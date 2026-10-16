import { requireActiveAccount } from "./accounts";
import { query, userId, settings } from "./db";
import { AppError } from "./security";

export async function assertAccountAvailable() {
  return requireActiveAccount(userId());
}
export async function effectiveLimits() {
  const user = await assertAccountAvailable();
  const own = await settings();
  return {
    dailySendLimit: Math.min(own.dailySendLimit, user.limits.dailySendLimit),
    monthlyAiBudget: Math.min(own.monthlyAiBudget, user.limits.monthlyAiBudget),
    storageMb: user.limits.storageMb,
  };
}
export async function assertStorageAvailable(extraBytes: number) {
  const limit = (await effectiveLimits()).storageMb * 1024 * 1024;
  const result = await query<{ used: string }>(
    `SELECT COALESCE(sum((data->>'size')::bigint),0) AS used FROM folio_records
    WHERE user_id=$1 AND (kind='file' OR (kind='csv-import' AND data->>'cleanedAt' IS NULL))`,
    [userId()],
  );
  if (Number(result.rows[0].used) + extraBytes > limit)
    throw new AppError(
      "Your storage allowance is full. Delete unused files or contact your administrator.",
      429,
    );
}
