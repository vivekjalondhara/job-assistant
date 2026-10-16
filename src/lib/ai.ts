import type { ResumeFile } from "./files";
import { effectiveLimits } from "./account-limits";
import { z } from "zod";
import { all, put, id, now, profile, settings, get, remove, transaction } from "./db";
import { AppError, appUrl, privateHash } from "./security";
import { emailOutputSchema, jobTitleSchema, profileExtractionSchema } from "./validation";
import type { Company, Draft, Job, Usage } from "./types";
import {
  applicationEmailPrompt,
  jobMatchPrompt,
  profileExtractionPrompt,
  untrustedInputPrompt,
  polishEmailPrompt,
} from "./prompts";
import { jobInsights } from "./job-insights";
import { contentChecks } from "./email-checks";
import {
  candidateSignature,
  defaultWritingInstructions,
  defaultWritingOptions,
  emailTemplates,
  type EmailTone,
  type WritingOptions,
} from "./email-writing";
export async function exclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const owner = id();
  await transaction(async () => {
    const lock = await get<{
      expires: number;
    }>("lock", key);
    if (lock && lock.expires > Date.now())
      throw new AppError("This action is already running. Please wait.", 409);
    await put("lock", { id: key, owner, expires: Date.now() + 600000 });
  });
  try {
    return await fn();
  } finally {
    await transaction(async () => {
      if (
        (
          await get<{
            owner: string;
          }>("lock", key)
        )?.owner === owner
      )
        await remove("lock", key);
    });
  }
}
export async function generate<T>(
  operation: string,
  schema: z.ZodType<T>,
  instructions: string,
  input: unknown,
): Promise<{
  value: T;
  model: string;
}> {
  const key = process.env.OPENROUTER_API_KEY,
    model = process.env.OPENROUTER_MODEL;
  if (!key || !model)
    throw new AppError(
      "Configure OPENROUTER_API_KEY and OPENROUTER_MODEL in .env, then restart the application.",
      503,
    );
  const month = now().slice(0, 7);
  const used = (await all<Usage>("usage"))
    .filter((u) => u.createdAt.startsWith(month))
    .reduce((n, u) => n + (u.cost || 0), 0);
  if (used >= (await effectiveLimits()).monthlyAiBudget)
    throw new AppError(
      "Your recorded monthly AI spending limit has been reached. Adjust it in Settings to continue.",
      429,
    );
  const providers = (process.env.OPENROUTER_PROVIDERS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(90000),
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": appUrl(),
      "X-OpenRouter-Title": "Folio - Private Job Assistant",
    },
    body: JSON.stringify({
      model,
      stream: false,
      max_tokens: 3000,
      provider: {
        data_collection: "deny",
        zdr: true,
        require_parameters: true,
        allow_fallbacks: true,
        ...(providers.length ? { only: providers } : {}),
      },
      messages: [
        {
          role: "system",
          content: `${instructions}\n${untrustedInputPrompt}`,
        },
        { role: "user", content: JSON.stringify(input) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: operation, strict: true, schema: z.toJSONSchema(schema) },
      },
    }),
  });
  if (!response.ok) {
    if (response.status === 401)
      throw new AppError("OpenRouter rejected the API key. Update the server configuration.", 502);
    if (response.status === 402) throw new AppError("Your OpenRouter account needs credits.", 502);
    if (response.status === 429)
      throw new AppError("OpenRouter is rate limited. Try again shortly.", 429);
    throw new AppError(
      `OpenRouter returned HTTP ${response.status}. Check that the selected model supports structured output with your privacy settings.`,
      502,
    );
  }
  const result = await response.json();
  const usage = result.usage;
  const numberOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  await put<Usage>("usage", {
    id: id(),
    operation,
    model: result.model || model,
    provider: result.provider || "Not returned",
    providerIdHash: typeof result.id === "string" ? privateHash(result.id) : null,
    cost: numberOrNull(usage?.cost),
    inputTokens: numberOrNull(usage?.prompt_tokens),
    outputTokens: numberOrNull(usage?.completion_tokens),
    cachedTokens: numberOrNull(usage?.prompt_tokens_details?.cached_tokens),
    cacheWriteTokens: numberOrNull(usage?.prompt_tokens_details?.cache_write_tokens),
    reasoningTokens: numberOrNull(usage?.completion_tokens_details?.reasoning_tokens),
    createdAt: now(),
  });
  const content = result.choices?.[0]?.message?.content;
  if (typeof content !== "string")
    throw new AppError("The model did not return usable content. Nothing was saved to Gmail.", 502);
  try {
    return { value: schema.parse(JSON.parse(content)), model: result.model || model };
  } catch {
    throw new AppError(
      "The model returned an invalid response. Please try again or select another compatible model.",
      502,
    );
  }
}
export async function extractProfile() {
  const p = await profile();
  if (!p.resumeText) throw new AppError("Upload a résumé first.");
  const result = await generate(
    "resume_extraction",
    profileExtractionSchema,
    profileExtractionPrompt,
    { resume: p.resumeText.slice(0, 30000) },
  );
  if ((await profile()).updatedAt !== p.updatedAt)
    throw new AppError(
      "Your profile changed during extraction. Please try again with the current version.",
      409,
    );
  const updated = { ...p, ...result.value, confirmed: false, updatedAt: now() };
  await transaction(async () => {
    await put("profile", updated);
    for (const job of await all<Job>("job")) await put("job", { ...job, match: null });
  });
  return updated;
}
export async function writeEmail(
  job: Job,
  company: Company,
  style?: string,
  previous?: string,
  resumeAttached?: boolean,
  options?: WritingOptions,
  originalApplication?: Pick<Draft, "subject" | "sentAt">,
  selectedResumeId?: string,
) {
  const p = await profile();
  if (!p.confirmed || !p.name || !p.experience)
    throw new AppError(
      "Confirm your profile with your name and experience before generating an email.",
    );
  if (job.status === "closed") throw new AppError("This vacancy is closed. Choose an open role.");
  const title = jobTitleSchema.parse(job.title);
  const selected = selectedResumeId ? await get<ResumeFile>("file", selectedResumeId) : null;
  if (selectedResumeId && !selected)
    throw new AppError("Selected résumé is no longer available.", 409);
  const sourceText = [
    p.experience,
    p.projects,
    p.education,
    p.skills.join(", "),
    selected?.text || "",
  ].join("\n");
  const insights = jobInsights(job, p);
  const writingOptions = options || defaultWritingOptions(p);
  if (writingOptions.template === "followup" && !originalApplication?.sentAt)
    throw new AppError("Follow-ups require an actual sent application.");
  const result = await generate("application_email", emailOutputSchema, applicationEmailPrompt, {
    candidate: {
      name: p.name,
      email: p.email,
      headline: p.headline,
      location: p.location,
      availability: p.availability,
      portfolio: p.portfolio,
      signature: candidateSignature(p),
      tone: writingOptions.tone,
    },
    candidateEvidence: sourceText,
    selectedResume: selected
      ? { id: selected.id, label: selected.label || selected.name, text: selected.text || "" }
      : null,
    company: { name: company.name },
    job: {
      title,
      description: job.description.slice(0, 24000),
      location: job.location,
    },
    resumeAttached: resumeAttached ?? !!p.resumeId,
    jobInsights: insights,
    rankedEvidence: insights.rankedEvidence,
    writingOptions: {
      ...writingOptions,
      focus: emailTemplates[writingOptions.template].description,
    },
    originalApplication: originalApplication
      ? { subject: originalApplication.subject, sentAt: originalApplication.sentAt }
      : null,
    requestedStyle: style || defaultWritingInstructions,
    previousDraft: previous?.slice(0, 8000) || null,
  });
  const normalized = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const metrics = (text: string): string[] => text.match(/\d+(?:[.,]\d+)*(?:[%+]|x\b)?/gi) || [];
  if (
    (!result.value.evidence.length && writingOptions.template !== "followup") ||
    result.value.evidence.some(
      (e) =>
        !e.sourceQuote.trim() ||
        !normalized(sourceText).includes(normalized(e.sourceQuote)) ||
        metrics(e.claim).some((metric) => !metrics(e.sourceQuote).includes(metric)),
    )
  )
    throw new AppError(
      "The generated email did not provide valid evidence for its claims. Please regenerate or write the email manually.",
      422,
    );
  const verifiedNumbers = metrics(
    [
      sourceText,
      p.name,
      p.availability,
      p.portfolio,
      candidateSignature(p),
      title,
      company.name,
      originalApplication?.subject,
      originalApplication?.sentAt,
    ]
      .filter(Boolean)
      .join("\n"),
  );
  if (metrics(result.value.body).some((metric) => !verifiedNumbers.includes(metric)))
    throw new AppError(
      "The generated email contains numbers not supported by your saved evidence. Please regenerate or edit manually.",
      422,
    );
  if (p.signature.trim() && !result.value.body.trimEnd().endsWith(p.signature.trim()))
    throw new AppError(
      "The generated email did not preserve your configured signature. Please regenerate.",
      422,
    );
  const issue = contentChecks({
    ...result.value,
    to: "review@example.com",
    resumeId: (resumeAttached ?? !!p.resumeId) ? "attached" : "",
  }).find((c) => c.status === "error");
  if (issue)
    throw new AppError(
      `The generated email needs correction: ${issue.message} Please regenerate.`,
      422,
    );
  return result;
}
export async function polishEmail(draft: Draft, tone: EmailTone = "professional") {
  const body = z.string().trim().min(20).max(8000).parse(draft.body);
  const p = await profile();
  const signature = candidateSignature(p);
  // Protect both configured signatures and manually written conventional sign-offs.
  const signoff = body
    .match(
      /(?:^|\n)(?:best regards|kind regards|regards|best|sincerely|thanks|thank you)[,!]?\s*\n[\s\S]*$/i,
    )?.[0]
    .trim();
  const protectedSignature = signoff || (signature && body.endsWith(signature) ? signature : "");
  const result = await generate(
    "email_english",
    z.object({
      body: z.string().trim().min(20).max(8000),
      changes: z.array(z.string().trim().min(1).max(250)).max(5),
    }),
    polishEmailPrompt,
    {
      subject: draft.subject,
      body,
      tone,
      resumeAttached: !!draft.resumeId,
      protectedSignature,
      purpose: draft.followUpOf
        ? "follow-up"
        : draft.kind === "direct"
          ? "direct email"
          : "application",
    },
  );
  // Language editing must not silently alter numerical facts or contact links.
  // This is a narrow guard; the comparison UI still requires a factual review.
  const protectedValues = (text: string) =>
    (
      text.match(
        /https?:\/\/[^\s<>]+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\d+(?:[.,]\d+)*(?:[%+]|x\b)?/gi,
      ) || []
    )
      .map((value) => value.replace(/[.,;!?]+$/, ""))
      .sort();
  if (JSON.stringify(protectedValues(body)) !== JSON.stringify(protectedValues(result.value.body)))
    throw new AppError(
      "The suggestion changed numbers or contact links. Your original email was kept. Try again or edit it yourself.",
      422,
    );
  if (protectedSignature && !result.value.body.endsWith(protectedSignature))
    throw new AppError("The suggestion changed your signature. Your original email was kept.", 422);
  const issue = contentChecks({ ...draft, to: "review@example.com", body: result.value.body }).find(
    (check) => check.status === "error",
  );
  if (issue) throw new AppError(`The suggestion needs correction: ${issue.message}`, 422);
  return result.value;
}

