import { cookies } from "next/headers";
import { assertSameOrigin } from "@/lib/security";
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    (await cookies()).delete("folio_session");
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 403 });
  }
}
