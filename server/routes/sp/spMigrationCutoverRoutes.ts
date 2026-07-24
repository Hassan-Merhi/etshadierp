import type { Express } from "express";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { logger } from "../../lib/logger";
import { requireAuth, requireRole } from "../../auth";
import { validateMigrationPair, pn } from "./spMigrationPhase2Common";
import { importHistoricalSales } from "./spMigrationPhase2Sales";
import { importContainers } from "./spMigrationPhase2Containers";
import {
  ensureCutoverSchema,
  getLiveCutover,
  installCutoverWriteGuard,
  invalidateCutoverLockCache,
} from "./spMigrationCutoverState";
import {
  buildCutoverReadiness,
  restoreCutoverStock,
  synchronizeCutoverStock,
} from "./spMigrationCutoverReadiness";
import { moveUsersToTarget, restoreUsersToSource } from "./spMigrationCutoverUsers";

async function ensureCutoverColumns(): Promise<void> {
  await ensureCutoverSchema();
  await db.execute(sql.raw(`
    ALTER TABLE sp_migration_cutovers
      ADD COLUMN IF NOT EXISTS rollback_window_hours INTEGER NOT NULL DEFAULT 72
  `));
  await db.execute(sql.raw(`
    ALTER TABLE sp_migration_cutovers
      ADD COLUMN IF NOT EXISTS finalize_started_at TIMESTAMPTZ
  `));
  await db.execute(sql.raw(`
    ALTER TABLE sp_migration_cutover_stock_deltas
      ADD COLUMN IF NOT EXISTS created_target_inventory BOOLEAN NOT NULL DEFAULT false
  `));
}

function exactConfirmation(req: any, expected: string, sourceName: string): string | null {
  if (req.body?.confirmation !== expected) return `Requires confirmation = "${expected}"`;
  if (!req.body?.companyNameConfirm || req.body.companyNameConfirm.trim() !== sourceName) {
    return `Company name confirmation must match exactly: "${sourceName}"`;
  }
  return null;
}

async function invokeMigrationHandler(handler: (req: any, res: any) => Promise<any>, req: any, body: any): Promise<any> {
  let statusCode = 200;
  let payload: any = null;
  const captureResponse: any = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(value: any) {
      payload = value;
      return this;
    },
    send(value: any) {
      payload = value;
      return this;
    },
  };
  await handler({ ...req, body }, captureResponse);
  if (statusCode >= 400) {
    throw new Error(payload?.message ?? `Migration handler failed with status ${statusCode}`);
  }
  return payload;
}

