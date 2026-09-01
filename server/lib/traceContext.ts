import { AsyncLocalStorage } from "node:async_hooks";

export interface TraceContext {
  requestId: string;
  routeTemplate?: string;
  userId?: number | string;
  companyId?: number;
  factoryCompanyId?: number;
  locationId?: number;
  buildVersion?: string;
  source?: "http" | "scheduler" | "websocket" | "background";
}

const storage = new AsyncLocalStorage<TraceContext>();

export function runWithTraceContext<T>(context: TraceContext, callback: () => T): T {
  return storage.run({ ...context }, callback);
}

export function getTraceContext(): TraceContext | undefined {
  const context = storage.getStore();
  return context ? { ...context } : undefined;
}

export function updateTraceContext(update: Partial<TraceContext>): void {
  const context = storage.getStore();
  if (!context) return;
  Object.assign(context, update);
}

function joinRouteTemplate(baseUrl: string, routePath: string): string {
  const base = baseUrl && baseUrl !== "/" ? baseUrl.replace(/\/$/, "") : "";
  const route = routePath.startsWith("/") ? routePath : `/${routePath}`;

  // Express can expose an absolute route path even while req.baseUrl still
  // contains a mounted middleware prefix. Concatenating both produced fake
  // diagnostics such as /api/factory/api/factory/bale-products even though the
  // browser requested /api/factory/bale-products. Preserve already-absolute API
  // routes instead of double-prefixing them.
  if (route.startsWith("/api/")) return route;
  if (base && (route === base || route.startsWith(`${base}/`))) return route;
  return `${base}${route}` || "/";
}

export function normaliseRouteTemplate(path: string, routePath?: unknown, baseUrl = ""): string {
  if (typeof routePath === "string") return joinRouteTemplate(baseUrl, routePath);
  return path
    .split("/")
    .map((segment) => {
      if (/^\d+$/.test(segment)) return ":id";
      if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment)) return ":id";
      if (/^[A-Z]{4}\d{7}$/i.test(segment)) return ":reference";
      return segment;
    })
    .join("/");
}

export async function withTraceSpan<T>(
  name: string,
  operation: () => Promise<T>,
  onComplete?: (result: { name: string; durationMs: number; failed: boolean }) => void
): Promise<T> {
  const startedAt = performance.now();
  let failed = false;
  try {
    return await operation();
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    onComplete?.({ name: name.slice(0, 120), durationMs: performance.now() - startedAt, failed });
  }
}
