import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { Link } from "wouter";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { LucideIcon } from "lucide-react";
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

  const sidebarGroups: { label: string; items: { key: string; label: string; icon: LucideIcon }[] }[] = [
    {
      label: "Containers",
      items: [
        { key: "active", label: "Active Containers", icon: Package },
      ],
    },
  ];

  const [searchTerm, setSearchTerm] = useState("");
  const [soldSearchTerm, setSoldSearchTerm] = useState("");
  const [otwSearchTerm, setOtwSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("OTW");
  const [supplierFilter, setSupplierFilter] = useState("ALL");
  const [showFilters, setShowFilters] = useState(false);
  // OTW Tracking filters
  const [otwLocationFilter, setOtwLocationFilter] = useState("ALL");
  const [otwSupplierFilter, setOtwSupplierFilter] = useState("ALL");
  const [otwAgentFilter, setOtwAgentFilter] = useState("ALL");
  const [otwTransporterFilter, setOtwTransporterFilter] = useState("ALL");
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
  const tableRef = useRef<HTMLTableElement>(null);
  const { data: myErpPages } = useQuery<{ hiddenErpCostFields?: string[] }>({ queryKey: ["/api/my-erp-pages"] });
  const hideContainerCosts = (myErpPages?.hiddenErpCostFields ?? []).includes("container_costs");

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
    enabled: !!selectedCompany?.id,
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
    enabled: !!selectedCompany?.id,
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

  const filteredOtwContainers = otwContainers.filter((c) => {
    // Search filter
    if (otwSearchTerm) {
      const search = (otwSearchTerm || "").toLowerCase();
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
    // Doc Received filter
    if (otwDocReceivedFilter !== "ALL") {
      const docValue = c.docReceived === true;
      if (otwDocReceivedFilter === "YES" && !docValue) return false;
      if (otwDocReceivedFilter === "NO" && docValue) return false;
    }
    return true;
  });

  const filteredSoldContainers = soldContainers.filter((sale) => {
    if (!soldSearchTerm) return true;
    const searchLower = (soldSearchTerm || "").toLowerCase();
    return (
      (sale.containerNumber || "").toLowerCase().includes(searchLower) ||
      (sale.customerName || "").toLowerCase().includes(searchLower)
    );
  });

  const containers = allContainers.filter((c) => {
    if (
      searchTerm &&
      !(c.containerNumber || "")
        .toLowerCase()
        .includes((searchTerm || "").toLowerCase())
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

  if (isLoading) {
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

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Container Tracking"
        subtitle="Track containers and manage offloading"
      >
        {activeTab === "active" && (
          <div className="flex gap-2 flex-wrap">
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
          </div>
        )}
      </PageHeader>

      {/* Mobile section selector */}
      <div className="md:hidden">
        <Select value={activeTab} onValueChange={setActiveTab}>
          <SelectTrigger className="w-full" data-testid="select-container-section">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sidebarGroups.flatMap((g) => g.items).map((item) => {
              const Icon = item.icon;
              return (
                <SelectItem key={item.key} value={item.key}>
                  <span className="flex items-center gap-2">
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-6">
        <nav className="hidden md:block w-56 shrink-0 space-y-4">
          {sidebarGroups.map((group) => (
            <div key={group.label}>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-3">
                {group.label}
              </h3>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.key;
                  return (
                    <button
                      key={item.key}
                      onClick={() => setActiveTab(item.key)}
                      data-testid={`tab-${item.key === "active" ? "active-containers" : item.key === "otw" ? "otw-tracking" : "sold-containers"}`}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors ${
                        isActive
                          ? "bg-background shadow-sm font-medium"
                          : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="flex-1 min-w-0">
          {activeTab === "active" && (
          <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
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
            <Popover open={showFilters} onOpenChange={setShowFilters}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="gap-2"
                  data-testid="button-filter"
                >
                  <Filter className="h-4 w-4" />
                  Filter
                  {(statusFilter !== "ALL" || supplierFilter !== "ALL") && (
                    <Badge
                      variant="secondary"
                      className="ml-1 px-1 min-w-5 h-5"
                    >
                      {
                        [
                          statusFilter !== "ALL",
                          supplierFilter !== "ALL",
                        ].filter(Boolean).length
                      }
                    </Badge>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80" data-testid="popover-filters">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium">Filters</h4>
                    {(statusFilter !== "ALL" || supplierFilter !== "ALL") && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={clearFilters}
                        data-testid="button-clear-filters"
                      >
                        <X className="h-4 w-4 mr-1" />
                        Clear
                      </Button>
                    )}
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Status</label>
                    <Select
                      value={statusFilter}
                      onValueChange={setStatusFilter}
                    >
                      <SelectTrigger data-testid="select-status-filter">
                        <SelectValue placeholder="All statuses" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">All Statuses</SelectItem>
                        <SelectItem value="OTW">OTW (On The Way)</SelectItem>
                        <SelectItem value="ARRIVED">Arrived</SelectItem>
                        <SelectItem value="OFFLOADED">Offloaded</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Supplier</label>
                    <Select
                      value={supplierFilter}
                      onValueChange={setSupplierFilter}
                    >
                      <SelectTrigger data-testid="select-supplier-filter">
                        <SelectValue placeholder="All suppliers" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">All Suppliers</SelectItem>
                        {suppliers.map((supplier) => (
                          <SelectItem
                            key={supplier.id}
                            value={supplier.id.toString()}
                          >
                            {supplier.legalName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {containers.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Package className="w-16 h-16 text-muted-foreground mb-4" />
                <h2 className="text-xl font-semibold mb-2">
                  No containers found
                </h2>
                <p className="text-muted-foreground mb-4">
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
              </CardContent>
            </Card>
          ) : (
            <>
              <div className={`grid gap-4 ${hideContainerCosts ? "grid-cols-1 max-w-xs" : "grid-cols-2"}`}>
                <Card>
                  <CardContent className="pt-6">
                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground">
                        Total Containers
                      </p>
                      <p
                        className="text-2xl font-semibold"
                        data-testid="text-total-containers"
                      >
                        {containers.length}
                      </p>
                    </div>
                  </CardContent>
                </Card>
                {!hideContainerCosts && (
                <Card>
                  <CardContent className="pt-6">
                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground">
                        Total Amount
                      </p>
                      <p
                        className="text-2xl font-semibold font-mono"
                        data-testid="text-total-amount"
                      >
                        {formatAmount(
                          containers.reduce((sum, c) => {
                            const gTotal = parseFloat(c.grandTotal ?? "0");
                            return sum + (gTotal || parseFloat(c.itemsTotal ?? "0") || 0);
                          }, 0)
                        )}
                      </p>
                    </div>
                  </CardContent>
                </Card>
                )}
              </div>

              <Card>
                <CardContent className="p-0 overflow-x-auto hidden md:block">
                  <Table>
                    <TableHeader className="sticky top-0 z-20 bg-background">
                      <TableRow>
                        <TableHead className="sticky left-0 bg-muted z-10 min-w-[140px]">
                          Container Number
                        </TableHead>
                        <TableHead>Supplier</TableHead>
                        <TableHead>Status</TableHead>
                        {!hideContainerCosts && <TableHead>Grand Total</TableHead>}
                        <TableHead>Import Date</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {containers.map((container) => (
                        <TableRow
                          key={container.id}
                          data-testid={`row-container-${container.id}`}
                        >
                          <TableCell className="font-mono font-medium sticky left-0 bg-background z-10">
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
                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => editContainerNumberMutation.mutate({ id: container.id, containerNumber: editingNumberValue })} disabled={editContainerNumberMutation.isPending} data-testid={`button-save-number-${container.id}`}>
                                  <Check className="h-3 w-3" />
                                </Button>
                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditingNumberId(null); setEditingNumberValue(""); }} data-testid={`button-cancel-number-${container.id}`}>
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1 group">
                                <span>{container.containerNumber}</span>
                                <Button size="icon" variant="ghost" className="h-6 w-6 opacity-100 md:opacity-0 md:group-hover:opacity-100" onClick={() => { setEditingNumberId(container.id); setEditingNumberValue(container.containerNumber); }} data-testid={`button-edit-number-${container.id}`}>
                                  <Pencil className="h-3 w-3" />
                                </Button>
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            {getSupplierName(container.supplierId)}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                container.status === "OTW"
                                  ? "default"
                                  : "secondary"
                              }
                            >
                              {container.status}
                            </Badge>
                          </TableCell>
                          {!hideContainerCosts && <TableCell className="font-mono">
                            {formatAmount(
                              parseFloat(container.grandTotal || "0")
                            )}
                          </TableCell>}
                          <TableCell className="font-mono">
                            {formatDisplayDate(container.importDate)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Link href={`/containers/${container.id}`}>
                              <Button
                                size="sm"
                                variant="outline"
                                data-testid={`button-view-${container.id}`}
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
                  {containers.map((container) => (
                    <Link key={container.id} href={`/containers/${container.id}`}>
                      <div
                        className="p-3 rounded-md border cursor-pointer hover-elevate"
                        data-testid={`row-container-${container.id}`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-mono font-medium text-sm">{container.containerNumber}</span>
                          <Badge
                            variant={container.status === "OTW" ? "default" : "secondary"}
                          >
                            {container.status}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mb-1">
                          {getSupplierName(container.supplierId)}
                        </div>
                        <div className="flex justify-between text-sm">
                          {!hideContainerCosts && <span className="font-mono font-semibold">
                            {formatAmount(parseFloat(container.grandTotal || "0"))}
                          </span>}
                          <span className="text-xs text-muted-foreground">
                            {formatDisplayDate(container.importDate)}
                          </span>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </Card>
            </>
          )}
          </div>
          )}

        </div>
      </div>

      <AddContainerDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
      />
    </div>
  );
}
