import { jobInsights } from "./job-insights";
import type { Company, Job, Profile } from "./types";
import { jobTitleSchema } from "./validation";

export function localEmail(
  job: Pick<Job, "title" | "description">,
  company: Pick<Company, "name">,
  profile: Profile,
  attachResume: boolean,
) {
  const title = jobTitleSchema.parse(job.title);
  const insights = jobInsights(job, profile);
  const formal = profile.tone === "formal";
  const concise = profile.tone === "concise";
  const background = profile.experience
    .split(/\n+|(?<!\bPvt\.)(?<!\bLtd\.)(?<!\bInc\.)(?<=[.!?])\s+(?=[A-Z])/)
    .map((text) => text.replace(/^\s*[-•]\s*/, "").trim())
    .filter((text) => text.length >= 20 && text.length <= 1200);
  // A sparse vacancy must not erase the candidate's confirmed background.
  // Preserve exact excerpts, prioritizing a summary and relevant work examples.
  const examples = [
    ...new Set([...background.slice(0, 1), ...insights.evidence, ...background.slice(1)]),
  ].slice(0, concise ? 1 : 3);
  const skills = [
    ...new Set(insights.supported.length ? insights.supported : profile.skills),
  ].slice(0, concise ? 4 : 8);
  const skillLine = skills.length ? `My technical skills include ${skills.join(", ")}.` : "";
  const signature = profile.signature || profile.name;
  const availability = profile.availability.trim().replace(/[.!?]+$/, "");
  const body = [
    formal ? "Dear Hiring Team," : "Hi Hiring Team,",
    `I am writing to express my interest in the ${title} position at ${company.name}.`,
    [examples[0], skillLine].filter(Boolean).join(" "),
    examples.slice(1).join(" "),
    ...(attachResume ? ["I have attached my résumé for your review."] : []),
    ...(profile.portfolio && !signature.includes(profile.portfolio)
      ? [`You can view my work at ${profile.portfolio}.`]
      : []),
    ...(availability
      ? [
          /^available\b/i.test(availability)
            ? `I am ${availability[0].toLowerCase()}${availability.slice(1)}.`
            : /^I\b/i.test(availability)
              ? `${availability}.`
              : `Availability: ${availability}.`,
        ]
      : []),
    "I would welcome the opportunity to discuss how my skills and experience could contribute to your team.",
    "Thank you for your time and consideration. I look forward to hearing from you.",
    `Best regards,\n${signature}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    subject: `Application for ${title} — ${profile.name}`.replace(/[\r\n]+/g, " ").slice(0, 250),
    body,
    evidence: [
      ...examples.map((quote) => `Work example\nSource: “${quote}”`),
      ...(skills.length
        ? [`Skills mentioned in your confirmed profile: ${skills.join(", ")}`]
        : []),
    ],
    reviewNotes: [
      "Written locally from your confirmed profile. Check the wording and all claims before sending.",
      ...(!examples.length
        ? ["Add a relevant work example to your profile, or personalize this draft before sending."]
        : []),
      ...(insights.missing.length
        ? [
            `The listing also mentions ${insights.missing.join(", ")}; these are not evidenced in your profile.`,
          ]
        : []),
    ],
  };
}
