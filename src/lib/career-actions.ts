import { z } from "zod";
import { all, get, id, now, profile, put, remove } from "./db";
import type {
  ApplicationDetails,
  Company,
  EmailTemplate,
  Job,
  ResumeVersion,
  SavedSearch,
} from "./types";
import { AppError } from "./security";
import { jobSchema } from "./validation";
import { matchJob } from "./matching";
import { canonicalJobUrl } from "./career-tools";
import { previewJobImport } from "./job-import";
import { inferBoard } from "./jobs";
import { employmentTypes, seniorities, workplaces } from "./job-preferences";

const text = (n: number) => z.string().trim().max(n);
const instant = z.union([z.literal(""), z.iso.datetime({ offset: true })]);
const requirementsSchema = z
  .object({
    experienceMin: z.number().min(0).max(60).nullable(),
    seniority: z.enum(["", ...seniorities]),
    eligibleCountries: z.array(text(80)).max(30),
    employmentType: z.enum(["", ...employmentTypes]),
    workplace: z.enum(["", ...workplaces]),
    salaryMin: z.number().min(0).max(1e9).nullable(),
    salaryMax: z.number().min(0).max(1e9).nullable(),
    salaryCurrency: z.union([z.literal(""), z.string().regex(/^[A-Z]{3}$/)]),
    salaryPeriod: z.enum(["", "year", "month", "hour"]),
    evidence: z.array(text(2000)).max(50),
  })
  .refine((r) => r.salaryMin === null || r.salaryMax === null || r.salaryMax >= r.salaryMin, {
    message: "Salary maximum must be at least the minimum.",
    path: ["salaryMax"],
  });
