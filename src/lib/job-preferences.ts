import {
  defaultPreferences,
  emptyProfile,
  type FitCheck,
  type Job,
  type JobRequirements,
  type Profile,
} from "./types";
import { experienceFit } from "./experience-fit";

export const seniorities = ["intern", "junior", "mid", "senior", "lead"];
export const employmentTypes = ["full-time", "part-time", "contract", "internship", "temporary"];
export const workplaces = ["remote", "hybrid", "onsite"];
export const recommendationLabels = {
  good: "Good match",
  stretch: "Stretch role",
  review: "Needs checking",
  poor: "Outside preferences",
};
export const emptyRequirements: JobRequirements = {
  experienceMin: null,
  seniority: "",
  eligibleCountries: [],
  employmentType: "",
  workplace: "",
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: "",
  salaryPeriod: "",
  evidence: [],
};
export function salaryFacts(
  min: unknown,
  max: unknown,
  currency: unknown,
  interval: unknown,
): Partial<JobRequirements> {
  if (
    typeof min !== "number" ||
    typeof max !== "number" ||
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    min < 0 ||
    max < min ||
    max > 1e9 ||
    typeof currency !== "string" ||
    !/^[A-Z]{3}$/.test(currency)
  )
    return {};
  const period = typeof interval === "string" ? interval.toLowerCase() : "";
  return {
    salaryMin: min,
    salaryMax: max,
    salaryCurrency: currency,
    salaryPeriod: ["year", "1 year", "per-year", "yearly"].includes(period)
      ? "year"
      : ["month", "1 month", "per-month", "monthly"].includes(period)
        ? "month"
        : ["hour", "1 hour", "per-hour", "hourly"].includes(period)
          ? "hour"
          : "",
  };
}
const countryAliases: Record<string, string> = {
  us: "united states",
  usa: "united states",
  "u.s.": "united states",
  "u.s.a.": "united states",
  uk: "united kingdom",
  gb: "united kingdom",
  in: "india",
  ca: "canada",
  au: "australia",
  de: "germany",
  fr: "france",
  nl: "netherlands",
  sg: "singapore",
  nz: "new zealand",
};
export const countryKey = (country: string) =>
  countryAliases[country.trim().toLowerCase()] || country.trim().toLowerCase();

