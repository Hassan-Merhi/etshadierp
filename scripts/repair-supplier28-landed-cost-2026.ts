/**
 * One-off repair: reconcile the January 2026 ABOU SOBHI ARIOM (supplier #28)
 * six-container landed cost to the authoritative supplier invoice total.
 *
 * BACKGROUND:
 *   Each of the six containers below was offloaded with its own independently
 *   computed cost/kg, but they were actually one combined shipment covered by
 *   a single supplier invoice for EUR 70,059.26 (FX 1.18) across 128,000 kg
 *   total. The correct landed cost is therefore a UNIFORM rate per kg across
 *   all six containers — not each container's separately (and inconsistently)
 *   computed rate. The system currently shows a blended average of ~$0.6361/kg
 *   (totalling $81,411.67); the authoritative figure is $0.645858803125/kg
 *   (totalling $82,669.9268) — a $1,258.26 understatement.
 *
 * SCOPE: This script ONLY touches valuation fields — costPerKg/costPerKgUsd on
 * factory_raw_stock, factory_mix_batch_sources, factory_mix_batches, and
 * factory_bales, plus the container's finalPayableAmount/finalPayableAmountUsd/
 * ratePerKgUsd. It does NOT touch quantities, vouchers, supplier balances, or
 * payments. Every changed row is written to audit_log with before/after values.
 *
 * SAFETY:
 *   - Dry-run by default; nothing is written unless --apply is passed.
 *   - Refuses to run unless ALL SIX containers are found under the expected
 *     company/supplier, with combined actualReceivedKg matching 128,000 kg
 *     within a 0.5 kg tolerance. Any mismatch aborts with no writes.
 *   - All writes happen inside a single DB transaction — a failure partway
 *     through rolls back everything.
 *
 * USAGE:
 *   tsx scripts/repair-supplier28-landed-cost-2026.ts            # dry-run
 *   tsx scripts/repair-supplier28-landed-cost-2026.ts --apply    # commit
 *
 * To target production, run with DATABASE_URL set to the production
 * connection string for that invocation only — never commit it to a file.
 */
import { db } from "../server/db";
import { factoryContainers, factorySuppliers, auditLog } from "../shared/schema";
import { eq, inArray, and, isNull } from "drizzle-orm";
import { cascadeContainerCostChange } from "../server/services/factory/rawStockCostCascade";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");

// ── Scope constants (this shipment only) ────────────────────────────────────
const SUPPLIER_NAME_HINT = "ABOU SOBHI ARIOM";
const SUPPLIER_ID = 28;
const COMPANY_ID = 12;
const CONTAINER_NUMBERS = [
  "MSMU4262860",
  "CMAU4950747",
  "ECMU7424712",
  "TRHU8457570",
  "ECMU7025820",
  "TEMU7619008",
];
const AUTHORITATIVE_EUR_TOTAL = 70059.26;
const AUTHORITATIVE_FX_RATE = 1.18;
const EXPECTED_TOTAL_KG = 128000;
const KG_TOLERANCE = 0.5;

