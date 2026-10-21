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

const METHODS = ["cash", "mpesa", "bank", "cheque", "other"];

function money(value) {
  return v.reqMoney(value);
}

function parseItems(raw, field = "items") {
  const list = v.reqJsonArray(raw, field, 40);
  if (!list.length) throw v.httpError(`${field}_required`);
  let total = 0;
  const items = list.map((entry) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw v.httpError(`${field}_invalid`);
    }
    const label = v.reqText(entry.label, "label", 80);
    const amount = money(entry.amount);
    total += amount;
    return { label, amount };
  });
  if (total > 100000000) throw v.httpError("total_out_of_range");
  return { items, total };
}

export async function getFeeStructure(supabase, user, params) {
  requireRole(user, "admin", "accountant", "teacher");
  const classId = v.reqId(v.reqText(params.classId, "classId"), "classId");
  const term = v.reqTerm(params.term);
  const year = v.reqYear(params.year);
  const scope = await studentScope(supabase, user);
  if (!scope.all) assertClassVisible(scope, classId);

  const rows = unwrap(
    await supabase
      .from("fee_structures")
      .select("id,class_id,term,year,items,total")
      .eq("structure_key", `${classId}|${term}|${year}`)
      .limit(1),
  );
  const row = rows?.[0];
  return ok({
    classId,
    term,
    year,
    exists: Boolean(row),
    items: row?.items ?? [],
    total: row?.total ?? 0,
    id: row?.id ?? null,
  });
}

export async function saveFeeStructure(supabase, user, params) {
  requireRole(user, "admin", "accountant");
  const classId = v.reqId(v.reqText(params.classId, "classId"), "classId");
  const term = v.reqTerm(params.term);
  const year = v.reqYear(params.year);
  const { items, total } = parseItems(params.items);
  await requireClass(supabase, classId);

  const payload = {
    id: crypto.randomUUID(),
    structure_key: `${classId}|${term}|${year}`,
    class_id: classId,
    term,
    year,
    items,
    total,
    created_at: v.nowIso(),
  };
  unwrap(
    await supabase
      .from("fee_structures")
      .upsert(payload, { onConflict: "structure_key" })
      .select("id,total")
      .maybeSingle(),
  );
  return ok({ classId, term, year, items, total });
}

async function requireClass(supabase, classId) {
  const rows = unwrap(await supabase.from("classes").select("id").eq("id", classId).limit(1));
  if (!rows?.length) throw v.httpError("class_not_found", 404);
}

export async function generateInvoices(supabase, user, params) {
  requireRole(user, "admin", "accountant");
  const classId = v.reqId(v.reqText(params.classId, "classId"), "classId");
  const term = v.reqTerm(params.term);
  const year = v.reqYear(params.year);
  await requireClass(supabase, classId);

  const structures = unwrap(
    await supabase
      .from("fee_structures")
      .select("id,items,total")
      .eq("structure_key", `${classId}|${term}|${year}`)
      .limit(1),
  );
  const structure = structures?.[0];
  if (!structure) throw v.httpError("fee_structure_not_found", 404);

  const students = unwrap(
    await supabase
      .from("students")
      .select("id,first_name,last_name")
      .eq("class_id", classId)
      .eq("is_active", true)
      .limit(300),
  ) ?? [];
  if (!students.length) throw v.httpError("class_has_no_students");

  const ids = students.map((student) => student.id);
  const existing = unwrap(
    await supabase
      .from("invoices")
      .select("student_id")
      .eq("term", term)
      .eq("year", year)
      .in("student_id", ids)
      .limit(300),
  ) ?? [];
  const alreadyBilled = new Set(existing.map((row) => row.student_id));
  const created = v.nowIso();
  const rows = students
    .filter((student) => !alreadyBilled.has(student.id))
    .map((student) => ({
      id: crypto.randomUUID(),
      invoice_key: `${student.id}|${term}|${year}`,
      student_id: student.id,
      class_id: classId,
      term,
      year,
      items: structure.items,
      amount: structure.total,
      created_at: created,
    }));

  if (rows.length) {
    unwrap(await supabase.from("invoices").insert(rows).select("invoice_key"));
  }
  return ok({ created: rows.length, skipped: alreadyBilled.size, classId, term, year });
}

const INVOICE_COLUMNS = "id,student_id,class_id,term,year,items,amount,created_at";

