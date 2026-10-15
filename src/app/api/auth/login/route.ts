import {
  assertSameOrigin,
  hasOwner,
  setPassword,
  verifyPassword,
  setSession,
  AppError,
  checkLoginRate,
} from "@/lib/security";
import { remove } from "@/lib/db";
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    checkLoginRate();
    const body = await req.json();
    if (typeof body.password !== "string") throw new AppError("Enter your password.");
    if (!hasOwner()) setPassword(body.password);
    else if (!verifyPassword(body.password)) throw new AppError("Incorrect password.", 401);
    remove("rate", "login");
    await setSession();
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { error: e instanceof AppError ? e.message : "Could not sign in." },
      { status: e instanceof AppError ? e.status : 500 },
    );
  }
}
