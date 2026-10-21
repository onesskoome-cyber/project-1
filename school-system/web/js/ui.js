const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

// A String subclass, so trusted markup can be interpolated into another html``
// template without being escaped and still be assignable to innerHTML.
class Markup extends String {}

/** Marks a string as already-escaped HTML. Only for fragments this module builds. */
export function safe(value) {
  return new Markup(String(value ?? ""));
}

function render(value) {
  if (value === null || value === undefined || value === false || value === true) return "";
  if (Array.isArray(value)) return value.map(render).join("");
  if (value instanceof Markup) return value.valueOf();
  return esc(value);
}

/**
 * Tagged template that escapes every interpolated value. Use this for all
 * markup built from server data so names and message bodies stay inert.
 */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) {
    out += render(values[i]) + strings[i + 1];
  }
  return new Markup(out);
}

export function mount(target, markup) {
  target.innerHTML = markup;
  return target;
}

export function qs(selector, root = document) {
  return root.querySelector(selector);
}

export function qsa(selector, root = document) {
  return [...root.querySelectorAll(selector)];
}

export function on(root, event, selector, handler) {
  root.addEventListener(event, (e) => {
    const match = e.target.closest(selector);
    if (match && root.contains(match)) handler(e, match);
  });
}

export const GRADE_TONE = { A: "a", B: "b", C: "c", D: "d", E: "e" };

export function gradePill(grade) {
  if (!grade) return html`<span class="pill pill-muted">&mdash;</span>`;
  return html`<span class="pill pill-${GRADE_TONE[grade] ?? "muted"}">${grade}</span>`;
}

export function money(amount, symbol = "KSh") {
  const value = Number(amount ?? 0);
  return `${symbol} ${value.toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;
}

export function compactMoney(amount, symbol = "KSh") {
  const value = Number(amount ?? 0);
  if (Math.abs(value) >= 1000000) return `${symbol} ${(value / 1000000).toFixed(1)}M`;
  if (Math.abs(value) >= 1000) return `${symbol} ${(value / 1000).toFixed(0)}k`;
  return `${symbol} ${value}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function dayText(day) {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return day ?? "";
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return `${DAYS[date.getUTCDay()].slice(0, 3)} ${d} ${MONTHS[m - 1]} ${y}`;
}

export function isoDay(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function shiftDay(day, delta) {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + delta));
  return date.toISOString().slice(0, 10);
}

export function timeAgo(iso) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
  return new Date(then).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function termLabel(term, year) {
  return term && year ? `Term ${term}, ${year}` : year ? `${year}` : "";
}

export const STATUS_LABEL = {
  present: "Present",
  absent: "Absent",
  sick: "Sick",
  exempt: "Exempt",
  paid: "Paid",
  partial: "Part paid",
  unpaid: "Unpaid",
};

export function statusPill(status) {
  return html`<span class="pill pill-${status}">${STATUS_LABEL[status] ?? status}</span>`;
}

let toastHost = null;

export function toast(message, type = "info", timeout = 4200) {
  if (!toastHost) {
    toastHost = document.createElement("div");
    toastHost.className = "toast-host";
    toastHost.setAttribute("role", "status");
    toastHost.setAttribute("aria-live", "polite");
    document.body.appendChild(toastHost);
  }
  const node = document.createElement("div");
  node.className = `toast toast-${type}`;
  node.textContent = message;
  toastHost.appendChild(node);
  requestAnimationFrame(() => node.classList.add("toast-in"));
  setTimeout(() => {
    node.classList.remove("toast-in");
    setTimeout(() => node.remove(), 220);
  }, timeout);
}

export function spinner(label = "Loading") {
  return html`<div class="loading"><span class="spinner" aria-hidden="true"></span><span>${label}&hellip;</span></div>`;
}

export function emptyState(title, hint = "", actionHtml = "") {
  return html`
    <div class="empty">
      <p class="empty-title">${title}</p>
      ${hint ? html`<p class="empty-hint">${hint}</p>` : ""}
      ${actionHtml ? safe(actionHtml) : ""}
    </div>`;
}

export function errorState(message, retryLabel = "Try again") {
  return html`
    <div class="empty empty-error">
      <p class="empty-title">${message}</p>
      <button class="btn btn-secondary" data-retry type="button">${retryLabel}</button>
    </div>`;
}

let modalRoot = null;
let modalCloseHandler = null;

