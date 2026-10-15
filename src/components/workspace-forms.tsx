"use client";
import { useState } from "react";
import {
  ArrowUpRight,
  Check,
  FileText,
  Upload,
  Sparkles,
  ShieldCheck,
  Mail,
  Plug,
  Pause,
  Play,
  Save,
  ArrowRight,
} from "lucide-react";
import type { AppState, Company } from "@/lib/types";
import type { Act } from "./workspace";
import { Button, Badge, External } from "./ui";

const value = (form: FormData, key: string) => String(form.get(key) || "").trim();
const list = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label>
      {label}
      {children}
      {hint && <small className="field-hint">{hint}</small>}
    </label>
  );
}
export function ProfilePanel({
  data,
  act,
  busy,
  upload,
}: {
  data: AppState;
  act: Act;
  busy: string;
  upload: (file: File) => Promise<void>;
}) {
  const p = data.profile;
  const [confirmed, setConfirmed] = useState(p.confirmed);
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await act("profile.save", {
      name: value(f, "name"),
      email: value(f, "email"),
      headline: value(f, "headline"),
      location: value(f, "location"),
      skills: list(value(f, "skills")),
      experience: value(f, "experience"),
      projects: value(f, "projects"),
      education: value(f, "education"),
      targetRoles: list(value(f, "targetRoles")),
      preferredLocations: list(value(f, "preferredLocations")),
      remoteOnly: f.has("remoteOnly"),
      availability: value(f, "availability"),
      portfolio: value(f, "portfolio"),
      signature: value(f, "signature"),
      tone: value(f, "tone"),
      confirmed,
    });
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">THE STORY ONLY YOU CAN TELL</span>
          <h1>Start with what makes you, you.</h1>
          <p>Your confirmed experience is the source for every match and email.</p>
        </div>
        <Badge tone={p.confirmed ? "green" : "amber"}>
          {p.confirmed ? "Profile confirmed" : "Needs your review"}
        </Badge>
      </div>
      <div className="profile-layout">
        <form className="panel profile-form" onSubmit={save}>
          <div className="section-heading">
            <div>
              <h2>Your experience</h2>
              <p>Keep it specific. Your real work makes the strongest introduction.</p>
            </div>
          </div>
          <div className="form-body">
            <div className="form-grid">
              <Field label="Full name">
                <input
                  name="name"
                  defaultValue={p.name}
                  placeholder="Your full name"
                  required
                  maxLength={160}
                />
              </Field>
              <Field label="Contact email">
                <input
                  name="email"
                  type="email"
                  defaultValue={p.email}
                  placeholder="you@example.com"
                />
              </Field>
              <Field label="Professional headline">
                <input
                  name="headline"
                  defaultValue={p.headline}
                  placeholder="e.g. Backend engineer"
                  maxLength={240}
                />
              </Field>
              <Field label="Current location">
                <input
                  name="location"
                  defaultValue={p.location}
                  placeholder="City, country"
                  maxLength={160}
                />
              </Field>
            </div>
            <Field
              label="Skills"
              hint="Separate skills with commas. Include only skills you can demonstrate."
            >
              <input
                name="skills"
                defaultValue={p.skills.join(", ")}
                placeholder="Python, Node.js, PostgreSQL, React"
              />
            </Field>
            <Field
              label="Work experience"
              hint="Include role, dates, responsibilities, and results you can support."
            >
              <textarea
                name="experience"
                defaultValue={p.experience}
                rows={6}
                placeholder="Describe your work in your own words…"
                maxLength={16000}
              />
            </Field>
            <Field label="Projects & achievements">
              <textarea
                name="projects"
                defaultValue={p.projects}
                rows={4}
                placeholder="What did you build? What was your contribution?"
                maxLength={16000}
              />
            </Field>
            <Field label="Education">
              <textarea
                name="education"
                defaultValue={p.education}
                rows={2}
                placeholder="Qualifications, institution, and dates"
                maxLength={6000}
              />
            </Field>
            <div className="form-section-title">
              <h2>What comes next</h2>
              <p>Give your search a little direction.</p>
            </div>
            <div className="form-grid">
              <Field label="Target roles" hint="Separate roles with commas.">
                <input
                  name="targetRoles"
                  defaultValue={p.targetRoles.join(", ")}
                  placeholder="Backend engineer, Full stack engineer"
                />
              </Field>
              <Field label="Preferred locations">
                <input
                  name="preferredLocations"
                  defaultValue={p.preferredLocations.join(", ")}
                  placeholder="India, Remote"
                />
              </Field>
              <Field label="Availability / notice period">
                <input
                  name="availability"
                  defaultValue={p.availability}
                  placeholder="e.g. Available after 30 days"
                />
              </Field>
              <Field label="Portfolio or GitHub URL">
                <input
                  name="portfolio"
                  type="url"
                  defaultValue={p.portfolio}
                  placeholder="https://"
                />
              </Field>
            </div>
            <label className="check-row">
              <input name="remoteOnly" type="checkbox" defaultChecked={p.remoteOnly} /> I’m only
              considering remote roles
            </label>
            <div className="form-section-title">
              <h2>Sound like yourself</h2>
              <p>A natural voice for your application emails.</p>
            </div>
            <Field label="Preferred writing style">
              <select name="tone" defaultValue={p.tone}>
                <option value="warm">Warm & professional</option>
                <option value="concise">Clear & concise</option>
                <option value="formal">More formal</option>
              </select>
            </Field>
            <Field label="Email signature">
              <textarea
                name="signature"
                rows={3}
                defaultValue={p.signature}
                placeholder="Your name&#10;Your portfolio link"
                maxLength={1000}
              />
            </Field>
            <label className="check-row confirmation">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />{" "}
              <span>
                I’ve reviewed this information and confirm it accurately represents my experience.
              </span>
            </label>
            <Button
              variant="primary"
              type="submit"
              busy={busy === "profile.save"}
              disabled={!!busy}
            >
              <Save size={16} /> Save my profile
            </Button>
          </div>
        </form>
        <aside>
          <section className="panel resume-panel">
            <span className="round-icon">
              <FileText size={23} />
            </span>
            <h2>Your résumé</h2>
            <p className="muted">Bring your experience with you. PDF, DOCX, or TXT, up to 4 MB.</p>
            {p.resumeName && (
              <a className="resume-file" href={`/api/resume/${p.resumeId}`}>
                <FileText size={18} />
                <span>{p.resumeName}</span>
                <ArrowUpRight size={15} />
              </a>
            )}
            <label className={`btn secondary full file-button ${busy ? "disabled" : ""}`}>
              <Upload size={16} />
              {busy === "upload"
                ? "Reading résumé…"
                : p.resumeId
                  ? "Replace résumé"
                  : "Upload résumé"}
              <input
                type="file"
                accept=".pdf,.docx,.txt"
                disabled={!!busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void upload(file);
                  e.target.value = "";
                }}
              />
            </label>
            <Button
              className="full"
              disabled={!!busy || !p.resumeId || !data.connections.openrouter}
              busy={busy === "profile.extract"}
              onClick={() => act("profile.extract")}
            >
              <Sparkles size={16} /> Fill profile with AI
            </Button>
            <p className="small muted">
              AI extraction replaces the experience fields and requires your review. You can also
              fill them manually.
            </p>
          </section>
          <div className="aside-note">
            <ShieldCheck size={20} />
            <strong>Facts first. Always.</strong>
            <p>
              The AI uses the experience you confirm here. Review every email before it leaves your
              account.
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
export function CompanyForm({
  company,
  act,
  busy,
  onDone,
}: {
  company?: Company;
  act: Act;
  busy: string;
  onDone: () => void;
}) {
  const [contacts, setContacts] = useState<{ email: string; source: string; context: string }[]>(
    [],
  );
  const [email, setEmail] = useState(company?.email || ""),
    [contactSource, setContactSource] = useState(company?.contactSource || ""),
    [contactConfirmed, setContactConfirmed] = useState(company?.contactConfirmed || false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await act("company.save", {
      id: company?.id,
      name: value(f, "name"),
      website: value(f, "website"),
      careersUrl: value(f, "careersUrl"),
      email: value(f, "email"),
      contactSource: value(f, "contactSource"),
      contactConfirmed: f.has("contactConfirmed"),
      priority: value(f, "priority"),
      paused: f.has("paused"),
    });
    if (r) onDone();
  }
  return (
    <form className="modal-form" onSubmit={submit}>
      <Field label="Company name">
        <input
          name="name"
          required
          defaultValue={company?.name}
          placeholder="Company name"
          maxLength={200}
        />
      </Field>
      <div className="form-grid">
        <Field label="Official website">
          <input
            name="website"
            type="url"
            defaultValue={company?.website}
            placeholder="https://company.com"
          />
        </Field>
        <Field label="Priority">
          <select name="priority" defaultValue={company?.priority || "normal"}>
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </select>
        </Field>
      </div>
      <Field
        label="Careers page"
        hint="Ashby, Greenhouse, and Lever boards are checked automatically. Other sources support manual job entry."
      >
        <input
          name="careersUrl"
          type="url"
          defaultValue={company?.careersUrl}
          placeholder="https://jobs.ashbyhq.com/company"
        />
      </Field>
      {company && (
        <>
          <Button
            type="button"
            disabled={!!busy}
            onClick={async () => {
              const result = await act("company.contacts", { id: company.id });
              if (result?.contacts) setContacts(result.contacts);
            }}
          >
            <Mail size={15} /> Find addresses in saved job listings
          </Button>
          {contacts.map((c) => (
            <div className="notice small" key={c.email}>
              <strong>{c.email}</strong>
              <span>{c.context}</span>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setEmail(c.email);
                  setContactSource(c.source);
                  setContactConfirmed(false);
                }}
              >
                Use this address
              </Button>
            </div>
          ))}
        </>
      )}
      <Field label="Recruitment email">
        <input
          name="email"
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setContactConfirmed(false);
          }}
          placeholder="An address published for recruitment"
        />
      </Field>
      <Field
        label="Contact source"
        hint="Record where you found the address so you can check it before sending."
      >
        <input
          name="contactSource"
          value={contactSource}
          onChange={(e) => {
            setContactSource(e.target.value);
            setContactConfirmed(false);
          }}
          placeholder="Job listing URL or company recruitment page"
          maxLength={1000}
        />
      </Field>
      <label className="check-row">
        <input
          name="contactConfirmed"
          type="checkbox"
          checked={contactConfirmed}
          onChange={(e) => setContactConfirmed(e.target.checked)}
        />{" "}
        I checked that this contact is appropriate for recruitment
      </label>
      <label className="check-row">
        <input name="paused" type="checkbox" defaultChecked={company?.paused} /> Pause scheduled
        checks for this company
      </label>
      <div className="modal-actions">
        <Button type="button" onClick={onDone}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" disabled={!!busy} busy={busy === "company.save"}>
          Save company <Check size={16} />
        </Button>
      </div>
    </form>
  );
}
export function JobForm({
  companies,
  act,
  busy,
  onDone,
}: {
  companies: Company[];
  act: Act;
  busy: string;
  onDone: () => void;
}) {
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await act("job.create", {
      companyId: value(f, "companyId"),
      title: value(f, "title"),
      location: value(f, "location"),
      description: value(f, "description"),
      url: value(f, "url"),
      applyUrl: value(f, "applyUrl") || value(f, "url"),
      remote: f.has("remote"),
      salary: value(f, "salary"),
    });
    if (r) onDone();
  }
  return (
    <form className="modal-form" onSubmit={submit}>
      {!companies.length && <div className="notice">Add a company before adding a vacancy.</div>}
      <Field label="Company">
        <select name="companyId" required defaultValue="">
          <option value="" disabled>
            Choose a company
          </option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Job title">
        <input name="title" required placeholder="Exact title from the vacancy" maxLength={250} />
      </Field>
      <div className="form-grid">
        <Field label="Location">
          <input name="location" placeholder="Location as listed" />
        </Field>
        <Field label="Published salary (optional)">
          <input name="salary" placeholder="Only if stated in the listing" />
        </Field>
      </div>
      <label className="check-row">
        <input name="remote" type="checkbox" /> The listing explicitly offers remote work
      </label>
      <Field label="Original listing URL">
        <input name="url" type="url" placeholder="https://" />
      </Field>
      <Field label="Application URL">
        <input name="applyUrl" type="url" placeholder="Leave blank to use the listing URL" />
      </Field>
      <Field label="Full job description">
        <textarea
          name="description"
          rows={8}
          required
          minLength={30}
          maxLength={50000}
          placeholder="Paste the actual responsibilities, requirements, and application instructions…"
        />
      </Field>
      <div className="modal-actions">
        <Button type="button" onClick={onDone}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={!!busy || !companies.length}
          busy={busy === "job.create"}
        >
          Add opportunity
        </Button>
      </div>
    </form>
  );
}
export function SettingsPanel({ data, act, busy }: { data: AppState; act: Act; busy: string }) {
  const options = data.settings;
  const usage = data.usage.filter((u) =>
    u.createdAt.startsWith(new Date().toISOString().slice(0, 7)),
  );
  const cost = usage.reduce((sum, u) => sum + (u.cost || 0), 0),
    missing = usage.filter((u) => u.cost === null).length;
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await act("settings.save", {
      automationPaused: f.has("automationPaused"),
      dailySearch: f.has("dailySearch"),
      dailySendLimit: Number(f.get("dailySendLimit")),
      monthlyAiBudget: Number(f.get("monthlyAiBudget")),
      followUpDays: Number(f.get("followUpDays")),
    });
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR WORKSPACE, YOUR RULES</span>
          <h1>A few thoughtful settings.</h1>
          <p>Connect your tools and choose the pace of your search.</p>
        </div>
      </div>
      <div className="settings-grid">
        <section className="panel settings-card">
          <div className="integration-title">
            <span className="round-icon">
              <Sparkles size={21} />
            </span>
            <div>
              <h2>OpenRouter</h2>
              <span className="small muted">Personal emails, grounded in your experience</span>
            </div>
            <Badge tone={data.connections.openrouter ? "green" : "amber"}>
              {data.connections.openrouter ? "Configured" : "Setup needed"}
            </Badge>
          </div>
          <p className="muted">
            {data.connections.model
              ? `Selected model: ${data.connections.model}`
              : "Choose a model that supports structured outputs and compatible private endpoints."}
          </p>
          <div className="integration-details">
            <p>
              <Check size={15} /> No-collection and zero-retention provider filters
            </p>
            <p>
              <Check size={15} /> No automatic switching to a different model
            </p>
            <p>
              <Check size={15} /> Requests run on your server
            </p>
          </div>
          {!data.connections.openrouter && (
            <div className="notice small">
              In your server’s .env.local, set <strong>OPENROUTER_API_KEY</strong> and{" "}
              <strong>OPENROUTER_MODEL</strong>, then restart. Keep the key private.
            </div>
          )}
          <External href="https://openrouter.ai/settings/keys">OpenRouter API settings</External>
          <div className="usage-box">
            <span>Recorded AI charges this month</span>
            <strong>${cost.toFixed(4)}</strong>
            <small>
              {usage.length} requests ·{" "}
              {missing
                ? `${missing} with unavailable cost; total is incomplete`
                : "Charges reported by OpenRouter"}
            </small>
          </div>
        </section>
        <section className="panel settings-card">
          <div className="integration-title">
            <span className="round-icon">
              <Mail size={21} />
            </span>
            <div>
              <h2>Gmail</h2>
              <span className="small muted">Your account. Your approval.</span>
            </div>
            <Badge tone={data.connections.gmail ? "green" : "amber"}>
              {data.connections.gmail
                ? "Connected"
                : data.connections.gmailNeedsReconnect
                  ? "Reconnect"
                  : "Not connected"}
            </Badge>
          </div>
          <p className="muted">
            Create actual Gmail drafts, send reviewed messages, and check replies in your
            application threads.
          </p>
          <div className="integration-details">
            <p>
              <Check size={15} /> Draft and send permission
            </p>
            <p>
              <Check size={15} /> Read permission for tracked replies
            </p>
            <p>
              <ShieldCheck size={15} /> Google tokens encrypted locally
            </p>
          </div>
          {data.connections.gmail ? (
            <>
              <div className="connected-account">
                <Mail size={17} />
                {data.connections.gmailEmail}
              </div>
              <Button variant="ghost" disabled={!!busy} onClick={() => act("gmail.disconnect")}>
                Disconnect Gmail
              </Button>
            </>
          ) : (
            <>
              {!data.connections.googleConfigured && (
                <div className="notice small">
                  Set <strong>GOOGLE_CLIENT_ID</strong>, <strong>GOOGLE_CLIENT_SECRET</strong>, and{" "}
                  <strong>GOOGLE_ALLOWED_EMAIL</strong> in .env.local. The README includes the
                  Google Cloud setup.
                </div>
              )}
              {data.connections.googleConfigured ? (
                <a className="btn primary" href="/api/auth/google/start">
                  <Plug size={16} /> Connect Gmail <ArrowUpRight size={16} />
                </a>
              ) : (
                <Button disabled>
                  <Plug size={16} /> Connect Gmail
                </Button>
              )}
            </>
          )}
        </section>
      </div>
      <form className="panel settings-form" onSubmit={submit} key={JSON.stringify(options)}>
        <div className="section-heading">
          <div>
            <h2>Set a comfortable pace</h2>
            <p>Search automatically. Keep sending under your control.</p>
          </div>
        </div>
        <div className="form-body">
          <label className="toggle-row">
            <span>
              <strong>Check companies daily</strong>
              <small>Run daily through the scheduler, or while your workspace is open.</small>
            </span>
            <input type="checkbox" name="dailySearch" defaultChecked={options.dailySearch} />
          </label>
          <label className="toggle-row">
            <span>
              <strong>Pause automation and sending</strong>
              <small>Stop background checks and block send actions until you resume.</small>
            </span>
            <input
              type="checkbox"
              name="automationPaused"
              defaultChecked={options.automationPaused}
            />
          </label>
          <div className="form-grid three">
            <Field label="Emails per rolling 24 hours">
              <input
                name="dailySendLimit"
                type="number"
                min={1}
                max={50}
                defaultValue={options.dailySendLimit}
              />
            </Field>
            <Field label="Recorded AI spend limit (USD)">
              <input
                name="monthlyAiBudget"
                type="number"
                min={0.1}
                max={1000}
                step={0.1}
                defaultValue={options.monthlyAiBudget}
              />
            </Field>
            <Field label="Follow-up reminder after (days)">
              <input
                name="followUpDays"
                type="number"
                min={3}
                max={30}
                defaultValue={options.followUpDays}
              />
            </Field>
          </div>
          <p className="small muted">
            The AI limit uses reported charges and can be exceeded by an in-flight request. Set an
            OpenRouter key budget for an additional spending control. Follow-ups are prepared for
            review and never sent automatically.
          </p>
          <Button variant="primary" disabled={!!busy} busy={busy === "settings.save"}>
            <Save size={16} /> Save settings
          </Button>
        </div>
      </form>
    </>
  );
}
