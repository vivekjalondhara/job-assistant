"use client";
import { useState } from "react";
import type { AppState, Profile } from "@/lib/types";
import { defaultPreferences } from "@/lib/types";
import { employmentTypes, seniorities, workplaces } from "@/lib/job-preferences";
import type { Act } from "./workspace";
import { Badge, Button, Modal } from "./ui";

export function CareerPreferences({ profile }: { profile: Profile }) {
  const p = { ...defaultPreferences, ...profile.preferences };
  return (
    <>
      <div className="form-section-title">
        <h2>Your job requirements</h2>
        <p>Leave uncertain details blank. Salary preferences use annual pay before tax.</p>
      </div>
      <div className="form-grid">
        <label>
          Years of experience
          <input
            name="experienceYears"
            type="number"
            min={0}
            max={60}
            step={0.5}
            defaultValue={p.experienceYears ?? ""}
          />
        </label>
        <label>
          Target level
          <select name="seniority" defaultValue={p.seniority}>
            <option value="">Any / not set</option>
            {seniorities.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Countries where you can work
          <input
            name="workCountries"
            defaultValue={p.workCountries.join(", ")}
            placeholder="India, Canada"
          />
          <small className="field-hint">
            Separate countries with commas; include only places where you are eligible to work.
          </small>
        </label>
        <label>
          Employment type
          <select name="employmentType" defaultValue={p.employmentType}>
            <option value="">Any</option>
            {employmentTypes.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Work arrangement
          <select name="workplace" defaultValue={p.workplace}>
            <option value="">Any</option>
            {workplaces.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Minimum annual salary
          <input
            name="salaryMin"
            type="number"
            min={0}
            max={1e9}
            defaultValue={p.salaryMin ?? ""}
          />
        </label>
        <label>
          Salary currency
          <select name="salaryCurrency" defaultValue={p.salaryCurrency}>
            {[...new Set([p.salaryCurrency, "INR", "USD", "EUR", "GBP", "CAD", "AUD", "SGD"])].map(
              (v) => (
                <option key={v}>{v}</option>
              ),
            )}
          </select>
        </label>
      </div>
    </>
  );
}

export function ResumeLibrary({
  data,
  act,
  busy,
  upload,
}: {
  data: AppState;
  act: Act;
  busy: string;
  upload: (file: File, previousId?: string) => Promise<void>;
}) {
  const [deleting, setDeleting] = useState<string | null>(null);
  const defaultId = data.profile.defaultResumeId ?? data.profile.resumeId;
  const resumes = data.resumes || [];
  if (!resumes.length) return null;
  return (
    <section className="panel resume-library">
      <h2>My résumés</h2>
      <p className="small muted">
        Keep one version per target role. Choose the attachment in each email; uploading another
        version keeps earlier files and your current default.
      </p>
      {resumes.map((resume) => (
        <form
          className="career-form resume-version"
          key={`${resume.id}:${resume.label}:${resume.targetRole}`}
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            await act("resume.label", {
              id: resume.id,
              label: f.get("label"),
              targetRole: f.get("targetRole"),
            });
          }}
        >
          <a href={`/api/resume/${resume.id}`} target="_blank" rel="noopener noreferrer">
            {resume.name}
          </a>
          {resume.id === data.profile.resumeId && <Badge>Profile source</Badge>}
          {resume.id === defaultId && <Badge tone="green">Default attachment</Badge>}
          <p className="small muted">
            Version {resume.version || 1} · {new Date(resume.createdAt).toLocaleDateString()} ·{" "}
            {Math.ceil((resume.size || 0) / 1024)} KB
          </p>
          <label>
            Version name
            <input
              name="label"
              defaultValue={resume.label || ""}
              maxLength={100}
              placeholder="Frontend résumé"
            />
          </label>
          <label>
            Target role
            <input
              name="targetRole"
              defaultValue={resume.targetRole || ""}
              maxLength={120}
              placeholder="React developer"
            />
          </label>
          <div className="button-row">
            {resume.id !== defaultId && (
              <Button
                type="button"
                disabled={!!busy}
                onClick={() => act("resume.default", { id: resume.id })}
              >
                Make default
              </Button>
            )}
            <label className="btn secondary file-button">
              Upload new version
              <input
                type="file"
                accept=".pdf,.docx,.txt"
                disabled={!!busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void upload(file, resume.id);
                  e.target.value = "";
                }}
              />
            </label>
            <Button type="button" disabled={!!busy} onClick={() => setDeleting(resume.id)}>
              Delete
            </Button>
            <Button type="submit" disabled={!!busy}>
              Save details
            </Button>
            {resume.id !== data.profile.resumeId && (
              <Button
                type="button"
                disabled={!!busy}
                onClick={() => act("resume.select", { id: resume.id })}
              >
                Use for profile
              </Button>
            )}
          </div>
        </form>
      ))}
      {deleting && (
        <Modal title="Delete résumé?" onClose={() => !busy && setDeleting(null)}>
          <p>
            The uploaded file and its extracted text will be removed. Unsent emails using it will
            lose their attachment and approval. Sent email history and messages already in Gmail
            remain.
          </p>
          <p>If this is your default, choose another résumé before your next application.</p>
          <Button
            variant="primary"
            disabled={!!busy}
            onClick={async () => {
              if (await act("resume.delete", { id: deleting })) setDeleting(null);
            }}
          >
            Delete résumé
          </Button>
        </Modal>
      )}
    </section>
  );
}

export function ResumesPanel(props: {
  data: AppState;
  act: Act;
  busy: string;
  upload: (file: File, previousId?: string) => Promise<void>;
}) {
  return (
    <section>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR EXPERIENCE, EVERY VERSION</span>
          <h1>My résumés.</h1>
          <p>Keep a résumé for each target role and choose the right one for every application.</p>
        </div>
      </div>
      <section className="panel resume-library">
        <h2>Add résumés</h2>
        <p>
          PDF, DOCX, or TXT, up to 4 MB each. You can select several files. Additional uploads
          preserve your profile and default attachment.
        </p>
        <label className="btn primary file-button">
          {props.busy === "upload" ? "Uploading…" : "Upload résumés"}
          <input
            type="file"
            accept=".pdf,.docx,.txt"
            multiple
            disabled={!!props.busy}
            onChange={async (e) => {
              const files = Array.from(e.target.files || []);
              e.target.value = "";
              for (const file of files) await props.upload(file);
            }}
          />
        </label>
        {props.data.account && (
          <p className="small muted">
            Storage allowance: {props.data.account.limits.storageMb} MB. Contact your administrator
            if you need more.
          </p>
        )}
      </section>
      <ResumeLibrary {...props} />
    </section>
  );
}
