import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";
import { z } from "zod";

const directory = mkdtempSync(path.join(tmpdir(), "folio-tests-"));
process.env.DATA_DIR = directory;
process.env.APP_URL = "http://localhost:3210";
const store = await import("../src/lib/db");
const security = await import("../src/lib/security");
const { matchJob } = await import("../src/lib/matching");
const { inferBoard, scanCompany } = await import("../src/lib/jobs");
const { importCsv } = await import("../src/lib/imports");
const { action } = await import("../src/lib/service");
const { approveDraft, sendDraft, draftHash, validateDraft } = await import("../src/lib/gmail");
const { generate } = await import("../src/lib/ai");
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
