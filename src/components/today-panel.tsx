"use client";
import type { AppState, Job } from "@/lib/types";
import { dailyJobs, followUpDue } from "@/lib/career-tools";
import { recommendationLabels } from "@/lib/job-preferences";
import type { Act } from "./workspace";
import { Badge, Button, External } from "./ui";

export function TodayPanel({
  data,
  act,
  busy,
  onJob,
  onEmail,
}: {
  data: AppState;
  act: Act;
  busy: string;
  onJob: (id: string) => void;
  onEmail: (id: string) => void;
}) {
  const jobs = dailyJobs(data),
    timestamp = Date.now();
  const active = data.jobs.filter(
    (j) => !["rejected", "withdrawn", "offer"].includes(j.applicationStatus),
  );
  const reminders = active.filter(
    (j) => j.application?.reminderAt && Date.parse(j.application.reminderAt) <= timestamp,
  );
  const interviews = active
    .filter(
      (j) =>
        j.application?.interviewAt &&
        Date.parse(j.application.interviewAt) >= timestamp &&
        Date.parse(j.application.interviewAt) < timestamp + 7 * 86400000,
    )
    .sort((a, b) => a.application!.interviewAt.localeCompare(b.application!.interviewAt));
  const followups = active
    .map((j) => ({ job: j, draft: followUpDue(data, j, timestamp) }))
    .filter((x) => x.draft);
  const pending = data.drafts.filter((d) =>
    ["draft", "gmail_draft", "approved"].includes(d.status),
  );
  const replies = data.drafts
    .filter((d) => d.replyStatus === "reply")
    .sort((a, b) => (b.lastReplyAt || "").localeCompare(a.lastReplyAt || ""))
    .slice(0, 5);
  const company = (j: Job) => data.companies.find((c) => c.id === j.companyId)?.name;
  return (
    <section className="today-grid" aria-label="Today's job search">
      <section className="panel today-jobs">
        <div className="section-heading">
          <div>
            <span className="eyebrow">YOUR NEXT FIVE</span>
            <h2>Today’s jobs</h2>
            <p>Ranked by preferences and fit, with newer listings first when scores tie.</p>
          </div>
        </div>
        {!jobs.length && (
          <p className="quiet-note">
            Check your companies or import a job to build today’s shortlist.
          </p>
        )}
        {jobs.map((job) => (
          <article className="today-job" key={job.id}>
            <div className="button-row">
              <Badge tone={job.match?.recommendation === "good" ? "green" : "neutral"}>
                {job.match
                  ? recommendationLabels[job.match.recommendation || "review"]
                  : "Confirm profile to match"}
              </Badge>
              <span className="small muted">
                {job.publishedAt ? "Published" : "First seen"}{" "}
                {new Date(job.publishedAt || job.createdAt).toLocaleDateString()}
              </span>
            </div>
            <button className="title-button" onClick={() => onJob(job.id)}>
              {job.title}
            </button>
            <p>
              {company(job)} · {job.location}
            </p>
            <p className="small muted">
              {job.match?.checks?.find((c) => c.status === "gap")?.detail ||
                job.match?.reasons[0] ||
                "Review the listing and compare it with your experience."}
            </p>
            <div className="button-row">
              <External href={job.applyUrl}>Apply</External>
              <Button
                disabled={!!busy}
                onClick={() =>
                  act("job.status", {
                    id: job.id,
                    status: job.status === "shortlisted" ? "new" : "shortlisted",
                  })
                }
              >
                {job.status === "shortlisted" ? "Saved ✓" : "Save job"}
              </Button>
              <Button
                variant="ghost"
                disabled={!!busy}
                onClick={() => act("job.status", { id: job.id, status: "skipped" })}
              >
                Not interested
              </Button>
              <Button variant="ghost" onClick={() => onJob(job.id)}>
                Details
              </Button>
            </div>
          </article>
        ))}
      </section>
      <section className="panel today-actions">
        <div className="section-heading">
          <div>
            <h2>Your next actions</h2>
            <p>
              {pending.length} emails to finish · {reminders.length} reminders due
            </p>
          </div>
        </div>
        {reminders.map((j) => (
          <article className="career-list-row" key={`r-${j.id}`}>
            <div>
              <Badge tone="amber">Reminder due</Badge>
              <p>
                <strong>{j.application?.nextAction || "Review application"}</strong>
                <br />
                {j.title} · {company(j)}
              </p>
            </div>
            <div className="button-row">
              <Button onClick={() => onJob(j.id)}>Open</Button>
              <Button
                disabled={!!busy}
                onClick={() =>
                  act("application.save", {
                    ...j.application,
                    id: j.id,
                    reminderAt: "",
                    nextAction: "",
                  })
                }
              >
                Done
              </Button>
            </div>
          </article>
        ))}
        {interviews.map((j) => (
          <article className="career-list-row" key={`i-${j.id}`}>
            <div>
              <Badge tone="green">Interview</Badge>
              <p>
                {j.title}
                <br />
                {new Date(j.application!.interviewAt).toLocaleString()}
              </p>
            </div>
            <Button onClick={() => onJob(j.id)}>Prepare</Button>
          </article>
        ))}
        {followups.map(({ job, draft }) => (
          <article className="career-list-row" key={`f-${job.id}`}>
            <div>
              <strong>Follow-up due</strong>
              <p>
                {job.title} · {company(job)}
              </p>
            </div>
            <Button
              disabled={!!busy}
              onClick={async () => {
                const r = await act("draft.followup", { id: draft!.id });
                if (r?.draftId) onEmail(r.draftId);
              }}
            >
              Prepare follow-up
            </Button>
          </article>
        ))}
        {pending.slice(0, 3).map((d) => (
          <article className="career-list-row" key={d.id}>
            <div>
              <strong>Finish your email</strong>
              <p>{d.subject || d.to || "New email"}</p>
            </div>
            <Button onClick={() => onEmail(d.id)}>Continue</Button>
          </article>
        ))}
        {!!replies.length && <h3>Recent replies</h3>}
        {replies.map((d) => (
          <article className="career-list-row" key={`reply-${d.id}`}>
            <div>
              <strong>{d.subject}</strong>
              <p className="small muted">
                {d.lastReplyAt && new Date(d.lastReplyAt).toLocaleString()}
              </p>
            </div>
            <External
              href={`https://mail.google.com/mail/u/${encodeURIComponent(d.gmailAccountEmail || data.connections.gmailEmail)}/#all/${encodeURIComponent(d.threadId || "")}`}
            >
              Read in Gmail
            </External>
          </article>
        ))}
        {!reminders.length &&
          !interviews.length &&
          !followups.length &&
          !pending.length &&
          !replies.length && (
            <p className="quiet-note">
              You’re up to date. Save a suitable job to take the next step.
            </p>
          )}
      </section>
    </section>
  );
}
