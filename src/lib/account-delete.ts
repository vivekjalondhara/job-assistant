import { query, transaction } from "./db";
import { audit, getAccount, requireAdminAccount } from "./accounts";
import { AppError } from "./security";
import { csvKey, resumeKey, deleteObject } from "./storage";
export async function deleteUser(actorId: string, targetId: string, confirmation: string) {
  await requireAdminAccount(actorId);
  await transaction(async () => {
    const user = await getAccount(targetId);
    if (!user || user.role === "admin")
      throw new AppError("Only user accounts can be deleted here.", 403);
    if (confirmation !== user.email)
      throw new AppError("Enter the user’s exact email to confirm deletion.");
    await query(
      "UPDATE folio_accounts SET status='deleting',session_version=session_version+1 WHERE id=$1",
      [targetId],
    );
    await query("DELETE FROM folio_account_tokens WHERE user_id=$1", [targetId]);
    await audit(actorId, targetId, "user.deletion_started");
  });
  // Keep records until storage cleanup succeeds, so a failed deletion is retryable.
  const objects = (
    await query<{ kind: string; id: string }>(
      "SELECT kind,id FROM folio_records WHERE user_id=$1 AND kind IN ('file','csv-import')",
      [targetId],
    )
  ).rows;
  for (const object of objects) {
    const key = object.kind === "file" ? resumeKey(object.id) : csvKey(object.id);
    // A previously signed CSV upload can finish after deletion. Repeat cleanup
    // after all issued one-hour upload URLs have expired.
    if (object.kind === "csv-import")
      await query(
        "INSERT INTO folio_storage_cleanup(object_key,after_at) VALUES($1,$2) ON CONFLICT(object_key) DO UPDATE SET after_at=EXCLUDED.after_at",
        [key, Date.now() + 3660000],
      );
    await deleteObject(key);
  }
  await transaction(async () => {
    await query("DELETE FROM folio_records WHERE user_id=$1", [targetId]);
    await query("DELETE FROM folio_tasks WHERE user_id=$1", [targetId]);
    await query("DELETE FROM folio_accounts WHERE id=$1", [targetId]);
    await audit(actorId, targetId, "user.deleted");
  });
}

export async function cleanupDeletedUploads() {
  const pending = (
    await query<{ object_key: string }>(
      "SELECT object_key FROM folio_storage_cleanup WHERE after_at<$1 LIMIT 50",
      [Date.now()],
    )
  ).rows;
  for (const item of pending) {
    try {
      await deleteObject(item.object_key);
      await query("DELETE FROM folio_storage_cleanup WHERE object_key=$1", [item.object_key]);
    } catch {
      console.error("deleted_upload_cleanup_failed");
    }
  }
}
