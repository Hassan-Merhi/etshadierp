import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { useCompany } from "@/contexts/CompanyContext";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

const ALLOWED_ROLES = new Set(["Admin", "Owner", "Developer"]);

interface UnresolvedOpening {
  entity_type: "ledger" | "bank" | "customer" | "supplier" | "employee" | "fixedAsset";
  id: number;
  name: string;
  code: string;
  raw_amount: string;
  side: "Dr" | "Cr";
  native_amount: string | null;
  currency: string | null;
  historical_rate: string | null;
  base_amount: string | null;
}

interface Draft {
  currency: string;
  historicalRate: string;
  nativeAmount: string;
}

export function HistoricalOpeningResolver() {
  const { selectedCompany } = useCompany();
  const { toast } = useToast();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const authorized = Boolean(selectedCompany?.role && ALLOWED_ROLES.has(selectedCompany.role));
  const query = useQuery<UnresolvedOpening[]>({
    queryKey: ["/api/accounts/multi-currency/unresolved-openings"],
    enabled: authorized,
    staleTime: 30_000,
  });

  const rows = query.data || [];
  const rowKeys = useMemo(() => new Set(rows.map((row) => `${row.entity_type}:${row.id}`)), [rows]);

  const mutation = useMutation({
    mutationFn: async ({ row, draft }: { row: UnresolvedOpening; draft: Draft }) => {
      const currency = draft.currency.trim().toUpperCase();
      return apiRequest(
        "PUT",
        `/api/accounts/multi-currency/opening-balance/${row.entity_type}/${row.id}`,
        {
          nativeAmount: draft.nativeAmount,
          currency,
          historicalRate: currency === "USD" ? "1" : draft.historicalRate,
          side: row.side,
        },
      );
    },
    onSuccess: (_data, variables) => {
      toast({
        title: "Historical value resolved",
        description: `${variables.row.name} now preserves its reviewed native amount and historical base value.`,
      });
      const key = `${variables.row.entity_type}:${variables.row.id}`;
      setDrafts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      for (const queryKey of [
        ["/api/accounts/multi-currency/unresolved-openings"],
        ["/api/accounts/multi-currency/readiness"],
        ["/api/accounts/multi-currency/repair-center"],
        ["/api/accounts/multi-currency/cash-bank-revaluation"],
        ["/api/ledger-accounts"],
        ["/api/bank-accounts"],
      ]) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Could not resolve historical value",
        description: error?.message || "Check the original amount, currency, and historical rate.",
        variant: "destructive",
      });
    },
  });

  if (!authorized) return null;

  if (query.isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking historical opening values…
        </CardContent>
      </Card>
    );
  }

  if (query.error) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Historical values unavailable</AlertTitle>
        <AlertDescription>{query.error instanceof Error ? query.error.message : "Unable to load unresolved values."}</AlertDescription>
      </Alert>
    );
  }

  if (rows.length === 0) {
    return (
      <Alert>
        <CheckCircle2 className="h-4 w-4" />
        <AlertTitle>Opening and acquisition values resolved</AlertTitle>
        <AlertDescription>No unresolved ledger, bank, customer, supplier, employee, or fixed-asset values remain.</AlertDescription>
      </Alert>
    );
  }

  return (
    <Card data-testid="historical-opening-resolver">
      <CardHeader>
        <CardTitle className="text-base">Resolve Historical Opening & Asset Values</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Manual review required</AlertTitle>
          <AlertDescription>
            Confirm the original native amount and currency from the source document, then enter its historical transaction-per-base rate. Persisted metadata is used only as a starting point; the raw legacy amount is never assumed to be native or base currency.
          </AlertDescription>
        </Alert>

        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Raw legacy amount</TableHead>
                <TableHead>Reviewed native amount</TableHead>
                <TableHead>Original currency</TableHead>
                <TableHead>Historical rate</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const key = `${row.entity_type}:${row.id}`;
                const draft = drafts[key] || {
                  currency: row.currency || "",
                  historicalRate: row.historical_rate || "",
                  nativeAmount: row.native_amount || row.raw_amount || "",
                };
                const normalizedCurrency = draft.currency.trim().toUpperCase();
                const isSaving = mutation.isPending && mutation.variables?.row.entity_type === row.entity_type && mutation.variables?.row.id === row.id;
                const invalidCurrency = normalizedCurrency.length < 3;
                const invalidNativeAmount = !draft.nativeAmount || !Number.isFinite(Number(draft.nativeAmount)) || Number(draft.nativeAmount) < 0;
                const invalidRate = normalizedCurrency !== "USD" && (!draft.historicalRate || Number(draft.historicalRate) <= 0);
                return (
                  <TableRow key={key}>
                    <TableCell className="capitalize">{row.entity_type === "fixedAsset" ? "Fixed asset" : row.entity_type}</TableCell>
                    <TableCell>
                      <div className="font-medium">{row.name}</div>
                      <div className="text-xs text-muted-foreground">{row.code || `#${row.id}`} · {row.side}</div>
                    </TableCell>
                    <TableCell className="font-mono">{Number(row.raw_amount || 0).toLocaleString()}</TableCell>
                    <TableCell className="min-w-[180px]">
                      <Label className="sr-only">Reviewed native amount</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.000001"
                        value={draft.nativeAmount}
                        onChange={(event) =>
                          setDrafts((current) => ({ ...current, [key]: { ...draft, nativeAmount: event.target.value } }))
                        }
                      />
                    </TableCell>
                    <TableCell className="min-w-[140px]">
                      <Label className="sr-only">Original currency</Label>
                      <Input
                        value={draft.currency}
                        placeholder="USD, CFA, EUR…"
                        maxLength={3}
                        onChange={(event) =>
                          setDrafts((current) => ({ ...current, [key]: { ...draft, currency: event.target.value } }))
                        }
                      />
                    </TableCell>
                    <TableCell className="min-w-[180px]">
                      {normalizedCurrency === "USD" ? (
                        <span className="text-sm text-muted-foreground">1.0000000000</span>
                      ) : (
                        <div className="space-y-1">
                          <Label className="sr-only">Historical transaction-per-base rate</Label>
                          <Input
                            type="number"
                            min="0.0000000001"
                            step="0.0000000001"
                            placeholder="e.g. 600"
                            value={draft.historicalRate}
                            onChange={(event) =>
                              setDrafts((current) => ({
                                ...current,
                                [key]: { ...draft, historicalRate: event.target.value },
                              }))
                            }
                          />
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        disabled={isSaving || invalidCurrency || invalidNativeAmount || invalidRate || !rowKeys.has(key)}
                        onClick={() => mutation.mutate({ row, draft })}
                      >
                        {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Resolve
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
