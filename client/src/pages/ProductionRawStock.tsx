import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Container, Package, Plus, ArrowDown, AlertTriangle, CheckCircle, Upload, Gavel, X, Check, ChevronsUpDown, Link2, Pencil, Trash2, Layers, BarChart3, CalendarDays, FlaskConical, FileSpreadsheet, FileText, RefreshCw } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { CreateMixBatchDialog } from "@/components/CreateMixBatchDialog";
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

export default function ProductionRawStock() {
  const { formatDisplayDate } = useDateFormat();
  const [offloadDialogOpen, setOffloadDialogOpen] = useState(false);
  const [offloadDate, setOffloadDate] = useState<string>(new Date().toISOString().slice(0, 10));
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
  // Assign OB stock to bales
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assigningRawStock, setAssigningRawStock] = useState<{ rawStockId: number; supplierName: string; availableKg: number; costPerKg: string } | null>(null);
  const [selectedBaleIds, setSelectedBaleIds] = useState<Set<number>>(new Set());
  // OB delete
  const [deleteObDialogOpen, setDeleteObDialogOpen] = useState(false);
  const [deletingObRecord, setDeletingObRecord] = useState<{ rawStockId: number; supplierName: string; containerNumber: string } | null>(null);
  // Mix batch section state
  const [createMixBatchOpen, setCreateMixBatchOpen] = useState(false);
  const [mixBatchStatusFilter, setMixBatchStatusFilter] = useState<string>("OPEN");
  const [useTodayOpen, setUseTodayOpen] = useState(false);
  const [useTodayDate, setUseTodayDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [useTodayOperator, setUseTodayOperator] = useState("");
  const [useTodayUsages, setUseTodayUsages] = useState<{ batchId: number; batchCode: string; totalKg: number; remainingKg: number; kgUsed: string }[]>([]);
  const [dailyReportOpen, setDailyReportOpen] = useState(false);
  const [dailyReportDate, setDailyReportDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [deleteBatchId, setDeleteBatchId] = useState<number | null>(null);
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);

  const { data: rawStock, isLoading } = useQuery<RawStockRow[]>({
    queryKey: ["/api/factory/raw-stock"],
  });

  const recalculateMutation = useMutation({
    mutationFn: () => modeApiRequest("POST", "/api/factory/raw-stock/recalculate-used").then(r => r.json()),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock"] });
      toast({ title: "Used kg recalculated", description: data.message });
    },
    onError: (err: any) => { if (err?._handledGlobally) return; toast({ title: "Recalculate failed", description: err.message, variant: "destructive" }); },
  });

  const { data: availableContainers } = useQuery<ContainerOption[]>({
    queryKey: ["/api/factory/raw-stock/available-containers"],
    enabled: offloadDialogOpen,
  });

  const { data: ledgerAccounts } = useQuery<{ id: number; name: string; code: string }[]>({
    queryKey: ["/api/ledger-accounts"],
    enabled: offloadDialogOpen || obDialogOpen,
  });

  const { data: factorySuppliers } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/factory/suppliers"],
    enabled: offloadDialogOpen || obDialogOpen,
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

  const { data: dailyReport, isLoading: dailyReportLoading } = useQuery<any>({
    queryKey: ["/api/factory/daily-report", dailyReportDate],
    queryFn: async () => {
      const res = await fetch(`/api/factory/daily-report?date=${dailyReportDate}`, { credentials: "include" });
      return res.json();
    },
    enabled: dailyReportOpen,
  });

  const consumeMutation = useMutation({
    mutationFn: async (payload: { usages: { batchId: number; kgUsed: number }[]; operatorUser?: string; usedDate: string }) => {
      const res = await modeApiRequest("POST", "/api/factory/mix-batches/consume", payload);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Consumption failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/mix-batches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/daily-report"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock"] });
      setUseTodayOpen(false);
      setUseTodayUsages([]);
      toast({ title: "Consumption recorded", description: "Daily usage logged. Carry-forward batches created where needed." });
    },
    onError: (err: any) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
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

  // Commission is entered and displayed in USD
  const commRateNum = parseFloat(commissionRate || "0");
  const commissionTotalUsd = commissionType === "PER_KG"
    ? commRateNum * actualKg
    : commRateNum;

  const fxRate = parseFloat(fxRateToUsd || "1");
  const freightVal = parseFloat(freight || "0");
  const otherChargesVal = parseFloat(otherCharges || "0");
  // Duty is entered in USD
  const dutyUsd = dutyPending ? 0 : parseFloat(dutyAmount || "0");

  // Additional charges are all entered in USD
  const additionalChargesTotalUsd = additionalCharges.reduce((sum, c) => sum + parseFloat(c.amount || "0"), 0);

  // Freight: convert to USD using the freight's own currency code
  // - If freight currency is USD → use directly
  // - If freight currency matches container currency → multiply by container fxRate
  // - Otherwise → use freightFxRate for the conversion
  const freightFxRateVal = parseFloat(freightFxRate || "1");
  const freightUsd = freightCurrencyCode === "USD"
    ? freightVal
    : freightCurrencyCode === currencyCode
      ? freightVal * fxRate
      : freightVal * freightFxRateVal;

  // Freight converted to container currency (for the container-ccy subtotal display)
  const freightInContainerCcy = freightCurrencyCode === currencyCode
    ? freightVal
    : fxRate > 0 ? freightUsd / fxRate : freightVal;

  // Other charges: entered in USD directly
  const otherChargesUsd = otherChargesVal;

  // Base material in USD
  const rateUsd = currencyCode === "USD" ? rate : rate * fxRate;
  const totalPayableUsd = actualKg * rateUsd;

  // Grand total in USD = base + freight_usd + other_usd + commission_usd + addl_usd + duty_usd
  const grandTotalUsd = totalPayableUsd + freightUsd + otherChargesUsd + commissionTotalUsd + additionalChargesTotalUsd + dutyUsd;

  // Also maintain a container-currency total for display (base + freight converted to container ccy; rest convert from USD)
  const commissionInContainerCcy = fxRate > 0 ? commissionTotalUsd / fxRate : commissionTotalUsd;
  const additionalChargesInContainerCcy = fxRate > 0 ? additionalChargesTotalUsd / fxRate : additionalChargesTotalUsd;
  const otherChargesInContainerCcy = fxRate > 0 ? otherChargesUsd / fxRate : otherChargesUsd;
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
          // Supplier: send raw USD amount with USD currency → backend converts to container ccy
          return { otherChargesSupplierId: p.id, otherCharges: otherCharges || "0", otherChargesCurrencyCode: "USD", otherChargesFxRate: "1" };
        } else {
          // Ledger account: convert USD input to container currency before sending
          const ocContainerCcy = currencyCode === "USD" ? (otherCharges || "0") : String(otherChargesVal / (fxRate || 1));
          return { otherChargesAccountId: p?.id ?? null, otherCharges: ocContainerCcy };
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
      // Additional charges entered in USD → send as USD so backend converts correctly
      additionalCharges: additionalCharges.filter(c => c.description.trim() && parseFloat(c.amount || "0") > 0).map(c => {
        const p = parseAccountValue(c.ledgerAccountId);
        return {
          description: c.description.trim(),
          amount: c.amount,
          currencyCode: "USD",
          fxRateToUsd: "1",
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
        currencyCode: "USD",
        fxRateToUsd: "1",
        ledgerAccountId: commissionLedgerAccountId || null,
      };
    }

    offloadMutation.mutate(payload);
  };

  const handleCloseDialog = () => {
    setOffloadDialogOpen(false);
    setOffloadDate(new Date().toISOString().slice(0, 10));
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
    mutationFn: async (data: { containerId: number; dutyAmount: string; dutyNotes: string }) => {
      const response = await modeApiRequest("PATCH", `/api/factory/containers/${data.containerId}/confirm-duty`, {
        dutyAmount: data.dutyAmount,
        dutyNotes: data.dutyNotes,
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
  };

  const recalcUsedMutation = useMutation({
    mutationFn: async () => {
      const response = await modeApiRequest("POST", "/api/factory/raw-stock/recalculate-used", {});
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Failed to recalculate");
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock"] });
      toast({ title: "Recalculated", description: data.message || "Remaining balances updated" });
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

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
  const totalReserved = rawStock?.reduce((sum, r) => sum + parseFloat(r.reservedKg || "0"), 0) || 0;
  const totalFree = rawStock?.reduce((sum, r) => sum + parseFloat(r.freeKg || "0"), 0) || 0;

  const filteredMixBatches = useMemo(() => {
    if (!mixBatches) return [];
    if (mixBatchStatusFilter === "ALL") return mixBatches;
    if (mixBatchStatusFilter === "OPEN") {
      return mixBatches.filter((b) => b.status === "OPEN" || b.status === "ACTIVE" || b.status === "CARRY_FORWARD");
    }
    return mixBatches.filter((b) => b.status === mixBatchStatusFilter);
  }, [mixBatches, mixBatchStatusFilter]);

  const openBatchesForUsage = useMemo(() => {
    if (!mixBatches) return [];
    return mixBatches.filter((b) => {
      const remaining = parseFloat(b.remainingKg);
      return remaining > 0.001 && (b.status === "OPEN" || b.status === "ACTIVE" || b.status === "CARRY_FORWARD");
    });
  }, [mixBatches]);

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
          <Button variant="outline" onClick={() => recalcUsedMutation.mutate()} disabled={recalcUsedMutation.isPending} data-testid="button-recalc-balance">
            {recalcUsedMutation.isPending ? "Recalculating..." : "Recalculate Balance"}
          </Button>
          <Button variant="outline" onClick={() => setObDialogOpen(true)} data-testid="button-opening-balance">
            <Upload className="h-4 w-4 mr-2" />
            Add Opening Balance
          </Button>
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
            <p className="text-sm text-muted-foreground">Reserved in Batches</p>
            <p className="text-xl font-bold font-mono text-amber-600 dark:text-amber-400" data-testid="text-total-reserved">
              {formatNumber(totalReserved)} kg
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => recalculateMutation.mutate()}
            disabled={recalculateMutation.isPending}
            data-testid="button-recalculate-used-kg"
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${recalculateMutation.isPending ? "animate-spin" : ""}`} />
            Recalculate Used kg
          </Button>
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
                  <TableHead className="text-right">Used (kg)</TableHead>
                  <TableHead className="text-right">Remaining (kg)</TableHead>
                  <TableHead className="text-right">Reserved (kg)</TableHead>
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
                        {row.supplierName}
                      </TableCell>
                      <TableCell>
                        <Badge variant={isOB ? "secondary" : "outline"} data-testid={`badge-source-${row.supplierId || idx}${isOB ? "-ob" : "-ct"}`}>
                          {isOB ? "Opening" : "Container"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatNumber(parseFloat(row.receivedKg))}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatNumber(parseFloat(row.usedKg))}
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        <Badge variant={remaining <= 0 ? "secondary" : "default"}>
                          {formatNumber(remaining)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-amber-600 dark:text-amber-400">
                        {formatNumber(parseFloat(row.reservedKg || "0"))}
                      </TableCell>
                      <TableCell className="text-right font-mono text-green-600 dark:text-green-400 font-medium">
                        {formatNumber(parseFloat(row.freeKg || "0"))}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${parseFloat(row.costPerKgUsd || row.costPerKg).toFixed(4)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${formatNumber(parseFloat(row.valueRemainingUsd || row.valueRemaining))}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {formatDisplayDate(row.lastOffloaded)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 flex-wrap">
                        {isOB && remaining > 0 && (
                          <Button
                            size="sm"
                            variant="outline"
                            data-testid={`button-assign-bales-${row.supplierId || idx}`}
                            onClick={() => {
                              const obRows = rawStockByContainer?.filter(
                                (r: any) => r.containerStatus === "OPENING_BALANCE" && r.supplierName === row.supplierName
                              ) || [];
                              const best = obRows.reduce((prev: any, cur: any) => {
                                const prevAvail = parseFloat(prev?.receivedKg || "0") - parseFloat(prev?.usedKg || "0");
                                const curAvail = parseFloat(cur.receivedKg) - parseFloat(cur.usedKg);
                                return curAvail > prevAvail ? cur : prev;
                              }, obRows[0]);
                              if (best) {
                                setAssigningRawStock({
                                  rawStockId: best.id,
                                  supplierName: row.supplierName,
                                  availableKg: parseFloat(best.receivedKg) - parseFloat(best.usedKg),
                                  costPerKg: best.costPerKg,
                                });
                                setSelectedBaleIds(new Set());
                                setAssignDialogOpen(true);
                              } else {
                                toast({ title: "Error", description: "Could not find OB raw stock record. Try refreshing.", variant: "destructive" });
                              }
                            }}
                          >
                            <Link2 className="h-3 w-3 mr-1" />
                            Assign to Bales
                          </Button>
                        )}
                        {isOB && (
                          <Button
                            size="sm"
                            variant="outline"
                            data-testid={`button-edit-ob-${row.supplierId || idx}`}
                            onClick={() => {
                              const obRows = rawStockByContainer?.filter(
                                (r: any) => r.containerStatus === "OPENING_BALANCE" && r.supplierName === row.supplierName
                              ) || [];
                              const best = obRows.reduce((prev: any, cur: any) => {
                                const prevAvail = parseFloat(prev?.receivedKg || "0") - parseFloat(prev?.usedKg || "0");
                                const curAvail = parseFloat(cur.receivedKg) - parseFloat(cur.usedKg);
                                return curAvail > prevAvail ? cur : prev;
                              }, obRows[0]);
                              if (best) {
                                navigate(`/factory/raw-stock/opening-balance/${best.id}/edit`);
                              } else {
                                toast({ title: "Error", description: "Could not find OB record. Try refreshing.", variant: "destructive" });
                              }
                            }}
                          >
                            <Pencil className="h-3 w-3 mr-1" />
                            Edit
                          </Button>
                        )}
                        {isOB && (
                          <Button
                            size="sm"
                            variant="ghost"
                            data-testid={`button-delete-ob-${row.supplierId || idx}`}
                            onClick={() => {
                              const obRows = rawStockByContainer?.filter(
                                (r: any) => r.containerStatus === "OPENING_BALANCE" && r.supplierName === row.supplierName
                              ) || [];
                              const best = obRows.reduce((prev: any, cur: any) => {
                                const prevAvail = parseFloat(prev?.receivedKg || "0") - parseFloat(prev?.usedKg || "0");
                                const curAvail = parseFloat(cur.receivedKg) - parseFloat(cur.usedKg);
                                return curAvail > prevAvail ? cur : prev;
                              }, obRows[0]);
                              if (best) {
                                setDeletingObRecord({
                                  rawStockId: best.id,
                                  supplierName: row.supplierName,
                                  containerNumber: best.containerNumber || "",
                                });
                                setDeleteObDialogOpen(true);
                              } else {
                                toast({ title: "Error", description: "Could not find OB record. Try refreshing.", variant: "destructive" });
                              }
                            }}
                          >
                            <Trash2 className="h-3 w-3 mr-1 text-destructive" />
                            Delete
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
                Daily Report
              </Button>
              <Button variant="outline" size="sm" onClick={() => { setUseTodayUsages([]); setUseTodayOpen(true); }} disabled={openBatchesForUsage.length === 0} data-testid="button-use-today">
                <CheckCircle className="h-4 w-4 mr-1" />
                Use Today
              </Button>
              <Button size="sm" onClick={() => setCreateMixBatchOpen(true)} data-testid="button-create-mix-batch">
                <Plus className="h-4 w-4 mr-1" />
                Create Batch
              </Button>
            </div>
          </div>
          {/* Status filter */}
          <div className="flex gap-2 flex-wrap mt-2">
            {[
              { key: "OPEN", label: "Open / Active" },
              { key: "CARRY_FORWARD", label: "Carry Forward" },
              { key: "CLOSED", label: "Closed" },
              { key: "ALL", label: "All" },
            ].map(({ key, label }) => (
              <Button
                key={key}
                size="sm"
                variant={mixBatchStatusFilter === key ? "default" : "outline"}
                onClick={() => setMixBatchStatusFilter(key)}
                data-testid={`button-mix-filter-${key.toLowerCase()}`}
              >
                {label}
              </Button>
            ))}
          </div>

          {/* Daily report panel */}
          {dailyReportOpen && (
            <div className="mt-4 border rounded-md p-4 space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Report date:</span>
                <Input
                  type="date"
                  value={dailyReportDate}
                  onChange={(e) => setDailyReportDate(e.target.value)}
                  className="w-auto"
                  data-testid="input-daily-report-date"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(`/api/factory/daily-report/export?date=${dailyReportDate}&format=excel`, "_blank")}
                  data-testid="button-export-daily-excel"
                >
                  <FileSpreadsheet className="h-4 w-4 mr-1" />
                  Excel
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(`/api/factory/daily-report/export?date=${dailyReportDate}&format=pdf`, "_blank")}
                  data-testid="button-export-daily-pdf"
                >
                  <FileText className="h-4 w-4 mr-1" />
                  PDF
                </Button>
              </div>
              {dailyReportLoading ? (
                <div className="space-y-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
              ) : dailyReport?.usages?.length > 0 ? (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
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
                <p className="text-sm text-muted-foreground py-4 text-center">No consumption recorded for {dailyReportDate}</p>
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
                  <TableHead>Operator</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Total (kg)</TableHead>
                  <TableHead className="text-right">Used (kg)</TableHead>
                  <TableHead className="text-right">Remaining (kg)</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMixBatches.map((batch) => {
                  const total = parseFloat(batch.totalWeightKg) || 0;
                  const used = parseFloat(batch.usedKg) || 0;
                  const remaining = parseFloat(batch.remainingKg) || 0;
                  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
                  const statusColors: Record<string, string> = {
                    OPEN: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
                    ACTIVE: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
                    CARRY_FORWARD: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
                    CLOSED: "bg-muted text-muted-foreground",
                    COMPLETED: "bg-muted text-muted-foreground",
                  };
                  return (
                    <TableRow key={batch.id} data-testid={`row-mix-batch-${batch.id}`}>
                      <TableCell className="font-mono font-medium text-sm">{batch.batchCode}</TableCell>
                      <TableCell className="text-sm">{batch.name || "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{batch.operatorUser || "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{batch.batchDate ? formatDisplayDate(batch.batchDate) : formatDisplayDate(batch.createdAt)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{formatNumber(total)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{formatNumber(used)}</TableCell>
                      <TableCell className="text-right font-mono font-medium text-sm">{formatNumber(remaining)}</TableCell>
                      <TableCell className="w-28">
                        <div className="space-y-1">
                          <Progress value={pct} className="h-2" />
                          <p className="text-xs text-muted-foreground">{pct.toFixed(0)}%</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className={`text-xs font-medium px-2 py-1 rounded-md ${statusColors[batch.status] || "bg-muted text-muted-foreground"}`}>
                          {batch.status === "CARRY_FORWARD" ? "Carry Fwd" : batch.status}
                        </span>
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setDeleteBatchId(batch.id)}
                          data-testid={`button-delete-mix-batch-${batch.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-10">
              <Layers className="mx-auto h-10 w-10 text-muted-foreground" />
              <h3 className="mt-3 text-base font-semibold">No mix batches</h3>
              <p className="text-muted-foreground text-sm mt-1">
                {mixBatchStatusFilter === "OPEN" ? "No open batches. Create one to get started." : "No batches match the current filter."}
              </p>
              {mixBatchStatusFilter === "OPEN" && (
                <Button className="mt-3" size="sm" onClick={() => setCreateMixBatchOpen(true)}>
                  <Plus className="h-4 w-4 mr-1" />
                  Create First Batch
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

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
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2 col-span-2">
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

                <div className="rounded-md border border-border bg-muted/30 p-3 space-y-3">
                  <p className="text-xs text-muted-foreground">Set the exchange rate below — it converts the base material cost from the container currency to USD. All offload charges are entered in USD.</p>
                  <div className="grid grid-cols-2 gap-4">
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
                  {currencyCode !== "USD" && rate > 0 && (
                    <div className="text-sm text-muted-foreground">
                      Base rate in USD: <span className="font-mono font-medium">${rateUsd.toFixed(4)}/kg</span>
                      {actualKg > 0 && <> · Base payable: <span className="font-mono font-medium">${formatNumber(totalPayableUsd)}</span></>}
                    </div>
                  )}
                </div>

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
                      onClick={() => setAdditionalCharges(prev => [...prev, { id: Date.now().toString(), description: "", amount: "", ledgerAccountId: "", supplierId: "" }])}
                      data-testid="button-add-additional-charge"
                    >
                      <Plus className="h-3 w-3 mr-1" /> Add Row
                    </Button>
                  </div>
                  {additionalCharges.length > 0 && (
                    <div className="space-y-3 mt-2">
                      {additionalCharges.map((charge, idx) => (
                        <div key={charge.id} className="space-y-1 p-2 border border-border rounded-md">
                          <div className="grid grid-cols-[1fr_120px_1fr_auto] gap-2 items-end">
                            <div className="space-y-1">
                              <Label className="text-muted-foreground text-xs">Description</Label>
                              <Input
                                value={charge.description}
                                onChange={(e) => setAdditionalCharges(prev => prev.map(c => c.id === charge.id ? { ...c, description: e.target.value } : c))}
                                placeholder="e.g. Handling fee"
                                data-testid={`input-addl-desc-${idx}`}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-muted-foreground text-xs">Amount (USD)</Label>
                              <Input
                                type="number"
                                value={charge.amount}
                                onChange={(e) => setAdditionalCharges(prev => prev.map(c => c.id === charge.id ? { ...c, amount: e.target.value } : c))}
                                placeholder="0.00"
                                step="0.01"
                                data-testid={`input-addl-amount-${idx}`}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-muted-foreground text-xs">Account / Broker</Label>
                              <AccountCombobox
                                value={charge.ledgerAccountId}
                                onValueChange={(v) => setAdditionalCharges(prev => prev.map(c => c.id === charge.id ? { ...c, ledgerAccountId: v } : c))}
                                accounts={ledgerAccounts || []}
                                suppliers={factorySuppliers || []}
                                placeholder="Select account or broker"
                                testId={`select-addl-account-${idx}`}
                              />
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setAdditionalCharges(prev => prev.filter(c => c.id !== charge.id))}
                              data-testid={`button-remove-addl-${idx}`}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
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
                      <span>{c.description || `Additional #${i + 1}`}</span>
                      <span className="font-mono">$ {formatNumber(parseFloat(c.amount))}</span>
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

      {/* ── Use Mix Batches Today Dialog ── */}
      <Dialog open={useTodayOpen} onOpenChange={(open) => { setUseTodayOpen(open); if (!open) setUseTodayUsages([]); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Record Daily Consumption</DialogTitle>
            <DialogDescription>
              Enter how many kg were consumed from each open batch today. Partial consumption will create a carry-forward batch automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Date</Label>
                <Input
                  type="date"
                  value={useTodayDate}
                  onChange={(e) => setUseTodayDate(e.target.value)}
                  data-testid="input-use-today-date"
                />
              </div>
              <div className="space-y-1">
                <Label>Operator (optional)</Label>
                <Input
                  placeholder="Operator name"
                  value={useTodayOperator}
                  onChange={(e) => setUseTodayOperator(e.target.value)}
                  data-testid="input-use-today-operator"
                />
              </div>
            </div>

            {/* Batch selection for consumption */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Select batches to consume from:</Label>
              <div className="max-h-64 overflow-y-auto border rounded-md divide-y">
                {openBatchesForUsage.map((batch) => {
                  const existing = useTodayUsages.find((u) => u.batchId === batch.id);
                  const remaining = parseFloat(batch.remainingKg);
                  return (
                    <div key={batch.id} className="flex items-center gap-3 p-3" data-testid={`row-use-batch-${batch.id}`}>
                      <div className="flex-1 min-w-0">
                        <p className="font-mono text-sm font-medium">{batch.batchCode}</p>
                        <p className="text-xs text-muted-foreground">{batch.name || ""} · {formatNumber(remaining)} kg remaining</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {existing ? (
                          <>
                            <Input
                              type="number"
                              placeholder="kg used"
                              value={existing.kgUsed}
                              step="0.001"
                              min="0.001"
                              max={remaining}
                              className="w-28 font-mono"
                              onChange={(e) => {
                                setUseTodayUsages((prev) =>
                                  prev.map((u) => u.batchId === batch.id ? { ...u, kgUsed: e.target.value } : u)
                                );
                              }}
                              data-testid={`input-kg-used-${batch.id}`}
                            />
                            <Button size="icon" variant="ghost" onClick={() => setUseTodayUsages((prev) => prev.filter((u) => u.batchId !== batch.id))}>
                              <X className="h-4 w-4" />
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setUseTodayUsages((prev) => [...prev, { batchId: batch.id, batchCode: batch.batchCode, totalKg: parseFloat(batch.totalWeightKg), remainingKg: remaining, kgUsed: remaining.toFixed(3) }])}
                            data-testid={`button-add-batch-usage-${batch.id}`}
                          >
                            <Plus className="h-3 w-3 mr-1" />
                            Add
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {useTodayUsages.length > 0 && (
              <div className="bg-muted/50 rounded-md p-3 space-y-1">
                <p className="text-sm font-medium">Summary:</p>
                {useTodayUsages.map((u) => {
                  const kgUsed = parseFloat(u.kgUsed) || 0;
                  const isPartial = kgUsed < u.remainingKg - 0.001;
                  return (
                    <p key={u.batchId} className="text-sm text-muted-foreground">
                      {u.batchCode}: {formatNumber(kgUsed)} kg consumed
                      {isPartial && <span className="text-amber-600 dark:text-amber-400"> → {formatNumber(u.remainingKg - kgUsed)} kg carry-forward</span>}
                    </p>
                  );
                })}
              </div>
            )}

            <div className="flex justify-end gap-2 flex-wrap">
              <Button variant="outline" onClick={() => setUseTodayOpen(false)} data-testid="button-use-today-cancel">
                Cancel
              </Button>
              <Button
                onClick={() => {
                  const validUsages = useTodayUsages
                    .map((u) => ({ batchId: u.batchId, kgUsed: parseFloat(u.kgUsed) || 0 }))
                    .filter((u) => u.kgUsed > 0);
                  if (validUsages.length === 0) {
                    toast({ title: "Nothing to record", description: "Enter kg used for at least one batch", variant: "destructive" });
                    return;
                  }
                  consumeMutation.mutate({ usages: validUsages, operatorUser: useTodayOperator || undefined, usedDate: useTodayDate });
                }}
                disabled={consumeMutation.isPending || useTodayUsages.length === 0}
                data-testid="button-use-today-confirm"
              >
                {consumeMutation.isPending ? "Recording..." : "Record Consumption"}
              </Button>
            </div>
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
