import { useState } from "react";
import {
  RefreshCw,
  Calculator,
  Building2,
  Loader2,
  Database,
  Trash2,
  AlertTriangle,
  PieChart,
  ShieldCheck,
  Layers,
  ScanSearch,
  Info,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ZeroBalancesDialog, InitializeBalancesDialog } from "./AccountingRepairDialogs";
import { CleanEmptyAccountsDialog } from "./CleanEmptyAccountsDialog";
import { FixPOCreditsDialog, ResetCompanyDataDialog } from "./SystemMaintenanceDialogs";
import { useLocation } from "wouter";

interface SystemToolsTabProps {
  appMode: string;
  currentUser: any;
  selectedCompany: any;
  companies: any[];
}

interface ToolCard {
  category: string;
  categoryColor: string;
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
  testId?: string;
}

export function SystemToolsTab({ appMode, currentUser, selectedCompany, companies }: SystemToolsTabProps) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const isDev = currentUser?.role === "Developer";
  const isFactory = appMode === "factory";

  const [isZeroBalanceDialogOpen, setIsZeroBalanceDialogOpen] = useState(false);
  const [isInitBalancesDialogOpen, setIsInitBalancesDialogOpen] = useState(false);
  const [isFixPOCreditsDialogOpen, setIsFixPOCreditsDialogOpen] = useState(false);
  const [isResetDataDialogOpen, setIsResetDataDialogOpen] = useState(false);
  const [emptyAccountsOpen, setEmptyAccountsOpen] = useState(false);

  const { data: parentCompanyData } = useQuery<{ parentCompanyId: number | null }>({
    queryKey: ["/api/system/parent-company"],
    enabled: ["Admin", "Owner", "Developer"].includes(currentUser?.role || ""),
  });

  const setParentCompanyMutation = useMutation({
    mutationFn: async (companyId: number | null) => apiRequest("POST", "/api/system/parent-company", { companyId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/system/parent-company"] });
      toast({ title: "Saved", description: "Parent company updated." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update parent company.", variant: "destructive" });
    },
  });

  const fixParentPOSupplierMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/fix-parent-po-supplier-entries", {});
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Done", description: data?.message || "Supplier entries fixed." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to fix supplier entries.", variant: "destructive" });
    },
  });

  const netPositionPath = isFactory ? "/factory/net-position-details" : "/net-position-details";

  const cards: ToolCard[] = [
    {
      category: "Recovery",
      categoryColor: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
      icon: <Trash2 className="h-6 w-6 text-rose-500" />,
      iconBg: "bg-rose-500/10",
      title: "Deleted Items",
      description: "Restore deleted records or permanently remove archived data.",
      actionLabel: "Open",
      onAction: () => navigate("/deleted-items"),
      testId: "card-deleted-items",
    },
    {
      category: "Accounting",
      categoryColor: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
      icon: <RefreshCw className="h-6 w-6 text-red-500" />,
      iconBg: "bg-red-500/10",
      title: "Zero Account Balances",
      description: "Reset opening balances for selected accounts in the current company.",
      actionLabel: "Zero Balances",
      onAction: () => setIsZeroBalanceDialogOpen(true),
      testId: "card-zero-balances",
    },
    {
      category: "Accounting",
      categoryColor: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
      icon: <Database className="h-6 w-6 text-blue-500" />,
      iconBg: "bg-blue-500/10",
      title: "Initialize Accounting",
      description: "Initial setup for companies with no accounting structure.",
      actionLabel: "Initialize",
      onAction: () => setIsInitBalancesDialogOpen(true),
      testId: "card-init-accounting",
    },
    {
      category: "Diagnostics",
      categoryColor: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
      icon: <ScanSearch className="h-6 w-6 text-amber-500" />,
      iconBg: "bg-amber-500/10",
      title: "Import Cycle Diagnostics",
      description: "Detect imbalance issues and troubleshoot import cycle problems.",
      actionLabel: "Run Check",
      onAction: () => navigate("/import-cycle-diagnostics"),
      testId: "card-import-cycle",
    },
    {
      category: "Diagnostics",
      categoryColor: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
      icon: <AlertTriangle className="h-6 w-6 text-amber-500" />,
      iconBg: "bg-amber-500/10",
      title: "Orphaned Vouchers",
      description: "Find and clean up charge vouchers for OTW containers.",
      actionLabel: "Diagnose",
      onAction: async () => {
        try {
          const response = await fetch("/api/debug/orphaned-charge-vouchers", {
            method: "GET",
            credentials: "include",
          });
          const result = await response.json();
          if (response.ok) {
            if (result.orphanedVoucherCount === 0) {
              toast({ title: "No Orphaned Vouchers", description: "All OTW containers have no leftover charge vouchers." });
            } else {
              toast({ title: `Found ${result.orphanedVoucherCount} orphaned voucher(s)`, description: `Total impact: ${result.totalImpact}`, variant: "destructive" });
            }
          } else {
            toast({ title: "Error", description: result.message, variant: "destructive" });
          }
        } catch (error: any) {
          toast({ title: "Error", description: error.message, variant: "destructive" });
        }
      },
      testId: "card-orphaned-vouchers",
    },
    {
      category: "Diagnostics",
      categoryColor: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
      icon: <Layers className="h-6 w-6 text-purple-500" />,
      iconBg: "bg-purple-500/10",
      title: "Container Analysis",
      description: "Analyze offloads for duplicates and quantity issues.",
      actionLabel: "Go to Analysis",
      onAction: () => navigate("/containers"),
      testId: "card-container-analysis",
    },
    {
      category: "Financials",
      categoryColor: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
      icon: <PieChart className="h-6 w-6 text-violet-500" />,
      iconBg: "bg-violet-500/10",
      title: "Net Position Details",
      description: "View income, expenses, and net position breakdowns by period.",
      actionLabel: "View Details",
      onAction: () => navigate(netPositionPath),
      testId: "card-net-position",
    },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <h2 className="text-2xl font-semibold">System Tools</h2>
          <Badge variant="secondary" className="text-xs">
            Admin Tools
          </Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          Manage recovery, diagnostics, and financial position insights.
        </p>
      </div>

      {/* Warning banner */}
      <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <span>
          System tools can affect company records, diagnostics, or user access. Use them carefully and review changes
          before confirming.
        </span>
      </div>

      {/* Tool cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {cards.map((card) => (
          <div
            key={card.testId}
            className="relative rounded-xl border bg-card p-5 flex flex-col gap-4"
            data-testid={card.testId}
          >
            {/* Category badge */}
            <span
              className={`absolute top-4 right-4 text-xs font-medium px-2 py-0.5 rounded-full ${card.categoryColor}`}
            >
              {card.category}
            </span>

            {/* Icon */}
            <div className={`w-11 h-11 rounded-lg flex items-center justify-center ${card.iconBg}`}>
              {card.icon}
            </div>

            {/* Text */}
            <div className="flex-1 space-y-1 pr-20">
              <h4 className="font-semibold text-sm">{card.title}</h4>
              <p className="text-sm text-muted-foreground leading-snug">{card.description}</p>
            </div>

            {/* Link-style action */}
            <button
              className="flex items-center gap-1 text-sm font-medium text-primary hover:underline w-fit"
              onClick={card.onAction}
              data-testid={`button-action-${card.testId}`}
            >
              {card.actionLabel} <span className="text-base leading-none">›</span>
            </button>
          </div>
        ))}
      </div>

      {/* Global Settings */}
      {["Admin", "Owner", "Developer"].includes(currentUser?.role || "") && (
        <div className="rounded-xl border bg-card p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-muted-foreground" />
            <h3 className="font-semibold">Global Settings</h3>
          </div>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h4 className="font-medium text-sm">Master Parent Company</h4>
              <p className="text-sm text-muted-foreground">The primary company for net position reporting.</p>
            </div>
            <div className="flex items-center gap-3">
              <Select
                value={parentCompanyData?.parentCompanyId?.toString() || "none"}
                onValueChange={(val) => setParentCompanyMutation.mutate(val === "none" ? null : parseInt(val))}
              >
                <SelectTrigger className="w-[240px]" data-testid="select-parent-company">
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
        </div>
      )}

      {/* Advanced Maintenance (Developer only) */}
      {isDev && (
        <div className="pt-2 border-t space-y-4">
          <div className="flex items-center gap-2 px-1">
            <Wrench className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-medium text-sm uppercase tracking-wider text-muted-foreground">Advanced Maintenance</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Card className="p-4">
              <h4 className="font-semibold text-sm mb-1">Fix Inter-Company</h4>
              <p className="text-xs text-muted-foreground mb-3">
                Manage credit management between subsidiaries and parent.
              </p>
              <Button size="sm" variant="outline" className="w-full" onClick={() => setIsFixPOCreditsDialogOpen(true)}>
                Manage Credits
              </Button>
            </Card>

            <Card className="p-4">
              <h4 className="font-semibold text-sm mb-1">Reset Company Data</h4>
              <p className="text-xs text-muted-foreground mb-3">
                Clear vouchers and entries for a company (Preserves Master Data).
              </p>
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => setIsResetDataDialogOpen(true)}
              >
                Reset Data
              </Button>
            </Card>

            <Card className="p-4">
              <h4 className="font-semibold text-sm mb-1">Clean Empty Accounts</h4>
              <p className="text-xs text-muted-foreground mb-3">
                Bulk delete ledger accounts that have no transactions.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => setEmptyAccountsOpen(true)}
              >
                Clean Accounts
              </Button>
            </Card>

            <Card className="p-4">
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

      {/* Dialogs */}
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
