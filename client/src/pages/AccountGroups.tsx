import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient } from "@/lib/queryClient";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useCompany } from "@/contexts/CompanyContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { PageHeader } from "@/components/PageHeader";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Layers,
  Plus,
  ArrowLeft,
  Trash2,
  UserPlus,
  Search,
  FolderOpen,
  Folder,
} from "lucide-react";
import type { LedgerAccount } from "@shared/schema";

const ACCOUNT_TYPES = [
  "Asset",
  "Liability",
  "Equity",
  "Income",
  "Expense",
  "Bank",
  "Cash",
  "Indirect Expense",
  "Direct Expense",
  "Government Taxes",
  "Loans",
  "Duty Agent",
  "Transporter Agent",
  "Accounts Payable",
  "Profit",
] as const;

export default function AccountGroups() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { selectedCompany } = useCompany();

  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [addAccountsOpen, setAddAccountsOpen] = useState(false);
  const [groupSearch, setGroupSearch] = useState("");
  const [accountSearch, setAccountSearch] = useState("");
  const [selectedToAdd, setSelectedToAdd] = useState<Set<number>>(new Set());

  // Create group form state
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupType, setNewGroupType] = useState<string>("");

  const { data: allAccounts = [], isLoading } = useQuery<LedgerAccount[]>({
    queryKey: ["/api/ledger-accounts", selectedCompany?.id],
    queryFn: async () => {
      const url = selectedCompany?.id
        ? `/api/ledger-accounts?companyId=${selectedCompany.id}`
        : "/api/ledger-accounts";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch accounts");
      return res.json();
    },
    enabled: !!selectedCompany,
  });

  // Derive parent groups: accounts that have at least one child OR we create them explicitly
  // A "group" is identified by having children pointing to it
  const childAccountIds = useMemo(() => {
    const set = new Set<number>();
    allAccounts.forEach((a) => { if (a.parentId) set.add(a.parentId); });
    return set;
  }, [allAccounts]);

  const parentGroups = useMemo(() =>
    allAccounts.filter((a) => childAccountIds.has(a.id)),
    [allAccounts, childAccountIds]
  );

  const filteredGroups = useMemo(() =>
    parentGroups.filter((g) =>
      g.name.toLowerCase().includes(groupSearch.toLowerCase()) ||
      g.code.toLowerCase().includes(groupSearch.toLowerCase())
    ),
    [parentGroups, groupSearch]
  );

  const selectedGroup = useMemo(() =>
    allAccounts.find((a) => a.id === selectedGroupId) ?? null,
    [allAccounts, selectedGroupId]
  );

  const childrenOfSelected = useMemo(() =>
    allAccounts.filter((a) => a.parentId === selectedGroupId),
    [allAccounts, selectedGroupId]
  );

  // Accounts not yet in this group (eligible to add)
  const eligibleToAdd = useMemo(() => {
    if (!selectedGroupId) return [];
    const childIds = new Set(childrenOfSelected.map((c) => c.id));
    return allAccounts.filter(
      (a) =>
        a.id !== selectedGroupId &&
        !childIds.has(a.id) &&
        a.name.toLowerCase().includes(accountSearch.toLowerCase())
    );
  }, [allAccounts, selectedGroupId, childrenOfSelected, accountSearch]);

  // --- Mutations ---
  const createGroupMutation = useMutation({
    mutationFn: async ({ name, accountType }: { name: string; accountType: string }) => {
      if (!selectedCompany?.id) throw new Error("No company selected");
      return apiRequest("POST", "/api/ledger-accounts", {
        name,
        accountType,
        companyId: selectedCompany.id,
      });
    },
    onSuccess: async (data: any) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts"] });
      setCreateOpen(false);
      setNewGroupName("");
      setNewGroupType("");
      toast({ title: "Group account created", description: `"${data.name}" is ready to receive child accounts.` });
    },
    onError: (err: any) => {
      toast({ title: "Failed to create group", description: err.message, variant: "destructive" });
    },
  });

  const assignMutation = useMutation({
    mutationFn: async ({ accountIds, parentId }: { accountIds: number[]; parentId: number | null }) =>
      apiRequest("PATCH", "/api/ledger-accounts/bulk-assign-parent", { accountIds, parentId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts"] });
      setAddAccountsOpen(false);
      setSelectedToAdd(new Set());
      setAccountSearch("");
      toast({ title: "Accounts assigned", description: "Selected accounts have been added to the group." });
    },
    onError: (err: any) => {
      toast({ title: "Failed to assign accounts", description: err.message, variant: "destructive" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (accountId: number) =>
      apiRequest("PATCH", "/api/ledger-accounts/bulk-assign-parent", { accountIds: [accountId], parentId: null }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts"] });
      toast({ title: "Account removed from group" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to remove account", description: err.message, variant: "destructive" });
    },
  });

  const handleCreateGroup = () => {
    if (!newGroupName.trim() || !newGroupType) return;
    createGroupMutation.mutate({ name: newGroupName.trim(), accountType: newGroupType });
  };

  const handleAssignAccounts = () => {
    if (!selectedGroupId || selectedToAdd.size === 0) return;
    assignMutation.mutate({ accountIds: Array.from(selectedToAdd), parentId: selectedGroupId });
  };

  const toggleSelectToAdd = (id: number) => {
    setSelectedToAdd((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const childCount = (groupId: number) => allAccounts.filter((a) => a.parentId === groupId).length;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/settings")}
            data-testid="button-back-settings"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
            <PageHeader title="Account Groups" />
          </div>
          <p className="text-sm text-muted-foreground ml-2 hidden sm:block">
            Organise ledger accounts under parent groups for better reporting
          </p>
        </div>
      </div>

      <div className="flex h-[calc(100vh-73px)]">
        {/* Left panel — group list */}
        <div className="w-72 border-r flex flex-col shrink-0">
          <div className="p-4 border-b space-y-3">
            <Button
              className="w-full"
              onClick={() => setCreateOpen(true)}
              data-testid="button-create-group"
            >
              <Plus className="h-4 w-4 mr-2" />
              Create Group
            </Button>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search groups…"
                value={groupSearch}
                onChange={(e) => setGroupSearch(e.target.value)}
                className="pl-8"
                data-testid="input-group-search"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {isLoading ? (
              [1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)
            ) : filteredGroups.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                {groupSearch ? "No groups match your search" : "No groups yet — create one to get started"}
              </div>
            ) : (
              filteredGroups.map((group) => (
                <button
                  key={group.id}
                  onClick={() => setSelectedGroupId(group.id)}
                  className={`w-full text-left rounded-md p-3 transition-colors hover-elevate ${
                    selectedGroupId === group.id
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-muted/60"
                  }`}
                  data-testid={`button-group-${group.id}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {selectedGroupId === group.id ? (
                      <FolderOpen className="h-4 w-4 shrink-0" />
                    ) : (
                      <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm truncate">{group.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{group.accountType}</div>
                    </div>
                    <Badge variant="secondary" className="shrink-0 text-xs">
                      {childCount(group.id)}
                    </Badge>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right panel — selected group */}
        <div className="flex-1 overflow-y-auto p-6">
          {!selectedGroup ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
              <Folder className="h-12 w-12 opacity-30" />
              <div className="text-center">
                <p className="font-medium">Select a group</p>
                <p className="text-sm mt-1">Choose a group from the left panel to manage its accounts</p>
              </div>
            </div>
          ) : (
            <div className="max-w-2xl space-y-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <h2 className="text-lg font-semibold">{selectedGroup.name}</h2>
                  <p className="text-sm text-muted-foreground">
                    {selectedGroup.accountType} · Code: {selectedGroup.code}
                  </p>
                </div>
                <Button
                  onClick={() => {
                    setSelectedToAdd(new Set());
                    setAccountSearch("");
                    setAddAccountsOpen(true);
                  }}
                  data-testid="button-add-accounts"
                >
                  <UserPlus className="h-4 w-4 mr-2" />
                  Add Accounts
                </Button>
              </div>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">
                    Member Accounts ({childrenOfSelected.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {childrenOfSelected.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">
                      No accounts assigned yet. Click "Add Accounts" to add some.
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {childrenOfSelected.map((child) => (
                        <div
                          key={child.id}
                          className="flex items-center justify-between rounded-md px-3 py-2 hover:bg-muted/50 group"
                          data-testid={`row-child-${child.id}`}
                        >
                          <div className="min-w-0">
                            <span className="font-medium text-sm">{child.name}</span>
                            <span className="text-xs text-muted-foreground ml-2">{child.code}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs shrink-0">
                              {child.accountType}
                            </Badge>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="opacity-0 group-hover:opacity-100 shrink-0"
                              onClick={() => removeMutation.mutate(child.id)}
                              disabled={removeMutation.isPending}
                              data-testid={`button-remove-child-${child.id}`}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>

      {/* Create Group Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Parent Group</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="group-name">Group Name</Label>
              <Input
                id="group-name"
                placeholder="e.g. Fixed Assets, Operating Expenses"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                data-testid="input-group-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="group-type">Account Type</Label>
              <Select value={newGroupType} onValueChange={setNewGroupType}>
                <SelectTrigger id="group-type" data-testid="select-group-type">
                  <SelectValue placeholder="Select account type…" />
                </SelectTrigger>
                <SelectContent>
                  {ACCOUNT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={handleCreateGroup}
              disabled={!newGroupName.trim() || !newGroupType || createGroupMutation.isPending}
              data-testid="button-confirm-create-group"
            >
              {createGroupMutation.isPending ? "Creating…" : "Create Group"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Accounts Dialog */}
      <Dialog open={addAccountsOpen} onOpenChange={setAddAccountsOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Accounts to "{selectedGroup?.name}"</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search accounts…"
                value={accountSearch}
                onChange={(e) => setAccountSearch(e.target.value)}
                className="pl-8"
                data-testid="input-add-account-search"
              />
            </div>
            <div className="max-h-72 overflow-y-auto border rounded-md divide-y">
              {eligibleToAdd.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  {accountSearch ? "No accounts match your search" : "No accounts available to add"}
                </p>
              ) : (
                eligibleToAdd.map((acc) => (
                  <label
                    key={acc.id}
                    className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/50"
                    data-testid={`label-add-account-${acc.id}`}
                  >
                    <Checkbox
                      checked={selectedToAdd.has(acc.id)}
                      onCheckedChange={() => toggleSelectToAdd(acc.id)}
                      data-testid={`checkbox-add-account-${acc.id}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm">{acc.name}</div>
                      <div className="text-xs text-muted-foreground">{acc.code} · {acc.accountType}</div>
                    </div>
                    {acc.parentId && (
                      <Badge variant="outline" className="text-xs shrink-0">In group</Badge>
                    )}
                  </label>
                ))
              )}
            </div>
            {selectedToAdd.size > 0 && (
              <p className="text-sm text-muted-foreground">
                {selectedToAdd.size} account{selectedToAdd.size !== 1 ? "s" : ""} selected
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddAccountsOpen(false)}>Cancel</Button>
            <Button
              onClick={handleAssignAccounts}
              disabled={selectedToAdd.size === 0 || assignMutation.isPending}
              data-testid="button-confirm-add-accounts"
            >
              {assignMutation.isPending ? "Assigning…" : `Add ${selectedToAdd.size > 0 ? selectedToAdd.size : ""} Account${selectedToAdd.size !== 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
