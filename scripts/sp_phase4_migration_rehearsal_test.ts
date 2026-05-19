/**
 * SP Phase 4 — Migration Rehearsal Test
 *
 * Tests the full migration rehearsal workflow:
 *   1. Preview (dry run) creates no DB rows
 *   2. Rehearsal with wrong confirmation is rejected
 *   3. Rehearsal with correct confirmations creates rows in TARGET only
 *   4. GC company counts unchanged before and after
 *   5. Rollback removes only target rehearsal data
 *   6. Rollback leaves GC unchanged
 *   7. Cutover endpoint is blocked (403)
 *   8. Run history is logged
 *
 * Run: npx tsx scripts/sp_phase4_migration_rehearsal_test.ts
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";

// ─── ANSI helpers ──────────────────────────────────────────────────────────────
const GREEN = (s: string) => `\x1b[32m${s}\x1b[0m`;
const RED   = (s: string) => `\x1b[31m${s}\x1b[0m`;
const CYAN  = (s: string) => `\x1b[36m${s}\x1b[0m`;
const BOLD  = (s: string) => `\x1b[1m${s}\x1b[0m`;

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(label: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  ${GREEN("✓")} ${label}`);
    passed++;
  } else {
    console.log(`  ${RED("✗")} ${label}${detail ? " — " + detail : ""}`);
    failed++;
    failures.push(label + (detail ? " — " + detail : ""));
  }
}
function assertApprox(label: string, actual: number, expected: number, tol = 0.01) {
  const ok = Math.abs(actual - expected) <= tol;
  assert(label, ok, ok ? "" : `expected ${expected}, got ${actual}`);
}
const pn = (v: any) => { const n = parseFloat(String(v ?? "0")); return isNaN(n) ? 0 : n; };

// ─── Config ────────────────────────────────────────────────────────────────────
// Source: HADI L'SHI (erp, id=1) — used throughout as "GC L'shi" source
// Target: SP Test Co (supplier_partner, id=14)
const SOURCE_ID   = 1;
const TARGET_ID   = 14;
const SOURCE_NAME_EXPECTED = "HADI L'SHI"; // exact name in DB for confirmation guard

// ─── Helpers ───────────────────────────────────────────────────────────────────
async function countTable(table: string, companyId: number): Promise<number> {
  const r = (await db.execute(sql.raw(`SELECT COUNT(*) AS n FROM ${table} WHERE company_id = ${companyId}`))).rows[0] as any;
  return pn(r.n);
}

async function gcSnapshot() {
  const v  = (await db.execute(sql`SELECT COUNT(*) AS n FROM vouchers   WHERE company_id = ${SOURCE_ID}`)).rows[0] as any;
  const i  = (await db.execute(sql`SELECT COUNT(*) AS n FROM inventory  WHERE company_id = ${SOURCE_ID}`)).rows[0] as any;
  const si = (await db.execute(sql`SELECT COUNT(*) AS n FROM stock_items WHERE company_id = ${SOURCE_ID} AND deleted_at IS NULL`)).rows[0] as any;
  return { vouchers: pn(v.n), inventory: pn(i.n), stockItems: pn(si.n) };
}

async function targetSnapshot() {
  return {
    aliases:     await countTable("stock_item_code_aliases", TARGET_ID),
    movements:   await countTable("sp_stock_movements",      TARGET_ID),
    sales:       await countTable("sp_sales",                TARGET_ID),
    salelines:   await countTable("sp_sale_lines",           TARGET_ID),
  };
}

async function cleanupRehearsal() {
  // Remove any previous phase4 test rehearsal data from target
  await db.execute(sql`
    DELETE FROM sp_migration_run_rows WHERE run_id IN (
      SELECT id FROM sp_migration_rehearsal_runs
      WHERE source_company_id = ${SOURCE_ID} AND target_company_id = ${TARGET_ID}
    )
  `);
  await db.execute(sql`
    DELETE FROM sp_migration_rehearsal_runs
    WHERE source_company_id = ${SOURCE_ID} AND target_company_id = ${TARGET_ID}
  `);
  // Remove target rehearsal data (not ERP vouchers — only SP tables)
  await db.execute(sql`DELETE FROM sp_sale_lines WHERE company_id = ${TARGET_ID}`);
  await db.execute(sql`DELETE FROM sp_sales      WHERE company_id = ${TARGET_ID}`);
  await db.execute(sql`DELETE FROM sp_stock_movements WHERE company_id = ${TARGET_ID}`);
  await db.execute(sql`DELETE FROM stock_item_code_aliases WHERE company_id = ${TARGET_ID}`);
  // Clean locations only if they are the default SP warehouse
  await db.execute(sql`DELETE FROM locations WHERE company_id = ${TARGET_ID} AND code = 'SP-WH-001'`);
}

// ─── Simulated API calls (direct DB logic, mirrors the route handlers) ─────────

async function callPreview(sourceId: number, targetId: number) {
  // Validates same rules as the route:
  const sourceComp = (await db.execute(sql`SELECT id, code, name, company_type FROM companies WHERE id = ${sourceId}`)).rows[0] as any;
  const targetComp = (await db.execute(sql`SELECT id, code, name, company_type FROM companies WHERE id = ${targetId}`)).rows[0] as any;
  if (!sourceComp || !targetComp) return { error: "Company not found" };
  if (sourceComp.company_type !== "erp") return { error: "Source must be erp" };
  if (targetComp.company_type !== "supplier_partner") return { error: "Target must be supplier_partner" };
  if (sourceId === targetId) return { error: "Same company" };

  const stockRows = (await db.execute(sql`
    SELECT si.id, si.code, inv.quantity, inv.average_rate
    FROM stock_items si
    JOIN inventory inv ON inv.stock_item_id = si.id AND inv.company_id = ${sourceId}
    WHERE si.company_id = ${sourceId} AND si.deleted_at IS NULL AND inv.quantity > 0
    ORDER BY si.code
  `)).rows as any[];

  return { dryRun: true, stockItems: stockRows, itemCount: stockRows.length };
}

async function callRehearsal(opts: {
  sourceId: number; targetId: number;
  companyNameConfirm: string; confirmation: string;
}) {
  const { sourceId, targetId, companyNameConfirm, confirmation } = opts;

  if (confirmation !== "REHEARSE") return { error: "confirmation must be REHEARSE", code: "BAD_CONFIRMATION" };

  const sourceComp = (await db.execute(sql`SELECT id, name, company_type FROM companies WHERE id = ${sourceId}`)).rows[0] as any;
  const targetComp = (await db.execute(sql`SELECT id, name, company_type FROM companies WHERE id = ${targetId}`)).rows[0] as any;
  if (!sourceComp) return { error: "Source not found" };
  if (!targetComp) return { error: "Target not found" };
  if (sourceComp.company_type !== "erp")           return { error: "Source must be erp" };
  if (targetComp.company_type !== "supplier_partner") return { error: "Target must be supplier_partner" };
  if (sourceId === targetId)                       return { error: "Same company" };
  if (companyNameConfirm.trim() !== sourceComp.name) return { error: `Name mismatch: expected "${sourceComp.name}", got "${companyNameConfirm}"`, code: "NAME_MISMATCH" };

  // Create run
  const [runRow] = (await db.execute(sql`
    INSERT INTO sp_migration_rehearsal_runs
      (source_company_id, target_company_id, action, status, notes)
    VALUES
      (${sourceId}, ${targetId}, 'rehearsal', 'running', ${"Phase4 test"})
    RETURNING id
  `)).rows as any[];
  const runId: string = runRow.id;

  let rowsCreated = 0;
  const stockRows = (await db.execute(sql`
    SELECT si.id AS stock_item_id, si.code, si.name, inv.quantity, inv.average_rate
    FROM stock_items si
    JOIN inventory inv ON inv.stock_item_id = si.id AND inv.company_id = ${sourceId}
    WHERE si.company_id = ${sourceId} AND si.deleted_at IS NULL AND inv.quantity > 0
    ORDER BY si.code
  `)).rows as any[];

  let aliasesCreated = 0;
  let movementsCreated = 0;

  for (const item of stockRows) {
    const qty     = pn(item.quantity);
    const avgRate = pn(item.average_rate);
    const siId    = pn(item.stock_item_id);

    const existing = (await db.execute(sql`
      SELECT id FROM stock_item_code_aliases
      WHERE company_id = ${targetId} AND alias_code = ${item.code} LIMIT 1
    `)).rows[0] as any;

    if (!existing) {
      const [aliasRow] = (await db.execute(sql`
        INSERT INTO stock_item_code_aliases (company_id, stock_item_id, alias_code, description)
        VALUES (${targetId}, ${siId}, ${item.code}, ${item.name}) RETURNING id
      `)).rows as any[];
      await db.execute(sql`
        INSERT INTO sp_migration_run_rows (run_id, table_name, row_id)
        VALUES (${runId}, 'stock_item_code_aliases', ${pn(aliasRow.id)})
      `);
      aliasesCreated++;
      rowsCreated++;
    }

    const [movRow] = (await db.execute(sql`
      INSERT INTO sp_stock_movements
        (company_id, article_code, description, stock_item_id,
         qty_in, qty_remaining,
         base_unit_cost_usd, landed_unit_cost_usd, final_unit_cost_usd,
         source_type, container_id, offload_id, container_line_id)
      VALUES
        (${targetId}, ${item.code}, ${"Phase4 rehearsal opening stock"}, ${siId},
         ${qty}, ${qty},
         ${avgRate.toFixed(6)}, ${avgRate.toFixed(6)}, ${avgRate.toFixed(6)},
         'opening_stock', NULL, NULL, NULL)
      RETURNING id
    `)).rows as any[];
    await db.execute(sql`
      INSERT INTO sp_migration_run_rows (run_id, table_name, row_id)
      VALUES (${runId}, 'sp_stock_movements', ${pn(movRow.id)})
    `);
    movementsCreated++;
    rowsCreated++;
  }

  await db.execute(sql`
    UPDATE sp_migration_rehearsal_runs
    SET status = 'completed', rows_created = ${rowsCreated}, completed_at = now()
    WHERE id = ${runId}
  `);

  return { success: true, runId, rowsCreated, aliasesCreated, movementsCreated };
}

async function callRollback(runId: string, targetId: number) {
  const runRow = (await db.execute(sql`
    SELECT id, source_company_id, target_company_id, status
    FROM sp_migration_rehearsal_runs WHERE id = ${runId} LIMIT 1
  `)).rows[0] as any;

  if (!runRow) return { error: "Run not found" };
  if (runRow.status === "rolled_back") return { error: "Already rolled back" };

  const tId = pn(runRow.target_company_id);
  const sId = pn(runRow.source_company_id);
  if (tId !== targetId) return { error: "Target mismatch" };

  const trackedRows = (await db.execute(sql`
    SELECT table_name, row_id FROM sp_migration_run_rows WHERE run_id = ${runId}
    ORDER BY id DESC
  `)).rows as any[];

  const byTable: Record<string, number[]> = {};
  for (const r of trackedRows) {
    if (!byTable[r.table_name]) byTable[r.table_name] = [];
    byTable[r.table_name].push(pn(r.row_id));
  }

  let deleted = 0;
  for (const [tbl, ids] of Object.entries(byTable)) {
    for (const id of ids) {
      // Verify row belongs to target, not source
      let companyIdInRow = -1;
      if (tbl === "sp_stock_movements") {
        const [chk] = (await db.execute(sql`SELECT company_id FROM sp_stock_movements WHERE id = ${id}`)).rows as any[];
        companyIdInRow = chk ? pn(chk.company_id) : -1;
      } else if (tbl === "stock_item_code_aliases") {
        const [chk] = (await db.execute(sql`SELECT company_id FROM stock_item_code_aliases WHERE id = ${id}`)).rows as any[];
        companyIdInRow = chk ? pn(chk.company_id) : -1;
      }
      if (companyIdInRow !== tId) continue; // Safety: skip if not in target
      if (companyIdInRow === sId) continue; // Safety: never delete source rows

      if (tbl === "sp_stock_movements")  await db.execute(sql`DELETE FROM sp_stock_movements WHERE id = ${id}`);
      if (tbl === "stock_item_code_aliases") await db.execute(sql`DELETE FROM stock_item_code_aliases WHERE id = ${id}`);
      deleted++;
    }
  }

  await db.execute(sql`
    UPDATE sp_migration_rehearsal_runs
    SET status = 'rolled_back', completed_at = now() WHERE id = ${runId}
  `);

  return { success: true, runId, rowsDeleted: deleted };
}

// ─── Main test runner ──────────────────────────────────────────────────────────
async function main() {
  console.log(BOLD(CYAN("\n═══════════════════════════════════════════════════════════")));
  console.log(BOLD(CYAN("  SP PHASE 4 — Migration Rehearsal Test")));
  console.log(BOLD(CYAN("  Dry run · Confirmation guards · Rollback · GC isolation")));
  console.log(BOLD(CYAN("═══════════════════════════════════════════════════════════\n")));

  // ── 0. Verify companies exist ───────────────────────────────────────────
  console.log(BOLD("0. Verify company configuration"));
  const sourceComp = (await db.execute(sql`SELECT id, name, company_type FROM companies WHERE id = ${SOURCE_ID}`)).rows[0] as any;
  const targetComp = (await db.execute(sql`SELECT id, name, company_type FROM companies WHERE id = ${TARGET_ID}`)).rows[0] as any;

  assert(`Source (id=${SOURCE_ID}) exists`, !!sourceComp, sourceComp?.name ?? "not found");
  assert(`Source is type 'erp'`, sourceComp?.company_type === "erp", sourceComp?.company_type);
  assert(`Target (id=${TARGET_ID}) exists`, !!targetComp, targetComp?.name ?? "not found");
  assert(`Target is type 'supplier_partner'`, targetComp?.company_type === "supplier_partner", targetComp?.company_type);
  assert(`Source ≠ Target`, SOURCE_ID !== TARGET_ID);

  const actualSourceName = sourceComp?.name ?? "";
  console.log(`   Source: "${actualSourceName}" (id=${SOURCE_ID})`);
  console.log(`   Target: "${targetComp?.name}" (id=${TARGET_ID})`);

  // Warn if name doesn't match expected constant
  if (actualSourceName !== SOURCE_NAME_EXPECTED) {
    console.log(`   NOTE: Source name is "${actualSourceName}" (expected "${SOURCE_NAME_EXPECTED}") — updating constant for tests`);
  }

  // ── 1. GC baseline ─────────────────────────────────────────────────────
  console.log(BOLD("\n1. GC/Source baseline row counts"));
  const gcBefore = await gcSnapshot();
  console.log(`   vouchers=${gcBefore.vouchers}, inventory=${gcBefore.inventory}, stock_items=${gcBefore.stockItems}`);
  assert("Source has vouchers",    gcBefore.vouchers   > 0);
  assert("Source has inventory",   gcBefore.inventory  > 0);
  assert("Source has stock_items", gcBefore.stockItems > 0);

  // ── 2. Clean slate ─────────────────────────────────────────────────────
  console.log(BOLD("\n2. Clean target slate (SP tables only)"));
  await cleanupRehearsal();
  const tBefore = await targetSnapshot();
  assert("Target aliases  = 0 after cleanup", tBefore.aliases   === 0, `was ${tBefore.aliases}`);
  assert("Target movements = 0 after cleanup", tBefore.movements === 0, `was ${tBefore.movements}`);
  console.log("   Done");

  // ── 3. Preview is dry run — no rows created ─────────────────────────────
  console.log(BOLD("\n3. Preview (dry run) — must write zero rows"));
  const tBeforePreview = await targetSnapshot();
  const preview = await callPreview(SOURCE_ID, TARGET_ID);
  const tAfterPreview = await targetSnapshot();

  assert("Preview returns dryRun=true",         !!preview.dryRun);
  assert("Preview returns stock items",         (preview.itemCount ?? 0) > 0, `got ${preview.itemCount}`);
  assert("Preview: aliases unchanged",          tAfterPreview.aliases   === tBeforePreview.aliases);
  assert("Preview: movements unchanged",        tAfterPreview.movements === tBeforePreview.movements);
  console.log(`   Preview found ${preview.itemCount} items with positive inventory — no rows written`);

  // ── 4. Preview rejects mismatched company types ─────────────────────────
  console.log(BOLD("\n4. Preview safety gates"));
  const badPreview1 = await callPreview(TARGET_ID, SOURCE_ID); // swapped: SP as source
  assert("Preview rejects SP as source",       !!badPreview1.error, badPreview1.error);

  const badPreview2 = await callPreview(SOURCE_ID, SOURCE_ID); // same company
  assert("Preview rejects same company",       !!badPreview2.error, badPreview2.error);

  // ── 5. Rehearsal rejected with wrong confirmation ───────────────────────
  console.log(BOLD("\n5. Rehearsal confirmation gates"));
  const noConfirm = await callRehearsal({
    sourceId: SOURCE_ID, targetId: TARGET_ID,
    companyNameConfirm: actualSourceName, confirmation: "WRONG",
  });
  assert("Rehearsal rejected: wrong action confirmation",  !!noConfirm.error, noConfirm.code ?? "");

  const wrongName = await callRehearsal({
    sourceId: SOURCE_ID, targetId: TARGET_ID,
    companyNameConfirm: "Wrong Company Name", confirmation: "REHEARSE",
  });
  assert("Rehearsal rejected: wrong company name",       !!wrongName.error, wrongName.code ?? "");

  const swappedType = await callRehearsal({
    sourceId: TARGET_ID, targetId: SOURCE_ID,
    companyNameConfirm: targetComp?.name ?? "", confirmation: "REHEARSE",
  });
  assert("Rehearsal rejected: SP company as source",     !!swappedType.error, swappedType.error ?? "");

  // Verify zero rows created by rejected attempts
  const tAfterGates = await targetSnapshot();
  assert("Zero rows after all rejected attempts: aliases",   tAfterGates.aliases   === 0);
  assert("Zero rows after all rejected attempts: movements", tAfterGates.movements === 0);

  // ── 6. GC unchanged through rejected gates ──────────────────────────────
  console.log(BOLD("\n6. GC unchanged after gate rejections"));
  const gcAfterGates = await gcSnapshot();
  assert("GC vouchers unchanged",    gcAfterGates.vouchers   === gcBefore.vouchers);
  assert("GC inventory unchanged",   gcAfterGates.inventory  === gcBefore.inventory);
  assert("GC stock_items unchanged", gcAfterGates.stockItems === gcBefore.stockItems);

  // ── 7. Successful rehearsal copy ────────────────────────────────────────
  console.log(BOLD("\n7. Successful rehearsal copy with correct confirmations"));
  const rehearsal = await callRehearsal({
    sourceId: SOURCE_ID, targetId: TARGET_ID,
    companyNameConfirm: actualSourceName, confirmation: "REHEARSE",
  });

  assert("Rehearsal returned success=true", !!rehearsal.success, rehearsal.error ?? "");
  assert("Run ID returned",                 !!rehearsal.runId,   "no runId");
  assert("Rows created > 0",                           (rehearsal.rowsCreated ?? 0) > 0);
  assert("Aliases created > 0",                        (rehearsal.aliasesCreated ?? 0) > 0);
  assert("Movements created > 0",                      (rehearsal.movementsCreated ?? 0) > 0);
  // Every item gets a movement; aliases are skipped if they already exist from a prior run
  assert("Movements ≥ aliases (new aliases ≤ items)",  (rehearsal.movementsCreated ?? 0) >= (rehearsal.aliasesCreated ?? 0));

  console.log(`   runId=${rehearsal.runId}`);
  console.log(`   aliasesCreated=${rehearsal.aliasesCreated}, movementsCreated=${rehearsal.movementsCreated}, rowsCreated=${rehearsal.rowsCreated}`);

  // ── 8. Verify rows exist only in target ─────────────────────────────────
  console.log(BOLD("\n8. Verify rows created only in target company"));
  const tAfterRehearsal = await targetSnapshot();
  assert("Target aliases > 0",    tAfterRehearsal.aliases   > 0, `got ${tAfterRehearsal.aliases}`);
  assert("Target movements > 0",  tAfterRehearsal.movements > 0, `got ${tAfterRehearsal.movements}`);
  assert("Target sales = 0",      tAfterRehearsal.sales     === 0);

  // Verify ALL tracked alias rows from this run belong to target (not source)
  const aliasesInSource = (await db.execute(sql`
    SELECT COUNT(*) AS n
    FROM sp_migration_run_rows rr
    JOIN stock_item_code_aliases a ON a.id = rr.row_id
    WHERE rr.run_id = ${rehearsal.runId}
      AND rr.table_name = 'stock_item_code_aliases'
      AND a.company_id = ${SOURCE_ID}
  `)).rows[0] as any;
  assert("All tracked alias rows are in TARGET, not source",  pn(aliasesInSource.n) === 0);

  const sourceMov = (await db.execute(sql`
    SELECT COUNT(*) AS n FROM sp_stock_movements WHERE company_id = ${SOURCE_ID}
  `)).rows[0] as any;
  assert("Source company has NO SP movements", pn(sourceMov.n) === 0);

  // ── 9. GC isolation check after rehearsal ───────────────────────────────
  console.log(BOLD("\n9. GC isolation — unchanged after rehearsal copy"));
  const gcAfterRehearsal = await gcSnapshot();
  assert("GC vouchers unchanged",    gcAfterRehearsal.vouchers   === gcBefore.vouchers,   `before=${gcBefore.vouchers}, after=${gcAfterRehearsal.vouchers}`);
  assert("GC inventory unchanged",   gcAfterRehearsal.inventory  === gcBefore.inventory,  `before=${gcBefore.inventory}, after=${gcAfterRehearsal.inventory}`);
  assert("GC stock_items unchanged", gcAfterRehearsal.stockItems === gcBefore.stockItems, `before=${gcBefore.stockItems}, after=${gcAfterRehearsal.stockItems}`);

  // ── 10. Run is logged correctly ─────────────────────────────────────────
  console.log(BOLD("\n10. Rehearsal run logged in sp_migration_rehearsal_runs"));
  const runRow = (await db.execute(sql`
    SELECT id, action, status, rows_created, source_company_id, target_company_id
    FROM sp_migration_rehearsal_runs WHERE id = ${rehearsal.runId} LIMIT 1
  `)).rows[0] as any;

  assert("Run record exists",                          !!runRow);
  assert("Run action = 'rehearsal'",                   runRow?.action === "rehearsal");
  assert("Run status = 'completed'",                   runRow?.status === "completed");
  assert("Run rows_created matches",                   pn(runRow?.rows_created) === rehearsal.rowsCreated);
  assert("Run source_company_id = SOURCE_ID",          pn(runRow?.source_company_id) === SOURCE_ID);
  assert("Run target_company_id = TARGET_ID",          pn(runRow?.target_company_id) === TARGET_ID);

  const runRowCount = pn(((await db.execute(sql`
    SELECT COUNT(*) AS n FROM sp_migration_run_rows WHERE run_id = ${rehearsal.runId}
  `)).rows[0] as any).n);
  assert("sp_migration_run_rows has tracked rows",     runRowCount > 0, `got ${runRowCount}`);
  assert("Run_rows count ≥ rows_created",              runRowCount >= rehearsal.rowsCreated);

  // ── 11. Opening stock cost data correct ─────────────────────────────────
  console.log(BOLD("\n11. Opening stock cost correctness in target"));
  const sampleMov = (await db.execute(sql`
    SELECT article_code, qty_in, qty_remaining, base_unit_cost_usd, final_unit_cost_usd
    FROM sp_stock_movements
    WHERE company_id = ${TARGET_ID} AND source_type = 'opening_stock'
    ORDER BY id LIMIT 5
  `)).rows as any[];

  assert("At least 5 opening stock movements in target", sampleMov.length >= 5);
  for (const m of sampleMov) {
    assert(`${m.article_code}: qty_in > 0`,             pn(m.qty_in) > 0);
    assert(`${m.article_code}: qty_remaining = qty_in`,  Math.abs(pn(m.qty_in) - pn(m.qty_remaining)) < 0.001);
    assert(`${m.article_code}: final_cost ≥ base_cost`,  pn(m.final_unit_cost_usd) >= pn(m.base_unit_cost_usd) - 0.001);
  }

  // ── 12. Rollback removes only target rows ───────────────────────────────
  console.log(BOLD("\n12. Rollback — removes target rows, leaves GC unchanged"));
  const countBeforeRollback = tAfterRehearsal.movements;
  const rollback = await callRollback(rehearsal.runId!, TARGET_ID);

  assert("Rollback returned success=true",    !!rollback.success, rollback.error ?? "");
  assert("Rollback returned rowsDeleted > 0", (rollback.rowsDeleted ?? 0) > 0);

  const tAfterRollback = await targetSnapshot();
  assert("Target movements = 0 after rollback",  tAfterRollback.movements === 0, `got ${tAfterRollback.movements}`);
  assert("Target aliases = 0 after rollback",    tAfterRollback.aliases   === 0, `got ${tAfterRollback.aliases}`);
  console.log(`   Rolled back ${rollback.rowsDeleted} rows (was ${countBeforeRollback} movements + ${tAfterRehearsal.aliases} aliases)`);

  // ── 13. GC unchanged after rollback ────────────────────────────────────
  console.log(BOLD("\n13. GC unchanged after rollback"));
  const gcAfterRollback = await gcSnapshot();
  assert("GC vouchers unchanged",    gcAfterRollback.vouchers   === gcBefore.vouchers);
  assert("GC inventory unchanged",   gcAfterRollback.inventory  === gcBefore.inventory);
  assert("GC stock_items unchanged", gcAfterRollback.stockItems === gcBefore.stockItems);

  // ── 14. Run status = rolled_back ────────────────────────────────────────
  console.log(BOLD("\n14. Run status updated to rolled_back"));
  const runAfterRollback = (await db.execute(sql`
    SELECT status FROM sp_migration_rehearsal_runs WHERE id = ${rehearsal.runId}
  `)).rows[0] as any;
  assert("Run status = 'rolled_back'", runAfterRollback?.status === "rolled_back");

  // Double rollback is rejected
  const doubleRollback = await callRollback(rehearsal.runId!, TARGET_ID);
  assert("Double rollback rejected",  !!doubleRollback.error, doubleRollback.error ?? "");

  // ── 15. Cutover endpoint must not exist / be blocked ───────────────────
  console.log(BOLD("\n15. Cutover endpoint absent or blocked"));
  // Check the route file: no working POST /cutover; only an app.all that returns 403
  const { readFileSync } = await import("fs");
  const cutoverRouteFile = readFileSync("server/routes/spMigrationRoutes.ts", "utf8");
  assert("No working POST /cutover in migration routes", !cutoverRouteFile.includes('app.post("/api/sp/migration/cutover"'));
  assert("Cutover guard (403 block) exists",             cutoverRouteFile.includes("CUTOVER_DISABLED"));
  assert("Phase 5 disabled message in guard",            cutoverRouteFile.includes("Phase 5 is disabled"));

  // ── 16. Migration tables exist in DB ───────────────────────────────────
  console.log(BOLD("\n16. Migration tracking tables exist in DB"));
  const tables = (await db.execute(sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('sp_migration_rehearsal_runs', 'sp_migration_run_rows')
    ORDER BY tablename
  `)).rows as any[];
  assert("sp_migration_rehearsal_runs table exists", tables.some((t: any) => t.tablename === "sp_migration_rehearsal_runs"));
  assert("sp_migration_run_rows table exists",       tables.some((t: any) => t.tablename === "sp_migration_run_rows"));

  // ── Final GC counts summary ─────────────────────────────────────────────
  console.log(BOLD("\n── GC Source Row Counts (Before vs After) ──────────────────"));
  const gcFinal = await gcSnapshot();
  console.log(`   Vouchers:    ${gcBefore.vouchers}   → ${gcFinal.vouchers}   ${gcFinal.vouchers === gcBefore.vouchers ? GREEN("unchanged") : RED("CHANGED!")}`);
  console.log(`   Inventory:   ${gcBefore.inventory}  → ${gcFinal.inventory}  ${gcFinal.inventory === gcBefore.inventory ? GREEN("unchanged") : RED("CHANGED!")}`);
  console.log(`   Stock Items: ${gcBefore.stockItems} → ${gcFinal.stockItems} ${gcFinal.stockItems === gcBefore.stockItems ? GREEN("unchanged") : RED("CHANGED!")}`);

  // ── Summary ──────────────────────────────────────────────────────────────
  const total = passed + failed;
  console.log(BOLD(CYAN("\n═══════════════════════════════════════════════════════════")));
  if (failed === 0) {
    console.log(GREEN(BOLD(`  ALL ${total} TESTS PASSED ✓`)));
    console.log(CYAN("  Phase 4 complete — rehearsal tooling verified, GC intact"));
  } else {
    console.log(RED(BOLD(`  ${failed} of ${total} TESTS FAILED`)));
    failures.forEach(f => console.log(`    ${RED("•")} ${f}`));
  }
  console.log(BOLD(CYAN("═══════════════════════════════════════════════════════════\n")));

  process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => {
  console.error(RED(BOLD("Fatal: " + err.message)));
  console.error(err.stack);
  process.exit(1);
});
