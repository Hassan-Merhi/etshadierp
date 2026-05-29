import { useState, useEffect, useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { factoryApiRequest } from "@/lib/factoryApi";
import { useToast } from "@/hooks/use-toast";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  User,
  Shield,
  Lock,
  Trash2,
  ChevronDown,
  ChevronRight,
  Check,
  X,
  Save,
  KeyRound,
} from "lucide-react";
import { FACTORY_NAV_PAGES } from "@/components/FactorySidebar";
import { FEATURE_KEYS, FEATURE_PAGE_INFO } from "@shared/schema";
import { UserRolesCard } from "./UserRolesCard";

const ALL_FACTORY_PAGES = FACTORY_NAV_PAGES;
const FACTORY_PAGE_GROUPS = Array.from(new Set(ALL_FACTORY_PAGES.map((p) => p.group)));
const ALL_ERP_PAGES: { key: string; label: string; group: string }[] = FEATURE_KEYS.map((key) => ({
  key,
  label: FEATURE_PAGE_INFO[key].label,
  group: FEATURE_PAGE_INFO[key].group,
}));
const ERP_PAGE_GROUPS = Array.from(new Set(ALL_ERP_PAGES.map((p) => p.group)));
const ERP_COST_FIELDS = [
  { key: "sales_profit_cost",         label: "Sales Cost/Profit Columns" },
  { key: "hide_export_selling_price", label: "Hide Selling Prices in Exports/Prints" },
  { key: "hide_export_cost_price",    label: "Hide Cost / Production Prices in Exports/Prints" },
];

const FACTORY_COST_FIELDS = [
  { key: "inventory_avg_rate", label: "Avg Rate Column" },
  { key: "inventory_total_value", label: "Total Value Column" },
  { key: "inventory_sell_price", label: "Sell Price Column" },
  { key: "inventory_sell_value", label: "Sell Value Column" },
  { key: "bale_history_cost_per_kg", label: "Cost/KG Column" },
  { key: "bale_history_total_cost", label: "Total Cost Column" },
  { key: "bales_list_cost_per_kg", label: "Cost/kg Column" },
  { key: "hide_proforma_price", label: "Price/Bale Column (Proformas)" },
];

const FACTORY_TABS: { key: string; label: string; group: string }[] = [
  { key: "hide_tab_workers_payroll",          label: "Payroll",                 group: "Workers Hub" },
  { key: "hide_tab_workers_attendance",       label: "Attendance",              group: "Workers Hub" },
  { key: "hide_tab_workers_report",           label: "Report",                  group: "Workers Hub" },
  { key: "hide_tab_workers_advances",         label: "Advances",                group: "Workers Hub" },
  { key: "hide_tab_workers_bonuses",          label: "Bonuses",                 group: "Workers Hub" },
  { key: "hide_tab_bales_barcode",            label: "Barcode Lookup",          group: "Bales Hub" },
  { key: "hide_tab_bales_remove",             label: "Remove from Stock",       group: "Bales Hub" },
  { key: "hide_tab_loadings_pending",         label: "Pending Loadings",        group: "Loadings Hub" },
  { key: "hide_tab_stockentry_entry",         label: "Stock Entry",             group: "Stock Entry" },
  { key: "hide_tab_stockentry_history",       label: "History",                 group: "Stock Entry" },
  { key: "hide_tab_stockentry_ground_scan",   label: "Ground Scan",             group: "Stock Entry" },
  { key: "hide_tab_stockentry_daily_scan",    label: "Daily Scan",              group: "Stock Entry" },
  { key: "hide_tab_advances_repayments",      label: "Repayments",              group: "Advances" },
  { key: "hide_tab_kpis_worker_performance",  label: "Worker Performance",      group: "KPIs" },
  { key: "hide_tab_kpis_mix_efficiency",      label: "Mix Efficiency",          group: "KPIs" },
  { key: "hide_tab_payroll_worker_master",    label: "Worker Master",           group: "Payroll" },
  { key: "hide_tab_profitability_containers", label: "Container Profitability", group: "Profitability" },
  { key: "hide_tab_workers_categories",       label: "Categories",              group: "Workers List" },
  { key: "hide_tab_workerdetail_statement",   label: "Statement",               group: "Worker Profile" },
  { key: "hide_tab_workerdetail_advances",    label: "Advances",                group: "Worker Profile" },
  { key: "hide_tab_workerdetail_bales",       label: "Bales",                   group: "Worker Profile" },
  { key: "hide_tab_workerdetail_documents",   label: "Documents",               group: "Worker Profile" },
  { key: "hide_tab_production_analytics",     label: "Overview",    group: "Sidebar Pages" },
  { key: "hide_tab_daybook",                  label: "Daybook",                 group: "Sidebar Pages" },
  { key: "hide_tab_agents",                   label: "Agent Ledger",            group: "Sidebar Pages" },
  { key: "hide_invoicing_proformas_tab",      label: "Proformas Tab",           group: "Invoicing" },
  { key: "hide_invoicing_proforma_col",       label: "Proforma Column",         group: "Invoicing" },
  { key: "hide_invoicing_totals_usd",         label: "Total Amounts (USD)",     group: "Invoicing" },
];
const FACTORY_TAB_GROUPS = Array.from(new Set(FACTORY_TABS.map((t) => t.group)));

