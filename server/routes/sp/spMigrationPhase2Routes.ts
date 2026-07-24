import type { Express } from "express";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { logger } from "../../lib/logger";
import { requireAuth, requireRole } from "../../auth";
import {
  ensurePhase2Schema,
  getSuspenseReview,
  pn,
  validateMigrationPair,
} from "./spMigrationPhase2Common";
import { importHistoricalSales } from "./spMigrationPhase2Sales";
import { importContainers } from "./spMigrationPhase2Containers";

async function rollbackMigrationRun(req: any, res: any): Promise<any> {
  const runId = String(req.body?.runId ?? "");
  if (!runId) return res.status(400).json({ message: "runId is required" });
  if (req.body?.confirmation && req.body.confirmation !== "ROLLBACK") {
    return res.status(400).json({ message: "Invalid rollback confirmation" });
  }

  await ensurePhase2Schema();
  const runResult = await db.execute(sql`
    SELECT id, source_company_id, target_company_id, status
    FROM sp_migration_rehearsal_runs
    WHERE id = ${runId}
    LIMIT 1
  `);
  const run = (runResult as any).rows?.[0];
  if (!run) return res.status(404).json({ message: "Migration run not found" });
  if (run.status === "rolled_back") return res.status(409).json({ message: "Run is already rolled back" });
  if (run.status === "running") return res.status(409).json({ message: "A running migration cannot be rolled back" });

  const targetId = pn(run.target_company_id);
  const sourceId = pn(run.source_company_id);
  if (!targetId || targetId === sourceId) {
    return res.status(400).json({ message: "Rollback safety check failed" });
  }

  const trackedResult = await db.execute(sql`
    SELECT table_name, row_id
    FROM sp_migration_run_rows
    WHERE run_id = ${runId}
    ORDER BY id DESC
  `);
  const grouped = new Map<string, number[]>();
  for (const row of (trackedResult as any).rows ?? []) {
    grouped.set(row.table_name, [...(grouped.get(row.table_name) ?? []), pn(row.row_id)]);
  }

  const tableOrder = [
    "sales_items",
    "sp_offload_charges",
    "sp_offloads",
    "sp_prepaid_charges",
    "voucher_entries",
    "vouchers",
    "sp_container_lines",
    "sp_containers",
    "ledger_accounts",
    "inventory",
    "sp_stock_movements",
    "stock_item_code_aliases",
    "stock_items",
    "stock_groups",
    "stock_grades",
    "stock_categories",
    "locations",
  ];

  async function belongsToTarget(table: string, id: number): Promise<boolean> {
    const directCompanyTables = new Set([
      "sp_offload_charges",
      "sp_offloads",
      "sp_prepaid_charges",
      "vouchers",
      "sp_container_lines",
      "sp_containers",
      "ledger_accounts",
      "inventory",
      "sp_stock_movements",
      "stock_item_code_aliases",
      "stock_items",
      "stock_groups",
      "stock_grades",
      "stock_categories",
      "locations",
    ]);

    if (directCompanyTables.has(table)) {
      const result = await db.execute(sql.raw(`SELECT company_id FROM ${table} WHERE id = ${id} LIMIT 1`));
      return pn((result as any).rows?.[0]?.company_id) === targetId;
    }
    if (table === "voucher_entries") {
      const result = await db.execute(sql`
        SELECT v.company_id
        FROM voucher_entries e
        JOIN vouchers v ON v.id = e.voucher_id
        WHERE e.id = ${id}
        LIMIT 1
      `);
      return pn((result as any).rows?.[0]?.company_id) === targetId;
    }
    if (table === "sales_items") {
      const result = await db.execute(sql`
        SELECT v.company_id
        FROM sales_items i
        JOIN vouchers v ON v.id = i.voucher_id
        WHERE i.id = ${id}
        LIMIT 1
      `);
      return pn((result as any).rows?.[0]?.company_id) === targetId;
    }
    return false;
  }

  let deleted = 0;
  for (const table of tableOrder) {
    for (const id of grouped.get(table) ?? []) {
      if (!(await belongsToTarget(table, id))) {
        logger.warn("[SP Phase 2 Rollback] Row skipped because target ownership could not be verified", {
          runId,
          table,
          id,
          targetId,
        });
        continue;
      }
      await db.execute(sql.raw(`DELETE FROM ${table} WHERE id = ${id}`));
      deleted++;
    }
  }

  await db.execute(sql`DELETE FROM sp_migration_container_charges WHERE run_id = ${runId}`);
  await db.execute(sql`DELETE FROM sp_migration_source_links WHERE run_id = ${runId}`);
  await db.execute(sql`
    UPDATE sp_migration_rehearsal_runs
    SET status = 'rolled_back', completed_at = now(),
        notes = COALESCE(notes, '') || ' | ROLLED BACK'
    WHERE id = ${runId}
  `);

  return res.json({ success: true, runId, rowsDeleted: deleted });
}

export function registerSpMigrationPhase2Routes(app: Express): void {
  void ensurePhase2Schema().catch((error) => {
    logger.warn("[SP Phase 2] Charge-review schema creation deferred until migration is used", {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  // registerSpRoutes runs before the legacy migration router, so these focused
  // handlers replace the older incomplete Step 6/7 and rollback implementations.
  app.post(
    "/api/sp/migration/gc-sales-readonly",
    requireAuth,
    requireRole("Developer"),
    importHistoricalSales
  );
  app.post("/api/sp/migration/gc-containers", requireAuth, requireRole("Developer"), importContainers);
  app.post("/api/sp/migration/rollback", requireAuth, requireRole("Developer"), rollbackMigrationRun);

  app.get(
    "/api/sp/migration/gc-suspense-review",
    requireAuth,
    requireRole("Developer"),
    async (req: any, res: any) => {
      try {
        const pair = await validateMigrationPair(req, res, false);
        if (!pair) return;
        return res.json(await getSuspenseReview(pair.sourceId, pair.targetId));
      } catch (error) {
        logger.error("[SP Phase 2] Suspense review failed", { error });
        return res.status(500).json({ message: "Failed to load migration suspense review" });
      }
    }
  );

  app.get(
    "/api/sp/migration/gc-container-charge-review",
    requireAuth,
    requireRole("Developer"),
    async (req: any, res: any) => {
      try {
        const pair = await validateMigrationPair(req, res, false);
        if (!pair) return;
        await ensurePhase2Schema();
        const result = await db.execute(sql`
          SELECT m.*, a.code AS target_account_code, a.name AS target_account_name
          FROM sp_migration_container_charges m
          JOIN sp_migration_rehearsal_runs r ON r.id = m.run_id
          LEFT JOIN ledger_accounts a ON a.id = m.target_ledger_account_id
          WHERE m.source_company_id = ${pair.sourceId}
            AND m.target_company_id = ${pair.targetId}
            AND r.status <> 'rolled_back'
          ORDER BY m.review_status DESC, m.source_container_id ASC, m.id ASC
        `);
        const items = (result as any).rows ?? [];
        return res.json({
          count: items.length,
          mapped: items.filter((item: any) => item.review_status === "mapped").length,
          review: items.filter((item: any) => item.review_status === "review").length,
          unmapped: items.filter((item: any) => item.review_status === "unmapped").length,
          totalAmountUsd: items.reduce((sum: number, item: any) => sum + pn(item.amount_usd), 0),
          items,
        });
      } catch (error) {
        logger.error("[SP Phase 2] Container charge review failed", { error });
        return res.status(500).json({ message: "Failed to load migrated container charge review" });
      }
    }
  );
}
