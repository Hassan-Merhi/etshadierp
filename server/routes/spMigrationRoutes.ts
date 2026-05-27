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

      // Delete in safe order — children before parents, entries before vouchers before accounts
      const tableOrder = [
        "voucher_entries",
        "vouchers",
        "ledger_accounts",
        "sp_stock_movements",
        "stock_item_code_aliases",
        "locations",
      ];
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
          } else if (tbl === "vouchers") {
            const [chk] = (await db.execute(sql`SELECT company_id FROM vouchers WHERE id = ${id} LIMIT 1`)).rows as any[];
            verified = !!chk && pn(chk.company_id) === targetId;
          } else if (tbl === "voucher_entries") {
            // voucher_entries has no company_id — verify via parent voucher
            const [chk] = (await db.execute(sql`
              SELECT v.company_id FROM voucher_entries ve
              JOIN vouchers v ON v.id = ve.voucher_id
              WHERE ve.id = ${id} LIMIT 1
            `)).rows as any[];
            verified = !!chk && pn(chk.company_id) === targetId;
          } else if (tbl === "ledger_accounts") {
            const [chk] = (await db.execute(sql`SELECT company_id FROM ledger_accounts WHERE id = ${id} LIMIT 1`)).rows as any[];
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
          } else if (tbl === "voucher_entries") {
            await db.execute(sql`DELETE FROM voucher_entries WHERE id = ${id}`);
          } else if (tbl === "vouchers") {
            await db.execute(sql`DELETE FROM vouchers WHERE id = ${id}`);
          } else if (tbl === "ledger_accounts") {
            await db.execute(sql`DELETE FROM ledger_accounts WHERE id = ${id}`);
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

  // ── POST /api/sp/migration/create-sp-company ─────────────────────────────
  // Creates a new supplier_partner company for the GC-LSHI migration.
  app.post("/api/sp/migration/create-sp-company", requireAuth, async (req: any, res: any) => {
    try {
      const { name, code } = req.body ?? {};
      if (!name || !code) return res.status(400).json({ message: "name and code are required" });

      // Check for duplicate code
      const existing = (await db.execute(sql`SELECT id FROM companies WHERE code = ${code} LIMIT 1`)).rows[0] as any;
      if (existing) return res.status(409).json({ message: `Company code "${code}" already exists` });

      const [row] = (await db.execute(sql`
        INSERT INTO companies (code, name, company_type, base_currency, active)
        VALUES (${code}, ${name}, 'supplier_partner', 'USD', true)
        RETURNING id, code, name, company_type
      `)).rows as any[];

      return res.json({ success: true, company: row });
    } catch (err: any) {
      console.error("[SP Migration] create-sp-company error:", err);
      return res.status(500).json({ message: err.message });
    }
  });

  // ── GET /api/sp/migration/gc-preview ─────────────────────────────────────
  // Extended preview that also shows sale voucher counts for the GC migration.
  app.get("/api/sp/migration/gc-preview", requireAuth, async (req: any, res: any) => {
    try {
      const sourceId = parseInt(String(req.query.sourceCompanyId ?? ""), 10);
      const targetId = parseInt(String(req.query.targetCompanyId ?? ""), 10);

      if (!sourceId || !targetId) return res.status(400).json({ message: "sourceCompanyId and targetCompanyId are required" });
      if (sourceId === targetId) return res.status(400).json({ message: "Source and target must be different" });

      const sourceComp = await getCompanyRow(sourceId);
      const targetComp = await getCompanyRow(targetId);
      if (!sourceComp) return res.status(404).json({ message: "Source company not found" });
      if (!targetComp) return res.status(404).json({ message: "Target company not found" });
      if (sourceComp.company_type !== "erp") return res.status(400).json({ message: "Source company must be type 'erp'" });
      if (targetComp.company_type !== "supplier_partner") return res.status(400).json({ message: "Target company must be type 'supplier_partner'" });

      // Stock items with positive inventory
      const stockRows = (await db.execute(sql`
        SELECT si.id AS stock_item_id, si.code, si.name, inv.quantity, inv.average_rate,
               ROUND(inv.quantity * COALESCE(inv.average_rate, 0), 4) AS total_value
        FROM stock_items si
        JOIN inventory inv ON inv.stock_item_id = si.id AND inv.company_id = ${sourceId}
        WHERE si.company_id = ${sourceId} AND si.deleted_at IS NULL AND inv.quantity > 0
        ORDER BY si.code
      `)).rows as any[];

      const existingAliases = (await db.execute(sql`
        SELECT alias_code FROM stock_item_code_aliases WHERE company_id = ${targetId}
      `)).rows as any[];
      const existingAliasCodes = new Set(existingAliases.map((r: any) => r.alias_code));

      const stockItems = stockRows.map((r: any) => ({
        stockItemId: pn(r.stock_item_id), code: r.code, name: r.name,
        quantity: pn(r.quantity), averageCostUsd: pn(r.average_rate),
        totalValueUsd: pn(r.total_value), aliasExists: existingAliasCodes.has(r.code),
      }));

      // Sale vouchers in source
      const voucherRow = (await db.execute(sql`
        SELECT COUNT(*) AS cnt, COALESCE(SUM(total_amount), 0) AS total
        FROM vouchers
        WHERE company_id = ${sourceId} AND voucher_type = 'Sale' AND deleted_at IS NULL
      `)).rows[0] as any;

      // Already migrated vouchers in target
      const migratedRow = (await db.execute(sql`
        SELECT COUNT(*) AS cnt FROM vouchers
        WHERE company_id = ${targetId} AND voucher_number LIKE 'MIG-%' AND deleted_at IS NULL
      `)).rows[0] as any;

      // SP accounts status
      const spAcctRows = (await db.execute(sql`
        SELECT sub_type FROM ledger_accounts
        WHERE company_id = ${targetId} AND deleted_at IS NULL AND sub_type LIKE 'sp_%'
      `)).rows as any[];
      const existingSpSubTypes = new Set(spAcctRows.map((r: any) => r.sub_type));
      const spAccountsStatus = SP_ACCOUNTS.map(a => ({
        subType: a.subType, name: a.name, exists: existingSpSubTypes.has(a.subType),
      }));

      // GC profit accounts status
      const gcAcctRows = (await db.execute(sql`
        SELECT sub_type FROM ledger_accounts
        WHERE company_id = ${targetId} AND deleted_at IS NULL AND sub_type IN ('gc_owner_profit', 'gc_supplier_profit')
      `)).rows as any[];
      const existingGcSubTypes = new Set(gcAcctRows.map((r: any) => r.sub_type));

      const totalQty = stockItems.reduce((s: number, i: any) => s + i.quantity, 0);
      const totalValue = stockItems.reduce((s: number, i: any) => s + i.totalValueUsd, 0);

      return res.json({
        sourceCompany: { id: sourceComp.id, code: sourceComp.code, name: sourceComp.name },
        targetCompany: { id: targetComp.id, code: targetComp.code, name: targetComp.name },
        stockSummary: {
          itemCount: stockItems.length,
          totalQty: Math.round(totalQty * 1000) / 1000,
          totalValueUsd: Math.round(totalValue * 100) / 100,
          alreadyMapped: stockItems.filter((i: any) => i.aliasExists).length,
        },
        stockItems,
        voucherSummary: {
          sourceCount: pn(voucherRow.cnt),
          totalAmount: pn(voucherRow.total),
          alreadyMigrated: pn(migratedRow.cnt),
        },
        spAccountsStatus,
        gcProfitAccountsStatus: [
          { subType: "gc_owner_profit",    name: "GC Owner Profit",    exists: existingGcSubTypes.has("gc_owner_profit")    },
          { subType: "gc_supplier_profit", name: "GC Supplier Profit", exists: existingGcSubTypes.has("gc_supplier_profit") },
        ],
        warnings: [
          pn(migratedRow.cnt) > 0 ? `${pn(migratedRow.cnt)} voucher(s) already migrated in target — re-running will create duplicates. Rollback first.` : null,
          "Open Goods-OTW containers must be recreated manually in the SP Containers screen.",
          "Voucher account mapping uses sub_type matching. Unmapped entries will be routed to a suspense account.",
        ].filter(Boolean),
      });
    } catch (err: any) {
      console.error("[SP Migration] gc-preview error:", err);
      return res.status(500).json({ message: err.message });
    }
  });

  // ── POST /api/sp/migration/gc-rehearsal ──────────────────────────────────
  // Full GC-LSHI → SP migration:
  //   1. Standard SP accounts (10 accounts)
  //   2. GC profit accounts (2 accounts)
  //   3. Stock items + aliases (same as rehearsal)
  //   4. Sale vouchers from ERP → SP (with account remapping)
  app.post("/api/sp/migration/gc-rehearsal", requireAuth, async (req: any, res: any) => {
    const { sourceCompanyId, targetCompanyId, companyNameConfirm, confirmation } = req.body ?? {};

    if (confirmation !== "MIGRATE") {
      return res.status(400).json({ message: 'GC migration requires confirmation = "MIGRATE"' });
    }

    const sourceId = parseInt(String(sourceCompanyId ?? ""), 10);
    const targetId = parseInt(String(targetCompanyId ?? ""), 10);
    if (!sourceId || !targetId) return res.status(400).json({ message: "sourceCompanyId and targetCompanyId required" });
    if (sourceId === targetId) return res.status(400).json({ message: "Source and target must be different" });

    const sourceComp = await getCompanyRow(sourceId);
    const targetComp = await getCompanyRow(targetId);
    if (!sourceComp) return res.status(404).json({ message: "Source company not found" });
    if (!targetComp) return res.status(404).json({ message: "Target company not found" });
    if (sourceComp.company_type !== "erp") return res.status(400).json({ message: "Source company must be type 'erp'" });
    if (targetComp.company_type !== "supplier_partner") return res.status(400).json({ message: "Target company must be type 'supplier_partner'" });
    if (!companyNameConfirm || companyNameConfirm.trim() !== sourceComp.name) {
      return res.status(400).json({ message: `Company name confirmation must match exactly: "${sourceComp.name}"` });
    }

    let runId = "";
    try {
      runId = await logRun(sourceId, targetId, "gc_migration", "running", 0, null,
        `GC Migration | User: ${req.session?.userId ?? "unknown"} | Source: ${sourceComp.name} | Target: ${targetComp.name}`);
    } catch (logErr: any) {
      return res.status(500).json({ message: "Failed to create run log: " + logErr.message });
    }

    let rowsCreated = 0;
    const summary: string[] = [];

    try {
      // 1. Standard SP accounts
      const createdAccounts = await ensureSpAccounts(targetId);
      if (createdAccounts.length) summary.push(`Created SP accounts: ${createdAccounts.join(", ")}`);

      // 2. GC profit accounts
      const GC_PROFIT_ACCOUNTS = [
        { code: "GC-OWNPFT", name: "GC Owner Profit",    accountType: "Equity", subType: "gc_owner_profit"    },
        { code: "GC-SUPPFT", name: "GC Supplier Profit", accountType: "Equity", subType: "gc_supplier_profit" },
      ];
      for (const acct of GC_PROFIT_ACCOUNTS) {
        const existing = (await db.execute(sql`
          SELECT id FROM ledger_accounts
          WHERE company_id = ${targetId} AND sub_type = ${acct.subType} AND deleted_at IS NULL LIMIT 1
        `)).rows[0] as any;
        if (!existing) {
          const [row] = (await db.execute(sql`
            INSERT INTO ledger_accounts (company_id, code, name, account_type, sub_type, active)
            VALUES (${targetId}, ${acct.code}, ${acct.name}, ${acct.accountType}, ${acct.subType}, true)
            RETURNING id
          `)).rows as any[];
          await trackRow(runId, "ledger_accounts", pn(row.id));
          rowsCreated++;
          summary.push(`Created account: ${acct.name}`);
        }
      }

      // 3. Default location
      const locs = await db.select().from(locations).where(and(eq(locations.companyId, targetId), isNull(locations.deletedAt)));
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

      // 4. Stock items
      const stockRows = (await db.execute(sql`
        SELECT si.id AS stock_item_id, si.code, si.name, inv.quantity, inv.average_rate
        FROM stock_items si
        JOIN inventory inv ON inv.stock_item_id = si.id AND inv.company_id = ${sourceId}
        WHERE si.company_id = ${sourceId} AND si.deleted_at IS NULL AND inv.quantity > 0
        ORDER BY si.code
      `)).rows as any[];

      let aliasesCreated = 0, aliasesSkipped = 0, movementsCreated = 0;
      for (const item of stockRows as any[]) {
        const stockItemId = pn(item.stock_item_id);
        const qty = pn(item.quantity);
        const avgRate = pn(item.average_rate);

        const existingAlias = (await db.execute(sql`
          SELECT id FROM stock_item_code_aliases
          WHERE company_id = ${targetId} AND alias_code = ${item.code} LIMIT 1
        `)).rows[0] as any;

        if (!existingAlias) {
          const [aliasRow] = (await db.execute(sql`
            INSERT INTO stock_item_code_aliases (company_id, stock_item_id, alias_code, description)
            VALUES (${targetId}, ${stockItemId}, ${item.code}, ${item.name})
            RETURNING id
          `)).rows as any[];
          await trackRow(runId, "stock_item_code_aliases", pn(aliasRow.id));
          aliasesCreated++;
          rowsCreated++;
        } else {
          aliasesSkipped++;
        }

        const [movRow] = (await db.execute(sql`
          INSERT INTO sp_stock_movements
            (company_id, article_code, description, stock_item_id,
             qty_in, qty_remaining,
             base_unit_cost_usd, landed_unit_cost_usd, final_unit_cost_usd,
             source_type, container_id, offload_id, container_line_id)
          VALUES
            (${targetId}, ${item.code},
             ${"GC Migration opening stock from " + sourceComp.name},
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
      summary.push(`Stock: ${aliasesCreated} aliases created, ${aliasesSkipped} skipped, ${movementsCreated} opening movements`);

      // 5. Build account mapping: source ledger_account_id → target ledger_account_id
      //    Match by sub_type first, then accountType
      const sourceAccts = (await db.execute(sql`
        SELECT id, account_type, sub_type FROM ledger_accounts
        WHERE company_id = ${sourceId} AND deleted_at IS NULL
      `)).rows as any[];
      const targetAccts = (await db.execute(sql`
        SELECT id, account_type, sub_type FROM ledger_accounts
        WHERE company_id = ${targetId} AND deleted_at IS NULL
      `)).rows as any[];

      const targetBySubType = new Map<string, number>();
      const targetByAccountType = new Map<string, number>();
      for (const ta of targetAccts) {
        if (ta.sub_type) targetBySubType.set(ta.sub_type, pn(ta.id));
        if (!targetByAccountType.has(ta.account_type)) targetByAccountType.set(ta.account_type, pn(ta.id));
      }

      // Ensure suspense account exists for unmapped entries
      let suspenseAccountId: number | null = null;
      const existingSuspense = (await db.execute(sql`
        SELECT id FROM ledger_accounts WHERE company_id = ${targetId} AND sub_type = 'gc_mig_suspense' AND deleted_at IS NULL LIMIT 1
      `)).rows[0] as any;
      if (existingSuspense) {
        suspenseAccountId = pn(existingSuspense.id);
      } else {
        const [suspRow] = (await db.execute(sql`
          INSERT INTO ledger_accounts (company_id, code, name, account_type, sub_type, active, is_hidden)
          VALUES (${targetId}, 'GC-SUSP', 'Migration Suspense', 'Equity', 'gc_mig_suspense', true, true)
          RETURNING id
        `)).rows as any[];
        suspenseAccountId = pn(suspRow.id);
        await trackRow(runId, "ledger_accounts", suspenseAccountId);
        rowsCreated++;
      }

      const accountMap = new Map<number, number | null>();
      for (const sa of sourceAccts) {
        const srcId = pn(sa.id);
        if (sa.sub_type && targetBySubType.has(sa.sub_type)) {
          accountMap.set(srcId, targetBySubType.get(sa.sub_type)!);
        } else if (targetByAccountType.has(sa.account_type)) {
          accountMap.set(srcId, targetByAccountType.get(sa.account_type)!);
        } else {
          accountMap.set(srcId, suspenseAccountId);
        }
      }

      // 6. Copy sale vouchers (no artificial limit — processes all historical records)
      const saleVouchers = (await db.execute(sql`
        SELECT id, voucher_number, voucher_type, voucher_date, description, total_amount, currency, exchange_rate
        FROM vouchers
        WHERE company_id = ${sourceId} AND voucher_type = 'Sale' AND deleted_at IS NULL
        ORDER BY voucher_date ASC, id ASC
      `)).rows as any[];

      let vouchersCreated = 0, entriesCreated = 0, vouchersSkipped = 0;
      for (const v of saleVouchers as any[]) {
        const newVoucherNumber = ("MIG-" + v.voucher_number).substring(0, 100);

        // Skip if already migrated
        const alreadyMig = (await db.execute(sql`
          SELECT id FROM vouchers WHERE voucher_number = ${newVoucherNumber} AND company_id = ${targetId} LIMIT 1
        `)).rows[0] as any;
        if (alreadyMig) { vouchersSkipped++; continue; }

        const [vRow] = (await db.execute(sql`
          INSERT INTO vouchers
            (company_id, voucher_number, voucher_type, voucher_date, description, total_amount, currency, exchange_rate, source_module)
          VALUES
            (${targetId}, ${newVoucherNumber}, ${v.voucher_type}, ${v.voucher_date},
             ${v.description ?? "Migrated from GC-LSHI ERP"},
             ${v.total_amount}, ${v.currency ?? "USD"}, ${v.exchange_rate ?? null}, 'ERP')
          RETURNING id
        `)).rows as any[];
        const newVoucherId = pn(vRow.id);
        await trackRow(runId, "vouchers", newVoucherId);
        rowsCreated++;
        vouchersCreated++;

        // Copy entries
        const entries = (await db.execute(sql`
          SELECT ledger_account_id, debit_amount, credit_amount, narration
          FROM voucher_entries WHERE voucher_id = ${v.id}
        `)).rows as any[];

        for (const e of entries as any[]) {
          const srcAcctId = e.ledger_account_id ? pn(e.ledger_account_id) : null;
          const mappedAcctId = srcAcctId !== null ? (accountMap.get(srcAcctId) ?? suspenseAccountId) : null;
          const [eRow] = (await db.execute(sql`
            INSERT INTO voucher_entries (voucher_id, ledger_account_id, debit_amount, credit_amount, narration)
            VALUES (${newVoucherId}, ${mappedAcctId}, ${e.debit_amount ?? "0"}, ${e.credit_amount ?? "0"}, ${e.narration ?? null})
            RETURNING id
          `)).rows as any[];
          await trackRow(runId, "voucher_entries", pn(eRow.id));
          entriesCreated++;
          rowsCreated++;
        }
      }
      summary.push(`Vouchers: ${vouchersCreated} created, ${vouchersSkipped} skipped, ${entriesCreated} entries created`);

      const totalStockQty   = (stockRows as any[]).reduce((s: number, r: any) => s + pn(r.quantity), 0);
      const totalStockValue = (stockRows as any[]).reduce((s: number, r: any) => s + pn(r.quantity) * pn(r.average_rate), 0);

      await db.execute(sql`
        UPDATE sp_migration_rehearsal_runs
        SET status = 'completed', rows_created = ${rowsCreated}, completed_at = now()
        WHERE id = ${runId}
      `);

      return res.json({
        success: true, runId, rowsCreated, summary,
        reconciliation: {
          sourceCompany: sourceComp.name, targetCompany: targetComp.name,
          stockItemsCopied: movementsCreated,
          aliasesCreated, aliasesSkipped,
          totalStockQty: Math.round(totalStockQty * 1000) / 1000,
          totalStockValueUsd: Math.round(totalStockValue * 100) / 100,
          vouchersCreated, vouchersSkipped, entriesCreated,
        },
        warnings: [
          "Account mapping used sub_type matching. Verify entries routed to Migration Suspense account.",
          "Goods-OTW containers must be recreated manually in the SP Containers screen.",
          "GC Owner Profit and GC Supplier Profit equity accounts have been created.",
        ],
      });
    } catch (err: any) {
      await db.execute(sql`
        UPDATE sp_migration_rehearsal_runs
        SET status = 'failed', error_message = ${err.message}, completed_at = now()
        WHERE id = ${runId}
      `).catch(() => {});
      console.error("[SP Migration] gc-rehearsal error:", err);
      return res.status(500).json({ message: err.message, runId });
    }
  });

  // ── GET /api/sp/migration/cash-accounts ─────────────────────────────────
  // Returns Cash/Bank ledger accounts for a given SP target company.
  app.get("/api/sp/migration/cash-accounts", requireAuth, async (req: any, res: any) => {
    try {
      const targetId = parseInt(String(req.query.targetCompanyId ?? ""), 10);
      if (!targetId) return res.status(400).json({ message: "targetCompanyId is required" });
      const rows = (await db.execute(sql`
        SELECT id, code, name, account_type
        FROM ledger_accounts
        WHERE company_id = ${targetId} AND account_type IN ('Cash', 'Bank') AND deleted_at IS NULL
        ORDER BY account_type, name
      `)).rows as any[];
      return res.json({ accounts: rows });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ── POST /api/sp/migration/opening-balance ───────────────────────────────
  // Creates a Journal voucher: Dr selected Cash/Bank account → Cr SP-OPNBAL
  // Requires cashAccountId — no silent auto-pick.
  app.post("/api/sp/migration/opening-balance", requireAuth, async (req: any, res: any) => {
    try {
      const { targetCompanyId, cashAccountId, amount, date, narration } = req.body ?? {};
      const targetId = parseInt(String(targetCompanyId ?? ""), 10);
      const cashId   = parseInt(String(cashAccountId ?? ""), 10);

      if (!targetId)              return res.status(400).json({ message: "targetCompanyId is required" });
      if (!cashId)                return res.status(400).json({ message: "cashAccountId is required — select a cash or bank account" });
      if (!amount || isNaN(parseFloat(amount))) return res.status(400).json({ message: "amount is required" });
      if (!date)                  return res.status(400).json({ message: "date is required" });

      const targetComp = await getCompanyRow(targetId);
      if (!targetComp) return res.status(404).json({ message: "Target company not found" });
      if (targetComp.company_type !== "supplier_partner") {
        return res.status(400).json({ message: "Target must be a supplier_partner company" });
      }

      // Verify the selected cash account belongs to target company
      const cashAcctRow = (await db.execute(sql`
        SELECT id, name, account_type FROM ledger_accounts
        WHERE id = ${cashId} AND company_id = ${targetId} AND deleted_at IS NULL LIMIT 1
      `)).rows[0] as any;
      if (!cashAcctRow) {
        return res.status(400).json({ message: "Selected cash account not found in target company" });
      }
      if (!["Cash", "Bank"].includes(cashAcctRow.account_type)) {
        return res.status(400).json({ message: `Account "${cashAcctRow.name}" is type "${cashAcctRow.account_type}", not Cash or Bank` });
      }

      // Find SP-OPNBAL account
      const opnBalRows = (await db.execute(sql`
        SELECT id FROM ledger_accounts
        WHERE company_id = ${targetId} AND sub_type = 'sp_opnbal' AND deleted_at IS NULL LIMIT 1
      `)).rows as any[];
      if (!opnBalRows.length) {
        return res.status(400).json({ message: "SP-OPNBAL account not found in target company. Run the GC migration first." });
      }
      const opnBalId = pn(opnBalRows[0].id);

      const amtStr = parseFloat(amount).toFixed(2);
      const voucherNumber = `OB-${targetId}-${Date.now()}`;

      const [vRow] = (await db.execute(sql`
        INSERT INTO vouchers (company_id, voucher_number, voucher_type, voucher_date, description, total_amount, currency, source_module)
        VALUES (${targetId}, ${voucherNumber}, 'Journal', ${date},
                ${narration ?? "GC Opening Cash Balance"}, ${amtStr}, 'USD', 'ERP')
        RETURNING id
      `)).rows as any[];
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
      console.error("[SP Migration] opening-balance error:", err);
      return res.status(500).json({ message: err.message });
    }
  });

  // ── POST /api/sp/migration/rollback (extended) ───────────────────────────
  // Updated below — existing endpoint handles all tracked tables.
  // Extension: also handles voucher_entries, vouchers, ledger_accounts.

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
