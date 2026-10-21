import { get, post, saveToken } from "./api.js";

export const state = {
  user: null,
  settings: {},
  unread: 0,
  classes: [],
  subjects: [],
  route: "dashboard",
  params: {},
  listeners: new Set(),
};

export function subscribe(listener) {
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

function emit() {
  for (const listener of state.listeners) listener(state);
}

export function setSession({ token, user, settings, unread }) {
  if (token !== undefined) saveToken(token);
  if (user !== undefined) state.user = user;
  if (settings !== undefined) state.settings = settings ?? {};
  if (unread !== undefined) state.unread = unread ?? 0;
  emit();
}

export function clearSession() {
  saveToken(null);
  state.user = null;
  state.settings = {};
  state.unread = 0;
  state.classes = [];
  state.subjects = [];
  emit();
}

export function setUnread(count) {
  state.unread = Number(count) || 0;
  emit();
}

export function can(...roles) {
  return Boolean(state.user) && roles.includes(state.user.role);
}

export function currency() {
  return state.settings.currencySymbol ?? "KSh";
}

export function currentTerm() {
  return Number(state.settings.currentTerm) || 3;
}

export function currentYear() {
  return Number(state.settings.currentYear) || new Date().getFullYear();
}

export function schoolName() {
  return state.settings.schoolName ?? "School";
}

export function isSampleData() {
  return state.settings.sampleData !== false;
}

export const TERMS = { 1: "Term 1", 2: "Term 2", 3: "Term 3" };

export function termOptions(year) {
  const years = {};
  for (let offset = 0; offset < 4; offset += 1) {
    const value = (year ?? currentYear()) - offset;
    years[value] = String(value);
  }
  return { years, terms: TERMS };
}

/** Classes are read on almost every screen, so they are fetched once. */
export async function ensureClasses(force = false) {
  if (!force && state.classes.length) return state.classes;
  const result = await get("listClasses");
  state.classes = result.items ?? [];
  return state.classes;
}

export async function ensureSubjects(force = false) {
  if (!force && state.subjects.length) return state.subjects;
  const result = await get("listSubjects", { filter: "active" });
  state.subjects = result.items ?? [];
  return state.subjects;
}

export function className(classId) {
  return state.classes.find((item) => item.id === classId)?.name ?? "—";
}

export async function refreshMe() {
  const result = await get("me");
  state.user = result.user;
  state.settings = result.settings ?? {};
  state.unread = result.unread ?? 0;
  emit();
  return result;
}

export async function logout() {
  try {
    await post("logout", {});
  } catch {
    // A failed logout call must still end the local session.
  }
  clearSession();
}
