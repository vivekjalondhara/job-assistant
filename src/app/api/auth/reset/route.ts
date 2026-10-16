import { assertSameOrigin, checkLoginRate } from "@/lib/security";
import { emailSchema } from "@/lib/accounts";
import { deliverAccountLink } from "@/lib/account-tokens";
import { query } from "@/lib/db";
import { accountMailConfigured } from "@/lib/account-mail";
import { jsonBody, apiError } from "@/lib/api-response";
import { z } from "zod";
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const { email } = z.object({ email: emailSchema }).parse(await jsonBody(req));
    await checkLoginRate(`reset:${email}`);
    if (accountMailConfigured()) {
      const user = (
        await query<{ id: string }>(
          "SELECT id FROM folio_accounts WHERE email=$1 AND status='active'",
          [email],
        )
      ).rows[0];
      if (user) await deliverAccountLink(user.id, "reset");
    }
    return Response.json({
      message:
        "If this account is active and email delivery is configured, a reset link will arrive shortly. Otherwise, ask your administrator for a reset link.",
    });
  } catch (e) {
    return apiError(e);
  }
}
