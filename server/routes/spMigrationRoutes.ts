/**
 * SP Migration Rehearsal Routes
 *
 * Safety guarantees enforced here (server-side):
 * 1. Source company must be type 'erp' — never supplier_partner
 * 2. Target company must be type 'supplier_partner'
 * 3. Source ≠ Target
 * 4. Typed confirmation "REHEARSE" required for any write
 * 5. Source name must match typed companyNameConfirm exactly
 * 6. Every attempt is logged to sp_migration_rehearsal_runs
 * 7. Rollback only deletes rows tracked in sp_migration_run_rows
 * 8. NO /cutover endpoint exists — blocked by absence
 */

import type { Express } from "express";
import { logger } from "../lib/logger";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../auth";
import { ledgerAccounts, locations } from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";

const pn = (v: any) => {
  const n = parseFloat(String(v ?? "0"));
  return isNaN(n) ? 0 : n;
};

// ── SP chart of accounts (same list as spRoutes.ts) ──────────────────────────
const SP_ACCOUNTS = [
  { code: "SP-OTW", name: "Goods On The Way", accountType: "Asset", subType: "sp_goods_otw" },
  { code: "SP-OTWCLR", name: "Goods OTW Clearing", accountType: "Liability", subType: "sp_otw_clearing" },
  { code: "SP-PREPAID", name: "Prepaid Charges", accountType: "Asset", subType: "sp_prepaid" },
  { code: "SP-STOCK", name: "Stock on Floor", accountType: "Asset", subType: "sp_stock" },
  { code: "SP-COSTCLR", name: "Stock Cost Payable Clearing", accountType: "Liability", subType: "sp_cost_clearing" },
  { code: "SP-PAYDED", name: "Pay Deduction Clearing", accountType: "Liability", subType: "sp_pay_deduction_clearing" },
  { code: "SP-PAY", name: "Supplier Cash Payable", accountType: "Liability", subType: "sp_payable" },
  { code: "SP-SALES", name: "Sales", accountType: "Income", subType: "sp_sales" },
  { code: "SP-COGS", name: "Cost of Goods Sold", accountType: "Direct Expense", subType: "sp_cogs" },
  { code: "SP-SHARED", name: "Shared Charges", accountType: "Direct Expense", subType: "sp_shared_charges" },
  { code: "SP-OPNBAL", name: "Opening Balance Clearing", accountType: "Equity", subType: "sp_opnbal" },
  { code: "SP-PREPEXP", name: "Prepaid Expenses", accountType: "Asset", subType: "sp_prepaid_expenses" },
  { code: "SP-HADIIC", name: "HADI Intercompany", accountType: "Intercompany", subType: "sp_hadi_intercompany" },
];

// GC-specific profit-share accounts (created during the GC migration, not the base SP set)
const GC_PROFIT_ACCOUNTS = [
  { code: "GC-OURPFT", name: "GC Our Profit Share", accountType: "Equity", subType: "gc_our_profit_share" },
  { code: "GC-SUPPFT", name: "GC Supplier Profit Share", accountType: "Equity", subType: "gc_supplier_profit_share" },
  {
    code: "GC-PROFCLR",
    name: "GC Accumulated Profit Clearing",
    accountType: "Equity",
    subType: "gc_accumulated_profit_clearing",
  },
];

// Legacy subTypes created by earlier versions of this tool — kept for account-mapping
// backward compatibility only; no longer created by default.
const LEGACY_GC_PROFIT_SUBTYPES = ["gc_owner_profit", "gc_supplier_profit"];

// Whitelist of subTypes the rename/create-accounts endpoint is allowed to create.
const ALL_ACCOUNT_DEFS = [...SP_ACCOUNTS, ...GC_PROFIT_ACCOUNTS];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getCompanyRow(companyId: number) {
  const rows = await db.execute(
    sql`SELECT id, code, name, company_type FROM companies WHERE id = ${companyId} LIMIT 1`
  );
  return (rows as any).rows?.[0] ?? (rows as any)[0] ?? null;
}

async function logRun(
  sourceId: number,
  targetId: number,
  action: string,
  status: string,
  rowsCreated: number,
  errorMessage: string | null,
  notes: string | null
): Promise<string> {
  const [row] = (
    await db.execute(sql`
    INSERT INTO sp_migration_rehearsal_runs
      (source_company_id, target_company_id, action, status, rows_created, error_message, notes)
    VALUES
      (${sourceId}, ${targetId}, ${action}, ${status}, ${rowsCreated}, ${errorMessage}, ${notes})
    RETURNING id
  `)
  ).rows as any[];
  return row.id;
}

async function trackRow(runId: string, tableName: string, rowId: number) {
  await db.execute(sql`
    INSERT INTO sp_migration_run_rows (run_id, table_name, row_id)
    VALUES (${runId}, ${tableName}, ${rowId})
  `);
}

// Map of dependent action -> action(s) that must have a 'completed' run for this
// target company before the dependent action is allowed to run.
const MIGRATION_ACTION_DEPENDENCIES: Record<string, string[]> = {
  gc_stock_opening: ["gc_stock_master"],
  gc_sales_readonly: ["gc_stock_opening"],
  gc_containers: ["gc_stock_opening"],
};

// Enforced server-side (not just UI) staged-dependency guard. Returns null if the
// dependency is satisfied, or an error message string describing what must run first.
async function requireCompletedMigrationAction(
  sourceCompanyId: number,
  targetCompanyId: number,
  actionName: string
): Promise<string | null> {
  const deps = MIGRATION_ACTION_DEPENDENCIES[actionName];
  if (!deps || !deps.length) return null;
  const ACTION_LABELS: Record<string, string> = {
    gc_stock_master: "Step 4 — Stock Master",
    gc_stock_opening: "Step 5 — Stock Opening by Location",
    gc_sales_readonly: "Step 6 — Historical Sales",
    gc_containers: "Step 7 — Containers",
  };
  for (const dep of deps) {
    // Scoped to the exact (source, target) pair — a completed run for a different
    // source company into the same target must NOT satisfy this dependency.
    const row = (
      await db.execute(sql`
      SELECT id FROM sp_migration_rehearsal_runs
      WHERE source_company_id = ${sourceCompanyId} AND target_company_id = ${targetCompanyId}
        AND action = ${dep} AND status = 'completed'
      ORDER BY id DESC LIMIT 1
    `)
    ).rows?.[0] as any;
    if (!row) {
      return `Run ${ACTION_LABELS[dep] ?? dep} successfully before running ${ACTION_LABELS[actionName] ?? actionName}.`;
    }
  }
  return null;
}

async function ensureSpAccounts(
  targetId: number,
  overrides?: Record<string, { code?: string; name?: string }>
): Promise<{ names: string[]; newIds: number[] }> {
  const names: string[] = [];
  const newIds: number[] = [];
  for (const acct of SP_ACCOUNTS) {
    const existing = await db
      .select()
      .from(ledgerAccounts)
      .where(
        and(
          eq(ledgerAccounts.companyId, targetId),
          eq(ledgerAccounts.subType, acct.subType),
          isNull(ledgerAccounts.deletedAt)
        )
      );
    if (!existing.length) {
      const code = overrides?.[acct.subType]?.code?.trim() || acct.code;
      const name = overrides?.[acct.subType]?.name?.trim() || acct.name;
      const [row] = (
        await db.execute(sql`
        INSERT INTO ledger_accounts (company_id, code, name, account_type, sub_type, is_hidden, active)
        VALUES (${targetId}, ${code}, ${name}, ${acct.accountType}, ${acct.subType},
                ${acct.subType.includes("clearing") || acct.subType === "sp_opnbal"}, true)
        RETURNING id
      `)
      ).rows as any[];
      names.push(name);
      newIds.push(pn(row.id));
    }
  }
  return { names, newIds };
}

// Create the GC profit-share accounts (or reuse existing ones), honoring user renames.
async function ensureGcProfitAccounts(
  targetId: number,
  overrides?: Record<string, { code?: string; name?: string }>
): Promise<{ names: string[]; newIds: number[] }> {
  const names: string[] = [];
  const newIds: number[] = [];
  for (const acct of GC_PROFIT_ACCOUNTS) {
    const existing = (
      await db.execute(sql`
      SELECT id FROM ledger_accounts
      WHERE company_id = ${targetId} AND sub_type = ${acct.subType} AND deleted_at IS NULL LIMIT 1
    `)
    ).rows[0] as any;
    if (!existing) {
      const code = overrides?.[acct.subType]?.code?.trim() || acct.code;
      const name = overrides?.[acct.subType]?.name?.trim() || acct.name;
      const [row] = (
        await db.execute(sql`
        INSERT INTO ledger_accounts (company_id, code, name, account_type, sub_type, active)
        VALUES (${targetId}, ${code}, ${name}, ${acct.accountType}, ${acct.subType}, true)
        RETURNING id
      `)
      ).rows as any[];
      names.push(name);
      newIds.push(pn(row.id));
    }
  }
  return { names, newIds };
}

// ── Stock master migration (creates REAL target-company stock_items, never reuses source IDs) ──
async function ensureTargetStockItems(
  sourceId: number,
  targetId: number,
  runId: string
): Promise<{
  map: Map<number, number>;
  groupsCreated: number;
  gradesCreated: number;
  categoriesCreated: number;
  itemsCreated: number;
  itemsReused: number;
}> {
  const map = new Map<number, number>();
  let groupsCreated = 0;
  let gradesCreated = 0;
  let categoriesCreated = 0;
  let itemsCreated = 0;
  let itemsReused = 0;

  // 1. Stock groups — mirror by code
  const groupMap = new Map<number, number>();
  const sourceGroups = (
    await db.execute(sql`
    SELECT id, code, name FROM stock_groups WHERE company_id = ${sourceId} AND deleted_at IS NULL
  `)
  ).rows as any[];
  for (const g of sourceGroups) {
    const existingGroup = (
      await db.execute(sql`
      SELECT id FROM stock_groups WHERE company_id = ${targetId} AND code = ${g.code} AND deleted_at IS NULL LIMIT 1
    `)
    ).rows[0] as any;
    if (existingGroup) {
      groupMap.set(pn(g.id), pn(existingGroup.id));
    } else {
      const [row] = (
        await db.execute(sql`
        INSERT INTO stock_groups (company_id, code, name, active)
        VALUES (${targetId}, ${g.code}, ${g.name}, true)
        RETURNING id
      `)
      ).rows as any[];
      const newGroupId = pn(row.id);
      groupMap.set(pn(g.id), newGroupId);
      await trackRow(runId, "stock_groups", newGroupId);
      await db.execute(sql`
        INSERT INTO sp_migration_source_links (run_id, source_table, source_id, target_table, target_id)
        VALUES (${runId}, 'stock_groups', ${pn(g.id)}, 'stock_groups', ${newGroupId})
      `);
      groupsCreated++;
    }
  }

  // 1b. Stock grades / categories — mirror by name (both tables are simple name+active lookups)
  const gradeMap = new Map<number, number>();
  const sourceGrades = (
    // Mirror ALL grades referenced by source items with positive inventory (not just active ones) so
    // grade_id on a migrated item never silently drops to null just because the grade was deactivated.
    await db.execute(sql`
      SELECT DISTINCT g.id, g.name FROM stock_grades g
      WHERE g.company_id = ${sourceId}
        AND (g.active = true OR g.id IN (
          SELECT si.grade_id FROM stock_items si
          JOIN inventory inv ON inv.stock_item_id = si.id AND inv.company_id = ${sourceId}
          WHERE si.company_id = ${sourceId} AND si.deleted_at IS NULL AND inv.quantity > 0 AND si.grade_id IS NOT NULL
        ))
    `)
  ).rows as any[];
  for (const g of sourceGrades) {
    const existingGrade = (
      await db.execute(sql`SELECT id FROM stock_grades WHERE company_id = ${targetId} AND name = ${g.name} LIMIT 1`)
    ).rows[0] as any;
    if (existingGrade) {
      gradeMap.set(pn(g.id), pn(existingGrade.id));
    } else {
      const [row] = (
        await db.execute(sql`INSERT INTO stock_grades (company_id, name, active) VALUES (${targetId}, ${g.name}, true) RETURNING id`)
      ).rows as any[];
      const newGradeId = pn(row.id);
      gradeMap.set(pn(g.id), newGradeId);
      await trackRow(runId, "stock_grades", newGradeId);
      gradesCreated++;
    }
  }

  const categoryMap = new Map<number, number>();
  const sourceCategories = (
    // Same rationale as grades above — include inactive categories still referenced by migratable items.
    await db.execute(sql`
      SELECT DISTINCT c.id, c.name FROM stock_categories c
      WHERE c.company_id = ${sourceId}
        AND (c.active = true OR c.id IN (
          SELECT si.category_id FROM stock_items si
          JOIN inventory inv ON inv.stock_item_id = si.id AND inv.company_id = ${sourceId}
          WHERE si.company_id = ${sourceId} AND si.deleted_at IS NULL AND inv.quantity > 0 AND si.category_id IS NOT NULL
        ))
    `)
  ).rows as any[];
  for (const c of sourceCategories) {
    const existingCategory = (
      await db.execute(sql`SELECT id FROM stock_categories WHERE company_id = ${targetId} AND name = ${c.name} LIMIT 1`)
    ).rows[0] as any;
    if (existingCategory) {
      categoryMap.set(pn(c.id), pn(existingCategory.id));
    } else {
      const [row] = (
        await db.execute(sql`INSERT INTO stock_categories (company_id, name, active) VALUES (${targetId}, ${c.name}, true) RETURNING id`)
      ).rows as any[];
      const newCategoryId = pn(row.id);
      categoryMap.set(pn(c.id), newCategoryId);
      await trackRow(runId, "stock_categories", newCategoryId);
      categoriesCreated++;
    }
  }

  // 2. Stock items with positive inventory in source
  const sourceItems = (
    await db.execute(sql`
    SELECT si.id, si.code, si.name, si.uom, si.stock_group_id, si.grade_id, si.category_id,
           si.opening_qty, si.opening_rate, si.opening_value, si.reorder_level, si.selling_price, si.active
    FROM stock_items si
    JOIN inventory inv ON inv.stock_item_id = si.id AND inv.company_id = ${sourceId}
    WHERE si.company_id = ${sourceId} AND si.deleted_at IS NULL AND inv.quantity > 0
    ORDER BY si.code
  `)
  ).rows as any[];

  for (const item of sourceItems) {
    const srcId = pn(item.id);

    // Already linked by a prior run?
    const priorLink = (
      await db.execute(sql`
      SELECT target_id FROM sp_migration_source_links
      WHERE source_table = 'stock_items' AND source_id = ${srcId} AND target_table = 'stock_items'
      LIMIT 1
    `)
    ).rows[0] as any;
    if (priorLink) {
      // Verify it still exists in target (defensive — should always be true)
      const stillExists = (
        await db.execute(sql`
        SELECT id FROM stock_items WHERE id = ${pn(priorLink.target_id)} AND company_id = ${targetId} AND deleted_at IS NULL LIMIT 1
      `)
      ).rows[0] as any;
      if (stillExists) {
        map.set(srcId, pn(priorLink.target_id));
        itemsReused++;
        continue;
      }
    }

    // Fall back to matching by code (handles manual pre-existing target items)
    const existingByCode = (
      await db.execute(sql`
      SELECT id FROM stock_items WHERE company_id = ${targetId} AND code = ${item.code} AND deleted_at IS NULL LIMIT 1
    `)
    ).rows[0] as any;

    let targetItemId: number;
    if (existingByCode) {
      targetItemId = pn(existingByCode.id);
      itemsReused++;
    } else {
      const targetGroupId = item.stock_group_id ? (groupMap.get(pn(item.stock_group_id)) ?? null) : null;
      const targetGradeId = item.grade_id ? (gradeMap.get(pn(item.grade_id)) ?? null) : null;
      const targetCategoryId = item.category_id ? (categoryMap.get(pn(item.category_id)) ?? null) : null;
      const [row] = (
        await db.execute(sql`
        INSERT INTO stock_items
          (company_id, code, name, uom, stock_group_id, grade_id, category_id,
           opening_qty, opening_rate, opening_value, reorder_level, selling_price, active)
        VALUES
          (${targetId}, ${item.code}, ${item.name}, ${item.uom}, ${targetGroupId}, ${targetGradeId}, ${targetCategoryId},
           ${item.opening_qty ?? "0"}, ${item.opening_rate ?? "0"}, ${item.opening_value ?? "0"},
           ${item.reorder_level ?? "0"}, ${item.selling_price ?? "0"}, ${item.active ?? true})
        RETURNING id
      `)
      ).rows as any[];
      targetItemId = pn(row.id);
      await trackRow(runId, "stock_items", targetItemId);
      itemsCreated++;
    }

    await db.execute(sql`
      INSERT INTO sp_migration_source_links (run_id, source_table, source_id, target_table, target_id)
      VALUES (${runId}, 'stock_items', ${srcId}, 'stock_items', ${targetItemId})
    `);
    map.set(srcId, targetItemId);
  }

  return { map, groupsCreated, gradesCreated, categoriesCreated, itemsCreated, itemsReused };
}

