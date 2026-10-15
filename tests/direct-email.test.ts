import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EmailPanel } from "../src/components/email-panel";
import { setupTestStorage } from "./setup";
import type { Draft } from "../src/lib/types";

const cleanup = await setupTestStorage();
const store = await import("../src/lib/db");
const { encrypt } = await import("../src/lib/security");
const { action, state } = await import("../src/lib/service");
const { draftHash, saveGmailDraft, approveDraft, sendDraft } = await import("../src/lib/gmail");
const { applicationChecks } = await import("../src/lib/email-checks");
const originalFetch = global.fetch;
let sends: number;
let failSend: boolean;
let tamper: boolean;
let remoteDrafts: Map<string, string>;

beforeEach(async () => {
  await store.query("DELETE FROM folio_records; DELETE FROM folio_tasks;");
  process.env.GOOGLE_ALLOWED_EMAIL = "owner@example.com";
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_MODEL;
  sends = 0;
  failSend = false;
  tamper = false;
  remoteDrafts = new Map();
  await store.put("secret", {
    id: "gmail",
    value: encrypt({
      email: "owner@example.com",
      accessToken: "test-access",
      refreshToken: "test-refresh",
      expiresAt: Date.now() + 3600000,
      needsReconnect: false,
    }),
  });
  global.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname !== "gmail.googleapis.com")
      throw new Error(`Unexpected network request: ${url.hostname}`);
    if (url.pathname.endsWith("/drafts/send")) {
      sends++;
      if (failSend) throw new Error("Connection lost after sending");
      return Response.json({ id: `sent-${sends}`, threadId: `thread-${sends}` });
    }
    if (init?.method === "POST" || init?.method === "PUT") {
      const id =
        init.method === "POST" ? `draft-${remoteDrafts.size + 1}` : url.pathname.split("/").at(-1)!;
      const data = JSON.parse(String(init.body));
      remoteDrafts.set(id, data.message.raw);
      return Response.json({ id });
    }
    if (url.searchParams.get("format") === "raw") {
      const raw = remoteDrafts.get(url.pathname.split("/").at(-1)!);
      assert.ok(raw, "Only a saved Gmail draft can be read");
      return Response.json({ message: { raw: tamper ? "externally-edited" : raw } });
    }
    throw new Error(`Unexpected Gmail request: ${url.pathname}`);
  };
});

after(async () => {
  global.fetch = originalFetch;
  await store.closeDatabase();
  await cleanup();
});

const readDraft = async (id: string) => (await store.get<Draft>("draft", id))!;
async function compose(
  to = "recruiter@example.com",
  body = "Hello, I would like to ask about opportunities on your engineering team. Thank you.",
) {
  const result = await action("draft.direct", {});
  assert.ok(result && "draftId" in result && result.draftId);
  await action("draft.save", {
    id: result.draftId,
    version: 1,
    to,
    subject: "Engineering opportunities",
    body,
    attachResume: false,
  });
  return readDraft(result.draftId);
}
async function approve(draft: Draft) {
  await saveGmailDraft(draft.id);
  await action("draft.approve", { id: draft.id, version: draft.version, reviewed: true });
}

test("direct email can be composed, reviewed, and sent without a company, job, or profile", async () => {
  const draft = await compose();
  assert.equal(draft.kind, "direct");
  assert.equal(draft.companyId, "");
  assert.equal(draft.jobId, "");
  assert.equal(draft.resumeId, "");
  assert.equal((await store.profile()).confirmed, false);
  assert.equal(
    applicationChecks(draft, await store.profile()).filter((c) => c.status === "error").length,
    0,
  );
  await assert.rejects(sendDraft(draft.id), /approve/);
  await saveGmailDraft(draft.id);
  const raw = Buffer.from([...remoteDrafts.values()][0], "base64url").toString();
  assert.match(raw, /To: recruiter@example.com/);
  assert.match(raw, /Subject: Engineering opportunities/);
  await assert.rejects(
    action("draft.approve", { id: draft.id, version: draft.version, reviewed: false }),
  );
  await action("draft.approve", { id: draft.id, version: draft.version, reviewed: true });
  assert.equal(sends, 0, "Saving and approving must not send");
  await sendDraft(draft.id);
  assert.equal(sends, 1);
  assert.equal((await readDraft(draft.id)).status, "sent");
  assert.equal((await store.all("company")).length, 0);
  assert.equal((await store.all("job")).length, 0);
  await assert.rejects(sendDraft(draft.id), /approve/);
  assert.equal(sends, 1);
});

test("changing the direct recipient clears approval and requires saving and review again", async () => {
  const draft = await compose();
  await approve(draft);
  const approved = await readDraft(draft.id);
  assert.notEqual(draftHash(approved), draftHash({ ...approved, kind: "application" }));
  await action("draft.save", {
    id: draft.id,
    version: draft.version,
    to: "another@example.com",
    subject: draft.subject,
    body: draft.body,
    attachResume: false,
    kind: "application",
    companyId: "ignored",
    jobId: "ignored",
  });
  const saved = await readDraft(draft.id);
  assert.equal(saved.kind, "direct");
  assert.equal(saved.companyId, "");
  assert.equal(saved.approvedHash, null);
  assert.equal(saved.status, "draft");
  await assert.rejects(sendDraft(draft.id), /approve/);
  await approve(saved);
  await sendDraft(saved.id);
  assert.match(
    Buffer.from([...remoteDrafts.values()][0], "base64url").toString(),
    /To: another@example.com/,
  );
  assert.equal(sends, 1);
});

