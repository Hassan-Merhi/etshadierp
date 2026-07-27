import type { Request, Response } from "express";
import { logger } from "../lib/logger";
import { recordOperationalEvent } from "../lib/operationalEvents";

const ENDPOINT = "/api/auth/observability/client-error";
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = Math.max(1, Number(process.env.CLIENT_ERROR_RATE_LIMIT || 20));
const DEDUPE_WINDOW_MS = Math.max(1_000, Number(process.env.CLIENT_ERROR_DEDUPE_MS || 60_000));
const MAX_TEXT = 2_000;
const MAX_STACK = 8_000;
const TRUSTED_APP_ORIGINS = new Set([
  "capacitor://localhost",
  "ionic://localhost",
  "https://localhost",
  "http://localhost",
]);

const rateWindows = new Map<string, { startedAt: number; count: number }>();
const recentFingerprints = new Map<string, number>();

function cleanText(value: unknown, max = MAX_TEXT): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}

function cleanRoute(value: unknown): string | undefined {
  const text = cleanText(value, 500);
  if (!text || !text.startsWith("/")) return undefined;
  return text.split("?")[0].split("#")[0];
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function isTrustedOrigin(req: Request): boolean {
  const origin = cleanText(req.headers.origin, 500);
  const referer = cleanText(req.headers.referer, 500);
  if (!origin && !referer) return true;
  if (origin && TRUSTED_APP_ORIGINS.has(origin)) return true;

  const host = req.headers.host;
  if (!host) return false;
  try {
    const sourceHost = origin ? new URL(origin).host : referer ? new URL(referer).host : "";
    return sourceHost === host;
  } catch {
    return false;
  }
}

function rateKey(req: Request): string {
  const sessionUser = (req as any).session?.userId;
  return sessionUser ? `user:${sessionUser}` : `ip:${req.ip || req.socket.remoteAddress || "unknown"}`;
}

function allowRate(req: Request): boolean {
  const now = Date.now();
  const key = rateKey(req);
  const existing = rateWindows.get(key);
  if (!existing || now - existing.startedAt >= RATE_WINDOW_MS) {
    rateWindows.set(key, { startedAt: now, count: 1 });
    return true;
  }
  existing.count += 1;
  return existing.count <= RATE_LIMIT;
}

function isDuplicate(fingerprint: string): boolean {
  const now = Date.now();
  const previous = recentFingerprints.get(fingerprint);
  recentFingerprints.set(fingerprint, now);

  if (recentFingerprints.size > 2_000) {
    for (const [key, timestamp] of recentFingerprints) {
      if (now - timestamp > DEDUPE_WINDOW_MS) recentFingerprints.delete(key);
    }
  }

  return previous !== undefined && now - previous < DEDUPE_WINDOW_MS;
}

async function deliverExternally(payload: Record<string, unknown>): Promise<void> {
  const url = process.env.OBSERVABILITY_WEBHOOK_URL;
  if (!url) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_500);
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.OBSERVABILITY_WEBHOOK_TOKEN
          ? { authorization: `Bearer ${process.env.OBSERVABILITY_WEBHOOK_TOKEN}` }
          : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    logger.warn("External observability delivery failed", {
      module: "observability",
      action: "external_delivery",
      error,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function handleClientObservability(req: Request, res: Response, requestId: string): boolean {
  if (req.method !== "POST" || req.path !== ENDPOINT) return false;

  if (!isTrustedOrigin(req)) {
    res.status(403).json({ message: "Cross-origin observability report rejected." });
    return true;
  }

  const session = (req as any).session;
  const userId = positiveInteger(session?.userId || (req as any).user?.id);
  if (!userId) {
    res.status(401).json({ message: "Authentication required." });
    return true;
  }

  if (!allowRate(req)) {
    res.status(202).json({ accepted: false, reason: "rate_limited" });
    return true;
  }

  const body = (req as any).body || {};
  const message = cleanText(body.message);
  const source = cleanText(body.source, 80) || "browser";
  const route = cleanRoute(body.route);
  const stack = cleanText(body.stack, MAX_STACK);
  const componentStack = cleanText(body.componentStack, MAX_STACK);
  const buildVersion = cleanText(body.buildVersion, 120);
  const browserRequestId = cleanText(body.lastRequestId, 128);

  if (!message) {
    res.status(400).json({ message: "A non-empty error message is required." });
    return true;
  }

  const companyId = positiveInteger(session?.factoryCompanyId || session?.currentCompanyId);
  const fingerprint = `${userId}|${companyId || "none"}|${source}|${route || "unknown"}|${message}|${stack?.split("\n")[0] || ""}`;
  if (isDuplicate(fingerprint)) {
    res.status(202).json({ accepted: false, reason: "duplicate" });
    return true;
  }

  const payload = {
    event: "client_error",
    timestamp: new Date().toISOString(),
    requestId,
    browserRequestId,
    userId,
    companyId: companyId ?? null,
    source,
    route,
    message,
    stack,
    componentStack,
    buildVersion,
    userAgent: cleanText(req.headers["user-agent"], 500),
  };

  logger.error("Client application error", {
    module: "observability",
    action: "client_error",
    requestId,
    userId,
    companyId,
    source,
    path: route,
    buildVersion,
    browserRequestId,
    error: stack ? new Error(`${message}\n${stack}`) : new Error(message),
    componentStack,
  });

  recordOperationalEvent({
    category: "error",
    code: "client_application_error",
    severity: "critical",
    message,
    requestId,
    path: route,
    userId,
    ...(companyId != null ? { companyId } : {}),
  });

  void deliverExternally(payload);
  res.status(202).json({ accepted: true, requestId });
  return true;
}
