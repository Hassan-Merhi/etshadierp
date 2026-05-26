import { useState, useRef, useCallback } from "react";
import { useDebounce } from "@/hooks/use-debounce";
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
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Plus,
  Package,
  Eye,
  Search,
  Filter,
  X,
  Download,
  HandCoins,
  Truck,
  Save,
  Check,
  MapPin,
  Upload,
  FileSpreadsheet,
  Pencil,
  ChevronDown,
  Wrench,
  Loader2,
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useCompany } from "@/contexts/CompanyContext";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { AddContainerDialog } from "../components/AddContainerDialog";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { utils, writeFile, readFile, read, ExcelJS } from "@/lib/excelHelper";
import type { Container, Supplier } from "@shared/schema";

interface SoldContainer {
  containerId: number;
  containerNumber: string;
  supplierId: number;
  status: string;
  importDate: string;
  itemsTotal: string;
  chargesTotal: string;
  grandTotal: string;
  saleId: number;
  customerId: number;
  customerName: string;
  saleDate: string;
  containerCost: string;
  commission: string;
  commissionAccountId: number | null;
  totalAmount: string;
  notes: string | null;
}

interface TrackingEdit {
  [key: number]: Partial<Container>;
}

export default function Containers() {
  const { formatDisplayDate } = useDateFormat();
  const [activeTab, setActiveTab] = useState("active");

  const [searchTerm, setSearchTerm] = useState("");
  const [soldSearchTerm, setSoldSearchTerm] = useState("");
  const [otwSearchTerm, setOtwSearchTerm] = useState("");
  const debouncedSearch = useDebounce(searchTerm, 300);
  const debouncedSoldSearch = useDebounce(soldSearchTerm, 300);
  const debouncedOtwSearch = useDebounce(otwSearchTerm, 300);
  const [statusFilter, setStatusFilter] = useState("OTW");
  const [supplierFilter, setSupplierFilter] = useState("ALL");
  // OTW Tracking filters
  const [otwLocationFilter, setOtwLocationFilter] = useState("ALL");
  const [otwSupplierFilter, setOtwSupplierFilter] = useState("ALL");
  const [otwAgentFilter, setOtwAgentFilter] = useState("ALL");
  const [otwTransporterFilter, setOtwTransporterFilter] = useState("ALL");
  const [otwTruckFilter, setOtwTruckFilter] = useState("ALL");
  const [otwDocReceivedFilter, setOtwDocReceivedFilter] = useState("ALL");
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
  const { data: currentUser } = useQuery<{ role?: string; currentRole?: string | null }>({ queryKey: ["/api/auth/me"] });
  const isPrivilegedRole = ["Admin", "Owner", "Developer"].includes(currentUser?.currentRole || currentUser?.role || "");
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
      if ((data?.updatedFreightVouchers ?? 0) > 0) parts.push(`Freight vouchers fixed: ${data.updatedFreightVouchers}.`);
      if ((data?.updatedContainerCharges ?? 0) > 0) parts.push(`Charge rows fixed: ${data.updatedContainerCharges}.`);
      if ((data?.notFoundParentVouchers?.length ?? 0) > 0) parts.push(`${data.notFoundParentVouchers.length} PO(s) have no parent JV yet — import or re-save those POs to create them.`);
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
  const autoSizeStyle = (
    value: unknown,
    placeholder = "",
    minCh = 10,
    maxCh = 32,
  ) => {
    const text = String((value ?? "") as any) || placeholder || "";
    const ch = Math.max(minCh, Math.min(maxCh, text.length + 2));
    return {
      width: `${ch}ch`,
      minWidth: `${minCh}ch`,
      maxWidth: `${maxCh}ch`,
    } as const;
  };

  const { data: allContainers = [], isLoading } = useQuery<Container[]>({
    queryKey: ["/api/containers/active", selectedCompany?.id],
    enabled: !!selectedCompany?.id,
  });

  const { data: soldContainers = [], isLoading: isSoldLoading } = useQuery<
    SoldContainer[]
  >({
    queryKey: ["/api/containers/sold", selectedCompany?.id],
    enabled: !!selectedCompany?.id && !isSupplierPartner,
  });

  const { data: spContainersList = [], isLoading: spContainersLoading } = useQuery<any[]>({
    queryKey: ["/api/sp/containers"],
    queryFn: () => fetch("/api/sp/containers", { credentials: "include" }).then(r => r.json()),
    enabled: !!selectedCompany?.id && isSupplierPartner,
  });


  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
  });

  const { data: freightStatusMap = {} } = useQuery<Record<number, { totalFreight: number; totalPaid: number; status: string }>>({
    queryKey: ["/api/factory/containers/freight-status"],
    queryFn: async () => {
      const res = await fetch("/api/factory/containers/freight-status");
      if (!res.ok) return {};
      return res.json();
    },
    enabled: !!selectedCompany?.id && isFactory,
  });

  const updateTrackingMutation = useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: number;
      data: Partial<Container>;
    }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/containers/${id}/tracking`,
        data,
      );
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
      if (!res.ok) { const err = await res.json(); throw new Error(err.message); }
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

  const otwContainers = allContainers.filter((c) => c.status === "OTW");

  // Extract unique values for OTW filters
  const uniqueOtwLocations = Array.from(
    new Set(
      otwContainers.map((c) => c.trackingLocation).filter(Boolean) as string[],
    ),
  ).sort();
  const uniqueOtwAgents = Array.from(
    new Set(otwContainers.map((c) => c.agent).filter(Boolean) as string[]),
  ).sort();
  const uniqueOtwTransporters = Array.from(
    new Set(
      otwContainers.map((c) => c.transporter).filter(Boolean) as string[],
    ),
  ).sort();
  const uniqueOtwSuppliers = Array.from(
    new Set(otwContainers.map((c) => c.supplierId)),
  ).sort((a, b) => a - b);
  const uniqueOtwTrucks = Array.from(
    new Set(otwContainers.map((c) => c.numberPlate).filter(Boolean) as string[]),
  ).sort();

  const filteredOtwContainers = otwContainers.filter((c) => {
    // Search filter
    if (debouncedOtwSearch) {
      const search = (debouncedOtwSearch || "").toLowerCase();
      if (
        !(
          (c.containerNumber || "").toLowerCase().includes(search) ||
          (c.shopName?.toLowerCase() || "").includes(search) ||
          (c.agent?.toLowerCase() || "").includes(search)
        )
      ) {
        return false;
      }
    }
    // Location filter
    if (
      otwLocationFilter !== "ALL" &&
      (c.trackingLocation || "") !== otwLocationFilter
    ) {
      return false;
    }
    // Supplier filter
    if (
      otwSupplierFilter !== "ALL" &&
      c.supplierId.toString() !== otwSupplierFilter
    ) {
      return false;
    }
    // Agent filter
    if (otwAgentFilter !== "ALL" && (c.agent || "") !== otwAgentFilter) {
      return false;
    }
    // Transporter filter
    if (
      otwTransporterFilter !== "ALL" &&
      (c.transporter || "") !== otwTransporterFilter
    ) {
      return false;
    }
    // Truck # filter
    if (otwTruckFilter !== "ALL" && (c.numberPlate || "") !== otwTruckFilter) {
      return false;
    }
    // Doc Received filter
    if (otwDocReceivedFilter !== "ALL") {
      const docValue = c.docReceived === true;
      if (otwDocReceivedFilter === "YES" && !docValue) return false;
      if (otwDocReceivedFilter === "NO" && docValue) return false;
    }
    return true;
  });

  const filteredSoldContainers = soldContainers.filter((sale) => {
    if (!debouncedSoldSearch) return true;
    const searchLower = (debouncedSoldSearch || "").toLowerCase();
    return (
      (sale.containerNumber || "").toLowerCase().includes(searchLower) ||
      (sale.customerName || "").toLowerCase().includes(searchLower)
    );
  });

  const containers = allContainers.filter((c) => {
    if (
      debouncedSearch &&
      !(c.containerNumber || "")
        .toLowerCase()
        .includes((debouncedSearch || "").toLowerCase())
    ) {
      return false;
    }
    if (statusFilter !== "ALL" && c.status !== statusFilter) {
      return false;
    }
    if (
      supplierFilter !== "ALL" &&
      c.supplierId.toString() !== supplierFilter
    ) {
      return false;
    }
    return true;
  });

  const getSupplierName = (supplierId: number) => {
    const supplier = suppliers.find((s) => s.id === supplierId);
    return supplier ? supplier.legalName : "Unknown";
  };

  const clearFilters = async () => {
    setStatusFilter("ALL");
    setSupplierFilter("ALL");
    setSearchTerm("");
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
    if (!navigator.onLine) { toast({ title: "Not available offline", description: "Exports require a connection", variant: "destructive" }); return; }
    try {
      const response = await fetch("/api/containers/export-all");
      if (!response.ok) throw new Error("Export failed");

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `containers_full_export_${new Date().toLocaleDateString('en-CA')}.xlsx`;
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

  // Safely extract a primitive value from an ExcelJS cell (which can return rich objects)
  const cellVal = (value: any): any => {
    if (value === null || value === undefined) return "";
    if (typeof value !== "object") return value;
    if (value instanceof Date) return value;
    // Formula cell: { result, formula }
    if ("result" in value) return value.result ?? "";
    // Rich-text cell: { richText: [...] }
    if ("richText" in value && Array.isArray(value.richText))
      return value.richText.map((r: any) => r.text ?? "").join("");
    // Shared-string / cell-model: { text }
    if ("text" in value) return value.text ?? "";
    // Hyperlink cell: { text, hyperlink }
    if ("hyperlink" in value) return value.text ?? "";
    return "";
  };

  const cellStr = (value: any): string => {
    const v = cellVal(value);
    if (v === null || v === undefined) return "";
    return String(v);
  };

  const cellNum = (value: any): string => {
    const v = cellVal(value);
    if (v === null || v === undefined || v === "") return "";
    const n = parseFloat(String(v).replace(/,/g, ""));
    return isNaN(n) ? "" : String(n);
  };

  const excelDateToString = (value: any): string => {
    if (!value) return "";

    const toYMD = (d: Date): string => {
      const y = d.getFullYear();
      const m = (d.getMonth() + 1).toString().padStart(2, "0");
      const day = d.getDate().toString().padStart(2, "0");
      return `${y}-${m}-${day}`;
    };

    // JavaScript Date object (ExcelJS returns these for date cells)
    if (value instanceof Date) {
      return isNaN(value.getTime()) ? "" : toYMD(value);
    }

    // ExcelJS cell-model object that has a 'result' property
    if (typeof value === "object" && value !== null) {
      if ("result" in value && value.result instanceof Date) return toYMD(value.result);
      if ("text" in value) return excelDateToString(value.text);
      return "";
    }

    // Excel serial number (integer days since Dec 30 1899)
    const num = Number(value);
    if (!isNaN(num) && num > 40000 && num < 60000) {
      const excelEpoch = new Date(1899, 11, 30);
      return toYMD(new Date(excelEpoch.getTime() + num * 24 * 60 * 60 * 1000));
    }

    // String: try to normalise common formats to YYYY-MM-DD
    if (typeof value === "string") {
      const s = value.trim();
      if (!s) return "";
      // Already YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      // MM/DD/YY  or  MM/DD/YYYY
      const slashMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
      if (slashMatch) {
        const [, m, d, yRaw] = slashMatch;
        const y = yRaw.length === 2 ? (parseInt(yRaw) >= 50 ? `19${yRaw}` : `20${yRaw}`) : yRaw;
        return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
      }
      // DD-MM-YYYY or DD/MM/YYYY (European style — less common but possible)
      // Try native Date parse as last resort
      const parsed = new Date(s);
      if (!isNaN(parsed.getTime())) return toYMD(parsed);
      return s;
    }

    return "";
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
        throw new Error(
          "The Excel file is empty. Please add data rows and try again.",
        );
      }

      // Read header row explicitly to get all column names (avoids issues with blank first-row cells)
      const headerRow =
        utils.sheet_to_json<string[]>(sheet, { header: 1 })[0] || [];
      const columns = headerRow.map((h) => String(h || "").trim());

      // Check for Container # column (required for matching)
      const containerColAliases = [
        "Container #",
        "Container Number",
        "containerNumber",
      ];
      const hasContainerCol = containerColAliases.some((alias) =>
        columns.includes(alias),
      );

      if (!hasContainerCol) {
        throw new Error(
          `Missing required column: "Container #"\n\n` +
            `Expected columns: Container #, Shop, ETA, Transporter, etc.\n` +
            `Found columns: ${columns.slice(0, 5).join(", ")}${columns.length > 5 ? "..." : ""}\n\n` +
            `Tip: Download the template to see the expected format.`,
        );
      }

      // Map Excel columns to API fields (convert Excel date serials to strings)
      const rows = jsonData.map((row: any) => ({
        containerNumber: cellStr(
          row["Container #"] ||
            row["Container Number"] ||
            row["containerNumber"],
        ),
        shopName: cellStr(row["Shop"] || row["Shop Name"] || row["shopName"]),
        eta: excelDateToString(cellVal(row["ETA"] || row["eta"])),
        transporter: cellStr(row["Transporter"] || row["transporter"]),
        transportFee: cellNum(row["Transport Fee"] || row["transportFee"]),
        numberPlate: cellStr(
          row["Number Plate"] || row["Plate"] || row["numberPlate"],
        ),
        trackingLocation: cellStr(
          row["Location"] || row["trackingLocation"],
        ),
        borderDate: excelDateToString(cellVal(row["Border Date"] || row["borderDate"])),
        offloadDate: excelDateToString(cellVal(
          row["Offload Date"] || row["offloadDate"],
        )),
        agent: cellStr(row["Agent"] || row["agent"]),
        dutyFee: cellNum(row["Duty Fee"] || row["dutyFee"]),
        docReceived: cellStr(row["Doc Received"] || row["docReceived"]),
        trackingDescription: cellStr(
          row["Description"] || row["trackingDescription"],
        ),
      }));

      const response = await apiRequest(
        "POST",
        "/api/containers/tracking/import",
        { rows },
      );
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
    if (
      trackingEdits[container.id] &&
      trackingEdits[container.id][field] !== undefined
    ) {
      return trackingEdits[container.id][field];
    }
    return container[field];
  };

  const setEditValue = async (
    containerId: number,
    field: keyof Container,
    value: any,
  ) => {
    setTrackingEdits((prev) => ({
      ...prev,
      [containerId]: {
        ...prev[containerId],
        [field]: value,
      },
    }));
  };

  const hasChanges = (containerId: number) => {
    return (
      trackingEdits[containerId] &&
      Object.keys(trackingEdits[containerId]).length > 0
    );
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
      const containerIndex = filteredOtwContainers.findIndex(
        (c) => c.id === containerId,
      );
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
    [filteredOtwContainers, trackingFields, hasChanges, saveTracking],
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
    const spNative: any[] = (Array.isArray(spContainersList) ? spContainersList : []).map(c => ({
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
    const erpNormalized: any[] = allContainers.map(c => {
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
    const filtered = allSpItems.filter(c =>
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
            <Button
              className="gap-2"
              onClick={() => setAddDialogOpen(true)}
              data-testid="button-add-container"
            >
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
              onChange={e => setSearchTerm(e.target.value)}
              className="pl-10"
              data-testid="input-search-container"
            />
          </div>
          {searchTerm && (
            <Button variant="ghost" size="sm" onClick={() => setSearchTerm("")} data-testid="button-clear-search">
              <X className="h-4 w-4 mr-1" />Clear
            </Button>
          )}
        </div>

        {isSpLoading ? (
          <div className="space-y-3">
            {[1,2,3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <Package className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">
              {allSpItems.length === 0 ? "No containers yet. Click Import Container to add one." : "No containers match your search."}
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
                    {c.subName && (
                      <span className="text-xs text-muted-foreground font-mono">{c.subName}</span>
                    )}
                    <Badge
                      variant="outline"
                      className={c.statusOffloaded ? "text-green-600 border-green-600/40" : "text-blue-600 border-blue-600/40"}
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
                  onClick={e => e.stopPropagation()}
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
      <PageHeader
        title="Container Tracking"
        subtitle="Track containers and manage offloading"
      >
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
            <span className="text-sm font-semibold" data-testid="text-total-containers">{allContainers.length.toLocaleString()}</span>
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

      {/* Inline filter row */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by container number..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
            data-testid="input-search-container"
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          {(["ALL", "OTW", "ARRIVED", "OFFLOADED"] as const).map((s) => (
            <Button
              key={s}
              size="sm"
              variant={statusFilter === s ? "default" : "outline"}
              onClick={() => setStatusFilter(s)}
              data-testid={`button-status-${s.toLowerCase()}`}
            >
              {s === "ALL" ? "All" : s === "OTW" ? "OTW" : s === "ARRIVED" ? "Arrived" : "Offloaded"}
            </Button>
          ))}
        </div>
        {suppliers.length > 0 && (
          <Select value={supplierFilter} onValueChange={setSupplierFilter}>
            <SelectTrigger className="w-[160px]" data-testid="select-supplier-filter">
              <SelectValue placeholder="All suppliers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Suppliers</SelectItem>
              {suppliers.map((supplier) => (
                <SelectItem key={supplier.id} value={supplier.id.toString()}>
                  {supplier.legalName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {(statusFilter !== "ALL" || supplierFilter !== "ALL" || searchTerm) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { clearFilters(); setSearchTerm(""); }}
            data-testid="button-clear-filters"
          >
            <X className="h-4 w-4 mr-1" />
            Clear
          </Button>
        )}
      </div>

      {/* Container list */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : containers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-xl bg-muted/60 flex items-center justify-center mb-4">
            <Package className="w-7 h-7 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold mb-1">No containers found</h2>
          <p className="text-sm text-muted-foreground mb-4">
            {allContainers.length === 0
              ? "Import your first purchase order to get started"
              : "Try adjusting your search or filters"}
          </p>
          {allContainers.length === 0 && (
            <Link href="/po-import">
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Import PO
              </Button>
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {containers.map((container) => {
            const statusColors: Record<string, string> = {
              OTW: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-transparent",
              ARRIVED: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-transparent",
              OFFLOADED: "bg-green-500/10 text-green-700 dark:text-green-300 border-transparent",
            };
            return (
              <div
                key={container.id}
                className="bg-card border rounded-xl p-4 flex items-center gap-4 hover-elevate"
                data-testid={`row-container-${container.id}`}
              >
                <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Package className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {editingNumberId === container.id ? (
                      <div className="flex items-center gap-1">
                        <Input
                          className="h-7 w-36 font-mono text-xs px-2"
                          value={editingNumberValue}
                          onChange={(e) => setEditingNumberValue(e.target.value.toUpperCase())}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") editContainerNumberMutation.mutate({ id: container.id, containerNumber: editingNumberValue });
                            if (e.key === "Escape") { setEditingNumberId(null); setEditingNumberValue(""); }
                          }}
                          autoFocus
                          data-testid={`input-container-number-${container.id}`}
                        />
                        <Button size="icon" variant="ghost" onClick={() => editContainerNumberMutation.mutate({ id: container.id, containerNumber: editingNumberValue })} disabled={editContainerNumberMutation.isPending} data-testid={`button-save-number-${container.id}`}>
                          <Check className="h-3 w-3" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => { setEditingNumberId(null); setEditingNumberValue(""); }} data-testid={`button-cancel-number-${container.id}`}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 group">
                        <span className="font-mono font-semibold text-sm">{container.containerNumber}</span>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => { e.stopPropagation(); setEditingNumberId(container.id); setEditingNumberValue(container.containerNumber); }}
                          data-testid={`button-edit-number-${container.id}`}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                    <Badge className={statusColors[container.status] || "border-transparent"} data-testid={`badge-status-${container.id}`}>
                      {container.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{getSupplierName(container.supplierId)}</p>
                </div>
                <div className="flex items-center gap-4 flex-shrink-0">
                  <div className="text-right hidden sm:block">
                    <p className="text-xs text-muted-foreground">Import date</p>
                    <p className="text-sm font-mono">{formatDisplayDate(container.importDate)}</p>
                  </div>
                  {!hideContainerCosts && (
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground hidden sm:block">Total</p>
                      <p className="text-sm font-mono font-semibold">{formatAmount(parseFloat(container.grandTotal || "0"))}</p>
                    </div>
                  )}
                  <Link href={`/containers/${container.id}`}>
                    <Button size="sm" variant="outline" onClick={(e) => e.stopPropagation()} data-testid={`button-view-${container.id}`}>
                      <Eye className="h-4 w-4 mr-1" />
                      View
                    </Button>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

          {activeTab === "otw" && (
          <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by container, shop, or agent..."
                value={otwSearchTerm}
                onChange={(e) => setOtwSearchTerm(e.target.value)}
                className="pl-10"
                data-testid="input-search-otw"
              />
            </div>
            <Select
              value={otwSupplierFilter}
              onValueChange={setOtwSupplierFilter}
            >
              <SelectTrigger
                className="w-full sm:w-[130px]"
                data-testid="select-otw-supplier"
              >
                <SelectValue placeholder="Supplier" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Suppliers</SelectItem>
                {uniqueOtwSuppliers.map((id) => (
                  <SelectItem key={id} value={id.toString()}>
                    {getSupplierName(id)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={otwLocationFilter}
              onValueChange={setOtwLocationFilter}
            >
              <SelectTrigger
                className="w-full sm:w-[130px]"
                data-testid="select-otw-location"
              >
                <SelectValue placeholder="Location" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Locations</SelectItem>
                {uniqueOtwLocations.map((loc) => (
                  <SelectItem key={loc} value={loc}>
                    {loc}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={otwTruckFilter} onValueChange={setOtwTruckFilter}>
              <SelectTrigger
                className="w-full sm:w-[120px]"
                data-testid="select-otw-truck"
              >
                <SelectValue placeholder="Truck #" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Trucks</SelectItem>
                {uniqueOtwTrucks.map((truck) => (
                  <SelectItem key={truck} value={truck}>
                    {truck}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={otwAgentFilter} onValueChange={setOtwAgentFilter}>
              <SelectTrigger
                className="w-full sm:w-[100px]"
                data-testid="select-otw-agent"
              >
                <SelectValue placeholder="Agent" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Agents</SelectItem>
                {uniqueOtwAgents.map((agent) => (
                  <SelectItem key={agent} value={agent}>
                    {agent}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={otwTransporterFilter}
              onValueChange={setOtwTransporterFilter}
            >
              <SelectTrigger
                className="w-full sm:w-[120px]"
                data-testid="select-otw-transporter"
              >
                <SelectValue placeholder="Transporter" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Transporters</SelectItem>
                {uniqueOtwTransporters.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={otwDocReceivedFilter}
              onValueChange={setOtwDocReceivedFilter}
            >
              <SelectTrigger className="w-full sm:w-[100px]" data-testid="select-otw-doc">
                <SelectValue placeholder="Doc" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Docs</SelectItem>
                <SelectItem value="YES">Doc Received</SelectItem>
                <SelectItem value="NO">No Doc</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {filteredOtwContainers.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Truck className="w-16 h-16 text-muted-foreground mb-4" />
                <h2 className="text-xl font-semibold mb-2">
                  No OTW containers
                </h2>
                <p className="text-muted-foreground">
                  {otwContainers.length === 0
                    ? "All containers have arrived or been offloaded"
                    : "No containers match your search"}
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader className="sticky top-0 z-30 bg-background">
                    <TableRow>
                      <TableHead className="whitespace-nowrap">
                        Container #
                      </TableHead>
                      <TableHead className="whitespace-nowrap">
                        Supplier
                      </TableHead>
                      <TableHead className="whitespace-nowrap">
                        Amount
                      </TableHead>
                      <TableHead className="whitespace-nowrap min-w-[100px]">
                        Shop
                      </TableHead>
                      <TableHead className="whitespace-nowrap min-w-[130px]">
                        ETA
                      </TableHead>
                      <TableHead className="whitespace-nowrap min-w-[120px]">
                        Transporter
                      </TableHead>
                      <TableHead className="whitespace-nowrap min-w-[80px]">
                        Fee
                      </TableHead>
                      <TableHead className="whitespace-nowrap min-w-[100px]">
                        Plate
                      </TableHead>
                      <TableHead className="whitespace-nowrap min-w-[120px]">
                        Location
                      </TableHead>
                      <TableHead className="whitespace-nowrap min-w-[130px]">
                        Border
                      </TableHead>
                      <TableHead className="whitespace-nowrap min-w-[130px]">
                        Offload
                      </TableHead>
                      <TableHead className="whitespace-nowrap min-w-[80px]">
                        Agent
                      </TableHead>
                      <TableHead className="whitespace-nowrap min-w-[80px]">
                        Duty
                      </TableHead>
                      <TableHead className="whitespace-nowrap">Doc</TableHead>
                      <TableHead className="whitespace-nowrap">Freight</TableHead>
                      <TableHead className="whitespace-nowrap min-w-[150px]">
                        Description
                      </TableHead>
                      <TableHead className="whitespace-nowrap min-w-[130px]">
                        Docs Sent
                      </TableHead>
                      <TableHead className="whitespace-nowrap min-w-[110px]">
                        Freight (GIT)
                      </TableHead>
                      <TableHead className="whitespace-nowrap min-w-[160px]">
                        Link
                      </TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOtwContainers.map((container) => (
                      <TableRow
                        key={container.id}
                        data-testid={`row-otw-${container.id}`}
                      >
                        <TableCell className="font-mono font-medium">
                          <Link
                            href={`/containers/${container.id}`}
                            className="text-primary hover:underline"
                          >
                            {container.containerNumber}
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm">
                          {getSupplierName(container.supplierId)}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {formatAmount(
                            parseFloat(container.grandTotal || "0")
                          )}
                        </TableCell>
                        <TableCell>
                          <Input
                            id={`tracking-${container.id}-shopName`}
                            value={
                              (getEditValue(container, "shopName") as string) ||
                              ""
                            }
                            onChange={(e) =>
                              setEditValue(
                                container.id,
                                "shopName",
                                e.target.value,
                              )
                            }
                            onKeyDown={(e) => handleKeyDown(e, container.id, 0)}
                            style={autoSizeStyle(
                              getEditValue(container, "shopName"),
                              "Shop",
                              6,
                              16,
                            )}
                            className="h-8 text-sm w-auto"
                            placeholder="Shop"
                            data-testid={`input-shop-${container.id}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            id={`tracking-${container.id}-eta`}
                            type="date"
                            value={
                              (getEditValue(container, "eta") as string) || ""
                            }
                            onChange={(e) =>
                              setEditValue(container.id, "eta", e.target.value)
                            }
                            onKeyDown={(e) => handleKeyDown(e, container.id, 1)}
                            style={autoSizeStyle(
                              getEditValue(container, "eta"),
                              "yyyy-mm-dd",
                              12,
                              12,
                            )}
                            className="h-8 text-sm w-auto"
                            data-testid={`input-eta-${container.id}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            id={`tracking-${container.id}-transporter`}
                            value={
                              (getEditValue(
                                container,
                                "transporter",
                              ) as string) || ""
                            }
                            onChange={(e) =>
                              setEditValue(
                                container.id,
                                "transporter",
                                e.target.value,
                              )
                            }
                            onKeyDown={(e) => handleKeyDown(e, container.id, 2)}
                            style={autoSizeStyle(
                              getEditValue(container, "transporter"),
                              "Transporter",
                              12,
                              40,
                            )}
                            className="h-8 text-sm w-auto"
                            placeholder="Transporter"
                            data-testid={`input-transporter-${container.id}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            id={`tracking-${container.id}-transportFee`}
                            type="number"
                            value={
                              (getEditValue(
                                container,
                                "transportFee",
                              ) as string) || ""
                            }
                            onChange={(e) =>
                              setEditValue(
                                container.id,
                                "transportFee",
                                e.target.value,
                              )
                            }
                            onKeyDown={(e) => handleKeyDown(e, container.id, 3)}
                            style={autoSizeStyle(
                              getEditValue(container, "transportFee"),
                              "0.00",
                            )}
                            className="h-8 text-sm w-auto"
                            placeholder="0.00"
                            data-testid={`input-transport-${container.id}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            id={`tracking-${container.id}-numberPlate`}
                            value={
                              (getEditValue(
                                container,
                                "numberPlate",
                              ) as string) || ""
                            }
                            onChange={(e) =>
                              setEditValue(
                                container.id,
                                "numberPlate",
                                e.target.value,
                              )
                            }
                            onKeyDown={(e) => handleKeyDown(e, container.id, 4)}
                            style={autoSizeStyle(
                              getEditValue(container, "numberPlate"),
                              "Plate",
                              10,
                              20,
                            )}
                            className="h-8 text-sm w-auto"
                            placeholder="Plate"
                            data-testid={`input-plate-${container.id}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            id={`tracking-${container.id}-trackingLocation`}
                            value={
                              (getEditValue(
                                container,
                                "trackingLocation",
                              ) as string) || ""
                            }
                            onChange={(e) =>
                              setEditValue(
                                container.id,
                                "trackingLocation",
                                e.target.value,
                              )
                            }
                            onKeyDown={(e) => handleKeyDown(e, container.id, 5)}
                            style={autoSizeStyle(
                              getEditValue(container, "trackingLocation"),
                              "Location",
                              12,
                              40,
                            )}
                            className="h-8 text-sm w-auto"
                            placeholder="Location"
                            data-testid={`input-location-${container.id}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            id={`tracking-${container.id}-borderDate`}
                            type="date"
                            value={
                              (getEditValue(
                                container,
                                "borderDate",
                              ) as string) || ""
                            }
                            onChange={(e) =>
                              setEditValue(
                                container.id,
                                "borderDate",
                                e.target.value,
                              )
                            }
                            onKeyDown={(e) => handleKeyDown(e, container.id, 6)}
                            style={autoSizeStyle(
                              getEditValue(container, "borderDate"),
                              "yyyy-mm-dd",
                              12,
                              12,
                            )}
                            className="h-8 text-sm w-auto"
                            data-testid={`input-border-${container.id}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            id={`tracking-${container.id}-offloadDate`}
                            type="date"
                            value={
                              (getEditValue(
                                container,
                                "offloadDate",
                              ) as string) || ""
                            }
                            onChange={(e) =>
                              setEditValue(
                                container.id,
                                "offloadDate",
                                e.target.value,
                              )
                            }
                            onKeyDown={(e) => handleKeyDown(e, container.id, 7)}
                            style={autoSizeStyle(
                              getEditValue(container, "offloadDate"),
                              "yyyy-mm-dd",
                              12,
                              12,
                            )}
                            className="h-8 text-sm w-auto"
                            data-testid={`input-offload-${container.id}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            id={`tracking-${container.id}-agent`}
                            value={
                              (getEditValue(container, "agent") as string) || ""
                            }
                            onChange={(e) =>
                              setEditValue(
                                container.id,
                                "agent",
                                e.target.value,
                              )
                            }
                            onKeyDown={(e) => handleKeyDown(e, container.id, 8)}
                            style={autoSizeStyle(
                              getEditValue(container, "agent"),
                              "Agent",
                            )}
                            className="h-8 text-sm w-auto"
                            placeholder="Agent"
                            data-testid={`input-agent-${container.id}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            id={`tracking-${container.id}-dutyFee`}
                            type="number"
                            value={
                              (getEditValue(container, "dutyFee") as string) ||
                              ""
                            }
                            onChange={(e) =>
                              setEditValue(
                                container.id,
                                "dutyFee",
                                e.target.value,
                              )
                            }
                            onKeyDown={(e) => handleKeyDown(e, container.id, 9)}
                            style={autoSizeStyle(
                              getEditValue(container, "dutyFee"),
                              "0.00",
                            )}
                            className="h-8 text-sm w-auto"
                            placeholder="0.00"
                            data-testid={`input-duty-${container.id}`}
                          />
                        </TableCell>
                        <TableCell className="text-center">
                          <Checkbox
                            id={`tracking-${container.id}-docReceived`}
                            checked={!!getEditValue(container, "docReceived")}
                            onCheckedChange={(checked) =>
                              setEditValue(
                                container.id,
                                "docReceived",
                                !!checked,
                              )
                            }
                            data-testid={`checkbox-doc-${container.id}`}
                          />
                        </TableCell>
                        <TableCell>
                          {(() => {
                            const fs = freightStatusMap[container.id];
                            if (!fs || fs.status === "NONE") return <span className="text-xs text-muted-foreground">--</span>;
                            return (
                              <Badge variant={fs.status === "PAID" ? "default" : fs.status === "PARTIAL" ? "secondary" : "destructive"} data-testid={`badge-freight-${container.id}`}>
                                {fs.status}
                              </Badge>
                            );
                          })()}
                        </TableCell>
                        <TableCell>
                          <Input
                            id={`tracking-${container.id}-trackingDescription`}
                            value={
                              (getEditValue(
                                container,
                                "trackingDescription",
                              ) as string) || ""
                            }
                            onChange={(e) =>
                              setEditValue(
                                container.id,
                                "trackingDescription",
                                e.target.value,
                              )
                            }
                            onKeyDown={(e) =>
                              handleKeyDown(e, container.id, 11)
                            }
                            style={autoSizeStyle(
                              getEditValue(container, "trackingDescription"),
                              "Notes...",
                              10,
                              32,
                            )}
                            className="h-8 text-sm w-auto"
                            placeholder="Notes..."
                            data-testid={`input-desc-${container.id}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            id={`tracking-${container.id}-docsSentDate`}
                            type="date"
                            value={
                              (getEditValue(
                                container,
                                "docsSentDate",
                              ) as string) || ""
                            }
                            onChange={(e) =>
                              setEditValue(
                                container.id,
                                "docsSentDate",
                                e.target.value,
                              )
                            }
                            onKeyDown={(e) =>
                              handleKeyDown(e, container.id, 12)
                            }
                            style={autoSizeStyle(
                              getEditValue(container, "docsSentDate"),
                              "yyyy-mm-dd",
                              12,
                              12,
                            )}
                            className="h-8 text-sm w-auto"
                            data-testid={`input-docs-sent-${container.id}`}
                          />
                        </TableCell>
                        <TableCell>
                          <select
                            id={`tracking-${container.id}-freightStatus`}
                            value={
                              (getEditValue(
                                container,
                                "freightStatus",
                              ) as string) || ""
                            }
                            onChange={(e) =>
                              setEditValue(
                                container.id,
                                "freightStatus",
                                e.target.value || null,
                              )
                            }
                            className="h-8 text-sm rounded-md border border-input bg-background px-2 py-1"
                            data-testid={`select-freight-git-${container.id}`}
                          >
                            <option value="">—</option>
                            <option value="Yes">Yes</option>
                            <option value="No">No</option>
                            <option value="Pending">Pending</option>
                          </select>
                        </TableCell>
                        <TableCell>
                          <Input
                            id={`tracking-${container.id}-trackingLink`}
                            value={
                              (getEditValue(
                                container,
                                "trackingLink",
                              ) as string) || ""
                            }
                            onChange={(e) =>
                              setEditValue(
                                container.id,
                                "trackingLink",
                                e.target.value,
                              )
                            }
                            onKeyDown={(e) =>
                              handleKeyDown(e, container.id, 13)
                            }
                            style={autoSizeStyle(
                              getEditValue(container, "trackingLink"),
                              "https://...",
                              12,
                              32,
                            )}
                            className="h-8 text-sm w-auto"
                            placeholder="https://..."
                            data-testid={`input-link-${container.id}`}
                          />
                        </TableCell>
                        <TableCell>
                          {hasChanges(container.id) && (
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => saveTracking(container.id)}
                              disabled={savingIds.has(container.id)}
                              data-testid={`button-save-${container.id}`}
                            >
                              {savingIds.has(container.id) ? (
                                <span className="animate-spin">...</span>
                              ) : (
                                <Check className="h-4 w-4 text-green-600" />
                              )}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
          </div>
          )}

          {activeTab === "sold" && (
          <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by container number or customer..."
              value={soldSearchTerm}
              onChange={(e) => setSoldSearchTerm(e.target.value)}
              className="pl-10"
              data-testid="input-search-sold-containers"
            />
          </div>

          {isSoldLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-96 w-full" />
            </div>
          ) : filteredSoldContainers.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <HandCoins className="w-16 h-16 text-muted-foreground mb-4" />
                <h2 className="text-xl font-semibold mb-2">
                  No sold containers found
                </h2>
                <p className="text-muted-foreground">
                  {soldContainers.length === 0
                    ? "No containers have been sold yet"
                    : "Try adjusting your search"}
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0 hidden md:block">
                <Table>
                  <TableHeader className="sticky top-0 z-30 bg-background">
                    <TableRow>
                      <TableHead>Container Number</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Sale Date</TableHead>
                      <TableHead className="text-right">
                        Container Cost
                      </TableHead>
                      <TableHead className="text-right">Commission</TableHead>
                      <TableHead className="text-right">Total Amount</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredSoldContainers.map((sale) => (
                      <TableRow
                        key={sale.saleId}
                        data-testid={`row-sale-${sale.saleId}`}
                      >
                        <TableCell className="font-mono font-medium">
                          {sale.containerNumber}
                        </TableCell>
                        <TableCell data-testid={`text-customer-${sale.saleId}`}>
                          {sale.customerName}
                        </TableCell>
                        <TableCell
                          className="font-mono"
                          data-testid={`text-sale-date-${sale.saleId}`}
                        >
                          {formatDisplayDate(sale.saleDate)}
                        </TableCell>
                        <TableCell
                          className="text-right font-mono"
                          data-testid={`text-sale-price-${sale.saleId}`}
                        >
                          {formatAmount(
                            parseFloat(sale.containerCost)
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatAmount(
                            parseFloat(sale.commission || "0")
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold">
                          {formatAmount(
                            parseFloat(sale.totalAmount)
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Link href={`/containers/${sale.containerId}`}>
                            <Button
                              size="sm"
                              variant="outline"
                              data-testid={`button-view-sale-${sale.saleId}`}
                            >
                              <Eye className="h-4 w-4 mr-2" />
                              View
                            </Button>
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
              <div className="md:hidden p-3 space-y-2">
                {filteredSoldContainers.map((sale) => (
                  <Link key={sale.saleId} href={`/containers/${sale.containerId}`}>
                    <div
                      className="p-3 rounded-md border cursor-pointer hover-elevate"
                      data-testid={`row-sale-${sale.saleId}`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-mono font-medium text-sm">{sale.containerNumber}</span>
                        <span className="text-xs text-muted-foreground" data-testid={`text-sale-date-${sale.saleId}`}>
                          {formatDisplayDate(sale.saleDate)}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mb-1" data-testid={`text-customer-${sale.saleId}`}>
                        {sale.customerName}
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="font-mono font-semibold" data-testid={`text-sale-price-${sale.saleId}`}>
                          {formatAmount(parseFloat(sale.totalAmount))}
                        </span>
                        {parseFloat(sale.commission || "0") > 0 && (
                          <span className="text-xs text-muted-foreground">
                            Commission: {formatAmount(parseFloat(sale.commission || "0"))}
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </Card>
          )}
          </div>
          )}

      <AddContainerDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
      />

      <AlertDialog open={syncAllConfirmOpen} onOpenChange={setSyncAllConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fix all PO and Parent JV sync?</AlertDialogTitle>
            <AlertDialogDescription>
              This will scan all purchase orders and update only vouchers and totals that are out of sync. It is safe to run multiple times.
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
