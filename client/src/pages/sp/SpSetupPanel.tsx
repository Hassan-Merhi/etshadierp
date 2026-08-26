import type { ClientErrorLike } from "@/lib/clientError";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle, Loader2, Zap, ShieldCheck, Landmark } from "lucide-react";

interface GoldenCoastRoleStatus {
  role: string;
  expectedName: string;
  expectedAccountType: string;
  status: "ok" | "missing" | "needs_repair";
  code: string | null;
  name: string | null;
  accountType: string | null;
  openingBalanceTargetUsd: string | null;
  ownershipSharePct: string | null;
  issues: string[];
  warnings: string[];
}

interface GoldenCoastSetupStatus {
  isConfigured: boolean;
  requiredRoleCount: number;
  configuredRoleCount: number;
  roles: GoldenCoastRoleStatus[];
}

interface SetupConfirmationPayload {
  confirmation: "CHANGE SP SETUP";
  reason: string;
  idempotencyKey: string;
}

function createFreshIdempotencyKey(scope: string): string {
  const uuid = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : null;
  return uuid ? `${scope}:${uuid}` : `${scope}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function requestSetupConfirmation(actionLabel: string): SetupConfirmationPayload | null {
  if (typeof window === "undefined") return null;
  const confirmation = window.prompt(`${actionLabel}\n\nType exactly: CHANGE SP SETUP`);
  if (confirmation == null) return null;
  if (confirmation.trim() !== "CHANGE SP SETUP") {
    window.alert("Confirmation did not match. Type exactly: CHANGE SP SETUP");
    return null;
  }

  const reason =
    window.prompt("Enter a meaningful reason for this setup change (at least 5 characters):")?.trim() ?? "";
  if (reason.length < 5) {
    window.alert("A meaningful reason of at least 5 characters is required.");
    return null;
  }

  return {
    confirmation: "CHANGE SP SETUP",
    reason,
    idempotencyKey: createFreshIdempotencyKey("sp-setup"),
  };
}

export default function SpSetupPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: status, isLoading } = useQuery<any>({
    queryKey: ["/api/sp/setup/status"],
  });

  const setupMutation = useMutation({
    mutationFn: async (payload: SetupConfirmationPayload) => {
      const response = await apiRequest("POST", "/api/sp/setup", payload);
      return response.json();
    },
    onSuccess: (data) => {
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
    onError: (e: ClientErrorLike) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const goldenCoastMutation = useMutation({
    mutationFn: async (payload: SetupConfirmationPayload) => {
      const response = await apiRequest("POST", "/api/sp/setup/golden-coast", payload);
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sp/setup/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts"] });

      const messages: string[] = [];
      if (data.created?.length > 0) messages.push(`Created ${data.created.length} account(s).`);
      if (data.repaired?.length > 0) messages.push(`Repaired ${data.repaired.length} account(s).`);
      if (data.settingsChanged?.length > 0) messages.push(`Bound ${data.settingsChanged.join(", ")}.`);

      toast({
        title: "Golden Coast accounts provisioned",
        description: messages.join(" ") || "All Golden Coast accounts were already configured.",
      });
    },
    onError: (e: ClientErrorLike) => toast({ title: "Error", description: e.message, variant: "destructive" }),
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
  const goldenCoast: GoldenCoastSetupStatus | undefined = status?.goldenCoast;
  const goldenCoastRoles: GoldenCoastRoleStatus[] = goldenCoast?.roles ?? [];

  return (
    <div className="max-w-2xl space-y-6">
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
              <span>
                No bank accounts found. Add at least one bank account for prepaid payments and sales receipts.
              </span>
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
            onClick={() => {
              const payload = requestSetupConfirmation(
                status?.isConfigured ? "Repair and re-run Supplier Partner setup" : "Initialize Supplier Partner setup"
              );
              if (payload) setupMutation.mutate(payload);
            }}
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
              <CardTitle className="text-base">Golden Coast Balance Sheet Accounts</CardTitle>
              <CardDescription className="text-xs mt-1">
                {goldenCoast?.configuredRoleCount ?? 0} of {goldenCoast?.requiredRoleCount ?? 0} partner, stock and
                settlement roles provisioned for this company
              </CardDescription>
            </div>
            {goldenCoast?.isConfigured ? (
              <Badge variant="outline" className="text-green-600 border-green-600/40">
                <CheckCircle2 className="h-3 w-3 mr-1" /> Configured
              </Badge>
            ) : (
              <Badge variant="outline" className="text-amber-600 border-amber-600/40">
                <AlertCircle className="h-3 w-3 mr-1" /> Action needed
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {goldenCoastRoles.length > 0 && (
            <div className="grid gap-1.5">
              {goldenCoastRoles.map((role) => (
                <div
                  key={role.role}
                  className="flex items-start justify-between gap-3 text-sm py-1.5 border-b border-border/40 last:border-0"
                  data-testid={`row-gc-role-${role.role}`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {role.status === "ok" ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />
                      ) : (
                        <AlertCircle className="h-3.5 w-3.5 text-amber-600 flex-shrink-0" />
                      )}
                      <span className="font-medium">{role.name ?? role.expectedName}</span>
                      <span className="font-mono text-xs text-muted-foreground">{role.code ?? "not created"}</span>
                      {role.openingBalanceTargetUsd && (
                        <Badge variant="secondary" className="text-xs py-0">
                          opening ${Number(role.openingBalanceTargetUsd).toLocaleString()}
                        </Badge>
                      )}
                      {role.ownershipSharePct && (
                        <Badge variant="secondary" className="text-xs py-0">
                          {role.ownershipSharePct}% share
                        </Badge>
                      )}
                    </div>
                    {role.issues?.length > 0 && (
                      <p className="text-xs text-amber-600 mt-0.5">{role.issues.join(" · ")}</p>
                    )}
                    {role.warnings?.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-0.5">{role.warnings.join(" · ")}</p>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {role.accountType ?? role.expectedAccountType}
                  </span>
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Opening balances are configuration targets only. The September 1, 2026 cutover posting is handled by a later
            phase.
          </p>

          <Button
            onClick={() => {
              const payload = requestSetupConfirmation(
                goldenCoast?.isConfigured ? "Re-verify Golden Coast accounts" : "Provision Golden Coast accounts"
              );
              if (payload) goldenCoastMutation.mutate(payload);
            }}
            disabled={goldenCoastMutation.isPending}
            data-testid="button-gc-setup"
          >
            {goldenCoastMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Landmark className="h-4 w-4 mr-2" />
            )}
            {goldenCoast?.isConfigured ? "Re-verify Golden Coast Accounts" : "Provision Golden Coast Accounts"}
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
              <span className="font-medium">Cr GC Sales Cash</span> (formerly Supplier Cash Payable) = full customer
              payment
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
