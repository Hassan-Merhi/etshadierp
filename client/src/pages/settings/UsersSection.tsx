import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { factoryApiRequest } from "@/lib/factoryApi";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
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
} from "@/components/ui/dialog";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Edit, Users, Trash2, Shield, Check, X } from "lucide-react";
import { FACTORY_NAV_PAGES } from "@/components/FactorySidebar";
import { FEATURE_KEYS, FEATURE_PAGE_INFO } from "@shared/schema";

const ALL_FACTORY_PAGES_SETTINGS = FACTORY_NAV_PAGES;
const FACTORY_PAGE_GROUPS_SETTINGS = Array.from(
  new Set(ALL_FACTORY_PAGES_SETTINGS.map((p) => p.group))
);
const ALL_ERP_PAGES: { key: string; label: string; group: string }[] =
  FEATURE_KEYS.map((key) => ({
    key,
    label: FEATURE_PAGE_INFO[key].label,
    group: FEATURE_PAGE_INFO[key].group,
  }));
const ERP_PAGE_GROUPS = Array.from(new Set(ALL_ERP_PAGES.map((p) => p.group)));
const FACTORY_COST_FIELDS = [
  { key: "inventory_avg_rate", label: "Avg Rate Column" },
  { key: "inventory_total_value", label: "Total Value Column" },
  { key: "inventory_sell_price", label: "Sell Price Column" },
  { key: "inventory_sell_value", label: "Sell Value Column" },
  { key: "bale_history_cost_per_kg", label: "Cost/KG Column" },
  { key: "bale_history_total_cost", label: "Total Cost Column" },
  { key: "bales_list_cost_per_kg", label: "Cost/kg Column" },
];

interface UsersSectionProps {
  companies: any[];
  handleAddRole: (userId: string) => void;
  handleEditRole: (role: any) => void;
  handleDeleteRole: (roleId: number, userId: string) => void;
}

