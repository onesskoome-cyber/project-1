import { get, post } from "../api.js";
import { navigate } from "../router.js";
import { can, ensureClasses } from "../store.js";
import {
  emptyState, field, html, mount, on, openModal, qs, spinner, toast,
} from "../ui.js";

const PAGE = 50;
const view = { classId: "", search: "", activeOnly: true, offset: 0, items: [], total: 0, loading: false };
let debounce = null;

export async function renderStudents(root, params) {
  if (params.classId !== undefined) view.classId = params.classId;
  const classes = await ensureClasses();

  mount(root, html`
    <div class="view-head">
      <div>
        <h2 class="view-title">Students</h2>
        <p class="view-sub">${can("admin") ? "Enrolment, class placement and parent links" : "Students in the classes you teach"}</p>
      </div>
      ${can("admin") ? html`<button class="btn btn-primary" data-add type="button">Add student</button>` : ""}
    </div>

    <section class="card">
      <div class="card-body">
        <div class="filters">
          <label class="filter">
            <span class="field-label">Class</span>
            <select name="classId">
              <option value="">All classes</option>
              ${classes.map((item) => html`
                <option value="${item.id}" ${view.classId === item.id ? "selected" : ""}>${item.name}</option>`)}
            </select>
          </label>
          <label class="filter filter-grow">
            <span class="field-label">Search</span>
            <input name="search" type="search" value="${view.search}" placeholder="Name or admission number" autocomplete="off" />
          </label>
          <label class="filter filter-check">
            <input name="activeOnly" type="checkbox" ${view.activeOnly ? "checked" : ""} />
            <span>Active only</span>
          </label>
        </div>
      </div>
    </section>

    <div id="students-result">${spinner("Loading students")}</div>`);

  wire(root, classes);
  await load(root, classes);
}

function wire(root, classes) {
  const search = qs('[name="search"]', root);
  search.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      view.search = search.value.trim();
      view.offset = 0;
      void load(root, classes);
    }, 350);
  });

  qs('[name="classId"]', root).addEventListener("change", (event) => {
    view.classId = event.target.value;
    view.offset = 0;
    void load(root, classes);
  });

  qs('[name="activeOnly"]', root).addEventListener("change", (event) => {
    view.activeOnly = event.target.checked;
    view.offset = 0;
    void load(root, classes);
  });

  const add = qs("[data-add]", root);
  if (add) add.addEventListener("click", () => openStudent(null, classes, () => load(root, classes)));

  on(root, "click", "[data-page]", (event, node) => {
    view.offset = Number(node.dataset.page);
    void load(root, classes);
  });
  on(root, "click", "[data-edit]", (event, node) =>
    openStudent(view.items.find((item) => item.id === node.dataset.edit), classes, () => load(root, classes)));
  on(root, "click", "[data-report]", (event, node) =>
    navigate("results", { studentId: node.dataset.report }));
  on(root, "click", "[data-parent]", (event, node) =>
    messageParent(node.dataset.parent));
}

async function messageParent(studentId) {
  try {
    const result = await get("getStudent", { studentId });
    const parent = result.item.parent;
    if (!parent) {
      toast("No parent account is linked to this student yet.", "error");
      return;
    }
    navigate("messages", { compose: "1", to: parent.id, studentId });
  } catch (error) {
    toast(error?.message ?? "Could not open that student.", "error");
  }
}

async function load(root, classes) {
  const host = qs("#students-result", root);
  if (!host) return;
  host.innerHTML = spinner("Loading students");
  try {
    const result = await get("listStudents", {
      classId: view.classId,
      search: view.search,
      activeOnly: view.activeOnly,
      offset: view.offset,
      limit: PAGE,
    });
    view.items = result.items;
    view.total = result.total;
  } catch (error) {
    host.innerHTML = emptyState("Could not load students", error?.message ?? "");
    return;
  }
  host.innerHTML = table(classes);
}

