import { get, post } from "../api.js";
import { ensureClasses } from "../store.js";
import {
  STATUS_LABEL, emptyState, html, isoDay, mount, qs, readForm, shiftDay, spinner, toast,
} from "../ui.js";

const view = { classId: "", day: isoDay(), from: "", to: "", sheet: null, summary: null, dirty: false };

export async function renderAttendance(root, params) {
  const classes = await ensureClasses();
  if (!classes.length) {
    mount(root, emptyState("No classes yet", "Add classes on the Administration page before marking attendance."));
    return;
  }
  view.classId = params.classId && classes.some((item) => item.id === params.classId)
    ? params.classId
    : view.classId || classes[0].id;
  if (params.day) view.day = params.day;
  view.to = view.to || view.day;
  view.from = view.from || shiftDay(view.to, -29);

  mount(root, html`
    <div class="view-head">
      <div>
        <h2 class="view-title">Attendance register</h2>
        <p class="view-sub">Mark the daily register, then review the period below.</p>
      </div>
      <div class="btn-row">
        <button class="btn btn-secondary" data-all-present type="button">Mark all present</button>
        <button class="btn btn-primary" data-save type="button" disabled>Save register</button>
      </div>
    </div>

    <section class="card">
      <div class="card-body">
        <div class="filters">
          <label class="filter">
            <span class="field-label">Class</span>
            <select name="classId">
              ${classes.map((item) => html`
                <option value="${item.id}" ${view.classId === item.id ? "selected" : ""}>${item.name}</option>`)}
            </select>
          </label>
          <label class="filter">
            <span class="field-label">Date</span>
            <input name="day" type="date" value="${view.day}" />
          </label>
          <span class="filter filter-inline">
            <button class="btn btn-sm btn-secondary" data-shift="-1" type="button" aria-label="Previous day">&larr;</button>
            <span class="hint" id="day-label"></span>
            <button class="btn btn-sm btn-secondary" data-shift="1" type="button" aria-label="Next day">&rarr;</button>
          </span>
        </div>
      </div>
    </section>

    <div id="register">${spinner("Loading register")}</div>

    <section class="card">
      <header class="card-head">
        <h2>Period summary</h2>
        <span class="card-meta">Present rate excludes exempt days</span>
      </header>
      <div class="card-body">
        <div class="filters">
          <label class="filter">
            <span class="field-label">From</span>
            <input name="from" type="date" value="${view.from}" />
          </label>
          <label class="filter">
            <span class="field-label">To</span>
            <input name="to" type="date" value="${view.to}" />
          </label>
          <span class="filter filter-inline">
            <button class="btn btn-sm btn-secondary" data-summary type="button">Update</button>
          </span>
        </div>
        <div id="summary">${spinner("Loading summary")}</div>
      </div>
    </section>`);

  wire(root, classes);
  await Promise.all([loadSheet(root), loadSummary(root)]);
}

function wire(root, classes) {
  const save = qs("[data-save]", root);

  qs('[name="classId"]', root).addEventListener("change", (event) => {
    view.classId = event.target.value;
    void loadSheet(root);
    void loadSummary(root);
  });
  qs('[name="day"]', root).addEventListener("change", (event) => {
    if (!event.target.value) return;
    view.day = event.target.value;
    void loadSheet(root);
  });
  root.addEventListener("click", (event) => {
    const shift = event.target.closest("[data-shift]");
    if (!shift) return;
    view.day = shiftDay(view.day, Number(shift.dataset.shift));
    qs('[name="day"]', root).value = view.day;
    void loadSheet(root);
  });

  qs('[name="from"]', root).addEventListener("change", (event) => { view.from = event.target.value; });
  qs('[name="to"]', root).addEventListener("change", (event) => { view.to = event.target.value; });
  qs("[data-summary]", root).addEventListener("click", () => { void loadSummary(root); });

  qs("[data-all-present]", root).addEventListener("click", () => {
    const form = qs("#register-form", root);
    if (!form) return;
    for (const radio of form.querySelectorAll('input[type="radio"][value="present"]')) radio.checked = true;
    markDirty(root, true);
  });

  save.addEventListener("click", async () => {
    const form = qs("#register-form", root);
    if (!form) return;
    const values = readForm(form);
    const entries = [];
    for (const item of view.sheet?.items ?? []) {
      const status = values[`s-${item.studentId}`];
      if (!status) continue;
      const note = values[`n-${item.studentId}`];
      entries.push({ studentId: item.studentId, status, note: note ? String(note).trim() : null });
    }
    if (!entries.length) {
      toast("Mark at least one student before saving.", "error");
      return;
    }
    save.disabled = true;
    save.classList.add("btn-busy");
    try {
      const result = await post("saveAttendance", { classId: view.classId, day: view.day, entries });
      toast(`Register saved for ${result.saved} students`, "success");
      view.dirty = false;
      await loadSheet(root);
      await loadSummary(root);
    } catch (error) {
      toast(error?.message ?? "Could not save the register.", "error");
    } finally {
      save.disabled = false;
      save.classList.remove("btn-busy");
    }
  });
}

