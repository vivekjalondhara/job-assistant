import { z } from "zod";
const text = (max = 1000) => z.string().trim().max(max);
const url = z.union([
  z.literal(""),
  z
    .url()
    .refine((v) => ["http:", "https:"].includes(new URL(v).protocol), "Use an HTTP or HTTPS URL."),
]);
export const jobTitleSchema = text(250)
  .min(1)
  .refine(
    (value) => !/[\r\n]|https?:\/\/|www\.|^[a-z0-9.-]+\.[a-z]{2,}[/?#]\S*$/i.test(value),
    "Enter the actual job title, such as Full Stack Software Engineer, not a URL. Put the link in Application URL.",
  );
export const profileSchema = z.object({
  name: text(160),
  email: z.union([z.literal(""), z.email()]),
  headline: text(240),
  location: text(160),
  skills: z
    .array(text(100).min(1))
    .max(100)
    .transform((items) =>
      items.filter(
        (item, index) =>
          items.findIndex((other) => other.toLowerCase() === item.toLowerCase()) === index,
      ),
    ),
  experience: text(16000),
  projects: text(16000),
  education: text(6000),
  targetRoles: z.array(text(120)).max(20),
  preferredLocations: z.array(text(120)).max(30),
  remoteOnly: z.boolean(),
  availability: text(500),
  portfolio: url,
  signature: text(1000),
  tone: z.enum(["warm", "concise", "formal"]),
  confirmed: z.boolean(),
});
export const companySchema = z.object({
  name: text(200).min(1),
  website: url,
  careersUrl: url,
  email: z.union([z.literal(""), z.email()]),
  contactSource: text(1000),
  contactConfirmed: z.boolean(),
  priority: z.enum(["high", "normal"]),
  paused: z.boolean().optional(),
});
export const jobSchema = z.object({
  companyId: z.string().min(1),
  title: jobTitleSchema,
  location: text(250),
  description: text(50000).min(30),
  url,
  applyUrl: url,
  remote: z.boolean(),
  salary: text(300),
});
export const settingsSchema = z.object({
  automationPaused: z.boolean(),
  dailySearch: z.boolean(),
  dailySendLimit: z.number().int().min(1).max(50),
  monthlyAiBudget: z.number().min(0.1).max(1000),
  followUpDays: z.number().int().min(3).max(30),
});
export const draftEditSchema = z.object({
  version: z.number().int(),
  to: z.union([z.literal(""), z.email()]),
  subject: text(250)
    .min(1)
    .refine((v) => !/[\r\n]/.test(v)),
  body: text(16000).min(20),
  attachResume: z.boolean(),
});
export const profileExtractionSchema = z.object({
  name: z.string(),
  email: z.string(),
  headline: z.string(),
  location: z.string(),
  skills: z.array(z.string()),
  experience: z.string(),
  projects: z.string(),
  education: z.string(),
});
export const emailOutputSchema = z.object({
  subject: z
    .string()
    .min(1)
    .max(250)
    .refine((v) => !/[\r\n]/.test(v)),
  body: z.string().min(30).max(8000),
  evidence: z.array(z.object({ claim: z.string(), sourceQuote: z.string() })).max(20),
  reviewNotes: z.array(z.string()).max(20),
});