/**
 * Opens a dialog built from `bodyHtml`. `onSubmit` receives the form values as a
 * plain object and may return a promise; returning false keeps the dialog open.
 * `onClose` runs once however the dialog is dismissed, including Escape.
 */
export function openModal({ title, bodyHtml, submitLabel = "Save", onSubmit, onClose, wide = false, danger = false }) {
  closeModal();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = html`
    <div class="modal${wide ? " modal-wide" : ""}" role="dialog" aria-modal="true" aria-label="${title}">
      <header class="modal-head">
        <h2>${title}</h2>
        <button class="icon-btn" type="button" data-close aria-label="Close">&times;</button>
      </header>
      <form class="modal-body" novalidate>${safe(bodyHtml)}</form>
      <footer class="modal-foot">
        <button class="btn btn-ghost" type="button" data-close>Cancel</button>
        <button class="btn ${danger ? "btn-danger" : "btn-primary"}" type="submit" form="modal-form">${submitLabel}</button>
      </footer>
    </div>`;

  const form = overlay.querySelector("form");
  form.id = "modal-form";
  document.body.appendChild(overlay);
  modalRoot = overlay;
  modalCloseHandler = typeof onClose === "function" ? onClose : null;
  document.body.classList.add("modal-open");

  const firstField = form.querySelector("input,select,textarea,button");
  if (firstField) firstField.focus();

  const close = () => closeModal();
  overlay.querySelectorAll("[data-close]").forEach((node) => node.addEventListener("click", close));
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });
  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitButton = overlay.querySelector('[type="submit"]');
    const values = readForm(form);
    if (!onSubmit) return close();
    submitButton.disabled = true;
    submitButton.classList.add("btn-busy");
    try {
      const result = await onSubmit(values, form);
      if (result !== false) close();
    } catch (error) {
      showFormError(overlay, error?.message ?? "Something went wrong. Please try again.");
    } finally {
      submitButton.disabled = false;
      submitButton.classList.remove("btn-busy");
    }
    return undefined;
  });
  return overlay;
}

export function closeModal() {
  if (!modalRoot) return;
  const handler = modalCloseHandler;
  modalRoot.remove();
  modalRoot = null;
  modalCloseHandler = null;
  document.body.classList.remove("modal-open");
  if (handler) handler();
}

function showFormError(overlay, message) {
  const body = overlay.querySelector(".modal-body");
  let box = body.querySelector(".form-error");
  if (!box) {
    box = document.createElement("div");
    box.className = "form-error";
    box.setAttribute("role", "alert");
    body.prepend(box);
  }
  box.textContent = message;
}

export function readForm(form) {
  const values = {};
  for (const [key, value] of new FormData(form).entries()) {
    if (key in values) {
      values[key] = [].concat(values[key], value);
    } else {
      values[key] = value;
    }
  }
  return values;
}

export function confirmDialog({ title, message, confirmLabel = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    openModal({
      title,
      bodyHtml: html`<p class="confirm-text">${message}</p>`,
      submitLabel: confirmLabel,
      danger,
      onClose: () => finish(false),
      onSubmit: () => {
        finish(true);
        closeModal();
        return false;
      },
    });
  });
}

export function field({ label, name, type = "text", value = "", required = false, options = {}, hint = "", disabled = false, min, max, step, rows }) {
  const id = `f-${name}`;
  const req = required ? "required" : "";
  let control;
  if (type === "select") {
    control = html`
      <select id="${id}" name="${name}" ${safe(req)} ${disabled ? safe("disabled") : ""}>
        ${Object.entries(options).map(([key, text]) =>
          html`<option value="${key}" ${String(value) === String(key) ? safe("selected") : ""}>${text}</option>`)}
      </select>`;
  } else if (type === "textarea") {
    control = html`<textarea id="${id}" name="${name}" rows="${rows ?? 4}" ${safe(req)} ${disabled ? safe("disabled") : ""}>${value}</textarea>`;
  } else {
    control = html`<input id="${id}" name="${name}" type="${type}" value="${value}" ${safe(req)}
      ${min !== undefined ? html`min="${min}"` : ""} ${max !== undefined ? html`max="${max}"` : ""}
      ${step !== undefined ? html`step="${step}"` : ""} ${disabled ? safe("disabled") : ""} />`;
  }
  return html`
    <label class="field" for="${id}">
      <span class="field-label">${label}${required ? safe(' <em class="req">*</em>') : ""}</span>
      ${safe(control)}
      ${hint ? html`<span class="field-hint">${hint}</span>` : ""}
    </label>`;
}
