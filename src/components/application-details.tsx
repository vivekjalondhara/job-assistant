"use client";
import type { AppState, Job } from "@/lib/types";
import type { Act } from "./workspace";
import { Button, label } from "./ui";

function localDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export function ApplicationDetailsForm({
  job,
  data,
  act,
  busy,
}: {
  job: Job;
  data: AppState;
  act: Act;
  busy: string;
}) {
  const a = job.application;
  return (
    <details className="application-details" open={job.applicationStatus !== "not_submitted"}>
      <summary>Application notes & reminders</summary>
      <form
        className="career-form"
        key={`${job.id}:${JSON.stringify(a)}`}
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const date = (key: string) =>
            f.get(key) ? new Date(String(f.get(key))).toISOString() : "";
          await act("application.save", {
            id: job.id,
            status: f.get("status"),
            submittedAt: date("submittedAt"),
            interviewAt: date("interviewAt"),
            reminderAt: date("reminderAt"),
            recruiterName: f.get("recruiterName"),
            recruiterEmail: f.get("recruiterEmail"),
            notes: f.get("notes"),
            nextAction: f.get("nextAction"),
            resumeId: f.get("resumeId"),
          });
        }}
      >
        <p className="small muted">
          Times use your device’s time zone. Reminders appear on Today’s jobs when due.
        </p>
        <div className="form-grid">
          <label>
            Formal application status
            <select name="status" defaultValue={job.applicationStatus}>
              {["not_submitted", "submitted", "interview", "offer", "rejected", "withdrawn"].map(
                (s) => (
                  <option key={s} value={s}>
                    {label(s)}
                  </option>
                ),
              )}
            </select>
          </label>
          <label>
            Application submitted
            <input
              name="submittedAt"
              type="datetime-local"
              defaultValue={localDate(a?.submittedAt)}
            />
          </label>
          <label>
            Interview date & time
            <input
              name="interviewAt"
              type="datetime-local"
              defaultValue={localDate(a?.interviewAt)}
            />
          </label>
          <label>
            Recruiter name
            <input name="recruiterName" maxLength={160} defaultValue={a?.recruiterName || ""} />
          </label>
          <label>
            Recruiter email
            <input name="recruiterEmail" type="email" defaultValue={a?.recruiterEmail || ""} />
          </label>
          <label>
            Next action
            <input
              name="nextAction"
              maxLength={500}
              defaultValue={a?.nextAction || ""}
              placeholder="Complete the take-home assignment"
            />
          </label>
          <label>
            Remind me at
            <input
              name="reminderAt"
              type="datetime-local"
              defaultValue={localDate(a?.reminderAt)}
            />
          </label>
        </div>
        <label>
          Résumé for this application
          <select name="resumeId" defaultValue={a?.resumeId || ""}>
            <option value="">Choose when composing</option>
            {a?.resumeId && !data.resumes?.some((r) => r.id === a.resumeId) && (
              <option value={a.resumeId}>{a.resumeName || "Previous résumé"} (file deleted)</option>
            )}
            {(data.resumes || []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.label || r.name}
              </option>
            ))}
          </select>
          <small className="field-hint">
            Used for new application drafts. Change an existing draft’s attachment in Email studio.
          </small>
        </label>
        <label>
          Application notes
          <textarea name="notes" rows={4} maxLength={10000} defaultValue={a?.notes || ""} />
        </label>
        <Button type="submit" disabled={!!busy} variant="primary">
          Save application details
        </Button>
        {!!a?.history.length && (
          <div>
            <h4>Status history</h4>
            <ul>
              {a.history.map((h, i) => (
                <li key={`${h.at}:${i}`}>
                  {label(h.status)} · {new Date(h.at).toLocaleString()}
                </li>
              ))}
            </ul>
          </div>
        )}
      </form>
    </details>
  );
}
