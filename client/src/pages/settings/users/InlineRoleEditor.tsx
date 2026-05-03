import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Check, X, MapPin } from "lucide-react";

const ROLE_OPTIONS = [
  "Admin", "Owner", "Manager",
  "POS1", "POS2", "POS3", "POS4", "POS5", "POS6",
];

interface InlineRoleEditorProps {
  userId: string;
  companies: any[];
  editingRole: any | null;
  onClose: () => void;
  onSaved: () => void;
}

export function InlineRoleEditor({
  userId,
  companies,
  editingRole,
  onClose,
  onSaved,
}: InlineRoleEditorProps) {
  const { toast } = useToast();
  const isEditing = !!editingRole;

  const [companyId, setCompanyId] = useState<number>(companies[0]?.id ?? 0);
  const [role, setRole] = useState("Manager");
  const [assignedLocationId, setAssignedLocationId] = useState<number | undefined>();
  const [selectedLocationIds, setSelectedLocationIds] = useState<number[]>([]);
  const [posStation, setPosStation] = useState<number | undefined>();
  const [daybookEditDays, setDaybookEditDays] = useState(0);
  const [cashAccountId, setCashAccountId] = useState<number | undefined>();
  const [canSellNegativeStock, setCanSellNegativeStock] = useState(false);

  const isPOS = role.startsWith("POS");
  const isPrivileged = ["Admin", "Owner", "Developer"].includes(role);

  useEffect(() => {
    if (editingRole) {
      setCompanyId(editingRole.companyId);
      setRole(editingRole.role);
      setAssignedLocationId(editingRole.assignedLocationId);
      setPosStation(editingRole.posStation ?? undefined);
      setDaybookEditDays(editingRole.daybookEditDays ?? 0);
      setCashAccountId(editingRole.cashAccountId ?? undefined);
      setCanSellNegativeStock(editingRole.canSellNegativeStock ?? false);

      if (editingRole.role?.startsWith("POS")) {
        fetch(`/api/user-locations/${editingRole.userId}/${editingRole.companyId}`, { credentials: "include" })
          .then((r) => r.json())
          .then((locs) => {
            if (Array.isArray(locs) && locs.length > 0) {
              setSelectedLocationIds(locs.map((l: any) => l.locationId));
            } else {
              setSelectedLocationIds(editingRole.assignedLocationId ? [editingRole.assignedLocationId] : []);
            }
          })
          .catch(() => {
            setSelectedLocationIds(editingRole.assignedLocationId ? [editingRole.assignedLocationId] : []);
          });
      } else {
        setSelectedLocationIds([]);
      }
    } else {
      setCompanyId(companies[0]?.id ?? 0);
      setRole("Manager");
      setAssignedLocationId(undefined);
      setSelectedLocationIds([]);
      setPosStation(undefined);
      setDaybookEditDays(0);
      setCashAccountId(undefined);
      setCanSellNegativeStock(false);
    }
  }, [editingRole?.id]);

  const { data: locations = [] } = useQuery<any[]>({
    queryKey: ["/api/locations", { companyId }],
    queryFn: async () => {
      if (!companyId) return [];
      const res = await fetch(`/api/locations?companyId=${companyId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch locations");
      return res.json();
    },
    enabled: !!companyId && isPOS,
  });

  const { data: ledgerAccounts = [] } = useQuery<any[]>({
    queryKey: ["/api/ledger-accounts", { companyId }],
    queryFn: async () => {
      if (!companyId) return [];
      const res = await fetch(`/api/ledger-accounts?companyId=${companyId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch ledger accounts");
      return res.json();
    },
    enabled: !!companyId,
  });

  const cashAccounts = ledgerAccounts.filter((a: any) => a.accountType === "Cash");

  const saveMutation = useMutation({
    mutationFn: async () => {
      const primary = selectedLocationIds[0] ?? assignedLocationId;
      const payload = {
        userId,
        companyId,
        role,
        assignedLocationId: isPOS ? primary : undefined,
        posStation: isPOS ? posStation : undefined,
        daybookEditDays,
        cashAccountId: cashAccountId ?? undefined,
        canSellNegativeStock,
      };

      if (isEditing) {
        await apiRequest("PATCH", `/api/user-company-roles/${editingRole.id}`, payload);
      } else {
        await apiRequest("POST", "/api/user-company-roles", payload);
      }

      if (isPOS && selectedLocationIds.length > 0) {
        await apiRequest("PUT", `/api/user-locations/${userId}/${companyId}`, {
          locationIds: selectedLocationIds,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/users/${userId}/company-roles`] });
      toast({ title: isEditing ? "Role updated" : "Role assigned" });
      onSaved();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const toggleLocation = (locId: number) => {
    setSelectedLocationIds((prev) => {
      const next = prev.includes(locId) ? prev.filter((id) => id !== locId) : [...prev, locId];
      if (next.length > 0) setAssignedLocationId(next[0]);
      return next;
    });
  };

  const selectAllLocations = () => {
    const all = locations.map((l: any) => l.id);
    setSelectedLocationIds(all);
    if (all.length > 0) setAssignedLocationId(all[0]);
  };

  const clearLocations = () => {
    setSelectedLocationIds([]);
    setAssignedLocationId(undefined);
  };

  return (
    <div className="rounded-md border border-primary/30 bg-accent/20 p-4 space-y-4" data-testid="inline-role-editor">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {isEditing ? "Edit Role" : "Add Role"}
      </p>

      {/* Group 1: Basic Role */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Company</Label>
          <Select
            value={companyId.toString()}
            onValueChange={(v) => setCompanyId(parseInt(v))}
            disabled={isEditing}
          >
            <SelectTrigger className="h-8 text-xs" data-testid="select-role-company">
              <SelectValue placeholder="Select company" />
            </SelectTrigger>
            <SelectContent>
              {companies.map((c: any) => (
                <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Role</Label>
          <Select value={role} onValueChange={(v) => { setRole(v); setSelectedLocationIds([]); }}>
            <SelectTrigger className="h-8 text-xs" data-testid="select-role-type">
              <SelectValue placeholder="Select role" />
            </SelectTrigger>
            <SelectContent>
              {ROLE_OPTIONS.map((r) => (
                <SelectItem key={r} value={r}>{r.startsWith("POS") ? `POS ${r.slice(3)}` : r}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Group 2: POS Settings */}
      {isPOS && (
        <div className="space-y-3 rounded-md border border-border/60 bg-background p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">POS Settings</p>

          {/* Locations */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                Assigned Locations
                {selectedLocationIds.length > 0 && (
                  <Badge variant="secondary" className="text-xs ml-1">{selectedLocationIds.length} selected</Badge>
                )}
              </Label>
              <div className="flex gap-1">
                <Button type="button" variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={selectAllLocations}>All</Button>
                <Button type="button" variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={clearLocations}>Clear</Button>
              </div>
            </div>
            {locations.length === 0 ? (
              <p className="text-xs text-muted-foreground">No locations for this company.</p>
            ) : (
              <div className="grid grid-cols-2 gap-1 max-h-36 overflow-y-auto rounded-md border p-2" data-testid="select-locations">
                {locations.map((loc: any) => {
                  const checked = selectedLocationIds.includes(loc.id);
                  return (
                    <label
                      key={loc.id}
                      className={`flex items-center gap-2 cursor-pointer text-xs rounded px-2 py-1 transition-colors ${checked ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted/50"}`}
                      data-testid={`checkbox-location-${loc.id}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleLocation(loc.id)}
                        className="rounded shrink-0"
                      />
                      <span className="truncate">{loc.name}</span>
                      <span className="text-muted-foreground shrink-0">({loc.code})</span>
                    </label>
                  );
                })}
              </div>
            )}
            {isPOS && selectedLocationIds.length === 0 && (
              <p className="text-xs text-destructive">At least one location required for POS roles.</p>
            )}
          </div>

          {/* POS Station + Daybook Days */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">POS Station</Label>
              <Input
                type="number"
                min={1}
                max={6}
                placeholder="1–6"
                value={posStation ?? ""}
                onChange={(e) => setPosStation(e.target.value ? parseInt(e.target.value) : undefined)}
                className="h-8 text-xs"
                data-testid="input-pos-station"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Daybook Edit Days</Label>
              <Input
                type="number"
                min={0}
                placeholder="0 = no edit"
                value={daybookEditDays}
                onChange={(e) => setDaybookEditDays(parseInt(e.target.value) || 0)}
                className="h-8 text-xs"
                data-testid="input-daybook-edit-days"
              />
            </div>
          </div>

          {/* Cash Account + Can Sell Negative */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Cash Account</Label>
              <Select
                value={cashAccountId?.toString() ?? ""}
                onValueChange={(v) => setCashAccountId(v ? parseInt(v) : undefined)}
              >
                <SelectTrigger className="h-8 text-xs" data-testid="select-cash-account">
                  <SelectValue placeholder="Optional" />
                </SelectTrigger>
                <SelectContent>
                  {cashAccounts.map((a: any) => (
                    <SelectItem key={a.id} value={a.id.toString()}>
                      {a.name} ({a.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 pt-5">
              <Switch
                checked={canSellNegativeStock}
                onCheckedChange={setCanSellNegativeStock}
                data-testid="switch-can-sell-negative-stock"
              />
              <Label className="text-xs cursor-pointer">Allow 0-stock sales</Label>
            </div>
          </div>
        </div>
      )}

      {/* Non-POS daybook days */}
      {!isPOS && !isPrivileged && (
        <div className="space-y-1.5">
          <Label className="text-xs">Daybook Edit Days</Label>
          <Input
            type="number"
            min={0}
            placeholder="0 = no editing"
            value={daybookEditDays}
            onChange={(e) => setDaybookEditDays(parseInt(e.target.value) || 0)}
            className="h-8 text-xs"
            data-testid="input-daybook-edit-days"
          />
          <p className="text-xs text-muted-foreground">How many past days this user can edit POS daybook vouchers.</p>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 border-t pt-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onClose}
          disabled={saveMutation.isPending}
          data-testid="button-cancel-role"
        >
          <X className="h-3.5 w-3.5 mr-1" />
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || (isPOS && selectedLocationIds.length === 0)}
          data-testid="button-save-role"
        >
          <Check className="h-3.5 w-3.5 mr-1" />
          {saveMutation.isPending ? "Saving…" : isEditing ? "Save Changes" : "Add Role"}
        </Button>
      </div>
    </div>
  );
}
