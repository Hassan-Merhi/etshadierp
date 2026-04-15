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
  import { getApiRequest, factoryApiRequest } from "@/lib/factoryApi";
  import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
  import { Plus, Edit, Building2, Users, ChevronDown, ChevronUp, Trash2, CalendarRange, Settings2, Wrench, MapPin, ChevronRight, Bot, MessageCircle, RefreshCw, Calculator, Loader2, Shield, AlertTriangle, PieChart, Key, Lock, Package, Eye, History, Clock, Upload, Download, Database, TrendingUp, ShoppingCart, Check, X, Copy, ExternalLink, ArrowLeftRight, WifiOff, Wifi, CheckCircle2, Printer, Layers } from "lucide-react";
import { utils, writeFile, readFile, read, ExcelJS } from "@/lib/excelHelper";
  import { Link } from "wouter";
  import { useDateFormat } from "@/contexts/DateFormatContext";
  import { insertUserSchema, insertCompanySchema, insertUserCompanyRoleSchema, FEATURE_KEYS, FEATURE_PAGE_INFO, type FeatureKey } from "@shared/schema";
  import { FACTORY_NAV_PAGES } from "@/components/FactorySidebar";
  import { FiscalPeriodTab } from "@/components/FiscalPeriodTab";
  import { useCompany } from "@/contexts/CompanyContext";
  import { ExchangeRateSettings } from "@/components/ExchangeRateSettings";
  import { formatNumber } from "@/lib/formatNumber";
  
  const userFormSchema = insertUserSchema;
  const companyFormSchema = insertCompanySchema;
  const roleAssignmentSchema = insertUserCompanyRoleSchema.refine(
    (data) => {
      // If role is POS, assignedLocationId must be present
      if (data.role.startsWith("POS") && !data.assignedLocationId) {
        return false;
      }
      return true;
    },
    {
      message: "POS roles require an assigned location",
      path: ["assignedLocationId"],
    }
  );
  
  type UserFormData = z.infer<typeof userFormSchema>;
  type CompanyFormData = z.infer<typeof companyFormSchema>;
  type RoleAssignmentData = z.infer<typeof roleAssignmentSchema>;


import { ParentCreditAccountSelect } from "./settings/ParentCreditAccountSelect";
import { NetPositionAdjustmentCard } from "./settings/NetPositionAdjustmentCard";
import { ActiveUsersSection } from "./settings/ActiveUsersSection";
import { DataToolsTab } from "./settings/DataToolsTab";
import { fmtDate, fieldLabel, fmtValue, getRecordLabel, getChangesSummary, tableShortName, AuditLogDialog, EditLogTable } from "./settings/AuditLog";
import { PosSettingsTab } from "./settings/PosSettingsTab";
import { ExportAccountsSection } from "./settings/ExportAccountsSection";
import { DailyExportSection } from "./settings/DailyExportSection";
import { WhatsAppExportSection } from "./settings/WhatsAppExportSection";
import { StockReportSection } from "./settings/StockReportSection";
import { NetPositionExportSection } from "./settings/NetPositionExportSection";
import { FileStorageTab } from "./settings/FileStorageTab";
import { BulkRenameTab } from "./settings/BulkRenameTab";
import { LoginHistoryTab } from "./settings/LoginHistoryTab";
import { POSReceiptSettings, IntercompanyPosTab } from "./settings/IntercompanyPosTab";
import { OfflineSyncPanel, formatRelativeTime } from "./settings/OfflineSyncPanel";

