import { useState, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Container, Package, Plus, ArrowDown, AlertTriangle, Gavel, X, Check, ChevronsUpDown, Link2, Pencil, Trash2, Layers, BarChart3, FlaskConical, FileSpreadsheet, FileText, SlidersHorizontal, PlusCircle, MinusCircle, History, ArrowUpCircle, ArrowDownCircle, FlaskRound } from "lucide-react";
import { CreateMixBatchDialog } from "@/components/CreateMixBatchDialog";
import { EditMixBatchDialog } from "@/components/EditMixBatchDialog";
import type { FactoryMixBatch } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { useAppMode } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";
import { formatNumber } from "@/lib/formatNumber";
import { cn } from "@/lib/utils";

function parseAccountValue(val: string): { type: "ledger" | "supplier"; id: number } | null {
  if (!val) return null;
  if (val.startsWith("SUP:")) return { type: "supplier", id: parseInt(val.slice(4)) };
  const n = parseInt(val);
  return isNaN(n) ? null : { type: "ledger", id: n };
}

interface AccountComboboxProps {
  value: string;
  onValueChange: (value: string) => void;
  accounts: { id: number; name: string; code?: string }[];
  suppliers?: { id: number; name: string }[];
  placeholder?: string;
  disabled?: boolean;
  testId?: string;
}

