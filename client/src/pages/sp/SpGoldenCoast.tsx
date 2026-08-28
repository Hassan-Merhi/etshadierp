import type { ClientErrorLike } from "@/lib/clientError";
import { releaseDebtEnglish } from "@/i18n/finalCloseoutTranslations";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRightLeft,
  Banknote,
  CalendarCheck2,
  CheckCircle2,
  CircleDollarSign,
  Loader2,
  RefreshCw,
  ShoppingCart,
  WalletCards,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCompany } from "@/contexts/CompanyContext";
import { useToast } from "@/hooks/use-toast";
import { useHubQueryState } from "@/hooks/use-hub-query-state";
import { apiRequest } from "@/lib/queryClient";

const PHASE7_READINESS = "/api/sp/golden-coast/phase7/sales-cash-transfer/readiness";
const PHASE7_TRANSFER = "/api/sp/golden-coast/phase7/sales-cash-transfer";
const PHASE9_READINESS = "/api/sp/golden-coast/phase9/hassan-savings-withdrawal/readiness";
const PHASE9_WITHDRAWAL = "/api/sp/golden-coast/phase9/hassan-savings-withdrawal";
const PHASE10_READINESS = "/api/sp/golden-coast/phase10/sales-cash-settlement/readiness";
const PHASE10_SETTLEMENT = "/api/sp/golden-coast/phase10/sales-cash-settlement";
const PHASE11_READINESS = "/api/sp/golden-coast/phase11/profit-splits/monthly-close/readiness";
const PHASE11_CLOSE = "/api/sp/golden-coast/phase11/profit-splits/monthly-close";
const HASSAN_SAVINGS_CONFIRMATION = "WITHDRAW HASSAN SAVINGS";
const MONTHLY_CLOSE_CONFIRMATION = "FINALIZE SP PROFIT SPLIT";

const GOLDEN_COAST_TABS = ["overview", "hadi", "savings", "sales-cash", "monthly-close"] as const;
type GoldenCoastTab = (typeof GOLDEN_COAST_TABS)[number];
type CashAccountKind = "ledger" | "bank";
type Phase7Operation = "collect_via_hadi" | "remit_from_hadi";

interface CashAccountOption {
  kind: CashAccountKind;
  id: number;
  name: string;
  type?: string;
}

interface Phase7Readiness {
  pair: {
    goldenCoastCompanyId: number;
    goldenCoastCompanyName: string;
    hadiCompanyId: number;
    hadiCompanyName: string;
  } | null;
  accounts: {
    gcSalesCashAccountId: number;
    gcSalesCashAccountName: string;
    goldenCoastHadiIntercompanyAccountId: number;
    goldenCoastHadiIntercompanyAccountName: string;
    hadiGoldenCoastIntercompanyAccountId: number;
    hadiGoldenCoastIntercompanyAccountName: string;
  } | null;
  balances: {
    gcSalesCashDebitBalanceUsd: string;
    outstandingHadiCollectionsUsd: string;
  } | null;
  hadiCashAccounts: CashAccountOption[];
  goldenCoastCashAccounts: CashAccountOption[];
  blockers: string[];
  canTransfer: boolean;
}

interface Phase9Readiness {
  ready: boolean;
  companyId: number;
  hassanSavingsAccount: { id: number; name?: string };
  availableSavingsUsd: string;
  paymentAccounts: CashAccountOption[];
  sourceType: string;
}

interface Phase10Readiness {
  ready: boolean;
  companyId: number;
  gcSalesCashAccount: { id: number; name?: string };
  collectibleSalesCashUsd: string;
  rawSalesCashDebitBalanceUsd: string;
  receiptAccounts: CashAccountOption[];
  sourceType: string;
}

interface Phase11Plan {
  periodMonth: string;
  periodStart: string;
  periodEnd: string;
  totalRevenueUsd: string;
  totalCogsUsd: string;
  totalSharedChargesUsd: string;
  netProfitLossUsd: string;
  freshStartShareUsd: string;
  hassanShareUsd: string;
}

interface Phase11Readiness {
  ready: boolean;
  alreadyClosed: boolean;
  plan?: Phase11Plan;
  splitPct?: string;
  profitPendingDistributionBalanceUsd?: string;
  split?: {
    periodMonth?: string;
    ourShare?: string;
    supplierShare?: string;
    finalizedAt?: string;
  };
}

interface MutationResult {
  replayed?: boolean;
  voucher?: { id?: number; voucherNumber?: string };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function previousCompletedMonth(): string {
  const date = new Date();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
}

function makeRequestId(prefix: string): string {
  const randomPart =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "")
      : Math.random().toString(16).slice(2);
  return `${prefix}:${Date.now()}:${randomPart}`.slice(0, 64);
}

