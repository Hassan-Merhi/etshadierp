import { useState, useEffect } from "react";
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
  Building2,
  Lock,
  Trash2,
  Plus,
  Edit,
  ChevronDown,
  ChevronRight,
  Check,
  X,
  Save,
  KeyRound,
} from "lucide-react";
import { FACTORY_NAV_PAGES } from "@/components/FactorySidebar";
import { FEATURE_KEYS, FEATURE_PAGE_INFO } from "@shared/schema";
import { UserRoleDialog } from "./UserRoleDialog";

const ALL_FACTORY_PAGES = FACTORY_NAV_PAGES;
const FACTORY_PAGE_GROUPS = Array.from(new Set(ALL_FACTORY_PAGES.map((p) => p.group)));
const ALL_ERP_PAGES: { key: string; label: string; group: string }[] = FEATURE_KEYS.map((key) => ({
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
  const isPrivileged = ["admin", "owner"].includes(user?.role?.toLowerCase() ?? "");

  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [hasErpAccess, setHasErpAccess] = useState(true);
  const [hasFactoryAccess, setHasFactoryAccess] = useState(true);
  const [pageAccess, setPageAccess] = useState<Set<string>>(new Set());
  const [hiddenCostFields, setHiddenCostFields] = useState<string[]>([]);

  const [newPassword, setNewPassword] = useState("");
  const [showPasswordReset, setShowPasswordReset] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Role dialog state — fully owned by this drawer
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<any>(null);
  const [roleToDelete, setRoleToDelete] = useState<any>(null);

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

  const { data: companyRoles = [] } = useQuery<any[]>({
    queryKey: [`/api/users/${user?.id}/company-roles`],
    enabled: !!user?.id,
  });

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

  const deleteRoleMutation = useMutation({
    mutationFn: async (roleId: number) => {
      await apiRequest("DELETE", `/api/user-company-roles/${roleId}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/users/${user?.id}/company-roles`] });
      toast({ title: "Role removed" });
      setRoleToDelete(null);
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
    (isPrivileged ? 0 : pageAccess.size) + (isPrivileged ? 0 : hiddenCostFields.length);

  return (
    <>
      <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-[520px] overflow-y-auto p-0"
        >
          <SheetHeader className="px-6 py-4 border-b">
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

          <div className="px-6 py-4 space-y-4">
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

                <div className="flex items-center justify-between gap-3 pt-1 flex-wrap">
                  {!isPrivileged && (
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
                  )}
                  <Button
                    size="sm"
                    className="ml-auto gap-2"
                    onClick={handleSaveAccount}
                    disabled={updateMutation.isPending}
                    data-testid="button-save-account"
                  >
                    <Save className="h-3.5 w-3.5" />
                    {updateMutation.isPending ? "Saving..." : "Save"}
                  </Button>
                </div>
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
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex items-center justify-between rounded-md border p-3">
                    <div>
                      <p className="text-sm font-medium">ERP</p>
                      <p className="text-xs text-muted-foreground">Accounting &amp; sales</p>
                    </div>
                    <Switch
                      checked={isPrivileged ? true : hasErpAccess}
                      disabled={isPrivileged}
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
                      checked={isPrivileged ? true : hasFactoryAccess}
                      disabled={isPrivileged}
                      onCheckedChange={setHasFactoryAccess}
                      data-testid="switch-drawer-factory-access"
                    />
                  </div>
                </div>
                {isPrivileged && (
                  <p className="text-xs text-muted-foreground">
                    Admin / Owner accounts always have full access.
                  </p>
                )}
                {!isPrivileged && (
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      className="gap-2"
                      onClick={handleSaveAccess}
                      disabled={updateMutation.isPending}
                      data-testid="button-save-access"
                    >
                      <Save className="h-3.5 w-3.5" />
                      {updateMutation.isPending ? "Saving..." : "Save"}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Card 3: Company Roles */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    Company Roles
                  </CardTitle>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => { setEditingRole(null); setRoleDialogOpen(true); }}
                    data-testid={`button-add-role-${user.id}`}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Role
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {companyRoles.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No company roles assigned yet.</p>
                ) : (
                  <div className="space-y-1.5">
                    {companyRoles.map((role: any) => (
                      <div
                        key={role.id}
                        className="flex items-center gap-2 rounded-md border px-3 py-2 bg-background"
                        data-testid={`role-item-${role.id}`}
                      >
                        <span className="flex-1 text-sm font-medium">
                          {companies.find((c: any) => c.id === role.companyId)?.name ||
                            `Company ${role.companyId}`}
                        </span>
                        <Badge
                          variant={["Admin", "Owner"].includes(role.role) ? "default" : "secondary"}
                          className="text-xs"
                        >
                          {role.role}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => { setEditingRole(role); setRoleDialogOpen(true); }}
                          data-testid={`button-edit-role-${role.id}`}
                        >
                          <Edit className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive"
                          onClick={() => setRoleToDelete(role)}
                          data-testid={`button-delete-role-${role.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

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
                    {!advancedOpen && (
                      <p className="text-xs text-muted-foreground font-normal mt-1">
                        Page access, hidden cost fields, daybook restrictions
                      </p>
                    )}
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
                            <p className="text-xs text-muted-foreground">Leave all unchecked for full factory access.</p>
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
                            <p className="text-xs text-muted-foreground">Leave all unchecked for full ERP access.</p>
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
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Daybook Restrictions</p>
                          <div className="border rounded-md p-3">
                            <div className="flex items-center gap-2">
                              <Checkbox checked={hiddenCostFields.includes("daybook_own_only")} onCheckedChange={() => toggleCostField("daybook_own_only")} data-testid="checkbox-daybook-own-only" />
                              <span className="text-sm">Show only entries they created</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex justify-end">
                          <Button size="sm" className="gap-2" onClick={handleSaveRestrictions} disabled={updateMutation.isPending} data-testid="button-save-restrictions">
                            <Save className="h-3.5 w-3.5" />
                            {updateMutation.isPending ? "Saving..." : "Save Restrictions"}
                          </Button>
                        </div>
                      </>
                    )}
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          </div>
        </SheetContent>
      </Sheet>

      {/* Self-contained role assignment dialog */}
      <UserRoleDialog
        open={roleDialogOpen}
        onClose={() => { setRoleDialogOpen(false); setEditingRole(null); }}
        userId={user.id}
        companies={companies}
        editingRole={editingRole}
      />

      {/* Delete role confirmation */}
      <AlertDialog open={!!roleToDelete} onOpenChange={(v) => { if (!v) setRoleToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this role?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove the <strong>{roleToDelete?.role}</strong> role from{" "}
              <strong>{companies.find((c: any) => c.id === roleToDelete?.companyId)?.name || `Company ${roleToDelete?.companyId}`}</strong>?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteRoleMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => roleToDelete && deleteRoleMutation.mutate(roleToDelete.id)}
              disabled={deleteRoleMutation.isPending}
              className="bg-destructive text-destructive-foreground"
              data-testid="button-confirm-delete-role"
            >
              {deleteRoleMutation.isPending ? "Removing..." : "Remove Role"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
