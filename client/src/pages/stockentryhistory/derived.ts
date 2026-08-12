import type { GroupRow } from "./types";

export interface StockEntryWorker {
  id: number;
  active: boolean;
  fullName?: string;
  full_name?: string;
}

export interface WorkerCategory {
  id: number;
  workerIds?: number[];
}

export interface WorkerTarget {
  targetBales: number;
  workerCount: number;
}

export interface WorkerCondensed {
  workerKey: string;
  workerId: number | null;
  workerName: string | null;
  totalBales: number;
  totalWeight: number;
  groups: GroupRow[];
}

interface DeriveStockEntryHistoryInput {
  groups: GroupRow[];
  workers: StockEntryWorker[];
  categories: WorkerCategory[];
  categoryFilter: string[];
  workerIdFilter: string[];
  workerTargets: Record<number, WorkerTarget>;
}

export function deriveStockEntryHistory({
  groups,
  workers,
  categories,
  categoryFilter,
  workerIdFilter,
  workerTargets,
}: DeriveStockEntryHistoryInput) {
  let selectedCategoryWorkerIds: number[] | null = null;
  if (categoryFilter.length > 0) {
    const selectedCategoryIds = new Set(categoryFilter);
    const ids = new Set<number>();
    for (const category of categories) {
      if (!selectedCategoryIds.has(String(category.id))) continue;
      for (const id of Array.isArray(category.workerIds) ? category.workerIds : []) {
        ids.add(Number(id));
      }
    }
    selectedCategoryWorkerIds = workers
      .filter((worker) => worker.active && ids.has(worker.id))
      .map((worker) => worker.id);
  }

  const filteredWorkers = selectedCategoryWorkerIds
    ? workers.filter((worker) => selectedCategoryWorkerIds!.includes(worker.id))
    : workers;

  // All active filters are applied by the API. Keep the returned groups unchanged so
  // the rendered table, KPI totals, exports and lazy detail requests share one dataset.
  const filteredGroups = groups;

  const totalBales = filteredGroups.reduce((sum, group) => sum + group.baleCount, 0);
  const totalWeight = filteredGroups.reduce((sum, group) => sum + parseFloat(group.totalWeight || "0"), 0);

  const workerMap = new Map<string, WorkerCondensed>();
  for (const group of filteredGroups) {
    const key = group.workerId != null ? String(group.workerId) : "unassigned";
    if (!workerMap.has(key)) {
      workerMap.set(key, {
        workerKey: key,
        workerId: group.workerId,
        workerName: group.workerName,
        totalBales: 0,
        totalWeight: 0,
        groups: [],
      });
    }
    const workerGroup = workerMap.get(key)!;
    workerGroup.totalBales += group.baleCount;
    workerGroup.totalWeight += parseFloat(group.totalWeight || "0");
    workerGroup.groups.push(group);
  }

  if (Object.keys(workerTargets).length > 0) {
    const workerNameById = new Map<number, string>(
      workers.map((worker) => [worker.id, worker.fullName ?? worker.full_name ?? ""])
    );
    const selectedWorkerIds = new Set(workerIdFilter.map(Number));
    const categoryWorkerIds = selectedCategoryWorkerIds ? new Set(selectedCategoryWorkerIds) : null;

    for (const workerIdString of Object.keys(workerTargets)) {
      const workerId = Number(workerIdString);
      if (selectedWorkerIds.size > 0 && !selectedWorkerIds.has(workerId)) continue;
      if (categoryWorkerIds && !categoryWorkerIds.has(workerId)) continue;

      const key = String(workerId);
      if (!workerMap.has(key)) {
        workerMap.set(key, {
          workerKey: key,
          workerId,
          workerName: workerNameById.get(workerId) ?? null,
          totalBales: 0,
          totalWeight: 0,
          groups: [],
        });
      }
    }
  }

  const workerGroups = Array.from(workerMap.values()).sort((left, right) => right.totalBales - left.totalBales);
  const allBales = filteredGroups.flatMap((group) => group.bales);

  return {
    selectedCategoryWorkerIds,
    filteredWorkers,
    filteredGroups,
    totalBales,
    totalWeight,
    workerGroups,
    allBales,
  };
}