test("direct duplicates are blocked while different messages to the same recipient are allowed", async () => {
  const first = await compose();
  await approve(first);
  await sendDraft(first.id);
  const duplicate = await compose("RECRUITER@example.com");
  await approve(duplicate);
  await assert.rejects(sendDraft(duplicate.id), /same email/);
  const different = await compose(
    first.to,
    "Hello, I have a different question about your interview process. Thank you for your help.",
  );
  await approve(different);
  await sendDraft(different.id);
  assert.equal(sends, 2);
});

test("direct sends retain the sending allowance and uncertain-send protection", async () => {
  const draft = await compose();
  await approve(draft);
  failSend = true;
  await assert.rejects(sendDraft(draft.id), /could not be confirmed/);
  assert.equal((await readDraft(draft.id)).status, "uncertain");
  await assert.rejects(sendDraft(draft.id), /approve/);
  const duplicate = await compose();
  await approve(duplicate);
  await assert.rejects(sendDraft(duplicate.id), /same email/);
  await store.put("settings", { ...(await store.settings()), dailySendLimit: 1 });
  const next = await compose("someone-else@example.com");
  await approve(next);
  await assert.rejects(sendDraft(next.id), /sending allowance/);
  assert.equal(sends, 1);
});

test("Gmail changes after approval block a direct send", async () => {
  const draft = await compose();
  await approve(draft);
  tamper = true;
  await assert.rejects(sendDraft(draft.id), /Gmail draft changed/);
  assert.equal((await readDraft(draft.id)).approvedHash, null);
  assert.equal(sends, 0);
});

test("concurrent duplicate direct emails result in only one Gmail send", async () => {
  const first = await compose();
  const second = await compose();
  await approve(first);
  await approve(second);
  const results = await Promise.allSettled([sendDraft(first.id), sendDraft(second.id)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(sends, 1);
});

test("a résumé is optional for direct emails and an explicitly selected file reaches Gmail", async () => {
  const { uploadResume } = await import("../src/lib/files");
  await uploadResume(
    new File(
      ["Test Candidate: built a TypeScript application using PostgreSQL and Node.js."],
      "resume.txt",
      { type: "text/plain" },
    ),
  );
  const draft = await compose();
  assert.equal(draft.resumeId, "", "New direct emails do not attach a file automatically");
  await action("draft.save", {
    id: draft.id,
    version: draft.version,
    to: draft.to,
    subject: draft.subject,
    body: "Hello, I have attached my résumé for your review. Thank you for your time.",
    attachResume: true,
  });
  const attached = await readDraft(draft.id);
  assert.equal(attached.resumeId, (await store.profile()).resumeId);
  assert.equal((await store.profile()).confirmed, false);
  await approve(attached);
  assert.match(
    Buffer.from([...remoteDrafts.values()][0], "base64url").toString(),
    /filename=resume.txt/,
  );
  await sendDraft(draft.id);
  assert.equal(sends, 1);
});

test("direct mail validates recipient and content and cannot bypass application checks", async () => {
  await assert.rejects(compose("a@example.com,b@example.com"));
  const draft = await compose();
  await store.put("draft", { ...draft, body: "Please find my résumé attached for your review." });
  await assert.rejects(saveGmailDraft(draft.id), /attachment/);
  await store.put("draft", draft);
  await saveGmailDraft(draft.id);
  const saved = await readDraft(draft.id);
  await store.put("draft", { ...saved, companyId: "invalid" });
  await assert.rejects(approveDraft(draft.id, draft.version), /invalid application details/);
  await store.put("draft", { ...saved, kind: undefined });
  await assert.rejects(approveDraft(draft.id, draft.version), /Confirm this recruitment address/);
  assert.equal(sends, 0);
});

test("manual direct emails ignore profile edits unless a résumé is attached", async () => {
  const draft = await compose();
  await approve(draft);
  await store.put("profile", { ...(await store.profile()), updatedAt: "2026-10-15T12:00:00Z" });
  await sendDraft(draft.id);
  const attached = { ...draft, resumeId: "test-resume" };
  assert.ok(
    applicationChecks(attached, await store.profile()).some(
      (c) => c.id === "freshness" && c.status === "error",
    ),
  );
  const approved = await readDraft(draft.id);
  const stale = { ...approved, status: "approved" as const, resumeId: "test-resume" };
  await store.put("draft", { ...stale, approvedHash: draftHash(stale) });
  await assert.rejects(sendDraft(draft.id), /profile or résumé changed/);
  assert.equal(sends, 1);
});

test("the direct composer shows To and New email without company or vacancy requirements", async () => {
  const draft = await compose();
  const html = renderToStaticMarkup(
    createElement(EmailPanel, {
      data: await state(),
      selectedId: draft.id,
      setSelectedId: () => {},
      act: async () => null,
      busy: "",
      onFindJobs: () => {},
    }),
  );
  assert.match(html, /New email/);
  assert.match(html, /Recipient email/);
  assert.match(html, /recruiter@example.com/);
  assert.match(html, /Direct email/);
  assert.match(html, /Improve English/);
  assert.doesNotMatch(
    html,
    /THE OPPORTUNITY|Confirm this recruitment address|vacancy is closed|Write from my profile/,
  );
  await assert.rejects(
    action("draft.template", { id: draft.id, version: draft.version }),
    /Write your direct email/,
  );
  await assert.rejects(
    action("draft.generate", { id: draft.id, version: draft.version }),
    /Write your direct email/,
  );
});
