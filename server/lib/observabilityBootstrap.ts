import { randomUUID } from "node:crypto";
import cron from "node-cron";
import { logger } from "./logger";
import { getTraceContext, runWithTraceContext, withTraceSpan } from "./traceContext";

const BOOTSTRAP_KEY = "__erpObservabilityBootstrapInstalled";
const originalFetch = globalThis.fetch?.bind(globalThis);

function safeDependencyName(input: RequestInfo | URL): string | undefined {
  try {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (host === "api.green-api.com") return "green-api";
    if (host.includes("maersk")) return "maersk";
    if (host.includes("cma-cgm") || host.includes("cmacgm")) return "cma-cgm";
    if (host.includes("msc.com")) return "msc";
    if (host.includes("hapag") || host.includes("hlag")) return "hapag-lloyd";
    return undefined;
  } catch {
    return undefined;
  }
}

function installExternalFetchTracing(): void {
  if (!originalFetch) return;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const dependency = safeDependencyName(input);
    if (!dependency) return originalFetch(input, init);

    return withTraceSpan(`external.${dependency}`, () => originalFetch(input, init), ({ durationMs, failed }) => {
      const trace = getTraceContext();
      const thresholdMs = Number(process.env.EXTERNAL_DEPENDENCY_SLOW_MS || 1_500);
      const slow = durationMs >= thresholdMs;
      if (!failed && !slow) return;
      logger[failed ? "error" : "warn"]("External dependency operation", {
        module: "dependency",
        action: failed ? "request_failed" : "slow_request",
        dependency,
        durationMs: Math.round(durationMs),
        requestId: trace?.requestId,
        source: trace?.source,
      });
    });
  }) as typeof globalThis.fetch;
}

function installCronTracing(): void {
  const cronAny = cron as any;
  if (cronAny.__erpTracePatched) return;
  cronAny.__erpTracePatched = true;
  const originalSchedule = cron.schedule.bind(cron);

  cronAny.schedule = (expression: string, callback: (...args: any[]) => any, options?: any) => {
    const wrapped = (...args: any[]) => {
      const requestId = `scheduler-${randomUUID()}`;
      return runWithTraceContext(
        {
          requestId,
          routeTemplate: `cron:${String(expression).slice(0, 80)}`,
          buildVersion: process.env.BUILD_VERSION || process.env.RENDER_GIT_COMMIT?.substring(0, 8) || "dev",
          source: "scheduler",
        },
        () => callback(...args),
      );
    };
    return originalSchedule(expression, wrapped, options);
  };
}

const globalState = globalThis as typeof globalThis & Record<string, unknown>;
if (!globalState[BOOTSTRAP_KEY]) {
  globalState[BOOTSTRAP_KEY] = true;
  installExternalFetchTracing();
  installCronTracing();
}
