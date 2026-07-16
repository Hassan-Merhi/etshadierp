#!/usr/bin/env tsx
/**
 * audit-repair-all-raw-material-costs.ts
 *
 * CLI script that:
 *   1. Runs the full audit scan (read-only) and prints a summary.
 *   2. If --repair flag is passed, applies all "safe" repairs automatically.
 *   3. Runs the audit again and reports how many safe mismatches remain.
 *
 * Usage:
 *   npx tsx scripts/audit-repair-all-raw-material-costs.ts --company-id=<id>
 *   npx tsx scripts/audit-repair-all-raw-material-costs.ts --company-id=<id> --repair
 *   npx tsx scripts/audit-repair-all-raw-material-costs.ts --company-id=<id> --repair --include-historical
 *   npx tsx scripts/audit-repair-all-raw-material-costs.ts --company-id=<id> --repair --include-completed-batches
 *
 * Environment:
 *   DATABASE_URL (or RENDER_DATABASE_URL) must be set.
 */
// DATABASE_URL must be set in the environment before running this script.
// Example: DATABASE_URL="$RENDER_DATABASE_URL" npx tsx scripts/audit-repair-all-raw-material-costs.ts --company-id=1
import { getFullAuditScan, applyRawStockRecalc, getMixBatchSourceCostMismatchPreview, applyZeroCostMixBatchSourcesFix } from "../server/services/factory/rawStockRecalc";

const args = process.argv.slice(2);
const doRepair = args.includes("--repair");
const includeHistorical = args.includes("--include-historical");
const includeCompletedBatches = args.includes("--include-completed-batches");
const companyIdArg = args.find((a) => a.startsWith("--company-id="));

if (!companyIdArg) {
  console.error("ERROR: --company-id=<id> is required");
  process.exit(1);
}

const companyId = parseInt(companyIdArg.split("=")[1]);
if (isNaN(companyId) || companyId <= 0) {
  console.error("ERROR: --company-id must be a positive integer");
  process.exit(1);
}

function line(char = "─", width = 72) {
  return char.repeat(width);
}

function printSummary(label: string, summary: ReturnType<typeof getFullAuditScan> extends Promise<infer R> ? R["summary"] : never) {
  console.log(`\n${line()}`);
  console.log(`  ${label}`);
  console.log(line());
  console.log(`  Total containers scanned     : ${summary.totalContainersScanned}`);
  console.log(`  Correct (no action needed)   : ${summary.containersCorrect}`);
  console.log(`  Container cost mismatches    : ${summary.containerCostMismatches}`);
  console.log(`  Active raw-stock mismatches  : ${summary.activeRawStockMismatches}`);
  console.log(`  Fully-used container issues  : ${summary.fullyUsedContainersWithMismatches}`);
  console.log(`  Missing raw-stock rows       : ${summary.missingRawStockContainers}`);
  console.log(`  Zero-cost sources            : ${summary.zeroCostSources}`);
  console.log(`  Non-zero source mismatches   : ${summary.nonZeroSourceCostMismatches}`);
  console.log(`  Unresolved FX (manual review): ${summary.unresolvedFxContainers}`);
  console.log(`  Safe repairs available       : ${summary.safeRepairsAvailable}`);
  console.log(line());
}