// ── Shared read-only preview builder ────────────────────────────────────────
// Used by both /gc-preview (canonical) and /preview (legacy alias, same shape).
// NO writes. Returns what WOULD be migrated by the staged flow.
async function buildGcMigrationPreview(sourceId: number, targetId: number) {
  const sourceComp = await getCompanyRow(sourceId);
  const targetComp = await getCompanyRow(targetId);
  if (!sourceComp) return { status: 404, body: { message: "Source company not found" } };
  if (!targetComp) return { status: 404, body: { message: "Target company not found" } };
  if (sourceComp.company_type !== "erp")
    return { status: 400, body: { message: "Source company must be type 'erp'" } };
  if (targetComp.company_type !== "supplier_partner")
    return { status: 400, body: { message: "Target company must be type 'supplier_partner'" } };

  // Stock items with positive inventory in source
  const stockRows = (
    await db.execute(sql`
    SELECT si.id AS stock_item_id, si.code, si.name, inv.quantity, inv.average_rate,
           ROUND(inv.quantity * COALESCE(inv.average_rate, 0), 4) AS total_value
    FROM stock_items si
    JOIN inventory inv ON inv.stock_item_id = si.id AND inv.company_id = ${sourceId}
    WHERE si.company_id = ${sourceId} AND si.deleted_at IS NULL AND inv.quantity > 0
    ORDER BY si.code
  `)
  ).rows as any[];

  // aliasExists is a per-item display flag only — NOT the mapping check (see below).
  const existingAliases = (
    await db.execute(sql`
    SELECT alias_code FROM stock_item_code_aliases WHERE company_id = ${targetId}
  `)
  ).rows as any[];
  const existingAliasCodes = new Set(existingAliases.map((r: any) => r.alias_code));

  // Real mapping check: has this source stock item already been linked to a target
  // stock item by a prior staged migration run (sp_migration_source_links)?
  let mappedSourceIds = new Set<number>();
  if (stockRows.length > 0) {
    const linkedRows = (
      await db.execute(sql`
      SELECT DISTINCT l.source_id
      FROM sp_migration_source_links l
      JOIN stock_items ti ON ti.id = l.target_id AND ti.company_id = ${targetId} AND ti.deleted_at IS NULL
      WHERE l.source_table = 'stock_items' AND l.target_table = 'stock_items'
        AND l.source_id IN (${sql.join(
          stockRows.map((r: any) => sql`${pn(r.stock_item_id)}`),
          sql`, `
        )})
    `)
    ).rows as any[];
    mappedSourceIds = new Set(linkedRows.map((r: any) => pn(r.source_id)));
  }

  const stockItems = stockRows.map((r: any) => ({
    code: r.code,
    name: r.name,
    quantity: pn(r.quantity),
    averageCostUsd: pn(r.average_rate),
    totalValueUsd: pn(r.total_value),
    aliasExists: existingAliasCodes.has(r.code),
  }));

  // Sale vouchers in source (support 'Sales' and legacy 'Sale')
  const voucherRow = (
    await db.execute(sql`
    SELECT COUNT(*) AS cnt, COALESCE(SUM(total_amount), 0) AS total
    FROM vouchers
    WHERE company_id = ${sourceId} AND voucher_type IN ('Sales', 'Sale') AND deleted_at IS NULL
  `)
  ).rows[0] as any;

  // Already-migrated vouchers in target: linked from a source sale voucher, OR
  // carrying the migration-only marker (prefix + source_module).
  const migratedRow = (
    await db.execute(sql`
    SELECT COUNT(*) AS cnt FROM vouchers v
    WHERE v.company_id = ${targetId} AND v.deleted_at IS NULL
      AND (
        v.id IN (
          SELECT target_id FROM sp_migration_source_links
          WHERE source_table = 'vouchers' AND target_table = 'vouchers'
        )
        OR v.voucher_number LIKE 'MIG-GC-%'
        OR v.source_module = 'SP_MIGRATION_READONLY'
      )
  `)
  ).rows[0] as any;

  // SP accounts status
  const spAcctRows = (
    await db.execute(sql`
    SELECT sub_type FROM ledger_accounts
    WHERE company_id = ${targetId} AND deleted_at IS NULL AND sub_type LIKE 'sp_%'
  `)
  ).rows as any[];
  const existingSpSubTypes = new Set(spAcctRows.map((r: any) => r.sub_type));
  const spAccountsStatus = SP_ACCOUNTS.map((a) => ({
    subType: a.subType,
    name: a.name,
    exists: existingSpSubTypes.has(a.subType),
  }));

  // GC profit accounts status (current subtypes + legacy ones from earlier tool versions)
  const gcAllSubTypes = [...GC_PROFIT_ACCOUNTS.map((a) => a.subType), ...LEGACY_GC_PROFIT_SUBTYPES];
  const gcAcctRows = (
    await db.execute(sql`
    SELECT sub_type, name FROM ledger_accounts
    WHERE company_id = ${targetId} AND deleted_at IS NULL AND sub_type = ANY(${gcAllSubTypes})
  `)
  ).rows as any[];
  const existingGcSubTypes = new Map(gcAcctRows.map((r: any) => [r.sub_type, r.name]));

  const totalQty = stockItems.reduce((s: number, i: any) => s + i.quantity, 0);
  const totalValue = stockItems.reduce((s: number, i: any) => s + i.totalValueUsd, 0);
  const alreadyMapped = mappedSourceIds.size;

  const warnings: string[] = [];
  if (stockItems.length === 0) warnings.push("No stock items with positive inventory found in source company.");
  if (alreadyMapped > 0)
    warnings.push(
      `${alreadyMapped} stock item(s) already have source-to-target migration links and will be reused by staged steps.`
    );
  if (pn(migratedRow.cnt) > 0)
    warnings.push(
      `${pn(migratedRow.cnt)} voucher(s) already migrated in target — re-running will create duplicates. Rollback first.`
    );
  warnings.push("Open/OTW containers can be migrated in the Containers step. Review OTW accounting after migration.");
  warnings.push(
    "Duty/surcharge/fumigation/other charges are not auto-posted unless safely mapped; review warnings after the Containers step."
  );
  warnings.push("Cash and bank balances must be posted separately if needed.");
  warnings.push("This preview is read-only. No data has been written.");

  return {
    status: 200,
    body: {
      sourceCompany: { id: sourceComp.id, code: sourceComp.code, name: sourceComp.name },
      targetCompany: { id: targetComp.id, code: targetComp.code, name: targetComp.name },
      stockSummary: {
        itemCount: stockItems.length,
        totalQty: Math.round(totalQty * 1000) / 1000,
        totalValueUsd: Math.round(totalValue * 100) / 100,
        alreadyMapped,
      },
      stockItems,
      voucherSummary: {
        sourceCount: pn(voucherRow.cnt),
        totalAmount: pn(voucherRow.total),
        alreadyMigrated: pn(migratedRow.cnt),
      },
      spAccountsStatus,
      gcProfitAccountsStatus: GC_PROFIT_ACCOUNTS.map((a) => ({
        subType: a.subType,
        name: existingGcSubTypes.get(a.subType) ?? a.name,
        exists: existingGcSubTypes.has(a.subType),
      })),
      warnings,
    },
  };
}

// ── Route Registration ─────────────────────────────────────────────────────────

