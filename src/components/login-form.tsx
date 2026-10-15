"use client";
import { useState } from "react";
import { ArrowUpRight, ArrowRight, LockKeyhole, LoaderCircle } from "lucide-react";
export default function LoginForm({ setup }: { setup: boolean }) {
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
        body: JSON.stringify({ password: form.get("password") }),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      window.location.href = "/";
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
          <h2>{setup ? "Make yourself at home." : "Welcome back."}</h2>
          <p className="muted">
            {setup
              ? "Create a password for this private installation. Gmail can be connected once you’re inside."
              : "Sign in to continue your job search."}
          </p>
          <form onSubmit={submit}>
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
            )}
            {error && (
              <div className="notice error" role="alert">
                {error}
              </div>
            )}
            <button className="btn primary full" disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={17} /> : null}
              {setup ? "Create my workspace" : "Open my workspace"}
              <ArrowRight size={17} />
            </button>
          </form>
          <p className="small muted">
            Your profile and drafts stay in this installation. Only the information needed for a
            requested AI action is sent to OpenRouter.
          </p>
        </div>
      </section>
    </main>
  );
}
