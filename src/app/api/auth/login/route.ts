import { z } from "zod";
import {
  assertSameOrigin,
  assertSetupToken,
  hasOwner,
  setSession,
  AppError,
  checkLoginRate,
} from "@/lib/security";
import { authenticate, createFirstAdmin } from "@/lib/accounts";
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    if (Number(req.headers.get("content-length") || 0) > 8192)
      throw new AppError("Request too large.", 413);
    const raw = await req.text();
    if (raw.length > 8192) throw new AppError("Request too large.", 413);
    const body = z
      .object({
        email: z.string().max(320).default(""),
        name: z.string().max(100).default("Administrator"),
        password: z.string().max(256),
        setupToken: z.unknown().optional(),
      })
      .parse(JSON.parse(raw));
    await checkLoginRate(`login:${body.email.trim().toLowerCase()}`);
    let user;
    if (!(await hasOwner())) {
      assertSetupToken(body.setupToken);
      user = await createFirstAdmin(body.name, body.email || null, body.password);
    } else user = await authenticate(body.email, body.password);
    await setSession(user);
    return Response.json({ ok: true, redirect: user.role === "admin" ? "/admin" : "/" });
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof AppError
            ? e.message
            : e instanceof z.ZodError
              ? "Enter a valid email and password."
              : "Could not sign in.",
      },
      { status: e instanceof AppError ? e.status : e instanceof z.ZodError ? 400 : 500 },
    );
  }
}
