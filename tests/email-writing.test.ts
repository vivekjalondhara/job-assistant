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
