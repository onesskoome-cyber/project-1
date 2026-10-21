import { hashPassword, randomHex, safeEqual } from "./crypto.mjs";
import {
  applyStudentScope,
  assertClassVisible,
  assertStudentVisible,
  exactCount,
  ok,
  publicUser,
  requireRole,
  scopeIsEmpty,
  studentScope,
  unwrap,
} from "./shared.mjs";
import * as v from "./validate.mjs";

const GENDERS = ["male", "female"];

export async function listClasses(supabase, user) {
  const scope = await studentScope(supabase, user);
  if (scopeIsEmpty(scope)) return ok({ items: [] });
  let query = supabase.from("classes").select("id,name,level,stream,teacher_id,created_at");
  if (!scope.all) query = query.in("id", scope.classIds);
  const rows = unwrap(await query.order("level").order("name").limit(200));
  const items = await withTeacherNames(supabase, rows ?? []);
  return ok({ items });
}

async function withTeacherNames(supabase, rows) {
  const ids = [...new Set(rows.map((row) => row.teacher_id).filter(Boolean))];
  const names = new Map();
  if (ids.length) {
    const users = unwrap(await supabase.from("users").select("id,full_name").in("id", ids));
    for (const user of users ?? []) names.set(user.id, user.full_name);
  }
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    level: row.level,
    stream: row.stream ?? null,
    teacherId: row.teacher_id ?? null,
    teacherName: names.get(row.teacher_id) ?? null,
  }));
}

export async function saveClass(supabase, user, body) {
  requireRole(user, "admin");
  const name = v.reqText(body.name, "name", 60);
  const level = v.reqInt(body.level, "level", { min: 1, max: 8 });
  const stream = v.optText(body.stream, "stream", 10);
  const teacherId = v.optId(body.teacherId, "teacherId");
  if (teacherId) await requireTeacher(supabase, teacherId);

  if (v.isUuid(body.id)) {
    const updated = unwrap(
      await supabase
        .from("classes")
        .update({ name, level, stream, teacher_id: teacherId })
        .eq("id", body.id)
        .select("id,name,level,stream,teacher_id")
        .maybeSingle(),
    );
    if (!updated) throw v.httpError("class_not_found", 404);
    return ok({ item: { id: updated.id, name: updated.name, level: updated.level, stream: updated.stream ?? null, teacherId: updated.teacher_id ?? null } });
  }

  const id = crypto.randomUUID();
  unwrap(
    await supabase
      .from("classes")
      .insert({ id, name, level, stream, teacher_id: teacherId, created_at: v.nowIso() })
      .select("id")
      .maybeSingle(),
    "class_name_taken",
  );
  return ok({ item: { id, name, level, stream, teacherId } }, 201);
}

export async function listSubjects(supabase, user, params) {
  const rows = unwrap(
    await supabase
      .from("subjects")
      .select("id,name,code,is_active")
      .order("name")
      .limit(200),
  );
  const activeOnly = params.filter === "active";
  const items = (rows ?? [])
    .filter((row) => (activeOnly ? row.is_active : true))
    .map((row) => ({ id: row.id, name: row.name, code: row.code, isActive: row.is_active }));
  return ok({ items });
}

export async function saveSubject(supabase, user, body) {
  requireRole(user, "admin");
  const name = v.reqText(body.name, "name", 80);
  const code = v.reqText(body.code, "code", 12).toUpperCase();

  if (v.isUuid(body.id)) {
    const isActive = body.isActive === undefined ? true : Boolean(body.isActive);
    const updated = unwrap(
      await supabase
        .from("subjects")
        .update({ name, code, is_active: isActive })
        .eq("id", body.id)
        .select("id,name,code,is_active")
        .maybeSingle(),
    );
    if (!updated) throw v.httpError("subject_not_found", 404);
    return ok({ item: { id: updated.id, name: updated.name, code: updated.code, isActive: updated.is_active } });
  }

  const id = crypto.randomUUID();
  unwrap(
    await supabase
      .from("subjects")
      .insert({ id, name, code, is_active: true })
      .select("id")
      .maybeSingle(),
    "subject_code_taken",
  );
  return ok({ item: { id, name, code, isActive: true } }, 201);
}

