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
} from "lucide-react";
import type { AppState, Draft } from "@/lib/types";
import type { Act } from "./workspace";
import { Badge, Button, Empty, External, label, relative, allowNavigation } from "./ui";

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
  const draft = data.drafts.find((d) => d.id === selectedId) || data.drafts[0];
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">A GOOD FIRST IMPRESSION</span>
          <h1>Your experience. In your words.</h1>
          <p>Thoughtful emails for the opportunities that matter to you.</p>
        </div>
        <Badge tone="green">
          <ShieldCheck size={13} /> Approval before sending
        </Badge>
      </div>
      {!data.drafts.length ? (
        <div className="panel">
          <Empty
            title="Start a conversation worth having"
            description="Open a job and choose “Prepare email”. Your tailored application will be ready to review here."
          >
            <Button variant="primary" onClick={onFindJobs}>
              Find an opportunity <ArrowUpRight size={15} />
            </Button>
          </Empty>
        </div>
      ) : (
        <div className="email-layout">
          <aside className="email-list" aria-label="Application emails">
            <div className="email-list-heading">
              <strong>Your emails</strong>
              <Badge>{data.drafts.length}</Badge>
            </div>
            {data.drafts.map((d) => {
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
                    <strong>{company?.name}</strong>
                    <span className={`email-state-dot ${d.status}`} />
                  </span>
                  <span>{job?.title}</span>
                  <small>
                    {d.followUpOf ? "Follow-up · " : ""}
                    {label(d.status)} · {relative(d.updatedAt)}
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
    [reviewed, setReviewed] = useState(false);
  const company = data.companies.find((c) => c.id === draft.companyId),
    job = data.jobs.find((j) => j.id === draft.jobId);
  const locked = ["sent", "sending", "uncertain"].includes(draft.status);
  const inputsChanged =
    draft.profileUpdatedAt !== data.profile.updatedAt || draft.jobUpdatedAt !== job?.updatedAt;
  const dirty =
    !locked &&
    (inputsChanged ||
      to !== draft.to ||
      subject !== draft.subject ||
      body !== draft.body ||
      attach !== !!draft.resumeId);
  const words = body.trim() ? body.trim().split(/\s+/).length : 0;
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
            <Mail size={17} /> {draft.followUpOf ? "Follow-up email" : "Application email"}
          </span>
          <Badge
            tone={
              draft.status === "sent" ? "green" : draft.status === "uncertain" ? "amber" : "neutral"
            }
          >
            {dirty ? "Unsaved changes" : label(draft.status)}
          </Badge>
        </div>
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
            }}
            placeholder="Add a verified recruitment address"
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
          }}
          placeholder="Your introduction starts here. Write in your own words, or generate a personal draft with OpenRouter."
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
              }}
            />
            <Paperclip size={15} />
            <span>
              {(dirty ? data.profile.resumeName : draft.resumeName || data.profile.resumeName) ||
                "Upload a résumé in My profile"}
            </span>
          </label>
          <span className="small muted">{words} words</span>
        </div>
        {!locked && (
          <div className="writing-tools">
            {inputsChanged && (
              <p className="small notice amber">
                Your profile or this job changed. Review the email and current résumé, then save
                your edits before continuing.
              </p>
            )}
            <span className="small muted">
              <Sparkles size={14} /> Writing assistant
            </span>
            <div className="button-row">
              <Button
                variant="ghost"
                disabled={
                  !!busy ||
                  dirty ||
                  !data.connections.openrouter ||
                  !data.profile.confirmed ||
                  !!draft.followUpOf
                }
                busy={busy === "draft.generate"}
                onClick={() => act("draft.generate", { id: draft.id })}
              >
                {body ? "Regenerate" : "Generate email"}
              </Button>
              {body && (
                <>
                  <Button
                    variant="ghost"
                    disabled={!!busy || dirty || !data.connections.openrouter || !!draft.followUpOf}
                    onClick={() =>
                      act("draft.generate", {
                        id: draft.id,
                        style: "Make it shorter, around 90 words.",
                      })
                    }
                  >
                    Make shorter
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={!!busy || dirty || !data.connections.openrouter || !!draft.followUpOf}
                    onClick={() =>
                      act("draft.generate", {
                        id: draft.id,
                        style:
                          "Make the wording sound more natural and conversational, while staying professional.",
                      })
                    }
                  >
                    More natural
                  </Button>
                </>
              )}
            </div>
            {dirty && (
              <p className="small muted">
                Save your edits before asking for a rewrite or syncing to Gmail.
              </p>
            )}
            {!data.connections.openrouter && (
              <p className="small muted">
                Configure OpenRouter in Settings to generate emails. You can write and save an email
                manually.
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
              <strong>Sent through your Gmail</strong>
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
              {draft.status === "gmail_draft" && !dirty && (
                <label className="check-row review-check">
                  <input
                    type="checkbox"
                    checked={reviewed}
                    onChange={(e) => setReviewed(e.target.checked)}
                  />
                  <span>
                    I checked that the job is open and reviewed the recipient, factual claims, and
                    attachment.
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
                  disabled={!!busy || dirty || !body.trim() || !to || !data.connections.gmail}
                  busy={busy === "draft.gmail"}
                  onClick={() => act("draft.gmail", { id: draft.id })}
                >
                  <Mail size={15} /> Save to Gmail
                </Button>
                {draft.status === "approved" && !dirty ? (
                  <Button
                    variant="primary"
                    disabled={!!busy || data.settings.automationPaused}
                    busy={busy === "draft.send"}
                    onClick={() => act("draft.send", { id: draft.id })}
                  >
                    <Send size={15} /> Send approved email
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    disabled={!!busy || dirty || !reviewed || draft.status !== "gmail_draft"}
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
      </section>
      <aside className="email-context" aria-label="Email context">
        <section className="panel context-card">
          <span className="eyebrow">THE OPPORTUNITY</span>
          <h2>{job?.title}</h2>
          <p className="muted">{company?.name}</p>
          {job?.match && (
            <Badge tone={job.match.rating === "strong" ? "green" : "neutral"}>
              {job.match.score}% fit · {job.match.method === "ai" ? "AI analysis" : "Keyword match"}
            </Badge>
          )}
          <p className="small muted">{job?.location}</p>
          {job && <External href={job.url}>Read the original listing</External>}
        </section>
        <section className="panel context-card">
          <span className="eyebrow">RECIPIENT CHECK</span>
          <p className="small">
            {company?.contactSource || "Add where you found this recruitment address in Companies."}
          </p>
          <Badge tone={company?.contactConfirmed && to === company.email ? "green" : "amber"}>
            {company?.contactConfirmed && to === company.email
              ? "Contact checked by you"
              : "Review recipient"}
          </Badge>
          <p className="small muted">
            An address must be suitable for recruitment. The AI does not invent contacts.
          </p>
        </section>
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
              Supporting profile quotes will appear here after AI generation. Review all claims,
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
      </aside>
    </div>
  );
}
