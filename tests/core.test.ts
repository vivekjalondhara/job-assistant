import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";
import { z } from "zod";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EmailPanel } from "../src/components/email-panel";

const directory = mkdtempSync(path.join(tmpdir(), "folio-tests-"));
process.env.DATA_DIR = directory;
process.env.APP_URL = "http://localhost:3210";
const store = await import("../src/lib/db");
const security = await import("../src/lib/security");
const { matchJob } = await import("../src/lib/matching");
const { inferBoard, scanCompany } = await import("../src/lib/jobs");
const { importCsv } = await import("../src/lib/imports");
const { action, state } = await import("../src/lib/service");
const { approveDraft, sendDraft, draftHash, validateDraft } = await import("../src/lib/gmail");
const { generate, writeEmail } = await import("../src/lib/ai");
const { jobInsights, mentions } = await import("../src/lib/job-insights");
const { contentChecks, applicationChecks } = await import("../src/lib/email-checks");
const { localEmail } = await import("../src/lib/local-email");
const { profileSchema } = await import("../src/lib/validation");
const { uploadResume, readResume } = await import("../src/lib/files");
const { emptyProfile } = await import("../src/lib/types");
type Draft = import("../src/lib/types").Draft;
type Job = import("../src/lib/types").Job;
type Company = import("../src/lib/types").Company;
const originalFetch = global.fetch;
beforeEach(() => {
  global.fetch = originalFetch;
  store.db().exec("DELETE FROM records; DELETE FROM tasks;");
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_MODEL;
});
after(() => {
  global.fetch = originalFetch;
  store.db().close();
  rmSync(directory, { recursive: true, force: true });
});
function fixtures() {
  const at = store.now();
  const p = {
    ...emptyProfile,
    name: "Test Candidate",
    skills: ["Node.js", "PostgreSQL"],
    experience: "Built a Node.js API with PostgreSQL.",
    confirmed: true,
    updatedAt: at,
  };
  store.put("profile", p);
  const company: Company = {
    id: store.id(),
    name: "Test Company",
    website: "https://example.com",
    careersUrl: "",
    source: "manual",
    board: "",
    email: "careers@example.com",
    contactSource: "https://example.com/careers",
    contactConfirmed: true,
    priority: "normal",
    paused: false,
    lastChecked: at,
    checkStatus: "success",
    checkNote: "",
    createdAt: at,
  };
  store.put("company", company);
  const job: Job = {
    id: store.id(),
    companyId: company.id,
    sourceId: "123",
    title: "Backend engineer",
    location: "Remote",
    remote: true,
    description: "Build Node.js APIs with PostgreSQL. We are hiring backend engineers.",
    url: "https://example.com/jobs/123",
    applyUrl: "https://example.com/jobs/123",
    salary: "",
    status: "shortlisted",
    applicationStatus: "not_submitted",
    source: "manual",
    match: null,
    checkedAt: at,
    publishedAt: null,
    createdAt: at,
    updatedAt: at,
  };
  store.put("job", job);
  const draft: Draft = {
    id: store.id(),
    jobId: job.id,
    companyId: company.id,
    to: company.email,
    subject: "Backend engineer application",
    body: "Hi Hiring Team,\n\nI built a Node.js API with PostgreSQL and would like to discuss your backend role.\n\nThanks,\nTest Candidate",
    resumeId: "",
    resumeName: "",
    evidence: [],
    reviewNotes: [],
    model: "Manual",
    status: "gmail_draft",
    version: 1,
    approvedHash: null,
    approvedAt: null,
    gmailDraftId: "draft-test",
    gmailRawHash: security.digest("raw-v1"),
    sentMessageId: null,
    threadId: null,
    sentAt: null,
    replyStatus: "none",
    lastReplyAt: null,
    followUpOf: null,
    profileUpdatedAt: at,
    jobUpdatedAt: at,
    createdAt: at,
    updatedAt: at,
  };
  store.put("draft", draft);
  store.put("secret", {
    id: "gmail",
    value: security.encrypt({
      email: "owner@example.com",
      accessToken: "test-access",
      refreshToken: "test-refresh",
      expiresAt: Date.now() + 3600000,
      needsReconnect: false,
    }),
  });
  return { p, company, job, draft };
}
function gmailMock(options: { raw?: string; failSend?: boolean } = {}) {
  let sends = 0;
  global.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("drafts/send")) {
      sends++;
      if (options.failSend) throw new Error("Connection lost after send");
      return Response.json({ id: "sent-1", threadId: "thread-1" });
    }
    if (url.includes("format=raw"))
      return Response.json({ message: { raw: options.raw || "raw-v1" } });
    throw new Error(`Unexpected request ${url}`);
  };
  return () => sends;
}
test("private data requires same-origin mutations; credentials are encrypted", () => {
  assert.throws(
    () =>
      security.assertSameOrigin(
        new Request("http://localhost:3210/api/action", {
          headers: { origin: "https://attacker.example" },
        }),
      ),
    /must come/,
  );
  assert.doesNotThrow(() =>
    security.assertSameOrigin(
      new Request("http://localhost:3210/api/action", {
        headers: { origin: "http://localhost:3210" },
      }),
    ),
  );
  const encrypted = security.encrypt({ token: "private-value" });
  assert.ok(!encrypted.includes("private-value"));
  assert.deepEqual(security.decrypt(encrypted), { token: "private-value" });
  security.setPassword("a-long-test-password");
  assert.equal(security.verifyPassword("a-long-test-password"), true);
  assert.equal(security.verifyPassword("wrong"), false);
  assert.throws(() => security.setPassword("a-different-password"), /already set up/);
});
test("ATS detection does not permit arbitrary fetch hosts or malicious slugs", () => {
  assert.deepEqual(inferBoard("https://jobs.ashbyhq.com/acme"), { source: "ashby", board: "acme" });
  assert.deepEqual(inferBoard("https://jobs.ashbyhq.com.attacker.example/acme"), {
    source: "manual",
    board: "",
  });
  assert.deepEqual(inferBoard("http://127.0.0.1/admin"), { source: "manual", board: "" });
  assert.deepEqual(inferBoard("https://jobs.ashbyhq.com/a%2Fb"), { source: "manual", board: "" });
});
test("matching waits for profile confirmation and flags remote eligibility gaps", () => {
  const { p, job } = fixtures();
  assert.equal(matchJob(job, { ...p, confirmed: false }), null);
  const match = matchJob({ ...job, remote: false }, { ...p, remoteOnly: true })!;
  assert.ok(match.score <= 35);
  assert.ok(match.gaps.some((g) => g.includes("Remote")));
  assert.equal(match.method, "rules");
});
test("CSV imports deduplicate companies, keep contact unconfirmed, and reject bad headers", () => {
  const csv =
    "Company,Website,Careers URL,Recruitment email\nExample,https://example.com,https://jobs.ashbyhq.com/example,hr@example.com\n";
  assert.equal(importCsv(csv).companies, 1);
  assert.equal(importCsv(csv).companies, 0);
  assert.equal(store.all<Company>("company")[0].contactConfirmed, false);
  assert.throws(() => importCsv("Something,Else\na,b"), /column/);
});
test("failed scans preserve listings and successful scans close only absent source jobs", async () => {
  const { company, job } = fixtures();
  store.put("company", { ...company, source: "ashby", board: "example" });
  store.put("job", { ...job, source: "ashby" });
  global.fetch = async () => new Response("Unavailable", { status: 503 });
  await assert.rejects(scanCompany(company.id));
  assert.equal(store.get<Job>("job", job.id)?.status, "shortlisted");
  global.fetch = async () => Response.json({ jobs: [] });
  await scanCompany(company.id);
  assert.equal(store.get<Job>("job", job.id)?.status, "closed");
});
test("approval cannot be bypassed and approval rejects changes made in Gmail", async () => {
  const { draft } = fixtures();
  const sent = gmailMock({ raw: "changed-in-gmail" });
  await assert.rejects(sendDraft(draft.id), /approve/);
  await assert.rejects(approveDraft(draft.id, 1), /edited in Gmail/);
  assert.equal(sent(), 0);
});
test("editing any approved content invalidates approval and stale editors cannot overwrite", async () => {
  const { draft } = fixtures();
  gmailMock();
  await approveDraft(draft.id, 1);
  assert.equal(store.get<Draft>("draft", draft.id)?.status, "approved");
  await action("draft.save", {
    id: draft.id,
    version: 1,
    to: draft.to,
    subject: "An updated subject",
    body: draft.body,
    attachResume: false,
  });
  const saved = store.get<Draft>("draft", draft.id)!;
  assert.equal(saved.approvedHash, null);
  assert.equal(saved.status, "draft");
  await assert.rejects(
    action("draft.save", {
      id: draft.id,
      version: 1,
      to: draft.to,
      subject: "Stale",
      body: draft.body,
      attachResume: false,
    }),
    /another tab/,
  );
});
test("concurrent send clicks produce one send and keep formal application status separate", async () => {
  const { draft, job } = fixtures();
  const sent = gmailMock();
  await approveDraft(draft.id, 1);
  const results = await Promise.allSettled([sendDraft(draft.id), sendDraft(draft.id)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(sent(), 1);
  assert.equal(store.get<Draft>("draft", draft.id)?.status, "sent");
  assert.equal(store.get<Job>("job", job.id)?.applicationStatus, "not_submitted");
  await assert.rejects(sendDraft(draft.id));
  assert.equal(sent(), 1);
});
test("ambiguous sends are held and cannot be retried", async () => {
  const { draft } = fixtures();
  const sent = gmailMock({ failSend: true });
  await approveDraft(draft.id, 1);
  await assert.rejects(sendDraft(draft.id), /could not be confirmed/);
  assert.equal(store.get<Draft>("draft", draft.id)?.status, "uncertain");
  await assert.rejects(sendDraft(draft.id));
  assert.equal(sent(), 1);
});
test("paused company schedules do not bypass a fresh vacancy check before sending", async () => {
  const { draft, company, job } = fixtures();
  gmailMock();
  await approveDraft(draft.id, 1);
  store.put("company", {
    ...company,
    source: "ashby",
    board: "example",
    paused: true,
    lastChecked: null,
  });
  store.put("job", { ...job, source: "ashby" });
  let sends = 0;
  global.fetch = async (input) => {
    if (String(input).includes("posting-api")) return Response.json({ jobs: [] });
    sends++;
    throw new Error("Sending must not be reached");
  };
  await assert.rejects(sendDraft(draft.id), /no longer open/);
  assert.equal(sends, 0);
});
test("profile edits during the last Gmail check block sending", async () => {
  const { draft, p } = fixtures();
  gmailMock();
  await approveDraft(draft.id, 1);
  let sends = 0;
  global.fetch = async (input) => {
    if (String(input).includes("format=raw")) {
      store.put("profile", { ...p, updatedAt: "changed-during-request" });
      return Response.json({ message: { raw: "raw-v1" } });
    }
    sends++;
    return Response.json({ id: "unexpected-send" });
  };
  await assert.rejects(sendDraft(draft.id), /profile or the job changed/);
  assert.equal(sends, 0);
});
test("paused sending and changed profiles block sending", async () => {
  const { draft, p } = fixtures();
  const sent = gmailMock();
  await approveDraft(draft.id, 1);
  store.put("settings", { ...store.settings(), automationPaused: true });
  await assert.rejects(sendDraft(draft.id), /paused/);
  store.put("settings", { ...store.settings(), automationPaused: false });
  store.put("profile", { ...p, updatedAt: "2099-01-01T00:00:00Z" });
  await assert.rejects(sendDraft(draft.id), /profile or the job changed/);
  assert.equal(sent(), 0);
});
test("header injection, missing promised attachments, and placeholders are blocked", () => {
  const { draft } = fixtures();
  assert.throws(() => validateDraft({ ...draft, subject: "Hello\nBcc: other@example.com" }));
  assert.throws(() =>
    validateDraft({ ...draft, body: "I’ve attached my résumé. Please consider my application." }),
  );
  assert.throws(() =>
    validateDraft({ ...draft, body: "Hi [Recruiter Name], here is my application." }),
  );
});
test("OpenRouter enforces selected model and privacy controls and records actual cost only", async () => {
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.OPENROUTER_MODEL = "test/model";
  global.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "test/model");
    assert.equal(body.models, undefined);
    assert.equal(body.provider.zdr, true);
    assert.equal(body.provider.data_collection, "deny");
    assert.equal(body.provider.require_parameters, true);
    return Response.json({
      id: "raw-provider-id",
      model: "test/model",
      provider: "test-provider",
      choices: [{ message: { content: '{"answer":"ok"}' } }],
      usage: { cost: 0.002, prompt_tokens: 10, completion_tokens: 5 },
    });
  };
  const result = await generate("test", z.object({ answer: z.string() }), "Test", {});
  assert.equal(result.value.answer, "ok");
  const usage = store.all<import("../src/lib/types").Usage>("usage")[0];
  assert.equal(usage.cost, 0.002);
  assert.equal(usage.providerIdHash?.length, 64);
  assert.ok(!JSON.stringify(usage).includes("raw-provider-id"));
  global.fetch = async () =>
    Response.json({ choices: [{ message: { content: '{"answer":"ok"}' } }] });
  await generate("test", z.object({ answer: z.string() }), "Test", {});
  assert.equal(store.all<import("../src/lib/types").Usage>("usage")[0].cost, null);
});
test("TXT and DOCX uploads extract text, keep original attachments, and require reconfirmation", async () => {
  fixtures();
  const text = "Test Candidate\nBuilt an API with Node.js and PostgreSQL.";
  const file = await uploadResume(new File([text], "resume.txt", { type: "text/plain" }));
  assert.equal(readResume(file.id).buffer.toString(), text);
  assert.equal(store.profile().confirmed, false);
  const archive = zipSync({
    "word/document.xml": strToU8(
      "<w:document><w:body><w:p><w:r><w:t>Test Candidate built a Node.js API with PostgreSQL.</w:t></w:r></w:p></w:body></w:document>",
    ),
  });
  await uploadResume(new File([new Uint8Array(archive)], "resume.docx"));
  assert.match(store.profile().resumeText, /Node.js API/);
});

