const ENDPOINT = "/api/auth/observability/client-error";
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 10;
const DEDUPE_WINDOW_MS = 60_000;

let installed = false;
let windowStartedAt = Date.now();
let sentInWindow = 0;
let lastRequestId: string | undefined;
const recent = new Map<string, number>();

export interface ClientErrorReport {
  source: "window_error" | "unhandled_rejection" | "react_error_boundary" | "manual";
  message: string;
  stack?: string;
  componentStack?: string;
}

/**
 * The session probe is intentionally allowed to receive 401 when a visitor
 * opens the public login page. It is not an application failure and should
 * not become either browser console noise or an observability event.
 *
 * Keep this narrowly scoped: permission and business API 401s remain useful
 * diagnostic signals.
 */
export function isExpectedUnauthenticatedProbe(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { status?: unknown; message?: unknown; url?: unknown };
  if (candidate.status !== 401) return false;

  const message = typeof candidate.message === "string" ? candidate.message : "";
  const url = typeof candidate.url === "string" ? candidate.url : "";
  return (
    url.includes("/api/auth/me") ||
    message.includes("/api/auth/me") ||
    message.includes("Failed to load authenticated user (401)")
  );
}

function trim(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.trim();
  return clean ? clean.slice(0, max) : undefined;
}

function allowSend(fingerprint: string): boolean {
  const now = Date.now();
  if (now - windowStartedAt >= RATE_WINDOW_MS) {
    windowStartedAt = now;
    sentInWindow = 0;
  }
  if (sentInWindow >= RATE_LIMIT) return false;

  const previous = recent.get(fingerprint);
  recent.set(fingerprint, now);
  if (recent.size > 250) {
    for (const [key, timestamp] of recent) {
      if (now - timestamp > DEDUPE_WINDOW_MS) recent.delete(key);
    }
  }
  if (previous !== undefined && now - previous < DEDUPE_WINDOW_MS) return false;

  sentInWindow += 1;
  return true;
}

function currentRoute(): string {
  return `${window.location.pathname}${window.location.search}`.slice(0, 500);
}

function isChunkFailure(value: unknown): boolean {
  const text = value instanceof Error ? `${value.name} ${value.message}` : String(value || "");
  return (
    text.includes("dynamically imported module") ||
    text.includes("Loading chunk") ||
    text.includes("Importing a module script failed") ||
    text.includes("Unable to preload CSS") ||
    text.includes("ChunkLoadError")
  );
}

export function reportClientError(report: ClientErrorReport): void {
  if (typeof window === "undefined") return;
  if (report.source === "unhandled_rejection" && isExpectedUnauthenticatedProbe(report)) return;
  const message = trim(report.message, 2_000);
  if (!message) return;
  const stack = trim(report.stack, 8_000);
  const componentStack = trim(report.componentStack, 8_000);
  const fingerprint = `${report.source}|${currentRoute()}|${message}|${stack?.split("\n")[0] || ""}`;
  if (!allowSend(fingerprint)) return;

  const body = JSON.stringify({
    source: report.source,
    message,
    stack,
    componentStack,
    route: currentRoute(),
    buildVersion: import.meta.env?.VITE_BUILD_VERSION || "unknown",
    lastRequestId,
  });

  void window
    .fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body,
      keepalive: true,
    })
    .catch(() => undefined);
}

export function installClientObservability(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const previousFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let pathname: string | undefined;
    try {
      const value = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
      pathname = new URL(value, window.location.origin).pathname;
    } catch {
      pathname = undefined;
    }

    if (pathname?.startsWith("/api/") && pathname !== ENDPOINT) {
      const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
      if (!headers.has("X-Request-Id")) {
        const id = globalThis.crypto?.randomUUID?.() || `browser-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        headers.set("X-Request-Id", id);
      }
      init = { ...init, headers };
    }

    const response = await previousFetch(input, init);
    const responseRequestId = response.headers.get("X-Request-Id");
    if (responseRequestId) lastRequestId = responseRequestId.slice(0, 128);
    return response;
  };

  window.addEventListener("error", (event) => {
    const error = event.error instanceof Error ? event.error : undefined;
    reportClientError({
      source: "window_error",
      message: error?.message || event.message || "Unknown browser error",
      stack: error?.stack,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    if (isExpectedUnauthenticatedProbe(event.reason)) {
      event.preventDefault();
      return;
    }
    if (isChunkFailure(event.reason)) return;
    const error = event.reason instanceof Error ? event.reason : undefined;
    reportClientError({
      source: "unhandled_rejection",
      message: error?.message || String(event.reason || "Unhandled promise rejection"),
      stack: error?.stack,
    });
  });
}
