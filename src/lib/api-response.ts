import { z } from "zod";
import { AppError } from "./security";
export async function jsonBody(req: Request, max = 8192) {
  if (Number(req.headers.get("content-length") || 0) > max)
    throw new AppError("Request too large.", 413);
  const raw = await req.text();
  if (raw.length > max) throw new AppError("Request too large.", 413);
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new AppError("Invalid request.");
  }
}
export function apiError(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof AppError
          ? error.message
          : error instanceof z.ZodError
            ? error.issues.map((i) => i.message).join("; ")
            : "The request could not be completed.",
    },
    { status: error instanceof AppError ? error.status : error instanceof z.ZodError ? 400 : 500 },
  );
}
