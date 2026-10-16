import { currentUserId, LEGACY_USER_ID } from "./db";
import { z } from "zod";

/** Exact addresses only. A malformed entry disables the whole list. */
export function allowedGoogleEmails(value = process.env.GOOGLE_ALLOWED_EMAIL || ""): string[] {
  const emails = [
    ...new Set(
      value
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  const parsed = z.array(z.email()).min(1).max(100).safeParse(emails);
  return parsed.success ? parsed.data : [];
}

export function isAllowedGoogleEmail(email: string): boolean {
  // The original owner's optional allowlist remains intact. Invited users authorize
  // their own verified Google mailbox inside their authenticated workspace.
  if (currentUserId() && currentUserId() !== LEGACY_USER_ID)
    return z.email().safeParse(email).success;
  return allowedGoogleEmails().includes(email.trim().toLowerCase());
}
