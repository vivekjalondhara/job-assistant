import { cookies } from "next/headers";
import { appUrl, digest, AppError, setSession } from "@/lib/security";
import { get, remove, transaction } from "@/lib/db";
import { exchangeCode } from "@/lib/gmail";
export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const state = u.searchParams.get("state"),
      code = u.searchParams.get("code");
    const jar = await cookies();
    if (!state || state !== jar.get("folio_oauth")?.value || !code)
      throw new AppError("Google authorization was cancelled or expired.");
    transaction(() => {
      const pending = get<{ expires: number }>("oauth", digest(state));
      if (!pending || pending.expires < Date.now())
        throw new AppError("Google authorization expired. Try again.");
      remove("oauth", digest(state));
    });
    jar.delete("folio_oauth");
    await exchangeCode(code);
    await setSession();
    return Response.redirect(`${appUrl()}/?connected=gmail`);
  } catch (e) {
    return Response.redirect(
      `${appUrl()}/?error=${encodeURIComponent(e instanceof AppError ? e.message : "Could not complete Google authorization.")}`,
    );
  }
}
