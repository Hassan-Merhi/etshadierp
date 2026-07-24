import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle, Loader2, Zap, ShieldCheck } from "lucide-react";

export default function SpSetup() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: status, isLoading } = useQuery<any>({
    queryKey: ["/api/sp/setup/status"],
  });

  const setupMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/sp/setup");
      return response.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sp/setup/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts"] });

      const messages: string[] = [];
      if (data.created?.length > 0) messages.push(`Created: ${data.created.join(", ")}.`);
      if (data.repairedSupplierVoucherLinks > 0) {
        messages.push(
          `Repaired ${data.repairedSupplierVoucherLinks} Goods-OTW voucher supplier link${
            data.repairedSupplierVoucherLinks === 1 ? "" : "s"
          }.`
        );
      }

      toast({
        title: "Supplier Partner setup complete",
        description: messages.join(" ") || "Accounts, warehouse, and supplier ledger links are already configured.",
      });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const requiredAccountCount = status?.requiredAccountCount ?? status?.spAccounts?.length ?? 0;
  const supplierLinkGapCount = Number(status?.supplierVoucherLinkGapCount ?? 0);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Supplier Partner Setup</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Initialize the SP chart of accounts, default warehouse, and supplier-ledger synchronization.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle className="text-base">Chart of Accounts</CardTitle>
              <CardDescription className="text-xs mt-1">
                {requiredAccountCount} accounts required for the complete SP accounting flow
              </CardDescription>
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
                    <span className="font-mono text-xs text-muted-foreground w-24">{acct.code}</span>
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
              <span>No bank accounts found. Add at least one bank account for prepaid payments and sales receipts.</span>
            </div>
          )}

          {supplierLinkGapCount > 0 ? (
            <div className="flex items-start gap-2 text-sm text-amber-600 bg-amber-50 dark:bg-amber-950/20 rounded-md p-3">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>
                {supplierLinkGapCount} Goods-OTW voucher{supplierLinkGapCount === 1 ? "" : "s"} need supplier-ledger
                repair. Re-run Setup to fix them safely.
              </span>
            </div>
          ) : (
            <div className="flex items-start gap-2 text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/20 rounded-md p-3">
              <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>Container suppliers and Goods-OTW voucher headers are synchronized.</span>
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
            {status?.isConfigured ? "Repair & Re-run Setup" : "Initialize Setup"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle className="text-base">SP POS Accounting Policy</CardTitle>
              <CardDescription className="text-xs mt-1">
                The dedicated Supplier Partner sales flow applies this entry automatically.
              </CardDescription>
            </div>
            <Badge variant="outline" className="text-green-600 border-green-600/40">
              <ShieldCheck className="h-3 w-3 mr-1" /> Automatic
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-md bg-muted/40 p-3 text-sm space-y-1">
            <p>
              <span className="font-medium">Dr Cash / Bank</span> = full customer payment
            </p>
            <p>
              <span className="font-medium">Cr Supplier Cash Payable</span> = full customer payment
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            Cost of goods and realized profit are retained on SP sale lines and stock movements for reporting. They are
            not posted as extra voucher lines, preventing the sale amount from being double-counted.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