function markDirty(root, dirty) {
  view.dirty = dirty;
  const save = qs("[data-save]", root);
  if (save) save.disabled = !dirty;
}

async function loadSheet(root) {
  const host = qs("#register", root);
  if (!host) return;
  host.innerHTML = spinner("Loading register");
  const label = qs("#day-label", root);
  try {
    view.sheet = await get("attendanceSheet", { classId: view.classId, day: view.day });
  } catch (error) {
    host.innerHTML = emptyState("Could not load the register", error?.message ?? "");
    return;
  }
  if (label) label.textContent = view.sheet.day;
  host.innerHTML = register();
  host.addEventListener("change", () => markDirty(root, true));
  const save = qs("[data-save]", root);
  if (save) save.disabled = true;
}

function register() {
  const sheet = view.sheet;
  if (!sheet.items.length) {
    return html`<section class="card"><div class="card-body">
      ${emptyState("This class has no active students", "Add students to the class first.")}
    </div></section>`;
  }

  const marked = sheet.items.filter((item) => item.status).length;
  return html`
    <section class="card">
      <header class="card-head">
        <h2>${sheet.day}</h2>
        <span class="card-meta">${marked} of ${sheet.items.length} marked</span>
      </header>
      <div class="card-body">
        <form id="register-form" class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Admission</th><th>Student</th><th>Status</th><th>Note</th>
              </tr>
            </thead>
            <tbody>
              ${sheet.items.map((item) => html`
                <tr>
                  <td class="mono">${item.admissionNo}</td>
                  <td><strong>${item.firstName} ${item.lastName}</strong></td>
                  <td>
                    <div class="seg">
                      ${sheet.statuses.map((status) => html`
                        <label class="seg-btn seg-${status}">
                          <input type="radio" name="s-${item.studentId}" value="${status}"
                                 ${item.status === status ? "checked" : ""} />
                          <span>${STATUS_LABEL[status] ?? status}</span>
                        </label>`)}
                    </div>
                  </td>
                  <td><input class="note-input" name="n-${item.studentId}" type="text" maxlength="200"
                             value="${item.note ?? ""}" placeholder="Optional" /></td>
                </tr>`)}
            </tbody>
          </table>
        </form>
      </div>
    </section>`;
}

async function loadSummary(root) {
  const host = qs("#summary", root);
  if (!host) return;
  host.innerHTML = spinner("Loading summary");
  try {
    view.summary = await get("attendanceSummary", {
      classId: view.classId, from: view.from, to: view.to,
    });
  } catch (error) {
    host.innerHTML = emptyState("Could not load the summary", error?.message ?? "");
    return;
  }
  host.innerHTML = summaryTable();
}

function summaryTable() {
  const summary = view.summary;
  if (!summary.items?.length) {
    return emptyState("No attendance recorded in this period", "Save a register to see it here.");
  }
  const nameOf = new Map(
    (view.sheet?.items ?? []).map((item) => [item.studentId, `${item.firstName} ${item.lastName}`]),
  );
  const rows = [...summary.items].sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1));

  return html`
    ${summary.truncated ? html`<p class="banner banner-warn">This period holds more rows than one report can show.</p>` : ""}
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr><th>Student</th><th class="ta-right">Days</th><th class="ta-right">Present</th>
            <th class="ta-right">Absent</th><th class="ta-right">Sick</th><th class="ta-right">Rate</th></tr>
        </thead>
        <tbody>
          ${rows.map((row) => html`
            <tr>
              <td>${nameOf.get(row.studentId) ?? "Student"}</td>
              <td class="ta-right">${row.days}</td>
              <td class="ta-right">${row.present}</td>
              <td class="ta-right ${row.absent > 0 ? "bad" : ""}">${row.absent}</td>
              <td class="ta-right">${row.sick}</td>
              <td class="ta-right"><strong>${row.rate === null ? "—" : `${row.rate}%`}</strong></td>
            </tr>`)}
        </tbody>
      </table>
    </div>`;
}
