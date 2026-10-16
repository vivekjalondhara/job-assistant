import { after, beforeEach, test } from "./scoped-test";
import assert from "node:assert/strict";
import { setupTestStorage } from "./setup";
import {
  defaultPreferences,
  emptyProfile,
  type Company,
  type Draft,
  type Job,
} from "../src/lib/types";
import { emptyRequirements, extractRequirements } from "../src/lib/job-preferences";
import { matchJob } from "../src/lib/matching";
import { builtinTemplates, renderEmailTemplate } from "../src/lib/email-templates";
import { contentChecks } from "../src/lib/email-checks";
import { dailyJobs, filterJobs } from "../src/lib/career-tools";
const cleanup = await setupTestStorage();
const store = await import("../src/lib/db");
const { action, state } = await import("../src/lib/service");
const { uploadResume, readResume } = await import("../src/lib/files");
const { syncReplies } = await import("../src/lib/gmail");
const { encrypt } = await import("../src/lib/security");
const { scanCompany } = await import("../src/lib/jobs");
const originalFetch = global.fetch;
beforeEach(async () => {
  await store.query("DELETE FROM folio_records; DELETE FROM folio_tasks;");
  global.fetch = async () => {
    throw new Error("Unexpected external request");
  };
  process.env.GOOGLE_ALLOWED_EMAIL = "owner@example.com";
});
after(async () => {
  global.fetch = originalFetch;
  await store.closeDatabase();
  await cleanup();
});
const candidate = {
  ...emptyProfile,
  name: "Candidate",
  confirmed: true,
  skills: ["React", "TypeScript"],
  experience: "Built an accessible React application using TypeScript.",
  targetRoles: ["Frontend engineer"],
  preferences: {
    ...defaultPreferences,
    experienceYears: 2,
    seniority: "junior",
    workCountries: ["India"],
  },
};
const listing = {
  companyName: "Example",
  title: "Frontend engineer",
  description:
    "Build accessible React applications using TypeScript. Requires 2 years of experience. Remote from India only.",
  location: "Remote",
  remote: true,
  url: "https://example.com/jobs/123",
  applyUrl: "https://example.com/jobs/123",
  salary: "",
  requirements: {
    ...emptyRequirements,
    experienceMin: 2,
    seniority: "junior",
    workplace: "remote",
    eligibleCountries: ["India"],
  },
};
async function createJob() {
  await store.put("profile", { ...candidate, updatedAt: store.now() });
  const result = await action("job.import", listing);
  assert.ok(result && "jobId" in result && result.jobId);
  return (await store.get<Job>("job", result.jobId))!;
}

test("structured experience, country restrictions and salary distinguish fit from skill overlap", () => {
  const good = matchJob(listing, candidate)!;
  assert.equal(good.recommendation, "good");
  assert.equal(good.skillScore, 100);
  assert.equal(
    matchJob(listing, { ...candidate, preferredLocations: ["India"] })?.recommendation,
    "good",
    "A country-eligible remote job should not fail a city/location text comparison",
  );
  const senior = matchJob(
    {
      ...listing,
      title: "Senior frontend engineer",
      requirements: { ...listing.requirements, experienceMin: 8, seniority: "senior" },
    },
    candidate,
  )!;
  assert.equal(senior.recommendation, "stretch");
  assert.ok(senior.score < good.score);
  const us = matchJob(
    { ...listing, requirements: { ...listing.requirements, eligibleCountries: ["USA"] } },
    candidate,
  )!;
  assert.equal(us.recommendation, "poor");
  const unknown = matchJob(
    { ...listing, requirements: { ...listing.requirements, eligibleCountries: [] } },
    candidate,
  )!;
  assert.equal(unknown.recommendation, "review");
  const salaryProfile = {
    ...candidate,
    preferences: { ...candidate.preferences, salaryMin: 1000000 },
  };
  const low = matchJob(
    {
      ...listing,
      requirements: {
        ...listing.requirements,
        salaryMax: 900000,
        salaryCurrency: "INR",
        salaryPeriod: "year",
      },
    },
    salaryProfile,
  )!;
  assert.equal(low.recommendation, "poor");
  const differentCurrency = matchJob(
    {
      ...listing,
      requirements: {
        ...listing.requirements,
        salaryMax: 900000,
        salaryCurrency: "USD",
        salaryPeriod: "year",
      },
    },
    salaryProfile,
  )!;
  assert.equal(differentCurrency.checks?.find((c) => c.label === "Salary")?.status, "unknown");
});

