import type { Job, Profile } from "./types";

// A transparent keyword aid, not an exhaustive requirements parser.
const skillGroups = [
  ["JavaScript", "javascript"],
  ["TypeScript", "typescript"],
  ["Node.js", "node.js", "nodejs", "node js"],
  ["React", "react", "react.js", "reactjs"],
  ["Next.js", "next.js", "nextjs"],
  ["Vue", "vue", "vue.js", "vuejs"],
  ["Angular", "angular"],
  ["Python", "python"],
  ["Java", "java"],
  ["C++", "c++"],
  ["C#", "c#", "c sharp"],
  [".NET", ".net", "dotnet"],
  ["Go", "golang", "go programming", "go language"],
  ["Rust", "rust"],
  ["PHP", "php"],
  ["Ruby", "ruby"],
  ["Kotlin", "kotlin"],
  ["Swift", "swift"],
  ["SQL", "sql"],
  ["PostgreSQL", "postgresql", "postgres"],
  ["MySQL", "mysql"],
  ["MongoDB", "mongodb", "mongo db"],
  ["Redis", "redis"],
  ["AWS", "aws", "amazon web services"],
  ["Azure", "azure"],
  ["Google Cloud", "google cloud", "gcp"],
  ["Docker", "docker"],
  ["Kubernetes", "kubernetes", "k8s"],
  ["Terraform", "terraform"],
  ["Git", "git"],
  ["CI/CD", "ci/cd", "ci cd", "continuous integration"],
  ["REST", "rest", "restful"],
  ["GraphQL", "graphql"],
  ["HTML", "html", "html5"],
  ["CSS", "css", "css3"],
  ["Tailwind CSS", "tailwind"],
  ["Jest", "jest"],
  ["Playwright", "playwright"],
  ["Cypress", "cypress"],
  ["Django", "django"],
  ["FastAPI", "fastapi"],
  ["Spring", "spring", "spring boot"],
  ["NestJS", "nestjs", "nest.js"],
  ["Express", "express", "express.js"],
  ["React Native", "react native"],
  ["Flutter", "flutter"],
  ["Figma", "figma"],
  ["Excel", "excel"],
  ["Power BI", "power bi", "powerbi"],
  ["Tableau", "tableau"],
  ["Salesforce", "salesforce"],
  ["Project management", "project management"],
  ["Data analysis", "data analysis"],
  ["Machine learning", "machine learning"],
  ["Communication", "communication"],
] as const;

export function mentions(text: string, phrase: string) {
  const escaped = phrase.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return !!escaped && new RegExp(`(^|[^a-z0-9+#])${escaped}(?=$|[^a-z0-9+#])`, "i").test(text);
}

export function jobInsights(job: Pick<Job, "title" | "description">, profile: Profile) {
  const text = `${job.title}\n${job.description}`;
  const groups: { name: string; aliases: readonly string[] }[] = skillGroups.map(
    ([name, ...aliases]) => ({ name, aliases }),
  );
  for (const skill of profile.skills.filter((s) => s.trim())) {
    if (
      !groups.some((g) =>
        [g.name, ...g.aliases].some((a) => a.toLowerCase() === skill.trim().toLowerCase()),
      )
    )
      groups.push({ name: skill.trim(), aliases: [skill.trim()] });
  }
  // Only explicitly listed skills count as capabilities. A sentence saying
  // "I have no AWS experience" must never become an AWS qualification.
  const evidenceText = profile.skills.join("\n");
  const mentioned = groups.filter((g) => g.aliases.some((a) => mentions(text, a)));
  const supported = mentioned.filter((g) =>
    [g.name, ...g.aliases].some((a) => mentions(evidenceText, a)),
  );
  const missing = mentioned.filter((g) => !supported.includes(g));
  const examples = [profile.experience, profile.projects]
    .flatMap((s) => s.split(/\n+|(?<=[.!?])\s+(?=[A-Z])/))
    .map((s) => s.replace(/^\s*[-•]\s*/, "").trim())
    .filter((s) => s.length >= 20 && s.length <= 700);
  const ranked = [...new Set(examples)]
    .map((quote) => ({
      quote,
      matches: supported.filter((g) => g.aliases.some((a) => mentions(quote, a))).length,
    }))
    .filter((e) => e.matches > 0)
    .sort((a, b) => b.matches - a.matches)
    .slice(0, 2);
  const requirements = [
    ...new Set(
      job.description
        .split(/\n+|(?<=[.!?])\s+(?=[A-Z])/)
        .map((s) => s.trim())
        .filter((s) =>
          /\b(?:\d+\s*(?:\+|[-–]\s*\d+)?\s*years?|visa|sponsorship|work authori[sz]ation|bachelor|master|degree|certification|must|required)\b/i.test(
            s,
          ),
        ),
    ),
  ]
    .slice(0, 6)
    .map((s) => (s.length > 500 ? `${s.slice(0, 497)}…` : s));
  return {
    mentioned: mentioned.map((g) => g.name),
    supported: supported.map((g) => g.name),
    missing: missing.map((g) => g.name),
    evidence: ranked.map((e) => e.quote),
    requirements,
    suggestions: [
      ...(supported.length
        ? [
            `Emphasize ${supported
              .slice(0, 5)
              .map((g) => g.name)
              .join(", ")} with a specific example from your work.`,
          ]
        : [
            "Add a concrete project or responsibility relevant to this role before writing your email.",
          ]),
      ...(missing.length
        ? [
            `Check ${missing
              .slice(0, 6)
              .map((g) => g.name)
              .join(
                ", ",
              )} in the listing. Add them to your profile only if you have that experience; otherwise treat them as gaps to discuss or learn.`,
          ]
        : []),
      ...(!ranked.length
        ? [
            "Your profile has no short work example mentioning these skills. Add what you built, your contribution, and an outcome you can verify.",
          ]
        : []),
      "Check required versus preferred qualifications, seniority, location, and work eligibility in the full description.",
    ],
  };
}
