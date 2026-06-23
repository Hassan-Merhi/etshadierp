import {
  Trash2,
  AlertTriangle,
  RefreshCw,
  Calculator,
  Package,
  Building2,
  Loader2,
  Eraser,
  Search,
  Check,
  Info,
  Database,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UseMutationResult } from "@tanstack/react-query";
import { ParentCreditAccountSelect } from "./ParentCreditAccountSelect";
import { formatNumber } from "@/lib/formatNumber";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ZeroBalancesDialog, InitializeBalancesDialog } from "./AccountingRepairDialogs";
import { CleanEmptyAccountsDialog } from "./CleanEmptyAccountsDialog";
import { FixPOCreditsDialog, ResetCompanyDataDialog } from "./SystemMaintenanceDialogs";
import { DiagnosticsSection } from "./DiagnosticsSection";

interface SystemToolsTabProps {
  appMode: string;
  currentUser: any;
  selectedCompany: any;
  companies: any[];
  isRecalcAllLoading: boolean;
  setIsRecalcAllLoading: (v: boolean) => void;
  orphanedChargesDiagnostic: any;
  setOrphanedChargesDiagnostic: (v: any) => void;
  isFixingOrphanedCharges: boolean;
  setIsFixingOrphanedCharges: (v: boolean) => void;
  orphanedPosSalesDiagnostic: any;
  setOrphanedPosSalesDiagnostic: (v: any) => void;
  isFixingOrphanedPosSales: boolean;
  setIsFixingOrphanedPosSales: (v: boolean) => void;
  isLoadingOrphanedPosSales: boolean;
  setIsLoadingOrphanedPosSales: (v: boolean) => void;
  selectedContainerForDiag: string;
  setSelectedContainerForDiag: (v: string) => void;
  containersForDiag: any[];
  containerDiagResult: any;
  setContainerDiagResult: (v: any) => void;
  isLoadingContainerDiag: boolean;
  setIsLoadingContainerDiag: (v: boolean) => void;
  isZeroBalanceDialogOpen: boolean;
  setIsZeroBalanceDialogOpen: (v: boolean) => void;
  selectedAccountsToZero: number[];
  setSelectedAccountsToZero: (v: number[]) => void;
  allLedgerAccounts: any[];
  zeroBalancesMutation: UseMutationResult<any, any, any>;
  isInitBalancesDialogOpen: boolean;
  setIsInitBalancesDialogOpen: (v: boolean) => void;
  initBalancesResult: any;
  setInitBalancesResult: (v: any) => void;
  initializeBalancesMutation: UseMutationResult<any, any, any>;
  isFixPOCreditsDialogOpen: boolean;
  setIsFixPOCreditsDialogOpen: (v: boolean) => void;
  selectedCompanyForFix: string;
  setSelectedCompanyForFix: (v: string) => void;
  selectedParentCompanyForFix: string;
  setSelectedParentCompanyForFix: (v: string) => void;
  fixPOCreditsResult: any;
  setFixPOCreditsResult: (v: any) => void;
  fixPOCreditsMutation: UseMutationResult<any, any, any>;
  reversePOCreditsResult: any;
  setReversePOCreditsResult: (v: any) => void;
  reversePOCreditsMutation: UseMutationResult<any, any, any>;
  isResetDataDialogOpen: boolean;
  setIsResetDataDialogOpen: (v: boolean) => void;
  selectedCompanyForReset: string;
  setSelectedCompanyForReset: (v: string) => void;
  resetDataResult: any;
  setResetDataResult: (v: any) => void;
  resetCompanyDataMutation: UseMutationResult<any, any, any>;
  emptyAccountsOpen: boolean;
  setEmptyAccountsOpen: (v: boolean) => void;
  emptyAccounts: any[];
  isLoadingEmptyAccounts: boolean;
  emptyAccountsSelected: number[];
  setEmptyAccountsSelected: (v: number[]) => void;
  emptyAccountsFilter: string;
  setEmptyAccountsFilter: (v: string) => void;
  bulkDeleteAccountsMutation: UseMutationResult<any, any, any>;
  queryClient: any;
  toast: any;
  modeApiRequest: any;
  setParentCompanyMutation: UseMutationResult<any, any, any>;
  parentCompanyData: any;
  fixParentPOSupplierMutation: UseMutationResult<any, any, any>;
}

