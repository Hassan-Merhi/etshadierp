export interface ProductionBonusMemberSnapshot {
  workerId: number;
  workerName: string;
}

export interface ProductionBonusAllocationPreview extends ProductionBonusMemberSnapshot {
  amount: number;
}

export interface ProductionBonusPreview {
  extraBales: number;
  bonusPool: number;
  allocations: ProductionBonusAllocationPreview[];
  perWorkerMin: number;
  perWorkerMax: number;
  distributable: boolean;
}

function moneyFromCents(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

/**
 * Calculate a deterministic, cents-safe production bonus preview.
 *
 * A target of 0 means "no target" and therefore cannot generate an extra-bale
 * bonus. Otherwise the pool is rounded to cents once, then divided using integer
 * cents in stable workerId order. Remainder cents go to the highest worker IDs,
 * producing splits such as 3.33, 3.33, 3.34 while keeping the total exact.
 */
export function calculateProductionBonusPreview(input: {
  targetBales: number;
  actualBales: number;
  bonusPerExtraBale: number;
  bonusEnabled: boolean;
  members: ProductionBonusMemberSnapshot[];
}): ProductionBonusPreview {
  const targetBales = Math.max(0, Math.trunc(Number(input.targetBales) || 0));
  const actualBales = Math.max(0, Math.trunc(Number(input.actualBales) || 0));
  const rate = Math.max(0, Number(input.bonusPerExtraBale) || 0);
  const extraBales = targetBales > 0 ? Math.max(actualBales - targetBales, 0) : 0;
  const poolCents = input.bonusEnabled ? Math.max(0, Math.round(extraBales * rate * 100 + Number.EPSILON)) : 0;
  const bonusPool = moneyFromCents(poolCents);

  const members = [...input.members]
    .filter((member) => Number.isInteger(member.workerId) && member.workerId > 0)
    .sort((a, b) => a.workerId - b.workerId);

  if (poolCents === 0 || members.length === 0) {
    return {
      extraBales,
      bonusPool,
      allocations: members.map((member) => ({ ...member, amount: 0 })),
      perWorkerMin: 0,
      perWorkerMax: 0,
      distributable: poolCents === 0 || members.length > 0,
    };
  }

  const baseCents = Math.floor(poolCents / members.length);
  const remainder = poolCents % members.length;
  const remainderStart = members.length - remainder;
  const allocations = members.map((member, index) => ({
    ...member,
    amount: moneyFromCents(baseCents + (remainder > 0 && index >= remainderStart ? 1 : 0)),
  }));

  const amounts = allocations.map((allocation) => allocation.amount);
  return {
    extraBales,
    bonusPool,
    allocations,
    perWorkerMin: Math.min(...amounts),
    perWorkerMax: Math.max(...amounts),
    distributable: true,
  };
}