function AccountCombobox({ value, onValueChange, accounts, suppliers, placeholder = "Select account", disabled = false, testId }: AccountComboboxProps) {
  const [open, setOpen] = useState(false);
  const parsed = parseAccountValue(value);
  const selectedAccount = parsed?.type === "ledger" ? accounts.find((a) => a.id === parsed.id) : null;
  const selectedSupplier = parsed?.type === "supplier" ? (suppliers || []).find((s) => s.id === parsed.id) : null;
  const displayLabel = selectedSupplier
    ? selectedSupplier.name
    : selectedAccount
      ? (selectedAccount.code ? `${selectedAccount.code} - ${selectedAccount.name}` : selectedAccount.name)
      : placeholder;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
          disabled={disabled}
          data-testid={testId}
        >
          <span className="truncate">{displayLabel}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0" align="start">
        <Command>
          <CommandInput placeholder="Search..." />
          <CommandList>
            <CommandEmpty>Nothing found.</CommandEmpty>
            {suppliers && suppliers.length > 0 && (
              <CommandGroup heading="Brokers & Suppliers">
                {suppliers.map((s) => (
                  <CommandItem
                    key={`sup-${s.id}`}
                    value={`supplier ${s.name}`}
                    onSelect={() => { onValueChange(`SUP:${s.id}`); setOpen(false); }}
                  >
                    <Check className={cn("mr-2 h-4 w-4", value === `SUP:${s.id}` ? "opacity-100" : "opacity-0")} />
                    {s.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            <CommandGroup heading="Ledger Accounts">
              {accounts.map((account) => (
                <CommandItem
                  key={`acc-${account.id}`}
                  value={account.code ? `${account.code} ${account.name}` : account.name}
                  onSelect={() => { onValueChange(account.id.toString()); setOpen(false); }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === account.id.toString() ? "opacity-100" : "opacity-0")} />
                  {account.code ? `${account.code} - ${account.name}` : account.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

interface AdditionalChargeRow {
  id: string;
  description: string;
  amount: string;
  currencyCode: string;
  ledgerAccountId: string;
  supplierId: string;
}

interface RawStockRow {
  supplierName: string;
  supplierId: number | null;
  sourceType?: string;
  currencyCode?: string;
  receivedKg: string;
  usedKg: string;
  remainingKg: string;
  reservedKg?: string;
  freeKg?: string;
  costPerKg: string;
  costPerKgUsd?: string;
  valueRemaining: string;
  valueRemainingUsd: string;
  lastOffloaded: string;
}

interface MixBatchRow {
  id: number;
  batchCode: string;
  name: string | null;
  totalWeightKg: string;
  usedKg: string;
  remainingKg: string;
  costPerKg: string;
  totalCost: string;
  status: string;
  operatorUser: string | null;
  batchDate: string | null;
  carryForwardFromId: number | null;
  createdAt: string;
}

interface ContainerOption {
  id: number;
  containerNumber: string;
  totalKg: string | null;
  ratePerKg: string | null;
  currencyCode?: string;
  fxRateToUsd?: string;
  freight?: string | null;
  freightCurrencyCode?: string | null;
  freightAccountId?: number | null;
  freightSupplierId?: number | null;
  otherCharges?: string | null;
  otherChargesAccountId?: number | null;
  otherChargesSupplierId?: number | null;
  commissionAmount?: string | null;
  commissionCurrencyCode?: string | null;
  commissionSupplierId?: number | null;
}

function AdjustmentsHistoryCard({ onDeleteRequest }: {
  onDeleteRequest: (id: number) => void;
}) {
  const { formatDisplayDate } = useDateFormat();
  const [open, setOpen] = useState(false);
  const { data: adjustments, isLoading } = useQuery<any[]>({
    queryKey: ["/api/factory/raw-stock/adjustments"],
    enabled: open,
  });

  if (!open) {
    return (
      <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={() => setOpen(true)} data-testid="button-show-adjustments-history">
        <SlidersHorizontal className="h-3.5 w-3.5 mr-1.5" />
        Show Manual Stock Adjustments History
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <SlidersHorizontal className="h-4 w-4" />
          Manual Stock Adjustments
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)} data-testid="button-hide-adjustments-history">
          <X className="h-3.5 w-3.5 mr-1" />
          Hide
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : adjustments && adjustments.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Material / Supplier</TableHead>
                <TableHead className="text-right">Qty (kg)</TableHead>
                <TableHead className="text-right">Cost/kg</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {adjustments.map((adj: any) => (
                <TableRow key={adj.id} data-testid={`row-adjustment-${adj.id}`}>
                  <TableCell className="text-sm text-muted-foreground">{formatDisplayDate(adj.date)}</TableCell>
                  <TableCell>
                    <Badge variant={adj.type === "ADD" ? "default" : "secondary"} data-testid={`badge-adj-type-${adj.id}`}>
                      {adj.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium">
                    {adj.materialLabel || adj.supplierName || `Supplier #${adj.supplierId}`}
                  </TableCell>
                  <TableCell className="text-right font-mono">{parseFloat(adj.kg).toFixed(3)}</TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">
                    {adj.type === "ADD" && parseFloat(adj.costPerKg) > 0
                      ? `${adj.currencyCode} ${parseFloat(adj.costPerKg).toFixed(4)}`
                      : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{adj.notes || "—"}</TableCell>
                  <TableCell>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => onDeleteRequest(adj.id)}
                      data-testid={`button-delete-adjustment-${adj.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-center text-muted-foreground py-6 text-sm">No manual adjustments recorded yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function ProductionRawStock() {
  const { formatDisplayDate } = useDateFormat();
  const [offloadDialogOpen, setOffloadDialogOpen] = useState(false);
  const [offloadDate, setOffloadDate] = useState<string>(new Date().toLocaleDateString('en-CA'));
  const [selectedContainerId, setSelectedContainerId] = useState("");
  const [actualReceivedKg, setActualReceivedKg] = useState("");
  const [costPerKg, setCostPerKg] = useState("");
  const [commissionPersonName, setCommissionPersonName] = useState("");
  const [commissionType, setCommissionType] = useState<"PER_KG" | "FIXED">("PER_KG");
  const [commissionRate, setCommissionRate] = useState("");
  const [commissionLedgerAccountId, setCommissionLedgerAccountId] = useState("");
  const [currencyCode, setCurrencyCode] = useState("USD");
  const [fxRateToUsd, setFxRateToUsd] = useState("1");
  const [freight, setFreight] = useState("");
  const [freightAccountId, setFreightAccountId] = useState("");
  const [freightCurrencyCode, setFreightCurrencyCode] = useState("USD");
  const [freightFxRate, setFreightFxRate] = useState("1");
  const [otherCharges, setOtherCharges] = useState("");
  const [otherChargesAccountId, setOtherChargesAccountId] = useState("");
  const [otherChargesCurrencyCode, setOtherChargesCurrencyCode] = useState("USD");
  const [otherChargesFxRate, setOtherChargesFxRate] = useState("1");
  // Flags: were these charges pre-filled from the container import (read-only)?
  const [freightFromContainer, setFreightFromContainer] = useState(false);
  const [otherChargesFromContainer, setOtherChargesFromContainer] = useState(false);
  const [commissionFromContainer, setCommissionFromContainer] = useState(false);
  const [containerCommissionCcy, setContainerCommissionCcy] = useState("USD");
  const [dutyAmount, setDutyAmount] = useState("");
  const [dutyAccountId, setDutyAccountId] = useState("");
  const [dutyPending, setDutyPending] = useState(false);
  const [dutyNotes, setDutyNotes] = useState("");
  const [additionalCharges, setAdditionalCharges] = useState<AdditionalChargeRow[]>([]);
  const [mixBatchAllocations, setMixBatchAllocations] = useState<{ id: string; mixBatchId: string; weightKg: string }[]>([]);
  const [confirmDutyDialogOpen, setConfirmDutyDialogOpen] = useState(false);
  const [confirmDutyContainerId, setConfirmDutyContainerId] = useState<number | null>(null);
  const [confirmDutyAmount, setConfirmDutyAmount] = useState("");
  const [confirmDutyNotes, setConfirmDutyNotes] = useState("");
  const [confirmDutyDate, setConfirmDutyDate] = useState(new Date().toLocaleDateString("en-CA"));
  const [obDialogOpen, setObDialogOpen] = useState(false);
  const [obSupplierName, setObSupplierName] = useState("");
  const [obSupplierId, setObSupplierId] = useState<number | null>(null);
  const [obSupplierOpen, setObSupplierOpen] = useState(false);
  const [obSupplierSearch, setObSupplierSearch] = useState("");
  const [obReceivedKg, setObReceivedKg] = useState("");
  const [obCostPerKg, setObCostPerKg] = useState("");
  const [obCurrency, setObCurrency] = useState("USD");
  const [obFxRate, setObFxRate] = useState("1");
  const [obNotes, setObNotes] = useState("");
  const [obCommissionAmount, setObCommissionAmount] = useState("");
  const [obCommissionCurrency, setObCommissionCurrency] = useState("USD");
  const [obCommissionFxRate, setObCommissionFxRate] = useState("1");
  const [obTxDate, setObTxDate] = useState(new Date().toLocaleDateString("en-CA"));
  // Assign OB stock to bales
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assigningRawStock, setAssigningRawStock] = useState<{ rawStockId: number; supplierName: string; availableKg: number; costPerKg: string } | null>(null);
  const [selectedBaleIds, setSelectedBaleIds] = useState<Set<number>>(new Set());
  // OB delete
  const [deleteObDialogOpen, setDeleteObDialogOpen] = useState(false);
  const [deletingObRecord, setDeletingObRecord] = useState<{ rawStockId: number; supplierName: string; containerNumber: string } | null>(null);
  // Raw stock adjustment dialog
  const [adjustDialogOpen, setAdjustDialogOpen] = useState(false);
  const [adjustingRow, setAdjustingRow] = useState<{ supplierId: number | null; supplierName: string } | null>(null);
  const [adjType, setAdjType] = useState<"ADD" | "REMOVE" | "COST">("ADD");
  const [adjKg, setAdjKg] = useState("");
  const [adjCostPerKg, setAdjCostPerKg] = useState("");
  const [adjCurrency, setAdjCurrency] = useState("USD");
  const [adjNotes, setAdjNotes] = useState("");
  const [adjDate, setAdjDate] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [adjMaterialLabel, setAdjMaterialLabel] = useState("");
  const [adjIsNewMaterial, setAdjIsNewMaterial] = useState(false);
  const [adjSupplierId, setAdjSupplierId] = useState<string>("");
  // Deduct from received dialog
  const [historySupplier, setHistorySupplier] = useState<{ id: number; name: string } | null>(null);
  const [deductDialogOpen, setDeductDialogOpen] = useState(false);
  const [deductingRow, setDeductingRow] = useState<{ supplierId: number; supplierName: string; receivedKg: string; freeKg: string; costPerKgUsd: string; currencyCode: string } | null>(null);
  const [inlineCostEditId, setInlineCostEditId] = useState<number | null>(null);
  const [inlineCostEditValue, setInlineCostEditValue] = useState("");
  const inlineCostValueRef = useRef("");   // always-current value for blur/keydown
  const inlineCostFiredRef = useRef(false); // prevent double-fire on Enter→blur
  const [deductKg, setDeductKg] = useState("");
  const [deductNotes, setDeductNotes] = useState("");
  // Add-to-batch quick dialog state
  const [addToBatchOpen, setAddToBatchOpen] = useState(false);
  const [addToBatchSource, setAddToBatchSource] = useState<{ supplierId: number; supplierName: string; costPerKg: string; remainingKg: string } | null>(null);
  const [addToBatchTargetId, setAddToBatchTargetId] = useState("");
  const [addToBatchKg, setAddToBatchKg] = useState("");
  const [addToBatchCost, setAddToBatchCost] = useState("");

  // Mix batch section state
  const [createMixBatchOpen, setCreateMixBatchOpen] = useState(false);
  const [dailyReportOpen, setDailyReportOpen] = useState(false);
  const [deleteBatchId, setDeleteBatchId] = useState<number | null>(null);
  const [editBatch, setEditBatch] = useState<FactoryMixBatch | null>(null);
  const [batchDetailOpen, setBatchDetailOpen] = useState(false);
  const [selectedBatchDetail, setSelectedBatchDetail] = useState<MixBatchRow | null>(null);
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);

  const { data: rawStock, isLoading } = useQuery<RawStockRow[]>({
    queryKey: ["/api/factory/raw-stock"],
  });

  const { data: availableContainers } = useQuery<ContainerOption[]>({
    queryKey: ["/api/factory/raw-stock/available-containers"],
    enabled: offloadDialogOpen,
  });

  const { data: ledgerAccounts } = useQuery<{ id: number; name: string; code: string }[]>({
    queryKey: ["/api/ledger-accounts"],
    enabled: offloadDialogOpen || obDialogOpen,
  });

  const { data: factorySuppliers = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/factory/suppliers"],
    enabled: offloadDialogOpen || obDialogOpen || adjustDialogOpen,
  });

  // Raw stock by individual container (always fetched so it's available when "Assign to Bales" is clicked)
  const { data: rawStockByContainer } = useQuery<{ id: number; containerId: number; receivedKg: string; usedKg: string; costPerKg: string; supplierName: string; containerStatus: string; containerNumber: string }[]>({
    queryKey: ["/api/factory/raw-stock/by-container"],
  });

  // Unlinked bales (no mix batch assigned)
  const { data: unlinkedBales } = useQuery<{ id: number; baleCode: string; referenceNumber: string; productName: string | null; weightKg: string; status: string; pressedAt: string | null }[]>({
    queryKey: ["/api/factory/bales/unlinked"],
    enabled: assignDialogOpen,
  });

  const { data: mixBatches, isLoading: mixBatchesLoading } = useQuery<MixBatchRow[]>({
    queryKey: ["/api/factory/mix-batches"],
  });

  const { data: batchDetailSources, isLoading: batchDetailSourcesLoading } = useQuery<any[]>({
    queryKey: ["/api/factory/mix-batches", selectedBatchDetail?.id, "sources"],
    queryFn: async () => {
      const res = await fetch(`/api/factory/mix-batches/${selectedBatchDetail!.id}/sources`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch sources");
      return res.json();
    },
    enabled: !!selectedBatchDetail && batchDetailOpen,
  });

  const { data: dailyReport, isLoading: dailyReportLoading } = useQuery<any>({
    queryKey: ["/api/factory/daily-report"],
    queryFn: async () => {
      const res = await fetch(`/api/factory/daily-report`, { credentials: "include" });
      return res.json();
    },
    enabled: dailyReportOpen,
  });

  const { data: materialHistory = [], isLoading: materialHistoryLoading } = useQuery<any[]>({
    queryKey: ["/api/factory/raw-stock/history", historySupplier?.id],
    queryFn: async () => {
      const res = await fetch(`/api/factory/raw-stock/history/${historySupplier!.id}`, { credentials: "include" });
      return res.json();
    },
    enabled: !!historySupplier,
  });

  const deleteBatchMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await modeApiRequest("DELETE", `/api/factory/mix-batches/${id}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to delete batch");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/mix-batches"] });
      setDeleteBatchId(null);
      toast({ title: "Batch deleted", description: "Mix batch deleted. Bales have been unlinked." });
    },
    onError: (err: any) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const assignMutation = useMutation({
    mutationFn: async ({ rawStockId, baleIds }: { rawStockId: number; baleIds: number[] }) => {
      const res = await modeApiRequest("POST", `/api/factory/raw-stock/${rawStockId}/assign-to-bales`, { baleIds });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Assignment failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock/by-container"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bales/unlinked"] });
      setAssignDialogOpen(false);
      setAssigningRawStock(null);
      setSelectedBaleIds(new Set());
      toast({ title: "Success", description: `Assigned ${data.balesUpdated} bale(s) (${data.totalKg.toFixed(3)} kg) to OB stock` });
    },
    onError: (err: any) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteObMutation = useMutation({
    mutationFn: async (rawStockId: number) => {
      const res = await modeApiRequest("DELETE", `/api/factory/raw-stock/opening-balance/${rawStockId}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Delete failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock/by-container"] });
      setDeleteObDialogOpen(false);
      setDeletingObRecord(null);
      toast({ title: "Deleted", description: "Opening balance removed. Bales remain intact." });
    },
    onError: (err: any) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setDeleteObDialogOpen(false);
    },
  });

  const createAdjustmentMutation = useMutation({
    mutationFn: async (payload: {
      type: "ADD" | "REMOVE";
      kg: string;
      costPerKg: string;
      currencyCode: string;
      supplierId?: number | null;
      materialLabel?: string;
      notes?: string;
      date: string;
      createVoucher?: boolean;
    }) => {
      const res = await modeApiRequest("POST", "/api/factory/raw-stock/adjustment", payload);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to save adjustment");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock/adjustments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers/with-balances"] });
      setAdjustDialogOpen(false);
      setAdjKg("");
      setAdjCostPerKg("");
      setAdjNotes("");
      setAdjMaterialLabel("");
      setAdjSupplierId("");
      toast({ title: "Saved", description: "Stock adjustment recorded successfully." });
    },
    onError: (err: any) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deductReceivedMutation = useMutation({
    mutationFn: async (payload: { supplierId: number; kg: string; notes?: string; costPerKg?: string; currencyCode?: string }) => {
      const res = await modeApiRequest("POST", "/api/factory/raw-stock/deduct-received", payload);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to deduct");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock/by-container"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers/with-balances"] });
      setDeductDialogOpen(false);
      setDeductKg("");
      setDeductNotes("");
      toast({ title: "Deducted", description: `${data.deducted} kg removed from received stock.` });
    },
    onError: (err: any) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateCostMutation = useMutation({
    mutationFn: async (payload: { supplierId: number; newCostPerKg: string }) => {
      const res = await modeApiRequest("POST", "/api/factory/raw-stock/update-cost", payload);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to update cost");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/mix-batches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bales"] });
      setAdjustDialogOpen(false);
      setAdjCostPerKg("");
      toast({ title: "Cost Updated", description: "Cost per kg updated and cascaded to all linked mix batches and bales." });
    },
    onError: (err: any) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const [confirmDeleteAdjId, setConfirmDeleteAdjId] = useState<number | null>(null);

  const deleteAdjustmentMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await modeApiRequest("DELETE", `/api/factory/raw-stock/adjustments/${id}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Delete failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock/adjustments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers/with-balances"] });
      setConfirmDeleteAdjId(null);
      toast({ title: "Deleted", description: "Adjustment and any linked accounting entries removed." });
    },
    onError: (err: any) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const addToBatchMutation = useMutation({
    mutationFn: async ({ batchId, supplierId, weightKg, costPerKg: cost }: { batchId: number; supplierId: number; weightKg: string; costPerKg: string }) => {
      const res = await modeApiRequest("POST", `/api/factory/mix-batches/${batchId}/top-up`, {
        supplierSources: [{ supplierId, weightKg, costPerKg: cost }],
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to add to batch");
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/mix-batches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock/by-container"] });
      setAddToBatchOpen(false);
      setAddToBatchSource(null);
      setAddToBatchTargetId("");
      setAddToBatchKg("");
      setAddToBatchCost("");
      toast({ title: "Added to batch", description: `${parseFloat(variables.weightKg).toFixed(3)} kg added to batch successfully.` });
    },
    onError: (err: any) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const selectedContainer = useMemo(() => {
    return availableContainers?.find((c) => c.id.toString() === selectedContainerId);
  }, [availableContainers, selectedContainerId]);

  const declaredKg = parseFloat(selectedContainer?.totalKg || "0");
  const actualKg = parseFloat(actualReceivedKg || "0");
  const rate = parseFloat(costPerKg || "0");
  const differenceKg = declaredKg - actualKg;
  const totalPayable = actualKg * rate;
  const declaredTotal = declaredKg * rate;
  const costDifference = differenceKg * rate;
  const hasWeightDiff = actualKg > 0 && declaredKg > 0 && actualKg !== declaredKg;

  const commRateNum = parseFloat(commissionRate || "0");
  const fxRate = parseFloat(fxRateToUsd || "1");
  const freightVal = parseFloat(freight || "0");
  const otherChargesVal = parseFloat(otherCharges || "0");
  // Duty is entered in USD
  const dutyUsd = dutyPending ? 0 : parseFloat(dutyAmount || "0");

  // Additional charges — convert to USD using each charge's own currency code
  const additionalChargesTotalUsd = additionalCharges.reduce((sum, c) => {
    const amt = parseFloat(c.amount || "0");
    const ccy = c.currencyCode || "USD";
    if (ccy === "USD") return sum + amt;
    if (ccy === currencyCode) return sum + (fxRate > 0 ? amt * fxRate : amt);
    return sum + amt; // other currencies: best estimate
  }, 0);

  // Freight: convert to USD using the freight's own currency code
  const freightFxRateVal = parseFloat(freightFxRate || "1");
  const freightUsd = freightCurrencyCode === "USD"
    ? freightVal
    : freightCurrencyCode === currencyCode
      ? freightVal * fxRate
      : freightVal * freightFxRateVal;
  // Freight in container currency for display
  const freightInContainerCcy = freightCurrencyCode === currencyCode
    ? freightVal
    : fxRate > 0 ? freightUsd / fxRate : freightVal;

  // Other charges carry their own currency (container currency when pre-filled from container).
  // Convert to USD using the OC currency code and its fx rate — same pattern as freight.
  const ocFxRateVal = parseFloat(otherChargesFxRate || "1");
  const otherChargesUsd = otherChargesCurrencyCode === "USD"
    ? otherChargesVal
    : otherChargesCurrencyCode === currencyCode
      ? otherChargesVal * fxRate
      : otherChargesVal * ocFxRateVal;
  // Other charges in container currency for display
  const otherChargesInContainerCcy = otherChargesCurrencyCode === currencyCode
    ? otherChargesVal
    : fxRate > 0 ? otherChargesUsd / fxRate : otherChargesVal;

  // Commission: when pre-filled from container the currency is containerCommissionCcy;
  // when manually entered the user types in USD (the default).
  const commCurrencyCode = commissionFromContainer ? containerCommissionCcy : "USD";
  const commTotal = commissionType === "PER_KG" ? commRateNum * actualKg : commRateNum;
  const commissionTotalUsd = commCurrencyCode === "USD"
    ? commTotal
    : commCurrencyCode === currencyCode
      ? commTotal * fxRate
      : commTotal * fxRate; // best estimate via container fx rate
  const commissionInContainerCcy = commCurrencyCode === currencyCode
    ? commTotal
    : fxRate > 0 ? commissionTotalUsd / fxRate : commTotal;

  // Base material in USD
  const rateUsd = currencyCode === "USD" ? rate : rate * fxRate;
  const totalPayableUsd = actualKg * rateUsd;

  // Grand total in USD
  const grandTotalUsd = totalPayableUsd + freightUsd + otherChargesUsd + commissionTotalUsd + additionalChargesTotalUsd + dutyUsd;

  // Container-currency totals for display
  const additionalChargesInContainerCcy = fxRate > 0 ? additionalChargesTotalUsd / fxRate : additionalChargesTotalUsd;
  const dutyInContainerCcy = fxRate > 0 ? dutyUsd / fxRate : dutyUsd;
  const totalCharges = freightInContainerCcy + otherChargesInContainerCcy + additionalChargesInContainerCcy + commissionInContainerCcy + dutyInContainerCcy;
  const grandTotal = totalPayable + totalCharges;
  const inclusiveCostPerKg = actualKg > 0 ? grandTotal / actualKg : 0;

  const offloadMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await modeApiRequest("POST", "/api/factory/raw-stock/offload", data);
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Failed to offload container");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock/available-containers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/containers"] });
      toast({ title: "Success", description: "Container offloaded to production raw stock" });
      handleCloseDialog();
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleContainerSelect = (id: string) => {
    setSelectedContainerId(id);
    const container = availableContainers?.find((c) => c.id.toString() === id);
    if (!container) {
      setFreightFromContainer(false);
      setOtherChargesFromContainer(false);
      setCommissionFromContainer(false);
      setContainerCommissionCcy("USD");
    }
    setActualReceivedKg(container?.totalKg || "");
    setCostPerKg(container?.ratePerKg || "");
    const ccy = container?.currencyCode || "USD";
    setCurrencyCode(ccy);
    setFxRateToUsd(container?.fxRateToUsd || "1");

    // Pre-fill freight from container (amount + account — not editable during offload)
    const freightVal = parseFloat(container?.freight || "0");
    setFreight(freightVal > 0 ? String(freightVal) : "");
    setFreightFromContainer(freightVal > 0);
    // Use the stored freight currency, falling back to the container's own currency (not USD).
    // Only a container that explicitly has a freight supplier uses a cross-currency rate.
    const storedFreightCcy = container?.freightCurrencyCode;
    const effectiveFreightCcy = storedFreightCcy || ccy;
    setFreightCurrencyCode(effectiveFreightCcy);
    setFreightFxRate("1");
    if (container?.freightSupplierId) {
      setFreightAccountId(`SUP:${container.freightSupplierId}`);
    } else if (container?.freightAccountId) {
      setFreightAccountId(String(container.freightAccountId));
    } else {
      setFreightAccountId("");
    }

    // Pre-fill other charges from container (read-only — shown in summary in native currency)
    const ocVal = parseFloat(container?.otherCharges || "0");
    setOtherCharges(ocVal > 0 ? String(ocVal) : "");
    setOtherChargesFromContainer(ocVal > 0);
    setOtherChargesCurrencyCode(ccy);
    setOtherChargesFxRate("1");
    if (container?.otherChargesSupplierId) {
      setOtherChargesAccountId(`SUP:${container.otherChargesSupplierId}`);
    } else if (container?.otherChargesAccountId) {
      setOtherChargesAccountId(String(container.otherChargesAccountId));
    } else {
      setOtherChargesAccountId("");
    }

    // Pre-populate commission from the container's pre-registered data (read-only)
    const commAmt = parseFloat(container?.commissionAmount || "0");
    if (commAmt > 0) {
      setCommissionType("FIXED");
      setCommissionRate(String(commAmt));
      setCommissionFromContainer(true);
      const commCcy = container?.commissionCurrencyCode || ccy;
      setContainerCommissionCcy(commCcy);
      const commSupplierId = container?.commissionSupplierId;
      const broker = commSupplierId ? factorySuppliers?.find((s: any) => s.id === commSupplierId) : null;
      setCommissionPersonName(broker?.name || "Commission");
    } else {
      setCommissionFromContainer(false);
      setContainerCommissionCcy("USD");
      setCommissionPersonName("");
      setCommissionRate("");
      setCommissionType("PER_KG");
    }
  };

  const handleOffload = () => {
    if (!selectedContainerId) {
      toast({ title: "Missing fields", description: "Please select a container", variant: "destructive" });
      return;
    }
    if (!actualReceivedKg || parseFloat(actualReceivedKg) <= 0) {
      toast({ title: "Missing weight", description: "Please enter the actual received weight", variant: "destructive" });
      return;
    }
    if (!costPerKg || parseFloat(costPerKg) <= 0) {
      toast({ title: "Missing cost", description: "Please enter the cost per kg", variant: "destructive" });
      return;
    }

    const dutyStatus = dutyPending ? "PENDING" : (parseFloat(dutyAmount || "0") > 0 ? "CONFIRMED" : "NONE");

    const payload: any = {
      containerId: selectedContainerId,
      offloadDate,
      receivedKg: actualReceivedKg,
      costPerKg,
      currencyCode,
      fxRateToUsd,
      freight: freight || "0",
      ...((() => { const p = parseAccountValue(freightAccountId); return p?.type === "supplier" ? { freightSupplierId: p.id, freightCurrencyCode, freightFxRate } : { freightAccountId: p?.id ?? null }; })()),
      ...((() => {
        const p = parseAccountValue(otherChargesAccountId);
        if (p?.type === "supplier") {
          // Send the actual amount with its real currency metadata — backend handles conversion
          return { otherChargesSupplierId: p.id, otherCharges: otherCharges || "0", otherChargesCurrencyCode, otherChargesFxRate };
        } else {
          // Send the actual amount with its real currency metadata — backend handles conversion
          return { otherChargesAccountId: p?.id ?? null, otherCharges: otherCharges || "0", otherChargesCurrencyCode, otherChargesFxRate };
        }
      })()),
      // Duty entered in USD → convert to container currency for backend (raw USD for pending)
      dutyAmount: (() => {
        const rawAmt = parseFloat(dutyAmount || "0");
        if (rawAmt === 0) return "0";
        if (currencyCode === "USD") return dutyAmount || "0";
        return String(rawAmt / (fxRate || 1));
      })(),
      dutyAccountId: dutyAccountId ? parseInt(dutyAccountId) : null,
      dutyStatus,
      dutyNotes: dutyNotes || null,
      additionalCharges: additionalCharges.filter(c => parseFloat(c.amount || "0") > 0).map(c => {
        const p = parseAccountValue(c.ledgerAccountId);
        return {
          description: c.description || "Additional Charge",
          amount: c.amount,
          currencyCode: c.currencyCode || "USD",
          ledgerAccountId: p?.type === "ledger" ? p.id : null,
          supplierId: p?.type === "supplier" ? p.id : null,
        };
      }),
      mixBatchAllocations: mixBatchAllocations.filter(a => a.mixBatchId && parseFloat(a.weightKg || "0") > 0).map(a => ({
        mixBatchId: parseInt(a.mixBatchId),
        weightKg: a.weightKg,
      })),
    };

    if (commissionPersonName.trim() && commRateNum > 0) {
      payload.commission = {
        personName: commissionPersonName.trim(),
        commissionType,
        commissionRate: commissionRate,
        // Use the actual commission currency: container currency when pre-filled from container,
        // USD when entered manually by the user.
        currencyCode: commCurrencyCode,
        fxRateToUsd: commCurrencyCode === "USD" ? "1" : fxRateToUsd,
        ledgerAccountId: commissionLedgerAccountId || null,
      };
    }

    offloadMutation.mutate(payload);
  };

  const handleCloseDialog = () => {
    setOffloadDialogOpen(false);
    setOffloadDate(new Date().toLocaleDateString('en-CA'));
    setSelectedContainerId("");
    setActualReceivedKg("");
    setCostPerKg("");
    setCommissionPersonName("");
    setCommissionType("PER_KG");
    setCommissionRate("");
    setCommissionLedgerAccountId("");
    setCurrencyCode("USD");
    setFxRateToUsd("1");
    setFreight("");
    setFreightAccountId("");
    setFreightCurrencyCode("USD");
    setFreightFxRate("1");
    setOtherCharges("");
    setOtherChargesAccountId("");
    setOtherChargesCurrencyCode("USD");
    setOtherChargesFxRate("1");
    setDutyAmount("");
    setDutyAccountId("");
    setDutyPending(false);
    setDutyNotes("");
    setAdditionalCharges([]);
    setMixBatchAllocations([]);
  };

  const confirmDutyMutation = useMutation({
    mutationFn: async (data: { containerId: number; dutyAmount: string; dutyNotes: string; txDate?: string }) => {
      const response = await modeApiRequest("PATCH", `/api/factory/containers/${data.containerId}/confirm-duty`, {
        dutyAmount: data.dutyAmount,
        dutyNotes: data.dutyNotes,
        txDate: data.txDate,
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Failed to confirm duty");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/containers"] });
      toast({ title: "Duty Confirmed", description: "Duty has been confirmed and costs recalculated" });
      setConfirmDutyDialogOpen(false);
      setConfirmDutyContainerId(null);
      setConfirmDutyAmount("");
      setConfirmDutyNotes("");
      setConfirmDutyDate(new Date().toLocaleDateString("en-CA"));
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const obKg = parseFloat(obReceivedKg || "0");
  const obRate = parseFloat(obCostPerKg || "0");
  const obFxRateNum = parseFloat(obFxRate || "1");
  const obRateUsd = obCurrency === "USD" ? obRate : obRate * obFxRateNum;
  const obTotal = obKg * obRate;
  const obTotalUsd = obKg * obRateUsd;

  const openingBalanceMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await modeApiRequest("POST", "/api/factory/raw-stock/opening-balance", data);
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Failed to create opening balance");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/containers"] });
      toast({ title: "Success", description: "Opening balance added to production raw stock" });
      handleCloseObDialog();
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleCloseObDialog = () => {
    setObDialogOpen(false);
    setObSupplierName("");
    setObSupplierId(null);
    setObSupplierOpen(false);
    setObSupplierSearch("");
    setObReceivedKg("");
    setObCostPerKg("");
    setObCurrency("USD");
    setObFxRate("1");
    setObNotes("");
    setObCommissionAmount("");
    setObCommissionCurrency("USD");
    setObCommissionFxRate("1");
    setObTxDate(new Date().toLocaleDateString("en-CA"));
  };


  const handleSubmitOpeningBalance = () => {
    if (!obSupplierName.trim()) {
      toast({ title: "Missing fields", description: "Please enter a supplier name", variant: "destructive" });
      return;
    }
    if (!obReceivedKg || obKg <= 0) {
      toast({ title: "Missing weight", description: "Please enter the weight in KG", variant: "destructive" });
      return;
    }
    if (!obCostPerKg || obRate < 0) {
      toast({ title: "Missing cost", description: "Please enter the cost per KG", variant: "destructive" });
      return;
    }

    const commAmt = parseFloat(obCommissionAmount || "0");
    openingBalanceMutation.mutate({
      supplierName: obSupplierName.trim(),
      supplierId: obSupplierId || undefined,
      receivedKg: obReceivedKg,
      costPerKg: obCostPerKg,
      currencyCode: obCurrency,
      fxRateToUsd: obFxRate,
      notes: obNotes || undefined,
      txDate: obTxDate || undefined,
      ...(commAmt > 0 ? {
        commissionAmount: obCommissionAmount,
        commissionCurrencyCode: obCommissionCurrency,
        commissionFxRateToUsd: obCommissionFxRate,
      } : {}),
    });
  };

  const totalReceived = rawStock?.reduce((sum, r) => sum + parseFloat(r.receivedKg), 0) || 0;
  const totalUsed = rawStock?.reduce((sum, r) => sum + parseFloat(r.usedKg), 0) || 0;
  const totalRemaining = rawStock?.reduce((sum, r) => sum + parseFloat(r.remainingKg), 0) || 0;
  const totalValue = rawStock?.reduce((sum, r) => sum + parseFloat(r.valueRemainingUsd || r.valueRemaining), 0) || 0;
  const totalFree = rawStock?.reduce((sum, r) => sum + parseFloat(r.freeKg || "0"), 0) || 0;

  const filteredMixBatches = useMemo(() => mixBatches || [], [mixBatches]);

  const mixBatchKpis = useMemo(() => {
    const active = (mixBatches || []).filter((b) => b.status === "OPEN" || b.status === "ACTIVE" || b.status === "CARRY_FORWARD");
    const totalMixKg = active.reduce((s, b) => s + parseFloat(b.remainingKg), 0);
    return { activeCount: active.length, totalMixKg };
  }, [mixBatches]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-title">Raw Production</h1>
          <p className="text-muted-foreground mt-1">Raw stock inventory and daily mix batch management</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button onClick={() => setOffloadDialogOpen(true)} data-testid="button-offload-container">
            <ArrowDown className="h-4 w-4 mr-2" />
            Offload Container
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Total Received</p>
            <p className="text-xl font-bold font-mono" data-testid="text-total-received">
              {formatNumber(totalReceived)} kg
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Total Used</p>
            <p className="text-xl font-bold font-mono" data-testid="text-total-used">
              {formatNumber(totalUsed)} kg
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Remaining Stock</p>
            <p className="text-xl font-bold font-mono" data-testid="text-total-remaining">
              {formatNumber(totalRemaining)} kg
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Free Available</p>
            <p className="text-xl font-bold font-mono text-green-600 dark:text-green-400" data-testid="text-total-free">
              {formatNumber(totalFree)} kg
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Stock Value</p>
            <p className="text-xl font-bold font-mono" data-testid="text-total-value">
              ${formatNumber(totalValue)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
          <CardTitle>Raw Stock by Supplier</CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setAdjIsNewMaterial(true);
                setAdjustingRow(null);
                setAdjType("ADD");
                setAdjKg("");
                setAdjCostPerKg("");
                setAdjCurrency("USD");
                setAdjNotes("");
                setAdjMaterialLabel("");
                setAdjSupplierId("");
                setAdjDate(new Date().toLocaleDateString('en-CA'));
                setAdjustDialogOpen(true);
              }}
              data-testid="button-add-manual-material"
            >
              <PlusCircle className="h-3.5 w-3.5 mr-1.5" />
              New Manual Material
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : rawStock && rawStock.length > 0 ? (
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Received (kg)</TableHead>
                  <TableHead className="text-right">Free (kg)</TableHead>
                  <TableHead className="text-right">Avg Cost/kg ($)</TableHead>
                  <TableHead className="text-right">Value Remaining ($)</TableHead>
                  <TableHead>Last Offloaded</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rawStock.map((row, idx) => {
                  const remaining = parseFloat(row.remainingKg);
                  const isOB = row.sourceType === "OPENING_BALANCE";
                  const currency = row.currencyCode || "USD";
                  return (
                    <TableRow key={(row.supplierId || idx) + (isOB ? "_ob" : "_ct")} data-testid={`row-raw-stock-${row.supplierId || idx}${isOB ? "-ob" : "-ct"}`}>
                      <TableCell className="font-medium" data-testid={`text-supplier-${row.supplierId || idx}`}>
                        {row.supplierId ? (
                          <button
                            type="button"
                            className="text-left hover:underline hover:text-primary transition-colors flex items-center gap-1.5"
                            onClick={() => setHistorySupplier({ id: row.supplierId!, name: row.supplierName })}
                            data-testid={`button-history-${row.supplierId}`}
                          >
                            {row.supplierName}
                            <History className="h-3 w-3 text-muted-foreground" />
                          </button>
                        ) : (
                          row.supplierName
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={row.sourceType === "MANUAL" ? "secondary" : "outline"}
                          data-testid={`badge-source-${row.supplierId || idx}${isOB ? "-ob" : "-ct"}`}
                        >
                          {row.sourceType === "MANUAL" ? "Manual" : "Container"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatNumber(parseFloat(row.receivedKg))}
                      </TableCell>
                      <TableCell className="text-right font-mono text-green-600 dark:text-green-400 font-medium">
                        {formatNumber(parseFloat(row.freeKg || "0"))}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {row.supplierId && inlineCostEditId === row.supplierId ? (
                          <input
                            autoFocus
                            type="number"
                            step="0.0001"
                            min="0"
                            className="w-24 text-right font-mono text-sm border rounded-md px-1.5 py-0.5 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                            value={inlineCostEditValue}
                            data-testid={`input-inline-cost-${row.supplierId}`}
                            onChange={(e) => {
                              inlineCostValueRef.current = e.target.value;
                              setInlineCostEditValue(e.target.value);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                const val = inlineCostValueRef.current;
                                const v = parseFloat(val);
                                if (!isNaN(v) && v >= 0 && row.supplierId) {
                                  inlineCostFiredRef.current = true;
                                  updateCostMutation.mutate({ supplierId: row.supplierId, newCostPerKg: val });
                                }
                                setInlineCostEditId(null);
                              } else if (e.key === "Escape") {
                                inlineCostFiredRef.current = true; // skip blur mutation
                                setInlineCostEditId(null);
                              }
                            }}
                            onBlur={() => {
                              if (inlineCostFiredRef.current) {
                                inlineCostFiredRef.current = false;
                                setInlineCostEditId(null);
                                return;
                              }
                              const val = inlineCostValueRef.current;
                              const v = parseFloat(val);
                              if (!isNaN(v) && v >= 0 && row.supplierId) {
                                const current = parseFloat(row.costPerKgUsd || row.costPerKg || "0");
                                if (Math.abs(v - current) > 0.00001) {
                                  updateCostMutation.mutate({ supplierId: row.supplierId, newCostPerKg: val });
                                }
                              }
                              setInlineCostEditId(null);
                            }}
                          />
                        ) : (
                          <span
                            className={row.supplierId ? "cursor-pointer hover-elevate rounded px-1 py-0.5 group" : ""}
                            title={row.supplierId ? "Click to edit cost per kg" : undefined}
                            data-testid={`text-cost-${row.supplierId || idx}`}
                            onClick={() => {
                              if (!row.supplierId) return;
                              const initial = parseFloat(row.costPerKgUsd || row.costPerKg || "0").toFixed(4);
                              inlineCostValueRef.current = initial;
                              inlineCostFiredRef.current = false;
                              setInlineCostEditValue(initial);
                              setInlineCostEditId(row.supplierId);
                            }}
                          >
                            ${parseFloat(row.costPerKgUsd || row.costPerKg).toFixed(4)}
                            {row.supplierId && <Pencil className="inline ml-1 h-2.5 w-2.5 opacity-0 group-hover:opacity-50" />}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${formatNumber(parseFloat(row.valueRemainingUsd || row.valueRemaining))}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {formatDisplayDate(row.lastOffloaded)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 flex-wrap">
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid={`button-adjust-stock-${row.supplierId || idx}`}
                          onClick={() => {
                            setAdjIsNewMaterial(false);
                            setAdjustingRow({ supplierId: row.supplierId ?? null, supplierName: row.supplierName });
                            setAdjType("ADD");
                            setAdjKg("");
                            setAdjCostPerKg(row.costPerKgUsd || row.costPerKg || "");
                            setAdjCurrency(row.currencyCode || "USD");
                            setAdjNotes("");
                            setAdjMaterialLabel("");
                            setAdjDate(new Date().toLocaleDateString('en-CA'));
                            setAdjustDialogOpen(true);
                          }}
                        >
                          <SlidersHorizontal className="h-3 w-3 mr-1" />
                          Adjust
                        </Button>
                        {row.supplierId && (
                          <Button
                            size="sm"
                            variant="outline"
                            data-testid={`button-deduct-received-${row.supplierId}`}
                            onClick={() => {
                              setDeductingRow({
                                supplierId: row.supplierId!,
                                supplierName: row.supplierName,
                                receivedKg: row.receivedKg,
                                freeKg: row.freeKg || "0",
                                costPerKgUsd: row.costPerKgUsd || row.costPerKg || "0",
                                currencyCode: row.currencyCode || "USD",
                              });
                              setDeductKg("");
                              setDeductNotes("");
                              setDeductDialogOpen(true);
                            }}
                          >
                            <MinusCircle className="h-3 w-3 mr-1" />
                            Deduct
                          </Button>
                        )}
                        {row.supplierId && parseFloat(row.freeKg || "0") > 0.001 && (
                          <Button
                            size="sm"
                            variant="outline"
                            data-testid={`button-add-to-batch-${row.supplierId}`}
                            onClick={() => {
                              setAddToBatchSource({
                                supplierId: row.supplierId!,
                                supplierName: row.supplierName,
                                costPerKg: row.costPerKgUsd || row.costPerKg || "0",
                                remainingKg: row.freeKg || row.remainingKg || "0",
                              });
                              setAddToBatchTargetId("");
                              setAddToBatchKg("");
                              setAddToBatchCost(row.costPerKgUsd || row.costPerKg || "");
                              setAddToBatchOpen(true);
                            }}
                          >
                            <Layers className="h-3 w-3 mr-1" />
                            Add to Batch
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
            <div className="text-center py-12">
              <Container className="mx-auto h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold">No raw stock yet</h3>
              <p className="text-muted-foreground mt-2">
                Offload a container to start tracking production raw materials
              </p>
              <Button className="mt-4" onClick={() => setOffloadDialogOpen(true)}>
                <ArrowDown className="h-4 w-4 mr-2" />
                Offload First Container
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Manual Stock Adjustments History ── */}
      <AdjustmentsHistoryCard onDeleteRequest={setConfirmDeleteAdjId} />

      {/* ── Mix Batches Section ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FlaskConical className="h-5 w-5" />
                Mix Batches
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {mixBatchKpis.activeCount} open {mixBatchKpis.activeCount === 1 ? "batch" : "batches"} · {formatNumber(mixBatchKpis.totalMixKg)} kg remaining
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" size="sm" onClick={() => setDailyReportOpen(!dailyReportOpen)} data-testid="button-toggle-daily-report">
                <BarChart3 className="h-4 w-4 mr-1" />
                Report
              </Button>
              <Button size="sm" onClick={() => setCreateMixBatchOpen(true)} data-testid="button-create-mix-batch">
                <Plus className="h-4 w-4 mr-1" />
                Create Batch
              </Button>
            </div>
          </div>

          {/* All-time report panel */}
          {dailyReportOpen && (
            <div className="mt-4 border rounded-md p-4 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <span className="text-sm font-medium">Weekly Production Report</span>
                  <p className="text-xs text-muted-foreground mt-0.5">Supplier × day pivot — one section per week, with opening balance, stock-in and daily consumption</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(`/api/factory/weekly-report/export?format=excel`, "_blank")}
                    data-testid="button-export-weekly-excel"
                  >
                    <FileSpreadsheet className="h-4 w-4 mr-1" />
                    Excel
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(`/api/factory/weekly-report/export?format=pdf`, "_blank")}
                    data-testid="button-export-weekly-pdf"
                  >
                    <FileText className="h-4 w-4 mr-1" />
                    PDF
                  </Button>
                </div>
              </div>
              {dailyReportLoading ? (
                <div className="space-y-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
              ) : dailyReport?.usages?.length > 0 ? (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Batch Code</TableHead>
                        <TableHead>Batch Name</TableHead>
                        <TableHead>Operator</TableHead>
                        <TableHead className="text-right">KG Used</TableHead>
                        <TableHead className="text-right">Cost/kg</TableHead>
                        <TableHead>Notes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dailyReport.usages.map((u: any) => (
                        <TableRow key={u.id} data-testid={`row-daily-usage-${u.id}`}>
                          <TableCell className="text-sm font-mono">{u.usedDate || "—"}</TableCell>
                          <TableCell className="font-mono text-sm">{u.batchCode}</TableCell>
                          <TableCell className="text-sm">{u.batchName || "—"}</TableCell>
                          <TableCell className="text-sm">{u.operatorUser || "—"}</TableCell>
                          <TableCell className="text-right font-mono font-medium">{formatNumber(parseFloat(u.kgUsed))} kg</TableCell>
                          <TableCell className="text-right font-mono">{parseFloat(u.costPerKg).toFixed(4)}/kg</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{u.notes || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <div className="text-sm text-right text-muted-foreground">
                    Total consumed: <span className="font-mono font-medium">{formatNumber(parseFloat(dailyReport.totalKgUsed))} kg</span>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground py-4 text-center">No consumption records found.</p>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent>
          {mixBatchesLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : filteredMixBatches.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Total (kg)</TableHead>
                  <TableHead className="text-right">Remaining (kg)</TableHead>
                  <TableHead className="text-right">Blended Cost</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMixBatches.map((batch) => {
                  const total = parseFloat(batch.totalWeightKg) || 0;
                  const remaining = parseFloat(batch.remainingKg) || 0;
                  const statusColors: Record<string, string> = {
                    OPEN: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
                    ACTIVE: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
                    CARRY_FORWARD: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
                    CLOSED: "bg-muted text-muted-foreground",
                    COMPLETED: "bg-muted text-muted-foreground",
                  };
                  return (
                    <TableRow key={batch.id} data-testid={`row-mix-batch-${batch.id}`}>
                      <TableCell
                        className="font-mono font-medium text-sm cursor-pointer hover:underline text-primary"
                        onClick={() => { setSelectedBatchDetail(batch); setBatchDetailOpen(true); }}
                        data-testid={`link-mix-batch-detail-${batch.id}`}
                      >
                        {batch.batchCode}
                      </TableCell>
                      <TableCell
                        className="text-sm cursor-pointer hover:underline"
                        onClick={() => { setSelectedBatchDetail(batch); setBatchDetailOpen(true); }}
                      >
                        {batch.name || <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{batch.batchDate ? formatDisplayDate(batch.batchDate) : formatDisplayDate(batch.createdAt)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{formatNumber(total)}</TableCell>
                      <TableCell className="text-right font-mono font-medium text-sm">{formatNumber(remaining)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        ${parseFloat(batch.costPerKg || "0").toFixed(4)}/kg
                      </TableCell>
                      <TableCell>
                        <span className={`text-xs font-medium px-2 py-1 rounded-md ${statusColors[batch.status] || "bg-muted text-muted-foreground"}`}>
                          {batch.status === "CARRY_FORWARD" ? "Carry Fwd" : batch.status}
                        </span>
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                            <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setEditBatch(batch as unknown as FactoryMixBatch)}
                            data-testid={`button-edit-mix-batch-${batch.id}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setDeleteBatchId(batch.id)}
                            data-testid={`button-delete-mix-batch-${batch.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              {(() => {
                const sumTotal = filteredMixBatches.reduce((s, b) => s + (parseFloat(b.totalWeightKg) || 0), 0);
                const sumUsed = filteredMixBatches.reduce((s, b) => s + (parseFloat(b.usedKg) || 0), 0);
                const sumRemaining = filteredMixBatches.reduce((s, b) => s + (parseFloat(b.remainingKg) || 0), 0);
                const sumUsagePct = sumTotal > 0 ? Math.min(100, (sumUsed / sumTotal) * 100) : 0;
                const weightedCost = filteredMixBatches.reduce((s, b) => s + (parseFloat(b.totalWeightKg) || 0) * (parseFloat(b.costPerKg) || 0), 0);
                const blendedCost = sumTotal > 0 ? weightedCost / sumTotal : 0;
                return (
                  <tfoot className="border-t-2 border-border bg-muted/40">
                    <tr>
                      <td colSpan={3} className="px-4 py-3 text-sm font-semibold text-foreground">
                        Combined Total
                        <div className="text-xs text-muted-foreground font-normal">{filteredMixBatches.length} batch{filteredMixBatches.length !== 1 ? "es" : ""}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-sm" data-testid="text-mix-summary-total">{formatNumber(sumTotal)}</td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-sm" data-testid="text-mix-summary-used">{formatNumber(sumUsed)}</td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-sm" data-testid="text-mix-summary-remaining">{formatNumber(sumRemaining)}</td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-sm" data-testid="text-mix-summary-cost">${blendedCost.toFixed(4)}/kg</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                );
              })()}
            </Table>
          ) : (
            <div className="text-center py-10">
              <Layers className="mx-auto h-10 w-10 text-muted-foreground" />
              <h3 className="mt-3 text-base font-semibold">No mix batches</h3>
              <p className="text-muted-foreground text-sm mt-1">No mix batches yet. Create one to get started.</p>
              <Button className="mt-3" size="sm" onClick={() => setCreateMixBatchOpen(true)}>
                <Plus className="h-4 w-4 mr-1" />
                Create First Batch
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <EditMixBatchDialog
        batch={editBatch}
        open={!!editBatch}
        onOpenChange={(open) => { if (!open) setEditBatch(null); }}
      />

      <Dialog open={deleteBatchId !== null} onOpenChange={(open) => { if (!open) setDeleteBatchId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Mix Batch</DialogTitle>
            <DialogDescription>
              This will permanently delete the batch. Linked bales will be unlinked but not deleted.
            </DialogDescription>
          </DialogHeader>
          {deleteBatchId && (() => {
            const batch = filteredMixBatches.find((b) => b.id === deleteBatchId);
            return batch ? (
              <div className="space-y-1 text-sm py-1">
                <p><span className="text-muted-foreground">Batch:</span> <span className="font-medium">{batch.name || batch.batchCode}</span></p>
                <p><span className="text-muted-foreground">Status:</span> <span className="font-medium">{batch.status}</span></p>
              </div>
            ) : null;
          })()}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteBatchId(null)} data-testid="button-cancel-delete-batch">Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteBatchId && deleteBatchMutation.mutate(deleteBatchId)}
              disabled={deleteBatchMutation.isPending}
              data-testid="button-confirm-delete-batch"
            >
              {deleteBatchMutation.isPending ? "Deleting..." : "Delete Batch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Batch Detail / Origin Summary Dialog ── */}
      <Dialog open={batchDetailOpen} onOpenChange={(open) => { setBatchDetailOpen(open); if (!open) setSelectedBatchDetail(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <DialogTitle>
                  {selectedBatchDetail?.batchCode}{selectedBatchDetail?.name ? ` — ${selectedBatchDetail.name}` : ""}
                </DialogTitle>
                <DialogDescription>
                  Origin breakdown — raw materials and batches that were blended into this batch
                </DialogDescription>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setBatchDetailOpen(false);
                  setAddToBatchTargetId(selectedBatchDetail?.id.toString() || "");
                  setAddToBatchKg("");
                  setAddToBatchCost("");
                  setAddToBatchSource(null);
                  setAddToBatchOpen(true);
                }}
                data-testid="button-add-to-this-batch"
              >
                <Layers className="h-3.5 w-3.5 mr-1.5" />
                Add to this batch
              </Button>
            </div>
          </DialogHeader>
          {selectedBatchDetail && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="rounded-md border p-3 space-y-0.5">
                  <p className="text-muted-foreground text-xs">Total Weight</p>
                  <p className="font-mono font-semibold">{formatNumber(parseFloat(selectedBatchDetail.totalWeightKg))} kg</p>
                </div>
                <div className="rounded-md border p-3 space-y-0.5">
                  <p className="text-muted-foreground text-xs">Blended Cost</p>
                  <p className="font-mono font-semibold">${parseFloat(selectedBatchDetail.costPerKg || "0").toFixed(4)}/kg</p>
                </div>
                <div className="rounded-md border p-3 space-y-0.5">
                  <p className="text-muted-foreground text-xs">Total Cost</p>
                  <p className="font-mono font-semibold">${formatNumber(parseFloat(selectedBatchDetail.totalCost || "0"))}</p>
                </div>
              </div>

              {batchDetailSourcesLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ) : batchDetailSources && batchDetailSources.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Origin</TableHead>
                      <TableHead>Container / Reference</TableHead>
                      <TableHead className="text-right">Weight (kg)</TableHead>
                      <TableHead className="text-right">Cost/kg</TableHead>
                      <TableHead className="text-right">Total Cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batchDetailSources.map((src: any) => {
                      const originLabel = src.supplierName || (src.sourceBatchCode ? "Batch" : "Unknown");
                      const refLabel = src.sourceBatchCode
                        ? src.sourceBatchCode
                        : src.containerNumber || "—";
                      return (
                        <TableRow key={src.id}>
                          <TableCell className="font-medium text-sm">{originLabel}</TableCell>
                          <TableCell className="font-mono text-sm text-muted-foreground">{refLabel}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{formatNumber(parseFloat(src.weightKg))}</TableCell>
                          <TableCell className="text-right font-mono text-sm">${parseFloat(src.costPerKg || "0").toFixed(4)}</TableCell>
                          <TableCell className="text-right font-mono text-sm">${formatNumber(parseFloat(src.totalCost || "0"))}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">No source data available for this batch.</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Add to Batch quick dialog ── */}
      {(() => {
        const activeBatches = mixBatches?.filter((b) => b.status === "ACTIVE" || b.status === "OPEN" || b.status === "CARRY_FORWARD") ?? [];
        const supplierOptions = rawStock?.filter((r) => r.supplierId && parseFloat(r.freeKg || "0") > 0.001) ?? [];
        const isNoSourcePreset = addToBatchSource === null;
        const [dialogSupplierId, setDialogSupplierId] = [
          addToBatchSource?.supplierId?.toString() ?? "",
          (val: string) => {
            const found = rawStock?.find((r) => r.supplierId?.toString() === val);
            if (found && found.supplierId) {
              setAddToBatchSource({
                supplierId: found.supplierId,
                supplierName: found.supplierName,
                costPerKg: found.costPerKgUsd || found.costPerKg || "0",
                remainingKg: found.freeKg || found.remainingKg || "0",
              });
              setAddToBatchCost(found.costPerKgUsd || found.costPerKg || "");
            }
          },
        ];
        const canSubmit = !!addToBatchTargetId && addToBatchTargetId !== "__none__" && !!addToBatchKg && !!addToBatchCost && !!addToBatchSource && !addToBatchMutation.isPending;
        return (
          <Dialog open={addToBatchOpen} onOpenChange={(open) => { if (!open) { setAddToBatchOpen(false); setAddToBatchSource(null); setAddToBatchTargetId(""); setAddToBatchKg(""); setAddToBatchCost(""); } }}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Add to Batch</DialogTitle>
                <DialogDescription>
                  {addToBatchSource ? `Stock from ${addToBatchSource.supplierName} — ${formatNumber(parseFloat(addToBatchSource.remainingKg))} kg free` : "Choose the source supplier and target batch."}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                {isNoSourcePreset && (
                  <div className="space-y-2">
                    <Label>Source Supplier</Label>
                    <Select value={dialogSupplierId} onValueChange={setDialogSupplierId}>
                      <SelectTrigger data-testid="select-add-to-batch-supplier">
                        <SelectValue placeholder="Select supplier..." />
                      </SelectTrigger>
                      <SelectContent>
                        {supplierOptions.map((r) => (
                          <SelectItem key={r.supplierId!} value={r.supplierId!.toString()}>
                            {r.supplierName} — {formatNumber(parseFloat(r.freeKg || "0"))} kg free
                          </SelectItem>
                        ))}
                        {supplierOptions.length === 0 && (
                          <SelectItem value="__none__" disabled>No free stock available</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-2">
                  <Label>Target Batch</Label>
                  <Select value={addToBatchTargetId} onValueChange={setAddToBatchTargetId}>
                    <SelectTrigger data-testid="select-add-to-batch-target">
                      <SelectValue placeholder="Select batch..." />
                    </SelectTrigger>
                    <SelectContent>
                      {activeBatches.map((b) => (
                        <SelectItem key={b.id} value={b.id.toString()}>
                          {b.name || b.batchCode} — {formatNumber(parseFloat(b.remainingKg))} kg @ ${parseFloat(b.costPerKg).toFixed(4)}/kg
                        </SelectItem>
                      ))}
                      {activeBatches.length === 0 && (
                        <SelectItem value="__none__" disabled>No active batches</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Weight to Add (kg)</Label>
                  <Input
                    type="number"
                    step="0.001"
                    placeholder={addToBatchSource ? `Max ${formatNumber(parseFloat(addToBatchSource.remainingKg))} kg` : "Enter kg"}
                    value={addToBatchKg}
                    onChange={(e) => setAddToBatchKg(e.target.value)}
                    data-testid="input-add-to-batch-kg"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Cost/kg (USD)</Label>
                  <Input
                    type="number"
                    step="0.0001"
                    value={addToBatchCost}
                    onChange={(e) => setAddToBatchCost(e.target.value)}
                    data-testid="input-add-to-batch-cost"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => { setAddToBatchOpen(false); setAddToBatchSource(null); setAddToBatchTargetId(""); setAddToBatchKg(""); setAddToBatchCost(""); }} data-testid="button-cancel-add-to-batch">
                    Cancel
                  </Button>
                  <Button
                    disabled={!canSubmit}
                    onClick={() => {
                      if (!addToBatchSource || !addToBatchTargetId) return;
                      addToBatchMutation.mutate({
                        batchId: parseInt(addToBatchTargetId),
                        supplierId: addToBatchSource.supplierId,
                        weightKg: addToBatchKg,
                        costPerKg: addToBatchCost,
                      });
                    }}
                    data-testid="button-confirm-add-to-batch"
                  >
                    {addToBatchMutation.isPending ? "Adding..." : "Add to Batch"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        );
      })()}

      {offloadDialogOpen && (
        <div className="fixed inset-0 z-50 bg-background flex flex-col">
          {/* Full-page header */}
          <div className="sticky top-0 z-10 border-b bg-background px-6 py-3 flex items-center justify-between shrink-0">
            <div>
              <h2 className="text-lg font-semibold">Offload Container to Production</h2>
              <p className="text-sm text-muted-foreground">Enter the actual received weight and verify cost details</p>
            </div>
            <Button variant="ghost" size="icon" onClick={handleCloseDialog} data-testid="button-close-offload-page">
              <X className="h-5 w-5" />
            </Button>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2 col-span-3">
                <Label>Container</Label>
                <Select value={selectedContainerId} onValueChange={handleContainerSelect}>
                  <SelectTrigger data-testid="select-offload-container">
                    <SelectValue placeholder="Select container to offload" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableContainers?.map((c) => (
                      <SelectItem key={c.id} value={c.id.toString()}>
                        {c.containerNumber} {c.totalKg ? `(${parseFloat(c.totalKg).toLocaleString()} kg)` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Offload Date</Label>
                <Input
                  type="date"
                  value={offloadDate}
                  onChange={(e) => setOffloadDate(e.target.value)}
                  data-testid="input-offload-date"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-muted-foreground text-xs">Container Currency</Label>
                <Select value={currencyCode} onValueChange={setCurrencyCode}>
                  <SelectTrigger data-testid="select-currency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                    <SelectItem value="AUD">AUD</SelectItem>
                    <SelectItem value="LBP">LBP</SelectItem>
                    <SelectItem value="GBP">GBP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-muted-foreground text-xs">
                  {currencyCode !== "USD" ? `FX Rate (1 ${currencyCode} = ? USD)` : "FX Rate"}
                </Label>
                <Input
                  type="number"
                  value={fxRateToUsd}
                  onChange={(e) => setFxRateToUsd(e.target.value)}
                  placeholder="1.0"
                  step="0.0001"
                  disabled={currencyCode === "USD"}
                  data-testid="input-fx-rate"
                />
              </div>
            </div>

            {selectedContainer && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label className="text-muted-foreground text-xs">Declared Weight (kg)</Label>
                    <Input
                      value={selectedContainer.totalKg ? formatNumber(parseFloat(selectedContainer.totalKg)) : "N/A"}
                      disabled
                      className="font-mono bg-muted"
                      data-testid="input-declared-kg"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-muted-foreground text-xs">Declared Rate/kg ($)</Label>
                    <Input
                      value={selectedContainer.ratePerKg ? parseFloat(selectedContainer.ratePerKg).toFixed(4) : "N/A"}
                      disabled
                      className="font-mono bg-muted"
                      data-testid="input-declared-rate"
                    />
                  </div>
                </div>

                {currencyCode !== "USD" && rate > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Base rate in USD: <span className="font-mono font-medium">${rateUsd.toFixed(4)}/kg</span>
                    {actualKg > 0 && <> · Base payable: <span className="font-mono font-medium">${formatNumber(totalPayableUsd)}</span></>}
                  </p>
                )}

                {hasWeightDiff && (
                  <div className={`flex items-center gap-2 text-sm p-2 rounded-md ${differenceKg > 0 ? "text-amber-600 bg-amber-50 dark:bg-amber-950/20" : "text-blue-600 bg-blue-50 dark:bg-blue-950/20"}`} data-testid="text-weight-difference">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>
                      Weight difference: <strong className="font-mono">{differenceKg > 0 ? "-" : "+"}{formatNumber(Math.abs(differenceKg))} kg</strong>
                      {rate > 0 && (
                        <> (cost difference: <strong className="font-mono">${formatNumber(Math.abs(costDifference))}</strong>)</>
                      )}
                    </span>
                  </div>
                )}

                <Separator />

                <div>
                  <Label className="text-sm font-semibold">Offload Charges</Label>
                  <div className="space-y-3 mt-2">
                    {/* Freight is fixed from the container import — shown read-only */}
                    {freightVal > 0 && (
                      <div className="flex items-center justify-between text-sm px-3 py-2 bg-muted/50 rounded-md">
                        <span className="text-muted-foreground">Freight (from container)</span>
                        <span className="font-mono font-medium">{freightCurrencyCode} {formatNumber(freightVal)}</span>
                      </div>
                    )}
                    {otherChargesFromContainer ? (
                      parseFloat(otherCharges || "0") > 0 && (
                        <div className="flex items-center justify-between text-sm px-3 py-2 bg-muted/50 rounded-md">
                          <span className="text-muted-foreground">Other Charges (from container)</span>
                          <span className="font-mono font-medium">{otherChargesCurrencyCode} {formatNumber(parseFloat(otherCharges))}</span>
                        </div>
                      )
                    ) : (
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-muted-foreground text-xs">Other Charges (USD)</Label>
                            <Input type="number" value={otherCharges} onChange={(e) => setOtherCharges(e.target.value)} placeholder="0.00" step="0.01" data-testid="input-other-charges" />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-muted-foreground text-xs">Other Charges Account / Broker</Label>
                            <AccountCombobox
                              value={otherChargesAccountId}
                              onValueChange={v => { setOtherChargesAccountId(v); if (!v.startsWith("SUP:")) { setOtherChargesCurrencyCode("USD"); setOtherChargesFxRate("1"); } }}
                              accounts={ledgerAccounts || []}
                              suppliers={factorySuppliers || []}
                              placeholder="Select account or broker"
                              testId="select-other-charges-account"
                            />
                          </div>
                        </div>
                        {parseAccountValue(otherChargesAccountId)?.type === "supplier" && (
                          <div className="grid grid-cols-2 gap-3 pl-2 border-l-2 border-muted">
                            <div className="space-y-1">
                              <Label className="text-muted-foreground text-xs">Balance Currency</Label>
                              <Select value={otherChargesCurrencyCode} onValueChange={v => { setOtherChargesCurrencyCode(v); setOtherChargesFxRate(v === "USD" ? "1" : ""); }}>
                                <SelectTrigger data-testid="select-oc-currency"><SelectValue /></SelectTrigger>
                                <SelectContent>{["USD","EUR","GBP","AUD","LBP"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-muted-foreground text-xs">FX Rate to USD</Label>
                              <Input type="number" value={otherChargesFxRate} onChange={(e) => setOtherChargesFxRate(e.target.value)} placeholder="1.0" step="0.0001" disabled={otherChargesCurrencyCode === "USD"} data-testid="input-oc-fx-rate" />
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <Separator />

                <div>
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <Label className="text-sm font-semibold">Additional Charges</Label>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setAdditionalCharges(prev => [...prev, { id: Date.now().toString(), description: "", amount: "", currencyCode: currencyCode || "USD", ledgerAccountId: "", supplierId: "" }])}
                      data-testid="button-add-additional-charge"
                    >
                      <Plus className="h-3 w-3 mr-1" /> Add Row
                    </Button>
                  </div>
                  {additionalCharges.length > 0 && (
                    <div className="mt-2">
                      <div className="grid grid-cols-[2fr_1fr_auto_2fr_auto] gap-x-2 gap-y-1 items-center">
                        <div className="text-xs text-muted-foreground font-medium">Description</div>
                        <div className="text-xs text-muted-foreground font-medium">Amount</div>
                        <div className="text-xs text-muted-foreground font-medium">CCY</div>
                        <div className="text-xs text-muted-foreground font-medium">Account / Broker</div>
                        <div />
                        {additionalCharges.map((charge, idx) => (
                          <>
                            <Input
                              key={`desc-${charge.id}`}
                              type="text"
                              value={charge.description}
                              onChange={(e) => setAdditionalCharges(prev => prev.map(c => c.id === charge.id ? { ...c, description: e.target.value } : c))}
                              placeholder="e.g. Port fees"
                              data-testid={`input-addl-description-${idx}`}
                            />
                            <Input
                              key={`amt-${charge.id}`}
                              type="number"
                              value={charge.amount}
                              onChange={(e) => setAdditionalCharges(prev => prev.map(c => c.id === charge.id ? { ...c, amount: e.target.value } : c))}
                              placeholder="0.00"
                              step="0.01"
                              data-testid={`input-addl-amount-${idx}`}
                            />
                            <Select
                              key={`ccy-${charge.id}`}
                              value={charge.currencyCode || "USD"}
                              onValueChange={(v) => setAdditionalCharges(prev => prev.map(c => c.id === charge.id ? { ...c, currencyCode: v } : c))}
                            >
                              <SelectTrigger className="w-20" data-testid={`select-addl-currency-${idx}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="USD">USD</SelectItem>
                                <SelectItem value="EUR">EUR</SelectItem>
                                <SelectItem value="AUD">AUD</SelectItem>
                                <SelectItem value="LBP">LBP</SelectItem>
                                <SelectItem value="GBP">GBP</SelectItem>
                              </SelectContent>
                            </Select>
                            <AccountCombobox
                              key={`acc-${charge.id}`}
                              value={charge.ledgerAccountId}
                              onValueChange={(v) => setAdditionalCharges(prev => prev.map(c => c.id === charge.id ? { ...c, ledgerAccountId: v } : c))}
                              accounts={ledgerAccounts || []}
                              suppliers={factorySuppliers || []}
                              placeholder="Select account or broker"
                              testId={`select-addl-account-${idx}`}
                            />
                            <Button
                              key={`del-${charge.id}`}
                              variant="ghost"
                              size="icon"
                              onClick={() => setAdditionalCharges(prev => prev.filter(c => c.id !== charge.id))}
                              data-testid={`button-remove-addl-${idx}`}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <Separator />

                <div>
                  <Label className="text-sm font-semibold">Commission {commissionFromContainer ? "(from container)" : "(optional)"}</Label>
                  <div className="space-y-3 mt-2">
                    {commissionFromContainer ? (
                      commRateNum > 0 && (
                        <div className="flex items-center justify-between text-sm px-3 py-2 bg-muted/50 rounded-md">
                          <span className="text-muted-foreground">
                            {commissionPersonName || "Commission"} — fixed from import
                          </span>
                          <span className="font-mono font-medium">{containerCommissionCcy} {formatNumber(commRateNum)}</span>
                        </div>
                      )
                    ) : (
                      <>
                        <div className="space-y-1">
                          <Label className="text-muted-foreground text-xs">Commission Person</Label>
                          <Input
                            value={commissionPersonName}
                            onChange={(e) => setCommissionPersonName(e.target.value)}
                            placeholder="Person name"
                            data-testid="input-commission-person"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-muted-foreground text-xs">Commission Type</Label>
                            <Select value={commissionType} onValueChange={(v) => setCommissionType(v as "PER_KG" | "FIXED")}>
                              <SelectTrigger data-testid="select-commission-type">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="PER_KG">Per KG</SelectItem>
                                <SelectItem value="FIXED">Fixed Amount</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-muted-foreground text-xs">
                              {commissionType === "PER_KG" ? "Rate per KG (USD)" : "Fixed Amount (USD)"}
                            </Label>
                            <Input
                              type="number"
                              value={commissionRate}
                              onChange={(e) => setCommissionRate(e.target.value)}
                              placeholder={commissionType === "PER_KG" ? "e.g. 0.05" : "e.g. 500"}
                              step="0.01"
                              data-testid="input-commission-rate"
                            />
                          </div>
                        </div>
                        {commissionPersonName && commRateNum > 0 && (
                          <>
                            <div className="text-sm text-muted-foreground">
                              Commission Total: <span className="font-mono font-medium text-foreground">$ {formatNumber(commissionTotalUsd)}</span>
                              {currencyCode !== "USD" && (
                                <span className="ml-2 text-xs">≈ {currencyCode} {formatNumber(commissionInContainerCcy)}</span>
                              )}
                            </div>
                            <div className="space-y-1">
                              <Label className="text-muted-foreground text-xs">Commission Account</Label>
                              <AccountCombobox
                                value={commissionLedgerAccountId}
                                onValueChange={setCommissionLedgerAccountId}
                                accounts={ledgerAccounts || []}
                                placeholder="Select account"
                                testId="select-commission-account"
                              />
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>

                <Separator />

                <div>
                  <Label className="text-sm font-semibold">Duty</Label>
                  <div className="space-y-3 mt-2">
                    <div className="grid grid-cols-2 gap-4 items-end">
                      <div className="space-y-1">
                        <Label className="text-muted-foreground text-xs">Duty Amount ($)</Label>
                        <Input
                          type="number"
                          value={dutyAmount}
                          onChange={(e) => setDutyAmount(e.target.value)}
                          placeholder="0.00"
                          step="0.01"
                          data-testid="input-duty-amount"
                        />
                      </div>
                      <div className="flex items-center gap-2 pb-1">
                        <Switch
                          checked={dutyPending}
                          onCheckedChange={setDutyPending}
                          data-testid="switch-duty-pending"
                        />
                        <Label className="text-xs text-muted-foreground">Pending (confirm later)</Label>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-muted-foreground text-xs">Duty Account</Label>
                      <AccountCombobox
                        value={dutyAccountId}
                        onValueChange={setDutyAccountId}
                        accounts={ledgerAccounts || []}
                        placeholder="Select account"
                        testId="select-duty-account"
                      />
                    </div>
                    {dutyPending && (
                      <div className="space-y-1">
                        <Label className="text-muted-foreground text-xs">Duty Notes</Label>
                        <Textarea
                          value={dutyNotes}
                          onChange={(e) => setDutyNotes(e.target.value)}
                          placeholder="Notes about pending duty..."
                          className="text-sm"
                          data-testid="input-duty-notes"
                        />
                        <p className="text-xs text-amber-600">Duty will not be included in cost until confirmed</p>
                      </div>
                    )}
                  </div>
                </div>

                <Separator />

                <div className="rounded-md border p-3 space-y-1.5 text-sm" data-testid="section-offload-summary">
                  <p className="font-semibold text-base mb-2">Offload Summary</p>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Declared</span>
                    <span className="font-mono">{formatNumber(declaredKg)} kg</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Actual</span>
                    <span className={`font-mono font-medium ${hasWeightDiff ? "text-amber-600" : ""}`}>
                      {formatNumber(actualKg)} kg
                    </span>
                  </div>
                  {hasWeightDiff && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Difference</span>
                      <span className="font-mono text-amber-600">
                        {differenceKg > 0 ? "-" : "+"}{formatNumber(Math.abs(differenceKg))} kg
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Base Rate</span>
                    <span className="font-mono">{currencyCode === "USD" ? "$" : currencyCode + " "}{rate.toFixed(4)}/kg</span>
                  </div>
                  <Separator className="my-1" />
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      Base Payable ({actualKg} kg × {currencyCode !== "USD" ? `${currencyCode} ` : "$"}{rate.toFixed(4)}{currencyCode !== "USD" && fxRate !== 1 ? ` @ ${fxRate}` : ""})
                    </span>
                    <span className="font-mono">$ {formatNumber(totalPayableUsd)}</span>
                  </div>
                  {freightVal > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Freight (from container)</span>
                      <span className="font-mono">{freightCurrencyCode} {formatNumber(freightVal)}</span>
                    </div>
                  )}
                  {otherChargesVal > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Other Charges {otherChargesFromContainer ? "(from container)" : ""}</span>
                      <span className="font-mono">
                        {otherChargesFromContainer
                          ? `${otherChargesCurrencyCode} ${formatNumber(otherChargesVal)}`
                          : `$ ${formatNumber(otherChargesUsd)}`}
                      </span>
                    </div>
                  )}
                  {additionalCharges.filter(c => parseFloat(c.amount || "0") > 0).map((c, i) => (
                    <div key={c.id} className="flex justify-between text-muted-foreground">
                      <span>Additional #{i + 1}</span>
                      <span className="font-mono">{c.currencyCode || "USD"} {formatNumber(parseFloat(c.amount))}</span>
                    </div>
                  ))}
                  {commissionPersonName && commRateNum > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Commission ({commissionPersonName})</span>
                      <span className="font-mono">
                        {commissionFromContainer
                          ? `${containerCommissionCcy} ${formatNumber(commRateNum)}`
                          : `$ ${formatNumber(commissionTotalUsd)}`}
                      </span>
                    </div>
                  )}
                  {dutyUsd > 0 && !dutyPending && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Duty</span>
                      <span className="font-mono">$ {formatNumber(dutyUsd)}</span>
                    </div>
                  )}
                  {dutyPending && parseFloat(dutyAmount || "0") > 0 && (
                    <div className="flex justify-between text-amber-600">
                      <span>Duty (Pending)</span>
                      <span className="font-mono">$ {formatNumber(parseFloat(dutyAmount))}</span>
                    </div>
                  )}
                  <Separator className="my-1" />
                  <div className="flex justify-between font-medium">
                    <span>Grand Total (USD)</span>
                    <span className="font-mono text-base">$ {formatNumber(grandTotalUsd)}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Inclusive Cost/KG (USD)</span>
                    <span className="font-mono">$ {(grandTotalUsd / (actualKg || 1)).toFixed(4)}/kg</span>
                  </div>
                </div>

                <Separator />

                <div>
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <Label className="text-sm font-semibold">Mix Batch Allocations (optional)</Label>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setMixBatchAllocations(prev => [...prev, { id: Date.now().toString(), mixBatchId: "", weightKg: "" }])}
                      data-testid="button-add-mix-batch-allocation"
                    >
                      <Plus className="h-3 w-3 mr-1" /> Add Batch
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Record which open mix batches this container's material was allocated to.</p>
                  {mixBatchAllocations.length > 0 && (
                    <div className="space-y-2 mt-2">
                      {(() => {
                        const openBatches = (mixBatches || []).filter(b => b.status === "OPEN" || b.status === "ACTIVE" || b.status === "CARRY_FORWARD");
                        const totalAllocated = mixBatchAllocations.reduce((sum, a) => sum + parseFloat(a.weightKg || "0"), 0);
                        return (
                          <>
                            {mixBatchAllocations.map((alloc, idx) => (
                              <div key={alloc.id} className="grid grid-cols-[1fr_120px_auto] gap-2 items-end">
                                <div className="space-y-1">
                                  <Label className="text-muted-foreground text-xs">Mix Batch</Label>
                                  <Select value={alloc.mixBatchId} onValueChange={(v) => setMixBatchAllocations(prev => prev.map(a => a.id === alloc.id ? { ...a, mixBatchId: v } : a))}>
                                    <SelectTrigger data-testid={`select-mix-batch-alloc-${idx}`}>
                                      <SelectValue placeholder="Select batch" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {openBatches.map(b => (
                                        <SelectItem key={b.id} value={b.id.toString()}>
                                          {b.batchCode}{b.name ? ` — ${b.name}` : ""}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-muted-foreground text-xs">KG</Label>
                                  <Input
                                    type="number"
                                    value={alloc.weightKg}
                                    onChange={(e) => setMixBatchAllocations(prev => prev.map(a => a.id === alloc.id ? { ...a, weightKg: e.target.value } : a))}
                                    placeholder="0.000"
                                    step="0.001"
                                    data-testid={`input-mix-batch-kg-${idx}`}
                                  />
                                </div>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => setMixBatchAllocations(prev => prev.filter(a => a.id !== alloc.id))}
                                  data-testid={`button-remove-mix-batch-${idx}`}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>
                            ))}
                            {actualKg > 0 && (
                              <div className={`text-xs mt-1 ${totalAllocated > actualKg ? "text-amber-600" : "text-muted-foreground"}`}>
                                Total allocated: <span className="font-mono font-medium">{formatNumber(totalAllocated)} kg</span>
                                {" / "}{formatNumber(actualKg)} kg received
                                {totalAllocated > actualKg && " — exceeds received weight"}
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>
              </>
            )}

            </div>
          </div>

          {/* Sticky footer with action buttons */}
          <div className="shrink-0 border-t bg-background px-6 py-4 flex justify-end gap-3">
            <Button variant="outline" onClick={handleCloseDialog} data-testid="button-cancel-offload">
              Cancel
            </Button>
            <Button
              onClick={handleOffload}
              disabled={offloadMutation.isPending || !selectedContainerId}
              data-testid="button-confirm-offload"
            >
              {offloadMutation.isPending ? "Offloading..." : "Confirm Offload"}
            </Button>
          </div>
        </div>
      )}

      <Dialog open={obDialogOpen} onOpenChange={handleCloseObDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Opening Balance</DialogTitle>
            <DialogDescription>
              Import raw stock directly by supplier without requiring a container
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            <div className="space-y-2">
              <Label>Supplier</Label>
              <Popover open={obSupplierOpen} onOpenChange={setObSupplierOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between font-normal"
                    data-testid="button-ob-supplier-select"
                  >
                    <span className={obSupplierName ? "" : "text-muted-foreground"}>
                      {obSupplierName || "Select or create supplier..."}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="p-0 z-[200]" style={{ width: "var(--radix-popover-trigger-width)" }} align="start">
                  <Command>
                    <CommandInput
                      placeholder="Search or type new name..."
                      value={obSupplierSearch}
                      onValueChange={setObSupplierSearch}
                      data-testid="input-ob-supplier-search"
                    />
                    <CommandList>
                      <CommandGroup>
                        {(() => {
                          const all = factorySuppliers ?? [];
                          const topLevel = all.filter((s: any) => !s.parentId);
                          const subsByParent: Record<number, typeof all> = {};
                          for (const s of all) {
                            if ((s as any).parentId) {
                              const pid = (s as any).parentId;
                              if (!subsByParent[pid]) subsByParent[pid] = [];
                              subsByParent[pid].push(s);
                            }
                          }
                          const search = obSupplierSearch.toLowerCase();
                          const rows: JSX.Element[] = [];
                          for (const parent of topLevel) {
                            const children = subsByParent[parent.id] || [];
                            const parentMatch = parent.name.toLowerCase().includes(search);
                            const childMatches = children.filter((c) => c.name.toLowerCase().includes(search));
                            if (!search || parentMatch || childMatches.length > 0) {
                              if (!search || parentMatch) {
                                rows.push(
                                  <CommandItem
                                    key={parent.id}
                                    value={`supplier-${parent.id}`}
                                    onSelect={() => {
                                      setObSupplierName(parent.name);
                                      setObSupplierId(parent.id);
                                      setObSupplierSearch("");
                                      setObSupplierOpen(false);
                                    }}
                                  >
                                    <Check className={`mr-2 h-4 w-4 ${obSupplierId === parent.id ? "opacity-100" : "opacity-0"}`} />
                                    {parent.name}
                                    {children.length > 0 && <span className="ml-1 text-xs text-muted-foreground">({children.length} sub)</span>}
                                  </CommandItem>
                                );
                              }
                              for (const child of (search ? childMatches : children)) {
                                rows.push(
                                  <CommandItem
                                    key={child.id}
                                    value={`supplier-${child.id}`}
                                    onSelect={() => {
                                      setObSupplierName(child.name);
                                      setObSupplierId(child.id);
                                      setObSupplierSearch("");
                                      setObSupplierOpen(false);
                                    }}
                                  >
                                    <Check className={`mr-2 h-4 w-4 ${obSupplierId === child.id ? "opacity-100" : "opacity-0"}`} />
                                    <span className="ml-4 text-muted-foreground">↳</span>
                                    <span className="ml-1">{child.name}</span>
                                    <span className="ml-1 text-xs text-muted-foreground italic">sub-account</span>
                                  </CommandItem>
                                );
                              }
                            }
                          }
                          return rows;
                        })()}
                        {obSupplierSearch.trim() &&
                          !(factorySuppliers ?? []).some(
                            (s) => s.name.toLowerCase() === obSupplierSearch.toLowerCase().trim()
                          ) && (
                            <CommandItem
                              value={`__create__${obSupplierSearch}`}
                              onSelect={() => {
                                setObSupplierName(obSupplierSearch.trim());
                                setObSupplierId(null);
                                setObSupplierSearch("");
                                setObSupplierOpen(false);
                              }}
                            >
                              <Plus className="mr-2 h-4 w-4" />
                              Create &ldquo;{obSupplierSearch.trim()}&rdquo; as new supplier
                            </CommandItem>
                          )}
                      </CommandGroup>
                      {!obSupplierSearch && (!factorySuppliers || factorySuppliers.length === 0) && (
                        <CommandEmpty>No suppliers yet. Type a name to create one.</CommandEmpty>
                      )}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {!obSupplierId && obSupplierName && (
                <p className="text-xs text-muted-foreground">New supplier will be created as top-level. To create a sub-account first, go to the Suppliers page.</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Operation Date</Label>
              <Input
                type="date"
                value={obTxDate}
                onChange={(e) => setObTxDate(e.target.value)}
                data-testid="input-ob-date"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Weight (KG)</Label>
                <Input
                  type="number"
                  value={obReceivedKg}
                  onChange={(e) => setObReceivedKg(e.target.value)}
                  placeholder="e.g. 145451"
                  step="0.001"
                  data-testid="input-ob-kg"
                />
              </div>
              <div className="space-y-2">
                <Label>Cost per KG</Label>
                <Input
                  type="number"
                  value={obCostPerKg}
                  onChange={(e) => setObCostPerKg(e.target.value)}
                  placeholder="e.g. 1.85"
                  step="0.0001"
                  data-testid="input-ob-cost"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-muted-foreground text-xs">Currency</Label>
                <Select value={obCurrency} onValueChange={(v) => { setObCurrency(v); if (v === "USD") setObFxRate("1"); }}>
                  <SelectTrigger data-testid="select-ob-currency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                    <SelectItem value="AUD">AUD</SelectItem>
                    <SelectItem value="LBP">LBP</SelectItem>
                    <SelectItem value="GBP">GBP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground text-xs">FX Rate to USD</Label>
                <Input
                  type="number"
                  value={obFxRate}
                  onChange={(e) => setObFxRate(e.target.value)}
                  placeholder="1.0"
                  step="0.0001"
                  disabled={obCurrency === "USD"}
                  data-testid="input-ob-fx-rate"
                />
              </div>
            </div>
            {obCurrency !== "USD" && obRate > 0 && (
              <div className="text-sm text-muted-foreground bg-muted/50 p-2 rounded-md">
                Rate in USD: <span className="font-mono font-medium">${obRateUsd.toFixed(4)}/kg</span>
              </div>
            )}

            <Separator />
            <div>
              <Label className="text-sm font-semibold">Commission (optional)</Label>
              <div className="space-y-3 mt-2">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label className="text-muted-foreground text-xs">Amount</Label>
                    <Input
                      type="number"
                      value={obCommissionAmount}
                      onChange={(e) => setObCommissionAmount(e.target.value)}
                      placeholder="0.00"
                      step="0.01"
                      data-testid="input-ob-commission-amount"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-muted-foreground text-xs">Currency</Label>
                    <Select value={obCommissionCurrency} onValueChange={(v) => { setObCommissionCurrency(v); if (v === "USD") setObCommissionFxRate("1"); }}>
                      <SelectTrigger data-testid="select-ob-commission-currency">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="USD">USD</SelectItem>
                        <SelectItem value="EUR">EUR</SelectItem>
                        <SelectItem value="AUD">AUD</SelectItem>
                        <SelectItem value="LBP">LBP</SelectItem>
                        <SelectItem value="GBP">GBP</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {obCommissionCurrency !== "USD" && (
                  <div className="space-y-1">
                    <Label className="text-muted-foreground text-xs">FX Rate to USD</Label>
                    <Input
                      type="number"
                      value={obCommissionFxRate}
                      onChange={(e) => setObCommissionFxRate(e.target.value)}
                      placeholder="1.0"
                      step="0.0001"
                      data-testid="input-ob-commission-fx-rate"
                    />
                  </div>
                )}
                {obSupplierName && parseFloat(obCommissionAmount || "0") > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Commission will be booked under <span className="font-medium text-foreground">{obSupplierName} Commission</span> (auto-created as a sub-account if it doesn't exist yet).
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground text-xs">Notes (optional)</Label>
              <Input
                value={obNotes}
                onChange={(e) => setObNotes(e.target.value)}
                placeholder="e.g. Opening stock as of Jan 2026"
                data-testid="input-ob-notes"
              />
            </div>

            {obKg > 0 && obRate >= 0 && (
              <>
                <Separator />
                <div className="rounded-md border p-3 space-y-1.5 text-sm" data-testid="section-ob-summary">
                  <p className="font-semibold text-base mb-2">Opening Balance Summary</p>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Weight</span>
                    <span className="font-mono">{formatNumber(obKg)} kg</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Rate</span>
                    <span className="font-mono">{obCurrency === "USD" ? "$" : obCurrency + " "}{obRate.toFixed(4)}/kg</span>
                  </div>
                  <Separator className="my-1" />
                  <div className="flex justify-between font-medium">
                    <span>Total Value</span>
                    <span className="font-mono text-base">
                      {obCurrency !== "USD" ? `${obCurrency} ${formatNumber(obTotal)}` : `$${formatNumber(obTotal)}`}
                    </span>
                  </div>
                  {obCurrency !== "USD" && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Total Value (USD)</span>
                      <span className="font-mono">${formatNumber(obTotalUsd)}</span>
                    </div>
                  )}
                </div>
              </>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={handleCloseObDialog} data-testid="button-cancel-ob">
                Cancel
              </Button>
              <Button
                onClick={handleSubmitOpeningBalance}
                disabled={openingBalanceMutation.isPending || !obSupplierName.trim()}
                data-testid="button-confirm-ob"
              >
                {openingBalanceMutation.isPending ? "Adding..." : "Add Opening Balance"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDutyDialogOpen} onOpenChange={(open) => {
        if (!open) {
          setConfirmDutyDialogOpen(false);
          setConfirmDutyContainerId(null);
          setConfirmDutyAmount("");
          setConfirmDutyNotes("");
          setConfirmDutyDate(new Date().toLocaleDateString("en-CA"));
        }
      }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Gavel className="h-5 w-5" />
              Confirm Duty
            </DialogTitle>
            <DialogDescription>
              Enter the confirmed duty amount. Bale costs will be recalculated.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Operation Date</Label>
              <Input
                type="date"
                value={confirmDutyDate}
                onChange={(e) => setConfirmDutyDate(e.target.value)}
                data-testid="input-confirm-duty-date"
              />
            </div>
            <div className="space-y-1">
              <Label>Duty Amount ($)</Label>
              <Input
                type="number"
                value={confirmDutyAmount}
                onChange={(e) => setConfirmDutyAmount(e.target.value)}
                placeholder="e.g. 1500"
                step="0.01"
                data-testid="input-confirm-duty-amount"
              />
            </div>
            <div className="space-y-1">
              <Label>Notes (optional)</Label>
              <Textarea
                value={confirmDutyNotes}
                onChange={(e) => setConfirmDutyNotes(e.target.value)}
                placeholder="Duty confirmation notes..."
                className="text-sm"
                data-testid="input-confirm-duty-notes"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmDutyDialogOpen(false)} data-testid="button-cancel-confirm-duty">
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (confirmDutyContainerId && confirmDutyAmount) {
                    confirmDutyMutation.mutate({
                      containerId: confirmDutyContainerId,
                      dutyAmount: confirmDutyAmount,
                      dutyNotes: confirmDutyNotes,
                      txDate: confirmDutyDate,
                    });
                  }
                }}
                disabled={confirmDutyMutation.isPending || !confirmDutyAmount}
                data-testid="button-submit-confirm-duty"
              >
                {confirmDutyMutation.isPending ? "Confirming..." : "Confirm Duty"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Assign OB Stock to Bales dialog */}
      <Dialog open={assignDialogOpen} onOpenChange={(open) => { setAssignDialogOpen(open); if (!open) { setAssigningRawStock(null); setSelectedBaleIds(new Set()); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Assign OB Stock to Bales</DialogTitle>
            <DialogDescription>
              Select bales to source from this opening balance raw stock record.
            </DialogDescription>
          </DialogHeader>

          {assigningRawStock && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 p-3 rounded-md bg-muted/50 text-sm">
                <div>
                  <span className="text-muted-foreground">Supplier: </span>
                  <span className="font-medium">{assigningRawStock.supplierName}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Available: </span>
                  <span className="font-mono font-medium">{formatNumber(assigningRawStock.availableKg)} kg</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Cost/kg: </span>
                  <span className="font-mono">${parseFloat(assigningRawStock.costPerKg).toFixed(4)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Unlinked bales: </span>
                  <span className="font-mono">{unlinkedBales?.length ?? "..."}</span>
                </div>
              </div>

              {(() => {
                const selectedKg = unlinkedBales
                  ?.filter((b) => selectedBaleIds.has(b.id))
                  .reduce((sum, b) => sum + parseFloat(b.weightKg), 0) ?? 0;
                const remainingAfter = assigningRawStock.availableKg - selectedKg;
                const overLimit = selectedKg > assigningRawStock.availableKg + 0.001;

                return (
                  <>
                    {unlinkedBales && unlinkedBales.length > 0 && (
                      <div className="flex items-center justify-between text-sm text-muted-foreground mb-1">
                        <span>Select all <Button variant="ghost" size="sm" className="h-6 px-1 text-xs" onClick={() => setSelectedBaleIds(new Set(unlinkedBales.map((b) => b.id)))}>All</Button> / <Button variant="ghost" size="sm" className="h-6 px-1 text-xs" onClick={() => setSelectedBaleIds(new Set())}>None</Button></span>
                        <span className={overLimit ? "text-destructive font-medium" : ""}>
                          {selectedBaleIds.size} bales / {formatNumber(selectedKg)} kg selected
                          {selectedBaleIds.size > 0 && ` — Remaining after: ${formatNumber(remainingAfter)} kg`}
                        </span>
                      </div>
                    )}

                    <div className="max-h-72 overflow-y-auto border rounded-md">
                      {!unlinkedBales ? (
                        <div className="p-4 space-y-2">
                          <Skeleton className="h-8 w-full" />
                          <Skeleton className="h-8 w-full" />
                        </div>
                      ) : unlinkedBales.length === 0 ? (
                        <div className="p-8 text-center text-muted-foreground text-sm">
                          No unlinked bales found. All pressed bales already have a raw stock source assigned.
                        </div>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-10"></TableHead>
                              <TableHead>Bale Code</TableHead>
                              <TableHead>Product</TableHead>
                              <TableHead className="text-right">Weight (kg)</TableHead>
                              <TableHead>Status</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {unlinkedBales.map((bale) => (
                              <TableRow
                                key={bale.id}
                                className="cursor-pointer"
                                onClick={() => {
                                  setSelectedBaleIds((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(bale.id)) next.delete(bale.id); else next.add(bale.id);
                                    return next;
                                  });
                                }}
                                data-testid={`row-unlinked-bale-${bale.id}`}
                              >
                                <TableCell>
                                  <input
                                    type="checkbox"
                                    checked={selectedBaleIds.has(bale.id)}
                                    readOnly
                                    className="cursor-pointer"
                                    data-testid={`checkbox-bale-${bale.id}`}
                                  />
                                </TableCell>
                                <TableCell className="font-mono text-sm">{bale.baleCode}</TableCell>
                                <TableCell className="text-sm">{bale.productName || "—"}</TableCell>
                                <TableCell className="text-right font-mono text-sm">{formatNumber(parseFloat(bale.weightKg))}</TableCell>
                                <TableCell>
                                  <Badge variant="outline" className="text-xs">{bale.status}</Badge>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </div>

                    {overLimit && (
                      <div className="flex items-center gap-2 text-destructive text-sm">
                        <AlertTriangle className="h-4 w-4" />
                        Selected bales ({formatNumber(selectedKg)} kg) exceed available stock ({formatNumber(assigningRawStock.availableKg)} kg)
                      </div>
                    )}

                    <div className="flex justify-end gap-2">
                      <Button variant="outline" onClick={() => setAssignDialogOpen(false)} data-testid="button-cancel-assign">
                        Cancel
                      </Button>
                      <Button
                        disabled={selectedBaleIds.size === 0 || overLimit || assignMutation.isPending}
                        data-testid="button-confirm-assign"
                        onClick={() => {
                          if (!assigningRawStock) return;
                          assignMutation.mutate({ rawStockId: assigningRawStock.rawStockId, baleIds: Array.from(selectedBaleIds) });
                        }}
                      >
                        {assignMutation.isPending ? "Assigning..." : `Assign ${selectedBaleIds.size} Bale${selectedBaleIds.size !== 1 ? "s" : ""}`}
                      </Button>
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Delete Manual Adjustment Confirmation ── */}
      <Dialog open={confirmDeleteAdjId !== null} onOpenChange={(open) => { if (!open) setConfirmDeleteAdjId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete Manual Adjustment?
            </DialogTitle>
            <DialogDescription>
              This will permanently remove the adjustment record.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md bg-muted p-3 text-sm space-y-1">
            <p className="font-medium">What happens:</p>
            <p>The stock adjustment entry will be deleted and stock totals will be recalculated.</p>
            <p>If a journal voucher was created (Dr Raw Material / Cr Supplier), it will be reversed and removed.</p>
            <p>Any linked daybook entries will also be removed.</p>
          </div>
          <div className="flex justify-end gap-2 flex-wrap">
            <Button variant="outline" onClick={() => setConfirmDeleteAdjId(null)} data-testid="button-delete-adj-cancel">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmDeleteAdjId !== null && deleteAdjustmentMutation.mutate(confirmDeleteAdjId)}
              disabled={deleteAdjustmentMutation.isPending}
              data-testid="button-delete-adj-confirm"
            >
              {deleteAdjustmentMutation.isPending ? "Deleting..." : "Yes, Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteObDialogOpen} onOpenChange={(open) => { setDeleteObDialogOpen(open); if (!open) setDeletingObRecord(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete Opening Balance?
            </DialogTitle>
            <DialogDescription>
              Remove opening balance{deletingObRecord?.containerNumber ? ` ${deletingObRecord.containerNumber}` : ""} for{" "}
              <span className="font-semibold">{deletingObRecord?.supplierName}</span>?
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md bg-muted p-3 text-sm space-y-1">
            <p className="font-medium">What happens:</p>
            <p>The opening balance entry will be removed from raw stock.</p>
            <p>Any bales linked through this entry will remain fully intact.</p>
            <p>Raw stock linkage will be safely detached without data loss.</p>
          </div>
          <div className="flex justify-end gap-2 flex-wrap">
            <Button variant="outline" onClick={() => setDeleteObDialogOpen(false)} data-testid="button-delete-ob-cancel">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deletingObRecord && deleteObMutation.mutate(deletingObRecord.rawStockId)}
              disabled={deleteObMutation.isPending}
              data-testid="button-delete-ob-confirm"
            >
              {deleteObMutation.isPending ? "Deleting..." : "Yes, Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Raw Stock Adjustment Dialog ── */}
      <Dialog open={adjustDialogOpen} onOpenChange={(open) => {
        setAdjustDialogOpen(open);
        if (!open) { setAdjustingRow(null); setAdjIsNewMaterial(false); }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {adjIsNewMaterial
                ? "Add New Manual Material"
                : `Adjust Stock — ${adjustingRow?.supplierName ?? ""}`}
            </DialogTitle>
            <DialogDescription>
              {adjIsNewMaterial
                ? "Add raw material stock. Choose an existing supplier to record a payable and create accounting entries, or leave blank for a standalone (no-accounting) entry."
                : "Add or remove kg from this supplier's stock total."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {adjIsNewMaterial && (
              <>
                <div className="space-y-1">
                  <Label>Supplier <span className="text-muted-foreground text-xs">(optional)</span></Label>
                  <Select value={adjSupplierId} onValueChange={setAdjSupplierId} data-testid="select-adj-supplier">
                    <SelectTrigger data-testid="select-adj-supplier-trigger">
                      <SelectValue placeholder="Select existing supplier…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">No Supplier (standalone entry)</SelectItem>
                      {factorySuppliers.map((s) => (
                        <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {adjSupplierId && adjSupplierId !== "__none__" && (
                    <p className="text-xs text-muted-foreground">A journal voucher (Dr Raw Material / Cr Supplier) will be created when cost &gt; 0.</p>
                  )}
                </div>
                {(!adjSupplierId || adjSupplierId === "__none__") && (
                  <div className="space-y-1">
                    <Label>Material Name <span className="text-muted-foreground text-xs">(required when no supplier)</span></Label>
                    <Input
                      value={adjMaterialLabel}
                      onChange={(e) => setAdjMaterialLabel(e.target.value)}
                      placeholder="e.g. Waste Regrind, Local Purchase..."
                      data-testid="input-adj-material-label"
                    />
                  </div>
                )}
              </>
            )}

            <div className="space-y-1">
              <Label>Adjustment Type</Label>
              <Select value={adjType} onValueChange={(v) => setAdjType(v as "ADD" | "REMOVE" | "COST")}>
                <SelectTrigger data-testid="select-adj-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADD">Add Stock (increase received kg)</SelectItem>
                  <SelectItem value="REMOVE">Remove Stock (increase used kg)</SelectItem>
                  {!adjIsNewMaterial && adjustingRow?.supplierId && (
                    <SelectItem value="COST">Adjust Cost Only (update $/kg everywhere)</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            {adjType === "COST" ? (
              <div className="space-y-3">
                <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                  This will update the cost per kg for all raw stock rows, mix batches, and bales linked to this supplier.
                </div>
                <div className="space-y-1">
                  <Label>New Cost / kg (USD)</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.0001"
                    value={adjCostPerKg}
                    onChange={(e) => setAdjCostPerKg(e.target.value)}
                    placeholder="0.0000"
                    data-testid="input-adj-new-cost"
                  />
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Quantity (kg)</Label>
                    <Input
                      type="number"
                      min="0.001"
                      step="0.001"
                      value={adjKg}
                      onChange={(e) => setAdjKg(e.target.value)}
                      placeholder="0.000"
                      data-testid="input-adj-kg"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Date</Label>
                    <Input
                      type="date"
                      value={adjDate}
                      onChange={(e) => setAdjDate(e.target.value)}
                      data-testid="input-adj-date"
                    />
                  </div>
                </div>

                {adjType === "ADD" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>Cost / kg (optional)</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={adjCostPerKg}
                        onChange={(e) => setAdjCostPerKg(e.target.value)}
                        placeholder="0.0000"
                        data-testid="input-adj-cost-per-kg"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Currency</Label>
                      <Select value={adjCurrency} onValueChange={setAdjCurrency}>
                        <SelectTrigger data-testid="select-adj-currency">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="USD">USD</SelectItem>
                          <SelectItem value="PKR">PKR</SelectItem>
                          <SelectItem value="EUR">EUR</SelectItem>
                          <SelectItem value="GBP">GBP</SelectItem>
                          <SelectItem value="AED">AED</SelectItem>
                          <SelectItem value="CNY">CNY</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                <div className="space-y-1">
                  <Label>Notes (optional)</Label>
                  <Textarea
                    value={adjNotes}
                    onChange={(e) => setAdjNotes(e.target.value)}
                    placeholder="Reason for adjustment..."
                    rows={2}
                    data-testid="input-adj-notes"
                  />
                </div>
              </>
            )}
          </div>

          <DialogFooter className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={() => setAdjustDialogOpen(false)} data-testid="button-adj-cancel">
              Cancel
            </Button>
            <Button
              disabled={adjType === "COST" ? updateCostMutation.isPending : createAdjustmentMutation.isPending}
              onClick={() => {
                if (adjType === "COST") {
                  if (!adjCostPerKg || parseFloat(adjCostPerKg) < 0) {
                    toast({ title: "Error", description: "Please enter a valid cost per kg.", variant: "destructive" });
                    return;
                  }
                  const supplierId = adjustingRow?.supplierId;
                  if (!supplierId) {
                    toast({ title: "Error", description: "Supplier is required for cost adjustment.", variant: "destructive" });
                    return;
                  }
                  updateCostMutation.mutate({ supplierId, newCostPerKg: adjCostPerKg });
                  return;
                }
                if (!adjKg || parseFloat(adjKg) <= 0) {
                  toast({ title: "Error", description: "Please enter a valid kg amount.", variant: "destructive" });
                  return;
                }
                if (adjIsNewMaterial && (!adjSupplierId || adjSupplierId === "__none__") && !adjMaterialLabel.trim()) {
                  toast({ title: "Error", description: "Please choose a supplier or enter a material name.", variant: "destructive" });
                  return;
                }
                if (!adjDate) {
                  toast({ title: "Error", description: "Please select a date.", variant: "destructive" });
                  return;
                }
                const resolvedSupplierId = adjIsNewMaterial
                  ? (adjSupplierId && adjSupplierId !== "__none__" ? parseInt(adjSupplierId) : null)
                  : (adjustingRow?.supplierId ?? null);
                createAdjustmentMutation.mutate({
                  type: adjType as "ADD" | "REMOVE",
                  kg: adjKg,
                  costPerKg: adjCostPerKg || "0",
                  currencyCode: adjCurrency,
                  supplierId: resolvedSupplierId,
                  materialLabel: ((!adjSupplierId || adjSupplierId === "__none__") && adjIsNewMaterial) ? adjMaterialLabel.trim() : undefined,
                  notes: adjNotes || undefined,
                  date: adjDate,
                  createVoucher: adjIsNewMaterial && !!adjSupplierId && adjSupplierId !== "__none__" && adjType === "ADD" && parseFloat(adjCostPerKg || "0") > 0,
                });
              }}
              data-testid="button-adj-confirm"
            >
              {adjType === "COST"
                ? (updateCostMutation.isPending ? "Updating..." : "Update Cost")
                : (createAdjustmentMutation.isPending ? "Saving..." : "Save Adjustment")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Deduct from Received Dialog ── */}
      <Dialog open={deductDialogOpen} onOpenChange={(open) => { setDeductDialogOpen(open); if (!open) { setDeductingRow(null); setDeductKg(""); setDeductNotes(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MinusCircle className="h-4 w-4 text-destructive" />
              Deduct from Received — {deductingRow?.supplierName}
            </DialogTitle>
            <DialogDescription>
              Reduces free kg and updates the supplier balance.
              Available free: <strong>{parseFloat(deductingRow?.freeKg || "0").toLocaleString(undefined, { maximumFractionDigits: 3 })} kg</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Amount to deduct (kg)</Label>
              <Input
                type="number"
                min="0.001"
                step="0.001"
                max={parseFloat(deductingRow?.freeKg || "0")}
                placeholder="e.g. 500"
                value={deductKg}
                onChange={(e) => setDeductKg(e.target.value)}
                data-testid="input-deduct-kg"
              />
              {deductKg && parseFloat(deductKg) > parseFloat(deductingRow?.freeKg || "0") + 0.001 && (
                <p className="text-xs text-destructive">
                  Exceeds available free kg ({parseFloat(deductingRow?.freeKg || "0").toFixed(3)} kg)
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label>Notes (optional)</Label>
              <Input
                placeholder="Reason for deduction…"
                value={deductNotes}
                onChange={(e) => setDeductNotes(e.target.value)}
                data-testid="input-deduct-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeductDialogOpen(false)} data-testid="button-deduct-cancel">
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={
                deductReceivedMutation.isPending ||
                !deductKg ||
                parseFloat(deductKg) <= 0 ||
                parseFloat(deductKg) > parseFloat(deductingRow?.freeKg || "0") + 0.001
              }
              onClick={() => {
                if (!deductingRow || !deductKg || parseFloat(deductKg) <= 0) return;
                deductReceivedMutation.mutate({
                  supplierId: deductingRow.supplierId,
                  kg: deductKg,
                  notes: deductNotes || undefined,
                });
              }}
              data-testid="button-deduct-confirm"
            >
              {deductReceivedMutation.isPending ? "Deducting…" : "Confirm Deduct"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Material History Dialog ── */}
      <Dialog open={!!historySupplier} onOpenChange={(open) => { if (!open) setHistorySupplier(null); }}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-4 w-4" />
              {historySupplier?.name} — Full History
            </DialogTitle>
            <DialogDescription>
              All movements for this raw material: additions, batch usage, deductions, and container receipts.
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto flex-1 -mx-1 px-1">
            {materialHistoryLoading ? (
              <div className="space-y-2 py-4">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-12 bg-muted/40 rounded-md animate-pulse" />
                ))}
              </div>
            ) : materialHistory.length === 0 ? (
              <p className="text-center text-muted-foreground py-10 text-sm">No history found for this material.</p>
            ) : (
              <div className="space-y-1 py-2">
                {materialHistory.map((entry: any, i: number) => {
                  const isAdd = entry.type === "ADD" || entry.type === "RECEIPT";
                  const isUsed = entry.type === "USED";
                  const isRemove = entry.type === "REMOVE";
                  const dateStr = entry.date
                    ? new Date(entry.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                    : "—";
                  return (
                    <div
                      key={i}
                      className="flex items-start justify-between gap-3 px-3 py-2.5 rounded-md hover-elevate bg-muted/20"
                      data-testid={`row-history-${i}`}
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        <div className="mt-0.5 shrink-0">
                          {isAdd ? (
                            <ArrowUpCircle className="h-4 w-4 text-green-500" />
                          ) : isUsed ? (
                            <FlaskRound className="h-4 w-4 text-blue-500" />
                          ) : (
                            <ArrowDownCircle className="h-4 w-4 text-destructive" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{entry.label}</p>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs text-muted-foreground font-mono">{entry.ref}</span>
                            <span className="text-xs text-muted-foreground">{dateStr}</span>
                            {entry.batchStatus && (
                              <Badge variant="outline" className="text-xs py-0">
                                {entry.batchStatus}
                              </Badge>
                            )}
                          </div>
                          {entry.notes && (
                            <p className="text-xs text-muted-foreground mt-0.5 italic">{entry.notes}</p>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`text-sm font-mono font-semibold ${isAdd ? "text-green-600 dark:text-green-400" : "text-destructive"}`}>
                          {isAdd ? "+" : "−"}{entry.kg.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg
                        </p>
                        {entry.costPerKg > 0 && (
                          <p className="text-xs text-muted-foreground font-mono">
                            ${entry.costPerKg.toFixed(4)}/kg
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Create Mix Batch Dialog ── */}
      <CreateMixBatchDialog
        open={createMixBatchOpen}
        onOpenChange={setCreateMixBatchOpen}
        onCreated={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/factory/mix-batches"] });
          queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock"] });
        }}
      />
    </div>
  );
}
