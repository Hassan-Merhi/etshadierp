  import { useState, useEffect, useRef } from "react";
  import { useConnectivity } from "@/contexts/ConnectivityContext";
  import { DeleteConfirmDialog } from "@/components/ConfirmationDialog";
  import { OfflinePrepPanel } from "@/components/OfflinePrepPanel";
  import { useForm } from "react-hook-form";
  import { zodResolver } from "@hookform/resolvers/zod";
  import { z } from "zod";
  import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
  import { Button } from "@/components/ui/button";
  import { Input } from "@/components/ui/input";
  import { Label } from "@/components/ui/label";
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
  } from "@/components/ui/dialog";
  import { Alert, AlertDescription } from "@/components/ui/alert";
  import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
  } from "@/components/ui/alert-dialog";
  import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
  } from "@/components/ui/form";
  import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  } from "@/components/ui/select";
  import { Checkbox } from "@/components/ui/checkbox";
  import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
  } from "@/components/ui/table";
  import { Badge } from "@/components/ui/badge";
  import { Skeleton } from "@/components/ui/skeleton";
  import { Switch } from "@/components/ui/switch";
  
  import { useToast } from "@/hooks/use-toast";
  import { useMutation, useQuery } from "@tanstack/react-query";
  import { queryClient, apiRequest } from "@/lib/queryClient";
  import { useAppMode } from "@/contexts/AppModeContext";
  import { getApiRequest } from "@/lib/factoryApi";
  import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
  import { Plus, Edit, Building2, Users, ChevronDown, ChevronUp, Trash2, CalendarRange, Settings2, Wrench, MapPin, ChevronRight, Bot, Bell, RefreshCw, Calculator, Loader2, Shield, AlertTriangle, PieChart, Key, Lock, Package, Eye, History, Clock, Upload, Download, Database, TrendingUp, ShoppingCart, Check, X, Copy, ExternalLink, ArrowLeftRight, WifiOff, Wifi, CheckCircle2, Printer, Layers, Zap, Eraser, ArrowLeft, Info, Search, Activity } from "lucide-react";
import { utils, writeFile, readFile, read, ExcelJS } from "@/lib/excelHelper";
  import { Link } from "wouter";
  import { useDateFormat } from "@/contexts/DateFormatContext";
  import { insertUserSchema, insertCompanySchema, type FeatureKey } from "@shared/schema";
  import { FiscalPeriodTab } from "@/components/FiscalPeriodTab";
  import { useCompany } from "@/contexts/CompanyContext";
  import { ExchangeRateSettings } from "@/components/ExchangeRateSettings";
  import { formatNumber } from "@/lib/formatNumber";
  
  const userFormSchema = insertUserSchema;
  const companyFormSchema = insertCompanySchema;
  type UserFormData = z.infer<typeof userFormSchema>;
  type CompanyFormData = z.infer<typeof companyFormSchema>;


