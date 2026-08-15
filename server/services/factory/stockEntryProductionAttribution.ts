import { and, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import { factoryProductionPositionMemberships, factoryProductionPositions, factoryWorkers } from "@shared/schema";

export interface StockEntryProductionAttributionInput {
  productId?: number | null;
  finalizedBy?: number | string | null;
  productionPositionId?: number | string | null;
}

export interface ResolvedStockEntryProductionAttribution {
  workerId: number | null;
  workerName: string | null;
  productionPositionId: number | null;
  productionPositionName: string | null;
}

interface EligiblePosition {
  id: number;
  name: string;
}

/**
 * Resolve and validate worker → production-position attribution for Stock Entry.
 *
 * Rules:
 * - no worker: no production position is allowed;
 * - one valid position on the entry date: auto-resolve when omitted;
 * - multiple valid positions: the client must choose one;
 * - zero valid positions: bale remains valid but bonus-ineligible;
 * - cross-company/inactive workers and invalid position memberships are rejected.
 *
 * Position eligibility is driven by the effective-dated membership interval,
 * not the position's current `active` flag. That is intentional: a position
 * archived today can still be the correct historical attribution for a
 * backdated Stock Entry from before its membership interval ended.
 */
export async function resolveStockEntryProductionAttributions(
  tx: unknown,
  companyId: number,
  stockEntryDate: string,
  items: StockEntryProductionAttributionInput[]
): Promise<ResolvedStockEntryProductionAttribution[]> {
  const workerIds = [
    ...new Set(
      items
        .map((item) => (item.finalizedBy == null || item.finalizedBy === "" ? null : Number(item.finalizedBy)))
        .filter((id): id is number => id != null && Number.isInteger(id) && id > 0)
    ),
  ];

  if (workerIds.length === 0) {
    for (const item of items) {
      if (item.productionPositionId != null && item.productionPositionId !== "") {
        throw new Error("A production position cannot be assigned without a worker");
      }
    }
    return items.map(() => ({
      workerId: null,
      workerName: null,
      productionPositionId: null,
      productionPositionName: null,
    }));
  }

  const workers = await tx
    .select({
      id: factoryWorkers.id,
      fullName: factoryWorkers.fullName,
    })
    .from(factoryWorkers)
    .where(
      and(
        eq(factoryWorkers.companyId, companyId),
        eq(factoryWorkers.active, true),
        inArray(factoryWorkers.id, workerIds)
      )
    );

  const workerById = new Map<number, { id: number; fullName: string }>(
    workers.map((worker: unknown) => [worker.id, worker])
  );
  if (workerById.size !== workerIds.length) {
    throw new Error("One or more selected workers are inactive or belong to another company");
  }

  const memberships = await tx
    .select({
      workerId: factoryProductionPositionMemberships.workerId,
      positionId: factoryProductionPositions.id,
      positionName: factoryProductionPositions.name,
    })
    .from(factoryProductionPositionMemberships)
    .innerJoin(
      factoryProductionPositions,
      eq(factoryProductionPositions.id, factoryProductionPositionMemberships.positionId)
    )
    .where(
      and(
        eq(factoryProductionPositionMemberships.companyId, companyId),
        eq(factoryProductionPositions.companyId, companyId),
        inArray(factoryProductionPositionMemberships.workerId, workerIds),
        lte(factoryProductionPositionMemberships.effectiveFrom, stockEntryDate),
        or(
          isNull(factoryProductionPositionMemberships.effectiveTo),
          gt(factoryProductionPositionMemberships.effectiveTo, stockEntryDate)
        )
      )
    );

  const positionsByWorker = new Map<number, EligiblePosition[]>();
  for (const membership of memberships) {
    const current = positionsByWorker.get(membership.workerId) ?? [];
    if (!current.some((position) => position.id === membership.positionId)) {
      current.push({ id: membership.positionId, name: membership.positionName });
      positionsByWorker.set(membership.workerId, current);
    }
  }

  return items.map((item) => {
    if (item.finalizedBy == null || item.finalizedBy === "") {
      if (item.productionPositionId != null && item.productionPositionId !== "") {
        throw new Error("A production position cannot be assigned without a worker");
      }
      return {
        workerId: null,
        workerName: null,
        productionPositionId: null,
        productionPositionName: null,
      };
    }

    const workerId = Number(item.finalizedBy);
    if (!Number.isInteger(workerId) || workerId <= 0) throw new Error("Invalid worker selection");
    const worker = workerById.get(workerId);
    if (!worker) throw new Error("Selected worker is inactive or belongs to another company");

    const eligible = positionsByWorker.get(workerId) ?? [];
    const requestedPositionId =
      item.productionPositionId == null || item.productionPositionId === "" ? null : Number(item.productionPositionId);

    if (requestedPositionId != null && (!Number.isInteger(requestedPositionId) || requestedPositionId <= 0)) {
      throw new Error(`Invalid production position selected for ${worker.fullName}`);
    }

    let selected: EligiblePosition | null = null;
    if (requestedPositionId != null) {
      selected = eligible.find((position) => position.id === requestedPositionId) ?? null;
      if (!selected) {
        throw new Error(`${worker.fullName} is not assigned to the selected production position on ${stockEntryDate}`);
      }
    } else if (eligible.length === 1) {
      selected = eligible[0];
    } else if (eligible.length > 1) {
      throw new Error(
        `${worker.fullName} belongs to multiple production positions on ${stockEntryDate}. Select a Production Position before saving Stock Entry.`
      );
    }

    return {
      workerId,
      workerName: worker.fullName,
      productionPositionId: selected?.id ?? null,
      productionPositionName: selected?.name ?? null,
    };
  });
}
