import { after } from "next/server";
import { runWorker } from "@/lib/worker";
import { requireAuth, AppError } from "@/lib/security";
import { state } from "@/lib/service";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await requireAuth();
    after(async () => {
      try {
        await runWorker();
      } catch {
        console.error("[worker] Queued work will retry on the next trigger.");
      }
    });
    return Response.json(await state());
  } catch (e) {
    return Response.json(
      { error: e instanceof AppError ? e.message : "Could not load your workspace." },
      { status: e instanceof AppError ? e.status : 500 },
    );
  }
}

export const maxDuration = 300;
