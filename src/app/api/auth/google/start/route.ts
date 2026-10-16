import { withAuth } from "@/lib/security";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { appUrl, digest, AppError, setSession } from "@/lib/security";
import { put } from "@/lib/db";
import { authorizationUrl } from "@/lib/gmail";
export async function GET() {
  try {
    return await withAuth(async () => {
      const state = randomBytes(32).toString("hex");
      const url = authorizationUrl(state);
      // Also replace older Strict cookies before leaving the app for Google.
      await setSession();
      await put("oauth", { id: digest(state), expires: Date.now() + 600000 });
      (await cookies()).set("folio_oauth", state, {
        httpOnly: true,
        sameSite: "lax",
        secure: appUrl().startsWith("https:"),
        path: "/api/auth/google",
        maxAge: 600,
      });
      return Response.redirect(url);
    });
  } catch (e) {
    return Response.redirect(
      `${appUrl()}/?error=${encodeURIComponent(e instanceof AppError ? e.message : "Could not connect Gmail.")}`,
    );
  }
}
