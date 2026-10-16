"use client";
import { useState } from "react";
import type { AppState, Company, EmailTemplate, Job } from "@/lib/types";
import { builtinTemplates, renderEmailTemplate, templateFields } from "@/lib/email-templates";
import type { Act } from "./workspace";
import { Button, Modal } from "./ui";

export function TemplateLibrary({
  data,
  act,
  busy,
  subject = "",
  body = "",
}: {
  data: AppState;
  act: Act;
  busy: string;
  subject?: string;
  body?: string;
}) {
  const [open, setOpen] = useState(false),
    [editing, setEditing] = useState<Partial<EmailTemplate> | null>(null);
  const templates = data.templates || builtinTemplates;
  return (
    <>
      <Button
        type="button"
        disabled={!!busy}
        onClick={() => {
          setOpen(true);
          setEditing(body ? { subject, body, purpose: "application" } : null);
        }}
      >
        {body ? "Save as reusable template" : "Email templates"}
      </Button>
      {open && (
        <Modal
          title="Your email templates"
          onClose={() => {
            setOpen(false);
            setEditing(null);
          }}
        >
          <div className="modal-form">
            <p>
              Save wording you want to reuse. Placeholders are filled when you prepare an email; the
              recipient is always chosen separately.
            </p>
            {editing ? (
              <form
                key={editing.id || "new"}
                className="career-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  const result = await act("template.save", {
                    ...(editing.id && !editing.builtin ? { id: editing.id } : {}),
                    name: f.get("name"),
                    subject: f.get("subject"),
                    body: f.get("body"),
                    purpose: f.get("purpose"),
                  });
                  if (result) setEditing(null);
                }}
              >
                <label>
                  Template name
                  <input
                    name="name"
                    required
                    maxLength={100}
                    defaultValue={
                      editing.builtin ? `${editing.name} — my version` : editing.name || ""
                    }
                  />
                </label>
                <label>
                  Purpose
                  <select name="purpose" defaultValue={editing.purpose || "application"}>
                    {["application", "inquiry", "referral", "followup"].map((p) => (
                      <option key={p} value={p}>
                        {p === "followup" ? "Follow-up" : p}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Template subject
                  <input
                    name="subject"
                    required
                    maxLength={250}
                    defaultValue={editing.subject || ""}
                  />
                </label>
                <label>
                  Template message
                  <textarea
                    name="body"
                    required
                    minLength={20}
                    maxLength={16000}
                    rows={10}
                    defaultValue={editing.body || ""}
                  />
                </label>
                <p className="small muted">
                  Use these placeholders: {templateFields.map((f) => `{{${f}}}`).join(", ")}.
                  Replace specific company names before reusing a saved email.
                </p>
                <div className="button-row">
                  <Button type="submit" variant="primary" disabled={!!busy}>
                    Save template
                  </Button>
                  <Button type="button" onClick={() => setEditing(null)}>
                    Back to templates
                  </Button>
                </div>
              </form>
            ) : (
              <>
                <Button type="button" variant="primary" onClick={() => setEditing({})}>
                  Create template
                </Button>
                <div className="career-list">
                  {templates.map((t) => (
                    <article key={t.id} className="career-list-row">
                      <div>
                        <strong>{t.name}</strong>
                        <p className="small muted">
                          {t.builtin ? "Starter template" : "Your template"} · {t.purpose}
                        </p>
                      </div>
                      <div className="button-row">
                        <Button type="button" onClick={() => setEditing(t)}>
                          {t.builtin ? "Customize" : "Edit"}
                        </Button>
                        {!t.builtin && (
                          <Button
                            type="button"
                            disabled={!!busy}
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Delete the template “${t.name}”? Saved emails will remain.`,
                                )
                              )
                                void act("template.delete", { id: t.id });
                            }}
                          >
                            Delete
                          </Button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

export function TemplatePicker({
  data,
  job,
  company,
  followup,
  busy,
  hasContent,
  onApply,
}: {
  data: AppState;
  job?: Job;
  company?: Company;
  followup: boolean;
  busy: string;
  hasContent: boolean;
  onApply: (subject: string, body: string) => void;
}) {
  const templates = (data.templates || builtinTemplates).filter((t) =>
    followup ? t.purpose === "followup" : t.purpose !== "followup",
  );
  const [id, setId] = useState(""),
    [values, setValues] = useState<Record<string, string>>({});
  const selected = templates.find((t) => t.id === id);
  const rendered = selected
    ? renderEmailTemplate(selected, data.profile, job, company, values)
    : null;
  const variables = selected
    ? [...new Set(`${selected.subject}\n${selected.body}`.match(/\{\{\s*\w+\s*\}\}/g) || [])].map(
        (s) => s.replace(/[{}\s]/g, ""),
      )
    : [];
  const editable = variables.filter(
    (v) =>
      ["recruiter", "work_example"].includes(v) ||
      rendered?.missing.includes(v) ||
      Object.hasOwn(values, v),
  );
  return (
    <details className="template-picker">
      <summary>Use a saved email template</summary>
      <div className="career-form">
        <label>
          Choose email template
          <select
            value={id}
            disabled={!!busy}
            onChange={(e) => {
              setId(e.target.value);
              setValues({});
            }}
          >
            <option value="">Choose a template</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        {selected && (
          <>
            <div className="form-grid">
              {editable.map((field) => (
                <label key={field}>
                  {field.replaceAll("_", " ")}
                  <input
                    value={values[field] ?? (field === "recruiter" ? "Hiring Team" : "")}
                    maxLength={field === "work_example" ? 1500 : 500}
                    onChange={(e) => setValues((v) => ({ ...v, [field]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
            <p className="small muted">
              Use a real work example. You can edit every part of the message after applying the
              template.
            </p>
            <div className="template-preview">
              <strong>{rendered?.subject}</strong>
              <div className="email-preview-body">{rendered?.body}</div>
            </div>
            {!!rendered?.missing.length && (
              <p className="small notice">
                Fill in: {rendered.missing.join(", ").replaceAll("_", " ")}. Unfilled placeholders
                prevent sending.
              </p>
            )}
            <Button
              type="button"
              disabled={!!busy}
              onClick={() => {
                if (
                  rendered &&
                  (!hasContent ||
                    window.confirm(
                      "Replace the subject and message in this editor with the template preview?",
                    ))
                )
                  onApply(rendered.subject, rendered.body);
              }}
            >
              Use this template
            </Button>
          </>
        )}
      </div>
    </details>
  );
}
