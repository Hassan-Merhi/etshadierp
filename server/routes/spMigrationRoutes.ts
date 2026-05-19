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
import { db } from "../db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../auth";
import { ledgerAccounts, locations } from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";

const pn = (v: any) => { const n = parseFloat(String(v ?? "0")); return isNaN(n) ? 0 : n; };

// ── SP chart of accounts (same list as spRoutes.ts) ──────────────────────────
const SP_ACCOUNTS = [
  { code: "SP-OTW",     name: "Goods On The Way",            accountType: "Asset",          subType: "sp_goods_otw"      },
  { code: "SP-OTWCLR",  name: "Goods OTW Clearing",          accountType: "Liability",       subType: "sp_otw_clearing"   },
  { code: "SP-PREPAID", name: "Prepaid Charges",             accountType: "Asset",          subType: "sp_prepaid"        },
  { code: "SP-STOCK",   name: "Stock on Floor",              accountType: "Asset",          subType: "sp_stock"          },
  { code: "SP-COSTCLR", name: "Stock Cost Payable Clearing", accountType: "Liability",       subType: "sp_cost_clearing"  },
  { code: "SP-PAY",     name: "Supplier Cash Payable",       accountType: "Liability",       subType: "sp_payable"        },
  { code: "SP-SALES",   name: "Sales",                       accountType: "Income",         subType: "sp_sales"          },
  { code: "SP-COGS",    name: "Cost of Goods Sold",          accountType: "Direct Expense", subType: "sp_cogs"           },
  { code: "SP-SHARED",  name: "Shared Charges",              accountType: "Direct Expense", subType: "sp_shared_charges" },
  { code: "SP-OPNBAL",  name: "Opening Balance Clearing",    accountType: "Equity",         subType: "sp_opnbal"         },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getCompanyRow(companyId: number) {
  const rows = await db.execute(sql`SELECT id, code, name, company_type FROM companies WHERE id = ${companyId} LIMIT 1`);
  return (rows as any).rows?.[0] ?? (rows as any)[0] ?? null;
}

async function logRun(
  sourceId: number, targetId: number, action: string, status: string,
  rowsCreated: number, errorMessage: string | null, notes: string | null
): Promise<string> {
  const [row] = (await db.execute(sql`
    INSERT INTO sp_migration_rehearsal_runs
      (source_company_id, target_company_id, action, status, rows_created, error_message, notes)
    VALUES
      (${sourceId}, ${targetId}, ${action}, ${status}, ${rowsCreated}, ${errorMessage}, ${notes})
    RETURNING id
  `)).rows as any[];
  return row.id;
}

async function trackRow(runId: string, tableName: string, rowId: number) {
  await db.execute(sql`
    INSERT INTO sp_migration_run_rows (run_id, table_name, row_id)
    VALUES (${runId}, ${tableName}, ${rowId})
  `);
}

async function ensureSpAccounts(targetId: number): Promise<string[]> {
  const created: string[] = [];
  for (const acct of SP_ACCOUNTS) {
    const existing = await db.select().from(ledgerAccounts)
      .where(and(eq(ledgerAccounts.companyId, targetId), eq(ledgerAccounts.subType, acct.subType), isNull(ledgerAccounts.deletedAt)));
    if (!existing.length) {
      await db.insert(ledgerAccounts).values({
        companyId: targetId,
        code: acct.code,
        name: acct.name,
        accountType: acct.accountType,
        subType: acct.subType,
        isHidden: acct.subType.includes("clearing") || acct.subType === "sp_opnbal",
        active: true,
      });
      created.push(acct.name);
    }
  }
  return created;
}

// ── Route Registration ─────────────────────────────────────────────────────────

export function registerSpMigrationRoutes(app: Express) {

  // ── GET /api/sp/migration/preview ────────────────────────────────────────
  // Dry run — NO writes. Returns what WOULD be copied.
  app.get("/api/sp/migration/preview", requireAuth, async (req: any, res: any) => {
    try {
      const sourceId = parseInt(String(req.query.sourceCompanyId ?? ""), 10);
      const targetId = parseInt(String(req.query.targetCompanyId ?? ""), 10);

      if (!sourceId || !targetId) {
        return res.status(400).json({ message: "sourceCompanyId and targetCompanyId are required" });
      }
      if (sourceId === targetId) {
        return res.status(400).json({ message: "Source and target companies must be different" });
      }

      const sourceComp = await getCompanyRow(sourceId);
      const targetComp = await getCompanyRow(targetId);

      if (!sourceComp) return res.status(404).json({ message: "Source company not found" });
      if (!targetComp) return res.status(404).json({ message: "Target company not found" });

      if (sourceComp.company_type !== "erp") {
        return res.status(400).json({ message: "Source company must be type 'erp'" });
      }
      if (targetComp.company_type !== "supplier_partner") {
        return res.status(400).json({ message: "Target company must be type 'supplier_partner'" });
      }

      // 1. Stock items with positive inventory
      const stockRows = (await db.execute(sql`
        SELECT
          si.id            AS stock_item_id,
          si.code,
          si.name,
          si.unit,
          inv.quantity,
          inv.average_rate,
          ROUND(inv.quantity * COALESCE(inv.average_rate, 0), 4) AS total_value
        FROM stock_items si
        JOIN inventory inv ON inv.stock_item_id = si.id AND inv.company_id = ${sourceId}
        WHERE si.company_id = ${sourceId}
          AND si.deleted_at IS NULL
          AND inv.quantity > 0
        ORDER BY si.code
      `)).rows as any[];

      // 2. Which items already have aliases in target
      const existingAliases = (await db.execute(sql`
        SELECT alias_code FROM stock_item_code_aliases WHERE company_id = ${targetId}
      `)).rows as any[];
      const existingAliasCodes = new Set(existingAliases.map((r: any) => r.alias_code));

      const stockItems = stockRows.map((r: any) => ({
        stockItemId:      pn(r.stock_item_id),
        code:             r.code,
        name:             r.name,
        unit:             r.unit,
        quantity:         pn(r.quantity),
        averageCostUsd:   pn(r.average_rate),
        totalValueUsd:    pn(r.total_value),
        aliasExists:      existingAliasCodes.has(r.code),
        openingStockExists: false, // always fresh in a new run
      }));

      // 3. SP accounts status in target
      const spAcctRows = (await db.execute(sql`
        SELECT sub_type FROM ledger_accounts
        WHERE company_id = ${targetId} AND deleted_at IS NULL AND sub_type LIKE 'sp_%'
      `)).rows as any[];
      const existingSpSubTypes = new Set(spAcctRows.map((r: any) => r.sub_type));
      const spAccountsStatus = SP_ACCOUNTS.map(a => ({
        subType: a.subType, name: a.name,
        exists: existingSpSubTypes.has(a.subType),
      }));

      // 4. Sales totals in source
      const salesRow = (await db.execute(sql`
        SELECT COUNT(*) AS cnt, COALESCE(SUM(total_amount), 0) AS total
        FROM vouchers
        WHERE company_id = ${sourceId} AND voucher_type = 'Sale'
          AND deleted_at IS NULL
      `)).rows[0] as any;

      // 5. Top cash/bank/payable accounts in source (approximate, computed from entries)
      const balanceRows = (await db.execute(sql`
        SELECT
          la.code, la.name, la.account_type,
          COALESCE(
            (SELECT SUM(ve.debit_amount) - SUM(ve.credit_amount)
             FROM voucher_entries ve
             JOIN vouchers v ON v.id = ve.voucher_id
             WHERE ve.ledger_account_id = la.id AND v.deleted_at IS NULL), 0
          ) AS balance
        FROM ledger_accounts la
        WHERE la.company_id = ${sourceId}
          AND la.deleted_at IS NULL
          AND la.account_type IN ('Cash', 'Bank', 'Creditor', 'Liability', 'Current Liability')
        ORDER BY la.account_type, la.name
        LIMIT 25
      `)).rows as any[];

      // 6. Totals summary
      const totalQty        = stockItems.reduce((s: number, i: any) => s + i.quantity, 0);
      const totalValue      = stockItems.reduce((s: number, i: any) => s + i.totalValueUsd, 0);
      const alreadyMapped   = stockItems.filter((i: any) => i.aliasExists).length;
      const unmapped        = stockItems.filter((i: any) => !i.aliasExists).length;

      // 7. Warnings
      const warnings: string[] = [];
      if (stockItems.length === 0) warnings.push("No stock items with positive inventory found in source company.");
      if (alreadyMapped > 0)       warnings.push(`${alreadyMapped} item(s) already have aliases in target — they will be skipped during rehearsal copy.`);
      warnings.push("Open Goods-OTW containers (ERP purchase orders) cannot be auto-migrated — recreate them manually in the SP Containers screen.");
      warnings.push("Cash and bank balances shown below are approximate (debit minus credit sum). Verify in source ERP before migrating.");
      warnings.push("Prepaid charges and accrued duties cannot be automatically detected — add them manually after rehearsal copy.");
      warnings.push("This is a REHEARSAL PREVIEW only. No data has been written.");

      return res.json({
        dryRun:       true,
        sourceCompany: { id: sourceComp.id, code: sourceComp.code, name: sourceComp.name, type: sourceComp.company_type },
        targetCompany: { id: targetComp.id, code: targetComp.code, name: targetComp.name, type: targetComp.company_type },
        stockItems,
        totals: {
          itemCount:    stockItems.length,
          totalQty:     Math.round(totalQty * 1000) / 1000,
          totalValueUsd: Math.round(totalValue * 100) / 100,
          alreadyMapped,
          willBeCopied: unmapped,
        },
        spAccountsStatus,
        salesSummary: {
          voucherCount: pn(salesRow.cnt),
          totalAmount:  pn(salesRow.total),
        },
        balanceAccounts: balanceRows.map((r: any) => ({
          code: r.code, name: r.name, accountType: r.account_type, balance: pn(r.balance),
        })),
        warnings,
      });
    } catch (err: any) {
      console.error("[SP Migration] preview error:", err);
      return res.status(500).json({ message: err.message });
    }
  });

  // ── GET /api/sp/migration/runs ──────────────────────────────────────────
  app.get("/api/sp/migration/runs", requireAuth, async (_req: any, res: any) => {
    try {
      const runs = (await db.execute(sql`
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
      `)).rows;
      return res.json({ runs });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ── POST /api/sp/migration/rehearsal ────────────────────────────────────
  // Requires: { sourceCompanyId, targetCompanyId, companyNameConfirm, confirmation: "REHEARSE" }
  app.post("/api/sp/migration/rehearsal", requireAuth, async (req: any, res: any) => {
    const { sourceCompanyId, targetCompanyId, companyNameConfirm, confirmation } = req.body ?? {};

    // Safety gate 1: typed action confirmation
    if (confirmation !== "REHEARSE") {
      return res.status(400).json({ message: "Rehearsal requires confirmation = \"REHEARSE\"" });
    }

    const sourceId = parseInt(String(sourceCompanyId ?? ""), 10);
    const targetId = parseInt(String(targetCompanyId ?? ""), 10);

    if (!sourceId || !targetId) return res.status(400).json({ message: "sourceCompanyId and targetCompanyId required" });
    if (sourceId === targetId)  return res.status(400).json({ message: "Source and target must be different" });

    const sourceComp = await getCompanyRow(sourceId);
    const targetComp = await getCompanyRow(targetId);
    if (!sourceComp) return res.status(404).json({ message: "Source company not found" });
    if (!targetComp) return res.status(404).json({ message: "Target company not found" });

    // Safety gate 2: source must be ERP
    if (sourceComp.company_type !== "erp") {
      return res.status(400).json({ message: "Source company must be type 'erp'" });
    }
    // Safety gate 3: target must be SP
    if (targetComp.company_type !== "supplier_partner") {
      return res.status(400).json({ message: "Target company must be type 'supplier_partner'" });
    }
    // Safety gate 4: company name confirmation must match exactly
    if (!companyNameConfirm || companyNameConfirm.trim() !== sourceComp.name) {
      return res.status(400).json({
        message: `Company name confirmation does not match. Expected exactly: "${sourceComp.name}"`,
      });
    }

    // Log the attempt immediately (even if it fails later)
    let runId: string = "";
    try {
      runId = await logRun(sourceId, targetId, "rehearsal", "running", 0, null,
        `User: ${req.session?.userId ?? "unknown"} | Source: ${sourceComp.name} | Target: ${targetComp.name}`);
    } catch (logErr: any) {
      return res.status(500).json({ message: "Failed to create run log: " + logErr.message });
    }

    let rowsCreated = 0;
    const summary: string[] = [];

    try {
      // 1. Ensure SP chart of accounts in target
      const createdAccounts = await ensureSpAccounts(targetId);
      if (createdAccounts.length) summary.push(`Created SP accounts: ${createdAccounts.join(", ")}`);

      // 2. Ensure default location in target
      const locs = await db.select().from(locations)
        .where(and(eq(locations.companyId, targetId), isNull(locations.deletedAt)));
      if (!locs.length) {
        const [locRow] = (await db.execute(sql`
          INSERT INTO locations (company_id, code, name, active)
          VALUES (${targetId}, 'SP-WH-001', 'Main Warehouse', true)
          RETURNING id
        `)).rows as any[];
        await trackRow(runId, "locations", locRow.id);
        rowsCreated++;
        summary.push("Created default warehouse location");
      }

      // 3. Fetch source stock items with positive inventory
      const stockRows = (await db.execute(sql`
        SELECT
          si.id AS stock_item_id, si.code, si.name, si.unit,
          inv.quantity, inv.average_rate
        FROM stock_items si
        JOIN inventory inv ON inv.stock_item_id = si.id AND inv.company_id = ${sourceId}
        WHERE si.company_id = ${sourceId}
          AND si.deleted_at IS NULL
          AND inv.quantity > 0
        ORDER BY si.code
      `)).rows as any[];

      summary.push(`Found ${stockRows.length} source stock items with positive inventory`);

      // 4. For each item: create alias + opening stock movement
      let aliasesCreated = 0;
      let aliasesSkipped = 0;
      let movementsCreated = 0;

      for (const item of stockRows as any[]) {
        const stockItemId = pn(item.stock_item_id);
        const qty         = pn(item.quantity);
        const avgRate     = pn(item.average_rate);

        // Check if alias already exists
        const existingAlias = (await db.execute(sql`
          SELECT id FROM stock_item_code_aliases
          WHERE company_id = ${targetId} AND alias_code = ${item.code}
          LIMIT 1
        `)).rows[0] as any;

        if (!existingAlias) {
          const [aliasRow] = (await db.execute(sql`
            INSERT INTO stock_item_code_aliases
              (company_id, stock_item_id, alias_code, description)
            VALUES (${targetId}, ${stockItemId}, ${item.code}, ${item.name})
            RETURNING id
          `)).rows as any[];
          await trackRow(runId, "stock_item_code_aliases", pn(aliasRow.id));
          aliasesCreated++;
          rowsCreated++;
        } else {
          aliasesSkipped++;
        }

        // Always create opening stock movement for this run
        const [movRow] = (await db.execute(sql`
          INSERT INTO sp_stock_movements
            (company_id, article_code, description, stock_item_id,
             qty_in, qty_remaining,
             base_unit_cost_usd, landed_unit_cost_usd, final_unit_cost_usd,
             source_type, container_id, offload_id, container_line_id)
          VALUES
            (${targetId}, ${item.code},
             ${"Rehearsal opening stock from " + sourceComp.name},
             ${stockItemId},
             ${qty}, ${qty},
             ${avgRate.toFixed(6)}, ${avgRate.toFixed(6)}, ${avgRate.toFixed(6)},
             'opening_stock', NULL, NULL, NULL)
          RETURNING id
        `)).rows as any[];
        await trackRow(runId, "sp_stock_movements", pn(movRow.id));
        movementsCreated++;
        rowsCreated++;
      }

      summary.push(`Aliases created: ${aliasesCreated}, skipped (already existed): ${aliasesSkipped}`);
      summary.push(`Opening stock movements created: ${movementsCreated}`);

      // 5. Compute reconciliation totals
      const totalQty   = (stockRows as any[]).reduce((s: number, r: any) => s + pn(r.quantity), 0);
      const totalValue = (stockRows as any[]).reduce((s: number, r: any) => s + pn(r.quantity) * pn(r.average_rate), 0);

      // Mark run as completed
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
        reconciliation: {
          sourceCompany:  sourceComp.name,
          targetCompany:  targetComp.name,
          itemsCopied:    movementsCreated,
          aliasesCreated,
          aliasesSkipped,
          totalQty:       Math.round(totalQty * 1000) / 1000,
          totalValueUsd:  Math.round(totalValue * 100) / 100,
        },
        warnings: [
          "Opening stock costs use source inventory average_rate. Verify these match your agreed supplier costs.",
          "Goods-OTW containers must be recreated manually in the SP Containers screen.",
          "This was a REHEARSAL COPY — target company only. Source was not modified.",
        ],
      });
    } catch (err: any) {
      // Mark run as failed
      await db.execute(sql`
        UPDATE sp_migration_rehearsal_runs
        SET status = 'failed', error_message = ${err.message}, completed_at = now()
        WHERE id = ${runId}
      `).catch(() => {});
      console.error("[SP Migration] rehearsal error:", err);
      return res.status(500).json({ message: err.message, runId });
    }
  });

  // ── POST /api/sp/migration/rollback ─────────────────────────────────────
  // Removes ONLY rows created by a specific rehearsal run.
  // Never touches source (ERP) company.
  app.post("/api/sp/migration/rollback", requireAuth, async (req: any, res: any) => {
    const { runId } = req.body ?? {};
    if (!runId) return res.status(400).json({ message: "runId is required" });

    try {
      // Fetch run metadata
      const runRow = (await db.execute(sql`
        SELECT id, source_company_id, target_company_id, status
        FROM sp_migration_rehearsal_runs WHERE id = ${runId} LIMIT 1
      `)).rows[0] as any;

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
      const trackedRows = (await db.execute(sql`
        SELECT table_name, row_id FROM sp_migration_run_rows WHERE run_id = ${runId}
        ORDER BY id DESC
      `)).rows as any[];

      let deleted = 0;
      const byTable: Record<string, number[]> = {};
      for (const r of trackedRows) {
        if (!byTable[r.table_name]) byTable[r.table_name] = [];
        byTable[r.table_name].push(pn(r.row_id));
      }

      // Delete in safe order (movements before aliases before locations)
      const tableOrder = ["sp_stock_movements", "stock_item_code_aliases", "locations"];
      for (const tbl of tableOrder) {
        const ids = byTable[tbl];
        if (!ids?.length) continue;
        for (const id of ids) {
          // Extra safety: verify the row belongs to target company before deleting
          let verified = false;
          if (tbl === "sp_stock_movements") {
            const [chk] = (await db.execute(sql`SELECT company_id FROM sp_stock_movements WHERE id = ${id} LIMIT 1`)).rows as any[];
            verified = !!chk && pn(chk.company_id) === targetId;
          } else if (tbl === "stock_item_code_aliases") {
            const [chk] = (await db.execute(sql`SELECT company_id FROM stock_item_code_aliases WHERE id = ${id} LIMIT 1`)).rows as any[];
            verified = !!chk && pn(chk.company_id) === targetId;
          } else if (tbl === "locations") {
            const [chk] = (await db.execute(sql`SELECT company_id FROM locations WHERE id = ${id} LIMIT 1`)).rows as any[];
            verified = !!chk && pn(chk.company_id) === targetId;
          }

          if (!verified) {
            console.warn(`[SP Rollback] Skipped ${tbl} id=${id} — company_id mismatch or row not found`);
            continue;
          }

          if (tbl === "sp_stock_movements") {
            await db.execute(sql`DELETE FROM sp_stock_movements WHERE id = ${id}`);
          } else if (tbl === "stock_item_code_aliases") {
            await db.execute(sql`DELETE FROM stock_item_code_aliases WHERE id = ${id}`);
          } else if (tbl === "locations") {
            await db.execute(sql`DELETE FROM locations WHERE id = ${id}`);
          }
          deleted++;
        }
      }

      // Mark run as rolled_back
      await db.execute(sql`
        UPDATE sp_migration_rehearsal_runs
        SET status = 'rolled_back', completed_at = now(),
            notes = COALESCE(notes, '') || ' | ROLLED BACK'
        WHERE id = ${runId}
      `);

      return res.json({ success: true, runId, rowsDeleted: deleted });
    } catch (err: any) {
      console.error("[SP Migration] rollback error:", err);
      return res.status(500).json({ message: err.message });
    }
  });

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
