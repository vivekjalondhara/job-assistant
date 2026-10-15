import type { Job, Match, Profile } from "./types";
import { jobInsights } from "./job-insights";
const tokens = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9+#. ]/g, " ")
    .split(/\s+/)
    .filter((x) => x.length > 1);
export function matchJob(
  job: Pick<Job, "title" | "description" | "location" | "remote">,
  p: Profile,
): Match | null {
  if (!p.confirmed || !p.skills.length) return null;
  const insights = jobInsights(job, p);
  const found = insights.supported;
  const titleWords = new Set(tokens(job.title));
  const roleMatch =
    !p.targetRoles.length ||
    p.targetRoles.some((role) => {
      const words = tokens(role).filter((word) => !["senior", "junior", "lead", "staff", "engineer", "developer", "manager"].includes(word));
      return (words.length ? words : tokens(role)).every((t) => titleWords.has(t));
    });
  const locationMatch =
    !p.preferredLocations.length ||
    p.preferredLocations.some((l) => job.location.toLowerCase().includes(l.toLowerCase()));
  let score = Math.round(
    (insights.mentioned.length ? found.length / insights.mentioned.length : 0) * 65 +
      (roleMatch ? 20 : 0) +
      (locationMatch ? 10 : 0) +
      (job.remote ? 5 : 0),
  );
  const gaps: string[] = [];
  if (insights.missing.length)
    gaps.push(`Mentioned in the listing but not evidenced in your profile: ${insights.missing.join(", ")}. Check which are mandatory.`);
  if (p.remoteOnly && !job.remote) {
    score = Math.min(score, 35);
    gaps.push("Remote work is not confirmed for this listing.");
  }
  if (!roleMatch) gaps.push("The job title does not clearly match your preferred roles.");
  if (!locationMatch) gaps.push("Location needs review against your preferences.");
  const reasons = found.length
    ? [`Your profile supports ${found.length} of ${insights.mentioned.length} recognized skills mentioned in the vacancy: ${found.join(", ")}.`]
    : ["No exact skill mentions found. Review the description for related experience."];
  if (roleMatch && p.targetRoles.length)
    reasons.push("The title overlaps with your preferred roles.");
  return {
    rating: score >= 70 ? "strong" : score >= 40 ? "possible" : "weak",
    score,
    reasons,
    gaps,
    unknowns: [
      "Keyword comparison only; seniority, work authorization, and mandatory qualifications need review.",
      ...(job.remote
        ? ["Remote work does not establish eligibility to work from your country."]
        : []),
    ],
    method: "rules",
    profileUpdatedAt: p.updatedAt,
  };
}
