import { test } from "node:test";
import assert from "node:assert/strict";
import { localEmail } from "../src/lib/local-email";
import { emptyProfile } from "../src/lib/types";
import { jobSchema } from "../src/lib/validation";
import { contentChecks } from "../src/lib/email-checks";

const profile = {
  ...emptyProfile,
  name: "Test Candidate",
  confirmed: true,
  tone: "formal" as const,
  experience:
    "I am a Full Stack Software Engineer with 3.5+ years of experience building SaaS applications. I improved email synchronization speed by 60%. I mentored 60+ developers and trainees.",
  skills: ["React.js", "Node.js", "TypeScript", "PostgreSQL"],
  portfolio: "https://example.com/work",
  signature: "Test Candidate\nPortfolio: https://example.com/work",
  availability: "Available after 30 days",
};
const job = {
  companyId: "company",
  title: "Full Stack Software Engineer",
  description: "Join a growing product team building enterprise software for our customers.",
  location: "Remote",
  url: "",
  applyUrl: "",
  remote: true,
  salary: "",
};
const company = { name: "Example Company" };

test("a sparse listing still produces a substantive professional email using confirmed facts", () => {
  const result = localEmail(job, company, profile, true);
  assert.match(result.body, /^Dear Hiring Team,/);
  assert.match(result.body, /Full Stack Software Engineer position at Example Company/);
  assert.match(result.body, /3\.5\+ years/);
  assert.match(result.body, /email synchronization speed by 60%/);
  assert.match(result.body, /mentored 60\+ developers/);
  assert.match(result.body, /React\.js, Node\.js, TypeScript, PostgreSQL/);
  assert.match(result.body, /attached my résumé/);
  assert.match(result.body, /I am available after 30 days\./);
  assert.equal(result.body.split(profile.portfolio).length - 1, 1);
  assert.ok(result.evidence.some((evidence) => evidence.includes("60%")));
  assert.ok(!result.body.includes("how my background relates"));
});

test("URL titles are rejected at job creation and by the local writer for existing jobs", () => {
  for (const title of [
    "https://job-assistant-nine.vercel.app/?view=companies",
    "www.example.com/jobs/123",
    "example.com/jobs/123",
    "Full Stack Engineer https://example.com/jobs/123",
  ]) {
    assert.equal(jobSchema.safeParse({ ...job, title }).success, false, title);
    assert.throws(() => localEmail({ ...job, title }, company, profile, false), /job title.*URL/i);
  }
  assert.equal(
    jobSchema.safeParse({ ...job, title: "Node.js / React.js Developer" }).success,
    true,
  );
});

test("concise drafting stays shorter and unprovided claims or attachments are never added", () => {
  const concise = localEmail(job, company, { ...profile, tone: "concise" }, false);
  const formal = localEmail(job, company, profile, false);
  assert.ok(concise.body.length < formal.body.length);
  assert.ok(!formal.body.includes("attached"));
  const sparse = localEmail(
    job,
    company,
    { ...profile, experience: "Built a React.js interface for a scheduling application." },
    false,
  );
  assert.ok(!sparse.body.includes("3.5"));
  assert.ok(!sparse.body.includes("60%"));
  assert.ok(!sparse.body.includes("60+ developers"));
});

test("unmatched employer requirements are not turned into candidate skills", () => {
  const result = localEmail(
    { ...job, description: "AWS and Kubernetes experience required for this software position." },
    company,
    profile,
    false,
  );
  assert.ok(!result.body.includes("AWS"));
  assert.ok(!result.body.includes("Kubernetes"));
  assert.match(result.reviewNotes.join(" "), /AWS, Kubernetes/);
});

test("a substantive application plus a contact signature does not trigger a short-template warning", () => {
  const checks = contentChecks({
    to: "careers@example.com",
    subject: "Application for Full Stack Software Engineer",
    body: "word ".repeat(270),
    resumeId: "",
  });
  assert.equal(checks.find((check) => check.id === "length")?.status, "pass");
});

const { emailTemplates, defaultWritingOptions, emailWordCount, candidateSignature } =
  await import("../src/lib/email-writing");
const { jobInsights } = await import("../src/lib/job-insights");
const { writingOptionsSchema } = await import("../src/lib/validation");

