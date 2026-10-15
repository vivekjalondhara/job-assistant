import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { requireAuth, appUrl, digest, AppError } from "@/lib/security";
import { put } from "@/lib/db";
import { authorizationUrl } from "@/lib/gmail";
export async function GET() {
  try {
    await requireAuth();
    const state = randomBytes(32).toString("hex");
    const url = authorizationUrl(state);
    put("oauth", { id: digest(state), expires: Date.now() + 600000 });
    (await cookies()).set("folio_oauth", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: appUrl().startsWith("https:"),
      path: "/api/auth/google",
      maxAge: 600,
    });
    return Response.redirect(url);
  } catch (e) {
    return Response.redirect(
      `${appUrl()}/?error=${encodeURIComponent(e instanceof AppError ? e.message : "Could not connect Gmail.")}`,
    );
  }
}
