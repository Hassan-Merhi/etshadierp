/**
 * Bandwidth debug middleware.
 *
 * Only active when BANDWIDTH_DEBUG=true. Logs metadata for large responses,
 * never response bodies, request bodies, cookies, auth headers or tokens.
 */
import type { Request, Response, NextFunction } from "express";
import { recordOperationalEvent } from "../lib/operationalEvents";

const DEFAULT_THRESHOLD_BYTES = 500 * 1024;

function getThresholdBytes(): number {
  const configuredKb = Number(process.env.BANDWIDTH_DEBUG_THRESHOLD_KB || 500);
  return Number.isFinite(configuredKb) && configuredKb > 0 ? Math.round(configuredKb * 1024) : DEFAULT_THRESHOLD_BYTES;
}

export function bandwidthDebugMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (process.env.BANDWIDTH_DEBUG !== "true") return next();

  const start = Date.now();
  const thresholdBytes = getThresholdBytes();
  let totalBytes = 0;

  const originalWrite = res.write.bind(res);
  (res as any).write = function (chunk: any, ...args: any[]): boolean {
    if (chunk != null) {
      totalBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
    }
    return originalWrite(chunk, ...args);
  };

  const originalEnd = res.end.bind(res);
  (res as any).end = function (chunk?: any, ...args: any[]): Response {
    if (chunk != null && typeof chunk !== "function") {
      totalBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
    }

    originalEnd(chunk, ...args);

    if (totalBytes >= thresholdBytes) {
      recordOperationalEvent({
        category: "bandwidth",
        code: "large_http_response",
        severity: "warning",
        message: "Large HTTP response detected",
        method: req.method,
        path: req.path,
        status: res.statusCode,
        responseBytes: totalBytes,
        durationMs: Date.now() - start,
      });
    }

    return res;
  };

  next();
}
