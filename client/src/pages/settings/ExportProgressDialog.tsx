import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { JobStatus } from "./ExportCenterTypes";
import { StepIcon } from "./ExportCenterComponents";

export function ExportProgressDialog({ jobId, mode, open, onClose }: {
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
        const data = (await (await apiRequest("GET", `/api/export/job/${jobId}`)).json()) as JobStatus;
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
