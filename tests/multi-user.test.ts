import { test, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestStorage } from "./setup";

const cleanup = await setupTestStorage();
const db = await import("../src/lib/db");
const files = await import("../src/lib/files");
await db.query(
  "INSERT INTO folio_accounts(id,name,role,status,created_at) SELECT value,value,'user','active',$1 FROM unnest($2::text[]) value",
  [db.now(), ["alice", "bob", "resume-owner", "other-user"]],
);
after(async () => {
  await db.closeDatabase();
  await cleanup();
});

test("workspace records, raw company search, and tasks are isolated between users", async () => {
  assert.equal(typeof db.withUser, "function", "A verified user context is required");
  const { companyPage } = await import("../src/lib/companies");
  await db.withUser("alice", async () => {
    await db.put("profile", { ...(await db.profile()), name: "Alice" });
    await db.put("company", { id: "same-id", name: "Alice Company" });
    await db.enqueue("replies", "main");
  });
  await db.withUser("bob", async () => {
    assert.equal((await db.profile()).name, "");
    assert.equal(await db.get("company", "same-id"), null);
    assert.equal((await companyPage()).total, 0);
    assert.equal((await db.tasks()).length, 0);
    await db.put("company", { id: "same-id", name: "Bob Company" });
    await db.enqueue("replies", "main");
    await db.remove("profile", "main");
  });
  await db.withUser("alice", async () => {
    assert.equal((await db.profile()).name, "Alice");
    assert.equal((await companyPage()).companies[0].name, "Alice Company");
    assert.equal((await db.tasks()).length, 1);
  });
  await assert.rejects(db.all("company"), /user context/i);
});

test("additional résumés preserve the default and cannot be downloaded by another user", async () => {
  assert.equal(typeof db.withUser, "function", "A verified user context is required");
  const first = await db.withUser("resume-owner", async () => {
    const one = await files.uploadResume(
      new File(["Frontend engineer with React and TypeScript experience."], "frontend.txt"),
    );
    await db.put("profile", { ...(await db.profile()), confirmed: true });
    await files.uploadResume(
      new File(["Backend engineer with Node.js and PostgreSQL experience."], "backend.txt"),
    );
    assert.equal((await db.profile()).resumeId, one.id);
    assert.equal((await db.profile()).confirmed, true);
    assert.equal((await db.all("file")).length, 2);
    return one;
  });
  await db.withUser("other-user", async () => {
    await assert.rejects(files.readResume(first.id), /not found/i);
    await assert.rejects(files.selectedResume(true, first.id, ""), /uploaded résumé/i);
  });
});

test("changing defaults preserves profile confirmation and existing attachments; deletion clears unsent approvals", async () => {
  const { action } = await import("../src/lib/service");
  await db.withUser("resume-owner", async () => {
    const resumes = await db.all<import("../src/lib/files").ResumeFile>("file");
    const profile = await db.profile();
    const first = resumes.find((r) => r.id === profile.resumeId)!;
    const second = resumes.find((r) => r.id !== profile.resumeId)!;
    await action("resume.default", { id: second.id });
    assert.equal((await db.profile()).defaultResumeId, second.id);
    assert.equal((await db.profile()).confirmed, true);
    await db.put("draft", {
      id: "pending-resume-draft",
      status: "approved",
      resumeId: first.id,
      resumeName: first.name,
      version: 1,
      approvedHash: "approved",
      approvedAt: db.now(),
    });
    await action("resume.delete", { id: first.id });
    const draft = await db.get<import("../src/lib/types").Draft>("draft", "pending-resume-draft");
    assert.equal(draft?.resumeId, "");
    assert.equal(draft?.approvedHash, null);
    assert.equal(draft?.status, "draft");
    await assert.rejects(files.readResume(first.id), /not found/i);
    assert.equal((await db.profile()).defaultResumeId, second.id);
    await db.put("draft", {
      id: "sent-resume-draft",
      status: "sent",
      resumeId: second.id,
      resumeName: second.name,
      version: 1,
    });
    await action("resume.delete", { id: second.id });
    const sent = await db.get<import("../src/lib/types").Draft>("draft", "sent-resume-draft");
    assert.equal(sent?.resumeName, second.name);
    assert.equal(sent?.status, "sent");
    assert.equal((await db.profile()).defaultResumeId, "");
  });
});

test("the scheduler processes active workspaces and leaves disabled users queued", async () => {
  const { runWorker } = await import("../src/lib/worker");
  await db.query(
    "INSERT INTO folio_accounts(id,name,role,status,created_at) SELECT value,value,'user','active',$1 FROM unnest($2::text[]) value",
    [db.now(), ["queue-active", "queue-disabled"]],
  );
  for (const owner of ["queue-active", "queue-disabled"])
    await db.withUser(owner, () => db.enqueue("replies", "main"));
  await db.query("UPDATE folio_accounts SET status='disabled' WHERE id='queue-disabled'");
  await runWorker(120000);
  assert.equal(await db.withUser("queue-active", async () => (await db.tasks())[0].status), "done");
  assert.equal(
    await db.withUser("queue-disabled", async () => (await db.tasks())[0].status),
    "pending",
  );
  await assert.rejects(
    db.withUser("queue-disabled", () => db.put("profile", { id: "main", name: "Blocked" })),
    /unavailable/i,
  );
});

test("admin allowances cap user preferences and reject oversized storage without saving a file", async () => {
  const { effectiveLimits } = await import("../src/lib/account-limits");
  await db.query(
    "INSERT INTO folio_accounts(id,name,role,status,created_at,limits) VALUES('limited','Limited','user','active',$1,$2::jsonb)",
    [db.now(), JSON.stringify({ storageMb: 1, monthlyAiBudget: 0, dailySendLimit: 2 })],
  );
  await db.withUser("limited", async () => {
    await db.put("settings", {
      ...(await db.settings()),
      monthlyAiBudget: 100,
      dailySendLimit: 50,
    });
    assert.deepEqual(await effectiveLimits(), {
      storageMb: 1,
      monthlyAiBudget: 0,
      dailySendLimit: 2,
    });
    await assert.rejects(
      files.uploadResume(new File(["Resume content ".repeat(90000)], "too-large-for-account.txt")),
      /storage allowance/i,
    );
    assert.equal((await db.all("file")).length, 0);
  });
});
