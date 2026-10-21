import { BANDS, aggregate } from "./grading.mjs";
import { ok, studentScope, unwrap, getSettings } from "./shared.mjs";
import { unreadCount } from "./comms.mjs";
import * as v from "./validate.mjs";

function tallyAttendance(rows) {
  const counts = { present: 0, absent: 0, sick: 0, exempt: 0 };
  for (const row of rows) if (row.status in counts) counts[row.status] += 1;
  const counted = counts.present + counts.absent + counts.sick;
  return { ...counts, recorded: rows.length, rate: counted ? Math.round((counts.present / counted) * 1000) / 10 : null };
}

async function termFinance(supabase, term, year) {
  const invoices = unwrap(
    await supabase.from("invoices").select("id,amount").eq("term", term).eq("year", year).limit(5000),
  ) ?? [];
  let expected = 0;
  for (const invoice of invoices) expected += invoice.amount;

  const payments = unwrap(
    await supabase.from("payments").select("amount").eq("term", term).eq("year", year).limit(20000),
  ) ?? [];
  let collected = 0;
  for (const payment of payments) collected += payment.amount;
  collected = Math.min(collected, expected);

  return {
    expected,
    collected,
    outstanding: Math.max(0, expected - collected),
    collectionRate: expected ? Math.round((collected / expected) * 1000) / 10 : 0,
    invoiceCount: invoices.length,
  };
}

export async function overview(supabase, user) {
  const settings = await getSettings(supabase);
  const term = Number(settings.currentTerm) || 3;
  const year = Number(settings.currentYear) || new Date().getFullYear();
  const today = v.today();
  const unread = await unreadCount(supabase, user);
  const base = {
    schoolName: settings.schoolName ?? "School",
    sampleData: settings.sampleData !== false,
    term,
    year,
    today,
    currency: settings.currencySymbol ?? "KSh",
    unread,
    bands: BANDS.map((band) => ({ grade: band.grade, range: `${band.min}-${band.max}`, points: band.points })),
  };

  if (user.role === "parent") return ok({ ...base, ...(await parentView(supabase, user)) });
  if (user.role === "teacher") return ok({ ...base, ...(await teacherView(supabase, user, today)) });
  if (user.role === "accountant") return ok({ ...base, ...(await accountantView(supabase, term, year)) });
  return ok({ ...base, ...(await adminView(supabase, today, term, year)) });
}

async function adminView(supabase, today, term, year) {
  const students = await countRows(supabase, "students", (q) => q.eq("is_active", true));
  const staff = await countRows(supabase, "users", (q) => q.in("role", ["teacher", "admin", "accountant"]).eq("is_active", true));
  const parents = await countRows(supabase, "users", (q) => q.eq("role", "parent").eq("is_active", true));
  const classes = await countRows(supabase, "classes", null);
  const attendanceRows = unwrap(
    await supabase.from("attendance").select("status").eq("day", today).limit(5000),
  ) ?? [];
  return {
    role: "admin",
    counts: { students, staff, parents, classes },
    attendanceToday: tallyAttendance(attendanceRows),
    finance: await termFinance(supabase, term, year),
  };
}

async function teacherView(supabase, user, today) {
  const scope = await studentScope(supabase, user);
  const classIds = scope.all ? [] : scope.classIds;
  if (!classIds.length) {
    return { role: "teacher", classes: [], studentCount: 0, attendanceToday: tallyAttendance([]), pendingExams: [] };
  }
  const classRows = unwrap(
    await supabase.from("classes").select("id,name,level").in("id", classIds).order("name").limit(50),
  ) ?? [];
  const studentRows = unwrap(
    await supabase.from("students").select("id").in("class_id", classIds).eq("is_active", true).limit(2000),
  ) ?? [];
  const studentIds = studentRows.map((row) => row.id);

  const marked = studentIds.length
    ? unwrap(
        await supabase.from("attendance").select("student_id").eq("day", today).in("student_id", studentIds).limit(2000),
      ) ?? []
    : [];
  const attendanceRows = unwrap(
    await supabase.from("attendance").select("status").eq("day", today).in("class_id", classIds).limit(2000),
  ) ?? [];

  const examRows = unwrap(
    await supabase.from("exams").select("id,name,class_id").in("class_id", classIds).limit(50),
  ) ?? [];
  const pendingExams = [];
  for (const exam of examRows) {
    const resultCount = await countRows(supabase, "results", (q) => q.eq("exam_id", exam.id));
    pendingExams.push({ id: exam.id, name: exam.name, classId: exam.class_id, resultsEntered: resultCount });
  }

  return {
    role: "teacher",
    classes: classRows.map((row) => ({ id: row.id, name: row.name, level: row.level })),
    studentCount: studentIds.length,
    attendanceToday: { ...tallyAttendance(attendanceRows), markedToday: marked.length },
    pendingExams,
  };
}

