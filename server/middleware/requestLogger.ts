/**
 * HTTP request logging middleware.
 *
 * Fires on response "finish" so req.user is already populated by requireAuth.
 * Only logs /api/* paths; skips static assets and the health probe.
 *
 * NEVER logs: passwords, tokens, cookies, authorization headers,
 *             x-csrf-token, or any request body field.
 */
import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on("finish", () => {
    const { method, path } = req;

    if (!path.startsWith("/api/")) return;
    if (path === "/api/health" || path === "/api/boot" || path === "/api/csrf-token") return;

    const userId: number | undefined = (req as any).user?.id;
    const companyId: number | undefined = (req as any).session?.currentCompanyId;
    const statusCode = res.statusCode;
    const durationMs = Date.now() - start;

    const level = statusCode >= 500 ? "error" : statusCode >= 400 ? "warn" : "info";

    logger[level](`${method} ${path} ${statusCode}`, {
      module: "http",
      action: "request",
      ...(userId != null ? { userId } : {}),
      ...(companyId != null ? { companyId } : {}),
      status: statusCode,
      durationMs,
    });
  });

  next();
}
