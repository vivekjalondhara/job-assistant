"use client";
import { useState } from "react";
import type { JobImportPreview } from "@/lib/types";
import { employmentTypes, seniorities, workplaces } from "@/lib/job-preferences";
import type { Act } from "./workspace";
import { Button } from "./ui";

export function JobImportPanel({
  act,
  busy,
  onImported,
}: {
  act: Act;
  busy: string;
  onImported: (id: string) => void;
}) {
  const [url, setUrl] = useState(""),
    [description, setDescription] = useState(""),
    [preview, setPreview] = useState<JobImportPreview | null>(null);
  return (
    <div className="modal-form">
      <p>
        Paste an Ashby, Greenhouse, or Lever job link. For other sites, paste the job description
        too. Review the company and requirements before saving.
      </p>
      <form
        className="career-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setPreview(null);
          const result = await act("job.preview", { url, description });
          if (result?.preview) setPreview(result.preview);
        }}
      >
        <label>
          Job link
          <input
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setPreview(null);
            }}
            placeholder="https://…"
          />
        </label>
        <label>
          Job description
          <textarea
            rows={5}
            maxLength={50000}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setPreview(null);
            }}
            placeholder="Paste the title on the first line, followed by the full description."
          />
        </label>
        <Button
          type="submit"
          disabled={!!busy || (!url && description.trim().length < 30)}
          busy={busy === "job.preview"}
        >
          Preview job
        </Button>
      </form>
      {preview && (
        <form
          className="career-form import-preview"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const value = (name: string) => String(f.get(name) || "");
            const number = (name: string) => (value(name) === "" ? null : Number(value(name)));
            const result = await act("job.import", {
              ...preview,
              companyName: value("companyName"),
              title: value("title"),
              location: value("location"),
              description: value("description"),
              applyUrl: value("applyUrl"),
              remote: value("workplace") === "remote",
              salary: value("salary"),
              requirements: {
                ...preview.requirements,
                experienceMin: number("experienceMin"),
                seniority: value("seniority"),
                eligibleCountries: value("eligibleCountries")
                  .split(",")
                  .map((c) => c.trim())
                  .filter(Boolean),
                employmentType: value("employmentType"),
                workplace: value("workplace"),
                salaryMin: number("salaryMin"),
                salaryMax: number("salaryMax"),
                salaryCurrency: value("salaryCurrency").toUpperCase(),
                salaryPeriod: value("salaryPeriod"),
              },
            });
            if (result?.jobId) onImported(result.jobId);
          }}
        >
          <h3>Review extracted details</h3>
          <p className="small muted">
            Only enter facts stated in the listing. Missing fields stay unknown.
          </p>
          <div className="form-grid">
            <label>
              Company name
              <input
                name="companyName"
                required
                maxLength={200}
                defaultValue={preview.companyName}
              />
            </label>
            <label>
              Job title
              <input name="title" required maxLength={250} defaultValue={preview.title} />
            </label>
            <label>
              Job location
              <input name="location" maxLength={250} defaultValue={preview.location} />
            </label>
            <label>
              Application link
              <input name="applyUrl" type="url" defaultValue={preview.applyUrl} />
            </label>
            <label>
              Minimum required experience (years)
              <input
                name="experienceMin"
                type="number"
                min={0}
                max={60}
                step={0.5}
                defaultValue={preview.requirements.experienceMin ?? ""}
              />
            </label>
            <label>
              Job seniority
              <select name="seniority" defaultValue={preview.requirements.seniority}>
                <option value="">Not stated</option>
                {seniorities.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              Eligible countries
              <input
                name="eligibleCountries"
                defaultValue={preview.requirements.eligibleCountries.join(", ")}
                placeholder="Only if stated; comma separated"
              />
            </label>
            <label>
              Job work arrangement
              <select name="workplace" defaultValue={preview.requirements.workplace}>
                <option value="">Not stated</option>
                {workplaces.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              Job employment type
              <select name="employmentType" defaultValue={preview.requirements.employmentType}>
                <option value="">Not stated</option>
                {employmentTypes.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              Salary as published
              <input name="salary" maxLength={300} defaultValue={preview.salary} />
            </label>
            <label>
              Salary minimum
              <input
                name="salaryMin"
                type="number"
                min={0}
                max={1e9}
                defaultValue={preview.requirements.salaryMin ?? ""}
              />
            </label>
            <label>
              Salary maximum
              <input
                name="salaryMax"
                type="number"
                min={0}
                max={1e9}
                defaultValue={preview.requirements.salaryMax ?? ""}
              />
            </label>
            <label>
              Currency code
              <input
                name="salaryCurrency"
                defaultValue={preview.requirements.salaryCurrency}
                maxLength={3}
                pattern="[A-Za-z]{3}|"
                placeholder="INR"
              />
            </label>
            <label>
              Pay period
              <select name="salaryPeriod" defaultValue={preview.requirements.salaryPeriod}>
                <option value="">Not stated</option>
                <option value="year">Annual</option>
                <option value="month">Monthly</option>
                <option value="hour">Hourly</option>
              </select>
            </label>
          </div>
          <label>
            Reviewed job description
            <textarea
              name="description"
              required
              minLength={30}
              maxLength={50000}
              rows={8}
              defaultValue={preview.description}
            />
          </label>
          {!!preview.requirements.evidence.length && (
            <details>
              <summary>Source excerpts for extracted requirements</summary>
              {preview.requirements.evidence.map((quote, i) => (
                <blockquote key={i}>{quote}</blockquote>
              ))}
            </details>
          )}
          <Button type="submit" variant="primary" disabled={!!busy} busy={busy === "job.import"}>
            Save job & check match
          </Button>
        </form>
      )}
    </div>
  );
}
