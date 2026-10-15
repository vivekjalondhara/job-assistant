import type { Profile } from "./types";

const writtenNumbers = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];
const amount = `(?:\\d+(?:\\.\\d+)?|${writtenNumbers.join("|")})`;
const numeric = (value: string) => {
  const written = writtenNumbers.indexOf(value.toLowerCase());
  return written < 0 ? Number(value) : written;
};

// Read stated durations only. Never infer tenure from dates, add overlapping
// jobs, or count years mentioned in projects/education as professional tenure.
function durations(text: string, vacancy: boolean) {
  const years: number[] = [];
  let ambiguous = false;
  let preferredSection = false;
  for (const line of text.split(/\n+/)) {
    const heading = line.trim().replace(/^[-*•#\s]+/, "");
    if (/^(?:preferred|desirable|optional|nice[- ]to[- ]have)\b/i.test(heading))
      preferredSection = true;
    else if (
      /^(?:required|requirements|minimum|essential|must[- ]have|responsibilities|about|benefits)\b/i.test(
        heading,
      )
    )
      preferredSection = false;
    for (const clause of line.split(
      /(?<=[.!?;])\s+|,\s*(?=(?:prefer|optional|ideally|nice[- ]to[- ]have))/i,
    )) {
      if (
        vacancy &&
        (preferredSection ||
          /\b(?:prefer(?:red|ably)?|desirable|optional|nice[- ]to[- ]have|bonus|not (?:strictly )?(?:required|necessary))\b/i.test(
            clause,
          ) ||
          /\b(?:(?:our|the) company (?:has|brings|offers)|we have|we bring|we offer|we've)\b/i.test(
            clause,
          ))
      )
        continue;
      const pattern = new RegExp(
        `\\b(${amount})(?:\\s*(?:[-–—]|to)\\s*(${amount}))?\\s*(?:\\+|or more)?\\s*(years?|yrs?|months?)\\b`,
        "gi",
      );
      for (const match of clause.matchAll(pattern)) {
        const context = clause.slice(
          Math.max(0, match.index! - 40),
          match.index! + match[0].length + 100,
        );
        if (
          !/\bexperience\b|\b(?:years?|yrs?|months?)\s+(?:in|as|working|building|developing|using|of (?:professional|commercial|relevant|software|backend|frontend|engineering|development))\b/i.test(
            context,
          )
        )
          continue;
        // An alternative degree/experience path or a negated/upper-bound
        // statement cannot safely establish one minimum duration.
        if (
          /\b(?:or|not|never|less than|under|up to|at most)\b/i.test(
            clause.replace(/\bor more\b/gi, ""),
          )
        ) {
          ambiguous = true;
          continue;
        }
        const value = numeric(match[1]);
        if (match[2] && numeric(match[2]) < value) {
          ambiguous = true;
          continue;
        }
        const duration = /^month/i.test(match[3]) ? value / 12 : value;
        if (duration <= 60) years.push(duration);
        else ambiguous = true;
      }
    }
  }
  return { years, ambiguous };
}

export function experienceFit(description: string, profile: Profile) {
  const requirement = durations(description, true);
  const candidate = durations(`${profile.headline}\n${profile.experience}`, false);
  const distinct = [...new Set(candidate.years)];
  // Multiple durations may describe different skills or overlapping jobs.
  // Ask for review rather than choosing the largest and inflating experience.
  const candidateYears = !candidate.ambiguous && distinct.length === 1 ? distinct[0] : null;
  const requiredYears =
    !requirement.ambiguous && requirement.years.length ? Math.max(...requirement.years) : null;
  const reasons: string[] = [];
  const gaps: string[] = [];
  const unknowns: string[] = [];
  let points = 0;
  let scoreLimit = 100;
  if (requirement.ambiguous) {
    scoreLimit = 69;
    unknowns.push(
      "The listing has alternative or unclear experience requirements. Check which qualification path applies.",
    );
  } else if (requiredYears === null) {
    unknowns.push("The listing does not state a clear minimum duration of required experience.");
  } else if (candidateYears === null) {
    scoreLimit = 69;
    unknowns.push(
      `The listing asks for ${requiredYears} years of experience, but your profile has no single clear duration to compare. State your relevant experience in years and review this requirement.`,
    );
  } else if (candidateYears < requiredYears) {
    scoreLimit = requiredYears - candidateYears >= 3 ? 39 : 59;
    gaps.push(
      `The listing asks for at least ${requiredYears} years of experience; your profile states ${candidateYears} years. The required duration is not evidenced.`,
    );
  } else {
    points = 15;
    reasons.push(
      `Your stated ${candidateYears} years of experience meets the listing's ${requiredYears}-year minimum duration. Check that it covers the required kind of work.`,
    );
  }
  return { requiredYears, points, scoreLimit, reasons, gaps, unknowns };
}
