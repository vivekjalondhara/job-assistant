import { withAuth } from "@/lib/security";
import { AppError } from "@/lib/security";
import { readResume } from "@/lib/files";
export async function GET(
  _req: Request,
  context: {
    params: Promise<{
      id: string;
    }>;
  },
) {
  try {
    return await withAuth(async () => {
      const { id } = await context.params;
      const file = await readResume(id);
      return new Response(new Uint8Array(file.buffer), {
        headers: {
          "Content-Type": file.meta.mime,
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.meta.name)}`,
          "Cache-Control": "no-store",
        },
      });
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof AppError ? e.message : "Could not read résumé." },
      { status: e instanceof AppError ? e.status : 500 },
    );
  }
}
