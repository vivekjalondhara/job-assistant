import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { query, transaction, now, LEGACY_USER_ID, currentUserId } from "./db";
import { AppError } from "./security";
import { defaultLimits, type Account } from "./account-types";

export const accountColumns = "id,email,name,role,status,session_version,limits,created_at";
export const emailSchema = z
  .email()
  .max(320)
  .transform((s) => s.trim().toLowerCase());
export function passwordHash(password: string) {
  if (typeof password !== "string" || password.length < 12 || password.length > 256)
    throw new AppError("Use a password between 12 and 256 characters.");
  const salt = randomBytes(16).toString("hex");
  return { salt, hash: scryptSync(password, salt, 64).toString("hex") };
}
export function passwordMatches(password: string, salt: string | null, hash: string | null) {
  if (!salt || !hash || typeof password !== "string" || password.length > 256) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}
export async function getAccount(id: string): Promise<Account | null> {
  return (
    (await query<Account>(`SELECT ${accountColumns} FROM folio_accounts WHERE id=$1`, [id]))
      .rows[0] || null
  );
}
export async function requireActiveAccount(id: string) {
  const user = await getAccount(id);
  if (!user || user.status !== "active")
    throw new AppError("Your account is unavailable. Contact your administrator.", 401);
  return user;
}
export async function requireAdminAccount(id: string) {
  const user = await requireActiveAccount(id);
  if (user.role !== "admin") throw new AppError("Administrator access is required.", 403);
  return user;
}
export async function currentAccount() {
  const id = currentUserId();
  return id ? await getAccount(id) : null;
}
export async function hasAccounts() {
  return !!(await query("SELECT id FROM folio_accounts LIMIT 1")).rows.length;
}
export async function createFirstAdmin(name: string, email: string | null, password: string) {
  const fields = passwordHash(password);
  const parsedName = z.string().trim().min(1).max(100).parse(name);
  const parsedEmail = email === null ? null : emailSchema.parse(email);
  return transaction(async () => {
    if (await hasAccounts()) throw new AppError("An administrator is already set up.", 409);
    await query(
      `INSERT INTO folio_accounts(id,email,name,role,status,salt,hash,created_at,limits)
      VALUES($1,$2,$3,'admin','active',$4,$5,$6,$7::jsonb)`,
      [
        LEGACY_USER_ID,
        parsedEmail,
        parsedName,
        fields.salt,
        fields.hash,
        now(),
        JSON.stringify(defaultLimits),
      ],
    );
    return (await getAccount(LEGACY_USER_ID))!;
  });
}
export async function authenticate(email: string, password: string) {
  const normalized = typeof email === "string" ? email.trim().toLowerCase() : "";
  const result = await query<Account & { salt: string; hash: string }>(
    "SELECT * FROM folio_accounts WHERE email=$1 OR (id=$2 AND email IS NULL)",
    [normalized, LEGACY_USER_ID],
  );
  const user = result.rows.find((u) => passwordMatches(password, u.salt, u.hash));
  if (!user || user.status !== "active")
    throw new AppError("Invalid credentials or disabled account.", 401);
  // An existing owner proves their old password before claiming their new login email.
  if (!user.email && normalized) {
    const parsed = emailSchema.parse(normalized);
    await transaction(async () => {
      if (
        (await query("SELECT id FROM folio_accounts WHERE email=$1 AND id<>$2", [parsed, user.id]))
          .rows.length
      )
        throw new AppError("This email is already in use.", 409);
      await query("UPDATE folio_accounts SET email=$1 WHERE id=$2 AND email IS NULL", [
        parsed,
        user.id,
      ]);
    });
  }
  return (await getAccount(user.id))!;
}
export async function audit(actor: string, target: string, action: string) {
  await query("INSERT INTO folio_audit(actor_id,target_id,action,created_at) VALUES($1,$2,$3,$4)", [
    actor,
    target,
    action,
    now(),
  ]);
}
