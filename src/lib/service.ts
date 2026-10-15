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
  query,
  recent,
} from "./db";
import { AppError } from "./security";
import {
  companySchema,
  draftEditSchema,
  jobSchema,
  jobTitleSchema,
  profileSchema,
  settingsSchema,
} from "./validation";
import { analyzeJob, exclusive, extractProfile, polishEmail, writeEmail } from "./ai";
import {
  approveDraft,
  connection,
  disconnectGmail,
  googleConfigured,
  saveGmailDraft,
  sendDraft,
  sendDirectEmail,
} from "./gmail";
import { inferBoard } from "./jobs";
import { matchJob } from "./matching";
import { localEmail } from "./local-email";
import type { AppState, Company, Draft, Job, Usage } from "./types";
export async function state(): Promise<AppState> {
  const conn = await connection();
  const user = await profile();
  const jobs = await recent<Job>("job", 2000);
  const drafts = await all<Draft>("draft");
  const companyIds = [...new Set([...jobs, ...drafts].map((item) => item.companyId))];
  const companies = await query<{ data: Company }>(
    `SELECT data FROM folio_records WHERE kind='company' AND
     (id=ANY($1::text[]) OR id IN (SELECT id FROM folio_records WHERE kind='company' ORDER BY sequence DESC LIMIT 100))
     ORDER BY sequence DESC`,
    [companyIds],
  );
  const companyCount = await query<{ count: number }>(
    "SELECT count(*)::int AS count FROM folio_records WHERE kind='company'",
  );
  return {
    profile: user,
    companies: companies.rows.map((row) => row.data),
    companyCount: companyCount.rows[0].count,
    jobs: jobs.map((job) => ({
      ...job,
      match:
        job.match?.method === "ai" && job.match.profileUpdatedAt === user.updatedAt
          ? job.match
          : matchJob(job, user),
    })),
    drafts,
    settings: await settings(),
    activity: await recent<AppState["activity"][number]>("activity", 40),
    usage: await all<Usage>("usage"),
    tasks: await tasks(),
    connections: {
      openrouter: !!(process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_MODEL),
      model: process.env.OPENROUTER_MODEL || "",
      googleConfigured: googleConfigured(),
      gmail: !!conn && !conn.needsReconnect,
      gmailEmail: conn?.email || "",
      gmailNeedsReconnect: conn?.needsReconnect || false,
      workerLastSeen:
        (
          await get<{
            at: string;
          }>("worker", "main")
        )?.at || null,
    },
  };
}
async function requireJob(jobId: string) {
  const value = await get<Job>("job", jobId);
  if (!value) throw new AppError("Job not found.", 404);
  return value;
}
async function requireDraft(draftId: string) {
  const value = await get<Draft>("draft", draftId);
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
async function newDraft(job?: Job, company?: Company): Promise<Draft> {
  if (job) jobTitleSchema.parse(job.title);
  const p = await profile();
  return {
    id: id(),
    kind: job ? "application" : "direct",
    jobId: job?.id || "",
    companyId: company?.id || "",
    to: company?.email || "",
    subject: job ? `Application for ${job.title}${p.name ? ` — ${p.name}` : ""}` : "",
    body: "",
    resumeId: job ? p.resumeId : "",
    resumeName: job ? p.resumeName : "",
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
    jobUpdatedAt: job?.updatedAt || "",
    createdAt: now(),
    updatedAt: now(),
  };
}
export async function action(actionName: string, input: unknown) {
  const atomic = [
    "profile.save",
    "company.save",
    "company.contacts",
    "company.scan",
    "job.create",
    "job.status",
    "job.application",
    "draft.create",
    "draft.direct",
    "draft.followup",
    "settings.save",
    "gmail.sync",
  ];
  return atomic.includes(actionName)
    ? transaction(() => performAction(actionName, input))
    : performAction(actionName, input);
}
async function performAction(actionName: string, input: unknown) {
  const p = z.record(z.string(), z.unknown()).parse(input || {});
  const itemId = () => z.string().uuid().parse(p.id);
  switch (actionName) {
    case "profile.save": {
      const parsed = profileSchema.parse(p);
      if (parsed.confirmed && (!parsed.name || !parsed.experience || !parsed.skills.length))
        throw new AppError("Add your name, experience, and skills before confirming your profile.");
      const next = { ...(await profile()), ...parsed, updatedAt: now() };
      await transaction(async () => {
        await put("profile", next);
        for (const job of await all<Job>("job"))
          await put("job", { ...job, match: matchJob(job, next) });
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
      const old = typeof p.id === "string" ? await get<Company>("company", p.id) : null;
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
      await put("company", company);
      return { message: "Company saved." };
    }
    case "company.contacts": {
      const companyId = itemId();
      const contacts: {
        email: string;
        source: string;
        context: string;
      }[] = [];
      for (const job of (await all<Job>("job")).filter(
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
      if ((await settings()).automationPaused)
        throw new AppError("Automation is paused. Resume it in Settings.");
      const list = p.id
        ? ([await get<Company>("company", itemId())].filter(Boolean) as Company[])
        : await all<Company>("company");
      let count = 0;
      for (const c of list.filter((c) => !c.paused)) {
        await enqueue("scan", c.id);
        await put("company", {
          ...c,
          checkStatus: "queued",
          checkNote: "Waiting for the background worker.",
        });
        count++;
      }
      return { message: `Queued ${count} company checks.` };
    }
    case "job.create": {
      const parsed = jobSchema.parse(p);
      if (!(await get<Company>("company", parsed.companyId)))
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
      job.match = matchJob(job, await profile());
      await put("job", job);
      return { message: "Job added." };
    }
    case "job.status": {
      const job = await requireJob(itemId());
      const status = z.enum(["new", "shortlisted", "skipped", "closed"]).parse(p.status);
      await put("job", { ...job, status });
      return {
        message: status === "shortlisted" ? "Added to your shortlist." : "Job status updated.",
      };
    }
    case "job.application": {
      const job = await requireJob(itemId());
      const applicationStatus = z
        .enum(["not_submitted", "submitted", "interview", "offer", "rejected", "withdrawn"])
        .parse(p.status);
      await put("job", { ...job, applicationStatus });
      await activity(
        "Application updated",
        `${job.title} · ${applicationStatus.replaceAll("_", " ")}`,
      );
      return { message: "Application status updated." };
    }
    case "job.match": {
      const job = await requireJob(itemId());
      return exclusive(`match:${job.id}`, async () => {
        const match = await analyzeJob(job);
        const latest = await requireJob(job.id);
        if (latest.updatedAt !== job.updatedAt)
          throw new AppError("The job changed during analysis. Please try again.", 409);
        await put("job", { ...latest, match });
        return { message: "AI match analysis is ready." };
      });
    }
    case "draft.direct": {
      const draft = await newDraft();
      await put("draft", draft);
      return {
        message: "New email opened. Enter the recipient, subject, and message.",
        draftId: draft.id,
      };
    }
    case "draft.create": {
      const job = await requireJob(itemId());
      const company = (await get<Company>("company", job.companyId))!;
      const previous = (await all<Draft>("draft")).find((d) => d.jobId === job.id && !d.followUpOf);
      if (previous)
        return { message: "Opened your existing application email.", draftId: previous.id };
      const draft = await newDraft(job, company);
      await put("draft", draft);
      return { message: "Email composer opened.", draftId: draft.id };
    }
    case "draft.generate": {
      const draft = await requireDraft(itemId());
      editable(draft);
      if (draft.kind === "direct")
        throw new AppError("Write your direct email, then use Improve English to edit it.");
      if (draft.followUpOf)
        throw new AppError(
          "Edit the follow-up directly; application generation is for first emails.",
        );
      return exclusive(`draft:${draft.id}`, async () => {
        const job = await requireJob(draft.jobId);
        const company = (await get<Company>("company", draft.companyId))!;
        const before = (await profile()).updatedAt;
        const version = z.number().int().parse(p.version);
        if (version !== draft.version)
          throw new AppError("The draft changed in another tab. Reload before generating.", 409);
        const style = z.string().trim().max(1000).optional().parse(p.style);
        const result = await writeEmail(job, company, style, draft.body, !!draft.resumeId);
        const latest = await requireDraft(draft.id);
        if (
          (await profile()).updatedAt !== before ||
          latest.version !== draft.version ||
          (await requireJob(job.id)).updatedAt !== job.updatedAt
        )
          throw new AppError(
            "The inputs changed while generating. Try again with the latest version.",
            409,
          );
        const user = await profile();
        await put("draft", {
          ...latest,
          subject: result.value.subject,
          body: result.value.body,
          evidence: result.value.evidence.map((e) => `${e.claim}\nSource: “${e.sourceQuote}”`),
          reviewNotes: result.value.reviewNotes,
          model: result.model,
          writingInstructions: style || "",
          resumeId: draft.resumeId ? user.resumeId : "",
          resumeName: draft.resumeId ? user.resumeName : "",
          status: "draft",
          version: latest.version + 1,
          approvedHash: null,
          approvedAt: null,
          gmailRawHash: null,
          profileUpdatedAt: before,
          jobUpdatedAt: job.updatedAt,
          updatedAt: now(),
        });
        await activity(
          "Application email generated",
          `${job.title} · ready for your review`,
          "success",
        );
        return {
          message: "Email generated. Check the claims and recipient before saving to Gmail.",
        };
      });
    }
    case "draft.polish":
      return exclusive(`draft:${itemId()}`, async () => {
        const draft = await requireDraft(itemId());
        editable(draft);
        if (z.number().int().parse(p.version) !== draft.version)
          throw new AppError(
            "The draft changed in another tab. Reload before improving the English.",
            409,
          );
        const suggestion = await polishEmail(draft);
        const latest = await requireDraft(draft.id);
        editable(latest);
        if (latest.version !== draft.version)
          throw new AppError("The email changed while editing. Request a new suggestion.", 409);
        // A suggestion never overwrites the draft, approval, or Gmail content.
        return { suggestion };
      });
    case "draft.template":
      return exclusive(`draft:${itemId()}`, async () => {
        const draft = await requireDraft(itemId());
        editable(draft);
        if (draft.kind === "direct")
          throw new AppError("Write your direct email, then use Improve English to edit it.");
        if (z.number().int().parse(p.version) !== draft.version)
          throw new AppError("The draft changed in another tab. Reload before generating.", 409);
        const job = await requireJob(draft.jobId);
        const company = await get<Company>("company", job.companyId);
        const user = await profile();
        if (!user.confirmed || !user.name || !user.experience || !user.skills.length)
          throw new AppError("Confirm your profile with your name, experience, and skills first.");
        if (!company) throw new AppError("Company not found.", 404);
        if (job.status === "closed")
          throw new AppError("This vacancy is closed. Choose an open role.");
        if (draft.followUpOf)
          throw new AppError("The local application template is not for follow-ups.");
        const resumeId = draft.resumeId ? user.resumeId : "";
        const result = localEmail(job, company, user, !!resumeId);
        await put("draft", {
          ...draft,
          ...result,
          resumeId,
          resumeName: resumeId ? user.resumeName : "",
          model: "Local template",
          status: "draft",
          version: draft.version + 1,
          approvedHash: null,
          approvedAt: null,
          gmailRawHash: null,
          profileUpdatedAt: user.updatedAt,
          jobUpdatedAt: job.updatedAt,
          updatedAt: now(),
        });
        return {
          message: "Email written from your profile. Review and personalize it before sending.",
        };
      });
    case "draft.save":
      return exclusive(`draft:${itemId()}`, async () => {
        const draft = await requireDraft(itemId());
        editable(draft);
        const parsed = draftEditSchema.parse(p);
        if (parsed.version !== draft.version)
          throw new AppError("The draft changed in another tab. Reload before editing.", 409);
        const user = await profile();
        await put("draft", {
          ...draft,
          to: parsed.to,
          subject: parsed.subject,
          body: parsed.body,
          ...(parsed.body !== draft.body ||
          parsed.subject !== draft.subject ||
          draft.profileUpdatedAt !== user.updatedAt
            ? {
                evidence: [],
                reviewNotes: [
                  draft.kind === "direct"
                    ? "Review the recipient, message, and any attachment before sending."
                    : "This email was edited manually. Recheck every claim against your confirmed profile.",
                ],
                model: "Manual",
              }
            : {}),
          resumeId: parsed.attachResume ? user.resumeId : "",
          resumeName: parsed.attachResume ? user.resumeName : "",
          version: draft.version + 1,
          status: "draft",
          approvedHash: null,
          approvedAt: null,
          gmailRawHash: null,
          profileUpdatedAt: user.updatedAt,
          jobUpdatedAt: draft.kind === "direct" ? "" : (await requireJob(draft.jobId)).updatedAt,
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
    case "draft.sendDirect":
      await sendDirectEmail(itemId(), p);
      return { message: "Email sent through Gmail." };
    case "draft.followup": {
      const original = await requireDraft(itemId());
      if (original.kind === "direct")
        throw new AppError("For direct emails, use New email to write another message.");
      if (original.status !== "sent" || original.replyStatus !== "none" || !original.sentAt)
        throw new AppError(
          "Follow-ups are only available for sent messages with no reply or bounce.",
        );
      if (Date.now() - Date.parse(original.sentAt) < (await settings()).followUpDays * 86400000)
        throw new AppError("The follow-up reminder is not due yet.");
      if (original.followUpOf)
        throw new AppError("Only one follow-up is supported per application.");
      const previous = (await all<Draft>("draft")).find((d) => d.followUpOf === original.id);
      if (previous) return { message: "Opened your existing follow-up.", draftId: previous.id };
      const job = await requireJob(original.jobId),
        company = (await get<Company>("company", job.companyId))!;
      const user = await profile();
      const draft = {
        ...(await newDraft(job, company)),
        to: original.to,
        subject: `Re: ${original.subject}`,
        body: `Hi Hiring Team,\n\nI wanted to follow up on my email about the ${job.title} role. I’m still interested and would be happy to share any additional information that would be useful.\n\nThanks for your time,\n${user.signature || user.name}`,
        resumeId: "",
        resumeName: "",
        followUpOf: original.id,
      };
      await put("draft", draft);
      return { message: "Follow-up prepared for review.", draftId: draft.id };
    }
    case "settings.save":
      await put("settings", { ...(await settings()), ...settingsSchema.parse(p) });
      return { message: "Settings saved." };
    case "gmail.disconnect":
      await disconnectGmail();
      return { message: "Gmail disconnected." };
    case "gmail.sync":
      await enqueue("replies", "main");
      return { message: "Reply check queued." };
    default:
      throw new AppError("Unknown action.", 404);
  }
}
