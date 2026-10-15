import { cookies } from "next/headers";
import { appUrl, digest, AppError, setSession } from "@/lib/security";
import { get, remove, transaction } from "@/lib/db";
import { exchangeCode } from "@/lib/gmail";
export async function GET(req: Request) {
  let stage = "validate_state";
  try {
    const u = new URL(req.url);
    const state = u.searchParams.get("state"),
      code = u.searchParams.get("code");
    const jar = await cookies();
    if (!state || state !== jar.get("folio_oauth")?.value)
      throw new AppError("Google authorization was cancelled or expired.");
    await transaction(async () => {
      const pending = await get<{
        expires: number;
      }>("oauth", digest(state));
      if (!pending || pending.expires < Date.now())
        throw new AppError("Google authorization expired. Try again.");
      await remove("oauth", digest(state));
    });
    jar.set("folio_oauth", "", {
      httpOnly: true,
      sameSite: "lax",
      secure: appUrl().startsWith("https:"),
      path: "/api/auth/google",
      maxAge: 0,
    });
    stage = "google_consent";
    if (u.searchParams.has("error") || !code)
      throw new AppError(
        "Gmail connection was cancelled. Try again and grant both Gmail permissions.",
      );
    stage = "exchange_code";
    await exchangeCode(code);
    stage = "create_session";
    await setSession();
    return Response.redirect(`${appUrl()}/?connected=gmail`);
  } catch (e) {
    // Never log callback URLs, authorization codes, cookies, or token responses.
    console.warn("[gmail oauth] Callback failed", {
      stage,
      reason: e instanceof AppError ? e.message : "Unexpected authentication error",
      errorType: e instanceof Error ? e.name : "UnknownError",
    });
    return Response.redirect(
      `${appUrl()}/?error=${encodeURIComponent(e instanceof AppError ? e.message : "Could not complete Google authorization.")}`,
    );
  }
}