export async function listClassSubjects(supabase, user, params) {
  const classId = v.reqId(v.reqText(params.classId, "classId"), "classId");
  const scope = await studentScope(supabase, user);
  assertClassVisible(scope, classId);
  const rows = unwrap(
    await supabase.from("class_subjects").select("id,class_id,subject_id,teacher_id").eq("class_id", classId).limit(60),
  );
  const subjectIds = [...new Set((rows ?? []).map((row) => row.subject_id))];
  const teacherIds = [...new Set((rows ?? []).map((row) => row.teacher_id).filter(Boolean))];
  const subjects = new Map();
  const teachers = new Map();
  if (subjectIds.length) {
    const list = unwrap(await supabase.from("subjects").select("id,name,code").in("id", subjectIds));
    for (const row of list ?? []) subjects.set(row.id, row);
  }
  if (teacherIds.length) {
    const list = unwrap(await supabase.from("users").select("id,full_name").in("id", teacherIds));
    for (const row of list ?? []) teachers.set(row.id, row.full_name);
  }
  const items = (rows ?? []).map((row) => ({
    id: row.id,
    classId: row.class_id,
    subjectId: row.subject_id,
    subjectName: subjects.get(row.subject_id)?.name ?? "Unknown subject",
    subjectCode: subjects.get(row.subject_id)?.code ?? null,
    teacherId: row.teacher_id ?? null,
    teacherName: teachers.get(row.teacher_id) ?? null,
  }));
  return ok({ items });
}

export async function saveClassSubject(supabase, user, body) {
  requireRole(user, "admin");
  const classId = v.reqId(v.reqText(body.classId, "classId"), "classId");
  const subjectId = v.reqId(v.reqText(body.subjectId, "subjectId"), "subjectId");
  const teacherId = v.optId(body.teacherId, "teacherId");
  await requireRow(supabase, "classes", classId, "class_not_found");
  await requireRow(supabase, "subjects", subjectId, "subject_not_found");
  if (teacherId) await requireTeacher(supabase, teacherId);

  const key = `${classId}|${subjectId}`;
  unwrap(
    await supabase
      .from("class_subjects")
      .upsert({ id: crypto.randomUUID(), subject_key: key, class_id: classId, subject_id: subjectId, teacher_id: teacherId }, { onConflict: "subject_key" })
      .select("id")
      .maybeSingle(),
  );
  return ok({ item: { classId, subjectId, teacherId } });
}

const STUDENT_COLUMNS =
  "id,admission_no,first_name,last_name,gender,birth_date,class_id,parent_user_id,guardian_name,guardian_phone,is_active";

export async function listStudents(supabase, user, params) {
  const scope = await studentScope(supabase, user);
  const { offset, limit } = v.pageBounds(params.offset, params.limit, 100, 200);
  if (scopeIsEmpty(scope)) return ok({ items: [], total: 0, offset, limit });

  const classId = v.optId(params.classId, "classId");
  const search = sanitizeSearch(v.optText(params.search, "search", 60));
  const activeOnly = params.activeOnly === true || params.activeOnly === "true";

  // The scope filter is always applied, so an out-of-scope classId can only
  // narrow the result to nothing rather than widen it.
  const applyFilters = (query) => {
    let q = scope.all ? query : applyStudentScope(query, scope);
    if (classId) q = q.eq("class_id", classId);
    if (activeOnly) q = q.eq("is_active", true);
    if (search) {
      q = q.or(
        `first_name.ilike.%${search}%,last_name.ilike.%${search}%,admission_no.ilike.%${search}%`,
      );
    }
    return q;
  };

  const total = await exactCount(supabase, "students", applyFilters);
  const rows = unwrap(
    await applyFilters(supabase.from("students").select(STUDENT_COLUMNS))
      .order("first_name")
      .order("last_name")
      .range(offset, offset + limit - 1),
  );
  return ok({ items: (rows ?? []).map(toStudent), total, offset, limit });
}

