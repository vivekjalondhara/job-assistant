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
  return allowedGoogleEmails().includes(email.trim().toLowerCase());
}
