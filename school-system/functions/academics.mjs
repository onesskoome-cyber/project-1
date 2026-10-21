import { aggregate, bandFor, gradeFor, pointsFor } from "./grading.mjs";
import {
  applyStudentScope,
  assertClassVisible,
  assertStudentVisible,
  ok,
  requireRole,
  scopeIsEmpty,
  studentScope,
  unwrap,
} from "./shared.mjs";
import * as v from "./validate.mjs";

const ATTENDANCE_STATUSES = ["present", "absent", "sick", "exempt"];
const COUNTED = ["present", "absent", "sick"];

async function classStudents(supabase, classId) {
  const rows = unwrap(
    await supabase
      .from("students")
      .select("id,admission_no,first_name,last_name")
      .eq("class_id", classId)
      .eq("is_active", true)
      .order("first_name")
      .order("last_name")
      .limit(200),
  );
  return rows ?? [];
}

export async function attendanceSheet(supabase, user, params) {
  const classId = v.reqId(v.reqText(params.classId, "classId"), "classId");
  const day = v.reqDay(params.day, "day");
  const scope = await studentScope(supabase, user);
  if (!scope.all) assertClassVisible(scope, classId);

  const students = await classStudents(supabase, classId);
  const ids = students.map((student) => student.id);
  const records = ids.length
    ? unwrap(
        await supabase
          .from("attendance")
          .select("student_id,status,note")
          .eq("day", day)
          .in("student_id", ids)
          .limit(500),
      ) ?? []
    : [];
  const byStudent = new Map(records.map((row) => [row.student_id, row]));

  return ok({
    classId,
    day,
    statuses: ATTENDANCE_STATUSES,
    items: students.map((student) => ({
      studentId: student.id,
      admissionNo: student.admission_no,
      firstName: student.first_name,
      lastName: student.last_name,
      status: byStudent.get(student.id)?.status ?? null,
      note: byStudent.get(student.id)?.note ?? null,
    })),
  });
}

export async function saveAttendance(supabase, user, params) {
  requireRole(user, "admin", "teacher");
  const classId = v.reqId(v.reqText(params.classId, "classId"), "classId");
  const day = v.reqDay(params.day, "day");
  const scope = await studentScope(supabase, user);
  if (!scope.all) assertClassVisible(scope, classId);

  const entries = v.reqJsonArray(params.entries, "entries", 200);
  if (!entries.length) throw v.httpError("entries_required");
  const allowed = new Set((await classStudents(supabase, classId)).map((s) => s.id));
  const recordedAt = v.nowIso();
  const rows = [];
  const seen = new Set();

  for (const entry of entries) {
    if (entry === null || typeof entry !== "object") throw v.httpError("entries_invalid");
    const studentId = v.reqId(v.reqText(entry.studentId, "studentId"), "studentId");
    if (!allowed.has(studentId)) throw v.httpError("student_not_in_class", 403);
    if (seen.has(studentId)) throw v.httpError("duplicate_student_entry");
    seen.add(studentId);
    const status = v.reqOneOf(entry.status, ATTENDANCE_STATUSES, "status");
    rows.push({
      id: crypto.randomUUID(),
      record_key: `${studentId}|${day}`,
      student_id: studentId,
      class_id: classId,
      day,
      status,
      note: v.optText(entry.note, "note", 200),
      recorded_by: user.id,
      recorded_at: recordedAt,
    });
  }

  unwrap(
    await supabase
      .from("attendance")
      .upsert(rows, { onConflict: "record_key" })
      .select("record_key"),
  );
  return ok({ saved: rows.length, classId, day });
}