export function SystemToolsTab({
  appMode,
  currentUser,
  selectedCompany,
  companies,
  isRecalcAllLoading,
  setIsRecalcAllLoading,
  orphanedChargesDiagnostic,
  setOrphanedChargesDiagnostic,
  isFixingOrphanedCharges,
  setIsFixingOrphanedCharges,
  orphanedPosSalesDiagnostic,
  setOrphanedPosSalesDiagnostic,
  isFixingOrphanedPosSales,
  setIsFixingOrphanedPosSales,
  isLoadingOrphanedPosSales,
  setIsLoadingOrphanedPosSales,
  selectedContainerForDiag,
  setSelectedContainerForDiag,
  containersForDiag,
  containerDiagResult,
  setContainerDiagResult,
  isLoadingContainerDiag,
  setIsLoadingContainerDiag,
  isZeroBalanceDialogOpen,
  setIsZeroBalanceDialogOpen,
  selectedAccountsToZero,
  setSelectedAccountsToZero,
  allLedgerAccounts,
  zeroBalancesMutation,
  isInitBalancesDialogOpen,
  setIsInitBalancesDialogOpen,
  initBalancesResult,
  setInitBalancesResult,
  initializeBalancesMutation,
  isFixPOCreditsDialogOpen,
  setIsFixPOCreditsDialogOpen,
  selectedCompanyForFix,
  setSelectedCompanyForFix,
  selectedParentCompanyForFix,
  setSelectedParentCompanyForFix,
  fixPOCreditsResult,
  setFixPOCreditsResult,
  fixPOCreditsMutation,
  reversePOCreditsResult,
  setReversePOCreditsResult,
  reversePOCreditsMutation,
  isResetDataDialogOpen,
  setIsResetDataDialogOpen,
  selectedCompanyForReset,
  setSelectedCompanyForReset,
  resetDataResult,
  setResetDataResult,
  resetCompanyDataMutation,
  emptyAccountsOpen,
  setEmptyAccountsOpen,
  emptyAccounts,
  isLoadingEmptyAccounts,
  emptyAccountsSelected,
  setEmptyAccountsSelected,
  emptyAccountsFilter,
  setEmptyAccountsFilter,
  bulkDeleteAccountsMutation,
  queryClient,
  toast,
  modeApiRequest,
  setParentCompanyMutation,
  parentCompanyData,
  fixParentPOSupplierMutation,
}: SystemToolsTabProps) {
  const isDev = currentUser?.role === "Developer";
  const pfx = appMode === "factory" ? "/factory" : appMode === "properties" ? "/properties" : "";

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <h2 className="text-2xl font-semibold">System Tools</h2>
          <Badge variant="secondary" className="text-xs">
            Admin Tools
          </Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          Maintenance tools for database cleanup, diagnostics, and system-wide adjustments.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Accounting Management */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 px-1">
            <Calculator className="h-5 w-5 text-muted-foreground" />
            <h3 className="font-medium text-sm uppercase tracking-wider text-muted-foreground">Accounting</h3>
          </div>

          <Card className="p-6">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-red-500/10 rounded-lg">
                  <RefreshCw className="h-6 w-6 text-red-500" />
                </div>
                <div>
                  <h4 className="font-semibold" data-testid="text-zero-balances-title">
                    Zero Account Balances
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    Reset opening balances for selected accounts in the current company
                  </p>
                </div>
              </div>
              <Button
                onClick={() => {
                  setSelectedAccountsToZero([]);
                  setIsZeroBalanceDialogOpen(true);
                }}
                disabled={!selectedCompany}
                data-testid="button-zero-balances"
              >
                Zero Balances
              </Button>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-blue-500/10 rounded-lg">
                  <Database className="h-6 w-6 text-blue-500" />
                </div>
                <div>
                  <h4 className="font-semibold" data-testid="text-init-accounting-title">
                    Initialize Accounting
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    Initial setup for companies with no accounting structure
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                onClick={() => setIsInitBalancesDialogOpen(true)}
                data-testid="button-init-accounting"
              >
                Initialize
              </Button>
            </div>
          </Card>
        </div>

        <DiagnosticsSection setOrphanedChargesDiagnostic={setOrphanedChargesDiagnostic} toast={toast} />
      </div>

      {/* Advanced Admin Actions (Only for Developers) */}
      {isDev && (
        <div className="pt-6 border-t space-y-6">
          <div className="flex items-center gap-2 px-1">
            <RefreshCw className="h-5 w-5 text-muted-foreground" />
            <h3 className="font-medium text-sm uppercase tracking-wider text-muted-foreground">Advanced Maintenance</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Card className="p-4 border-l-4 border-l-rose-500">
              <h4 className="font-semibold text-sm mb-1">Fix Inter-Company</h4>
              <p className="text-xs text-muted-foreground mb-3">
                Manage credit management between subsidiaries and parent.
              </p>
              <Button size="sm" variant="outline" className="w-full" onClick={() => setIsFixPOCreditsDialogOpen(true)}>
                Manage Credits
              </Button>
            </Card>

            <Card className="p-4 border-l-4 border-l-orange-500">
              <h4 className="font-semibold text-sm mb-1">Reset Company Data</h4>
              <p className="text-xs text-muted-foreground mb-3">
                Clear vouchers and entries for a company (Preserves Master Data).
              </p>
              <Button
                size="sm"
                variant="outline"
                className="w-full text-orange-600 border-orange-200"
                onClick={() => setIsResetDataDialogOpen(true)}
              >
                Reset Data
              </Button>
            </Card>

            <Card className="p-4 border-l-4 border-l-cyan-500">
              <h4 className="font-semibold text-sm mb-1">Clean Empty Accounts</h4>
              <p className="text-xs text-muted-foreground mb-3">
                Bulk delete ledger accounts that have no transactions.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="w-full text-cyan-600 border-cyan-200"
                onClick={() => setEmptyAccountsOpen(true)}
              >
                Clean Accounts
              </Button>
            </Card>

            <Card className="p-4 border-l-4 border-l-blue-500">
              <h4 className="font-semibold text-sm mb-1">Fix Parent PO Supplier</h4>
              <p className="text-xs text-muted-foreground mb-3">
                Fix supplier entries in parent company for subsidiary POs.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => fixParentPOSupplierMutation.mutate()}
                disabled={fixParentPOSupplierMutation.isPending}
              >
                {fixParentPOSupplierMutation.isPending ? "Fixing..." : "Fix Supplier Entries"}
              </Button>
            </Card>
          </div>
        </div>
      )}

      {/* Parent Company Selection (Admin only) */}
      {["Admin", "Owner", "Developer"].includes(currentUser?.role || "") && (
        <Card className="mt-8 border-primary/20 bg-primary/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              Global Settings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <h4 className="font-medium">Master Parent Company</h4>
                <p className="text-sm text-muted-foreground">The primary company for net position reporting.</p>
              </div>
              <div className="flex items-center gap-3">
                <Select
                  value={parentCompanyData?.parentCompanyId?.toString() || "none"}
                  onValueChange={(val) => setParentCompanyMutation.mutate(val === "none" ? null : parseInt(val))}
                >
                  <SelectTrigger className="w-[240px] bg-background">
                    <SelectValue placeholder="No parent company set" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None (Disabled)</SelectItem>
                    {companies.map((c) => (
                      <SelectItem key={c.id} value={c.id.toString()}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {setParentCompanyMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ALL DIALOGS (Extracted from the main Settings page) */}

      <ZeroBalancesDialog
        open={isZeroBalanceDialogOpen}
        onOpenChange={setIsZeroBalanceDialogOpen}
        companyId={selectedCompany?.id}
      />

      <InitializeBalancesDialog open={isInitBalancesDialogOpen} onOpenChange={setIsInitBalancesDialogOpen} />

      <FixPOCreditsDialog
        open={isFixPOCreditsDialogOpen}
        onOpenChange={setIsFixPOCreditsDialogOpen}
        companies={companies}
      />

      <ResetCompanyDataDialog
        open={isResetDataDialogOpen}
        onOpenChange={setIsResetDataDialogOpen}
        companies={companies}
      />

      <CleanEmptyAccountsDialog
        open={emptyAccountsOpen}
        onOpenChange={setEmptyAccountsOpen}
        companyId={selectedCompany?.id}
      />
    </div>
  );
}
