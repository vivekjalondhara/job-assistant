"use client";
import { useEffect, useState } from "react";
import { readJsonResponse } from "@/lib/http-client";
export default function ActivateForm() {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setToken(window.location.hash.slice(1));
    window.history.replaceState(null, "", "/activate");
  }, []);
  return (
    <main className="account-entry">
      <section className="panel">
        <span className="eyebrow">YOUR PRIVATE WORKSPACE</span>
        <h1>Set your password.</h1>
        <p>Accept your invitation or complete your password reset. Use at least 12 characters.</p>
        <form
          className="career-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setError("");
            if (f.get("password") !== f.get("confirm")) {
              setError("Passwords do not match.");
              return;
            }
            setBusy(true);
            try {
              const result = await readJsonResponse<{ redirect: string }>(
                await fetch("/api/auth/activate", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ token, password: f.get("password") }),
                }),
              );
              window.location.href = result.redirect;
            } catch (e) {
              setError(e instanceof Error ? e.message : "Could not activate account.");
              setBusy(false);
            }
          }}
        >
          <label>
            Password
            <input
              name="password"
              type="password"
              minLength={12}
              maxLength={256}
              autoComplete="new-password"
              required
            />
          </label>
          <label>
            Confirm password
            <input
              name="confirm"
              type="password"
              minLength={12}
              maxLength={256}
              autoComplete="new-password"
              required
            />
          </label>
          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
          {!token && (
            <p className="notice">
              Open the complete invitation or reset link supplied by your administrator.
            </p>
          )}
          <button className="btn primary" disabled={busy || !token}>
            {busy ? "Saving…" : "Save password and sign in"}
          </button>
          <a href="/login">Back to login</a>
        </form>
      </section>
    </main>
  );
}
