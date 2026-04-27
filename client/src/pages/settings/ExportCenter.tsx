import { useState, useEffect, useRef, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Download, Mail, Plus, Trash2, Building2, Calendar, ChevronDown, ChevronRight,
  Clock, Eye, EyeOff, Loader2, AlertTriangle, CheckCircle2, XCircle, Info,
  MessageSquare, Send, RefreshCw, ShieldCheck, ShieldAlert, Users, TrendingUp,
  Settings2, Zap,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface Recipient { id: number; email: string; active: boolean; created_at: string; }
interface ExportSettings { gmailUser: string; scheduleEnabled: boolean; lastRunAt: string | null; }
interface Company { id: number; name: string; code: string; }
interface JobStep { time: string; message: string; type: "info" | "success" | "error" | "warning"; }
interface JobStatus { status: "running" | "done" | "error"; steps: JobStep[]; error?: string; hasZip: boolean; }

interface BackupRun {
  id: number; runType: string; status: string;
  startedAt: string; finishedAt?: string;
  zipSizeBytes?: number; companiesCount?: number; companyFilesCount?: number;
  skippedCompanies?: string; skippedReason?: string;
  emailAttempted?: boolean; emailSuccess?: boolean; emailError?: string; emailAttempts?: number;
  whatsappAttempted?: boolean; whatsappSuccess?: boolean; whatsappError?: string; whatsappAttempts?: number;
}
interface BackupReadiness {
  emailScheduleEnabled: boolean; gmailConfigured: boolean; emailRecipientCount: number;
  whatsappEnabled: boolean; whatsappDailyAutoSend: boolean;
  whatsappDailyRecipientId: number | null; whatsappDailyRecipientActive: boolean;
  companiesCount: number;
}
interface BackupStatus {
  latestRun: BackupRun | null; recentRuns: BackupRun[];
  readiness: BackupReadiness; issues: string[];
}
interface WaSettings {
  instanceId: string; apiToken: string; enabled: boolean;
  dailyAutoSend: boolean; dailyRecipientId: number | null; hasCredentials: boolean;
}
interface WaRecipient { id: number; chatId: string; name: string; isGroup: boolean; active: boolean; }
interface NpSettings {
  recipientId: number | null; frequency: string; sendHour: number;
  sendDayOfWeek: number; enabled: boolean; autoSend: boolean; lastSentAt: string | null;
}

// ── Helper utilities ─────────────────────────────────────────────────────────

function fmtBytes(bytes?: number): string {
  if (!bytes) return "—";
  const mb = bytes / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}
function fmtTime(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}
function runTypeLabel(t: string): string {
  switch (t) {
    case "scheduled":         return "Scheduled";
    case "manual_email":      return "Manual — Email";
    case "manual_whatsapp":   return "Manual — WhatsApp";
    case "manual_download":   return "Manual — Download";
    default: return t;
  }
}
function runTypeBadgeClass(t: string): string {
  switch (t) {
    case "scheduled":       return "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300";
    case "manual_email":    return "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300";
    case "manual_whatsapp": return "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300";
    case "manual_download": return "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
    default: return "bg-muted text-muted-foreground";
  }
}

const DAYS = [
  { value: "0", label: "Sunday" }, { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" }, { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" }, { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
];
function formatHour(h: number): string {
  if (h === 0) return "12:00 AM";
  if (h < 12) return `${h}:00 AM`;
  if (h === 12) return "12:00 PM";
  return `${h - 12}:00 PM`;
}
const HOURS = Array.from({ length: 24 }, (_, i) => ({ value: String(i), label: formatHour(i) }));

function scheduleLabel(cfg: NpSettings | undefined): string {
  if (!cfg?.autoSend || !cfg?.enabled) return "";
  const time = formatHour(cfg.sendHour ?? 18);
  if (cfg.frequency === "daily") return `Daily at ${time} EST`;
  if (cfg.frequency === "monthly") return `Monthly (1st) at ${time} EST`;
  if (cfg.frequency === "weekly") {
    const day = DAYS.find(d => d.value === String(cfg.sendDayOfWeek))?.label ?? "Monday";
    return `Every ${day} at ${time} EST`;
  }
  return "Auto-Send On";
}
function currentYearDateRange() {
  const year = new Date().getFullYear();
  const today = new Date().toISOString().split("T")[0];
  return { start: `${year}-01-01`, end: today };
}

// ── Shared sub-components ────────────────────────────────────────────────────

function RunStatusBadge({ status }: { status: string }) {
  if (status === "success") return (
    <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400 font-medium">
      <CheckCircle2 className="h-3 w-3" /> Success
    </span>
  );
  if (status === "partial_failed") return (
    <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 font-medium">
      <AlertTriangle className="h-3 w-3" /> Partial
    </span>
  );
  if (status === "failed") return (
    <span className="inline-flex items-center gap-1 text-xs text-destructive font-medium">
      <XCircle className="h-3 w-3" /> Failed
    </span>
  );
  if (status === "running") return (
    <span className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 font-medium">
      <Loader2 className="h-3 w-3 animate-spin" /> Running
    </span>
  );
  if (status === "skipped") return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground font-medium">
      <Info className="h-3 w-3" /> Skipped
    </span>
  );
  return <span className="text-xs text-muted-foreground">{status}</span>;
}

function ChannelLine({ icon, label, attempted, success, error, attempts }: {
  icon: ReactNode; label: string; attempted?: boolean;
  success?: boolean; error?: string; attempts?: number;
}) {
  if (!attempted) return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="shrink-0">{icon}</span>
      <span className="font-medium">{label}:</span><span>not attempted</span>
    </div>
  );
  if (success) return (
    <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
      <CheckCircle2 className="h-3 w-3 shrink-0" />
      <span className="font-medium">{label}:</span>
      <span>sent{attempts && attempts > 1 ? ` (attempt ${attempts})` : ""}</span>
    </div>
  );
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1.5 text-xs text-destructive">
        <XCircle className="h-3 w-3 shrink-0" />
        <span className="font-medium">{label}:</span>
        <span>failed{attempts && attempts > 1 ? ` after ${attempts} attempt(s)` : ""}</span>
      </div>
      {error && <p className="text-xs text-muted-foreground pl-5 break-words">{error}</p>}
    </div>
  );
}

