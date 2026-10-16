import { userId, withUser } from "@/lib/db";
import { withAuth } from "@/lib/security";
import { after } from "next/server";
import { runWorker } from "@/lib/worker";
import { z } from "zod";
import { assertSameOrigin, AppError } from "@/lib/security";
import { action } from "@/lib/service";
export const maxDuration = 300;
export async function POST(req: Request) {
  try {
    return await withAuth(async () => {
      const ownerId = userId();
      assertSameOrigin(req);
      if (Number(req.headers.get("content-length") || 0) > 200000)
        throw new AppError("Request too large.", 413);
      const raw = await req.text();
      if (raw.length > 200000) throw new AppError("Request too large.", 413);
      const parsed = z
        .object({ action: z.string(), payload: z.unknown().optional() })
        .parse(JSON.parse(raw));
      const result = await action(parsed.action, parsed.payload);
      if (["company.scan", "gmail.sync"].includes(parsed.action))
        after(async () => {
          try {
            await withUser(ownerId, () => runWorker(120000));
          } catch {
            console.error("[worker] Queued work will retry on the next trigger.");
          }
        });
      return Response.json(result);
    });
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
