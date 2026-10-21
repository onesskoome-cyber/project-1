import { get, getToken, setUnauthorizedHandler } from "./api.js";
import * as ui from "./ui.js";
import {
  isSampleData,
  logout,
  refreshMe,
  schoolName,
  state,
  subscribe,
} from "./store.js";
import { parseHash } from "./router.js";
import { renderAuth } from "./views/login.js";
import { renderDashboard } from "./views/dashboard.js";
import { renderStudents } from "./views/students.js";
import { renderAttendance } from "./views/attendance.js";
import { renderResults } from "./views/results.js";
import { renderFees } from "./views/fees.js";
import { renderMessages } from "./views/messages.js";
import { renderAnnouncements } from "./views/announcements.js";
import { renderAdmin } from "./views/admin.js";

const ALL = ["admin", "teacher", "parent", "accountant"];

const ROUTES = {
  dashboard: { title: "Dashboard", roles: ALL, render: renderDashboard },
  students: { title: "Students", roles: ["admin", "teacher"], render: renderStudents },
  attendance: { title: "Attendance", roles: ["admin", "teacher"], render: renderAttendance },
  results: { title: "Results", roles: ["admin", "teacher", "parent"], render: renderResults },
  fees: { title: "Fees & finance", roles: ALL, render: renderFees },
  messages: { title: "Messages", roles: ALL, render: renderMessages },
  notices: { title: "Notices", roles: ALL, render: renderAnnouncements },
  admin: { title: "Administration", roles: ["admin"], render: renderAdmin },
};

const ICONS = {
  dashboard: "M3 13h8V3H3v10zm10 8h8V11h-8v10zM3 21h8v-6H3v6zm10-12h8V3h-8v6z",
  students: "M12 12a5 5 0 100-10 5 5 0 000 10zm0 2c-5 0-9 2.5-9 6v2h18v-2c0-3.5-4-6-9-6z",
  attendance: "M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z",
  results: "M5 9.2h3V19H5V9.2zM10.6 5h3v14h-3V5zm5.6 8h3v6h-3v-6z",
  fees: "M12 2a10 10 0 100 20 10 10 0 000-20zm1 15h-2v-1H8v-2h5v-1H9a1 1 0 01-1-1V9a1 1 0 011-1h2V7h2v1h3v2h-5v1h4a1 1 0 011 1v3a1 1 0 01-1 1h-2v1z",
  messages: "M20 2H4a2 2 0 00-2 2v18l4-4h14a2 2 0 002-2V4a2 2 0 00-2-2z",
  notices: "M18 11v2h4v-2h-4zm-2 6.6l3.4 2-1 1.7-3.4-2 1-1.7zM20.4 4.3l-1-1.7-3.4 2 1 1.7 3.4-2zM11 5a1 1 0 011 1v3.6l4.4 2.6-.9 1.6L11 11.7V16a1 1 0 01-1 1H6a1 1 0 01-1-1v-5H2v-2h3V6a1 1 0 011-1h5z",
  admin: "M12 8a4 4 0 100 8 4 4 0 000-8zm9 4l2 1.6-1.6 2.8-2.5-.6-1.7 1 .3 2.6-3.2.6-1.2-2.4h-2l-1.2 2.4-3.2-.6.3-2.6-1.7-1-2.5.6L1 13.6 3 12l-2-1.6 1.6-2.8 2.5.6 1.7-1L6.5 4.6l3.2-.6L11 6.4h2l1.2-2.4 3.2.6-.3 2.6 1.7 1 2.5-.6L23 10.4 21 12z",
};

function navItems() {
  return Object.entries(ROUTES)
    .filter(([, route]) => route.roles.includes(state.user?.role))
    .map(([key, route]) => ({ key, title: route.title }));
}

function shellMarkup() {
  return ui.html`
    <div class="shell">
      <aside class="sidebar" id="sidebar">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true">M</span>
          <span class="brand-text">
            <strong id="brand-name">${schoolName()}</strong>
            <small>School management</small>
          </span>
        </div>
        <nav class="nav" id="nav" aria-label="Main"></nav>
        <div class="sidebar-foot">
          <div class="who">
            <span class="avatar" id="who-avatar" aria-hidden="true"></span>
            <span class="who-text">
              <strong id="who-name"></strong>
              <small id="who-role"></small>
            </span>
          </div>
          <button class="btn btn-ghost btn-sm" id="signout" type="button">Sign out</button>
        </div>
      </aside>
      <div class="main">
        <header class="topbar">
          <button class="icon-btn menu-toggle" id="menu-toggle" type="button" aria-label="Open menu" aria-expanded="false">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z"/></svg>
          </button>
          <h1 class="page-title" id="page-title">Dashboard</h1>
          <div class="topbar-right">
            ${isSampleData() ? ui.safe('<span class="badge badge-demo" title="This deployment holds sample records only">Demo data</span>') : ""}
            <span class="term-chip" id="term-chip"></span>
            <a class="bell" href="#/messages" id="bell" aria-label="Messages">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 22a2 2 0 002-2h-4a2 2 0 002 2zm6-6V11a6 6 0 10-12 0v5l-2 2v1h16v-1l-2-2z"/></svg>
              <span class="bell-count" id="bell-count" hidden></span>
            </a>
          </div>
        </header>
        <main class="view" id="view" tabindex="-1"></main>
      </div>
      <div class="scrim" id="scrim" hidden></div>
    </div>`;
}

