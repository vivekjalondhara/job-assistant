"use client";
import { useState } from "react";
import { ArrowUpRight, Plus, Users, LogOut, Settings2 } from "lucide-react";
import type { AdminSummary, ManagedAccount, AccountLimits } from "@/lib/account-types";
import { defaultLimits } from "@/lib/account-types";
import { Badge, Button, Modal } from "./ui";
import { readJsonResponse } from "@/lib/http-client";
function Allowances({ limits }: { limits: AccountLimits }) {
  return (
    <div className="form-grid">
      <label>
        Storage (MB)
        <input
          name="storageMb"
          type="number"
          min={1}
          max={10000}
          defaultValue={limits.storageMb}
          required
        />
      </label>
      <label>
        Monthly AI allowance ($)
        <input
          name="monthlyAiBudget"
          type="number"
          min={0}
          max={10000}
          step="0.01"
          defaultValue={limits.monthlyAiBudget}
          required
        />
      </label>
      <label>
        Emails per 24 hours
        <input
          name="dailySendLimit"
          type="number"
          min={0}
          max={500}
          defaultValue={limits.dailySendLimit}
          required
        />
      </label>
    </div>
  );
}
const formLimits = (f: FormData): AccountLimits => ({
  storageMb: Number(f.get("storageMb")),
  monthlyAiBudget: Number(f.get("monthlyAiBudget")),
  dailySendLimit: Number(f.get("dailySendLimit")),
});
export default function AdminPanel({ initial, name }: { initial: AdminSummary; name: string }) {
  const [data, setData] = useState(initial);
  const [editor, setEditor] = useState<ManagedAccount | "new" | null>(null);
  const [deleting, setDeleting] = useState<ManagedAccount | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const [search, setSearch] = useState("");
  async function action(body: unknown) {
    if (busy) return false;
    setBusy(true);
    setError("");
    setNotice("");
    setLink("");
    try {
      const result = await readJsonResponse<{ link?: string; delivered?: boolean }>(
        await fetch("/api/admin/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      setData(
        await readJsonResponse<AdminSummary>(
          await fetch("/api/admin/users", { cache: "no-store" }),
        ),
      );
      if (result.link) {
        setLink(result.link);
        setNotice(
          result.delivered
            ? "Email sent. The link expires in 24 hours."
            : "Share this private link with the intended user. Email was not delivered. The link expires in 24 hours.",
        );
      } else setNotice("Account updated.");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update account.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  const users = data.users.filter((u) =>
    `${u.name} ${u.email || ""}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <main className="admin-shell">
      <header className="admin-header">
        <a className="brand" href="/admin">
          <span className="brand-mark">
            <ArrowUpRight size={23} />
          </span>
          folio<span className="brand-dot">.</span>
        </a>
        <div className="button-row">
          <Button
            disabled={busy}
            onClick={async () => {
              try {
                setData(
                  await readJsonResponse<AdminSummary>(
                    await fetch("/api/admin/users", { cache: "no-store" }),
                  ),
                );
              } catch {
                setError("Could not refresh accounts. Sign in again if your session expired.");
              }
            }}
          >
            Refresh
          </Button>
          <a className="btn secondary" href="/">
            My workspace
          </a>
          <Button
            disabled={busy}
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              window.location.href = "/admin/login";
            }}
          >
            <LogOut size={16} /> Sign out
          </Button>
        </div>
      </header>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ADMINISTRATION · {name}</span>
          <h1>People and workspaces.</h1>
          <p>Create private workspaces and manage access.</p>
        </div>
        <Button variant="primary" onClick={() => setEditor("new")}>
          <Plus size={17} /> Add user
        </Button>
      </div>
      <div className="admin-stats">
        {[
          ["Users", data.users.filter((u) => u.role === "user").length],
          ["Active", data.users.filter((u) => u.status === "active").length],
          ["Invitations", data.users.filter((u) => u.status === "invited").length],
          ["Disabled", data.users.filter((u) => u.status === "disabled").length],
          [
            "Storage",
            `${(data.users.reduce((n, u) => n + u.storageBytes, 0) / 1048576).toFixed(1)} MB`,
          ],
          ["AI this month", `$${data.users.reduce((n, u) => n + u.aiCost, 0).toFixed(2)}`],
        ].map(([label, value]) => (
          <div className="panel" key={label}>
            <span className="small muted">{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      {!data.emailConfigured && (
        <p className="notice">
          Invitation email is not configured. After adding a user, copy their invitation link and
          share it privately.
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {link && (
        <div className="panel invite-link">
          <label>
            Private account link
            <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
          </label>
          <Button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(link);
                setNotice("Link copied. Share it only with the intended user.");
              } catch {
                setNotice("Select the link and copy it manually.");
              }
            }}
          >
            Copy link
          </Button>
          <Button onClick={() => setLink("")}>Dismiss</Button>
        </div>
      )}
      <section className="panel">
        <div className="admin-list-heading">
          <h2>
            <Users size={20} /> Accounts
          </h2>
          <label>
            Search users
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name or email"
            />
          </label>
        </div>
        {users.map((u) => (
          <article className="admin-user" key={u.id}>
            <div>
              <h3>
                {u.name}{" "}
                <Badge tone={u.status === "active" ? "green" : "neutral"}>{u.status}</Badge>
              </h3>
              <p>{u.email || "Original owner — enter an email on your next login"}</p>
              <p className="small muted">
                {u.role} · {(u.storageBytes / 1048576).toFixed(1)} / {u.limits.storageMb} MB · AI $
                {u.aiCost.toFixed(4)} / ${u.limits.monthlyAiBudget}
                {u.unknownAiCosts > 0 ? ` · ${u.unknownAiCosts} costs unavailable` : ""} ·{" "}
                {u.failedTasks} failed tasks
              </p>
            </div>
            {u.role === "user" && (
              <div className="button-row">
                <Button disabled={busy || u.status === "deleting"} onClick={() => setEditor(u)}>
                  <Settings2 size={16} /> Manage
                </Button>
                {["invited", "active"].includes(u.status) && (
                  <Button disabled={busy} onClick={() => action({ action: "resend", id: u.id })}>
                    {u.status === "invited" ? "New invitation" : "Password reset"}
                  </Button>
                )}
                <Button disabled={busy} onClick={() => setDeleting(u)}>
                  {u.status === "deleting" ? "Retry deletion" : "Delete"}
                </Button>
              </div>
            )}
          </article>
        ))}
        {!users.length && <p className="muted">No users match your search.</p>}
      </section>
      <section className="panel">
        <h2>Administrative activity</h2>
        <p className="small muted">
          Account and allowance changes only. Private résumés and emails are not shown here.
        </p>
        {data.audit.slice(0, 30).map((a) => (
          <p className="admin-audit" key={a.id}>
            <span>
              {a.action.replaceAll(".", " ")} ·{" "}
              {data.users.find((u) => u.id === a.target_id)?.email || "Deleted account"}
            </span>
            <time dateTime={a.created_at}>{new Date(a.created_at).toLocaleString()}</time>
          </p>
        ))}
      </section>
      {editor && (
        <Modal
          title={editor === "new" ? "Add a user" : "Manage user"}
          onClose={() => !busy && setEditor(null)}
        >
          <form
            className="career-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const payload = {
                name: f.get("name"),
                limits: formLimits(f),
                ...(editor === "new" ? { email: f.get("email") } : { status: f.get("status") }),
              };
              if (
                await action({
                  action: editor === "new" ? "invite" : "update",
                  id: editor === "new" ? undefined : editor.id,
                  payload,
                })
              )
                setEditor(null);
            }}
          >
            <label>
              Name
              <input
                name="name"
                maxLength={100}
                defaultValue={editor === "new" ? "" : editor.name}
                required
              />
            </label>
            {editor === "new" ? (
              <label>
                Email
                <input name="email" type="email" maxLength={320} required />
              </label>
            ) : (
              <label>
                Access
                <select
                  name="status"
                  defaultValue={editor.status === "disabled" ? "disabled" : "active"}
                >
                  <option value="active">Enabled</option>
                  <option value="disabled">Disabled</option>
                </select>
              </label>
            )}
            <Allowances limits={editor === "new" ? defaultLimits : editor.limits} />
            <p className="small muted">
              AI allowances use reported costs. Missing costs and in-flight requests can make totals
              incomplete.
            </p>
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? "Saving…" : editor === "new" ? "Create user and invitation" : "Save changes"}
            </Button>
          </form>
        </Modal>
      )}
      {deleting && (
        <Modal title="Delete this user?" onClose={() => !busy && setDeleting(null)}>
          <form
            className="career-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              if (
                await action({
                  action: "delete",
                  id: deleting.id,
                  confirmation: f.get("confirmation"),
                })
              )
                setDeleting(null);
            }}
          >
            <p>
              This permanently removes {deleting.name}’s workspace, uploaded files, saved Gmail
              connection, and application history. Messages already in Gmail remain there.
            </p>
            <label>
              Type {deleting.email} to confirm
              <input name="confirmation" type="email" required autoComplete="off" />
            </label>
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Deleting…" : "Permanently delete user"}
            </Button>
          </form>
        </Modal>
      )}
    </main>
  );
}
