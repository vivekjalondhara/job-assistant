import { withAuth } from "@/lib/security";
import { companyPage } from "@/lib/companies";
import { AppError } from "@/lib/security";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    return await withAuth(async () => {
      const params = new URL(req.url).searchParams;
      const page = Number(params.get("page") || 1);
      if (!Number.isSafeInteger(page) || page < 1) throw new AppError("Invalid page.");
      return Response.json(await companyPage(params.get("q") || "", page));
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof AppError ? error.message : "Could not load companies." },
      { status: error instanceof AppError ? error.status : 500 },
    );
  }
}
