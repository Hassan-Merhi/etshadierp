import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { Link, useLocation } from "wouter";
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
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Plus,
  Package,
  Eye,
  Search,
  X,
  Download,
  Truck,
  Check,
  MapPin,
  Upload,
  FileSpreadsheet,
  ChevronDown,
  Wrench,
  Loader2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useCompany } from "@/contexts/CompanyContext";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { AddContainerDialog } from "../components/AddContainerDialog";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { utils, writeFile, readFile, read, ExcelJS } from "@/lib/excelHelper";
import type { Container, Supplier } from "@shared/schema";
// Split-out modules
import type { SoldContainer, TrackingEdit } from "./containers/types";
import { cellVal, cellStr, cellNum, excelDateToString } from "./containers/containerExcel";
import { useContainerFilters } from "./containers/useContainerFilters";
import { ContainerFilters } from "./containers/ContainerFilters";
import { ActiveContainersTable } from "./containers/ActiveContainersTable";
import { OtwContainersTable } from "./containers/OtwContainersTable";
import { SoldContainersTable } from "./containers/SoldContainersTable";

export default function Containers() {
  const { formatDisplayDate } = useDateFormat();
  const [activeTab, setActiveTab] = useState("active");

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editingNumberId, setEditingNumberId] = useState<number | null>(null);
  const [editingNumberValue, setEditingNumberValue] = useState("");
  const [trackingEdits, setTrackingEdits] = useState<TrackingEdit>({});
  const [savingIds, setSavingIds] = useState<Set<number>>(new Set());
  const [savingAll, setSavingAll] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { selectedCompany } = useCompany();
  const { formatAmount } = useCurrencyContext();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const isSupplierPartner = selectedCompany?.companyType === "supplier_partner";
  const isFactory = selectedCompany?.companyType === "factory" || selectedCompany?.companyType === "factory_v2";
  const tableRef = useRef<HTMLTableElement>(null);
  const { data: myErpPages } = useQuery<{ hiddenErpCostFields?: string[] }>({ queryKey: ["/api/my-erp-pages"] });
  const hideContainerCosts = (myErpPages?.hiddenErpCostFields ?? []).includes("container_costs");
  const { data: currentUser } = useQuery<{ role?: string; currentRole?: string | null }>({
    queryKey: ["/api/auth/me"],
  });
  const _allowedRoles = ["Admin", "Owner", "Developer"];
  const isPrivilegedRole =
    _allowedRoles.includes(currentUser?.currentRole ?? "") || _allowedRoles.includes(currentUser?.role ?? "");
  const isDeveloper = currentUser?.role === "Developer";
  const [syncAllConfirmOpen, setSyncAllConfirmOpen] = useState(false);

  const syncAllMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/containers/sync-all-vouchers", {}),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/containers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/containers/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/containers/sold"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daybook"] });
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      const parts: string[] = [data?.message ?? "All POs and parent JVs have been checked."];
      if ((data?.updatedFreightVouchers ?? 0) > 0)
        parts.push(`Freight vouchers fixed: ${data.updatedFreightVouchers}.`);
      if ((data?.updatedContainerCharges ?? 0) > 0) parts.push(`Charge rows fixed: ${data.updatedContainerCharges}.`);
      if ((data?.notFoundParentVouchers?.length ?? 0) > 0)
        parts.push(
          `${data.notFoundParentVouchers.length} PO(s) have no parent JV yet — import or re-save those POs to create them.`
        );
      toast({
        title: "Sync Complete",
        description: parts.join(" "),
      });
      if (data?.errors?.length > 0) {
        console.warn("[SyncAll] Errors:", data.errors);
      }
      if (data?.missingParentFreightAccount?.length > 0) {
        toast({
          title: "Action Required",
          description: `${data.missingParentFreightAccount.length} PO(s) have parent-paid freight but no parent account set. Please edit each PO to select the parent freight account.`,
          variant: "destructive",
        });
      }
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to sync vouchers",
        variant: "destructive",
      });
    },
  });

  const trackingFields = [
    "shopName",
    "eta",
    "transporter",
    "transportFee",
    "numberPlate",
    "trackingLocation",
    "borderDate",
    "offloadDate",
    "agent",
    "dutyFee",
    "docReceived",
    "trackingDescription",
    "docsSentDate",
    "trackingLink",
  ] as const;

  // Auto-size inputs to fit their text.
  // Defaults are slightly wider so fields don't feel cramped (like Description).
  const autoSizeStyle = (value: unknown, placeholder = "", minCh = 10, maxCh = 32) => {
    const text = String((value ?? "") as any) || placeholder || "";
    const ch = Math.max(minCh, Math.min(maxCh, text.length + 2));
    return {
      width: `${ch}ch`,
      minWidth: `${minCh}ch`,
      maxWidth: `${maxCh}ch`,
    } as const;
  };

  const { data: rawContainers = [], isLoading } = useQuery<Container[]>({
    queryKey: ["/api/containers/active", selectedCompany?.id],
    enabled: !!selectedCompany?.id,
  });
  const allContainers = rawContainers
    .slice()
    .sort((a, b) => new Date(b.importDate).getTime() - new Date(a.importDate).getTime());

  const { data: soldContainers = [], isLoading: isSoldLoading } = useQuery<SoldContainer[]>({
    queryKey: ["/api/containers/sold", selectedCompany?.id],
    enabled: !!selectedCompany?.id && !isSupplierPartner,
  });

  const { data: spContainersList = [], isLoading: spContainersLoading } = useQuery<any[]>({
    queryKey: ["/api/sp/containers"],
    queryFn: () => fetch("/api/sp/containers", { credentials: "include" }).then((r) => r.json()),
    enabled: !!selectedCompany?.id && isSupplierPartner,
  });

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
  });

  const { data: freightStatusMap = {} } = useQuery<
    Record<number, { totalFreight: number; totalPaid: number; status: string }>
  >({
    queryKey: ["/api/factory/containers/freight-status"],
    queryFn: async () => {
      const res = await fetch("/api/factory/containers/freight-status");
      if (!res.ok) return {};
      return res.json();
    },
    enabled: !!selectedCompany?.id && isFactory,
  });

  const updateTrackingMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<Container> }) => {
      const res = await apiRequest("PATCH", `/api/containers/${id}/tracking`, data);
      return res.json();
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/containers/active"] });
      setTrackingEdits((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      toast({ title: "Saved", description: "Tracking info updated" });
    },
    onError: (error: any, { id }) => {
      if (error?._handledGlobally) return;
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const editContainerNumberMutation = useMutation({
    mutationFn: async ({ id, containerNumber }: { id: number; containerNumber: string }) => {
      const res = await apiRequest("PATCH", `/api/containers/${id}/number`, { containerNumber });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/containers/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/containers/sold"] });
      setEditingNumberId(null);
      setEditingNumberValue("");
      toast({ title: "Updated", description: "Container number changed" });
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Filter state and computed filtered arrays
  const {
    searchTerm,
    setSearchTerm,
    soldSearchTerm,
    setSoldSearchTerm,
    otwSearchTerm,
    setOtwSearchTerm,
    statusFilter,
    setStatusFilter,
    supplierFilter,
    setSupplierFilter,
    otwLocationFilter,
    setOtwLocationFilter,
    otwSupplierFilter,
    setOtwSupplierFilter,
    otwAgentFilter,
    setOtwAgentFilter,
    otwTransporterFilter,
    setOtwTransporterFilter,
    otwTruckFilter,
    setOtwTruckFilter,
    otwDocReceivedFilter,
    setOtwDocReceivedFilter,
    otwFreightStatusFilter,
    setOtwFreightStatusFilter,
    otwNotesFilter,
    setOtwNotesFilter,
    uniqueOtwLocations,
    uniqueOtwAgents,
    uniqueOtwTransporters,
    uniqueOtwSuppliers,
    uniqueOtwTrucks,
    otwContainers,
    filteredOtwContainers,
    filteredSoldContainers,
    containers,
    clearFilters,
  } = useContainerFilters(allContainers, soldContainers);

  const getSupplierName = (supplierId: number) => {
    const supplier = suppliers.find((s) => s.id === supplierId);
    return supplier ? supplier.legalName : "Unknown";
  };

  const exportToExcel = async () => {
    const data = containers.map((container) => ({
      "Container Number": container.containerNumber,
      Supplier: getSupplierName(container.supplierId),
      Status: container.status,
      Amount: parseFloat(container.grandTotal || "0"),
      "Import Date": formatDisplayDate(container.importDate),
    }));

    const worksheet = utils.json_to_sheet(data);
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, worksheet, "Containers");
    await writeFile(workbook, "containers.xlsx");
  };

  const exportAllContainersFull = async () => {
    if (!navigator.onLine) {
      toast({ title: "Not available offline", description: "Exports require a connection", variant: "destructive" });
      return;
    }
    try {
      const response = await fetch("/api/containers/export-all");
      if (!response.ok) throw new Error("Export failed");

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `containers_full_export_${new Date().toLocaleDateString("en-CA")}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: "Export successful",
        description: "All containers exported with full details",
      });
    } catch (error: any) {
      toast({
        title: "Export failed",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const exportOtwToExcel = async () => {
    const data = filteredOtwContainers.map((c) => ({
      "Container #": c.containerNumber,
      Supplier: getSupplierName(c.supplierId),
      Amount: parseFloat(c.grandTotal || "0"),
      Shop: c.shopName || "",
      ETA: c.eta || "",
      Transporter: c.transporter || "",
      "Transport Fee": c.transportFee || "",
      "Number Plate": c.numberPlate || "",
      Location: c.trackingLocation || "",
      "Border Date": c.borderDate || "",
      "Offload Date": c.offloadDate || "",
      Agent: c.agent || "",
      "Duty Fee": c.dutyFee || "",
      "Doc Received": c.docReceived ? "Yes" : "No",
      Description: c.trackingDescription || "",
    }));

    const worksheet = utils.json_to_sheet(data);
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, worksheet, "OTW Containers");
    await writeFile(workbook, "otw_containers.xlsx");
  };

  const downloadImportTemplate = async () => {
    const templateData = [
      {
        "Container #": "EXAMPLE123456",
        Shop: "Hadi #1",
        ETA: "2026-01-15",
        Transporter: "FARHAT",
        "Transport Fee": "8500",
        "Number Plate": "T123 ABC",
        Location: "KASUMBALESA",
        "Border Date": "2026-01-20",
        "Offload Date": "2026-01-22",
        Agent: "NCA",
        "Duty Fee": "5000",
        "Doc Received": "YES",
        Description: "Sample description",
      },
    ];

    const worksheet = utils.json_to_sheet(templateData);
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, worksheet, "Import Template");
    await writeFile(workbook, "container_import_template.xlsx");
  };

  const handleImportClick = async () => {
    fileInputRef.current?.click();
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    try {
      const data = await file.arrayBuffer();
      const workbook = await read(data);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = utils.sheet_to_json(sheet);

      // Validate file has data
      if (jsonData.length === 0) {
        throw new Error("The Excel file is empty. Please add data rows and try again.");
      }

      // Read header row explicitly to get all column names (avoids issues with blank first-row cells)
      const headerRow = utils.sheet_to_json<string[]>(sheet, { header: 1 })[0] || [];
      const columns = headerRow.map((h) => String(h || "").trim());

      // Check for Container # column (required for matching)
      const containerColAliases = ["Container #", "Container Number", "containerNumber"];
      const hasContainerCol = containerColAliases.some((alias) => columns.includes(alias));

      if (!hasContainerCol) {
        throw new Error(
          `Missing required column: "Container #"\n\n` +
            `Expected columns: Container #, Shop, ETA, Transporter, etc.\n` +
            `Found columns: ${columns.slice(0, 5).join(", ")}${columns.length > 5 ? "..." : ""}\n\n` +
            `Tip: Download the template to see the expected format.`
        );
      }

      // Map Excel columns to API fields (convert Excel date serials to strings)
      const rows = jsonData.map((row: any) => ({
        containerNumber: cellStr(row["Container #"] || row["Container Number"] || row["containerNumber"]),
        shopName: cellStr(row["Shop"] || row["Shop Name"] || row["shopName"]),
        eta: excelDateToString(cellVal(row["ETA"] || row["eta"])),
        transporter: cellStr(row["Transporter"] || row["transporter"]),
        transportFee: cellNum(row["Transport Fee"] || row["transportFee"]),
        numberPlate: cellStr(row["Number Plate"] || row["Plate"] || row["numberPlate"]),
        trackingLocation: cellStr(row["Location"] || row["trackingLocation"]),
        borderDate: excelDateToString(cellVal(row["Border Date"] || row["borderDate"])),
        offloadDate: excelDateToString(cellVal(row["Offload Date"] || row["offloadDate"])),
        agent: cellStr(row["Agent"] || row["agent"]),
        dutyFee: cellNum(row["Duty Fee"] || row["dutyFee"]),
        docReceived: cellStr(row["Doc Received"] || row["docReceived"]),
        trackingDescription: cellStr(row["Description"] || row["trackingDescription"]),
      }));

      const response = await apiRequest("POST", "/api/containers/tracking/import", { rows });
      const result = await response.json();

      queryClient.invalidateQueries({ queryKey: ["/api/containers/active"] });

      if (result.errors && result.errors.length > 0) {
        toast({
          title: `Import completed with issues`,
          description: `${result.updated} updated, ${result.notFound} not found. ${result.errors[0]}`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Import successful",
          description: `${result.updated} container(s) updated`,
        });
      }
    } catch (error: any) {
      toast({
        title: "Import failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const getEditValue = (container: Container, field: keyof Container) => {
    if (trackingEdits[container.id] && trackingEdits[container.id][field] !== undefined) {
      return trackingEdits[container.id][field];
    }
    return container[field];
  };

  const setEditValue = async (containerId: number, field: keyof Container, value: any) => {
    setTrackingEdits((prev) => ({
      ...prev,
      [containerId]: {
        ...prev[containerId],
        [field]: value,
      },
    }));
  };

  const hasChanges = (containerId: number) => {
    return trackingEdits[containerId] && Object.keys(trackingEdits[containerId]).length > 0;
  };

  const saveTracking = async (containerId: number) => {
    const data = trackingEdits[containerId];
    if (!data) return;

    setSavingIds((prev) => new Set(prev).add(containerId));
    updateTrackingMutation.mutate({ id: containerId, data });
  };

  const hasAnyChanges = Object.keys(trackingEdits).length > 0;

  const saveAllTracking = async () => {
    const containerIds = Object.keys(trackingEdits).map(Number);
    if (containerIds.length === 0) return;

    setSavingAll(true);
    let savedCount = 0;
    let errorCount = 0;

    for (const id of containerIds) {
      const data = trackingEdits[id];
      if (!data || Object.keys(data).length === 0) continue;

      try {
        await apiRequest("PATCH", `/api/containers/${id}/tracking`, data);
        savedCount++;
      } catch (e) {
        errorCount++;
      }
    }

    queryClient.invalidateQueries({ queryKey: ["/api/containers/active"] });
    setTrackingEdits({});
    setSavingAll(false);

    if (errorCount === 0) {
      toast({
        title: "Saved",
        description: `${savedCount} container(s) updated`,
      });
    } else {
      toast({
        title: "Partial save",
        description: `${savedCount} saved, ${errorCount} failed`,
        variant: "destructive",
      });
    }
  };

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, containerId: number, fieldIndex: number) => {
      const containerIndex = filteredOtwContainers.findIndex((c) => c.id === containerId);
      if (containerIndex === -1) return;

      const getInputId = (cIdx: number, fIdx: number) => {
        const container = filteredOtwContainers[cIdx];
        if (!container) return null;
        const field = trackingFields[fIdx];
        if (!field) return null;
        return `tracking-${container.id}-${field}`;
      };

      const focusInput = async (inputId: string | null) => {
        if (!inputId) return false;
        const el = document.getElementById(inputId) as HTMLInputElement | null;
        if (el) {
          el.focus();
          el.select?.();
          return true;
        }
        return false;
      };

      if (e.key === "Enter") {
        e.preventDefault();
        if (hasChanges(containerId)) {
          saveTracking(containerId);
        }
        const nextId = getInputId(containerIndex + 1, fieldIndex);
        if (nextId) focusInput(nextId);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        const nextId = getInputId(containerIndex + 1, fieldIndex);
        focusInput(nextId);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prevId = getInputId(containerIndex - 1, fieldIndex);
        focusInput(prevId);
      } else if (e.key === "ArrowRight" && e.altKey) {
        e.preventDefault();
        const nextId = getInputId(containerIndex, fieldIndex + 1);
        focusInput(nextId);
      } else if (e.key === "ArrowLeft" && e.altKey) {
        e.preventDefault();
        const prevId = getInputId(containerIndex, fieldIndex - 1);
        focusInput(prevId);
      }
    },
    [filteredOtwContainers, trackingFields, hasChanges, saveTracking]
  );

  if (isLoading && !isSupplierPartner) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    );
  }

  // ── SP Company view ───────────────────────────────────────────────────────
  if (isSupplierPartner) {
    // Normalize sp_containers rows to a common display shape
    const spNative: any[] = (Array.isArray(spContainersList) ? spContainersList : []).map((c) => ({
      _key: `sp-${c.id}`,
      id: c.id,
      _source: "sp",
      displayName: c.invoiceNumber || c.containerNumber || `#${c.id}`,
      subName: c.containerNumber && c.invoiceNumber ? c.containerNumber : null,
      supplierName: c.supplierName ?? "",
      statusLabel: c.status === "offloaded" ? "Offloaded" : "Open / OTW",
      statusOffloaded: c.status === "offloaded",
      date: c.invoiceDate,
      dateLabel: "Invoice Date",
      totalUsd: parseFloat(c.invoiceTotalUsd ?? "0"),
    }));

    // Normalize regular containers (from PO Import) to same shape
    const erpNormalized: any[] = allContainers.map((c) => {
      const sup = suppliers.find((s: any) => s.id === c.supplierId);
      const isOffloaded = c.status === "OFFLOADED";
      return {
        _key: `erp-${c.id}`,
        id: c.id,
        _source: "erp",
        displayName: c.containerNumber,
        subName: null,
        supplierName: (sup as any)?.legalName ?? (sup as any)?.name ?? "",
        statusLabel: isOffloaded ? "Offloaded" : c.status === "OTW" ? "On The Way" : c.status,
        statusOffloaded: isOffloaded,
        date: c.importDate,
        dateLabel: "Import Date",
        totalUsd: parseFloat(c.grandTotal ?? "0"),
      };
    });

    const spSearch = searchTerm.toLowerCase();
    const allSpItems = [...spNative, ...erpNormalized];
    const filtered = allSpItems.filter(
      (c) =>
        !spSearch ||
        (c.displayName ?? "").toLowerCase().includes(spSearch) ||
        (c.subName ?? "").toLowerCase().includes(spSearch) ||
        (c.supplierName ?? "").toLowerCase().includes(spSearch)
    );
    const isSpLoading = spContainersLoading || isLoading;

    return (
      <div className="space-y-4 sm:space-y-6">
        <PageHeader title="Container Tracking" subtitle="Supplier partner containers">
          <div className="flex gap-2 flex-wrap">
            <Button className="gap-2" onClick={() => setAddDialogOpen(true)} data-testid="button-add-container">
              <Plus className="h-4 w-4" />
              Import Container
            </Button>
          </div>
        </PageHeader>

        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by invoice, container, supplier…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
              data-testid="input-search-container"
            />
          </div>
          {searchTerm && (
            <Button variant="ghost" size="sm" onClick={() => setSearchTerm("")} data-testid="button-clear-search">
              <X className="h-4 w-4 mr-1" />
              Clear
            </Button>
          )}
        </div>

        {isSpLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <Package className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">
              {allSpItems.length === 0
                ? "No containers yet. Click Import Container to add one."
                : "No containers match your search."}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((c: any) => (
              <div
                key={c._key}
                className="flex items-center gap-4 p-4 rounded-md border border-border bg-card hover-elevate cursor-pointer"
                onClick={() => setLocation(c._source === "erp" ? `/containers/${c.id}?src=erp` : `/containers/${c.id}`)}
                data-testid={`row-sp-container-${c.id}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{c.displayName}</span>
                    {c.subName && <span className="text-xs text-muted-foreground font-mono">{c.subName}</span>}
                    <Badge
                      variant="outline"
                      className={
                        c.statusOffloaded ? "text-green-600 border-green-600/40" : "text-blue-600 border-blue-600/40"
                      }
                    >
                      {c.statusLabel}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{c.supplierName}</p>
                </div>
                <div className="text-right hidden sm:block">
                  <p className="text-xs text-muted-foreground">{c.dateLabel}</p>
                  <p className="text-sm font-mono">{formatDisplayDate(c.date)}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground hidden sm:block">Total (USD)</p>
                  <p className="text-sm font-mono font-semibold">
                    ${c.totalUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
                <Link
                  href={c._source === "erp" ? `/containers/${c.id}?src=erp` : `/containers/${c.id}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Button size="sm" variant="outline" data-testid={`button-view-sp-${c.id}`}>
                    <Eye className="h-4 w-4 mr-1" />
                    View
                  </Button>
                </Link>
              </div>
            ))}
          </div>
        )}

        <AddContainerDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} isSP={true} />
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader title="Container Tracking" subtitle="Track containers and manage offloading">
        <div className="flex gap-2 flex-wrap">
          {isDeveloper && (
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => setSyncAllConfirmOpen(true)}
              disabled={syncAllMutation.isPending}
              data-testid="button-sync-all-vouchers"
            >
              {syncAllMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Wrench className="h-4 w-4" />
              )}
              Fix All PO &amp; Parent JV Sync
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2" data-testid="button-export-dropdown">
                <Download className="h-4 w-4" />
                Export
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={exportToExcel} data-testid="button-export-excel">
                <Download className="h-4 w-4 mr-2" />
                Export
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={exportAllContainersFull} data-testid="button-export-all-full">
                <Download className="h-4 w-4 mr-2" />
                Export All (Full)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {isSupplierPartner ? (
            <Link href="/po-import">
              <Button className="gap-2" data-testid="button-add-container">
                <Plus className="h-4 w-4" />
                Import Container
              </Button>
            </Link>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="gap-2" data-testid="button-add-dropdown">
                  <Plus className="h-4 w-4" />
                  Add
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setAddDialogOpen(true)} data-testid="button-add-container">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Container
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild data-testid="button-import-po">
                  <Link href="/po-import" className="flex items-center">
                    <Plus className="h-4 w-4 mr-2" />
                    Import PO
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </PageHeader>

      {/* Stats bar */}
      {!isLoading && allContainers.length > 0 && (
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2 bg-muted/60 rounded-lg px-3 py-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold" data-testid="text-total-containers">
              {allContainers.length.toLocaleString()}
            </span>
            <span className="text-xs text-muted-foreground">Containers</span>
          </div>
          {(() => {
            const otwCount = allContainers.filter((c) => c.status === "OTW").length;
            const arrivedCount = allContainers.filter((c) => c.status === "ARRIVED").length;
            const offloadedCount = allContainers.filter((c) => c.status === "OFFLOADED").length;
            return (
              <>
                {otwCount > 0 && (
                  <div className="flex items-center gap-2 bg-blue-500/10 rounded-lg px-3 py-2">
                    <Truck className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    <span className="text-sm font-semibold text-blue-700 dark:text-blue-300">{otwCount}</span>
                    <span className="text-xs text-muted-foreground">OTW</span>
                  </div>
                )}
                {arrivedCount > 0 && (
                  <div className="flex items-center gap-2 bg-amber-500/10 rounded-lg px-3 py-2">
                    <MapPin className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">{arrivedCount}</span>
                    <span className="text-xs text-muted-foreground">Arrived</span>
                  </div>
                )}
                {offloadedCount > 0 && (
                  <div className="flex items-center gap-2 bg-green-500/10 rounded-lg px-3 py-2">
                    <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                    <span className="text-sm font-semibold text-green-700 dark:text-green-300">{offloadedCount}</span>
                    <span className="text-xs text-muted-foreground">Offloaded</span>
                  </div>
                )}
              </>
            );
          })()}
          {!hideContainerCosts && (
            <div className="flex items-center gap-2 bg-primary/10 rounded-lg px-3 py-2">
              <span className="text-sm font-semibold font-mono text-primary" data-testid="text-total-amount">
                {formatAmount(
                  containers.reduce((sum, c) => {
                    const gTotal = parseFloat(c.grandTotal ?? "0");
                    return sum + (gTotal || parseFloat(c.itemsTotal ?? "0") || 0);
                  }, 0)
                )}
              </span>
              <span className="text-xs text-muted-foreground">total value</span>
            </div>
          )}
        </div>
      )}

      <ContainerFilters
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        statusFilter={statusFilter}
        onStatusChange={setStatusFilter}
        supplierFilter={supplierFilter}
        onSupplierFilterChange={setSupplierFilter}
        suppliers={suppliers}
        getSupplierName={getSupplierName}
        onClearFilters={clearFilters}
      />

      <ActiveContainersTable
        containers={containers}
        allContainers={allContainers}
        isLoading={isLoading}
        hideContainerCosts={hideContainerCosts}
        formatDisplayDate={formatDisplayDate}
        formatAmount={formatAmount}
        editingNumberId={editingNumberId}
        editingNumberValue={editingNumberValue}
        onEditNumberStart={(id, number) => {
          setEditingNumberId(id);
          setEditingNumberValue(number);
        }}
        onEditNumberChange={setEditingNumberValue}
        onEditNumberSave={(id, containerNumber) =>
          editContainerNumberMutation.mutate({ id, containerNumber })
        }
        onEditNumberCancel={() => {
          setEditingNumberId(null);
          setEditingNumberValue("");
        }}
        isEditNumberPending={editContainerNumberMutation.isPending}
        getSupplierName={getSupplierName}
      />

      {activeTab === "otw" && (
        <OtwContainersTable
          filteredOtwContainers={filteredOtwContainers}
          otwContainers={otwContainers}
          otwSearchTerm={otwSearchTerm}
          setOtwSearchTerm={setOtwSearchTerm}
          otwSupplierFilter={otwSupplierFilter}
          setOtwSupplierFilter={setOtwSupplierFilter}
          otwLocationFilter={otwLocationFilter}
          setOtwLocationFilter={setOtwLocationFilter}
          otwTruckFilter={otwTruckFilter}
          setOtwTruckFilter={setOtwTruckFilter}
          otwAgentFilter={otwAgentFilter}
          setOtwAgentFilter={setOtwAgentFilter}
          otwTransporterFilter={otwTransporterFilter}
          setOtwTransporterFilter={setOtwTransporterFilter}
          otwDocReceivedFilter={otwDocReceivedFilter}
          setOtwDocReceivedFilter={setOtwDocReceivedFilter}
          otwFreightStatusFilter={otwFreightStatusFilter}
          setOtwFreightStatusFilter={setOtwFreightStatusFilter}
          otwNotesFilter={otwNotesFilter}
          setOtwNotesFilter={setOtwNotesFilter}
          uniqueOtwLocations={uniqueOtwLocations}
          uniqueOtwSuppliers={uniqueOtwSuppliers}
          uniqueOtwAgents={uniqueOtwAgents}
          uniqueOtwTransporters={uniqueOtwTransporters}
          uniqueOtwTrucks={uniqueOtwTrucks}
          getSupplierName={getSupplierName}
          formatAmount={formatAmount}
          freightStatusMap={freightStatusMap}
          getEditValue={getEditValue}
          setEditValue={setEditValue}
          hasChanges={hasChanges}
          saveTracking={saveTracking}
          savingIds={savingIds}
          handleKeyDown={handleKeyDown}
          autoSizeStyle={autoSizeStyle}
        />
      )}

      {activeTab === "sold" && (
        <SoldContainersTable
          isSoldLoading={isSoldLoading}
          soldContainers={soldContainers}
          filteredSoldContainers={filteredSoldContainers}
          soldSearchTerm={soldSearchTerm}
          setSoldSearchTerm={setSoldSearchTerm}
          formatDisplayDate={formatDisplayDate}
          formatAmount={formatAmount}
        />
      )}

      <AddContainerDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} />

      <AlertDialog open={syncAllConfirmOpen} onOpenChange={setSyncAllConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fix all PO and Parent JV sync?</AlertDialogTitle>
            <AlertDialogDescription>
              This will scan all purchase orders and update only vouchers and totals that are out of sync. It is safe to
              run multiple times.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-sync-all-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-sync-all-confirm"
              onClick={() => {
                setSyncAllConfirmOpen(false);
                syncAllMutation.mutate();
              }}
            >
              Run Sync
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
