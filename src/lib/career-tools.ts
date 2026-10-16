import type { AppState, Job, SavedSearch } from "./types";
import { requirementsFor } from "./job-preferences";

export function canonicalJobUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()])
      if (/^(utm_|source$|ref$|referrer$|tracking)/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}
export function filterJobs(
  jobs: Job[],
  search: Pick<SavedSearch, "query" | "location" | "workplace" | "employmentType" | "maxAgeDays">,
  companies: AppState["companies"],
  now = Date.now(),
) {
  return jobs.filter((job) => {
    const r = requirementsFor(job);
    const haystack =
      `${job.title} ${companies.find((c) => c.id === job.companyId)?.name || ""} ${job.description}`.toLowerCase();
    return (
      search.query
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
        .every((word) => haystack.includes(word)) &&
      (!search.location || job.location.toLowerCase().includes(search.location.toLowerCase())) &&
      (!search.workplace || r.workplace === search.workplace) &&
      (!search.employmentType || r.employmentType === search.employmentType) &&
      (!search.maxAgeDays ||
        now - Date.parse(job.publishedAt || job.createdAt) <= search.maxAgeDays * 86400000)
    );
  });
}
export function dailyJobs(data: AppState) {
  const contacted = new Set(
    data.drafts
      .filter((d) => ["sent", "sending", "uncertain"].includes(d.status))
      .map((d) => d.jobId),
  );
  const rank = { good: 4, review: 3, stretch: 2, poor: 1 };
  return data.jobs
    .filter(
      (j) =>
        !["closed", "skipped"].includes(j.status) &&
        j.applicationStatus === "not_submitted" &&
        !contacted.has(j.id),
    )
    .sort(
      (a, b) =>
        rank[b.match?.recommendation || "review"] - rank[a.match?.recommendation || "review"] ||
        (b.match?.score || 0) - (a.match?.score || 0) ||
        (b.publishedAt || b.createdAt).localeCompare(a.publishedAt || a.createdAt),
    )
    .slice(0, 5);
}
export function followUpDue(data: AppState, job: Job, now = Date.now()) {
  if (["rejected", "withdrawn", "offer"].includes(job.applicationStatus) || job.status === "closed")
    return undefined;
  return data.drafts.find(
    (d) =>
      d.jobId === job.id &&
      !d.followUpOf &&
      d.kind !== "direct" &&
      d.status === "sent" &&
      d.replyStatus === "none" &&
      d.sentAt &&
      now - Date.parse(d.sentAt) >= data.settings.followUpDays * 86400000 &&
      !data.drafts.some((f) => f.followUpOf === d.id) &&
      data.connections.gmail &&
      d.gmailAccountEmail === data.connections.gmailEmail.toLowerCase(),
  );
}
export function discoveryUrl(query: string, location: string) {
  const q = `${query || "jobs"} ${location} (site:jobs.ashbyhq.com OR site:jobs.lever.co OR site:job-boards.greenhouse.io OR site:boards.greenhouse.io)`;
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}
