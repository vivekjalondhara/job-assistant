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

// A database lease prevents overlapping cron, browser, and local-worker runs.
export async function runWorker(budgetMs = 200000) {
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
    await transaction(async () => {
      await put("worker", { id: "main", at: now() });
      await query(
        `UPDATE folio_tasks SET status='pending',"startedAt"=NULL WHERE status='running' AND "startedAt"<$1`,
        [new Date(Date.now() - 300000).toISOString()],
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
      if (lease?.owner === owner)
        await query("DELETE FROM folio_records WHERE kind='lock' AND id='worker'");
    });
  }
}
