export interface ContainerOffloadLifecycleScope {
  companyId: number;
  containerId: number;
}

export interface ContainerOffloadChargeInput {
  amount?: unknown;
  ledgerAccountId?: unknown;
}

export interface ContainerOffloadPolicyInput {
  duties?: unknown;
  dutiesAccountId?: unknown;
  officeCharges?: unknown;
  officeChargesAccountId?: unknown;
  officeChargesCashAccountId?: unknown;
  transportFees?: unknown;
  transportAccountId?: unknown;
  additionalCharges?: ContainerOffloadChargeInput[];
  agentChargeLines?: Array<{ amountUsd?: unknown; parentAgentAccountId?: unknown }>;
}

function positiveAmount(value: unknown): boolean {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0;
}

function positiveInteger(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function uniqueSorted(values: Array<number | null>): number[] {
  return [...new Set(values.filter((value): value is number => value !== null))].sort((left, right) => left - right);
}

export function buildContainerOffloadLifecycleScope(
  companyId: number,
  containerId: number
): ContainerOffloadLifecycleScope {
  return { companyId, containerId };
}

export function collectContainerOffloadLedgerIds(input: ContainerOffloadPolicyInput): number[] {
  const ids: Array<number | null> = [];

  if (positiveAmount(input.duties)) ids.push(positiveInteger(input.dutiesAccountId));
  if (positiveAmount(input.officeCharges)) {
    ids.push(positiveInteger(input.officeChargesAccountId));
    ids.push(positiveInteger(input.officeChargesCashAccountId));
  }
  if (positiveAmount(input.transportFees)) ids.push(positiveInteger(input.transportAccountId));

  for (const charge of input.additionalCharges ?? []) {
    if (positiveAmount(charge.amount)) ids.push(positiveInteger(charge.ledgerAccountId));
  }

  return uniqueSorted(ids);
}

export function collectContainerOffloadAdditionalChargeLedgerIds(input: ContainerOffloadPolicyInput): number[] {
  return uniqueSorted(
    (input.additionalCharges ?? [])
      .filter((charge) => positiveAmount(charge.amount))
      .map((charge) => positiveInteger(charge.ledgerAccountId))
  );
}

export function collectContainerOffloadParentAgentIds(input: ContainerOffloadPolicyInput): number[] {
  return uniqueSorted(
    (input.agentChargeLines ?? [])
      .filter((charge) => positiveAmount(charge.amountUsd))
      .map((charge) => positiveInteger(charge.parentAgentAccountId))
  );
}
