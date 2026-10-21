const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const USERNAME = /^[a-z0-9._-]{3,40}$/;

export function httpError(code, status = 400) {
  const error = new Error(code);
  error.public = true;
  error.status = status;
  return error;
}

export function isUuid(value) {
  return typeof value === "string" && UUID.test(value);
}

export function reqId(value, field = "id") {
  if (!isUuid(value)) throw httpError(`${field}_invalid`);
  return value;
}

export function optId(value, field = "id") {
  if (value === undefined || value === null || value === "") return null;
  return reqId(value, field);
}

export function reqText(value, field, max = 200) {
  if (typeof value !== "string") throw httpError(`${field}_invalid`);
  const trimmed = value.trim();
  if (!trimmed) throw httpError(`${field}_required`);
  if (trimmed.length > max) throw httpError(`${field}_too_long`);
  return trimmed;
}

export function optText(value, field, max = 200) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw httpError(`${field}_invalid`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw httpError(`${field}_too_long`);
  return trimmed === "" ? null : trimmed;
}

export function reqOneOf(value, allowed, field) {
  const text = reqText(value, field, 40);
  if (!allowed.includes(text)) throw httpError(`${field}_invalid`);
  return text;
}

export function optOneOf(value, allowed, field) {
  const text = optText(value, field, 40);
  if (text !== null && !allowed.includes(text)) throw httpError(`${field}_invalid`);
  return text;
}

export function reqInt(value, field, { min = -2147483648, max = 2147483647 } = {}) {
  const num = typeof value === "string" && /^-?\d+$/.test(value.trim()) ? Number(value.trim()) : value;
  if (typeof num !== "number" || !Number.isInteger(num)) throw httpError(`${field}_invalid`);
  if (num < min || num > max) throw httpError(`${field}_out_of_range`);
  return num;
}

export function optInt(value, field, bounds = {}) {
  if (value === undefined || value === null || value === "") return null;
  return reqInt(value, field, bounds);
}

export function reqUsername(value, field = "username") {
  const text = reqText(value, field, 40).toLowerCase();
  if (!USERNAME.test(text)) throw httpError(`${field}_invalid`);
  return text;
}

export function reqPassword(value, field = "password") {
  if (typeof value !== "string") throw httpError(`${field}_invalid`);
  if (value.length < 8) throw httpError(`${field}_too_short`);
  if (value.length > 200) throw httpError(`${field}_too_long`);
  return value;
}

// Calendar dates are stored as text because the migration subset has no date type.
export function reqDay(value, field = "day") {
  const text = reqText(value, field, 10);
  const match = DAY.exec(text);
  if (!match) throw httpError(`${field}_invalid`);
  const [, y, m, d] = match.map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) throw httpError(`${field}_invalid`);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw httpError(`${field}_invalid`);
  }
  if (y < 1990 || y > 2200) throw httpError(`${field}_out_of_range`);
  return text;
}

export function optDay(value, field = "day") {
  if (value === undefined || value === null || value === "") return null;
  return reqDay(value, field);
}

export function reqTerm(value, field = "term") {
  return reqInt(value, field, { min: 1, max: 3 });
}

export function reqYear(value, field = "year") {
  return reqInt(value, field, { min: 1990, max: 2200 });
}

export function reqMoney(value, field = "amount") {
  return reqInt(value, field, { min: 0, max: 100000000 });
}

export function reqMarks(value, field = "marks") {
  return reqInt(value, field, { min: 0, max: 100 });
}

export function reqJsonArray(value, field, maxItems) {
  if (!Array.isArray(value)) throw httpError(`${field}_invalid`);
  if (value.length > maxItems) throw httpError(`${field}_too_many`);
  return value;
}

export function pageBounds(rawOffset, rawLimit, defaultLimit = 50, maxLimit = 200) {
  const offset = Math.max(0, optInt(rawOffset, "offset", { min: 0, max: 1000000 }) ?? 0);
  const limit = Math.max(1, Math.min(maxLimit, optInt(rawLimit, "limit", { min: 1, max: maxLimit }) ?? defaultLimit));
  return { offset, limit };
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function nowIso() {
  return new Date().toISOString();
}
