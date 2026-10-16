import { cleanupDeletedUploads } from "./account-delete";
import { currentUserId, withUser, userId, remove } from "./db";
import { getAccount } from "./accounts";
import {
  all,
  claimTask,
  enqueue,
  finishTask,
  get,
  now,
  put,
  query,
  settings,
  activity,
  transaction,
} from "./db";
import { scanCompany } from "./jobs";
import { connection, syncReplies } from "./gmail";
import { AppError } from "./security";
import type { Company, Draft } from "./types";
import { randomUUID } from "node:crypto";
import { cleanupCsvImports, runCsvImports } from "./csv-imports";

// A database lease prevents overlapping cron, browser, and local-worker runs.
export async function runWorker(budgetMs = 200000): Promise<{ processed: number; busy: boolean }> {
  if (currentUserId()) {
    const account = await getAccount(userId());
    if (!account || account.status !== "active") return { processed: 0, busy: false };
    return runUserWorker(budgetMs);
  }
  const deadline = Date.now() + Math.min(budgetMs, 200000);
  await cleanupDeletedUploads();
  const users = (
    await query<{ id: string }>(
      "SELECT id FROM folio_accounts WHERE status='active' ORDER BY last_work_at ASC NULLS FIRST, created_at ASC",
    )
  ).rows;
  let processed = 0;
  let busy = false;
  for (const user of users) {
    if (Date.now() > deadline - 30000) break;
    if ((await getAccount(user.id))?.status !== "active") continue;
    try {
      const result = await withUser(user.id, () =>
        runUserWorker(Math.min(60000, deadline - Date.now())),
      );
      processed += result.processed;
      busy ||= result.busy;
    } catch {
      console.error("workspace_worker_failed", { userId: user.id });
    }
    await query("UPDATE folio_accounts SET last_work_at=$1 WHERE id=$2", [now(), user.id]);
  }
  return { processed, busy };
}
async function runUserWorker(budgetMs: number) {
  const owner = randomUUID();
  const deadline = Date.now() + Math.min(budgetMs, 200000);
  const acquired = await transaction(async () => {
    const lease = await get<{ expires: number }>("lock", "worker");
    if (lease && lease.expires > Date.now()) return false;
    await put("lock", { id: "worker", owner, expires: Date.now() + 300000 });
    return true;
  });
  if (!acquired) return { processed: 0, busy: true };
  let processed = 0;
  try {
    // User-requested imports continue even when scheduled vacancy checks are paused.
    await runCsvImports(Math.max(0, deadline - Date.now() - 30000));
    await cleanupCsvImports();
    await transaction(async () => {
      await put("worker", { id: "main", at: now() });
      await query(
        `UPDATE folio_tasks SET status='pending',"startedAt"=NULL WHERE user_id=$2 AND status='running' AND "startedAt"<$1`,
        [new Date(Date.now() - 300000).toISOString(), userId()],
      );
      for (const draft of await all<Draft>("draft")) {
        if (draft.status === "sending" && Date.parse(draft.updatedAt) < Date.now() - 300000)
          await put("draft", { ...draft, status: "uncertain", approvedHash: null });
      }
      const options = await settings();
      if (options.automationPaused) return;
      const day = now().slice(0, 10);
      if (options.dailySearch && options.lastScheduledDay !== day) {
        for (const company of (await all<Company>("company")).filter((c) => !c.paused))
          await enqueue("scan", company.id);
        await put("settings", { ...options, lastScheduledDay: day });
      }
      if (
        (await connection()) &&
        Date.now() - ((await get<{ at: number }>("schedule", "replies"))?.at || 0) > 900000
      ) {
        await enqueue("replies", "main");
        await put("schedule", { id: "replies", at: Date.now() });
      }
    });
    while (Date.now() < deadline - 30000 && !(await settings()).automationPaused) {
      const account = await getAccount(userId());
      if (!account || account.status !== "active") break;
      const task = await claimTask();
      if (!task) break;
      try {
        if (task.type === "scan")
          await scanCompany(task.targetId, false, Math.min(deadline, Date.now() + 90000));
        else await syncReplies(deadline);
        await finishTask(task.id);
      } catch (error) {
        const message =
          error instanceof AppError
            ? error.message
            : "Background task failed. Check the connection and try again.";
        await finishTask(task.id, message);
        await activity("A background task needs attention", message, "error");
      }
      processed++;
      await put("worker", { id: "main", at: now() });
    }
    return { processed, busy: false };
  } finally {
    await transaction(async () => {
      const lease = await get<{ owner: string }>("lock", "worker");
      if (lease?.owner === owner) await remove("lock", "worker");
    });
  }
}
