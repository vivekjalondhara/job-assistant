import { userId, withUser } from "@/lib/db";
import { withAuth } from "@/lib/security";
import { after } from "next/server";
import { assertSameOrigin, AppError } from "@/lib/security";
import {
  completeCsvUpload,
  listCsvImports,
  resumeCsvUpload,
  retryCsvImport,
  runCsvImports,
  startCsvImport,
} from "@/lib/csv-imports";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

function schedule() {
  const ownerId = userId();
  after(async () => {
    try {
      await withUser(ownerId, () => runCsvImports());
    } catch {
      console.error("csv_import_worker_unavailable");
    }
  });
}

function failure(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof AppError
          ? error.message
          : "The import could not be started. Please try again.",
    },
    { status: error instanceof AppError ? error.status : 500 },
  );
}

export async function GET() {
  try {
    return await withAuth(async () => {
      const imports = await listCsvImports();
      if (imports.some((value) => ["queued", "processing"].includes(value.status))) schedule();
      return Response.json({ imports });
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(req: Request) {
  try {
    return await withAuth(async () => {
      assertSameOrigin(req);
      if (Number(req.headers.get("content-length") || 0) > 4096)
        throw new AppError("Request too large.", 413);
      const raw = await req.text();
      if (raw.length > 4096) throw new AppError("Request too large.", 413);
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        throw new AppError("Invalid import request.");
      }
      if (!body || typeof body !== "object") throw new AppError("Invalid import request.");
      if (body.action === "start")
        return Response.json(await startCsvImport(body), { status: 201 });
      if (typeof body.id !== "string") throw new AppError("Invalid import reference.");
      if (body.action === "resume") return Response.json(await resumeCsvUpload(body.id));
      const value =
        body.action === "complete"
          ? await completeCsvUpload(body.id)
          : body.action === "retry"
            ? await retryCsvImport(body.id)
            : null;
      if (!value) throw new AppError("Unknown import action.");
      schedule();
      return Response.json({ import: value });
    });
  } catch (error) {
    return failure(error);
  }
}