test("matching measures job skill coverage without penalizing unrelated candidate skills", () => {
  const { p, job } = fixtures();
  const original = matchJob(job, p)!;
  assert.equal(
    matchJob(job, { ...p, skills: [...p.skills, "Python", "Docker", "Figma"] })!.score,
    original.score,
  );
  const moreRequirements = matchJob(
    { ...job, description: `${job.description} AWS and Kubernetes required.` },
    p,
  )!;
  assert.ok(moreRequirements.score < original.score);
  assert.match(moreRequirements.gaps.join(" "), /AWS, Kubernetes/);
});

test("skill aliases, duplicate skills, and punctuation do not create false keyword matches", () => {
  const { p, job } = fixtures();
  const insights = jobInsights(
    { ...job, description: "Use NodeJS with Postgres, C++ and C#." },
    { ...p, skills: ["node.js", "Node.js", "PostgreSQL"] },
  );
  assert.deepEqual(insights.supported, ["Node.js", "PostgreSQL"]);
  assert.deepEqual(insights.missing, ["C++", "C#"]);
  assert.equal(mentions("JavaScript and JavaBeans", "Java"), false);
  assert.equal(mentions("C++ and C#", "C"), false);
  assert.equal(mentions("ReactNative", "React"), false);
  assert.equal(mentions("We use C++, C# and .NET.", "C++"), true);
});