async function main() {
  console.log(`\n== Supplier #${SUPPLIER_ID} (${SUPPLIER_NAME_HINT}) Landed Cost Reconciliation — 2026 ==`);
  console.log(`Mode: ${APPLY ? "APPLY (will write to DB)" : "DRY-RUN (read-only)"}`);
  console.log("");

  // ── Precondition 1: supplier identity sanity check ────────────────────────
  const [supplier] = await db.select().from(factorySuppliers).where(eq(factorySuppliers.id, SUPPLIER_ID));
  if (!supplier) {
    throw new Error(`Supplier #${SUPPLIER_ID} not found — aborting, no writes made.`);
  }
  if (!supplier.name?.toUpperCase().includes(SUPPLIER_NAME_HINT.split(" ")[0])) {
    throw new Error(
      `Supplier #${SUPPLIER_ID} name "${supplier.name}" does not look like "${SUPPLIER_NAME_HINT}" — aborting to avoid touching the wrong supplier's data.`
    );
  }

  // ── Precondition 2: all six containers must exist under this company ─────
  // NOTE: select only the columns this script needs (not select-all) so it stays
  // robust against schema drift between this dev environment and whatever
  // migration state the target database is actually at (e.g. newer tracking
  // columns that may not exist yet on an older production schema).
  const containers = await db
    .select({
      id: factoryContainers.id,
      companyId: factoryContainers.companyId,
      containerNumber: factoryContainers.containerNumber,
      supplierId: factoryContainers.supplierId,
      status: factoryContainers.status,
      currencyCode: factoryContainers.currencyCode,
      actualReceivedKg: factoryContainers.actualReceivedKg,
      finalPayableAmount: factoryContainers.finalPayableAmount,
      finalPayableAmountUsd: factoryContainers.finalPayableAmountUsd,
      ratePerKgUsd: factoryContainers.ratePerKgUsd,
      fxRateToUsd: factoryContainers.fxRateToUsd,
    })
    .from(factoryContainers)
    .where(
      and(
        eq(factoryContainers.companyId, COMPANY_ID),
        inArray(factoryContainers.containerNumber, CONTAINER_NUMBERS),
        isNull(factoryContainers.deletedAt)
      )
    );

  if (containers.length !== CONTAINER_NUMBERS.length) {
    const found = containers.map((c) => c.containerNumber);
    const missing = CONTAINER_NUMBERS.filter((n) => !found.includes(n));
    throw new Error(
      `Expected all ${CONTAINER_NUMBERS.length} containers, found ${containers.length}. Missing: ${missing.join(", ")}. Aborting — no writes made.`
    );
  }
  for (const c of containers) {
    if (c.supplierId !== SUPPLIER_ID) {
      throw new Error(
        `Container ${c.containerNumber} has supplierId=${c.supplierId}, expected ${SUPPLIER_ID}. Aborting.`
      );
    }
    if (c.status !== "OFFLOADED") {
      throw new Error(`Container ${c.containerNumber} has status="${c.status}", expected OFFLOADED. Aborting.`);
    }
    if ((c.currencyCode || "USD") !== "EUR") {
      throw new Error(`Container ${c.containerNumber} currency is "${c.currencyCode}", expected EUR. Aborting.`);
    }
  }

  // ── Precondition 3: total received kg must match the invoice's declared kg ─
  const totalKg = containers.reduce((sum, c) => sum + parseFloat(c.actualReceivedKg || "0"), 0);
  if (Math.abs(totalKg - EXPECTED_TOTAL_KG) > KG_TOLERANCE) {
    throw new Error(
      `Combined actualReceivedKg=${totalKg} does not match expected ${EXPECTED_TOTAL_KG} kg (tolerance ${KG_TOLERANCE}). Aborting — no writes made.`
    );
  }

  // ── Compute the uniform authoritative rate ────────────────────────────────
  const nativeRatePerKg = AUTHORITATIVE_EUR_TOTAL / EXPECTED_TOTAL_KG; // EUR/kg
  const usdRatePerKg = nativeRatePerKg * AUTHORITATIVE_FX_RATE; // USD/kg

  console.log(`Supplier:            ${supplier.name} (#${SUPPLIER_ID})`);
  console.log(`Containers:          ${containers.length} found, all OFFLOADED/EUR, matched`);
  console.log(`Total received kg:   ${totalKg} (expected ${EXPECTED_TOTAL_KG})`);
  console.log(`Authoritative total: EUR ${AUTHORITATIVE_EUR_TOTAL} x FX ${AUTHORITATIVE_FX_RATE} = USD ${(AUTHORITATIVE_EUR_TOTAL * AUTHORITATIVE_FX_RATE).toFixed(4)}`);
  console.log(`New uniform rate:    EUR ${nativeRatePerKg.toFixed(7)}/kg  =  USD ${usdRatePerKg.toFixed(7)}/kg`);
  console.log("");
  console.log("Per-container changes:");

  let sumOldUsd = 0;
  let sumNewUsd = 0;
  const perContainerPlan = containers
    .sort((a, b) => a.containerNumber.localeCompare(b.containerNumber))
    .map((c) => {
      const kg = parseFloat(c.actualReceivedKg || "0");
      const oldNative = parseFloat(c.finalPayableAmount || "0");
      const oldUsd = parseFloat(c.finalPayableAmountUsd || "0");
      const newNative = kg * nativeRatePerKg;
      const newUsd = kg * usdRatePerKg;
      sumOldUsd += oldUsd;
      sumNewUsd += newUsd;
      console.log(
        `  ${c.containerNumber.padEnd(14)} kg=${kg.toString().padStart(8)}  ` +
          `old: EUR ${oldNative.toFixed(2)} / USD ${oldUsd.toFixed(2)} (rate ${(oldUsd / kg).toFixed(4)})  ` +
          `-> new: EUR ${newNative.toFixed(2)} / USD ${newUsd.toFixed(2)} (rate ${usdRatePerKg.toFixed(6)})`
      );
      return { container: c, kg, oldNative, oldUsd, newNative, newUsd };
    });

  console.log("");
  console.log(`Sum old USD total: $${sumOldUsd.toFixed(2)}`);
  console.log(`Sum new USD total: $${sumNewUsd.toFixed(2)}  (authoritative: $${(AUTHORITATIVE_EUR_TOTAL * AUTHORITATIVE_FX_RATE).toFixed(4)})`);
  console.log(`Difference:        $${(sumNewUsd - sumOldUsd).toFixed(2)}`);
  console.log("");

  if (!APPLY) {
    console.log("Dry-run complete. Re-run with --apply to write these changes (in one transaction, fully audited).");
    process.exit(0);
  }

  console.log("Applying changes in a transaction...");
  const runId = `landed-cost-repair-supplier28-2026`;
  const runAt = new Date().toISOString();

  await db.transaction(async (tx) => {
    for (const plan of perContainerPlan) {
      const c = plan.container;

      await tx
        .update(factoryContainers)
        .set({
          finalPayableAmount: plan.newNative.toFixed(4),
          finalPayableAmountUsd: plan.newUsd.toFixed(4),
          ratePerKgUsd: usdRatePerKg.toFixed(7),
          updatedAt: new Date(),
        })
        .where(eq(factoryContainers.id, c.id));

      const cascade = await cascadeContainerCostChange(tx, {
        companyId: COMPANY_ID,
        containerId: c.id,
        newCostPerKg: nativeRatePerKg,
        newCostPerKgUsd: usdRatePerKg,
      });

      await tx.insert(auditLog).values({
        userId: "system-script",
        username: "repair-supplier28-landed-cost-2026",
        companyId: COMPANY_ID,
        action: "LANDED_COST_RECONCILIATION",
        tableName: "factory_containers",
        recordId: c.id,
        recordIdentifier: c.containerNumber,
        changes: {
          old: {
            finalPayableAmount: c.finalPayableAmount,
            finalPayableAmountUsd: c.finalPayableAmountUsd,
            ratePerKgUsd: c.ratePerKgUsd,
          },
          new: {
            finalPayableAmount: plan.newNative.toFixed(4),
            finalPayableAmountUsd: plan.newUsd.toFixed(4),
            ratePerKgUsd: usdRatePerKg.toFixed(7),
          },
          runId,
          runAt,
          reason:
            "Reconciled to authoritative supplier invoice EUR 70,059.26 x FX 1.18 across 128,000kg (uniform rate), replacing inconsistent per-container blended rates.",
          rawStockRowsUpdated: cascade.rawStockRowsUpdated,
          affectedBatches: cascade.affectedBatches.map((b) => ({
            batchId: b.batchId,
            batchCode: b.batchCode,
            oldCostPerKg: b.oldCostPerKg,
            newCostPerKg: b.newCostPerKg,
          })),
          affectedBaleCount: cascade.affectedBales.length,
        },
      });

      console.log(
        `  [applied] ${c.containerNumber}: ${cascade.affectedBatches.length} batch(es), ${cascade.affectedBales.length} bale(s) recosted.`
      );
    }
  });

  console.log("");
  console.log("Done. All six containers reconciled to the authoritative landed cost, fully audited.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Repair failed — no partial writes were committed (transactional):", err.message);
  process.exit(1);
});