export const careerAtomicActions = [
  "template.save",
  "template.delete",
  "search.save",
  "search.delete",
  "resume.label",
  "resume.select",
  "application.save",
  "job.import",
];
export async function careerAction(name: string, input: Record<string, unknown>) {
  const itemId = () => z.string().uuid().parse(input.id);
  switch (name) {
    case "template.save": {
      const fields = z
        .object({
          name: text(100).min(1),
          subject: text(250)
            .min(1)
            .refine((v) => !/[\r\n]/.test(v)),
          body: text(16000).min(20),
          purpose: z.enum(["application", "inquiry", "referral", "followup"]),
        })
        .parse(input);
      const templateId = input.id ? itemId() : id();
      if (input.id && !(await get("template", templateId)))
        throw new AppError("Template not found.", 404);
      if (!input.id && (await all("template")).length >= 100)
        throw new AppError("You can save up to 100 templates.");
      await put<EmailTemplate>("template", { id: templateId, ...fields, updatedAt: now() });
      return { message: "Template saved. Choose it in any email composer." };
    }
    case "template.delete":
      await remove("template", itemId());
      return { message: "Template deleted. Existing emails are unchanged." };
    case "search.save": {
      const fields = z
        .object({
          name: text(100).min(1),
          query: text(200),
          location: text(150),
          workplace: z.enum(["", ...workplaces]),
          employmentType: z.enum(["", ...employmentTypes]),
          maxAgeDays: z.number().int().min(0).max(365),
        })
        .parse(input);
      const searchId = input.id ? itemId() : id();
      if (!input.id && (await all("search")).length >= 50)
        throw new AppError("You can save up to 50 searches.");
      await put<SavedSearch>("search", { id: searchId, ...fields, updatedAt: now() });
      return { message: "Search saved." };
    }
    case "search.delete":
      await remove("search", itemId());
      return { message: "Saved search removed." };
    case "resume.label": {
      const file = await get<ResumeVersion>("file", itemId());
      if (!file) throw new AppError("Résumé not found.", 404);
      await put("file", {
        ...file,
        label: text(100).parse(input.label),
        targetRole: text(120).parse(input.targetRole),
      });
      return { message: "Résumé details saved." };
    }
    case "resume.select": {
      const file = await get<ResumeVersion & { text?: string }>("file", itemId());
      if (!file) throw new AppError("Résumé not found.", 404);
      const user = await profile();
      if (!file.text && file.id !== user.resumeId)
        throw new AppError(
          "Re-upload this older résumé to make it your profile source. It can still be attached to emails.",
        );
      await put("profile", {
        ...user,
        resumeId: file.id,
        resumeName: file.name,
        resumeText: file.text || user.resumeText,
        confirmed: false,
        updatedAt: now(),
      });
      return {
        message:
          "Default résumé changed. Review and confirm your profile; existing email attachments are preserved.",
      };
    }
    case "application.save": {
      const job = await get<Job>("job", itemId());
      if (!job) throw new AppError("Job not found.", 404);
      const fields = z
        .object({
          submittedAt: instant,
          recruiterName: text(160),
          recruiterEmail: z.union([z.literal(""), z.email()]),
          notes: text(10000),
          interviewAt: instant,
          nextAction: text(500),
          reminderAt: instant,
          resumeId: text(100),
        })
        .parse(input);
      const selected = fields.resumeId ? await get<ResumeVersion>("file", fields.resumeId) : null;
      if (fields.resumeId && !selected && fields.resumeId !== job.application?.resumeId)
        throw new AppError("Choose a saved résumé.");
      const status = z
        .enum(["not_submitted", "submitted", "interview", "offer", "rejected", "withdrawn"])
        .parse(input.status ?? job.applicationStatus);
      const application: ApplicationDetails = {
        ...fields,
        resumeName: selected?.name || (fields.resumeId ? job.application?.resumeName : ""),
        resumeVersion:
          selected?.version || (fields.resumeId ? job.application?.resumeVersion : undefined),
        submittedAt:
          fields.submittedAt ||
          (status === "submitted" ? job.application?.submittedAt || now() : ""),
        history:
          status === job.applicationStatus
            ? job.application?.history || []
            : [...(job.application?.history || []), { status, at: now() }],
      };
      await put("job", {
        ...job,
        applicationStatus: status,
        application,
        match: fields.resumeId !== job.application?.resumeId ? null : job.match,
      });
      return { message: "Application details saved." };
    }
    case "job.preview":
      return {
        preview: await previewJobImport(input),
        message: "Review the extracted details before adding this job.",
      };
    case "job.import": {
      const parsed = jobSchema
        .omit({ companyId: true })
        .extend({ companyName: text(200).min(1), requirements: requirementsSchema })
        .parse(input);
      const jobs = await all<Job>("job");
      const urls = [parsed.url, parsed.applyUrl].map(canonicalJobUrl).filter(Boolean);
      const duplicate = jobs.find((j) =>
        [j.url, j.applyUrl].some((url) => urls.includes(canonicalJobUrl(url))),
      );
      if (duplicate)
        return {
          message: "This job is already saved. Opened the existing listing.",
          jobId: duplicate.id,
        };
      const companies = await all<Company>("company");
      let company = companies.find(
        (c) => c.name.trim().toLowerCase() === parsed.companyName.toLowerCase(),
      );
      if (company) {
        const sameRole = jobs.find(
          (j) =>
            j.companyId === company!.id &&
            j.title.toLowerCase() === parsed.title.toLowerCase() &&
            j.location.toLowerCase() === parsed.location.toLowerCase() &&
            j.description.trim() === parsed.description.trim(),
        );
        if (sameRole) return { message: "This description is already saved.", jobId: sameRole.id };
      }
      if (!company) {
        const board = inferBoard(parsed.url);
        const careersUrl =
          board.source === "manual" ? "" : `${new URL(parsed.url).origin}/${board.board}`;
        company = {
          id: id(),
          name: parsed.companyName,
          website: "",
          careersUrl,
          ...board,
          email: "",
          contactSource: "",
          contactConfirmed: false,
          priority: "normal",
          paused: false,
          lastChecked: null,
          checkStatus: "never",
          checkNote: "",
          createdAt: now(),
        };
        await put("company", company);
      }
      const { companyName: _, ...details } = parsed;
      const job: Job = {
        ...details,
        id: id(),
        companyId: company.id,
        sourceId: id(),
        source: "manual",
        status: "new",
        applicationStatus: "not_submitted",
        match: null,
        publishedAt: null,
        checkedAt: null,
        createdAt: now(),
        updatedAt: now(),
      };
      job.match = matchJob(job, await profile());
      await put("job", job);
      return { message: "Job saved and matched to your profile.", jobId: job.id };
    }
    default:
      return null;
  }
}
