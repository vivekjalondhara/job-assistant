import type { Job, Match, Profile } from "./types";
import { jobInsights } from "./job-insights";
import { experienceFit } from "./experience-fit";
const tokens = (s: string) =>
  s
    .toLowerCase()
    .replace(/\bsr\.?\b/g, "senior")
    .replace(/\bjr\.?\b/g, "junior")
    .replace(/\bdeveloper\b/g, "engineer")
    .replace(/[^a-z0-9+#. ]/g, " ")
    .split(/\s+/)
    .map((x) => x.replace(/\.$/, ""))
    .filter((x) => x.length > 1);

function seniority(title: string): number | null {
  const words = tokens(title);
  if (words.includes("principal")) return 5;
  if (words.some((word) => ["staff", "lead"].includes(word))) return 4;
  if (words.includes("senior")) return 3;
  if (words.includes("mid") || words.includes("intermediate")) return 2;
  if (words.some((word) => ["junior", "entry", "graduate", "intern", "trainee"].includes(word)))
    return 1;
  return null;
}
export function matchJob(
  job: Pick<Job, "title" | "description" | "location" | "remote">,
  p: Profile,
): Match | null {
  if (!p.confirmed || !p.skills.length) return null;
  const insights = jobInsights(job, p);
  const found = insights.supported;
  const experience = experienceFit(job.description, p);
  const titleWords = new Set(tokens(job.title));
  const roleMatch =
    !p.targetRoles.length ||
    p.targetRoles.some((role) => {
      const words = tokens(role);
      return words.length > 0 && words.every((t) => titleWords.has(t));
    });
  const locationMatch =
    !p.preferredLocations.length ||
    p.preferredLocations.some((l) => job.location.toLowerCase().includes(l.toLowerCase()));
  let score = Math.round(
    (insights.mentioned.length ? found.length / insights.mentioned.length : 0) * 50 +
      (roleMatch ? 20 : 0) +
      (locationMatch ? 10 : 0) +
      (job.remote ? 5 : 0) +
      experience.points,
  );
  score = Math.min(score, experience.scoreLimit);
  const gaps: string[] = [...experience.gaps];
  const unknowns: string[] = [...experience.unknowns];
  const jobLevel = seniority(job.title);
  const currentLevel = seniority(p.headline);
  const preferredLevels = p.targetRoles.map(seniority);
  if (jobLevel !== null && currentLevel !== null && jobLevel > currentLevel) {
    score = Math.min(score, 59);
    gaps.push("The role's seniority is above the level stated in your current profile headline.");
  } else if (
    jobLevel !== null &&
    preferredLevels.length &&
    preferredLevels.every((level) => level !== null && level < jobLevel)
  ) {
    score = Math.min(score, 59);
    gaps.push("The role's seniority is above your preferred role levels.");
  } else if (
    jobLevel !== null &&
    jobLevel >= 3 &&
    currentLevel === null &&
    experience.requiredYears === null
  ) {
    score = Math.min(score, 69);
    unknowns.push(
      "This role has a seniority requirement that is not established by your profile headline or a stated experience minimum. Target roles are preferences, not evidence of seniority.",
    );
  }
  if (insights.missing.length)
    gaps.push(
      `Mentioned in the listing but not evidenced in your profile: ${insights.missing.join(", ")}. Check which are mandatory.`,
    );
  if (p.remoteOnly && !job.remote) {
    score = Math.min(score, 35);
    gaps.push("Remote work is not confirmed for this listing.");
  }
  if (!roleMatch) gaps.push("The job title does not clearly match your preferred roles.");
  if (!locationMatch) gaps.push("Location needs review against your preferences.");
  const reasons = found.length
    ? [
        `Your profile supports ${found.length} of ${insights.mentioned.length} recognized skills mentioned in the vacancy: ${found.join(", ")}.`,
      ]
    : ["No exact skill mentions found. Review the description for related experience."];
  if (roleMatch && p.targetRoles.length)
    reasons.push("The title overlaps with your preferred roles.");
  reasons.push(...experience.reasons);
  return {
    rating: score >= 70 ? "strong" : score >= 40 ? "possible" : "weak",
    score,
    reasons,
    gaps,
    unknowns: [
      ...unknowns,
      "Rules compare explicit text only; confirm relevant experience, mandatory skills, work authorization, and salary against the full listing.",
      ...(job.remote
        ? ["Remote work does not establish eligibility to work from your country."]
        : []),
    ],
    method: "rules",
    profileUpdatedAt: p.updatedAt,
  };
}