test("preferred skill gaps have less weight and optional years do not become mandatory", () => {
  const required = matchJob(
    { ...listing, description: listing.description + " AWS required." },
    candidate,
  )!;
  const preferred = matchJob(
    { ...listing, description: listing.description + " AWS preferred." },
    candidate,
  )!;
  assert.ok(preferred.skillScore! > required.skillScore!);
  assert.equal(required.recommendation, "stretch");
  assert.equal(preferred.recommendation, "good");
  const r = extractRequirements({
    ...listing,
    description:
      "Requires 2 years of experience.\nPreferred qualifications:\n8 years of experience.",
  });
  assert.equal(r.experienceMin, 2);
  assert.equal(
    extractRequirements({
      ...listing,
      description: "Requires 8 years of experience or a degree and 2 years of experience.",
    }).experienceMin,
    null,
  );
});

test("templates fill literal values, retain missing fields, and never send messages", async () => {
  const template = builtinTemplates[0];
  const unresolved = renderEmailTemplate(template, candidate);
  assert.ok(unresolved.missing.includes("company"));
  assert.ok(
    contentChecks({ ...unresolved, to: "hr@example.com", resumeId: "" }).some(
      (c) => c.id === "placeholders" && c.status === "error",
    ),
  );
  const complete = renderEmailTemplate(template, candidate, undefined, undefined, {
    role: "Frontend engineer",
    company: "$& Example",
    work_example: candidate.experience,
  });
  assert.equal(complete.missing.length, 0);
  assert.ok(complete.body.includes("$& Example"));
  await action("template.save", { ...template, name: "My intro", id: undefined });
  const templates = (await state()).templates!;
  const saved = templates.find((t) => !t.builtin)!;
  assert.ok(saved);
  await action("template.save", { ...saved, name: "Updated intro" });
  assert.equal((await store.get<any>("template", saved.id)).name, "Updated intro");
  await action("template.delete", { id: saved.id });
  assert.equal(await store.get("template", saved.id), null);
  assert.equal((await store.all("draft")).length, 0);
});

test("job import previews text and deduplicates links with tracking parameters", async () => {
  const preview = await action("job.preview", {
    url: listing.url,
    description: `Title: Frontend engineer\nCompany: Example\nLocation: Remote\n${listing.description}`,
  });
  assert.ok(preview && "preview" in preview);
  assert.equal(preview.preview?.title, "Frontend engineer");
  const job = await createJob();
  const duplicate = await action("job.import", {
    ...listing,
    url: listing.url + "?utm_source=feed",
    applyUrl: listing.applyUrl + "?ref=feed",
  });
  assert.equal(duplicate && "jobId" in duplicate && duplicate.jobId, job.id);
  assert.equal((await store.all("job")).length, 1);
  assert.equal((await store.all("company")).length, 1);
});

test("job URL extraction only fetches supported public provider endpoints", async () => {
  let requests = 0;
  global.fetch = async (input) => {
    requests++;
    assert.equal(
      String(input),
      "https://boards-api.greenhouse.io/v1/boards/example/jobs/123?questions=false",
    );
    return Response.json({
      title: listing.title,
      content: listing.description,
      location: { name: "Remote" },
      absolute_url: listing.url,
    });
  };
  for (const url of [
    "http://127.0.0.1/admin",
    "https://jobs.ashbyhq.com.evil.example/a/b",
    "https://jobs.lever.co:444/a/b",
    "https://user:pass@jobs.lever.co/a/b",
  ])
    await assert.rejects(
      action("job.preview", { url, description: "" }),
      /Paste the job description/,
    );
  assert.equal(requests, 0);
  const result = await action("job.preview", {
    url: "https://boards.greenhouse.io/example/jobs/123",
    description: "",
  });
  assert.ok(result && "preview" in result && result.preview?.title === listing.title);
  assert.equal(requests, 1);
});