test("guidance selects relevant exact work examples and quotes requirements without inventing qualifications", () => {
  const { p, job } = fixtures();
  const insights = jobInsights(
    {
      ...job,
      description: `${job.description}\nAWS required.\nMust have 5+ years of experience and work authorization.`,
    },
    {
      ...p,
      experience:
        "Designed event posters.\nBuilt a Node.js API with PostgreSQL.\nI have no AWS experience.",
    },
  );
  assert.deepEqual(insights.evidence, ["Built a Node.js API with PostgreSQL."]);
  assert.ok(insights.missing.includes("AWS"));
  assert.ok(!insights.supported.includes("AWS"));
  assert.ok(insights.requirements.some((requirement) => requirement.includes("5+ years")));
  assert.match(insights.suggestions.join(" "), /only if you have that experience/);
});

test("an unrelated engineering role is not a preferred role match just because it says engineer", () => {
  const { p, job } = fixtures();
  const result = matchJob(
    { ...job, title: "Mechanical engineer" },
    { ...p, targetRoles: ["Backend engineer"] },
  )!;
  assert.ok(result.gaps.some((gap) => gap.includes("preferred roles")));
});

test("local email uses the role, company, confirmed evidence, and selected attachment without external requests", async () => {
  const { draft, job, company, p } = fixtures();
  let requests = 0;
  global.fetch = async () => {
    requests++;
    throw new Error("Local generation must not call a provider");
  };
  await action("draft.template", { id: draft.id, version: draft.version });
  const generated = store.get<Draft>("draft", draft.id)!;
  assert.match(generated.subject, /Backend engineer/);
  assert.ok(generated.body.includes(company.name));
  assert.ok(generated.body.includes(p.experience));
  assert.equal(generated.model, "Local template");
  assert.equal(generated.version, draft.version + 1);
  assert.equal(generated.status, "draft");
  assert.equal(generated.approvedHash, null);
  assert.equal(generated.gmailRawHash, null);
  assert.equal(requests, 0);
  assert.ok(!generated.body.includes("attached"));
  assert.match(localEmail(job, company, p, true).body, /attached my résumé/);
});

