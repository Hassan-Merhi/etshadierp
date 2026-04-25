import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Download,
  Mail,
  Plus,
  Trash2,
  Building2,
  Calendar,
  ChevronDown,
  Clock,
  Eye,
  EyeOff,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Info,
  MessageSquare,
  Send,
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";

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
  latestRun: BackupRun | null;
  recentRuns: BackupRun[];
  readiness: BackupReadiness;
  issues: string[];
}

function fmtBytes(bytes?: number): string {
  if (!bytes) return "—";
  const mb = bytes / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

function fmtTime(iso?: string): string {
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

function RunStatusBadge({ status }: { status: string }) {
  if (status === "success") return (
    <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400 font-medium">
      <CheckCircle2 className="h-3 w-3" /> Success
    </span>
  );
  if (status === "partial_failed") return (
    <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 font-medium">
      <AlertTriangle className="h-3 w-3" /> Partial success
    </span>
  );
  if (status === "failed") return (
    <span className="inline-flex items-center gap-1 text-xs text-destructive font-medium">
      <XCircle className="h-3 w-3" /> Failed
    </span>
  );
  if (status === "skipped") return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground font-medium">
      <Info className="h-3 w-3" /> Skipped
    </span>
  );
  if (status === "running") return (
    <span className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 font-medium">
      <Loader2 className="h-3 w-3 animate-spin" /> In progress
    </span>
  );
  return <span className="text-xs text-muted-foreground">{status}</span>;
}

function ChannelLine({ icon, label, attempted, success, error, attempts }: {
  icon: React.ReactNode;
  label: string;
  attempted?: boolean;
  success?: boolean;
  error?: string;
  attempts?: number;
}) {
  if (!attempted) return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="shrink-0">{icon}</span>
      <span className="font-medium">{label}:</span>
      <span>not attempted</span>
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
  const isRunning = run.status === "running";
  const isStuck   = isRunning && run.startedAt
    ? (Date.now() - new Date(run.startedAt).getTime()) > 5 * 60 * 1000
    : false;

  return (
    <div
      className="rounded-md border p-3 space-y-2.5"
      data-testid={`run-row-${run.id}`}
    >
      {/* Top: type badge + status + time */}
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${runTypeBadgeClass(run.runType)}`}>
          {runTypeLabel(run.runType)}
        </span>
        <RunStatusBadge status={run.status} />
        <span className="text-xs text-muted-foreground ml-auto">
          {fmtTime(run.startedAt)}
        </span>
      </div>

      {/* Meta: ZIP size + companies */}
      {(run.zipSizeBytes || run.companyFilesCount != null) && (
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
          {run.zipSizeBytes ? <span>ZIP: {fmtBytes(run.zipSizeBytes)}</span> : null}
          {run.companyFilesCount != null
            ? <span>{run.companyFilesCount} compan{run.companyFilesCount === 1 ? "y" : "ies"}{run.skippedCompanies ? ` (${run.skippedCompanies.split(",").filter(Boolean).length} skipped)` : ""}</span>
            : null}
          {run.finishedAt && !isRunning
            ? <span>finished {fmtTime(run.finishedAt)}</span>
            : null}
        </div>
      )}

      {/* Channel results */}
      <div className="space-y-1.5 pl-0.5">
        <ChannelLine
          icon={<Mail className="h-3 w-3" />}
          label="Email"
          attempted={run.emailAttempted}
          success={run.emailSuccess}
          error={run.emailError}
          attempts={run.emailAttempts}
        />
        <ChannelLine
          icon={<MessageSquare className="h-3 w-3" />}
          label="WhatsApp"
          attempted={run.whatsappAttempted}
          success={run.whatsappSuccess}
          error={run.whatsappError}
          attempts={run.whatsappAttempts}
        />
      </div>

      {/* Stuck warning — shown when a run has been "running" for >5 min */}
      {isStuck && (
        <div className="flex items-start gap-1.5 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-2.5 py-1.5">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
          <p className="text-xs text-amber-800 dark:text-amber-300">
            This run has been in progress for over 5 minutes. It may have stalled due to a server restart or network timeout. Refresh to see if it resolves, or try again.
          </p>
        </div>
      )}

      {/* Skip / note */}
      {run.skippedReason && (
        <p className="text-xs text-muted-foreground pl-0.5">{run.skippedReason}</p>
      )}
    </div>
  );
}

function BackupStatusCard({ status, onRefresh, isRefreshing }: {
  status: BackupStatus;
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  const hasAnyRun = status.recentRuns.length > 0;
  const hasRunning = status.recentRuns.some(r => r.status === "running");

  const headerIcon = hasRunning
    ? <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
    : !hasAnyRun
      ? <ShieldAlert className="h-4 w-4 text-muted-foreground" />
      : status.recentRuns[0]?.status === "success"
        ? <ShieldCheck className="h-4 w-4 text-green-600" />
        : status.recentRuns[0]?.status === "partial_failed"
          ? <AlertTriangle className="h-4 w-4 text-amber-500" />
          : status.recentRuns[0]?.status === "failed"
            ? <ShieldAlert className="h-4 w-4 text-destructive" />
            : <ShieldCheck className="h-4 w-4 text-muted-foreground" />;

  return (
    <Card data-testid="card-backup-status">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base flex items-center gap-2">
            {headerIcon}
            Backup Status
          </CardTitle>
          <Button
            size="icon"
            variant="ghost"
            onClick={onRefresh}
            disabled={isRefreshing}
            data-testid="button-refresh-backup-status"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>
        <CardDescription>
          {hasRunning
            ? "A backup is currently in progress..."
            : hasAnyRun
              ? `Last ${status.recentRuns.length} run${status.recentRuns.length === 1 ? "" : "s"} — newest first`
              : "No backup runs recorded yet"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Configuration issues */}
        {status.issues.length > 0 && (
          <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-1">
            <p className="text-xs font-medium text-amber-700 dark:text-amber-400 flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" />
              {status.issues.length === 1 ? "1 issue" : `${status.issues.length} issues`} blocking automatic send
            </p>
            <ul className="space-y-0.5">
              {status.issues.map((issue, i) => (
                <li key={i} className="text-xs text-amber-800 dark:text-amber-300 flex items-start gap-1.5">
                  <span className="shrink-0 mt-0.5">•</span>{issue}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Run history */}
        {hasAnyRun ? (
          <div className="space-y-2">
            {status.recentRuns.map(run => (
              <RunRow key={run.id} run={run} />
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No backup runs recorded yet. Trigger a manual send or wait for the 6 PM scheduled run.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function StepIcon({ type }: { type: JobStep["type"] }) {
  if (type === "success") return <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />;
  if (type === "error") return <XCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />;
  if (type === "warning") return <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />;
  return <Info className="h-3.5 w-3.5 text-blue-500 shrink-0 mt-0.5" />;
}

function ExportProgressDialog({
  jobId,
  mode,
  open,
  onClose,
}: {
  jobId: string;
  mode: "download" | "email";
  open: boolean;
  onClose: () => void;
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
        if (data.status !== "running") {
          if (intervalRef.current) clearInterval(intervalRef.current);
        }
      } catch { /* ignore */ }
    };

    poll();
    intervalRef.current = setInterval(poll, 600);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [open, jobId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [job?.steps.length]);

  // Auto-trigger download once zip is ready
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

        {/* Steps log */}
        <div
          ref={scrollRef}
          className="bg-muted/50 rounded-md border p-3 h-72 overflow-y-auto font-mono text-xs space-y-1.5"
          data-testid="export-progress-log"
        >
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
                step.type === "warning" ? "text-amber-600" :
                "text-foreground"
              }>{step.message}</span>
            </div>
          ))}
          {isRunning && job && job.steps.length > 0 && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin shrink-0" />
              <span>Working...</span>
            </div>
          )}
        </div>

        {/* Status footer */}
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
          <Button
            variant={isDone || isError ? "default" : "outline"}
            onClick={onClose}
            disabled={isRunning}
            data-testid="button-close-progress"
          >
            {isRunning ? "Please wait..." : "Close"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function DailyExportSection() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [newEmail, setNewEmail] = useState("");
  const [gmailUser, setGmailUser] = useState("");
  const [gmailPassword, setGmailPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);

  // Progress dialog state
  const [progressOpen, setProgressOpen] = useState(false);
  const [activeJobId, setActiveJobId] = useState("");
  const [activeMode, setActiveMode] = useState<"download" | "email">("download");

  // Net position manual send
  const npDefaultEnd   = new Date().toLocaleDateString("en-CA");
  const npDefaultStart = (() => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d.toLocaleDateString("en-CA"); })();
  const [npStart, setNpStart] = useState(npDefaultStart);
  const [npEnd,   setNpEnd]   = useState(npDefaultEnd);

  const { data: recipients = [] } = useQuery<Recipient[]>({
    queryKey: ["/api/export/recipients"],
  });

  const { data: settings } = useQuery<ExportSettings>({
    queryKey: ["/api/export/settings"],
  });

  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ["/api/export/companies"],
  });

  const addRecipient = useMutation({
    mutationFn: (email: string) => apiRequest("POST", "/api/export/recipients", { email }),
    onSuccess: () => {
      setNewEmail("");
      qc.invalidateQueries({ queryKey: ["/api/export/recipients"] });
      toast({ title: "Recipient added" });
    },
    onError: (e: any) => toast({ variant: "destructive", title: "Error", description: e.message }),
  });

  const removeRecipient = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/export/recipients/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/export/recipients"] });
      toast({ title: "Recipient removed" });
    },
  });

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      const body: any = { scheduleEnabled: settings?.scheduleEnabled ?? false };
      if (gmailUser) body.gmailUser = gmailUser;
      if (gmailPassword) body.gmailAppPassword = gmailPassword;
      await apiRequest("PUT", "/api/export/settings", body);
      qc.invalidateQueries({ queryKey: ["/api/export/settings"] });
      setGmailUser("");
      setGmailPassword("");
      toast({ title: "Settings saved" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    } finally {
      setSavingSettings(false);
    }
  };

  const toggleSchedule = async (enabled: boolean) => {
    try {
      await apiRequest("PUT", "/api/export/settings", {
        scheduleEnabled: enabled,
        gmailUser: settings?.gmailUser,
      });
      qc.invalidateQueries({ queryKey: ["/api/export/settings"] });
      toast({ title: enabled ? "Schedule enabled — runs daily at 6:00 PM EST" : "Schedule disabled" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    }
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
    } catch (e: any) {
      toast({ variant: "destructive", title: "Could not start export", description: e.message });
    }
  };

  const { data: waSettings } = useQuery<{ enabled: boolean; dailyAutoSend: boolean; dailyRecipientId: number | null; hasCredentials: boolean }>({
    queryKey: ["/api/whatsapp/settings"],
  });
  const waReady = !!(waSettings?.enabled && waSettings?.dailyRecipientId);

  const { data: backupStatus, isFetching: backupFetching, refetch: refetchBackup } = useQuery<BackupStatus>({
    queryKey: ["/api/export/backup-status"],
    refetchInterval: 15000,
  });

  const [sendingWa, setSendingWa] = useState(false);
  const sendViaWhatsApp = async () => {
    setSendingWa(true);
    try {
      const body: any = {};
      if (fromDate) body.fromDate = fromDate;
      if (toDate)   body.toDate   = toDate;
      const data = await apiRequest("POST", "/api/daily-export/trigger-whatsapp", body) as any;
      toast({
        title: "WhatsApp export started",
        description: data.message || "Building ZIP and sending — check Backup Status below for the result.",
      });
      // Schedule several refetches to capture the result as it arrives
      // (ZIP build + send can take 60–120 s for large company sets)
      [5, 20, 45, 75, 120].forEach(s => setTimeout(() => refetchBackup(), s * 1000));
    } catch (e: any) {
      toast({ variant: "destructive", title: "WhatsApp send failed", description: e.message });
    } finally {
      setSendingWa(false);
      refetchBackup();
    }
  };

  const sendNpToWa = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/whatsapp/send-net-position", { startDate: npStart, endDate: npEnd }),
    onSuccess: (data: any) => {
      toast({ title: "Sent via WhatsApp", description: data?.message || "Net position report sent" });
    },
    onError: (e: any) => toast({ variant: "destructive", title: "Send failed", description: e.message }),
  });

  const downloadNpExcel = () => {
    const url = `/api/reports/net-position-monthly-excel?startDate=${npStart}&endDate=${npEnd}`;
    window.open(url, "_blank");
  };

  return (
    <div className="space-y-6" data-testid="section-daily-export">
      <div>
        <h3 className="text-lg font-semibold">Daily Full Company Export</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Export all data — accounts, transactions, inventory, payroll, containers, production, and more — for every company. One Excel file per company, bundled in a zip.
        </p>
      </div>

      {/* Backup Status */}
      {backupStatus && (
        <BackupStatusCard
          status={backupStatus}
          onRefresh={() => refetchBackup()}
          isRefreshing={backupFetching}
        />
      )}

      {/* Companies overview */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Companies ({companies.length})
          </CardTitle>
          <CardDescription>All companies will be included in the export.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {companies.map(c => (
              <Badge key={c.id} variant="secondary" data-testid={`badge-company-${c.id}`}>
                {c.name}
              </Badge>
            ))}
            {companies.length === 0 && (
              <p className="text-sm text-muted-foreground">No companies found.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Export Now */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Download className="h-4 w-4" />
            Export Now
          </CardTitle>
          <CardDescription>
            Leave dates blank to export full history. Set a range to scope the export.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs flex items-center gap-1"><Calendar className="h-3 w-3" />From Date</Label>
              <Input
                type="date"
                value={fromDate}
                onChange={e => setFromDate(e.target.value)}
                className="w-40"
                data-testid="input-export-from-date"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs flex items-center gap-1"><Calendar className="h-3 w-3" />To Date</Label>
              <Input
                type="date"
                value={toDate}
                onChange={e => setToDate(e.target.value)}
                className="w-40"
                data-testid="input-export-to-date"
              />
            </div>
            {(fromDate || toDate) && (
              <Button variant="ghost" size="sm" onClick={() => { setFromDate(""); setToDate(""); }}>
                Clear (full history)
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button disabled={companies.length === 0} data-testid="button-export-now">
                  Export Now <ChevronDown className="h-4 w-4 ml-2" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={() => startExport("download")} data-testid="menu-export-download">
                  <Download className="h-4 w-4 mr-2" />
                  Download ZIP
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => startExport("email")}
                  disabled={recipients.length === 0 || !settings?.gmailUser}
                  data-testid="menu-export-email"
                >
                  <Mail className="h-4 w-4 mr-2" />
                  Send by Email
                  {(recipients.length === 0 || !settings?.gmailUser) && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {!settings?.gmailUser ? "(no Gmail configured)" : "(no recipients)"}
                    </span>
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={sendViaWhatsApp}
                  disabled={!waReady || sendingWa}
                  data-testid="menu-export-whatsapp"
                >
                  <MessageSquare className="h-4 w-4 mr-2 text-green-600" />
                  {sendingWa ? "Sending…" : "Send via WhatsApp"}
                  {!waReady && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {!waSettings?.hasCredentials ? "(no credentials)" : !waSettings?.enabled ? "(WA disabled)" : "(no group set)"}
                    </span>
                  )}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <p className="text-xs text-muted-foreground">
              {fromDate || toDate
                ? `Filtered: ${fromDate || "—"} → ${toDate || "—"}`
                : "Full history (all dates)"}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Net Position Report */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-green-600" />
            Net Position Report
          </CardTitle>
          <CardDescription>
            Download or send the monthly net position Excel (includes income statement) via WhatsApp for any date range.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs flex items-center gap-1"><Calendar className="h-3 w-3" />From</Label>
              <Input
                type="date"
                value={npStart}
                onChange={e => setNpStart(e.target.value)}
                className="w-40"
                data-testid="input-np-start"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs flex items-center gap-1"><Calendar className="h-3 w-3" />To</Label>
              <Input
                type="date"
                value={npEnd}
                onChange={e => setNpEnd(e.target.value)}
                className="w-40"
                data-testid="input-np-end"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={downloadNpExcel}
              data-testid="button-np-download"
            >
              <Download className="h-4 w-4 mr-2" />
              Download Excel
            </Button>
            <Button
              onClick={() => sendNpToWa.mutate()}
              disabled={sendNpToWa.isPending}
              data-testid="button-np-send-whatsapp"
            >
              {sendNpToWa.isPending
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Sending...</>
                : <><Send className="h-4 w-4 mr-2" />Send via WhatsApp</>}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Scheduled Daily Export */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Scheduled Daily Export
          </CardTitle>
          <CardDescription>Automatically runs every day at 6:00 PM EST and emails the export to all recipients.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Enable daily schedule</p>
              <p className="text-xs text-muted-foreground">Runs at 6:00 PM Eastern Time, Monday–Sunday</p>
            </div>
            <Switch
              checked={settings?.scheduleEnabled ?? false}
              onCheckedChange={toggleSchedule}
              data-testid="switch-schedule-enabled"
            />
          </div>
          {settings?.lastRunAt && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <CheckCircle2 className="h-3 w-3 text-green-600" />
              Last run: {new Date(settings.lastRunAt).toLocaleString()}
            </div>
          )}
          {settings?.scheduleEnabled && !settings?.gmailUser && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>Schedule is enabled but Gmail credentials are not configured.</AlertDescription>
            </Alert>
          )}
          {settings?.scheduleEnabled && recipients.length === 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>Schedule is enabled but no recipients are configured.</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Gmail Credentials */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Gmail Sender Credentials
          </CardTitle>
          <CardDescription>
            Use a dedicated Gmail account. Generate an App Password from Google Account → Security → 2-Step Verification → App Passwords.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {settings?.gmailUser && (
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span>Currently configured: <span className="font-medium">{settings.gmailUser}</span></span>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Gmail Address</Label>
              <Input
                type="email"
                placeholder={settings?.gmailUser || "sender@gmail.com"}
                value={gmailUser}
                onChange={e => setGmailUser(e.target.value)}
                data-testid="input-gmail-user"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">App Password</Label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="xxxx xxxx xxxx xxxx"
                  value={gmailPassword}
                  onChange={e => setGmailPassword(e.target.value)}
                  className="pr-10"
                  data-testid="input-gmail-password"
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="absolute right-0 top-0 h-full"
                  onClick={() => setShowPassword(p => !p)}
                  type="button"
                  data-testid="button-toggle-password"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </div>
          <Button
            onClick={saveSettings}
            disabled={savingSettings || (!gmailUser && !gmailPassword)}
            data-testid="button-save-email-settings"
          >
            {savingSettings ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</> : "Save Credentials"}
          </Button>
        </CardContent>
      </Card>

      {/* Recipients */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Email Recipients ({recipients.length})
          </CardTitle>
          <CardDescription>These addresses receive the daily export email.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              type="email"
              placeholder="Add email address..."
              value={newEmail}
              onChange={e => setNewEmail(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && newEmail) addRecipient.mutate(newEmail); }}
              data-testid="input-new-recipient"
            />
            <Button
              onClick={() => newEmail && addRecipient.mutate(newEmail)}
              disabled={!newEmail || addRecipient.isPending}
              data-testid="button-add-recipient"
            >
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          </div>
          {recipients.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email Address</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recipients.map(r => (
                  <TableRow key={r.id} data-testid={`row-recipient-${r.id}`}>
                    <TableCell className="font-mono text-sm">{r.email}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(r.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => removeRecipient.mutate(r.id)}
                        data-testid={`button-remove-recipient-${r.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">No recipients yet. Add an email address above.</p>
          )}
        </CardContent>
      </Card>

      <Separator />

      {/* Data coverage */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">What's included in each export</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-xs text-muted-foreground">
          {[
            "Summary overview", "Locations", "Ledger accounts",
            "Bank accounts", "Fixed assets", "All vouchers",
            "All voucher entries", "Suppliers + transactions", "Customers + transactions",
            "Employees + payrolls", "Salary advances", "Factory workers",
            "Factory payrolls", "Factory attendance", "Factory daybook",
            "Stock groups + items", "Inventory by location", "Stock transfers + revisions",
            "Stock adjustments", "Purchase orders + line items", "Containers + charges",
            "Container offloads", "Bales (sorting)", "Factory bales + products",
            "Factory containers", "Exchange rates", "POS shifts",
            "Sales items", "Full audit log",
          ].map(item => (
            <div key={item} className="flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-green-600 shrink-0" />
              {item}
            </div>
          ))}
        </div>
      </div>

      {/* Progress dialog */}
      {activeJobId && (
        <ExportProgressDialog
          jobId={activeJobId}
          mode={activeMode}
          open={progressOpen}
          onClose={() => { setProgressOpen(false); setActiveJobId(""); refetchBackup(); }}
        />
      )}
    </div>
  );
}
