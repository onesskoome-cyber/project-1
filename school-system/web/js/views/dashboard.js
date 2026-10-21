import { get, post } from "../api.js";
import {
  compactMoney, emptyState, gradePill, html, mount, money, on, qs, spinner, termLabel, timeAgo, toast,
} from "../ui.js";
import { navigate } from "../router.js";
import { currency, state } from "../store.js";

function kpi(label, value, sub = "", tone = "") {
  return html`
    <div class="kpi ${tone}">
      <span class="kpi-label">${label}</span>
      <span class="kpi-value">${value}</span>
      ${sub ? html`<span class="kpi-sub">${sub}</span>` : ""}
    </div>`;
}

function progress(percent) {
  const width = Math.max(0, Math.min(100, Number(percent) || 0));
  return html`
    <div class="progress" role="img" aria-label="${width}% collected">
      <span style="width:${width}%"></span>
    </div>`;
}

function financeCard(finance, title = "Fees this term") {
  return html`
    <section class="card">
      <header class="card-head">
        <h2>${title}</h2>
        <span class="card-meta">${finance.collectionRate}% collected</span>
      </header>
      <div class="card-body">
        <div class="finance-figures">
          <div><span>Expected</span><strong>${money(finance.expected, currency())}</strong></div>
          <div><span>Collected</span><strong class="good">${money(finance.collected, currency())}</strong></div>
          <div><span>Outstanding</span><strong class="bad">${money(finance.outstanding, currency())}</strong></div>
        </div>
        ${progress(finance.collectionRate)}
      </div>
    </section>`;
}

function noticesCard(items) {
  if (!items.length) return "";
  return html`
    <section class="card">
      <header class="card-head"><h2>Latest notices</h2></header>
      <div class="card-body list">
        ${items.slice(0, 4).map((item) => html`
          <article class="list-row">
            <div class="list-main">
              <strong>${item.title}</strong>
              <p>${item.body}</p>
              <small>${item.author} · ${timeAgo(item.createdAt)}${item.className ? ` · ${item.className}` : ""}</small>
            </div>
          </article>`)}
      </div>
    </section>`;
}

function seedPanel() {
  return html`
    <section class="card card-accent">
      <header class="card-head">
        <h2>Set up your school</h2>
      </header>
      <div class="card-body">
        <p>This database is empty. Load a complete sample school — 8 classes, 40 students,
        staff, parents, an examination with results, ten days of attendance and a full term of
        fee invoices — or start from nothing and add your own records.</p>
        <p class="gate-warn">The sample school contains fictional people only.</p>
        <div class="btn-row">
          <button class="btn btn-primary" data-seed type="button">Load sample school</button>
          <button class="btn btn-secondary" data-classes type="button">Add classes yourself</button>
        </div>
      </div>
    </section>`;
}

