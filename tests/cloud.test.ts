import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestStorage } from "./setup";
const cleanup = await setupTestStorage();
const store = await import("../src/lib/db");
const security = await import("../src/lib/security");
const { uploadResume, readResume } = await import("../src/lib/files");
const { readObject, resumeKey } = await import("../src/lib/storage");
const { GET: cron } = await import("../src/app/api/cron/route");
const { runWorker } = await import("../src/lib/worker");
beforeEach(async () => { await store.query("DELETE FROM folio_records; DELETE FROM folio_tasks;"); });
after(async () => { await store.closeDatabase(); await cleanup(); });

test("transactions roll back partial writes and serialize concurrent updates", async () => {
  await assert.rejects(store.transaction(async () => {
    await store.put("test", { id: "rollback", value: 1 });
    throw new Error("abort");
  }), /abort/);
  assert.equal(await store.get("test", "rollback"), null);
  await store.put("test", { id: "counter", value: 0 });
  await Promise.all(Array.from({ length: 8 }, () => store.transaction(async () => {
    const row = await store.get<{ value: number }>("test", "counter");
    await store.put("test", { id: "counter", value: row!.value + 1 });
  })));
  assert.equal((await store.get<{ value: number }>("test", "counter"))?.value, 8);
});
test("only one concurrent owner setup succeeds", async () => {
  const results = await Promise.allSettled([security.setPassword("first-test-password"), security.setPassword("second-test-password")]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const valid = await Promise.all([security.verifyPassword("first-test-password"), security.verifyPassword("second-test-password")]);
  assert.equal(valid.filter(Boolean).length, 1);
});
test("concurrent login-rate increments cannot bypass the limit", async () => {
  const results = await Promise.allSettled(Array.from({length: 12}, () => security.checkLoginRate()));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 10);
  assert.equal(results.filter((r) => r.status === "rejected").length, 2);
});
test("duplicate enqueues and concurrent claims process a task only once", async () => {
  await Promise.all(Array.from({length: 5}, () => store.enqueue("scan", "company-1")));
  assert.equal((await store.tasks()).length, 1);
  const claimed = await Promise.all(Array.from({length: 5}, () => store.claimTask()));
  assert.equal(claimed.filter(Boolean).length, 1);
  await store.finishTask(claimed.find(Boolean)!.id);
  await store.enqueue("scan", "company-1");
  assert.ok(await store.claimTask());
});
test("résumé bytes persist across database connections and are encrypted in S3", async () => {
  const text = "Test candidate résumé with TypeScript, PostgreSQL, and web development experience.";
  const file = await uploadResume(new File([text], "resume.txt", {type: "text/plain"}));
  const object = await readObject(resumeKey(file.id));
  assert.equal(object.includes(text), false);
  await store.closeDatabase();
  assert.equal((await readResume(file.id)).buffer.toString(), text);
  assert.equal((await store.profile()).resumeId, file.id);
});
test("failed S3 upload does not replace the current profile or save file metadata", async () => {
  await store.put("profile", {...await store.profile(), resumeId: "previous"});
  const bucket = process.env.S3_BUCKET;
  process.env.S3_BUCKET = "folio-nonexistent-bucket";
  try {
    await assert.rejects(uploadResume(new File(["A sufficiently long résumé describing relevant job experience."], "resume.txt")));
    assert.equal((await store.profile()).resumeId, "previous");
    assert.equal((await store.all("file")).length, 0);
  } finally { process.env.S3_BUCKET = bucket; }
});
test("first-owner setup requires the configured token and encryption has no disk fallback", () => {
  process.env.APP_SETUP_TOKEN = "test-setup-token-".repeat(3);
  assert.throws(() => security.assertSetupToken(undefined), /setup token/);
  assert.throws(() => security.assertSetupToken("incorrect"), /setup token/);
  security.assertSetupToken(process.env.APP_SETUP_TOKEN);
  const key = process.env.APP_ENCRYPTION_KEY;
  delete process.env.APP_ENCRYPTION_KEY;
  try { assert.throws(() => security.secret(), /APP_ENCRYPTION_KEY/); }
  finally { process.env.APP_ENCRYPTION_KEY = key; }
});
test("cron denies unauthenticated triggers and allows the configured secret", async () => {
  process.env.CRON_SECRET = "test-cron-secret";
  assert.equal((await cron(new Request("https://example.com/api/cron"))).status, 401);
  assert.equal(await store.get("worker", "main"), null);
  const result = await cron(new Request("https://example.com/api/cron", {headers:{authorization:"Bearer test-cron-secret"}}));
  assert.equal(result.status, 200);
  assert.ok(await store.get("worker", "main"));
});
test("overlapping workers respect the database lease", async () => {
  await store.put("lock", {id:"worker",owner:"other",expires:Date.now()+60000});
  assert.deepEqual(await runWorker(), {processed:0,busy:true});
  assert.equal(await store.get("worker", "main"), null);
});
