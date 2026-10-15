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
  resumeId: string;
  resumeName: string;
  confirmed: boolean;
  updatedAt: string;
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
}
export type DraftStatus = "draft" | "gmail_draft" | "approved" | "sending" | "sent" | "uncertain";
export interface Draft {
  id: string;
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
  status: DraftStatus;
  version: number;
  approvedHash: string | null;
  approvedAt: string | null;
  gmailDraftId: string | null;
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
  profile: Profile;
  companies: Company[];
  jobs: Job[];
  drafts: Draft[];
  settings: Settings;
  activity: Activity[];
  usage: Usage[];
  tasks: Task[];
  connections: Connections;
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
