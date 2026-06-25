/**
 * Bandwidth debug middleware.
 *
 * Only active when BANDWIDTH_DEBUG=true.
 * Logs any response whose uncompressed byte count exceeds THRESHOLD_BYTES.
 *
 * Logs ONLY: method, path, status, approximate size (KB), duration (ms).
 * NEVER logs: response body, request body, cookies, auth headers, tokens,
 *             passwords, or any sensitive business data.
 */
import type { Request, Response, NextFunction } from "express";

const THRESHOLD_BYTES = 500 * 1024; // 500 KB

export function bandwidthDebugMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (process.env.BANDWIDTH_DEBUG !== "true") {
    return next();
  }

  const start = Date.now();
  let totalBytes = 0;

  const _write = res.write.bind(res);
  (res as any).write = function (chunk: any, ...args: any[]): boolean {
    if (chunk != null) {
      totalBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
    }
    return _write(chunk, ...args);
  };

  const _end = res.end.bind(res);
  (res as any).end = function (chunk?: any, ...args: any[]): Response {
    if (chunk != null && typeof chunk !== "function") {
      totalBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
    }
    _end(chunk, ...args);

    if (totalBytes >= THRESHOLD_BYTES) {
      const durationMs = Date.now() - start;
      const sizeKB = Math.round(totalBytes / 1024);
      console.log(
        `[BANDWIDTH] ${req.method} ${req.path} ${res.statusCode} — ${sizeKB}KB in ${durationMs}ms`
      );
    }

    return res;
  };

  next();
}
