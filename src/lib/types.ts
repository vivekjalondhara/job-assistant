import type { Account } from "./account-types";
import type { WritingOptions } from "./email-writing";

export interface Profile {
  id: string;
  name: string;
  email: string;
  headline: string;
  location: string;
  skills: string[];
  experience: string;
  projects: string;
  education: string;
  targetRoles: string[];
  preferredLocations: string[];
  remoteOnly: boolean;
  availability: string;
  portfolio: string;
  signature: string;
  tone: "warm" | "concise" | "formal";
  resumeText: string;
  defaultResumeId?: string;
  resumeId: string;
  resumeName: string;
  confirmed: boolean;
  updatedAt: string;
  preferences?: JobPreferences;
}
export interface JobPreferences {
  experienceYears: number | null;
  seniority: string;
  workCountries: string[];
  employmentType: string;
  workplace: string;
  salaryMin: number | null;
  salaryCurrency: string;
}
export const defaultPreferences: JobPreferences = {
  experienceYears: null,
  seniority: "",
  workCountries: [],
  employmentType: "",
  workplace: "",
  salaryMin: null,
  salaryCurrency: "INR",
};
export interface JobRequirements {
  experienceMin: number | null;
  seniority: string;
  eligibleCountries: string[];
  employmentType: string;
  workplace: string;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string;
  salaryPeriod: string;
  evidence: string[];
}
export interface FitCheck {
  label: string;
  status: "supported" | "gap" | "unknown";
  detail: string;
}
export interface ApplicationDetails {
  resumeName?: string;
  resumeVersion?: number;
  submittedAt: string;
  recruiterName: string;
  recruiterEmail: string;
  notes: string;
  interviewAt: string;
  nextAction: string;
  reminderAt: string;
  resumeId: string;
  history: { status: Job["applicationStatus"]; at: string }[];
}
export interface ResumeVersion {
  size?: number;
  version?: number;
  previousId?: string;
  id: string;
  name: string;
  label?: string;
  targetRole?: string;
  createdAt: string;
}
export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  purpose: "application" | "inquiry" | "referral" | "followup";
  updatedAt: string;
  builtin?: boolean;
}
export interface SavedSearch {
  id: string;
  name: string;
  query: string;
  location: string;
  workplace: string;
  employmentType: string;
  maxAgeDays: number;
  updatedAt: string;
}
export interface JobImportPreview {
  companyName: string;
  title: string;
  location: string;
  description: string;
  url: string;
  applyUrl: string;
  remote: boolean;
  salary: string;
  requirements: JobRequirements;
}
export type Source = "ashby" | "greenhouse" | "lever" | "manual";
export interface Company {
  id: string;
  name: string;
  website: string;
  careersUrl: string;
  source: Source;
  board: string;
  email: string;
  contactSource: string;
  contactConfirmed: boolean;
  priority: "high" | "normal";
  paused: boolean;
  lastChecked: string | null;
  checkStatus: "never" | "queued" | "success" | "failed" | "manual";
  checkNote: string;
  createdAt: string;
}
export interface Match {
  rating: "strong" | "possible" | "weak";
  score: number;
  reasons: string[];
  gaps: string[];
  unknowns: string[];
  method: "rules" | "ai";
  profileUpdatedAt: string;
  resumeId?: string;
  recommendation?: "good" | "stretch" | "review" | "poor";
  checks?: FitCheck[];
  skillScore?: number;
}
export interface Job {
  id: string;
  companyId: string;
  sourceId: string;
  title: string;
  location: string;
  remote: boolean;
  description: string;
  url: string;
  applyUrl: string;
  salary: string;
  status: "new" | "shortlisted" | "skipped" | "closed";
  applicationStatus:
    "not_submitted" | "submitted" | "interview" | "offer" | "rejected" | "withdrawn";
  match: Match | null;
  publishedAt: string | null;
  checkedAt: string | null;
  createdAt: string;
  updatedAt: string;
  source: Source;
  requirements?: JobRequirements;
  application?: ApplicationDetails;
}
export type DraftStatus = "draft" | "gmail_draft" | "approved" | "sending" | "sent" | "uncertain";
export interface Draft {
  id: string;
  // Older drafts without a kind are job applications.
  kind?: "application" | "direct";
  jobId: string;
  companyId: string;
  to: string;
  subject: string;
  body: string;
  resumeId: string;
  resumeName: string;
  evidence: string[];
  reviewNotes: string[];
  model: string;
  writingInstructions?: string;
  writingOptions?: WritingOptions;
  status: DraftStatus;
  version: number;
  approvedHash: string | null;
  approvedAt: string | null;
  gmailDraftId: string | null;
  gmailAccountEmail?: string;
  gmailRawHash: string | null;
  sentMessageId: string | null;
  threadId: string | null;
  sentAt: string | null;
  replyStatus: "none" | "reply" | "bounce";
  lastReplyAt: string | null;
  followUpOf: string | null;
  profileUpdatedAt: string;
  jobUpdatedAt: string;
  createdAt: string;
  updatedAt: string;
}
export interface EnglishSuggestion {
  body: string;
  changes: string[];
}
export interface Settings {
  id: string;
  automationPaused: boolean;
  dailySearch: boolean;
  dailySendLimit: number;
  monthlyAiBudget: number;
  followUpDays: number;
  lastScheduledDay: string;
}
export interface Usage {
  id: string;
  operation: string;
  model: string;
  provider: string;
  providerIdHash: string | null;
  cost: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
  createdAt: string;
}
export interface Activity {
  id: string;
  label: string;
  detail: string;
  kind: "success" | "info" | "error";
  createdAt: string;
}
export interface Task {
  id: string;
  type: "scan" | "replies";
  targetId: string;
  status: "pending" | "running" | "done" | "failed";
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}
export interface Connections {
  openrouter: boolean;
  model: string;
  googleConfigured: boolean;
  gmail: boolean;
  gmailEmail: string;
  gmailNeedsReconnect: boolean;
  workerLastSeen: string | null;
}
export interface AppState {
  account?: Account;
  profile: Profile;
  companies: Company[];
  companyCount: number;
  jobs: Job[];
  drafts: Draft[];
  settings: Settings;
  activity: Activity[];
  usage: Usage[];
  tasks: Task[];
  connections: Connections;
  templates?: EmailTemplate[];
  resumes?: ResumeVersion[];
  searches?: SavedSearch[];
}
export const emptyProfile: Profile = {
  id: "main",
  name: "",
  email: "",
  headline: "",
  location: "",
  skills: [],
  experience: "",
  projects: "",
  education: "",
  targetRoles: [],
  preferredLocations: [],
  remoteOnly: false,
  availability: "",
  portfolio: "",
  signature: "",
  tone: "warm",
  resumeText: "",
  resumeId: "",
  resumeName: "",
  confirmed: false,
  updatedAt: "",
};
export const defaultSettings: Settings = {
  id: "main",
  automationPaused: false,
  dailySearch: false,
  dailySendLimit: 10,
  monthlyAiBudget: 10,
  followUpDays: 7,
  lastScheduledDay: "",
};
