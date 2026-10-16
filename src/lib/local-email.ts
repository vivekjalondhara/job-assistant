import { jobInsights } from "./job-insights";
import type { Company, Draft, Job, Profile } from "./types";
import { jobTitleSchema } from "./validation";
import {
  candidateSignature,
  defaultWritingOptions,
  emailWordCount,
  type WritingOptions,
} from "./email-writing";

export function localEmail(
  job: Pick<Job, "title" | "description">,
  company: Pick<Company, "name">,
  profile: Profile,
  attachResume: boolean,
  options: WritingOptions = defaultWritingOptions(profile),
  original?: Pick<Draft, "subject" | "sentAt">,
) {
  const title = jobTitleSchema.parse(job.title);
  const insights = jobInsights(job, profile);
  const followup = options.template === "followup";
  if (followup && !original?.sentAt)
    throw new Error("Follow-ups require an actual sent application.");
  const concise = options.template === "short" || options.tone === "concise";
  const signature = candidateSignature(profile);
  const skills = [
    ...new Set(insights.supported.length ? insights.supported : profile.skills),
  ].slice(0, concise ? 2 : 4);
  const summary = insights.rankedEvidence.find(
    (e) => e.field === "experience" && /\b(?:years?|I am|I’m|currently)\b/i.test(e.quote),
  );
  const ranked = insights.rankedEvidence.filter((e) => e !== summary);
  // Relevance always comes before metrics. A large unrelated number is not a reason to use a claim.
  const candidates = [...(summary ? [summary] : []), ...ranked.slice(0, concise ? 1 : 2)];
  if (options.template === "achievement")
    candidates.sort(
      (a, b) => b.relevance - a.relevance || Number(b.measurable) - Number(a.measurable),
    );
  const examples: typeof candidates = [];
  const greeting = options.tone === "friendly" ? "Hi Hiring Team," : "Dear Hiring Team,";
  const opening = followup
    ? `I am following up on my previous application email for the ${title} position at ${company.name}.`
    : options.tone === "confident"
      ? `I would like to contribute to ${company.name} as a ${title}.`
      : `I am applying for the ${title} position at ${company.name}.`;
  const closing = followup
    ? "I remain interested in this role and the opportunity to contribute to your team. Could you please let me know whether there is an update on my application? Thank you for your time and consideration."
    : "I would welcome the opportunity to discuss how my experience could contribute to your team. Thank you for your consideration.";
  const skillLine =
    !followup && skills.length ? `My technical skills include ${skills.join(", ")}.` : "";
  const attachment = attachResume ? "I have attached my résumé for your review." : "";
  const availability = profile.availability.trim().replace(/[.!?]+$/, "");
  const extras =
    !followup && !concise
      ? [
          profile.portfolio && !signature.includes(profile.portfolio)
            ? `You can view my work at ${profile.portfolio}.`
            : "",
          availability
            ? /^available\b/i.test(availability)
              ? `I am ${availability[0].toLowerCase()}${availability.slice(1)}.`
              : /^I\b/i.test(availability)
                ? `${availability}.`
                : `Availability: ${availability}.`
            : "",
        ].filter(Boolean)
      : [];
  const compose = () =>
    [
      greeting,
      opening,
      examples.map((e) => e.quote).join(" "),
      skillLine,
      attachment,
      ...extras,
      closing,
      `Best regards,\n${signature}`,
    ]
      .filter(Boolean)
      .join("\n\n");
  // Keep complete verified excerpts, never truncate a number or turn a sentence fragment into a new claim.
  if (!followup)
    for (const candidate of candidates) {
      examples.push(candidate);
      if (emailWordCount(compose(), signature) > options.maxWords) examples.pop();
    }
  while (extras.length && emailWordCount(compose(), signature) > options.maxWords) extras.pop();
  const body = compose();
  const words = emailWordCount(body, signature);
  return {
    subject: followup
      ? `Re: ${original!.subject.replace(/^(?:Re:\s*)+/i, "")}`.slice(0, 250)
      : `Application for ${title} – ${profile.name}`.replace(/[\r\n]+/g, " ").slice(0, 250),
    body,
    evidence: [
      ...examples.map((e) => `Work example (${e.field})\nSource: “${e.quote}”`),
      ...(!followup && skills.length
        ? [`Skills mentioned in your confirmed profile: ${skills.join(", ")}`]
        : []),
      ...(followup ? [`Previous application email sent on ${original!.sentAt}`] : []),
    ],
    reviewNotes: [
      "Written locally from your confirmed profile. Check the wording and all claims before sending.",
      ...(words < options.minWords || words > options.maxWords
        ? [
            `This email has ${words} words excluding the signature; your target is ${options.minWords}–${options.maxWords}. Adjust the wording without adding unsupported claims.`,
          ]
        : []),
      ...(!followup && !examples.length
        ? [
            "Add a short relevant work example to your profile, or personalize this draft before sending.",
          ]
        : []),
      ...(!followup && insights.missing.length
        ? [
            `The listing also mentions ${insights.missing.join(", ")}; these are not evidenced in your profile.`,
          ]
        : []),
    ],
  };
}