export async function listInvoices(supabase, user, params) {
  requireRole(user, "admin", "accountant", "teacher", "parent");
  const scope = await studentScope(supabase, user);
  const { offset, limit } = v.pageBounds(params.offset, params.limit, 100, 200);
  if (scopeIsEmpty(scope)) return ok({ items: [], total: 0, offset, limit, currency: "KES" });

  const term = v.optInt(params.term, "term", { min: 1, max: 3 });
  const year = v.optInt(params.year, "year", { min: 1990, max: 2200 });
  const classId = v.optId(params.classId, "classId");
  const status = v.optOneOf(params.status, ["paid", "partial", "unpaid"], "status");

  const applyFilters = (query) => {
    let q = scope.all ? query : applyStudentScope(query, scope, "student_id");
    if (term) q = q.eq("term", term);
    if (year) q = q.eq("year", year);
    if (classId) q = q.eq("class_id", classId);
    return q;
  };

  const rows = unwrap(
    await applyFilters(supabase.from("invoices").select(INVOICE_COLUMNS))
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1),
  ) ?? [];

  const paidByInvoice = await sumPayments(supabase, rows.map((row) => row.id));
  let items = rows.map((row) => toInvoice(row, paidByInvoice.get(row.id) ?? 0));
  if (status) items = items.filter((item) => item.status === status);

  const studentNames = await studentNameMap(supabase, items.map((item) => item.studentId));
  for (const item of items) item.studentName = studentNames.get(item.studentId) ?? null;

  return ok({ items, offset, limit, counted: rows.length });
}

async function studentNameMap(supabase, studentIds) {
  const ids = [...new Set(studentIds.filter(Boolean))];
  const names = new Map();
  if (!ids.length) return names;
  const rows = unwrap(
    await supabase.from("students").select("id,first_name,last_name,admission_no").in("id", ids).limit(500),
  );
  for (const row of rows ?? []) {
    names.set(row.id, `${row.first_name} ${row.last_name}`);
  }
  return names;
}

async function sumPayments(supabase, invoiceIds) {
  const totals = new Map();
  const ids = [...new Set(invoiceIds.filter(Boolean))];
  if (!ids.length) return totals;
  const rows = unwrap(
    await supabase.from("payments").select("invoice_id,amount").in("invoice_id", ids).limit(20000),
  );
  for (const row of rows ?? []) {
    totals.set(row.invoice_id, (totals.get(row.invoice_id) ?? 0) + row.amount);
  }
  return totals;
}

function toInvoice(row, paid) {
  const amount = row.amount;
  const balance = Math.max(0, amount - paid);
  return {
    id: row.id,
    studentId: row.student_id,
    classId: row.class_id ?? null,
    term: row.term,
    year: row.year,
    items: row.items ?? [],
    amount,
    paid,
    balance,
    status: paid <= 0 ? "unpaid" : paid >= amount ? "paid" : "partial",
    createdAt: row.created_at,
  };
}

export async function invoiceDetail(supabase, user, params) {
  const invoiceId = v.reqId(v.reqText(params.invoiceId, "invoiceId"), "invoiceId");
  const scope = await studentScope(supabase, user);
  const rows = unwrap(
    await supabase.from("invoices").select(INVOICE_COLUMNS).eq("id", invoiceId).limit(1),
  );
  const row = rows?.[0];
  if (!row) throw v.httpError("invoice_not_found", 404);
  await assertStudentVisible(supabase, scope, row.student_id);

  const paidByInvoice = await sumPayments(supabase, [invoiceId]);
  const invoice = toInvoice(row, paidByInvoice.get(invoiceId) ?? 0);
  const names = await studentNameMap(supabase, [row.student_id]);
  invoice.studentName = names.get(row.student_id) ?? null;

  const payments = unwrap(
    await supabase
      .from("payments")
      .select("id,amount,method,reference,note,received_by,paid_at")
      .eq("invoice_id", invoiceId)
      .order("paid_at", { ascending: false })
      .limit(200),
  ) ?? [];
  const receiverIds = [...new Set(payments.map((row) => row.received_by).filter(Boolean))];
  const receivers = new Map();
  if (receiverIds.length) {
    const list = unwrap(await supabase.from("users").select("id,full_name").in("id", receiverIds));
    for (const item of list ?? []) receivers.set(item.id, item.full_name);
  }

  return ok({
    invoice,
    payments: payments.map((payment) => ({
      id: payment.id,
      amount: payment.amount,
      method: payment.method,
      reference: payment.reference ?? null,
      note: payment.note ?? null,
      receivedBy: receivers.get(payment.received_by) ?? null,
      paidAt: payment.paid_at,
    })),
  });
}

