const ENDPOINT = "/functions/v1/app";
const TOKEN_KEY = "sms.session";

const MESSAGES = {
  login_required: "Your session has expired. Please sign in again.",
  invalid_credentials: "That username and password combination is not correct.",
  forbidden: "You do not have permission to do that.",
  recipient_not_permitted: "You are not able to message that person.",
  cannot_message_self: "You cannot send a message to yourself.",
  unknown_action: "That request is not supported by this version of the app.",
  method_not_allowed: "That request is not allowed.",
  payload_too_large: "That request is too large.",
  body_invalid: "The request could not be read. Please try again.",
  database_error: "The school database did not respond. Please try again.",
  database_runtime_unavailable: "The school database is not reachable right now.",
  count_unavailable: "Could not read the record count. Please try again.",
  server_error: "Something went wrong on the server. Please try again.",
  service_unavailable: "The service is temporarily unavailable.",
  not_initialised: "This school has not been set up yet.",
  already_initialised: "This school is already set up.",
  already_seeded: "Demo data has already been loaded.",
  username_taken: "That username is already in use.",
  username_invalid: "Usernames must be 3-40 characters: letters, numbers, dot, underscore or hyphen.",
  password_too_short: "Passwords must be at least 8 characters.",
  password_unchanged: "The new password must differ from the current one.",
  admission_no_taken: "That admission number is already in use.",
  class_name_taken: "A class with that name already exists.",
  subject_code_taken: "That subject code is already in use.",
  class_not_found: "That class no longer exists.",
  student_not_found: "That student no longer exists.",
  student_not_in_class: "One of the students does not belong to that class.",
  duplicate_student_entry: "The same student appears twice in that submission.",
  subject_not_found: "That subject no longer exists.",
  exam_not_found: "That exam no longer exists.",
  exam_student_mismatch: "That student is not in the class this exam belongs to.",
  invoice_not_found: "That invoice no longer exists.",
  invoice_already_settled: "That invoice is already fully paid.",
  amount_exceeds_balance: "That payment is more than the outstanding balance.",
  fee_structure_not_found: "Set the fee structure for that class and term first.",
  class_has_no_students: "That class has no active students to bill.",
  entries_required: "Add at least one entry before saving.",
  no_marks_supplied: "Enter at least one mark before saving.",
  range_invalid: "The start date must not be after the end date.",
  message_not_found: "That message no longer exists.",
  user_not_found: "That user no longer exists.",
  cannot_demote_self: "You cannot remove your own administrator access.",
  no_changes: "Nothing was changed.",
  teacherId_invalid: "Choose a teacher who is still active.",
  parentUserId_invalid: "Choose a parent account that is still active.",
  classId_required: "Choose the class this announcement is for.",
  recipient_not_found: "That person no longer has an account.",
  entries_invalid: "One of the rows could not be read. Please try again.",
  items_required: "Add at least one fee line item.",
  items_invalid: "One of the fee line items could not be read.",
  total_out_of_range: "That fee total is too large.",
};

// Field-level validation errors arrive as `<field>_<suffix>`, so they are turned
// into a sentence here instead of maintaining an entry for every field.
const LABELS = {
  classId: "class", studentId: "student", subjectId: "subject", examId: "exam",
  invoiceId: "invoice", messageId: "message", userId: "user", teacherId: "teacher",
  parentUserId: "parent account", admissionNo: "admission number", firstName: "first name",
  lastName: "last name", fullName: "full name", guardianName: "guardian name",
  guardianPhone: "guardian phone", schoolName: "school name", newPassword: "new password",
  currentPassword: "current password", birthDate: "date of birth", examDate: "exam date",
  username: "username", password: "password", amount: "amount", marks: "marks",
  items: "fee items", entries: "entries", day: "date", from: "start date", to: "end date",
  method: "payment method", audience: "audience", gender: "gender", level: "level",
};

const SUFFIXES = {
  required: (label) => `The ${label} is required.`,
  invalid: (label) => `The ${label} is not valid.`,
  too_long: (label) => `The ${label} is too long.`,
  too_many: (label) => `Too many ${label}.`,
  too_short: (label) => `The ${label} is too short.`,
  out_of_range: (label) => `The ${label} is out of range.`,
  not_found: (label) => `That ${label} no longer exists.`,
  taken: (label) => `That ${label} is already in use.`,
};

function labelFor(field) {
  if (LABELS[field]) return LABELS[field];
  return field.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}

function sentence(code) {
  const match = /^(.+?)_(required|invalid|too_long|too_many|too_short|out_of_range|not_found|taken)$/.exec(code);
  if (!match) return null;
  return SUFFIXES[match[2]](labelFor(match[1]));
}

export function messageFor(code, fallback = "Something went wrong. Please try again.") {
  return MESSAGES[code] ?? sentence(code) ?? fallback;
}

export class ApiError extends Error {
  constructor(code, status) {
    super(messageFor(code));
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

let token = null;
try {
  token = sessionStorage.getItem(TOKEN_KEY);
} catch {
  token = null;
}

let onUnauthorized = null;
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

export function getToken() {
  return token;
}

export function saveToken(value) {
  token = value;
  try {
    if (value) sessionStorage.setItem(TOKEN_KEY, value);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage can be unavailable in private mode; the in-memory token still works.
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function api(action, params = {}, method = "GET") {
  const url = new URL(ENDPOINT, window.location.origin);
  url.searchParams.set("action", action);

  const init = { method, credentials: "same-origin", headers: {} };
  if (token) init.headers["x-session-token"] = token;

  if (method === "GET") {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  } else {
    init.headers["content-type"] = "application/json";
    // The token is repeated in the body so a mutation still authenticates if an
    // intermediary strips the custom header.
    init.body = JSON.stringify(token ? { ...params, sessionToken: token } : params);
  }

  let response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new ApiError("service_unavailable", 0);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    // An HTML body means a gateway or access page answered, not the application.
    throw new ApiError(response.status === 401 || response.status === 403 ? "login_required" : "service_unavailable", response.status);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError("body_invalid", response.status);
  }
  if (!isPlainObject(payload)) throw new ApiError("body_invalid", response.status);

  if (!response.ok || payload.ok !== true) {
    const code = typeof payload.error === "string" ? payload.error : "server_error";
    if (response.status === 401 || code === "login_required") {
      saveToken(null);
      if (onUnauthorized) onUnauthorized();
    }
    throw new ApiError(code, response.status);
  }
  return payload;
}

export const get = (action, params) => api(action, params, "GET");
export const post = (action, params) => api(action, params, "POST");
