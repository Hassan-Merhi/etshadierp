import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Container, Package, Plus, ArrowDown, AlertTriangle, CheckCircle, Upload, Gavel, X, Check, ChevronsUpDown, Link2, Pencil, Trash2 } from "lucide-react";
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

interface AccountComboboxProps {
  value: string;
  onValueChange: (value: string) => void;
  accounts: { id: number; name: string; code?: string }[];
  placeholder?: string;
  disabled?: boolean;
  testId?: string;
}

function AccountCombobox({ value, onValueChange, accounts, placeholder = "Select account", disabled = false, testId }: AccountComboboxProps) {
  const [open, setOpen] = useState(false);
  const selectedAccount = accounts.find((a) => a.id.toString() === value);
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
          <span className="truncate">{selectedAccount ? (selectedAccount.code ? `${selectedAccount.code} - ${selectedAccount.name}` : selectedAccount.name) : placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0" align="start">
        <Command>
          <CommandInput placeholder="Search accounts..." />
          <CommandList>
            <CommandEmpty>No account found.</CommandEmpty>
            <CommandGroup>
              {accounts.map((account) => (
                <CommandItem
                  key={account.id}
                  value={account.code ? `${account.code} ${account.name}` : account.name}
                  onSelect={() => {
                    onValueChange(account.id.toString());
                    setOpen(false);
                  }}
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
}

interface RawStockRow {
  supplierName: string;
  supplierId: number | null;
  sourceType?: string;
  currencyCode?: string;
  receivedKg: string;
  usedKg: string;
  remainingKg: string;
  costPerKg: string;
  valueRemaining: string;
  lastOffloaded: string;
}

interface ContainerOption {
  id: number;
  containerNumber: string;
  totalKg: string | null;
  ratePerKg: string | null;
  currencyCode?: string;
  fxRateToUsd?: string;
}

export default function ProductionRawStock() {
  const { formatDisplayDate } = useDateFormat();
  const [offloadDialogOpen, setOffloadDialogOpen] = useState(false);
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
  const [otherCharges, setOtherCharges] = useState("");
  const [otherChargesAccountId, setOtherChargesAccountId] = useState("");
  const [dutyAmount, setDutyAmount] = useState("");
  const [dutyAccountId, setDutyAccountId] = useState("");
  const [dutyPending, setDutyPending] = useState(false);
  const [dutyNotes, setDutyNotes] = useState("");
  const [additionalCharges, setAdditionalCharges] = useState<AdditionalChargeRow[]>([]);
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

  const { data: factorySuppliers } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/factory/suppliers"],
    enabled: obDialogOpen,
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

  const commRateNum = parseFloat(commissionRate || "0");
  const commissionTotal = commissionType === "PER_KG"
    ? commRateNum * actualKg
    : commRateNum;

  const freightVal = parseFloat(freight || "0");
  const otherChargesVal = parseFloat(otherCharges || "0");
  const additionalChargesTotal = additionalCharges.reduce((sum, c) => sum + parseFloat(c.amount || "0"), 0);
  const dutyVal = dutyPending ? 0 : parseFloat(dutyAmount || "0");
  const totalCharges = freightVal + otherChargesVal + additionalChargesTotal + commissionTotal + dutyVal;
  const grandTotal = totalPayable + totalCharges;
  const inclusiveCostPerKg = actualKg > 0 ? grandTotal / actualKg : 0;

  const fxRate = parseFloat(fxRateToUsd || "1");
  const rateUsd = currencyCode === "USD" ? rate : rate * fxRate;
  const totalPayableUsd = actualKg * rateUsd;
  const grandTotalUsd = currencyCode === "USD" ? grandTotal : grandTotal * fxRate;

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
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleContainerSelect = (id: string) => {
    setSelectedContainerId(id);
    const container = availableContainers?.find((c) => c.id.toString() === id);
    setActualReceivedKg(container?.totalKg || "");
    setCostPerKg(container?.ratePerKg || "");
    setCurrencyCode(container?.currencyCode || "USD");
    setFxRateToUsd(container?.fxRateToUsd || "1");
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
      receivedKg: actualReceivedKg,
      costPerKg,
      currencyCode,
      fxRateToUsd,
      freight: freight || "0",
      freightAccountId: freightAccountId ? parseInt(freightAccountId) : null,
      otherCharges: otherCharges || "0",
      otherChargesAccountId: otherChargesAccountId ? parseInt(otherChargesAccountId) : null,
      dutyAmount: dutyAmount || "0",
      dutyAccountId: dutyAccountId ? parseInt(dutyAccountId) : null,
      dutyStatus,
      dutyNotes: dutyNotes || null,
      additionalCharges: additionalCharges.filter(c => c.description.trim() && parseFloat(c.amount || "0") > 0).map(c => ({
        description: c.description.trim(),
        amount: c.amount,
        ledgerAccountId: c.ledgerAccountId ? parseInt(c.ledgerAccountId) : null,
      })),
    };

    if (commissionPersonName.trim() && commRateNum > 0) {
      payload.commission = {
        personName: commissionPersonName.trim(),
        commissionType,
        commissionRate: commissionRate,
        ledgerAccountId: commissionLedgerAccountId || null,
      };
    }

    offloadMutation.mutate(payload);
  };

  const handleCloseDialog = () => {
    setOffloadDialogOpen(false);
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
    setOtherCharges("");
    setOtherChargesAccountId("");
    setDutyAmount("");
    setDutyAccountId("");
    setDutyPending(false);
    setDutyNotes("");
    setAdditionalCharges([]);
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
  const totalValue = rawStock?.reduce((sum, r) => sum + parseFloat(r.valueRemaining), 0) || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-title">Production Raw Stock</h1>
          <p className="text-muted-foreground mt-1">Supplier-based raw material tracking for production</p>
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

      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Total Received</p>
            <p className="text-2xl font-bold font-mono" data-testid="text-total-received">
              {formatNumber(totalReceived)} kg
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Total Used</p>
            <p className="text-2xl font-bold font-mono" data-testid="text-total-used">
              {formatNumber(totalUsed)} kg
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Total Remaining</p>
            <p className="text-2xl font-bold font-mono" data-testid="text-total-remaining">
              {formatNumber(totalRemaining)} kg
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Total Value</p>
            <p className="text-2xl font-bold font-mono" data-testid="text-total-value">
              ${formatNumber(totalValue)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Raw Stock by Supplier</CardTitle>
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
                  <TableHead className="text-right">Avg Cost/kg</TableHead>
                  <TableHead className="text-right">Value Remaining</TableHead>
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
                      <TableCell className="text-right font-mono">
                        {currency !== "USD" ? `${currency} ` : "$"}{parseFloat(row.costPerKg).toFixed(4)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${formatNumber(parseFloat(row.valueRemaining))}
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

      <Dialog open={offloadDialogOpen} onOpenChange={handleCloseDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Offload Container to Production</DialogTitle>
            <DialogDescription>
              Enter the actual received weight and verify cost details
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            <div className="space-y-2">
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

                <Separator />

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label>Actual Arrived KG</Label>
                    <Input
                      type="number"
                      value={actualReceivedKg}
                      onChange={(e) => setActualReceivedKg(e.target.value)}
                      placeholder="e.g. 19600"
                      step="0.001"
                      data-testid="input-actual-kg"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Rate per KG ($)</Label>
                    <Input
                      type="number"
                      value={costPerKg}
                      onChange={(e) => setCostPerKg(e.target.value)}
                      placeholder="e.g. 1.85"
                      step="0.0001"
                      data-testid="input-cost-per-kg"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label className="text-muted-foreground text-xs">Currency</Label>
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
                    <Label className="text-muted-foreground text-xs">FX Rate to USD</Label>
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
                  <div className="text-sm text-muted-foreground bg-muted/50 p-2 rounded-md">
                    Rate in USD: <span className="font-mono font-medium">${rateUsd.toFixed(4)}/kg</span>
                  </div>
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
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <Label className="text-muted-foreground text-xs">Freight ($)</Label>
                        <Input
                          type="number"
                          value={freight}
                          onChange={(e) => setFreight(e.target.value)}
                          placeholder="0.00"
                          step="0.01"
                          data-testid="input-freight"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-muted-foreground text-xs">Freight Account</Label>
                        <AccountCombobox
                          value={freightAccountId}
                          onValueChange={setFreightAccountId}
                          accounts={ledgerAccounts || []}
                          placeholder="Select account"
                          testId="select-freight-account"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <Label className="text-muted-foreground text-xs">Other Charges ($)</Label>
                        <Input
                          type="number"
                          value={otherCharges}
                          onChange={(e) => setOtherCharges(e.target.value)}
                          placeholder="0.00"
                          step="0.01"
                          data-testid="input-other-charges"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-muted-foreground text-xs">Other Charges Account</Label>
                        <AccountCombobox
                          value={otherChargesAccountId}
                          onValueChange={setOtherChargesAccountId}
                          accounts={ledgerAccounts || []}
                          placeholder="Select account"
                          testId="select-other-charges-account"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <Separator />

                <div>
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <Label className="text-sm font-semibold">Additional Charges</Label>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setAdditionalCharges(prev => [...prev, { id: Date.now().toString(), description: "", amount: "", ledgerAccountId: "" }])}
                      data-testid="button-add-additional-charge"
                    >
                      <Plus className="h-3 w-3 mr-1" /> Add Row
                    </Button>
                  </div>
                  {additionalCharges.length > 0 && (
                    <div className="space-y-2 mt-2">
                      {additionalCharges.map((charge, idx) => (
                        <div key={charge.id} className="grid grid-cols-[1fr_100px_1fr_auto] gap-2 items-end">
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
                            <Label className="text-muted-foreground text-xs">Amount</Label>
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
                            <Label className="text-muted-foreground text-xs">Account</Label>
                            <AccountCombobox
                              value={charge.ledgerAccountId}
                              onValueChange={(v) => setAdditionalCharges(prev => prev.map(c => c.id === charge.id ? { ...c, ledgerAccountId: v } : c))}
                              accounts={ledgerAccounts || []}
                              placeholder="Select"
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
                      ))}
                    </div>
                  )}
                </div>

                <Separator />

                <div>
                  <Label className="text-sm font-semibold">Commission (optional)</Label>
                  <div className="space-y-3 mt-2">
                    <div className="space-y-1">
                      <Label className="text-muted-foreground text-xs">Commission Person</Label>
                      <Input
                        value={commissionPersonName}
                        onChange={(e) => setCommissionPersonName(e.target.value)}
                        placeholder="Person name"
                        data-testid="input-commission-person"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
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
                          {commissionType === "PER_KG" ? "Rate per KG ($)" : "Fixed Amount ($)"}
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
                          Commission Total: <span className="font-mono font-medium text-foreground">${formatNumber(commissionTotal)}</span>
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
                    <span className="text-muted-foreground">Base Payable ({actualKg} kg x {rate.toFixed(4)})</span>
                    <span className="font-mono">${formatNumber(totalPayable)}</span>
                  </div>
                  {freightVal > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Freight</span>
                      <span className="font-mono">${formatNumber(freightVal)}</span>
                    </div>
                  )}
                  {otherChargesVal > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Other Charges</span>
                      <span className="font-mono">${formatNumber(otherChargesVal)}</span>
                    </div>
                  )}
                  {additionalCharges.filter(c => parseFloat(c.amount || "0") > 0).map((c, i) => (
                    <div key={c.id} className="flex justify-between text-muted-foreground">
                      <span>{c.description || `Additional #${i + 1}`}</span>
                      <span className="font-mono">${formatNumber(parseFloat(c.amount))}</span>
                    </div>
                  ))}
                  {commissionPersonName && commRateNum > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Commission ({commissionPersonName})</span>
                      <span className="font-mono">${formatNumber(commissionTotal)}</span>
                    </div>
                  )}
                  {dutyVal > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Duty</span>
                      <span className="font-mono">${formatNumber(dutyVal)}</span>
                    </div>
                  )}
                  {dutyPending && parseFloat(dutyAmount || "0") > 0 && (
                    <div className="flex justify-between text-amber-600">
                      <span>Duty (Pending)</span>
                      <span className="font-mono">${formatNumber(parseFloat(dutyAmount))}</span>
                    </div>
                  )}
                  <Separator className="my-1" />
                  <div className="flex justify-between font-medium">
                    <span>Grand Total (Inclusive)</span>
                    <span className="font-mono text-base">${formatNumber(grandTotal)}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Inclusive Cost/KG</span>
                    <span className="font-mono">${inclusiveCostPerKg.toFixed(4)}/kg</span>
                  </div>
                  {currencyCode !== "USD" && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Grand Total (USD)</span>
                      <span className="font-mono">${formatNumber(grandTotalUsd)}</span>
                    </div>
                  )}
                </div>
              </>
            )}

            <div className="flex justify-end gap-2 pt-2">
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
        </DialogContent>
      </Dialog>

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
    </div>
  );
}
