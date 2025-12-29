  import { useState } from "react";
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
  import { Plus, Edit, Building2, Users, ChevronDown, ChevronUp, Trash2, CalendarRange, Settings2, Wrench, MapPin, ChevronRight, Bot, MessageCircle, RefreshCw, Calculator, Loader2, Shield, AlertTriangle, PieChart } from "lucide-react";
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
    const [reversePOCreditsResult, setReversePOCreditsResult] = useState<any>(null);
  
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
      mutationFn: async (companyId: number) => {
        const res = await apiRequest("POST", "/api/fix-old-po-credits", { companyId });
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

    const reversePOCreditsMutation = useMutation({
      mutationFn: async (companyId: number) => {
        const res = await apiRequest("POST", "/api/reverse-po-credits", { companyId });
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
                      <>
                        <TableRow key={user.id}>
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
                      </>
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
            </div>
          </TabsContent>
  
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
                    {(() => {
                      const selectedCo = companies.find((c: any) => c.id.toString() === selectedCompanyForFix);
                      const isParentSelected = selectedCo && (
                        selectedCo.name.toLowerCase().includes("lubumbashi") || 
                        selectedCo.name.toLowerCase().includes("hadi l'shi")
                      );
                      return (
                        <>
                          <p>
                            <strong>Fix:</strong> Creates inter-company credit entries for old offloaded POs.
                            <br />
                            <strong>Reverse:</strong> Removes all inter-company (INTERCO) vouchers.
                          </p>
                          <div className="pt-2">
                            <label className="text-sm font-medium text-foreground">Select Company</label>
                            <Select
                              value={selectedCompanyForFix}
                              onValueChange={setSelectedCompanyForFix}
                            >
                              <SelectTrigger className="mt-1" data-testid="select-company-for-fix">
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
                          {isParentSelected && (
                            <div className="p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-md">
                              <p className="text-sm text-blue-800 dark:text-blue-200">
                                <strong>Parent company selected:</strong> This will process ALL subsidiary companies at once.
                              </p>
                            </div>
                          )}
                        </>
                      );
                    })()}
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
                    onClick={() => reversePOCreditsMutation.mutate(parseInt(selectedCompanyForFix))}
                    disabled={reversePOCreditsMutation.isPending || fixPOCreditsMutation.isPending || !selectedCompanyForFix}
                    data-testid="button-reverse-po-credits"
                  >
                    {reversePOCreditsMutation.isPending ? "Reversing..." : "Reverse Credits"}
                  </Button>
                  <AlertDialogAction
                    onClick={() => fixPOCreditsMutation.mutate(parseInt(selectedCompanyForFix))}
                    disabled={fixPOCreditsMutation.isPending || reversePOCreditsMutation.isPending || !selectedCompanyForFix}
                  >
                    {fixPOCreditsMutation.isPending ? "Processing..." : "Fix Credits"}
                  </AlertDialogAction>
                </>
              )}
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
  