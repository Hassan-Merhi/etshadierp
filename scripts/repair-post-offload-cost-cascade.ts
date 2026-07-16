/**
 * One-time repair: re-run the post-offload cost cascade for every offloaded
 * container that has factoryOffloadAdditionalCharges rows whose costs were not
 * correctly propagated to raw-stock, mix-batches, and bales.
 *
 * What this script does:
 *   1. Finds all (companyId, containerId) pairs that have post-offload charges.
 *   2. For each eligible container (OFFLOADED / RECEIVED / PARTIALLY_RECEIVED):
 *      a. Calls computeCorrectContainerCost to get the authoritative landed cost.
 *      b. Updates container landed totals.
 *      c. Calls cascadeContainerCostChange(includeCompletedBatches: true) which:
 *         - reads the OLD raw-stock cost (value-delta calc requires this)
 *         - writes the new raw-stock cost
 *         - nudges the supplier locked rate
 *         - corrects mix-batch source rows (USD cost)
 *         - recomputes batch weighted averages
 *         - cascades to bales
 *   3. NEVER creates, modifies or deletes accounting vouchers.
 *   4. NEVER changes quantities, received kg, payments or supplier balances.
 *   5. Each container is repaired in its own transaction (idempotent).
 *
 * IMPORTANT: do NOT manually overwrite raw-stock before calling the cascade —
 * the cascade reads the old cost first to compute the supplier-rate value delta.
 *
 * Run with:
 *   npx tsx scripts/repair-post-offload-cost-cascade.ts
 */
import { eq, and } from "drizzle-orm";
import { db } from "../server/db";
import {
  factoryContainers,
  factoryOffloadAdditionalCharges,
  factoryContainerCommissions,
} from "@shared/schema";
import { computeCorrectContainerCost } from "../server/services/factory/rawStockRecalc";
import { cascadeContainerCostChange } from "../server/services/factory/rawStockCostCascade";

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  Post-offload cost cascade repair");
  console.log("═══════════════════════════════════════════════════\n");

  // 1. Find every (companyId, containerId) pair that has post-offload charges.
  const chargeRows = await db
    .selectDistinct({
      containerId: factoryOffloadAdditionalCharges.containerId,
      companyId: factoryOffloadAdditionalCharges.companyId,
    })
    .from(factoryOffloadAdditionalCharges);

  if (chargeRows.length === 0) {
    console.log("No containers with post-offload charges found. Nothing to repair.");
    process.exit(0);
  }

  console.log(`Found ${chargeRows.length} container(s) with post-offload charges.\n`);

  const ELIGIBLE_STATUSES = new Set(["OFFLOADED", "RECEIVED", "PARTIALLY_RECEIVED"]);

  let repaired = 0;
  let skipped = 0;
  let failed = 0;
  let totalRawStockRowsUpdated = 0;
  let totalBatchesUpdated = 0;
  let totalCompletedBatchesUpdated = 0;
  let totalBalesUpdated = 0;

  for (const { companyId, containerId } of chargeRows) {
    try {
      // Load container
      const [container] = await db
        .select()
        .from(factoryContainers)
        .where(and(eq(factoryContainers.id, containerId), eq(factoryContainers.companyId, companyId)));

      if (!container) {
        console.log(`  Container ${containerId}: not found — skip`);
        skipped++;
        continue;
      }

      if (!ELIGIBLE_STATUSES.has(container.status)) {
        console.log(
          `  Container ${container.containerNumber} (${containerId}): status=${container.status} — skip`
        );
        skipped++;
        continue;
      }

      // Load charges and commission record
      const [additionalCharges, commissionRecords] = await Promise.all([
        db
          .select()
          .from(factoryOffloadAdditionalCharges)
          .where(
            and(
              eq(factoryOffloadAdditionalCharges.containerId, containerId),
              eq(factoryOffloadAdditionalCharges.companyId, companyId)
            )
          ),
        db
          .select()
          .from(factoryContainerCommissions)
          .where(
            and(
              eq(factoryContainerCommissions.containerId, containerId),
              eq(factoryContainerCommissions.companyId, companyId)
            )
          ),
      ]);

      const commissionRecord = commissionRecords.sort((a: any, b: any) => b.id - a.id)[0] || null;

      // Compute authoritative landed cost
      const next = computeCorrectContainerCost(container, additionalCharges, commissionRecord);

      if (next.fxUnresolved) {
        console.log(
          `  Container ${container.containerNumber}: FX rate unresolved — skip (needs manual review)`
        );
        skipped++;
        continue;
      }
      if (next.costPerKgUsd === 0 && next.costPerKg === 0) {
        console.log(`  Container ${container.containerNumber}: no received kg — skip`);
        skipped++;
        continue;
      }

      const oldCostPerKgUsd = parseFloat((container as any).ratePerKgUsd || "0");

      await db.transaction(async (tx: any) => {
        // Update container landed totals (never touches ratePerKg)
        await tx
          .update(factoryContainers)
          .set({
            finalPayableAmount: String(next.totalCost),
            ratePerKgUsd: String(next.costPerKgUsd),
            finalPayableAmountUsd: String(next.totalUsd),
            updatedAt: new Date(),
          })
          .where(eq(factoryContainers.id, containerId));

        // Cascade: raw-stock → supplier locked rate → mix-batch sources → batches → bales.
        // includeCompletedBatches: true — post-offload charges are retroactive by design.
        const result = await cascadeContainerCostChange(
          tx,
          {
            companyId,
            containerId,
            newCostPerKg: next.costPerKg,
            newCostPerKgUsd: next.costPerKgUsd,
          },
          { includeCompletedBatches: true }
        );

        totalRawStockRowsUpdated += result.rawStockRowsUpdated;
        totalBatchesUpdated += result.affectedBatches.length;
        totalCompletedBatchesUpdated += result.affectedBatches.filter((b: any) => b.wasCompleted).length;
        totalBalesUpdated += result.affectedBales.length;
      });

      console.log(
        `  ✓ ${container.containerNumber}: ` +
          `${oldCostPerKgUsd.toFixed(4)} → ${next.costPerKgUsd.toFixed(4)} USD/kg`
      );
      repaired++;
    } catch (err: any) {
      console.error(`  ✗ Container ${containerId}: ${err.message}`);
      failed++;
    }
  }

  console.log("\n═══════════════════════════════════════════════════");
  console.log("  Repair complete");
  console.log("───────────────────────────────────────────────────");
  console.log(`  Containers repaired:         ${repaired}`);
  console.log(`  Raw-stock rows updated:      ${totalRawStockRowsUpdated}`);
  console.log(`  Batches updated:             ${totalBatchesUpdated}`);
  console.log(`  Completed batches updated:   ${totalCompletedBatchesUpdated}`);
  console.log(`  Bales updated:               ${totalBalesUpdated}`);
  console.log(`  Skipped:                     ${skipped}`);
  console.log(`  Failures:                    ${failed}`);
  console.log("═══════════════════════════════════════════════════");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
