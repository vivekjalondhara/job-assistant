import { attachDatabasePool } from "@vercel/functions";
import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import WebSocket from "ws";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { Pool, type QueryResultRow } from "pg";
import { emptyProfile, defaultSettings, type Activity, type Task } from "./types";

interface SqlConnection {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
}
interface SqlClient extends SqlConnection {
  release(): void;
}
interface SqlPool extends SqlConnection {
  connect(): Promise<SqlClient>;
  end(): Promise<void>;
  on(event: "error", listener: () => void): unknown;
}
let pool: SqlPool | undefined;
let initialized: Promise<void> | undefined;
const current = new AsyncLocalStorage<SqlClient>();
// All short read-modify-write transactions and standalone writes share this lock.
// Preserve the single-owner app's SQLite BEGIN IMMEDIATE guarantees across instances.
const writeLock = 714026153;
function connectionPool() {
  if (!process.env.DATABASE_URL)
    throw new Error("Set DATABASE_URL to your Neon Postgres connection string.");
  if (!pool) {
    const url = new URL(process.env.DATABASE_URL);
    if (url.searchParams.get("sslmode") === "require")
      url.searchParams.set("sslmode", "verify-full");
    neonConfig.webSocketConstructor = WebSocket;
    const Driver = url.hostname.endsWith(".neon.tech") ? NeonPool : Pool;
    const created = new Driver({
      connectionString: url.toString(),
      max: 3,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 15000,
      allowExitOnIdle: true,
    });
    if (process.env.VERCEL) attachDatabasePool(created);
    pool = created;
    pool.on("error", () => console.error("[database] An idle connection failed."));
  }
  return pool;
}
export async function initializeDatabase() {
  if (!initialized) {
    initialized = (async () => {
      const client = await connectionPool().connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock($1)", [writeLock]);
        await client.query(`
          CREATE TABLE IF NOT EXISTS folio_records (
            sequence BIGSERIAL UNIQUE, kind TEXT NOT NULL, id TEXT NOT NULL,
            data JSONB NOT NULL, PRIMARY KEY (kind, id));
          CREATE INDEX IF NOT EXISTS folio_records_kind_sequence ON folio_records(kind, sequence DESC);
          CREATE TABLE IF NOT EXISTS folio_tasks (
            id TEXT PRIMARY KEY, type TEXT NOT NULL, "targetId" TEXT NOT NULL,
            status TEXT NOT NULL, error TEXT, "createdAt" TEXT NOT NULL,
            "startedAt" TEXT, "finishedAt" TEXT);
          CREATE UNIQUE INDEX IF NOT EXISTS folio_active_task
            ON folio_tasks(type, "targetId") WHERE status IN ('pending', 'running');
        `);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    })().catch((error) => {
      initialized = undefined;
      throw error;
    });
  }
  await initialized;
}
export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  values: unknown[] = [],
) {
  await initializeDatabase();
  return (current.getStore() || connectionPool()).query<T>(sql, values);
}
export async function transaction<T>(fn: () => Promise<T>): Promise<T> {
  if (current.getStore()) return fn();
  await initializeDatabase();
  const client = await connectionPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '15s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '30s'");
    await client.query("SELECT pg_advisory_xact_lock($1)", [writeLock]);
    const result = await current.run(client, fn);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
export async function get<T>(kind: string, id: string): Promise<T | null> {
  const result = await query<{ data: T }>(
    "SELECT data FROM folio_records WHERE kind=$1 AND id=$2",
    [kind, id],
  );
  return result.rows[0]?.data ?? null;
}
export async function all<T>(kind: string): Promise<T[]> {
  const result = await query<{ data: T }>(
    "SELECT data FROM folio_records WHERE kind=$1 ORDER BY sequence DESC",
    [kind],
  );
  return result.rows.map((row) => row.data);
}
export async function put<T extends { id: string }>(kind: string, value: T): Promise<T> {
  return transaction(async () => {
    await query(
      "INSERT INTO folio_records(kind,id,data) VALUES($1,$2,$3::jsonb) ON CONFLICT(kind,id) DO UPDATE SET data=EXCLUDED.data",
      [kind, value.id, JSON.stringify(value)],
    );
    return value;
  });
}
export async function remove(kind: string, id: string) {
  await transaction(async () => {
    await query("DELETE FROM folio_records WHERE kind=$1 AND id=$2", [kind, id]);
  });
}
export const now = () => new Date().toISOString();
export const id = () => randomUUID();
export const profile = async () =>
  (await get<typeof emptyProfile>("profile", "main")) || { ...emptyProfile };
export const settings = async () =>
  (await get<typeof defaultSettings>("settings", "main")) || { ...defaultSettings };
export async function activity(label: string, detail: string, kind: Activity["kind"] = "info") {
  await put("activity", { id: id(), label, detail, kind, createdAt: now() });
}
export async function enqueue(type: Task["type"], targetId: string) {
  return transaction(async () => {
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
    await query(
      `INSERT INTO folio_tasks(id,type,"targetId",status,"createdAt") VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [task.id, type, targetId, task.status, task.createdAt],
    );
    return task;
  });
}
export async function claimTask(): Promise<Task | null> {
  return transaction(async () => {
    const result = await query<Task>(
      `UPDATE folio_tasks SET status='running', "startedAt"=$1
      WHERE id=(SELECT id FROM folio_tasks WHERE status='pending' ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`,
      [now()],
    );
    return result.rows[0] || null;
  });
}
export async function tasks(): Promise<Task[]> {
  return (await query<Task>('SELECT * FROM folio_tasks ORDER BY "createdAt" DESC LIMIT 100')).rows;
}
export async function finishTask(taskId: string, error?: string) {
  await transaction(async () => {
    await query(`UPDATE folio_tasks SET status=$1,error=$2,"finishedAt"=$3 WHERE id=$4`, [
      error ? "failed" : "done",
      error || null,
      now(),
      taskId,
    ]);
  });
}
export async function closeDatabase() {
  await pool?.end();
  pool = undefined;
  initialized = undefined;
}
