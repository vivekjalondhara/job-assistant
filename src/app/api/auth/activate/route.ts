import { z } from "zod";
import { assertSameOrigin, checkLoginRate, setSession } from "@/lib/security";
import { redeemToken } from "@/lib/account-tokens";
import { jsonBody, apiError } from "@/lib/api-response";
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const body = z
      .object({ token: z.string().length(64), password: z.string().min(12).max(256) })
      .parse(await jsonBody(req));
    await checkLoginRate(`activate:${body.token}`);
    const user = await redeemToken(body.token, body.password);
    await setSession(user);
    return Response.json({ redirect: user.role === "admin" ? "/admin" : "/" });
  } catch (e) {
    return apiError(e);
  }
}