function table(classes) {
  if (!view.items.length) {
    return html`<section class="card"><div class="card-body">
      ${emptyState("No students match these filters",
        can("admin") ? "Add a student, or clear the filters." : "Ask an administrator to place students in your classes.")}
    </div></section>`;
  }

  const nameOf = (id) => classes.find((item) => item.id === id)?.name ?? "—";
  const from = view.offset + 1;
  const to = Math.min(view.total, view.offset + PAGE);

  return html`
    <section class="card">
      <div class="card-body">
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Admission</th><th>Name</th><th>Class</th><th>Guardian</th><th>Status</th>
                <th class="ta-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${view.items.map((item) => html`
                <tr class="${item.isActive ? "" : "row-off"}">
                  <td class="mono">${item.admissionNo}</td>
                  <td><strong>${item.firstName} ${item.lastName}</strong>
                    <small class="muted">${item.gender === "female" ? "Female" : "Male"}</small></td>
                  <td>${item.classId ? nameOf(item.classId) : html`<span class="muted">Unplaced</span>`}</td>
                  <td>${item.guardianName ?? html`<span class="muted">—</span>`}
                    ${item.guardianPhone ? html`<small class="muted">${item.guardianPhone}</small>` : ""}</td>
                  <td>${item.isActive
                    ? html`<span class="pill pill-present">Active</span>`
                    : html`<span class="pill pill-muted">Inactive</span>`}</td>
                  <td class="ta-right nowrap">
                    <button class="btn btn-sm btn-ghost" data-report="${item.id}" type="button">Report</button>
                    <button class="btn btn-sm btn-ghost" data-parent="${item.id}" type="button">Parent</button>
                    ${can("admin") ? html`<button class="btn btn-sm btn-secondary" data-edit="${item.id}" type="button">Edit</button>` : ""}
                  </td>
                </tr>`)}
            </tbody>
          </table>
        </div>
        <div class="pager">
          <span class="muted">${from}–${to} of ${view.total}</span>
          <span class="btn-row">
            ${view.offset > 0
              ? html`<button class="btn btn-sm btn-secondary" data-page="${Math.max(0, view.offset - PAGE)}" type="button">Previous</button>` : ""}
            ${to < view.total
              ? html`<button class="btn btn-sm btn-secondary" data-page="${view.offset + PAGE}" type="button">Next</button>` : ""}
          </span>
        </div>
      </div>
    </section>`;
}

async function openStudent(student, classes, onSaved) {
  let parents = [];
  try {
    parents = (await get("listUsers", { role: "parent" })).items ?? [];
  } catch {
    // The parent picker is a convenience; the form still works without it.
  }

  const parentOptions = { "": "Not linked" };
  for (const parent of parents) parentOptions[parent.id] = `${parent.fullName} (@${parent.username})`;
  const classOptions = { "": "Unplaced" };
  for (const item of classes) classOptions[item.id] = item.name;

  openModal({
    title: student ? `Edit ${student.firstName} ${student.lastName}` : "Add student",
    wide: true,
    submitLabel: student ? "Save changes" : "Add student",
    bodyHtml: html`
      <div class="form-grid">
        ${field({ label: "Admission number", name: "admissionNo", required: true, value: student?.admissionNo ?? "" })}
        ${field({ label: "First name", name: "firstName", required: true, value: student?.firstName ?? "" })}
        ${field({ label: "Last name", name: "lastName", required: true, value: student?.lastName ?? "" })}
        ${field({ label: "Gender", name: "gender", type: "select", value: student?.gender ?? "female",
          options: { female: "Female", male: "Male" } })}
        ${field({ label: "Date of birth", name: "birthDate", type: "date", value: student?.birthDate ?? "" })}
        ${field({ label: "Class", name: "classId", type: "select", value: student?.classId ?? view.classId ?? "",
          options: classOptions })}
        ${field({ label: "Parent account", name: "parentUserId", type: "select", value: student?.parentUserId ?? "",
          options: parentOptions, hint: parents.length ? "" : "Create parent accounts under Staff on the Administration page." })}
        ${field({ label: "Guardian name", name: "guardianName", value: student?.guardianName ?? "" })}
        ${field({ label: "Guardian phone", name: "guardianPhone", type: "tel", value: student?.guardianPhone ?? "" })}
        ${field({ label: "Enrolment", name: "isActive", type: "select", value: student ? String(student.isActive) : "true",
          options: { true: "Active", false: "Inactive (left or transferred)" } })}
      </div>`,
    onSubmit: async (values) => {
      const payload = {
        admissionNo: values.admissionNo,
        firstName: values.firstName,
        lastName: values.lastName,
        gender: values.gender,
        birthDate: values.birthDate || null,
        classId: values.classId || null,
        parentUserId: values.parentUserId || null,
        guardianName: values.guardianName || null,
        guardianPhone: values.guardianPhone || null,
        isActive: values.isActive === "true",
      };
      if (student) payload.id = student.id;
      await post("saveStudent", payload);
      toast(student ? "Student updated" : "Student added", "success");
      await onSaved();
      return true;
    },
  });
}
