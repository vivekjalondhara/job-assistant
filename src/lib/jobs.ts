import { all, get, put, id, now, profile, activity, transaction } from "./db";
import { AppError } from "./security";
import { matchJob } from "./matching";
import type { Company, Job, Source, JobRequirements } from "./types";
import { extractRequirements, salaryFacts } from "./job-preferences";
export function inferBoard(value: string): {
  source: Source;
  board: string;
} {
  try {
    const u = new URL(value);
    const bits = u.pathname.split("/").filter(Boolean);
    const board = bits[0] || "";
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(board)) return { source: "manual", board: "" };
    if (u.hostname === "jobs.ashbyhq.com") return { source: "ashby", board };
    if (["boards.greenhouse.io", "job-boards.greenhouse.io"].includes(u.hostname))
      return { source: "greenhouse", board };
    if (u.hostname === "jobs.lever.co") return { source: "lever", board };
  } catch {}
  return { source: "manual", board: "" };
}
export function stripHtml(value: string) {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n/g, "\n\n")
    .trim();
}
export async function fetchJson(url: string) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(25000),
    redirect: "error",
    headers: { Accept: "application/json" },
  });
  if (!response.ok)
    throw new AppError(
      `Job source returned HTTP ${response.status}. Existing jobs were preserved.`,
      502,
    );
  if (Number(response.headers.get("content-length") || 0) > 8000000)
    throw new AppError("The job feed is too large.", 502);
  const reader = response.body?.getReader();
  if (!reader) throw new AppError("The job feed was empty.", 502);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > 8000000) {
      await reader.cancel();
      throw new AppError("The job feed is too large.", 502);
    }
    chunks.push(part.value);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}
