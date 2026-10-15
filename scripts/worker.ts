import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import {
  all,
  claimTask,
  db,
  enqueue,
  finishTask,
  get,
  now,
  put,
  settings,
  activity,
} from "../src/lib/db";
import { scanCompany } from "../src/lib/jobs";
import { connection, syncReplies } from "../src/lib/gmail";
import { AppError } from "../src/lib/security";
import type { Company, Draft } from "../src/lib/types";

let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
async function tick() {
  put("worker", { id: "main", at: now() });
  db()
    .prepare(
      "UPDATE tasks SET status='pending',startedAt=NULL WHERE status='running' AND startedAt<?",
    )
    .run(new Date(Date.now() - 300000).toISOString());
  for (const d of all<Draft>("draft")) {
    if (d.status === "sending" && Date.parse(d.updatedAt) < Date.now() - 180000)
      put("draft", { ...d, status: "uncertain", approvedHash: null });
  }
  const options = settings();
  if (options.automationPaused) return;
  const day = now().slice(0, 10);
  if (options.dailySearch && options.lastScheduledDay !== day) {
    for (const c of all<Company>("company").filter((c) => !c.paused)) enqueue("scan", c.id);
    put("settings", { ...options, lastScheduledDay: day });
  }
  if (connection() && Date.now() - (get<{ at: number }>("schedule", "replies")?.at || 0) > 900000) {
    enqueue("replies", "main");
    put("schedule", { id: "replies", at: Date.now() });
  }
  const task = claimTask();
  if (!task) return;
  try {
    if (task.type === "scan") await scanCompany(task.targetId);
    else await syncReplies();
    finishTask(task.id);
  } catch (error) {
    const message =
      error instanceof AppError
        ? error.message
        : "Background task failed. Check the connection and try again.";
    finishTask(task.id, message);
    activity("A background task needs attention", message, "error");
  }
  put("worker", { id: "main", at: now() });
}
async function main() {
  console.log("Folio worker started. Daily search and sending remain under your control.");
  while (!stopping) {
    try {
      await tick();
    } catch {
      console.error("Folio worker encountered an error. It will retry safe background tasks.");
    }
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  db().close();
}
void main();
