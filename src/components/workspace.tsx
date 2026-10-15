"use client";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowUpRight,
  LayoutDashboard,
  Building2,
  BriefcaseBusiness,
  Mail,
  UserRound,
  Settings2,
  ArrowRight,
  Search,
  Plus,
  RefreshCw,
  Check,
  Circle,
  ShieldCheck,
  LogOut,
  Menu,
  X,
  ArrowDownToLine,
  Sparkles,
  Pause,
  CheckCheck,
  Clock3,
} from "lucide-react";
import type { AppState, Company, Job, Draft, EnglishSuggestion } from "@/lib/types";
import { Badge, Button, Empty, External, Modal, relative, label, allowNavigation } from "./ui";
import { ProfilePanel, SettingsPanel, CompanyForm, JobForm } from "./workspace-forms";
import { EmailPanel } from "./email-panel";
import { JobGuidance } from "./job-guidance";
import { CsvImportPanel } from "./csv-import-panel";
import { CompanyDirectory } from "./company-directory";
import { readJsonResponse } from "@/lib/http-client";

export type Act = (
  name: string,
  payload?: unknown,
) => Promise<{
  message?: string;
  draftId?: string;
  suggestion?: EnglishSuggestion;
  contacts?: { email: string; source: string; context: string }[];
} | null>;
type View = "overview" | "jobs" | "companies" | "emails" | "applications" | "profile" | "settings";
const navigation = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "jobs", label: "Job matches", icon: BriefcaseBusiness },
  { id: "companies", label: "Companies", icon: Building2 },
  { id: "emails", label: "Email studio", icon: Mail },
  { id: "applications", label: "Applications", icon: CheckCheck },
  { id: "profile", label: "My profile", icon: UserRound },
] as const;
export default function Workspace({ initialState }: { initialState: AppState }) {
  const [data, setData] = useState(initialState),
    [view, setView] = useState<View>("overview"),
    [busy, setBusy] = useState(""),
    [toast, setToast] = useState<{ message: string; error: boolean } | null>(null),
    [sidebar, setSidebar] = useState(false);
  const [companyEditor, setCompanyEditor] = useState<Company | "new" | null>(null),
    [jobEditor, setJobEditor] = useState(false),
    [jobDetail, setJobDetail] = useState<string | null>(null),
    [draftId, setDraftId] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all");
  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/state", { cache: "no-store" });
      if (r.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (r.ok) setData(await r.json());
    } catch {}
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initial = params.get("view");
    if ([...navigation.map((n) => n.id), "settings"].includes(initial || ""))
      setView(initial as View);
    if (params.get("error")) setToast({ message: params.get("error")!, error: true });
    if (params.has("connected"))
      setToast({ message: "Gmail connected. Your drafts are ready to sync.", error: false });
    const timer = setInterval(refresh, 7000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.error ? 12000 : 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  function navigate(next: View) {
    if (!allowNavigation()) return;
    setView(next);
    setSidebar(false);
    setQuery("");
    setFilter("all");
    window.history.replaceState(null, "", `/?view=${next}`);
  }
  const act: Act = async (name, payload = {}) => {
    if (busy) return null;
    setBusy(name);
    try {
      const r = await fetch("/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: name, payload }),
      });
      const result = await readJsonResponse<NonNullable<Awaited<ReturnType<Act>>>>(r);
      await refresh();
      if (result.message) setToast({ message: result.message, error: false });
      return result;
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : "Something went wrong.", error: true });
      return null;
    } finally {
      setBusy("");
    }
  };
  async function upload(file: File, type: "resume") {
    if (busy) return;
    setBusy("upload");
    try {
      if (file.size > 4 * 1024 * 1024) throw new Error("Upload a résumé smaller than 4 MB.");
      const form = new FormData();
      form.set("file", file);
      form.set("type", type);
      const r = await fetch("/api/upload", { method: "POST", body: form });
      const result = await readJsonResponse<{ message: string }>(r);
      await refresh();
      setToast({ message: result.message, error: false });
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : "Upload failed.", error: true });
    } finally {
      setBusy("");
    }
  }
  async function openEmail(job: Job) {
    const result = await act("draft.create", { id: job.id });
    if (result?.draftId) {
      setDraftId(result.draftId);
      setJobDetail(null);
      navigate("emails");
    }
  }
  const companyById = (id: string) => data.companies.find((c) => c.id === id);
  const activeJobs = data.jobs.filter((j) => !["closed", "skipped"].includes(j.status));
  const shortlist = activeJobs.filter((j) => j.status === "shortlisted");
  const drafts = data.drafts.filter((d) => !["sent", "sending"].includes(d.status));
  const sent = data.drafts.filter((d) => d.status === "sent");
  const steps = [
    {
      title: "Make it yours",
      text: "Add your experience and job preferences.",
      done: data.profile.confirmed,
      view: "profile" as View,
    },
    {
      title: "Build your company list",
      text: "Start with the places you want to work.",
      done: data.companies.length > 0,
      view: "companies" as View,
    },
    {
      title: "Connect optional tools",
      text: "Use AI for rewriting and Gmail for approved sending. Local drafts work without them.",
      done: data.connections.openrouter && data.connections.gmail,
      view: "settings" as View,
    },
  ];
  const detail = data.jobs.find((j) => j.id === jobDetail);
  const searchedJobs = activeJobs
    .filter(
      (j) =>
        `${j.title} ${companyById(j.companyId)?.name} ${j.location}`
          .toLowerCase()
          .includes(query.toLowerCase()) &&
        (filter === "all" ||
          (filter === "shortlisted" && j.status === "shortlisted") ||
          (filter === "strong" && j.match?.rating === "strong") ||
          (filter === "remote" && j.remote)),
    )
    .sort((a, b) => (b.match?.score || 0) - (a.match?.score || 0));
  const workerOnline =
    !!data.connections.workerLastSeen &&
    Date.now() - Date.parse(data.connections.workerLastSeen) < 90000;
  function jobRow(job: Job) {
    const company = companyById(job.companyId);
    return (
      <article className="job-row" key={job.id}>
        <span className="company-avatar">{company?.name.slice(0, 2).toUpperCase()}</span>
        <div className="job-main">
          <button className="title-button" onClick={() => setJobDetail(job.id)}>
            {job.title}
          </button>
          <p>
            {company?.name}
            <span>·</span>
            {job.location.length > 70 ? `${job.location.slice(0, 70)}…` : job.location}
          </p>
          <div className="job-tags">
            {job.remote && <Badge>Remote listed</Badge>}
            {job.status === "shortlisted" && <Badge tone="green">Shortlisted</Badge>}
            <span className="small muted">
              {job.checkedAt ? `Checked ${relative(job.checkedAt)}` : "Not yet verified"}
            </span>
          </div>
        </div>
        <div className="job-end">
          {job.match ? (
            <Badge
              tone={
                job.match.rating === "strong"
                  ? "green"
                  : job.match.rating === "possible"
                    ? "amber"
                    : "neutral"
              }
            >
              {job.match.score}% fit <span className="badge-dot" />
            </Badge>
          ) : (
            <Badge>Not scored</Badge>
          )}
          <button
            className="icon-btn bordered"
            aria-label={`View ${job.title}`}
            onClick={() => setJobDetail(job.id)}
          >
            <ArrowUpRight size={18} />
          </button>
        </div>
      </article>
    );
  }
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {sidebar && <div className="sidebar-backdrop" onClick={() => setSidebar(false)} />}
      <aside className={`sidebar ${sidebar ? "open" : ""}`} aria-label="Workspace sidebar">
        <button className="brand" onClick={() => navigate("overview")} aria-label="Folio overview">
          <span className="brand-mark">
            <ArrowUpRight size={23} />
          </span>
          folio<span className="brand-dot">.</span>
        </button>
        <div className="workspace-label">
          <span className="tiny-dot" /> PERSONAL WORKSPACE
        </div>
        <nav aria-label="Main navigation">
          {navigation.map((n) => (
            <button
              key={n.id}
              className={`nav-item ${view === n.id ? "active" : ""}`}
              aria-current={view === n.id ? "page" : undefined}
              onClick={() => navigate(n.id)}
            >
              <n.icon size={18} />
              {n.label}
              {n.id === "emails" && drafts.length > 0 && (
                <span className="nav-count">{drafts.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="control-card">
            <ShieldCheck size={19} />
            <strong>You’re in control</strong>
            <p>Every email waits for your review and approval.</p>
          </div>
          <button
            className={`nav-item ${view === "settings" ? "active" : ""}`}
            onClick={() => navigate("settings")}
          >
            <Settings2 size={18} /> Settings
          </button>
          <div className="account">
            <span className="account-avatar">{data.profile.name?.slice(0, 1) || "Y"}</span>
            <div>
              <strong>{data.profile.name || "Your workspace"}</strong>
              <span>Private account</span>
            </div>
            <button
              className="icon-btn"
              aria-label="Sign out"
              onClick={async () => {
                await fetch("/api/auth/logout", { method: "POST" });
                window.location.href = "/login";
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <button
            className="icon-btn mobile-menu"
            aria-label="Open navigation"
            onClick={() => setSidebar(true)}
          >
            <Menu size={21} />
          </button>
          <div className="breadcrumb">
            Workspace <span>/</span>{" "}
            <strong>
              {view === "settings" ? "Settings" : navigation.find((n) => n.id === view)?.label}
            </strong>
          </div>
          <div className="topbar-right">
            <span
              className={`connection-dot ${data.settings.automationPaused ? "paused" : workerOnline ? "online" : ""}`}
            />
            <span className="small">
              {data.settings.automationPaused
                ? "Automation paused"
                : workerOnline
                  ? "Workspace running"
                  : "Background tasks on demand"}
            </span>
            <span className="topbar-divider" />
            <span className="small muted">
              {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </span>
          </div>
        </header>
        <main id="main" className={`main ${view === "emails" ? "main-email" : ""}`}>
          {view === "overview" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">A THOUGHTFUL JOB SEARCH</span>
                  <h1>
                    {data.profile.name
                      ? `Your next chapter, ${data.profile.name.split(" ")[0]}.`
                      : "Your next chapter starts here."}
                  </h1>
                  <p>Good opportunities. Personal applications. A little less busywork.</p>
                </div>
                <Button
                  variant="primary"
                  busy={busy === "company.scan"}
                  disabled={!data.companies.length || !!busy}
                  onClick={() => act("company.scan")}
                >
                  <RefreshCw size={16} /> Check for new jobs
                </Button>
              </div>
              {!steps.every((s) => s.done) && (
                <section className="welcome-panel">
                  <div className="welcome-intro">
                    <span className="eyebrow">LET’S GET YOU SETTLED</span>
                    <h2>
                      A search that
                      <br />
                      feels like you.
                    </h2>
                    <p>
                      A few details now make every
                      <br />
                      application more personal.
                    </p>
                    <div className="setup-progress">
                      <span
                        style={{ width: `${(steps.filter((s) => s.done).length / 3) * 100}%` }}
                      />
                    </div>
                    <span className="small muted">
                      {steps.filter((s) => s.done).length} of 3 steps complete
                    </span>
                  </div>
                  <div className="setup-steps">
                    {steps.map((s, i) => (
                      <button
                        key={s.title}
                        className={`setup-step ${s.done ? "done" : ""}`}
                        onClick={() => navigate(s.view)}
                      >
                        <span className="step-number">
                          {s.done ? <Check size={17} /> : String(i + 1).padStart(2, "0")}
                        </span>
                        <span>
                          <strong>{s.title}</strong>
                          <small>{s.text}</small>
                        </span>
                        <ArrowRight size={18} />
                      </button>
                    ))}
                  </div>
                </section>
              )}
              <div className="stats-grid">
                {[
                  {
                    label: "Open opportunities",
                    number: activeJobs.length,
                    note: `Across ${data.companyCount} companies`,
                    icon: BriefcaseBusiness,
                  },
                  {
                    label: "On your shortlist",
                    number: shortlist.length,
                    note: "Worth a closer look",
                    icon: CheckCheck,
                  },
                  {
                    label: "Emails to review",
                    number: drafts.length,
                    note: "Your words, your approval",
                    icon: Mail,
                  },
                  {
                    label: "Replies received",
                    number: sent.filter((d) => d.replyStatus === "reply").length,
                    note: `${sent.length} emails sent`,
                    icon: ArrowDownToLine,
                  },
                ].map((s) => (
                  <div className="stat" key={s.label}>
                    <div>
                      <span>{s.label}</span>
                      <s.icon size={17} />
                    </div>
                    <strong>{s.number.toString().padStart(2, "0")}</strong>
                    <small>{s.note}</small>
                  </div>
                ))}
              </div>
              <div className="overview-columns">
                <section className="panel">
                  <div className="section-heading">
                    <div>
                      <h2>Opportunities worth a look</h2>
                      <p>Your latest roles, ready for a closer read.</p>
                    </div>
                    <Button variant="ghost" onClick={() => navigate("jobs")}>
                      View all <ArrowRight size={15} />
                    </Button>
                  </div>
                  {activeJobs.length ? (
                    activeJobs.slice(0, 4).map(jobRow)
                  ) : (
                    <Empty
                      title="Your next opportunity belongs here"
                      description="Add your target companies or upload a company CSV to start exploring."
                    >
                      <Button onClick={() => navigate("companies")}>
                        Explore companies <ArrowRight size={15} />
                      </Button>
                    </Empty>
                  )}
                </section>
                <section className="panel activity-panel">
                  <div className="section-heading">
                    <div>
                      <h2>A little progress, every day</h2>
                      <p>Your workspace activity.</p>
                    </div>
                  </div>
                  {data.activity.length ? (
                    <div className="activity-list">
                      {data.activity.slice(0, 6).map((a) => (
                        <div className="activity-item" key={a.id}>
                          <span className={`activity-dot ${a.kind}`} />
                          <div>
                            <strong>{a.label}</strong>
                            <p>{a.detail}</p>
                            <time>{relative(a.createdAt)}</time>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="quiet-note">
                      <Clock3 size={24} />
                      <p>A fresh start.</p>
                      <span>
                        Your searches, drafts, and applications will appear here as you go.
                      </span>
                    </div>
                  )}
                </section>
              </div>
            </>
          )}
          {view === "jobs" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">FIND YOUR FIT</span>
                  <h1>Good work starts with a good match.</h1>
                  <p>Explore roles against your experience. Keep the ones that feel right.</p>
                </div>
                <Button onClick={() => setJobEditor(true)}>
                  <Plus size={16} /> Add a job
                </Button>
              </div>
              {!data.profile.confirmed && (
                <div className="notice">
                  Confirm your profile to get match scores.{" "}
                  <button className="inline-link" onClick={() => navigate("profile")}>
                    Complete my profile <ArrowRight size={14} />
                  </button>
                </div>
              )}
              <div className="toolbar">
                <div className="tabs" aria-label="Filter jobs">
                  {["all", "shortlisted", "strong", "remote"].map((f) => (
                    <button
                      key={f}
                      className={filter === f ? "active" : ""}
                      onClick={() => setFilter(f)}
                    >
                      {f === "all"
                        ? "All opportunities"
                        : f === "strong"
                          ? "Strong matches"
                          : label(f)}
                    </button>
                  ))}
                </div>
                <label className="search-field">
                  <Search size={17} />
                  <input
                    aria-label="Search jobs"
                    placeholder="Search roles or companies"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
              </div>
              <div className="panel">
                {searchedJobs.length ? (
                  searchedJobs.map(jobRow)
                ) : (
                  <Empty
                    title={
                      query || filter !== "all"
                        ? "No matches for these filters"
                        : "A little direction goes a long way"
                    }
                    description={
                      query
                        ? "Try another role or company name."
                        : "Add companies and check their careers pages, or paste a vacancy you found."
                    }
                  >
                    <Button onClick={() => navigate("companies")}>
                      Explore companies <ArrowRight size={15} />
                    </Button>
                  </Empty>
                )}
              </div>
              <p className="small muted bottom-note">
                Fit scores are a sorting aid, not a hiring prediction. Keyword matches and AI
                analyses are identified separately in each job.
              </p>
            </>
          )}
          <section hidden={view !== "companies"}>
            <div className="page-heading">
              <div>
                <span className="eyebrow">PLACES YOU COULD BELONG</span>
                <h1>Your company shortlist.</h1>
                <p>Choose the places. We’ll help you keep up with their opportunities.</p>
              </div>
              <Button variant="primary" onClick={() => setCompanyEditor("new")}>
                <Plus size={16} /> Add company
              </Button>
            </div>
            <CsvImportPanel onChanged={refresh} />
            <CompanyDirectory data={data} busy={busy} act={act} onEdit={setCompanyEditor} />
            <p className="small muted bottom-note">
              CSV columns: Company, Website, Careers URL, Recruitment email. Imported contacts need
              your verification.
            </p>
          </section>
          {view === "profile" && (
            <ProfilePanel
              key={data.profile.updatedAt}
              data={data}
              act={act}
              busy={busy}
              upload={(file) => upload(file, "resume")}
            />
          )}
          {view === "settings" && <SettingsPanel data={data} act={act} busy={busy} />}
          {view === "emails" && (
            <EmailPanel
              data={data}
              selectedId={draftId}
              setSelectedId={setDraftId}
              act={act}
              busy={busy}
              onFindJobs={() => navigate("jobs")}
            />
          )}
          {view === "applications" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">KEEP THE CONVERSATION GOING</span>
                  <h1>Every application, in one place.</h1>
                  <p>Track formal submissions and email outreach separately.</p>
                </div>
                <Button
                  disabled={!!busy || !data.connections.gmail}
                  onClick={() => act("gmail.sync")}
                  busy={busy === "gmail.sync"}
                >
                  <RefreshCw size={16} /> Check replies
                </Button>
              </div>
              <div className="panel">
                {data.jobs.filter(
                  (j) =>
                    j.applicationStatus !== "not_submitted" ||
                    data.drafts.some((d) => d.jobId === j.id),
                ).length ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Role & company</th>
                          <th>Application</th>
                          <th>Email activity</th>
                          <th>Next step</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.jobs
                          .filter(
                            (j) =>
                              j.applicationStatus !== "not_submitted" ||
                              data.drafts.some((d) => d.jobId === j.id),
                          )
                          .map((j) => {
                            const draft = data.drafts.find(
                              (d) => d.jobId === j.id && !d.followUpOf,
                            );
                            const followupDue =
                              draft?.status === "sent" &&
                              draft.replyStatus === "none" &&
                              Date.now() - Date.parse(draft.sentAt!) >=
                                data.settings.followUpDays * 86400000;
                            return (
                              <tr key={j.id}>
                                <td>
                                  <button
                                    className="title-button"
                                    onClick={() => setJobDetail(j.id)}
                                  >
                                    {j.title}
                                  </button>
                                  <span className="table-sub">
                                    {companyById(j.companyId)?.name}
                                  </span>
                                </td>
                                <td>
                                  <select
                                    aria-label={`Application status for ${j.title}`}
                                    value={j.applicationStatus}
                                    disabled={!!busy}
                                    onChange={(e) =>
                                      act("job.application", { id: j.id, status: e.target.value })
                                    }
                                  >
                                    {[
                                      "not_submitted",
                                      "submitted",
                                      "interview",
                                      "offer",
                                      "rejected",
                                      "withdrawn",
                                    ].map((s) => (
                                      <option key={s} value={s}>
                                        {label(s)}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td>
                                  <Badge
                                    tone={
                                      draft?.replyStatus === "reply"
                                        ? "green"
                                        : draft?.replyStatus === "bounce"
                                          ? "red"
                                          : "neutral"
                                    }
                                  >
                                    {draft
                                      ? draft.replyStatus !== "none"
                                        ? label(draft.replyStatus)
                                        : label(draft.status)
                                      : "No email"}
                                  </Badge>
                                  {draft?.sentAt && (
                                    <span className="table-sub">{relative(draft.sentAt)}</span>
                                  )}
                                </td>
                                <td>
                                  {followupDue ? (
                                    <Button
                                      variant="ghost"
                                      disabled={!!busy}
                                      onClick={async () => {
                                        const r = await act("draft.followup", { id: draft.id });
                                        if (r?.draftId) {
                                          setDraftId(r.draftId);
                                          navigate("emails");
                                        }
                                      }}
                                    >
                                      Prepare follow-up
                                    </Button>
                                  ) : (
                                    <External href={j.applyUrl}>Application page</External>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty
                    title="Small steps become new beginnings"
                    description="Shortlist a role and prepare an email. Your applications will appear here."
                  />
                )}
              </div>
            </>
          )}
        </main>
        <footer className="page-footer">
          <span>Made for a more intentional search.</span>
          <span>
            <ShieldCheck size={13} /> Private by design
          </span>
        </footer>
      </div>
      {toast && (
        <div
          role={toast.error ? "alert" : "status"}
          className={`toast ${toast.error ? "error" : ""}`}
        >
          {toast.error ? <Circle size={18} /> : <Check size={18} />}
          <span>{toast.message}</span>
          <button
            className="icon-btn"
            aria-label="Dismiss notification"
            onClick={() => setToast(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {companyEditor && (
        <Modal
          title={companyEditor === "new" ? "Add a company" : "Edit company"}
          onClose={() => setCompanyEditor(null)}
        >
          <CompanyForm
            company={companyEditor === "new" ? undefined : companyEditor}
            act={act}
            busy={busy}
            onDone={() => setCompanyEditor(null)}
          />
        </Modal>
      )}
      {jobEditor && (
        <Modal title="Add a job you found" onClose={() => setJobEditor(false)}>
          <JobForm
            companies={data.companies}
            act={act}
            busy={busy}
            onDone={() => setJobEditor(false)}
          />
        </Modal>
      )}
      {detail && (
        <Modal title="A closer look" onClose={() => setJobDetail(null)}>
          <div className="job-detail">
            <span className="eyebrow">{companyById(detail.companyId)?.name}</span>
            <h2>{detail.title}</h2>
            <p className="muted">{detail.location}</p>
            <div className="button-row">
              <Button variant="primary" disabled={!!busy} onClick={() => openEmail(detail)}>
                <Mail size={16} /> Prepare email
              </Button>
              <Button
                disabled={!!busy}
                onClick={() =>
                  act("job.status", {
                    id: detail.id,
                    status: detail.status === "shortlisted" ? "new" : "shortlisted",
                  })
                }
              >
                {detail.status === "shortlisted" ? <Check size={16} /> : <Plus size={16} />}{" "}
                {detail.status === "shortlisted" ? "Shortlisted" : "Shortlist"}
              </Button>
              <External href={detail.applyUrl}>Apply on website</External>
            </div>
            <div className="match-card">
              <div className="section-heading">
                <h3>
                  {detail.match
                    ? `${detail.match.score}% fit · ${label(detail.match.rating)} match`
                    : "Get to know your fit"}
                </h3>
                <Button
                  variant="ghost"
                  disabled={!!busy || !data.connections.openrouter || !data.profile.confirmed}
                  busy={busy === "job.match"}
                  onClick={() => act("job.match", { id: detail.id })}
                >
                  <Sparkles size={15} /> Analyze with AI
                </Button>
              </div>
              {detail.match ? (
                <>
                  <span className="small muted">
                    {detail.match.method === "ai"
                      ? "AI analysis — review against the original listing"
                      : "Keyword comparison — not an AI assessment"}
                  </span>
                  <ul>
                    {detail.match.reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                  {detail.match.gaps.length > 0 && (
                    <>
                      <strong>Gaps to consider</strong>
                      <ul>
                        {detail.match.gaps.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  <strong>Still to confirm</strong>
                  <ul>
                    {detail.match.unknowns.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="muted">
                  Complete your profile to compare this role with your experience.
                </p>
              )}
            </div>
            <JobGuidance job={detail} profile={data.profile} />
            <h3>About the opportunity</h3>
            <div className="job-description">{detail.description}</div>
            <div className="detail-footer">
              <span className="small muted">
                {detail.checkedAt
                  ? `Last checked ${new Date(detail.checkedAt).toLocaleDateString("en-US")}`
                  : "Manually added · current availability not verified"}
              </span>
              <Button
                variant="ghost"
                onClick={async () => {
                  await act("job.status", { id: detail.id, status: "skipped" });
                  setJobDetail(null);
                }}
              >
                Skip this job
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
