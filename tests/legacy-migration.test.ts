import { test, after } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { scryptSync } from "node:crypto";
import { setupTestStorage } from "./setup";
const cleanup = await setupTestStorage();
const old = new Pool({ connectionString: process.env.DATABASE_URL });
await old.query(`CREATE TABLE folio_records(sequence BIGSERIAL UNIQUE,kind TEXT NOT NULL,id TEXT NOT NULL,data JSONB NOT NULL,PRIMARY KEY(kind,id));
  CREATE TABLE folio_tasks(id TEXT PRIMARY KEY,type TEXT NOT NULL,"targetId" TEXT NOT NULL,status TEXT NOT NULL,error TEXT,"createdAt" TEXT NOT NULL,"startedAt" TEXT,"finishedAt" TEXT);`);
const salt = "migration-test-salt";
await old.query(
  "INSERT INTO folio_records(kind,id,data) VALUES('owner','main',$1::jsonb),('profile','main',$2::jsonb)",
  [
    JSON.stringify({
      id: "main",
      salt,
      hash: scryptSync("original-owner-password", salt, 64).toString("hex"),
      createdAt: new Date().toISOString(),
    }),
    JSON.stringify({ id: "main", name: "Preserved Candidate", resumeId: "existing-file" }),
  ],
);
await old.end();
const db = await import("../src/lib/db");
const accounts = await import("../src/lib/accounts");
after(async () => {
  await db.closeDatabase();
  await cleanup();
});
test("the original owner keeps their password and workspace while claiming an email exactly once", async () => {
  const user = await accounts.authenticate("owner@example.com", "original-owner-password");
  assert.equal(user.id, db.LEGACY_USER_ID);
  assert.equal(user.role, "admin");
  assert.equal(user.email, "owner@example.com");
  assert.equal(
    await db.withUser(user.id, async () => (await db.profile()).name),
    "Preserved Candidate",
  );
  await assert.rejects(
    accounts.authenticate("another@example.com", "original-owner-password"),
    /credentials/i,
  );
  await db.closeDatabase();
  assert.equal(
    (await accounts.authenticate("owner@example.com", "original-owner-password")).id,
    user.id,
  );
  assert.equal(
    await db.withUser(user.id, async () => (await db.profile()).resumeId),
    "existing-file",
  );
});