test("local drafting rejects stale editors, unconfirmed facts, closed jobs, and follow-ups", async () => {
  const { p, draft, job } = fixtures();
  await assert.rejects(action("draft.template", { id: draft.id, version: 99 }), /another tab/);
  store.put("profile", { ...p, confirmed: false });
  await assert.rejects(
    action("draft.template", { id: draft.id, version: 1 }),
    /Confirm your profile/,
  );
  store.put("profile", p);
  store.put("job", { ...job, status: "closed" });
  await assert.rejects(action("draft.template", { id: draft.id, version: 1 }), /closed/);
  store.put("job", job);
  store.put("draft", { ...draft, followUpOf: store.id() });
  await assert.rejects(action("draft.template", { id: draft.id, version: 1 }), /follow-ups/);
  assert.equal(store.get<Draft>("draft", draft.id)?.body, draft.body);
});

test("local drafting cannot change sent, sending, or uncertain messages", async () => {
  const { draft } = fixtures();
  for (const status of ["sent", "sending", "uncertain"]) {
    store.put("draft", { ...draft, status });
    await assert.rejects(
      action("draft.template", { id: draft.id, version: 1 }),
      /cannot be edited/,
    );
    assert.equal(store.get<Draft>("draft", draft.id)?.status, status);
    assert.equal(store.get<Draft>("draft", draft.id)?.body, draft.body);
  }
});

