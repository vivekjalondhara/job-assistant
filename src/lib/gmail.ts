import { createRemoteJWKSet, jwtVerify } from "jose";
import MailComposer from "nodemailer/lib/mail-composer";
import { all, get, put, remove, now, settings, transaction, profile, activity } from "./db";
import { AppError, appUrl, encrypt, decrypt, digest } from "./security";
import { readResume } from "./files";
import { exclusive } from "./ai";
import { scanCompany } from "./jobs";
import type { Draft, Job, Company } from "./types";
import { contentChecks } from "./email-checks";
import { allowedGoogleEmails, isAllowedGoogleEmail } from "./google-config";
interface GmailConnection {
  email: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  needsReconnect: boolean;
}
const jwks = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
export async function connection(): Promise<GmailConnection | null> {
  const record = await get<{
    value: string;
  }>("secret", "gmail");
  if (!record) return null;
  const conn = decrypt<GmailConnection>(record.value);
  return { ...conn, needsReconnect: conn.needsReconnect || !isAllowedGoogleEmail(conn.email) };
}
const saveConnection = async (value: GmailConnection) =>
  await put("secret", { id: "gmail", value: encrypt(value) });
export function googleConfigured() {
  return !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    allowedGoogleEmails().length
  );
}
export function authorizationUrl(state: string) {
  if (!googleConfigured())
    throw new AppError(
      "Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_ALLOWED_EMAIL in your server environment. GOOGLE_ALLOWED_EMAIL accepts one email or a comma-separated list of valid addresses.",
      503,
    );
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${appUrl()}/api/auth/google/callback`,
    response_type: "code",
    scope:
      "openid email https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/gmail.readonly",
    access_type: "offline",
    prompt: "consent select_account",
    state,
  }).toString();
  return u.toString();
}
export async function exchangeCode(code: string) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    signal: AbortSignal.timeout(20000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${appUrl()}/api/auth/google/callback`,
      grant_type: "authorization_code",
    }),
  });
  if (!response.ok)
    throw new AppError("Google authorization failed. Please connect Gmail again.", 502);
  const data = await response.json();
  if (!data.id_token) throw new AppError("Google did not provide an identity token.", 401);
  const { payload } = await jwtVerify(data.id_token, jwks, {
    audience: process.env.GOOGLE_CLIENT_ID!,
    issuer: ["https://accounts.google.com", "accounts.google.com"],
  });
  const email = String(payload.email || "").toLowerCase();
  if (payload.email_verified !== true || !isAllowedGoogleEmail(email))
    throw new AppError("Choose a verified Google account listed in GOOGLE_ALLOWED_EMAIL.", 403);
  const scopes = String(data.scope || "");
  if (!scopes.includes("gmail.compose") || !scopes.includes("gmail.readonly"))
    throw new AppError("Grant both Gmail permissions to enable drafts and reply tracking.", 403);
  await transaction(async () => {
    const previous = await connection();
    const refreshToken =
      data.refresh_token ||
      (previous?.email.toLowerCase() === email ? previous.refreshToken : undefined);
    if (!refreshToken)
      throw new AppError(
        "Google did not grant offline access for this account. Connect again and grant consent.",
        400,
      );
    if (previous) await bindLegacyDrafts(previous.email);
    await saveConnection({
      email,
      accessToken: data.access_token,
      refreshToken,
      expiresAt: Date.now() + data.expires_in * 1000,
      needsReconnect: false,
    });
  });
  await activity("Gmail connected", email, "success");
}
async function accessToken(expectedEmail: string) {
  const conn = await connection();
  if (!conn || conn.needsReconnect)
    throw new AppError("Connect Gmail in Settings before continuing.", 409);
  if (conn.email.toLowerCase() !== expectedEmail.toLowerCase())
    throw new AppError(
      "The connected Gmail account changed. Review the sender and try again.",
      409,
    );
  if (conn.expiresAt > Date.now() + 60000) return conn.accessToken;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    signal: AbortSignal.timeout(20000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: conn.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) {
    if (response.status === 400 || response.status === 401)
      await updateConnectionIfCurrent(conn, { ...conn, needsReconnect: true });
    throw new AppError(
      "Gmail access could not be refreshed. Check Settings and reconnect if needed.",
      502,
    );
  }
  const data = await response.json();
  const refreshed = {
    ...conn,
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  await updateConnectionIfCurrent(conn, refreshed);
  return refreshed.accessToken;
}
async function updateConnectionIfCurrent(previous: GmailConnection, next: GmailConnection) {
  await transaction(async () => {
    const current = await connection();
    if (
      current?.email === previous.email &&
      current.accessToken === previous.accessToken &&
      current.refreshToken === previous.refreshToken
    )
      await saveConnection(next);
  });
}
async function bindLegacyDrafts(email: string) {
  for (const draft of await all<Draft>("draft")) {
    if (!draft.gmailAccountEmail && (draft.gmailDraftId || draft.sentMessageId || draft.threadId))
      await put("draft", {
        ...draft,
        gmailAccountEmail: email.toLowerCase(),
        approvedHash: null,
        approvedAt: null,
        status: draft.status === "approved" ? "gmail_draft" : draft.status,
      });
  }
}
async function gmail(expectedEmail: string, path: string, method = "GET", body?: unknown) {
  const token = await accessToken(expectedEmail);
  const current = await connection();
  if (
    !current ||
    current.needsReconnect ||
    current.email.toLowerCase() !== expectedEmail.toLowerCase() ||
    current.accessToken !== token
  )
    throw new AppError("The Gmail connection changed. Review the sender and try again.", 409);
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    method,
    signal: AbortSignal.timeout(25000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    if (response.status === 401) {
      const conn = await connection();
      if (conn?.email.toLowerCase() === expectedEmail.toLowerCase() && conn.accessToken === token)
        await updateConnectionIfCurrent(conn, { ...conn, needsReconnect: true });
    }
    throw new AppError(
      `Gmail returned HTTP ${response.status}. ${response.status === 404 ? "The draft may have been sent or removed in Gmail." : "Check your connection and try again."}`,
      502,
    );
  }
  return response.status === 204 ? {} : response.json();
}
export async function disconnectGmail() {
  const conn = await connection();
  await transaction(async () => {
    const current = await connection();
    if (current?.email !== conn?.email || current?.refreshToken !== conn?.refreshToken)
      throw new AppError("The Gmail connection changed. Refresh Settings and try again.", 409);
    if (current) await bindLegacyDrafts(current.email);
    await remove("secret", "gmail");
  });
  if (conn) {
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: conn.refreshToken }),
      signal: AbortSignal.timeout(15000),
    }).catch(() => null);
  }
  await activity(
    "Gmail disconnected",
    "Local credentials removed. You can also revoke access in your Google Account.",
  );
}
export const draftHash = (draft: Draft) =>
  digest(
    JSON.stringify({
      to: draft.to,
      subject: draft.subject,
      body: draft.body,
      resumeId: draft.resumeId,
      resumeName: draft.resumeName,
      gmailAccountEmail: draft.gmailAccountEmail,
      version: draft.version,
    }),
  );
