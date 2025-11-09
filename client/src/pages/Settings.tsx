import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { Plus, Edit, Building2, Users, ChevronDown, ChevronUp, Trash2, Shield, CalendarRange } from "lucide-react";
import { insertUserSchema, insertCompanySchema, insertUserCompanyRoleSchema } from "@shared/schema";
import { FiscalPeriodTab } from "@/components/FiscalPeriodTab";
import { useCompany } from "@/contexts/CompanyContext";

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
  const { selectedCompany, currentRole } = useCompany();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [isCompanyDialogOpen, setIsCompanyDialogOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState<any>(null);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [isRoleDialogOpen, setIsRoleDialogOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<any>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const { data: companies = [], isLoading: isLoadingCompanies } = useQuery<any[]>({
    queryKey: ["/api/companies"],
  });

  const { data: users = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/users"],
  });

  // Query for user company roles when a user is expanded
  const { data: userCompanyRoles = [] } = useQuery<any[]>({
    queryKey: [`/api/users/${expandedUserId}/company-roles`],
    enabled: !!expandedUserId,
  });

  // Query for all user company roles (for the permissions tab)
  const { data: allUserCompanyRoles = [], isLoading: isLoadingPermissions } = useQuery<any[]>({
    queryKey: ["/api/user-company-roles"],
    queryFn: async () => {
      const roles: any[] = [];
      for (const user of users) {
        const res = await fetch(`/api/users/${user.id}/company-roles`);
        if (res.ok) {
          const userRoles = await res.json();
          roles.push(...userRoles.map((role: any) => ({ ...role, username: user.username })));
        }
      }
      return roles;
    },
    enabled: users.length > 0,
  });

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

  // Load ledger accounts for the selected company
  const { data: ledgerAccounts = [] } = useQuery<any[]>({
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
  const cashAccounts = ledgerAccounts.filter((account: any) => account.accountType === "Cash");

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
          <TabsTrigger value="permissions" data-testid="tab-permissions">
            <Shield className="h-4 w-4 mr-2" />
            User Permissions
          </TabsTrigger>
          <TabsTrigger value="fiscal" data-testid="tab-fiscal">
            <CalendarRange className="h-4 w-4 mr-2" />
            Fiscal Period
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
                  <TableHead>Code</TableHead>
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
                    <TableCell data-testid={`text-company-code-${company.id}`}>{company.code}</TableCell>
                    <TableCell data-testid={`text-company-status-${company.id}`}>
                      {company.active ? "Active" : "Inactive"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleEditCompany(company)}
                        data-testid={`button-edit-company-${company.id}`}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
        </TabsContent>

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
                            disabled={!!editingUser}
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
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleEdit(user)}
                            data-testid={`button-edit-${user.id}`}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
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
                                        className="flex items-center justify-between p-3 bg-background rounded-md border"
                                        data-testid={`role-assignment-${role.id}`}
                                      >
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

        {/* User Permissions Tab */}
        <TabsContent value="permissions" className="space-y-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                <h2 className="text-2xl font-semibold">User Permissions</h2>
              </div>
            </div>

            <Card className="p-6">
              {isLoadingPermissions ? (
                <p className="text-center text-muted-foreground">Loading permissions...</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Username</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead className="text-center">Can Sell Negative Stock</TableHead>
                      <TableHead className="text-center">Can Edit Daybook</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allUserCompanyRoles.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground">
                          No user permissions found
                        </TableCell>
                      </TableRow>
                    ) : (
                      allUserCompanyRoles.map((role: any) => {
                        const company = companies.find((c: any) => c.id === role.companyId);
                        return (
                          <TableRow key={role.id} data-testid={`permission-row-${role.id}`}>
                            <TableCell className="font-medium" data-testid={`text-permission-username-${role.id}`}>
                              {role.username}
                            </TableCell>
                            <TableCell data-testid={`text-permission-company-${role.id}`}>
                              {company?.name || "Unknown Company"}
                            </TableCell>
                            <TableCell data-testid={`text-permission-role-${role.id}`}>
                              <Badge variant="outline">{role.role}</Badge>
                            </TableCell>
                            <TableCell className="text-center">
                              <Switch
                                checked={role.role === "Admin" ? true : role.canSellNegativeStock}
                                onCheckedChange={(checked) =>
                                  handlePermissionToggle(role.id, role.userId, role.companyId, "canSellNegativeStock", checked)
                                }
                                disabled={updatePermissionMutation.isPending || role.role === "Admin"}
                                data-testid={`toggle-sell-negative-stock-${role.id}`}
                              />
                            </TableCell>
                            <TableCell className="text-center">
                              <Switch
                                checked={role.canEditDaybook}
                                onCheckedChange={(checked) =>
                                  handlePermissionToggle(role.id, role.userId, role.companyId, "canEditDaybook", checked)
                                }
                                disabled={updatePermissionMutation.isPending}
                                data-testid={`toggle-edit-daybook-${role.id}`}
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              )}
            </Card>
          </div>
        </TabsContent>

        {/* Fiscal Period Tab */}
        <TabsContent value="fiscal" className="space-y-4">
          <FiscalPeriodTab 
            currentCompanyId={selectedCompany?.id} 
            userRole={currentRole} 
          />
        </TabsContent>
      </Tabs>

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