type Listing = {
  sourceId: string;
  title: string;
  description: string;
  location: string;
  remote: boolean;
  url: string;
  applyUrl: string;
  publishedAt: string | null;
  salary: string;
  workplace?: string;
  employmentType?: string;
  compensation?: Partial<JobRequirements>;
};
export async function scanCompany(
  companyId: string,
  verifyBeforeSend = false,
  deadline = Date.now() + 90000,
) {
  const company = await get<Company>("company", companyId);
  if (!company || (company.paused && !verifyBeforeSend)) return;
  if (company.source === "manual") {
    await put("company", {
      ...company,
      checkStatus: "manual",
      checkNote: "Add jobs manually or provide an Ashby, Greenhouse, or Lever careers URL.",
      lastChecked: now(),
    });
    return;
  }
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(company.board))
    throw new AppError("Invalid job-board identifier.");
  let listings: Listing[] = [];
  try {
    if (company.source === "ashby") {
      const data = await fetchJson(
        `https://api.ashbyhq.com/posting-api/job-board/${company.board}?includeCompensation=true`,
      );
      if (!Array.isArray(data.jobs))
        throw new AppError("The job feed format changed. Existing jobs were preserved.", 502);
      listings = data.jobs
        .filter((j: { isListed?: boolean }) => j.isListed !== false)
        .map((j: Record<string, any>) => ({
          sourceId: typeof j.jobUrl === "string" ? j.jobUrl.split("/").filter(Boolean).pop()! : "",
          title: j.title,
          description: j.descriptionPlain || stripHtml(j.descriptionHtml || ""),
          location: j.location || "Not stated",
          remote: j.isRemote === true,
          url: j.jobUrl,
          applyUrl: j.applyUrl || j.jobUrl,
          publishedAt: j.publishedAt || null,
          salary: j.compensation?.compensationTierSummary || "",
          compensation: (() => {
            const salaries = j.compensation?.summaryComponents?.filter(
              (c: Record<string, unknown>) => c.compensationType === "Salary",
            );
            const s = salaries?.length === 1 ? salaries[0] : {};
            return salaryFacts(s.minValue, s.maxValue, s.currencyCode, s.interval);
          })(),
          workplace: typeof j.workplaceType === "string" ? j.workplaceType.toLowerCase() : "",
          employmentType:
            (
              {
                FullTime: "full-time",
                PartTime: "part-time",
                Intern: "internship",
                Contract: "contract",
                Temporary: "temporary",
              } as Record<string, string>
            )[j.employmentType] || "",
        }));
    } else if (company.source === "greenhouse") {
      const data = await fetchJson(
        `https://boards-api.greenhouse.io/v1/boards/${company.board}/jobs?content=true`,
      );
      if (!Array.isArray(data.jobs))
        throw new AppError("The job feed format changed. Existing jobs were preserved.", 502);
      listings = data.jobs.map((j: Record<string, any>) => ({
        sourceId: typeof j.id === "number" || typeof j.id === "string" ? String(j.id) : "",
        title: j.title,
        description: stripHtml(j.content || ""),
        location: j.location?.name || "Not stated",
        remote: /remote/i.test(j.location?.name || ""),
        url: j.absolute_url,
        applyUrl: j.absolute_url,
        publishedAt: null,
        salary: "",
      }));
    } else {
      let complete = false;
      for (let skip = 0; skip < 2000; skip += 100) {
        if (Date.now() > deadline - 25000)
          throw new AppError(
            "The feed took too long to complete. Existing jobs were preserved. Try again.",
            504,
          );
        const batch = await fetchJson(
          `https://api.lever.co/v0/postings/${company.board}?mode=json&limit=100&skip=${skip}`,
        );
        if (!Array.isArray(batch)) throw new AppError("The job feed format changed.", 502);
        listings.push(
          ...batch.map((j: Record<string, any>) => ({
            sourceId: typeof j.id === "number" || typeof j.id === "string" ? String(j.id) : "",
            title: j.text,
            description: [
              j.descriptionPlain || stripHtml(j.description || ""),
              ...(j.lists || []).map(
                (l: Record<string, string>) => `${l.text}\n${stripHtml(l.content)}`,
              ),
              j.additionalPlain || "",
            ].join("\n\n"),
            location: j.categories?.location || "Not stated",
            remote: j.workplaceType === "remote",
            workplace: j.workplaceType === "on-site" ? "onsite" : j.workplaceType || "",
            employmentType:
              typeof j.categories?.commitment === "string"
                ? (
                    {
                      "full-time": "full-time",
                      "part-time": "part-time",
                      contract: "contract",
                      internship: "internship",
                    } as Record<string, string>
                  )[j.categories.commitment.toLowerCase()] || ""
                : "",
            url: j.hostedUrl,
            applyUrl: j.applyUrl || j.hostedUrl,
            publishedAt: null,
            salary: j.salaryRange
              ? `${j.salaryRange.min}–${j.salaryRange.max} ${j.salaryRange.currency} ${j.salaryRange.interval}`
              : "",
            compensation: salaryFacts(
              j.salaryRange?.min,
              j.salaryRange?.max,
              j.salaryRange?.currency,
              j.salaryRange?.interval,
            ),
          })),
        );
        if (batch.length < 100) {
          complete = true;
          break;
        }
      }
      if (!complete)
        throw new AppError("The feed exceeds the scan limit. Existing jobs were preserved.", 502);
    }
    if (
      new Set(listings.map((j) => j.sourceId)).size !== listings.length ||
      listings.some(
        (j) =>
          !j.sourceId ||
          typeof j.title !== "string" ||
          !j.title.trim() ||
          typeof j.url !== "string" ||
          !/^https:\/\//i.test(j.url),
      )
    )
      throw new AppError(
        "The job feed contains incomplete records. Existing jobs were preserved.",
        502,
      );
    const existing = (await all<Job>("job")).filter((j) => j.companyId === company.id);
    const seen = new Set<string>();
    let added = 0;
    const p = await profile();
    const timestamp = now();
    await transaction(async () => {
      const currentCompany = await get<Company>("company", company.id);
      if (
        !currentCompany ||
        currentCompany.source !== company.source ||
        currentCompany.board !== company.board
      )
        throw new AppError("The careers source changed during this check. Run it again.", 409);
      for (const listing of listings) {
        seen.add(listing.sourceId);
        const prev = existing.find((j) => j.sourceId === listing.sourceId || j.url === listing.url);
        const requirements = {
          ...extractRequirements(listing),
          ...listing.compensation,
          ...(listing.workplace ? { workplace: listing.workplace } : {}),
          ...(listing.employmentType ? { employmentType: listing.employmentType } : {}),
        };
        const changed =
          !prev ||
          JSON.stringify(prev.requirements) !== JSON.stringify(requirements) ||
          (
            ["title", "description", "location", "remote", "url", "applyUrl", "salary"] as const
          ).some((key) => prev[key] !== listing[key]);
        const job: Job = {
          ...prev,
          id: prev?.id || id(),
          companyId: company.id,
          ...listing,
          requirements,
          source: company.source,
          status: prev?.status === "closed" ? "new" : prev?.status || "new",
          applicationStatus: prev?.applicationStatus || "not_submitted",
          match: prev?.match || null,
          createdAt: prev?.createdAt || timestamp,
          updatedAt: changed ? timestamp : prev!.updatedAt,
          checkedAt: timestamp,
        };
        job.match =
          !changed && prev?.match?.profileUpdatedAt === p.updatedAt ? prev.match : matchJob(job, p);
        await put("job", job);
        if (!prev) added++;
      }
      for (const old of existing) {
        if (old.source === company.source && !seen.has(old.sourceId))
          await put("job", {
            ...old,
            status: "closed",
            checkedAt: timestamp,
            updatedAt: timestamp,
          });
      }
      const latest = (await get<Company>("company", company.id))!;
      await put("company", {
        ...latest,
        lastChecked: timestamp,
        checkStatus: "success",
        checkNote: `${listings.length} open roles checked. ${added} new.`,
      });
    });
    await activity(
      `Checked ${company.name}`,
      `${listings.length} open roles · ${added} new`,
      "success",
    );
  } catch (error) {
    const message =
      error instanceof AppError
        ? error.message
        : "Could not reach the job source. Existing jobs were preserved.";
    const latest = (await get<Company>("company", company.id))!;
    await put("company", { ...latest, checkStatus: "failed", checkNote: message });
    throw new AppError(message, 502);
  }
}
