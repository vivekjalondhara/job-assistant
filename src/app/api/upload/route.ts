import { requireAuth, assertSameOrigin, AppError } from "@/lib/security";
import { uploadResume } from "@/lib/files";
import { importCsv } from "@/lib/imports";
export const maxDuration = 60;
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    await requireAuth();
    if (Number(req.headers.get("content-length") || 0) > 9000000)
      throw new AppError("File too large.", 413);
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError("Choose a file.");
    if (file.size > 8000000) throw new AppError("File too large.", 413);
    if (form.get("type") === "csv") {
      const result = importCsv(await file.text());
      return Response.json({ message: `Imported ${result.companies} companies.` });
    }
    await uploadResume(file);
    return Response.json({
      message: "Résumé uploaded. Extract with AI or update your profile manually, then confirm it.",
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof AppError ? e.message : "Could not process this file." },
      { status: e instanceof AppError ? e.status : 500 },
    );
  }
}
