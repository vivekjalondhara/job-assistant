import {
  assertSameOrigin,
  assertSetupToken,
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
    await checkLoginRate();
    const body = await req.json();
    if (typeof body.password !== "string") throw new AppError("Enter your password.");
    if (!(await hasOwner())) {
      assertSetupToken(body.setupToken);
      await setPassword(body.password);
    } else if (!(await verifyPassword(body.password)))
      throw new AppError("Incorrect password.", 401);
    await remove("rate", "login");
    await setSession();
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { error: e instanceof AppError ? e.message : "Could not sign in." },
      { status: e instanceof AppError ? e.status : 500 },
    );
  }
}