test("saved searches persist and filter location, arrangement, type and freshness", async () => {
  const job = await createJob();
  const search = {
    name: "India frontend",
    query: "React",
    location: "Remote",
    workplace: "remote",
    employmentType: "",
    maxAgeDays: 7,
  };
  await action("search.save", search);
  const data = await state();
  assert.equal(data.searches?.length, 1);
  assert.equal(filterJobs([job], search, data.companies).length, 1);
  assert.equal(filterJobs([job], { ...search, workplace: "hybrid" }, data.companies).length, 0);
  assert.equal(
    filterJobs([{ ...job, createdAt: "2020-01-01T00:00:00.000Z" }], search, data.companies).length,
    0,
  );
  await action("search.delete", { id: data.searches![0].id });
  assert.equal((await state()).searches?.length, 0);
});

test("application details and status history persist without invalidating job facts", async () => {
  const job = await createJob();
  await action("job.application", { id: job.id, status: "submitted" });
  const submitted = (await store.get<Job>("job", job.id))!;
  assert.ok(submitted.application?.submittedAt);
  assert.equal(submitted.application?.history.length, 1);
  await action("application.save", {
    ...submitted.application,
    id: job.id,
    notes: "Discuss accessibility project",
    recruiterName: "Recruiter",
    recruiterEmail: "hr@example.com",
    nextAction: "Prepare examples",
    reminderAt: "2027-01-01T09:00:00.000Z",
  });
  await action("job.application", { id: job.id, status: "interview" });
  const updated = (await store.get<Job>("job", job.id))!;
  assert.equal(updated.application?.notes, "Discuss accessibility project");
  assert.equal(updated.application?.history.length, 2);
  assert.equal(updated.updatedAt, job.updatedAt);
  await assert.rejects(
    action("application.save", { ...updated.application, id: job.id, reminderAt: "bad date" }),
  );
  await action("application.save", { ...updated.application, id: job.id, status: "offer" });
  assert.equal((await store.get<Job>("job", job.id))?.applicationStatus, "offer");
  assert.equal(
    (await store.all("draft")).length,
    0,
    "Formal submissions can be tracked without creating an email",
  );
});

test("résumé versions remain selectable after a new upload and draft edits preserve the attachment", async () => {
  const job = await createJob();
  const first = await uploadResume(
    new File(["Frontend experience building accessible React applications."], "frontend.txt"),
  );
  await store.put("profile", { ...(await store.profile()), confirmed: true });
  const result = await action("draft.create", { id: job.id });
  assert.ok(result && "draftId" in result && result.draftId);
  const draft = (await store.get<Draft>("draft", result.draftId))!;
  const second = await uploadResume(
    new File(["Backend experience building resilient Node.js applications."], "backend.txt"),
  );
  await action("draft.save", {
    id: draft.id,
    version: draft.version,
    to: "hr@example.com",
    subject: "Frontend application",
    body: "Hello, I would like to apply for this frontend role. Thank you for your time.",
    attachResume: true,
    resumeId: first.id,
  });
  const saved = (await store.get<Draft>("draft", draft.id))!;
  assert.equal(saved.resumeId, first.id);
  assert.equal((await store.profile()).resumeId, first.id);
  await action("resume.label", {
    id: first.id,
    label: "Frontend version",
    targetRole: "Frontend engineer",
  });
  await action("resume.select", { id: first.id });
  assert.match((await store.profile()).resumeText, /accessible React/);
  assert.equal((await store.profile()).confirmed, false);
  assert.equal((await state()).resumes?.length, 2);
  assert.equal(
    (await readResume(first.id)).buffer.toString(),
    "Frontend experience building accessible React applications.",
  );
  await assert.rejects(
    action("draft.save", {
      id: saved.id,
      version: saved.version,
      to: saved.to,
      subject: saved.subject,
      body: saved.body,
      attachResume: true,
      resumeId: store.id(),
    }),
    /uploaded résumé/,
  );
});