export async function analyzeJob(job: Job) {
  const p = await profile();
  const resumeId = job.application?.resumeId || (p.defaultResumeId ?? p.resumeId);
  const selected = resumeId ? await get<ResumeFile>("file", resumeId) : null;
  if (resumeId && !selected)
    throw new AppError("Select an available résumé for this application first.", 409);
  if (!p.confirmed) throw new AppError("Confirm your profile first.");
  const schema = z.object({
    rating: z.enum(["strong", "possible", "weak"]),
    score: z.number().int().min(0).max(100),
    reasons: z.array(z.string()).max(8),
    gaps: z.array(z.string()).max(8),
    unknowns: z.array(z.string()).max(8),
  });
  const result = await generate("job_match", schema, jobMatchPrompt, {
    candidate: {
      skills: p.skills,
      experience: p.experience,
      projects: p.projects,
      location: p.location,
      targetRoles: p.targetRoles,
      preferredLocations: p.preferredLocations,
      remoteOnly: p.remoteOnly,
      preferences: p.preferences,
      selectedResume: selected ? { id: selected.id, text: selected.text || "" } : null,
    },
    job: {
      title: job.title,
      location: job.location,
      description: job.description.slice(0, 25000),
      requirements: job.requirements,
    },
  });
  if ((await profile()).updatedAt !== p.updatedAt)
    throw new AppError("Your profile changed during analysis. Please run the match again.", 409);
  return { ...result.value, method: "ai" as const, profileUpdatedAt: p.updatedAt, resumeId };
}