async function main() {
  console.log(`\n${"=".repeat(72)}`);
  console.log(`  RAW MATERIAL COST AUDIT${doRepair ? " + REPAIR" : ""}`);
  console.log(`  Company ID : ${companyId}`);
  console.log(`  Mode       : ${doRepair ? "AUDIT + APPLY SAFE REPAIRS" : "AUDIT ONLY (read-only)"}`);
  if (doRepair) {
    console.log(`  Include historical containers : ${includeHistorical}`);
    console.log(`  Include completed batches     : ${includeCompletedBatches}`);
  }
  console.log("=".repeat(72));

  // ── Phase 1: Initial audit ────────────────────────────────────────────────
  console.log("\n[1/4] Running full audit scan...");
  const initialAudit = await getFullAuditScan(companyId);
  printSummary("INITIAL AUDIT", initialAudit.summary);

  if (initialAudit.summary.safeRepairsAvailable === 0) {
    console.log("\n✅  No safe repairs needed — all containers are correct.");
    process.exit(0);
  }

  // ── Phase 2: Source cost mismatches ──────────────────────────────────────
  console.log("\n[2/4] Scanning mix-batch-source cost mismatches...");
  const sourceMismatches = await getMixBatchSourceCostMismatchPreview(companyId);
  const fixableSourceMismatches = sourceMismatches.filter((r) => r.fixable);
  console.log(`  Total source rows with mismatches : ${sourceMismatches.length}`);
  console.log(`  Fixable automatically             : ${fixableSourceMismatches.length}`);
  console.log(`  Manual review required            : ${sourceMismatches.length - fixableSourceMismatches.length}`);

  if (!doRepair) {
    console.log("\n  (Dry-run mode — pass --repair to apply fixes)\n");
    process.exit(0);
  }

  // ── Phase 3: Apply container-level cost repairs ───────────────────────────
  let safeRows = initialAudit.rows.filter((r) => r.safeToRepair);
  if (!includeHistorical) {
    safeRows = safeRows.filter((r) => !["CLOSED", "COMPLETED"].includes(r.containerStatus));
  }
  const safeContainerIds = safeRows.map((r) => r.containerId);

  if (safeContainerIds.length > 0) {
    console.log(`\n[3/4] Applying cost repairs for ${safeContainerIds.length} container(s)...`);
    const repairResults = await applyRawStockRecalc(companyId, safeContainerIds, {
      includeCompletedBatches,
      includeHistoricalContainers: includeHistorical,
    });

    const applied = repairResults.filter((r) => r.applied);
    const skipped = repairResults.filter((r) => !r.applied);
    console.log(`  Applied : ${applied.length}`);
    console.log(`  Skipped : ${skipped.length}`);
    for (const s of skipped) {
      console.log(`    SKIPPED ${s.containerNumber}: ${s.skippedReason}`);
    }
    const totalBatches = applied.reduce((s, r) => s + r.affectedBatches, 0);
    const totalBales = applied.reduce((s, r) => s + r.affectedBales, 0);
    console.log(`  Total mix batches updated : ${totalBatches}`);
    console.log(`  Total bales updated       : ${totalBales}`);
  } else {
    console.log("\n[3/4] No container repairs to apply (all excluded).");
  }

  // ── Phase 3b: Apply source-level repairs ──────────────────────────────────
  if (fixableSourceMismatches.length > 0) {
    console.log(`\n  Applying source-cost repairs for ${fixableSourceMismatches.length} source(s)...`);
    const sourceFixResults = await applyZeroCostMixBatchSourcesFix(
      companyId,
      fixableSourceMismatches.map((r) => r.sourceId)
    );
    const sourceApplied = sourceFixResults.filter((r) => r.applied);
    console.log(`  Source fixes applied : ${sourceApplied.length} / ${fixableSourceMismatches.length}`);
  }

  // ── Phase 4: Re-audit to verify ──────────────────────────────────────────
  console.log("\n[4/4] Re-running audit to verify...");
  const finalAudit = await getFullAuditScan(companyId);
  printSummary("FINAL AUDIT (after repairs)", finalAudit.summary);

  if (finalAudit.summary.safeRepairsAvailable === 0) {
    console.log("\n✅  VERIFIED: Zero safe mismatches remain. All auto-repairable issues are resolved.");
  } else {
    console.log(
      `\n⚠️  WARNING: ${finalAudit.summary.safeRepairsAvailable} safe mismatches still remain after repair.`
    );
    console.log("  This may indicate a bug in the repair logic. Review the remaining rows manually.");
    const remaining = finalAudit.rows.filter((r) => r.safeToRepair).slice(0, 10);
    for (const r of remaining) {
      console.log(`    ${r.containerNumber} (${r.containerStatus}) — codes: ${r.codes.join(", ")}`);
    }
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("\nFATAL ERROR:", err);
  process.exit(1);
});
