import { jobInsights } from "./job-insights";
import type { Company, Job, Profile } from "./types";

export function localEmail(job: Job, company: Company, profile: Profile, attachResume: boolean) {
  const insights = jobInsights(job, profile);
  const formal = profile.tone === "formal";
  const examples = insights.evidence.slice(0, profile.tone === "concise" ? 1 : 2);
  const skillLine = insights.supported.length
    ? `My background includes ${insights.supported.slice(0, 4).join(", ")}, which your listing mentions.`
    : "I would welcome the opportunity to discuss how my background relates to the role.";
  const body = [
    formal ? "Dear Hiring Team," : "Hi Hiring Team,",
    `I’m writing to apply for the ${job.title} role at ${company.name}. ${skillLine}`,
    ...examples,
    ...(attachResume ? ["I’ve attached my résumé for your review."] : []),
    ...(profile.portfolio ? [`You can view my work at ${profile.portfolio}.`] : []),
    ...(profile.availability ? [`Availability: ${profile.availability}`] : []),
    "Would you be open to a conversation about the role? Thank you for considering my application.",
    `${formal ? "Kind regards" : "Best regards"},\n${profile.signature || profile.name}`,
  ].join("\n\n");
  return {
    subject: `Application for ${job.title} — ${profile.name}`
      .replace(/[\r\n]+/g, " ")
      .slice(0, 250),
    body,
    evidence: [
      ...examples.map((quote) => `Work example\nSource: “${quote}”`),
      ...(insights.supported.length
        ? [
            `Skills mentioned in your confirmed profile: ${insights.supported.slice(0, 4).join(", ")}`,
          ]
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
