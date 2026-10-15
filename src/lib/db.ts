import Database from "better-sqlite3";
import { mkdirSync, chmodSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  emptyProfile,
  defaultSettings,
  type Activity,
  type Profile,
  type Settings,
  type Task,
} from "./types";

export const dataDir = path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIR || "./data");
let singleton: Database.Database | undefined;
export function db() {
  if (singleton) return singleton;
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  singleton = new Database(path.join(dataDir, "folio.sqlite"));
  chmodSync(path.join(dataDir, "folio.sqlite"), 0o600);
  singleton.pragma("journal_mode = WAL");
  singleton.pragma("busy_timeout = 5000");
  singleton.exec(`CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(kind,id));
    CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, type TEXT NOT NULL, targetId TEXT NOT NULL, status TEXT NOT NULL, error TEXT, createdAt TEXT NOT NULL, startedAt TEXT, finishedAt TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS active_task ON tasks(type,targetId) WHERE status IN ('pending','running');`);
  return singleton;
}
export function get<T>(kind: string, id: string): T | null {
  const row = db().prepare("SELECT data FROM records WHERE kind=? AND id=?").get(kind, id) as
    { data: string } | undefined;
  return row ? (JSON.parse(row.data) as T) : null;
}
export function all<T>(kind: string): T[] {
  return (
    db().prepare("SELECT data FROM records WHERE kind=? ORDER BY rowid DESC").all(kind) as {
      data: string;
    }[]
  ).map((r) => JSON.parse(r.data) as T);
}
export function put<T extends { id: string }>(kind: string, value: T): T {
  db()
    .prepare(
      "INSERT INTO records(kind,id,data) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data",
    )
    .run(kind, value.id, JSON.stringify(value));
  return value;
}
export function remove(kind: string, id: string) {
  db().prepare("DELETE FROM records WHERE kind=? AND id=?").run(kind, id);
}
export function transaction<T>(fn: () => T): T {
  return db().transaction(fn).immediate();
}
export const now = () => new Date().toISOString();
export const id = () => randomUUID();
export const profile = () => get<Profile>("profile", "main") || { ...emptyProfile };
export const settings = () => get<Settings>("settings", "main") || { ...defaultSettings };
export function activity(label: string, detail: string, kind: Activity["kind"] = "info") {
  put("activity", { id: id(), label, detail, kind, createdAt: now() });
}
export function enqueue(type: Task["type"], targetId: string) {
  const task: Task = {
    id: id(),
    type,
    targetId,
    status: "pending",
    error: null,
    createdAt: now(),
    startedAt: null,
    finishedAt: null,
  };
  db()
    .prepare(
      "INSERT OR IGNORE INTO tasks(id,type,targetId,status,createdAt) VALUES(@id,@type,@targetId,@status,@createdAt)",
    )
    .run(task);
  return task;
}
export function claimTask(): Task | null {
  return transaction(() => {
    const task = db()
      .prepare("SELECT * FROM tasks WHERE status='pending' ORDER BY createdAt LIMIT 1")
      .get() as Task | undefined;
    if (!task) return null;
    db().prepare("UPDATE tasks SET status='running',startedAt=? WHERE id=?").run(now(), task.id);
    return task;
  });
}
export function tasks(): Task[] {
  return db().prepare("SELECT * FROM tasks ORDER BY createdAt DESC LIMIT 100").all() as Task[];
}
export function finishTask(taskId: string, error?: string) {
  db()
    .prepare("UPDATE tasks SET status=?,error=?,finishedAt=? WHERE id=?")
    .run(error ? "failed" : "done", error || null, now(), taskId);
}
