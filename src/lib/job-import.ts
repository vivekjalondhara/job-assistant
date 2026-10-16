import { z } from "zod";
import { fetchJson, inferBoard, stripHtml } from "./jobs";
import { extractRequirements, salaryFacts } from "./job-preferences";
import type { JobImportPreview, JobRequirements } from "./types";
import { AppError } from "./security";

export async function previewJobImport(input: unknown): Promise<JobImportPreview> {
  const parsed = z
    .object({ url: z.union([z.literal(""), z.url()]), description: z.string().max(50000) })
    .parse(input);
  let description = parsed.description.trim(),
    title = description.split("\n")[0]?.trim().slice(0, 250) || "";
  let companyName = "",
    location = "",
    remote = false,
    salary = "",
    applyUrl = parsed.url;
  let facts: Partial<JobRequirements> = {};
  if (parsed.url && !/^https?:\/\//i.test(parsed.url))
    throw new AppError("Use an HTTP or HTTPS job link.");
  if (!description) {
    const u = new URL(parsed.url || "https://invalid.example");
    const { source, board } = inferBoard(u.toString());
    const bits = u.pathname.split("/").filter(Boolean);
    const posting = source === "greenhouse" ? bits[bits.indexOf("jobs") + 1] : bits[1];
    if (
      u.protocol !== "https:" ||
      u.port ||
      u.username ||
      u.password ||
      source === "manual" ||
      (source === "greenhouse" && !bits.includes("jobs")) ||
      !posting ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(posting)
    )
      throw new AppError(
        "Paste the job description below. Link extraction supports individual Ashby, Greenhouse, and Lever job pages.",
      );
    companyName = board.replace(/[-_]/g, " ");
    if (source === "ashby") {
      const feed = await fetchJson(
        `https://api.ashbyhq.com/posting-api/job-board/${board}?includeCompensation=true`,
      );
      const job = Array.isArray(feed.jobs)
        ? feed.jobs.find(
            (j: Record<string, any>) =>
              typeof j.jobUrl === "string" &&
              j.jobUrl.split("/").filter(Boolean).at(-1) === posting &&
              j.isListed !== false,
          )
        : undefined;
      if (!job)
        throw new AppError(
          "This job was not found in the current feed. Paste the description to review it manually.",
        );
      title = job.title;
      description = job.descriptionPlain || stripHtml(job.descriptionHtml || "");
      location = job.location || "";
      remote = job.isRemote === true;
      salary = job.compensation?.compensationTierSummary || "";
      applyUrl = job.applyUrl || parsed.url;
      const salaries = job.compensation?.summaryComponents?.filter(
        (c: Record<string, unknown>) => c.compensationType === "Salary",
      );
      const s = salaries?.length === 1 ? salaries[0] : {};
      facts = {
        ...salaryFacts(s.minValue, s.maxValue, s.currencyCode, s.interval),
        ...(job.workplaceType ? { workplace: String(job.workplaceType).toLowerCase() } : {}),
        employmentType:
          (
            {
              FullTime: "full-time",
              PartTime: "part-time",
              Intern: "internship",
              Contract: "contract",
              Temporary: "temporary",
            } as Record<string, string>
          )[job.employmentType] || "",
      };
    } else if (source === "greenhouse") {
      const job = await fetchJson(
        `https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${posting}?questions=false`,
      );
      title = job.title;
      description = stripHtml(job.content || "");
      location = job.location?.name || "";
      remote = /remote/i.test(location);
      applyUrl = job.absolute_url || parsed.url;
    } else {
      const job = await fetchJson(`https://api.lever.co/v0/postings/${board}/${posting}?mode=json`);
      title = job.text;
      description = [
        job.descriptionPlain || stripHtml(job.description || ""),
        ...(job.lists || []).map(
          (l: Record<string, string>) => `${l.text}\n${stripHtml(l.content || "")}`,
        ),
        job.additionalPlain || "",
      ].join("\n\n");
      location = job.categories?.location || "";
      remote = job.workplaceType === "remote";
      applyUrl = job.applyUrl || parsed.url;
      facts = salaryFacts(
        job.salaryRange?.min,
        job.salaryRange?.max,
        job.salaryRange?.currency,
        job.salaryRange?.interval,
      );
    }
  } else {
    location = description.match(/(?:^|\n)Location\s*:\s*([^\n]+)/i)?.[1]?.trim() || "";
    companyName = description.match(/(?:^|\n)Company\s*:\s*([^\n]+)/i)?.[1]?.trim() || "";
    title = title.replace(/^(?:job title|title|role)\s*:\s*/i, "");
    remote = /\bremote\b/i.test(location);
  }
  if (
    typeof title !== "string" ||
    typeof description !== "string" ||
    description.length < 30 ||
    description.length > 50000
  )
    throw new AppError(
      "Could not extract a complete listing. Paste its title and full description instead.",
    );
  if (!/^https?:\/\//i.test(applyUrl)) applyUrl = parsed.url;
  return {
    companyName,
    title,
    description,
    location,
    remote,
    salary,
    url: parsed.url,
    applyUrl,
    requirements: { ...extractRequirements({ title, description, location, remote }), ...facts },
  };
}