interface UserManagementDrawerProps {
  user: any | null;
  open: boolean;
  onClose: () => void;
  companies: any[];
  onUserDeleted: () => void;
}

export function UserManagementDrawer({
  user,
  open,
  onClose,
  companies,
  onUserDeleted,
}: UserManagementDrawerProps) {
  const { toast } = useToast();
  const isPrivileged = ["admin", "owner", "developer"].includes(user?.role?.toLowerCase() ?? "");

  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [hasErpAccess, setHasErpAccess] = useState(true);
  const [hasFactoryAccess, setHasFactoryAccess] = useState(true);
  const [pageAccess, setPageAccess] = useState<Set<string>>(new Set());
  const [hiddenCostFields, setHiddenCostFields] = useState<string[]>([]);
  const [hiddenErpCostFields, setHiddenErpCostFields] = useState<string[]>([]);

  const [newPassword, setNewPassword] = useState("");
  const [showPasswordReset, setShowPasswordReset] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [openTabGroups, setOpenTabGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (user) {
      setUsername(user.username ?? "");
      setDisplayName(user.displayName ?? "");
      setHasErpAccess(isPrivileged ? true : (user.hasErpAccess ?? true));
      setHasFactoryAccess(isPrivileged ? true : (user.hasFactoryAccess ?? true));
      setPageAccess(new Set(user.pageAccess ?? []));
      setHiddenCostFields(user.hiddenCostFields ?? []);
      setNewPassword("");
      setShowPasswordReset(false);
      setAdvancedOpen(false);
    }
  }, [user?.id]);

  const { data: erpHiddenCostData } = useQuery<{ hiddenCostFields: string[] }>({
    queryKey: ["/api/erp-user-hidden-costs", user?.id],
    queryFn: async () => {
      const res = await fetch(`/api/erp-user-hidden-costs/${user?.id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch ERP hidden cost fields");
      return res.json();
    },
    enabled: !!user?.id,
  });

  useEffect(() => {
    if (erpHiddenCostData?.hiddenCostFields) {
      setHiddenErpCostFields(erpHiddenCostData.hiddenCostFields);
    }
  }, [erpHiddenCostData]);

  const updateMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await factoryApiRequest("PUT", `/api/factory/users/${user.id}`, data);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to update user");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/users"] });
      toast({ title: "Saved", description: "User updated successfully" });
      setNewPassword("");
      setShowPasswordReset(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await factoryApiRequest("DELETE", `/api/factory/users/${user.id}`, {});
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to remove user");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/users"] });
      toast({ title: "Removed", description: `${user.username} has been removed` });
      setConfirmDelete(false);
      onUserDeleted();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleSaveAccount = () => {
    updateMutation.mutate({
      username: username !== user.username ? username : undefined,
      displayName,
      password: newPassword || undefined,
    });
  };

  const handleSaveAccess = () => {
    updateMutation.mutate({
      hasErpAccess: isPrivileged ? true : hasErpAccess,
      hasFactoryAccess: isPrivileged ? true : hasFactoryAccess,
    });
  };

  const handleSaveRestrictions = () => {
    updateMutation.mutate({
      pageAccess: Array.from(pageAccess),
      hiddenCostFields: isPrivileged ? [] : hiddenCostFields,
    });
  };

  const togglePage = (key: string) => {
    setPageAccess((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const toggleGroup = (group: string, pages: { key: string }[]) => {
    const allSelected = pages.every((p) => pageAccess.has(p.key));
    setPageAccess((prev) => {
      const next = new Set(prev);
      pages.forEach((p) => (allSelected ? next.delete(p.key) : next.add(p.key)));
      return next;
    });
  };

  const toggleCostField = (key: string) => {
    setHiddenCostFields((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const toggleErpCostField = (key: string) => {
    setHiddenErpCostFields((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const saveErpRestrictionsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", `/api/erp-user-hidden-costs/${user.id}`, {
        hiddenCostFields: isPrivileged ? [] : hiddenErpCostFields,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to save ERP restrictions");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp-user-hidden-costs", user.id] });
      toast({ title: "Saved", description: "ERP cost field restrictions updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleSaveErpRestrictions = () => saveErpRestrictionsMutation.mutate();

  const toggleTabGroup = (group: string) => {
    setOpenTabGroups((prev) => {
      const next = new Set(prev);
      next.has(group) ? next.delete(group) : next.add(group);
      return next;
    });
  };

  const isDirty = useMemo(() => {
    if (!user) return false;
    const origPageAccess = new Set(user.pageAccess ?? []);
    const pageSetChanged =
      pageAccess.size !== origPageAccess.size ||
      Array.from(pageAccess).some((k) => !origPageAccess.has(k));
    const sortedCost = JSON.stringify([...hiddenCostFields].sort());
    const origSortedCost = JSON.stringify([...(user.hiddenCostFields ?? [])].sort());
    const sortedErp = JSON.stringify([...hiddenErpCostFields].sort());
    const origSortedErp = JSON.stringify([...(erpHiddenCostData?.hiddenCostFields ?? [])].sort());
    return (
      username !== (user.username ?? "") ||
      displayName !== (user.displayName ?? "") ||
      !!newPassword ||
      (!isPrivileged && hasErpAccess !== (user.hasErpAccess ?? true)) ||
      (!isPrivileged && hasFactoryAccess !== (user.hasFactoryAccess ?? true)) ||
      (!isPrivileged && pageSetChanged) ||
      (!isPrivileged && sortedCost !== origSortedCost) ||
      (!isPrivileged && sortedErp !== origSortedErp)
    );
  }, [user, username, displayName, newPassword, hasErpAccess, hasFactoryAccess, pageAccess, hiddenCostFields, hiddenErpCostFields, erpHiddenCostData, isPrivileged]);

  const handleSaveAll = () => {
    const payload: any = {
      displayName,
    };
    if (username !== user.username) payload.username = username;
    if (newPassword) payload.password = newPassword;
    if (!isPrivileged) {
      payload.hasErpAccess = hasErpAccess;
      payload.hasFactoryAccess = hasFactoryAccess;
      payload.pageAccess = Array.from(pageAccess);
      payload.hiddenCostFields = hiddenCostFields;
    }
    updateMutation.mutate(payload, {
      onSuccess: () => {
        if (!isPrivileged) saveErpRestrictionsMutation.mutate();
      },
    });
  };

  const handleDiscard = () => {
    if (!user) return;
    setUsername(user.username ?? "");
    setDisplayName(user.displayName ?? "");
    setHasErpAccess(isPrivileged ? true : (user.hasErpAccess ?? true));
    setHasFactoryAccess(isPrivileged ? true : (user.hasFactoryAccess ?? true));
    setPageAccess(new Set(user.pageAccess ?? []));
    setHiddenCostFields(user.hiddenCostFields ?? []);
    setHiddenErpCostFields(erpHiddenCostData?.hiddenCostFields ?? []);
    setNewPassword("");
    setShowPasswordReset(false);
  };

  if (!user) return null;

  const accessLabel =
    (isPrivileged || hasErpAccess) && (isPrivileged || hasFactoryAccess)
      ? "ERP + Factory"
      : isPrivileged || hasErpAccess
      ? "ERP only"
      : isPrivileged || hasFactoryAccess
      ? "Factory only"
      : "No access";

  const restrictionCount =
    (isPrivileged ? 0 : pageAccess.size) +
    (isPrivileged ? 0 : hiddenCostFields.length) +
    (isPrivileged ? 0 : hiddenErpCostFields.length);

  return (
    <>
      <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-[520px] p-0 flex flex-col"
        >
          <SheetHeader className="px-6 py-4 border-b shrink-0">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted font-bold text-base uppercase text-muted-foreground">
                {(user.displayName || user.username).charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <SheetTitle className="text-lg leading-tight">
                  {user.displayName || user.username}
                </SheetTitle>
                {user.displayName && (
                  <SheetDescription className="font-mono text-xs mt-0">
                    {user.username}
                  </SheetDescription>
                )}
              </div>
              {isPrivileged && (
                <Badge variant="default" className="capitalize gap-1 shrink-0">
                  <Shield className="h-3 w-3" />
                  {user.role}
                </Badge>
              )}
            </div>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto">
          <div className="px-6 py-4 space-y-4 pb-6">
            {/* Card 1: Account */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Account
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Username</Label>
                    <Input
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      data-testid="input-drawer-username"
                    />
                    {username !== user.username && (
                      <p className="text-xs text-muted-foreground">Will change on save</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Display Name</Label>
                    <Input
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Optional friendly name"
                      data-testid="input-drawer-display-name"
                    />
                  </div>
                </div>

                {showPasswordReset ? (
                  <div className="space-y-1.5">
                    <Label className="text-xs">New Password</Label>
                    <div className="flex gap-2">
                      <Input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Enter new password"
                        data-testid="input-drawer-new-password"
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => { setNewPassword(""); setShowPasswordReset(false); }}
                        data-testid="button-cancel-password-reset"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => setShowPasswordReset(true)}
                    data-testid="button-show-password-reset"
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                    Reset Password
                  </Button>
                )}

                {!isPrivileged && (
                  <div className="pt-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive gap-2"
                      onClick={() => setConfirmDelete(true)}
                      data-testid="button-delete-user"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove User
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Card 2: App Access */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Lock className="h-4 w-4" />
                  App Access
                  <Badge variant="secondary" className="ml-auto text-xs font-normal">
                    {accessLabel}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {isPrivileged ? (
                  <p className="text-xs text-muted-foreground rounded-md bg-muted/40 px-3 py-2.5">
                    <strong>{user.role}</strong> accounts always have full access to both ERP and Factory — this cannot be restricted.
                  </p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex items-center justify-between rounded-md border p-3">
                        <div>
                          <p className="text-sm font-medium">ERP</p>
                          <p className="text-xs text-muted-foreground">Accounting &amp; sales</p>
                        </div>
                        <Switch
                          checked={hasErpAccess}
                          onCheckedChange={setHasErpAccess}
                          data-testid="switch-drawer-erp-access"
                        />
                      </div>
                      <div className="flex items-center justify-between rounded-md border p-3">
                        <div>
                          <p className="text-sm font-medium">Factory</p>
                          <p className="text-xs text-muted-foreground">Production &amp; bales</p>
                        </div>
                        <Switch
                          checked={hasFactoryAccess}
                          onCheckedChange={setHasFactoryAccess}
                          data-testid="switch-drawer-factory-access"
                        />
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Card 3: Company Roles — inline editing, no modal */}
            <UserRolesCard userId={user?.id} companies={companies} />

            {/* Card 4: Advanced Restrictions */}
            <Card>
              <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                <CollapsibleTrigger asChild>
                  <CardHeader
                    className="pb-3 cursor-pointer select-none"
                    data-testid="button-toggle-advanced-restrictions"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <Shield className="h-4 w-4" />
                        Advanced Restrictions
                        {restrictionCount > 0 && (
                          <Badge variant="secondary" className="text-xs font-normal ml-1">
                            {restrictionCount} active
                          </Badge>
                        )}
                      </CardTitle>
                      <div className="text-muted-foreground">
                        {advancedOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </div>
                    </div>
                    {!advancedOpen && (() => {
                      const pageCount = isPrivileged ? 0 : pageAccess.size;
                      const costCount = isPrivileged ? 0 : hiddenCostFields.length;
                      const erpCount = isPrivileged ? 0 : hiddenErpCostFields.length;
                      const parts: string[] = [];
                      if (pageCount > 0) parts.push(`${pageCount} page${pageCount !== 1 ? "s" : ""} hidden`);
                      if (costCount > 0) parts.push(`${costCount} field${costCount !== 1 ? "s" : ""} hidden`);
                      if (erpCount > 0) parts.push(`${erpCount} ERP field${erpCount !== 1 ? "s" : ""} hidden`);
                      return (
                        <p className="text-xs text-muted-foreground font-normal mt-1">
                          {parts.length > 0 ? parts.join(" · ") : "No restrictions active — full access"}
                        </p>
                      );
                    })()}
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="space-y-5 pt-0">
                    {isPrivileged ? (
                      <p className="text-sm text-muted-foreground">
                        Admin / Owner accounts always have full access to all pages.
                      </p>
                    ) : (
                      <>
                        <div className="flex items-start gap-2 rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 px-3 py-2 text-xs text-blue-700 dark:text-blue-300">
                          <User className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          <span>
                            These restrictions apply to <strong>{user.username}</strong> personally — they override any role-level defaults for this user only.
                          </span>
                        </div>
                        {hasFactoryAccess && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Factory Pages
                              </p>
                              <div className="flex gap-1.5">
                                <Button variant="outline" size="sm" onClick={() => setPageAccess((prev) => new Set([...prev, ...ALL_FACTORY_PAGES.map((p) => p.key)]))} data-testid="button-factory-pages-all">
                                  <Check className="h-3 w-3 mr-1" />All
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => setPageAccess((prev) => { const next = new Set(prev); ALL_FACTORY_PAGES.forEach((p) => next.delete(p.key)); return next; })} data-testid="button-factory-pages-none">
                                  <X className="h-3 w-3 mr-1" />None
                                </Button>
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground">Checked pages will be <strong>hidden</strong> from this user. Leave all unchecked for full factory access.</p>
                            <div className="space-y-3 border rounded-md p-3 max-h-48 overflow-y-auto">
                              {FACTORY_PAGE_GROUPS.map((group) => {
                                const groupPages = ALL_FACTORY_PAGES.filter((p) => p.group === group);
                                const allSel = groupPages.every((p) => pageAccess.has(p.key));
                                const someSel = groupPages.some((p) => pageAccess.has(p.key));
                                return (
                                  <div key={group} className="space-y-1.5">
                                    <div className="flex items-center gap-2">
                                      <Checkbox checked={allSel} onCheckedChange={() => toggleGroup(group, groupPages)} data-testid={`checkbox-group-${group.toLowerCase().replace(/\s+/g, "-")}`} />
                                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</span>
                                      {someSel && !allSel && <Badge variant="secondary" className="text-xs">partial</Badge>}
                                    </div>
                                    <div className="ml-6 grid grid-cols-2 gap-1">
                                      {groupPages.map((page) => (
                                        <div key={page.key} className="flex items-center gap-2">
                                          <Checkbox checked={pageAccess.has(page.key)} onCheckedChange={() => togglePage(page.key)} data-testid={`checkbox-page-${page.key.replace(/\//g, "-")}`} />
                                          <span className="text-sm">{page.label}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {hasErpAccess && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">ERP Pages</p>
                              <div className="flex gap-1.5">
                                <Button variant="outline" size="sm" onClick={() => setPageAccess((prev) => new Set([...prev, ...ALL_ERP_PAGES.map((p) => p.key)]))} data-testid="button-erp-pages-all">
                                  <Check className="h-3 w-3 mr-1" />All
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => setPageAccess((prev) => { const next = new Set(prev); ALL_ERP_PAGES.forEach((p) => next.delete(p.key)); return next; })} data-testid="button-erp-pages-none">
                                  <X className="h-3 w-3 mr-1" />None
                                </Button>
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground">Checked pages will be <strong>hidden</strong> from this user. Leave all unchecked for full ERP access.</p>
                            <div className="space-y-3 border rounded-md p-3 max-h-48 overflow-y-auto">
                              {ERP_PAGE_GROUPS.map((group) => {
                                const groupPages = ALL_ERP_PAGES.filter((p) => p.group === group);
                                const allSel = groupPages.every((p) => pageAccess.has(p.key));
                                const someSel = groupPages.some((p) => pageAccess.has(p.key));
                                return (
                                  <div key={`erp-${group}`} className="space-y-1.5">
                                    <div className="flex items-center gap-2">
                                      <Checkbox checked={allSel} onCheckedChange={() => toggleGroup(group, groupPages)} data-testid={`checkbox-erp-group-${group.toLowerCase().replace(/\s+/g, "-")}`} />
                                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</span>
                                      {someSel && !allSel && <Badge variant="secondary" className="text-xs">partial</Badge>}
                                    </div>
                                    <div className="ml-6 grid grid-cols-2 gap-1">
                                      {groupPages.map((page) => (
                                        <div key={page.key} className="flex items-center gap-2">
                                          <Checkbox checked={pageAccess.has(page.key)} onCheckedChange={() => togglePage(page.key)} data-testid={`checkbox-erp-page-${page.key}`} />
                                          <span className="text-sm">{page.label}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {hasFactoryAccess && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Factory Tabs
                              </p>
                              <div className="flex gap-1.5">
                                <Button variant="outline" size="sm" onClick={() => {
                                  const allKeys = FACTORY_TABS.map((t) => t.key);
                                  setHiddenCostFields((prev) => Array.from(new Set([...prev, ...allKeys])));
                                }} data-testid="button-factory-tabs-hide-all">
                                  <X className="h-3 w-3 mr-1" />Hide All
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => {
                                  const allKeys = new Set(FACTORY_TABS.map((t) => t.key));
                                  setHiddenCostFields((prev) => prev.filter((k) => !allKeys.has(k)));
                                }} data-testid="button-factory-tabs-show-all">
                                  <Check className="h-3 w-3 mr-1" />Show All
                                </Button>
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground">Checked tabs will be hidden from this user.</p>
                            <div className="space-y-1">
                              {FACTORY_TAB_GROUPS.map((group) => {
                                const groupTabs = FACTORY_TABS.filter((t) => t.group === group);
                                const hiddenCount = groupTabs.filter((t) => hiddenCostFields.includes(t.key)).length;
                                const isOpen = openTabGroups.has(group);
                                return (
                                  <Collapsible key={group} open={isOpen} onOpenChange={() => toggleTabGroup(group)}>
                                    <CollapsibleTrigger asChild>
                                      <div className="flex items-center justify-between cursor-pointer select-none rounded-md px-2.5 py-1.5 bg-muted/30 hover-elevate" data-testid={`group-tabs-${group.toLowerCase().replace(/\s+/g, "-")}`}>
                                        <div className="flex items-center gap-2">
                                          {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                                          <span className="text-xs font-semibold">{group}</span>
                                          {hiddenCount > 0 && (
                                            <Badge variant="secondary" className="text-xs">{hiddenCount} hidden</Badge>
                                          )}
                                        </div>
                                        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                                          <Button variant="ghost" size="sm" className="h-6 text-xs px-2"
                                            onClick={() => setHiddenCostFields((prev) => Array.from(new Set([...prev, ...groupTabs.map((t) => t.key)])))}
                                            data-testid={`button-tabs-hide-all-${group}`}>
                                            Hide all
                                          </Button>
                                          <Button variant="ghost" size="sm" className="h-6 text-xs px-2"
                                            onClick={() => { const keys = new Set(groupTabs.map((t) => t.key)); setHiddenCostFields((prev) => prev.filter((k) => !keys.has(k))); }}
                                            data-testid={`button-tabs-show-all-${group}`}>
                                            Show all
                                          </Button>
                                        </div>
                                      </div>
                                    </CollapsibleTrigger>
                                    <CollapsibleContent>
                                      <div className="grid grid-cols-2 gap-1 px-2 py-1.5 pl-8">
                                        {groupTabs.map((tab) => (
                                          <div key={tab.key} className="flex items-center gap-2">
                                            <Checkbox
                                              checked={hiddenCostFields.includes(tab.key)}
                                              onCheckedChange={() => toggleCostField(tab.key)}
                                              data-testid={`checkbox-tab-${tab.key}`}
                                            />
                                            <span className="text-sm">{tab.label}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </CollapsibleContent>
                                  </Collapsible>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Hidden Cost Fields</p>
                          <p className="text-xs text-muted-foreground">Checked fields will be hidden from this user.</p>
                          <div className="space-y-1.5 border rounded-md p-3">
                            {FACTORY_COST_FIELDS.map((field) => (
                              <div key={field.key} className="flex items-center gap-2">
                                <Checkbox checked={hiddenCostFields.includes(field.key)} onCheckedChange={() => toggleCostField(field.key)} data-testid={`checkbox-cost-${field.key}`} />
                                <span className="text-sm">{field.label}</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Export &amp; Print Visibility</p>
                          <p className="text-xs text-muted-foreground">Checked items will be hidden from this user's exports, PDFs, prints, invoices, proformas, and reports.</p>
                          <div className="space-y-1.5 border rounded-md p-3">
                            <div className="flex items-center gap-2">
                              <Checkbox
                                checked={hiddenCostFields.includes("hide_export_selling_price")}
                                onCheckedChange={() => toggleCostField("hide_export_selling_price")}
                                data-testid="checkbox-cost-hide_export_selling_price"
                              />
                              <span className="text-sm">Hide Selling Prices in Exports/Prints</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Checkbox
                                checked={hiddenCostFields.includes("hide_export_cost_price")}
                                onCheckedChange={() => toggleCostField("hide_export_cost_price")}
                                data-testid="checkbox-cost-hide_export_cost_price"
                              />
                              <span className="text-sm">Hide Cost / Production Prices in Exports/Prints</span>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Daybook Restrictions</p>
                          <div className="border rounded-md p-3">
                            <div className="flex items-center gap-2">
                              <Checkbox checked={hiddenCostFields.includes("daybook_own_only")} onCheckedChange={() => toggleCostField("daybook_own_only")} data-testid="checkbox-daybook-own-only" />
                              <span className="text-sm">Show only entries they created</span>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-2 pt-2 border-t">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">ERP Cost &amp; Profit Fields</p>
                          <p className="text-xs text-muted-foreground">Checked items will be hidden from this user in the ERP system (sales detail, exports, prints).</p>
                          <div className="space-y-1.5 border rounded-md p-3">
                            {ERP_COST_FIELDS.map((field) => (
                              <div key={field.key} className="flex items-center gap-2">
                                <Checkbox
                                  checked={hiddenErpCostFields.includes(field.key)}
                                  onCheckedChange={() => toggleErpCostField(field.key)}
                                  data-testid={`checkbox-erp-cost-${field.key}`}
                                />
                                <span className="text-sm">{field.label}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          </div>
          </div>

          {/* Sticky save bar — appears only when something has changed */}
          {isDirty && (
            <div className="shrink-0 border-t px-6 py-3 bg-background flex items-center justify-between gap-3 flex-wrap z-50">
              <p className="text-xs text-muted-foreground">
                {newPassword ? "Unsaved changes · includes new password" : "Unsaved changes"}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDiscard}
                  disabled={updateMutation.isPending || saveErpRestrictionsMutation.isPending}
                  data-testid="button-discard-changes"
                >
                  Discard
                </Button>
                <Button
                  size="sm"
                  className="gap-2"
                  onClick={handleSaveAll}
                  disabled={updateMutation.isPending || saveErpRestrictionsMutation.isPending}
                  data-testid="button-save-all-changes"
                >
                  <Save className="h-3.5 w-3.5" />
                  {updateMutation.isPending || saveErpRestrictionsMutation.isPending ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Delete user confirmation */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {user.username}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will deactivate their account. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground"
              data-testid="button-confirm-delete-user"
            >
              {deleteMutation.isPending ? "Removing..." : "Remove User"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
