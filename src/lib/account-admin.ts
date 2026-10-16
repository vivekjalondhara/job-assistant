import { z } from "zod";
import { query, transaction, id, now } from "./db";
import { accountColumns, audit, emailSchema, getAccount, requireAdminAccount } from "./accounts";
import {
  defaultLimits,
  type Account,
  type AdminSummary,
  type ManagedAccount,
} from "./account-types";
import { AppError } from "./security";
import { deliverAccountLink } from "./account-tokens";
import { accountMailConfigured } from "./account-mail";
export const limitsSchema = z.object({
  storageMb: z.number().int().min(1).max(10000),
  monthlyAiBudget: z.number().min(0).max(10000),
  dailySendLimit: z.number().int().min(0).max(500),
});
export async function inviteUser(actorId: string, input: unknown) {
  await requireAdminAccount(actorId);
  const fields = z
    .object({
      name: z.string().trim().min(1).max(100),
      email: emailSchema,
      limits: limitsSchema.optional(),
    })
    .strict()
    .parse(input);
  const user = await transaction(async () => {
    await requireAdminAccount(actorId);
    if ((await query("SELECT id FROM folio_accounts WHERE email=$1", [fields.email])).rows.length)
      throw new AppError("A user with this email already exists.", 409);
    const userId = id();
    await query(
      `INSERT INTO folio_accounts(id,email,name,role,status,limits,created_at) VALUES($1,$2,$3,'user','invited',$4::jsonb,$5)`,
      [userId, fields.email, fields.name, JSON.stringify(fields.limits || defaultLimits), now()],
    );
    await audit(actorId, userId, "user.invited");
    return (await getAccount(userId))!;
  });
  return { user, ...(await deliverAccountLink(user.id, "invite")) };
}
export async function updateUser(actorId: string, targetId: string, input: unknown) {
  await requireAdminAccount(actorId);
  const fields = z
    .object({
      name: z.string().trim().min(1).max(100).optional(),
      status: z.enum(["active", "disabled"]).optional(),
      limits: limitsSchema.optional(),
    })
    .strict()
    .parse(input);
  return transaction(async () => {
    await requireAdminAccount(actorId);
    const user = await getAccount(targetId);
    if (!user) throw new AppError("User not found.", 404);
    if (user.role === "admin")
      throw new AppError("Administrator accounts cannot be changed here.", 403);
    if (user.status === "deleting") throw new AppError("Account deletion is in progress.", 409);
    const nextStatus =
      fields.status === "active" &&
      !(await query("SELECT id FROM folio_accounts WHERE id=$1 AND hash IS NOT NULL", [targetId]))
        .rows.length
        ? "invited"
        : fields.status || user.status;
    await query(
      "UPDATE folio_accounts SET name=$1,status=$2,limits=$3::jsonb,session_version=session_version+1 WHERE id=$4",
      [
        fields.name || user.name,
        nextStatus,
        JSON.stringify(fields.limits || user.limits),
        targetId,
      ],
    );
    if (fields.status === "disabled")
      await query("DELETE FROM folio_account_tokens WHERE user_id=$1", [targetId]);
    await audit(actorId, targetId, fields.status ? `user.${fields.status}` : "user.updated");
    return (await getAccount(targetId))!;
  });
}
export async function resendUserLink(actorId: string, targetId: string) {
  await requireAdminAccount(actorId);
  const user = await getAccount(targetId);
  if (!user || user.role === "admin") throw new AppError("User not found.", 404);
  const result = await deliverAccountLink(targetId, user.status === "invited" ? "invite" : "reset");
  await audit(actorId, targetId, "user.link_issued");
  return result;
}
export async function adminSummary(actorId: string): Promise<AdminSummary> {
  await requireAdminAccount(actorId);
  const users = (
    await query<Account>(`SELECT ${accountColumns} FROM folio_accounts ORDER BY created_at DESC`)
  ).rows;
  const totals = (
    await query<{
      user_id: string;
      storage: string;
      cost: string;
      unknown_costs: string;
      failed_imports: string;
    }>(
      `SELECT user_id,
    COALESCE(sum(CASE WHEN kind='file' OR (kind='csv-import' AND data->>'cleanedAt' IS NULL) THEN (data->>'size')::bigint ELSE 0 END),0) AS storage,
    COALESCE(sum(CASE WHEN kind='usage' AND data->>'createdAt'>=$1 THEN (data->>'cost')::numeric ELSE 0 END),0) AS cost,
    count(*) FILTER (WHERE kind='usage' AND data->>'createdAt'>=$1 AND (data->>'cost') IS NULL) AS unknown_costs,
    count(*) FILTER (WHERE kind='csv-import' AND data->>'status'='failed') AS failed_imports
    FROM folio_records GROUP BY user_id`,
      [now().slice(0, 7)],
    )
  ).rows;
  const failures = (
    await query<{ user_id: string; count: string }>(
      `SELECT user_id,count(*) FROM folio_tasks WHERE status='failed' GROUP BY user_id`,
    )
  ).rows;
  return {
    users: users.map((u): ManagedAccount => {
      const total = totals.find((t) => t.user_id === u.id);
      return {
        ...u,
        storageBytes: Number(total?.storage || 0),
        aiCost: Number(total?.cost || 0),
        unknownAiCosts: Number(total?.unknown_costs || 0),
        failedTasks:
          Number(failures.find((f) => f.user_id === u.id)?.count || 0) +
          Number(total?.failed_imports || 0),
      };
    }),
    audit: (
      await query<AdminSummary["audit"][number]>(
        "SELECT * FROM folio_audit ORDER BY id DESC LIMIT 100",
      )
    ).rows,
    emailConfigured: accountMailConfigured(),
  };
}