export function registerSpMigrationRoutes(app: Express) {
  // ── GET /api/sp/migration/preview ────────────────────────────────────────
  // Legacy alias — kept only for backward compatibility. Returns the exact same
  // shape as /gc-preview (see buildGcMigrationPreview) so no two preview
  // endpoints ever disagree on field names again.
  app.get("/api/sp/migration/preview", requireAuth, requireRole("Developer"), async (req: any, res: any) => {
    try {
      const sourceId = parseInt(String(req.query.sourceCompanyId ?? ""), 10);
      const targetId = parseInt(String(req.query.targetCompanyId ?? ""), 10);
      if (!sourceId || !targetId) {
        return res.status(400).json({ message: "sourceCompanyId and targetCompanyId are required" });
      }
      if (sourceId === targetId) {
        return res.status(400).json({ message: "Source and target companies must be different" });
      }
      const { status, body } = await buildGcMigrationPreview(sourceId, targetId);
      return res.status(status).json(body);
    } catch (err: any) {
      logger.error("[SP Migration] preview error:", { error: err });
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── GET /api/sp/migration/runs ──────────────────────────────────────────
  app.get("/api/sp/migration/runs", requireAuth, requireRole("Developer"), async (_req: any, res: any) => {
    try {
      const runs = (
        await db.execute(sql`
        SELECT
          r.id, r.source_company_id, r.target_company_id,
          r.action, r.status, r.rows_created,
          r.created_at, r.completed_at, r.error_message, r.notes,
          sc.name AS source_name, tc.name AS target_name
        FROM sp_migration_rehearsal_runs r
        JOIN companies sc ON sc.id = r.source_company_id
        JOIN companies tc ON tc.id = r.target_company_id
        ORDER BY r.created_at DESC
        LIMIT 50
      `)
      ).rows;
      return res.json({ runs });
    } catch (err: any) {
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── POST /api/sp/migration/rehearsal ────────────────────────────────────
  // DISABLED: the old all-in-one rehearsal flow (default-warehouse + raw stock_item_id reuse +
  // source_type='opening_stock' + "recreate containers manually") is permanently retired.
  // Use the staged endpoints instead: gc-account-plan, gc-stock-master, gc-stock-opening,
  // gc-sales-readonly, gc-containers, gc-profit-opening, gc-reconciliation.
  app.post("/api/sp/migration/rehearsal", requireAuth, requireRole("Developer"), async (_req: any, res: any) => {
    return res.status(410).json({
      message: "The old all-in-one GC migration flow is disabled. Use the staged migration steps instead.",
      code: "OLD_GC_REHEARSAL_DISABLED",
    });
  });

  // ── POST /api/sp/migration/rollback ─────────────────────────────────────
  // Removes ONLY rows created by a specific rehearsal run.
  // Never touches source (ERP) company.
  app.post("/api/sp/migration/rollback", requireAuth, requireRole("Developer"), async (req: any, res: any) => {
    const { runId } = req.body ?? {};
    if (!runId) return res.status(400).json({ message: "runId is required" });

    try {
      // Fetch run metadata
      const runRow = (
        await db.execute(sql`
        SELECT id, source_company_id, target_company_id, status
        FROM sp_migration_rehearsal_runs WHERE id = ${runId} LIMIT 1
      `)
      ).rows[0] as any;

      if (!runRow) return res.status(404).json({ message: "Run not found" });
      if (runRow.status === "rolled_back") {
        return res.status(400).json({ message: "This run has already been rolled back" });
      }
      if (runRow.status === "rollback") {
        return res.status(400).json({ message: "Rollback already in progress" });
      }

      const targetId = pn(runRow.target_company_id);
      const sourceId = pn(runRow.source_company_id);

      // Safety: never touch source company
      if (!targetId || targetId === sourceId) {
        return res.status(400).json({ message: "Rollback safety check failed: invalid target/source" });
      }

      // Fetch tracked rows
      const trackedRows = (
        await db.execute(sql`
        SELECT table_name, row_id FROM sp_migration_run_rows WHERE run_id = ${runId}
        ORDER BY id DESC
      `)
      ).rows as any[];

      let deleted = 0;
      const byTable: Record<string, number[]> = {};
      for (const r of trackedRows) {
        if (!byTable[r.table_name]) byTable[r.table_name] = [];
        byTable[r.table_name].push(pn(r.row_id));
      }

      // Delete in safe order — children before parents, entries before vouchers before accounts
      const tableOrder = [
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
      for (const tbl of tableOrder) {
        const ids = byTable[tbl];
        if (!ids?.length) continue;
        for (const id of ids) {
          // Extra safety: verify the row belongs to target company before deleting
          let verified = false;
          if (tbl === "sp_stock_movements") {
            const [chk] = (await db.execute(sql`SELECT company_id FROM sp_stock_movements WHERE id = ${id} LIMIT 1`))
              .rows as any[];
            verified = !!chk && pn(chk.company_id) === targetId;
          } else if (tbl === "stock_item_code_aliases") {
            const [chk] = (
              await db.execute(sql`SELECT company_id FROM stock_item_code_aliases WHERE id = ${id} LIMIT 1`)
            ).rows as any[];
            verified = !!chk && pn(chk.company_id) === targetId;
          } else if (tbl === "locations") {
            const [chk] = (await db.execute(sql`SELECT company_id FROM locations WHERE id = ${id} LIMIT 1`))
              .rows as any[];
            verified = !!chk && pn(chk.company_id) === targetId;
          } else if (tbl === "vouchers") {
            const [chk] = (await db.execute(sql`SELECT company_id FROM vouchers WHERE id = ${id} LIMIT 1`))
              .rows as any[];
            verified = !!chk && pn(chk.company_id) === targetId;
          } else if (tbl === "voucher_entries") {
            // voucher_entries has no company_id — verify via parent voucher
            const [chk] = (
              await db.execute(sql`
              SELECT v.company_id FROM voucher_entries ve
              JOIN vouchers v ON v.id = ve.voucher_id
              WHERE ve.id = ${id} LIMIT 1
            `)
            ).rows as any[];
            verified = !!chk && pn(chk.company_id) === targetId;
          } else if (tbl === "ledger_accounts") {
            const [chk] = (await db.execute(sql`SELECT company_id FROM ledger_accounts WHERE id = ${id} LIMIT 1`))
              .rows as any[];
            verified = !!chk && pn(chk.company_id) === targetId;
          } else if (tbl === "inventory") {
            const [chk] = (await db.execute(sql`SELECT company_id FROM inventory WHERE id = ${id} LIMIT 1`))
              .rows as any[];
            verified = !!chk && pn(chk.company_id) === targetId;
          } else if (tbl === "stock_items") {
            const [chk] = (await db.execute(sql`SELECT company_id FROM stock_items WHERE id = ${id} LIMIT 1`))
              .rows as any[];
            verified = !!chk && pn(chk.company_id) === targetId;
          } else if (tbl === "stock_groups") {
            const [chk] = (await db.execute(sql`SELECT company_id FROM stock_groups WHERE id = ${id} LIMIT 1`))
              .rows as any[];
            verified = !!chk && pn(chk.company_id) === targetId;
          } else if (tbl === "stock_grades") {
            const [chk] = (await db.execute(sql`SELECT company_id FROM stock_grades WHERE id = ${id} LIMIT 1`))
              .rows as any[];
            verified = !!chk && pn(chk.company_id) === targetId;
          } else if (tbl === "stock_categories") {
            const [chk] = (await db.execute(sql`SELECT company_id FROM stock_categories WHERE id = ${id} LIMIT 1`))
              .rows as any[];
            verified = !!chk && pn(chk.company_id) === targetId;
          } else if (tbl === "sp_containers") {
            const [chk] = (await db.execute(sql`SELECT company_id FROM sp_containers WHERE id = ${id} LIMIT 1`))
              .rows as any[];
            verified = !!chk && pn(chk.company_id) === targetId;
          } else if (tbl === "sp_container_lines") {
            const [chk] = (await db.execute(sql`SELECT company_id FROM sp_container_lines WHERE id = ${id} LIMIT 1`))
              .rows as any[];
            verified = !!chk && pn(chk.company_id) === targetId;
          }

          if (!verified) {
            logger.warn(`[SP Rollback] Skipped ${tbl} id=${id} — company_id mismatch or row not found`);
            continue;
          }

          if (tbl === "inventory") {
            await db.execute(sql`DELETE FROM inventory WHERE id = ${id}`);
          } else if (tbl === "sp_stock_movements") {
            await db.execute(sql`DELETE FROM sp_stock_movements WHERE id = ${id}`);
          } else if (tbl === "stock_item_code_aliases") {
            await db.execute(sql`DELETE FROM stock_item_code_aliases WHERE id = ${id}`);
          } else if (tbl === "locations") {
            await db.execute(sql`DELETE FROM locations WHERE id = ${id}`);
          } else if (tbl === "voucher_entries") {
            await db.execute(sql`DELETE FROM voucher_entries WHERE id = ${id}`);
          } else if (tbl === "vouchers") {
            await db.execute(sql`DELETE FROM vouchers WHERE id = ${id}`);
          } else if (tbl === "ledger_accounts") {
            await db.execute(sql`DELETE FROM ledger_accounts WHERE id = ${id}`);
          } else if (tbl === "stock_items") {
            await db.execute(sql`DELETE FROM stock_items WHERE id = ${id}`);
          } else if (tbl === "stock_groups") {
            await db.execute(sql`DELETE FROM stock_groups WHERE id = ${id}`);
          } else if (tbl === "stock_grades") {
            await db.execute(sql`DELETE FROM stock_grades WHERE id = ${id}`);
          } else if (tbl === "stock_categories") {
            await db.execute(sql`DELETE FROM stock_categories WHERE id = ${id}`);
          } else if (tbl === "sp_container_lines") {
            await db.execute(sql`DELETE FROM sp_container_lines WHERE id = ${id}`);
          } else if (tbl === "sp_containers") {
            await db.execute(sql`DELETE FROM sp_containers WHERE id = ${id}`);
          }
          deleted++;
        }
      }

      // Clean up provenance links written by this run (source-side rows are never touched)
      await db.execute(sql`DELETE FROM sp_migration_source_links WHERE run_id = ${runId}`);

      // Mark run as rolled_back
      await db.execute(sql`
        UPDATE sp_migration_rehearsal_runs
        SET status = 'rolled_back', completed_at = now(),
            notes = COALESCE(notes, '') || ' | ROLLED BACK'
        WHERE id = ${runId}
      `);

      return res.json({ success: true, runId, rowsDeleted: deleted });
    } catch (err: any) {
      logger.error("[SP Migration] rollback error:", { error: err });
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── POST /api/sp/migration/create-sp-company ─────────────────────────────
  // Creates a new supplier_partner company for the GC-LSHI migration.
  app.post(
    "/api/sp/migration/create-sp-company",
    requireAuth,
    requireRole("Developer"),
    async (req: any, res: any) => {
      try {
        const { name, code } = req.body ?? {};
        if (!name || !code) return res.status(400).json({ message: "name and code are required" });

        // Check for duplicate code
        const existing = (await db.execute(sql`SELECT id FROM companies WHERE code = ${code} LIMIT 1`)).rows[0] as any;
        if (existing) return res.status(409).json({ message: `Company code "${code}" already exists` });

        const [row] = (
          await db.execute(sql`
        INSERT INTO companies (code, name, company_type, base_currency, active)
        VALUES (${code}, ${name}, 'supplier_partner', 'USD', true)
        RETURNING id, code, name, company_type
      `)
        ).rows as any[];

        return res.json({ success: true, company: row });
      } catch (err: any) {
        logger.error("[SP Migration] create-sp-company error:", { error: err });
        return res.status(500).json({ message: "Internal server error" });
      }
    }
  );

  // ── GET /api/sp/migration/gc-preview ─────────────────────────────────────
  // Canonical read-only preview for the staged GC migration flow. Developer-only,
  // no writes. See buildGcMigrationPreview for the exact response shape.
  app.get("/api/sp/migration/gc-preview", requireAuth, requireRole("Developer"), async (req: any, res: any) => {
    try {
      const sourceId = parseInt(String(req.query.sourceCompanyId ?? ""), 10);
      const targetId = parseInt(String(req.query.targetCompanyId ?? ""), 10);

      if (!sourceId || !targetId)
        return res.status(400).json({ message: "sourceCompanyId and targetCompanyId are required" });
      if (sourceId === targetId) return res.status(400).json({ message: "Source and target must be different" });

      const { status, body } = await buildGcMigrationPreview(sourceId, targetId);
      return res.status(status).json(body);
    } catch (err: any) {
      logger.error("[SP Migration] gc-preview error:", { error: err });
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── POST /api/sp/migration/gc-rehearsal ──────────────────────────────────
  // Full GC-LSHI → SP migration:
  //   1. Standard SP accounts (10 accounts)
  //   2. GC profit accounts (2 accounts)
  //   3. Stock items + aliases (same as rehearsal)
  //   4. Sale vouchers from ERP → SP (with account remapping)
  // ── DISABLED: old all-in-one GC migration flow ──────────────────────────
  // The single-shot "run everything" flow has been superseded by the staged
  // migration steps (stock master -> stock opening -> sales read-only ->
  // containers -> profit-share opening -> reconciliation). It is kept only as
  // a hard-disabled stub so any stale client cannot silently trigger it.
  app.post("/api/sp/migration/gc-rehearsal", requireAuth, requireRole("Developer"), async (_req: any, res: any) => {
    return res.status(410).json({
      message: "The old all-in-one GC migration flow is disabled. Use the staged migration steps instead.",
      code: "GC_REHEARSAL_DISABLED",
    });
  });

  // ── GET /api/sp/migration/gc-account-plan ────────────────────────────────
  // Returns the full proposed chart-of-accounts list (SP + GC profit accounts)
  // with default code/name so the UI can let the user rename before creation.
  app.get("/api/sp/migration/gc-account-plan", requireAuth, requireRole("Developer"), async (req: any, res: any) => {
    try {
      const targetId = parseInt(String(req.query.targetCompanyId ?? ""), 10);
      if (!targetId) return res.status(400).json({ message: "targetCompanyId is required" });

      const existingRows = (
        await db.execute(sql`
        SELECT sub_type, code, name FROM ledger_accounts
        WHERE company_id = ${targetId} AND deleted_at IS NULL
          AND sub_type = ANY(${ALL_ACCOUNT_DEFS.map((a) => a.subType)})
      `)
      ).rows as any[];
      const existingBySubType = new Map(existingRows.map((r: any) => [r.sub_type, r]));

      const accounts = ALL_ACCOUNT_DEFS.map((a) => {
        const existing = existingBySubType.get(a.subType);
        return {
          subType: a.subType,
          accountType: a.accountType,
          defaultCode: a.code,
          defaultName: a.name,
          exists: !!existing,
          currentCode: existing?.code ?? a.code,
          currentName: existing?.name ?? a.name,
          group: SP_ACCOUNTS.some((s) => s.subType === a.subType) ? "sp" : "gc",
        };
      });

      return res.json({ accounts });
    } catch (err: any) {
      logger.error("[SP Migration] gc-account-plan error:", { error: err });
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── POST /api/sp/migration/gc-create-accounts ────────────────────────────
  // Creates only the missing accounts from the whitelist, using user-supplied
  // code/name overrides. Idempotent — existing subTypes are left untouched.
  app.post(
    "/api/sp/migration/gc-create-accounts",
    requireAuth,
    requireRole("Developer"),
    async (req: any, res: any) => {
      try {
        const { targetCompanyId, accounts } = req.body ?? {};
        const targetId = parseInt(String(targetCompanyId ?? ""), 10);
        if (!targetId) return res.status(400).json({ message: "targetCompanyId is required" });
        if (!Array.isArray(accounts) || !accounts.length) {
          return res.status(400).json({ message: "accounts array is required" });
        }

        const targetComp = await getCompanyRow(targetId);
        if (!targetComp) return res.status(404).json({ message: "Target company not found" });
        if (targetComp.company_type !== "supplier_partner") {
          return res.status(400).json({ message: "Target must be a supplier_partner company" });
        }

        const allowedSubTypes = new Set(ALL_ACCOUNT_DEFS.map((a) => a.subType));
        const overrides: Record<string, { code?: string; name?: string }> = {};
        for (const a of accounts) {
          if (!allowedSubTypes.has(a?.subType)) {
            return res.status(400).json({ message: `Unknown account subType: ${a?.subType}` });
          }
          overrides[a.subType] = { code: a.code, name: a.name };
        }

        const runId = await logRun(
          targetId,
          targetId,
          "gc_create_accounts",
          "running",
          0,
          null,
          `User: ${req.session?.userId ?? "unknown"} | Target: ${targetComp.name}`
        );

        const spResult = await ensureSpAccounts(targetId, overrides);
        const gcResult = await ensureGcProfitAccounts(targetId, overrides);
        const allNewIds = [...spResult.newIds, ...gcResult.newIds];
        for (const id of allNewIds) await trackRow(runId, "ledger_accounts", id);

        await db.execute(sql`
          UPDATE sp_migration_rehearsal_runs
          SET status = 'completed', rows_created = ${allNewIds.length}, completed_at = now()
          WHERE id = ${runId}
        `);

        return res.json({
          success: true,
          runId,
          created: [...spResult.names, ...gcResult.names],
          createdCount: allNewIds.length,
        });
      } catch (err: any) {
        logger.error("[SP Migration] gc-create-accounts error:", { error: err });
        return res.status(500).json({ message: "Internal server error" });
      }
    }
  );

  // ── GET /api/sp/migration/session-role ──────────────────────────────────
  // Returns the current session's role — used by the frontend to gate the page.
  app.get("/api/sp/migration/session-role", requireAuth, requireRole("Developer"), async (req: any, res: any) => {
    return res.json({ role: req.session?.currentRole ?? null });
  });

  // ── GET /api/sp/migration/cash-accounts ─────────────────────────────────
  // Returns Cash/Bank ledger accounts for a given SP target company.
  app.get("/api/sp/migration/cash-accounts", requireAuth, requireRole("Developer"), async (req: any, res: any) => {
    try {
      const targetId = parseInt(String(req.query.targetCompanyId ?? ""), 10);
      if (!targetId) return res.status(400).json({ message: "targetCompanyId is required" });
      const rows = (
        await db.execute(sql`
        SELECT id, code, name, account_type
        FROM ledger_accounts
        WHERE company_id = ${targetId} AND account_type IN ('Cash', 'Bank') AND deleted_at IS NULL
        ORDER BY account_type, name
      `)
      ).rows as any[];
      return res.json({ accounts: rows });
    } catch (err: any) {
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── POST /api/sp/migration/opening-balance ───────────────────────────────
  // Creates a Journal voucher: Dr selected Cash/Bank account → Cr SP-OPNBAL
  // Requires cashAccountId — no silent auto-pick.
  app.post(
    "/api/sp/migration/opening-balance",
    requireAuth,
    requireRole("Developer"),
    async (req: any, res: any) => {
      try {
        const { targetCompanyId, cashAccountId, amount, date, narration } = req.body ?? {};
        const targetId = parseInt(String(targetCompanyId ?? ""), 10);
        const cashId = parseInt(String(cashAccountId ?? ""), 10);

        if (!targetId) return res.status(400).json({ message: "targetCompanyId is required" });
        if (!cashId)
          return res.status(400).json({ message: "cashAccountId is required — select a cash or bank account" });
        if (!amount || isNaN(parseFloat(amount))) return res.status(400).json({ message: "amount is required" });
        if (!date) return res.status(400).json({ message: "date is required" });

        const targetComp = await getCompanyRow(targetId);
        if (!targetComp) return res.status(404).json({ message: "Target company not found" });
        if (targetComp.company_type !== "supplier_partner") {
          return res.status(400).json({ message: "Target must be a supplier_partner company" });
        }

        // Verify the selected cash account belongs to target company
        const cashAcctRow = (
          await db.execute(sql`
        SELECT id, name, account_type FROM ledger_accounts
        WHERE id = ${cashId} AND company_id = ${targetId} AND deleted_at IS NULL LIMIT 1
      `)
        ).rows[0] as any;
        if (!cashAcctRow) {
          return res.status(400).json({ message: "Selected cash account not found in target company" });
        }
        if (!["Cash", "Bank"].includes(cashAcctRow.account_type)) {
          return res
            .status(400)
            .json({ message: `Account "${cashAcctRow.name}" is type "${cashAcctRow.account_type}", not Cash or Bank` });
        }

        // Find SP-OPNBAL account
        const opnBalRows = (
          await db.execute(sql`
        SELECT id FROM ledger_accounts
        WHERE company_id = ${targetId} AND sub_type = 'sp_opnbal' AND deleted_at IS NULL LIMIT 1
      `)
        ).rows as any[];
        if (!opnBalRows.length) {
          return res
            .status(400)
            .json({ message: "SP-OPNBAL account not found in target company. Run the GC migration first." });
        }
        const opnBalId = pn(opnBalRows[0].id);

        const amtStr = parseFloat(amount).toFixed(2);
        const voucherNumber = `OB-${targetId}-${Date.now()}`;

        const [vRow] = (
          await db.execute(sql`
        INSERT INTO vouchers (company_id, voucher_number, voucher_type, voucher_date, description, total_amount, currency, source_module)
        VALUES (${targetId}, ${voucherNumber}, 'Journal', ${date},
                ${narration ?? "GC Opening Cash Balance"}, ${amtStr}, 'USD', 'ERP')
        RETURNING id
      `)
        ).rows as any[];
        const voucherId = pn(vRow.id);

        // Dr selected Cash/Bank account
        await db.execute(sql`
        INSERT INTO voucher_entries (voucher_id, ledger_account_id, debit_amount, credit_amount, narration)
        VALUES (${voucherId}, ${cashId}, ${amtStr}, '0.00', ${narration ?? "Opening cash balance"})
      `);
        // Cr SP-OPNBAL
        await db.execute(sql`
        INSERT INTO voucher_entries (voucher_id, ledger_account_id, debit_amount, credit_amount, narration)
        VALUES (${voucherId}, ${opnBalId}, '0.00', ${amtStr}, ${narration ?? "Opening cash balance"})
      `);

        return res.json({ success: true, voucherId, voucherNumber, amount: amtStr, cashAccountName: cashAcctRow.name });
      } catch (err: any) {
        logger.error("[SP Migration] opening-balance error:", { error: err });
        return res.status(500).json({ message: "Internal server error" });
      }
    }
  );

  // ── POST /api/sp/migration/rollback (extended) ───────────────────────────
  // Updated below — existing endpoint handles all tracked tables.
  // Extension: also handles voucher_entries, vouchers, ledger_accounts.

  // ── Location-aware stock opening ────────────────────────────────────────
  // Copies source per-location inventory into matching target locations
  // (matched by code, then name, then created), instead of dumping everything
  // into a single "Main Warehouse". Idempotent per (target stock item, target
  // location): a prior sp_stock_movements 'opening_stock' row for that pair
  // blocks a duplicate re-add.
  async function ensureTargetLocation(
    sourceLoc: { id: number; code: string; name: string },
    targetId: number,
    runId: string,
    locMap: Map<number, number>
  ): Promise<number> {
    const srcId = pn(sourceLoc.id);
    if (locMap.has(srcId)) return locMap.get(srcId)!;

    let targetLocId: number | undefined;
    const byCode = (
      await db.execute(sql`
      SELECT id FROM locations WHERE company_id = ${targetId} AND code = ${sourceLoc.code} AND deleted_at IS NULL LIMIT 1
    `)
    ).rows[0] as any;
    if (byCode) targetLocId = pn(byCode.id);

    if (!targetLocId) {
      const byName = (
        await db.execute(sql`
        SELECT id FROM locations WHERE company_id = ${targetId} AND name = ${sourceLoc.name} AND deleted_at IS NULL LIMIT 1
      `)
      ).rows[0] as any;
      if (byName) targetLocId = pn(byName.id);
    }

    if (!targetLocId) {
      const [row] = (
        await db.execute(sql`
        INSERT INTO locations (company_id, code, name, active)
        VALUES (${targetId}, ${sourceLoc.code}, ${sourceLoc.name}, true)
        RETURNING id
      `)
      ).rows as any[];
      targetLocId = pn(row.id);
      await trackRow(runId, "locations", targetLocId);
    }

    locMap.set(srcId, targetLocId);
    return targetLocId;
  }

  // POST /api/sp/migration/gc-stock-master
  // Explicit, standalone staged step: creates/reuses target stock groups, grades,
  // categories and stock items (with opening qty/rate/value, reorder level, selling
  // price and active flag copied over) WITHOUT posting any opening-stock movements or
  // touching inventory. This lets the master data be reviewed/corrected before the
  // location-aware stock-opening step runs.
  // Requires: { sourceCompanyId, targetCompanyId, companyNameConfirm, confirmation: "MIGRATE" }
  app.post(
    "/api/sp/migration/gc-stock-master",
    requireAuth,
    requireRole("Developer"),
    async (req: any, res: any) => {
      const { sourceCompanyId, targetCompanyId, companyNameConfirm, confirmation } = req.body ?? {};
      if (confirmation !== "MIGRATE") {
        return res.status(400).json({ message: 'Requires confirmation = "MIGRATE"' });
      }
      const sourceId = parseInt(String(sourceCompanyId ?? ""), 10);
      const targetId = parseInt(String(targetCompanyId ?? ""), 10);
      if (!sourceId || !targetId)
        return res.status(400).json({ message: "sourceCompanyId and targetCompanyId required" });

      const sourceComp = await getCompanyRow(sourceId);
      const targetComp = await getCompanyRow(targetId);
      if (!sourceComp) return res.status(404).json({ message: "Source company not found" });
      if (!targetComp) return res.status(404).json({ message: "Target company not found" });
      if (sourceComp.company_type !== "erp")
        return res.status(400).json({ message: "Source company must be type 'erp'" });
      if (targetComp.company_type !== "supplier_partner")
        return res.status(400).json({ message: "Target company must be type 'supplier_partner'" });
      if (!companyNameConfirm || companyNameConfirm.trim() !== sourceComp.name) {
        return res.status(400).json({ message: `Company name confirmation must match exactly: "${sourceComp.name}"` });
      }

      const runId = await logRun(
        sourceId,
        targetId,
        "gc_stock_master",
        "running",
        0,
        null,
        `User: ${req.session?.userId ?? "unknown"} | Source: ${sourceComp.name} | Target: ${targetComp.name}`
      );

      try {
        const { map, groupsCreated, gradesCreated, categoriesCreated, itemsCreated, itemsReused } =
          await ensureTargetStockItems(sourceId, targetId, runId);
        const rowsCreated = groupsCreated + gradesCreated + categoriesCreated + itemsCreated;

        await db.execute(sql`
          UPDATE sp_migration_rehearsal_runs SET status = 'completed', rows_created = ${rowsCreated}, completed_at = now() WHERE id = ${runId}
        `);

        return res.json({
          success: true,
          runId,
          rowsCreated,
          summary: [
            `Stock groups: ${groupsCreated} created`,
            `Stock grades: ${gradesCreated} created`,
            `Stock categories: ${categoriesCreated} created`,
            `Stock items: ${itemsCreated} created, ${itemsReused} reused (already existed/linked)`,
            `Total stock items now mapped: ${map.size}`,
          ],
          warnings: [
            "This step only creates master data (groups, grades, categories, items with opening/reorder/selling-price fields) — no opening-stock movements or inventory rows were touched.",
            "Per-location selling prices (stock_item_location_prices) are not migrated here — set them manually per target location if needed.",
          ],
        });
      } catch (err: any) {
        await db
          .execute(
            sql`UPDATE sp_migration_rehearsal_runs SET status = 'failed', error_message = ${err.message}, completed_at = now() WHERE id = ${runId}`
          )
          .catch(() => {});
        logger.error("[SP Migration] gc-stock-master error:", { error: err });
        return res.status(500).json({ message: "Stock master migration failed", runId });
      }
    }
  );

  // POST /api/sp/migration/gc-stock-opening
  // Requires: { sourceCompanyId, targetCompanyId, companyNameConfirm, confirmation: "MIGRATE" }
  app.post(
    "/api/sp/migration/gc-stock-opening",
    requireAuth,
    requireRole("Developer"),
    async (req: any, res: any) => {
      const { sourceCompanyId, targetCompanyId, companyNameConfirm, confirmation } = req.body ?? {};
      if (confirmation !== "MIGRATE") {
        return res.status(400).json({ message: 'Requires confirmation = "MIGRATE"' });
      }
      const sourceId = parseInt(String(sourceCompanyId ?? ""), 10);
      const targetId = parseInt(String(targetCompanyId ?? ""), 10);
      if (!sourceId || !targetId)
        return res.status(400).json({ message: "sourceCompanyId and targetCompanyId required" });

      const sourceComp = await getCompanyRow(sourceId);
      const targetComp = await getCompanyRow(targetId);
      if (!sourceComp) return res.status(404).json({ message: "Source company not found" });
      if (!targetComp) return res.status(404).json({ message: "Target company not found" });
      if (sourceComp.company_type !== "erp")
        return res.status(400).json({ message: "Source company must be type 'erp'" });
      if (targetComp.company_type !== "supplier_partner")
        return res.status(400).json({ message: "Target company must be type 'supplier_partner'" });
      if (!companyNameConfirm || companyNameConfirm.trim() !== sourceComp.name) {
        return res.status(400).json({ message: `Company name confirmation must match exactly: "${sourceComp.name}"` });
      }
      const depError = await requireCompletedMigrationAction(sourceId, targetId, "gc_stock_opening");
      if (depError) return res.status(409).json({ message: depError });

      const runId = await logRun(
        sourceId,
        targetId,
        "gc_stock_opening",
        "running",
        0,
        null,
        `User: ${req.session?.userId ?? "unknown"} | Source: ${sourceComp.name} | Target: ${targetComp.name}`
      );

      let rowsCreated = 0;
      const summary: string[] = [];
      try {
        const { map: stockItemMap } = await ensureTargetStockItems(sourceId, targetId, runId);

        const sourceLocs = (
          await db.execute(sql`
          SELECT id, code, name FROM locations WHERE company_id = ${sourceId} AND deleted_at IS NULL
        `)
        ).rows as any[];
        const locMap = new Map<number, number>();
        for (const l of sourceLocs) await ensureTargetLocation(l, targetId, runId, locMap);

        // Per-location inventory in source (location_id may be null for legacy rows — group those into an "Unassigned" bucket)
        const invRows = (
          await db.execute(sql`
          SELECT inv.stock_item_id, inv.location_id, si.code, si.name AS item_name, inv.quantity, inv.average_rate
          FROM inventory inv
          JOIN stock_items si ON si.id = inv.stock_item_id
          WHERE inv.company_id = ${sourceId} AND inv.quantity > 0
        `)
        ).rows as any[];

        let movementsCreated = 0,
          skipped = 0,
          mismatchedItems = 0;
        const perLocationRecon: Array<{ location: string; sourceQty: number; targetQty: number }> = [];

        for (const row of invRows) {
          const srcStockItemId = pn(row.stock_item_id);
          const targetStockItemId = stockItemMap.get(srcStockItemId);
          if (!targetStockItemId) {
            mismatchedItems++;
            continue;
          }
          const qty = pn(row.quantity);
          const avgRate = pn(row.average_rate);

          let targetLocId: number;
          if (row.location_id && locMap.has(pn(row.location_id))) {
            targetLocId = locMap.get(pn(row.location_id))!;
          } else {
            // Fall back to (create-once) "Unassigned" location for rows with no source location
            const unassigned = (
              await db.execute(sql`
              SELECT id FROM locations WHERE company_id = ${targetId} AND code = 'UNASSIGNED' AND deleted_at IS NULL LIMIT 1
            `)
            ).rows[0] as any;
            if (unassigned) {
              targetLocId = pn(unassigned.id);
            } else {
              const [locRow] = (
                await db.execute(sql`
                INSERT INTO locations (company_id, code, name, active)
                VALUES (${targetId}, 'UNASSIGNED', 'Unassigned (migrated)', true)
                RETURNING id
              `)
              ).rows as any[];
              targetLocId = pn(locRow.id);
              await trackRow(runId, "locations", targetLocId);
            }
          }

          // Idempotency: skip only if a movement from THIS specific GC migration source type already
          // exists for this exact (item, location) pair in the target — checking a narrow source_type
          // (instead of the generic 'opening_stock') avoids false-blocking on manually entered opening
          // stock and false-matching on unrelated migrations.
          const already = (
            await db.execute(sql`
            SELECT id FROM sp_stock_movements
            WHERE company_id = ${targetId} AND stock_item_id = ${targetStockItemId} AND location_id = ${targetLocId}
              AND source_type = 'migration_opening_stock' LIMIT 1
          `)
          ).rows[0] as any;
          if (already) {
            skipped++;
            continue;
          }

          // Guard: if the target already has non-migration stock for this exact item/location
          // (e.g. manually entered), block this row instead of silently stacking quantities.
          const existingInv = (
            await db.execute(sql`
            SELECT id, quantity FROM inventory
            WHERE company_id = ${targetId} AND stock_item_id = ${targetStockItemId} AND location_id = ${targetLocId}
            LIMIT 1
          `)
          ).rows[0] as any;
          if (existingInv && pn(existingInv.quantity) > 0) {
            mismatchedItems++;
            summary.push(
              `Blocked ${row.code} @ target location — target already has stock (qty ${pn(existingInv.quantity)}) for this item/location. Resolve or rollback before migration.`
            );
            continue;
          }

          const [movRow] = (
            await db.execute(sql`
            INSERT INTO sp_stock_movements
              (company_id, article_code, description, stock_item_id, location_id,
               qty_in, qty_remaining, base_unit_cost_usd, landed_unit_cost_usd, final_unit_cost_usd, source_type)
            VALUES
              (${targetId}, ${row.code}, ${"GC Migration opening stock (per-location) from " + sourceComp.name},
               ${targetStockItemId}, ${targetLocId}, ${qty}, ${qty},
               ${avgRate.toFixed(6)}, ${avgRate.toFixed(6)}, ${avgRate.toFixed(6)}, 'migration_opening_stock')
            RETURNING id
          `)
          ).rows as any[];
          await trackRow(runId, "sp_stock_movements", pn(movRow.id));
          movementsCreated++;
          rowsCreated++;

          const totalVal = (qty * avgRate).toFixed(2);
          const [invRow] = (
            await db.execute(sql`
            INSERT INTO inventory (company_id, location_id, stock_item_id, quantity, average_rate, total_value)
            VALUES (${targetId}, ${targetLocId}, ${targetStockItemId}, ${qty.toFixed(3)}, ${avgRate.toFixed(2)}, ${totalVal})
            ON CONFLICT (location_id, stock_item_id) DO NOTHING
            RETURNING id
          `)
          ).rows as any[];
          if (invRow) {
            await trackRow(runId, "inventory", pn(invRow.id));
            rowsCreated++;
          }
        }

        // Reconciliation: compare per-location totals source vs target
        for (const [srcLocId, tgtLocId] of Array.from(locMap.entries())) {
          const srcTotal = (
            await db.execute(sql`
            SELECT COALESCE(SUM(quantity), 0) AS q FROM inventory WHERE company_id = ${sourceId} AND location_id = ${srcLocId}
          `)
          ).rows[0] as any;
          const tgtTotal = (
            await db.execute(sql`
            SELECT COALESCE(SUM(quantity), 0) AS q FROM inventory WHERE company_id = ${targetId} AND location_id = ${tgtLocId}
          `)
          ).rows[0] as any;
          const locNameRow = sourceLocs.find((l: any) => pn(l.id) === srcLocId);
          perLocationRecon.push({
            location: locNameRow?.name ?? `location #${srcLocId}`,
            sourceQty: Math.round(pn(srcTotal.q) * 1000) / 1000,
            targetQty: Math.round(pn(tgtTotal.q) * 1000) / 1000,
          });
        }

        summary.push(`Opening stock movements created: ${movementsCreated}, skipped (already existed): ${skipped}`);
        if (mismatchedItems) summary.push(`${mismatchedItems} row(s) had no target stock item mapping — skipped`);

        await db.execute(sql`
          UPDATE sp_migration_rehearsal_runs
          SET status = 'completed', rows_created = ${rowsCreated}, completed_at = now()
          WHERE id = ${runId}
        `);

        return res.json({
          success: true,
          runId,
          rowsCreated,
          summary,
          perLocationRecon,
          warnings: mismatchedItems
            ? ["Some inventory rows referenced stock items not migrated by the stock-master step — run it first."]
            : [],
        });
      } catch (err: any) {
        await db
          .execute(
            sql`UPDATE sp_migration_rehearsal_runs SET status = 'failed', error_message = ${err.message}, completed_at = now() WHERE id = ${runId}`
          )
          .catch(() => {});
        logger.error("[SP Migration] gc-stock-opening error:", {
          sourceCompanyId: sourceId,
          targetCompanyId: targetId,
          runId,
          error: err?.message,
        });
        return res.status(500).json({
          message: `Stock opening migration failed: ${err?.message || "Unknown error"}`,
          runId,
        });
      }
    }
  );

  // ── Historical sales — TRUE read-only copy ──────────────────────────────
  // POST /api/sp/migration/gc-sales-readonly
  app.post(
    "/api/sp/migration/gc-sales-readonly",
    requireAuth,
    requireRole("Developer"),
    async (req: any, res: any) => {
      const { sourceCompanyId, targetCompanyId, companyNameConfirm, confirmation } = req.body ?? {};
      if (confirmation !== "MIGRATE") {
        return res.status(400).json({ message: 'Requires confirmation = "MIGRATE"' });
      }
      const sourceId = parseInt(String(sourceCompanyId ?? ""), 10);
      const targetId = parseInt(String(targetCompanyId ?? ""), 10);
      if (!sourceId || !targetId)
        return res.status(400).json({ message: "sourceCompanyId and targetCompanyId required" });

      const sourceComp = await getCompanyRow(sourceId);
      const targetComp = await getCompanyRow(targetId);
      if (!sourceComp) return res.status(404).json({ message: "Source company not found" });
      if (!targetComp) return res.status(404).json({ message: "Target company not found" });
      if (sourceComp.company_type !== "erp")
        return res.status(400).json({ message: "Source company must be type 'erp'" });
      if (targetComp.company_type !== "supplier_partner")
        return res.status(400).json({ message: "Target company must be type 'supplier_partner'" });
      if (!companyNameConfirm || companyNameConfirm.trim() !== sourceComp.name) {
        return res.status(400).json({ message: `Company name confirmation must match exactly: "${sourceComp.name}"` });
      }
      const depError = await requireCompletedMigrationAction(sourceId, targetId, "gc_sales_readonly");
      if (depError) return res.status(409).json({ message: depError });

      const runId = await logRun(
        sourceId,
        targetId,
        "gc_sales_readonly",
        "running",
        0,
        null,
        `User: ${req.session?.userId ?? "unknown"} | Source: ${sourceComp.name} | Target: ${targetComp.name}`
      );

      let rowsCreated = 0;
      const summary: string[] = [];
      try {
        // Reuse the same account-mapping strategy as gc-rehearsal
        const ERP_TO_SP_SUBTYPE: Record<string, string> = {
          "Direct Income": "sp_sales",
          "Direct Expense": "sp_cogs",
          "Indirect Expense": "sp_shared_charges",
          hadi_sp_intercompany: "sp_hadi_intercompany",
        };
        const sourceAccts = (
          await db.execute(sql`SELECT id, account_type, sub_type FROM ledger_accounts WHERE company_id = ${sourceId} AND deleted_at IS NULL`)
        ).rows as any[];
        const targetAccts = (
          await db.execute(sql`SELECT id, account_type, sub_type FROM ledger_accounts WHERE company_id = ${targetId} AND deleted_at IS NULL`)
        ).rows as any[];
        const targetBySubType = new Map<string, number>();
        for (const ta of targetAccts) if (ta.sub_type) targetBySubType.set(ta.sub_type, pn(ta.id));

        let suspenseAccountId: number;
        const existingSuspense = (
          await db.execute(sql`SELECT id FROM ledger_accounts WHERE company_id = ${targetId} AND sub_type = 'gc_mig_suspense' AND deleted_at IS NULL LIMIT 1`)
        ).rows[0] as any;
        if (existingSuspense) {
          suspenseAccountId = pn(existingSuspense.id);
        } else {
          const [suspRow] = (
            await db.execute(sql`
            INSERT INTO ledger_accounts (company_id, code, name, account_type, sub_type, active, is_hidden)
            VALUES (${targetId}, 'GC-SUSP', 'Migration Suspense', 'Equity', 'gc_mig_suspense', true, true)
            RETURNING id
          `)
          ).rows as any[];
          suspenseAccountId = pn(suspRow.id);
          await trackRow(runId, "ledger_accounts", suspenseAccountId);
          rowsCreated++;
        }

        const accountMap = new Map<number, number | null>();
        for (const sa of sourceAccts) {
          const srcId = pn(sa.id);
          if (sa.sub_type && targetBySubType.has(sa.sub_type)) accountMap.set(srcId, targetBySubType.get(sa.sub_type)!);
          else if (sa.account_type && ERP_TO_SP_SUBTYPE[sa.account_type] && targetBySubType.has(ERP_TO_SP_SUBTYPE[sa.account_type]))
            accountMap.set(srcId, targetBySubType.get(ERP_TO_SP_SUBTYPE[sa.account_type])!);
          else accountMap.set(srcId, suspenseAccountId);
        }

        const saleVouchers = (
          await db.execute(sql`
          SELECT id, voucher_number, voucher_type, voucher_date, description, total_amount, currency, exchange_rate
          FROM vouchers
          WHERE company_id = ${sourceId} AND voucher_type IN ('Sales', 'Sale') AND deleted_at IS NULL
          ORDER BY voucher_date ASC, id ASC
        `)
        ).rows as any[];

        // Stock item mapping produced by Step 4 (Stock Master) — required to translate
        // source sale-item stock_item_id references into the target company's stock items.
        const stockItemLinkRows = (
          await db.execute(sql`
          SELECT sml.source_id, sml.target_id
          FROM sp_migration_source_links sml
          JOIN sp_migration_rehearsal_runs r ON r.id = sml.run_id
          WHERE r.target_company_id = ${targetId} AND r.source_company_id = ${sourceId}
            AND sml.source_table = 'stock_items' AND sml.target_table = 'stock_items'
        `)
        ).rows as any[];
        const stockItemMap = new Map<number, number>();
        for (const l of stockItemLinkRows) stockItemMap.set(pn(l.source_id), pn(l.target_id));

        let vouchersCreated = 0,
          vouchersSkipped = 0,
          entriesCreated = 0,
          itemRowsCreated = 0,
          vouchersMissingItems = 0;
        for (const v of saleVouchers) {
          const newVoucherNumber = ("MIG-GC-" + v.voucher_number).substring(0, 100);
          const alreadyMig = (
            await db.execute(sql`SELECT id FROM vouchers WHERE voucher_number = ${newVoucherNumber} AND company_id = ${targetId} LIMIT 1`)
          ).rows[0] as any;
          if (alreadyMig) {
            vouchersSkipped++;
            continue;
          }

          const [vRow] = (
            await db.execute(sql`
            INSERT INTO vouchers
              (company_id, voucher_number, voucher_type, voucher_date, description, total_amount, currency, exchange_rate, source_module)
            VALUES
              (${targetId}, ${newVoucherNumber}, ${v.voucher_type}, ${v.voucher_date},
               ${v.description ?? "Migrated (read-only) from GC-LSHI ERP"},
               ${v.total_amount}, ${v.currency ?? "USD"}, ${v.exchange_rate ?? null}, 'SP_MIGRATION_READONLY')
            RETURNING id
          `)
          ).rows as any[];
          const newVoucherId = pn(vRow.id);
          await trackRow(runId, "vouchers", newVoucherId);
          rowsCreated++;
          vouchersCreated++;

          await db.execute(sql`
            INSERT INTO sp_migration_source_links (run_id, source_table, source_id, target_table, target_id)
            VALUES (${runId}, 'vouchers', ${pn(v.id)}, 'vouchers', ${newVoucherId})
          `);

          // Copy the original sale-item rows so migrated vouchers show real item details
          // (not just the accounting entries) — display/history only, never touches stock.
          const sourceSaleItems = (
            await db.execute(sql`
            SELECT stock_item_id, quantity, selling_price, cost_price, total_sales, total_cost, profit, configured_price
            FROM sales_items WHERE voucher_id = ${v.id}
          `)
          ).rows as any[];
          if (!sourceSaleItems.length) {
            vouchersMissingItems++;
            summary.push(`Voucher ${v.voucher_number} has no source sale item rows; accounting-only voucher migrated.`);
          } else {
            for (const si of sourceSaleItems) {
              const targetStockItemId = stockItemMap.get(pn(si.stock_item_id));
              if (!targetStockItemId) {
                summary.push(
                  `Voucher ${v.voucher_number}: sale item for source stock_item_id=${si.stock_item_id} has no target stock item mapping — skipped (run Stock Master first).`
                );
                continue;
              }
              const [siRow] = (
                await db.execute(sql`
                INSERT INTO sales_items
                  (voucher_id, stock_item_id, quantity, selling_price, cost_price, total_sales, total_cost, profit, configured_price)
                VALUES
                  (${newVoucherId}, ${targetStockItemId}, ${si.quantity}, ${si.selling_price}, ${si.cost_price},
                   ${si.total_sales}, ${si.total_cost}, ${si.profit ?? "0"}, ${si.configured_price ?? null})
                RETURNING id
              `)
              ).rows as any[];
              await trackRow(runId, "sales_items", pn(siRow.id));
              itemRowsCreated++;
              rowsCreated++;
            }
          }

          const entries = (
            await db.execute(sql`SELECT ledger_account_id, debit_amount, credit_amount, narration FROM voucher_entries WHERE voucher_id = ${v.id}`)
          ).rows as any[];
          for (const e of entries) {
            const srcAcctId = e.ledger_account_id ? pn(e.ledger_account_id) : null;
            const mappedAcctId = srcAcctId !== null ? accountMap.get(srcAcctId) ?? suspenseAccountId : null;
            const [eRow] = (
              await db.execute(sql`
              INSERT INTO voucher_entries (voucher_id, ledger_account_id, debit_amount, credit_amount, narration)
              VALUES (${newVoucherId}, ${mappedAcctId}, ${e.debit_amount ?? "0"}, ${e.credit_amount ?? "0"}, ${e.narration ?? null})
              RETURNING id
            `)
            ).rows as any[];
            await trackRow(runId, "voucher_entries", pn(eRow.id));
            entriesCreated++;
            rowsCreated++;
          }
        }

        summary.push(
          `Vouchers: ${vouchersCreated} created (read-only), ${vouchersSkipped} skipped, ${entriesCreated} entries, ${itemRowsCreated} sale item rows copied`
        );
        if (vouchersMissingItems) summary.push(`${vouchersMissingItems} voucher(s) had no source sale item rows.`);

        await db.execute(sql`
          UPDATE sp_migration_rehearsal_runs SET status = 'completed', rows_created = ${rowsCreated}, completed_at = now() WHERE id = ${runId}
        `);

        return res.json({
          success: true,
          runId,
          rowsCreated,
          summary,
          reconciliation: { vouchersCreated, vouchersSkipped, entriesCreated, itemRowsCreated, vouchersMissingItems },
          warnings: [
            "These vouchers are marked read-only (sourceModule = SP_MIGRATION_READONLY, prefix MIG-GC-) and never move stock.",
            "Account mapping used account type matching — verify entries routed to Migration Suspense.",
          ],
        });
      } catch (err: any) {
        await db
          .execute(
            sql`UPDATE sp_migration_rehearsal_runs SET status = 'failed', error_message = ${err.message}, completed_at = now() WHERE id = ${runId}`
          )
          .catch(() => {});
        logger.error("[SP Migration] gc-sales-readonly error:", {
          sourceCompanyId: sourceId,
          targetCompanyId: targetId,
          runId,
          error: err?.message,
        });
        return res.status(500).json({
          message: `Historical sales migration failed: ${err?.message || "Unknown error"}`,
          runId,
        });
      }
    }
  );

  // ── Container migration into SP ─────────────────────────────────────────
  // POST /api/sp/migration/gc-containers
  // Creates sp_containers/sp_container_lines from ERP containers/purchase_orders/po_line_items.
  // Does NOT re-create stock movements for offloaded containers — that stock is
  // already covered by the stock-opening step; only OPEN (OTW) containers get an
  // OTW clearing voucher since their stock isn't yet in source inventory either.
  app.post("/api/sp/migration/gc-containers", requireAuth, requireRole("Developer"), async (req: any, res: any) => {
    const { sourceCompanyId, targetCompanyId, companyNameConfirm, confirmation } = req.body ?? {};
    if (confirmation !== "MIGRATE") {
      return res.status(400).json({ message: 'Requires confirmation = "MIGRATE"' });
    }
    const sourceId = parseInt(String(sourceCompanyId ?? ""), 10);
    const targetId = parseInt(String(targetCompanyId ?? ""), 10);
    if (!sourceId || !targetId) return res.status(400).json({ message: "sourceCompanyId and targetCompanyId required" });

    const sourceComp = await getCompanyRow(sourceId);
    const targetComp = await getCompanyRow(targetId);
    if (!sourceComp) return res.status(404).json({ message: "Source company not found" });
    if (!targetComp) return res.status(404).json({ message: "Target company not found" });
    if (sourceComp.company_type !== "erp") return res.status(400).json({ message: "Source company must be type 'erp'" });
    if (targetComp.company_type !== "supplier_partner")
      return res.status(400).json({ message: "Target company must be type 'supplier_partner'" });
    if (!companyNameConfirm || companyNameConfirm.trim() !== sourceComp.name) {
      return res.status(400).json({ message: `Company name confirmation must match exactly: "${sourceComp.name}"` });
    }
    const depError = await requireCompletedMigrationAction(sourceId, targetId, "gc_containers");
    if (depError) return res.status(409).json({ message: depError });

    const runId = await logRun(
      sourceId,
      targetId,
      "gc_containers",
      "running",
      0,
      null,
      `User: ${req.session?.userId ?? "unknown"} | Source: ${sourceComp.name} | Target: ${targetComp.name}`
    );

    let rowsCreated = 0;
    const summary: string[] = [];
    const chargeWarnings: string[] = [];
    let otwVouchersCreated = 0,
      otwVouchersSkipped = 0;
    try {
      const { map: stockItemMap } = await ensureTargetStockItems(sourceId, targetId, runId);

      // OTW accounts must exist before we can post open-container vouchers.
      const otwAcctRows = (
        await db.execute(sql`
        SELECT sub_type, id FROM ledger_accounts
        WHERE company_id = ${targetId} AND deleted_at IS NULL AND sub_type IN ('sp_goods_otw', 'sp_otw_clearing')
      `)
      ).rows as any[];
      const otwBySubType = new Map(otwAcctRows.map((r: any) => [r.sub_type, pn(r.id)]));
      const otwAssetAcctId = otwBySubType.get("sp_goods_otw");
      const otwClearingAcctId = otwBySubType.get("sp_otw_clearing");

      const containerRows = (
        await db.execute(sql`
        SELECT id, container_number, supplier_id, status, import_date, items_total, charges_total, grand_total
        FROM containers WHERE company_id = ${sourceId}
        ORDER BY import_date ASC, id ASC
      `)
      ).rows as any[];

      let containersCreated = 0,
        containersSkipped = 0,
        linesCreated = 0;

      for (const c of containerRows) {
        const srcContainerId = pn(c.id);
        const alreadyLinked = (
          await db.execute(sql`
          SELECT target_id FROM sp_migration_source_links
          WHERE source_table = 'containers' AND source_id = ${srcContainerId} AND target_table = 'sp_containers' LIMIT 1
        `)
        ).rows[0] as any;
        if (alreadyLinked) {
          containersSkipped++;
          continue;
        }

        // Supplier name lookup (best-effort — supplier match by name in target is a manual step, so supplierId stays null)
        const supplierRow = (
          await db.execute(sql`SELECT legal_name FROM suppliers WHERE id = ${pn(c.supplier_id)} LIMIT 1`)
        ).rows[0] as any;
        const supplierName = supplierRow?.legal_name ?? "Unknown Supplier (GC migration)";

        const poRow = (
          await db.execute(sql`
          SELECT id, po_number, freight FROM purchase_orders WHERE container_id = ${srcContainerId} LIMIT 1
        `)
        ).rows[0] as any;

        const status = c.status === "OTW" || c.status === "Open" ? "open" : "offloaded";

        const [contRow] = (
          await db.execute(sql`
          INSERT INTO sp_containers
            (company_id, supplier_id, supplier_name, container_number, invoice_number, invoice_date,
             invoice_total_usd, freight_estimate_usd, status, notes)
          VALUES
            (${targetId}, NULL, ${supplierName}, ${c.container_number}, ${poRow?.po_number ?? c.container_number},
             ${c.import_date}, ${c.items_total ?? "0"}, ${poRow?.freight ?? "0"}, ${status},
             ${"Migrated from GC-LSHI ERP container #" + c.container_number})
          RETURNING id
        `)
        ).rows as any[];
        const newContainerId = pn(contRow.id);
        await trackRow(runId, "sp_containers", newContainerId);
        await db.execute(sql`
          INSERT INTO sp_migration_source_links (run_id, source_table, source_id, target_table, target_id)
          VALUES (${runId}, 'containers', ${srcContainerId}, 'sp_containers', ${newContainerId})
        `);
        rowsCreated++;
        containersCreated++;

        // Open/OTW containers have goods in transit that are not yet in any inventory
        // (source or target), so unlike offloaded containers their value isn't covered
        // by the stock-opening step. Post a Dr Goods-OTW / Cr OTW Clearing voucher so the
        // asset shows up on the SP books, matching the container's invoice total.
        if (status === "open") {
          const otwAmount = parseFloat(String(c.items_total ?? c.grand_total ?? "0")) || 0;
          if (!otwAssetAcctId || !otwClearingAcctId) {
            chargeWarnings.push(
              `Container ${c.container_number}: is OTW but Goods-OTW/OTW-Clearing accounts are missing in target — no accounting voucher posted. Run account creation first.`
            );
          } else if (otwAmount <= 0) {
            chargeWarnings.push(
              `Container ${c.container_number}: is OTW but has no positive invoice total — skipped OTW voucher.`
            );
            otwVouchersSkipped++;
          } else {
            const otwVoucherNumber = `GC-OTW-${targetId}-${srcContainerId}`;
            const existingOtwV = (
              await db.execute(
                sql`SELECT id FROM vouchers WHERE company_id = ${targetId} AND voucher_number = ${otwVoucherNumber} LIMIT 1`
              )
            ).rows[0] as any;
            if (existingOtwV) {
              otwVouchersSkipped++;
            } else {
              const [otwVRow] = (
                await db.execute(sql`
                INSERT INTO vouchers (company_id, voucher_number, voucher_type, voucher_date, description, total_amount, currency, source_module)
                VALUES (${targetId}, ${otwVoucherNumber}, 'Journal', ${c.import_date ?? new Date().toISOString().split("T")[0]},
                        ${"GC Migration — Goods-OTW opening for container " + c.container_number},
                        ${otwAmount.toFixed(2)}, 'USD', 'SP_MIGRATION')
                RETURNING id
              `)
              ).rows as any[];
              const otwVoucherId = pn(otwVRow.id);
              await trackRow(runId, "vouchers", otwVoucherId);

              const [otwDrEntry] = (
                await db.execute(sql`
                INSERT INTO voucher_entries (voucher_id, ledger_account_id, debit_amount, credit_amount, narration)
                VALUES (${otwVoucherId}, ${otwAssetAcctId}, ${otwAmount.toFixed(2)}, '0.00', ${"Goods OTW — container " + c.container_number})
                RETURNING id
              `)
              ).rows as any[];
              await trackRow(runId, "voucher_entries", pn(otwDrEntry.id));

              const [otwCrEntry] = (
                await db.execute(sql`
                INSERT INTO voucher_entries (voucher_id, ledger_account_id, debit_amount, credit_amount, narration)
                VALUES (${otwVoucherId}, ${otwClearingAcctId}, '0.00', ${otwAmount.toFixed(2)}, ${"Goods OTW clearing — container " + c.container_number})
                RETURNING id
              `)
              ).rows as any[];
              await trackRow(runId, "voucher_entries", pn(otwCrEntry.id));

              rowsCreated += 3;
              otwVouchersCreated++;
            }
          }
        }

        if (poRow) {
          const lineItems = (
            await db.execute(sql`
            SELECT stock_item_id, item_name, quantity, rate FROM po_line_items WHERE po_id = ${pn(poRow.id)}
          `)
          ).rows as any[];
          for (const li of lineItems) {
            const srcStockItemId = li.stock_item_id ? pn(li.stock_item_id) : null;
            const targetStockItemId = srcStockItemId ? stockItemMap.get(srcStockItemId) ?? null : null;
            if (srcStockItemId && !targetStockItemId) {
              chargeWarnings.push(`Container ${c.container_number}: line "${li.item_name}" has no mapped target stock item.`);
            }
            const [lineRow] = (
              await db.execute(sql`
              INSERT INTO sp_container_lines (container_id, company_id, article_code, description, qty, unit_rate_usd, stock_item_id)
              VALUES (${newContainerId}, ${targetId}, ${li.item_name}, ${li.item_name}, ${li.quantity}, ${li.rate}, ${targetStockItemId})
              RETURNING id
            `)
            ).rows as any[];
            await trackRow(runId, "sp_container_lines", pn(lineRow.id));
            linesCreated++;
            rowsCreated++;
          }
        } else {
          chargeWarnings.push(`Container ${c.container_number}: no purchase order found — line items were not migrated.`);
        }

        // Charges beyond freight (duty, surcharge, fumigation, etc.) are best-effort noted, not posted —
        // they typically require account-specific mapping that must be reviewed manually.
        if (poRow) {
          chargeWarnings.push(
            `Container ${c.container_number}: only freight was carried over — duty/surcharge/fumigation/other charges must be reviewed and entered manually in SP.`
          );
        }
      }

      summary.push(`Containers: ${containersCreated} created, ${containersSkipped} skipped (already migrated), ${linesCreated} line(s) created`);
      summary.push(`OTW accounting: ${otwVouchersCreated} voucher(s) posted, ${otwVouchersSkipped} skipped (already posted or zero value)`);

      await db.execute(sql`
        UPDATE sp_migration_rehearsal_runs SET status = 'completed', rows_created = ${rowsCreated}, completed_at = now() WHERE id = ${runId}
      `);

      return res.json({
        success: true,
        runId,
        rowsCreated,
        summary,
        warnings: [
          ...Array.from(new Set(chargeWarnings)),
          "Supplier linkage was not auto-matched — set supplierId on migrated SP containers manually if needed.",
          "Offloaded containers' stock quantities are already covered by the stock-opening step; this step only migrates container/line records for history.",
        ],
      });
    } catch (err: any) {
      await db
        .execute(
          sql`UPDATE sp_migration_rehearsal_runs SET status = 'failed', error_message = ${err.message}, completed_at = now() WHERE id = ${runId}`
        )
        .catch(() => {});
      logger.error("[SP Migration] gc-containers error:", {
        sourceCompanyId: sourceId,
        targetCompanyId: targetId,
        runId,
        error: err?.message,
      });
      return res.status(500).json({
        message: `Container migration failed: ${err?.message || "Unknown error"}`,
        runId,
      });
    }
  });

  // ── Profit-share opening balance ────────────────────────────────────────
  // POST /api/sp/migration/gc-profit-opening
  // Posts: Dr GC-PROFCLR (accumulated profit) / Cr GC-OURPFT (our share) + Cr GC-SUPPFT (supplier share)
  app.post(
    "/api/sp/migration/gc-profit-opening",
    requireAuth,
    requireRole("Developer"),
    async (req: any, res: any) => {
      try {
        const {
          targetCompanyId,
          cutoffDate,
          accumulatedProfit,
          ourSplitPct,
          ourShareAmount: ourShareAmountRaw,
          supplierShareAmount: supplierShareAmountRaw,
          notes: profitNotes,
        } = req.body ?? {};
        const targetId = parseInt(String(targetCompanyId ?? ""), 10);
        const profit = parseFloat(accumulatedProfit);
        const ourPct = ourSplitPct !== undefined && ourSplitPct !== null && ourSplitPct !== "" ? parseFloat(ourSplitPct) : 50;

        // Manual split amounts take priority over the percentage when both are provided.
        const manualOurShare =
          ourShareAmountRaw !== undefined && ourShareAmountRaw !== null && ourShareAmountRaw !== ""
            ? parseFloat(ourShareAmountRaw)
            : null;
        const manualSupplierShare =
          supplierShareAmountRaw !== undefined && supplierShareAmountRaw !== null && supplierShareAmountRaw !== ""
            ? parseFloat(supplierShareAmountRaw)
            : null;
        const usingManualSplit = manualOurShare !== null && manualSupplierShare !== null;

        if (!targetId) return res.status(400).json({ message: "targetCompanyId is required" });
        if (!cutoffDate) return res.status(400).json({ message: "cutoffDate is required" });
        if (isNaN(profit) || profit < 0) return res.status(400).json({ message: "accumulatedProfit must be a non-negative number" });
        if (!usingManualSplit && (isNaN(ourPct) || ourPct < 0 || ourPct > 100))
          return res.status(400).json({ message: "ourSplitPct must be between 0 and 100" });
        if (usingManualSplit) {
          if (isNaN(manualOurShare!) || manualOurShare! < 0)
            return res.status(400).json({ message: "ourShareAmount must be a non-negative number" });
          if (isNaN(manualSupplierShare!) || manualSupplierShare! < 0)
            return res.status(400).json({ message: "supplierShareAmount must be a non-negative number" });
          if (Math.abs(manualOurShare! + manualSupplierShare! - profit) > 0.01) {
            return res.status(400).json({
              message: `Our share + supplier share (${(manualOurShare! + manualSupplierShare!).toFixed(2)}) must equal accumulated profit (${profit.toFixed(2)}).`,
            });
          }
        }

        const targetComp = await getCompanyRow(targetId);
        if (!targetComp) return res.status(404).json({ message: "Target company not found" });
        if (targetComp.company_type !== "supplier_partner")
          return res.status(400).json({ message: "Target must be a supplier_partner company" });

        const acctRows = (
          await db.execute(sql`
          SELECT sub_type, id FROM ledger_accounts
          WHERE company_id = ${targetId} AND deleted_at IS NULL
            AND sub_type IN ('gc_our_profit_share', 'gc_supplier_profit_share', 'gc_accumulated_profit_clearing')
        `)
        ).rows as any[];
        const bySubType = new Map(acctRows.map((r: any) => [r.sub_type, pn(r.id)]));
        const ourAcctId = bySubType.get("gc_our_profit_share");
        const supAcctId = bySubType.get("gc_supplier_profit_share");
        const clrAcctId = bySubType.get("gc_accumulated_profit_clearing");
        if (!ourAcctId || !supAcctId || !clrAcctId) {
          return res.status(400).json({
            message: "GC profit-share accounts not found in target company. Run the account creation step first.",
          });
        }

        const runId = await logRun(
          targetId,
          targetId,
          "gc_profit_opening",
          "running",
          0,
          null,
          `User: ${req.session?.userId ?? "unknown"} | Target: ${targetComp.name}`
        );

        const ourShare = usingManualSplit ? Math.round(manualOurShare! * 100) / 100 : Math.round(profit * (ourPct / 100) * 100) / 100;
        const supplierShare = usingManualSplit
          ? Math.round(manualSupplierShare! * 100) / 100
          : Math.round((profit - ourShare) * 100) / 100;
        const splitDescLabel = usingManualSplit ? "manual split" : `${ourPct}% / ${100 - ourPct}% split`;

        // Deterministic voucher number (no timestamp) so re-running for the same
        // target + cutoff date is idempotent instead of creating a duplicate journal.
        const voucherNumber = `GC-PROFIT-OPN-${targetId}-${cutoffDate}`;
        const existing = (
          await db.execute(sql`SELECT id FROM vouchers WHERE company_id = ${targetId} AND voucher_number = ${voucherNumber} LIMIT 1`)
        ).rows[0] as any;
        if (existing) {
          await db
            .execute(
              sql`UPDATE sp_migration_rehearsal_runs SET status = 'failed', error_message = 'Duplicate — already posted', completed_at = now() WHERE id = ${runId}`
            )
            .catch(() => {});
          return res.status(409).json({
            message: `A profit-share opening balance for ${cutoffDate} has already been posted (voucher ${voucherNumber}). Roll it back first if you need to re-post with different figures.`,
            voucherId: pn(existing.id),
            voucherNumber,
          });
        }

        const [vRow] = (
          await db.execute(sql`
          INSERT INTO vouchers (company_id, voucher_number, voucher_type, voucher_date, description, total_amount, currency, source_module)
          VALUES (${targetId}, ${voucherNumber}, 'Journal', ${cutoffDate},
                  ${`GC accumulated profit-share opening balance as of ${cutoffDate} (${splitDescLabel})${profitNotes ? " — " + profitNotes : ""}`},
                  ${profit.toFixed(2)}, 'USD', 'SP_MIGRATION')
          RETURNING id
        `)
        ).rows as any[];
        const voucherId = pn(vRow.id);
        await trackRow(runId, "vouchers", voucherId);

        const clrEntry = (
          await db.execute(sql`
          INSERT INTO voucher_entries (voucher_id, ledger_account_id, debit_amount, credit_amount, narration)
          VALUES (${voucherId}, ${clrAcctId}, ${profit.toFixed(2)}, '0.00', 'Accumulated profit clearing')
          RETURNING id
        `)
        ).rows[0] as any;
        await trackRow(runId, "voucher_entries", pn(clrEntry.id));

        const ourEntry = (
          await db.execute(sql`
          INSERT INTO voucher_entries (voucher_id, ledger_account_id, debit_amount, credit_amount, narration)
          VALUES (${voucherId}, ${ourAcctId}, '0.00', ${ourShare.toFixed(2)}, 'Our profit share opening balance')
          RETURNING id
        `)
        ).rows[0] as any;
        await trackRow(runId, "voucher_entries", pn(ourEntry.id));

        const supEntry = (
          await db.execute(sql`
          INSERT INTO voucher_entries (voucher_id, ledger_account_id, debit_amount, credit_amount, narration)
          VALUES (${voucherId}, ${supAcctId}, '0.00', ${supplierShare.toFixed(2)}, 'Supplier profit share opening balance')
          RETURNING id
        `)
        ).rows[0] as any;
        await trackRow(runId, "voucher_entries", pn(supEntry.id));

        await db.execute(sql`
          UPDATE sp_migration_rehearsal_runs SET status = 'completed', rows_created = 4, completed_at = now() WHERE id = ${runId}
        `);

        return res.json({
          success: true,
          runId,
          voucherId,
          voucherNumber,
          accumulatedProfit: profit,
          ourShare,
          supplierShare,
          ourSplitPct: ourPct,
        });
      } catch (err: any) {
        logger.error("[SP Migration] gc-profit-opening error:", { error: err });
        return res.status(500).json({ message: "Internal server error" });
      }
    }
  );

  // ── Final reconciliation report ─────────────────────────────────────────
  // GET /api/sp/migration/gc-reconciliation
  app.get(
    "/api/sp/migration/gc-reconciliation",
    requireAuth,
    requireRole("Developer"),
    async (req: any, res: any) => {
      try {
        const sourceId = parseInt(String(req.query.sourceCompanyId ?? ""), 10);
        const targetId = parseInt(String(req.query.targetCompanyId ?? ""), 10);
        if (!sourceId || !targetId)
          return res.status(400).json({ message: "sourceCompanyId and targetCompanyId are required" });

        const areas: Array<{ area: string; status: "PASS" | "FAIL" | "WARN"; detail: string; mismatches?: string[] }> = [];

        // 1. Stock master: every source stock item (with positive inventory) must have a target link
        const unlinkedItemRows = (
          await db.execute(sql`
          SELECT si.id, si.code, si.name FROM stock_items si
          JOIN inventory inv ON inv.stock_item_id = si.id AND inv.company_id = ${sourceId}
          WHERE si.company_id = ${sourceId} AND si.deleted_at IS NULL AND inv.quantity > 0
            AND NOT EXISTS (
              SELECT 1 FROM sp_migration_source_links l
              WHERE l.source_table = 'stock_items' AND l.source_id = si.id AND l.target_table = 'stock_items'
            )
          ORDER BY si.code LIMIT 50
        `)
        ).rows as any[];
        areas.push({
          area: "Stock master",
          status: unlinkedItemRows.length === 0 ? "PASS" : "FAIL",
          detail:
            unlinkedItemRows.length === 0
              ? "All source stock items are linked to target."
              : `${unlinkedItemRows.length} source item(s) have no target stock item link (showing up to 50).`,
          mismatches: unlinkedItemRows.map((r: any) => `${r.code} — ${r.name}`),
        });

        // 2. Stock in hand: per-item qty comparison via source links (source vs mapped target item),
        // not just a global sum, so items that offset each other don't hide real mismatches.
        const perItemStock = (
          await db.execute(sql`
          SELECT si.code, si.name,
                 COALESCE((SELECT SUM(quantity) FROM inventory WHERE company_id = ${sourceId} AND stock_item_id = si.id), 0) AS src_qty,
                 COALESCE((SELECT SUM(quantity) FROM inventory WHERE company_id = ${targetId} AND stock_item_id = l.target_id), 0) AS tgt_qty
          FROM stock_items si
          JOIN sp_migration_source_links l ON l.source_table = 'stock_items' AND l.source_id = si.id AND l.target_table = 'stock_items'
          WHERE si.company_id = ${sourceId} AND si.deleted_at IS NULL
        `)
        ).rows as any[];
        const stockMismatches = perItemStock.filter((r: any) => Math.abs(pn(r.src_qty) - pn(r.tgt_qty)) > 0.01);
        const srcStock = (
          await db.execute(sql`SELECT COALESCE(SUM(quantity),0) AS q, COALESCE(SUM(quantity*average_rate),0) AS v FROM inventory WHERE company_id = ${sourceId}`)
        ).rows[0] as any;
        const tgtStock = (
          await db.execute(sql`SELECT COALESCE(SUM(quantity),0) AS q, COALESCE(SUM(quantity*average_rate),0) AS v FROM inventory WHERE company_id = ${targetId}`)
        ).rows[0] as any;
        areas.push({
          area: "Stock in hand",
          status: stockMismatches.length === 0 ? "PASS" : "WARN",
          detail: `Totals — source qty ${pn(srcStock.q).toFixed(3)} vs target qty ${pn(tgtStock.q).toFixed(3)} (value ${pn(srcStock.v).toFixed(2)} vs ${pn(tgtStock.v).toFixed(2)}). ${stockMismatches.length} linked item(s) have a qty mismatch.`,
          mismatches: stockMismatches
            .slice(0, 50)
            .map((r: any) => `${r.code} — source ${pn(r.src_qty).toFixed(3)} vs target ${pn(r.tgt_qty).toFixed(3)}`),
        });

        // 3. Historical sales — per-voucher check that each source sale has a migrated read-only copy
        const unmigratedSales = (
          await db.execute(sql`
          SELECT v.id, v.voucher_number FROM vouchers v
          WHERE v.company_id = ${sourceId} AND v.voucher_type IN ('Sales','Sale') AND v.deleted_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM sp_migration_source_links l
              WHERE l.source_table = 'vouchers' AND l.source_id = v.id AND l.target_table = 'vouchers'
            )
          ORDER BY v.voucher_number LIMIT 50
        `)
        ).rows as any[];
        const srcSales = (
          await db.execute(sql`SELECT COUNT(*) AS cnt FROM vouchers WHERE company_id = ${sourceId} AND voucher_type IN ('Sales','Sale') AND deleted_at IS NULL`)
        ).rows[0] as any;
        const tgtSales = (
          await db.execute(sql`SELECT COUNT(*) AS cnt FROM vouchers WHERE company_id = ${targetId} AND source_module = 'SP_MIGRATION_READONLY' AND deleted_at IS NULL`)
        ).rows[0] as any;
        const srcSaleItems = (
          await db.execute(sql`
          SELECT COUNT(*) AS cnt FROM sales_items si JOIN vouchers v ON v.id = si.voucher_id
          WHERE v.company_id = ${sourceId} AND v.voucher_type IN ('Sales','Sale') AND v.deleted_at IS NULL
        `)
        ).rows[0] as any;
        const migratedSaleItems = (
          await db.execute(sql`
          SELECT COUNT(*) AS cnt FROM sales_items si JOIN vouchers v ON v.id = si.voucher_id
          WHERE v.company_id = ${targetId} AND v.source_module = 'SP_MIGRATION_READONLY' AND v.deleted_at IS NULL
        `)
        ).rows[0] as any;
        const migratedVouchersWithoutItems = (
          await db.execute(sql`
          SELECT v.voucher_number FROM vouchers v
          WHERE v.company_id = ${targetId} AND v.source_module = 'SP_MIGRATION_READONLY' AND v.deleted_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM sales_items si WHERE si.voucher_id = v.id)
          ORDER BY v.voucher_number LIMIT 50
        `)
        ).rows as any[];
        const salesStatus =
          unmigratedSales.length > 0 ? "WARN" : migratedVouchersWithoutItems.length > 0 ? "WARN" : "PASS";
        areas.push({
          area: "Historical sales",
          status: salesStatus,
          detail:
            `Source: ${pn(srcSales.cnt)} sale voucher(s), ${pn(srcSaleItems.cnt)} item row(s). ` +
            `Migrated read-only: ${pn(tgtSales.cnt)} voucher(s), ${pn(migratedSaleItems.cnt)} item row(s). ` +
            `${unmigratedSales.length} source sale(s) have no migrated copy. ` +
            `${migratedVouchersWithoutItems.length} migrated voucher(s) have no item rows (accounting-only).`,
          mismatches: [
            ...unmigratedSales.map((r: any) => `Not migrated: ${r.voucher_number}`),
            ...migratedVouchersWithoutItems.map((r: any) => `No item rows: ${r.voucher_number}`),
          ],
        });

        // 4. Containers — list which source containers have no migrated sp_containers row
        const unmigratedContainers = (
          await db.execute(sql`
          SELECT c.id, c.container_number, c.status FROM containers c
          WHERE c.company_id = ${sourceId}
            AND NOT EXISTS (
              SELECT 1 FROM sp_migration_source_links l
              WHERE l.source_table = 'containers' AND l.source_id = c.id AND l.target_table = 'sp_containers'
            )
          ORDER BY c.container_number LIMIT 50
        `)
        ).rows as any[];
        const srcContainers = (await db.execute(sql`SELECT COUNT(*) AS cnt FROM containers WHERE company_id = ${sourceId}`)).rows[0] as any;
        const tgtContainers = (
          await db.execute(sql`
          SELECT COUNT(*) AS cnt FROM sp_migration_source_links WHERE source_table = 'containers' AND target_table = 'sp_containers'
            AND run_id IN (SELECT id FROM sp_migration_rehearsal_runs WHERE source_company_id = ${sourceId} AND target_company_id = ${targetId})
        `)
        ).rows[0] as any;
        areas.push({
          area: "Containers",
          status: unmigratedContainers.length === 0 ? "PASS" : "WARN",
          detail: `Source: ${pn(srcContainers.cnt)} container(s). Migrated: ${pn(tgtContainers.cnt)}. ${unmigratedContainers.length} container(s) not yet migrated (showing up to 50).`,
          mismatches: unmigratedContainers.map((r: any) => `${r.container_number} (${r.status})`),
        });

        // 4b. OTW containers must have a Goods-OTW accounting voucher posted
        const missingOtwVouchers = (
          await db.execute(sql`
          SELECT c.container_number FROM containers c
          WHERE c.company_id = ${sourceId} AND (c.status = 'OTW' OR c.status = 'Open')
            AND EXISTS (
              SELECT 1 FROM sp_migration_source_links l
              WHERE l.source_table = 'containers' AND l.source_id = c.id AND l.target_table = 'sp_containers'
                AND l.run_id IN (SELECT id FROM sp_migration_rehearsal_runs WHERE source_company_id = ${sourceId} AND target_company_id = ${targetId})
            )
            AND NOT EXISTS (
              SELECT 1 FROM vouchers v WHERE v.company_id = ${targetId} AND v.voucher_number = 'GC-OTW-' || ${targetId} || '-' || c.id
            )
          ORDER BY c.container_number LIMIT 50
        `)
        ).rows as any[];
        areas.push({
          area: "Container OTW accounting",
          status: missingOtwVouchers.length === 0 ? "PASS" : "WARN",
          detail:
            missingOtwVouchers.length === 0
              ? "All migrated OTW containers have a Goods-OTW voucher posted."
              : `${missingOtwVouchers.length} migrated OTW container(s) are missing their Goods-OTW voucher.`,
          mismatches: missingOtwVouchers.map((r: any) => r.container_number),
        });

        // 5. Accounting balance — verify all migrated vouchers in target are balanced
        const unbalancedRows = (
          await db.execute(sql`
          SELECT v.voucher_number, SUM(ve.debit_amount::numeric) AS d, SUM(ve.credit_amount::numeric) AS c
          FROM voucher_entries ve JOIN vouchers v ON v.id = ve.voucher_id
          WHERE v.company_id = ${targetId} AND (v.source_module IN ('ERP','SP_MIGRATION_READONLY','SP_MIGRATION'))
          GROUP BY v.id, v.voucher_number
          HAVING ABS(SUM(ve.debit_amount::numeric) - SUM(ve.credit_amount::numeric)) > 0.01
          LIMIT 50
        `)
        ).rows as any[];
        areas.push({
          area: "Accounting",
          status: unbalancedRows.length === 0 ? "PASS" : "FAIL",
          detail: unbalancedRows.length === 0 ? "All migrated vouchers are balanced." : `${unbalancedRows.length} migrated voucher(s) are unbalanced.`,
          mismatches: unbalancedRows.map((r: any) => `${r.voucher_number} — Dr ${pn(r.d).toFixed(2)} vs Cr ${pn(r.c).toFixed(2)}`),
        });

        // 6. Profit opening
        const profitOpening = (
          await db.execute(sql`SELECT voucher_number, total_amount FROM vouchers WHERE company_id = ${targetId} AND voucher_number LIKE 'GC-PROFIT-OPN-%'`)
        ).rows as any[];
        areas.push({
          area: "Profit opening",
          status: profitOpening.length > 0 ? "PASS" : "WARN",
          detail:
            profitOpening.length > 0
              ? `${profitOpening.length} profit-opening voucher(s) posted.`
              : "No profit-share opening balance has been posted yet.",
          mismatches: profitOpening.map((r: any) => `${r.voucher_number} — ${pn(r.total_amount).toFixed(2)}`),
        });

        const overall = areas.some((a) => a.status === "FAIL") ? "FAIL" : areas.some((a) => a.status === "WARN") ? "WARN" : "PASS";

        // Detect the specific partial-run scenario: stock master done, stock-in-hand empty on
        // target, but later steps (historical sales / containers) already ran. Surface a clear
        // recovery instruction instead of silently letting the user proceed further.
        const stockMasterArea = areas.find((a) => a.area === "Stock master");
        const stockInHandArea = areas.find((a) => a.area === "Stock in hand");
        const salesArea = areas.find((a) => a.area === "Historical sales");
        const containersArea = areas.find((a) => a.area === "Containers");
        const targetHasNoStock = pn(tgtStock.q) === 0 && pn(srcStock.q) > 0;
        const laterStepsRan = pn(tgtSales.cnt) > 0 || pn(tgtContainers.cnt) > 0;
        let partialMigrationWarning: string | null = null;
        if (stockMasterArea?.status === "PASS" && targetHasNoStock && laterStepsRan) {
          partialMigrationWarning =
            "This migration is partially applied. Stock opening failed but later steps were run. " +
            "Roll back Step 7 Containers, then Step 6 Historical Sales, then rerun Step 5 Stock Opening before continuing.";
        }

        return res.json({ overall, areas, partialMigrationWarning });
      } catch (err: any) {
        logger.error("[SP Migration] gc-reconciliation error:", { error: err });
        return res.status(500).json({ message: "Internal server error" });
      }
    }
  );

  // ── HARD GUARD: No cutover endpoint ─────────────────────────────────────
  // This explicitly blocks any attempt to POST to /api/sp/migration/cutover.
  // Phase 5 final migration is not implemented.
  app.all("/api/sp/migration/cutover", requireAuth, (_req: any, res: any) => {
    return res.status(403).json({
      message: "BLOCKED: Final production migration (cutover) is not available. Phase 5 is disabled.",
      code: "CUTOVER_DISABLED",
    });
  });
}