test("Today excludes submitted, skipped and contacted jobs", async () => {
  const job = await createJob();
  const data = await state();
  assert.equal(dailyJobs(data)[0].id, job.id);
  for (const variant of [
    { ...job, status: "skipped" as const },
    { ...job, applicationStatus: "submitted" as const },
  ])
    assert.equal(dailyJobs({ ...data, jobs: [variant] }).length, 0);
  const result = await action("draft.create", { id: job.id });
  assert.ok(result && "draftId" in result && result.draftId);
  const draft = (await store.get<Draft>("draft", result.draftId))!;
  assert.equal(dailyJobs({ ...data, drafts: [{ ...draft, status: "sent" }] }).length, 0);
});

test("feed updates preserve application notes and malformed feed IDs cannot close valid jobs", async () => {
  const job = await createJob();
  const company = (await store.get<Company>("company", job.companyId))!;
  await store.put("company", { ...company, source: "greenhouse", board: "example" });
  await store.put("job", { ...job, source: "greenhouse", sourceId: "123" });
  await action("job.application", { id: job.id, status: "interview" });
  global.fetch = async () =>
    Response.json({
      jobs: [
        {
          id: 123,
          title: job.title,
          content: job.description,
          location: { name: "Remote" },
          absolute_url: job.url,
        },
      ],
    });
  await scanCompany(company.id);
  const refreshed = (await store.get<Job>("job", job.id))!;
  assert.equal(refreshed.application?.history[0].status, "interview");
  global.fetch = async () => Response.json({ jobs: [{ title: job.title, absolute_url: job.url }] });
  await assert.rejects(scanCompany(company.id), /incomplete/);
  assert.notEqual((await store.get<Job>("job", job.id))?.status, "closed");
});

test("Gmail drafts and own messages do not count as incoming replies", async () => {
  const job = await createJob();
  const result = await action("draft.create", { id: job.id });
  assert.ok(result && "draftId" in result && result.draftId);
  const draft = (await store.get<Draft>("draft", result.draftId))!;
  const sentAt = new Date(Date.now() - 10000).toISOString();
  await store.put("draft", {
    ...draft,
    status: "sent",
    sentAt,
    gmailAccountEmail: "owner@example.com",
    threadId: "thread-1",
    sentMessageId: "sent-1",
  });
  await store.put("secret", {
    id: "gmail",
    value: encrypt({
      email: "owner@example.com",
      accessToken: "test",
      refreshToken: "test",
      expiresAt: Date.now() + 3600000,
      needsReconnect: false,
    }),
  });
  global.fetch = async () =>
    Response.json({
      messages: [
        {
          id: "draft-1",
          internalDate: String(Date.now()),
          labelIds: ["DRAFT"],
          payload: { headers: [] },
        },
        {
          id: "own-1",
          internalDate: String(Date.now()),
          labelIds: [],
          payload: { headers: [{ name: "From", value: "Owner <owner@example.com>" }] },
        },
      ],
    });
  await syncReplies();
  assert.equal((await store.get<Draft>("draft", draft.id))?.replyStatus, "none");
  global.fetch = async () =>
    Response.json({
      messages: [
        {
          id: "reply-1",
          internalDate: String(Date.now()),
          labelIds: ["INBOX"],
          payload: { headers: [{ name: "From", value: "hr@example.com" }] },
        },
      ],
    });
  await syncReplies();
  assert.equal((await store.get<Draft>("draft", draft.id))?.replyStatus, "reply");
});