test("draft checks detect subject placeholders, missing attachments, malformed recipients, and header injection", () => {
  const { draft } = fixtures();
  assert.equal(contentChecks(draft).filter((c) => c.status === "error").length, 0);
  for (const body of [
    "Please find my CV attached.",
    "My résumé is enclosed for your review.",
    "Hi {{recruiter}}, please review my application.",
  ]) {
    assert.throws(() => validateDraft({ ...draft, body }));
  }
  assert.throws(
    () => validateDraft({ ...draft, subject: "Application for [Job Title]" }),
    /placeholders/,
  );
  assert.throws(
    () => validateDraft({ ...draft, to: "one@example.com,two@example.com" }),
    /recipient/,
  );
  assert.throws(
    () => validateDraft({ ...draft, subject: "Hi\r\nBcc: leak@example.com" }),
    /one-line/,
  );
  assert.doesNotThrow(() =>
    validateDraft({ ...draft, resumeId: "resume", body: "Please find my CV attached." }),
  );
});

test("application checks flag changed facts, missing contact confirmation, and resolved applications", () => {
  const { draft, p, job, company } = fixtures();
  assert.equal(
    applicationChecks(draft, p, job, company).filter((c) => c.status === "error").length,
    0,
  );
  const checks = applicationChecks(
    draft,
    { ...p, updatedAt: "changed" },
    { ...job, applicationStatus: "rejected" },
    { ...company, contactConfirmed: false },
  );
  assert.deepEqual(
    checks.filter((c) => c.status === "error").map((c) => c.id),
    ["freshness", "contact", "resolved"],
  );
});

