import { z } from "zod";
import { requireAuth, assertSameOrigin, AppError } from "@/lib/security";
import { action } from "@/lib/service";
export const maxDuration = 120;
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    await requireAuth();
    if (Number(req.headers.get("content-length") || 0) > 200000)
      throw new AppError("Request too large.", 413);
    const raw = await req.text();
    if (raw.length > 200000) throw new AppError("Request too large.", 413);
    const parsed = z
      .object({ action: z.string(), payload: z.unknown().optional() })
      .parse(JSON.parse(raw));
    return Response.json(await action(parsed.action, parsed.payload));
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof AppError
            ? e.message
            : e instanceof z.ZodError
              ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
              : "This action could not be completed. Please try again.",
      },
      { status: e instanceof AppError ? e.status : e instanceof z.ZodError ? 400 : 500 },
    );
  }
}