export async function renderDashboard(root) {
  mount(root, spinner("Loading your dashboard"));
  const [data, notices] = await Promise.all([
    get("overview"),
    get("listAnnouncements").then((result) => result.items ?? []).catch(() => []),
  ]);

  const head = html`
    <div class="view-head">
      <div>
        <h2 class="view-title">${greeting()}, ${state.user.fullName.split(" ")[0]}</h2>
        <p class="view-sub">${termLabel(data.term, data.year)} · ${data.schoolName}</p>
      </div>
    </div>`;

  let body;
  if (data.role === "admin") body = adminBody(data);
  else if (data.role === "teacher") body = teacherBody(data);
  else if (data.role === "parent") body = parentBody(data);
  else body = accountantBody(data);

  mount(root, html`${head}${body}${noticesCard(notices)}`);
  wire(root, data);
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function adminBody(data) {
  if (!data.counts.classes) {
    return html`${seedPanel()}
      <div class="grid-kpi">
        ${kpi("Students", data.counts.students)}
        ${kpi("Staff", data.counts.staff)}
        ${kpi("Parents", data.counts.parents)}
        ${kpi("Classes", data.counts.classes)}
      </div>`;
  }
  const attendance = data.attendanceToday;
  return html`
    <div class="grid-kpi">
      ${kpi("Students", data.counts.students, "active enrolment")}
      ${kpi("Classes", data.counts.classes, `${data.counts.staff} staff`)}
      ${kpi("Attendance today", attendance.rate === null ? "Not marked" : `${attendance.rate}%`,
        attendance.rate === null ? "" : `${attendance.present} present · ${attendance.absent} absent · ${attendance.sick} sick`,
        attendance.rate === null ? "warn" : "")}
      ${kpi("Messages", data.unread, "unread")}
    </div>
    <div class="grid-2">
      ${financeCard(data.finance)}
      <section class="card">
        <header class="card-head"><h2>Quick actions</h2></header>
        <div class="card-body">
          <div class="action-grid">
            <button class="action" data-go="attendance" type="button">Mark attendance</button>
            <button class="action" data-go="results" type="button">Enter results</button>
            <button class="action" data-go="fees" type="button">Fees &amp; invoices</button>
            <button class="action" data-go="messages" type="button">Message parents</button>
            <button class="action" data-go="students" type="button">Students</button>
            <button class="action" data-go="admin" type="button">Administration</button>
          </div>
        </div>
      </section>
    </div>`;
}

function teacherBody(data) {
  const attendance = data.attendanceToday;
  const marked = attendance.markedToday ?? 0;
  return html`
    <div class="grid-kpi">
      ${kpi("My classes", data.classes.length, data.classes.map((item) => item.name).join(", ") || "None assigned")}
      ${kpi("My students", data.studentCount)}
      ${kpi("Marked today", marked, attendance.rate === null ? "not started" : `${attendance.rate}% present`,
        marked ? "" : "warn")}
      ${kpi("Messages", data.unread, "unread")}
    </div>
    <div class="grid-2">
      <section class="card">
        <header class="card-head">
          <h2>Attendance today</h2>
          <span class="card-meta">${data.today}</span>
        </header>
        <div class="card-body">
          ${data.classes.length
            ? html`
              <div class="chip-row">
                ${data.classes.map((item) => html`
                  <button class="chip" data-attend="${item.id}" type="button">${item.name}</button>`)}
              </div>
              <p class="hint">Choose a class to mark the register.</p>`
            : emptyState("No classes assigned", "An administrator assigns classes on the Administration page.")}
        </div>
      </section>
      <section class="card">
        <header class="card-head"><h2>Exams to mark</h2></header>
        <div class="card-body list">
          ${data.pendingExams.length
            ? data.pendingExams.map((exam) => html`
              <div class="list-row">
                <div class="list-main">
                  <strong>${exam.name}</strong>
                  <small>${exam.resultsEntered} result rows entered</small>
                </div>
                <button class="btn btn-sm btn-secondary" data-exam="${exam.id}" type="button">Open</button>
              </div>`)
            : emptyState("Nothing to mark", "Exams you create will appear here.")}
        </div>
      </section>
    </div>`;
}

function parentBody(data) {
  if (!data.children.length) {
    return emptyState("No children linked to your account",
      "The school office links your account to your children's records.");
  }
  return html`
    ${data.feeBalance > 0 ? html`
      <div class="banner banner-warn">
        <strong>Fee balance ${money(data.feeBalance, currency())}</strong>
        <button class="btn btn-sm btn-secondary" data-go="fees" type="button">View invoices</button>
      </div>` : ""}
    <div class="grid-cards">
      ${data.children.map((child) => html`
        <article class="card child-card">
          <header class="card-head">
            <h2>${child.firstName} ${child.lastName}</h2>
            <span class="card-meta">${child.className ?? "No class"}</span>
          </header>
          <div class="card-body">
            <dl class="stat-list">
              <div><dt>Admission</dt><dd>${child.admissionNo}</dd></div>
              <div><dt>Attendance</dt><dd>${child.attendance.rate === null ? "—" : `${child.attendance.rate}%`}</dd></div>
              <div><dt>Absences</dt><dd>${child.attendance.absent}</dd></div>
              <div><dt>${child.latestExam ? child.latestExam.name : "Latest result"}</dt>
                <dd>${child.summary ? gradePill(child.summary.meanGrade) : html`<span class="muted">Not published</span>`}</dd></div>
              <div><dt>Mean marks</dt><dd>${child.summary ? child.summary.meanMarks : "—"}</dd></div>
              <div><dt>Fee balance</dt>
                <dd class="${child.feeBalance > 0 ? "bad" : "good"}">${money(child.feeBalance, currency())}</dd></div>
            </dl>
            <div class="btn-row">
              <button class="btn btn-sm btn-secondary" data-report="${child.id}" type="button">Report card</button>
              <button class="btn btn-sm btn-ghost" data-msg="${child.id}" type="button">Message teacher</button>
            </div>
          </div>
        </article>`)}
    </div>`;
}

function accountantBody(data) {
  const finance = data.finance;
  return html`
    <div class="grid-kpi">
      ${kpi("Expected", compactMoney(finance.expected, currency()), `${finance.invoiceCount} invoices`)}
      ${kpi("Collected", compactMoney(finance.collected, currency()), `${finance.collectionRate}% of billed`, "good")}
      ${kpi("Outstanding", compactMoney(finance.outstanding, currency()),
        `${finance.status.partial} part paid · ${finance.status.unpaid} unpaid`, "warn")}
      ${kpi("Messages", data.unread, "unread")}
    </div>
    <div class="grid-2">
      ${financeCard(finance)}
      <section class="card">
        <header class="card-head">
          <h2>Largest balances</h2>
          <button class="btn btn-sm btn-ghost" data-go="fees" type="button">All invoices</button>
        </header>
        <div class="card-body list">
          ${data.topBalances.length
            ? data.topBalances.map((row) => html`
              <div class="list-row">
                <div class="list-main">
                  <strong>${row.name ?? "Student"}</strong>
                  <small>${row.className ?? ""}</small>
                </div>
                <span class="amount bad">${money(row.balance, currency())}</span>
              </div>`)
            : emptyState("Nothing outstanding", "Every invoice for this term is settled.")}
        </div>
      </section>
    </div>`;
}

function wire(root, data) {
  on(root, "click", "[data-go]", (event, node) => navigate(node.dataset.go));
  on(root, "click", "[data-attend]", (event, node) =>
    navigate("attendance", { classId: node.dataset.attend }));
  on(root, "click", "[data-exam]", (event, node) =>
    navigate("results", { examId: node.dataset.exam }));
  on(root, "click", "[data-report]", (event, node) =>
    navigate("results", { studentId: node.dataset.report }));
  on(root, "click", "[data-msg]", (event, node) =>
    navigate("messages", { compose: "1", studentId: node.dataset.msg }));
  on(root, "click", "[data-classes]", () => navigate("admin", { tab: "classes" }));

  const seedButton = qs("[data-seed]", root);
  if (seedButton) {
    seedButton.addEventListener("click", async () => {
      seedButton.disabled = true;
      seedButton.textContent = "Loading sample school…";
      try {
        const result = await post("seedDemo", {});
        toast(`Sample school loaded — ${result.counts.students} students, ${result.counts.results} results`, "success", 6000);
        await renderDashboard(root);
      } catch (error) {
        toast(error?.message ?? "Could not load the sample school", "error");
        seedButton.disabled = false;
        seedButton.textContent = "Load sample school";
      }
    });
  }
}
