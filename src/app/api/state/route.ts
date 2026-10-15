import { requireAuth, AppError } from "@/lib/security";
import { state } from "@/lib/service";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await requireAuth();
    return Response.json(state());
  } catch (e) {
    return Response.json(
      { error: e instanceof AppError ? e.message : "Could not load your workspace." },
      { status: e instanceof AppError ? e.status : 500 },
    );
  }
}
