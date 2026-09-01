export interface Recipient {
  id: number;
  email: string;
  active: boolean;
  created_at: string;
}
export interface ExportSettings {
  gmailUser: string;
  scheduleEnabled: boolean;
  lastRunAt: string | null;
  scheduleHour: number;
  scheduleTimezone: string;
}
export interface Company {
  id: number;
  name: string;
  code: string;
}
export interface JobStep {
  time: string;
  message: string;
  type: "info" | "success" | "error" | "warning";
}
export interface JobStatus {
  status: "running" | "done" | "error";
  steps: JobStep[];
  error?: string;
  hasZip: boolean;
}

export interface BackupRun {
  id: number;
  runType: string;
  status: string;
  startedAt: string;
  finishedAt?: string;
  zipSizeBytes?: number;
  companiesCount?: number;
  companyFilesCount?: number;
  skippedCompanies?: string;
  skippedReason?: string;
  emailAttempted?: boolean;
  emailSuccess?: boolean;
  emailError?: string;
  emailAttempts?: number;
  whatsappAttempted?: boolean;
  whatsappSuccess?: boolean;
  whatsappError?: string;
  whatsappAttempts?: number;
}
export interface BackupReadiness {
  emailScheduleEnabled: boolean;
  gmailConfigured: boolean;
  emailRecipientCount: number;
  whatsappEnabled: boolean;
  whatsappDailyAutoSend: boolean;
  whatsappDailyRecipientId: number | null;
  whatsappDailyRecipientActive: boolean;
  companiesCount: number;
}
export interface BackupStatus {
  latestRun: BackupRun | null;
  recentRuns: BackupRun[];
  readiness: BackupReadiness;
  issues: string[];
}
export interface WaSettings {
  instanceId: string;
  apiToken: string;
  enabled: boolean;
  dailyAutoSend: boolean;
  dailyRecipientId: number | null;
  dailyRecipientName: string | null;
  hasCredentials: boolean;
}
export interface WaRecipient {
  id: number;
  chatId: string;
  name: string;
  isGroup: boolean;
  active: boolean;
}
export interface NpSettings {
  recipientId: number | null;
  recipientName: string | null;
  frequency: string;
  sendHour: number;
  sendDayOfWeek: number;
  enabled: boolean;
  autoSend: boolean;
  lastSentAt: string | null;
}