export async function attendanceSummary(supabase, user, params) {
  const scope = await studentScope(supabase, user);
  const from = v.reqDay(params.from, "from");
  const to = v.reqDay(params.to, "to");
  if (from > to) throw v.httpError("range_invalid");
  const studentId = v.optId(params.studentId, "studentId");

  if (studentId) {
    await assertStudentVisible(supabase, scope, studentId);
    const rows = unwrap(
      await supabase
        .from("attendance")
        .select("day,status")
        .eq("student_id", studentId)
        .gte("day", from)
        .lte("day", to)
        .order("day")
        .limit(500),
    ) ?? [];
    const tally = tallyStatuses(rows);
    return ok({ from, to, days: rows.length, ...tally, daily: rows });
  }

  if (scopeIsEmpty(scope)) return ok({ from, to, items: [] });
  const classId = v.optId(params.classId, "classId");
  if (classId && !scope.all) assertClassVisible(scope, classId);

  let query = supabase.from("attendance").select("student_id,day,status");
  query = scope.all ? query : applyStudentScope(query, scope, "student_id");
  if (classId) query = query.eq("class_id", classId);
  const rows = unwrap(await query.gte("day", from).lte("day", to).limit(5000)) ?? [];

  const perStudent = new Map();
  for (const row of rows) {
    if (!perStudent.has(row.student_id)) perStudent.set(row.student_id, []);
    perStudent.get(row.student_id).push(row);
  }
  const items = [...perStudent.entries()].map(([sid, list]) => ({
    studentId: sid,
    days: list.length,
    ...tallyStatuses(list),
  }));
  return ok({ from, to, items, total: rows.length, truncated: rows.length >= 5000 });
}

function tallyStatuses(rows) {
  const counts = { present: 0, absent: 0, sick: 0, exempt: 0 };
  for (const row of rows) if (row.status in counts) counts[row.status] += 1;
  const counted = COUNTED.reduce((sum, status) => sum + counts[status], 0);
  return {
    ...counts,
    rate: counted ? Math.round((counts.present / counted) * 1000) / 10 : null,
  };
}

export async function listExams(supabase, user, params) {
  const scope = await studentScope(supabase, user);
  if (scopeIsEmpty(scope)) return ok({ items: [] });
  const classId = v.optId(params.classId, "classId");
  if (classId && !scope.all) assertClassVisible(scope, classId);

  let query = supabase
    .from("exams")
    .select("id,name,term,year,class_id,exam_date,created_at")
    .order("year", { ascending: false })
    .order("term", { ascending: false })
    .limit(100);
  if (classId) query = query.eq("class_id", classId);
  else if (!scope.all && scope.by === "class") query = query.in("class_id", scope.classIds);
  else if (!scope.all && scope.by === "student") {
    // Parents see exams belonging to their children's classes.
    const rows = unwrap(
      await supabase.from("students").select("class_id").in("id", scope.studentIds).limit(50),
    ) ?? [];
    const ids = [...new Set(rows.map((row) => row.class_id).filter(Boolean))];
    if (!ids.length) return ok({ items: [] });
    query = query.in("class_id", ids);
  }

  const rows = unwrap(await query) ?? [];
  const classIds = [...new Set(rows.map((row) => row.class_id))];
  const names = new Map();
  if (classIds.length) {
    const list = unwrap(await supabase.from("classes").select("id,name").in("id", classIds));
    for (const row of list ?? []) names.set(row.id, row.name);
  }
  return ok({
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      term: row.term,
      year: row.year,
      classId: row.class_id,
      className: names.get(row.class_id) ?? null,
      examDate: row.exam_date ?? null,
    })),
  });
}

export async function saveExam(supabase, user, params) {
  requireRole(user, "admin", "teacher");
  const name = v.reqText(params.name, "name", 80);
  const term = v.reqTerm(params.term);
  const year = v.reqYear(params.year);
  const classId = v.reqId(v.reqText(params.classId, "classId"), "classId");
  const examDate = v.optDay(params.examDate, "examDate");
  const scope = await studentScope(supabase, user);
  if (!scope.all) assertClassVisible(scope, classId);
  await requireClass(supabase, classId);

  if (v.isUuid(params.id)) {
    const updated = unwrap(
      await supabase
        .from("exams")
        .update({ name, term, year, class_id: classId, exam_date: examDate })
        .eq("id", params.id)
        .select("id,name,term,year,class_id,exam_date")
        .maybeSingle(),
    );
    if (!updated) throw v.httpError("exam_not_found", 404);
    return ok({ item: toExam(updated) });
  }
  const id = crypto.randomUUID();
  unwrap(
    await supabase
      .from("exams")
      .insert({ id, name, term, year, class_id: classId, exam_date: examDate, created_at: v.nowIso() })
      .select("id")
      .maybeSingle(),
  );
  return ok({ item: toExam({ id, name, term, year, class_id: classId, exam_date: examDate }) }, 201);
}

function toExam(row) {
  return {
    id: row.id,
    name: row.name,
    term: row.term,
    year: row.year,
    classId: row.class_id,
    examDate: row.exam_date ?? null,
  };
}

