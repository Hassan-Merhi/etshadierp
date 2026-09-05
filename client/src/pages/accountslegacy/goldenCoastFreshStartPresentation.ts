import { useQuery } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";

const FRESH_START_SUBTYPE = "gc_partner_capital";

type BalanceSide = "Dr" | "Cr";

type NetPositionEquityAccount = {
  id?: number;
  name?: string;
  value?: number;
  balanceSide?: BalanceSide;
};

type NetPositionResponse = {
  equity?: {
    freshStartResidual?: number;
    freshStartClaim?: number;
    accounts?: NetPositionEquityAccount[];
  };
};

export type GoldenCoastFreshStartPresentation = {
  accountId: number;
  amount: number;
  balanceSide: BalanceSide;
  signedBalance: number;
};

type PresentableAccount = {
  accountId: number;
  subType?: string;
  balance: number | string;
  balanceSide?: string | null;
};

type StatementRow = {
  runningBalance: number;
};

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function resolveGoldenCoastFreshStartPresentation(
  data: NetPositionResponse | null | undefined,
  accountId: number
): GoldenCoastFreshStartPresentation | null {
  const equity = data?.equity;
  if (!equity) return null;

  const accounts = Array.isArray(equity.accounts) ? equity.accounts : [];
  const matchingAccount =
    accounts.find((account) => Number(account.id) === accountId) ??
    accounts.find((account) => /fresh\s*start/i.test(account.name || ""));

  const residual = finiteNumber(equity.freshStartResidual ?? equity.freshStartClaim);
  const accountAmount = finiteNumber(matchingAccount?.value);
  const sourceAmount = accountAmount ?? residual;
  if (sourceAmount == null) return null;

  const balanceSide: BalanceSide = matchingAccount?.balanceSide ?? (residual != null && residual < 0 ? "Dr" : "Cr");
  const amount = Math.abs(sourceAmount);

  return {
    accountId,
    amount,
    balanceSide,
    signedBalance: balanceSide === "Cr" ? -amount : amount,
  };
}

export function projectGoldenCoastFreshStartAccounts<T extends PresentableAccount>(
  accounts: T[],
  presentation: GoldenCoastFreshStartPresentation | null
): T[] {
  if (!presentation) return accounts;

  return accounts.map((account) => {
    if (account.subType !== FRESH_START_SUBTYPE || account.accountId !== presentation.accountId) return account;
    return {
      ...account,
      balance: presentation.amount,
      balanceSide: presentation.balanceSide,
    };
  });
}

export function projectGoldenCoastFreshStartStatement<T extends StatementRow>(input: {
  openingBalance: number;
  closingBalance: number;
  vouchersWithBalance: T[];
  presentation: GoldenCoastFreshStartPresentation | null;
}): { openingBalance: number; closingBalance: number; vouchersWithBalance: T[] } {
  const { openingBalance, closingBalance, vouchersWithBalance, presentation } = input;
  if (!presentation) return { openingBalance, closingBalance, vouchersWithBalance };

  // Net Position is the presentation source of truth for Golden Coast Fresh Start.
  // Keep every statement debit/credit movement unchanged and shift only the
  // presentation baseline so the final running balance lands on that exact value.
  const presentationOffset = presentation.signedBalance - closingBalance;

  return {
    openingBalance: openingBalance + presentationOffset,
    closingBalance: presentation.signedBalance,
    vouchersWithBalance: vouchersWithBalance.map((row) => ({
      ...row,
      runningBalance: row.runningBalance + presentationOffset,
    })),
  };
}

export function useGoldenCoastFreshStartPresentation(input: {
  accountId?: number | null;
  subType?: string | null;
  toDate?: string | null;
}): GoldenCoastFreshStartPresentation | null {
  const { selectedCompany } = useCompany();
  const accountId = input.accountId ?? null;
  const isGoldenCoastFreshStart =
    selectedCompany?.companyType === "supplier_partner" && input.subType === FRESH_START_SUBTYPE && accountId != null;

  const { data } = useQuery<NetPositionResponse>({
    queryKey: [
      "/api/stats/net-profit",
      "accounts-fresh-start-presentation",
      selectedCompany?.id ?? null,
      input.toDate || null,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (input.toDate) params.set("toDate", input.toDate);
      const suffix = params.toString() ? `?${params.toString()}` : "";
      const response = await fetch(`/api/stats/net-profit${suffix}`, { credentials: "include" });
      if (!response.ok) throw new Error(`Failed to load Net Position (${response.status})`);
      return response.json();
    },
    enabled: isGoldenCoastFreshStart,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  if (!isGoldenCoastFreshStart || accountId == null) return null;
  return resolveGoldenCoastFreshStartPresentation(data, accountId);
}
