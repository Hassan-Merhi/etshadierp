export type RequestTimingClass = "default" | "pdf" | "whatsapp" | "report_export" | "background_job";

export interface SlowRequestThresholdConfig {
  default: number;
  pdf: number;
  whatsapp: number;
  reportExport: number;
  backgroundJob: number;
}

const DEFAULT_SLOW_REQUEST_MS = 1_000;
const DEFAULT_PDF_SLOW_REQUEST_MS = 3_000;
const DEFAULT_WHATSAPP_SLOW_REQUEST_MS = 5_000;
const DEFAULT_REPORT_EXPORT_SLOW_REQUEST_MS = 5_000;
const DEFAULT_BACKGROUND_JOB_SLOW_REQUEST_MS = 10_000;

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalisePath(path: string): string {
  return String(path || "/")
    .split("?")[0]
    .toLowerCase();
}

export function classifyRequestTiming(path: string): RequestTimingClass {
  const normalized = normalisePath(path);

  if (
    normalized.includes("whatsapp") ||
    normalized.includes("send-invoice-pdf-backend") ||
    normalized.includes("send-stock-pdf-backend") ||
    normalized.includes("green-api")
  ) {
    return "whatsapp";
  }

  if (
    /(?:^|\/)(?:cron|scheduler|schedulers|background|jobs?|workers?)(?:\/|$)/.test(normalized) ||
    /(?:sync-all|bulk-track|recalculate|reconciliation|reconcile|repair|migration|purge)/.test(normalized)
  ) {
    return "background_job";
  }

  if (
    /(?:export|download|excel|xlsx|csv)/.test(normalized) &&
    /(?:report|statement|daybook|inventory|stock|sales|payroll|container|account|voucher|ledger|summary)/.test(
      normalized
    )
  ) {
    return "report_export";
  }

  if (/(?:pdf|print|receipt)/.test(normalized)) return "pdf";

  return "default";
}

export function getSlowRequestThresholdConfig(
  env: Record<string, string | undefined> = process.env
): SlowRequestThresholdConfig {
  const legacyDefault = positiveNumber(env.SLOW_REQUEST_MS, DEFAULT_SLOW_REQUEST_MS);
  return {
    default: positiveNumber(env.SLOW_REQUEST_DEFAULT_MS, legacyDefault),
    pdf: positiveNumber(env.SLOW_REQUEST_PDF_MS, DEFAULT_PDF_SLOW_REQUEST_MS),
    whatsapp: positiveNumber(env.SLOW_REQUEST_WHATSAPP_MS, DEFAULT_WHATSAPP_SLOW_REQUEST_MS),
    reportExport: positiveNumber(env.SLOW_REQUEST_REPORT_EXPORT_MS, DEFAULT_REPORT_EXPORT_SLOW_REQUEST_MS),
    backgroundJob: positiveNumber(env.SLOW_REQUEST_BACKGROUND_JOB_MS, DEFAULT_BACKGROUND_JOB_SLOW_REQUEST_MS),
  };
}

export function getSlowRequestThresholdMs(path: string, env: Record<string, string | undefined> = process.env): number {
  const config = getSlowRequestThresholdConfig(env);
  switch (classifyRequestTiming(path)) {
    case "whatsapp":
      return config.whatsapp;
    case "background_job":
      return config.backgroundJob;
    case "report_export":
      return config.reportExport;
    case "pdf":
      return config.pdf;
    default:
      return config.default;
  }
}
