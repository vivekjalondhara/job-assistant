import { timingSafeEqual } from "node:crypto";
import { runWorker } from "@/lib/worker";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const expected = Buffer.from(`Bearer ${secret || ""}`);
  const actual = Buffer.from(req.headers.get("authorization") || "");
  if (!secret || expected.length !== actual.length || !timingSafeEqual(expected, actual))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return Response.json(await runWorker());
  } catch {
    return Response.json({ error: "Background processing failed." }, { status: 500 });
  }
}
