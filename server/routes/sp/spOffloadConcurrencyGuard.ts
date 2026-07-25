import type { Express, NextFunction, Request, Response } from "express";
import { pool } from "../../db";
import { requireAuth } from "../../auth";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { requireSpCompany } from "./spHelpers";

export interface SpOffloadLockScope {
  companyId: number;
  containerId: number;
}

export function buildSpOffloadLockScope(companyId: number, containerId: number): SpOffloadLockScope {
  return { companyId, containerId };
}

export function classifySpOffloadState(
  status: string | null | undefined,
  hasExistingOffload: boolean
): "post" | "replay" | "reject" {
  if (status === "open") return "post";
  if (hasExistingOffload) return "replay";
  return "reject";
}

async function guardSpOffload(req: Request, res: Response, next: NextFunction): Promise<void> {
  const companyId = await requireSpCompany(req as any, res as any);
  if (!companyId) return;

  const containerId = Number(req.body?.containerId);
  if (!Number.isInteger(containerId) || containerId <= 0) {
    res.status(400).json({ message: "containerId is required" });
    return;
  }

  const client = await pool.connect();
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    try {
      await client.query("SELECT pg_advisory_unlock($1, $2)", [companyId, containerId]);
    } catch (error) {
      logger.warn("SP offload advisory unlock failed", { companyId, containerId, error });
    } finally {
      client.release();
    }
  };

  try {
    const lockResult = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1, $2) AS locked",
      [companyId, containerId]
    );
    if (!lockResult.rows[0]?.locked) {
      client.release();
      released = true;
      res.status(409).json({
        code: "SP_OFFLOAD_IN_PROGRESS",
        message: "This container is currently being offloaded. Wait for the first request to finish before retrying.",
      });
      return;
    }

    res.once("finish", () => void release());
    res.once("close", () => void release());

    const containerResult = await client.query<{ status: string }>(
      "SELECT status FROM sp_containers WHERE id = $1 AND company_id = $2 LIMIT 1",
      [containerId, companyId]
    );
    const container = containerResult.rows[0];
    if (!container) {
      res.status(404).json({ message: "Container not found" });
      return;
    }

    const existingResult = await client.query(
      "SELECT * FROM sp_offloads WHERE container_id = $1 AND company_id = $2 ORDER BY id DESC LIMIT 1",
      [containerId, companyId]
    );
    const existingOffload = existingResult.rows[0] ?? null;
    const decision = classifySpOffloadState(container.status, Boolean(existingOffload));

    if (decision === "replay") {
      res.setHeader("X-Idempotent-Replay", "true");
      res.json(existingOffload);
      return;
    }
    if (decision === "reject") {
      res.status(409).json({
        code: "SP_CONTAINER_NOT_OPEN",
        message: "Container is not open and has no completed offload to replay.",
      });
      return;
    }

    next();
  } catch (error: unknown) {
    await release();
    logger.error("SP offload concurrency guard failed", { companyId, containerId, error });
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

/** Register before the legacy SP offload route. */
export function registerSpOffloadConcurrencyGuard(app: Express): void {
  app.post("/api/sp/offload", requireAuth, (req, res, next) => {
    void guardSpOffload(req, res, next);
  });
}