// Conservative local extraction. Unknown fields stay unknown and the source is shown.
export function extractRequirements(
  job: Pick<Job, "title" | "description" | "remote" | "location">,
): JobRequirements {
  const result = {
    ...emptyRequirements,
    eligibleCountries: [] as string[],
    evidence: [] as string[],
  };
  const title = job.title.toLowerCase();
  result.seniority = /\b(intern|internship)\b/.test(title)
    ? "intern"
    : /\b(junior|jr\.?|entry.level|graduate)\b/.test(title)
      ? "junior"
      : /\b(lead|staff|principal|head)\b/.test(title)
        ? "lead"
        : /\b(senior|sr\.?)\b/.test(title)
          ? "senior"
          : /\b(mid.level|intermediate)\b/.test(title)
            ? "mid"
            : "";
  if (result.seniority) result.evidence.push(`Title: ${job.title}`);
  const lines = job.description
    .split(/\n|(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter(Boolean);
  result.experienceMin = experienceFit(job.description, emptyProfile).requiredYears;
  for (const line of lines) {
    const years = line.match(
      /(?:minimum(?: of)?\s*|at least\s*)?(\d{1,2})(?:\s*[-–]\s*\d{1,2})?\+?\s*(?:years?|yrs?)\b[^.!?]{0,50}\bexperience\b/i,
    );
    if (years && !/preferred|nice.to.have|optional|desirable/i.test(line)) {
      result.evidence.push(line);
    }
    if (
      /\b(?:must (?:be based|reside|live)|(?:candidates|applicants) (?:must|should|need)|authorized to work in|eligible (?:locations|countries)|remote (?:from|within|in))\b/i.test(
        line,
      )
    ) {
      const countries = line.match(
        /\b(?:India|United States|USA|US|United Kingdom|UK|Canada|Australia|Germany|France|Netherlands|Singapore|New Zealand)\b/g,
      );
      if (countries?.length) {
        result.eligibleCountries.push(...countries.map(countryKey));
        result.evidence.push(line);
      }
    }
    if (/\b(?:work (?:from )?anywhere|worldwide remote|remote worldwide)\b/i.test(line)) {
      result.eligibleCountries.push("worldwide");
      result.evidence.push(line);
    }
  }
  result.eligibleCountries = [...new Set(result.eligibleCountries)];
  result.evidence = [...new Set(result.evidence)].slice(0, 50).map((quote) => quote.slice(0, 2000));
  const text = `${job.title}\n${job.description}`;
  result.employmentType = /\bfull[ -]time\b/i.test(text)
    ? "full-time"
    : /\bpart[ -]time\b/i.test(text)
      ? "part-time"
      : /\bcontract(?:or)?\b/i.test(title)
        ? "contract"
        : result.seniority === "intern"
          ? "internship"
          : "";
  result.workplace = /\bhybrid\b/i.test(job.location)
    ? "hybrid"
    : job.remote
      ? "remote"
      : /\bon[ -]?site\b/i.test(job.location)
        ? "onsite"
        : "";
  return result;
}

export function requirementsFor(
  job: Pick<Job, "title" | "description" | "remote" | "location"> & {
    requirements?: JobRequirements;
  },
) {
  return { ...extractRequirements(job), ...job.requirements };
}

export function preferenceChecks(
  job: Pick<Job, "title" | "description" | "remote" | "location"> & {
    requirements?: JobRequirements;
  },
  profile: Profile,
): FitCheck[] {
  const p = { ...defaultPreferences, ...profile.preferences },
    r = requirementsFor(job);
  p.experienceYears ??= experienceFit(job.description, profile).candidateYears;
  const checks: FitCheck[] = [];
  const add = (label: string, status: FitCheck["status"], detail: string) =>
    checks.push({ label, status, detail });
  add(
    "Experience",
    r.experienceMin === null || p.experienceYears === null
      ? "unknown"
      : p.experienceYears >= r.experienceMin
        ? "supported"
        : "gap",
    r.experienceMin === null
      ? "Required years are not stated clearly. Check the listing."
      : p.experienceYears === null
        ? `Listing mentions ${r.experienceMin}+ years. Add your years of experience.`
        : `You: ${p.experienceYears} years · listing: ${r.experienceMin}+ years.`,
  );
  if (p.seniority)
    add(
      "Seniority",
      !r.seniority
        ? "unknown"
        : seniorities.indexOf(r.seniority) <= seniorities.indexOf(p.seniority)
          ? "supported"
          : "gap",
      r.seniority
        ? `Your target: ${p.seniority} · role: ${r.seniority}.`
        : "Seniority is not explicit in the title.",
    );
  else if (r.seniority)
    add("Seniority", "unknown", `Role: ${r.seniority}. Set your target level in My profile.`);
  if (job.remote || p.workCountries.length || r.eligibleCountries.length) {
    const unrestricted =
      r.eligibleCountries.includes("worldwide") && r.eligibleCountries.length === 1;
    add(
      "Work location eligibility",
      !r.eligibleCountries.length || (!unrestricted && !p.workCountries.length)
        ? "unknown"
        : unrestricted ||
            p.workCountries.some((c) => r.eligibleCountries.map(countryKey).includes(countryKey(c)))
          ? "supported"
          : "gap",
      !r.eligibleCountries.length
        ? "Eligible countries are not stated clearly. Remote does not mean worldwide."
        : `Listing countries: ${r.eligibleCountries.join(", ")}. ${p.workCountries.length ? `Your eligible countries: ${p.workCountries.join(", ")}.` : "Confirm any work authorization requirements."}`,
    );
  }
  const workplace = profile.remoteOnly ? "remote" : p.workplace;
  if (workplace)
    add(
      "Work arrangement",
      !r.workplace ? "unknown" : r.workplace === workplace ? "supported" : "gap",
      `Wanted: ${workplace} · listed: ${r.workplace || "not stated"}.`,
    );
  if (p.employmentType)
    add(
      "Employment type",
      !r.employmentType ? "unknown" : r.employmentType === p.employmentType ? "supported" : "gap",
      `Wanted: ${p.employmentType} · listed: ${r.employmentType || "not stated"}.`,
    );
  if (p.salaryMin !== null) {
    const comparable =
      r.salaryMax !== null && r.salaryCurrency === p.salaryCurrency && r.salaryPeriod === "year";
    add(
      "Salary",
      !comparable ? "unknown" : r.salaryMax! >= p.salaryMin ? "supported" : "gap",
      comparable
        ? `Your minimum: ${p.salaryMin.toLocaleString()} ${p.salaryCurrency}/year · listed maximum: ${r.salaryMax!.toLocaleString()} ${r.salaryCurrency}/year.`
        : "A comparable annual salary is not stated. Different currencies and pay periods need review.",
    );
  }
  return checks;
}