export function validateDraft(draft: Draft) {
  const issue = contentChecks(draft).find((check) => check.status === "error");
  if (issue) throw new AppError(issue.message);
}
async function checkCurrent(draft: Draft) {
  const conn = await connection();
  if (!conn || conn.needsReconnect)
    throw new AppError("Connect Gmail in Settings before continuing.", 409);
  if (draft.gmailAccountEmail !== conn.email.toLowerCase())
    throw new AppError(
      "Save this email to the connected Gmail account and approve it again before sending.",
      409,
    );
  const company = await get<Company>("company", draft.companyId);
  if (
    !company?.contactConfirmed ||
    !company.contactSource.trim() ||
    draft.to.toLowerCase() !== company.email.toLowerCase()
  )
    throw new AppError(
      "Confirm this recruitment address and its source in Companies before approving or sending.",
      409,
    );
  if (!(await profile()).confirmed)
    throw new AppError("Confirm your profile before approving or sending an application.", 409);
  const job = await get<Job>("job", draft.jobId);
  if (!job || job.status === "closed")
    throw new AppError("This job is no longer open. Review the application before sending.", 409);
  if (
    (await profile()).updatedAt !== draft.profileUpdatedAt ||
    job.updatedAt !== draft.jobUpdatedAt
  )
    throw new AppError(
      "Your profile or the job changed. Save the reviewed email again before approving.",
      409,
    );
  if (["rejected", "withdrawn", "offer"].includes(job.applicationStatus))
    throw new AppError(
      "This application is already resolved. Review its status before sending.",
      409,
    );
  if (draft.followUpOf) {
    const original = await get<Draft>("draft", draft.followUpOf);
    if (!original || original.replyStatus !== "none")
      throw new AppError("A reply or bounce was received. This follow-up must not be sent.", 409);
    if (original.gmailAccountEmail !== draft.gmailAccountEmail)
      throw new AppError(
        "Connect the Gmail account that sent the original application before following up.",
        409,
      );
  }
}
export async function saveGmailDraft(draftId: string) {
  return exclusive(`draft:${draftId}`, async () => {
    const draft = await get<Draft>("draft", draftId);
    if (!draft) throw new AppError("Draft not found.", 404);
    if (["sent", "sending", "uncertain"].includes(draft.status))
      throw new AppError(
        "This message cannot be changed while sent or awaiting verification.",
        409,
      );
    validateDraft(draft);
    const conn = await connection();
    if (!conn || conn.needsReconnect) throw new AppError("Connect Gmail in Settings.", 409);
    const attachment = draft.resumeId ? await readResume(draft.resumeId) : null;
    let replyHeaders: {
      inReplyTo?: string;
      references?: string;
    } = {};
    let threadId: string | undefined;
    if (draft.followUpOf) {
      const original = await get<Draft>("draft", draft.followUpOf);
      if (!original?.sentMessageId || !original.threadId)
        throw new AppError("The original sent message is not available for threading.");
      if (original.gmailAccountEmail !== conn.email.toLowerCase())
        throw new AppError(
          "Connect the Gmail account that sent the original application before following up.",
          409,
        );
      const originalMessage = await gmail(
        conn.email,
        `messages/${encodeURIComponent(original.sentMessageId)}?format=metadata&metadataHeaders=Message-ID`,
      );
      const messageId = (originalMessage.payload?.headers || []).find(
        (h: { name: string }) => h.name.toLowerCase() === "message-id",
      )?.value;
      if (!messageId) throw new AppError("Could not identify the original email thread.");
      replyHeaders = { inReplyTo: messageId, references: messageId };
      threadId = original.threadId;
    }
    const composer = new MailComposer({
      from: conn.email,
      to: draft.to,
      subject: draft.subject,
      text: draft.body,
      ...replyHeaders,
      attachments: attachment
        ? [
            {
              filename: attachment.meta.name,
              content: attachment.buffer,
              contentType: attachment.meta.mime,
            },
          ]
        : [],
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    const mime = await composer.compile().build();
    const raw = mime.toString("base64url");
    const existingId =
      draft.gmailAccountEmail === conn.email.toLowerCase() ? draft.gmailDraftId : null;
    const result = await gmail(
      conn.email,
      existingId ? `drafts/${encodeURIComponent(existingId)}` : "drafts",
      existingId ? "PUT" : "POST",
      { message: { raw, ...(threadId ? { threadId } : {}) } },
    );
    const saved = await gmail(conn.email, `drafts/${encodeURIComponent(result.id)}?format=raw`);
    const latest = (await get<Draft>("draft", draftId))!;
    if (latest.version !== draft.version)
      throw new AppError("The email changed while saving. Save the latest version again.", 409);
    await put("draft", {
      ...latest,
      status: "gmail_draft",
      gmailDraftId: result.id,
      gmailAccountEmail: conn.email.toLowerCase(),
      gmailRawHash: digest(saved.message.raw),
      approvedHash: null,
      approvedAt: null,
      updatedAt: now(),
    });
    await activity("Saved a Gmail draft", draft.subject, "success");
  });
}
export async function approveDraft(draftId: string, version: number) {
  return exclusive(`draft:${draftId}`, async () => {
    const draft = await get<Draft>("draft", draftId);
    if (!draft) throw new AppError("Draft not found.", 404);
    if (draft.version !== version)
      throw new AppError("The draft changed. Review the latest version.", 409);
    if (!draft.gmailDraftId || draft.status !== "gmail_draft")
      throw new AppError("Save the latest version to Gmail before approving.", 409);
    validateDraft(draft);
    await checkCurrent(draft);
    const remote = await gmail(
      draft.gmailAccountEmail!,
      `drafts/${encodeURIComponent(draft.gmailDraftId)}?format=raw`,
    );
    if (digest(remote.message.raw) !== draft.gmailRawHash)
      throw new AppError(
        "This draft was edited in Gmail. Review it there, or save your reviewed application version to Gmail again.",
        409,
      );
    await put("draft", {
      ...draft,
      status: "approved",
      approvedHash: draftHash(draft),
      approvedAt: now(),
      updatedAt: now(),
    });
  });
}
export async function sendDraft(draftId: string) {
  return exclusive(`draft:${draftId}`, async () => {
    if ((await settings()).automationPaused)
      throw new AppError("Sending is paused. Resume automation in Settings.", 409);
    const draft = await get<Draft>("draft", draftId);
    if (!draft) throw new AppError("Draft not found.", 404);
    if (
      draft.status !== "approved" ||
      draft.approvedHash !== draftHash(draft) ||
      !draft.gmailDraftId
    )
      throw new AppError("Review and approve the latest Gmail draft before sending.", 409);
    const company = await get<Company>("company", draft.companyId);
    if (
      company &&
      company.source !== "manual" &&
      (!company.lastChecked || Date.now() - Date.parse(company.lastChecked) > 86400000)
    )
      await scanCompany(company.id, true);
    if (draft.followUpOf) await syncReplies();
    validateDraft(draft);
    await checkCurrent(draft);
    const remote = await gmail(
      draft.gmailAccountEmail!,
      `drafts/${encodeURIComponent(draft.gmailDraftId)}?format=raw`,
    );
    if (digest(remote.message.raw) !== draft.gmailRawHash) {
      await put("draft", { ...draft, status: "gmail_draft", approvedHash: null, approvedAt: null });
      throw new AppError("The Gmail draft changed after approval. Review it again.", 409);
    }
    await transaction(async () => {
      const latest = (await get<Draft>("draft", draftId))!;
      await checkCurrent(latest);
      if ((await settings()).automationPaused)
        throw new AppError("Sending is paused. Resume automation in Settings.", 409);
      if (latest.status !== "approved" || latest.version !== draft.version)
        throw new AppError("This draft changed or is already being sent.", 409);
      const recent = (await all<Draft>("draft")).filter(
        (d) =>
          (d.sentAt && Date.parse(d.sentAt) > Date.now() - 86400000) ||
          ["sending", "uncertain"].includes(d.status),
      );
      if (recent.length >= (await settings()).dailySendLimit)
        throw new AppError("Your rolling 24-hour sending allowance has been reached.", 429);
      if (
        (await all<Draft>("draft")).some(
          (d) =>
            d.id !== draft.id &&
            d.jobId === draft.jobId &&
            d.to.toLowerCase() === draft.to.toLowerCase() &&
            d.followUpOf === draft.followUpOf &&
            ["sent", "sending", "uncertain"].includes(d.status),
        )
      )
        throw new AppError(
          "An email for this application has already been sent or is awaiting verification.",
          409,
        );
      await put("draft", { ...latest, status: "sending", updatedAt: now() });
    });
    try {
      const result = await gmail(draft.gmailAccountEmail!, "drafts/send", "POST", {
        id: draft.gmailDraftId,
      });
      if (!result.id) throw new Error("Missing send result");
      await put("draft", {
        ...draft,
        status: "sent",
        sentMessageId: result.id,
        threadId: result.threadId,
        sentAt: now(),
        updatedAt: now(),
      });
      await activity("Email sent", draft.subject, "success");
    } catch {
      await put("draft", { ...draft, status: "uncertain", approvedHash: null, updatedAt: now() });
      throw new AppError(
        "Gmail's send result could not be confirmed. Check Sent in Gmail before taking any further action; this message will not be retried automatically.",
        502,
      );
    }
  });
}
export async function syncReplies(deadline = Date.now() + 200000) {
  const conn = await connection();
  if (!conn || conn.needsReconnect) return;
  const drafts = (await all<Draft>("draft")).filter(
    (d) => d.status === "sent" && d.threadId && d.gmailAccountEmail === conn.email.toLowerCase(),
  );
  let count = 0;
  const cursor = (await get<{ offset: number }>("schedule", "reply-cursor"))?.offset || 0;
  const ordered = [...drafts.slice(cursor), ...drafts.slice(0, cursor)];
  for (let index = 0; index < Math.min(ordered.length, 100); index++) {
    if (Date.now() > deadline - 30000) break;
    const draft = ordered[index];
    // Advance only after a successful request; the next run resumes the rotation.

    const thread = await gmail(
      conn.email,
      `threads/${encodeURIComponent(draft.threadId!)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Auto-Submitted`,
    );
    await put("schedule", {
      id: "reply-cursor",
      offset: (cursor + index + 1) % Math.max(drafts.length, 1),
    });
    const messages = (thread.messages || []).filter(
      (m: Record<string, any>) =>
        m.id !== draft.sentMessageId &&
        Number(m.internalDate) > Date.parse(draft.sentAt || "0") &&
        !(m.labelIds || []).includes("SENT"),
    );
    if (!messages.length) continue;
    const last = messages.at(-1);
    const headers = (last.payload?.headers || []) as {
      name: string;
      value: string;
    }[];
    const from = headers.find((h) => h.name.toLowerCase() === "from")?.value || "";
    const subject = headers.find((h) => h.name.toLowerCase() === "subject")?.value || "";
    const bounce = /mailer-daemon|postmaster|delivery status notification|undeliver/i.test(
      `${from} ${subject}`,
    );
    const latest = (await get<Draft>("draft", draft.id))!;
    await put("draft", {
      ...latest,
      replyStatus: bounce ? "bounce" : "reply",
      lastReplyAt: new Date(Number(last.internalDate)).toISOString(),
    });
    count++;
  }
  await activity(
    "Checked application replies",
    `${count} tracked threads have a reply or delivery notice. Only messages in known application threads were checked.`,
  );
}
