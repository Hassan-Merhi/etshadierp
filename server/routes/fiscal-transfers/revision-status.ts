import type { Express, NextFunction, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAuth, requireNonPOS } from "../../auth";
import { getErrorMessage } from "../../lib/httpHandlers";

export type RevisionLifecycleStatus = "pending" | "approved" | "rejected" | "superseded";

async function ensureRevisionStatusTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS stock_transfer_revision_statuses (
      revision_id integer PRIMARY KEY REFERENCES stock_transfer_revisions(id) ON DELETE RESTRICT,
      status text NOT NULL CHECK (status IN ('rejected', 'superseded')),
      reason text NOT NULL,
      changed_by varchar,
      changed_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_stock_transfer_revision_statuses_status
    ON stock_transfer_revision_statuses(status)
  `);
}

async function getExplicitStatus(revisionId: number): Promise<"rejected" | "superseded" | null> {
  await ensureRevisionStatusTable();
  const result = await db.execute(sql`
    SELECT status
    FROM stock_transfer_revision_statuses
    WHERE revision_id = ${revisionId}
    LIMIT 1
  `);
  const row = (result.rows?.[0] ?? null) as { status?: "rejected" | "superseded" } | null;
  return row?.status ?? null;
}

async function approvalGuard(req: Request, res: Response, next: NextFunction) {
  try {
    const revisionId = Number(req.params.id);
    if (!Number.isInteger(revisionId) || revisionId <= 0) return next();
    const status = await getExplicitStatus(revisionId);
    if (status) {
      return res.status(409).json({ message: `A ${status} revision cannot be approved` });
    }
    return next();
  } catch (error: unknown) {
    return res.status(500).json({ message: getErrorMessage(error) });
  }
}

export function registerStockTransferRevisionStatusRoutes(app: Express) {
  // Registered before the approval implementation to block terminal states.
  app.post("/api/stock-transfer-revisions/:id/approve", requireAuth, requireNonPOS, approvalGuard);

  app.get("/api/stock-transfers/:transferId/revision-statuses", requireAuth, async (req, res) => {
    try {
      const transferId = Number(req.params.transferId);
      if (!Number.isInteger(transferId) || transferId <= 0) {
        return res.status(400).json({ message: "Transfer ID required" });
      }
      await ensureRevisionStatusTable();
      const result = await db.execute(sql`
        SELECT
          r.id AS "revisionId",
          r.revision_number AS "revisionNumber",
          CASE
            WHEN s.status IS NOT NULL THEN s.status
            WHEN r.optional = true THEN 'pending'
            ELSE 'approved'
          END AS status,
          s.reason,
          s.changed_by AS "changedBy",
          s.changed_at AS "changedAt"
        FROM stock_transfer_revisions r
        LEFT JOIN stock_transfer_revision_statuses s ON s.revision_id = r.id
        WHERE r.transfer_id = ${transferId}
        ORDER BY r.revision_number ASC
      `);
      return res.json(result.rows ?? []);
    } catch (error: unknown) {
      return res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.post("/api/stock-transfer-revisions/:id/reject", requireAuth, requireNonPOS, async (req, res) => {
    return setTerminalStatus(req, res, "rejected");
  });

  app.post("/api/stock-transfer-revisions/:id/supersede", requireAuth, requireNonPOS, async (req, res) => {
    return setTerminalStatus(req, res, "superseded");
  });
}

async function setTerminalStatus(
  req: Request,
  res: Response,
  status: "rejected" | "superseded"
) {
  try {
    const revisionId = Number(req.params.id);
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (!Number.isInteger(revisionId) || revisionId <= 0) {
      return res.status(400).json({ message: "Revision ID required" });
    }
    if (reason.length < 3) {
      return res.status(400).json({ message: "A meaningful reason is required" });
    }

    await ensureRevisionStatusTable();
    const revisionResult = await db.execute(sql`
      SELECT id, optional
      FROM stock_transfer_revisions
      WHERE id = ${revisionId}
      LIMIT 1
    `);
    const revision = revisionResult.rows?.[0] as { id?: number; optional?: boolean } | undefined;
    if (!revision?.id) return res.status(404).json({ message: "Revision not found" });
    if (!revision.optional) {
      return res.status(409).json({ message: "An approved revision cannot be changed" });
    }

    const existing = await getExplicitStatus(revisionId);
    if (existing) {
      return res.status(409).json({ message: `Revision is already ${existing}` });
    }

    await db.execute(sql`
      INSERT INTO stock_transfer_revision_statuses (
        revision_id, status, reason, changed_by, changed_at
      ) VALUES (
        ${revisionId}, ${status}, ${reason}, ${req.user?.id ?? null}, now()
      )
    `);

    return res.json({ revisionId, status, reason });
  } catch (error: unknown) {
    return res.status(500).json({ message: getErrorMessage(error) });
  }
}