async function requireClass(supabase, classId) {
  const rows = unwrap(await supabase.from("classes").select("id").eq("id", classId).limit(1));
  if (!rows?.length) throw v.httpError("class_not_found", 404);
}

async function requireExam(supabase, examId) {
  const rows = unwrap(
    await supabase.from("exams").select("id,name,term,year,class_id,exam_date").eq("id", examId).limit(1),
  );
  const exam = rows?.[0];
  if (!exam) throw v.httpError("exam_not_found", 404);
  return exam;
}

export async function resultsSheet(supabase, user, params) {
  const examId = v.reqId(v.reqText(params.examId, "examId"), "examId");
  const subjectId = v.reqId(v.reqText(params.subjectId, "subjectId"), "subjectId");
  const exam = await requireExam(supabase, examId);
  const scope = await studentScope(supabase, user);
  if (!scope.all) assertClassVisible(scope, exam.class_id);
  await requireSubject(supabase, subjectId);

  const students = await classStudents(supabase, exam.class_id);
  const ids = students.map((student) => student.id);
  const rows = ids.length
    ? unwrap(
        await supabase
          .from("results")
          .select("student_id,marks,grade")
          .eq("exam_id", examId)
          .eq("subject_id", subjectId)
          .in("student_id", ids)
          .limit(500),
      ) ?? []
    : [];
  const mine = new Map(rows.map((row) => [row.student_id, row]));

  return ok({
    exam: toExam(exam),
    subjectId,
    items: students.map((student) => ({
      studentId: student.id,
      admissionNo: student.admission_no,
      firstName: student.first_name,
      lastName: student.last_name,
      marks: mine.get(student.id)?.marks ?? null,
      grade: mine.get(student.id)?.grade ?? null,
    })),
  });
}

export async function saveResults(supabase, user, params) {
  requireRole(user, "admin", "teacher");
  const examId = v.reqId(v.reqText(params.examId, "examId"), "examId");
  const subjectId = v.reqId(v.reqText(params.subjectId, "subjectId"), "subjectId");
  const exam = await requireExam(supabase, examId);
  const scope = await studentScope(supabase, user);
  if (!scope.all) assertClassVisible(scope, exam.class_id);
  await requireSubject(supabase, subjectId);

  const entries = v.reqJsonArray(params.entries, "entries", 200);
  if (!entries.length) throw v.httpError("entries_required");
  const allowed = new Set((await classStudents(supabase, exam.class_id)).map((s) => s.id));
  const enteredAt = v.nowIso();
  const rows = [];
  const seen = new Set();

  for (const entry of entries) {
    if (entry === null || typeof entry !== "object") throw v.httpError("entries_invalid");
    const studentId = v.reqId(v.reqText(entry.studentId, "studentId"), "studentId");
    if (!allowed.has(studentId)) throw v.httpError("student_not_in_class", 403);
    if (seen.has(studentId)) throw v.httpError("duplicate_student_entry");
    seen.add(studentId);
    if (entry.marks === null || entry.marks === undefined || entry.marks === "") continue;
    const marks = v.reqMarks(entry.marks);
    rows.push({
      id: crypto.randomUUID(),
      result_key: `${examId}|${studentId}|${subjectId}`,
      exam_id: examId,
      student_id: studentId,
      subject_id: subjectId,
      marks,
      grade: gradeFor(marks),
      points: pointsFor(marks),
      entered_by: user.id,
      entered_at: enteredAt,
    });
  }

  if (!rows.length) throw v.httpError("no_marks_supplied");
  unwrap(
    await supabase
      .from("results")
      .upsert(rows, { onConflict: "result_key" })
      .select("result_key"),
  );
  return ok({ saved: rows.length, examId, subjectId });
}

async function requireSubject(supabase, subjectId) {
  const rows = unwrap(await supabase.from("subjects").select("id").eq("id", subjectId).limit(1));
  if (!rows?.length) throw v.httpError("subject_not_found", 404);
}

/** Every result row for an exam, grouped for aggregation and ranking. */
async function examResults(supabase, examId) {
  const rows = unwrap(
    await supabase
      .from("results")
      .select("student_id,subject_id,marks,grade,points")
      .eq("exam_id", examId)
      .limit(5000),
  ) ?? [];
  const byStudent = new Map();
  for (const row of rows) {
    if (!byStudent.has(row.student_id)) byStudent.set(row.student_id, []);
    byStudent.get(row.student_id).push(row);
  }
  return { rows, byStudent };
}

