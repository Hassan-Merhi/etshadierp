import type { ClientErrorLike } from "@/lib/clientError";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HandCoins, Loader2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { releaseDebtEnglish } from "@/i18n/finalCloseoutTranslations";
import { apiRequest } from "@/lib/queryClient";
import { PHASE7_READINESS, type CashAccountOption, type CompanyKey, type Phase7Readiness } from "./contracts";
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

const FRESH_START_HADI_READINESS = "/api/sp/golden-coast/phase7/sales-cash-pay-fresh-start/readiness";
const FRESH_START_HADI_PAYMENT = "/api/sp/golden-coast/phase7/sales-cash-pay-fresh-start";

interface FreshStartHadiReadiness {
  pair: {
    goldenCoastCompanyId: number;
    goldenCoastCompanyName: string;
    hadiCompanyId: number;
    hadiCompanyName: string;
  };
  accounts: {
    gcSalesCashAccountId: number;
    goldenCoastHadiIntercompanyAccountId: number;
    hadiGoldenCoastIntercompanyAccountId: number;
    gcSalesCash: string;
    goldenCoastHadiIntercompany: string;
    hadiGoldenCoastIntercompany: string;
  };
  gcSalesCashPayableUsd: string;
  outstandingHadiSalesCashUsd: string;
  hadiIntercompanyAssetUsd: string;
  maximumPaymentUsd: string;
  hadiCashAccounts: CashAccountOption[];
  ready: boolean;
}