// PostgREST reads , ( ) and % inside an `or` filter as syntax, so a search term
// is reduced to characters that can only ever match literal text.
function sanitizeSearch(raw) {
  const cleaned = (raw ?? "").replace(/[^A-Za-z0-9 /._-]/g, "").trim();
  return cleaned || null;
}

function toStudent(row) {
  return {
    id: row.id,
    admissionNo: row.admission_no,
    firstName: row.first_name,
    lastName: row.last_name,
    gender: row.gender,
    birthDate: row.birth_date ?? null,
    classId: row.class_id ?? null,
    parentUserId: row.parent_user_id ?? null,
    guardianName: row.guardian_name ?? null,
    guardianPhone: row.guardian_phone ?? null,
    isActive: row.is_active,
  };
}

export async function getStudent(supabase, user, params) {
  const studentId = v.reqId(v.reqText(params.studentId, "studentId"), "studentId");
  const scope = await studentScope(supabase, user);
  const rows = unwrap(
    await supabase.from("students").select(STUDENT_COLUMNS).eq("id", studentId).limit(1),
  );
  const row = rows?.[0];
  if (!row) throw v.httpError("student_not_found", 404);
  await assertStudentVisible(supabase, scope, row.id);
  const item = toStudent(row);
  if (row.class_id) {
    const cls = unwrap(await supabase.from("classes").select("id,name,level,stream").eq("id", row.class_id).limit(1));
    item.className = cls?.[0]?.name ?? null;
  }
  if (row.parent_user_id) {
    const parent = unwrap(
      await supabase.from("users").select("id,full_name,email,phone").eq("id", row.parent_user_id).limit(1),
    );
    item.parent = parent?.[0]
      ? { id: parent[0].id, fullName: parent[0].full_name, email: parent[0].email, phone: parent[0].phone }
      : null;
  }
  return ok({ item });
}

export async function saveStudent(supabase, user, body) {
  requireRole(user, "admin");
  const admissionNo = v.reqText(body.admissionNo, "admissionNo", 24).toUpperCase();
  const firstName = v.reqText(body.firstName, "firstName", 60);
  const lastName = v.reqText(body.lastName, "lastName", 60);
  const gender = v.reqOneOf(body.gender, GENDERS, "gender");
  const birthDate = v.optDay(body.birthDate, "birthDate");
  const classId = v.optId(body.classId, "classId");
  const parentUserId = v.optId(body.parentUserId, "parentUserId");
  const guardianName = v.optText(body.guardianName, "guardianName", 120);
  const guardianPhone = v.optText(body.guardianPhone, "guardianPhone", 24);
  const isActive = body.isActive === undefined ? true : Boolean(body.isActive);

  if (classId) await requireRow(supabase, "classes", classId, "class_not_found");
  if (parentUserId) await requireParent(supabase, parentUserId);

  const fields = {
    admission_no: admissionNo,
    first_name: firstName,
    last_name: lastName,
    gender,
    birth_date: birthDate,
    class_id: classId,
    parent_user_id: parentUserId,
    guardian_name: guardianName,
    guardian_phone: guardianPhone,
    is_active: isActive,
  };

  if (v.isUuid(body.id)) {
    const updated = unwrap(
      await supabase.from("students").update(fields).eq("id", body.id)
        .select("id,admission_no,first_name,last_name,gender,birth_date,class_id,parent_user_id,guardian_name,guardian_phone,is_active")
        .maybeSingle(),
      "admission_no_taken",
    );
    if (!updated) throw v.httpError("student_not_found", 404);
    return ok({ item: toStudent(updated) });
  }

  const id = crypto.randomUUID();
  unwrap(
    await supabase.from("students")
      .insert({ id, ...fields, created_at: v.nowIso() })
      .select("id")
      .maybeSingle(),
    "admission_no_taken",
  );
  return ok({ item: toStudent({ id, ...fields }) }, 201);
}