const ROLE_LABEL = {
  admin: "Administrator",
  teacher: "Teacher",
  parent: "Parent",
  accountant: "Bursar",
};

function paintChrome() {
  const nav = document.getElementById("nav");
  if (!nav) return;
  nav.innerHTML = navItems()
    .map((item) => ui.html`
      <a class="nav-link" href="#/${item.key}" data-route="${item.key}">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="${ICONS[item.key]}"/></svg>
        <span>${item.title}</span>
      </a>`)
    .join("");

  const user = state.user;
  document.getElementById("brand-name").textContent = schoolName();
  document.getElementById("who-name").textContent = user?.fullName ?? "";
  document.getElementById("who-role").textContent = ROLE_LABEL[user?.role] ?? "";
  document.getElementById("who-avatar").textContent = (user?.fullName ?? "?").trim().charAt(0).toUpperCase();
  document.getElementById("term-chip").textContent = ui.termLabel(
    Number(state.settings.currentTerm) || 0,
    Number(state.settings.currentYear) || 0,
  );

  const count = document.getElementById("bell-count");
  if (state.unread > 0) {
    count.hidden = false;
    count.textContent = state.unread > 99 ? "99+" : String(state.unread);
  } else {
    count.hidden = true;
  }
}

let shellBuilt = false;
let inFlight = 0;

async function renderRoute() {
  const { route, params } = parseHash();
  const entry = ROUTES[route];
  const view = document.getElementById("view");
  if (!view) return;

  document.getElementById("sidebar")?.classList.remove("open");
  const scrim = document.getElementById("scrim");
  if (scrim) scrim.hidden = true;

  if (!entry || !entry.roles.includes(state.user?.role)) {
    document.getElementById("page-title").textContent = "Not available";
    view.innerHTML = ui.emptyState(
      "That page is not available for your role",
      "Use the menu to return to your dashboard.",
    );
    return;
  }

  document.getElementById("page-title").textContent = entry.title;
  document.title = `${entry.title} · ${schoolName()}`;
  for (const link of document.querySelectorAll(".nav-link")) {
    link.classList.toggle("active", link.dataset.route === route);
  }

  const token = ++inFlight;
  view.innerHTML = ui.spinner("Loading");
  try {
    await entry.render(view, params);
  } catch (error) {
    // A late response must not overwrite the page the user has moved on to.
    if (token !== inFlight) return;
    view.innerHTML = ui.errorState(error?.message ?? "Could not load this page.");
    const retry = view.querySelector("[data-retry]");
    if (retry) retry.addEventListener("click", () => renderRoute());
    return;
  }
  if (token !== inFlight) return;
  view.scrollTop = 0;
  paintChrome();
}

function buildShell() {
  if (shellBuilt) {
    paintChrome();
    return;
  }
  document.getElementById("app").innerHTML = shellMarkup();
  shellBuilt = true;

  document.getElementById("signout").addEventListener("click", async () => {
    await logout();
    await boot();
  });

  const toggle = document.getElementById("menu-toggle");
  const sidebar = document.getElementById("sidebar");
  const scrim = document.getElementById("scrim");
  const closeNav = () => {
    sidebar.classList.remove("open");
    scrim.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
  };
  toggle.addEventListener("click", () => {
    const open = sidebar.classList.toggle("open");
    scrim.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
  });
  scrim.addEventListener("click", closeNav);
  sidebar.addEventListener("click", (event) => {
    if (event.target.closest(".nav-link")) closeNav();
  });

  paintChrome();
}

async function showAuth(mode, status) {
  shellBuilt = false;
  document.getElementById("app").innerHTML = "";
  await renderAuth(document.getElementById("app"), { mode, status, onAuthenticated: () => boot() });
}

let booting = false;

async function boot() {
  if (booting) return;
  booting = true;
  try {
    let status;
    try {
      status = await get("status");
    } catch (error) {
      document.getElementById("app").innerHTML = ui.html`
        <div class="gate-error">
          <h1>Cannot reach the school service</h1>
          <p>${error?.message ?? "The server did not respond."}</p>
          <button class="btn btn-primary" type="button" id="retry-boot">Try again</button>
        </div>`;
      document.getElementById("retry-boot").addEventListener("click", () => {
        document.getElementById("app").innerHTML = ui.spinner("Connecting");
        void boot();
      });
      return;
    }

    if (!status.initialised) return void (await showAuth("setup", status));
    if (!state.user && getToken()) {
      try {
        await refreshMe();
      } catch {
        // An expired or rejected token simply returns to the sign-in screen.
        return void (await showAuth("login", status));
      }
    }
    if (!state.user) return void (await showAuth("login", status));
    buildShell();
    await renderRoute();
  } finally {
    booting = false;
  }
  return undefined;
}

subscribe(() => {
  if (state.user && shellBuilt) paintChrome();
});

window.addEventListener("hashchange", () => {
  if (state.user) void renderRoute();
});

setUnauthorizedHandler(() => {
  state.user = null;
  void boot();
});

void boot();