test("unconfirmed recruitment contacts and missing sources block approval on the server", async () => {
  const { company, draft } = fixtures();
  let requests = 0;
  global.fetch = async () => {
    requests++;
    throw new Error("Gmail must not be reached");
  };
  for (const changed of [
    { contactConfirmed: false },
    { contactSource: "" },
    { email: "different@example.com" },
  ]) {
    store.put("company", { ...company, ...changed });
    await assert.rejects(approveDraft(draft.id, draft.version), /Confirm this recruitment address/);
  }
  assert.equal(requests, 0);
  assert.equal(store.get<Draft>("draft", draft.id)?.approvedHash, null);
});

test("contact changes after approval prevent sending", async () => {
  const { company, draft } = fixtures();
  const sends = gmailMock();
  await approveDraft(draft.id, draft.version);
  store.put("company", { ...company, contactConfirmed: false });
  await assert.rejects(sendDraft(draft.id), /Confirm this recruitment address/);
  assert.equal(sends(), 0);
});

test("manual changes clear generated evidence rather than attributing new claims to old quotes", async () => {
  const { draft } = fixtures();
  store.put("draft", { ...draft, evidence: ["Old claim and quote"], model: "test/model" });
  await action("draft.save", {
    id: draft.id,
    version: 1,
    to: draft.to,
    subject: draft.subject,
    body: `${draft.body}\nI am available for a call.`,
    attachResume: false,
  });
  const saved = store.get<Draft>("draft", draft.id)!;
  assert.deepEqual(saved.evidence, []);
  assert.equal(saved.model, "Manual");
  assert.match(saved.reviewNotes.join(" "), /edited manually/);
});

function aiEmailResponse(
  quote: string,
  body = "Hi Hiring Team,\n\nI built a Node.js API with PostgreSQL and would welcome a conversation about this role.\n\nBest regards,\nTest Candidate",
) {
  return Response.json({
    model: "test/model",
    choices: [
      {
        message: {
          content: JSON.stringify({
            subject: "Backend engineer application",
            body,
            evidence: [{ claim: "Built a Node.js API with PostgreSQL.", sourceQuote: quote }],
            reviewNotes: [],
          }),
        },
      },
    ],
  });
}