export async function listUsers(supabase, user, body) {
  requireRole(user, "admin");
  const role = v.optOneOf(body.role, ["admin", "teacher", "parent", "accountant"], "role");
  let query = supabase
    .from("users")
    .select("id,username,role,full_name,email,phone,is_active,created_at")
    .order("full_name")
    .limit(500);
  if (role) query = query.eq("role", role);
  const rows = unwrap(await query);
  return ok({ items: (rows ?? []).map(publicUser) });
}

export async function saveUser(supabase, user, body) {
  requireRole(user, "admin");
  const role = v.reqOneOf(body.role, ["admin", "teacher", "parent", "accountant"], "role");
  const fullName = v.reqText(body.fullName, "fullName", 120);
  const email = v.optText(body.email, "email", 160);
  const phone = v.optText(body.phone, "phone", 24);
  const isActive = body.isActive === undefined ? true : Boolean(body.isActive);

  if (v.isUuid(body.id)) {
    if (body.id === user.id && (!isActive || role !== "admin")) {
      throw v.httpError("cannot_demote_self");
    }
    const updated = unwrap(
      await supabase
        .from("users")
        .update({ role, full_name: fullName, email, phone, is_active: isActive })
        .eq("id", body.id)
        .select("id,username,role,full_name,email,phone,is_active")
        .maybeSingle(),
    );
    if (!updated) throw v.httpError("user_not_found", 404);
    // A password reset is optional on edit and must be explicitly requested.
    if (typeof body.password === "string" && body.password.length) {
      await setPassword(supabase, updated.id, v.reqPassword(body.password));
    }
    return ok({ item: publicUser(updated) });
  }

  const username = v.reqUsername(body.username);
  const password = v.reqPassword(body.password);
  const id = crypto.randomUUID();
  const salt = randomHex(16);
  unwrap(
    await supabase
      .from("users")
      .insert({
        id,
        username,
        password_hash: await hashPassword(password, salt),
        salt,
        role,
        full_name: fullName,
        email,
        phone,
        is_active: isActive,
        created_at: v.nowIso(),
      })
      .select("id")
      .maybeSingle(),
    "username_taken",
  );
  return ok({ item: publicUser({ id, username, role, full_name: fullName, email, phone }) }, 201);
}

async function setPassword(supabase, userId, password) {
  const salt = randomHex(16);
  unwrap(
    await supabase
      .from("users")
      .update({ password_hash: await hashPassword(password, salt), salt })
      .eq("id", userId)
      .select("id")
      .maybeSingle(),
  );
}

export async function changePassword(supabase, user, body) {
  const current = v.reqPassword(body.currentPassword, "currentPassword");
  const next = v.reqPassword(body.newPassword, "newPassword");
  if (current === next) throw v.httpError("password_unchanged");
  await verifyPasswordById(supabase, user.id, current);
  await setPassword(supabase, user.id, next);
  return ok();
}

async function verifyPasswordById(supabase, userId, password) {
  const rows = unwrap(
    await supabase.from("users").select("id,password_hash,salt").eq("id", userId).limit(1),
  );
  const row = rows?.[0];
  if (!row) throw v.httpError("user_not_found", 404);
  if (!safeEqual(await hashPassword(password, row.salt), row.password_hash)) {
    throw v.httpError("invalid_credentials", 401);
  }
}

async function requireRow(supabase, table, id, code) {
  const rows = unwrap(await supabase.from(table).select("id").eq("id", id).limit(1));
  if (!rows?.length) throw v.httpError(code, 404);
  return rows[0];
}

async function requireTeacher(supabase, userId) {
  const rows = unwrap(
    await supabase.from("users").select("id,role,is_active").eq("id", userId).limit(1),
  );
  const row = rows?.[0];
  if (!row || !row.is_active || !["teacher", "admin"].includes(row.role)) {
    throw v.httpError("teacherId_invalid");
  }
}

async function requireParent(supabase, userId) {
  const rows = unwrap(
    await supabase.from("users").select("id,role,is_active").eq("id", userId).limit(1),
  );
  const row = rows?.[0];
  if (!row || !row.is_active || row.role !== "parent") throw v.httpError("parentUserId_invalid");
}