async function parentView(supabase, user) {
  const children = unwrap(
    await supabase
      .from("students")
      .select("id,first_name,last_name,class_id,admission_no")
      .eq("parent_user_id", user.id)
      .eq("is_active", true)
      .order("first_name")
      .limit(20),
  ) ?? [];

  const childIds = children.map((row) => row.id);
  const classIds = [...new Set(children.map((row) => row.class_id).filter(Boolean))];

  // Four bounded reads for the whole family instead of one per record.
  const [classNames, examRows, attendanceRows, invoiceRows, resultRows] = await Promise.all([
    classIds.length
      ? unwrap(await supabase.from("classes").select("id,name").in("id", classIds)).then((rows) => rows ?? [])
      : Promise.resolve([]),
    classIds.length
      ? unwrap(
          await supabase.from("exams").select("id,name,year,term,class_id")
            .in("class_id", classIds)
            .order("year", { ascending: false })
            .order("term", { ascending: false })
            .limit(50),
        ).then((rows) => rows ?? [])
      : Promise.resolve([]),
    childIds.length
      ? unwrap(await supabase.from("attendance").select("student_id,status").in("student_id", childIds).limit(2000)).then((rows) => rows ?? [])
      : Promise.resolve([]),
    childIds.length
      ? unwrap(await supabase.from("invoices").select("id,student_id,amount").in("student_id", childIds).limit(200)).then((rows) => rows ?? [])
      : Promise.resolve([]),
    childIds.length
      ? unwrap(await supabase.from("results").select("student_id,exam_id,marks,points").in("student_id", childIds).limit(2000)).then((rows) => rows ?? [])
      : Promise.resolve([]),
  ]);

  const nameOfClass = new Map(classNames.map((row) => [row.id, row.name]));
  const paymentsByInvoice = new Map();
  if (invoiceRows.length) {
    const payments = unwrap(
      await supabase.from("payments").select("invoice_id,amount").in("invoice_id", invoiceRows.map((row) => row.id)).limit(1000),
    ) ?? [];
    for (const payment of payments) {
      paymentsByInvoice.set(payment.invoice_id, (paymentsByInvoice.get(payment.invoice_id) ?? 0) + payment.amount);
    }
  }

  const attendanceByChild = groupBy(attendanceRows, (row) => row.student_id);
  const invoicesByChild = groupBy(invoiceRows, (row) => row.student_id);
  const resultsByChild = groupBy(resultRows, (row) => row.student_id);

  let balance = 0;
  const items = children.map((child) => {
    let owed = 0;
    let billed = 0;
    for (const invoice of invoicesByChild.get(child.id) ?? []) {
      const paid = paymentsByInvoice.get(invoice.id) ?? 0;
      billed += invoice.amount;
      owed += Math.max(0, invoice.amount - paid);
    }
    balance += owed;

    // Most recent exam that actually has marks for this child.
    const byExam = groupBy(resultsByChild.get(child.id) ?? [], (row) => row.exam_id);
    const exam = examRows.find((row) => row.class_id === child.class_id && byExam.has(row.id));
    const summary = exam
      ? aggregate((byExam.get(exam.id) ?? []).map((row) => ({ marks: row.marks, points: row.points })))
      : null;

    return {
      id: child.id,
      firstName: child.first_name,
      lastName: child.last_name,
      admissionNo: child.admission_no,
      className: nameOfClass.get(child.class_id) ?? null,
      attendance: tallyAttendance(attendanceByChild.get(child.id) ?? []),
      feeBalance: owed,
      feeBilled: billed,
      latestExam: exam ? { id: exam.id, name: exam.name, term: exam.term, year: exam.year } : null,
      summary,
    };
  });

  return { role: "parent", children: items, feeBalance: balance };
}

function groupBy(rows, keyOf) {
  const map = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

async function accountantView(supabase, term, year) {
  const finance = await termFinance(supabase, term, year);
  const invoices = unwrap(
    await supabase.from("invoices").select("id,student_id,amount").eq("term", term).eq("year", year).limit(5000),
  ) ?? [];
  const status = { paid: 0, partial: 0, unpaid: 0 };
  const owing = [];
  const paidTotals = new Map();
  const payments = unwrap(
    await supabase.from("payments").select("invoice_id,amount").eq("term", term).eq("year", year).limit(20000),
  ) ?? [];
  for (const payment of payments) {
    paidTotals.set(payment.invoice_id, (paidTotals.get(payment.invoice_id) ?? 0) + payment.amount);
  }
  for (const invoice of invoices) {
    const paid = paidTotals.get(invoice.id) ?? 0;
    const state = paid <= 0 ? "unpaid" : paid >= invoice.amount ? "paid" : "partial";
    status[state] += 1;
    if (state !== "paid") {
      owing.push({ studentId: invoice.student_id, balance: Math.max(0, invoice.amount - paid) });
    }
  }
  owing.sort((a, b) => b.balance - a.balance);

  const topIds = owing.slice(0, 8).map((row) => row.studentId);
  const names = new Map();
  if (topIds.length) {
    const rows = unwrap(
      await supabase.from("students").select("id,first_name,last_name,class_id").in("id", topIds),
    ) ?? [];
    for (const row of rows) names.set(row.id, row);
  }
  const classIds = [...new Set([...names.values()].map((row) => row.class_id).filter(Boolean))];
  const classNames = new Map();
  if (classIds.length) {
    const rows = unwrap(await supabase.from("classes").select("id,name").in("id", classIds)) ?? [];
    for (const row of rows) classNames.set(row.id, row.name);
  }

  return {
    role: "accountant",
    finance: { ...finance, status },
    topBalances: owing.slice(0, 8).map((row) => ({
      studentId: row.studentId,
      name: names.get(row.studentId)
        ? `${names.get(row.studentId).first_name} ${names.get(row.studentId).last_name}`
        : null,
      className: classNames.get(names.get(row.studentId)?.class_id) ?? null,
      balance: row.balance,
    })),
  };
}

async function countRows(supabase, table, applyFilters) {
  let query = supabase.from(table).select("id", { count: "exact" });
  if (applyFilters) query = applyFilters(query) ?? query;
  const result = await query.limit(1);
  if (result.error || !Number.isSafeInteger(result.count)) return 0;
  return result.count;
}
