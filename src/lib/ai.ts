import { z } from "zod";
import { all, put, id, now, profile, settings, get, remove, transaction } from "./db";
import { AppError, appUrl, privateHash } from "./security";
import { emailOutputSchema, profileExtractionSchema } from "./validation";
import type { Company, Job, Usage } from "./types";
import {
  applicationEmailPrompt,
  jobMatchPrompt,
  profileExtractionPrompt,
  untrustedInputPrompt,
} from "./prompts";
import { jobInsights } from "./job-insights";
import { contentChecks } from "./email-checks";

export async function exclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const owner = id();
  transaction(() => {
    const lock = get<{ expires: number }>("lock", key);
    if (lock && lock.expires > Date.now())
      throw new AppError("This action is already running. Please wait.", 409);
    put("lock", { id: key, owner, expires: Date.now() + 180000 });
  });
  try {
    return await fn();
  } finally {
    transaction(() => {
      if (get<{ owner: string }>("lock", key)?.owner === owner) remove("lock", key);
    });
  }
}
export async function generate<T>(
  operation: string,
  schema: z.ZodType<T>,
  instructions: string,
  input: unknown,
): Promise<{ value: T; model: string }> {
  const key = process.env.OPENROUTER_API_KEY,
    model = process.env.OPENROUTER_MODEL;
  if (!key || !model)
    throw new AppError(
      "Configure OPENROUTER_API_KEY and OPENROUTER_MODEL in .env.local, then restart the application.",
      503,
    );
  const month = now().slice(0, 7);
  const used = all<Usage>("usage")
    .filter((u) => u.createdAt.startsWith(month))
    .reduce((n, u) => n + (u.cost || 0), 0);
  if (used >= settings().monthlyAiBudget)
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
      "X-OpenRouter-Title": "Folio — Private Job Assistant",
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
  put<Usage>("usage", {
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
  const p = profile();
  if (!p.resumeText) throw new AppError("Upload a résumé first.");
  const result = await generate(
    "resume_extraction",
    profileExtractionSchema,
    profileExtractionPrompt,
    { resume: p.resumeText.slice(0, 30000) },
  );
  if (profile().updatedAt !== p.updatedAt)
    throw new AppError(
      "Your profile changed during extraction. Please try again with the current version.",
      409,
    );
  const updated = { ...p, ...result.value, confirmed: false, updatedAt: now() };
  transaction(() => {
    put("profile", updated);
    for (const job of all<Job>("job")) put("job", { ...job, match: null });
  });
  return updated;
}
export async function writeEmail(
  job: Job,
  company: Company,
  style?: string,
  previous?: string,
  resumeAttached?: boolean,
) {
  const p = profile();
  if (!p.confirmed || !p.name || !p.experience)
    throw new AppError(
      "Confirm your profile with your name and experience before generating an email.",
    );
  if (job.status === "closed") throw new AppError("This vacancy is closed. Choose an open role.");
  const sourceText = [p.experience, p.projects, p.education, p.skills.join(", ")].join("\n");
  const result = await generate("application_email", emailOutputSchema, applicationEmailPrompt, {
    candidate: {
      name: p.name,
      headline: p.headline,
      location: p.location,
      availability: p.availability,
      portfolio: p.portfolio,
      signature: p.signature,
      tone: p.tone,
    },
    candidateEvidence: sourceText,
    company: { name: company.name },
    job: {
      title: job.title,
      description: job.description.slice(0, 24000),
      location: job.location,
    },
    resumeAttached: resumeAttached ?? !!p.resumeId,
    jobInsights: jobInsights(job, p),
    requestedStyle: style || "Natural professional English",
    previousDraft: previous?.slice(0, 8000) || null,
  });
  const normalized = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  if (
    !result.value.evidence.length ||
    result.value.evidence.some(
      (e) => !e.sourceQuote.trim() || !normalized(sourceText).includes(normalized(e.sourceQuote)),
    )
  )
    throw new AppError(
      "The generated email did not provide valid evidence for its claims. Please regenerate or write the email manually.",
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
export async function analyzeJob(job: Job) {
  const p = profile();
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
    },
    job: {
      title: job.title,
      location: job.location,
      description: job.description.slice(0, 25000),
    },
  });
  if (profile().updatedAt !== p.updatedAt)
    throw new AppError("Your profile changed during analysis. Please run the match again.", 409);
  return { ...result.value, method: "ai" as const, profileUpdatedAt: p.updatedAt };
}