function FxRatesCard() {
  const { toast } = useToast();
  const [newCurrency, setNewCurrency] = useState("");
  const [newRate, setNewRate] = useState("");

  const { data: rates = [], isLoading } = useQuery<{ currencyCode: string; rateToUsd: string; effectiveDate: string }[]>({
    queryKey: ["/api/factory/fx-rates"],
  });

  const saveMutation = useMutation({
    mutationFn: async ({ currencyCode, rateToUsd }: { currencyCode: string; rateToUsd: string }) => {
      const res = await apiRequest("POST", "/api/factory/fx-rates", { currencyCode, rateToUsd });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Rate saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/fx-rates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers/with-balances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/net-position"] });
      setNewCurrency("");
      setNewRate("");
    },
    onError: (err: any) => toast({ title: "Failed to save rate", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (currency: string) => {
      const res = await apiRequest("DELETE", `/api/factory/fx-rates/${currency}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Rate removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/fx-rates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers/with-balances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/net-position"] });
    },
    onError: (err: any) => toast({ title: "Failed to remove rate", description: err.message, variant: "destructive" }),
  });

  const handleAdd = () => {
    const cc = newCurrency.trim().toUpperCase();
    const rate = parseFloat(newRate);
    if (!cc || cc.length < 2 || cc.length > 6) return toast({ title: "Enter a valid currency code (2–6 letters)", variant: "destructive" });
    if (isNaN(rate) || rate <= 0) return toast({ title: "Enter a positive rate", variant: "destructive" });
    saveMutation.mutate({ currencyCode: cc, rateToUsd: newRate });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-muted-foreground" />
          FX Rates
        </CardTitle>
        <CardDescription>
          Set the exchange rates used to convert foreign-currency supplier balances to USD in Net Position and on supplier cards.
          For example: EUR = 1.18 means 1 EUR = 1.18 USD.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : rates.length === 0 ? (
          <p className="text-sm text-muted-foreground">No rates configured yet. Add one below.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Currency</TableHead>
                <TableHead>Rate to USD</TableHead>
                <TableHead>Last Updated</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rates.map((r) => (
                <TableRow key={r.currencyCode} data-testid={`row-fxrate-${r.currencyCode}`}>
                  <TableCell className="font-mono font-semibold">{r.currencyCode}</TableCell>
                  <TableCell className="font-mono">{parseFloat(r.rateToUsd).toFixed(4)}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{r.effectiveDate}</TableCell>
                  <TableCell>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => deleteMutation.mutate(r.currencyCode)}
                      disabled={deleteMutation.isPending}
                      data-testid={`button-delete-fxrate-${r.currencyCode}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            placeholder="Currency (e.g. EUR)"
            value={newCurrency}
            onChange={(e) => setNewCurrency(e.target.value.toUpperCase())}
            className="w-36"
            data-testid="input-fxrate-currency"
          />
          <Input
            placeholder="Rate to USD (e.g. 1.18)"
            value={newRate}
            onChange={(e) => setNewRate(e.target.value)}
            className="w-48"
            type="number"
            step="0.0001"
            min="0"
            data-testid="input-fxrate-rate"
          />
          <Button
            onClick={handleAdd}
            disabled={saveMutation.isPending}
            data-testid="button-add-fxrate"
          >
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
            Add / Update Rate
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

import { ParentCreditAccountSelect } from "./settings/ParentCreditAccountSelect";
import { NetPositionAdjustmentCard } from "./settings/NetPositionAdjustmentCard";
import { SessionsHub } from "./settings/SessionsHub";
import { ApprovalsPage } from "./settings/ApprovalsPage";
import { BusinessAlertsPage } from "./settings/BusinessAlertsPage";
import { DataToolsTab } from "./settings/DataToolsTab";
import { fmtDate, fieldLabel, fmtValue, getRecordLabel, getChangesSummary, tableShortName, AuditLogDialog, EditLogTable } from "./settings/AuditLog";
import { PosSettingsTab } from "./settings/PosSettingsTab";
import { PosSetupHub } from "./settings/PosSetupHub";
import { FileStorageAndExport } from "./settings/FileStorageAndExport";
import { DailyExportSection } from "./settings/DailyExportSection";
import { StockReportSection } from "./settings/StockReportSection";
import { NetPositionExportSection } from "./settings/NetPositionExportSection";
import { DailyAutoSendSection } from "./settings/DailyAutoSendSection";
import { ExportCenter } from "./settings/ExportCenter";
import { POSReceiptSettings, IntercompanyPosTab } from "./settings/IntercompanyPosTab";
import { OfflineSyncPanel, formatRelativeTime } from "./settings/OfflineSyncPanel";
import { PriceGroupsTab } from "./settings/PriceGroupsTab";
import { SettingsHubPage } from "./settings/SettingsHubPage";
import { UsersPermissionsHub } from "./settings/UsersPermissionsHub";

  export default function Settings() {
    const { toast } = useToast();
    const { selectedCompany } = useCompany();
    const { dateFormat, setDateFormat, formatDisplayDate, isPending: isDateFormatPending } = useDateFormat();
    const appMode = useAppMode();
    const modeApiRequest = getApiRequest(appMode);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<any>(null);
    const [isCompanyDialogOpen, setIsCompanyDialogOpen] = useState(false);
    const [editingCompany, setEditingCompany] = useState<any>(null);
    const [companyToDelete, setCompanyToDelete] = useState<any>(null);
    const [companySearch, setCompanySearch] = useState("");
    const [userToDelete, setUserToDelete] = useState<any>(null);
    const [isZeroBalanceDialogOpen, setIsZeroBalanceDialogOpen] = useState(false);
    const [selectedAccountsToZero, setSelectedAccountsToZero] = useState<number[]>([]);
    const [isInitBalancesDialogOpen, setIsInitBalancesDialogOpen] = useState(false);
    const [initBalancesResult, setInitBalancesResult] = useState<any>(null);
    const [expandedBreakdownId, setExpandedBreakdownId] = useState<number | null>(null);
    const [isFixPOCreditsDialogOpen, setIsFixPOCreditsDialogOpen] = useState(false);
    const [fixPOCreditsResult, setFixPOCreditsResult] = useState<any>(null);
    const [selectedCompanyForFix, setSelectedCompanyForFix] = useState<string>("");
    const [selectedParentCompanyForFix, setSelectedParentCompanyForFix] = useState<string>("");
    const [reversePOCreditsResult, setReversePOCreditsResult] = useState<any>(null);
    const [isResetDataDialogOpen, setIsResetDataDialogOpen] = useState(false);
    const [resetDataResult, setResetDataResult] = useState<any>(null);
    const [selectedCompanyForReset, setSelectedCompanyForReset] = useState<string>("");
    const [userToResetPassword, setUserToResetPassword] = useState<any>(null);
    const [newPasswordForReset, setNewPasswordForReset] = useState("");
    const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
    const [changePasswordData, setChangePasswordData] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
    const [orphanedChargesDiagnostic, setOrphanedChargesDiagnostic] = useState<{ count: number; impact: number; vouchers: any[] } | null>(null);
    const [isFixingOrphanedCharges, setIsFixingOrphanedCharges] = useState(false);
    const [orphanedPosSalesDiagnostic, setOrphanedPosSalesDiagnostic] = useState<{ count: number; totalImpact: number; vouchers: any[] } | null>(null);
    const [isFixingOrphanedPosSales, setIsFixingOrphanedPosSales] = useState(false);
    const [isLoadingOrphanedPosSales, setIsLoadingOrphanedPosSales] = useState(false);
    const [selectedContainerForDiag, setSelectedContainerForDiag] = useState<string>("");
    const [containerDiagResult, setContainerDiagResult] = useState<any>(null);
    const [isLoadingContainerDiag, setIsLoadingContainerDiag] = useState(false);
    const [isExportingCompanyData, setIsExportingCompanyData] = useState(false);
    const [isImportingCompanyData, setIsImportingCompanyData] = useState(false);
    const [importCompanyResult, setImportCompanyResult] = useState<any>(null);
    const [isRecalcAllLoading, setIsRecalcAllLoading] = useState(false);
    const [emptyAccountsOpen, setEmptyAccountsOpen] = useState(false);
    const [emptyAccountsSelected, setEmptyAccountsSelected] = useState<number[]>([]);
    const [emptyAccountsFilter, setEmptyAccountsFilter] = useState("");

    const { data: companies = [], isLoading: isLoadingCompanies } = useQuery<any[]>({
      queryKey: ["/api/companies"],
    });
  
    const { data: users = [], isLoading } = useQuery<any[]>({
      queryKey: ["/api/users"],
    });

    // Get current user role for fiscal period access
    const { data: currentUser } = useQuery<{ role?: string }>({
      queryKey: ["/api/auth/me"],
    });

    // Query for ledger accounts for zero balance feature
    const { data: allLedgerAccounts = [] } = useQuery<any[]>({
      queryKey: ["/api/ledger-accounts", selectedCompany?.id],
      enabled: !!selectedCompany && isZeroBalanceDialogOpen,
    });
  
    // Query for role feature permissions
    const { data: rolePermissions = [], isLoading: isLoadingPermissions } = useQuery<any[]>({
      queryKey: ["/api/settings/role-permissions", selectedCompany?.id],
      enabled: !!selectedCompany,
    });

    // Query for containers for offload diagnostics
    const { data: containersForDiag = [] } = useQuery<any[]>({
      queryKey: ["/api/admin/containers-for-diagnostics"],
      enabled: !!selectedCompany && (currentUser?.role === "Admin" || currentUser?.role === "Developer"),
    });

    const { data: emptyAccounts = [], isLoading: isLoadingEmptyAccounts, refetch: refetchEmptyAccounts } = useQuery<any[]>({
      queryKey: ["/api/ledger-accounts/empty", selectedCompany?.id],
      enabled: emptyAccountsOpen && !!selectedCompany?.id,
    });

    const bulkDeleteAccountsMutation = useMutation({
      mutationFn: async (ids: number[]) => {
        const res = await apiRequest("POST", "/api/ledger-accounts/bulk-delete", { accountIds: ids });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.message || "Failed to delete accounts");
        }
        return res.json();
      },
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts"] });
        queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts/empty", selectedCompany?.id] });
        setEmptyAccountsSelected([]);
        toast({
          title: "Accounts deleted",
          description: `${data.deleted} account(s) deleted${data.skipped > 0 ? `, ${data.skipped} skipped (not empty)` : ""}`,
        });
      },
      onError: (err: Error) => {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      },
    });

    // Build a lookup map for role permissions: { "role:featureKey": enabled }
    const permissionMap = new Map<string, boolean>();
    rolePermissions.forEach((p: any) => {
      permissionMap.set(`${p.role}:${p.featureKey}`, p.enabled);
    });

    // Get permission value for a role/feature
    const getPermission = (role: string, featureKey: string): boolean => {
      // Admin always has all permissions
      if (role === "Admin" || role === "Developer") return true;
      const key = `${role}:${featureKey}`;
      // Default to false if not explicitly set (disabled by default)
      return permissionMap.has(key) ? permissionMap.get(key)! : false;
    };

    // Mutation for updating role permissions
    const updateRolePermissionMutation = useMutation({
      mutationFn: async ({ role, featureKey, enabled }: { role: string; featureKey: string; enabled: boolean }) => {
        if (!selectedCompany?.id) throw new Error("No company selected");
        const res = await modeApiRequest("PUT", "/api/settings/role-permissions", {
          companyId: selectedCompany.id,
          permissions: [{ role, featureKey, enabled }],
        });
        return await res.json();
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/settings/role-permissions", selectedCompany?.id] });
        toast({
          title: "Permission Updated",
          description: "Role permission has been updated successfully.",
        });
      },
      onError: (error: any) => {
        if ((error as any)?._handledGlobally) return;
        toast({
          title: "Error",
          description: error.message || "Failed to update permission",
          variant: "destructive",
        });
      },
    });

    // Roles that can be configured (exclude Admin since they always have full access)
    const configurableRoles = ["Owner", "Manager", "POS", "Normal User"];

    // Parent Company setting query and mutation
    const { data: parentCompanyData } = useQuery<{ parentCompanyId: number | null }>({
      queryKey: ["/api/system/parent-company"],
    });

    const setParentCompanyMutation = useMutation({
      mutationFn: async (companyId: number | null) => {
        const res = await modeApiRequest("POST", "/api/system/parent-company", { parentCompanyId: companyId });
        return await res.json();
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/system/parent-company"] });
        toast({
          title: "Success",
          description: "Parent company setting has been updated.",
        });
      },
      onError: (error: any) => {
        if ((error as any)?._handledGlobally) return;
        toast({
          title: "Error",
          description: error.message || "Failed to update parent company setting",
          variant: "destructive",
        });
      },
    });

    // Feature key to readable name
    const featureLabels: Record<FeatureKey, string> = {
      dashboard: "Dashboard",
      pos: "Point of Sale",
      pos_daybook: "POS Daybook",
      stock_items: "Stock Items",
      location_inventory: "Location Inventory",
      containers: "Containers",
      stock_otw: "Stock OTW",
      factory_production: "Factory Production",
      analytics: "Analytics",
      accounts: "Accounts",
      suppliers: "Suppliers",
      customers: "Customers",
      vouchers: "Vouchers",
      daybook: "Daybook",
      payroll: "Payroll",
      create: "Create",
      stock_query: "Stock Query",
      location_summary: "Location Summary",
      sales_report: "Sales Report",
      settings: "Settings",
      optional_vouchers: "Optional Vouchers",
    };
  
    const companyForm = useForm<CompanyFormData>({
      resolver: zodResolver(companyFormSchema),
      defaultValues: {
        name: "",
        code: "",
        companyType: "erp",
        baseCurrency: "USD",
        displayCurrency: "none",
        active: true,
      },
    });
  
    const form = useForm<UserFormData>({
      resolver: zodResolver(userFormSchema),
      defaultValues: {
        username: "",
        password: "",
        active: true,
      },
    });
  
    const createCompanyMutation = useMutation({
      mutationFn: async (data: CompanyFormData) => {
        if (editingCompany) {
          const res = await modeApiRequest("PATCH", `/api/companies/${editingCompany.id}`, data);
          return await res.json();
        } else {
          const res = await modeApiRequest("POST", "/api/companies", data);
          return await res.json();
        }
      },
      onSuccess: () => {
        toast({
          title: "Success",
          description: editingCompany ? "Company updated successfully" : "Company created successfully",
        });
        queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
        setIsCompanyDialogOpen(false);
        setEditingCompany(null);
        companyForm.reset({
          name: "",
          code: "",
          companyType: "erp",
          baseCurrency: "USD",
          displayCurrency: "none",
          active: true,
        });
      },
      onError: (error: any) => {
        if ((error as any)?._handledGlobally) return;
        toast({
          title: "Error",
          description: error.message || "Failed to save company",
          variant: "destructive",
        });
      },
    });
  
    const deleteCompanyMutation = useMutation({
      mutationFn: async (companyId: number) => {
        const res = await modeApiRequest("DELETE", `/api/companies/${companyId}`);
        return await res.json();
      },
      onSuccess: () => {
        toast({
          title: "Success",
          description: "Company and all associated data deleted successfully",
        });
        queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
        queryClient.invalidateQueries({ queryKey: ["/api/user/companies"] });
        setCompanyToDelete(null);
      },
      onError: (error: any) => {
        if ((error as any)?._handledGlobally) return;
        toast({
          title: "Error",
          description: error.message || "Failed to delete company",
          variant: "destructive",
        });
      },
    });
  
    const createUserMutation = useMutation({
      mutationFn: async (data: UserFormData) => {
        if (editingUser) {
          const res = await modeApiRequest("PATCH", `/api/users/${editingUser.id}`, data);
          return await res.json();
        } else {
          const res = await modeApiRequest("POST", "/api/users", data);
          return await res.json();
        }
      },
      onSuccess: () => {
        toast({
          title: "Success",
          description: editingUser ? "User updated successfully" : "User created successfully",
        });
        queryClient.invalidateQueries({ queryKey: ["/api/users"] });
        setIsDialogOpen(false);
        setEditingUser(null);
        form.reset({
          username: "",
          password: "",
          active: true,
        });
      },
      onError: (error: any) => {
        if ((error as any)?._handledGlobally) return;
        toast({
          title: "Error",
          description: error.message || "Failed to save user",
          variant: "destructive",
        });
      },
    });

    const deleteUserMutation = useMutation({
      mutationFn: async (userId: string) => {
        const res = await modeApiRequest("DELETE", `/api/users/${userId}`);
        return await res.json();
      },
      onSuccess: () => {
        toast({
          title: "Success",
          description: "User deleted successfully",
        });
        queryClient.invalidateQueries({ queryKey: ["/api/users"] });
        setUserToDelete(null);
      },
      onError: (error: any) => {
        if ((error as any)?._handledGlobally) return;
        toast({
          title: "Error",
          description: error.message || "Failed to delete user",
          variant: "destructive",
        });
      },
    });

    const resetPasswordMutation = useMutation({
      mutationFn: async ({ userId, newPassword }: { userId: string; newPassword: string }) => {
        const res = await modeApiRequest("POST", `/api/admin/reset-password/${userId}`, { newPassword });
        return res.json();
      },
      onSuccess: (data) => {
        toast({
          title: "Success",
          description: data.message || "Password reset successfully",
        });
        setUserToResetPassword(null);
        setNewPasswordForReset("");
      },
      onError: (error: any) => {
        if ((error as any)?._handledGlobally) return;
        toast({
          title: "Error",
          description: error.message || "Failed to reset password",
          variant: "destructive",
        });
      },
    });

    const changePasswordMutation = useMutation({
      mutationFn: async ({ currentPassword, newPassword }: { currentPassword: string; newPassword: string }) => {
        const res = await modeApiRequest("POST", "/api/user/change-password", { currentPassword, newPassword });
        return res.json();
      },
      onSuccess: () => {
        toast({
          title: "Success",
          description: "Password changed successfully",
        });
        setIsChangePasswordOpen(false);
        setChangePasswordData({ currentPassword: "", newPassword: "", confirmPassword: "" });
      },
      onError: (error: any) => {
        if ((error as any)?._handledGlobally) return;
        toast({
          title: "Error",
          description: error.message || "Failed to change password",
          variant: "destructive",
        });
      },
    });
  
    const zeroBalancesMutation = useMutation({
      mutationFn: async (accountIds: number[]) => {
        const res = await modeApiRequest("POST", "/api/ledger-accounts/zero-balances", { accountIds });
        return await res.json();
      },
      onSuccess: (data) => {
        toast({
          title: "Success",
          description: `Opening balances zeroed for ${data.count} account(s)`,
        });
        queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts"] });
        setIsZeroBalanceDialogOpen(false);
        setSelectedAccountsToZero([]);
      },
      onError: (error: any) => {
        if ((error as any)?._handledGlobally) return;
        toast({
          title: "Error",
          description: error.message || "Failed to zero balances",
          variant: "destructive",
        });
      },
    });

    const initializeBalancesMutation = useMutation({
      mutationFn: async () => {
        const res = await modeApiRequest("POST", "/api/admin/initialize-accounting-balances", {});
        return await res.json();
      },
      onSuccess: (data) => {
        setInitBalancesResult(data);
        toast({
          title: "Success",
          description: data.message,
        });
        queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts"] });
        queryClient.invalidateQueries({ queryKey: ["/api/stats/import-cycle-balance"] });
      },
      onError: (error: any) => {
        if ((error as any)?._handledGlobally) return;
        console.error("Initialize balances error:", error);
        toast({
          title: "Error",
          description: error.message || "Failed to initialize balances",
          variant: "destructive",
        });
        // Reset the result so button shows again for retry
        setInitBalancesResult(null);
      },
    });

    const fixPOCreditsMutation = useMutation({
      mutationFn: async ({ companyId, parentCompanyId }: { companyId: number; parentCompanyId: number }) => {
        const res = await modeApiRequest("POST", "/api/fix-old-po-credits", { companyId, parentCompanyId });
        return await res.json();
      },
      onSuccess: (data) => {
        setFixPOCreditsResult(data);
        toast({
          title: "Success",
          description: data.message,
        });
        queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts"] });
        queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      },
      onError: (error: any) => {
        if ((error as any)?._handledGlobally) return;
        console.error("Fix PO credits error:", error);
        toast({
          title: "Error",
          description: error.message || "Failed to fix PO credits",
          variant: "destructive",
        });
        setFixPOCreditsResult(null);
      },
    });

    const fixParentPOSupplierMutation = useMutation({
      mutationFn: async () => {
        const res = await modeApiRequest("POST", "/api/fix-parent-po-supplier-entries", {});
        return await res.json();
      },
      onSuccess: (data) => {
        toast({
          title: "Success",
          description: data.message,
        });
        queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
        queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
        queryClient.invalidateQueries({ queryKey: ["/api/import-cycle-balance"] });
      },
      onError: (error: any) => {
        if ((error as any)?._handledGlobally) return;
        console.error("Fix parent PO supplier entries error:", error);
        toast({
          title: "Error",
          description: error.message || "Failed to fix supplier entries",
          variant: "destructive",
        });
      },
    });

    const resetCompanyDataMutation = useMutation({
      mutationFn: async (companyId: number) => {
        const res = await modeApiRequest("POST", "/api/admin/reset-company-data", { companyId });
        return await res.json();
      },
      onSuccess: (data) => {
        setResetDataResult(data);
        toast({
          title: "Reset Complete",
          description: data.message,
        });
        queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
        queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts"] });
        queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      },
      onError: (error: any) => {
        if ((error as any)?._handledGlobally) return;
        console.error("Reset company data error:", error);
        toast({
          title: "Error",
          description: error.message,
          variant: "destructive",
        });
      },
    });

    const reversePOCreditsMutation = useMutation({
      mutationFn: async ({ companyId, parentCompanyId }: { companyId: number; parentCompanyId: number }) => {
        const res = await modeApiRequest("POST", "/api/reverse-po-credits", { companyId, parentCompanyId });
        return await res.json();
      },
      onSuccess: (data) => {
        setReversePOCreditsResult(data);
        toast({
          title: "Success",
          description: data.message,
        });
        queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts"] });
        queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      },
      onError: (error: any) => {
        if ((error as any)?._handledGlobally) return;
        console.error("Reverse PO credits error:", error);
        toast({
          title: "Error",
          description: error.message || "Failed to reverse PO credits",
          variant: "destructive",
        });
        setReversePOCreditsResult(null);
      },
    });
  
    const handleEditCompany = async (company: any) => {
      setEditingCompany(company);
      companyForm.reset({
        name: company.name,
        code: company.code,
        companyType: company.companyType || "erp",
        baseCurrency: company.baseCurrency || "USD",
        displayCurrency: company.displayCurrency || "none",
        active: company.active,
      });
      setIsCompanyDialogOpen(true);
    };
  
    const handleEdit = async (user: any) => {
      setEditingUser(user);
      form.reset({
        username: user.username,
        password: "",
        active: user.active,
      });
      setIsDialogOpen(true);
    };
  
    const handleSubmitCompany = async (data: CompanyFormData) => {
      createCompanyMutation.mutate(data);
    };
  
    const handleSubmit = async (data: UserFormData) => {
      // If editing and password is empty, remove it from the update
      if (editingUser && !data.password) {
        const { password, ...dataWithoutPassword } = data;
        createUserMutation.mutate(dataWithoutPassword as UserFormData);
      } else {
        createUserMutation.mutate(data);
      }
    };
  
    const [activeSection, setActiveSection] = useState("users-permissions");

    const sidebarGroups = [
      {
        label: "General",
        items: [
          { key: "companies", label: "Companies", icon: Building2 },
          { key: "preferences", label: "Preferences", icon: Settings2, devOnly: true },
        ],
      },
      {
        label: "Users & Access",
        items: [
          { key: "users-permissions", label: "Users & Permissions", icon: Users },
          { key: "sessions-hub", label: "Sessions & Users", icon: Shield, devOnly: true },
        ],
      },
      {
        label: "Tools",
        items: [
          { key: "data-tools", label: "Data Tools", icon: Database, devOnly: true },
          { key: "edit-log", label: "Edit Log", icon: History },
          { key: "files-export", label: "Files & Export", icon: Upload },
          { key: "export-center", label: "Export Center", icon: Zap },
        ],
      },
      {
        label: "POS",
        items: appMode !== "factory" ? [
          { key: "pos-setup", label: "POS Setup", icon: ShoppingCart, devOnly: true },
        ] : [],
      },
      {
        label: "Factory",
        items: appMode === "factory" ? [
          { key: "fx-rates", label: "FX Rates", icon: TrendingUp },
        ] : [],
      },
      {
        label: "Controls",
        items: [
          { key: "approvals", label: "Approvals", icon: CheckCircle2 },
          { key: "business-alerts", label: "Business Alerts", icon: AlertTriangle },
        ],
      },
      {
        label: "System",
        items: [
          { key: "system", label: "System Tools", icon: Wrench },
        ],
      },
    ];

    return (
      <div className="flex flex-col sm:flex-row sm:h-full">
        {/* Mobile section selector */}
        <div className="sm:hidden border-b p-3 flex items-center gap-2">
          <Select value={activeSection} onValueChange={setActiveSection}>
            <SelectTrigger data-testid="select-settings-section" className="flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sidebarGroups.map((group) =>
                group.items.length > 0 ? group.items.filter((item) => !(item as any).devOnly || currentUser?.role === "Developer" || ((item as any).factoryAdminAllowed && appMode === "factory" && ["Admin", "Owner"].includes(currentUser?.role || ""))).map((item) => (
                  <SelectItem key={item.key} value={item.key} data-testid={`tab-mobile-${item.key}`}>
                    {item.label}
                  </SelectItem>
                )) : null
              )}
            </SelectContent>
          </Select>
        </div>

        {/* Desktop sidebar nav */}
        <nav className="hidden sm:flex sm:flex-col w-56 shrink-0 border-r bg-muted/30 p-3 gap-3 overflow-y-auto" data-testid="tabs-settings">
          <div className="space-y-4">
          {sidebarGroups.map((group) => (
            <div key={group.label}>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-1">{group.label}</p>
              <div className="space-y-0.5">
                {group.items.filter((item) => !(item as any).devOnly || currentUser?.role === "Developer" || ((item as any).factoryAdminAllowed && appMode === "factory" && ["Admin", "Owner"].includes(currentUser?.role || ""))).map((item) => {
                  const Icon = item.icon;
                  const isActive = activeSection === item.key;
                  return (
                    <button
                      key={item.key}
                      onClick={() => setActiveSection(item.key)}
                      className={`flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-sm transition-colors ${isActive ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover-elevate"}`}
                      data-testid={`tab-${item.key}`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          </div>
        </nav>

        <div className="flex-1 sm:overflow-y-auto p-4 sm:p-6">

          {activeSection === "companies" && (
            <div className="space-y-5">
              {/* Header */}
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h2 className="text-2xl font-semibold flex items-center gap-2">
                    <Building2 className="h-6 w-6" />
                    Company Management
                  </h2>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {companies.length} {companies.length === 1 ? "company" : "companies"} configured
                  </p>
                </div>
                <Dialog open={isCompanyDialogOpen} onOpenChange={setIsCompanyDialogOpen}>
                  <DialogTrigger asChild>
                    <Button
                      onClick={() => {
                        setEditingCompany(null);
                        companyForm.reset({ name: "", code: "", companyType: "erp", active: true });
                      }}
                      data-testid="button-add-company"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Company
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>{editingCompany ? "Edit Company" : "Create New Company"}</DialogTitle>
                    </DialogHeader>
                    <Form {...companyForm}>
                      <form onSubmit={companyForm.handleSubmit(handleSubmitCompany)} className="space-y-4" noValidate>
                        <FormField
                          control={companyForm.control}
                          name="name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Company Name *</FormLabel>
                              <FormControl>
                                <Input {...field} placeholder="ABC Textiles Inc." data-testid="input-company-name" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={companyForm.control}
                          name="code"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Company Code *</FormLabel>
                              <FormControl>
                                <Input {...field} placeholder="ABC" data-testid="input-company-code" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={companyForm.control}
                          name="companyType"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Company Type</FormLabel>
                              <Select onValueChange={field.onChange} value={field.value || "erp"}>
                                <FormControl>
                                  <SelectTrigger data-testid="select-company-type">
                                    <SelectValue placeholder="Select type" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="erp">Normal ERP</SelectItem>
                                  <SelectItem value="factory">Factory Production</SelectItem>
                                  <SelectItem value="properties">Properties</SelectItem>
                                  <SelectItem value="supplier_partner">Supplier Partner</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <div className="grid grid-cols-2 gap-4">
                          <FormField
                            control={companyForm.control}
                            name="baseCurrency"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Base Currency</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value || "USD"}>
                                  <FormControl>
                                    <SelectTrigger data-testid="select-base-currency">
                                      <SelectValue placeholder="Select currency" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="USD">USD</SelectItem>
                                    <SelectItem value="EUR">EUR</SelectItem>
                                    <SelectItem value="GBP">GBP</SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={companyForm.control}
                            name="displayCurrency"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Display Currency</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value || "none"}>
                                  <FormControl>
                                    <SelectTrigger data-testid="select-display-currency">
                                      <SelectValue placeholder="None" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="none">None</SelectItem>
                                    <SelectItem value="CFA">CFA</SelectItem>
                                    <SelectItem value="EUR">EUR</SelectItem>
                                    <SelectItem value="GBP">GBP</SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                        <FormField
                          control={companyForm.control}
                          name="active"
                          render={({ field }) => (
                            <FormItem className="flex items-center gap-2 space-y-0">
                              <FormControl>
                                <Checkbox checked={field.value} onCheckedChange={field.onChange} data-testid="checkbox-company-active" />
                              </FormControl>
                              <FormLabel className="!mt-0">Active</FormLabel>
                            </FormItem>
                          )}
                        />
                        {editingCompany && (
                          <div className="border-t pt-4">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Parent Credit Account</p>
                            <ParentCreditAccountSelect company={editingCompany} />
                          </div>
                        )}
                        <div className="flex gap-2 justify-end border-t pt-4">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => { setIsCompanyDialogOpen(false); setEditingCompany(null); }}
                            disabled={createCompanyMutation.isPending}
                            data-testid="button-cancel-company"
                          >
                            Cancel
                          </Button>
                          <Button type="submit" disabled={createCompanyMutation.isPending} data-testid="button-save-company">
                            {createCompanyMutation.isPending ? "Saving..." : "Save"}
                          </Button>
                        </div>
                      </form>
                    </Form>
                  </DialogContent>
                </Dialog>
              </div>

              {/* Search */}
              {companies.length > 3 && (
                <div className="relative max-w-xs">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    placeholder="Search companies…"
                    value={companySearch}
                    onChange={e => setCompanySearch(e.target.value)}
                    className="pl-9"
                    data-testid="input-company-search"
                  />
                </div>
              )}

              {/* Cards */}
              {isLoadingCompanies ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[1,2,3].map(i => (
                    <div key={i} className="h-36 rounded-md border bg-muted/30 animate-pulse" />
                  ))}
                </div>
              ) : companies.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
                  <Building2 className="h-12 w-12 text-muted-foreground/30" />
                  <div>
                    <p className="font-medium text-muted-foreground">No companies yet</p>
                    <p className="text-sm text-muted-foreground/70 mt-1">Click "Add Company" above to create your first one.</p>
                  </div>
                </div>
              ) : (() => {
                const q = companySearch.toLowerCase();
                const filtered = companies.filter((c: any) =>
                  !q || c.name?.toLowerCase().includes(q) || c.code?.toLowerCase().includes(q)
                );

                if (filtered.length === 0) {
                  return (
                    <p className="text-sm text-muted-foreground text-center py-10">
                      No companies match "<span className="font-medium">{companySearch}</span>"
                    </p>
                  );
                }

                return (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filtered.map((company: any) => {
                      const isFactory = company.companyType === "factory" || company.companyType === "factory_v2";
                      const isProperties = company.companyType === "properties";
                      const typeLabel = isFactory ? "Factory" : isProperties ? "Properties" : "ERP";

                      const accentClass = isFactory
                        ? "bg-orange-500"
                        : isProperties
                        ? "bg-green-500"
                        : "bg-indigo-500";

                      const typeBadgeClass = isFactory
                        ? "border-orange-200 text-orange-700 bg-orange-50 dark:border-orange-800 dark:text-orange-300 dark:bg-orange-950"
                        : isProperties
                        ? "border-green-200 text-green-700 bg-green-50 dark:border-green-800 dark:text-green-300 dark:bg-green-950"
                        : "border-indigo-200 text-indigo-700 bg-indigo-50 dark:border-indigo-800 dark:text-indigo-300 dark:bg-indigo-950";

                      return (
                        <div
                          key={company.id}
                          className="rounded-md border bg-card flex flex-col overflow-hidden"
                          data-testid={`card-company-${company.id}`}
                        >
                          {/* Colored top accent bar */}
                          <div className={`h-1.5 w-full ${accentClass}`} />

                          <div className="flex flex-col gap-3 p-4 flex-1">
                            {/* Name + badges */}
                            <div className="flex items-start justify-between gap-2">
                              <p
                                className="font-semibold text-base leading-tight"
                                data-testid={`text-company-name-${company.id}`}
                              >
                                {company.name}
                              </p>
                              <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                                <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${typeBadgeClass}`}
                                  data-testid={`text-company-type-${company.id}`}>
                                  {typeLabel}
                                </span>
                                <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                                  company.active
                                    ? "border-emerald-200 text-emerald-700 bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:bg-emerald-950"
                                    : "border-border text-muted-foreground bg-muted"
                                }`}
                                  data-testid={`text-company-status-${company.id}`}>
                                  {company.active ? "Active" : "Inactive"}
                                </span>
                              </div>
                            </div>

                            {/* Currency row */}
                            <p className="text-xs text-muted-foreground">
                              {company.baseCurrency || "USD"}
                              {company.displayCurrency && company.displayCurrency !== "none"
                                ? ` · ${company.displayCurrency}`
                                : ""}
                            </p>
                          </div>

                          {/* Action footer */}
                          <div className="border-t px-4 py-2 flex justify-end gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleEditCompany(company)}
                              data-testid={`button-edit-company-${company.id}`}
                              title="Edit company"
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => setCompanyToDelete(company)}
                              data-testid={`button-delete-company-${company.id}`}
                              title="Delete company"
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* Delete confirmation */}
              <AlertDialog open={!!companyToDelete} onOpenChange={(open) => !open && setCompanyToDelete(null)}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete Company</AlertDialogTitle>
                    <AlertDialogDescription asChild>
                      <div className="space-y-2">
                        <p>Are you sure you want to delete <strong>{companyToDelete?.name}</strong>?</p>
                        <p className="text-destructive font-medium">This will permanently delete ALL data associated with this company, including:</p>
                        <ul className="list-disc list-inside text-sm space-y-1 ml-2">
                          <li>All locations and inventory</li>
                          <li>All ledger accounts and bank accounts</li>
                          <li>All vouchers and transactions</li>
                          <li>All purchase orders and containers</li>
                          <li>All employees and customers</li>
                          <li>All user role assignments for this company</li>
                        </ul>
                        <p className="font-bold text-destructive mt-2">This action cannot be undone!</p>
                      </div>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel data-testid="button-cancel-delete-company">Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => companyToDelete && deleteCompanyMutation.mutate(companyToDelete.id)}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      disabled={deleteCompanyMutation.isPending}
                      data-testid="button-confirm-delete-company"
                    >
                      {deleteCompanyMutation.isPending ? "Deleting..." : "Delete Company"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}

          {/* User Delete Confirmation Dialog */}
          <AlertDialog open={!!userToDelete} onOpenChange={(open) => !open && setUserToDelete(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete User</AlertDialogTitle>
                <AlertDialogDescription className="space-y-2">
                  <p>
                    Are you sure you want to delete user <strong>{userToDelete?.username}</strong>?
                  </p>
                  <p className="text-destructive font-medium">
                    This will permanently delete the user and all their company role assignments.
                  </p>
                  <p className="font-bold text-destructive mt-2">
                    This action cannot be undone!
                  </p>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="button-cancel-delete-user">Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => userToDelete && deleteUserMutation.mutate(userToDelete.id)}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={deleteUserMutation.isPending}
                  data-testid="button-confirm-delete-user"
                >
                  {deleteUserMutation.isPending ? "Deleting..." : "Delete User"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Admin Reset Password Dialog */}
          <Dialog open={!!userToResetPassword} onOpenChange={(open) => {
            if (!open) {
              setUserToResetPassword(null);
              setNewPasswordForReset("");
            }
          }}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Reset Password for {userToResetPassword?.username}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Enter a new password for this user. They will be able to log in with this password immediately.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="reset-new-password">New Password</Label>
                  <Input
                    id="reset-new-password"
                    type="password"
                    value={newPasswordForReset}
                    onChange={(e) => setNewPasswordForReset(e.target.value)}
                    placeholder="Enter new password (min 4 characters)"
                    data-testid="input-reset-new-password"
                  />
                </div>
                <div className="flex gap-2 justify-end border-t pt-4">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setUserToResetPassword(null);
                      setNewPasswordForReset("");
                    }}
                    disabled={resetPasswordMutation.isPending}
                    data-testid="button-cancel-reset-password"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => {
                      if (newPasswordForReset.length < 4) {
                        toast({
                          title: "Error",
                          description: "Password must be at least 4 characters",
                          variant: "destructive",
                        });
                        return;
                      }
                      resetPasswordMutation.mutate({
                        userId: userToResetPassword.id,
                        newPassword: newPasswordForReset,
                      });
                    }}
                    disabled={resetPasswordMutation.isPending || newPasswordForReset.length < 4}
                    data-testid="button-submit-reset-password"
                  >
                    {resetPasswordMutation.isPending ? "Resetting..." : "Reset Password"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
  
          {/* Users & Permissions Hub */}
          {activeSection === "users-permissions" && (
            <UsersPermissionsHub
              userRole={currentUser?.role}
              appMode={appMode}
            />
          )}

          {activeSection === "sessions-hub" && currentUser?.role === "Developer" && (
            <SessionsHub
              isAdmin={["Admin", "Owner", "Developer"].includes(currentUser?.role || "")}
              isDev={currentUser?.role === "Developer"}
            />
          )}

          {activeSection === "edit-log" && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <History className="h-5 w-5" />
                <h2 className="text-2xl font-semibold">Edit Log</h2>
              </div>
              <p className="text-muted-foreground">
                Track all changes made to records across the system with before/after values.
              </p>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    Recent Changes
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <EditLogTable companyId={selectedCompany?.id} />
                </CardContent>
              </Card>
            </div>
          )}

          {activeSection === "approvals" && (
            <ApprovalsPage currentUser={currentUser} />
          )}

          {activeSection === "business-alerts" && (
            <BusinessAlertsPage currentUser={currentUser} />
          )}

          {activeSection === "data-tools" && currentUser?.role === "Developer" && (
            <DataToolsTab />
          )}
          {activeSection === "pos-setup" && currentUser?.role === "Developer" && (
            <PosSetupHub userRole={currentUser?.role} />
          )}
          {activeSection === "fx-rates" && appMode === "factory" && (
            <div className="space-y-5 max-w-2xl">
              <div>
                <h2 className="text-2xl font-semibold flex items-center gap-2">
                  <TrendingUp className="h-6 w-6" />
                  FX Rates
                </h2>
                <p className="text-muted-foreground text-sm mt-1">
                  Manage exchange rates for converting foreign-currency balances to USD.
                </p>
              </div>
              <FxRatesCard />
            </div>
          )}

          {activeSection === "files-export" && (
            <FileStorageAndExport />
          )}

          {activeSection === "export-center" && (
            <ExportCenter />
          )}

          {activeSection === "preferences" && (
            <div className="space-y-6 max-w-lg">
              <div>
                <h2 className="text-2xl font-semibold flex items-center gap-2"><Settings2 className="h-5 w-5" />Preferences</h2>
                <p className="text-muted-foreground text-sm mt-1">Customize your display and regional settings.</p>
              </div>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Date Format</CardTitle>
                  <CardDescription>Choose how dates are displayed across the application.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(["MM/DD/YYYY", "DD/MM/YYYY"] as const).map((fmt) => (
                    <label
                      key={fmt}
                      className={`flex items-center gap-3 p-3 rounded-md border cursor-pointer transition-colors ${dateFormat === fmt ? "border-primary bg-primary/5" : "border-border hover-elevate"}`}
                    >
                      <input
                        type="radio"
                        name="dateFormat"
                        value={fmt}
                        checked={dateFormat === fmt}
                        onChange={() => setDateFormat(fmt)}
                        disabled={isDateFormatPending}
                        className="accent-primary"
                        data-testid={`radio-date-format-${fmt}`}
                      />
                      <div>
                        <div className="font-medium text-sm">{fmt}</div>
                        <div className="text-xs text-muted-foreground">
                          {fmt === "MM/DD/YYYY" ? "e.g. 12/31/2025 (US style)" : "e.g. 31/12/2025 (International style)"}
                        </div>
                      </div>
                      {dateFormat === fmt && <Check className="h-4 w-4 text-primary ml-auto" />}
                    </label>
                  ))}
                  {isDateFormatPending && <p className="text-xs text-muted-foreground">Saving…</p>}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">POS Receipt Settings</CardTitle>
                  <CardDescription>Configure how POS receipts are displayed and printed.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <POSReceiptSettings />
                </CardContent>
              </Card>
            </div>
          )}


          {activeSection === "system" && (() => {
            const pfx = appMode === "factory" ? "/factory" : appMode === "properties" ? "/properties" : "";
            const isDev = currentUser?.role === "Developer";
            return (
            <div className="space-y-8">
              {/* Page header */}
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h2 className="text-2xl font-semibold">System Tools</h2>
                  <Badge variant="secondary" className="text-xs">Admin Tools</Badge>
                </div>
                <p className="text-muted-foreground text-sm">Manage recovery, diagnostics, and financial position insights.</p>
              </div>

              {/* Admin notice */}
              <div className="flex items-start gap-3 p-4 bg-muted/50 rounded-md border text-sm text-muted-foreground">
                <Info className="h-4 w-4 mt-0.5 shrink-0" />
                <p>System tools can affect company records, diagnostics, or user access. Use them carefully and review changes before confirming.</p>
              </div>

              {/* Main 4 tools */}
              <div className="grid gap-4 md:grid-cols-2">
                <Link href={`${pfx}/deleted-items`}>
                  <Card className="p-6 hover-elevate cursor-pointer h-full">
                    <div className="flex flex-col gap-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="p-2.5 bg-destructive/10 rounded-md">
                          <Trash2 className="h-5 w-5 text-destructive" />
                        </div>
                        <Badge variant="secondary" className="text-xs">Recovery</Badge>
                      </div>
                      <div>
                        <h3 className="font-semibold mb-1" data-testid="link-deleted-items">Deleted Items</h3>
                        <p className="text-sm text-muted-foreground">Restore deleted records or permanently remove archived data.</p>
                      </div>
                      <div className="flex items-center gap-1 text-sm font-medium text-primary">
                        Open <ChevronRight className="h-4 w-4" />
                      </div>
                    </div>
                  </Card>
                </Link>

                <Link href={`${pfx}/import-cycle-diagnostics`}>
                  <Card className="p-6 hover-elevate cursor-pointer h-full">
                    <div className="flex flex-col gap-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="p-2.5 bg-yellow-500/10 rounded-md">
                          <AlertTriangle className="h-5 w-5 text-yellow-500" />
                        </div>
                        <Badge variant="secondary" className="text-xs">Diagnostics</Badge>
                      </div>
                      <div>
                        <h3 className="font-semibold mb-1" data-testid="link-import-diagnostics">Import Cycle Diagnostics</h3>
                        <p className="text-sm text-muted-foreground">Detect imbalance issues and troubleshoot import cycle problems.</p>
                      </div>
                      <div className="flex items-center gap-1 text-sm font-medium text-primary">
                        Run Check <ChevronRight className="h-4 w-4" />
                      </div>
                    </div>
                  </Card>
                </Link>

                <Link href={`${pfx}/net-position-details`}>
                  <Card className="p-6 hover-elevate cursor-pointer h-full">
                    <div className="flex flex-col gap-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="p-2.5 bg-purple-500/10 rounded-md">
                          <PieChart className="h-5 w-5 text-purple-500" />
                        </div>
                        <Badge variant="secondary" className="text-xs">Financials</Badge>
                      </div>
                      <div>
                        <h3 className="font-semibold mb-1" data-testid="link-net-profit-details">Net Position Details</h3>
                        <p className="text-sm text-muted-foreground">View income, expenses, and net position breakdowns by period.</p>
                      </div>
                      <div className="flex items-center gap-1 text-sm font-medium text-primary">
                        View Details <ChevronRight className="h-4 w-4" />
                      </div>
                    </div>
                  </Card>
                </Link>
              </div>

              {/* Developer Tools section */}
              {isDev && (
                <div className="space-y-6">
                  <div className="border-t pt-6">
                    <div className="flex items-center gap-3 mb-1">
                      <h3 className="text-lg font-semibold">Developer Tools</h3>
                      <Badge variant="outline" className="text-xs border-orange-500/50 text-orange-500">Dev Mode</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">Advanced maintenance and repair utilities available only in Dev Mode.</p>
                  </div>

                  <div className="flex items-start gap-3 p-4 bg-orange-500/10 rounded-md border border-orange-500/20 text-sm text-orange-700 dark:text-orange-400">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <p>These tools can modify or reset important company data. Use only for maintenance, migration, or debugging.</p>
                  </div>

                  {/* Nav-style dev tools grid */}
                  <div className="grid gap-4 md:grid-cols-2">
                    <Link href={`${pfx}/chatbot-settings`}>
                      <Card className="p-6 hover-elevate cursor-pointer h-full">
                        <div className="flex flex-col gap-4">
                          <div className="flex items-start justify-between gap-2">
                            <div className="p-2.5 bg-primary/10 rounded-md">
                              <Bot className="h-5 w-5 text-primary" />
                            </div>
                            <Badge variant="secondary" className="text-xs">AI Access</Badge>
                          </div>
                          <div>
                            <h3 className="font-semibold mb-1" data-testid="link-chatbot-settings">AI Chatbot Settings</h3>
                            <p className="text-sm text-muted-foreground">Manage AI assistant access permissions and review conversation history.</p>
                          </div>
                          <div className="flex items-center gap-1 text-sm font-medium text-primary">
                            Manage <ChevronRight className="h-4 w-4" />
                          </div>
                        </div>
                      </Card>
                    </Link>

                    <Link href={`${pfx}/notification-settings`}>
                      <Card className="p-6 hover-elevate cursor-pointer h-full">
                        <div className="flex flex-col gap-4">
                          <div className="flex items-start justify-between gap-2">
                            <div className="p-2.5 bg-primary/10 rounded-md">
                              <Bell className="h-5 w-5 text-primary" />
                            </div>
                            <Badge variant="secondary" className="text-xs">Alerts</Badge>
                          </div>
                          <div>
                            <h3 className="font-semibold mb-1" data-testid="link-notification-settings">Notification Settings</h3>
                            <p className="text-sm text-muted-foreground">Configure which users receive alerts for loading, invoice, and intercompany events.</p>
                          </div>
                          <div className="flex items-center gap-1 text-sm font-medium text-primary">
                            Manage <ChevronRight className="h-4 w-4" />
                          </div>
                        </div>
                      </Card>
                    </Link>

                    {appMode !== "factory" && (
                      <Link href={`${pfx}/account-groups`}>
                        <Card className="p-6 hover-elevate cursor-pointer h-full">
                          <div className="flex flex-col gap-4">
                            <div className="flex items-start justify-between gap-2">
                              <div className="p-2.5 bg-blue-500/10 rounded-md">
                                <Layers className="h-5 w-5 text-blue-500" />
                              </div>
                              <Badge variant="secondary" className="text-xs">Accounts</Badge>
                            </div>
                            <div>
                              <h3 className="font-semibold mb-1" data-testid="link-account-groups">Account Groups</h3>
                              <p className="text-sm text-muted-foreground">Create parent groups and organise accounts under them for better reporting.</p>
                            </div>
                            <div className="flex items-center gap-1 text-sm font-medium text-primary">
                              Open <ChevronRight className="h-4 w-4" />
                            </div>
                          </div>
                        </Card>
                      </Link>
                    )}

                    <Link href="/account-transfer">
                      <Card className="p-6 hover-elevate cursor-pointer h-full">
                        <div className="flex flex-col gap-4">
                          <div className="flex items-start justify-between gap-2">
                            <div className="p-2.5 bg-indigo-500/10 rounded-md">
                              <ArrowLeftRight className="h-5 w-5 text-indigo-500" />
                            </div>
                            <Badge variant="secondary" className="text-xs">Accounts</Badge>
                          </div>
                          <div>
                            <h3 className="font-semibold mb-1" data-testid="link-account-transfer">Account Transfer</h3>
                            <p className="text-sm text-muted-foreground">Move voucher entries from one ledger account to another in bulk.</p>
                          </div>
                          <div className="flex items-center gap-1 text-sm font-medium text-primary">
                            Open <ChevronRight className="h-4 w-4" />
                          </div>
                        </div>
                      </Card>
                    </Link>

                    <Card
                      className="p-6 hover-elevate cursor-pointer h-full"
                      onClick={() => {
                        setEmptyAccountsOpen(true);
                        setEmptyAccountsSelected([]);
                        setEmptyAccountsFilter("");
                      }}
                      data-testid="card-clean-empty-accounts"
                    >
                      <div className="flex flex-col gap-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="p-2.5 bg-rose-500/10 rounded-md">
                            <Eraser className="h-5 w-5 text-rose-500" />
                          </div>
                          <Badge variant="secondary" className="text-xs">Cleanup</Badge>
                        </div>
                        <div>
                          <h3 className="font-semibold mb-1">Clean Empty Accounts</h3>
                          <p className="text-sm text-muted-foreground">Find and delete ledger accounts with no entries or opening balance.</p>
                        </div>
                        <div className="flex items-center gap-1 text-sm font-medium text-primary">
                          Clean Up <ChevronRight className="h-4 w-4" />
                        </div>
                      </div>
                    </Card>

                    <Link href={`${pfx}/company-data-reset`}>
                      <Card className="p-6 hover-elevate cursor-pointer h-full">
                        <div className="flex flex-col gap-4">
                          <div className="flex items-start justify-between gap-2">
                            <div className="p-2.5 bg-red-500/10 rounded-md">
                              <Trash2 className="h-5 w-5 text-red-500" />
                            </div>
                            <Badge variant="outline" className="text-xs border-destructive/40 text-destructive">Destructive</Badge>
                          </div>
                          <div>
                            <h3 className="font-semibold mb-1" data-testid="link-company-data-reset">Company Data Reset</h3>
                            <p className="text-sm text-muted-foreground">Clear vouchers and opening balances for selected accounts.</p>
                          </div>
                          <div className="flex items-center gap-1 text-sm font-medium text-destructive">
                            Open <ChevronRight className="h-4 w-4" />
                          </div>
                        </div>
                      </Card>
                    </Link>

                    <Link href="/factory/bale-relabeling">
                      <Card className="p-6 hover-elevate cursor-pointer h-full">
                        <div className="flex flex-col gap-4">
                          <div className="flex items-start justify-between gap-2">
                            <div className="p-2.5 bg-yellow-500/10 rounded-md">
                              <RefreshCw className="h-5 w-5 text-yellow-500" />
                            </div>
                            <Badge variant="secondary" className="text-xs">Factory</Badge>
                          </div>
                          <div>
                            <h3 className="font-semibold mb-1" data-testid="link-bale-relabeling">Bale Relabeling</h3>
                            <p className="text-sm text-muted-foreground">Reassign or relabel bales and re-enter wipers stock by date.</p>
                          </div>
                          <div className="flex items-center gap-1 text-sm font-medium text-primary">
                            Open <ChevronRight className="h-4 w-4" />
                          </div>
                        </div>
                      </Card>
                    </Link>

                    <Link href="/factory/reprint-labels">
                      <Card className="p-6 hover-elevate cursor-pointer h-full">
                        <div className="flex flex-col gap-4">
                          <div className="flex items-start justify-between gap-2">
                            <div className="p-2.5 bg-blue-500/10 rounded-md">
                              <Printer className="h-5 w-5 text-blue-500" />
                            </div>
                            <Badge variant="secondary" className="text-xs">Factory</Badge>
                          </div>
                          <div>
                            <h3 className="font-semibold mb-1" data-testid="link-reprint-labels">Reprint Labels</h3>
                            <p className="text-sm text-muted-foreground">Reprint bale barcode labels for any existing bales.</p>
                          </div>
                          <div className="flex items-center gap-1 text-sm font-medium text-primary">
                            Open <ChevronRight className="h-4 w-4" />
                          </div>
                        </div>
                      </Card>
                    </Link>

                    {appMode === "factory" && (
                      <Link href="/factory/customer-logos">
                        <Card className="p-6 hover-elevate cursor-pointer h-full">
                          <div className="flex flex-col gap-4">
                            <div className="flex items-start justify-between gap-2">
                              <div className="p-2.5 bg-indigo-500/10 rounded-md">
                                <Upload className="h-5 w-5 text-indigo-500" />
                              </div>
                              <Badge variant="secondary" className="text-xs">Factory</Badge>
                            </div>
                            <div>
                              <h3 className="font-semibold mb-1" data-testid="link-customer-logos">Customer Logos</h3>
                              <p className="text-sm text-muted-foreground">Upload and manage per-customer logos used on bale labels.</p>
                            </div>
                            <div className="flex items-center gap-1 text-sm font-medium text-primary">
                              Open <ChevronRight className="h-4 w-4" />
                            </div>
                          </div>
                        </Card>
                      </Link>
                    )}

                    <Link href={`${pfx}/orphaned-records`}>
                      <Card className="p-6 hover-elevate cursor-pointer h-full">
                        <div className="flex flex-col gap-4">
                          <div className="flex items-start justify-between gap-2">
                            <div className="p-2.5 bg-orange-500/10 rounded-md">
                              <MapPin className="h-5 w-5 text-orange-500" />
                            </div>
                            <Badge variant="secondary" className="text-xs">Repair</Badge>
                          </div>
                          <div>
                            <h3 className="font-semibold mb-1" data-testid="link-orphaned-records">Orphaned Records</h3>
                            <p className="text-sm text-muted-foreground">Find and reassign records that reference deleted locations.</p>
                          </div>
                          <div className="flex items-center gap-1 text-sm font-medium text-primary">
                            Open <ChevronRight className="h-4 w-4" />
                          </div>
                        </div>
                      </Card>
                    </Link>

                    <Link href={`${pfx}/inventory-repair`}>
                      <Card className="p-6 hover-elevate cursor-pointer h-full">
                        <div className="flex flex-col gap-4">
                          <div className="flex items-start justify-between gap-2">
                            <div className="p-2.5 bg-orange-500/10 rounded-md">
                              <Wrench className="h-5 w-5 text-orange-500" />
                            </div>
                            <Badge variant="secondary" className="text-xs">Repair</Badge>
                          </div>
                          <div>
                            <h3 className="font-semibold mb-1" data-testid="link-inventory-repair">Inventory Repair Tool</h3>
                            <p className="text-sm text-muted-foreground">Detect and fix inventory discrepancies by replaying all voucher-backed operations.</p>
                          </div>
                          <div className="flex items-center gap-1 text-sm font-medium text-primary">
                            Open <ChevronRight className="h-4 w-4" />
                          </div>
                        </div>
                      </Card>
                    </Link>
                  </div>

                  {/* Action-based dev tools */}
                  <div className="grid gap-4 md:grid-cols-2">
                    <Card className="p-6">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                          <div className="p-3 bg-orange-500/10 rounded-lg">
                            <Trash2 className="h-6 w-6 text-orange-500" />
                          </div>
                          <div>
                            <h3 className="font-semibold" data-testid="text-reset-company-title">Reset Company Data</h3>
                            <p className="text-sm text-muted-foreground">
                              Delete Payment/Receipt/Journal vouchers for a company (keeps POS, inventory, containers, POs)
                            </p>
                          </div>
                        </div>
                        <Button
                          variant="destructive"
                          onClick={() => {
                            setResetDataResult(null);
                            setSelectedCompanyForReset("");
                            setIsResetDataDialogOpen(true);
                          }}
                          disabled={resetCompanyDataMutation.isPending}
                          data-testid="button-reset-company-data"
                        >
                          {resetCompanyDataMutation.isPending ? (
                            <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Resetting...</>
                          ) : (
                            "Reset Data"
                          )}
                        </Button>
                      </div>
                    </Card>

                    <Card className="p-6">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                          <div className="p-3 bg-green-500/10 rounded-lg">
                            <Calculator className="h-6 w-6 text-green-500" />
                          </div>
                          <div>
                            <h3 className="font-semibold" data-testid="text-init-balances-title">Initialize Accounting Balances</h3>
                            <p className="text-sm text-muted-foreground">
                              Create Owner's Capital accounts to balance the Import Cycle for all companies
                            </p>
                          </div>
                        </div>
                        <Button
                          onClick={() => {
                            setInitBalancesResult(null);
                            setIsInitBalancesDialogOpen(true);
                          }}
                          disabled={initializeBalancesMutation.isPending}
                          data-testid="button-init-accounting"
                        >
                          {initializeBalancesMutation.isPending ? (
                            <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processing...</>
                          ) : (
                            "Initialize"
                          )}
                        </Button>
                      </div>
                    </Card>

                    <Card className="p-6">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                          <div className="p-3 bg-blue-500/10 rounded-lg">
                            <RefreshCw className="h-6 w-6 text-blue-500" />
                          </div>
                          <div>
                            <h3 className="font-semibold" data-testid="text-fix-po-credits-title">Fix Old PO Inter-Company Credits</h3>
                            <p className="text-sm text-muted-foreground">
                              Create "Lubumbashi Credit" entries for old POs that were imported before this feature existed
                            </p>
                          </div>
                        </div>
                        <Button
                          onClick={() => {
                            setFixPOCreditsResult(null);
                            setIsFixPOCreditsDialogOpen(true);
                          }}
                          disabled={fixPOCreditsMutation.isPending}
                          data-testid="button-fix-po-credits"
                        >
                          {fixPOCreditsMutation.isPending ? (
                            <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processing...</>
                          ) : (
                            "Fix Credits"
                          )}
                        </Button>
                      </div>
                    </Card>

                    <Card className="p-6">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                          <div className="p-3 bg-orange-500/10 rounded-lg">
                            <RefreshCw className="h-6 w-6 text-orange-500" />
                          </div>
                          <div>
                            <h3 className="font-semibold" data-testid="text-fix-parent-po-title">Fix Parent Company PO Supplier Entries</h3>
                            <p className="text-sm text-muted-foreground">
                              Add missing supplier entries to POs imported directly to the parent company
                            </p>
                          </div>
                        </div>
                        <Button
                          onClick={() => fixParentPOSupplierMutation.mutate()}
                          disabled={fixParentPOSupplierMutation.isPending}
                          data-testid="button-fix-parent-po-supplier"
                        >
                          {fixParentPOSupplierMutation.isPending ? (
                            <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processing...</>
                          ) : (
                            "Fix Supplier Entries"
                          )}
                        </Button>
                      </div>
                    </Card>

                    <Card className="p-6">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                          <div className="p-3 bg-teal-500/10 rounded-lg">
                            <RefreshCw className="h-6 w-6 text-teal-500" />
                          </div>
                          <div>
                            <h3 className="font-semibold" data-testid="text-fix-sales-inventory-title">Fix Sales Inventory</h3>
                            <p className="text-sm text-muted-foreground">
                              Clean up orphaned negative inventory from POS sales edited with wrong locations
                            </p>
                          </div>
                        </div>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button data-testid="button-fix-sales-inventory">
                              Fix Inventory
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Fix Sales Inventory</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will find and reset orphaned negative inventory records that were caused by editing POS sales with incorrect locations. Are you sure you want to proceed?
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={async () => {
                                  try {
                                    const response = await fetch("/api/admin/fix-sales-inventory", {
                                      method: "POST",
                                      credentials: "include",
                                    });
                                    const result = await response.json();
                                    if (response.ok) {
                                      toast({
                                        title: "Inventory Fixed",
                                        description: `Fixed ${result.cleaned?.length || 0} orphaned records. ${result.negativeInventoryFound || 0} negative inventory items found total.`,
                                      });
                                      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
                                    } else {
                                      toast({
                                        title: "Error",
                                        description: result.message,
                                        variant: "destructive",
                                      });
                                    }
                                  } catch (error: any) {
                                    toast({
                                      title: "Error",
                                      description: error.message,
                                      variant: "destructive",
                                    });
                                  }
                                }}
                              >
                                Fix Inventory
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </Card>

                    <Card className="p-6">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                          <div className="p-3 bg-red-500/10 rounded-lg">
                            <Calculator className="h-6 w-6 text-red-500" />
                          </div>
                          <div>
                            <h3 className="font-semibold" data-testid="text-zero-balances-title">Zero Account Balances</h3>
                            <p className="text-sm text-muted-foreground">
                              Reset opening balances to zero for selected accounts (fresh start for new period)
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
                          <div className="p-3 bg-cyan-500/10 rounded-lg">
                            <Trash2 className="h-6 w-6 text-cyan-500" />
                          </div>
                          <div>
                            <h3 className="font-semibold" data-testid="text-fix-orphaned-pos-title">Fix Orphaned POS Data</h3>
                            <p className="text-sm text-muted-foreground">
                              Clean up orphaned sales items and voucher entries that may cause Import Cycle imbalance
                            </p>
                          </div>
                        </div>
                        <Button
                          onClick={async () => {
                            try {
                              const response = await fetch("/api/admin/fix-orphaned-pos-data", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                credentials: "include",
                              });
                              const result = await response.json();
                              if (response.ok) {
                                toast({ title: "Cleanup Complete", description: result.message });
                              } else {
                                toast({ title: "Error", description: result.message, variant: "destructive" });
                              }
                            } catch (error: any) {
                              toast({ title: "Error", description: error.message, variant: "destructive" });
                            }
                          }}
                          data-testid="button-fix-orphaned-pos"
                        >
                          Fix Orphaned
                        </Button>
                      </div>
                    </Card>

                    <Card className="p-6">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                          <div className="p-3 bg-purple-500/10 rounded-lg">
                            <RefreshCw className="h-6 w-6 text-purple-500" />
                          </div>
                          <div>
                            <h3 className="font-semibold" data-testid="text-recalc-equity-title">Recalculate Equity Adjustment</h3>
                            <p className="text-sm text-muted-foreground">
                              Zero out the Import Cycle Balance by adjusting the opening balance equity offset
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Button
                            disabled={isRecalcAllLoading}
                            onClick={async () => {
                              try {
                                const response = await fetch("/api/admin/recalculate-equity-adjustment", { method: "POST", credentials: "include" });
                                const result = await response.json();
                                if (response.ok) {
                                  toast({ title: "Equity Adjusted", description: result.message });
                                  queryClient.invalidateQueries({ queryKey: ["/api/stats/import-cycle-balance"] });
                                } else {
                                  toast({ title: "Error", description: result.message, variant: "destructive" });
                                }
                              } catch (error: any) {
                                toast({ title: "Error", description: error.message, variant: "destructive" });
                              }
                            }}
                            data-testid="button-recalc-equity"
                          >
                            Recalculate
                          </Button>
                          <Button
                            variant="outline"
                            disabled={isRecalcAllLoading}
                            onClick={async () => {
                              setIsRecalcAllLoading(true);
                              try {
                                const response = await fetch("/api/admin/recalculate-equity-adjustment-all", { method: "POST", credentials: "include" });
                                const result = await response.json();
                                if (response.ok) {
                                  toast({ title: "All Companies Adjusted", description: result.message });
                                  queryClient.invalidateQueries({ queryKey: ["/api/stats/import-cycle-balance"] });
                                } else {
                                  toast({ title: "Error", description: result.message, variant: "destructive" });
                                }
                              } catch (error: any) {
                                toast({ title: "Error", description: error.message, variant: "destructive" });
                              } finally {
                                setIsRecalcAllLoading(false);
                              }
                            }}
                            data-testid="button-recalc-equity-all"
                          >
                            {isRecalcAllLoading ? "Processing..." : "All Companies"}
                          </Button>
                        </div>
                      </div>
                    </Card>
                  </div>

                  {/* Complex diagnostic dev tools */}
                  <div className="space-y-4">
                    <Card className="p-6">
                      <div className="space-y-4">
                        <div className="flex items-center justify-between gap-4 flex-wrap">
                          <div className="flex items-center gap-4">
                            <div className="p-3 bg-amber-500/10 rounded-lg">
                              <AlertTriangle className="h-6 w-6 text-amber-500" />
                            </div>
                            <div>
                              <h3 className="font-semibold" data-testid="text-fix-orphaned-charges-title">Fix Orphaned Charge Vouchers</h3>
                              <p className="text-sm text-muted-foreground">
                                Delete charge vouchers (DUTY, TRANS, etc.) that shouldn't exist for OTW containers
                              </p>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              onClick={async () => {
                                try {
                                  setOrphanedChargesDiagnostic(null);
                                  const response = await fetch("/api/debug/orphaned-charge-vouchers", { method: "GET", credentials: "include" });
                                  const result = await response.json();
                                  if (response.ok) {
                                    setOrphanedChargesDiagnostic({ count: result.orphanedVoucherCount, impact: result.totalImpact, vouchers: result.orphanedVouchers || [] });
                                    if (result.orphanedVoucherCount === 0) toast({ title: "No Orphaned Vouchers", description: "All OTW containers have no leftover charge vouchers." });
                                  } else {
                                    toast({ title: "Error", description: result.message, variant: "destructive" });
                                  }
                                } catch (error: any) {
                                  toast({ title: "Error", description: error.message, variant: "destructive" });
                                }
                              }}
                              data-testid="button-diagnose-orphaned-charges"
                            >
                              Diagnose
                            </Button>
                            <Button
                              variant="destructive"
                              disabled={!orphanedChargesDiagnostic || orphanedChargesDiagnostic.count === 0 || isFixingOrphanedCharges}
                              onClick={async () => {
                                if (!orphanedChargesDiagnostic || orphanedChargesDiagnostic.count === 0) return;
                                if (!confirm(`Delete ${orphanedChargesDiagnostic.count} orphaned vouchers with impact of $${orphanedChargesDiagnostic.impact.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}? This cannot be undone.`)) return;
                                try {
                                  setIsFixingOrphanedCharges(true);
                                  const response = await fetch("/api/admin/fix-orphaned-charge-vouchers", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include" });
                                  const result = await response.json();
                                  if (response.ok) {
                                    toast({ title: "Cleanup Complete", description: result.message });
                                    setOrphanedChargesDiagnostic(null);
                                    queryClient.invalidateQueries({ queryKey: ["/api/stats/import-cycle-balance"] });
                                  } else {
                                    toast({ title: "Error", description: result.message, variant: "destructive" });
                                  }
                                } catch (error: any) {
                                  toast({ title: "Error", description: error.message, variant: "destructive" });
                                } finally {
                                  setIsFixingOrphanedCharges(false);
                                }
                              }}
                              data-testid="button-fix-orphaned-charges"
                            >
                              {isFixingOrphanedCharges ? "Deleting..." : "Delete Orphaned"}
                            </Button>
                          </div>
                        </div>
                        {orphanedChargesDiagnostic && orphanedChargesDiagnostic.count > 0 && (
                          <div className="bg-destructive/10 p-4 rounded-lg space-y-2">
                            <p className="font-medium text-destructive">
                              Found {orphanedChargesDiagnostic.count} orphaned vouchers (Impact: ${orphanedChargesDiagnostic.impact.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })})
                            </p>
                            <div className="max-h-32 overflow-y-auto text-sm">
                              {orphanedChargesDiagnostic.vouchers.map((v: any, i: number) => (
                                <div key={i} className="flex justify-between text-muted-foreground py-1 border-b last:border-0">
                                  <span>{v.voucherNumber}</span>
                                  <span>Container: {v.containerNumber}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </Card>

                    <Card className="p-6">
                      <div className="space-y-4">
                        <div className="flex items-center justify-between gap-4 flex-wrap">
                          <div className="flex items-center gap-4">
                            <div className="p-3 bg-red-500/10 rounded-lg">
                              <Trash2 className="h-6 w-6 text-red-500" />
                            </div>
                            <div>
                              <h3 className="font-semibold" data-testid="text-orphaned-pos-sales-title">Orphaned POS Sales at Deleted Locations</h3>
                              <p className="text-sm text-muted-foreground">
                                Find and delete POS sale vouchers linked to deleted locations
                              </p>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              disabled={isLoadingOrphanedPosSales}
                              onClick={async () => {
                                try {
                                  setIsLoadingOrphanedPosSales(true);
                                  const response = await fetch("/api/admin/orphaned-pos-sales", { method: "GET", credentials: "include" });
                                  const result = await response.json();
                                  if (response.ok) {
                                    setOrphanedPosSalesDiagnostic({ count: result.count, totalImpact: result.totalImpact, vouchers: result.vouchers || [] });
                                    if (result.count === 0) toast({ title: "No Orphaned Sales Found", description: "All POS sales are linked to valid locations." });
                                  } else {
                                    toast({ title: "Error", description: result.message, variant: "destructive" });
                                  }
                                } catch (error: any) {
                                  toast({ title: "Error", description: error.message, variant: "destructive" });
                                } finally {
                                  setIsLoadingOrphanedPosSales(false);
                                }
                              }}
                              data-testid="button-diagnose-orphaned-pos-sales"
                            >
                              {isLoadingOrphanedPosSales ? "Checking..." : "Diagnose"}
                            </Button>
                            <Button
                              variant="destructive"
                              disabled={!orphanedPosSalesDiagnostic || orphanedPosSalesDiagnostic.count === 0 || isFixingOrphanedPosSales}
                              onClick={async () => {
                                if (!orphanedPosSalesDiagnostic || orphanedPosSalesDiagnostic.count === 0) return;
                                if (!confirm(`Delete ${orphanedPosSalesDiagnostic.count} orphaned POS vouchers with impact of $${orphanedPosSalesDiagnostic.totalImpact.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}? This cannot be undone.`)) return;
                                try {
                                  setIsFixingOrphanedPosSales(true);
                                  const response = await fetch("/api/admin/delete-orphaned-pos-sales", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include" });
                                  const result = await response.json();
                                  if (response.ok) {
                                    toast({ title: "Cleanup Complete", description: result.message });
                                    setOrphanedPosSalesDiagnostic(null);
                                  } else {
                                    toast({ title: "Error", description: result.message, variant: "destructive" });
                                  }
                                } catch (error: any) {
                                  toast({ title: "Error", description: error.message, variant: "destructive" });
                                } finally {
                                  setIsFixingOrphanedPosSales(false);
                                }
                              }}
                              data-testid="button-delete-orphaned-pos-sales"
                            >
                              {isFixingOrphanedPosSales ? "Deleting..." : "Delete Orphaned"}
                            </Button>
                          </div>
                        </div>
                        {orphanedPosSalesDiagnostic && orphanedPosSalesDiagnostic.count > 0 && (
                          <div className="bg-destructive/10 p-4 rounded-lg space-y-2">
                            <p className="font-medium text-destructive">
                              Found {orphanedPosSalesDiagnostic.count} orphaned POS vouchers (Impact: ${orphanedPosSalesDiagnostic.totalImpact.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })})
                            </p>
                            <div className="max-h-32 overflow-y-auto text-sm">
                              {orphanedPosSalesDiagnostic.vouchers.slice(0, 20).map((v: any, i: number) => (
                                <div key={i} className="flex justify-between text-muted-foreground py-1 border-b last:border-0">
                                  <span>{v.voucherNumber}</span>
                                  <span>Location ID: {v.locationId} (deleted)</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </Card>

                    <Card className="p-6">
                      <div className="space-y-4">
                        <div className="flex items-center justify-between gap-4 flex-wrap">
                          <div className="flex items-center gap-4">
                            <div className="p-3 bg-blue-500/10 rounded-lg">
                              <Package className="h-6 w-6 text-blue-500" />
                            </div>
                            <div>
                              <h3 className="font-semibold" data-testid="text-container-offload-analysis">Container Offload Analysis</h3>
                              <p className="text-sm text-muted-foreground">
                                Analyze PO line items for a container to detect duplicates, blank quantities, and other issues
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Select value={selectedContainerForDiag} onValueChange={setSelectedContainerForDiag}>
                              <SelectTrigger className="w-[200px]" data-testid="select-container-for-diag">
                                <SelectValue placeholder="Select container" />
                              </SelectTrigger>
                              <SelectContent>
                                {containersForDiag.map((c: any) => (
                                  <SelectItem key={c.id} value={c.id.toString()}>
                                    {c.containerNumber} ({c.status})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              variant="outline"
                              disabled={!selectedContainerForDiag || isLoadingContainerDiag}
                              onClick={async () => {
                                if (!selectedContainerForDiag) return;
                                try {
                                  setIsLoadingContainerDiag(true);
                                  setContainerDiagResult(null);
                                  const response = await fetch(`/api/containers/${selectedContainerForDiag}/offload-diagnostics`, { method: "GET", credentials: "include" });
                                  const result = await response.json();
                                  if (response.ok) {
                                    setContainerDiagResult(result);
                                    if (!result.hasIssues) toast({ title: "No Issues Found", description: `Container ${result.containerNumber} has ${result.lineItemCount} valid line items, total ${result.totalQuantity} bales.` });
                                  } else {
                                    toast({ title: "Error", description: result.message, variant: "destructive" });
                                  }
                                } catch (error: any) {
                                  toast({ title: "Error", description: error.message, variant: "destructive" });
                                } finally {
                                  setIsLoadingContainerDiag(false);
                                }
                              }}
                              data-testid="button-analyze-container"
                            >
                              {isLoadingContainerDiag ? "Analyzing..." : "Analyze"}
                            </Button>
                          </div>
                        </div>
                        {containerDiagResult && (
                          <div className={`p-4 rounded-lg space-y-3 ${containerDiagResult.hasIssues ? 'bg-destructive/10' : 'bg-green-500/10'}`}>
                            <div className="flex items-center justify-between">
                              <p className={`font-medium ${containerDiagResult.hasIssues ? 'text-destructive' : 'text-green-600'}`}>
                                {containerDiagResult.containerNumber} ({containerDiagResult.containerStatus})
                              </p>
                              <p className="text-sm text-muted-foreground">
                                {containerDiagResult.poCount} POs, {containerDiagResult.lineItemCount} line items
                              </p>
                            </div>
                            {containerDiagResult.hasIssues && (
                              <div className="space-y-2">
                                <p className="text-sm font-medium text-destructive">Issues Found:</p>
                                <div className="max-h-48 overflow-y-auto text-sm space-y-1">
                                  {containerDiagResult.lineItems.filter((item: any) => !item.isValid).map((item: any, i: number) => (
                                    <div key={i} className="flex justify-between gap-2 py-1 border-b last:border-0">
                                      <span className="truncate">{item.poNumber} - {item.stockItemCode || 'No stock item'} (Qty: {item.quantity})</span>
                                      <span className="text-destructive whitespace-nowrap">{item.issues.join(', ')}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </Card>

                    <Card className="p-6">
                      <div className="flex items-center justify-between gap-4 flex-wrap">
                        <div className="flex items-center gap-4">
                          <div className="p-3 bg-purple-500/10 rounded-lg">
                            <Building2 className="h-6 w-6 text-purple-500" />
                          </div>
                          <div>
                            <h3 className="font-semibold" data-testid="text-parent-company-title">Parent Company for Net Position</h3>
                            <p className="text-sm text-muted-foreground">
                              Set which company is the parent for supplier balance reporting. Suppliers are only counted in the parent company's Net Position.
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Select
                            value={parentCompanyData?.parentCompanyId?.toString() || "none"}
                            onValueChange={(value) => {
                              const companyId = value === "none" ? null : parseInt(value, 10);
                              setParentCompanyMutation.mutate(companyId);
                            }}
                            disabled={setParentCompanyMutation.isPending || (currentUser?.role !== "Admin" && currentUser?.role !== "Developer")}
                          >
                            <SelectTrigger className="w-[200px]" data-testid="select-parent-company">
                              <SelectValue placeholder="Select parent company" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Not Set</SelectItem>
                              {companies.map((company: any) => (
                                <SelectItem key={company.id} value={company.id.toString()}>
                                  {company.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {currentUser?.role !== "Admin" && currentUser?.role !== "Developer" && (
                            <span className="text-xs text-muted-foreground">(Admin only)</span>
                          )}
                        </div>
                      </div>
                    </Card>

                    <NetPositionAdjustmentCard />
                  </div>
                </div>
              )}
            </div>
            );
          })()}

        </div>

        {/* Initialize Accounting Balances Dialog */}
        <AlertDialog open={isInitBalancesDialogOpen} onOpenChange={setIsInitBalancesDialogOpen}>
          <AlertDialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
            <AlertDialogHeader>
              <AlertDialogTitle>Initialize Accounting Balances</AlertDialogTitle>
              <AlertDialogDescription asChild>
                {!initBalancesResult ? (
                  <p>This will create Owner's Capital accounts for each company to balance the Import Cycle. This action cannot be easily undone.</p>
                ) : (
                  <div className="space-y-4 mt-4">
                    <div className="text-foreground font-medium">{initBalancesResult.message}</div>
                    {initBalancesResult.results?.map((r: any) => (
                      <div key={r.companyId} className="p-3 border rounded-md space-y-2">
                        <div className="font-medium">{r.companyName}</div>
                        <div className="text-sm">Imbalance: ${formatNumber(r.imbalance || 0)}</div>
                        <div className="text-sm">{r.message}</div>
                        
                        {r.components && (
                          <div className="text-sm mt-3 border-t pt-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="w-full justify-between"
                              onClick={() => setExpandedBreakdownId(expandedBreakdownId === r.companyId ? null : r.companyId)}
                              data-testid={`button-expand-breakdown-${r.companyId}`}
                            >
                              <span>View Calculation Breakdown</span>
                              {expandedBreakdownId === r.companyId ? (
                                <ChevronUp className="h-4 w-4 ml-2" />
                              ) : (
                                <ChevronDown className="h-4 w-4 ml-2" />
                              )}
                            </Button>
                            {expandedBreakdownId === r.companyId && (
                              <>
                                <div className="mt-2 grid grid-cols-2 gap-4 p-2 bg-muted/50 rounded">
                                  <div>
                                    <div className="font-medium text-green-600 dark:text-green-400 mb-1">Assets (Debit)</div>
                                    {r.components.assets?.map((c: any, i: number) => (
                                      <div key={i} className="flex justify-between">
                                        <span>{c.name}</span>
                                        <span>${formatNumber(c.value)}</span>
                                      </div>
                                    ))}
                                    <div className="border-t mt-1 pt-1 font-medium flex justify-between">
                                      <span>Total Assets</span>
                                      <span>${formatNumber(r.components.totalAssets || 0)}</span>
                                    </div>
                                  </div>
                                  <div>
                                    <div className="font-medium text-red-600 dark:text-red-400 mb-1">Liabilities (Credit)</div>
                                    {r.components.liabilities?.map((c: any, i: number) => (
                                      <div key={i} className="flex justify-between">
                                        <span>{c.name}</span>
                                        <span>${formatNumber(c.value)}</span>
                                      </div>
                                    ))}
                                    <div className="border-t mt-1 pt-1 font-medium flex justify-between">
                                      <span>Total Liabilities</span>
                                      <span>${formatNumber(r.components.totalLiabilities || 0)}</span>
                                    </div>
                                  </div>
                                </div>
                                <div className="mt-2 p-2 bg-muted rounded text-center font-medium">
                                  Net Imbalance = ${formatNumber(r.components.totalAssets || 0)} - ${formatNumber(r.components.totalLiabilities || 0)} = ${formatNumber(r.imbalance || 0)}
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                    {initBalancesResult.sqlForProduction && (
                      <div className="mt-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="font-medium">SQL for Production (Copy to Render):</div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              navigator.clipboard.writeText(initBalancesResult.sqlForProduction);
                              toast({
                                title: "Copied",
                                description: "SQL copied to clipboard",
                              });
                            }}
                            data-testid="button-copy-sql"
                          >
                            Copy SQL
                          </Button>
                        </div>
                        <pre className="p-3 bg-muted rounded-md text-xs overflow-x-auto whitespace-pre-wrap">
                          {initBalancesResult.sqlForProduction}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Close</AlertDialogCancel>
              {!initBalancesResult && (
                <AlertDialogAction
                  onClick={() => initializeBalancesMutation.mutate()}
                  disabled={initializeBalancesMutation.isPending}
                >
                  {initializeBalancesMutation.isPending ? "Processing..." : "Initialize All Companies"}
                </AlertDialogAction>
              )}
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Fix Old PO Credits Dialog */}
        <AlertDialog open={isFixPOCreditsDialogOpen} onOpenChange={(open) => {
          setIsFixPOCreditsDialogOpen(open);
          if (!open) {
            setSelectedCompanyForFix("");
            setSelectedParentCompanyForFix("");
            setFixPOCreditsResult(null);
            setReversePOCreditsResult(null);
          }
        }}>
          <AlertDialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <AlertDialogHeader>
              <AlertDialogTitle>Inter-Company Credit Management</AlertDialogTitle>
              <AlertDialogDescription asChild>
                {!fixPOCreditsResult && !reversePOCreditsResult ? (
                  <div className="space-y-4">
                    <p>
                      <strong>Fix:</strong> Creates inter-company credit entries for old offloaded POs.
                      <br />
                      <strong>Reverse:</strong> Removes all inter-company (INTERCO) vouchers.
                    </p>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium text-foreground">Subsidiary Company (source)</label>
                        <Select
                          value={selectedCompanyForFix}
                          onValueChange={setSelectedCompanyForFix}
                        >
                          <SelectTrigger className="mt-1" data-testid="select-company-for-fix">
                            <SelectValue placeholder="Choose subsidiary..." />
                          </SelectTrigger>
                          <SelectContent>
                            {companies
                              .filter((c: any) => c.id.toString() !== selectedParentCompanyForFix)
                              .map((company: any) => (
                                <SelectItem key={company.id} value={company.id.toString()}>
                                  {company.name}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground mt-1">The company whose POs need fixing</p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-foreground">Parent Company (receiver)</label>
                        <Select
                          value={selectedParentCompanyForFix}
                          onValueChange={setSelectedParentCompanyForFix}
                        >
                          <SelectTrigger className="mt-1" data-testid="select-parent-for-fix">
                            <SelectValue placeholder="Choose parent..." />
                          </SelectTrigger>
                          <SelectContent>
                            {companies
                              .filter((c: any) => c.id.toString() !== selectedCompanyForFix)
                              .map((company: any) => (
                                <SelectItem key={company.id} value={company.id.toString()}>
                                  {company.name}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground mt-1">The company that paid suppliers</p>
                      </div>
                    </div>
                    {selectedCompanyForFix && selectedParentCompanyForFix && (
                      <div className="status-info p-3 rounded-md">
                        <p className="text-sm">
                          This will create credit entries for <strong>{companies.find((c: any) => c.id.toString() === selectedCompanyForFix)?.name}</strong> towards <strong>{companies.find((c: any) => c.id.toString() === selectedParentCompanyForFix)?.name}</strong>.
                        </p>
                      </div>
                    )}
                  </div>
                ) : fixPOCreditsResult ? (
                  <div className="space-y-4 mt-4">
                    <div className="text-foreground font-medium">{fixPOCreditsResult.message}</div>
                    <div className="grid grid-cols-2 gap-4 p-3 bg-muted/50 rounded">
                      <div>
                        <div className="text-sm text-muted-foreground">POs Fixed</div>
                        <div className="text-lg font-semibold">{fixPOCreditsResult.fixed}</div>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground">Total Amount</div>
                        <div className="text-lg font-semibold">${formatNumber(parseFloat(fixPOCreditsResult.totalAmount || 0))}</div>
                      </div>
                    </div>
                    {fixPOCreditsResult.details?.length > 0 && (
                      <div className="mt-4">
                        <div className="font-medium mb-2">Details:</div>
                        <div className="max-h-60 overflow-y-auto border rounded">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Company</TableHead>
                                <TableHead>PO Number</TableHead>
                                <TableHead className="text-right">Amount</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {fixPOCreditsResult.details.map((d: any, i: number) => (
                                <TableRow key={i}>
                                  <TableCell>{d.company}</TableCell>
                                  <TableCell>{d.poNumber}</TableCell>
                                  <TableCell className="text-right">${formatNumber(d.amount)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    )}
                  </div>
                ) : reversePOCreditsResult ? (
                  <div className="space-y-4 mt-4">
                    <div className="text-foreground font-medium">{reversePOCreditsResult.message}</div>
                    <div className="p-3 bg-muted/50 rounded">
                      <div className="text-sm text-muted-foreground">Vouchers Reversed</div>
                      <div className="text-lg font-semibold">{reversePOCreditsResult.reversed}</div>
                    </div>
                    {reversePOCreditsResult.details?.length > 0 && (
                      <div className="mt-4">
                        <div className="font-medium mb-2">Deleted Vouchers:</div>
                        <div className="max-h-60 overflow-y-auto border rounded">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Company</TableHead>
                                <TableHead>Voucher Number</TableHead>
                                <TableHead className="text-right">Amount</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {reversePOCreditsResult.details.map((d: any, i: number) => (
                                <TableRow key={i}>
                                  <TableCell>{d.company}</TableCell>
                                  <TableCell>{d.voucherNumber}</TableCell>
                                  <TableCell className="text-right">${formatNumber(parseFloat(d.amount))}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="gap-2">
              <AlertDialogCancel>Close</AlertDialogCancel>
              {!fixPOCreditsResult && !reversePOCreditsResult && (
                <>
                  <Button
                    variant="destructive"
                    onClick={() => reversePOCreditsMutation.mutate({ 
                      companyId: parseInt(selectedCompanyForFix), 
                      parentCompanyId: parseInt(selectedParentCompanyForFix) 
                    })}
                    disabled={reversePOCreditsMutation.isPending || fixPOCreditsMutation.isPending || !selectedCompanyForFix || !selectedParentCompanyForFix}
                    data-testid="button-reverse-po-credits"
                  >
                    {reversePOCreditsMutation.isPending ? "Reversing..." : "Reverse Credits"}
                  </Button>
                  <AlertDialogAction
                    onClick={() => fixPOCreditsMutation.mutate({ 
                      companyId: parseInt(selectedCompanyForFix), 
                      parentCompanyId: parseInt(selectedParentCompanyForFix) 
                    })}
                    disabled={fixPOCreditsMutation.isPending || reversePOCreditsMutation.isPending || !selectedCompanyForFix || !selectedParentCompanyForFix}
                  >
                    {fixPOCreditsMutation.isPending ? "Processing..." : "Fix Credits"}
                  </AlertDialogAction>
                </>
              )}
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Reset Company Data Dialog */}
        <AlertDialog open={isResetDataDialogOpen} onOpenChange={(open) => {
          setIsResetDataDialogOpen(open);
          if (!open) {
            setSelectedCompanyForReset("");
            setResetDataResult(null);
          }
        }}>
          <AlertDialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <AlertDialogHeader>
              <AlertDialogTitle>Reset Company Data</AlertDialogTitle>
              <AlertDialogDescription asChild>
                {!resetDataResult ? (
                  <div className="space-y-4">
                    <div className="status-warning p-3 rounded-md">
                      <p className="text-sm font-medium">
                        Warning: This action permanently deletes data. This cannot be undone.
                      </p>
                    </div>
                    
                    <div>
                      <label className="text-sm font-medium text-foreground">Select Company to Reset</label>
                      <Select
                        value={selectedCompanyForReset}
                        onValueChange={setSelectedCompanyForReset}
                      >
                        <SelectTrigger className="mt-1" data-testid="select-company-for-reset">
                          <SelectValue placeholder="Choose a company..." />
                        </SelectTrigger>
                        <SelectContent>
                          {companies.map((company: any) => (
                            <SelectItem key={company.id} value={company.id.toString()}>
                              {company.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4 mt-4">
                      <div>
                        <h4 className="text-sm font-medium text-red-600 mb-2">Will be DELETED:</h4>
                        <ul className="text-xs text-muted-foreground space-y-1">
                          <li>• Payment vouchers</li>
                          <li>• Receipt vouchers</li>
                          <li>• Journal vouchers</li>
                          <li>• Associated voucher entries</li>
                        </ul>
                      </div>
                      <div>
                        <h4 className="text-sm font-medium text-green-600 mb-2">Will be PRESERVED:</h4>
                        <ul className="text-xs text-muted-foreground space-y-1">
                          <li>• All containers & offloads</li>
                          <li>• Inventory/stock balances</li>
                          <li>• Locations & accounts</li>
                          <li>• POS vouchers</li>
                          <li>• Production/Consumption/Stock Transfer</li>
                          <li>• Purchase Orders</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 mt-4">
                    <div className="text-foreground font-medium">{resetDataResult.message}</div>
                    <div className="grid grid-cols-2 gap-4 p-3 bg-muted/50 rounded">
                      <div>
                        <span className="text-sm text-muted-foreground">Vouchers Deleted:</span>
                        <span className="ml-2 font-medium">{resetDataResult.deletedVouchers}</span>
                      </div>
                      <div>
                        <span className="text-sm text-muted-foreground">Entries Deleted:</span>
                        <span className="ml-2 font-medium">{resetDataResult.deletedEntries}</span>
                      </div>
                    </div>
                    {resetDataResult.typeSummary && (
                      <div className="text-sm space-y-1">
                        <div className="font-medium">Breakdown by type:</div>
                        {resetDataResult.typeSummary.map((ts: any) => (
                          <div key={ts.type} className="flex justify-between text-muted-foreground">
                            <span>{ts.type}:</span>
                            <span>{ts.count}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="gap-2">
              <AlertDialogCancel>Close</AlertDialogCancel>
              {!resetDataResult && (
                <Button
                  variant="destructive"
                  onClick={() => resetCompanyDataMutation.mutate(parseInt(selectedCompanyForReset))}
                  disabled={resetCompanyDataMutation.isPending || !selectedCompanyForReset}
                  data-testid="button-confirm-reset"
                >
                  {resetCompanyDataMutation.isPending ? "Resetting..." : "Reset Company Data"}
                </Button>
              )}
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Zero Account Balances Dialog */}
        <AlertDialog open={isZeroBalanceDialogOpen} onOpenChange={(open) => {
          setIsZeroBalanceDialogOpen(open);
          if (!open) {
            setSelectedAccountsToZero([]);
          }
        }}>
          <AlertDialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <Calculator className="h-5 w-5 text-red-500" />
                Zero Account Balances
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-4">
                  <p>
                    Select accounts to zero their opening balances. This gives you a fresh start for a new period while keeping all historical vouchers intact.
                  </p>
                  
                  {!selectedCompany ? (
                    <p className="text-destructive">Please select a company first.</p>
                  ) : (
                    <>
                      <div className="flex items-center justify-between border-b pb-2">
                        <div className="flex items-center gap-4">
                          <Checkbox
                            checked={allLedgerAccounts.length > 0 && selectedAccountsToZero.length === allLedgerAccounts.filter((a: any) => parseFloat(a.openingBalance || "0") !== 0).length}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedAccountsToZero(allLedgerAccounts.filter((a: any) => parseFloat(a.openingBalance || "0") !== 0).map((a: any) => a.id));
                              } else {
                                setSelectedAccountsToZero([]);
                              }
                            }}
                            data-testid="checkbox-select-all-accounts"
                          />
                          <Label className="font-medium">Select All with Non-Zero Balances</Label>
                        </div>
                        <Badge variant="outline">
                          {selectedAccountsToZero.length} selected
                        </Badge>
                      </div>

                      <div className="max-h-96 overflow-y-auto border rounded">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-12"></TableHead>
                              <TableHead>Account Name</TableHead>
                              <TableHead>Type</TableHead>
                              <TableHead className="text-right">Opening Balance</TableHead>
                              <TableHead className="text-center">Side</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {allLedgerAccounts
                              .filter((account: any) => !account.deletedAt && account.active)
                              .sort((a: any, b: any) => a.accountType.localeCompare(b.accountType) || a.name.localeCompare(b.name))
                              .map((account: any) => {
                                const balance = parseFloat(account.openingBalance || "0");
                                const hasBalance = balance !== 0;
                                return (
                                  <TableRow key={account.id} className={hasBalance ? "" : "opacity-50"}>
                                    <TableCell>
                                      <Checkbox
                                        checked={selectedAccountsToZero.includes(account.id)}
                                        disabled={!hasBalance}
                                        onCheckedChange={(checked) => {
                                          if (checked) {
                                            setSelectedAccountsToZero([...selectedAccountsToZero, account.id]);
                                          } else {
                                            setSelectedAccountsToZero(selectedAccountsToZero.filter(id => id !== account.id));
                                          }
                                        }}
                                        data-testid={`checkbox-account-${account.id}`}
                                      />
                                    </TableCell>
                                    <TableCell className="font-medium">{account.name}</TableCell>
                                    <TableCell>
                                      <Badge variant="outline" className="text-xs">
                                        {account.accountType}
                                      </Badge>
                                    </TableCell>
                                    <TableCell className={`text-right ${hasBalance ? "font-medium" : ""}`}>
                                      {formatNumber(Math.abs(balance))}
                                    </TableCell>
                                    <TableCell className="text-center">
                                      {account.openingBalanceSide || "-"}
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                          </TableBody>
                        </Table>
                      </div>

                      {selectedAccountsToZero.length > 0 && (
                        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md">
                          <p className="text-sm font-medium text-destructive">
                            Warning: This will set the opening balance to $0.00 for {selectedAccountsToZero.length} account(s). This action cannot be easily undone.
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="button-cancel-zero-balances">Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => zeroBalancesMutation.mutate(selectedAccountsToZero)}
                disabled={zeroBalancesMutation.isPending || selectedAccountsToZero.length === 0}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                data-testid="button-confirm-zero-balances"
              >
                {zeroBalancesMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processing...</>
                ) : (
                  `Zero ${selectedAccountsToZero.length} Account(s)`
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Clean Empty Accounts Dialog */}
        <Dialog open={emptyAccountsOpen} onOpenChange={(open) => {
          setEmptyAccountsOpen(open);
          if (!open) { setEmptyAccountsSelected([]); setEmptyAccountsFilter(""); }
        }}>
          <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Eraser className="h-5 w-5 text-rose-500" />
                Clean Empty Accounts
              </DialogTitle>
              <DialogDescription>
                Accounts listed here have no voucher entries, no opening balance, and no child accounts. Select any you want to permanently delete.
              </DialogDescription>
            </DialogHeader>

            <div className="flex items-center gap-2 mt-1">
              <Input
                placeholder="Filter by name or code..."
                value={emptyAccountsFilter}
                onChange={(e) => setEmptyAccountsFilter(e.target.value)}
                data-testid="input-empty-accounts-filter"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchEmptyAccounts()}
                data-testid="button-refresh-empty-accounts"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0">
              {isLoadingEmptyAccounts ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  Loading...
                </div>
              ) : (() => {
                const filtered = emptyAccounts.filter((a: any) => {
                  if (!emptyAccountsFilter) return true;
                  const q = emptyAccountsFilter.toLowerCase();
                  return (a.name || "").toLowerCase().includes(q) || (a.code || "").toLowerCase().includes(q);
                });
                if (filtered.length === 0) {
                  return (
                    <div className="text-center py-10 text-muted-foreground">
                      {emptyAccountsFilter ? "No accounts match your filter." : "No empty accounts found — everything is in use."}
                    </div>
                  );
                }
                const allSelected = filtered.length > 0 && filtered.every((a: any) => emptyAccountsSelected.includes(a.id));
                return (
                  <Table>
                    <TableHeader className="sticky top-0 bg-background z-10">
                      <TableRow>
                        <TableHead className="w-10">
                          <Checkbox
                            checked={allSelected}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                const newIds = filtered.map((a: any) => a.id);
                                setEmptyAccountsSelected(prev => [...new Set([...prev, ...newIds])]);
                              } else {
                                const filteredIds = new Set(filtered.map((a: any) => a.id));
                                setEmptyAccountsSelected(prev => prev.filter(id => !filteredIds.has(id)));
                              }
                            }}
                            data-testid="checkbox-select-all-empty"
                          />
                        </TableHead>
                        <TableHead>Account Name</TableHead>
                        <TableHead>Code</TableHead>
                        <TableHead>Type</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map((a: any) => (
                        <TableRow
                          key={a.id}
                          className="cursor-pointer"
                          onClick={() => setEmptyAccountsSelected(prev =>
                            prev.includes(a.id) ? prev.filter(id => id !== a.id) : [...prev, a.id]
                          )}
                          data-testid={`row-empty-account-${a.id}`}
                        >
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={emptyAccountsSelected.includes(a.id)}
                              onCheckedChange={(checked) => {
                                setEmptyAccountsSelected(prev =>
                                  checked ? [...prev, a.id] : prev.filter(id => id !== a.id)
                                );
                              }}
                              data-testid={`checkbox-empty-account-${a.id}`}
                            />
                          </TableCell>
                          <TableCell className="font-medium">{a.name}</TableCell>
                          <TableCell className="text-muted-foreground text-sm">{a.code || "—"}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">{a.accountType || "—"}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                );
              })()}
            </div>

            <DialogFooter className="flex-shrink-0 gap-2 mt-2">
              <span className="text-sm text-muted-foreground mr-auto self-center">
                {emptyAccountsSelected.length > 0
                  ? `${emptyAccountsSelected.length} account(s) selected`
                  : `${emptyAccounts.length} empty account(s) found`}
              </span>
              <Button variant="outline" onClick={() => setEmptyAccountsOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={emptyAccountsSelected.length === 0 || bulkDeleteAccountsMutation.isPending}
                onClick={() => bulkDeleteAccountsMutation.mutate(emptyAccountsSelected)}
                data-testid="button-delete-empty-accounts"
              >
                {bulkDeleteAccountsMutation.isPending
                  ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Deleting...</>
                  : <><Trash2 className="h-4 w-4 mr-2" />Delete {emptyAccountsSelected.length} Account(s)</>}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </div>
    );
  }
  