export function UsersSection({
  companies,
  handleAddRole,
  handleEditRole,
  handleDeleteRole,
}: UsersSectionProps) {
  const { toast } = useToast();

  const [factoryCreateOpen, setFactoryCreateOpen] = useState(false);
  const [factoryEditingUser, setFactoryEditingUser] = useState<any>(null);
  const [factoryDeletingUser, setFactoryDeletingUser] = useState<any>(null);
  const [factoryUserFormData, setFactoryUserFormData] = useState({
    username: "",
    password: "",
    displayName: "",
    hasErpAccess: true,
    hasFactoryAccess: true,
  });
  const [factoryUserPages, setFactoryUserPages] = useState<Set<string>>(
    new Set()
  );
  const [factoryUserHiddenCostFields, setFactoryUserHiddenCostFields] =
    useState<string[]>([]);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  const { data: factoryUsersData = [], isLoading: isLoadingFactoryUsers } =
    useQuery<any[]>({
      queryKey: ["/api/factory/users"],
    });

  const { data: userCompanyRoles = [] } = useQuery<any[]>({
    queryKey: [`/api/users/${expandedUserId}/company-roles`],
    enabled: !!expandedUserId,
  });

  const createFactoryUserMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await factoryApiRequest("POST", "/api/factory/users", data);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to create user");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/users"] });
      toast({ title: "Created", description: "User created successfully" });
      resetFactoryUserForm();
      setFactoryCreateOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateFactoryUserMutation = useMutation({
    mutationFn: async ({ userId, data }: { userId: string; data: any }) => {
      const res = await factoryApiRequest(
        "PUT",
        `/api/factory/users/${userId}`,
        data
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to update user");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/users"] });
      toast({ title: "Updated", description: "User updated successfully" });
      resetFactoryUserForm();
      setFactoryEditingUser(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteFactoryUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await factoryApiRequest(
        "DELETE",
        `/api/factory/users/${userId}`,
        {}
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to remove");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/users"] });
      toast({ title: "Removed", description: "User removed" });
      setFactoryDeletingUser(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const resetFactoryUserForm = () => {
    setFactoryUserFormData({
      username: "",
      password: "",
      displayName: "",
      hasErpAccess: true,
      hasFactoryAccess: true,
    });
    setFactoryUserPages(new Set());
    setFactoryUserHiddenCostFields([]);
  };

  const openFactoryUserEdit = (user: any) => {
    setFactoryEditingUser(user);
    setExpandedUserId(user.id);
    setFactoryUserFormData({
      username: user.username,
      password: "",
      displayName: user.displayName || "",
      hasErpAccess: user.hasErpAccess ?? true,
      hasFactoryAccess: user.hasFactoryAccess ?? true,
    });
    setFactoryUserPages(new Set(user.pageAccess));
    setFactoryUserHiddenCostFields(user.hiddenCostFields ?? []);
  };

  const isFactoryAdminOrOwner = (user: any) =>
    ["admin", "owner"].includes(user.role?.toLowerCase());

  const toggleFactoryUserPage = (pageKey: string) => {
    setFactoryUserPages((prev) => {
      const next = new Set(prev);
      next.has(pageKey) ? next.delete(pageKey) : next.add(pageKey);
      return next;
    });
  };

  const toggleFactoryUserGroup = (group: string) => {
    const groupPages = ALL_FACTORY_PAGES_SETTINGS.filter(
      (p) => p.group === group
    ).map((p) => p.key);
    const allSelected = groupPages.every((k) => factoryUserPages.has(k));
    setFactoryUserPages((prev) => {
      const next = new Set(prev);
      groupPages.forEach((k) =>
        allSelected ? next.delete(k) : next.add(k)
      );
      return next;
    });
  };

  const handleFactoryUserSubmit = () => {
    if (factoryEditingUser) {
      const privileged = isFactoryAdminOrOwner(factoryEditingUser);
      updateFactoryUserMutation.mutate({
        userId: factoryEditingUser.id,
        data: {
          username:
            factoryUserFormData.username !== factoryEditingUser.username
              ? factoryUserFormData.username
              : undefined,
          displayName: factoryUserFormData.displayName,
          pageAccess: Array.from(factoryUserPages),
          password: factoryUserFormData.password || undefined,
          hasErpAccess: privileged ? true : factoryUserFormData.hasErpAccess,
          hasFactoryAccess: privileged
            ? true
            : factoryUserFormData.hasFactoryAccess,
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2
            className="text-2xl font-semibold"
            data-testid="text-factory-users-title"
          >
            User Management
          </h2>
          <p className="text-muted-foreground mt-1">
            Create users and control their access
          </p>
        </div>
        <Button
          onClick={() => {
            resetFactoryUserForm();
            setFactoryCreateOpen(true);
          }}
          data-testid="button-add-factory-user"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add User
        </Button>
      </div>

      <Card>
        <CardContent className="pt-4 overflow-x-auto">
          {isLoadingFactoryUsers ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
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
                  const hasFactory =
                    privileged || (user.hasFactoryAccess ?? true);
                  const factoryPageKeys = new Set(
                    ALL_FACTORY_PAGES_SETTINGS.map((p: any) => p.key)
                  );
                  const erpPageKeys = new Set(
                    ALL_ERP_PAGES.map((p: any) => p.key)
                  );
                  const factoryPagesCount = user.pageAccess.filter((k: string) =>
                    factoryPageKeys.has(k)
                  ).length;
                  const erpPagesCount = user.pageAccess.filter((k: string) =>
                    erpPageKeys.has(k)
                  ).length;
                  const accessLabel =
                    hasERP && hasFactory
                      ? "ERP + Factory"
                      : hasERP
                      ? "ERP only"
                      : hasFactory
                      ? "Factory only"
                      : "No access";
                  let pagesLabel = "All pages";
                  if (!privileged && user.pageAccess.length > 0) {
                    const parts: string[] = [];
                    if (hasFactory && factoryPagesCount > 0)
                      parts.push(`Factory: ${factoryPagesCount}`);
                    if (hasERP && erpPagesCount > 0)
                      parts.push(`ERP: ${erpPagesCount}`);
                    if (parts.length > 0) pagesLabel = parts.join(" · ");
                  }
                  const roleLabel = user.role || "User";
                  return (
                    <TableRow
                      key={user.id}
                      data-testid={`row-factory-user-${user.id}`}
                    >
                      <TableCell className="font-mono font-medium">
                        {user.username}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {user.displayName || "—"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={privileged ? "default" : "secondary"}
                          className="capitalize"
                        >
                          {roleLabel}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {accessLabel}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {pagesLabel}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openFactoryUserEdit(user)}
                            data-testid={`button-edit-user-${user.id}`}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          {!privileged && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setFactoryDeletingUser(user)}
                              data-testid={`button-delete-user-${user.id}`}
                              className="text-destructive"
                            >
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
              <p className="text-sm mt-1">
                Click "Add User" to create the first one
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create / Edit Dialog */}
      <Dialog
        open={factoryCreateOpen || !!factoryEditingUser}
        onOpenChange={(open) => {
          if (!open) {
            setFactoryCreateOpen(false);
            setFactoryEditingUser(null);
            setExpandedUserId(null);
            resetFactoryUserForm();
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              {factoryEditingUser
                ? `Edit: ${factoryEditingUser.username}`
                : "Add New User"}
            </DialogTitle>
            <DialogDescription>
              {factoryEditingUser
                ? "Update credentials, access modes, and page permissions"
                : "Set up login credentials and choose what this user can access"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-1">
            {/* Credentials */}
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Credentials
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Username *</Label>
                  <Input
                    value={factoryUserFormData.username}
                    onChange={(e) =>
                      setFactoryUserFormData({
                        ...factoryUserFormData,
                        username: e.target.value,
                      })
                    }
                    placeholder="Enter username"
                    data-testid="input-factory-username"
                  />
                  {factoryEditingUser &&
                    factoryUserFormData.username !==
                      factoryEditingUser.username && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Username will change on save
                      </p>
                    )}
                </div>
                <div>
                  <Label>
                    {factoryEditingUser ? "New Password" : "Password *"}
                  </Label>
                  <Input
                    type="password"
                    value={factoryUserFormData.password}
                    onChange={(e) =>
                      setFactoryUserFormData({
                        ...factoryUserFormData,
                        password: e.target.value,
                      })
                    }
                    placeholder={
                      factoryEditingUser
                        ? "Leave blank to keep"
                        : "Min 4 characters"
                    }
                    data-testid="input-factory-password"
                  />
                </div>
              </div>
              <div>
                <Label>Display Name</Label>
                <Input
                  value={factoryUserFormData.displayName}
                  onChange={(e) =>
                    setFactoryUserFormData({
                      ...factoryUserFormData,
                      displayName: e.target.value,
                    })
                  }
                  placeholder="Name shown in the system (e.g. John, Warehouse Manager)"
                  data-testid="input-factory-display-name"
                />
              </div>
            </div>

            {/* App Access */}
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                App Access
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <p className="text-sm font-medium">ERP</p>
                    <p className="text-xs text-muted-foreground">
                      Accounting, sales, analytics
                    </p>
                  </div>
                  <Switch
                    checked={
                      factoryEditingUser &&
                      isFactoryAdminOrOwner(factoryEditingUser)
                        ? true
                        : factoryUserFormData.hasErpAccess
                    }
                    disabled={
                      !!factoryEditingUser &&
                      isFactoryAdminOrOwner(factoryEditingUser)
                    }
                    onCheckedChange={(v) =>
                      setFactoryUserFormData({
                        ...factoryUserFormData,
                        hasErpAccess: v,
                      })
                    }
                    data-testid="switch-form-erp-access"
                  />
                </div>
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <p className="text-sm font-medium">Factory</p>
                    <p className="text-xs text-muted-foreground">
                      Production, bales, workers
                    </p>
                  </div>
                  <Switch
                    checked={
                      factoryEditingUser &&
                      isFactoryAdminOrOwner(factoryEditingUser)
                        ? true
                        : factoryUserFormData.hasFactoryAccess
                    }
                    disabled={
                      !!factoryEditingUser &&
                      isFactoryAdminOrOwner(factoryEditingUser)
                    }
                    onCheckedChange={(v) =>
                      setFactoryUserFormData({
                        ...factoryUserFormData,
                        hasFactoryAccess: v,
                      })
                    }
                    data-testid="switch-form-factory-access"
                  />
                </div>
              </div>
            </div>

            {/* Factory Pages */}
            {factoryUserFormData.hasFactoryAccess &&
              !(
                factoryEditingUser &&
                isFactoryAdminOrOwner(factoryEditingUser)
              ) && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Factory Pages
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setFactoryUserPages(
                            (prev) =>
                              new Set([
                                ...prev,
                                ...ALL_FACTORY_PAGES_SETTINGS.map(
                                  (p: any) => p.key
                                ),
                              ])
                          )
                        }
                        data-testid="button-select-all-pages"
                      >
                        <Check className="h-3 w-3 mr-1" />
                        All
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setFactoryUserPages((prev) => {
                            const next = new Set(prev);
                            ALL_FACTORY_PAGES_SETTINGS.forEach((p: any) =>
                              next.delete(p.key)
                            );
                            return next;
                          })
                        }
                        data-testid="button-select-none-pages"
                      >
                        <X className="h-3 w-3 mr-1" />
                        None
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Leave all unchecked to grant full factory access.
                  </p>
                  <div className="space-y-4 border rounded-md p-4 max-h-56 overflow-y-auto">
                    {FACTORY_PAGE_GROUPS_SETTINGS.map((group: string) => {
                      const groupPages = ALL_FACTORY_PAGES_SETTINGS.filter(
                        (p: any) => p.group === group
                      );
                      const allSelected = groupPages.every((p: any) =>
                        factoryUserPages.has(p.key)
                      );
                      const someSelected = groupPages.some((p: any) =>
                        factoryUserPages.has(p.key)
                      );
                      return (
                        <div key={group} className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Checkbox
                              checked={allSelected}
                              onCheckedChange={() =>
                                toggleFactoryUserGroup(group)
                              }
                              data-testid={`checkbox-group-${group
                                .toLowerCase()
                                .replace(/\s+/g, "-")}`}
                            />
                            <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                              {group}
                            </span>
                            {someSelected && !allSelected && (
                              <Badge variant="secondary" className="text-xs">
                                partial
                              </Badge>
                            )}
                          </div>
                          <div className="ml-6 grid grid-cols-2 gap-1">
                            {groupPages.map((page: any) => (
                              <div
                                key={page.key}
                                className="flex items-center gap-2"
                              >
                                <Checkbox
                                  checked={factoryUserPages.has(page.key)}
                                  onCheckedChange={() =>
                                    toggleFactoryUserPage(page.key)
                                  }
                                  data-testid={`checkbox-page-${page.key.replace(
                                    /\//g,
                                    "-"
                                  )}`}
                                />
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
            {factoryUserFormData.hasErpAccess &&
              !(
                factoryEditingUser &&
                isFactoryAdminOrOwner(factoryEditingUser)
              ) && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      ERP Pages
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setFactoryUserPages(
                            (prev) =>
                              new Set([
                                ...prev,
                                ...ALL_ERP_PAGES.map((p: any) => p.key),
                              ])
                          )
                        }
                        data-testid="button-select-all-erp-pages"
                      >
                        <Check className="h-3 w-3 mr-1" />
                        All
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setFactoryUserPages((prev) => {
                            const next = new Set(prev);
                            ALL_ERP_PAGES.forEach((p: any) =>
                              next.delete(p.key)
                            );
                            return next;
                          })
                        }
                        data-testid="button-select-none-erp-pages"
                      >
                        <X className="h-3 w-3 mr-1" />
                        None
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Leave all unchecked to grant full ERP access.
                  </p>
                  <div className="space-y-4 border rounded-md p-4 max-h-56 overflow-y-auto">
                    {ERP_PAGE_GROUPS.map((group: string) => {
                      const groupPages = ALL_ERP_PAGES.filter(
                        (p: any) => p.group === group
                      );
                      const allSelected = groupPages.every((p: any) =>
                        factoryUserPages.has(p.key)
                      );
                      const someSelected = groupPages.some((p: any) =>
                        factoryUserPages.has(p.key)
                      );
                      return (
                        <div key={`erp-${group}`} className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Checkbox
                              checked={allSelected}
                              onCheckedChange={() => {
                                setFactoryUserPages((prev) => {
                                  const next = new Set(prev);
                                  if (allSelected) {
                                    groupPages.forEach((p: any) =>
                                      next.delete(p.key)
                                    );
                                  } else {
                                    groupPages.forEach((p: any) =>
                                      next.add(p.key)
                                    );
                                  }
                                  return next;
                                });
                              }}
                              data-testid={`checkbox-erp-group-${group
                                .toLowerCase()
                                .replace(/\s+/g, "-")}`}
                            />
                            <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                              {group}
                            </span>
                            {someSelected && !allSelected && (
                              <Badge variant="secondary" className="text-xs">
                                partial
                              </Badge>
                            )}
                          </div>
                          <div className="ml-6 grid grid-cols-2 gap-1">
                            {groupPages.map((page: any) => (
                              <div
                                key={page.key}
                                className="flex items-center gap-2"
                              >
                                <Checkbox
                                  checked={factoryUserPages.has(page.key)}
                                  onCheckedChange={() =>
                                    toggleFactoryUserPage(page.key)
                                  }
                                  data-testid={`checkbox-erp-page-${page.key}`}
                                />
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
            {!(
              factoryEditingUser && isFactoryAdminOrOwner(factoryEditingUser)
            ) && (
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Cost &amp; Pricing Visibility
                </p>
                <p className="text-xs text-muted-foreground">
                  Check to hide these fields from this user.
                </p>
                <div className="space-y-2 border rounded-md p-4">
                  {FACTORY_COST_FIELDS.map((field: any) => (
                    <div key={field.key} className="flex items-center gap-2">
                      <Checkbox
                        checked={factoryUserHiddenCostFields.includes(field.key)}
                        onCheckedChange={() =>
                          setFactoryUserHiddenCostFields((prev) =>
                            prev.includes(field.key)
                              ? prev.filter((k) => k !== field.key)
                              : [...prev, field.key]
                          )
                        }
                        data-testid={`checkbox-cost-${field.key}`}
                      />
                      <span className="text-sm">{field.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Daybook Restrictions */}
            {!(
              factoryEditingUser && isFactoryAdminOrOwner(factoryEditingUser)
            ) && (
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Daybook Restrictions
                </p>
                <p className="text-xs text-muted-foreground">
                  Restrict what this user sees in the factory daybook.
                </p>
                <div className="space-y-2 border rounded-md p-4">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={factoryUserHiddenCostFields.includes(
                        "daybook_own_only"
                      )}
                      onCheckedChange={() =>
                        setFactoryUserHiddenCostFields((prev) =>
                          prev.includes("daybook_own_only")
                            ? prev.filter((k) => k !== "daybook_own_only")
                            : [...prev, "daybook_own_only"]
                        )
                      }
                      data-testid="checkbox-daybook-own-only"
                    />
                    <span className="text-sm">
                      Show only entries they created
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Company Roles — edit mode only */}
            {factoryEditingUser && (
              <div className="space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    ERP Company Roles
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleAddRole(factoryEditingUser.id)}
                    data-testid={`button-add-role-${factoryEditingUser.id}`}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add Role
                  </Button>
                </div>
                {userCompanyRoles.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No company roles assigned yet.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {userCompanyRoles.map((role: any) => (
                      <div
                        key={role.id}
                        className="flex items-center gap-1.5 border rounded-md px-2 py-1 bg-background text-sm"
                        data-testid={`role-item-${role.id}`}
                      >
                        <span className="font-medium">
                          {companies.find((c: any) => c.id === role.companyId)
                            ?.name || `Company ${role.companyId}`}
                        </span>
                        <span className="text-muted-foreground">—</span>
                        <Badge
                          variant={
                            role.role === "Admin" || role.role === "Owner"
                              ? "default"
                              : "secondary"
                          }
                          className="text-xs"
                        >
                          {role.role}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5"
                          onClick={() => handleEditRole(role)}
                          data-testid={`button-edit-role-${role.id}`}
                        >
                          <Edit className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 text-destructive"
                          onClick={() =>
                            handleDeleteRole(role.id, factoryEditingUser.id)
                          }
                          data-testid={`button-delete-role-${role.id}`}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="mt-4">
            <Button
              variant="outline"
              onClick={() => {
                setFactoryCreateOpen(false);
                setFactoryEditingUser(null);
                setExpandedUserId(null);
                resetFactoryUserForm();
              }}
              disabled={
                createFactoryUserMutation.isPending ||
                updateFactoryUserMutation.isPending
              }
            >
              Cancel
            </Button>
            <Button
              onClick={handleFactoryUserSubmit}
              disabled={
                createFactoryUserMutation.isPending ||
                updateFactoryUserMutation.isPending
              }
              data-testid="button-save-factory-user"
            >
              {createFactoryUserMutation.isPending ||
              updateFactoryUserMutation.isPending
                ? "Saving..."
                : factoryEditingUser
                ? "Save Changes"
                : "Create User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog
        open={!!factoryDeletingUser}
        onOpenChange={(open) => {
          if (!open) setFactoryDeletingUser(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove User</DialogTitle>
            <DialogDescription>
              Remove <strong>{factoryDeletingUser?.username}</strong> from this
              company? Their account will be deactivated.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setFactoryDeletingUser(null)}
              disabled={deleteFactoryUserMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                factoryDeletingUser &&
                deleteFactoryUserMutation.mutate(factoryDeletingUser.id)
              }
              disabled={deleteFactoryUserMutation.isPending}
              data-testid="button-confirm-delete-factory-user"
            >
              {deleteFactoryUserMutation.isPending
                ? "Removing..."
                : "Remove User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
