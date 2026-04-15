/**
 * Shared helper: compute the total raw-material stock value (in USD) for a
 * factory company.  Mirrors the aggregation logic in /api/factory/raw-stock
 * so that the net-position endpoint can include it without duplicating SQL.
 */

import { db } from "../db";
import {
  factoryRawStock,
  factoryContainers,
  factorySuppliers,
  factoryRawMaterialAdjustments,
} from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";

export async function calculateRawMaterialStockValue(companyId: number): Promise<number> {
  const results = await db
    .select({
      supplierId:    factoryContainers.supplierId,
      receivedKg:    factoryRawStock.receivedKg,
      usedKg:        factoryRawStock.usedKg,
      costPerKg:     factoryRawStock.costPerKg,
      costPerKgUsd:  factoryRawStock.costPerKgUsd,
      containerStatus: factoryContainers.status,
    })
    .from(factoryRawStock)
    .innerJoin(factoryContainers, eq(factoryRawStock.containerId, factoryContainers.id))
    .leftJoin(factorySuppliers, eq(factoryContainers.supplierId, factorySuppliers.id))
    .where(and(
      eq(factoryRawStock.companyId, companyId),
      sql`${factoryContainers.status} != 'DELETED'`,
    ));

  // Weighted-average per supplier (same formula as the raw-stock list endpoint)
  const supplierMap = new Map<string, {
    _totalReceived: number;
    _totalUsed:     number;
    _avgCostPerKgUsd: number;
  }>();

  for (const r of results) {
    const key      = r.supplierId != null ? `s-${r.supplierId}` : `c-unknown`;
    const received = parseFloat(String(r.receivedKg  || "0"));
    const used     = parseFloat(String(r.usedKg      || "0"));
    const cpkUsd   = parseFloat(String(r.costPerKgUsd || r.costPerKg || "0"));

    const existing = supplierMap.get(key);
    if (existing) {
      const prevCostUsd = existing._totalReceived * existing._avgCostPerKgUsd;
      existing._totalReceived += received;
      existing._totalUsed     += used;
      existing._avgCostPerKgUsd = existing._totalReceived > 0
        ? (prevCostUsd + received * cpkUsd) / existing._totalReceived
        : 0;
    } else {
      supplierMap.set(key, {
        _totalReceived:    received,
        _totalUsed:        used,
        _avgCostPerKgUsd:  cpkUsd,
      });
    }
  }

  // Apply manual adjustments
  const adjustments = await db
    .select()
    .from(factoryRawMaterialAdjustments)
    .where(eq(factoryRawMaterialAdjustments.companyId, companyId));

  for (const adj of adjustments) {
    const kg  = parseFloat(String(adj.kg  || "0"));
    const cpk = parseFloat(String(adj.costPerKg || "0"));
    const key = adj.supplierId != null ? `s-${adj.supplierId}` : `MANUAL__${adj.materialLabel || "Manual"}`;

    const existing = supplierMap.get(key);
    if (adj.type === "ADD") {
      if (existing) {
        const prevCost = existing._totalReceived * existing._avgCostPerKgUsd;
        existing._totalReceived   += kg;
        existing._avgCostPerKgUsd  = existing._totalReceived > 0
          ? (prevCost + kg * cpk) / existing._totalReceived
          : 0;
      } else {
        supplierMap.set(key, { _totalReceived: kg, _totalUsed: 0, _avgCostPerKgUsd: cpk });
      }
    } else {
      // DEDUCT — increases used kg
      if (existing) {
        existing._totalUsed += kg;
      } else {
        supplierMap.set(key, { _totalReceived: 0, _totalUsed: kg, _avgCostPerKgUsd: cpk });
      }
    }
  }

  let total = 0;
  for (const s of supplierMap.values()) {
    const remaining = s._totalReceived - s._totalUsed;
    if (remaining > 0) total += remaining * s._avgCostPerKgUsd;
  }

  return Math.round((total + Number.EPSILON) * 100) / 100;
}
