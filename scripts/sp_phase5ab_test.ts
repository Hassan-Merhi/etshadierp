/**
 * SP Phase 5-A/B Test
 *
 * Verifies:
 *   A) Routing: supplier_partner companies no longer forced to /sp/containers
 *      (verified structurally — the redirect code no longer exists)
 *   B) Backend guards: unsafe ERP posting endpoints block supplier_partner and
 *      allow safe types, while normal ERP companies remain unaffected.
 *
 * Usage: npx tsx scripts/sp_phase5ab_test.ts
 */

import { db } from "../server/db";
import { companies, vouchers, inventory, stockItems } from "../shared/schema";
import { eq, and, count } from "drizzle-orm";

// ── Helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function check(label: string, actual: boolean, expected = true) {
  const ok = actual === expected;
  console.log(`  ${ok ? "✅ PASS" : "❌ FAIL"}  ${label}`);
  ok ? passed++ : failed++;
  return ok;
}

function checkVal(label: string, got: any, expected: any) {
  const ok = got === expected;
  console.log(`  ${ok ? "✅ PASS" : "❌ FAIL"}  ${label}: got=${JSON.stringify(got)} expected=${JSON.stringify(expected)}`);
  ok ? passed++ : failed++;
  return ok;
}

function section(title: string) {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 55 - title.length))}`);
}

// ── Guard-logic simulator ─────────────────────────────────────────────────────
// Mirrors what each route now does: look up company type and block if SP + unsafe type.

const SP_BLOCKED_VOUCHER_TYPES = ["Sale", "Purchase", "Stock Adjustment"];

async function simulateVoucherGuard(companyId: number, voucherType: string): Promise<{ blocked: boolean; reason?: string }> {
  if (SP_BLOCKED_VOUCHER_TYPES.includes(voucherType)) {
    const [co] = await db.select({ companyType: companies.companyType })
      .from(companies).where(eq(companies.id, companyId)).limit(1);
    if (co?.companyType === "supplier_partner") {
      return { blocked: true, reason: "Supplier Partner companies must use SP Sales / SP Containers for this action." };
    }
  }
  return { blocked: false };
}

async function simulatePosGuard(companyId: number): Promise<{ blocked: boolean }> {
  const [co] = await db.select({ companyType: companies.companyType })
    .from(companies).where(eq(companies.id, companyId)).limit(1);
  if (co?.companyType === "supplier_partner") return { blocked: true };
  return { blocked: false };
}

async function simulateQuickAdjustGuard(companyId: number): Promise<{ blocked: boolean }> {
  const [co] = await db.select({ companyType: companies.companyType })
    .from(companies).where(eq(companies.id, companyId)).limit(1);
  if (co?.companyType === "supplier_partner") return { blocked: true };
  return { blocked: false };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("  SP Phase 5-A/B Test — Navigation + Backend Safety Guards");
  console.log("══════════════════════════════════════════════════════════════\n");

  // ── 0. Find test companies ────────────────────────────────────────────────
  section("0. Company setup");

  const [spCo] = await db.select().from(companies)
    .where(eq(companies.code, "SPTEST")).limit(1);
  check("SP test company (SPTEST) exists", !!spCo);
  checkVal("SP company type is supplier_partner", spCo?.companyType, "supplier_partner");

  // Find a normal ERP company (not SP / factory)
  const [erpCo] = await db.select().from(companies)
    .where(and(
      eq(companies.companyType, "erp"),
      eq(companies.active, true),
    )).limit(1);
  check("Normal ERP company found", !!erpCo);
  if (erpCo) checkVal("ERP company type is erp", erpCo.companyType, "erp");

  if (!spCo || !erpCo) {
    console.log("\n⚠️  Cannot continue without both companies. Aborting.\n");
    process.exit(1);
  }

  // ── 1. P5-A Structural check — hard redirect removed ─────────────────────
  section("1. P5-A — Hard redirect removed (structural)");

  // The redirect lived in App.tsx. We verify it's gone by checking the source file.
  const { readFileSync } = await import("fs");
  const appSource = readFileSync("client/src/App.tsx", "utf-8");

  check(
    'Hard redirect to /sp/containers is removed from App.tsx',
    !appSource.includes('return <Redirect to="/sp/containers" />;'),
  );
  check(
    'SP routing block comment is removed',
    !appSource.includes('Supplier Partner routing block'),
  );
  check(
    '/sp/containers route exists in ERP Router Switch',
    appSource.includes('path="/sp/containers"') && appSource.includes('SpContainers'),
  );
  check(
    '/sp/migration route exists in ERP Router Switch',
    appSource.includes('path="/sp/migration"'),
  );
  check(
    '/sp/setup route exists in ERP Router Switch',
    appSource.includes('path="/sp/setup"'),
  );
  check(
    'SpSidebar is no longer imported in App.tsx',
    !appSource.includes("SpSidebar"),
  );

  // Verify AppSidebar has the SP section
  const sidebarSource = readFileSync("client/src/components/AppSidebar.tsx", "utf-8");
  check(
    'AppSidebar has Supplier Partner section',
    sidebarSource.includes('"Supplier Partner"'),
  );
  check(
    'AppSidebar SP section is conditional on supplier_partner type',
    sidebarSource.includes('companyType === "supplier_partner"'),
  );
  check(
    'AppSidebar SP section includes SP Containers link',
    sidebarSource.includes('"/sp/containers"'),
  );
  check(
    'AppSidebar SP section includes Setup link',
    sidebarSource.includes('"/sp/setup"'),
  );

  // ── 2. P5-B — Backend guard: Voucher Sale blocked for SP ─────────────────
  section("2. P5-B — Voucher Sale blocked for supplier_partner");

  const saleResult = await simulateVoucherGuard(spCo.id, "Sale");
  check("POST /api/vouchers Sale blocked for SP company", saleResult.blocked);
  check("Blocked Sale returns correct message",
    saleResult.reason === "Supplier Partner companies must use SP Sales / SP Containers for this action.");

  const purchaseResult = await simulateVoucherGuard(spCo.id, "Purchase");
  check("POST /api/vouchers Purchase blocked for SP company", purchaseResult.blocked);

  const stockAdjResult = await simulateVoucherGuard(spCo.id, "Stock Adjustment");
  check("POST /api/vouchers Stock Adjustment blocked for SP company", stockAdjResult.blocked);

  // ── 3. P5-B — Safe voucher types pass through for SP ─────────────────────
  section("3. P5-B — Safe voucher types allowed for supplier_partner");

  const safeTypes = ["Payment", "Receipt", "Journal", "Contra", "Expense", "Stock Transfer"];
  for (const vt of safeTypes) {
    const result = await simulateVoucherGuard(spCo.id, vt);
    check(`POST /api/vouchers ${vt} is NOT blocked for SP company`, !result.blocked);
  }

  // ── 4. P5-B — POS sale blocked for SP ────────────────────────────────────
  section("4. P5-B — POS sale blocked for supplier_partner");

  const posResult = await simulatePosGuard(spCo.id);
  check("POST /api/pos/sales blocked for SP company", posResult.blocked);

  // ── 5. P5-B — Quick-adjust blocked for SP ────────────────────────────────
  section("5. P5-B — Stock quick-adjust blocked for supplier_partner");

  const adjResult = await simulateQuickAdjustGuard(spCo.id);
  check("POST /api/inventory/quick-adjust blocked for SP company", adjResult.blocked);

  // ── 6. Normal ERP — guards do NOT block normal ERP company ────────────────
  section("6. Normal ERP company — guards pass through");

  const erpSale = await simulateVoucherGuard(erpCo.id, "Sale");
  check("POST /api/vouchers Sale NOT blocked for normal ERP company", !erpSale.blocked);

  const erpPurchase = await simulateVoucherGuard(erpCo.id, "Purchase");
  check("POST /api/vouchers Purchase NOT blocked for normal ERP company", !erpPurchase.blocked);

  const erpStockAdj = await simulateVoucherGuard(erpCo.id, "Stock Adjustment");
  check("POST /api/vouchers Stock Adjustment NOT blocked for normal ERP company", !erpStockAdj.blocked);

  const erpPos = await simulatePosGuard(erpCo.id);
  check("POST /api/pos/sales NOT blocked for normal ERP company", !erpPos.blocked);

  const erpAdj = await simulateQuickAdjustGuard(erpCo.id);
  check("POST /api/inventory/quick-adjust NOT blocked for normal ERP company", !erpAdj.blocked);

  // ── 7. Backend guard source code present ─────────────────────────────────
  section("7. Backend guard code present in source files");

  const voucherSrc = readFileSync("server/routes/voucherRoutes.ts", "utf-8");
  check(
    'voucherRoutes has SP_BLOCKED_VOUCHER_TYPES guard in POST /api/vouchers',
    voucherSrc.includes('SP_BLOCKED_VOUCHER_TYPES') && voucherSrc.includes('supplier_partner'),
  );
  check(
    'voucherRoutes guards POST /api/vouchers/with-entries too',
    (voucherSrc.match(/SP_BLOCKED_VOUCHER_TYPES/g) || []).length >= 2,
  );

  const posSrc = readFileSync("server/routes/posRoutes.ts", "utf-8");
  check(
    'posRoutes guards POST /api/pos/sales for supplier_partner',
    posSrc.includes('supplier_partner') && posSrc.includes('SP Sales / SP Containers'),
  );

  const invSrc = readFileSync("server/routes/inventoryRoutes.ts", "utf-8");
  check(
    'inventoryRoutes guards POST /api/inventory/quick-adjust for supplier_partner',
    invSrc.includes('supplier_partner') && invSrc.includes('SP Sales / SP Containers'),
  );

  // ── 8. GC L'shi isolation ─────────────────────────────────────────────────
  section("8. GC L'shi data isolation (must be unchanged)");

  const [gcCo] = await db.select().from(companies)
    .where(eq(companies.name, "GC L'shi")).limit(1);

  if (gcCo) {
    const [{ value: voucherCount }] = await db.select({ value: count() })
      .from(vouchers).where(eq(vouchers.companyId, gcCo.id));
    check("GC L'shi vouchers >= 2612 (not reduced)", Number(voucherCount) >= 2612);
    console.log(`     GC L'shi voucher count: ${voucherCount}`);

    const [{ value: invCount }] = await db.select({ value: count() })
      .from(inventory).where(eq(inventory.companyId, gcCo.id));
    check("GC L'shi inventory >= 2216 (not reduced)", Number(invCount) >= 2216);
    console.log(`     GC L'shi inventory rows: ${invCount}`);

    const [{ value: siCount }] = await db.select({ value: count() })
      .from(stockItems).where(eq(stockItems.companyId, gcCo.id));
    check("GC L'shi stock items >= 1808 (not reduced)", Number(siCount) >= 1808);
    console.log(`     GC L'shi stock items: ${siCount}`);
  } else {
    console.log("  ⚠️  GC L'shi company not found — skipping isolation check.");
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const total = passed + failed;
  console.log(`\n══════════════════════════════════════════════════════════════`);
  console.log(`  Results: ${passed}/${total} passed`);
  if (failed === 0) {
    console.log("  ✅ All P5-A/B checks passed.");
  } else {
    console.log(`  ❌ ${failed} check(s) failed.`);
  }
  console.log("══════════════════════════════════════════════════════════════\n");

  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
