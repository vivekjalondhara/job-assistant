import { parse } from "csv-parse/sync";
import { all, put, now, id, activity, transaction } from "./db";
import type { Company, Job } from "./types";
import { inferBoard } from "./jobs";
import { AppError } from "./security";
const cleanUrl = (s: string) => {
  try {
    const u = new URL(s);
    return ["http:", "https:"].includes(u.protocol) ? u.toString() : "";
  } catch {
    return "";
  }
};
export async function importCsv(csv: string, includeJobs = false) {
  let rows: Record<string, string>[];
  try {
    rows = parse(csv, {
      columns: true,
      bom: true,
      skip_empty_lines: true,
      trim: true,
      max_record_size: 100000,
    });
  } catch {
    throw new AppError("Could not read this CSV. Include a header row and valid quoted cells.");
  }
  if (rows.length > 1000) throw new AppError("Import up to 1,000 rows at a time.");
  const companies = await all<Company>("company"),
    jobs = await all<Job>("job");
  let companyCount = 0,
    jobCount = 0;
  await transaction(async () => {
    for (const original of rows) {
      const r = Object.fromEntries(
        Object.entries(original).map(([k, v]) => [k.toLowerCase().trim(), v]),
      );
      const name = (r["company name"] || r.company || r.name || "").trim();
      if (!name) continue;
      const website = cleanUrl(
        r["official company website"] || r["official website"] || r.website || "",
      );
      const careersUrl = cleanUrl(r["careers page"] || r["careers url"] || r.careersurl || "");
      let company = companies.find((c) => c.name.toLowerCase() === name.toLowerCase());
      if (!company) {
        company = {
          id: id(),
          name,
          website,
          careersUrl,
          ...inferBoard(careersUrl),
          email: r["recruitment email"] || r.email || "",
          contactSource: r["contact source"] || "Imported CSV — verify before sending",
          contactConfirmed: false,
          priority: "normal",
          paused: false,
          lastChecked: null,
          checkStatus: "never",
          checkNote: "",
          createdAt: now(),
        };
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(company.email)) company.email = "";
        await put("company", company);
        companies.push(company);
        companyCount++;
      }
      if (!includeJobs) continue;
      const title = r["job title"] || r.title;
      const url = cleanUrl(r["original job description url"] || r.url || "");
      if (!title || !url || jobs.some((j) => j.url === url)) continue;
      const u = new URL(url);
      const parts = u.pathname.split("/").filter(Boolean);
      const sourceId = u.searchParams.get("gh_jid") || parts.at(-1) || url;
      const description = [
        `Imported research. Recheck the original vacancy before applying.`,
        r["required experience"] && `Experience: ${r["required experience"]}`,
        r["relevant technical stack"] && `Stack: ${r["relevant technical stack"]}`,
        r["product name and business category"],
        r["remote eligibility for indian residents"],
        r.caveats,
      ]
        .filter(Boolean)
        .join("\n\n");
      const job: Job = {
        id: id(),
        companyId: company.id,
        sourceId,
        title,
        location: r["remote eligibility for indian residents"] || "Not stated",
        remote: /remote/i.test(r["remote eligibility for indian residents"] || ""),
        description,
        url,
        applyUrl: cleanUrl(r["direct application url"] || url),
        salary: r["published compensation and currency"] || "",
        source: company.source,
        status: "new",
        applicationStatus: "not_submitted",
        match: null,
        publishedAt: null,
        checkedAt: r["checked on"] ? `${r["checked on"]}T00:00:00.000Z` : null,
        createdAt: now(),
        updatedAt: now(),
      };
      await put("job", job);
      jobs.push(job);
      jobCount++;
    }
  });
  if (
    !rows.some((r) =>
      Object.keys(r).some((k) =>
        ["company name", "company", "name"].includes(k.toLowerCase().trim()),
      ),
    )
  )
    throw new AppError("Add a Company, Company name, or Name column to your CSV.");
  await activity(
    "Company list imported",
    `${companyCount} companies and ${jobCount} research listings added.`,
    "success",
  );
  return { companies: companyCount, jobs: jobCount };
}