function RunRow({ run }: { run: BackupRun }) {
  const [open, setOpen] = useState(false);
  const isRunning = run.status === "running";
  const isStuck = isRunning && run.startedAt
    ? (Date.now() - new Date(run.startedAt).getTime()) > 5 * 60 * 1000
    : false;

  return (
    <div className="border rounded-md" data-testid={`run-row-${run.id}`}>
      <button
        className="w-full flex items-center gap-3 p-3 text-left hover-elevate"
        onClick={() => setOpen(v => !v)}
      >
        <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium shrink-0 ${runTypeBadgeClass(run.runType)}`}>
          {runTypeLabel(run.runType)}
        </span>
        <RunStatusBadge status={run.status} />
        <span className="text-xs text-muted-foreground ml-auto shrink-0">{fmtTime(run.startedAt)}</span>
        {(run.zipSizeBytes || run.companyFilesCount != null) && (
          <span className="text-xs text-muted-foreground hidden sm:block shrink-0">
            {run.companyFilesCount != null ? `${run.companyFilesCount} co.` : ""}
            {run.zipSizeBytes ? ` · ${fmtBytes(run.zipSizeBytes)}` : ""}
          </span>
        )}
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
      </button>

      {open && (
        <div className="border-t px-3 pb-3 pt-2 space-y-2">
          {(run.zipSizeBytes || run.companyFilesCount != null || run.finishedAt) && (
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
              {run.zipSizeBytes ? <span>ZIP: {fmtBytes(run.zipSizeBytes)}</span> : null}
              {run.companyFilesCount != null
                ? <span>{run.companyFilesCount} compan{run.companyFilesCount === 1 ? "y" : "ies"}{run.skippedCompanies ? ` (${run.skippedCompanies.split(",").filter(Boolean).length} skipped)` : ""}</span>
                : null}
              {run.finishedAt && !isRunning ? <span>Finished: {fmtTime(run.finishedAt)}</span> : null}
            </div>
          )}
          <div className="space-y-1.5">
            <ChannelLine icon={<Mail className="h-3 w-3" />} label="Email"
              attempted={run.emailAttempted} success={run.emailSuccess}
              error={run.emailError} attempts={run.emailAttempts} />
            <ChannelLine icon={<MessageSquare className="h-3 w-3" />} label="WhatsApp"
              attempted={run.whatsappAttempted} success={run.whatsappSuccess}
              error={run.whatsappError} attempts={run.whatsappAttempts} />
          </div>
          {run.skippedReason && (
            <p className="text-xs text-muted-foreground">{run.skippedReason}</p>
          )}
          {isStuck && (
            <div className="flex items-start gap-1.5 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-2.5 py-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <p className="text-xs text-amber-800 dark:text-amber-300">
                Stalled for over 5 minutes. Dismiss if needed.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StepIcon({ type }: { type: JobStep["type"] }) {
  if (type === "success") return <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />;
  if (type === "error")   return <XCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />;
  if (type === "warning") return <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />;
  return <Info className="h-3.5 w-3.5 text-blue-500 shrink-0 mt-0.5" />;
}

function ExportProgressDialog({ jobId, mode, open, onClose }: {
  jobId: string; mode: "download" | "email"; open: boolean; onClose: () => void;
}) {
  const [job, setJob] = useState<JobStatus | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!open || !jobId) return;
    setJob(null);
    setDownloaded(false);
    const poll = async () => {
      try {
        const data = await apiRequest("GET", `/api/export/job/${jobId}`) as JobStatus;
        setJob(data);
        if (data.status !== "running" && intervalRef.current) clearInterval(intervalRef.current);
      } catch { /* ignore */ }
    };
    poll();
    intervalRef.current = setInterval(poll, 600);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [open, jobId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [job?.steps.length]);

  useEffect(() => {
    if (mode === "download" && job?.status === "done" && job.hasZip && !downloaded) {
      setDownloaded(true);
      const dateLabel = new Date().toISOString().substring(0, 10);
      const a = document.createElement("a");
      a.href = `/api/export/download/${jobId}`;
      a.download = `DailyExport_${dateLabel}.zip`;
      a.click();
    }
  }, [job?.status, job?.hasZip, downloaded, jobId, mode]);

  const isDone = job?.status === "done";
  const isError = job?.status === "error";
  const isRunning = !job || job.status === "running";

  return (
    <Dialog open={open} onOpenChange={v => { if (!v && !isRunning) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isRunning && <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
            {isDone && <CheckCircle2 className="h-4 w-4 text-green-500" />}
            {isError && <XCircle className="h-4 w-4 text-destructive" />}
            {isRunning ? "Exporting..." : isDone ? "Export Succeeded" : "Export Failed"}
          </DialogTitle>
        </DialogHeader>
        <div ref={scrollRef}
          className="bg-muted/50 rounded-md border p-3 h-72 overflow-y-auto font-mono text-xs space-y-1.5"
          data-testid="export-progress-log">
          {(!job || job.steps.length === 0) && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
              <span>Initialising export job...</span>
            </div>
          )}
          {job?.steps.map((step, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <StepIcon type={step.type} />
              <span className="text-muted-foreground shrink-0">{step.time}</span>
              <span className={
                step.type === "success" ? "text-green-600 dark:text-green-400" :
                step.type === "error" ? "text-destructive" :
                step.type === "warning" ? "text-amber-600" : "text-foreground"
              }>{step.message}</span>
            </div>
          ))}
          {isRunning && job && job.steps.length > 0 && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin shrink-0" /><span>Working...</span>
            </div>
          )}
        </div>
        {isDone && mode === "download" && (
          <Alert className="border-green-200 bg-green-50 dark:bg-green-950/20">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-700 dark:text-green-300">
              Export complete — your ZIP file is downloading now.
            </AlertDescription>
          </Alert>
        )}
        {isDone && mode === "email" && (
          <Alert className="border-green-200 bg-green-50 dark:bg-green-950/20">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-700 dark:text-green-300">
              Export emailed successfully to all recipients.
            </AlertDescription>
          </Alert>
        )}
        {isError && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertDescription>{job?.error || "An unexpected error occurred."}</AlertDescription>
          </Alert>
        )}
        <div className="flex justify-end">
          <Button variant={isDone || isError ? "default" : "outline"}
            onClick={onClose} disabled={isRunning} data-testid="button-close-progress">
            {isRunning ? "Please wait..." : "Close"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Readiness check item ─────────────────────────────────────────────────────

function ReadinessItem({ ok, warn, label }: { ok: boolean; warn?: boolean; label: string }) {
  const icon = ok
    ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600 dark:text-green-400 shrink-0" />
    : warn
      ? <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
      : <XCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
  return (
    <div className="flex items-center gap-1.5 text-xs">
      {icon}
      <span className={ok ? "text-foreground" : warn ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}>
        {label}
      </span>
    </div>
  );
}

// ── Status badge helper ──────────────────────────────────────────────────────

function StatusBadge({ active, needsSetup }: { active: boolean; needsSetup: boolean }) {
  if (active) return <Badge className="bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 border-0">Active</Badge>;
  if (needsSetup) return <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-0">Needs Setup</Badge>;
  return <Badge variant="secondary">Disabled</Badge>;
}

// ── Main Export Center ───────────────────────────────────────────────────────

export function ExportCenter() {
  const { toast } = useToast();
  const qc = useQueryClient();

  // Daily export local state
  const [newEmail, setNewEmail] = useState("");
  const [gmailUser, setGmailUser] = useState("");
  const [gmailPassword, setGmailPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [savingGmail, setSavingGmail] = useState(false);
  const [sendingWa, setSendingWa] = useState(false);

  // Progress dialog
  const [progressOpen, setProgressOpen] = useState(false);
  const [activeJobId, setActiveJobId] = useState("");
  const [activeMode, setActiveMode] = useState<"download" | "email">("download");

  // NP export local state
  const { start: npDefaultStart, end: npDefaultEnd } = currentYearDateRange();
  const [npStart, setNpStart] = useState(npDefaultStart);
  const [npEnd, setNpEnd] = useState(npDefaultEnd);
  const [npRecipientId, setNpRecipientId] = useState<number | null | undefined>(undefined);
  const [npFrequency, setNpFrequency] = useState<string | null>(null);
  const [npSendHour, setNpSendHour] = useState<number | null>(null);
  const [npSendDayOfWeek, setNpSendDayOfWeek] = useState<number | null>(null);

  // UI collapse state
  const [showCompanies, setShowCompanies] = useState(false);
  const [showRecipients, setShowRecipients] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showHistory, setShowHistory] = useState(true);
  const [dismissing, setDismissing] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<string>("all");

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: emailRecipients = [] } = useQuery<Recipient[]>({
    queryKey: ["/api/export/recipients"],
  });
  const { data: exportSettings } = useQuery<ExportSettings>({
    queryKey: ["/api/export/settings"],
  });
  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ["/api/export/companies"],
  });
  const { data: backupStatus, isFetching: backupFetching, refetch: refetchBackup } = useQuery<BackupStatus>({
    queryKey: ["/api/export/backup-status"],
    refetchInterval: 15000,
  });
  const { data: waSettings } = useQuery<WaSettings>({
    queryKey: ["/api/whatsapp/settings"],
  });
  const { data: waRecipients = [] } = useQuery<WaRecipient[]>({
    queryKey: ["/api/whatsapp/recipients"],
  });
  const { data: npSettings } = useQuery<NpSettings>({
    queryKey: ["/api/whatsapp/np-settings"],
  });

  // ── Computed values ──────────────────────────────────────────────────────

  const waGroups = waRecipients.filter(r => r.isGroup && r.active);
  const dailyWaGroup = waRecipients.find(r => r.id === waSettings?.dailyRecipientId);
  const npWaGroup = waRecipients.find(r => r.id === (npRecipientId !== undefined ? npRecipientId : npSettings?.recipientId));
  const waReady = !!(waSettings?.enabled && waSettings?.dailyRecipientId);
  const emailReady = emailRecipients.length > 0 && !!exportSettings?.gmailUser;

  const npEff = {
    recipientId: npRecipientId !== undefined ? npRecipientId : (npSettings?.recipientId ?? null),
    frequency: npFrequency ?? (npSettings?.frequency ?? "daily"),
    sendHour: npSendHour ?? (npSettings?.sendHour ?? 18),
    sendDayOfWeek: npSendDayOfWeek ?? (npSettings?.sendDayOfWeek ?? 1),
  };

  const buildNpPayload = (overrides?: Partial<NpSettings>) => ({
    recipientId: npEff.recipientId,
    frequency: npEff.frequency,
    sendHour: npEff.sendHour,
    sendDayOfWeek: npEff.sendDayOfWeek,
    enabled: npSettings?.enabled ?? false,
    autoSend: npSettings?.autoSend ?? false,
    ...overrides,
  });

  const npScheduleText = scheduleLabel(npSettings);

  // History filter
  const filteredRuns = (backupStatus?.recentRuns ?? []).filter(r => {
    if (historyFilter === "all") return true;
    if (historyFilter === "success") return r.status === "success";
    if (historyFilter === "failed") return r.status === "failed" || r.status === "partial_failed";
    if (historyFilter === "running") return r.status === "running";
    return true;
  });

  const stuckRuns = (backupStatus?.recentRuns ?? []).filter(
    r => r.status === "running" && (Date.now() - new Date(r.startedAt).getTime()) > 5 * 60 * 1000
  );
  const hasRunning = (backupStatus?.recentRuns ?? []).some(r => r.status === "running");

  // ── Mutations ────────────────────────────────────────────────────────────

  const addEmailRecipient = useMutation({
    mutationFn: (email: string) => apiRequest("POST", "/api/export/recipients", { email }),
    onSuccess: () => { setNewEmail(""); qc.invalidateQueries({ queryKey: ["/api/export/recipients"] }); toast({ title: "Recipient added" }); },
    onError: (e: any) => toast({ variant: "destructive", title: "Error", description: e.message }),
  });

  const removeEmailRecipient = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/export/recipients/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/export/recipients"] }); toast({ title: "Recipient removed" }); },
  });

  const toggleSchedule = async (enabled: boolean) => {
    try {
      await apiRequest("PUT", "/api/export/settings", { scheduleEnabled: enabled, gmailUser: exportSettings?.gmailUser });
      qc.invalidateQueries({ queryKey: ["/api/export/settings"] });
      toast({ title: enabled ? "Schedule enabled — runs daily at 6:00 PM EST" : "Schedule disabled" });
    } catch (e: any) { toast({ variant: "destructive", title: "Error", description: e.message }); }
  };

  const saveGmail = async () => {
    setSavingGmail(true);
    try {
      const body: any = { scheduleEnabled: exportSettings?.scheduleEnabled ?? false };
      if (gmailUser) body.gmailUser = gmailUser;
      if (gmailPassword) body.gmailAppPassword = gmailPassword;
      await apiRequest("PUT", "/api/export/settings", body);
      qc.invalidateQueries({ queryKey: ["/api/export/settings"] });
      setGmailUser(""); setGmailPassword("");
      toast({ title: "Gmail credentials saved" });
    } catch (e: any) { toast({ variant: "destructive", title: "Error", description: e.message }); }
    finally { setSavingGmail(false); }
  };

  const startExport = async (mode: "download" | "email") => {
    try {
      const body: any = { mode };
      if (fromDate) body.fromDate = fromDate;
      if (toDate) body.toDate = toDate;
      const result = await apiRequest("POST", "/api/export/start", body) as any;
      setActiveJobId(result.jobId);
      setActiveMode(mode);
      setProgressOpen(true);
    } catch (e: any) { toast({ variant: "destructive", title: "Could not start export", description: e.message }); }
  };

  const sendViaWhatsApp = async () => {
    setSendingWa(true);
    try {
      const body: any = {};
      if (fromDate) body.fromDate = fromDate;
      if (toDate) body.toDate = toDate;
      const data = await apiRequest("POST", "/api/daily-export/trigger-whatsapp", body) as any;
      toast({ title: "WhatsApp export started", description: data.message || "Building ZIP and sending…" });
      [5, 20, 45, 75, 120].forEach(s => setTimeout(() => refetchBackup(), s * 1000));
    } catch (e: any) { toast({ variant: "destructive", title: "WhatsApp send failed", description: e.message }); }
    finally { setSendingWa(false); refetchBackup(); }
  };

  const patchWaSettings = useMutation({
    mutationFn: (patch: Partial<{ dailyAutoSend: boolean; dailyRecipientId: number | null }>) =>
      apiRequest("PUT", "/api/whatsapp/settings", patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/whatsapp/settings"] }),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const npSaveSettings = useMutation({
    mutationFn: () => apiRequest("PUT", "/api/whatsapp/np-settings", buildNpPayload()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/whatsapp/np-settings"] }); toast({ title: "Settings saved" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const npToggleEnabled = useMutation({
    mutationFn: (value: boolean) => apiRequest("PUT", "/api/whatsapp/np-settings", buildNpPayload({ enabled: value })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/whatsapp/np-settings"] }),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const npToggleAutoSend = useMutation({
    mutationFn: (value: boolean) => apiRequest("PUT", "/api/whatsapp/np-settings", buildNpPayload({ autoSend: value })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/whatsapp/np-settings"] }),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const npSendNow = useMutation({
    mutationFn: () => apiRequest("POST", "/api/whatsapp/send-np-all-now", { recipientId: npEff.recipientId }),
    onSuccess: (data: any) => toast({ title: "Net Position Export Sent", description: data?.message || "Done" }),
    onError: (e: any) => toast({ title: "Send failed", description: e.message, variant: "destructive" }),
  });

  const downloadNpExcel = () => {
    window.open(`/api/reports/net-position-monthly-excel?startDate=${npStart}&endDate=${npEnd}`, "_blank");
  };

  const dismissStuck = async () => {
    setDismissing(true);
    try {
      const data = await apiRequest("POST", "/api/export/cleanup-stuck-runs") as any;
      toast({
        title: data.cleared > 0 ? `Dismissed ${data.cleared} stalled run${data.cleared === 1 ? "" : "s"}` : "No stalled runs found",
        description: data.cleared > 0 ? "They are now marked as failed." : undefined,
      });
      refetchBackup();
    } catch (e: any) { toast({ variant: "destructive", title: "Dismiss failed", description: e.message }); }
    finally { setDismissing(false); }
  };

  // ── Readiness flags ──────────────────────────────────────────────────────
  const r = backupStatus?.readiness;
  const dailyActive = !!(exportSettings?.scheduleEnabled && exportSettings?.gmailUser && emailRecipients.length > 0);
  const dailyNeedsSetup = !exportSettings?.gmailUser || emailRecipients.length === 0;
  const npActive = !!(npSettings?.enabled && npSettings?.autoSend);
  const npNeedsSetup = !npSettings?.recipientId;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6" data-testid="section-export-center">

      {/* ── Page header ───────────────────────────────────────────────── */}
      <div>
        <h2 className="text-2xl font-semibold flex items-center gap-2">
          <Zap className="h-5 w-5" />
          Export Center
        </h2>
        <p className="text-muted-foreground text-sm mt-1">
          Manage daily exports, net position exports, recipients, schedules, and export history.
        </p>
      </div>

      {/* ── Issues banner ─────────────────────────────────────────────── */}
      {backupStatus && backupStatus.issues.length > 0 && (
        <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-1">
          <p className="text-xs font-medium text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" />
            {backupStatus.issues.length} issue{backupStatus.issues.length === 1 ? "" : "s"} blocking automatic send
          </p>
          <ul className="space-y-0.5">
            {backupStatus.issues.map((issue, i) => (
              <li key={i} className="text-xs text-amber-800 dark:text-amber-300 flex items-start gap-1.5">
                <span className="shrink-0 mt-0.5">•</span>{issue}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Main tabs ─────────────────────────────────────────────────── */}
      <Tabs defaultValue="daily" data-testid="tabs-export-center">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="daily" data-testid="tab-daily-export">Daily Export</TabsTrigger>
          <TabsTrigger value="np" data-testid="tab-np-export">Net Position Export</TabsTrigger>
        </TabsList>

        {/* ══════════════════════════════════════════════════════════════
            DAILY EXPORT TAB
        ══════════════════════════════════════════════════════════════ */}
        <TabsContent value="daily" className="space-y-4 mt-4">

          {/* Status summary card */}
          <Card data-testid="card-daily-status">
            <CardContent className="pt-4 pb-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1.5 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold">Daily Full Company Export</p>
                    <StatusBadge active={dailyActive} needsSetup={dailyNeedsSetup} />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <Clock className="h-3 w-3 shrink-0" />
                      Schedule: {exportSettings?.scheduleEnabled ? "Daily at 6:00 PM EST" : "Disabled"}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <CheckCircle2 className="h-3 w-3 shrink-0" />
                      Last run: {fmtTime(exportSettings?.lastRunAt)}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Mail className="h-3 w-3 shrink-0" />
                      Email recipients: {emailRecipients.length}
                      {!exportSettings?.gmailUser && <span className="text-amber-600 ml-1">(no Gmail)</span>}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <MessageSquare className="h-3 w-3 shrink-0" />
                      WhatsApp: {dailyWaGroup ? dailyWaGroup.name : <span className="text-amber-600">Not configured</span>}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Building2 className="h-3 w-3 shrink-0" />
                      Companies: {companies.length}
                    </span>
                    {backupStatus?.recentRuns[0] && (
                      <span className="flex items-center gap-1.5">
                        <ShieldCheck className="h-3 w-3 shrink-0" />
                        Latest: <RunStatusBadge status={backupStatus.recentRuns[0].status} />
                      </span>
                    )}
                  </div>
                </div>
                {/* Actions dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button data-testid="button-daily-actions">
                      Actions <ChevronDown className="h-4 w-4 ml-1.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem onClick={() => startExport("download")} data-testid="menu-daily-download">
                      <Download className="h-4 w-4 mr-2" /> Download Now
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => startExport("email")}
                      disabled={!emailReady}
                      data-testid="menu-daily-email">
                      <Mail className="h-4 w-4 mr-2" /> Email Now
                      {!emailReady && <span className="ml-auto text-xs text-muted-foreground">({!exportSettings?.gmailUser ? "no Gmail" : "no recipients"})</span>}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={sendViaWhatsApp}
                      disabled={!waReady || sendingWa}
                      data-testid="menu-daily-whatsapp">
                      <MessageSquare className="h-4 w-4 mr-2 text-green-600" />
                      {sendingWa ? "Sending…" : "Send WhatsApp Now"}
                      {!waReady && <span className="ml-auto text-xs text-muted-foreground">(needs setup)</span>}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => refetchBackup()} data-testid="menu-daily-refresh">
                      <RefreshCw className="h-4 w-4 mr-2" /> Refresh Status
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </CardContent>
          </Card>

          {/* Date range card */}
          <Card data-testid="card-daily-date-range">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Calendar className="h-4 w-4" /> Date Range
              </CardTitle>
              <CardDescription className="text-xs">Leave blank to export full history.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">From Date</Label>
                  <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                    className="w-40" data-testid="input-export-from-date" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">To Date</Label>
                  <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
                    className="w-40" data-testid="input-export-to-date" />
                </div>
                {(fromDate || toDate) && (
                  <Button variant="ghost" size="sm" onClick={() => { setFromDate(""); setToDate(""); }}>
                    Clear (full history)
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Schedule card */}
          <Card data-testid="card-daily-schedule">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Clock className="h-4 w-4" /> Schedule
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Enable daily schedule</p>
                  <p className="text-xs text-muted-foreground">Runs at 6:00 PM Eastern Time, emails the export to all recipients</p>
                </div>
                <Switch checked={exportSettings?.scheduleEnabled ?? false}
                  onCheckedChange={toggleSchedule} data-testid="switch-schedule-enabled" />
              </div>
              {exportSettings?.lastRunAt && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CheckCircle2 className="h-3 w-3 text-green-600" />
                  Last run: {fmtTime(exportSettings.lastRunAt)}
                </div>
              )}
              {exportSettings?.gmailUser && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Mail className="h-3 w-3" />
                  Gmail sender: <span className="font-medium text-foreground">{exportSettings.gmailUser}</span>
                </div>
              )}
              {exportSettings?.scheduleEnabled && !exportSettings?.gmailUser && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>Schedule is enabled but Gmail credentials are not configured.</AlertDescription>
                </Alert>
              )}
              {exportSettings?.scheduleEnabled && emailRecipients.length === 0 && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>Schedule is enabled but no email recipients are configured.</AlertDescription>
                </Alert>
              )}

              <Separator />

              {/* WhatsApp auto-send */}
              <div className="space-y-3">
                <p className="text-sm font-medium flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-green-600" /> WhatsApp Auto-Send
                </p>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm">Enable daily auto-send (6 PM EST)</p>
                    <p className="text-xs text-muted-foreground">Send the daily ZIP to a WhatsApp group every day</p>
                  </div>
                  <Switch
                    data-testid="switch-daily-autosend"
                    checked={waSettings?.dailyAutoSend ?? false}
                    onCheckedChange={v => patchWaSettings.mutate({ dailyAutoSend: v })}
                    disabled={!waSettings?.enabled || patchWaSettings.isPending}
                  />
                </div>
                {!waSettings?.hasCredentials && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    WhatsApp credentials not configured — see Advanced Settings below.
                  </p>
                )}
                {waSettings?.hasCredentials && !waSettings?.enabled && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    WhatsApp sending is disabled — enable it in Advanced Settings.
                  </p>
                )}
                <div className="space-y-1.5">
                  <Label className="text-xs">Daily Export WhatsApp Group</Label>
                  {waGroups.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">No group recipients added yet — add one in the Recipients section below.</p>
                  ) : (
                    <Select
                      value={String(waSettings?.dailyRecipientId ?? "")}
                      onValueChange={v => patchWaSettings.mutate({ dailyRecipientId: v ? parseInt(v) : null })}
                      disabled={!waSettings?.enabled || patchWaSettings.isPending}
                    >
                      <SelectTrigger data-testid="select-daily-autosend-group" className="w-full sm:w-80">
                        <SelectValue placeholder="Pick a group…" />
                      </SelectTrigger>
                      <SelectContent>
                        {waGroups.map(r => (
                          <SelectItem key={r.id} value={String(r.id)} data-testid={`option-daily-group-${r.id}`}>
                            <div className="flex items-center gap-2"><Users className="h-3.5 w-3.5" />{r.name}</div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Companies (collapsible) */}
          <div className="border rounded-md" data-testid="card-daily-companies">
            <button
              className="w-full flex items-center justify-between p-4 text-left hover-elevate"
              onClick={() => setShowCompanies(v => !v)}
              data-testid="button-toggle-companies"
            >
              <span className="font-medium flex items-center gap-2 text-sm">
                <Building2 className="h-4 w-4" />
                Companies Included ({companies.length})
              </span>
              {showCompanies ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            </button>
            {showCompanies && (
              <div className="border-t p-4">
                {companies.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No companies found.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {companies.map(c => (
                      <Badge key={c.id} variant="secondary" data-testid={`badge-company-${c.id}`}>{c.name}</Badge>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* History */}
          <div className="border rounded-md" data-testid="card-daily-history">
            <div className="flex items-center justify-between p-4">
              <button
                className="flex items-center gap-2 text-sm font-medium"
                onClick={() => setShowHistory(v => !v)}
                data-testid="button-toggle-history"
              >
                {stuckRuns.length > 0
                  ? <AlertTriangle className="h-4 w-4 text-amber-500" />
                  : hasRunning
                    ? <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                    : (backupStatus?.recentRuns[0]?.status === "success")
                      ? <ShieldCheck className="h-4 w-4 text-green-600" />
                      : <ShieldAlert className="h-4 w-4 text-muted-foreground" />}
                Export History
                {showHistory ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground ml-1" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground ml-1" />}
              </button>
              <div className="flex items-center gap-1">
                {stuckRuns.length > 0 && (
                  <Button size="sm" variant="outline" onClick={dismissStuck} disabled={dismissing}
                    data-testid="button-dismiss-stuck-runs" className="text-xs">
                    {dismissing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <XCircle className="h-3 w-3 mr-1" />}
                    Dismiss stalled
                  </Button>
                )}
                <Button size="icon" variant="ghost" onClick={() => refetchBackup()} disabled={backupFetching}
                  data-testid="button-refresh-backup-status">
                  <RefreshCw className={`h-4 w-4 ${backupFetching ? "animate-spin" : ""}`} />
                </Button>
              </div>
            </div>

            {showHistory && (
              <div className="border-t p-4 space-y-3">
                {/* Filter pills */}
                {(backupStatus?.recentRuns ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {["all", "success", "failed", "running"].map(f => (
                      <button
                        key={f}
                        onClick={() => setHistoryFilter(f)}
                        className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${historyFilter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover-elevate"}`}
                        data-testid={`filter-history-${f}`}
                      >
                        {f.charAt(0).toUpperCase() + f.slice(1)}
                      </button>
                    ))}
                  </div>
                )}

                {filteredRuns.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {(backupStatus?.recentRuns ?? []).length === 0
                      ? "No backup runs recorded yet. Trigger a manual send or wait for the 6 PM scheduled run."
                      : "No runs match this filter."}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {filteredRuns.map(run => <RunRow key={run.id} run={run} />)}
                  </div>
                )}
              </div>
            )}
          </div>

        </TabsContent>

        {/* ══════════════════════════════════════════════════════════════
            NET POSITION EXPORT TAB
        ══════════════════════════════════════════════════════════════ */}
        <TabsContent value="np" className="space-y-4 mt-4">

          {/* Status summary card */}
          <Card data-testid="card-np-status">
            <CardContent className="pt-4 pb-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1.5 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold">Net Position Export</p>
                    <StatusBadge active={npActive} needsSetup={npNeedsSetup} />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <Calendar className="h-3 w-3 shrink-0" />
                      Range: Jan 1, {new Date().getFullYear()} → today
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Clock className="h-3 w-3 shrink-0" />
                      Schedule: {npScheduleText || "Not configured"}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <CheckCircle2 className="h-3 w-3 shrink-0" />
                      Last sent: {fmtTime(npSettings?.lastSentAt)}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Users className="h-3 w-3 shrink-0" />
                      WhatsApp group: {npWaGroup ? npWaGroup.name : <span className="text-amber-600">Not selected</span>}
                    </span>
                  </div>
                </div>
                {/* Actions dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button data-testid="button-np-actions">
                      Actions <ChevronDown className="h-4 w-4 ml-1.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem
                      onClick={() => npSendNow.mutate()}
                      disabled={npSendNow.isPending}
                      data-testid="menu-np-send-now">
                      <Send className="h-4 w-4 mr-2" />
                      {npSendNow.isPending ? "Sending…" : "Send Now"}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={downloadNpExcel} data-testid="menu-np-download">
                      <Download className="h-4 w-4 mr-2" /> Download Excel
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { qc.invalidateQueries({ queryKey: ["/api/whatsapp/np-settings"] }); }} data-testid="menu-np-refresh">
                      <RefreshCw className="h-4 w-4 mr-2" /> Refresh Status
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </CardContent>
          </Card>

          {/* Date range note */}
          <div className="flex items-center gap-2 rounded-md bg-muted/40 border px-3 py-2">
            <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Date range: </span>
              Jan 1, {new Date().getFullYear()} → today ({npDefaultEnd}). Every send covers from the start of the current year up to the run date.
            </p>
          </div>

          {/* Settings card */}
          <Card data-testid="card-np-settings">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Settings2 className="h-4 w-4" /> Schedule Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">

              {/* WhatsApp group */}
              <div className="space-y-1.5">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <Users className="h-4 w-4" /> WhatsApp Group
                </Label>
                <p className="text-xs text-muted-foreground">A ZIP with one net position Excel per company will be sent to this group.</p>
                {waGroups.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No active group recipients — add one in the Recipients section below.</p>
                ) : (
                  <Select
                    value={String(npEff.recipientId ?? "")}
                    onValueChange={v => setNpRecipientId(v ? parseInt(v) : null)}
                  >
                    <SelectTrigger data-testid="select-np-group" className="w-full sm:w-80">
                      <SelectValue placeholder="Pick a group…" />
                    </SelectTrigger>
                    <SelectContent>
                      {waGroups.map(r => (
                        <SelectItem key={r.id} value={String(r.id)} data-testid={`option-np-group-${r.id}`}>
                          <div className="flex items-center gap-2"><Users className="h-3.5 w-3.5" />{r.name}</div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <Separator />

              {/* Frequency + time */}
              <div className="space-y-3">
                <p className="text-sm font-medium flex items-center gap-2">
                  <Clock className="h-4 w-4" /> Send Schedule
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Frequency</Label>
                    <Select value={npEff.frequency} onValueChange={v => setNpFrequency(v)}>
                      <SelectTrigger data-testid="select-np-frequency"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="daily">Daily</SelectItem>
                        <SelectItem value="weekly">Weekly</SelectItem>
                        <SelectItem value="monthly">Monthly (1st of month)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Send Time (EST)</Label>
                    <Select value={String(npEff.sendHour)} onValueChange={v => setNpSendHour(parseInt(v))}>
                      <SelectTrigger data-testid="select-np-hour"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {HOURS.map(h => <SelectItem key={h.value} value={h.value}>{h.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  {npEff.frequency === "weekly" && (
                    <div className="space-y-1">
                      <Label className="text-xs flex items-center gap-1"><Calendar className="h-3 w-3" />Day of Week</Label>
                      <Select value={String(npEff.sendDayOfWeek)} onValueChange={v => setNpSendDayOfWeek(parseInt(v))}>
                        <SelectTrigger data-testid="select-np-day"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {DAYS.map(d => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              </div>

              <Separator />

              {/* Enable toggles */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Enable</p>
                    <p className="text-xs text-muted-foreground">Activate this export schedule</p>
                  </div>
                  <Switch data-testid="switch-np-enabled"
                    checked={npSettings?.enabled ?? false}
                    onCheckedChange={v => npToggleEnabled.mutate(v)}
                    disabled={npToggleEnabled.isPending} />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Auto-Send</p>
                    <p className="text-xs text-muted-foreground">Run automatically on the configured schedule</p>
                  </div>
                  <Switch data-testid="switch-np-autosend"
                    checked={npSettings?.autoSend ?? false}
                    onCheckedChange={v => npToggleAutoSend.mutate(v)}
                    disabled={!(npSettings?.enabled) || npToggleAutoSend.isPending} />
                </div>
              </div>

              {npSettings?.lastSentAt && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CheckCircle2 className="h-3 w-3 text-green-600" />
                  Last sent: {fmtTime(npSettings.lastSentAt)}
                </div>
              )}

              <div className="flex gap-2 flex-wrap">
                <Button onClick={() => npSaveSettings.mutate()} disabled={npSaveSettings.isPending}
                  data-testid="button-np-save">
                  {npSaveSettings.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : "Save Settings"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                "Send Now" (via the Actions menu) immediately sends the ZIP ({npDefaultStart} → {npDefaultEnd}) to the selected WhatsApp group. The scheduler checks every hour and sends automatically when the time matches.
              </p>
            </CardContent>
          </Card>

        </TabsContent>
      </Tabs>

      {/* ── Recipients (collapsible) ───────────────────────────────────── */}
      <div className="border rounded-md" data-testid="section-recipients">
        <button
          className="w-full flex items-center justify-between p-4 text-left hover-elevate"
          onClick={() => setShowRecipients(v => !v)}
          data-testid="button-toggle-recipients"
        >
          <span className="font-medium flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Recipients
            <Badge variant="secondary" className="ml-1">{emailRecipients.length} email · {waGroups.length} WA groups</Badge>
          </span>
          {showRecipients ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </button>

        {showRecipients && (
          <div className="border-t p-4 space-y-6">

            {/* Email recipients */}
            <div className="space-y-3">
              <p className="text-sm font-semibold flex items-center gap-2">
                <Mail className="h-4 w-4" /> Email Recipients
              </p>
              <div className="flex gap-2">
                <Input type="email" placeholder="Add email address..."
                  value={newEmail} onChange={e => setNewEmail(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && newEmail) addEmailRecipient.mutate(newEmail); }}
                  data-testid="input-new-recipient" />
                <Button onClick={() => newEmail && addEmailRecipient.mutate(newEmail)}
                  disabled={!newEmail || addEmailRecipient.isPending} data-testid="button-add-recipient">
                  <Plus className="h-4 w-4 mr-1" /> Add
                </Button>
              </div>
              {emailRecipients.length > 0 ? (
                <div className="rounded-md border divide-y">
                  {emailRecipients.map(r => (
                    <div key={r.id} className="flex items-center justify-between gap-2 px-3 py-2"
                      data-testid={`row-recipient-${r.id}`}>
                      <span className="font-mono text-sm truncate">{r.email}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-muted-foreground hidden sm:block">
                          {new Date(r.created_at).toLocaleDateString()}
                        </span>
                        <Button size="icon" variant="ghost"
                          onClick={() => removeEmailRecipient.mutate(r.id)}
                          data-testid={`button-remove-recipient-${r.id}`}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4 border rounded-md">No recipients yet. Add an email address above.</p>
              )}
            </div>

            <Separator />

            {/* WhatsApp recipients summary */}
            <div className="space-y-3">
              <p className="text-sm font-semibold flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-green-600" /> WhatsApp Recipients
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="rounded-md border p-3 space-y-1">
                  <p className="font-medium text-muted-foreground">Daily Export Group</p>
                  {dailyWaGroup
                    ? <p className="flex items-center gap-1.5 font-medium"><CheckCircle2 className="h-3.5 w-3.5 text-green-600" />{dailyWaGroup.name}</p>
                    : <p className="flex items-center gap-1.5 text-amber-600"><AlertTriangle className="h-3.5 w-3.5" />Not configured</p>}
                </div>
                <div className="rounded-md border p-3 space-y-1">
                  <p className="font-medium text-muted-foreground">Net Position Export Group</p>
                  {npWaGroup
                    ? <p className="flex items-center gap-1.5 font-medium"><CheckCircle2 className="h-3.5 w-3.5 text-green-600" />{npWaGroup.name}</p>
                    : <p className="flex items-center gap-1.5 text-amber-600"><AlertTriangle className="h-3.5 w-3.5" />Not configured</p>}
                </div>
              </div>
              {waRecipients.length > 0 && (
                <div className="rounded-md border divide-y">
                  {waRecipients.map(r => (
                    <div key={r.id} className="flex items-center gap-2 px-3 py-2"
                      data-testid={`row-wa-recipient-${r.id}`}>
                      {r.isGroup
                        ? <Users className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                        : <MessageSquare className="h-3.5 w-3.5 shrink-0 text-green-500" />}
                      <span className="text-sm font-medium truncate">{r.name}</span>
                      {r.isGroup && <Badge variant="secondary" className="text-xs shrink-0">Group</Badge>}
                      {r.active
                        ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 ml-auto shrink-0" />
                        : <XCircle className="h-3.5 w-3.5 text-muted-foreground ml-auto shrink-0" />}
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                To add or remove WhatsApp groups and manage credentials, go to the <strong>WhatsApp Export</strong> section in Settings.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Advanced Settings (collapsible) ───────────────────────────── */}
      <div className="border rounded-md" data-testid="section-advanced-settings">
        <button
          className="w-full flex items-center justify-between p-4 text-left hover-elevate"
          onClick={() => setShowAdvanced(v => !v)}
          data-testid="button-toggle-advanced"
        >
          <span className="font-medium flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            Advanced Settings
          </span>
          {showAdvanced ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </button>

        {showAdvanced && (
          <div className="border-t p-4 space-y-5">
            <div className="space-y-1">
              <p className="text-sm font-semibold">Gmail Sender Credentials</p>
              <p className="text-xs text-muted-foreground">
                Use a dedicated Gmail account. Generate an App Password from Google Account → Security → 2-Step Verification → App Passwords.
              </p>
            </div>
            {exportSettings?.gmailUser && (
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span>Currently configured: <span className="font-medium">{exportSettings.gmailUser}</span></span>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Gmail Address</Label>
                <Input type="email" placeholder={exportSettings?.gmailUser || "sender@gmail.com"}
                  value={gmailUser} onChange={e => setGmailUser(e.target.value)}
                  data-testid="input-gmail-user" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">App Password</Label>
                <div className="relative">
                  <Input type={showPassword ? "text" : "password"} placeholder="xxxx xxxx xxxx xxxx"
                    value={gmailPassword} onChange={e => setGmailPassword(e.target.value)}
                    className="pr-10" data-testid="input-gmail-password" />
                  <Button size="icon" variant="ghost" className="absolute right-0 top-0 h-full"
                    onClick={() => setShowPassword(p => !p)} type="button"
                    data-testid="button-toggle-password">
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </div>
            <Button onClick={saveGmail} disabled={savingGmail || (!gmailUser && !gmailPassword)}
              data-testid="button-save-email-settings">
              {savingGmail ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</> : "Save Credentials"}
            </Button>

            <Separator />

            {/* Readiness checklist */}
            <div className="space-y-2">
              <p className="text-sm font-semibold">Readiness Checklist</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                <ReadinessItem ok={!!exportSettings?.gmailUser} warn={!exportSettings?.gmailUser} label="Gmail configured" />
                <ReadinessItem ok={emailRecipients.length > 0} warn={emailRecipients.length === 0} label={`Email recipients (${emailRecipients.length})`} />
                <ReadinessItem ok={!!waSettings?.enabled} warn={!waSettings?.enabled} label="WhatsApp enabled" />
                <ReadinessItem ok={!!waSettings?.dailyRecipientId} warn={!waSettings?.dailyRecipientId} label="Daily export WA group selected" />
                <ReadinessItem ok={!!npSettings?.recipientId} warn={!npSettings?.recipientId} label="Net position WA group selected" />
                <ReadinessItem ok={companies.length > 0} warn={companies.length === 0} label={`Companies found (${companies.length})`} />
                <ReadinessItem ok={!!exportSettings?.scheduleEnabled} label="Daily export schedule enabled" />
                <ReadinessItem ok={!!(npSettings?.enabled && npSettings?.autoSend)} label="Net position auto-send enabled" />
              </div>
            </div>

            <Separator />

            {/* Data coverage note */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">What's included in each Daily Export</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-xs text-muted-foreground">
                {[
                  "Summary overview", "Locations", "Ledger accounts", "Bank accounts", "Fixed assets",
                  "All vouchers", "All voucher entries", "Suppliers + transactions", "Customers + transactions",
                  "Employees + payrolls", "Salary advances", "Factory workers", "Factory payrolls",
                  "Factory attendance", "Factory daybook", "Stock groups + items", "Inventory by location",
                  "Stock transfers + revisions", "Stock adjustments", "Purchase orders + line items",
                  "Containers + charges", "Container offloads", "Bales (sorting)", "Factory bales + products",
                  "Factory containers", "Exchange rates", "POS shifts", "Sales items", "Full audit log",
                ].map(item => (
                  <div key={item} className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-green-600 shrink-0" />{item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Progress dialog */}
      {activeJobId && (
        <ExportProgressDialog
          jobId={activeJobId} mode={activeMode} open={progressOpen}
          onClose={() => { setProgressOpen(false); setActiveJobId(""); refetchBackup(); }}
        />
      )}
    </div>
  );
}
