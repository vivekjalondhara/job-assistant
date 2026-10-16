import { id, now, putMany, query, userId } from "./db";
import { inferBoard } from "./jobs";
import type { Company } from "./types";

const url = (value: string) => {
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : "";
  } catch {
    return "";
  }
};

export function companyFromCsv(row: Record<string, string>): Company | string {
  if (Object.values(row).some((value) => value.includes("\u0000")))
    return "Row contains a null character. Save the CSV as UTF-8 text.";
  const name = (row["company name"] || row.company || row.name || "").trim();
  if (!name) return "Company name is missing.";
  if (name.length > 200) return "Company name exceeds 200 characters.";
  const website = row["official company website"] || row["official website"] || row.website || "";
  const careers = row["careers page"] || row["careers url"] || row.careersurl || "";
  const contactSource = row["contact source"] || "Imported CSV — verify before sending";
  if (website.length > 2048 || careers.length > 2048)
    return "Website URL exceeds 2,048 characters.";
  if (contactSource.length > 1000) return "Contact source exceeds 1,000 characters.";
  const careersUrl = url(careers);
  const email = row["recruitment email"] || row.email || "";
  return {
    id: id(),
    name,
    website: url(website),
    careersUrl,
    ...inferBoard(careersUrl),
    email: email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "",
    contactSource,
    contactConfirmed: false,
    priority: "normal",
    paused: false,
    lastChecked: null,
    checkStatus: "never",
    checkNote: "",
    createdAt: now(),
  };
}

// The caller holds the write transaction, so another import cannot insert the same name
// between this indexed lookup and the bulk insert. Existing company details are preserved.
export async function insertCompanyBatch(companies: Company[]) {
  if (!companies.length) return { companies: 0, duplicates: 0 };
  const names = companies.map((c) => c.name);
  const result = await query<{ name: string }>(
    `SELECT DISTINCT lower(btrim(data->>'name')) AS name FROM folio_records
     WHERE user_id=$2 AND kind='company' AND lower(btrim(data->>'name')) IN
       (SELECT lower(btrim(value)) FROM unnest($1::text[]) AS value)`,
    [names, userId()],
  );
  // Normalize through Postgres as well, preserving its case-folding rules for Unicode names.
  const normalized = await query<{ name: string }>(
    "SELECT lower(btrim(value)) AS name FROM unnest($1::text[]) AS value",
    [names],
  );
  const seen = new Set(result.rows.map((r) => r.name));
  const fresh = companies.filter((_, index) => {
    const name = normalized.rows[index].name;
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
  await putMany("company", fresh);
  return { companies: fresh.length, duplicates: companies.length - fresh.length };
}
