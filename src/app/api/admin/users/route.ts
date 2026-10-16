import { z } from "zod";
import { assertSameOrigin, requireAuth } from "@/lib/security";
import { adminSummary, inviteUser, updateUser, resendUserLink } from "@/lib/account-admin";
import { deleteUser } from "@/lib/account-delete";
import { apiError, jsonBody } from "@/lib/api-response";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return Response.json(await adminSummary((await requireAuth()).id));
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const actor = await requireAuth();
    const body = z
      .object({
        action: z.enum(["invite", "update", "resend", "delete"]),
        id: z.string().max(100).optional(),
        payload: z.unknown().optional(),
        confirmation: z.string().max(320).optional(),
      })
      .parse(await jsonBody(req));
    if (body.action === "invite")
      return Response.json(await inviteUser(actor.id, body.payload), { status: 201 });
    const target = z.string().min(1).parse(body.id);
    if (body.action === "update")
      return Response.json({ user: await updateUser(actor.id, target, body.payload) });
    if (body.action === "resend") return Response.json(await resendUserLink(actor.id, target));
    await deleteUser(actor.id, target, body.confirmation || "");
    return Response.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
