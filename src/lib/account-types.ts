export interface AccountLimits {
  storageMb: number;
  monthlyAiBudget: number;
  dailySendLimit: number;
}
export interface Account {
  id: string;
  email: string | null;
  name: string;
  role: "admin" | "user";
  status: "invited" | "active" | "disabled" | "deleting";
  session_version: number;
  limits: AccountLimits;
  created_at: string;
}
export interface ManagedAccount extends Account {
  storageBytes: number;
  aiCost: number;
  unknownAiCosts: number;
  failedTasks: number;
}
export interface AdminSummary {
  users: ManagedAccount[];
  audit: { id: number; actor_id: string; target_id: string; action: string; created_at: string }[];
  emailConfigured: boolean;
}
export const defaultLimits: AccountLimits = {
  storageMb: 100,
  monthlyAiBudget: 10,
  dailySendLimit: 10,
};