export async function reportCard(supabase, user, params) {
  requireRole(user, "admin", "teacher", "parent");
  const studentId = v.reqId(v.reqText(params.studentId, "studentId"), "studentId");
  const examId = v.reqId(v.reqText(params.examId, "examId"), "examId");
  const scope = await studentScope(supabase, user);
  await assertStudentVisible(supabase, scope, studentId);
  const exam = await requireExam(supabase, examId);

  const studentRows = unwrap(
    await supabase
      .from("students")
      .select("id,admission_no,first_name,last_name,class_id")
      .eq("id", studentId)
      .limit(1),
  );
  const student = studentRows?.[0];
  if (!student) throw v.httpError("student_not_found", 404);
  if (student.class_id !== exam.class_id) throw v.httpError("exam_student_mismatch");

  const { byStudent } = await examResults(supabase, examId);
  const mine = byStudent.get(studentId) ?? [];
  const subjectIds = [...new Set([...byStudent.values()].flat().map((row) => row.subject_id))];
  const subjects = new Map();
  if (subjectIds.length) {
    const list = unwrap(await supabase.from("subjects").select("id,name,code").in("id", subjectIds));
    for (const row of list ?? []) subjects.set(row.id, row);
  }

  const entries = mine.map((row) => ({
    subjectId: row.subject_id,
    subject: subjects.get(row.subject_id)?.name ?? "Unknown",
    code: subjects.get(row.subject_id)?.code ?? null,
    marks: row.marks,
    grade: row.grade,
    points: row.points,
    remark: bandFor(row.marks).remark,
  }));

  const meanPointsOf = (list) => (list.length ? list.reduce((s, r) => s + r.points, 0) / list.length : 0);
  const allMeans = [...byStudent.values()].map(meanPointsOf).filter((value) => value > 0);
  const summary = aggregate(entries);
  const rank = summary ? rankAmong(meanPointsOf(mine), allMeans) : null;

  const classRows = unwrap(await supabase.from("classes").select("id,name").eq("id", exam.class_id).limit(1));
  return ok({
    exam: toExam(exam),
    className: classRows?.[0]?.name ?? null,
    student: {
      id: student.id,
      admissionNo: student.admission_no,
      firstName: student.first_name,
      lastName: student.last_name,
    },
    entries,
    summary,
    rank,
    cohortSize: allMeans.length,
    bands: ["A", "B", "C", "D", "E"],
  });
}

function rankAmong(meanPoints, allMeans) {
  const sorted = [...allMeans].sort((a, b) => b - a);
  return sorted.findIndex((value) => value <= meanPoints) + 1;
}

export async function classReport(supabase, user, params) {
  requireRole(user, "admin", "teacher");
  const examId = v.reqId(v.reqText(params.examId, "examId"), "examId");
  const exam = await requireExam(supabase, examId);
  const scope = await studentScope(supabase, user);
  if (!scope.all) assertClassVisible(scope, exam.class_id);

  const { byStudent } = await examResults(supabase, examId);
  const students = await classStudents(supabase, exam.class_id);

  const rows = students.map((student) => {
    const list = byStudent.get(student.id) ?? [];
    return { student, list, summary: aggregate(list) };
  });
  const ranked = rows
    .filter((row) => row.summary)
    .sort((a, b) => b.summary.meanPoints - a.summary.meanPoints);
  const positionOf = new Map();
  ranked.forEach((row, index) => {
    const previous = ranked[index - 1];
    const position = previous && previous.summary.meanPoints === row.summary.meanPoints
      ? positionOf.get(previous.student.id)
      : index + 1;
    positionOf.set(row.student.id, position);
  });

  const allMeans = ranked.map((row) => row.summary.meanPoints);

  return ok({
    exam: toExam(exam),
    items: rows.map((row) => ({
      studentId: row.student.id,
      admissionNo: row.student.admission_no,
      firstName: row.student.first_name,
      lastName: row.student.last_name,
      subjects: row.summary?.subjects ?? 0,
      meanMarks: row.summary?.meanMarks ?? null,
      meanGrade: row.summary?.meanGrade ?? null,
      meanPoints: row.summary?.meanPoints ?? null,
      position: positionOf.get(row.student.id) ?? null,
    })),
    cohortSize: allMeans.length,
  });
}
