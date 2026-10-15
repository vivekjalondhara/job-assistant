import type { Company, Draft, Job, Profile } from "./types";

export interface EmailCheck { id: string; status: "pass" | "warning" | "error"; message: string }

export function contentChecks(draft: Pick<Draft, "to" | "subject" | "body" | "resumeId">): EmailCheck[] {
  const words = draft.body.trim().split(/\s+/).filter(Boolean).length;
  const placeholder = /\[(?:your|company|job|name|insert|recruiter|portfolio|hiring)[^\]]*\]|\{\{[^}]+\}\}|<(?:your|insert|recruiter|company|name)[^>]*>/i;
  const attachmentMention = /\battach(?:ed|ment)\b|\benclosed\b/i;
  return [
    { id: "recipient", status: /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(draft.to) ? "pass" : "error", message: "Enter one valid recipient email before continuing." },
    { id: "subject", status: draft.subject.trim() && draft.subject.length <= 250 && !/[\r\n]/.test(draft.subject) ? "pass" : "error", message: "Enter a valid one-line subject of up to 250 characters." },
    { id: "body", status: draft.body.trim().length >= 20 && draft.body.length <= 16000 ? "pass" : "error", message: "Write an email body between 20 and 16,000 characters." },
    { id: "placeholders", status: placeholder.test(`${draft.subject}\n${draft.body}`) ? "error" : "pass", message: "Replace the remaining placeholders before continuing." },
    { id: "attachment", status: !draft.resumeId && attachmentMention.test(draft.body) ? "error" : "pass", message: "Your email mentions an attachment. Attach your résumé or edit that sentence." },
    { id: "length", status: words > 220 ? "warning" : "pass", message: "Consider shortening this email to around 100–160 words." },
  ];
}

export function applicationChecks(draft: Draft, profile: Profile, job?: Job, company?: Company): EmailCheck[] {
  return [
    ...contentChecks(draft),
    { id: "profile", status: profile.confirmed ? "pass" : "error", message: "Confirm your profile before approving or sending." },
    { id: "vacancy", status: job && job.status !== "closed" ? "pass" : "error", message: "This vacancy is closed or unavailable." },
    { id: "freshness", status: draft.profileUpdatedAt === profile.updatedAt && draft.jobUpdatedAt === job?.updatedAt ? "pass" : "error", message: "Your profile or job changed. Review and save the email again." },
    { id: "contact", status: company?.contactConfirmed && !!company.contactSource && draft.to.toLowerCase() === company.email.toLowerCase() ? "pass" : "error", message: "Confirm this recruitment address and its source in Companies." },
    { id: "resolved", status: job && ["rejected", "withdrawn", "offer"].includes(job.applicationStatus) ? "error" : "pass", message: "This application is already resolved. Review its status before sending." },
    { id: "resume", status: draft.resumeId ? "pass" : "warning", message: "No résumé is attached. Add one if the employer requests it." },
  ];
}