test("backend and full-stack descriptions select different verified examples and at most four skills", () => {
  const candidate = {
    ...profile,
    experience:
      "I am a software engineer with 4 years of experience. Built a React dashboard with accessible components and reduced page load time by 40%. Optimized PostgreSQL queries for Node.js APIs and reduced latency by 60%.",
    projects:
      "Designed a Node.js API with PostgreSQL connection pooling for reliable background processing.",
    skills: ["React", "CSS", "Node.js", "PostgreSQL", "TypeScript", "Docker", "AWS"],
  };
  const backend = {
    title: "Backend Engineer",
    description:
      "Optimize PostgreSQL queries and Node.js API latency. Own reliable background processing and connection pooling.",
  };
  const frontend = {
    title: "Full Stack Developer",
    description:
      "Build accessible React dashboard components. Improve page load time. Integrate Node.js APIs.",
  };
  const backendEmail = localEmail(backend, company, candidate, false);
  const frontendEmail = localEmail(frontend, company, candidate, false);
  assert.match(backendEmail.body, /latency by 60%/);
  assert.doesNotMatch(backendEmail.body, /page load time by 40%/);
  assert.match(frontendEmail.body, /page load time by 40%/);
  assert.equal(
    jobInsights(backend, candidate).rankedEvidence.find((e) => e.quote.includes("latency by 60%"))
      ?.field,
    "experience",
  );
  assert.doesNotMatch(backendEmail.body, /AWS|Docker|CSS/);
});

test("short and achievement templates honor their targets and preserve complete metrics", () => {
  for (const template of ["short", "achievement", "standard"] as const) {
    const options = {
      ...defaultWritingOptions(),
      template,
      minWords: emailTemplates[template].minWords,
      maxWords: emailTemplates[template].maxWords,
    };
    const result = localEmail(job, company, profile, true, options);
    assert.ok(emailWordCount(result.body, profile.signature) <= options.maxWords);
    assert.equal(result.body.split(profile.portfolio).length - 1, 1);
    assert.match(result.body, /attached my résumé/);
    assert.equal(
      contentChecks({ ...result, to: "jobs@example.com", resumeId: "resume" }).filter(
        (c) => c.status === "error",
      ).length,
      0,
    );
  }
});

test("follow-up template references a real email without inventing a conversation or form submission", () => {
  const options = defaultWritingOptions(profile, true);
  assert.throws(() => localEmail(job, company, profile, false, options), /actual sent application/);
  const result = localEmail(job, company, profile, false, options, {
    subject: "Re: My application",
    sentAt: "2026-10-01T10:00:00.000Z",
  });
  assert.equal(result.subject, "Re: My application");
  assert.match(result.body, /previous application email/);
  assert.match(result.body, /Example Company/);
  assert.doesNotMatch(result.body, /interview|conversation|attached|submitted/i);
  const words = emailWordCount(result.body, profile.signature);
  assert.ok(words >= 50 && words <= 90, String(words));
});

test("word counts exclude configured contact signatures and invalid ranges are rejected", () => {
  const signature = candidateSignature({
    name: "Test Candidate",
    email: "test@example.com",
    signature: "",
  });
  assert.equal(signature, "Test Candidate\ntest@example.com");
  assert.equal(emailWordCount(`Hello hiring team.\n\nBest regards,\n${signature}`, signature), 3);
  for (const options of [
    { minWords: 100, maxWords: 60 },
    { minWords: 0, maxWords: 180 },
    { minWords: 60, maxWords: 301 },
    { minWords: 60.5, maxWords: 100 },
  ])
    assert.equal(
      writingOptionsSchema.safeParse({ ...defaultWritingOptions(), ...options }).success,
      false,
    );
});

test("exact title and candidate placeholders are caught before sending", () => {
  for (const text of ["[Exact Job Title]", "[Candidate Name]", "[Position]", "{{company}}"])
    assert.equal(
      contentChecks({
        to: "test@example.com",
        subject: `Application for ${text}`,
        body: "Please consider my application for this position.",
        resumeId: "",
      }).find((c) => c.id === "placeholders")?.status,
      "error",
    );
});
