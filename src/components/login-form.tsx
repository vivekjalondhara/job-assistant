"use client";
import { useState } from "react";
import { ArrowUpRight, ArrowRight, LockKeyhole, LoaderCircle } from "lucide-react";
export default function LoginForm({ setup, admin = false }: { setup: boolean; admin?: boolean }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const form = new FormData(e.currentTarget);
    if (setup && form.get("password") !== form.get("confirm")) {
      setError("Your passwords don’t match.");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          name: form.get("name") || "Administrator",
          password: form.get("password"),
          setupToken: form.get("setupToken"),
        }),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      window.location.href = result.redirect || "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in.");
      setBusy(false);
    }
  }
  return (
    <main className="login-layout">
      <section className="login-story">
        <div className="brand">
          <span className="brand-mark">
            <ArrowUpRight size={23} />
          </span>
          folio<span className="brand-dot">.</span>
        </div>
        <div>
          <span className="eyebrow">YOUR NEXT CHAPTER</span>
          <h1>
            A little more intention.
            <br />A lot more possibility.
          </h1>
          <p>
            Your skills. Your shortlist. Your words.
            <br />A calmer way to find what comes next.
          </p>
        </div>
        <span className="login-foot">A private workspace, built around you.</span>
      </section>
      <section className="login-panel">
        <div className="login-form">
          <span className="round-icon">
            <LockKeyhole size={22} />
          </span>
          <h2>
            {setup
              ? "Set up your administrator."
              : admin
                ? "Administrator login."
                : "Welcome back."}
          </h2>
          <p className="muted">
            {setup
              ? "Create the first administrator account. Only administrators can invite users."
              : "Sign in to continue your job search."}
          </p>
          <form onSubmit={submit}>
            {setup && (
              <label>
                Your name
                <input name="name" maxLength={100} autoComplete="name" required />
              </label>
            )}
            <label>
              Email
              <input name="email" type="email" maxLength={320} autoComplete="username" required />
            </label>
            <label>
              Your password
              <input
                name="password"
                type="password"
                minLength={12}
                maxLength={256}
                autoComplete={setup ? "new-password" : "current-password"}
                required
                autoFocus
                placeholder={setup ? "At least 12 characters" : "Enter your password"}
              />
            </label>
            {setup && (
              <>
                <label>
                  Confirm password
                  <input
                    name="confirm"
                    type="password"
                    minLength={12}
                    autoComplete="new-password"
                    required
                    placeholder="Enter it once more"
                  />
                </label>
                <label>
                  Workspace setup token
                  <input
                    name="setupToken"
                    type="password"
                    autoComplete="off"
                    required
                    placeholder="Token from your server configuration"
                  />
                </label>
              </>
            )}
            {error && (
              <div className="notice error" role="alert">
                {error}
              </div>
            )}
            <button className="btn primary full" disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={17} /> : null}
              {setup ? "Create administrator" : "Sign in"}
              <ArrowRight size={17} />
            </button>
          </form>
          {!setup && (
            <div className="login-links">
              <button
                className="title-button"
                type="button"
                onClick={async () => {
                  const email =
                    document.querySelector<HTMLInputElement>('input[name="email"]')?.value;
                  if (!email) {
                    setError("Enter your email above first.");
                    return;
                  }
                  setBusy(true);
                  try {
                    const response = await fetch("/api/auth/reset", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ email }),
                    });
                    const result = await response.json();
                    setError(result.message || result.error);
                  } catch {
                    setError("Could not request a reset. Contact your administrator.");
                  } finally {
                    setBusy(false);
                  }
                }}
                disabled={busy}
              >
                Forgot password?
              </button>
              <a href={admin ? "/login" : "/admin/login"}>{admin ? "User login" : "Admin login"}</a>
              <p className="small muted">
                New here? Ask your administrator for an invitation. Existing owners can use their
                current password and enter an email to register it.
              </p>
            </div>
          )}
          <p className="small muted">
            Your profile and drafts stay in this installation. Only the information needed for a
            requested AI action is sent to OpenRouter.
          </p>
        </div>
      </section>
    </main>
  );
}