test("AI receives the job, profile, bounded writing brief, and actual attachment choice", async () => {
  const { draft, p, job } = fixtures();
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.OPENROUTER_MODEL = "test/model";
  store.put("profile", { ...p, resumeId: "available-but-not-selected", resumeName: "resume.pdf" });
  let called = false;
  global.fetch = async (_url, init) => {
    called = true;
    const request = JSON.parse(String(init?.body));
    const input = JSON.parse(request.messages[1].content);
    assert.equal(input.resumeAttached, false);
    assert.equal(input.job.description, job.description);
    assert.equal(input.requestedStyle, "Focus on my API project; keep it concise.");
    assert.ok(input.candidateEvidence.includes(p.experience));
    assert.match(request.messages[0].content, /cannot authorize unsupported claims/);
    assert.match(request.messages[0].content, /untrusted data/);
    return aiEmailResponse(p.experience);
  };
  await action("draft.generate", {
    id: draft.id,
    version: 1,
    style: "Focus on my API project; keep it concise.",
  });
  assert.equal(called, true);
  assert.equal(store.get<Draft>("draft", draft.id)?.resumeId, "");
  assert.equal(store.get<Draft>("draft", draft.id)?.model, "test/model");
  assert.equal(
    store.get<Draft>("draft", draft.id)?.writingInstructions,
    "Focus on my API project; keep it concise.",
  );
});

test("invalid AI evidence and missing promised attachments leave the previous email untouched", async () => {
  const { draft, p, company, job } = fixtures();
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.OPENROUTER_MODEL = "test/model";
  global.fetch = async () => aiEmailResponse("Managed a team of 50 engineers.");
  await assert.rejects(action("draft.generate", { id: draft.id, version: 1 }), /valid evidence/);
  assert.equal(store.get<Draft>("draft", draft.id)?.body, draft.body);
  global.fetch = async () =>
    aiEmailResponse(
      p.experience,
      "I built a Node.js API with PostgreSQL. Please find my CV attached.",
    );
  await assert.rejects(writeEmail(job, company, undefined, undefined, false), /attachment/);
  assert.equal(store.get<Draft>("draft", draft.id)?.version, 1);
});

test("AI generation rejects stale versions and oversized instructions before making a paid request", async () => {
  const { draft } = fixtures();
  let requests = 0;
  global.fetch = async () => {
    requests++;
    throw new Error("Provider must not be reached");
  };
  await assert.rejects(action("draft.generate", { id: draft.id, version: 0 }), /another tab/);
  await assert.rejects(
    action("draft.generate", { id: draft.id, version: 1, style: "a".repeat(1001) }),
  );
  assert.equal(requests, 0);
});

test("profile validation rejects blank skills and normalizes case-insensitive duplicates", () => {
  const { p } = fixtures();
  assert.equal(profileSchema.safeParse({ ...p, skills: ["   "] }).success, false);
  assert.deepEqual(
    profileSchema.parse({ ...p, skills: ["Node.js", " node.js ", "PostgreSQL"] }).skills,
    ["Node.js", "PostgreSQL"],
  );
});

test("an empty stale draft can still be written from current profile facts while approval stays blocked", async () => {
  const { draft, p } = fixtures();
  store.put("draft", { ...draft, body: "", status: "draft" });
  store.put("profile", {
    ...p,
    updatedAt: "changed-profile",
    experience: "Built a Node.js API for scheduling interviews.",
  });
  const markup = renderToStaticMarkup(
    createElement(EmailPanel, {
      data: state(),
      selectedId: draft.id,
      setSelectedId: () => {},
      act: async () => null,
      busy: "",
      onFindJobs: () => {},
    }),
  );
  const buttons = [...markup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
  const write = buttons.find((button) => button[2].includes("Write from my profile"));
  assert.ok(write, "Local drafting control is available");
  assert.ok(!write[1].includes("disabled"), "Changed profile does not trap an empty draft");
  const approve = buttons.find((button) => button[2].includes("Approve this draft"));
  assert.ok(approve?.[1].includes("disabled"), "Stale content cannot be approved");
  await action("draft.template", { id: draft.id, version: 1 });
  const generated = store.get<Draft>("draft", draft.id)!;
  assert.match(generated.body, /scheduling interviews/);
  assert.equal(generated.profileUpdatedAt, "changed-profile");
});