function money(value: unknown): string {
  const amount = Number(value ?? 0);
  const normalized = Number.isFinite(amount) ? amount : 0;
  return `$${normalized.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return releaseDebtEnglish("The request failed. Refresh readiness and try again.");
}

function accountKey(account: Pick<CashAccountOption, "kind" | "id">): string {
  return `${account.kind}:${account.id}`;
}

function selectedAccount(value: string, accounts: CashAccountOption[]): { kind: CashAccountKind; id: number } | null {
  const fallback = accounts[0];
  const match = accounts.find((account) => accountKey(account) === value) ?? fallback;
  return match ? { kind: match.kind, id: match.id } : null;
}

function allowedAmount(value: string, maximum: unknown): boolean {
  const amount = Number(value);
  const cap = Number(maximum);
  return Number.isFinite(amount) && amount > 0 && Number.isFinite(cap) && cap >= amount;
}

async function readJson<T>(url: string): Promise<T> {
  const response = await apiRequest("GET", url);
  return (await response.json()) as T;
}

function AccountPicker({
  id,
  value,
  accounts,
  onChange,
}: {
  id: string;
  value: string;
  accounts: CashAccountOption[];
  onChange: (value: string) => void;
}) {
  const effectiveValue = value || (accounts[0] ? accountKey(accounts[0]) : "");
  return (
    <select
      id={id}
      value={effectiveValue}
      onChange={(event) => onChange(event.target.value)}
      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
      data-testid={id}
    >
      {accounts.length === 0 ? (
        <option value="">{releaseDebtEnglish("No active cash or bank accounts")}</option>
      ) : (
        accounts.map((account) => (
          <option key={accountKey(account)} value={accountKey(account)}>
            {account.name} · {account.type ?? account.kind}
          </option>
        ))
      )}
    </select>
  );
}

function ReadinessState({
  loading,
  error,
  ready,
  readyText,
  blockedText,
}: {
  loading: boolean;
  error: unknown;
  ready: boolean;
  readyText: string;
  blockedText: string;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {releaseDebtEnglish("Checking live readiness…")}
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <span>{errorMessage(error)}</span>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 rounded-md border p-3 text-sm">
      {ready ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
      ) : (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      )}
      <span>{ready ? readyText : blockedText}</span>
    </div>
  );
}

export default function SpGoldenCoast() {
  const { selectedCompany } = useCompany();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useHubQueryState<GoldenCoastTab>({
    key: "tab",
    allowedValues: GOLDEN_COAST_TABS,
    defaultValue: "overview",
    omitDefault: true,
  });
  const isSupplierPartner = selectedCompany?.companyType === "supplier_partner";
  const companyKey = selectedCompany?.id ?? "no-company";

  const [phase7Operation, setPhase7Operation] = useState<Phase7Operation>("collect_via_hadi");
  const [phase7Date, setPhase7Date] = useState(todayIso);
  const [phase7Amount, setPhase7Amount] = useState("");
  const [phase7HadiAccount, setPhase7HadiAccount] = useState("");
  const [phase7GcAccount, setPhase7GcAccount] = useState("");
  const [phase7Reference, setPhase7Reference] = useState("");
  const [phase7RequestId, setPhase7RequestId] = useState(() => makeRequestId("gc-p7"));

  const [phase9Date, setPhase9Date] = useState(todayIso);
  const [phase9Amount, setPhase9Amount] = useState("");
  const [phase9PaymentAccount, setPhase9PaymentAccount] = useState("");
  const [phase9Reference, setPhase9Reference] = useState("");
  const [phase9Reason, setPhase9Reason] = useState("");
  const [phase9Confirmation, setPhase9Confirmation] = useState("");
  const [phase9RequestId, setPhase9RequestId] = useState(() => makeRequestId("gc-p9"));

  const [phase10Date, setPhase10Date] = useState(todayIso);
  const [phase10Amount, setPhase10Amount] = useState("");
  const [phase10ReceiptAccount, setPhase10ReceiptAccount] = useState("");
  const [phase10Reference, setPhase10Reference] = useState("");
  const [phase10RequestId, setPhase10RequestId] = useState(() => makeRequestId("gc-p10"));

  const [phase11Month, setPhase11Month] = useState(previousCompletedMonth);
  const [phase11Reference, setPhase11Reference] = useState("");
  const [phase11Reason, setPhase11Reason] = useState("");
  const [phase11Confirmation, setPhase11Confirmation] = useState("");
  const [phase11RequestId, setPhase11RequestId] = useState(() => makeRequestId("gc-p11"));

  const phase7Probe = useQuery<Phase7Readiness>({
    queryKey: [PHASE7_READINESS, companyKey, "probe"],
    queryFn: () => readJson<Phase7Readiness>(PHASE7_READINESS),
    enabled: isSupplierPartner,
    retry: false,
  });
  const phase7TargetCompanyId = phase7Probe.data?.pair?.hadiCompanyId ?? null;
  const phase7AuthorizedUrl = phase7TargetCompanyId
    ? `${PHASE7_READINESS}?targetCompanyId=${encodeURIComponent(String(phase7TargetCompanyId))}`
    : PHASE7_READINESS;
  const phase7Authorized = useQuery<Phase7Readiness>({
    queryKey: [phase7AuthorizedUrl, companyKey, "authorized"],
    queryFn: () => readJson<Phase7Readiness>(phase7AuthorizedUrl),
    enabled: isSupplierPartner && phase7TargetCompanyId != null,
    retry: false,
  });
  const phase7 = phase7Authorized.data ?? phase7Probe.data;
  const phase7Error = phase7Authorized.error ?? phase7Probe.error;
  const phase7Loading = phase7Probe.isLoading || (phase7TargetCompanyId != null && phase7Authorized.isLoading);

  const phase9Query = useQuery<Phase9Readiness>({
    queryKey: [PHASE9_READINESS, companyKey],
    queryFn: () => readJson<Phase9Readiness>(PHASE9_READINESS),
    enabled: isSupplierPartner,
    retry: false,
  });

  const phase10Query = useQuery<Phase10Readiness>({
    queryKey: [PHASE10_READINESS, companyKey],
    queryFn: () => readJson<Phase10Readiness>(PHASE10_READINESS),
    enabled: isSupplierPartner,
    retry: false,
  });

  const phase11Url = `${PHASE11_READINESS}?periodMonth=${encodeURIComponent(phase11Month)}`;
  const phase11Query = useQuery<Phase11Readiness>({
    queryKey: [phase11Url, companyKey],
    queryFn: () => readJson<Phase11Readiness>(phase11Url),
    enabled: isSupplierPartner && /^\d{4}-\d{2}$/.test(phase11Month),
    retry: false,
  });

  const invalidateReadiness = () => {
    void queryClient.invalidateQueries({
      predicate: (query) => String(query.queryKey[0] ?? "").startsWith("/api/sp/golden-coast/"),
    });
    void queryClient.invalidateQueries({ queryKey: ["/api/sp/sales"] });
  };

  const rotatePhase7 = () => setPhase7RequestId(makeRequestId("gc-p7"));
  const rotatePhase9 = () => setPhase9RequestId(makeRequestId("gc-p9"));
  const rotatePhase10 = () => setPhase10RequestId(makeRequestId("gc-p10"));
  const rotatePhase11 = () => setPhase11RequestId(makeRequestId("gc-p11"));

  const phase7Maximum =
    phase7Operation === "collect_via_hadi"
      ? (phase7?.balances?.gcSalesCashDebitBalanceUsd ?? "0")
      : (phase7?.balances?.outstandingHadiCollectionsUsd ?? "0");
  const phase7HadiChoice = selectedAccount(phase7HadiAccount, phase7?.hadiCashAccounts ?? []);
  const phase7GcChoice = selectedAccount(phase7GcAccount, phase7?.goldenCoastCashAccounts ?? []);
  const phase7CanSubmit =
    phase7?.canTransfer === true &&
    allowedAmount(phase7Amount, phase7Maximum) &&
    phase7HadiChoice != null &&
    (phase7Operation === "collect_via_hadi" || phase7GcChoice != null);

  const phase7Mutation = useMutation({
    mutationFn: async () => {
      const targetCompanyId = phase7?.pair?.hadiCompanyId;
      if (!targetCompanyId || !phase7HadiChoice) {
        throw new Error(releaseDebtEnglish("HADI routing is not ready for this company."));
      }
      const response = await apiRequest(
        "POST",
        `${PHASE7_TRANSFER}?targetCompanyId=${encodeURIComponent(String(targetCompanyId))}`,
        {
          operation: phase7Operation,
          transferDate: phase7Date,
          amountUsd: phase7Amount,
          clientRequestId: phase7RequestId,
          reference: phase7Reference.trim() || null,
          hadiCashAccount: phase7HadiChoice,
          ...(phase7Operation === "remit_from_hadi" && phase7GcChoice
            ? { goldenCoastCashAccount: phase7GcChoice }
            : {}),
        }
      );
      return (await response.json()) as MutationResult;
    },
    onSuccess: (result) => {
      invalidateReadiness();
      setPhase7Amount("");
      setPhase7Reference("");
      setPhase7RequestId(makeRequestId("gc-p7"));
      toast({
        title: releaseDebtEnglish(result.replayed ? "HADI transfer replay confirmed" : "HADI transfer posted"),
        description: releaseDebtEnglish("Live balances were refreshed from the server."),
      });
    },
    onError: (error: ClientErrorLike) => {
      toast({ title: releaseDebtEnglish("HADI transfer failed"), description: error.message, variant: "destructive" });
    },
  });

  const phase9 = phase9Query.data;
  const phase9Choice = selectedAccount(phase9PaymentAccount, phase9?.paymentAccounts ?? []);
  const phase9CanSubmit =
    phase9?.ready === true &&
    phase9Choice != null &&
    allowedAmount(phase9Amount, phase9.availableSavingsUsd) &&
    phase9Reason.trim().length >= 5 &&
    phase9Confirmation.trim() === HASSAN_SAVINGS_CONFIRMATION;

  const phase9Mutation = useMutation({
    mutationFn: async () => {
      if (!phase9Choice) throw new Error(releaseDebtEnglish("Select a payment account."));
      const response = await apiRequest("POST", PHASE9_WITHDRAWAL, {
        withdrawalDate: phase9Date,
        amountUsd: phase9Amount,
        clientRequestId: phase9RequestId,
        paymentAccount: phase9Choice,
        reference: phase9Reference.trim() || null,
        reason: phase9Reason.trim(),
        confirmation: phase9Confirmation.trim(),
      });
      return (await response.json()) as MutationResult;
    },
    onSuccess: (result) => {
      invalidateReadiness();
      setPhase9Amount("");
      setPhase9Reference("");
      setPhase9Reason("");
      setPhase9Confirmation("");
      setPhase9RequestId(makeRequestId("gc-p9"));
      toast({
        title: releaseDebtEnglish(result.replayed ? "Withdrawal replay confirmed" : "Hassan Savings withdrawn"),
        description: releaseDebtEnglish("The available Hassan Savings balance was refreshed."),
      });
    },
    onError: (error: ClientErrorLike) => {
      toast({ title: releaseDebtEnglish("Withdrawal failed"), description: error.message, variant: "destructive" });
    },
  });

  const phase10 = phase10Query.data;
  const phase10Choice = selectedAccount(phase10ReceiptAccount, phase10?.receiptAccounts ?? []);
  const phase10CanSubmit =
    phase10?.ready === true && phase10Choice != null && allowedAmount(phase10Amount, phase10.collectibleSalesCashUsd);

  const phase10Mutation = useMutation({
    mutationFn: async () => {
      if (!phase10Choice) throw new Error(releaseDebtEnglish("Select a receipt account."));
      const response = await apiRequest("POST", PHASE10_SETTLEMENT, {
        settlementDate: phase10Date,
        amountUsd: phase10Amount,
        clientRequestId: phase10RequestId,
        receiptAccount: phase10Choice,
        reference: phase10Reference.trim() || null,
      });
      return (await response.json()) as MutationResult;
    },
    onSuccess: (result) => {
      invalidateReadiness();
      setPhase10Amount("");
      setPhase10Reference("");
      setPhase10RequestId(makeRequestId("gc-p10"));
      toast({
        title: releaseDebtEnglish(result.replayed ? "Settlement replay confirmed" : "GC Sales Cash settled"),
        description: releaseDebtEnglish("The collectible sales-cash balance was refreshed."),
      });
    },
    onError: (error: ClientErrorLike) => {
      toast({ title: releaseDebtEnglish("Settlement failed"), description: error.message, variant: "destructive" });
    },
  });

  const phase11 = phase11Query.data;
  const phase11CanSubmit =
    phase11?.ready === true &&
    phase11.alreadyClosed !== true &&
    phase11Reason.trim().length >= 5 &&
    phase11Confirmation.trim() === MONTHLY_CLOSE_CONFIRMATION;

  const phase11Mutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", PHASE11_CLOSE, {
        periodMonth: phase11Month,
        clientRequestId: phase11RequestId,
        idempotencyKey: phase11RequestId,
        reference: phase11Reference.trim() || null,
        reason: phase11Reason.trim(),
        confirmation: phase11Confirmation.trim(),
      });
      return (await response.json()) as MutationResult;
    },
    onSuccess: (result) => {
      invalidateReadiness();
      setPhase11Reference("");
      setPhase11Reason("");
      setPhase11Confirmation("");
      setPhase11RequestId(makeRequestId("gc-p11"));
      toast({
        title: releaseDebtEnglish(result.replayed ? "Monthly close replay confirmed" : "Monthly close finalized"),
        description: releaseDebtEnglish("The month is now protected by the Phase 11 close."),
      });
    },
    onError: (error: ClientErrorLike) => {
      toast({ title: releaseDebtEnglish("Monthly close failed"), description: error.message, variant: "destructive" });
    },
  });

  const overviewCards = useMemo(
    () => [
      {
        phase: "Phase 6",
        title: releaseDebtEnglish("POS sales"),
        description: releaseDebtEnglish(
          "Use the existing POS sale flow. Phase 6 owns Golden Coast sale, FIFO, and COGS posting."
        ),
        icon: ShoppingCart,
        href: "/pos",
        tab: null,
      },
      {
        phase: "Phase 7",
        title: releaseDebtEnglish("HADI cash routing"),
        description: releaseDebtEnglish(
          "Collect Golden Coast sales cash through HADI or remit collected cash back to Golden Coast."
        ),
        icon: ArrowRightLeft,
        href: null,
        tab: "hadi" as GoldenCoastTab,
      },
      {
        phase: "Phase 9",
        title: releaseDebtEnglish("Hassan Savings withdrawal"),
        description: releaseDebtEnglish(
          "Withdraw only from the live Hassan Savings balance into an approved Golden Coast cash or bank account."
        ),
        icon: WalletCards,
        href: null,
        tab: "savings" as GoldenCoastTab,
      },
      {
        phase: "Phase 10",
        title: releaseDebtEnglish("GC Sales Cash settlement"),
        description: releaseDebtEnglish(
          "Settle all or part of the current collectible GC Sales Cash balance directly into Golden Coast cash or bank."
        ),
        icon: CircleDollarSign,
        href: null,
        tab: "sales-cash" as GoldenCoastTab,
      },
      {
        phase: "Phase 11",
        title: releaseDebtEnglish("Monthly 50/50 close"),
        description: releaseDebtEnglish(
          "Review server-derived monthly results and finalize the protected 50/50 profit or loss close."
        ),
        icon: CalendarCheck2,
        href: null,
        tab: "monthly-close" as GoldenCoastTab,
      },
    ],
    []
  );

  if (!isSupplierPartner) {
    return (
      <div className="mx-auto max-w-5xl space-y-4" data-testid="sp-golden-coast">
        <h1 className="text-2xl font-semibold">{releaseDebtEnglish("Golden Coast operations")}</h1>
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            {releaseDebtEnglish("Select a Supplier Partner company before opening Golden Coast operations.")}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6" data-testid="sp-golden-coast">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{releaseDebtEnglish("Golden Coast operations")}</h1>
            <Badge variant="outline">{selectedCompany?.name}</Badge>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {releaseDebtEnglish(
              "Frontend controls for the already-approved Golden Coast flows. Accounting rules, account setup, and container semantics stay server-owned and unchanged."
            )}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={invalidateReadiness} data-testid="button-gc-refresh-readiness">
          <RefreshCw className="mr-2 h-4 w-4" />
          {releaseDebtEnglish("Refresh readiness")}
        </Button>
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as GoldenCoastTab)}>
        <TabsList className="flex h-auto flex-wrap gap-1" data-testid="tabs-golden-coast">
          <TabsTrigger value="overview">{releaseDebtEnglish("Overview")}</TabsTrigger>
          <TabsTrigger value="hadi">{releaseDebtEnglish("HADI")}</TabsTrigger>
          <TabsTrigger value="savings">{releaseDebtEnglish("Hassan Savings")}</TabsTrigger>
          <TabsTrigger value="sales-cash">{releaseDebtEnglish("GC Sales Cash")}</TabsTrigger>
          <TabsTrigger value="monthly-close">{releaseDebtEnglish("Monthly close")}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-5 space-y-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {overviewCards.map((item) => {
              const Icon = item.icon;
              return (
                <Card key={item.phase} className="h-full">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <div className="rounded-md bg-muted p-2">
                        <Icon className="h-5 w-5" />
                      </div>
                      <Badge variant="secondary">{item.phase}</Badge>
                    </div>
                    <CardTitle className="pt-2 text-base">{item.title}</CardTitle>
                    <CardDescription>{item.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {item.href ? (
                      <Link href={item.href}>
                        <a
                          className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90"
                          data-testid="link-gc-pos"
                        >
                          {releaseDebtEnglish("Open POS")}
                        </a>
                      </Link>
                    ) : (
                      <Button onClick={() => item.tab && setTab(item.tab)} data-testid={`button-gc-open-${item.tab}`}>
                        {releaseDebtEnglish("Open workflow")}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <Card>
            <CardContent className="p-5 text-sm text-muted-foreground">
              {releaseDebtEnglish(
                "Phase 8 container funding and offload remains on its existing workflow. This page does not change container reserve, landed-cost, FIFO, account provisioning, or setup behavior."
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="hadi" className="mt-5">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <ArrowRightLeft className="h-5 w-5" /> {releaseDebtEnglish("HADI cash routing")}
                  </CardTitle>
                  <CardDescription>
                    {releaseDebtEnglish(
                      "Phase 7 validates both companies, live balances, cash accounts, and intercompany routing on the server."
                    )}
                  </CardDescription>
                </div>
                <Badge variant="secondary">{releaseDebtEnglish("Phase 7")}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <ReadinessState
                loading={phase7Loading}
                error={phase7Error}
                ready={phase7?.canTransfer === true}
                readyText={releaseDebtEnglish("HADI routing is ready for a new transfer.")}
                blockedText={releaseDebtEnglish("HADI routing is blocked. Review the server blockers below.")}
              />
              {phase7?.blockers?.length ? (
                <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {phase7.blockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">{releaseDebtEnglish("GC Sales Cash")}</p>
                  <p className="mt-1 font-semibold tabular-nums">
                    {money(phase7?.balances?.gcSalesCashDebitBalanceUsd)}
                  </p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">{releaseDebtEnglish("Outstanding with HADI")}</p>
                  <p className="mt-1 font-semibold tabular-nums">
                    {money(phase7?.balances?.outstandingHadiCollectionsUsd)}
                  </p>
                </div>
                <div className="rounded-md border p-3 sm:col-span-2">
                  <p className="text-xs text-muted-foreground">{releaseDebtEnglish("Company pair")}</p>
                  <p className="mt-1 text-sm font-medium">
                    {phase7?.pair
                      ? `${phase7.pair.goldenCoastCompanyName} ↔ ${phase7.pair.hadiCompanyName}`
                      : releaseDebtEnglish("Not resolved")}
                  </p>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="gc-phase7-operation">
                    {releaseDebtEnglish("Operation")}
                  </label>
                  <select
                    id="gc-phase7-operation"
                    value={phase7Operation}
                    onChange={(event) => {
                      setPhase7Operation(event.target.value as Phase7Operation);
                      rotatePhase7();
                    }}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="collect_via_hadi">
                      {releaseDebtEnglish("HADI collects Golden Coast sales cash")}
                    </option>
                    <option value="remit_from_hadi">
                      {releaseDebtEnglish("HADI remits collected cash to Golden Coast")}
                    </option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="gc-phase7-date">
                    {releaseDebtEnglish("Transfer date")}
                  </label>
                  <Input
                    id="gc-phase7-date"
                    type="date"
                    value={phase7Date}
                    onChange={(event) => {
                      setPhase7Date(event.target.value);
                      rotatePhase7();
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="gc-phase7-amount">
                    {releaseDebtEnglish("Amount (USD)")}
                  </label>
                  <Input
                    id="gc-phase7-amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    max={phase7Maximum}
                    value={phase7Amount}
                    onChange={(event) => {
                      setPhase7Amount(event.target.value);
                      rotatePhase7();
                    }}
                    data-testid="input-gc-phase7-amount"
                  />
                  <p className="text-xs text-muted-foreground">
                    {releaseDebtEnglish("Current server cap")}: {money(phase7Maximum)}
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="select-gc-phase7-hadi-account">
                    {releaseDebtEnglish("HADI cash or bank account")}
                  </label>
                  <AccountPicker
                    id="select-gc-phase7-hadi-account"
                    value={phase7HadiAccount}
                    accounts={phase7?.hadiCashAccounts ?? []}
                    onChange={(value) => {
                      setPhase7HadiAccount(value);
                      rotatePhase7();
                    }}
                  />
                </div>
                {phase7Operation === "remit_from_hadi" ? (
                  <div className="space-y-2">
                    <label className="text-sm font-medium" htmlFor="select-gc-phase7-gc-account">
                      {releaseDebtEnglish("Golden Coast receiving account")}
                    </label>
                    <AccountPicker
                      id="select-gc-phase7-gc-account"
                      value={phase7GcAccount}
                      accounts={phase7?.goldenCoastCashAccounts ?? []}
                      onChange={(value) => {
                        setPhase7GcAccount(value);
                        rotatePhase7();
                      }}
                    />
                  </div>
                ) : null}
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="gc-phase7-reference">
                    {releaseDebtEnglish("Reference (optional)")}
                  </label>
                  <Input
                    id="gc-phase7-reference"
                    value={phase7Reference}
                    maxLength={200}
                    onChange={(event) => {
                      setPhase7Reference(event.target.value);
                      rotatePhase7();
                    }}
                  />
                </div>
              </div>
              <Button
                onClick={() => phase7Mutation.mutate()}
                disabled={!phase7CanSubmit || phase7Mutation.isPending}
                data-testid="button-gc-phase7-submit"
              >
                {phase7Mutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Banknote className="mr-2 h-4 w-4" />
                )}
                {phase7Operation === "collect_via_hadi"
                  ? releaseDebtEnglish("Post HADI collection")
                  : releaseDebtEnglish("Post HADI remittance")}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="savings" className="mt-5">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <WalletCards className="h-5 w-5" /> {releaseDebtEnglish("Hassan Savings withdrawal")}
                  </CardTitle>
                  <CardDescription>
                    {releaseDebtEnglish(
                      "Phase 9 pays out only from the live credit balance of the canonical Hassan Savings account."
                    )}
                  </CardDescription>
                </div>
                <Badge variant="secondary">{releaseDebtEnglish("Phase 9")}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <ReadinessState
                loading={phase9Query.isLoading}
                error={phase9Query.error}
                ready={phase9?.ready === true}
                readyText={releaseDebtEnglish("Hassan Savings is ready for a controlled withdrawal.")}
                blockedText={releaseDebtEnglish(
                  "Withdrawal is not ready. Refresh after resolving the server-reported account state."
                )}
              />
              <div className="rounded-md border p-4">
                <p className="text-xs text-muted-foreground">{releaseDebtEnglish("Available Hassan Savings")}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{money(phase9?.availableSavingsUsd)}</p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="gc-phase9-date">
                    {releaseDebtEnglish("Withdrawal date")}
                  </label>
                  <Input
                    id="gc-phase9-date"
                    type="date"
                    value={phase9Date}
                    onChange={(event) => {
                      setPhase9Date(event.target.value);
                      rotatePhase9();
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="gc-phase9-amount">
                    {releaseDebtEnglish("Amount (USD)")}
                  </label>
                  <Input
                    id="gc-phase9-amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    max={phase9?.availableSavingsUsd ?? "0"}
                    value={phase9Amount}
                    onChange={(event) => {
                      setPhase9Amount(event.target.value);
                      rotatePhase9();
                    }}
                    data-testid="input-gc-phase9-amount"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm font-medium" htmlFor="select-gc-phase9-payment-account">
                    {releaseDebtEnglish("Payment account")}
                  </label>
                  <AccountPicker
                    id="select-gc-phase9-payment-account"
                    value={phase9PaymentAccount}
                    accounts={phase9?.paymentAccounts ?? []}
                    onChange={(value) => {
                      setPhase9PaymentAccount(value);
                      rotatePhase9();
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="gc-phase9-reference">
                    {releaseDebtEnglish("Reference (optional)")}
                  </label>
                  <Input
                    id="gc-phase9-reference"
                    value={phase9Reference}
                    maxLength={200}
                    onChange={(event) => {
                      setPhase9Reference(event.target.value);
                      rotatePhase9();
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="gc-phase9-reason">
                    {releaseDebtEnglish("Reason")}
                  </label>
                  <Input
                    id="gc-phase9-reason"
                    value={phase9Reason}
                    maxLength={500}
                    onChange={(event) => {
                      setPhase9Reason(event.target.value);
                      rotatePhase9();
                    }}
                    data-testid="input-gc-phase9-reason"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm font-medium" htmlFor="gc-phase9-confirmation">
                    {releaseDebtEnglish("Exact confirmation")}
                  </label>
                  <Input
                    id="gc-phase9-confirmation"
                    value={phase9Confirmation}
                    onChange={(event) => {
                      setPhase9Confirmation(event.target.value);
                      rotatePhase9();
                    }}
                    placeholder={HASSAN_SAVINGS_CONFIRMATION}
                    autoComplete="off"
                    data-testid="input-gc-phase9-confirmation"
                  />
                  <p className="text-xs text-muted-foreground">
                    {releaseDebtEnglish("Type exactly")}:{" "}
                    <span className="font-mono">{HASSAN_SAVINGS_CONFIRMATION}</span>
                  </p>
                </div>
              </div>
              <Button
                onClick={() => phase9Mutation.mutate()}
                disabled={!phase9CanSubmit || phase9Mutation.isPending}
                data-testid="button-gc-phase9-submit"
              >
                {phase9Mutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <WalletCards className="mr-2 h-4 w-4" />
                )}
                {releaseDebtEnglish("Withdraw Hassan Savings")}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sales-cash" className="mt-5">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <CircleDollarSign className="h-5 w-5" /> {releaseDebtEnglish("GC Sales Cash settlement")}
                  </CardTitle>
                  <CardDescription>
                    {releaseDebtEnglish(
                      "Phase 10 clears only the server-calculated collectible GC Sales Cash balance into an approved Golden Coast cash or bank account."
                    )}
                  </CardDescription>
                </div>
                <Badge variant="secondary">{releaseDebtEnglish("Phase 10")}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <ReadinessState
                loading={phase10Query.isLoading}
                error={phase10Query.error}
                ready={phase10?.ready === true}
                readyText={releaseDebtEnglish("Direct GC Sales Cash settlement is ready.")}
                blockedText={releaseDebtEnglish(
                  "Settlement is not ready. Refresh after resolving the server-reported account state."
                )}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border p-4">
                  <p className="text-xs text-muted-foreground">{releaseDebtEnglish("Collectible GC Sales Cash")}</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{money(phase10?.collectibleSalesCashUsd)}</p>
                </div>
                <div className="rounded-md border p-4">
                  <p className="text-xs text-muted-foreground">{releaseDebtEnglish("Raw debit balance")}</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">
                    {money(phase10?.rawSalesCashDebitBalanceUsd)}
                  </p>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="gc-phase10-date">
                    {releaseDebtEnglish("Settlement date")}
                  </label>
                  <Input
                    id="gc-phase10-date"
                    type="date"
                    value={phase10Date}
                    onChange={(event) => {
                      setPhase10Date(event.target.value);
                      rotatePhase10();
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="gc-phase10-amount">
                    {releaseDebtEnglish("Amount (USD)")}
                  </label>
                  <Input
                    id="gc-phase10-amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    max={phase10?.collectibleSalesCashUsd ?? "0"}
                    value={phase10Amount}
                    onChange={(event) => {
                      setPhase10Amount(event.target.value);
                      rotatePhase10();
                    }}
                    data-testid="input-gc-phase10-amount"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm font-medium" htmlFor="select-gc-phase10-receipt-account">
                    {releaseDebtEnglish("Receipt account")}
                  </label>
                  <AccountPicker
                    id="select-gc-phase10-receipt-account"
                    value={phase10ReceiptAccount}
                    accounts={phase10?.receiptAccounts ?? []}
                    onChange={(value) => {
                      setPhase10ReceiptAccount(value);
                      rotatePhase10();
                    }}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm font-medium" htmlFor="gc-phase10-reference">
                    {releaseDebtEnglish("Reference (optional)")}
                  </label>
                  <Input
                    id="gc-phase10-reference"
                    value={phase10Reference}
                    maxLength={200}
                    onChange={(event) => {
                      setPhase10Reference(event.target.value);
                      rotatePhase10();
                    }}
                  />
                </div>
              </div>
              <Button
                onClick={() => phase10Mutation.mutate()}
                disabled={!phase10CanSubmit || phase10Mutation.isPending}
                data-testid="button-gc-phase10-submit"
              >
                {phase10Mutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CircleDollarSign className="mr-2 h-4 w-4" />
                )}
                {releaseDebtEnglish("Post direct settlement")}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="monthly-close" className="mt-5">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <CalendarCheck2 className="h-5 w-5" /> {releaseDebtEnglish("Monthly 50/50 close")}
                  </CardTitle>
                  <CardDescription>
                    {releaseDebtEnglish(
                      "Phase 11 derives revenue, COGS, shared charges, and both 50/50 shares from posted ledger activity. The UI never supplies accounting totals or split percentages."
                    )}
                  </CardDescription>
                </div>
                <Badge variant="secondary">{releaseDebtEnglish("Phase 11")}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="max-w-xs space-y-2">
                <label className="text-sm font-medium" htmlFor="gc-phase11-month">
                  {releaseDebtEnglish("Closed month")}
                </label>
                <Input
                  id="gc-phase11-month"
                  type="month"
                  value={phase11Month}
                  onChange={(event) => {
                    setPhase11Month(event.target.value);
                    rotatePhase11();
                  }}
                  data-testid="input-gc-phase11-month"
                />
              </div>
              <ReadinessState
                loading={phase11Query.isLoading}
                error={phase11Query.error}
                ready={phase11?.ready === true}
                readyText={releaseDebtEnglish("The selected month is ready for the ledger-derived 50/50 close.")}
                blockedText={releaseDebtEnglish(
                  phase11?.alreadyClosed
                    ? "The selected month is already closed."
                    : "The selected month is not ready to close. Review the server response before continuing."
                )}
              />
              {phase11?.plan ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {[
                    [releaseDebtEnglish("Revenue"), phase11.plan.totalRevenueUsd],
                    [releaseDebtEnglish("COGS"), phase11.plan.totalCogsUsd],
                    [releaseDebtEnglish("Shared charges"), phase11.plan.totalSharedChargesUsd],
                    [releaseDebtEnglish("Net profit / loss"), phase11.plan.netProfitLossUsd],
                    [releaseDebtEnglish("Fresh Start share"), phase11.plan.freshStartShareUsd],
                    [releaseDebtEnglish("Hassan share"), phase11.plan.hassanShareUsd],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-md border p-3">
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="mt-1 font-semibold tabular-nums">{money(value)}</p>
                    </div>
                  ))}
                </div>
              ) : null}
              {phase11?.profitPendingDistributionBalanceUsd != null ? (
                <div className="rounded-md border p-3 text-sm">
                  <span className="text-muted-foreground">
                    {releaseDebtEnglish("Profit Pending Distribution balance")}:{" "}
                  </span>
                  <span className="font-semibold tabular-nums">
                    {money(phase11.profitPendingDistributionBalanceUsd)}
                  </span>
                </div>
              ) : null}
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="gc-phase11-reference">
                    {releaseDebtEnglish("Reference (optional)")}
                  </label>
                  <Input
                    id="gc-phase11-reference"
                    value={phase11Reference}
                    maxLength={200}
                    onChange={(event) => {
                      setPhase11Reference(event.target.value);
                      rotatePhase11();
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="gc-phase11-reason">
                    {releaseDebtEnglish("Reason")}
                  </label>
                  <Input
                    id="gc-phase11-reason"
                    value={phase11Reason}
                    maxLength={500}
                    onChange={(event) => {
                      setPhase11Reason(event.target.value);
                      rotatePhase11();
                    }}
                    data-testid="input-gc-phase11-reason"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm font-medium" htmlFor="gc-phase11-confirmation">
                    {releaseDebtEnglish("Exact confirmation")}
                  </label>
                  <Input
                    id="gc-phase11-confirmation"
                    value={phase11Confirmation}
                    onChange={(event) => {
                      setPhase11Confirmation(event.target.value);
                      rotatePhase11();
                    }}
                    placeholder={MONTHLY_CLOSE_CONFIRMATION}
                    autoComplete="off"
                    data-testid="input-gc-phase11-confirmation"
                  />
                  <p className="text-xs text-muted-foreground">
                    {releaseDebtEnglish("Type exactly")}:{" "}
                    <span className="font-mono">{MONTHLY_CLOSE_CONFIRMATION}</span>
                  </p>
                </div>
              </div>
              <Button
                onClick={() => phase11Mutation.mutate()}
                disabled={!phase11CanSubmit || phase11Mutation.isPending}
                data-testid="button-gc-phase11-submit"
              >
                {phase11Mutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CalendarCheck2 className="mr-2 h-4 w-4" />
                )}
                {releaseDebtEnglish("Finalize monthly close")}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
