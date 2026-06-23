import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle, Loader2, Zap, Save } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

export default function SpSetup() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: status, isLoading } = useQuery<any>({
    queryKey: ["/api/sp/setup/status"],
  });

  const { data: companySettings, isLoading: isSettingsLoading } = useQuery<any>({
    queryKey: ["/api/company-settings"],
  });

  const { data: ledgerAccounts = [], isLoading: isAccountsLoading } = useQuery<any[]>({
    queryKey: ["/api/ledger-accounts"],
  });

  const [selectedPayableId, setSelectedPayableId] = useState<string>("");
  const [selectedProfitId, setSelectedProfitId] = useState<string>("");

  const payableId = selectedPayableId || String(companySettings?.spPosPayableAccountId ?? "");
  const profitId = selectedProfitId || String(companySettings?.spPosProfitAccountId ?? "");

  const setupMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/sp/setup"),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sp/setup/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts"] });
      toast({
        title: "Setup complete",
        description: data.created?.length > 0 ? `Created: ${data.created.join(", ")}` : "Already fully configured.",
      });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const savePosAccountsMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/company-settings", {
        spPosPayableAccountId: payableId ? parseInt(payableId) : null,
        spPosProfitAccountId: profitId ? parseInt(profitId) : null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-settings"] });
      toast({ title: "Saved", description: "POS accounting accounts updated." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const isPosConfigured = !!companySettings?.spPosPayableAccountId && !!companySettings?.spPosProfitAccountId;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Supplier Partner Setup</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Initialize the chart of accounts and default warehouse for this company.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle className="text-base">Chart of Accounts</CardTitle>
              <CardDescription className="text-xs mt-1">9 accounts required for SP accounting flow</CardDescription>
            </div>
            {status?.isConfigured ? (
              <Badge variant="outline" className="text-green-600 border-green-600/40">
                <CheckCircle2 className="h-3 w-3 mr-1" /> Configured
              </Badge>
            ) : (
              <Badge variant="outline" className="text-amber-600 border-amber-600/40">
                <AlertCircle className="h-3 w-3 mr-1" /> Not set up
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {status?.spAccounts && status.spAccounts.length > 0 && (
            <div className="grid gap-1.5">
              {status.spAccounts.map((acct: any) => (
                <div
                  key={acct.id}
                  className="flex items-center justify-between text-sm py-1 border-b border-border/40 last:border-0"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground w-20">{acct.code}</span>
                    <span>{acct.name}</span>
                    {acct.isHidden && (
                      <Badge variant="secondary" className="text-xs py-0">
                        hidden
                      </Badge>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">{acct.accountType}</span>
                </div>
              ))}
            </div>
          )}

          {status?.locations && status.locations.length > 0 && (
            <div className="text-sm">
              <span className="text-muted-foreground">Warehouse: </span>
              <span className="font-medium">{status.locations[0].name}</span>
            </div>
          )}

          {status?.bankAccounts?.length === 0 && (
            <div className="flex items-start gap-2 text-sm text-amber-600 bg-amber-50 dark:bg-amber-950/20 rounded-md p-3">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>
                No bank accounts found. Add at least one bank account to record prepaid payments and sales receipts.
              </span>
            </div>
          )}

          <Button
            onClick={() => setupMutation.mutate()}
            disabled={setupMutation.isPending}
            data-testid="button-sp-setup"
          >
            {setupMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Zap className="h-4 w-4 mr-2" />
            )}
            {status?.isConfigured ? "Re-run Setup" : "Initialize Setup"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle className="text-base">POS Accounting Accounts</CardTitle>
              <CardDescription className="text-xs mt-1">
                Accounts used when recording POS sales for this supplier partner company. Each sale debits Cash and
                splits the credit between Supplier Payable (cost) and Profit.
              </CardDescription>
            </div>
            {isPosConfigured ? (
              <Badge variant="outline" className="text-green-600 border-green-600/40">
                <CheckCircle2 className="h-3 w-3 mr-1" /> Configured
              </Badge>
            ) : (
              <Badge variant="outline" className="text-amber-600 border-amber-600/40">
                <AlertCircle className="h-3 w-3 mr-1" /> Not configured
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {isAccountsLoading || isSettingsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading accounts…
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="payable-account">Supplier Payable Account (Cr cost)</Label>
                <Select value={payableId} onValueChange={setSelectedPayableId}>
                  <SelectTrigger id="payable-account" data-testid="select-sp-pos-payable-account">
                    <SelectValue placeholder="Select account…" />
                  </SelectTrigger>
                  <SelectContent>
                    {ledgerAccounts
                      .filter((a: any) => a.accountType === "Liability" || a.accountType === "Current Liability")
                      .map((a: any) => (
                        <SelectItem key={a.id} value={String(a.id)}>
                          <span className="font-mono text-xs text-muted-foreground mr-2">{a.code}</span>
                          {a.name}
                        </SelectItem>
                      ))}
                    {ledgerAccounts
                      .filter((a: any) => a.accountType !== "Liability" && a.accountType !== "Current Liability")
                      .map((a: any) => (
                        <SelectItem key={a.id} value={String(a.id)}>
                          <span className="font-mono text-xs text-muted-foreground mr-2">{a.code}</span>
                          {a.name}
                          <span className="ml-2 text-xs text-muted-foreground">({a.accountType})</span>
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="profit-account">POS Profit Account (Cr margin)</Label>
                <Select value={profitId} onValueChange={setSelectedProfitId}>
                  <SelectTrigger id="profit-account" data-testid="select-sp-pos-profit-account">
                    <SelectValue placeholder="Select account…" />
                  </SelectTrigger>
                  <SelectContent>
                    {ledgerAccounts
                      .filter((a: any) => a.accountType === "Income")
                      .map((a: any) => (
                        <SelectItem key={a.id} value={String(a.id)}>
                          <span className="font-mono text-xs text-muted-foreground mr-2">{a.code}</span>
                          {a.name}
                        </SelectItem>
                      ))}
                    {ledgerAccounts
                      .filter((a: any) => a.accountType !== "Income")
                      .map((a: any) => (
                        <SelectItem key={a.id} value={String(a.id)}>
                          <span className="font-mono text-xs text-muted-foreground mr-2">{a.code}</span>
                          {a.name}
                          <span className="ml-2 text-xs text-muted-foreground">({a.accountType})</span>
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground">Accounting entry per sale:</p>
                <p>
                  Dr Cash / Bank &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;=
                  Grand Total
                </p>
                <p>Cr Supplier Payable &nbsp;&nbsp;&nbsp;&nbsp; = Total Supplier Cost</p>
                <p>Cr Profit Account &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; = Grand Total − Cost</p>
              </div>

              <Button
                onClick={() => savePosAccountsMutation.mutate()}
                disabled={savePosAccountsMutation.isPending || !payableId || !profitId}
                data-testid="button-save-sp-pos-accounts"
              >
                {savePosAccountsMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save POS Accounts
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
