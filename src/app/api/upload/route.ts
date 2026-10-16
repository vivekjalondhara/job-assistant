import { withAuth } from "@/lib/security";
import { assertSameOrigin, AppError } from "@/lib/security";
import { uploadResume } from "@/lib/files";
import { importCsv } from "@/lib/imports";
export const maxDuration = 60;
export async function POST(req: Request) {
  try {
    return await withAuth(async () => {
      assertSameOrigin(req);
      if (Number(req.headers.get("content-length") || 0) > 4400000)
        throw new AppError("File too large.", 413);
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw new AppError("Choose a file.");
      if (file.size > 4 * 1024 * 1024) throw new AppError("File too large.", 413);
      if (form.get("type") === "csv") {
        const result = await importCsv(await file.text());
        return Response.json({ message: `Imported ${result.companies} companies.` });
      }
      await uploadResume(
        file,
        typeof form.get("previousId") === "string" ? String(form.get("previousId")) : undefined,
      );
      return Response.json({
        message:
          "Résumé added to your library. Choose a default attachment or use it as your profile source.",
      });
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof AppError ? e.message : "Could not process this file." },
      { status: e instanceof AppError ? e.status : 500 },
    );
  }
}
