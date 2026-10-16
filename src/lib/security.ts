import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { query, transaction, withUser, LEGACY_USER_ID } from "./db";
import { authenticate, createFirstAdmin, getAccount, hasAccounts } from "./accounts";
import type { Account } from "./account-types";
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function secret(): Buffer {
  const value = process.env.APP_ENCRYPTION_KEY;
  if (!value || !/^[a-f0-9]{64}$/i.test(value))
    throw new Error("Set APP_ENCRYPTION_KEY to a permanent 64-character hexadecimal key.");
  return Buffer.from(value, "hex");
}
export function encrypt(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secret(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}
export function decrypt<T>(value: string): T {
  const buf = Buffer.from(value, "base64");
  const decipher = createDecipheriv("aes-256-gcm", secret(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString(),
  ) as T;
}
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const privateHash = (value: string) =>
  createHmac("sha256", secret()).update(value).digest("hex");
export function appUrl() {
  const configured = process.env.APP_URL?.trim();
  if (process.env.VERCEL === "1") {
    // Local .env values must not send production sign-ins or OAuth back to localhost.
    if (configured) {
      const url = new URL(configured);
      if (url.protocol === "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
        return url.origin;
    }
    const host =
      process.env.VERCEL_ENV === "production"
        ? process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL
        : process.env.VERCEL_URL;
    if (!host) throw new Error("Set APP_URL to the public HTTPS application origin.");
    return new URL(`https://${host}`).origin;
  }
  return new URL(configured || "http://localhost:3210").origin;
}
export async function createSessionToken(user: Account) {
  return new SignJWT({ version: user.session_version })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuer("folio")
    .setAudience("private-app")
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret());
}
export async function accountFromToken(token: string): Promise<Account | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), {
      issuer: "folio",
      audience: "private-app",
      algorithms: ["HS256"],
    });
    if (!payload.sub) return null;
    const user = await getAccount(payload.sub);
    return user?.status === "active" && payload.version === user.session_version ? user : null;
  } catch {
    return null;
  }
}
export async function authenticatedAccount() {
  const token = (await cookies()).get("folio_session")?.value;
  return token ? accountFromToken(token) : null;
}
export async function isAuthenticated() {
  return !!(await authenticatedAccount());
}
export async function requireAuth() {
  const user = await authenticatedAccount();
  if (!user) throw new AppError("Please sign in again.", 401);
  return user;
}
export async function withAuth<T>(fn: (user: Account) => Promise<T>): Promise<T> {
  const user = await requireAuth();
  return withUser(user.id, () => fn(user));
}
export async function setSession(user?: Account) {
  const account = user || (await requireAuth());
  const token = await createSessionToken(account);
  (await cookies()).set("folio_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: appUrl().startsWith("https:"),
    path: "/",
    maxAge: 7 * 86400,
  });
}
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin || origin !== new URL(appUrl()).origin)
    throw new AppError("This request must come from your application.", 403);
}
export function assertSetupToken(value: unknown) {
  const expected = process.env.APP_SETUP_TOKEN || "";
  if (expected.length < 32)
    throw new AppError(
      "The owner must configure APP_SETUP_TOKEN before creating this workspace.",
      503,
    );
  if (
    typeof value !== "string" ||
    !timingSafeEqual(Buffer.from(digest(value), "hex"), Buffer.from(digest(expected), "hex"))
  )
    throw new AppError("Enter the workspace setup token supplied by the owner.", 403);
}
export const hasOwner = hasAccounts;
export async function setPassword(password: string) {
  return createFirstAdmin("Original owner", null, password);
}
export async function verifyPassword(password: string) {
  try {
    return (await authenticate("", password)).id === LEGACY_USER_ID;
  } catch {
    return false;
  }
}
export async function checkLoginRate(key = "login") {
  await transaction(async () => {
    const rateKey = privateHash(key);
    const value = (
      await query<{ count: number; until_at: string }>(
        "SELECT count,until_at FROM folio_login_rates WHERE key=$1",
        [rateKey],
      )
    ).rows[0];
    if (value && Number(value.until_at) > Date.now() && value.count >= 10)
      throw new AppError("Too many attempts. Try again in 15 minutes.", 429);
    await query(
      `INSERT INTO folio_login_rates(key,count,until_at) VALUES($1,$2,$3)
      ON CONFLICT(key) DO UPDATE SET count=EXCLUDED.count,until_at=EXCLUDED.until_at`,
      [
        rateKey,
        value && Number(value.until_at) > Date.now() ? value.count + 1 : 1,
        value && Number(value.until_at) > Date.now() ? Number(value.until_at) : Date.now() + 900000,
      ],
    );
    await query("DELETE FROM folio_login_rates WHERE until_at<$1", [Date.now() - 86400000]);
  });
}
