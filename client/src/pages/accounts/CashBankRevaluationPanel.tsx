import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Landmark, Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCurrency } from "@/hooks/use-currency";

interface CashBankSummary {
  accountKind: "ledger" | "bank";
  id: number;
  name: string;
  code: string;
  accountType: string;
  nativeBalancesByCurrency: Record<string, string>;
  historicalBaseBalance: string;
  currentTranslatedBaseBalance: string | null;
  translationDifference: string | null;
  currentCfaPerUsd: string | null;
  currentRateMissing: boolean;
  openingBalanceCurrencyUnresolved: boolean;
  unresolvedOpeningBalanceRaw: string | null;
  unresolvedLegacyEntryCount: number;
  unresolvedTranslationCurrencies: string[];
  totalsProvisional: boolean;
}

interface CashBankResponse {
  accounts: CashBankSummary[];
  currentCfaPerUsd: string | null;
  unresolvedAccountCount: number;
}

export function CashBankRevaluationPanel() {
  const { formatTransactionAmount, formatHistoricalBaseAmount } = useCurrency();
  const { data, isLoading, error } = useQuery<CashBankResponse>({
    queryKey: ["/api/accounts/multi-currency/cash-bank-revaluation"],
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading cash and bank currency balances…
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Currency balances unavailable</AlertTitle>
        <AlertDescription>{error instanceof Error ? error.message : "Unable to load revaluation data."}</AlertDescription>
      </Alert>
    );
  }

  if (!data?.accounts?.length) return null;

  return (
    <Card data-testid="cash-bank-revaluation-panel">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Landmark className="h-4 w-4" /> Cash & Bank Currency Values
          </CardTitle>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {data.currentCfaPerUsd ? <span>Current rate: CFA {Number(data.currentCfaPerUsd).toLocaleString()} / USD</span> : null}
            {data.unresolvedAccountCount > 0 ? (
              <Badge variant="destructive">{data.unresolvedAccountCount} need review</Badge>
            ) : (
              <Badge variant="outline">Resolved</Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {data.unresolvedAccountCount > 0 && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Some totals are provisional</AlertTitle>
            <AlertDescription>
              Unresolved legacy transactions or opening balances are excluded instead of being silently treated as USD.
            </AlertDescription>
          </Alert>
        )}

        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Native balance</TableHead>
                <TableHead className="text-right">Historical USD</TableHead>
                <TableHead className="text-right">Current USD value</TableHead>
                <TableHead className="text-right">Translation difference</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.accounts.map((account) => (
                <TableRow key={`${account.accountKind}-${account.id}`}>
                  <TableCell>
                    <div className="font-medium">{account.name}</div>
                    <div className="text-xs text-muted-foreground">{account.code} · {account.accountType}</div>
                  </TableCell>
                  <TableCell>
                    {Object.entries(account.nativeBalancesByCurrency).length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <div className="space-y-0.5">
                        {Object.entries(account.nativeBalancesByCurrency).map(([currency, value]) => (
                          <div key={currency}>{formatTransactionAmount(value, currency)}</div>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatHistoricalBaseAmount(account.historicalBaseBalance)}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {account.currentTranslatedBaseBalance === null
                      ? "Unresolved"
                      : formatHistoricalBaseAmount(account.currentTranslatedBaseBalance)}
                  </TableCell>
                  <TableCell className="text-right">
                    {account.translationDifference === null
                      ? "—"
                      : formatHistoricalBaseAmount(account.translationDifference)}
                  </TableCell>
                  <TableCell>
                    {account.totalsProvisional ? (
                      <div className="space-y-1 text-xs">
                        <Badge variant="destructive">Review</Badge>
                        {account.openingBalanceCurrencyUnresolved && <div>Opening currency missing</div>}
                        {account.unresolvedLegacyEntryCount > 0 && (
                          <div>{account.unresolvedLegacyEntryCount} legacy entr{account.unresolvedLegacyEntryCount === 1 ? "y" : "ies"}</div>
                        )}
                        {account.currentRateMissing && <div>Current CFA rate missing</div>}
                        {account.unresolvedTranslationCurrencies.length > 0 && (
                          <div>Unsupported: {account.unresolvedTranslationCurrencies.join(", ")}</div>
                        )}
                      </div>
                    ) : (
                      <Badge variant="outline">Current</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
