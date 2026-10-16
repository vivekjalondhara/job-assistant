import type { Draft, Profile } from "./types";

export const emailTemplates = {
  standard: {
    label: "Standard Job Application",
    minWords: 120,
    maxWords: 180,
    description: "A relevant introduction, matching skills, and up to two work examples.",
  },
  short: {
    label: "Short Recruiter Email",
    minWords: 60,
    maxWords: 100,
    description: "The exact role, your strongest matching skill, and a brief introduction.",
  },
  achievement: {
    label: "Achievement-Focused Application",
    minWords: 120,
    maxWords: 180,
    description: "Lead with verified impact, ownership, and relevant projects.",
  },
  followup: {
    label: "Application Follow-Up",
    minWords: 50,
    maxWords: 90,
    description: "Reference your sent application, reaffirm interest, and ask for an update.",
  },
} as const;

export const emailTones = ["professional", "concise", "friendly", "confident"] as const;
export type EmailTone = (typeof emailTones)[number];
export interface WritingOptions {
  template: keyof typeof emailTemplates;
  tone: EmailTone;
  minWords: number;
  maxWords: number;
}

export function defaultWritingOptions(
  profile?: Pick<Profile, "tone">,
  followup = false,
): WritingOptions {
  const template = followup ? "followup" : "standard";
  return {
    template,
    tone: profile?.tone === "concise" ? "concise" : "professional",
    minWords: emailTemplates[template].minWords,
    maxWords: emailTemplates[template].maxWords,
  };
}

export function writingOptionsFor(
  draft: Pick<Draft, "writingOptions" | "followUpOf">,
  profile?: Profile,
) {
  return draft.writingOptions || defaultWritingOptions(profile, !!draft.followUpOf);
}

export function candidateSignature(profile: Pick<Profile, "signature" | "name" | "email">) {
  return profile.signature.trim() || [profile.name, profile.email].filter(Boolean).join("\n");
}

// Count the actual message, excluding a known signature and conventional sign-off.
export function emailWordCount(body: string, signature = "") {
  let message = body.trim();
  if (signature.trim() && message.endsWith(signature.trim())) {
    message = message.slice(0, -signature.trim().length).trimEnd();
    message = message
      .replace(
        /(?:^|\n)(?:best regards|kind regards|regards|best|sincerely|thanks|thank you)[,!]?$/i,
        "",
      )
      .trimEnd();
  }
  return message.split(/\s+/).filter(Boolean).length;
}

export const defaultWritingInstructions = `Act as an expert technical recruiter, professional career writer, and job application specialist.
Write a personalized job application email using my confirmed profile and the exact job description.
Use the exact job title and company name. Open naturally and confidently with the role and my relevant, verified experience.
Highlight only 2–4 matching technical skills and up to two relevant achievements or project examples. Preserve all metrics accurately. Explain how this evidence relates to the team's stated needs.
Use natural, confident, professional English. Avoid exaggerated claims, clichés, unnecessary formalities, and AI-sounding phrases. Every sentence should serve a purpose.
Follow the selected template, tone, and word target, excluding the signature. Standard applications should be 120–180 words; use a shorter message when the recruiter requests it. Do not pad sparse evidence.
Use a clear subject: Application for [Exact Job Title] – [Candidate Name], filling it only with confirmed details.
Mention the attached résumé only when selected. Use my configured signature once, without repeating contact information.
Close with a polite request to discuss my suitability. For follow-ups, reference only the actual sent application and ask politely for an update; never imply an interview or conversation that did not happen.
Never invent experience, skills, achievements, education, certifications, salary, availability, or company knowledge. Omit missing information instead of leaving placeholders.
Return a subject and complete email body ready for review. Keep evidence, explanations, and review notes outside the email body.`;
