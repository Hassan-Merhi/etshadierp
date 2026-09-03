/**
 * Phase 7 — HADI cash routing.
 *
 * Both directions (HADI collects Golden Coast sales cash, HADI remits it back)
 * are validated on the server: this panel only picks an approved account, an
 * amount inside the server-reported cap, and a stable client request id.
 */
import type { ClientErrorLike } from "@/lib/clientError";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRightLeft, Banknote, Loader2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { releaseDebtEnglish } from "@/i18n/finalCloseoutTranslations";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  PHASE7_READINESS,
  PHASE7_TRANSFER,
  type CompanyKey,
  type MutationResult,
  type Phase7Operation,
  type Phase7Readiness,
} from "./contracts";
import {
  AccountPicker,
  ReadinessState,
  allowedAmount,
  makeRequestId,
  money,
  readJson,
  selectedAccount,
  todayIso,
  useReadinessInvalidation,
} from "./shared";

export function HadiCashRoutingPanel({ companyKey }: { companyKey: CompanyKey }) {
  const { toast } = useToast();
  const invalidateReadiness = useReadinessInvalidation();

  const [phase7Operation, setPhase7Operation] = useState<Phase7Operation>("collect_via_hadi");
  const [phase7Date, setPhase7Date] = useState(todayIso);
  const [phase7Amount, setPhase7Amount] = useState("");
  const [phase7HadiAccount, setPhase7HadiAccount] = useState("");
  const [phase7GcAccount, setPhase7GcAccount] = useState("");
  const [phase7Reference, setPhase7Reference] = useState("");
  const [phase7RequestId, setPhase7RequestId] = useState(() => makeRequestId("gc-p7"));

  // The unscoped probe resolves the HADI company, and the authorized read is
  // then re-issued with that targetCompanyId so the cross-company gate applies.
  const phase7Probe = useQuery<Phase7Readiness>({
    queryKey: [PHASE7_READINESS, companyKey, "probe"],
    queryFn: () => readJson<Phase7Readiness>(PHASE7_READINESS),
    retry: false,
  });
  const phase7TargetCompanyId = phase7Probe.data?.pair?.hadiCompanyId ?? null;
  const phase7AuthorizedUrl = phase7TargetCompanyId
    ? `${PHASE7_READINESS}?targetCompanyId=${encodeURIComponent(String(phase7TargetCompanyId))}`
    : PHASE7_READINESS;
  const phase7Authorized = useQuery<Phase7Readiness>({
    queryKey: [phase7AuthorizedUrl, companyKey, "authorized"],
    queryFn: () => readJson<Phase7Readiness>(phase7AuthorizedUrl),
    enabled: phase7TargetCompanyId != null,
    retry: false,
  });
  const phase7 = phase7Authorized.data ?? phase7Probe.data;
  const phase7Error = phase7Authorized.error ?? phase7Probe.error;
  const phase7Loading = phase7Probe.isLoading || (phase7TargetCompanyId != null && phase7Authorized.isLoading);

  const rotatePhase7 = () => setPhase7RequestId(makeRequestId("gc-p7"));

  // A collection records sale cash HADI received on Golden Coast's behalf, so it
  // RAISES the GC Sales Cash payable and has no ceiling on that account. Only a
  // remittance is capped, by what Phase 7 collected and has not yet returned.
  const phase7Maximum =
    phase7Operation === "collect_via_hadi" ? null : (phase7?.balances?.outstandingHadiCollectionsUsd ?? "0");
  const phase7HadiChoice = selectedAccount(phase7HadiAccount, phase7?.hadiCashAccounts ?? []);
  const phase7GcChoice = selectedAccount(phase7GcAccount, phase7?.goldenCoastCashAccounts ?? []);
  const phase7AmountAllowed =
    phase7Maximum === null ? Number(phase7Amount) > 0 : allowedAmount(phase7Amount, phase7Maximum);
  const phase7CanSubmit =
    phase7?.canTransfer === true &&
    phase7AmountAllowed &&
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

  return (
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
            <p className="text-xs text-muted-foreground">{releaseDebtEnglish("GC Sales Cash payable")}</p>
            <p className="mt-1 font-semibold tabular-nums">{money(phase7?.balances?.gcSalesCashPayableBalanceUsd)}</p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">{releaseDebtEnglish("Outstanding with HADI")}</p>
            <p className="mt-1 font-semibold tabular-nums">{money(phase7?.balances?.outstandingHadiCollectionsUsd)}</p>
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
              <option value="collect_via_hadi">{releaseDebtEnglish("HADI collects Golden Coast sales cash")}</option>
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
              max={phase7Maximum ?? undefined}
              value={phase7Amount}
              onChange={(event) => {
                setPhase7Amount(event.target.value);
                rotatePhase7();
              }}
              data-testid="input-gc-phase7-amount"
            />
            <p className="text-xs text-muted-foreground">
              {phase7Maximum === null
                ? releaseDebtEnglish("A collection raises the GC Sales Cash payable and is not capped by it.")
                : `${releaseDebtEnglish("Current server cap")}: ${money(phase7Maximum)}`}
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
  );
}
