import { eq, and, isNull } from "drizzle-orm";
import { db } from "../../../db";
import {
  factoryContainers,
  factoryRawStock,
  factoryOffloadAdditionalCharges,
  factoryContainerCommissions,
  factoryContainerOtherCharges,
} from "@shared/schema";
import { RecalcFingerprintInputs } from "./cost-math";

export async function loadRecalcFingerprintInputs(
  companyId: number,
  containerId: number,
  dbOrTx: unknown = db
): Promise<RecalcFingerprintInputs | null> {
  const [container] = await dbOrTx
    .select()
    .from(factoryContainers)
    .where(and(eq(factoryContainers.id, containerId), eq(factoryContainers.companyId, companyId)));
  if (!container) return null;

  const [additionalCharges, commissionRecords, rawStockRows, otherChargesRows] = await Promise.all([
    dbOrTx
      .select()
      .from(factoryOffloadAdditionalCharges)
      .where(
        and(
          eq(factoryOffloadAdditionalCharges.containerId, containerId),
          eq(factoryOffloadAdditionalCharges.companyId, companyId)
        )
      ),
    dbOrTx
      .select()
      .from(factoryContainerCommissions)
      .where(
        and(
          eq(factoryContainerCommissions.containerId, containerId),
          eq(factoryContainerCommissions.companyId, companyId)
        )
      ),
    dbOrTx
      .select()
      .from(factoryRawStock)
      .where(
        and(
          eq(factoryRawStock.containerId, containerId),
          eq(factoryRawStock.companyId, companyId),
          isNull(factoryRawStock.deletedAt)
        )
      ),
    dbOrTx
      .select()
      .from(factoryContainerOtherCharges)
      .where(
        and(
          eq(factoryContainerOtherCharges.containerId, containerId),
          eq(factoryContainerOtherCharges.companyId, companyId)
        )
      ),
  ]);
  const commissionRecord = commissionRecords.sort((a: unknown, b: unknown) => b.id - a.id)[0] || null;

  return {
    container,
    additionalCharges,
    commissionRecord,
    rawStock: rawStockRows[0] || null,
    otherChargesRows,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// getRawStockRecalcPreview
// ─────────────────────────────────────────────────────────────────────────────
