import { randomBytes } from "node:crypto";
import { query, transaction } from "./db";
import { appUrl, digest, AppError } from "./security";
import { audit, getAccount, passwordHash } from "./accounts";
import { sendAccountLink } from "./account-mail";

export async function issueAccountToken(userId: string, purpose: "invite" | "reset") {
  const token = randomBytes(32).toString("hex");
  await transaction(async () => {
    const user = await getAccount(userId);
    if (!user || !["active", "invited"].includes(user.status))
      throw new AppError("This account cannot receive a password link.", 409);
    await query("DELETE FROM folio_account_tokens WHERE user_id=$1", [userId]);
    await query(
      "INSERT INTO folio_account_tokens(digest,user_id,purpose,expires_at) VALUES($1,$2,$3,$4)",
      [digest(token), userId, purpose, Date.now() + 86400000],
    );
  });
  // Fragment tokens are not included in HTTP access logs or Referer headers.
  return `${appUrl()}/activate#${token}`;
}
export async function redeemToken(token: string, password: string) {
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new AppError(
      "This link is expired or already used. Ask your administrator for a new one.",
    );
  const fields = passwordHash(password);
  return transaction(async () => {
    const pending = (
      await query<{ user_id: string; expires_at: string }>(
        "SELECT user_id,expires_at FROM folio_account_tokens WHERE digest=$1 FOR UPDATE",
        [digest(token)],
      )
    ).rows[0];
    const user = pending ? await getAccount(pending.user_id) : null;
    if (
      !pending ||
      Number(pending.expires_at) < Date.now() ||
      !user ||
      !["active", "invited"].includes(user.status)
    )
      throw new AppError(
        "This link is expired or already used. Ask your administrator for a new one.",
      );
    await query(
      "UPDATE folio_accounts SET salt=$1,hash=$2,status='active',session_version=session_version+1 WHERE id=$3",
      [fields.salt, fields.hash, user.id],
    );
    await query("DELETE FROM folio_account_tokens WHERE user_id=$1", [user.id]);
    await audit(
      user.id,
      user.id,
      user.status === "invited" ? "invitation.accepted" : "password.reset",
    );
    return (await getAccount(user.id))!;
  });
}
export async function deliverAccountLink(userId: string, purpose: "invite" | "reset") {
  const user = await getAccount(userId);
  if (!user?.email) throw new AppError("Add an account email first.");
  const link = await issueAccountToken(userId, purpose);
  let delivered = false;
  try {
    delivered = await sendAccountLink(user.email, link, purpose);
  } catch {
    console.error("account_email_delivery_failed");
  }
  return { link, delivered };
}
