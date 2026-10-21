import * as academics from "./academics.mjs";
import * as comms from "./comms.mjs";
import * as finance from "./finance.mjs";
import * as overview from "./overview.mjs";
import * as people from "./people.mjs";
import { seedDemo } from "./seed.mjs";
import { hashPassword, randomHex } from "./crypto.mjs";
import {
  createSession,
  currentUser,
  exactCount,
  getSettings,
  json,
  ok,
  publicUser,
  putSetting,
  readBody,
  requireUser,
  requireRole,
  unwrap,
  verifyPassword,
} from "./shared.mjs";
import * as v from "./validate.mjs";

const DEFAULT_SETTINGS = {
  schoolName: "My School",
  motto: null,
  currencyCode: "KES",
  currencySymbol: "KSh",
  currentTerm: 3,
  currentYear: new Date().getFullYear(),
  contactEmail: null,
  contactPhone: null,
  address: null,
  sampleData: true,
};

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS).filter((key) => key !== "sampleData");

function publicSettings(settings) {
  const out = {};
  for (const key of [...SETTING_KEYS, "sampleData", "termDates"]) {
    if (settings[key] !== undefined) out[key] = settings[key];
  }
  return out;
}

async function status(supabase) {
  const users = await exactCount(supabase, "users", null);
  const classes = await exactCount(supabase, "classes", null);
  const settings = users > 0 ? await getSettings(supabase) : {};
  return ok({
    initialised: users > 0,
    seeded: classes > 0,
    schoolName: settings.schoolName ?? null,
    sampleData: settings.sampleData !== false,
  });
}

// Runs only against a database with no accounts at all, so it cannot be used
// to add an administrator to an initialised school.
async function bootstrap(supabase, user, params) {
  const users = await exactCount(supabase, "users", null);
  if (users > 0) throw v.httpError("already_initialised", 409);

  const username = v.reqUsername(params.username);
  const password = v.reqPassword(params.password);
  const fullName = v.optText(params.fullName, "fullName", 120) ?? "System Administrator";
  const schoolName = v.optText(params.schoolName, "schoolName", 120) ?? DEFAULT_SETTINGS.schoolName;

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
        role: "admin",
        full_name: fullName,
        email: null,
        phone: null,
        is_active: true,
        created_at: v.nowIso(),
      })
      .select("id")
      .maybeSingle(),
    "username_taken",
  );

  for (const [key, value] of Object.entries({ ...DEFAULT_SETTINGS, schoolName })) {
    await putSetting(supabase, key, value);
  }
  const token = await createSession(supabase, id);
  return ok({ token, user: publicUser({ id, username, role: "admin", full_name: fullName, email: null, phone: null }) }, 201);
}

async function login(supabase, user, params) {
  const account = await verifyPassword(
    supabase,
    v.reqUsername(params.username),
    v.reqPassword(params.password),
  );
  return ok({ token: await createSession(supabase, account.id), user: publicUser(account) });
}

async function logout(supabase, user) {
  await supabase.from("sessions").delete().eq("id", user.sessionId);
  return ok();
}

async function me(supabase, user) {
  const settings = await getSettings(supabase);
  return ok({
    user: publicUser(user),
    settings: publicSettings(settings),
    unread: await comms.unreadCount(supabase, user),
  });
}

async function readSettings(supabase) {
  return ok({ settings: publicSettings(await getSettings(supabase)) });
}

async function saveSettings(supabase, user, params) {
  requireRole(user, "admin");
  const updates = {};
  for (const key of SETTING_KEYS) {
    if (!(key in params)) continue;
    const raw = params[key];
    if (key === "currentTerm") updates[key] = v.reqTerm(raw);
    else if (key === "currentYear") updates[key] = v.reqYear(raw);
    else if (key === "currencyCode") updates[key] = v.reqText(raw, key, 8).toUpperCase();
    else if (key === "schoolName" || key === "currencySymbol") updates[key] = v.reqText(raw, key, 120);
    else updates[key] = v.optText(raw, key, 240);
  }
  if (!Object.keys(updates).length) throw v.httpError("no_changes");
  for (const [key, value] of Object.entries(updates)) await putSetting(supabase, key, value);
  return ok({ settings: publicSettings(await getSettings(supabase)) });
}

const route = (method, auth, run) => ({ method, auth, run });

const ROUTES = {
  status: route("GET", false, status),
  bootstrap: route("POST", false, bootstrap),
  login: route("POST", false, login),

  me: route("GET", true, me),
  logout: route("POST", true, logout),
  changePassword: route("POST", true, people.changePassword),
  overview: route("GET", true, overview.overview),
  settings: route("GET", true, readSettings),
  saveSettings: route("POST", true, saveSettings),
  seedDemo: route("POST", true, seedDemo),

  listClasses: route("GET", true, people.listClasses),
  saveClass: route("POST", true, people.saveClass),
  listSubjects: route("GET", true, people.listSubjects),
  saveSubject: route("POST", true, people.saveSubject),
  listClassSubjects: route("GET", true, people.listClassSubjects),
  saveClassSubject: route("POST", true, people.saveClassSubject),
  listStudents: route("GET", true, people.listStudents),
  getStudent: route("GET", true, people.getStudent),
  saveStudent: route("POST", true, people.saveStudent),
  listUsers: route("GET", true, people.listUsers),
  saveUser: route("POST", true, people.saveUser),

  attendanceSheet: route("GET", true, academics.attendanceSheet),
  saveAttendance: route("POST", true, academics.saveAttendance),
  attendanceSummary: route("GET", true, academics.attendanceSummary),
  listExams: route("GET", true, academics.listExams),
  saveExam: route("POST", true, academics.saveExam),
  resultsSheet: route("GET", true, academics.resultsSheet),
  saveResults: route("POST", true, academics.saveResults),
  reportCard: route("GET", true, academics.reportCard),
  classReport: route("GET", true, academics.classReport),

  getFeeStructure: route("GET", true, finance.getFeeStructure),
  saveFeeStructure: route("POST", true, finance.saveFeeStructure),
  generateInvoices: route("POST", true, finance.generateInvoices),
  listInvoices: route("GET", true, finance.listInvoices),
  invoiceDetail: route("GET", true, finance.invoiceDetail),
  recordPayment: route("POST", true, finance.recordPayment),
  financeSummary: route("GET", true, finance.financeSummary),

  contacts: route("GET", true, comms.contacts),
  listMessages: route("GET", true, comms.listMessages),
  sendMessage: route("POST", true, comms.sendMessage),
  markRead: route("POST", true, comms.markRead),
  listAnnouncements: route("GET", true, comms.listAnnouncements),
  saveAnnouncement: route("POST", true, comms.saveAnnouncement),
};

export async function handleSchool({ request, supabase }) {
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get("action") ?? "";
    const entry = ROUTES[action];
    if (!entry) return json({ error: "unknown_action" }, 404);
    // Checked before any body is parsed so a GET can never reach a mutation.
    if (request.method !== entry.method) {
      return json({ error: "method_not_allowed", allowed: entry.method }, 405);
    }

    const body = await readBody(request);
    const params = { ...Object.fromEntries(url.searchParams), ...body };
    const user = entry.auth
      ? await requireUser(request, supabase, body)
      : await currentUser(request, supabase, body);
    return await entry.run(supabase, user, params);
  } catch (error) {
    if (error?.public) return json({ error: error.message }, error.status ?? 400);
    return json({ error: "server_error" }, 503);
  }
}
