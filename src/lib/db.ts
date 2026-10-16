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
const workspace = new AsyncLocalStorage<string>();
export const LEGACY_USER_ID = "legacy-owner";
export function currentUserId() {
  return workspace.getStore();
}
export function userId(): string {
  const value = currentUserId();
  if (!value) throw new Error("A verified user context is required for workspace data.");
  return value;
}
export function withUser<T>(ownerId: string, fn: () => T): T {
  if (!ownerId || (current.getStore() && currentUserId() && currentUserId() !== ownerId))
    throw new Error("Cannot change user context inside a workspace transaction.");
  return workspace.run(ownerId, fn);
}
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

          CREATE TABLE IF NOT EXISTS folio_tasks (
            id TEXT PRIMARY KEY, type TEXT NOT NULL, "targetId" TEXT NOT NULL,
            status TEXT NOT NULL, error TEXT, "createdAt" TEXT NOT NULL,
            "startedAt" TEXT, "finishedAt" TEXT);
          ALTER TABLE folio_records ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'legacy-owner';
          ALTER TABLE folio_tasks ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'legacy-owner';
          CREATE TABLE IF NOT EXISTS folio_migrations (id TEXT PRIMARY KEY);
          DO $migration$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM folio_migrations WHERE id='multi-user-v1') THEN
              ALTER TABLE folio_records DROP CONSTRAINT folio_records_pkey;
              ALTER TABLE folio_records ADD PRIMARY KEY(user_id, kind, id);
              DROP INDEX IF EXISTS folio_active_task;
              DROP INDEX IF EXISTS folio_records_kind_sequence;
              DROP INDEX IF EXISTS folio_company_name;
              INSERT INTO folio_migrations VALUES ('multi-user-v1');
            END IF;
          END $migration$;
          CREATE INDEX IF NOT EXISTS folio_records_kind_sequence ON folio_records(user_id, kind, sequence DESC);
          CREATE INDEX IF NOT EXISTS folio_company_name ON folio_records(user_id, lower(btrim(data->>'name'))) WHERE kind='company';
          CREATE UNIQUE INDEX IF NOT EXISTS folio_active_task
            ON folio_tasks(user_id, type, "targetId") WHERE status IN ('pending', 'running');
          CREATE TABLE IF NOT EXISTS folio_accounts (
            id TEXT PRIMARY KEY, email TEXT UNIQUE, name TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('admin','user')),
            status TEXT NOT NULL CHECK(status IN ('invited','active','disabled','deleting')),
            salt TEXT, hash TEXT, session_version INTEGER NOT NULL DEFAULT 1,
            limits JSONB NOT NULL DEFAULT '{"storageMb":100,"monthlyAiBudget":10,"dailySendLimit":10}',
            created_at TEXT NOT NULL, last_work_at TEXT
          );
          INSERT INTO folio_accounts(id,email,name,role,status,salt,hash,created_at)
            SELECT 'legacy-owner',NULL,'Original owner','admin','active',data->>'salt',data->>'hash',
              COALESCE(data->>'createdAt',now()::text)
            FROM folio_records WHERE user_id='legacy-owner' AND kind='owner' AND id='main'
            ON CONFLICT DO NOTHING;
          CREATE TABLE IF NOT EXISTS folio_account_tokens (
            digest TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES folio_accounts(id) ON DELETE CASCADE,
            purpose TEXT NOT NULL, expires_at BIGINT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS folio_audit (
            id BIGSERIAL PRIMARY KEY, actor_id TEXT NOT NULL, target_id TEXT NOT NULL,
            action TEXT NOT NULL, created_at TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS folio_storage_cleanup (object_key TEXT PRIMARY KEY, after_at BIGINT NOT NULL);
          ALTER TABLE folio_records ALTER COLUMN user_id DROP DEFAULT;
          ALTER TABLE folio_tasks ALTER COLUMN user_id DROP DEFAULT;
          CREATE TABLE IF NOT EXISTS folio_login_rates (
            key TEXT PRIMARY KEY, count INTEGER NOT NULL, until_at BIGINT NOT NULL
          );
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
    if (currentUserId()) {
      const account = (
        await client.query<{ status: string }>(
          "SELECT status FROM folio_accounts WHERE id=$1 FOR SHARE",
          [userId()],
        )
      ).rows[0];
      if (!account || account.status !== "active")
        throw new Error("This workspace account is unavailable.");
    }
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
    "SELECT data FROM folio_records WHERE kind=$1 AND id=$2 AND user_id=$3",
    [kind, id, userId()],
  );
  return result.rows[0]?.data ?? null;
}
export async function all<T>(kind: string): Promise<T[]> {
  const result = await query<{ data: T }>(
    "SELECT data FROM folio_records WHERE kind=$1 AND user_id=$2 ORDER BY sequence DESC",
    [kind, userId()],
  );
  return result.rows.map((row) => row.data);
}
export async function recent<T>(kind: string, limit: number): Promise<T[]> {
  const result = await query<{ data: T }>(
    "SELECT data FROM folio_records WHERE kind=$1 AND user_id=$3 ORDER BY sequence DESC LIMIT $2",
    [kind, limit, userId()],
  );
  return result.rows.map((row) => row.data);
}

// Call inside a transaction when this belongs to a larger atomic operation.
export async function putMany<T extends { id: string }>(kind: string, values: T[]) {
  if (!values.length) return;
  await transaction(async () => {
    await query(
      `INSERT INTO folio_records(kind,id,data,user_id)
       SELECT $1, item->>'id', item, $3 FROM jsonb_array_elements($2::jsonb) AS item
       ON CONFLICT(user_id,kind,id) DO UPDATE SET data=EXCLUDED.data`,
      [kind, JSON.stringify(values), userId()],
    );
  });
}
export async function put<T extends { id: string }>(kind: string, value: T): Promise<T> {
  return transaction(async () => {
    await query(
      "INSERT INTO folio_records(kind,id,data,user_id) VALUES($1,$2,$3::jsonb,$4) ON CONFLICT(user_id,kind,id) DO UPDATE SET data=EXCLUDED.data",
      [kind, value.id, JSON.stringify(value), userId()],
    );
    return value;
  });
}
export async function remove(kind: string, id: string) {
  await transaction(async () => {
    await query("DELETE FROM folio_records WHERE kind=$1 AND id=$2 AND user_id=$3", [
      kind,
      id,
      userId(),
    ]);
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
      `INSERT INTO folio_tasks(id,type,"targetId",status,"createdAt",user_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [task.id, type, targetId, task.status, task.createdAt, userId()],
    );
    return task;
  });
}
export async function claimTask(): Promise<Task | null> {
  return transaction(async () => {
    const result = await query<Task>(
      `UPDATE folio_tasks SET status='running', "startedAt"=$1
      WHERE id=(SELECT id FROM folio_tasks WHERE status='pending' AND user_id=$2 ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`,
      [now(), userId()],
    );
    return result.rows[0] || null;
  });
}
export async function tasks(): Promise<Task[]> {
  return (
    await query<Task>(
      'SELECT * FROM folio_tasks WHERE user_id=$1 ORDER BY "createdAt" DESC LIMIT 100',
      [userId()],
    )
  ).rows;
}
export async function finishTask(taskId: string, error?: string) {
  await transaction(async () => {
    await query(
      `UPDATE folio_tasks SET status=$1,error=$2,"finishedAt"=$3 WHERE id=$4 AND user_id=$5`,
      [error ? "failed" : "done", error || null, now(), taskId, userId()],
    );
  });
}
export async function closeDatabase() {
  await pool?.end();
  pool = undefined;
  initialized = undefined;
}
