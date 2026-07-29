import { and, eq, isNull, sql } from "drizzle-orm";
import {
  factoryBales,
  factoryMixBatches,
  factoryMixBatchSources,
} from "@shared/schema";
import { db } from "../../db";
import {
  calculateCostLine,
  calculateWeightedAverageCost,
  factoryRatesEqual,
  formatFactoryTotal,
} from "./factoryCostingEngine";

export interface FactoryCostingBatchMismatch {
  batchId: number;
  batchCode: string;
  status: string;
  sourceCount: number;
  sourceMismatchCount: number;
  storedCostPerKg: string;
  expectedCostPerKg: string;
  storedTotalCost: string;
  expectedTotalCost: string;
  calculationError?: string;
}

export interface FactoryCostingBaleMismatch {
  baleId: number;
  baleCode: string | null;
  batchId: number;
  storedCostPerKg: string;
  expectedCostPerKg: string;
  storedTotalCost: string;
  expectedTotalCost: string;
}

export interface FactoryCostingConsistencyReport {
  companyId: number;
  generatedAt: string;
  summary: {
    batchCount: number;
    sourceCount: number;
    baleCount: number;
    sourceValueMismatchCount: number;
    batchHeaderMismatchCount: number;
    baleMismatchCount: number;
    calculationErrorCount: number;
  };
  batchMismatches: FactoryCostingBatchMismatch[];
  baleMismatches: FactoryCostingBaleMismatch[];
}

function totalsEqual(left: unknown, right: unknown): boolean {
  return formatFactoryTotal(left as any) === formatFactoryTotal(right as any);
}

/**
 * Read-only reconciliation of the persisted factory costing chain:
 * source values -> batch header -> bales. No write or lazy backfill is allowed.
 */
export async function getFactoryCostingConsistencyReport(
  companyId: number,
): Promise<FactoryCostingConsistencyReport> {
  const [batches, sourceRows, baleRows] = await Promise.all([
    db
      .select({
        id: factoryMixBatches.id,
        batchCode: factoryMixBatches.batchCode,
        status: factoryMixBatches.status,
        costPerKg: factoryMixBatches.costPerKg,
        totalCost: factoryMixBatches.totalCost,
      })
      .from(factoryMixBatches)
      .where(and(eq(factoryMixBatches.companyId, companyId), isNull(factoryMixBatches.deletedAt))),
    db
      .select({
        batchId: factoryMixBatchSources.mixBatchId,
        sourceId: factoryMixBatchSources.id,
        weightKg: factoryMixBatchSources.weightKg,
        costPerKg: factoryMixBatchSources.costPerKg,
        totalCost: factoryMixBatchSources.totalCost,
      })
      .from(factoryMixBatchSources)
      .innerJoin(factoryMixBatches, eq(factoryMixBatchSources.mixBatchId, factoryMixBatches.id))
      .where(and(eq(factoryMixBatches.companyId, companyId), isNull(factoryMixBatches.deletedAt))),
    db
      .select({
        id: factoryBales.id,
        baleCode: factoryBales.baleCode,
        batchId: factoryBales.mixBatchId,
        weightKg: factoryBales.weightKg,
        costPerKg: factoryBales.costPerKg,
        totalCost: factoryBales.totalCost,
        batchCostPerKg: factoryMixBatches.costPerKg,
      })
      .from(factoryBales)
      .innerJoin(factoryMixBatches, eq(factoryBales.mixBatchId, factoryMixBatches.id))
      .where(
        and(
          eq(factoryMixBatches.companyId, companyId),
          isNull(factoryMixBatches.deletedAt),
          sql`${factoryBales.status} NOT IN ('DELETED', 'REMOVED')`,
        ),
      ),
  ]);

  const sourcesByBatch = new Map<number, typeof sourceRows>();
  for (const source of sourceRows) {
    const current = sourcesByBatch.get(source.batchId) ?? [];
    current.push(source);
    sourcesByBatch.set(source.batchId, current);
  }

  const batchMismatches: FactoryCostingBatchMismatch[] = [];
  let sourceValueMismatchCount = 0;
  let calculationErrorCount = 0;

  for (const batch of batches) {
    const sources = sourcesByBatch.get(batch.id) ?? [];
    try {
      const aggregate = calculateWeightedAverageCost(
        sources.map((source) => ({
          quantityKg: source.weightKg,
          unitCostPerKg: source.costPerKg,
          totalCost: source.totalCost,
        })),
      );
      sourceValueMismatchCount += aggregate.sourceMismatchCount;

      const rateMismatch = !factoryRatesEqual(batch.costPerKg, aggregate.weightedUnitCostPerKg);
      const totalMismatch = !totalsEqual(batch.totalCost, aggregate.totalCost);
      if (rateMismatch || totalMismatch || aggregate.sourceMismatchCount > 0) {
        batchMismatches.push({
          batchId: batch.id,
          batchCode: batch.batchCode || `#${batch.id}`,
          status: batch.status,
          sourceCount: sources.length,
          sourceMismatchCount: aggregate.sourceMismatchCount,
          storedCostPerKg: String(batch.costPerKg || "0"),
          expectedCostPerKg: aggregate.weightedUnitCostPerKg.toFixed(),
          storedTotalCost: String(batch.totalCost || "0"),
          expectedTotalCost: aggregate.totalCost.toFixed(),
        });
      }
    } catch (error: unknown) {
      calculationErrorCount += 1;
      batchMismatches.push({
        batchId: batch.id,
        batchCode: batch.batchCode || `#${batch.id}`,
        status: batch.status,
        sourceCount: sources.length,
        sourceMismatchCount: 0,
        storedCostPerKg: String(batch.costPerKg || "0"),
        expectedCostPerKg: "0",
        storedTotalCost: String(batch.totalCost || "0"),
        expectedTotalCost: "0",
        calculationError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const baleMismatches: FactoryCostingBaleMismatch[] = [];
  for (const bale of baleRows) {
    const expectedTotal = calculateCostLine(bale.weightKg, bale.batchCostPerKg).totalCost;
    const rateMismatch = !factoryRatesEqual(bale.costPerKg, bale.batchCostPerKg);
    const totalMismatch = !totalsEqual(bale.totalCost, expectedTotal);
    if (rateMismatch || totalMismatch) {
      baleMismatches.push({
        baleId: bale.id,
        baleCode: bale.baleCode,
        batchId: Number(bale.batchId),
        storedCostPerKg: String(bale.costPerKg || "0"),
        expectedCostPerKg: String(bale.batchCostPerKg || "0"),
        storedTotalCost: String(bale.totalCost || "0"),
        expectedTotalCost: expectedTotal.toFixed(),
      });
    }
  }

  return {
    companyId,
    generatedAt: new Date().toISOString(),
    summary: {
      batchCount: batches.length,
      sourceCount: sourceRows.length,
      baleCount: baleRows.length,
      sourceValueMismatchCount,
      batchHeaderMismatchCount: batchMismatches.length,
      baleMismatchCount: baleMismatches.length,
      calculationErrorCount,
    },
    batchMismatches,
    baleMismatches,
  };
}