export function FreshStartHadiPaymentPanel({ companyKey }: { companyKey: CompanyKey }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const invalidateReadiness = useReadinessInvalidation();
  const [paymentDate, setPaymentDate] = useState(todayIso);
  const [amount, setAmount] = useState("");
  const [hadiAccount, setHadiAccount] = useState("");
  const [reference, setReference] = useState("");
  const [requestId, setRequestId] = useState(() => makeRequestId("gc-fs-hadi"));

  const phase7Probe = useQuery<Phase7Readiness>({
    queryKey: [PHASE7_READINESS, companyKey, "fresh-start-probe"],
    queryFn: () => readJson<Phase7Readiness>(PHASE7_READINESS),
    retry: false,
  });
  const targetCompanyId = phase7Probe.data?.pair?.hadiCompanyId ?? null;
  const readinessUrl = targetCompanyId
    ? `${FRESH_START_HADI_READINESS}?targetCompanyId=${encodeURIComponent(String(targetCompanyId))}`
    : FRESH_START_HADI_READINESS;
  const readiness = useQuery<FreshStartHadiReadiness>({
    queryKey: [readinessUrl, companyKey],
    queryFn: () => readJson<FreshStartHadiReadiness>(readinessUrl),
    enabled: targetCompanyId != null,
    retry: false,
  });

  const data = readiness.data;
  const selectedHadiAccount = selectedAccount(hadiAccount, data?.hadiCashAccounts ?? []);
  const canSubmit =
    data?.ready === true &&
    selectedHadiAccount != null &&
    allowedAmount(amount, data.maximumPaymentUsd) &&
    paymentDate.length === 10;

  const rotateRequest = () => setRequestId(makeRequestId("gc-fs-hadi"));

  const mutation = useMutation({
    mutationFn: async () => {
      if (!targetCompanyId || !selectedHadiAccount) {
        throw new Error(releaseDebtEnglish("Fresh Start payment routing is not ready."));
      }
      const response = await apiRequest(
        "POST",
        `${FRESH_START_HADI_PAYMENT}?targetCompanyId=${encodeURIComponent(String(targetCompanyId))}`,
        {
          paymentDate,
          amountUsd: amount,
          clientRequestId: requestId,
          reference: reference.trim() || null,
          hadiCashAccount: selectedHadiAccount,
        }
      );
      return response.json();
    },
    onSuccess: (result: { replayed?: boolean }) => {
      setAmount("");
      setReference("");
      setRequestId(makeRequestId("gc-fs-hadi"));
      invalidateReadiness();
      queryClient.invalidateQueries({
        predicate: (query) => String(query.queryKey[0] ?? "").includes(FRESH_START_HADI_READINESS),
      });
      queryClient.invalidateQueries({
        predicate: (query) => String(query.queryKey[0] ?? "").includes("/api/stats/net-profit"),
      });
      toast({
        title: releaseDebtEnglish(
          result.replayed ? "Fresh Start payment replay confirmed" : "Fresh Start payment posted"
        ),
        description: releaseDebtEnglish("GC Sales Cash payable and the HADI intercompany asset were reduced together."),
      });
    },
    onError: (error: ClientErrorLike) => {
      toast({
        title: releaseDebtEnglish("Fresh Start payment failed"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <HandCoins className="h-5 w-5" /> {releaseDebtEnglish("Pay Fresh Start from HADI")}
            </CardTitle>
            <CardDescription>
              {releaseDebtEnglish(
                "Use this only when HADI actually pays Fresh Start. A normal GC↔HADI transfer only moves an asset and does not reduce Fresh Start."
              )}
            </CardDescription>
          </div>
          <Badge variant="secondary">{releaseDebtEnglish("Fresh Start settlement")}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <ReadinessState
          loading={phase7Probe.isLoading || readiness.isLoading}
          error={readiness.error ?? phase7Probe.error}
          ready={data?.ready === true}
          readyText={releaseDebtEnglish("HADI has Golden Coast sales cash available to pay Fresh Start.")}
          blockedText={releaseDebtEnglish("No Fresh Start payment is currently available from HADI.")}
        />

        <div className="grid gap-3 sm:grid-cols-4">
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">{releaseDebtEnglish("GC Sales Cash payable")}</p>
            <p className="mt-1 font-semibold tabular-nums">{money(data?.gcSalesCashPayableUsd)}</p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">{releaseDebtEnglish("Sales cash still held by HADI")}</p>
            <p className="mt-1 font-semibold tabular-nums">{money(data?.outstandingHadiSalesCashUsd)}</p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">{releaseDebtEnglish("GC HADI intercompany asset")}</p>
            <p className="mt-1 font-semibold tabular-nums">{money(data?.hadiIntercompanyAssetUsd)}</p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">{releaseDebtEnglish("Maximum payment now")}</p>
            <p className="mt-1 font-semibold tabular-nums">{money(data?.maximumPaymentUsd)}</p>
          </div>
        </div>

        <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{releaseDebtEnglish("Golden Coast")}: </span>
          {releaseDebtEnglish("Dr GC Sales Cash payable / Cr HADI Intercompany")}
          <span className="mx-2">•</span>
          <span className="font-medium text-foreground">{releaseDebtEnglish("HADI")}: </span>
          {releaseDebtEnglish("Dr Golden Coast Intercompany / Cr selected Cash or Bank")}
          <p className="mt-2 text-xs">
            {releaseDebtEnglish(
              "Fresh Start Equity is not posted here. It decreases automatically in Net Position because Net Assets fell while Hassan's account stayed unchanged."
            )}
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="gc-fs-hadi-date">
              {releaseDebtEnglish("Payment date")}
            </label>
            <Input
              id="gc-fs-hadi-date"
              type="date"
              value={paymentDate}
              onChange={(event) => {
                setPaymentDate(event.target.value);
                rotateRequest();
              }}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="gc-fs-hadi-amount">
              {releaseDebtEnglish("Amount (USD)")}
            </label>
            <Input
              id="gc-fs-hadi-amount"
              type="number"
              min="0.01"
              step="0.01"
              max={data?.maximumPaymentUsd ?? undefined}
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
                rotateRequest();
              }}
              data-testid="input-gc-fs-hadi-amount"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="gc-fs-hadi-account">
              {releaseDebtEnglish("HADI paying cash or bank account")}
            </label>
            <AccountPicker
              id="gc-fs-hadi-account"
              value={hadiAccount}
              accounts={data?.hadiCashAccounts ?? []}
              onChange={(value) => {
                setHadiAccount(value);
                rotateRequest();
              }}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="gc-fs-hadi-reference">
              {releaseDebtEnglish("Reference (optional)")}
            </label>
            <Input
              id="gc-fs-hadi-reference"
              value={reference}
              maxLength={200}
              onChange={(event) => {
                setReference(event.target.value);
                rotateRequest();
              }}
            />
          </div>
        </div>

        <Button
          onClick={() => mutation.mutate()}
          disabled={!canSubmit || mutation.isPending}
          data-testid="button-gc-fs-hadi-submit"
        >
          {mutation.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <HandCoins className="mr-2 h-4 w-4" />
          )}
          {releaseDebtEnglish("Post Fresh Start payment")}
        </Button>
      </CardContent>
    </Card>
  );
}
