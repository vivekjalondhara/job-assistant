import { test, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestStorage } from "./setup";
const cleanup = await setupTestStorage();
const db = await import("../src/lib/db");
const security = await import("../src/lib/security");
const accounts = await import("../src/lib/accounts").catch(() => null);
after(async () => {
  await db.closeDatabase();
  await cleanup();
});
test("admin invitations are one-use, normal users cannot administer, and disabling revokes sessions", async () => {
  assert.ok(accounts, "Account lifecycle must exist");
  const admin = await accounts.createFirstAdmin("Admin", "admin@example.com", "a-secure-password");
  assert.equal(admin.role, "admin");
  await assert.rejects(
    accounts.createFirstAdmin("Other", "other@example.com", "a-secure-password"),
    /already/i,
  );
  const management = await import("../src/lib/account-admin");
  const invitations = await import("../src/lib/account-tokens");
  const invited = await management.inviteUser(admin.id, {
    name: "Alice",
    email: "alice@example.com",
  });
  assert.equal((await accounts.getAccount(invited.user.id))?.status, "invited");
  const token = new URL(invited.link).hash.slice(1);
  const alice = await invitations.redeemToken(token, "alice-secure-password");
  await assert.rejects(invitations.redeemToken(token, "another-password"), /expired|used/i);
  await assert.rejects(
    management.inviteUser(alice.id, { name: "Bad", email: "bad@example.com" }),
    /admin/i,
  );
  const session = await security.createSessionToken(alice);
  assert.equal((await security.accountFromToken(session))?.id, alice.id);
  await management.updateUser(admin.id, alice.id, { status: "disabled" });
  assert.equal(await security.accountFromToken(session), null);
  await assert.rejects(
    accounts.authenticate("alice@example.com", "alice-secure-password"),
    /credentials|disabled/i,
  );
  await management.updateUser(admin.id, alice.id, { status: "active" });
  assert.equal(
    await security.accountFromToken(session),
    null,
    "Old sessions stay revoked after reactivation",
  );
  const signedIn = await accounts.authenticate("alice@example.com", "alice-secure-password");
  assert.equal(signedIn.id, alice.id);
  const summary = await management.adminSummary(admin.id);
  assert.ok(summary.users.every((u) => !("hash" in u) && !("salt" in u)));
  await assert.rejects(
    management.updateUser(admin.id, admin.id, { status: "disabled" }),
    /own|admin/i,
  );
});

test("reissuing and expiring invitations rejects old tokens without activating the account", async () => {
  assert.ok(accounts);
  const { inviteUser, resendUserLink } = await import("../src/lib/account-admin");
  const { redeemToken } = await import("../src/lib/account-tokens");
  const admin = await accounts.authenticate("admin@example.com", "a-secure-password");
  const invited = await inviteUser(admin.id, { name: "Pending", email: "pending@example.com" });
  const replacement = await resendUserLink(admin.id, invited.user.id);
  await assert.rejects(
    redeemToken(new URL(invited.link).hash.slice(1), "pending-password"),
    /expired|used/i,
  );
  await db.query("UPDATE folio_account_tokens SET expires_at=$1 WHERE user_id=$2", [
    Date.now() - 1,
    invited.user.id,
  ]);
  await assert.rejects(
    redeemToken(new URL(replacement.link).hash.slice(1), "pending-password"),
    /expired|used/i,
  );
  assert.equal((await accounts.getAccount(invited.user.id))?.status, "invited");
});

test("account deletion removes only its workspace and cleans late signed CSV uploads", async () => {
  assert.ok(accounts);
  const { inviteUser } = await import("../src/lib/account-admin");
  const { redeemToken } = await import("../src/lib/account-tokens");
  const { deleteUser, cleanupDeletedUploads } = await import("../src/lib/account-delete");
  const { startCsvImport } = await import("../src/lib/csv-imports");
  const { uploadResume } = await import("../src/lib/files");
  const { csvObjectInfo } = await import("../src/lib/storage");
  const admin = await accounts.authenticate("admin@example.com", "a-secure-password");
  const invitation = await inviteUser(admin.id, {
    name: "Delete test",
    email: "delete@example.com",
  });
  const user = await redeemToken(new URL(invitation.link).hash.slice(1), "deletion-test-password");
  const csv = "Company\nDeletion Test\n";
  const upload = await db.withUser(user.id, async () => {
    await uploadResume(
      new File(["Private candidate with React and backend experience."], "private.txt"),
    );
    return startCsvImport({ name: "late.csv", size: Buffer.byteLength(csv) });
  });
  await db.withUser(admin.id, () => db.put("company", { id: "keep", name: "Keep admin data" }));
  await deleteUser(admin.id, user.id, "delete@example.com");
  assert.equal(await accounts.getAccount(user.id), null);
  assert.equal(
    (await db.query("SELECT id FROM folio_records WHERE user_id=$1", [user.id])).rows.length,
    0,
  );
  assert.ok(await db.withUser(admin.id, () => db.get("company", "keep")));
  const late = await fetch(upload.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "text/csv" },
    body: csv,
  });
  assert.equal(late.status, 200);
  assert.equal((await csvObjectInfo(upload.import.id)).size, Buffer.byteLength(csv));
  await db.query("UPDATE folio_storage_cleanup SET after_at=0");
  await cleanupDeletedUploads();
  await assert.rejects(csvObjectInfo(upload.import.id));
});
