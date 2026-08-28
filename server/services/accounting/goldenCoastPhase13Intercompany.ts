export type GoldenCoastPhase13IntercompanyRole = "golden_coast_hadi" | "hadi_golden_coast";

export interface GoldenCoastPhase13IntercompanyDefinition {
  role: GoldenCoastPhase13IntercompanyRole;
  subType: "sp_hadi_intercompany" | "hadi_sp_intercompany";
  code: string;
  name: string;
  accountType: "Intercompany";
  isHidden: false;
}

export interface GoldenCoastPhase13LedgerRow {
  id: number;
  companyId: number;
  code: string;
  name: string;
  accountType: string;
  subType: string | null;
  isHidden: boolean;
  active: boolean;
  deletedAt: Date | string | null;
}

export interface GoldenCoastPhase13IntercompanyRepair {
  field: "accountType" | "subType" | "isHidden" | "active" | "deletedAt";
  from: unknown;
  to: unknown;
}

export interface GoldenCoastPhase13IntercompanyPlan {
  definition: GoldenCoastPhase13IntercompanyDefinition;
  action: "create" | "repair" | "none";
  accountId: number | null;
  repairs: GoldenCoastPhase13IntercompanyRepair[];
}

export interface GoldenCoastPhase13IntercompanyStatus {
  role: GoldenCoastPhase13IntercompanyRole;
  companyId: number;
  subType: string;
  expectedName: string;
  status: "ok" | "missing" | "needs_repair" | "ambiguous";
  accountId: number | null;
  name: string | null;
  accountType: string | null;
  issues: string[];
}

export class GoldenCoastPhase13IntercompanyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoldenCoastPhase13IntercompanyError";
  }
}

function positiveId(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new GoldenCoastPhase13IntercompanyError(`${field} must be a positive integer`);
  }
  return value;
}

function cleanName(value: string, field: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new GoldenCoastPhase13IntercompanyError(`${field} is required`);
  return text;
}

export function goldenCoastPhase13IntercompanyDefinitions(input: {
  goldenCoastCompanyName: string;
  hadiCompanyName: string;
}): Record<GoldenCoastPhase13IntercompanyRole, GoldenCoastPhase13IntercompanyDefinition> {
  const goldenCoastCompanyName = cleanName(input.goldenCoastCompanyName, "goldenCoastCompanyName");
  const hadiCompanyName = cleanName(input.hadiCompanyName, "hadiCompanyName");
  return {
    golden_coast_hadi: {
      role: "golden_coast_hadi",
      subType: "sp_hadi_intercompany",
      code: "SP-HADI-IC",
      name: `${hadiCompanyName} — Intercompany`,
      accountType: "Intercompany",
      isHidden: false,
    },
    hadi_golden_coast: {
      role: "hadi_golden_coast",
      subType: "hadi_sp_intercompany",
      code: "SP-IC",
      name: `${goldenCoastCompanyName} — Intercompany`,
      accountType: "Intercompany",
      isHidden: false,
    },
  };
}

function assertScoped(companyId: number, rows: readonly GoldenCoastPhase13LedgerRow[]): void {
  const foreign = rows.find((row) => Number(row.companyId) !== companyId);
  if (foreign) {
    throw new GoldenCoastPhase13IntercompanyError(
      `Intercompany account ${foreign.id} belongs to company ${foreign.companyId}, not company ${companyId}`
    );
  }
}

function byId(a: GoldenCoastPhase13LedgerRow, b: GoldenCoastPhase13LedgerRow): number {
  return a.id - b.id;
}

function isLive(row: GoldenCoastPhase13LedgerRow): boolean {
  return row.active === true && row.deletedAt == null;
}

/**
 * Plans one side of the Golden Coast ↔ HADI pair. Canonical subtype is the
 * identity. A missing row is created; an inactive/deleted/wrong-type row is
 * repaired in place so historical voucher links keep the same account id.
 * Multiple live rows are never guessed between and must be repaired manually.
 */
export function planGoldenCoastPhase13IntercompanyAccount(input: {
  companyId: number;
  definition: GoldenCoastPhase13IntercompanyDefinition;
  accounts: readonly GoldenCoastPhase13LedgerRow[];
}): GoldenCoastPhase13IntercompanyPlan {
  const companyId = positiveId(input.companyId, "companyId");
  const accounts = input.accounts ?? [];
  assertScoped(companyId, accounts);
  const matches = accounts.filter((row) => row.subType === input.definition.subType).sort(byId);
  const live = matches.filter(isLive);
  if (live.length > 1) {
    throw new GoldenCoastPhase13IntercompanyError(
      `Company ${companyId} has ${live.length} active ${input.definition.subType} accounts; repair duplicates before Golden Coast setup`
    );
  }

  const selected = live[0] ?? matches[0] ?? null;
  if (!selected) {
    return { definition: input.definition, action: "create", accountId: null, repairs: [] };
  }

  const repairs: GoldenCoastPhase13IntercompanyRepair[] = [];
  if (selected.accountType !== "Intercompany") {
    repairs.push({ field: "accountType", from: selected.accountType, to: "Intercompany" });
  }
  if (selected.subType !== input.definition.subType) {
    repairs.push({ field: "subType", from: selected.subType, to: input.definition.subType });
  }
  if (selected.isHidden) repairs.push({ field: "isHidden", from: true, to: false });
  if (!selected.active) repairs.push({ field: "active", from: false, to: true });
  if (selected.deletedAt != null) repairs.push({ field: "deletedAt", from: selected.deletedAt, to: null });

  return {
    definition: input.definition,
    action: repairs.length > 0 ? "repair" : "none",
    accountId: selected.id,
    repairs,
  };
}

export function summarizeGoldenCoastPhase13IntercompanyAccount(input: {
  companyId: number;
  definition: GoldenCoastPhase13IntercompanyDefinition;
  accounts: readonly GoldenCoastPhase13LedgerRow[];
}): GoldenCoastPhase13IntercompanyStatus {
  const companyId = positiveId(input.companyId, "companyId");
  assertScoped(companyId, input.accounts ?? []);
  const matches = (input.accounts ?? [])
    .filter((row) => row.subType === input.definition.subType)
    .sort(byId);
  const live = matches.filter(isLive);
  if (live.length > 1) {
    return {
      role: input.definition.role,
      companyId,
      subType: input.definition.subType,
      expectedName: input.definition.name,
      status: "ambiguous",
      accountId: null,
      name: null,
      accountType: null,
      issues: [`${live.length} active accounts share ${input.definition.subType}`],
    };
  }

  const selected = live[0] ?? matches[0] ?? null;
  if (!selected) {
    return {
      role: input.definition.role,
      companyId,
      subType: input.definition.subType,
      expectedName: input.definition.name,
      status: "missing",
      accountId: null,
      name: null,
      accountType: null,
      issues: ["Required intercompany account is missing"],
    };
  }

  const plan = planGoldenCoastPhase13IntercompanyAccount({ companyId, definition: input.definition, accounts: input.accounts });
  return {
    role: input.definition.role,
    companyId,
    subType: input.definition.subType,
    expectedName: input.definition.name,
    status: plan.repairs.length > 0 ? "needs_repair" : "ok",
    accountId: selected.id,
    name: selected.name,
    accountType: selected.accountType,
    issues: plan.repairs.map((repair) => `${repair.field} must be ${String(repair.to)}`),
  };
}
