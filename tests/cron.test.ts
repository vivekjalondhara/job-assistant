import { after, afterEach, beforeEach, test } from "./scoped-test";
import assert from "node:assert/strict";
import { setupTestStorage } from "./setup";
import type { Company, Job } from "../src/lib/types";

const cleanup = await setupTestStorage();
const store = await import("../src/lib/db");
const { encrypt } = await import("../src/lib/security");
const { runWorker } = await import("../src/lib/worker");
const { GET: cron } = await import("../src/app/api/cron/route");
const originalFetch = global.fetch;
let requests: string[] = [];

beforeEach(async () => {
  await store.query("DELETE FROM folio_records; DELETE FROM folio_tasks;");
  process.env.CRON_SECRET = "isolated-scheduler-test-secret";
  process.env.GOOGLE_ALLOWED_EMAIL = "owner@example.com";
  requests = [];
  global.fetch = async (input, init) => {
    const url = String(input);
    requests.push(url);
    assert.equal(init?.method || "GET", "GET", "scheduled work must never send email");
    assert.ok(url.startsWith("https://boards-api.greenhouse.io/"));
    return Response.json({
      jobs: [
        {
          id: 42,
          title: "Backend Engineer",
          content: "Build APIs",
          absolute_url: "https://example.com/jobs/42",
        },
      ],
    });
  };
});
afterEach(() => {
  global.fetch = originalFetch;
});
after(async () => {
  await store.closeDatabase();
  await cleanup();
});

async function company(paused = false) {
  const value: Company = {
    id: store.id(),
    name: "Scheduler test",
    website: "https://example.com",
    careersUrl: "https://boards.greenhouse.io/test",
    source: "greenhouse",
    board: "test",
    email: "",
    contactSource: "",
    contactConfirmed: false,
    priority: "normal",
    paused,
    lastChecked: null,
    checkStatus: "never",
    checkNote: "",
    createdAt: store.now(),
  };
  return store.put("company", value);
}
const trigger = () =>
  cron(
    new Request("https://example.com/api/cron", {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    }),
  );

test("cron fails closed for absent, incorrect, and unconfigured secrets", async () => {
  for (const authorization of ["", "Bearer incorrect", "Bearer " + "x".repeat(30)]) {
    assert.equal(
      (
        await cron(
          new Request("https://example.com/api/cron", {
            headers: { authorization },
          }),
        )
      ).status,
      401,
    );
  }
  delete process.env.CRON_SECRET;
  assert.equal((await trigger()).status, 401);
  assert.equal(await store.get("worker", "main"), null);
  assert.deepEqual(requests, []);
});

test("daily cron scans active companies once per UTC day and skips paused companies", async () => {
  const active = await company();
  const paused = await company(true);
  await store.put("settings", { ...(await store.settings()), dailySearch: true });
  const response = await trigger();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { processed: 1, busy: false });
  assert.equal((await store.get<Company>("company", active.id))?.checkStatus, "success");
  assert.equal((await store.get<Company>("company", paused.id))?.lastChecked, null);
  assert.equal((await store.all<Job>("job"))[0]?.title, "Backend Engineer");
  assert.equal((await store.settings()).lastScheduledDay, store.now().slice(0, 10));
  assert.deepEqual(await (await trigger()).json(), { processed: 0, busy: false });
  assert.equal(requests.length, 1);
  await store.put("settings", { ...(await store.settings()), lastScheduledDay: "2000-01-01" });
  await trigger();
  assert.equal(requests.length, 2);
  assert.equal((await store.all("job")).length, 1, "repeat scans must not duplicate listings");
});

test("daily search is opt-in, while explicitly queued scans still run", async () => {
  const active = await company();
  assert.equal((await store.settings()).dailySearch, false);
  await trigger();
  assert.equal(requests.length, 0);
  await store.enqueue("scan", active.id);
  await trigger();
  assert.equal(requests.length, 1);
  assert.equal((await store.tasks())[0]?.status, "done");
});

test("global pause holds queued work and scheduling until automation resumes", async () => {
  const active = await company();
  await store.enqueue("scan", active.id);
  await store.put("settings", {
    ...(await store.settings()),
    dailySearch: true,
    automationPaused: true,
  });
  await trigger();
  assert.equal(requests.length, 0);
  assert.equal((await store.tasks())[0]?.status, "pending");
  assert.equal((await store.settings()).lastScheduledDay, "");
  await store.put("settings", { ...(await store.settings()), automationPaused: false });
  await trigger();
  assert.equal(requests.length, 1);
  assert.equal((await store.tasks()).length, 1, "resume must not duplicate a queued scan");
});

test("work left by an exhausted execution budget waits for the next trigger", async () => {
  await company();
  await store.put("settings", { ...(await store.settings()), dailySearch: true });
  assert.deepEqual(await runWorker(0), { processed: 0, busy: false });
  assert.equal((await store.tasks())[0]?.status, "pending");
  assert.equal(await store.get("lock", "worker"), null);
  await trigger();
  assert.equal((await store.tasks())[0]?.status, "done");
  assert.equal(requests.length, 1);
});

test("an expired worker lease and abandoned running scan are recovered", async () => {
  const active = await company();
  await store.enqueue("scan", active.id);
  const task = await store.claimTask();
  await store.query('UPDATE folio_tasks SET "startedAt"=$1 WHERE id=$2', [
    new Date(Date.now() - 600000).toISOString(),
    task!.id,
  ]);
  await store.put("lock", { id: "worker", owner: "terminated-worker", expires: Date.now() - 1000 });
  await trigger();
  assert.equal((await store.tasks())[0]?.status, "done");
  assert.equal(requests.length, 1);
  assert.equal(await store.get("lock", "worker"), null);
});

test("cron HTTP success can contain a failed scan; the failure remains visible in tasks", async () => {
  const active = await company();
  await store.put("settings", { ...(await store.settings()), dailySearch: true });
  global.fetch = async (input) => {
    requests.push(String(input));
    return new Response(null, { status: 503 });
  };
  const response = await trigger();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { processed: 1, busy: false });
  assert.equal((await store.tasks())[0]?.status, "failed");
  assert.match((await store.tasks())[0]?.error || "", /HTTP 503/);
  assert.equal((await store.get<Company>("company", active.id))?.checkStatus, "failed");
  await trigger();
  assert.equal(requests.length, 1, "failed scans require a manual retry or a later daily check");
});

test("reply checks are throttled for 15 minutes and only read tracked Gmail threads", async () => {
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
  await store.put("draft", {
    id: store.id(),
    status: "sent",
    threadId: "tracked-thread",
    gmailAccountEmail: "owner@example.com",
    sentMessageId: "sent-message",
    sentAt: store.now(),
    updatedAt: store.now(),
  });
  global.fetch = async (input, init) => {
    requests.push(String(input));
    assert.equal(init?.method, "GET");
    assert.match(
      String(input),
      /^https:\/\/gmail\.googleapis\.com\/gmail\/v1\/users\/me\/threads\/tracked-thread\?/,
    );
    return Response.json({ messages: [] });
  };
  await trigger();
  await trigger();
  assert.equal(requests.length, 1);
  await store.put("schedule", { id: "replies", at: Date.now() - 901000 });
  await trigger();
  assert.equal(requests.length, 2);
  assert.equal(
    (await store.tasks()).filter((task) => task.type === "replies" && task.status === "done")
      .length,
    2,
  );
});
