import { cleanupExportPath, isFileBackedExport } from "../lib/fileBackedExport";

export type StepType = "info" | "success" | "error" | "warning";

export interface JobStep {
  time: string;
  message: string;
  type: StepType;
}

export interface ExportJob {
  id: string;
  status: "running" | "done" | "error";
  mode: "download" | "email";
  steps: JobStep[];
  /** Legacy small-buffer result. New full exports use zipFilePath. */
  zipBuffer?: Buffer;
  zipFilePath?: string;
  zipSizeBytes?: number;
  error?: string;
  createdAt: Date;
}

const jobs = new Map<string, ExportJob>();

// Clean up jobs older than 30 minutes, including any disk-backed ZIP artifact.
const cleanupTimer = setInterval(
  () => {
    const cutoff = new Date(Date.now() - 30 * 60 * 1000);
    for (const [id, job] of jobs.entries()) {
      if (job.createdAt < cutoff) {
        jobs.delete(id);
        if (job.zipFilePath) void cleanupExportPath(job.zipFilePath);
        job.zipBuffer = undefined;
      }
    }
  },
  5 * 60 * 1000
);
cleanupTimer.unref();

export function createJob(mode: "download" | "email"): ExportJob {
  const id = `exp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const job: ExportJob = {
    id,
    status: "running",
    mode,
    steps: [],
    createdAt: new Date(),
  };
  jobs.set(id, job);
  return job;
}

export function getJob(id: string): ExportJob | undefined {
  return jobs.get(id);
}

export function addStep(job: ExportJob, message: string, type: StepType = "info") {
  job.steps.push({
    time: new Date().toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
    message,
    type,
  });
}

export function finishJob(job: ExportJob, zipBuffer?: Buffer) {
  job.status = "done";

  if (zipBuffer && isFileBackedExport(zipBuffer)) {
    job.zipFilePath = zipBuffer.filePath;
    job.zipSizeBytes = zipBuffer.length;
    job.zipBuffer = undefined;
    return;
  }

  job.zipBuffer = zipBuffer;
  job.zipSizeBytes = zipBuffer?.length;
}

export function failJob(job: ExportJob, error: string) {
  job.status = "error";
  job.error = error;
  addStep(job, `Failed: ${error}`, "error");
}
