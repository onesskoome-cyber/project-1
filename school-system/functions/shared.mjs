import { hashPassword, randomHex, safeEqual, sha256Hex } from "./crypto.mjs";
import { httpError } from "./validate.mjs";

export const ROLES = ["admin", "teacher", "parent", "accountant"];
export const SESSION_DAYS = 14;
export const MAX_BODY_BYTES = 256 * 1024;

export function json(payload, status = 200) {
  return Response.json(payload, { status, headers: { "cache-control": "no-store" } });
}

export function ok(payload = {}, status = 200) {
  return json({ ok: true, ...payload }, status);
}

// Provider detail never reaches the browser; callers see a stable code only.
export function unwrap(result, code = "database_error") {
  if (result.error) throw httpError(code, 503);
  return result.data;
}

export async function exactCount(supabase, table, applyFilters) {
  let query = supabase.from(table).select("id", { count: "exact" });
  if (applyFilters) query = applyFilters(query) ?? query;
  const result = await query.limit(1);
  if (result.error) throw httpError("database_error", 503);
  if (!Number.isSafeInteger(result.count) || result.count < 0) {
    throw httpError("count_unavailable", 503);
  }
  return result.count;
}

export function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    fullName: user.full_name,
    email: user.email ?? null,
    phone: user.phone ?? null,
  };
}

export async function readBody(request) {
  if (request.method === "GET") return {};
  if (request.method !== "POST") throw httpError("method_not_allowed", 405);
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw httpError("payload_too_large", 413);
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw httpError("payload_too_large", 413);
  if (!text) return {};
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw httpError("body_invalid");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw httpError("body_invalid");
  }
  return parsed;
}

// The deployment adapter deletes authorization and cookie headers before the
// handler runs, so the session token travels in a custom header, with a body
// field as the fallback for mutations.
function extractToken(request, body) {
  for (const candidate of [request.headers.get("x-session-token"), body?.sessionToken]) {
    if (typeof candidate === "string" && candidate.length >= 32 && candidate.length <= 128) {
      return candidate;
    }
  }
  return null;
}

export async function currentUser(request, supabase, body) {
  const token = extractToken(request, body);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const sessions = unwrap(
    await supabase.from("sessions").select("id,user_id,expires_at").eq("token_hash", tokenHash).limit(1),
  );
  const session = sessions?.[0];
  if (!session) return null;
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    await supabase.from("sessions").delete().eq("id", session.id);
    return null;
  }
  const users = unwrap(
    await supabase
      .from("users")
      .select("id,username,role,full_name,email,phone,is_active")
      .eq("id", session.user_id)
      .limit(1),
  );
  const user = users?.[0];
  if (!user || !user.is_active) return null;
  return { ...user, sessionId: session.id };
}

export async function requireUser(request, supabase, body) {
  const user = await currentUser(request, supabase, body);
  if (!user) throw httpError("login_required", 401);
  return user;
}

export function requireRole(user, ...roles) {
  if (!roles.includes(user.role)) throw httpError("forbidden", 403);
}

export async function createSession(supabase, userId) {
  const token = randomHex(32);
  const now = Date.now();
  // Expired rows are pruned opportunistically; failure here must not block login.
  await supabase.from("sessions").delete().lt("expires_at", new Date(now).toISOString());
  unwrap(
    await supabase
      .from("sessions")
      .insert({
        id: crypto.randomUUID(),
        token_hash: await sha256Hex(token),
        user_id: userId,
        created_at: new Date(now).toISOString(),
        expires_at: new Date(now + SESSION_DAYS * 86400000).toISOString(),
      })
      .select("id")
      .maybeSingle(),
  );
  return token;
}

export async function verifyPassword(supabase, username, password) {
  const rows = unwrap(
    await supabase
      .from("users")
      .select("id,username,password_hash,salt,role,full_name,email,phone,is_active")
      .eq("username", username)
      .limit(1),
  );
  const user = rows?.[0] ?? null;
  // Hash even when the account is absent so timing does not reveal existence.
  const candidate = await hashPassword(password, user ? user.salt : "unknown-account-salt");
  if (!user || !user.is_active || !safeEqual(candidate, user.password_hash)) {
    throw httpError("invalid_credentials", 401);
  }
  return user;
}

/**
 * Rows a role may act on. `all: true` means unrestricted; otherwise `by`
 * says which column narrows every query. Parents are limited to their own
 * children, teachers to classes they teach.
 */
export async function studentScope(supabase, user) {
  if (user.role === "admin" || user.role === "accountant") return { all: true };
  if (user.role === "parent") {
    const rows = unwrap(
      await supabase.from("students").select("id").eq("parent_user_id", user.id),
    );
    const studentIds = (rows ?? []).map((row) => row.id);
    return { all: false, by: "student", studentIds, classIds: [] };
  }
  const classRows = unwrap(await supabase.from("classes").select("id").eq("teacher_id", user.id));
  const subjectRows = unwrap(
    await supabase.from("class_subjects").select("class_id").eq("teacher_id", user.id),
  );
  const classIds = new Set((classRows ?? []).map((row) => row.id));
  for (const row of subjectRows ?? []) classIds.add(row.class_id);
  return { all: false, by: "class", classIds: [...classIds], studentIds: [] };
}

export function scopeIsEmpty(scope) {
  if (scope.all) return false;
  return scope.by === "class" ? scope.classIds.length === 0 : scope.studentIds.length === 0;
}

/**
 * Narrows a query to the rows a role may act on. `column` names the column
 * holding the student id: `id` on the students table, `student_id` on
 * attendance and invoices. Class scope always filters `class_id`, which those
 * tables all carry. Callers must short-circuit on scopeIsEmpty.
 */
export function applyStudentScope(query, scope, column = "id") {
  if (scope.all) return query;
  return scope.by === "class"
    ? query.in("class_id", scope.classIds)
    : query.in(column, scope.studentIds);
}

export async function assertStudentVisible(supabase, scope, studentId) {
  if (scope.all) return;
  if (scope.by === "student") {
    if (!scope.studentIds.includes(studentId)) throw httpError("forbidden", 403);
    return;
  }
  if (!scope.classIds.length) throw httpError("forbidden", 403);
  const rows = unwrap(
    await supabase.from("students").select("id,class_id").eq("id", studentId).limit(1),
  );
  const student = rows?.[0];
  if (!student || !scope.classIds.includes(student.class_id)) throw httpError("forbidden", 403);
}

export function assertClassVisible(scope, classId) {
  if (scope.all) return;
  if (scope.by === "class") {
    if (!scope.classIds.includes(classId)) throw httpError("forbidden", 403);
    return;
  }
  throw httpError("forbidden", 403);
}

export async function getSettings(supabase) {
  const rows = unwrap(await supabase.from("settings").select("setting_key,value").limit(100));
  const settings = {};
  for (const row of rows ?? []) {
    try {
      settings[row.setting_key] = JSON.parse(row.value);
    } catch {
      settings[row.setting_key] = row.value;
    }
  }
  return settings;
}

export async function putSetting(supabase, key, value) {
  // The migration subset has no column defaults, so every id is supplied here.
  // On conflict the surrogate id is simply replaced, which nothing references.
  const payload = {
    id: crypto.randomUUID(),
    setting_key: key,
    value: JSON.stringify(value),
    updated_at: new Date().toISOString(),
  };
  const result = await supabase.from("settings").upsert(payload, { onConflict: "setting_key" });
  if (result.error) throw httpError("database_error", 503);
}
