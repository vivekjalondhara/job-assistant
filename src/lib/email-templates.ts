import type { Company, EmailTemplate, Job, Profile } from "./types";

export const templateFields = [
  "name",
  "signature",
  "company",
  "role",
  "target_role",
  "skills",
  "portfolio",
  "availability",
  "recruiter",
  "work_example",
] as const;
export const builtinTemplates: EmailTemplate[] = [
  {
    id: "builtin-application",
    name: "Job application",
    purpose: "application",
    subject: "Application for {{role}} — {{name}}",
    body: "Hi {{recruiter}},\n\nI’m interested in the {{role}} position at {{company}}. My skills include {{skills}}.\n\n{{work_example}}\n\nI would welcome the opportunity to discuss the role and learn more about your team.\n\nThank you for your time.\n\n{{signature}}",
    updatedAt: "",
    builtin: true,
  },
  {
    id: "builtin-inquiry",
    name: "Ask about opportunities",
    purpose: "inquiry",
    subject: "{{target_role}} opportunities at {{company}}",
    body: "Hi {{recruiter}},\n\nI’m looking for {{target_role}} opportunities and would like to learn about openings at {{company}}. My skills include {{skills}}.\n\n{{work_example}}\n\nIs there a suitable role or application page you could point me to?\n\nThank you,\n{{signature}}",
    updatedAt: "",
    builtin: true,
  },
  {
    id: "builtin-referral",
    name: "Referral request",
    purpose: "referral",
    subject: "Interested in {{role}} at {{company}}",
    body: "Hi {{recruiter}},\n\nI noticed the {{role}} opening at {{company}} and wanted to ask whether you would be comfortable considering me for a referral.\n\n{{work_example}}\n\nI’d be happy to share more details about my experience. Thank you for considering my request.\n\n{{signature}}",
    updatedAt: "",
    builtin: true,
  },
  {
    id: "builtin-followup",
    name: "Application follow-up",
    purpose: "followup",
    subject: "Re: Application for {{role}} — {{name}}",
    body: "Hi {{recruiter}},\n\nI’m following up on my application for the {{role}} position at {{company}}. I’m still interested and would be happy to provide any additional information.\n\nThank you for your time,\n{{signature}}",
    updatedAt: "",
    builtin: true,
  },
];

export function renderEmailTemplate(
  template: Pick<EmailTemplate, "subject" | "body">,
  profile: Profile,
  job?: Job,
  company?: Company,
  custom: Record<string, string> = {},
) {
  const values: Record<string, string> = {
    name: profile.name,
    signature: profile.signature || profile.name,
    company: company?.name || "",
    role: job?.title || "",
    target_role: profile.targetRoles[0] || "",
    skills: profile.confirmed ? profile.skills.slice(0, 5).join(", ") : "",
    portfolio: profile.portfolio,
    availability: profile.availability,
    recruiter: "Hiring Team",
    work_example: "",
    ...custom,
  };
  const missing = new Set<string>();
  const fill = (text: string) =>
    text.replace(/\{\{\s*([\w]+)\s*\}\}/g, (placeholder, key: string) => {
      if (!Object.hasOwn(values, key) || !values[key]?.trim()) {
        missing.add(key);
        return placeholder;
      }
      return values[key].trim();
    });
  return {
    subject: fill(template.subject).replace(/[\r\n]+/g, " "),
    body: fill(template.body),
    missing: [...missing],
  };
}
