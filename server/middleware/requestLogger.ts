/**
 * HTTP request logging middleware.
 *
 * Logs failures, slow requests and an optional sample of successful requests.
 * Never logs request/response bodies, credentials, cookies or auth headers.
 */
import { randomUUID } from "crypto";
import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";

const SLOW_REQUEST_MS = Number(process.env.SLOW_REQUEST_MS || 500);
const SUCCESS_SAMPLE_RATE = Math.min(1, Math.max(0, Number(process.env.REQUEST_LOG_SAMPLE_RATE || 0)));
const SKIPPED_PATHS = new Set(["/api/health", "/api/health/db", "/api/boot", "/api/csrf-token"]);

function normaliseRequestId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return /^[A-Za-z0-9._:-]{8,128}$/.test(trimmed) ? trimmed : undefined;
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const requestId = normaliseRequestId(req.headers["x-request-id"]) || randomUUID();
  res.setHeader("X-Request-Id", requestId);

  res.on("finish", () => {
    const { method, path } = req;
    if (!path.startsWith("/api/")) return;
    if (SKIPPED_PATHS.has(path)) return;

    const userId: number | undefined = (req as any).user?.id;
    const companyId: number | undefined = (req as any).session?.currentCompanyId;
    const statusCode = res.statusCode;
    const durationMs = Date.now() - start;
    const isSlow = durationMs >= SLOW_REQUEST_MS;
    const isFailure = statusCode >= 400;
    const sampledSuccess = !isFailure && SUCCESS_SAMPLE_RATE > 0 && Math.random() < SUCCESS_SAMPLE_RATE;

    if (!isFailure && !isSlow && !sampledSuccess) return;

    const level = statusCode >= 500 ? "error" : statusCode >= 400 || isSlow ? "warn" : "info";
    logger[level](`${method} ${path} ${statusCode}`, {
      module: "http",
      action: isSlow ? "slow_request" : "request",
      requestId,
      ...(userId != null ? { userId } : {}),
      ...(companyId != null ? { companyId } : {}),
      status: statusCode,
      durationMs,
      slow: isSlow,
    });
  });

  next();
}