export async function recordPayment(supabase, user, params) {
  requireRole(user, "admin", "accountant");
  const invoiceId = v.reqId(v.reqText(params.invoiceId, "invoiceId"), "invoiceId");
  const amount = v.reqInt(params.amount, "amount", { min: 1, max: 100000000 });
  const method = v.reqOneOf(params.method, METHODS, "method");
  const reference = v.optText(params.reference, "reference", 60);
  const note = v.optText(params.note, "note", 200);

  const rows = unwrap(
    await supabase.from("invoices").select("id,student_id,amount,term,year").eq("id", invoiceId).limit(1),
  );
  const invoice = rows?.[0];
  if (!invoice) throw v.httpError("invoice_not_found", 404);

  const paidSoFar = (await sumPayments(supabase, [invoiceId])).get(invoiceId) ?? 0;
  const balance = invoice.amount - paidSoFar;
  if (balance <= 0) throw v.httpError("invoice_already_settled", 409);
  // Sequential SDK calls are not a transaction, so two simultaneous payments
  // could both pass this precheck. The overpayment is visible in the balance
  // and must be corrected by an accountant; it cannot be prevented atomically.
  if (amount > balance) throw v.httpError("amount_exceeds_balance");

  const id = crypto.randomUUID();
  unwrap(
    await supabase
      .from("payments")
      .insert({
        id,
        invoice_id: invoiceId,
        student_id: invoice.student_id,
        term: invoice.term,
        year: invoice.year,
        amount,
        method,
        reference,
        note,
        received_by: user.id,
        paid_at: v.nowIso(),
      })
      .select("id")
      .maybeSingle(),
  );
  return ok({
    id,
    invoiceId,
    amount,
    balance: Math.max(0, balance - amount),
  }, 201);
}

export async function financeSummary(supabase, user, params) {
  requireRole(user, "admin", "accountant", "teacher");
  const term = v.optInt(params.term, "term", { min: 1, max: 3 });
  const year = v.optInt(params.year, "year", { min: 1990, max: 2200 });

  let invoiceQuery = supabase.from("invoices").select("id,student_id,class_id,amount");
  if (term) invoiceQuery = invoiceQuery.eq("term", term);
  if (year) invoiceQuery = invoiceQuery.eq("year", year);
  const invoices = unwrap(await invoiceQuery.limit(5000)) ?? [];

  // Payments carry term and year so a whole-term report is two bounded reads
  // instead of one read plus an IN filter over thousands of invoice ids.
  let paymentQuery = supabase.from("payments").select("invoice_id,amount,method");
  if (term) paymentQuery = paymentQuery.eq("term", term);
  if (year) paymentQuery = paymentQuery.eq("year", year);
  const payments = unwrap(await paymentQuery.limit(20000)) ?? [];

  const invoiceIds = new Set(invoices.map((row) => row.id));
  const paidByInvoice = new Map();
  const methodTotals = new Map();
  for (const payment of payments) {
    if (!invoiceIds.has(payment.invoice_id)) continue;
    paidByInvoice.set(payment.invoice_id, (paidByInvoice.get(payment.invoice_id) ?? 0) + payment.amount);
    methodTotals.set(payment.method, (methodTotals.get(payment.method) ?? 0) + payment.amount);
  }

  let expected = 0;
  let collected = 0;
  const status = { paid: 0, partial: 0, unpaid: 0 };
  const byClass = new Map();

  for (const invoice of invoices) {
    const paid = Math.min(invoice.amount, paidByInvoice.get(invoice.id) ?? 0);
    expected += invoice.amount;
    collected += paid;
    const state = paid <= 0 ? "unpaid" : paid >= invoice.amount ? "paid" : "partial";
    status[state] += 1;
    const key = invoice.class_id ?? "none";
    const bucket = byClass.get(key) ?? { classId: invoice.class_id, expected: 0, collected: 0 };
    bucket.expected += invoice.amount;
    bucket.collected += paid;
    byClass.set(key, bucket);
  }

  const classIds = [...byClass.keys()].filter((key) => key !== "none");
  const classNames = new Map();
  if (classIds.length) {
    const list = unwrap(await supabase.from("classes").select("id,name").in("id", classIds));
    for (const row of list ?? []) classNames.set(row.id, row.name);
  }

  return ok({
    term: term ?? null,
    year: year ?? null,
    invoiceCount: invoices.length,
    expected,
    collected,
    outstanding: Math.max(0, expected - collected),
    collectionRate: expected ? Math.round((collected / expected) * 1000) / 10 : 0,
    status,
    byMethod: [...methodTotals.entries()].map(([method, total]) => ({ method, total })),
    byClass: [...byClass.values()]
      .map((bucket) => ({ ...bucket, className: classNames.get(bucket.classId) ?? "Unassigned" }))
      .sort((a, b) => (a.className < b.className ? -1 : 1)),
    truncated: invoices.length >= 5000,
  });
}
