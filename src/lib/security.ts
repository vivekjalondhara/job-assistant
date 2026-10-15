import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
  createHmac,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { get, put, now, transaction } from "./db";
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
export async function isAuthenticated() {
  const token = (await cookies()).get("folio_session")?.value;
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, secret(), {
      issuer: "folio",
      audience: "private-app",
    });
    return payload.sub === "owner";
  } catch {
    return false;
  }
}
export async function requireAuth() {
  if (!(await isAuthenticated())) throw new AppError("Please sign in again.", 401);
}
export async function setSession() {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("owner")
    .setIssuer("folio")
    .setAudience("private-app")
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret());
  (await cookies()).set("folio_session", token, {
    httpOnly: true,
    // Google's top-level callback and its redirects must retain this session.
    // State-changing API requests still require assertSameOrigin().
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
export async function hasOwner() {
  return !!(await get("owner", "main"));
}
export async function setPassword(password: string) {
  if (password.length < 12 || password.length > 256)
    throw new AppError("Use a password between 12 and 256 characters.");
  await transaction(async () => {
    if (await hasOwner()) throw new AppError("Your account is already set up.", 409);
    const salt = randomBytes(16).toString("hex");
    await put("owner", {
      id: "main",
      salt,
      hash: scryptSync(password, salt, 64).toString("hex"),
      createdAt: now(),
    });
  });
}
export async function verifyPassword(password: string) {
  const owner = await get<{
    salt: string;
    hash: string;
  }>("owner", "main");
  if (!owner || password.length > 256) return false;
  return timingSafeEqual(scryptSync(password, owner.salt, 64), Buffer.from(owner.hash, "hex"));
}
export async function checkLoginRate() {
  await transaction(async () => {
    const value = await get<{ count: number; until: number }>("rate", "login");
    if (value && value.until > Date.now() && value.count >= 10)
      throw new AppError("Too many attempts. Try again in 15 minutes.", 429);
    await put("rate", {
      id: "login",
      count: value && value.until > Date.now() ? value.count + 1 : 1,
      until: value && value.until > Date.now() ? value.until : Date.now() + 900000,
    });
  });
}
