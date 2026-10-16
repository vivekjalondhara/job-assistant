import { query, userId } from "./db";
import type { Company } from "./types";

export interface CompanyPage {
  companies: Company[];
  total: number;
  page: number;
  pageSize: number;
}

export async function companyPage(search = "", page = 1): Promise<CompanyPage> {
  const pageSize = 50;
  const pattern = `%${search
    .trim()
    .slice(0, 200)
    .replace(/[\\%_]/g, "\\$&")}%`;
  const filter = "user_id=$2 AND kind='company' AND ($1='%%' OR data->>'name' ILIKE $1)";
  const count = await query<{ count: number }>(
    `SELECT count(*)::int AS count FROM folio_records WHERE ${filter}`,
    [pattern, userId()],
  );
  const total = count.rows[0].count;
  const currentPage = Math.max(1, Math.min(Math.floor(page), Math.ceil(total / pageSize) || 1));
  const result = await query<{ data: Company }>(
    `SELECT data FROM folio_records WHERE ${filter} ORDER BY sequence DESC LIMIT $3 OFFSET $4`,
    [pattern, userId(), pageSize, (currentPage - 1) * pageSize],
  );
  return { companies: result.rows.map((r) => r.data), total, page: currentPage, pageSize };
}
