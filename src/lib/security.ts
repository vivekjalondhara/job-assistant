import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
  createHmac,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { dataDir, get, put, now, transaction } from "./db";

export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function secret(): Buffer {
  if (process.env.APP_ENCRYPTION_KEY) {
    if (!/^[a-f0-9]{64}$/i.test(process.env.APP_ENCRYPTION_KEY))
      throw new Error("APP_ENCRYPTION_KEY must contain 64 hexadecimal characters.");
    return Buffer.from(process.env.APP_ENCRYPTION_KEY, "hex");
  }
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = path.join(dataDir, ".encryption-key");
  if (!existsSync(file)) {
    try {
      writeFileSync(file, randomBytes(32), { mode: 0o600, flag: "wx" });
    } catch (e) {
      if (!existsSync(file)) throw e;
    }
  }
  return readFileSync(file);
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
export const appUrl = () => process.env.APP_URL || "http://localhost:3210";
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
    sameSite: "strict",
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
export function hasOwner() {
  return !!get("owner", "main");
}
export function setPassword(password: string) {
  if (password.length < 12 || password.length > 256)
    throw new AppError("Use a password between 12 and 256 characters.");
  transaction(() => {
    if (hasOwner()) throw new AppError("Your account is already set up.", 409);
    const salt = randomBytes(16).toString("hex");
    put("owner", {
      id: "main",
      salt,
      hash: scryptSync(password, salt, 64).toString("hex"),
      createdAt: now(),
    });
  });
}
export function verifyPassword(password: string) {
  const owner = get<{ salt: string; hash: string }>("owner", "main");
  if (!owner || password.length > 256) return false;
  return timingSafeEqual(scryptSync(password, owner.salt, 64), Buffer.from(owner.hash, "hex"));
}
export function checkLoginRate() {
  const value = get<{ id: string; count: number; until: number }>("rate", "login");
  if (value && value.until > Date.now() && value.count >= 10)
    throw new AppError("Too many attempts. Try again in 15 minutes.", 429);
  put("rate", {
    id: "login",
    count: value && value.until > Date.now() ? value.count + 1 : 1,
    until: value && value.until > Date.now() ? value.until : Date.now() + 900000,
  });
}
