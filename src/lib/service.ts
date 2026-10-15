import { z } from "zod";
import {
  all,
  get,
  put,
  id,
  now,
  profile,
  settings,
  activity,
  enqueue,
  tasks,
  transaction,
} from "./db";
import { AppError } from "./security";
import {
  companySchema,
  draftEditSchema,
  jobSchema,
  profileSchema,
  settingsSchema,
} from "./validation";
import { analyzeJob, exclusive, extractProfile, writeEmail } from "./ai";
import {
  approveDraft,
  connection,
  disconnectGmail,
  googleConfigured,
  saveGmailDraft,
  sendDraft,
} from "./gmail";
import { inferBoard } from "./jobs";
import { importExistingResearch } from "./imports";
import { matchJob } from "./matching";
import type { AppState, Company, Draft, Job, Usage } from "./types";

export function state(): AppState {
  const conn = connection();
  return {
    profile: profile(),
    companies: all("company"),
    jobs: all<Job>("job").slice(0, 2000),
    drafts: all("draft"),
    settings: settings(),
    activity: all<AppState["activity"][number]>("activity").slice(0, 40),
    usage: all<Usage>("usage"),
    tasks: tasks(),
    connections: {
      openrouter: !!(process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_MODEL),
      model: process.env.OPENROUTER_MODEL || "",
      googleConfigured: googleConfigured(),
      gmail: !!conn && !conn.needsReconnect,
      gmailEmail: conn?.email || "",
      gmailNeedsReconnect: conn?.needsReconnect || false,
      workerLastSeen: get<{ at: string }>("worker", "main")?.at || null,
    },
  };
}
function requireJob(jobId: string) {
  const value = get<Job>("job", jobId);
  if (!value) throw new AppError("Job not found.", 404);
  return value;
}
function requireDraft(draftId: string) {
  const value = get<Draft>("draft", draftId);
  if (!value) throw new AppError("Draft not found.", 404);
  return value;
}
function editable(draft: Draft) {
  if (["sending", "sent", "uncertain"].includes(draft.status))
    throw new AppError(
      "This email is sent or awaiting send verification and cannot be edited.",
      409,
    );
}
function newDraft(job: Job, company: Company): Draft {
  const p = profile();
  return {
    id: id(),
    jobId: job.id,
    companyId: company.id,
    to: company.email,
    subject: `Application for ${job.title}${p.name ? ` — ${p.name}` : ""}`,
    body: "",
    resumeId: p.resumeId,
    resumeName: p.resumeName,
    evidence: [],
    reviewNotes: [],
    model: "Manual",
    status: "draft",
    version: 1,
    approvedHash: null,
    approvedAt: null,
    gmailDraftId: null,
    gmailRawHash: null,
    sentMessageId: null,
    threadId: null,
    sentAt: null,
    replyStatus: "none",
    lastReplyAt: null,
    followUpOf: null,
    profileUpdatedAt: p.updatedAt,
    jobUpdatedAt: job.updatedAt,
    createdAt: now(),
    updatedAt: now(),
  };
}
export async function action(actionName: string, input: unknown) {
  const p = z.record(z.string(), z.unknown()).parse(input || {});
  const itemId = () => z.string().uuid().parse(p.id);
  switch (actionName) {
    case "profile.save": {
      const parsed = profileSchema.parse(p);
      if (parsed.confirmed && (!parsed.name || !parsed.experience || !parsed.skills.length))
        throw new AppError("Add your name, experience, and skills before confirming your profile.");
      const next = { ...profile(), ...parsed, updatedAt: now() };
      transaction(() => {
        put("profile", next);
        for (const job of all<Job>("job")) put("job", { ...job, match: matchJob(job, next) });
      });
      return {
        message: parsed.confirmed
          ? "Profile confirmed. Job matches refreshed."
          : "Profile saved for review.",
      };
    }
    case "profile.extract":
      return exclusive("profile-extract", async () => {
        await extractProfile();
        return { message: "Résumé information extracted. Review and confirm your profile." };
      });
    case "company.save": {
      const parsed = companySchema.parse(p);
      const old = typeof p.id === "string" ? get<Company>("company", p.id) : null;
      const board = inferBoard(parsed.careersUrl);
      const sourceChanged = !!old && (old.source !== board.source || old.board !== board.board);
      const company: Company = {
        id: old?.id || id(),
        ...parsed,
        ...board,
        paused: parsed.paused ?? old?.paused ?? false,
        lastChecked: sourceChanged ? null : old?.lastChecked || null,
        checkStatus: sourceChanged ? "never" : old?.checkStatus || "never",
        checkNote: sourceChanged ? "" : old?.checkNote || "",
        createdAt: old?.createdAt || now(),
      };
      put("company", company);
      return { message: "Company saved." };
    }
    case "company.contacts": {
      const companyId = itemId();
      const contacts: { email: string; source: string; context: string }[] = [];
      for (const job of all<Job>("job").filter(
        (j) => j.companyId === companyId && j.status !== "closed",
      )) {
        for (const found of job.description.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
          const email = found[0].toLowerCase();
          if (/noreply|no-reply/.test(email) || contacts.some((c) => c.email === email)) continue;
          contacts.push({
            email,
            source: job.url,
            context: job.description.slice(
              Math.max(0, (found.index || 0) - 100),
              (found.index || 0) + email.length + 100,
            ),
          });
        }
      }
      return {
        contacts,
        message: contacts.length
          ? `Found ${contacts.length} published addresses in saved job descriptions. Check their purpose before using them.`
          : "No email address was found in the saved job descriptions. Use the application page or add a published recruitment address manually.",
      };
    }
    case "company.scan": {
      if (settings().automationPaused)
        throw new AppError("Automation is paused. Resume it in Settings.");
      const list = p.id
        ? ([get<Company>("company", itemId())].filter(Boolean) as Company[])
        : all<Company>("company");
      let count = 0;
      for (const c of list.filter((c) => !c.paused)) {
        enqueue("scan", c.id);
        put("company", {
          ...c,
          checkStatus: "queued",
          checkNote: "Waiting for the background worker.",
        });
        count++;
      }
      return { message: `Queued ${count} company checks.` };
    }
    case "research.import": {
      const result = importExistingResearch();
      return {
        message: `Imported ${result.companies} companies and ${result.jobs} research listings. Recheck the sources before applying.`,
      };
    }
    case "job.create": {
      const parsed = jobSchema.parse(p);
      if (!get<Company>("company", parsed.companyId))
        throw new AppError("Choose an existing company.");
      const job: Job = {
        id: id(),
        ...parsed,
        sourceId: id(),
        source: "manual",
        status: "new",
        applicationStatus: "not_submitted",
        match: null,
        checkedAt: null,
        publishedAt: null,
        createdAt: now(),
        updatedAt: now(),
      };
      job.match = matchJob(job, profile());
      put("job", job);
      return { message: "Job added." };
    }
    case "job.status": {
      const job = requireJob(itemId());
      const status = z.enum(["new", "shortlisted", "skipped", "closed"]).parse(p.status);
      put("job", { ...job, status });
      return {
        message: status === "shortlisted" ? "Added to your shortlist." : "Job status updated.",
      };
    }
    case "job.application": {
      const job = requireJob(itemId());
      const applicationStatus = z
        .enum(["not_submitted", "submitted", "interview", "offer", "rejected", "withdrawn"])
        .parse(p.status);
      put("job", { ...job, applicationStatus });
      activity("Application updated", `${job.title} · ${applicationStatus.replaceAll("_", " ")}`);
      return { message: "Application status updated." };
    }
    case "job.match": {
      const job = requireJob(itemId());
      return exclusive(`match:${job.id}`, async () => {
        const match = await analyzeJob(job);
        const latest = requireJob(job.id);
        if (latest.updatedAt !== job.updatedAt)
          throw new AppError("The job changed during analysis. Please try again.", 409);
        put("job", { ...latest, match });
        return { message: "AI match analysis is ready." };
      });
    }
    case "draft.create": {
      const job = requireJob(itemId());
      const company = get<Company>("company", job.companyId)!;
      const previous = all<Draft>("draft").find((d) => d.jobId === job.id && !d.followUpOf);
      if (previous)
        return { message: "Opened your existing application email.", draftId: previous.id };
      const draft = newDraft(job, company);
      put("draft", draft);
      return { message: "Email composer opened.", draftId: draft.id };
    }
    case "draft.generate": {
      const draft = requireDraft(itemId());
      editable(draft);
      return exclusive(`draft:${draft.id}`, async () => {
        const job = requireJob(draft.jobId);
        const company = get<Company>("company", draft.companyId)!;
        const before = profile().updatedAt;
        const style = z.string().max(200).optional().parse(p.style);
        const result = await writeEmail(job, company, style, draft.body);
        const latest = requireDraft(draft.id);
        if (
          profile().updatedAt !== before ||
          latest.version !== draft.version ||
          requireJob(job.id).updatedAt !== job.updatedAt
        )
          throw new AppError(
            "The inputs changed while generating. Try again with the latest version.",
            409,
          );
        const user = profile();
        put("draft", {
          ...latest,
          subject: result.value.subject,
          body: result.value.body,
          evidence: result.value.evidence.map((e) => `${e.claim}\nSource: “${e.sourceQuote}”`),
          reviewNotes: result.value.reviewNotes,
          model: result.model,
          resumeId: user.resumeId,
          resumeName: user.resumeName,
          status: "draft",
          version: latest.version + 1,
          approvedHash: null,
          approvedAt: null,
          gmailRawHash: null,
          profileUpdatedAt: before,
          jobUpdatedAt: job.updatedAt,
          updatedAt: now(),
        });
        activity("Application email generated", `${job.title} · ready for your review`, "success");
        return {
          message: "Email generated. Check the claims and recipient before saving to Gmail.",
        };
      });
    }
    case "draft.save":
      return exclusive(`draft:${itemId()}`, async () => {
        const draft = requireDraft(itemId());
        editable(draft);
        const parsed = draftEditSchema.parse(p);
        if (parsed.version !== draft.version)
          throw new AppError("The draft changed in another tab. Reload before editing.", 409);
        const user = profile();
        put("draft", {
          ...draft,
          to: parsed.to,
          subject: parsed.subject,
          body: parsed.body,
          resumeId: parsed.attachResume ? user.resumeId : "",
          resumeName: parsed.attachResume ? user.resumeName : "",
          version: draft.version + 1,
          status: "draft",
          approvedHash: null,
          approvedAt: null,
          gmailRawHash: null,
          profileUpdatedAt: user.updatedAt,
          jobUpdatedAt: requireJob(draft.jobId).updatedAt,
          updatedAt: now(),
        });
        return { message: "Email saved. Any earlier approval has been cleared." };
      });
    case "draft.gmail":
      await saveGmailDraft(itemId());
      return { message: "Saved to Gmail Drafts." };
    case "draft.approve": {
      z.literal(true).parse(p.reviewed);
      await approveDraft(itemId(), z.number().int().parse(p.version));
      return { message: "This exact draft is approved. You can now send it." };
    }
    case "draft.send":
      await sendDraft(itemId());
      return { message: "Email sent through Gmail." };
    case "draft.followup": {
      const original = requireDraft(itemId());
      if (original.status !== "sent" || original.replyStatus !== "none" || !original.sentAt)
        throw new AppError(
          "Follow-ups are only available for sent messages with no reply or bounce.",
        );
      if (Date.now() - Date.parse(original.sentAt) < settings().followUpDays * 86400000)
        throw new AppError("The follow-up reminder is not due yet.");
      if (original.followUpOf)
        throw new AppError("Only one follow-up is supported per application.");
      const previous = all<Draft>("draft").find((d) => d.followUpOf === original.id);
      if (previous) return { message: "Opened your existing follow-up.", draftId: previous.id };
      const job = requireJob(original.jobId),
        company = get<Company>("company", job.companyId)!;
      const user = profile();
      const draft = {
        ...newDraft(job, company),
        to: original.to,
        subject: `Re: ${original.subject}`,
        body: `Hi Hiring Team,\n\nI wanted to follow up on my email about the ${job.title} role. I’m still interested and would be happy to share any additional information that would be useful.\n\nThanks for your time,\n${user.signature || user.name}`,
        resumeId: "",
        resumeName: "",
        followUpOf: original.id,
      };
      put("draft", draft);
      return { message: "Follow-up prepared for review.", draftId: draft.id };
    }
    case "settings.save":
      put("settings", { ...settings(), ...settingsSchema.parse(p) });
      return { message: "Settings saved." };
    case "gmail.disconnect":
      await disconnectGmail();
      return { message: "Gmail disconnected." };
    case "gmail.sync":
      enqueue("replies", "main");
      return { message: "Reply check queued." };
    default:
      throw new AppError("Unknown action.", 404);
  }
}
