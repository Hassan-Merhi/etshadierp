import type { Express, NextFunction, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { requireAuth } from "../../auth";
import { db } from "../../db";
import { getErrorMessage } from "../../lib/httpHandlers";
import { requireSpCompany } from "./spHelpers";
import { ensureSpOffloadReversalStorage } from "./spOffloadLifecycleRoutes";

/**
 * The legacy offload concurrency guard treats every historical sp_offloads row
 * as active. After a fully audited reversal, archive the old operational rows
 * immediately before corrected re-offload. The immutable reversal row retains
 * the complete offload, charge, movement and voucher snapshot.
 */
async function prepareCorrectedReoffload(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const companyId = await requireSpCompany(req as any, res as any);
    if (!companyId) return;

    const containerId = Number(req.body?.containerId);
    if (!Number.isInteger(containerId) || containerId <= 0) {
      next();
      return;
    }

    await ensureSpOffloadReversalStorage();
    await db.transaction(async (tx) => {
      const containerResult = await tx.execute(sql`
        SELECT status
        FROM sp_containers
        WHERE id = ${containerId} AND company_id = ${companyId}
        FOR UPDATE
      `);
      const container = (containerResult as any).rows?.[0] ?? (containerResult as any)[0];
      if (!container || container.status !== "open") return;

      const reversedRows = await tx.execute(sql`
        SELECT r.offload_id
        FROM sp_offload_reversals r
        JOIN sp_offloads o ON o.id = r.offload_id
        WHERE r.company_id = ${companyId}
          AND r.container_id = ${containerId}
          AND o.company_id = ${companyId}
        ORDER BY r.id
        FOR UPDATE OF o
      `);
      const reversedOffloadIds = ((reversedRows as any).rows ?? reversedRows ?? []).map((row: any) => Number(row.offload_id));
      if (reversedOffloadIds.length === 0) return;

      await tx.execute(sql`
        DELETE FROM sp_offload_charges
        WHERE company_id = ${companyId}
          AND offload_id = ANY(${reversedOffloadIds}::int[])
      `);
      await tx.execute(sql`
        DELETE FROM sp_offloads
        WHERE company_id = ${companyId}
          AND id = ANY(${reversedOffloadIds}::int[])
      `);
    });

    next();
  } catch (error: unknown) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

export function registerSpReoffloadPreparationGuard(app: Express): void {
  app.post("/api/sp/offload", requireAuth, (req, res, next) => {
    void prepareCorrectedReoffload(req, res, next);
  });
}
