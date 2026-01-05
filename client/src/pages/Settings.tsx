  import { useState, Fragment } from "react";
  import { useForm } from "react-hook-form";
  import { zodResolver } from "@hookform/resolvers/zod";
  import { z } from "zod";
  import { Card } from "@/components/ui/card";
  import { Button } from "@/components/ui/button";
  import { Input } from "@/components/ui/input";
  import { Label } from "@/components/ui/label";
  import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
  } from "@/components/ui/dialog";
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
  import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
  } from "@/components/ui/table";
  import { Checkbox } from "@/components/ui/checkbox";
  import { Badge } from "@/components/ui/badge";
  import { Switch } from "@/components/ui/switch";
  import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
  import { useToast } from "@/hooks/use-toast";
  import { useMutation, useQuery } from "@tanstack/react-query";
  import { apiRequest, queryClient } from "@/lib/queryClient";
  import { Plus, Edit, Building2, Users, ChevronDown, ChevronUp, Trash2, CalendarRange, Settings2, Wrench, MapPin, ChevronRight, Bot, MessageCircle, RefreshCw, Calculator, Loader2, Shield, AlertTriangle, PieChart, Key, Lock } from "lucide-react";
  import { Link } from "wouter";
  import { useDateFormat } from "@/contexts/DateFormatContext";
  import { insertUserSchema, insertCompanySchema, insertUserCompanyRoleSchema, FEATURE_KEYS, type FeatureKey } from "@shared/schema";
  import { FiscalPeriodTab } from "@/components/FiscalPeriodTab";
  import { useCompany } from "@/contexts/CompanyContext";
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

  function ParentCreditAccountSelect({ company }: { company: any }) {
    const { toast } = useToast();
    const [isCreating, setIsCreating] = useState(false);
    const [newAccountName, setNewAccountName] = useState("");

    const { data: companySettings } = useQuery<any>({
      queryKey: ["/api/company-settings", company.id],
      queryFn: async () => {
        try {
          const res = await fetch(`/api/company-settings?companyId=${company.id}`, { credentials: "include" });
          if (res.status === 404) return { companyId: company.id, parentCreditAccountId: null };
          if (!res.ok) throw new Error("Failed to fetch settings");
          return res.json();
        } catch {
          return { companyId: company.id, parentCreditAccountId: null };
        }
      },
    });

    const { data: ledgerAccounts = [] } = useQuery<any[]>({
      queryKey: ["/api/ledger-accounts", company.id],
      queryFn: async () => {
        try {
          const res = await fetch(`/api/ledger-accounts?companyId=${company.id}`, { credentials: "include" });
          if (!res.ok) return [];
          return res.json();
        } catch {
          return [];
        }
      },
    });

    const liabilityAccounts = ledgerAccounts.filter(
      (acc: any) => acc.accountType === "Liability" && acc.active && !acc.deletedAt
    );

    const updateSettingsMutation = useMutation({
      mutationFn: async (parentCreditAccountId: number | null) => {
        const res = await apiRequest("POST", "/api/company-settings", {
          companyId: company.id,
          parentCreditAccountId,
        });
        return res.json();
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/company-settings"] });
        queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
        toast({ title: "Saved", description: "Parent credit account updated" });
      },
      onError: (error: any) => {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      },
    });

    const createAccountMutation = useMutation({
      mutationFn: async (name: string) => {
        const res = await apiRequest("POST", "/api/ledger-accounts", {
          companyId: company.id,
          name,
          accountType: "Liability",
          subType: "Current Liability",
        });
        return res.json();
      },
      onSuccess: (newAccount) => {
        queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts"] });
        updateSettingsMutation.mutate(newAccount.id);
        setIsCreating(false);
        setNewAccountName("");
      },
      onError: (error: any) => {
        toast({ title: "Error creating account", description: error.message, variant: "destructive" });
      },
    });

    const currentAccountId = companySettings?.parentCreditAccountId;
    const currentAccount = ledgerAccounts.find((acc: any) => acc.id === currentAccountId);

    if (isCreating) {
      return (
        <div className="flex gap-1 items-center">
          <Input
            value={newAccountName}
            onChange={(e) => setNewAccountName(e.target.value)}
            placeholder="Account name..."
            className="h-8 w-32 text-xs"
            data-testid={`input-new-credit-account-${company.id}`}
          />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => newAccountName && createAccountMutation.mutate(newAccountName)}
            disabled={!newAccountName || createAccountMutation.isPending}
            data-testid={`button-save-credit-account-${company.id}`}
          >
            {createAccountMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => { setIsCreating(false); setNewAccountName(""); }}
            data-testid={`button-cancel-credit-account-${company.id}`}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      );
    }

    return (
      <Select
        value={currentAccountId?.toString() || "none"}
        onValueChange={(value) => {
          if (value === "create_new") {
            setIsCreating(true);
          } else {
            const accountId = value === "none" ? null : parseInt(value, 10);
            updateSettingsMutation.mutate(accountId);
          }
        }}
        disabled={updateSettingsMutation.isPending}
      >
        <SelectTrigger className="w-40 h-8 text-xs" data-testid={`select-credit-account-${company.id}`}>
          <SelectValue placeholder="Not Set">
            {currentAccount ? currentAccount.name : "Not Set"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Not Set</SelectItem>
          {liabilityAccounts.map((acc: any) => (
            <SelectItem key={acc.id} value={acc.id.toString()}>
              {acc.name}
            </SelectItem>
          ))}
          <SelectItem value="create_new" className="text-primary font-medium">
            + Create New Account
          </SelectItem>
        </SelectContent>
      </Select>
    );
  }

  function NetPositionAdjustmentCard() {
    const { toast } = useToast();
    const { selectedCompany } = useCompany();
    const [adjustmentValue, setAdjustmentValue] = useState<string>("");
    const [isEditing, setIsEditing] = useState(false);

    // Get current user role
    const { data: currentUser } = useQuery<{ role?: string }>({
      queryKey: ["/api/auth/me"],
    });

    // Get company settings to fetch current adjustment value
    const { data: companySettings } = useQuery<any>({
      queryKey: ["/api/company-settings", selectedCompany?.id],
      enabled: !!selectedCompany?.id,
      queryFn: async () => {
        try {
          const res = await fetch(`/api/company-settings?companyId=${selectedCompany?.id}`, { credentials: "include" });
          if (res.status === 404) return { companyId: selectedCompany?.id, netPositionAdjustment: "0" };
          if (!res.ok) throw new Error("Failed to fetch settings");
          return res.json();
        } catch {
          return { companyId: selectedCompany?.id, netPositionAdjustment: "0" };
        }
      },
    });

    const currentAdjustment = parseFloat(companySettings?.netPositionAdjustment || "0");

    const updateAdjustmentMutation = useMutation({
      mutationFn: async (value: string) => {
        const res = await apiRequest("POST", "/api/company-settings", {
          companyId: selectedCompany?.id,
          netPositionAdjustment: value,
        });
        return res.json();
      },
      onSuccess: () => {
        toast({
          title: "Updated",
          description: "Net Position Adjustment has been updated.",
        });
        queryClient.invalidateQueries({ queryKey: ["/api/company-settings"] });
        queryClient.invalidateQueries({ queryKey: ["/api/stats/profit"] });
        setIsEditing(false);
      },
      onError: (error: any) => {
        toast({
          title: "Error",
          description: error.message || "Failed to update adjustment",
          variant: "destructive",
        });
      },
    });

    if (!selectedCompany) {
      return (
        <Card className="p-6">
          <p className="text-muted-foreground">Select a company to set Net Position Adjustment.</p>
        </Card>
      );
    }

    return (
      <Card className="p-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-500/10 rounded-lg">
              <Calculator className="h-6 w-6 text-blue-500" />
            </div>
            <div>
              <h3 className="font-semibold" data-testid="text-net-position-adjustment-title">Net Position Adjustment</h3>
              <p className="text-sm text-muted-foreground">
                Reduce the Net Position by a fixed amount (for {selectedCompany.name}). This does not affect Import Cycle Balance.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isEditing ? (
              <>
                <Input
                  type="number"
                  value={adjustmentValue}
                  onChange={(e) => setAdjustmentValue(e.target.value)}
                  placeholder="0"
                  className="w-32"
                  data-testid="input-net-position-adjustment"
                />
                <Button
                  size="sm"
                  onClick={() => updateAdjustmentMutation.mutate(adjustmentValue)}
                  disabled={updateAdjustmentMutation.isPending}
                  data-testid="button-save-adjustment"
                >
                  {updateAdjustmentMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setIsEditing(false)}
                  data-testid="button-cancel-adjustment"
                >
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <span className="font-mono text-lg" data-testid="text-current-adjustment">
                  ${formatNumber(currentAdjustment)}
                </span>
                {currentUser?.role === "Admin" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setAdjustmentValue(currentAdjustment.toString());
                      setIsEditing(true);
                    }}
                    data-testid="button-edit-adjustment"
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                )}
              </>
            )}
            {currentUser?.role !== "Admin" && !isEditing && (
              <span className="text-xs text-muted-foreground">(Admin only)</span>
            )}
          </div>
        </div>
      </Card>
    );
  }
  
  export default function Settings() {
    const { toast } = useToast();
    const { selectedCompany } = useCompany();
    const { dateFormat, setDateFormat, isPending: isDateFormatPending } = useDateFormat();
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
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
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
        const res = await apiRequest("PUT", "/api/settings/role-permissions", {
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
        const res = await apiRequest("POST", "/api/system/parent-company", { parentCompanyId: companyId });
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
    };
  
    const companyForm = useForm<CompanyFormData>({
      resolver: zodResolver(companyFormSchema),
      defaultValues: {
        name: "",
        code: "",
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
          const res = await apiRequest("PATCH", `/api/companies/${editingCompany.id}`, data);
          return await res.json();
        } else {
          const res = await apiRequest("POST", "/api/companies", data);
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
          active: true,
        });
      },
      onError: (error: any) => {
        toast({
          title: "Error",
          description: error.message || "Failed to save company",
          variant: "destructive",
        });
      },
    });
  
    const deleteCompanyMutation = useMutation({
      mutationFn: async (companyId: number) => {
        const res = await apiRequest("DELETE", `/api/companies/${companyId}`);
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
          const res = await apiRequest("PATCH", `/api/users/${editingUser.id}`, data);
          return await res.json();
        } else {
          const res = await apiRequest("POST", "/api/users", data);
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
        toast({
          title: "Error",
          description: error.message || "Failed to save user",
          variant: "destructive",
        });
      },
    });

    const deleteUserMutation = useMutation({
      mutationFn: async (userId: string) => {
        const res = await apiRequest("DELETE", `/api/users/${userId}`);
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
        toast({
          title: "Error",
          description: error.message || "Failed to delete user",
          variant: "destructive",
        });
      },
    });

    const resetPasswordMutation = useMutation({
      mutationFn: async ({ userId, newPassword }: { userId: string; newPassword: string }) => {
        const res = await apiRequest("POST", `/api/admin/reset-password/${userId}`, { newPassword });
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
        toast({
          title: "Error",
          description: error.message || "Failed to reset password",
          variant: "destructive",
        });
      },
    });

    const changePasswordMutation = useMutation({
      mutationFn: async ({ currentPassword, newPassword }: { currentPassword: string; newPassword: string }) => {
        const res = await apiRequest("POST", "/api/user/change-password", { currentPassword, newPassword });
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
        toast({
          title: "Error",
          description: error.message || "Failed to change password",
          variant: "destructive",
        });
      },
    });
  
    const createRoleMutation = useMutation({
      mutationFn: async (data: RoleAssignmentData) => {
        if (editingRole) {
          const res = await apiRequest("PATCH", `/api/user-company-roles/${editingRole.id}`, data);
          return await res.json();
        } else {
          const res = await apiRequest("POST", "/api/user-company-roles", data);
          return await res.json();
        }
      },
      onSuccess: () => {
        // Capture userId before resetting state
        const userId = currentUserId;
        
        toast({
          title: "Success",
          description: editingRole ? "Role updated successfully" : "Role assigned successfully",
        });
        queryClient.invalidateQueries({ queryKey: [`/api/users/${userId}/company-roles`] });
        setIsRoleDialogOpen(false);
        setEditingRole(null);
        setCurrentUserId(null);
        roleForm.reset({
          userId: "",
          companyId: 0,
          role: "Manager",
        });
      },
      onError: (error: any) => {
        toast({
          title: "Error",
          description: error.message || "Failed to save role",
          variant: "destructive",
        });
      },
    });
  
    const deleteRoleMutation = useMutation({
      mutationFn: async (roleId: number) => {
        await apiRequest("DELETE", `/api/user-company-roles/${roleId}`, {});
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
        toast({
          title: "Error",
          description: error.message || "Failed to delete role",
          variant: "destructive",
        });
      },
    });

    const zeroBalancesMutation = useMutation({
      mutationFn: async (accountIds: number[]) => {
        const res = await apiRequest("POST", "/api/ledger-accounts/zero-balances", { accountIds });
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
        toast({
          title: "Error",
          description: error.message || "Failed to zero balances",
          variant: "destructive",
        });
      },
    });

    const initializeBalancesMutation = useMutation({
      mutationFn: async () => {
        const res = await apiRequest("POST", "/api/admin/initialize-accounting-balances", {});
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
        const res = await apiRequest("POST", "/api/fix-old-po-credits", { companyId, parentCompanyId });
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
        console.error("Fix PO credits error:", error);
        toast({
          title: "Error",
          description: error.message || "Failed to fix PO credits",
          variant: "destructive",
        });
        setFixPOCreditsResult(null);
      },
    });

    const resetCompanyDataMutation = useMutation({
      mutationFn: async (companyId: number) => {
        const res = await apiRequest("POST", "/api/admin/reset-company-data", { companyId });
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
        const res = await apiRequest("POST", "/api/reverse-po-credits", { companyId, parentCompanyId });
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
        const res = await apiRequest("PATCH", `/api/user-company-roles/${roleId}`, data);
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
                await apiRequest("POST", "/api/auth/set-company", { companyId: variables.companyId });
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
        toast({
          title: "Error",
          description: error.message || "Failed to update permission",
          variant: "destructive",
        });
      },
    });
  
    const handleEditCompany = (company: any) => {
      setEditingCompany(company);
      companyForm.reset({
        name: company.name,
        code: company.code,
        active: company.active,
      });
      setIsCompanyDialogOpen(true);
    };
  
    const handleEdit = (user: any) => {
      setEditingUser(user);
      form.reset({
        username: user.username,
        password: "",
        active: user.active,
      });
      setIsDialogOpen(true);
    };
  
    const handleSubmitCompany = (data: CompanyFormData) => {
      createCompanyMutation.mutate(data);
    };
  
    const handleSubmit = (data: UserFormData) => {
      // If editing and password is empty, remove it from the update
      if (editingUser && !data.password) {
        const { password, ...dataWithoutPassword } = data;
        createUserMutation.mutate(dataWithoutPassword as UserFormData);
      } else {
        createUserMutation.mutate(data);
      }
    };
  
    const handleAddRole = (userId: string) => {
      setCurrentUserId(userId);
      setEditingRole(null);
      roleForm.reset({
        userId,
        companyId: companies[0]?.id || 0,
        role: "Manager",
      });
      setIsRoleDialogOpen(true);
    };
  
    const handleEditRole = (role: any) => {
      setCurrentUserId(role.userId);
      setEditingRole(role);
      roleForm.reset({
        userId: role.userId,
        companyId: role.companyId,
        role: role.role,
        assignedLocationId: role.assignedLocationId,
        posStation: role.posStation,
      });
      setIsRoleDialogOpen(true);
    };
  
    const handleSubmitRole = (data: RoleAssignmentData) => {
      createRoleMutation.mutate(data);
    };
  
    const handleDeleteRole = (roleId: number, userId: string) => {
      setCurrentUserId(userId);
      if (confirm("Are you sure you want to remove this role assignment?")) {
        deleteRoleMutation.mutate(roleId);
      }
    };
  
    const toggleUserExpansion = (userId: string) => {
      setExpandedUserId(expandedUserId === userId ? null : userId);
    };
  
    const handlePermissionToggle = (roleId: number, userId: string, companyId: number, field: string, value: boolean) => {
      updatePermissionMutation.mutate({
        roleId,
        userId,
        companyId,
        data: { [field]: value },
      });
    };
  
    const isPOSRole = selectedRole?.startsWith("POS");
  
    return (
      <div className="p-6">
        <Tabs defaultValue="companies" className="space-y-6">
          <TabsList data-testid="tabs-settings">
            <TabsTrigger value="companies" data-testid="tab-companies">
              <Building2 className="h-4 w-4 mr-2" />
              Companies
            </TabsTrigger>
            <TabsTrigger value="users" data-testid="tab-users">
              <Users className="h-4 w-4 mr-2" />
              Users
            </TabsTrigger>
            <TabsTrigger value="fiscal" data-testid="tab-fiscal">
              <CalendarRange className="h-4 w-4 mr-2" />
              Fiscal Period
            </TabsTrigger>
            <TabsTrigger value="preferences" data-testid="tab-preferences">
              <Settings2 className="h-4 w-4 mr-2" />
              Preferences
            </TabsTrigger>
            <TabsTrigger value="system" data-testid="tab-system">
              <Wrench className="h-4 w-4 mr-2" />
              System
            </TabsTrigger>
            <TabsTrigger value="role-permissions" data-testid="tab-role-permissions">
              <Shield className="h-4 w-4 mr-2" />
              Role Permissions
            </TabsTrigger>
          </TabsList>
  
          {/* Companies Tab */}
          <TabsContent value="companies" className="space-y-4">
            <div className="space-y-4">
          <div className="flex items-center justify-between">
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
                  <form onSubmit={companyForm.handleSubmit(handleSubmitCompany)} className="space-y-4">
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
          </TabsContent>

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
          <TabsContent value="users" className="space-y-4">
            <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              <h2 className="text-2xl font-semibold">User Management</h2>
            </div>
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  onClick={() => {
                    setEditingUser(null);
                    form.reset({
                      username: "",
                      password: "",
                      active: true,
                    });
                  }}
                  data-testid="button-add-user"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add User
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>{editingUser ? "Edit User" : "Create New User"}</DialogTitle>
                </DialogHeader>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                    <FormField
                      control={form.control}
                      name="username"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Username *</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              placeholder="john.doe"
                              data-testid="input-username"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
  
                    <FormField
                      control={form.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            Password {!editingUser && "*"}
                            {editingUser && " (leave blank to keep current)"}
                          </FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              type="password"
                              placeholder={editingUser ? "Leave blank to keep current" : "Enter password"}
                              data-testid="input-password"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
  
                    <FormField
                      control={form.control}
                      name="active"
                      render={({ field }) => (
                        <FormItem className="flex items-center gap-2 space-y-0">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              data-testid="checkbox-active"
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
                          setIsDialogOpen(false);
                          setEditingUser(null);
                        }}
                        disabled={createUserMutation.isPending}
                        data-testid="button-cancel"
                      >
                        Cancel
                      </Button>
                      <Button type="submit" disabled={createUserMutation.isPending} data-testid="button-save">
                        {createUserMutation.isPending ? "Saving..." : "Save"}
                      </Button>
                    </div>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>
  
          <Card className="p-6">
            {isLoading ? (
              <p className="text-center text-muted-foreground">Loading users...</p>
            ) : (
              <div className="space-y-2">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12"></TableHead>
                      <TableHead>Username</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Company Assignments</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((user: any) => (
                      <Fragment key={user.id}>
                        <TableRow>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleUserExpansion(user.id)}
                              data-testid={`button-expand-${user.id}`}
                            >
                              {expandedUserId === user.id ? (
                                <ChevronUp className="h-4 w-4" />
                              ) : (
                                <ChevronDown className="h-4 w-4" />
                              )}
                            </Button>
                          </TableCell>
                          <TableCell className="font-medium" data-testid={`text-username-${user.id}`}>
                            {user.username}
                          </TableCell>
                          <TableCell data-testid={`text-status-${user.id}`}>
                            {user.active ? "Active" : "Inactive"}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                toggleUserExpansion(user.id);
                              }}
                              data-testid={`button-view-roles-${user.id}`}
                            >
                              View Roles
                            </Button>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex gap-1 justify-end">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleEdit(user)}
                                data-testid={`button-edit-${user.id}`}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setUserToResetPassword(user)}
                                title="Reset Password"
                                data-testid={`button-reset-password-${user.id}`}
                              >
                                <Key className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setUserToDelete(user)}
                                data-testid={`button-delete-${user.id}`}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                        {expandedUserId === user.id && (
                          <TableRow>
                            <TableCell colSpan={5} className="bg-muted/50">
                              <div className="p-4 space-y-3">
                                <div className="flex items-center justify-between">
                                  <h4 className="font-medium">Company Role Assignments</h4>
                                  <Button
                                    size="sm"
                                    onClick={() => handleAddRole(user.id)}
                                    data-testid={`button-add-role-${user.id}`}
                                  >
                                    <Plus className="h-3 w-3 mr-1" />
                                    Add Role
                                  </Button>
                                </div>
                                {userCompanyRoles.length === 0 ? (
                                  <p className="text-sm text-muted-foreground">No company assignments yet</p>
                                ) : (
                                  <div className="space-y-2">
                                    {userCompanyRoles.map((role: any) => {
                                      const company = companies.find((c: any) => c.id === role.companyId);
                                      const location = locations.find((l: any) => l.id === role.assignedLocationId);
                                      return (
                                        <div
                                          key={role.id}
                                          className="p-3 bg-background rounded-md border space-y-3"
                                          data-testid={`role-assignment-${role.id}`}
                                        >
                                          <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                              <div>
                                                <div className="font-medium">{company?.name || "Unknown Company"}</div>
                                                <div className="text-sm text-muted-foreground">
                                                  <Badge variant="outline" className="mr-2">{role.role}</Badge>
                                                  {location && <span className="text-xs">Location: {location.name}</span>}
                                                  {role.posStation && <span className="text-xs ml-2">Station: {role.posStation}</span>}
                                                </div>
                                              </div>
                                            </div>
                                            <div className="flex gap-1">
                                              <Button
                                                size="sm"
                                                variant="ghost"
                                                onClick={() => handleEditRole(role)}
                                                data-testid={`button-edit-role-${role.id}`}
                                              >
                                                <Edit className="h-3 w-3" />
                                              </Button>
                                              <Button
                                                size="sm"
                                                variant="ghost"
                                                onClick={() => handleDeleteRole(role.id, user.id)}
                                                data-testid={`button-delete-role-${role.id}`}
                                              >
                                                <Trash2 className="h-3 w-3" />
                                              </Button>
                                            </div>
                                          </div>
                                          <div className="flex gap-6 pl-1">
                                            <div className="flex items-center gap-2">
                                              <Switch
                                                checked={role.role === "Admin" ? true : role.canSellNegativeStock}
                                                onCheckedChange={(checked) =>
                                                  handlePermissionToggle(role.id, user.id, role.companyId, "canSellNegativeStock", checked)
                                                }
                                                disabled={updatePermissionMutation.isPending || role.role === "Admin"}
                                                data-testid={`toggle-can-sell-${role.id}`}
                                              />
                                              <Label className="text-sm cursor-pointer">Can Sell</Label>
                                            </div>
                                            <div className="flex items-center gap-2">
                                              <Switch
                                                checked={role.canEditDaybook}
                                                onCheckedChange={(checked) =>
                                                  handlePermissionToggle(role.id, user.id, role.companyId, "canEditDaybook", checked)
                                                }
                                                disabled={updatePermissionMutation.isPending}
                                                data-testid={`toggle-can-edit-daybook-${role.id}`}
                                              />
                                              <Label className="text-sm cursor-pointer">Can Edit Daybook</Label>
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        </div>
          </TabsContent>
  
  
          {/* Fiscal Period Tab */}
          <TabsContent value="fiscal" className="space-y-4">
            <FiscalPeriodTab 
              currentCompanyId={selectedCompany?.id} 
              userRole={currentUser?.role} 
            />
          </TabsContent>
  
          {/* Preferences Tab */}
          <TabsContent value="preferences" className="space-y-4">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Settings2 className="h-5 w-5" />
                <h2 className="text-2xl font-semibold">User Preferences</h2>
              </div>
  
              <Card className="p-6">
                <div className="space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="date-format" className="text-base font-medium">
                      Date Format
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Choose how dates are displayed throughout the application.
                    </p>
                    <Select
                      value={dateFormat}
                      onValueChange={(value: "MM/DD/YYYY" | "DD/MM/YYYY") => {
                        setDateFormat(value);
                        toast({
                          title: "Date format updated",
                          description: `Dates will now be displayed as ${value}`,
                        });
                      }}
                      disabled={isDateFormatPending}
                    >
                      <SelectTrigger id="date-format" className="w-64" data-testid="select-date-format">
                        <SelectValue placeholder="Select date format" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MM/DD/YYYY">MM/DD/YYYY (e.g., 12/31/2025)</SelectItem>
                        <SelectItem value="DD/MM/YYYY">DD/MM/YYYY (e.g., 31/12/2025)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </Card>

              <Card className="p-6">
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Lock className="h-5 w-5" />
                    <h3 className="text-lg font-medium">Change Password</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Update your account password. You will need to enter your current password.
                  </p>
                  <Button 
                    variant="outline" 
                    onClick={() => setIsChangePasswordOpen(true)}
                    data-testid="button-open-change-password"
                  >
                    <Key className="h-4 w-4 mr-2" />
                    Change Password
                  </Button>
                </div>
              </Card>
            </div>
          </TabsContent>

          {/* Change Password Dialog */}
          <Dialog open={isChangePasswordOpen} onOpenChange={(open) => {
            setIsChangePasswordOpen(open);
            if (!open) setChangePasswordData({ currentPassword: "", newPassword: "", confirmPassword: "" });
          }}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Change Password</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="current-password">Current Password</Label>
                  <Input
                    id="current-password"
                    type="password"
                    value={changePasswordData.currentPassword}
                    onChange={(e) => setChangePasswordData(prev => ({ ...prev, currentPassword: e.target.value }))}
                    placeholder="Enter current password"
                    data-testid="input-current-password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-password">New Password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    value={changePasswordData.newPassword}
                    onChange={(e) => setChangePasswordData(prev => ({ ...prev, newPassword: e.target.value }))}
                    placeholder="Enter new password (min 4 characters)"
                    data-testid="input-new-password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm New Password</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    value={changePasswordData.confirmPassword}
                    onChange={(e) => setChangePasswordData(prev => ({ ...prev, confirmPassword: e.target.value }))}
                    placeholder="Confirm new password"
                    data-testid="input-confirm-password"
                  />
                </div>
                <div className="flex gap-2 justify-end border-t pt-4">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsChangePasswordOpen(false);
                      setChangePasswordData({ currentPassword: "", newPassword: "", confirmPassword: "" });
                    }}
                    disabled={changePasswordMutation.isPending}
                    data-testid="button-cancel-change-password"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => {
                      if (changePasswordData.newPassword !== changePasswordData.confirmPassword) {
                        toast({
                          title: "Error",
                          description: "New passwords do not match",
                          variant: "destructive",
                        });
                        return;
                      }
                      if (changePasswordData.newPassword.length < 4) {
                        toast({
                          title: "Error",
                          description: "New password must be at least 4 characters",
                          variant: "destructive",
                        });
                        return;
                      }
                      changePasswordMutation.mutate({
                        currentPassword: changePasswordData.currentPassword,
                        newPassword: changePasswordData.newPassword,
                      });
                    }}
                    disabled={changePasswordMutation.isPending || !changePasswordData.currentPassword || !changePasswordData.newPassword || !changePasswordData.confirmPassword}
                    data-testid="button-submit-change-password"
                  >
                    {changePasswordMutation.isPending ? "Changing..." : "Change Password"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
  
          {/* System Tab */}
          <TabsContent value="system" className="space-y-4">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Wrench className="h-5 w-5" />
                <h2 className="text-2xl font-semibold">System Tools</h2>
              </div>
  
              <div className="grid gap-4 md:grid-cols-2">
                <Link href="/deleted-items">
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
  
                <Link href="/orphaned-records">
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
  
                <Link href="/chatbot-settings">
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

                <Link href="/import-cycle-diagnostics">
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

                <Link href="/net-profit-details">
                  <Card className="p-6 hover-elevate cursor-pointer">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="p-3 bg-purple-500/10 rounded-lg">
                          <PieChart className="h-6 w-6 text-purple-500" />
                        </div>
                        <div>
                          <h3 className="font-semibold" data-testid="link-net-profit-details">Net Profit Details</h3>
                          <p className="text-sm text-muted-foreground">
                            View detailed breakdown of income, expenses, and net position
                          </p>
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    </div>
                  </Card>
                </Link>

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
                            if (!confirm(`Delete ${orphanedChargesDiagnostic.count} orphaned vouchers with impact of $${orphanedChargesDiagnostic.impact.toFixed(2)}? This cannot be undone.`)) {
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
                          Found {orphanedChargesDiagnostic.count} orphaned vouchers (Impact: ${orphanedChargesDiagnostic.impact.toFixed(2)})
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
                        disabled={setParentCompanyMutation.isPending || currentUser?.role !== "Admin"}
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
                      {currentUser?.role !== "Admin" && (
                        <span className="text-xs text-muted-foreground">(Admin only)</span>
                      )}
                    </div>
                  </div>
                </Card>

                <NetPositionAdjustmentCard />
              </div>
            </div>
          </TabsContent>

          {/* Role Permissions Tab */}
          <TabsContent value="role-permissions" className="space-y-4">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                <h2 className="text-2xl font-semibold">Role Permissions</h2>
              </div>

              <p className="text-muted-foreground">
                Configure which menu features are accessible for each role. Admin users always have full access.
              </p>

              {!selectedCompany ? (
                <Card className="p-6">
                  <p className="text-muted-foreground">Please select a company to configure role permissions.</p>
                </Card>
              ) : isLoadingPermissions ? (
                <Card className="p-6">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Loading permissions...</span>
                  </div>
                </Card>
              ) : (
                <Card className="p-0 overflow-hidden">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="sticky left-0 bg-background z-10 min-w-[160px]">Feature</TableHead>
                          {configurableRoles.map((role) => (
                            <TableHead key={role} className="text-center min-w-[80px]">
                              {role}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {FEATURE_KEYS.map((featureKey) => (
                          <TableRow key={featureKey}>
                            <TableCell className="sticky left-0 bg-background z-10 font-medium">
                              {featureLabels[featureKey]}
                            </TableCell>
                            {configurableRoles.map((role) => (
                              <TableCell key={role} className="text-center">
                                <Switch
                                  checked={getPermission(role, featureKey)}
                                  onCheckedChange={(checked) => {
                                    updateRolePermissionMutation.mutate({
                                      role,
                                      featureKey,
                                      enabled: checked,
                                    });
                                  }}
                                  disabled={updateRolePermissionMutation.isPending}
                                  data-testid={`switch-permission-${role}-${featureKey}`}
                                />
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </Card>
              )}
            </div>
          </TabsContent>
        </Tabs>

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
              <form onSubmit={roleForm.handleSubmit(handleSubmitRole)} className="space-y-4">
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
                          <FormLabel>Assigned Location *</FormLabel>
                          <Select
                            onValueChange={(v) => field.onChange(v ? parseInt(v) : undefined)}
                            value={field.value?.toString() || ""}
                          >
                            <FormControl>
                              <SelectTrigger data-testid="select-location">
                                <SelectValue placeholder="Select location" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {locations.map((loc: any) => (
                                <SelectItem key={loc.id} value={loc.id.toString()}>
                                  {loc.name} ({loc.code})
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
      </div>
    );
  }
  