// Page access constants — single source of truth shared between Settings and BulkRenameTab
const ALL_FACTORY_PAGES_SETTINGS = FACTORY_NAV_PAGES;
const FACTORY_PAGE_GROUPS_SETTINGS = Array.from(new Set(ALL_FACTORY_PAGES_SETTINGS.map(p => p.group)));
const ALL_ERP_PAGES: { key: string; label: string; group: string }[] = FEATURE_KEYS.map(key => ({
  key,
  label: FEATURE_PAGE_INFO[key].label,
  group: FEATURE_PAGE_INFO[key].group,
}));
const ERP_PAGE_GROUPS = Array.from(new Set(ALL_ERP_PAGES.map(p => p.group)));
const FACTORY_COST_FIELDS = [
  { key: "inventory_avg_rate",       label: "Avg Rate Column" },
  { key: "inventory_total_value",    label: "Total Value Column" },
  { key: "inventory_sell_price",     label: "Sell Price Column" },
  { key: "inventory_sell_value",     label: "Sell Value Column" },
  { key: "bale_history_cost_per_kg", label: "Cost/KG Column" },
  { key: "bale_history_total_cost",  label: "Total Cost Column" },
  { key: "bales_list_cost_per_kg",   label: "Cost/kg Column" },
];

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
    const [userToDelete, setUserToDelete] = useState<any>(null);
    const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
    const [isRoleDialogOpen, setIsRoleDialogOpen] = useState(false);
    const [isZeroBalanceDialogOpen, setIsZeroBalanceDialogOpen] = useState(false);
    const [selectedAccountsToZero, setSelectedAccountsToZero] = useState<number[]>([]);
    const [editingRole, setEditingRole] = useState<any>(null);
    const [selectedLocationIds, setSelectedLocationIds] = useState<number[]>([]);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [pendingDelete, setPendingDelete] = useState<(() => void) | null>(null);
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

    // Factory user management state
    const [factoryCreateOpen, setFactoryCreateOpen] = useState(false);
    const [factoryEditingUser, setFactoryEditingUser] = useState<any>(null);
    const [factoryDeletingUser, setFactoryDeletingUser] = useState<any>(null);
    const [factoryUserFormData, setFactoryUserFormData] = useState({
      username: "", password: "", displayName: "", hasErpAccess: true, hasFactoryAccess: true,
    });
    const [factoryUserPages, setFactoryUserPages] = useState<Set<string>>(new Set());
    const [factoryUserHiddenCostFields, setFactoryUserHiddenCostFields] = useState<string[]>([]);
  
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
  
    // Query for user company roles when a user is expanded
    const { data: userCompanyRoles = [] } = useQuery<any[]>({
      queryKey: [`/api/users/${expandedUserId}/company-roles`],
      enabled: !!expandedUserId,
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

    // Factory users query (used in Users section in both modes)
    const { data: factoryUsersData = [], isLoading: isLoadingFactoryUsers } = useQuery<any[]>({
      queryKey: ["/api/factory/users"],
    });

    const createFactoryUserMutation = useMutation({
      mutationFn: async (data: any) => {
        const res = await factoryApiRequest("POST", "/api/factory/users", data);
        if (!res.ok) { const err = await res.json(); throw new Error(err.message || "Failed to create user"); }
        return res.json();
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/factory/users"] });
        toast({ title: "Created", description: "User created successfully" });
        resetFactoryUserForm();
        setFactoryCreateOpen(false);
      },
      onError: (err: Error) => { toast({ title: "Error", description: err.message, variant: "destructive" }); },
    });

    const updateFactoryUserMutation = useMutation({
      mutationFn: async ({ userId, data }: { userId: string; data: any }) => {
        const res = await factoryApiRequest("PUT", `/api/factory/users/${userId}`, data);
        if (!res.ok) { const err = await res.json(); throw new Error(err.message || "Failed to update user"); }
        return res.json();
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/factory/users"] });
        toast({ title: "Updated", description: "User updated successfully" });
        resetFactoryUserForm();
        setFactoryEditingUser(null);
      },
      onError: (err: Error) => { toast({ title: "Error", description: err.message, variant: "destructive" }); },
    });

    const toggleFactoryAccessMutation = useMutation({
      mutationFn: async ({ userId, data }: { userId: string; data: any }) => {
        const res = await factoryApiRequest("PUT", `/api/factory/users/${userId}`, data);
        if (!res.ok) { const err = await res.json(); throw new Error(err.message || "Failed to update"); }
        return res.json();
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/factory/users"] });
        toast({ title: "Updated", description: "Access updated" });
      },
      onError: (err: Error) => { toast({ title: "Error", description: err.message, variant: "destructive" }); },
    });

    const deleteFactoryUserMutation = useMutation({
      mutationFn: async (userId: string) => {
        const res = await factoryApiRequest("DELETE", `/api/factory/users/${userId}`, {});
        if (!res.ok) { const err = await res.json(); throw new Error(err.message || "Failed to remove"); }
        return res.json();
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/factory/users"] });
        toast({ title: "Removed", description: "User removed" });
        setFactoryDeletingUser(null);
      },
      onError: (err: Error) => { toast({ title: "Error", description: err.message, variant: "destructive" }); },
    });

    const resetFactoryUserForm = async () => {
      setFactoryUserFormData({ username: "", password: "", displayName: "", hasErpAccess: true, hasFactoryAccess: true });
      setFactoryUserPages(new Set());
      setFactoryUserHiddenCostFields([]);
    };

    const openFactoryUserEdit = async (user: any) => {
      setFactoryEditingUser(user);
      setExpandedUserId(user.id);
      setFactoryUserFormData({ username: user.username, password: "", displayName: user.displayName || "", hasErpAccess: user.hasErpAccess ?? true, hasFactoryAccess: user.hasFactoryAccess ?? true });
      setFactoryUserPages(new Set(user.pageAccess));
      setFactoryUserHiddenCostFields(user.hiddenCostFields ?? []);
    };

    const isFactoryAdminOrOwner = (user: any) => ["admin", "owner"].includes(user.role?.toLowerCase());

    const toggleFactoryUserPage = async (pageKey: string) => {
      setFactoryUserPages(prev => { const next = new Set(prev); next.has(pageKey) ? next.delete(pageKey) : next.add(pageKey); return next; });
    };

    const toggleFactoryUserGroup = async (group: string) => {
      const groupPages = ALL_FACTORY_PAGES_SETTINGS.filter(p => p.group === group).map(p => p.key);
      const allSelected = groupPages.every(k => factoryUserPages.has(k));
      setFactoryUserPages(prev => { const next = new Set(prev); groupPages.forEach(k => allSelected ? next.delete(k) : next.add(k)); return next; });
    };

    const handleFactoryUserSubmit = async () => {
      if (factoryEditingUser) {
        const privileged = isFactoryAdminOrOwner(factoryEditingUser);
        updateFactoryUserMutation.mutate({
          userId: factoryEditingUser.id,
          data: {
            username: factoryUserFormData.username !== factoryEditingUser.username ? factoryUserFormData.username : undefined,
            displayName: factoryUserFormData.displayName,
            pageAccess: Array.from(factoryUserPages),
            password: factoryUserFormData.password || undefined,
            hasErpAccess: privileged ? true : factoryUserFormData.hasErpAccess,
            hasFactoryAccess: privileged ? true : factoryUserFormData.hasFactoryAccess,
            hiddenCostFields: privileged ? [] : factoryUserHiddenCostFields,
          },
        });
      } else {
        createFactoryUserMutation.mutate({
          username: factoryUserFormData.username,
          password: factoryUserFormData.password,
          displayName: factoryUserFormData.displayName,
          pageAccess: Array.from(factoryUserPages),
          hasErpAccess: factoryUserFormData.hasErpAccess,
          hasFactoryAccess: factoryUserFormData.hasFactoryAccess,
          hiddenCostFields: factoryUserHiddenCostFields,
        });
      }
    };

    // Build a lookup map for role permissions: { "role:featureKey": enabled }
    const permissionMap = new Map<string, boolean>();
    rolePermissions.forEach((p: any) => {
      permissionMap.set(`${p.role}:${p.featureKey}`, p.enabled);
    });

    // Get permission value for a role/feature
    const getPermission = (role: string, featureKey: string): boolean => {
      // Admin always has all permissions
      if (role === "Admin") return true;
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
    const configurableRoles = ["Owner", "Manager", "POS1", "POS2", "POS3", "POS4", "POS5", "POS6"];

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
  
    const roleForm = useForm<RoleAssignmentData>({
      resolver: zodResolver(roleAssignmentSchema),
      defaultValues: {
        userId: "",
        companyId: 0,
        role: "Manager",
      },
    });
  
    const selectedRole = roleForm.watch("role");
    const selectedCompanyId = roleForm.watch("companyId");
    
    // Load locations for the selected company when assigning roles
    const { data: locations = [] } = useQuery<any[]>({
      queryKey: ["/api/locations", { companyId: selectedCompanyId }],
      queryFn: async () => {
        if (!selectedCompanyId) return [];
        const res = await fetch(`/api/locations?companyId=${selectedCompanyId}`);
        if (!res.ok) throw new Error("Failed to fetch locations");
        return res.json();
      },
      enabled: !!selectedCompanyId && isRoleDialogOpen,
    });
  
    // Load bank accounts (cash accounts) for the selected company
    const { data: bankAccounts = [] } = useQuery<any[]>({
      queryKey: ["/api/bank-accounts", { companyId: selectedCompanyId }],
      queryFn: async () => {
        if (!selectedCompanyId) return [];
        const res = await fetch(`/api/bank-accounts?companyId=${selectedCompanyId}`);
        if (!res.ok) throw new Error("Failed to fetch bank accounts");
        return res.json();
      },
      enabled: !!selectedCompanyId && isRoleDialogOpen,
    });
  
    // Load ledger accounts for the selected company (for role dialog)
    const { data: roleDialogLedgerAccounts = [] } = useQuery<any[]>({
      queryKey: ["/api/ledger-accounts", { companyId: selectedCompanyId }],
      queryFn: async () => {
        if (!selectedCompanyId) return [];
        const res = await fetch(`/api/ledger-accounts?companyId=${selectedCompanyId}`);
        if (!res.ok) throw new Error("Failed to fetch ledger accounts");
        return res.json();
      },
      enabled: !!selectedCompanyId && isRoleDialogOpen,
    });
  
    // Filter for Cash type ledger accounts only
    const cashAccounts = roleDialogLedgerAccounts.filter((account: any) => account.accountType === "Cash");
  
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
  
    const createRoleMutation = useMutation({
      mutationFn: async (data: RoleAssignmentData) => {
        let result;
        if (editingRole) {
          const res = await modeApiRequest("PATCH", `/api/user-company-roles/${editingRole.id}`, data);
          result = await res.json();
        } else {
          const res = await modeApiRequest("POST", "/api/user-company-roles", data);
          result = await res.json();
        }
        if (data.role?.startsWith("POS") && selectedLocationIds.length > 0) {
          await modeApiRequest("PUT", `/api/user-locations/${data.userId}/${data.companyId}`, {
            locationIds: selectedLocationIds,
          });
        }
        return result;
      },
      onSuccess: () => {
        const userId = currentUserId;
        
        toast({
          title: "Success",
          description: editingRole ? "Role updated successfully" : "Role assigned successfully",
        });
        queryClient.invalidateQueries({ queryKey: [`/api/users/${userId}/company-roles`] });
        setIsRoleDialogOpen(false);
        setEditingRole(null);
        setCurrentUserId(null);
        setSelectedLocationIds([]);
        roleForm.reset({
          userId: "",
          companyId: 0,
          role: "Manager",
        });
      },
      onError: (error: any) => {
        if ((error as any)?._handledGlobally) return;
        toast({
          title: "Error",
          description: error.message || "Failed to save role",
          variant: "destructive",
        });
      },
    });
  
    const deleteRoleMutation = useMutation({
      mutationFn: async (roleId: number) => {
        await modeApiRequest("DELETE", `/api/user-company-roles/${roleId}`, {});
      },
      onSuccess: () => {
        // Capture userId before it potentially changes
        const userId = currentUserId;
        
        toast({
          title: "Success",
          description: "Role assignment removed successfully",
        });
        queryClient.invalidateQueries({ queryKey: [`/api/users/${userId}/company-roles`] });
      },
      onError: (error: any) => {
        if ((error as any)?._handledGlobally) return;
        toast({
          title: "Error",
          description: error.message || "Failed to delete role",
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
  
    const updatePermissionMutation = useMutation({
      mutationFn: async ({ roleId, userId, companyId, data }: { roleId: number; userId: string; companyId: number; data: any }) => {
        const res = await modeApiRequest("PATCH", `/api/user-company-roles/${roleId}`, data);
        return await res.json();
      },
      onSuccess: async (_, variables) => {
        // Invalidate the user's company roles query
        queryClient.invalidateQueries({ queryKey: [`/api/users/${variables.userId}/company-roles`] });
        
        // Invalidate the aggregate permissions query so the permissions table updates
        queryClient.invalidateQueries({ queryKey: ["/api/user-company-roles"] });
        
        let isCurrentUser = false;
        
        // Check if we need to refresh current user's session
        const currentUserRes = await fetch("/api/auth/me");
        if (currentUserRes.ok) {
          const currentUser = await currentUserRes.json();
          isCurrentUser = currentUser.id === variables.userId;
          
          // If we just updated the current user's permissions for the current company, refresh the session
          if (isCurrentUser) {
            const currentCompanyRes = await fetch("/api/user/companies");
            if (currentCompanyRes.ok) {
              const userCompanies = await currentCompanyRes.json();
              const currentCompany = userCompanies.find((uc: any) => uc.companyId === variables.companyId);
              if (currentCompany) {
                // Refresh session by re-selecting the company
                await modeApiRequest("POST", "/api/auth/set-company", { companyId: variables.companyId });
                // Invalidate current user query to refresh UI
                queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
              }
            }
          }
        }
        
        toast({
          title: "Success",
          description: isCurrentUser 
            ? "Permission updated successfully"
            : "Permission updated successfully. The user will need to log out and log back in for this change to take effect.",
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
  
    const handleAddRole = async (userId: string) => {
      setCurrentUserId(userId);
      setEditingRole(null);
      setSelectedLocationIds([]);
      roleForm.reset({
        userId,
        companyId: companies[0]?.id || 0,
        role: "Manager",
      });
      setIsRoleDialogOpen(true);
    };
  
    const handleEditRole = async (role: any) => {
      setCurrentUserId(role.userId);
      setEditingRole(role);
      roleForm.reset({
        userId: role.userId,
        companyId: role.companyId,
        role: role.role,
        assignedLocationId: role.assignedLocationId,
        posStation: role.posStation,
        canSellNegativeStock: role.canSellNegativeStock ?? false,
        daybookEditDays: role.daybookEditDays ?? 0,
      });
      if (role.role?.startsWith("POS")) {
        try {
          const res = await fetch(`/api/user-locations/${role.userId}/${role.companyId}`);
          const locs = await res.json();
          if (Array.isArray(locs) && locs.length > 0) {
            setSelectedLocationIds(locs.map((l: any) => l.locationId));
          } else {
            // Fallback to legacy single assignedLocationId if userLocations is empty
            setSelectedLocationIds(role.assignedLocationId ? [role.assignedLocationId] : []);
          }
        } catch {
          setSelectedLocationIds(role.assignedLocationId ? [role.assignedLocationId] : []);
        }
      } else {
        setSelectedLocationIds([]);
      }
      setIsRoleDialogOpen(true);
    };
  
    const handleSubmitRole = async (data: RoleAssignmentData) => {
      createRoleMutation.mutate(data);
    };
  
    const handleDeleteRole = async (roleId: number, userId: string) => {
      setCurrentUserId(userId);
      setPendingDelete(() => () => deleteRoleMutation.mutate(roleId));
    };
  
    const toggleUserExpansion = async (userId: string) => {
      setExpandedUserId(expandedUserId === userId ? null : userId);
    };
  
    const handlePermissionToggle = async (roleId: number, userId: string, companyId: number, field: string, value: boolean) => {
      updatePermissionMutation.mutate({
        roleId,
        userId,
        companyId,
        data: { [field]: value },
      });
    };

    const handleDaybookDaysChange = async (roleId: number, userId: string, companyId: number, days: number) => {
      updatePermissionMutation.mutate({
        roleId,
        userId,
        companyId,
        data: { daybookEditDays: days },
      });
    };
  
    const isPOSRole = selectedRole?.startsWith("POS");
  
    const [activeSection, setActiveSection] = useState("companies");

    const sidebarGroups = [
      {
        label: "General",
        items: [
          { key: "companies", label: "Companies", icon: Building2 },
          { key: "preferences", label: "Preferences", icon: Settings2 },
          { key: "fiscal", label: "Fiscal Period", icon: CalendarRange },
          { key: "exchange-rates", label: "Exchange Rates", icon: TrendingUp },
        ],
      },
      {
        label: "Users & Access",
        items: [
          { key: "users", label: "Users", icon: Users },
          { key: "active-users", label: "Active Users", icon: Eye, devOnly: true },
          { key: "login-history", label: "Login History", icon: Clock, devOnly: true },
        ],
      },
      {
        label: "Tools",
        items: [
          { key: "data-tools", label: "Data Tools", icon: Database, devOnly: true, factoryAdminAllowed: true },
          { key: "bulk-rename", label: "Bulk Rename", icon: Package, devOnly: true },
          { key: "edit-log", label: "Edit Log", icon: History },
          { key: "files", label: "File Storage", icon: Upload },
          { key: "export-accounts", label: "Export Accounts", icon: Download },
          { key: "daily-export", label: "Daily Export", icon: Download },
          { key: "np-export", label: "Net Position Export", icon: TrendingUp },
        ],
      },
      {
        label: "POS",
        items: appMode !== "factory" ? [
          { key: "pos-settings", label: "POS Settings", icon: ShoppingCart, devOnly: true },
        ] : [],
      },
      {
        label: "Intercompany",
        items: appMode !== "factory" ? [
          { key: "intercompany", label: "POS Auto-Transfer", icon: ArrowLeftRight },
        ] : [],
      },
      {
        label: "System",
        items: [
          { key: "system", label: "System Tools", icon: Wrench },
          { key: "offline", label: "Offline & Sync", icon: WifiOff },
        ],
      },
    ];

    return (
      <div className="flex flex-col sm:flex-row sm:h-full">
        {/* Mobile section selector — visible only on small screens */}
        <div className="sm:hidden border-b p-3">
          <Select value={activeSection} onValueChange={setActiveSection}>
            <SelectTrigger data-testid="select-settings-section">
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

        {/* Desktop sidebar nav — hidden on small screens */}
        <nav className="hidden sm:block w-56 shrink-0 border-r bg-muted/30 p-3 space-y-4 overflow-y-auto" data-testid="tabs-settings">
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
        </nav>

        <div className="flex-1 sm:overflow-y-auto p-4 sm:p-6">

          {activeSection === "companies" && (
            <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              <h2 className="text-2xl font-semibold">Company Management</h2>
            </div>
            <Dialog open={isCompanyDialogOpen} onOpenChange={setIsCompanyDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  onClick={() => {
                    setEditingCompany(null);
                    companyForm.reset({
                      name: "",
                      code: "",
                      companyType: "erp",
                      active: true,
                    });
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
                            <Input
                              {...field}
                              placeholder="ABC Textiles Inc."
                              data-testid="input-company-name"
                            />
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
                            <Input
                              {...field}
                              placeholder="ABC"
                              data-testid="input-company-code"
                            />
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
                                  <SelectValue placeholder="None (single currency)" />
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
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              data-testid="checkbox-company-active"
                            />
                          </FormControl>
                          <FormLabel className="!mt-0">Active</FormLabel>
                        </FormItem>
                      )}
                    />
  
                    <div className="flex gap-2 justify-end border-t pt-4">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setIsCompanyDialogOpen(false);
                          setEditingCompany(null);
                        }}
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
  
          <Card className="p-6">
            {isLoadingCompanies ? (
              <p className="text-center text-muted-foreground">Loading companies...</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Company Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Parent Credit Account</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {companies.map((company: any) => (
                    <TableRow key={company.id}>
                      <TableCell className="font-medium" data-testid={`text-company-name-${company.id}`}>
                        {company.name}
                      </TableCell>
                      <TableCell data-testid={`text-company-type-${company.id}`}>
                        <Badge variant={company.companyType === "factory" ? "default" : company.companyType === "properties" ? "outline" : "secondary"}>
                          {company.companyType === "factory" ? "Factory" : company.companyType === "properties" ? "Properties" : "ERP"}
                        </Badge>
                      </TableCell>
                      <TableCell data-testid={`text-company-status-${company.id}`}>
                        {company.active ? "Active" : "Inactive"}
                      </TableCell>
                      <TableCell>
                        <ParentCreditAccountSelect company={company} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-1 justify-end">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleEditCompany(company)}
                            data-testid={`button-edit-company-${company.id}`}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setCompanyToDelete(company)}
                            data-testid={`button-delete-company-${company.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
  
          <AlertDialog open={!!companyToDelete} onOpenChange={(open) => !open && setCompanyToDelete(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Company</AlertDialogTitle>
                <AlertDialogDescription className="space-y-2">
                  <p>
                    Are you sure you want to delete <strong>{companyToDelete?.name}</strong>?
                  </p>
                  <p className="text-destructive font-medium">
                    This will permanently delete ALL data associated with this company, including:
                  </p>
                  <ul className="list-disc list-inside text-sm space-y-1 ml-2">
                    <li>All locations and inventory</li>
                    <li>All ledger accounts and bank accounts</li>
                    <li>All vouchers and transactions</li>
                    <li>All purchase orders and containers</li>
                    <li>All employees and customers</li>
                    <li>All user role assignments for this company</li>
                  </ul>
                  <p className="font-bold text-destructive mt-2">
                    This action cannot be undone!
                  </p>
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
  
          {/* Users Tab */}
          {activeSection === "users" && (
            <div className="space-y-6">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h2 className="text-2xl font-semibold" data-testid="text-factory-users-title">User Management</h2>
                  <p className="text-muted-foreground mt-1">Create users and control their access</p>
                </div>
                <Button onClick={() => { resetFactoryUserForm(); setFactoryCreateOpen(true); }} data-testid="button-add-factory-user">
                  <Plus className="h-4 w-4 mr-2" />Add User
                </Button>
              </div>

              <Card>
                <CardContent className="pt-4 overflow-x-auto">
                  {isLoadingFactoryUsers ? (
                    <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
                  ) : factoryUsersData.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Username</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead>Role</TableHead>
                          <TableHead>Access</TableHead>
                          <TableHead>Pages</TableHead>
                          <TableHead className="w-20">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {factoryUsersData.map((user: any) => {
                          const privileged = isFactoryAdminOrOwner(user);
                          const hasERP = privileged || (user.hasErpAccess ?? true);
                          const hasFactory = privileged || (user.hasFactoryAccess ?? true);
                          const factoryPageKeys = new Set(ALL_FACTORY_PAGES_SETTINGS.map((p: any) => p.key));
                          const erpPageKeys = new Set(ALL_ERP_PAGES.map((p: any) => p.key));
                          const factoryPagesCount = user.pageAccess.filter((k: string) => factoryPageKeys.has(k)).length;
                          const erpPagesCount = user.pageAccess.filter((k: string) => erpPageKeys.has(k)).length;
                          const accessLabel = hasERP && hasFactory ? "ERP + Factory" : hasERP ? "ERP only" : hasFactory ? "Factory only" : "No access";
                          let pagesLabel = "All pages";
                          if (!privileged && user.pageAccess.length > 0) {
                            const parts: string[] = [];
                            if (hasFactory && factoryPagesCount > 0) parts.push(`Factory: ${factoryPagesCount}`);
                            if (hasERP && erpPagesCount > 0) parts.push(`ERP: ${erpPagesCount}`);
                            if (parts.length > 0) pagesLabel = parts.join(" · ");
                          }
                          const roleLabel = user.role || "User";
                          return (
                            <TableRow key={user.id} data-testid={`row-factory-user-${user.id}`}>
                              <TableCell className="font-mono font-medium">{user.username}</TableCell>
                              <TableCell className="text-muted-foreground">{user.displayName || "—"}</TableCell>
                              <TableCell>
                                <Badge variant={privileged ? "default" : "secondary"} className="capitalize">
                                  {roleLabel}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">{accessLabel}</TableCell>
                              <TableCell className="text-sm text-muted-foreground">{pagesLabel}</TableCell>
                              <TableCell>
                                <div className="flex items-center gap-1">
                                  <Button variant="ghost" size="icon" onClick={() => openFactoryUserEdit(user)} data-testid={`button-edit-user-${user.id}`}>
                                    <Edit className="h-4 w-4" />
                                  </Button>
                                  {!privileged && (
                                    <Button variant="ghost" size="icon" onClick={() => setFactoryDeletingUser(user)} data-testid={`button-delete-user-${user.id}`} className="text-destructive">
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="text-center py-10 text-muted-foreground">
                      <Users className="h-10 w-10 mx-auto mb-3 opacity-40" />
                      <p className="font-medium">No users yet</p>
                      <p className="text-sm mt-1">Click "Add User" to create the first one</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Create / Edit Dialog */}
              <Dialog open={factoryCreateOpen || !!factoryEditingUser} onOpenChange={(open) => { if (!open) { setFactoryCreateOpen(false); setFactoryEditingUser(null); setExpandedUserId(null); resetFactoryUserForm(); } }}>
                <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <Shield className="h-5 w-5" />
                      {factoryEditingUser ? `Edit: ${factoryEditingUser.username}` : "Add New User"}
                    </DialogTitle>
                    <DialogDescription>
                      {factoryEditingUser ? "Update credentials, access modes, and page permissions" : "Set up login credentials and choose what this user can access"}
                    </DialogDescription>
                  </DialogHeader>

                  <div className="space-y-6 py-1">
                    {/* Credentials */}
                    <div className="space-y-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Credentials</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label>Username *</Label>
                          <Input value={factoryUserFormData.username} onChange={(e) => setFactoryUserFormData({ ...factoryUserFormData, username: e.target.value })} placeholder="Enter username" data-testid="input-factory-username" />
                          {factoryEditingUser && factoryUserFormData.username !== factoryEditingUser.username && (
                            <p className="text-xs text-muted-foreground mt-1">Username will change on save</p>
                          )}
                        </div>
                        <div>
                          <Label>{factoryEditingUser ? "New Password" : "Password *"}</Label>
                          <Input type="password" value={factoryUserFormData.password} onChange={(e) => setFactoryUserFormData({ ...factoryUserFormData, password: e.target.value })} placeholder={factoryEditingUser ? "Leave blank to keep" : "Min 4 characters"} data-testid="input-factory-password" />
                        </div>
                      </div>
                      <div>
                        <Label>Display Name</Label>
                        <Input value={factoryUserFormData.displayName} onChange={(e) => setFactoryUserFormData({ ...factoryUserFormData, displayName: e.target.value })} placeholder="Name shown in the system (e.g. John, Warehouse Manager)" data-testid="input-factory-display-name" />
                      </div>
                    </div>

                    {/* App Access */}
                    <div className="space-y-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">App Access</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="flex items-center justify-between rounded-md border p-3">
                          <div>
                            <p className="text-sm font-medium">ERP</p>
                            <p className="text-xs text-muted-foreground">Accounting, sales, analytics</p>
                          </div>
                          <Switch checked={factoryEditingUser && isFactoryAdminOrOwner(factoryEditingUser) ? true : factoryUserFormData.hasErpAccess} disabled={!!factoryEditingUser && isFactoryAdminOrOwner(factoryEditingUser)} onCheckedChange={(v) => setFactoryUserFormData({ ...factoryUserFormData, hasErpAccess: v })} data-testid="switch-form-erp-access" />
                        </div>
                        <div className="flex items-center justify-between rounded-md border p-3">
                          <div>
                            <p className="text-sm font-medium">Factory</p>
                            <p className="text-xs text-muted-foreground">Production, bales, workers</p>
                          </div>
                          <Switch checked={factoryEditingUser && isFactoryAdminOrOwner(factoryEditingUser) ? true : factoryUserFormData.hasFactoryAccess} disabled={!!factoryEditingUser && isFactoryAdminOrOwner(factoryEditingUser)} onCheckedChange={(v) => setFactoryUserFormData({ ...factoryUserFormData, hasFactoryAccess: v })} data-testid="switch-form-factory-access" />
                        </div>
                      </div>
                    </div>

                    {/* Factory Pages */}
                    {factoryUserFormData.hasFactoryAccess && !(factoryEditingUser && isFactoryAdminOrOwner(factoryEditingUser)) && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Factory Pages</p>
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => setFactoryUserPages(prev => new Set([...prev, ...ALL_FACTORY_PAGES_SETTINGS.map((p: any) => p.key)]))} data-testid="button-select-all-pages"><Check className="h-3 w-3 mr-1" />All</Button>
                            <Button variant="outline" size="sm" onClick={() => setFactoryUserPages(prev => { const next = new Set(prev); ALL_FACTORY_PAGES_SETTINGS.forEach((p: any) => next.delete(p.key)); return next; })} data-testid="button-select-none-pages"><X className="h-3 w-3 mr-1" />None</Button>
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground">Leave all unchecked to grant full factory access.</p>
                        <div className="space-y-4 border rounded-md p-4 max-h-56 overflow-y-auto">
                          {FACTORY_PAGE_GROUPS_SETTINGS.map((group: string) => {
                            const groupPages = ALL_FACTORY_PAGES_SETTINGS.filter((p: any) => p.group === group);
                            const allSelected = groupPages.every((p: any) => factoryUserPages.has(p.key));
                            const someSelected = groupPages.some((p: any) => factoryUserPages.has(p.key));
                            return (
                              <div key={group} className="space-y-2">
                                <div className="flex items-center gap-2">
                                  <Checkbox checked={allSelected} onCheckedChange={() => toggleFactoryUserGroup(group)} data-testid={`checkbox-group-${group.toLowerCase().replace(/\s+/g, '-')}`} />
                                  <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{group}</span>
                                  {someSelected && !allSelected && <Badge variant="secondary" className="text-xs">partial</Badge>}
                                </div>
                                <div className="ml-6 grid grid-cols-2 gap-1">
                                  {groupPages.map((page: any) => (
                                    <div key={page.key} className="flex items-center gap-2">
                                      <Checkbox checked={factoryUserPages.has(page.key)} onCheckedChange={() => toggleFactoryUserPage(page.key)} data-testid={`checkbox-page-${page.key.replace(/\//g, '-')}`} />
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

                    {/* ERP Pages */}
                    {factoryUserFormData.hasErpAccess && !(factoryEditingUser && isFactoryAdminOrOwner(factoryEditingUser)) && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">ERP Pages</p>
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => setFactoryUserPages(prev => new Set([...prev, ...ALL_ERP_PAGES.map((p: any) => p.key)]))} data-testid="button-select-all-erp-pages"><Check className="h-3 w-3 mr-1" />All</Button>
                            <Button variant="outline" size="sm" onClick={() => setFactoryUserPages(prev => { const next = new Set(prev); ALL_ERP_PAGES.forEach((p: any) => next.delete(p.key)); return next; })} data-testid="button-select-none-erp-pages"><X className="h-3 w-3 mr-1" />None</Button>
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground">Leave all unchecked to grant full ERP access.</p>
                        <div className="space-y-4 border rounded-md p-4 max-h-56 overflow-y-auto">
                          {ERP_PAGE_GROUPS.map((group: string) => {
                            const groupPages = ALL_ERP_PAGES.filter((p: any) => p.group === group);
                            const allSelected = groupPages.every((p: any) => factoryUserPages.has(p.key));
                            const someSelected = groupPages.some((p: any) => factoryUserPages.has(p.key));
                            return (
                              <div key={`erp-${group}`} className="space-y-2">
                                <div className="flex items-center gap-2">
                                  <Checkbox checked={allSelected} onCheckedChange={() => { setFactoryUserPages(prev => { const next = new Set(prev); if (allSelected) { groupPages.forEach((p: any) => next.delete(p.key)); } else { groupPages.forEach((p: any) => next.add(p.key)); } return next; }); }} data-testid={`checkbox-erp-group-${group.toLowerCase().replace(/\s+/g, '-')}`} />
                                  <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{group}</span>
                                  {someSelected && !allSelected && <Badge variant="secondary" className="text-xs">partial</Badge>}
                                </div>
                                <div className="ml-6 grid grid-cols-2 gap-1">
                                  {groupPages.map((page: any) => (
                                    <div key={page.key} className="flex items-center gap-2">
                                      <Checkbox checked={factoryUserPages.has(page.key)} onCheckedChange={() => toggleFactoryUserPage(page.key)} data-testid={`checkbox-erp-page-${page.key}`} />
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

                    {/* Cost Visibility */}
                    {!(factoryEditingUser && isFactoryAdminOrOwner(factoryEditingUser)) && (
                      <div className="space-y-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cost & Pricing Visibility</p>
                        <p className="text-xs text-muted-foreground">Check to hide these fields from this user.</p>
                        <div className="space-y-2 border rounded-md p-4">
                          {FACTORY_COST_FIELDS.map((field: any) => (
                            <div key={field.key} className="flex items-center gap-2">
                              <Checkbox checked={factoryUserHiddenCostFields.includes(field.key)} onCheckedChange={() => setFactoryUserHiddenCostFields(prev => prev.includes(field.key) ? prev.filter(k => k !== field.key) : [...prev, field.key])} data-testid={`checkbox-cost-${field.key}`} />
                              <span className="text-sm">{field.label}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Daybook Restrictions */}
                    {!(factoryEditingUser && isFactoryAdminOrOwner(factoryEditingUser)) && (
                      <div className="space-y-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Daybook Restrictions</p>
                        <p className="text-xs text-muted-foreground">Restrict what this user sees in the factory daybook.</p>
                        <div className="space-y-2 border rounded-md p-4">
                          <div className="flex items-center gap-2">
                            <Checkbox
                              checked={factoryUserHiddenCostFields.includes("daybook_own_only")}
                              onCheckedChange={() => setFactoryUserHiddenCostFields(prev =>
                                prev.includes("daybook_own_only")
                                  ? prev.filter(k => k !== "daybook_own_only")
                                  : [...prev, "daybook_own_only"]
                              )}
                              data-testid="checkbox-daybook-own-only"
                            />
                            <span className="text-sm">Show only entries they created</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Company Roles — edit mode only */}
                    {factoryEditingUser && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">ERP Company Roles</p>
                          <Button size="sm" variant="outline" onClick={() => handleAddRole(factoryEditingUser.id)} data-testid={`button-add-role-${factoryEditingUser.id}`}>
                            <Plus className="h-3 w-3 mr-1" />Add Role
                          </Button>
                        </div>
                        {userCompanyRoles.length === 0 ? (
                          <p className="text-sm text-muted-foreground">No company roles assigned yet.</p>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {userCompanyRoles.map((role: any) => (
                              <div key={role.id} className="flex items-center gap-1.5 border rounded-md px-2 py-1 bg-background text-sm" data-testid={`role-item-${role.id}`}>
                                <span className="font-medium">{companies.find((c: any) => c.id === role.companyId)?.name || `Company ${role.companyId}`}</span>
                                <span className="text-muted-foreground">—</span>
                                <Badge variant={role.role === "Admin" || role.role === "Owner" ? "default" : "secondary"} className="text-xs">{role.role}</Badge>
                                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => handleEditRole(role)} data-testid={`button-edit-role-${role.id}`}><Edit className="h-3 w-3" /></Button>
                                <Button variant="ghost" size="icon" className="h-5 w-5 text-destructive" onClick={() => handleDeleteRole(role.id, factoryEditingUser.id)} data-testid={`button-delete-role-${role.id}`}><Trash2 className="h-3 w-3" /></Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <DialogFooter className="mt-4">
                    <Button variant="outline" onClick={() => { setFactoryCreateOpen(false); setFactoryEditingUser(null); setExpandedUserId(null); resetFactoryUserForm(); }} disabled={createFactoryUserMutation.isPending || updateFactoryUserMutation.isPending}>Cancel</Button>
                    <Button onClick={handleFactoryUserSubmit} disabled={createFactoryUserMutation.isPending || updateFactoryUserMutation.isPending} data-testid="button-save-factory-user">
                      {(createFactoryUserMutation.isPending || updateFactoryUserMutation.isPending) ? "Saving..." : factoryEditingUser ? "Save Changes" : "Create User"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* Delete confirm */}
              <Dialog open={!!factoryDeletingUser} onOpenChange={(open) => { if (!open) setFactoryDeletingUser(null); }}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Remove User</DialogTitle>
                    <DialogDescription>Remove <strong>{factoryDeletingUser?.username}</strong> from this company? Their account will be deactivated.</DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setFactoryDeletingUser(null)} disabled={deleteFactoryUserMutation.isPending}>Cancel</Button>
                    <Button variant="destructive" onClick={() => factoryDeletingUser && deleteFactoryUserMutation.mutate(factoryDeletingUser.id)} disabled={deleteFactoryUserMutation.isPending} data-testid="button-confirm-delete-factory-user">
                      {deleteFactoryUserMutation.isPending ? "Removing..." : "Remove User"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          )}


          {/* Active Users Tab */}
          {activeSection === "active-users" && currentUser?.role === "Developer" && (
            <ActiveUsersSection />
          )}

          {activeSection === "login-history" && currentUser?.role === "Developer" && <LoginHistoryTab />}


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

          {activeSection === "data-tools" && (currentUser?.role === "Developer" || (appMode === "factory" && ["Admin", "Owner"].includes(currentUser?.role || ""))) && (
            <DataToolsTab />
          )}
          {activeSection === "exchange-rates" && (
            <ExchangeRateSettings />
          )}
          {activeSection === "bulk-rename" && currentUser?.role === "Developer" && (
            <BulkRenameTab />
          )}
          {activeSection === "pos-settings" && currentUser?.role === "Developer" && (
            <PosSettingsTab />
          )}
          {activeSection === "files" && (
            <FileStorageTab />
          )}

          {activeSection === "export-accounts" && (
            <ExportAccountsSection />
          )}

          {activeSection === "daily-export" && (
            <>
              <DailyExportSection />
              <WhatsAppExportSection />
              <StockReportSection />
              <NetPositionExportSection />
            </>
          )}

          {activeSection === "np-export" && (
            <NetPositionExportSection />
          )}

          {activeSection === "fiscal" && (
            <FiscalPeriodTab currentCompanyId={selectedCompany?.id} userRole={currentUser?.role} />
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

          {activeSection === "intercompany" && (
            <IntercompanyPosTab />
          )}

          {activeSection === "system" && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Wrench className="h-5 w-5" />
                <h2 className="text-2xl font-semibold">System Tools</h2>
              </div>

              {(() => {
                const pfx = appMode === "factory" ? "/factory" : "";
                return (
              <div className="grid gap-4 md:grid-cols-2">
                <Link href={`${pfx}/deleted-items`}>
                  <Card className="p-6 hover-elevate cursor-pointer">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="p-3 bg-destructive/10 rounded-lg">
                          <Trash2 className="h-6 w-6 text-destructive" />
                        </div>
                        <div>
                          <h3 className="font-semibold" data-testid="link-deleted-items">Deleted Items</h3>
                          <p className="text-sm text-muted-foreground">
                            View and restore deleted records or permanently remove them
                          </p>
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    </div>
                  </Card>
                </Link>

                {currentUser?.role === "Developer" && (
                <Link href={`${pfx}/orphaned-records`}>
                  <Card className="p-6 hover-elevate cursor-pointer">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="p-3 bg-orange-500/10 rounded-lg">
                          <MapPin className="h-6 w-6 text-orange-500" />
                        </div>
                        <div>
                          <h3 className="font-semibold" data-testid="link-orphaned-records">Orphaned Records</h3>
                          <p className="text-sm text-muted-foreground">
                            Find and reassign records that reference deleted locations
                          </p>
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    </div>
                  </Card>
                </Link>
                )}

                <Link href={`${pfx}/chatbot-settings`}>
                  <Card className="p-6 hover-elevate cursor-pointer">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="p-3 bg-primary/10 rounded-lg">
                          <Bot className="h-6 w-6 text-primary" />
                        </div>
                        <div>
                          <h3 className="font-semibold" data-testid="link-chatbot-settings">AI Chatbot Settings</h3>
                          <p className="text-sm text-muted-foreground">
                            Manage AI assistant access and view conversation history
                          </p>
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    </div>
                  </Card>
                </Link>

                <Link href={`${pfx}/import-cycle-diagnostics`}>
                  <Card className="p-6 hover-elevate cursor-pointer">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="p-3 bg-yellow-500/10 rounded-lg">
                          <AlertTriangle className="h-6 w-6 text-yellow-500" />
                        </div>
                        <div>
                          <h3 className="font-semibold" data-testid="link-import-diagnostics">Import Cycle Diagnostics</h3>
                          <p className="text-sm text-muted-foreground">
                            Detect and diagnose issues causing import cycle imbalance
                          </p>
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    </div>
                  </Card>
                </Link>

                {currentUser?.role === "Developer" && (
                <Link href={`${pfx}/inventory-repair`}>
                  <Card className="p-6 hover-elevate cursor-pointer">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="p-3 bg-orange-500/10 rounded-lg">
                          <Wrench className="h-6 w-6 text-orange-500" />
                        </div>
                        <div>
                          <h3 className="font-semibold" data-testid="link-inventory-repair">Inventory Repair Tool</h3>
                          <p className="text-sm text-muted-foreground">
                            Detect and fix inventory discrepancies by replaying all voucher-backed operations
                          </p>
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    </div>
                  </Card>
                </Link>
                )}

                <Link href={`${pfx}/net-position-details`}>
                  <Card className="p-6 hover-elevate cursor-pointer">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="p-3 bg-purple-500/10 rounded-lg">
                          <PieChart className="h-6 w-6 text-purple-500" />
                        </div>
                        <div>
                          <h3 className="font-semibold" data-testid="link-net-profit-details">Net Position Details</h3>
                          <p className="text-sm text-muted-foreground">
                            View detailed breakdown of income, expenses, and net position
                          </p>
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    </div>
                  </Card>
                </Link>

                {appMode !== "factory" && (
                <Link href="/account-groups">
                  <Card className="p-6 hover-elevate cursor-pointer">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="p-3 bg-blue-500/10 rounded-lg">
                          <Layers className="h-6 w-6 text-blue-500" />
                        </div>
                        <div>
                          <h3 className="font-semibold" data-testid="link-account-groups">Account Groups</h3>
                          <p className="text-sm text-muted-foreground">
                            Create parent groups and organise accounts under them for better reporting
                          </p>
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    </div>
                  </Card>
                </Link>
                )}

                <Link href={`${pfx}/company-data-reset`}>
                  <Card className="p-6 hover-elevate cursor-pointer">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="p-3 bg-red-500/10 rounded-lg">
                          <Trash2 className="h-6 w-6 text-red-500" />
                        </div>
                        <div>
                          <h3 className="font-semibold" data-testid="link-company-data-reset">Company Data Reset</h3>
                          <p className="text-sm text-muted-foreground">
                            Clear vouchers and opening balances for selected accounts
                          </p>
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    </div>
                  </Card>
                </Link>

                <Link href="/factory/bale-relabeling">
                  <Card className="p-6 hover-elevate cursor-pointer">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="p-3 bg-yellow-500/10 rounded-lg">
                          <RefreshCw className="h-6 w-6 text-yellow-500" />
                        </div>
                        <div>
                          <h3 className="font-semibold" data-testid="link-bale-relabeling">Bale Relabeling</h3>
                          <p className="text-sm text-muted-foreground">
                            Reassign or relabel bales and re-enter wipers stock by date
                          </p>
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    </div>
                  </Card>
                </Link>

                <Link href="/factory/reprint-labels">
                  <Card className="p-6 hover-elevate cursor-pointer">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="p-3 bg-blue-500/10 rounded-lg">
                          <Printer className="h-6 w-6 text-blue-500" />
                        </div>
                        <div>
                          <h3 className="font-semibold" data-testid="link-reprint-labels">Reprint Labels</h3>
                          <p className="text-sm text-muted-foreground">
                            Reprint bale barcode labels for any existing bales
                          </p>
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    </div>
                  </Card>
                </Link>

                {currentUser?.role === "Developer" && (
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
                )}

                {currentUser?.role === "Developer" && (
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
                )}

                {currentUser?.role === "Developer" && (
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
                )}

                {currentUser?.role === "Developer" && (
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
                )}

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

                {currentUser?.role === "Developer" && (
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
                )}

                {currentUser?.role === "Developer" && (
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
                            toast({
                              title: "Cleanup Complete",
                              description: result.message,
                            });
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
                      data-testid="button-fix-orphaned-pos"
                    >
                      Fix Orphaned
                    </Button>
                  </div>
                </Card>
                )}

                {currentUser?.role === "Developer" && (
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
                    <div className="flex items-center gap-2">
                      <Button
                        disabled={isRecalcAllLoading}
                        onClick={async () => {
                          try {
                            const response = await fetch("/api/admin/recalculate-equity-adjustment", {
                              method: "POST",
                              credentials: "include",
                            });
                            const result = await response.json();
                            if (response.ok) {
                              toast({
                                title: "Equity Adjusted",
                                description: result.message,
                              });
                              queryClient.invalidateQueries({ queryKey: ["/api/stats/import-cycle-balance"] });
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
                            const response = await fetch("/api/admin/recalculate-equity-adjustment-all", {
                              method: "POST",
                              credentials: "include",
                            });
                            const result = await response.json();
                            if (response.ok) {
                              toast({
                                title: "All Companies Adjusted",
                                description: result.message,
                              });
                              queryClient.invalidateQueries({ queryKey: ["/api/stats/import-cycle-balance"] });
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
                )}

                {currentUser?.role === "Developer" && (
                <Card className="p-6">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-4">
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
                              const response = await fetch("/api/debug/orphaned-charge-vouchers", {
                                method: "GET",
                                credentials: "include",
                              });
                              const result = await response.json();
                              if (response.ok) {
                                setOrphanedChargesDiagnostic({
                                  count: result.orphanedVoucherCount,
                                  impact: result.totalImpact,
                                  vouchers: result.orphanedVouchers || [],
                                });
                                if (result.orphanedVoucherCount === 0) {
                                  toast({
                                    title: "No Orphaned Vouchers",
                                    description: "All OTW containers have no leftover charge vouchers.",
                                  });
                                }
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
                          data-testid="button-diagnose-orphaned-charges"
                        >
                          Diagnose
                        </Button>
                        <Button
                          variant="destructive"
                          disabled={!orphanedChargesDiagnostic || orphanedChargesDiagnostic.count === 0 || isFixingOrphanedCharges}
                          onClick={async () => {
                            if (!orphanedChargesDiagnostic || orphanedChargesDiagnostic.count === 0) return;
                            if (!confirm(`Delete ${orphanedChargesDiagnostic.count} orphaned vouchers with impact of $${orphanedChargesDiagnostic.impact.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}? This cannot be undone.`)) {
                              return;
                            }
                            try {
                              setIsFixingOrphanedCharges(true);
                              const response = await fetch("/api/admin/fix-orphaned-charge-vouchers", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                credentials: "include",
                              });
                              const result = await response.json();
                              if (response.ok) {
                                toast({
                                  title: "Cleanup Complete",
                                  description: result.message,
                                });
                                setOrphanedChargesDiagnostic(null);
                                queryClient.invalidateQueries({ queryKey: ["/api/stats/import-cycle-balance"] });
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
                )}

                {currentUser?.role === "Developer" && (
                <Card className="p-6">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-4">
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
                              const response = await fetch("/api/admin/orphaned-pos-sales", {
                                method: "GET",
                                credentials: "include",
                              });
                              const result = await response.json();
                              if (response.ok) {
                                setOrphanedPosSalesDiagnostic({
                                  count: result.count,
                                  totalImpact: result.totalImpact,
                                  vouchers: result.vouchers || [],
                                });
                                if (result.count === 0) {
                                  toast({
                                    title: "No Orphaned Sales Found",
                                    description: "All POS sales are linked to valid locations.",
                                  });
                                }
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
                            if (!confirm(`Delete ${orphanedPosSalesDiagnostic.count} orphaned POS vouchers with impact of $${orphanedPosSalesDiagnostic.totalImpact.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}? This cannot be undone.`)) {
                              return;
                            }
                            try {
                              setIsFixingOrphanedPosSales(true);
                              const response = await fetch("/api/admin/delete-orphaned-pos-sales", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                credentials: "include",
                              });
                              const result = await response.json();
                              if (response.ok) {
                                toast({
                                  title: "Cleanup Complete",
                                  description: result.message,
                                });
                                setOrphanedPosSalesDiagnostic(null);
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
                )}

                {currentUser?.role === "Developer" && (
                <Card className="p-6 md:col-span-2">
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
                        <Select
                          value={selectedContainerForDiag}
                          onValueChange={setSelectedContainerForDiag}
                        >
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
                              const response = await fetch(`/api/containers/${selectedContainerForDiag}/offload-diagnostics`, {
                                method: "GET",
                                credentials: "include",
                              });
                              const result = await response.json();
                              if (response.ok) {
                                setContainerDiagResult(result);
                                if (!result.hasIssues) {
                                  toast({
                                    title: "No Issues Found",
                                    description: `Container ${result.containerNumber} has ${result.lineItemCount} valid line items, total ${result.totalQuantity} bales.`,
                                  });
                                }
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
                              {containerDiagResult.lineItems
                                .filter((item: any) => !item.isValid)
                                .map((item: any, i: number) => (
                                  <div key={i} className="flex justify-between gap-2 py-1 border-b last:border-0">
                                    <span className="truncate">
                                      {item.poNumber} - {item.stockItemCode || 'No stock item'} (Qty: {item.quantity})
                                    </span>
                                    <span className="text-destructive whitespace-nowrap">
                                      {item.issues.join(', ')}
                                    </span>
                                  </div>
                                ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </Card>
                )}

                {currentUser?.role === "Developer" && (
                <Card className="p-6 md:col-span-2">
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
                )}

                {currentUser?.role === "Developer" && (
                  <NetPositionAdjustmentCard />
                )}
              </div>
              );
              })()}
            </div>
          )}

          {activeSection === "offline" && (
            <div className="space-y-6">
              <Card>
                <CardContent className="pt-5">
                  <OfflinePrepPanel />
                </CardContent>
              </Card>
              <OfflineSyncPanel />
            </div>
          )}
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
                      <div className="p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-md">
                        <p className="text-sm text-blue-800 dark:text-blue-200">
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
                    <div className="p-3 bg-orange-50 dark:bg-orange-950 border border-orange-200 dark:border-orange-800 rounded-md">
                      <p className="text-sm text-orange-800 dark:text-orange-200 font-medium">
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
  
        {/* Role Assignment Dialog */}
        <Dialog open={isRoleDialogOpen} onOpenChange={setIsRoleDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editingRole ? "Edit Role Assignment" : "Add Role Assignment"}</DialogTitle>
            </DialogHeader>
            <Form {...roleForm}>
              <form onSubmit={roleForm.handleSubmit(handleSubmitRole)} className="space-y-4" noValidate>
                <FormField
                  control={roleForm.control}
                  name="companyId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Company *</FormLabel>
                      <Select
                        onValueChange={(v) => field.onChange(parseInt(v))}
                        value={field.value?.toString() || ""}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-company">
                            <SelectValue placeholder="Select company" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {companies.map((company: any) => (
                            <SelectItem key={company.id} value={company.id.toString()}>
                              {company.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
  
                <FormField
                  control={roleForm.control}
                  name="role"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Role *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-role">
                            <SelectValue placeholder="Select role" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Admin">Admin</SelectItem>
                          <SelectItem value="Owner">Owner</SelectItem>
                          <SelectItem value="Manager">Manager</SelectItem>
                          <SelectItem value="POS1">POS 1</SelectItem>
                          <SelectItem value="POS2">POS 2</SelectItem>
                          <SelectItem value="POS3">POS 3</SelectItem>
                          <SelectItem value="POS4">POS 4</SelectItem>
                          <SelectItem value="POS5">POS 5</SelectItem>
                          <SelectItem value="POS6">POS 6</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
  
                {isPOSRole && (
                  <>
                    <FormField
                      control={roleForm.control}
                      name="assignedLocationId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Assigned Locations *</FormLabel>
                          <div className="border rounded-md p-3 space-y-2 max-h-48 overflow-y-auto" data-testid="select-locations">
                            {locations.map((loc: any) => {
                              const isChecked = (selectedLocationIds || []).includes(loc.id);
                              return (
                                <label
                                  key={loc.id}
                                  className="flex items-center gap-2 cursor-pointer text-sm"
                                  data-testid={`checkbox-location-${loc.id}`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={(e) => {
                                      const newIds = e.target.checked
                                        ? [...(selectedLocationIds || []), loc.id]
                                        : (selectedLocationIds || []).filter((id: number) => id !== loc.id);
                                      setSelectedLocationIds(newIds);
                                      if (newIds.length > 0) {
                                        field.onChange(newIds[0]);
                                      } else {
                                        field.onChange(undefined);
                                      }
                                    }}
                                    className="rounded"
                                  />
                                  {loc.name} ({loc.code})
                                </label>
                              );
                            })}
                          </div>
                          {(selectedLocationIds || []).length === 0 && (
                            <p className="text-sm text-destructive">At least one location is required for POS roles</p>
                          )}
                          <FormMessage />
                        </FormItem>
                      )}
                    />
  
                    <FormField
                      control={roleForm.control}
                      name="posStation"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>POS Station Number</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              type="number"
                              min="1"
                              max="6"
                              placeholder="1-6"
                              data-testid="input-pos-station"
                              onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                              value={field.value || ""}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                  </>
                )}

                {selectedRole !== "Admin" && selectedRole !== "Owner" && (
                  <FormField
                    control={roleForm.control}
                    name="daybookEditDays"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>POS Daybook Editable Days</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="number"
                            min="0"
                            placeholder="0 = no editing"
                            data-testid="input-daybook-edit-days"
                            onChange={(e) => field.onChange(e.target.value !== "" ? parseInt(e.target.value) : 0)}
                            value={field.value ?? 0}
                          />
                        </FormControl>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          How many past days this user can edit POS daybook vouchers (0 = cannot edit). Admin and Owner can always edit.
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
  
                <FormField
                  control={roleForm.control}
                  name="cashAccountId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cash Account (Optional)</FormLabel>
                      <Select
                        onValueChange={(v) => field.onChange(v ? parseInt(v) : undefined)}
                        value={field.value?.toString() || ""}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-cash-account">
                            <SelectValue placeholder="Select cash account" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {cashAccounts.map((account: any) => (
                            <SelectItem key={account.id} value={account.id.toString()}>
                              {account.name} ({account.code})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
  
                <FormField
                  control={roleForm.control}
                  name="canSellNegativeStock"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-md border p-3">
                      <div>
                        <FormLabel className="cursor-pointer">Allow Selling 0-Stock Items</FormLabel>
                        <p className="text-xs text-muted-foreground mt-0.5">Lets this user add items to POS even when stock is at 0</p>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value ?? false}
                          onCheckedChange={field.onChange}
                          data-testid="switch-can-sell-negative-stock"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <div className="flex gap-2 justify-end border-t pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setIsRoleDialogOpen(false);
                      setEditingRole(null);
                      setCurrentUserId(null);
                    }}
                    disabled={createRoleMutation.isPending}
                    data-testid="button-cancel-role"
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createRoleMutation.isPending} data-testid="button-save-role">
                    {createRoleMutation.isPending ? "Saving..." : "Save"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
        <DeleteConfirmDialog
          open={!!pendingDelete}
          onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
          onConfirm={() => { pendingDelete?.(); setPendingDelete(null); }}
        />
      </div>
    );
  }
  