async function harmfulTargetActivity(targetId: number, activatedAt?: string | null): Promise<any> {
  const after = activatedAt ? sql`AND created_at > ${activatedAt}` : sql``;
  const vouchers = await db.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM vouchers
    WHERE company_id = ${targetId}
      AND deleted_at IS NULL
      AND COALESCE(source_module, 'ERP') NOT IN ('SP_MIGRATION', 'SP_MIGRATION_READONLY')
      AND voucher_number NOT LIKE ${`OB-${targetId}-%`}
      ${after}
  `);
  const sales = await db.execute(sql`
    SELECT COUNT(*)::int AS count FROM sp_sales
    WHERE company_id = ${targetId} ${after}
  `);
  const offloads = await db.execute(sql`
    SELECT COUNT(*)::int AS count FROM sp_offloads
    WHERE company_id = ${targetId} ${after}
  `);
  const prepaid = await db.execute(sql`
    SELECT COUNT(*)::int AS count FROM sp_prepaid_charges
    WHERE company_id = ${targetId} ${after}
  `);
  const containers = await db.execute(sql`
    SELECT COUNT(*)::int AS count FROM sp_containers
    WHERE company_id = ${targetId}
      AND COALESCE(notes, '') NOT ILIKE '%migrated from%erp container%'
      ${after}
  `);
  const counts = {
    vouchers: pn((vouchers as any).rows?.[0]?.count),
    sales: pn((sales as any).rows?.[0]?.count),
    offloads: pn((offloads as any).rows?.[0]?.count),
    prepaid: pn((prepaid as any).rows?.[0]?.count),
    containers: pn((containers as any).rows?.[0]?.count),
  };
  return { ...counts, total: Object.values(counts).reduce((sum, value) => sum + value, 0) };
}

async function normalizedReadiness(sourceId: number, targetId: number): Promise<any> {
  const readiness = await buildCutoverReadiness(sourceId, targetId);
  const activity = await harmfulTargetActivity(targetId);
  readiness.blockers = (readiness.blockers ?? []).filter((blocker: any) => blocker.code !== "TARGET_ALREADY_LIVE");
  readiness.counts.targetLiveActivity = activity.total;
  if (activity.total > 0) {
    readiness.blockers.push({
      code: "TARGET_ALREADY_LIVE",
      message: `Target contains ${activity.total} live transaction(s) outside the migration.`,
      count: activity.total,
      detail: activity,
    });
  }
  readiness.canPrepare = readiness.blockers.length === 0;
  readiness.canFinalize = readiness.blockers.length === 0 && (readiness.deltas ?? []).length === 0;
  return readiness;
}

async function loadCutoverById(cutoverId: number): Promise<any | null> {
  const result = await db.execute(sql`
    SELECT * FROM sp_migration_cutovers WHERE id = ${cutoverId} LIMIT 1
  `);
  return (result as any).rows?.[0] ?? null;
}

async function prepareCutover(req: any, res: any): Promise<any> {
  const pair = await validateMigrationPair(req, res, false);
  if (!pair) return;
  const confirmationError = exactConfirmation(req, "PREPARE CUTOVER", pair.sourceCompany.name);
  if (confirmationError) return res.status(400).json({ message: confirmationError });

  await ensureCutoverColumns();
  const existing = await getLiveCutover(pair.sourceId, pair.targetId);
  if (existing) {
    return res.status(409).json({ message: `Cutover ${existing.id} is already ${existing.status}.`, cutover: existing });
  }

  const readiness = await normalizedReadiness(pair.sourceId, pair.targetId);
  if (!readiness.canPrepare) {
    return res.status(409).json({
      message: "Cutover preparation is blocked. Resolve all hard blockers first.",
      readiness,
    });
  }

  const rollbackWindowHours = Math.min(168, Math.max(1, pn(req.body?.rollbackWindowHours) || 72));
  const inserted = await db.execute(sql`
    INSERT INTO sp_migration_cutovers
      (source_company_id, target_company_id, status, prepared_by,
       source_company_name, target_company_name, readiness_snapshot,
       rollback_window_hours, notes)
    VALUES
      (${pair.sourceId}, ${pair.targetId}, 'prepared', ${req.session?.userId ?? null},
       ${pair.sourceCompany.name}, ${pair.targetCompany.name}, ${JSON.stringify(readiness)}::jsonb,
       ${rollbackWindowHours}, ${req.body?.notes ?? null})
    RETURNING *
  `);
  invalidateCutoverLockCache();
  return res.json({
    success: true,
    message: "Source and target are now locked for final synchronization.",
    cutover: (inserted as any).rows[0],
    readiness,
  });
}

async function finalizeCutover(req: any, res: any): Promise<any> {
  const pair = await validateMigrationPair(req, res, false);
  if (!pair) return;
  const confirmationError = exactConfirmation(req, "FINALIZE CUTOVER", pair.sourceCompany.name);
  if (confirmationError) return res.status(400).json({ message: confirmationError });

  await ensureCutoverColumns();
  const live = await getLiveCutover(pair.sourceId, pair.targetId);
  if (!live || live.status !== "prepared") {
    return res.status(409).json({ message: "Prepare and lock this source/target pair before finalizing." });
  }

  const claimed = await db.execute(sql`
    UPDATE sp_migration_cutovers
    SET finalize_started_at = now(), failure_message = NULL, updated_at = now()
    WHERE id = ${pn(live.id)}
      AND status = 'prepared'
      AND finalize_started_at IS NULL
    RETURNING id
  `);
  if (!(claimed as any).rows?.[0]) {
    return res.status(409).json({ message: "Cutover finalization is already running or awaiting repair." });
  }

  try {
    const migrationBody = {
      sourceCompanyId: pair.sourceId,
      targetCompanyId: pair.targetId,
      companyNameConfirm: pair.sourceCompany.name,
      confirmation: "MIGRATE",
    };
    const salesDelta = await invokeMigrationHandler(importHistoricalSales, req, migrationBody);
    const containerDelta = await invokeMigrationHandler(importContainers, req, migrationBody);
    const stockDelta = await synchronizeCutoverStock(pn(live.id), pair.sourceId, pair.targetId);

    const readiness = await normalizedReadiness(pair.sourceId, pair.targetId);
    if (!readiness.canFinalize) {
      await db.execute(sql`
        UPDATE sp_migration_cutovers
        SET finalize_started_at = NULL,
            failure_message = 'Final readiness did not pass after delta synchronization',
            delta_summary = ${JSON.stringify({ salesDelta, containerDelta, stockDelta })}::jsonb,
            final_readiness_snapshot = ${JSON.stringify(readiness)}::jsonb,
            updated_at = now()
        WHERE id = ${pn(live.id)}
      `);
      return res.status(409).json({
        message: "Final delta synchronization completed, but review items remain. Resolve them while both companies stay locked, then finalize again.",
        cutoverId: pn(live.id),
        deltaSummary: { salesDelta, containerDelta, stockDelta },
        readiness,
      });
    }

    const roleSummary = await moveUsersToTarget(
      pn(live.id),
      pair.sourceId,
      pair.targetId,
      pair.targetCompany.name
    );
    const rollbackWindowHours = pn(live.rollback_window_hours) || 72;
    const activated = await db.execute(sql`
      UPDATE sp_migration_cutovers
      SET status = 'active',
          activated_by = ${req.session?.userId ?? null},
          activated_at = now(),
          rollback_deadline = now() + (${rollbackWindowHours} || ' hours')::interval,
          delta_summary = ${JSON.stringify({ salesDelta, containerDelta, stockDelta })}::jsonb,
          role_summary = ${JSON.stringify(roleSummary)}::jsonb,
          final_readiness_snapshot = ${JSON.stringify(readiness)}::jsonb,
          finalize_started_at = NULL,
          failure_message = NULL,
          updated_at = now()
      WHERE id = ${pn(live.id)} AND status = 'prepared'
      RETURNING *
    `);
    invalidateCutoverLockCache();
    return res.json({
      success: true,
      message: "Supplier Partner cutover is active. The old ERP company is now permanently read-only unless the controlled rollback is used.",
      cutover: (activated as any).rows[0],
      deltaSummary: { salesDelta, containerDelta, stockDelta },
      roleSummary,
      readiness,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.execute(sql`
      UPDATE sp_migration_cutovers
      SET finalize_started_at = NULL, failure_message = ${message}, updated_at = now()
      WHERE id = ${pn(live.id)}
    `).catch(() => undefined);
    logger.error("[SP Cutover] Finalization failed", { error, cutoverId: live.id });
    return res.status(500).json({ message: `Cutover finalization failed: ${message}`, cutoverId: pn(live.id) });
  }
}

async function rollbackCutover(req: any, res: any): Promise<any> {
  const cutoverId = pn(req.body?.cutoverId);
  if (!cutoverId) return res.status(400).json({ message: "cutoverId is required" });
  await ensureCutoverColumns();
  const cutover = await loadCutoverById(cutoverId);
  if (!cutover) return res.status(404).json({ message: "Cutover not found" });
  if (cutover.status !== "active") return res.status(409).json({ message: "Only an active cutover can be rolled back." });
  const confirmationError = exactConfirmation(req, "ROLLBACK CUTOVER", cutover.source_company_name);
  if (confirmationError) return res.status(400).json({ message: confirmationError });
  if (!cutover.rollback_deadline || new Date(cutover.rollback_deadline).getTime() < Date.now()) {
    return res.status(409).json({ message: "The controlled rollback window has expired." });
  }

  const activity = await harmfulTargetActivity(pn(cutover.target_company_id), cutover.activated_at);
  if (activity.total > 0) {
    return res.status(409).json({
      message: "Rollback is blocked because the Supplier Partner company has live post-cutover activity.",
      activity,
    });
  }

  const userRestore = await restoreUsersToSource(
    cutoverId,
    pn(cutover.source_company_id),
    pn(cutover.target_company_id),
    cutover.source_company_name
  );
  const stockRestore = await restoreCutoverStock(cutoverId, pn(cutover.target_company_id));
  const rolledBack = await db.execute(sql`
    UPDATE sp_migration_cutovers
    SET status = 'rolled_back', rolled_back_by = ${req.session?.userId ?? null},
        rolled_back_at = now(), updated_at = now()
    WHERE id = ${cutoverId} AND status = 'active'
    RETURNING *
  `);
  invalidateCutoverLockCache();
  return res.json({
    success: true,
    message: "Operational cutover rolled back. Source users and pre-cutover target inventory were restored.",
    cutover: (rolledBack as any).rows[0],
    userRestore,
    stockRestore,
  });
}

async function cancelPreparedCutover(req: any, res: any): Promise<any> {
  const cutoverId = pn(req.body?.cutoverId);
  if (!cutoverId) return res.status(400).json({ message: "cutoverId is required" });
  await ensureCutoverColumns();
  const cutover = await loadCutoverById(cutoverId);
  if (!cutover) return res.status(404).json({ message: "Cutover not found" });
  if (cutover.status !== "prepared") return res.status(409).json({ message: "Only a prepared cutover can be cancelled." });
  const confirmationError = exactConfirmation(req, "CANCEL CUTOVER", cutover.source_company_name);
  if (confirmationError) return res.status(400).json({ message: confirmationError });

  const stockRestore = await restoreCutoverStock(cutoverId, pn(cutover.target_company_id));
  const cancelled = await db.execute(sql`
    UPDATE sp_migration_cutovers
    SET status = 'cancelled', cancelled_at = now(), finalize_started_at = NULL, updated_at = now()
    WHERE id = ${cutoverId} AND status = 'prepared'
    RETURNING *
  `);
  invalidateCutoverLockCache();
  return res.json({
    success: true,
    message: "Prepared cutover cancelled; company write locks were removed.",
    cutover: (cancelled as any).rows[0],
    stockRestore,
  });
}

async function statusCutover(req: any, res: any): Promise<any> {
  const pair = await validateMigrationPair(req, res, false);
  if (!pair) return;
  await ensureCutoverColumns();
  const live = await getLiveCutover(pair.sourceId, pair.targetId);
  const latestResult = await db.execute(sql`
    SELECT * FROM sp_migration_cutovers
    WHERE source_company_id = ${pair.sourceId} AND target_company_id = ${pair.targetId}
    ORDER BY id DESC LIMIT 1
  `);
  return res.json({
    liveCutover: live,
    latestCutover: (latestResult as any).rows?.[0] ?? null,
    readiness: await normalizedReadiness(pair.sourceId, pair.targetId),
  });
}

async function mapSuspenseEntry(req: any, res: any): Promise<any> {
  const pair = await validateMigrationPair(req, res, false);
  if (!pair) return;
  const targetEntryId = pn(req.params.targetEntryId);
  const targetLedgerAccountId = pn(req.body?.targetLedgerAccountId);
  if (!targetEntryId || !targetLedgerAccountId) {
    return res.status(400).json({ message: "targetEntryId and targetLedgerAccountId are required" });
  }
  const targetAccount = await db.execute(sql`
    SELECT id FROM ledger_accounts
    WHERE id = ${targetLedgerAccountId} AND company_id = ${pair.targetId} AND deleted_at IS NULL
    LIMIT 1
  `);
  if (!(targetAccount as any).rows?.[0]) return res.status(400).json({ message: "Target account does not belong to the target company." });

  const updated = await db.execute(sql`
    UPDATE voucher_entries e
    SET ledger_account_id = ${targetLedgerAccountId}
    FROM vouchers v, ledger_accounts suspense
    WHERE e.id = ${targetEntryId}
      AND v.id = e.voucher_id
      AND v.company_id = ${pair.targetId}
      AND suspense.id = e.ledger_account_id
      AND suspense.company_id = ${pair.targetId}
      AND suspense.sub_type = 'gc_mig_suspense'
    RETURNING e.id
  `);
  if (!(updated as any).rows?.[0]) return res.status(404).json({ message: "Suspense entry was not found or is already mapped." });
  return res.json({ success: true, targetEntryId, targetLedgerAccountId });
}

async function mapContainerCharge(req: any, res: any): Promise<any> {
  const pair = await validateMigrationPair(req, res, false);
  if (!pair) return;
  const chargeId = pn(req.params.chargeId);
  const targetLedgerAccountId = pn(req.body?.targetLedgerAccountId);
  if (!chargeId || !targetLedgerAccountId) {
    return res.status(400).json({ message: "chargeId and targetLedgerAccountId are required" });
  }
  const updated = await db.execute(sql`
    UPDATE sp_migration_container_charges m
    SET target_ledger_account_id = a.id,
        mapping_method = 'manual_approval',
        review_status = 'mapped',
        notes = trim(COALESCE(m.notes, '') || ' Manually approved during cutover review.')
    FROM ledger_accounts a
    WHERE m.id = ${chargeId}
      AND m.source_company_id = ${pair.sourceId}
      AND m.target_company_id = ${pair.targetId}
      AND a.id = ${targetLedgerAccountId}
      AND a.company_id = ${pair.targetId}
      AND a.deleted_at IS NULL
    RETURNING m.id
  `);
  if (!(updated as any).rows?.[0]) return res.status(404).json({ message: "Charge review row or target account was not found." });
  return res.json({ success: true, chargeId, targetLedgerAccountId });
}

export function registerSpMigrationCutoverRoutes(app: Express): void {
  installCutoverWriteGuard(app);
  void ensureCutoverColumns().catch((error) => {
    logger.warn("[SP Cutover] Schema setup deferred", { error: error instanceof Error ? error.message : String(error) });
  });

  const developer = [requireAuth, requireRole("Developer")] as const;
  app.get("/api/sp/migration/cutover", ...developer, statusCutover);
  app.get("/api/sp/migration/cutover/status", ...developer, statusCutover);
  app.post("/api/sp/migration/cutover/prepare", ...developer, prepareCutover);
  app.post("/api/sp/migration/cutover/finalize", ...developer, finalizeCutover);
  app.post("/api/sp/migration/cutover/rollback", ...developer, rollbackCutover);
  app.post("/api/sp/migration/cutover/cancel", ...developer, cancelPreparedCutover);

  // Compatibility endpoint replacing the previous hard-disabled POST /cutover.
  app.post("/api/sp/migration/cutover", ...developer, async (req: any, res: any) => {
    if (req.body?.action === "prepare") return prepareCutover(req, res);
    if (req.body?.action === "finalize") return finalizeCutover(req, res);
    if (req.body?.action === "rollback") return rollbackCutover(req, res);
    if (req.body?.action === "cancel") return cancelPreparedCutover(req, res);
    return res.status(400).json({ message: "action must be prepare, finalize, rollback, or cancel" });
  });

  app.post(
    "/api/sp/migration/gc-suspense-review/:targetEntryId/map",
    ...developer,
    mapSuspenseEntry
  );
  app.post(
    "/api/sp/migration/gc-container-charge-review/:chargeId/map",
    ...developer,
    mapContainerCharge
  );
}
