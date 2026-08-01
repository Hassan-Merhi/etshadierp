import type { Express, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { requireAuth } from "../../auth";
import { db } from "../../db";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { requireActionAccess } from "../../lib/permissionMiddleware";
import { writeAuditEvent } from "../../services/audit/auditService";
import {
  applyFactoryBilingualSnapshotBackfill,
  buildFactoryBilingualSnapshotPlan,
} from "../../services/factoryBilingualSnapshotService";

function getFactoryCompanyId(req: Request): number | null {
  const companyId = Number((req.session as any)?.factoryCompanyId);
  return Number.isSafeInteger(companyId) && companyId > 0 ? companyId : null;
}

function isAdmin(req: Request): boolean {
  const role = String((req as any).user?.role ?? (req.session as any)?.currentRole ?? "");
  return ["Admin", "Owner", "Developer"].includes(role);
}

function booleanValue(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

export function registerFactoryBilingualSnapshotRoutes(app: Express): void {
  app.get(
    "/api/factory/bilingual-snapshots/diagnose",
    requireAuth,
    requireActionAccess("act_import_data"),
    async (req: Request, res: Response) => {
      try {
        const companyId = getFactoryCompanyId(req);
        if (!companyId) return res.status(403).json({ message: "Factory company access required" });
        return res.json(await buildFactoryBilingualSnapshotPlan(companyId));
      } catch (error) {
        logger.error("Failed to diagnose Factory bilingual snapshots", { error });
        return res.status(500).json({ message: getErrorMessage(error) });
      }
    }
  );

  app.post(
    "/api/factory/bilingual-snapshots/backfill",
    requireAuth,
    requireActionAccess("act_import_data"),
    async (req: Request, res: Response) => {
      try {
        if (!isAdmin(req)) {
          return res.status(403).json({ message: "Admin authorization required" });
        }
        const companyId = getFactoryCompanyId(req);
        if (!companyId) return res.status(403).json({ message: "Factory company access required" });

        const apply = booleanValue((req.body as any)?.apply);
        const includeFinalized = booleanValue((req.body as any)?.includeFinalized);
        const overwrite = booleanValue((req.body as any)?.overwrite);
        const plan = await buildFactoryBilingualSnapshotPlan(companyId);

        if (!apply) {
          return res.json({ dryRun: true, plan, options: { includeFinalized, overwrite } });
        }
        if ((req.body as any)?.confirmation !== "APPLY_ARABIC_SNAPSHOT_BACKFILL") {
          return res.status(400).json({
            message: "Confirmation is required before applying the snapshot backfill",
            requiredConfirmation: "APPLY_ARABIC_SNAPSHOT_BACKFILL",
            plan,
          });
        }

        const result = await db.transaction(async (tx) => {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(7347, ${companyId})`);
          const before = await buildFactoryBilingualSnapshotPlan(companyId, tx as any);
          const applied = await applyFactoryBilingualSnapshotBackfill(
            companyId,
            { includeFinalized, overwrite },
            tx as any
          );
          const after = await buildFactoryBilingualSnapshotPlan(companyId, tx as any);
          await writeAuditEvent(
            {
              action: "factory_bilingual_snapshot_backfill",
              entityType: "factory_bilingual_snapshot",
              entityId: companyId,
              companyId,
              userId: Number((req.session as any)?.userId) || undefined,
              metadata: {
                includeFinalized,
                overwrite,
                before,
                applied,
                after,
              },
            },
            tx as any
          );
          return { before, applied, after };
        });

        return res.json({ dryRun: false, ...result });
      } catch (error) {
        logger.error("Failed to backfill Factory bilingual snapshots", { error });
        return res.status(500).json({ message: getErrorMessage(error) });
      }
    }
  );
}
