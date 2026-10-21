import { post } from "../api.js";
import { refreshMe, setSession } from "../store.js";
import { html, mount, qs, toast } from "../ui.js";

export async function renderAuth(root, { mode, status, onAuthenticated }) {
  const setup = mode === "setup";
  mount(root, html`
    <div class="gate">
      <div class="gate-card">
        <div class="gate-brand">
          <span class="brand-mark" aria-hidden="true">M</span>
          <div>
            <strong>${setup ? "Set up your school" : status?.schoolName || "School management"}</strong>
            <small>${setup ? "One-time administrator account" : "Attendance · Results · Fees · Parents"}</small>
          </div>
        </div>

        <form id="auth-form" novalidate>
          ${setup ? html`
            <label class="field" for="schoolName">
              <span class="field-label">School name <em class="req">*</em></span>
              <input id="schoolName" name="schoolName" type="text" required maxlength="120"
                     placeholder="Mwangaza Secondary School" autocomplete="organization" />
            </label>
            <label class="field" for="fullName">
              <span class="field-label">Your full name <em class="req">*</em></span>
              <input id="fullName" name="fullName" type="text" required maxlength="120" autocomplete="name" />
            </label>` : ""}

          <label class="field" for="username">
            <span class="field-label">Username <em class="req">*</em></span>
            <input id="username" name="username" type="text" required maxlength="40"
                   autocomplete="username" autocapitalize="none" spellcheck="false" />
          </label>

          <label class="field" for="password">
            <span class="field-label">Password <em class="req">*</em></span>
            <input id="password" name="password" type="password" required minlength="8" maxlength="200"
                   autocomplete="${setup ? "new-password" : "current-password"}" />
          </label>

          ${setup ? html`
            <label class="field" for="confirm">
              <span class="field-label">Confirm password <em class="req">*</em></span>
              <input id="confirm" name="confirm" type="password" required minlength="8" maxlength="200"
                     autocomplete="new-password" />
              <span class="field-hint">At least 8 characters.</span>
            </label>` : ""}

          <div class="form-error" id="auth-error" role="alert" hidden></div>
          <button class="btn btn-primary btn-block" type="submit" id="auth-submit">
            ${setup ? "Create administrator account" : "Sign in"}
          </button>
        </form>
      </div>

      ${setup ? html`
        <div class="gate-card gate-note">
          <h2>What happens next</h2>
          <ol>
            <li>Your administrator account is created.</li>
            <li>Load the sample school, or add your own classes, students and staff.</li>
            <li>Start marking attendance, entering results and billing fees.</li>
          </ol>
          <p class="gate-warn">
            This deployment stores <strong>sample data only</strong>. Do not enter real student,
            parent or financial records here.
          </p>
        </div>` : html`
        <p class="gate-foot">
          Signed-in sessions are stored for this browser tab only and expire automatically.
        </p>`}
    </div>`);

  const form = qs("#auth-form", root);
  const errorBox = qs("#auth-error", root);
  const submit = qs("#auth-submit", root);
  qs("#username", root)?.focus();

  const showError = (message) => {
    errorBox.textContent = message;
    errorBox.hidden = false;
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    const data = Object.fromEntries(new FormData(form).entries());

    if (!data.username || !data.password) return showError("Enter your username and password.");
    if (data.password.length < 8) return showError("Passwords must be at least 8 characters.");
    if (setup) {
      if (!data.schoolName?.trim()) return showError("Enter the school name.");
      if (!data.fullName?.trim()) return showError("Enter your full name.");
      if (data.password !== data.confirm) return showError("The two passwords do not match.");
    }

    submit.disabled = true;
    submit.classList.add("btn-busy");
    try {
      const result = setup
        ? await post("bootstrap", {
            schoolName: data.schoolName.trim(),
            fullName: data.fullName.trim(),
            username: data.username.trim().toLowerCase(),
            password: data.password,
          })
        : await post("login", {
            username: data.username.trim().toLowerCase(),
            password: data.password,
          });
      setSession({ token: result.token });
      // Settings and the unread badge are only available once authenticated.
      await refreshMe();
      toast(setup ? "Administrator account created" : `Welcome back, ${result.user.fullName.split(" ")[0]}`, "success");
      if (onAuthenticated) await onAuthenticated();
    } catch (error) {
      showError(error?.message ?? "Could not sign in. Please try again.");
      submit.disabled = false;
      submit.classList.remove("btn-busy");
    }
    return undefined;
  });
}
