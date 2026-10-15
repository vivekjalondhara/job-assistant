"use client";
import { useEffect, useState } from "react";
import {
  Mail,
  Sparkles,
  Paperclip,
  Save,
  Send,
  ShieldCheck,
  ArrowUpRight,
  Check,
  CircleAlert,
  FileCheck2,
  Copy,
  Download,
  Plus,
} from "lucide-react";
import type { AppState, Draft, EnglishSuggestion } from "@/lib/types";
import type { Act } from "./workspace";
import { Badge, Button, Empty, External, label, relative, allowNavigation } from "./ui";
import { applicationChecks, contentChecks, draftInputsChanged } from "@/lib/email-checks";
import { EmailPreview } from "./email-preview";

export function EmailPanel({
  data,
  selectedId,
  setSelectedId,
  act,
  busy,
  onFindJobs,
}: {
  data: AppState;
  selectedId: string | null;
  setSelectedId: (id: string) => void;
  act: Act;
  busy: string;
  onFindJobs: () => void;
}) {
  const [folder, setFolder] = useState<"all" | "drafts" | "sent">("all");
  const sentCount = data.drafts.filter((d) => d.status === "sent").length;
  const emails = data.drafts
    .filter(
      (d) => folder === "all" || (folder === "sent" ? d.status === "sent" : d.status !== "sent"),
    )
    .sort((a, b) => (b.sentAt || b.updatedAt).localeCompare(a.sentAt || a.updatedAt));
  const draft = emails.find((d) => d.id === selectedId) || emails[0];
  async function newEmail() {
    if (!allowNavigation()) return;
    const result = await act("draft.direct");
    if (result?.draftId) {
      setFolder("all");
      setSelectedId(result.draftId);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">A GOOD FIRST IMPRESSION</span>
          <h1>Your experience. In your words.</h1>
          <p>Write directly to an email address or prepare an application from a job.</p>
        </div>
        <div className="button-row">
          <Badge tone="green">
            <ShieldCheck size={13} /> Approval before sending
          </Badge>
          <Button
            variant="primary"
            disabled={!!busy}
            busy={busy === "draft.direct"}
            onClick={newEmail}
          >
            <Plus size={16} /> New email
          </Button>
        </div>
      </div>
      <div className="email-folders">
        <div className="tabs" aria-label="Filter emails">
          {(
            [
              ["all", "All emails", data.drafts.length],
              ["drafts", "Drafts & pending", data.drafts.length - sentCount],
              ["sent", "Sent", sentCount],
            ] as const
          ).map(([value, title, count]) => (
            <button
              key={value}
              className={folder === value ? "active" : ""}
              aria-pressed={folder === value}
              onClick={() => {
                if (allowNavigation()) setFolder(value);
              }}
            >
              {title} <span>{count}</span>
            </button>
          ))}
        </div>
        <p className="small muted">Sent shows emails sent through Folio.</p>
      </div>
      {!data.drafts.length ? (
        <div className="panel">
          <Empty
            title="Start a conversation worth having"
            description="Choose “New email” to enter a recipient and write your message. No company or job is required. You can also prepare an application from a job."
          >
            <Button variant="primary" onClick={onFindJobs}>
              Find an opportunity <ArrowUpRight size={15} />
            </Button>
          </Empty>
        </div>
      ) : !emails.length ? (
        <div className="panel">
          <Empty
            title={folder === "sent" ? "No sent emails yet" : "No drafts waiting"}
            description={
              folder === "sent"
                ? "After you review, approve, and send an email, its message and attachment details will appear here."
                : "Choose “New email” or prepare an application from a job."
            }
          />
        </div>
      ) : (
        <div className="email-layout">
          <aside className="email-list" aria-label="Emails">
            <div className="email-list-heading">
              <strong>Your emails</strong>
              <Badge>{emails.length}</Badge>
            </div>
            {emails.map((d) => {
              const company = data.companies.find((c) => c.id === d.companyId);
              const job = data.jobs.find((j) => j.id === d.jobId);
              return (
                <button
                  key={d.id}
                  className={`email-list-item ${draft?.id === d.id ? "active" : ""}`}
                  onClick={() => {
                    if (allowNavigation()) setSelectedId(d.id);
                  }}
                >
                  <span className="email-item-top">
                    <strong>{d.kind === "direct" ? d.to || "New email" : company?.name}</strong>
                    <span className={`email-state-dot ${d.status}`} />
                  </span>
                  <span>{d.kind === "direct" ? d.subject || "No subject yet" : job?.title}</span>
                  <small>
                    {d.followUpOf ? "Follow-up · " : ""}
                    {label(d.status)} · {relative(d.sentAt || d.updatedAt)}
                  </small>
                </button>
              );
            })}
          </aside>
          {draft && (
            <Composer
              key={`${draft.id}:${draft.version}:${draft.status}`}
              draft={draft}
              data={data}
              act={act}
              busy={busy}
            />
          )}
        </div>
      )}
    </>
  );
}
function Composer({
  draft,
  data,
  act,
  busy,
}: {
  draft: Draft;
  data: AppState;
  act: Act;
  busy: string;
}) {
  const [to, setTo] = useState(draft.to),
    [subject, setSubject] = useState(draft.subject),
    [body, setBody] = useState(draft.body),
    [attach, setAttach] = useState(!!draft.resumeId),
    [reviewed, setReviewed] = useState(false),
    [instructions, setInstructions] = useState(draft.writingInstructions || ""),
    [exportNotice, setExportNotice] = useState(""),
    [showPreview, setShowPreview] = useState(false),
    [suggestion, setSuggestion] = useState<EnglishSuggestion | null>(null);
  const company = data.companies.find((c) => c.id === draft.companyId),
    job = data.jobs.find((j) => j.id === draft.jobId);
  const direct = draft.kind === "direct";
  const locked = ["sent", "sending", "uncertain"].includes(draft.status);
  const inputsChanged = draftInputsChanged(draft, data.profile, job);
  const edited =
    !locked &&
    (to !== draft.to ||
      subject !== draft.subject ||
      body !== draft.body ||
      attach !== !!draft.resumeId);
  const dirty = !locked && (inputsChanged || edited);
  const words = body.trim() ? body.trim().split(/\s+/).length : 0;
  const preview = {
    ...draft,
    to,
    subject,
    body,
    resumeId: attach ? (dirty ? data.profile.resumeId : draft.resumeId) : "",
  };
  const checks = applicationChecks(preview, data.profile, job, company);
  const senderMatches =
    !!data.connections.gmail &&
    draft.gmailAccountEmail === data.connections.gmailEmail.toLowerCase();
  if (data.connections.gmail && draft.gmailDraftId && !senderMatches)
    checks.push({
      id: "gmail-account",
      status: "error",
      message:
        "Save to the connected Gmail account, then review and approve again. The existing Gmail draft belongs to another account or needs its sender verified.",
    });
  const issues = checks.filter((check) => check.status !== "pass");
  const hasErrors = issues.some((check) => check.status === "error");
  const invalidContent = contentChecks(preview).some((check) => check.status === "error");
  const exportText = `To: ${to}\nSubject: ${subject}\n\n${body}`;
  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(exportText);
      setExportNotice("Email copied. Attach your résumé separately when sending elsewhere.");
    } catch {
      setExportNotice("Clipboard access was unavailable. Use Download text instead.");
    }
  }
  function downloadEmail() {
    const url = URL.createObjectURL(new Blob([exportText], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = direct ? "email.txt" : "application-email.txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExportNotice("Email downloaded. Attach your résumé separately when sending elsewhere.");
  }
  const save = () =>
    act("draft.save", {
      id: draft.id,
      version: draft.version,
      to,
      subject,
      body,
      attachResume: attach,
    });
  useEffect(() => {
    function beforeUnload(e: BeforeUnloadEvent) {
      if (dirty) e.preventDefault();
    }
    function navigate(e: Event) {
      if (dirty && !window.confirm("Leave this email without saving your changes?"))
        e.preventDefault();
    }
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("folio:before-navigate", navigate);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("folio:before-navigate", navigate);
    };
  }, [dirty]);
  return (
    <div className="composer-area">
      <section className="composer panel">
        <div className="composer-heading">
          <span>
            <Mail size={17} />{" "}
            {draft.followUpOf ? "Follow-up email" : direct ? "Direct email" : "Application email"}
          </span>
          <Badge
            tone={
              draft.status === "sent" ? "green" : draft.status === "uncertain" ? "amber" : "neutral"
            }
          >
            {dirty ? "Unsaved changes" : label(draft.status)}
          </Badge>
        </div>
        {!locked && (
          <div className="email-view-switch" aria-label="Email view">
            <Button
              variant="ghost"
              aria-pressed={!showPreview}
              onClick={() => setShowPreview(false)}
            >
              Edit email
            </Button>
            <Button variant="ghost" aria-pressed={showPreview} onClick={() => setShowPreview(true)}>
              Preview email
            </Button>
          </div>
        )}
        {locked || showPreview ? (
          <EmailPreview
            to={to}
            subject={subject}
            body={body}
            resumeName={
              preview.resumeId ? (dirty ? data.profile.resumeName : draft.resumeName) : undefined
            }
            sentAt={draft.status === "sent" ? draft.sentAt : null}
          />
        ) : (
          <>
            <label className="compose-field">
              <span>To</span>
              <input
                type="email"
                aria-label="Recipient email"
                value={to}
                disabled={locked || !!busy}
                onChange={(e) => {
                  setTo(e.target.value);
                  setReviewed(false);
                  setSuggestion(null);
                }}
                placeholder={
                  direct ? "recipient@example.com" : "Add a verified recruitment address"
                }
                autoFocus={direct && !draft.to}
              />
            </label>
            <label className="compose-field">
              <span>Subject</span>
              <input
                aria-label="Email subject"
                value={subject}
                disabled={locked || !!busy}
                onChange={(e) => {
                  setSubject(e.target.value);
                  setReviewed(false);
                  setSuggestion(null);
                }}
              />
            </label>
            <textarea
              className="compose-body"
              aria-label="Email message"
              value={body}
              disabled={locked || !!busy}
              onChange={(e) => {
                setBody(e.target.value);
                setReviewed(false);
                setSuggestion(null);
              }}
              placeholder={
                direct
                  ? "Write your message here."
                  : "Write your introduction, use your confirmed profile to draft locally, or ask AI to tailor it."
              }
            />
            <div className="compose-bottom">
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={attach}
                  disabled={locked || !!busy || !data.profile.resumeId}
                  onChange={(e) => {
                    setAttach(e.target.checked);
                    setReviewed(false);
                    setSuggestion(null);
                  }}
                />
                <Paperclip size={15} />
                <span>
                  {(dirty
                    ? data.profile.resumeName
                    : draft.resumeName || data.profile.resumeName) ||
                    "Upload a résumé in My profile"}
                </span>
              </label>
              <span className="small muted">{words} words</span>
            </div>
          </>
        )}
        {!locked && (
          <div className="writing-tools">
            {inputsChanged && (
              <p className="small notice amber">
                {direct
                  ? "Your profile or résumé changed. Review the attachment and save your edits before continuing."
                  : "Your profile or this job changed. Review the email and current résumé, then save your edits, or regenerate from the current profile before continuing."}
              </p>
            )}
            <span className="small muted">
              <Sparkles size={14} /> Writing assistant
            </span>
            {!direct && (
              <label className="writing-brief">
                <span>Writing instructions for AI drafts (optional)</span>
                <textarea
                  value={instructions}
                  onChange={(event) => setInstructions(event.target.value)}
                  maxLength={1000}
                  rows={3}
                  disabled={!!busy || !!draft.followUpOf}
                  placeholder="For example: Keep it under 120 words. Focus on my API project. Use a concise, friendly tone."
                />
              </label>
            )}
            <p className="small muted">
              {direct
                ? "Write your message and save it. Improve English can help with grammar and phrasing."
                : "Draft generation uses your saved job and confirmed profile. Improve English edits the saved email. Review every factual claim before sending."}
            </p>
            <div className="button-row">
              <Button
                variant="ghost"
                disabled={
                  !!busy ||
                  dirty ||
                  !data.connections.openrouter ||
                  body.trim().length < 20 ||
                  body.length > 8000
                }
                busy={busy === "draft.polish"}
                onClick={async () => {
                  const result = await act("draft.polish", {
                    id: draft.id,
                    version: draft.version,
                  });
                  if (result?.suggestion) setSuggestion(result.suggestion);
                }}
              >
                <Sparkles size={14} /> Improve English
              </Button>
              {!direct && (
                <>
                  <Button
                    variant="ghost"
                    disabled={
                      !!busy ||
                      edited ||
                      !data.profile.confirmed ||
                      !!draft.followUpOf ||
                      job?.status === "closed"
                    }
                    busy={busy === "draft.template"}
                    onClick={() => {
                      if (
                        !body.trim() ||
                        window.confirm(
                          "Replace this saved email with a new draft from your profile?",
                        )
                      )
                        act("draft.template", { id: draft.id, version: draft.version });
                    }}
                  >
                    Write from my profile
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={
                      !!busy ||
                      edited ||
                      !data.connections.openrouter ||
                      !data.profile.confirmed ||
                      !!draft.followUpOf ||
                      job?.status === "closed"
                    }
                    busy={busy === "draft.generate"}
                    onClick={() => {
                      if (
                        !body.trim() ||
                        window.confirm("Replace this saved email with an AI draft?")
                      )
                        act("draft.generate", {
                          id: draft.id,
                          version: draft.version,
                          style: instructions,
                        });
                    }}
                  >
                    {body ? "Rewrite with AI" : "Generate with AI"}
                  </Button>
                  {body && (
                    <>
                      <Button
                        variant="ghost"
                        disabled={
                          !!busy || dirty || !data.connections.openrouter || !!draft.followUpOf
                        }
                        onClick={() =>
                          act("draft.generate", {
                            id: draft.id,
                            version: draft.version,
                            style: `${instructions.slice(0, 850)}\nMake it shorter, around 90 words.`,
                          })
                        }
                      >
                        Make shorter
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={
                          !!busy || dirty || !data.connections.openrouter || !!draft.followUpOf
                        }
                        onClick={() =>
                          act("draft.generate", {
                            id: draft.id,
                            version: draft.version,
                            style: `${instructions.slice(0, 850)}\nMake the wording sound more natural and conversational, while staying professional.`,
                          })
                        }
                      >
                        More natural
                      </Button>
                    </>
                  )}
                </>
              )}
            </div>
            <p className="small muted">
              Improve English checks grammar, spelling, and phrasing. You review the suggestion
              before using it. Your subject stays the same.
            </p>
            {body.length > 8000 && (
              <p className="small muted">
                Shorten this email to 8,000 characters or fewer to use Improve English.
              </p>
            )}
            {suggestion && (
              <section className="english-suggestion" aria-label="English suggestion">
                <h3>Review the improved English</h3>
                <details>
                  <summary>Compare with your current wording</summary>
                  <div className="email-preview-body">{body}</div>
                </details>
                <div className="email-preview-body">{suggestion.body}</div>
                {suggestion.changes.length > 0 && (
                  <ul>
                    {suggestion.changes.map((change, index) => (
                      <li key={index}>{change}</li>
                    ))}
                  </ul>
                )}
                <p className="small muted">
                  Check that the meaning and every fact are still correct. Using this version
                  updates the editor; save your edits before approval.
                </p>
                <div className="button-row">
                  <Button
                    variant="primary"
                    disabled={!!busy}
                    onClick={() => {
                      setBody(suggestion.body);
                      setReviewed(false);
                      setSuggestion(null);
                      setShowPreview(false);
                    }}
                  >
                    Use improved version
                  </Button>
                  <Button disabled={!!busy} onClick={() => setSuggestion(null)}>
                    Keep my wording
                  </Button>
                </div>
              </section>
            )}
            {edited && (
              <p className="small muted">
                Save your edits before using the writing assistant or syncing to Gmail.
              </p>
            )}
            {!data.connections.openrouter && (
              <p className="small muted">
                {direct
                  ? "Configure OpenRouter in Settings to use Improve English. You can write and send emails without it."
                  : "Write from your profile without an API key. Configure OpenRouter in Settings for AI rewriting and custom instructions."}
              </p>
            )}
          </div>
        )}
        {draft.status === "uncertain" && (
          <div className="notice amber">
            <CircleAlert size={18} />
            <span>
              The send result is uncertain. Check Gmail Sent before taking any further action.
              Automatic retries are blocked.
            </span>
          </div>
        )}
        {draft.status === "sent" ? (
          <div className="sent-confirmation">
            <Check size={20} />
            <div>
              <strong>Sent through {draft.gmailAccountEmail || "your Gmail"}</strong>
              <p>
                {draft.sentAt ? new Date(draft.sentAt).toLocaleString("en-US") : ""} ·{" "}
                {draft.replyStatus === "none" ? "No reply detected yet" : label(draft.replyStatus)}
              </p>
            </div>
            <External href="https://mail.google.com/mail/u/0/#sent">Open Sent</External>
          </div>
        ) : (
          !locked && (
            <div className="composer-actions">
              <p className="small muted">
                {data.connections.gmail
                  ? `Save to Gmail as: ${data.connections.gmailEmail}`
                  : "Connect Gmail in Settings to choose your sender."}
              </p>
              {draft.status === "gmail_draft" && !dirty && (
                <label className="check-row review-check">
                  <input
                    type="checkbox"
                    checked={reviewed}
                    onChange={(e) => setReviewed(e.target.checked)}
                  />
                  <span>
                    {direct
                      ? "I reviewed the recipient email address, message, and any attachment."
                      : "I checked that the job is open and reviewed the recipient, factual claims, and attachment."}
                  </span>
                </label>
              )}
              <div className="button-row">
                <Button
                  disabled={!!busy || !dirty || !body.trim()}
                  onClick={save}
                  busy={busy === "draft.save"}
                >
                  <Save size={15} /> Save edits
                </Button>
                <Button
                  disabled={!!busy || dirty || invalidContent || !data.connections.gmail}
                  busy={busy === "draft.gmail"}
                  onClick={() => act("draft.gmail", { id: draft.id })}
                >
                  <Mail size={15} /> Save to Gmail
                </Button>
                {draft.status === "approved" && !dirty ? (
                  <Button
                    variant="primary"
                    disabled={
                      !!busy ||
                      hasErrors ||
                      !senderMatches ||
                      !data.connections.gmail ||
                      data.settings.automationPaused
                    }
                    busy={busy === "draft.send"}
                    onClick={() => act("draft.send", { id: draft.id })}
                  >
                    <Send size={15} /> Send approved email
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    disabled={
                      !!busy ||
                      dirty ||
                      hasErrors ||
                      !senderMatches ||
                      !reviewed ||
                      draft.status !== "gmail_draft"
                    }
                    busy={busy === "draft.approve"}
                    onClick={() =>
                      act("draft.approve", { id: draft.id, version: draft.version, reviewed })
                    }
                  >
                    <ShieldCheck size={15} /> Approve this draft
                  </Button>
                )}
              </div>
              {draft.gmailDraftId && (
                <a
                  className="text-link small"
                  href="https://mail.google.com/mail/u/0/#drafts"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open Gmail Drafts <ArrowUpRight size={13} />
                </a>
              )}
            </div>
          )
        )}
        <div className="email-export">
          <div className="button-row">
            <Button disabled={!body.trim()} onClick={copyEmail}>
              <Copy size={15} /> Copy email
            </Button>
            <Button disabled={!body.trim()} onClick={downloadEmail}>
              <Download size={15} /> Download text
            </Button>
          </div>
          {exportNotice && (
            <p className="small muted" role="status">
              {exportNotice}
            </p>
          )}
        </div>
      </section>
      <aside className="email-context" aria-label="Email context">
        {!locked && (
          <section className="panel context-card" aria-label="Email checks">
            <span className="eyebrow">BEFORE YOU SEND</span>
            <p>
              <Badge tone={hasErrors ? "amber" : "green"}>
                {hasErrors ? "Needs attention" : "Content checks passed"}
              </Badge>
            </p>
            {issues.length ? (
              <ul className="draft-checks">
                {issues.map((check) => (
                  <li key={check.id}>
                    <strong>{check.status === "error" ? "Fix" : "Review"}:</strong> {check.message}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="small">
                {direct
                  ? "Content checks passed. Review the recipient, message, and any attachment before sending."
                  : "Automated checks passed. Read every claim and confirm the job is still open."}
              </p>
            )}
            {!data.connections.gmail && (
              <p className="small muted">
                Connect Gmail in Settings to save, approve, and send. You can copy or download this
                draft now.
              </p>
            )}
            {dirty && <p className="small muted">Save your edits before approval.</p>}
            <p className="small muted">
              These checks cannot verify every claim or guarantee email delivery.
            </p>
          </section>
        )}
        {!direct && (
          <section className="panel context-card">
            <span className="eyebrow">THE OPPORTUNITY</span>
            <h2>{job?.title}</h2>
            <p className="muted">{company?.name}</p>
            {job?.match && (
              <Badge tone={job.match.rating === "strong" ? "green" : "neutral"}>
                {job.match.score}% fit ·{" "}
                {job.match.method === "ai" ? "AI analysis" : "Keyword match"}
              </Badge>
            )}
            <p className="small muted">{job?.location}</p>
            {job && <External href={job.url}>Read the original listing</External>}
          </section>
        )}
        <section className="panel context-card">
          <span className="eyebrow">RECIPIENT CHECK</span>
          <p className="small">
            {direct
              ? to || "Enter the recipient’s email address in To."
              : company?.contactSource ||
                "Add where you found this recruitment address in Companies."}
          </p>
          {!direct && (
            <Badge tone={company?.contactConfirmed && to === company.email ? "green" : "amber"}>
              {company?.contactConfirmed && to === company.email
                ? "Contact checked by you"
                : "Review recipient"}
            </Badge>
          )}
          <p className="small muted">
            {direct
              ? "Check the address carefully before sending. No company or job is required."
              : "An address must be suitable for recruitment. The AI does not invent contacts."}
          </p>
        </section>
        {!direct && (
          <section className="panel context-card">
            <span className="eyebrow">GROUNDED IN YOUR EXPERIENCE</span>
            {draft.evidence.length ? (
              draft.evidence.map((e, i) => (
                <div className="evidence" key={i}>
                  <FileCheck2 size={16} />
                  <p>{e}</p>
                </div>
              ))
            ) : (
              <p className="small muted">
                Supporting profile quotes will appear here after generation. Review all claims,
                including manual edits.
              </p>
            )}
            {draft.reviewNotes.length > 0 && (
              <div className="review-notes">
                <strong>Things to review</strong>
                {draft.reviewNotes.map((n, i) => (
                  <p key={i}>{n}</p>
                ))}
              </div>
            )}
            <span className="small muted">
              {draft.model === "Manual" ? "Written by you" : `Written with ${draft.model}`}
            </span>
          </section>
        )}
      </aside>
    </div>
  );
}
