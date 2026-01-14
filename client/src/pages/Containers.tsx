import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Plus, Package, Eye, Search, Filter, X, Download, HandCoins, Truck, Save, Check, MapPin, Upload, FileSpreadsheet } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { useCompany } from "@/contexts/CompanyContext";
import { AddContainerDialog } from "../components/AddContainerDialog";
import { queryClient, apiRequest } from "@/lib/queryClient";
import * as XLSX from "xlsx";
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
  const [activeTab, setActiveTab] = useState("active");
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
  const [trackingEdits, setTrackingEdits] = useState<TrackingEdit>({});
  const [savingIds, setSavingIds] = useState<Set<number>>(new Set());
  const [savingAll, setSavingAll] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { selectedCompany } = useCompany();
  const { toast } = useToast();
  const tableRef = useRef<HTMLTableElement>(null);
  
  const trackingFields = ["shopName", "eta", "transporter", "transportFee", "numberPlate", "trackingLocation", "borderDate", "offloadDate", "agent", "dutyFee", "docReceived", "trackingDescription"] as const;
  
  const { data: allContainers = [], isLoading } = useQuery<Container[]>({
    queryKey: ["/api/containers/active", selectedCompany?.id],
    enabled: !!selectedCompany?.id,
  });

  const { data: soldContainers = [], isLoading: isSoldLoading } = useQuery<SoldContainer[]>({
    queryKey: ["/api/containers/sold", selectedCompany?.id],
    enabled: !!selectedCompany?.id,
  });

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
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
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const otwContainers = allContainers.filter((c) => c.status === "OTW");
  
  // Extract unique values for OTW filters
  const uniqueOtwLocations = Array.from(new Set(otwContainers.map(c => c.trackingLocation).filter(Boolean) as string[])).sort();
  const uniqueOtwAgents = Array.from(new Set(otwContainers.map(c => c.agent).filter(Boolean) as string[])).sort();
  const uniqueOtwTransporters = Array.from(new Set(otwContainers.map(c => c.transporter).filter(Boolean) as string[])).sort();
  const uniqueOtwSuppliers = Array.from(new Set(otwContainers.map(c => c.supplierId))).sort((a, b) => a - b);
  
  const filteredOtwContainers = otwContainers.filter((c) => {
    // Search filter
    if (otwSearchTerm) {
      const search = (otwSearchTerm || "").toLowerCase();
      if (!((c.containerNumber || "").toLowerCase().includes(search) ||
          (c.shopName?.toLowerCase() || "").includes(search) ||
          (c.agent?.toLowerCase() || "").includes(search))) {
        return false;
      }
    }
    // Location filter
    if (otwLocationFilter !== "ALL" && (c.trackingLocation || "") !== otwLocationFilter) {
      return false;
    }
    // Supplier filter
    if (otwSupplierFilter !== "ALL" && c.supplierId.toString() !== otwSupplierFilter) {
      return false;
    }
    // Agent filter
    if (otwAgentFilter !== "ALL" && (c.agent || "") !== otwAgentFilter) {
      return false;
    }
    // Transporter filter
    if (otwTransporterFilter !== "ALL" && (c.transporter || "") !== otwTransporterFilter) {
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

  const containers = allContainers
    .filter((c) => {
      if (searchTerm && !(c.containerNumber || "").toLowerCase().includes((searchTerm || "").toLowerCase())) {
        return false;
      }
      if (statusFilter !== "ALL" && c.status !== statusFilter) {
        return false;
      }
      if (supplierFilter !== "ALL" && c.supplierId.toString() !== supplierFilter) {
        return false;
      }
      return true;
    });

  const getSupplierName = (supplierId: number) => {
    const supplier = suppliers.find((s) => s.id === supplierId);
    return supplier ? supplier.legalName : "Unknown";
  };

  const clearFilters = () => {
    setStatusFilter("ALL");
    setSupplierFilter("ALL");
    setSearchTerm("");
  };

  const exportToExcel = () => {
    const data = containers.map((container) => ({
      "Container Number": container.containerNumber,
      Supplier: getSupplierName(container.supplierId),
      Status: container.status,
      Amount: parseFloat(container.grandTotal || "0"),
      "Import Date": new Date(container.importDate).toLocaleDateString(),
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Containers");
    XLSX.writeFile(workbook, "containers.xlsx");
  };

  const exportAllContainersFull = async () => {
    try {
      const response = await fetch("/api/containers/export-all");
      if (!response.ok) throw new Error("Export failed");
      
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `containers_full_export_${new Date().toISOString().split("T")[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast({ title: "Export successful", description: "All containers exported with full details" });
    } catch (error: any) {
      toast({ title: "Export failed", description: error.message, variant: "destructive" });
    }
  };

  const exportOtwToExcel = () => {
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

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "OTW Containers");
    XLSX.writeFile(workbook, "otw_containers.xlsx");
  };

  // Helper function to convert Excel date serial numbers to date strings
  const excelDateToString = (value: any): string => {
    if (!value) return "";
    // If it's already a string that looks like a date, return as-is
    if (typeof value === "string") {
      // Check if it contains any date-like characters
      if (value.includes("/") || value.includes("-") || isNaN(Number(value))) {
        return value;
      }
    }
    // If it's a number, it might be an Excel serial date
    const num = Number(value);
    if (!isNaN(num) && num > 40000 && num < 60000) {
      // Excel serial date: days since 1900-01-01 (with a bug for 1900 leap year)
      const excelEpoch = new Date(1899, 11, 30); // Dec 30, 1899
      const date = new Date(excelEpoch.getTime() + num * 24 * 60 * 60 * 1000);
      const month = (date.getMonth() + 1).toString().padStart(2, "0");
      const day = date.getDate().toString().padStart(2, "0");
      const year = date.getFullYear().toString().slice(-2);
      return `${month}/${day}/${year}`;
    }
    return String(value);
  };

  const downloadImportTemplate = () => {
    const templateData = [{
      "Container #": "EXAMPLE123456",
      "Shop": "Hadi #1",
      "ETA": "01/15/26",
      "Transporter": "FARHAT",
      "Transport Fee": "8500",
      "Number Plate": "T123 ABC",
      "Location": "KASUMBALESA",
      "Border Date": "01/20/26",
      "Offload Date": "01/22/26",
      "Agent": "NCA",
      "Duty Fee": "5000",
      "Doc Received": "YES",
      "Description": "Sample description",
    }];

    const worksheet = XLSX.utils.json_to_sheet(templateData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Import Template");
    XLSX.writeFile(workbook, "container_import_template.xlsx");
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setIsImporting(true);
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(sheet);
      
      // Validate file has data
      if (jsonData.length === 0) {
        throw new Error("The Excel file is empty. Please add data rows and try again.");
      }
      
      // Read header row explicitly to get all column names (avoids issues with blank first-row cells)
      const headerRow = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 })[0] || [];
      const columns = headerRow.map(h => String(h || "").trim());
      
      // Check for Container # column (required for matching)
      const containerColAliases = ["Container #", "Container Number", "containerNumber"];
      const hasContainerCol = containerColAliases.some(alias => columns.includes(alias));
      
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
        containerNumber: String(row["Container #"] || row["Container Number"] || row["containerNumber"] || ""),
        shopName: String(row["Shop"] || row["Shop Name"] || row["shopName"] || ""),
        eta: excelDateToString(row["ETA"] || row["eta"]),
        transporter: String(row["Transporter"] || row["transporter"] || ""),
        transportFee: String(row["Transport Fee"] || row["transportFee"] || ""),
        numberPlate: String(row["Number Plate"] || row["Plate"] || row["numberPlate"] || ""),
        trackingLocation: String(row["Location"] || row["trackingLocation"] || ""),
        borderDate: excelDateToString(row["Border Date"] || row["borderDate"]),
        offloadDate: excelDateToString(row["Offload Date"] || row["offloadDate"]),
        agent: String(row["Agent"] || row["agent"] || ""),
        dutyFee: String(row["Duty Fee"] || row["dutyFee"] || ""),
        docReceived: String(row["Doc Received"] || row["docReceived"] || ""),
        trackingDescription: String(row["Description"] || row["trackingDescription"] || ""),
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

  const setEditValue = (containerId: number, field: keyof Container, value: any) => {
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

  const saveTracking = (containerId: number) => {
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
      toast({ title: "Saved", description: `${savedCount} container(s) updated` });
    } else {
      toast({ 
        title: "Partial save", 
        description: `${savedCount} saved, ${errorCount} failed`, 
        variant: "destructive" 
      });
    }
  };

  const handleKeyDown = useCallback((e: React.KeyboardEvent, containerId: number, fieldIndex: number) => {
    const containerIndex = filteredOtwContainers.findIndex(c => c.id === containerId);
    if (containerIndex === -1) return;
    
    const getInputId = (cIdx: number, fIdx: number) => {
      const container = filteredOtwContainers[cIdx];
      if (!container) return null;
      const field = trackingFields[fIdx];
      if (!field) return null;
      return `tracking-${container.id}-${field}`;
    };
    
    const focusInput = (inputId: string | null) => {
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
  }, [filteredOtwContainers, trackingFields, hasChanges, saveTracking]);

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
    <div className="space-y-6">
      <PageHeader 
        title="Container Tracking" 
        subtitle="Track containers and manage offloading"
      >
        {activeTab === "active" && (
          <div className="flex gap-2">
            <Button
              onClick={exportToExcel}
              variant="outline"
              className="gap-2"
              data-testid="button-export-excel"
            >
              <Download className="h-4 w-4" />
              Export
            </Button>
            <Button
              onClick={exportAllContainersFull}
              variant="outline"
              className="gap-2"
              data-testid="button-export-all-full"
            >
              <Download className="h-4 w-4" />
              Export All (Full)
            </Button>
            <Button
              onClick={() => setAddDialogOpen(true)}
              variant="outline"
              className="gap-2"
              data-testid="button-add-container"
            >
              <Plus className="h-4 w-4" />
              Add Container
            </Button>
            <Link href="/po-import">
              <Button className="gap-2" data-testid="button-import-po">
                <Plus className="h-4 w-4" />
                Import PO
              </Button>
            </Link>
          </div>
        )}
        {activeTab === "otw" && (
          <div className="flex gap-2">
            {hasAnyChanges && (
              <Button
                onClick={saveAllTracking}
                disabled={savingAll}
                className="gap-2"
                data-testid="button-save-all"
              >
                <Save className="h-4 w-4" />
                {savingAll ? "Saving..." : `Save All (${Object.keys(trackingEdits).length})`}
              </Button>
            )}
            <Button
              onClick={exportOtwToExcel}
              variant="outline"
              className="gap-2"
              data-testid="button-export-otw"
            >
              <Download className="h-4 w-4" />
              Export OTW
            </Button>
            <Button
              onClick={downloadImportTemplate}
              variant="outline"
              className="gap-2"
              data-testid="button-download-template"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Template
            </Button>
            <Button
              onClick={handleImportClick}
              disabled={isImporting}
              variant="outline"
              className="gap-2"
              data-testid="button-import-otw"
            >
              <Upload className="h-4 w-4" />
              {isImporting ? "Importing..." : "Import Excel"}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileImport}
              className="hidden"
              data-testid="input-import-file"
            />
          </div>
        )}
      </PageHeader>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="active" data-testid="tab-active-containers">
            <Package className="h-4 w-4 mr-2" />
            Active Containers
            <Badge variant="secondary" className="ml-2">{allContainers.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="otw" data-testid="tab-otw-tracking">
            <Truck className="h-4 w-4 mr-2" />
            OTW Tracking
            <Badge variant="secondary" className="ml-2">{otwContainers.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="sold" data-testid="tab-sold-containers">
            <HandCoins className="h-4 w-4 mr-2" />
            Sold Containers
            <Badge variant="secondary" className="ml-2">{soldContainers.length}</Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="space-y-4 mt-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
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
                <Button variant="outline" className="gap-2" data-testid="button-filter">
                  <Filter className="h-4 w-4" />
                  Filter
                  {(statusFilter !== "ALL" || supplierFilter !== "ALL") && (
                    <Badge variant="secondary" className="ml-1 px-1 min-w-5 h-5">
                      {[statusFilter !== "ALL", supplierFilter !== "ALL"].filter(Boolean).length}
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
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
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
                    <Select value={supplierFilter} onValueChange={setSupplierFilter}>
                      <SelectTrigger data-testid="select-supplier-filter">
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
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {containers.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Package className="w-16 h-16 text-muted-foreground mb-4" />
                <h2 className="text-xl font-semibold mb-2">No containers found</h2>
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
              <div className="grid grid-cols-2 gap-4">
                <Card>
                  <CardContent className="pt-6">
                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground">Total Containers</p>
                      <p className="text-2xl font-semibold" data-testid="text-total-containers">
                        {containers.length}
                      </p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground">Total Amount</p>
                      <p className="text-2xl font-semibold font-mono" data-testid="text-total-amount">
                        ${containers.reduce((sum, c) => sum + parseFloat(c.grandTotal || "0"), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Container Number</TableHead>
                        <TableHead>Supplier</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Grand Total</TableHead>
                        <TableHead>Import Date</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {containers.map((container) => (
                        <TableRow key={container.id} data-testid={`row-container-${container.id}`}>
                          <TableCell className="font-mono font-medium">
                            {container.containerNumber}
                          </TableCell>
                          <TableCell>{getSupplierName(container.supplierId)}</TableCell>
                          <TableCell>
                            <Badge variant={container.status === "OTW" ? "default" : "secondary"}>
                              {container.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono">
                            ${parseFloat(container.grandTotal || "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell className="font-mono">
                            {new Date(container.importDate).toLocaleDateString()}
                          </TableCell>
                          <TableCell className="text-right">
                            <Link href={`/containers/${container.id}`}>
                              <Button size="sm" variant="outline" data-testid={`button-view-${container.id}`}>
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
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="otw" className="space-y-4 mt-4">
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
            <Select value={otwSupplierFilter} onValueChange={setOtwSupplierFilter}>
              <SelectTrigger className="w-[130px]" data-testid="select-otw-supplier">
                <SelectValue placeholder="Supplier" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Suppliers</SelectItem>
                {uniqueOtwSuppliers.map(id => (
                  <SelectItem key={id} value={id.toString()}>{getSupplierName(id)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={otwLocationFilter} onValueChange={setOtwLocationFilter}>
              <SelectTrigger className="w-[130px]" data-testid="select-otw-location">
                <SelectValue placeholder="Location" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Locations</SelectItem>
                {uniqueOtwLocations.map(loc => (
                  <SelectItem key={loc} value={loc}>{loc}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={otwAgentFilter} onValueChange={setOtwAgentFilter}>
              <SelectTrigger className="w-[100px]" data-testid="select-otw-agent">
                <SelectValue placeholder="Agent" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Agents</SelectItem>
                {uniqueOtwAgents.map(agent => (
                  <SelectItem key={agent} value={agent}>{agent}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={otwTransporterFilter} onValueChange={setOtwTransporterFilter}>
              <SelectTrigger className="w-[120px]" data-testid="select-otw-transporter">
                <SelectValue placeholder="Transporter" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Transporters</SelectItem>
                {uniqueOtwTransporters.map(t => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={otwDocReceivedFilter} onValueChange={setOtwDocReceivedFilter}>
              <SelectTrigger className="w-[100px]" data-testid="select-otw-doc">
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
                <h2 className="text-xl font-semibold mb-2">No OTW containers</h2>
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
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap">Container #</TableHead>
                      <TableHead className="whitespace-nowrap">Supplier</TableHead>
                      <TableHead className="whitespace-nowrap">Amount</TableHead>
                      <TableHead className="whitespace-nowrap min-w-[100px]">Shop</TableHead>
                      <TableHead className="whitespace-nowrap min-w-[130px]">ETA</TableHead>
                      <TableHead className="whitespace-nowrap min-w-[120px]">Transporter</TableHead>
                      <TableHead className="whitespace-nowrap min-w-[80px]">Fee</TableHead>
                      <TableHead className="whitespace-nowrap min-w-[100px]">Plate</TableHead>
                      <TableHead className="whitespace-nowrap min-w-[120px]">Location</TableHead>
                      <TableHead className="whitespace-nowrap min-w-[130px]">Border</TableHead>
                      <TableHead className="whitespace-nowrap min-w-[130px]">Offload</TableHead>
                      <TableHead className="whitespace-nowrap min-w-[80px]">Agent</TableHead>
                      <TableHead className="whitespace-nowrap min-w-[80px]">Duty</TableHead>
                      <TableHead className="whitespace-nowrap">Doc</TableHead>
                      <TableHead className="whitespace-nowrap min-w-[150px]">Description</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOtwContainers.map((container) => (
                      <TableRow key={container.id} data-testid={`row-otw-${container.id}`}>
                        <TableCell className="font-mono font-medium">
                          <Link href={`/containers/${container.id}`} className="text-primary hover:underline">
                            {container.containerNumber}
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm">{getSupplierName(container.supplierId)}</TableCell>
                        <TableCell className="font-mono text-sm">
                          ${parseFloat(container.grandTotal || "0").toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <Input
                            id={`tracking-${container.id}-shopName`}
                            value={getEditValue(container, "shopName") as string || ""}
                            onChange={(e) => setEditValue(container.id, "shopName", e.target.value)}
                            onKeyDown={(e) => handleKeyDown(e, container.id, 0)}
                            className="h-8 text-sm w-full"
                            placeholder="Shop"
                            data-testid={`input-shop-${container.id}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            id={`tracking-${container.id}-eta`}
                            type="date"
                            value={getEditValue(container, "eta") as string || ""}
                            onChange={(e) => setEditValue(container.id, "eta", e.target.value)}
                            onKeyDown={(e) => handleKeyDown(e, container.id, 1)}
                            className="h-8 text-sm w-full"
                            data-testid={`input-eta-${container.id}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            id={`tracking-${container.id}-transporter`}
                            value={getEditValue(container, "transporter") as string || ""}
                            onChange={(e) => setEditValue(container.id, "transporter", e.target.value)}
                            onKeyDown={(e) => handleKeyDown(e, container.id, 2)}
                            className="h-8 text-sm w-full"
                            placeholder="Transporter"
                            data-testid={`input-transporter-${container.id}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            id={`tracking-${container.id}-transportFee`}
                            type="number"
                            value={getEditValue(container, "transportFee") as string || ""}
                            onChange={(e) => setEditValue(container.id, "transportFee", e.target.value)}
                            onKeyDown={(e) => handleKeyDown(e, container.id, 3)}
                            className="h-8 text-sm w-full"
                            placeholder="0.00"
                            data-testid={`input-transport-${container.id}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            id={`tracking-${container.id}-numberPlate`}
                            value={getEditValue(container, "numberPlate") as string || ""}
                            onChange={(e) => setEditValue(container.id, "numberPlate", e.target.value)}
                            onKeyDown={(e) => handleKeyDown(e, container.id, 4)}
                            className="h-8 text-sm w-full"
                            placeholder="Plate"
                            data-testid={`input-plate-${container.id}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            id={`tracking-${container.id}-trackingLocation`}
                            value={getEditValue(container, "trackingLocation") as string || ""}
                            onChange={(e) => setEditValue(container.id, "trackingLocation", e.target.value)}
                            onKeyDown={(e) => handleKeyDown(e, container.id, 5)}
                            className="h-8 text-sm w-full"
                            placeholder="Location"
                            data-testid={`input-location-${container.id}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            id={`tracking-${container.id}-borderDate`}
                            type="date"
                            value={getEditValue(container, "borderDate") as string || ""}
                            onChange={(e) => setEditValue(container.id, "borderDate", e.target.value)}
                            onKeyDown={(e) => handleKeyDown(e, container.id, 6)}
                            className="h-8 text-sm w-full"
                            data-testid={`input-border-${container.id}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            id={`tracking-${container.id}-offloadDate`}
                            type="date"
                            value={getEditValue(container, "offloadDate") as string || ""}
                            onChange={(e) => setEditValue(container.id, "offloadDate", e.target.value)}
                            onKeyDown={(e) => handleKeyDown(e, container.id, 7)}
                            className="h-8 text-sm w-full"
                            data-testid={`input-offload-${container.id}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            id={`tracking-${container.id}-agent`}
                            value={getEditValue(container, "agent") as string || ""}
                            onChange={(e) => setEditValue(container.id, "agent", e.target.value)}
                            onKeyDown={(e) => handleKeyDown(e, container.id, 8)}
                            className="h-8 text-sm w-full"
                            placeholder="Agent"
                            data-testid={`input-agent-${container.id}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            id={`tracking-${container.id}-dutyFee`}
                            type="number"
                            value={getEditValue(container, "dutyFee") as string || ""}
                            onChange={(e) => setEditValue(container.id, "dutyFee", e.target.value)}
                            onKeyDown={(e) => handleKeyDown(e, container.id, 9)}
                            className="h-8 text-sm w-full"
                            placeholder="0.00"
                            data-testid={`input-duty-${container.id}`}
                          />
                        </TableCell>
                        <TableCell className="text-center">
                          <Checkbox
                            id={`tracking-${container.id}-docReceived`}
                            checked={!!getEditValue(container, "docReceived")}
                            onCheckedChange={(checked) => setEditValue(container.id, "docReceived", !!checked)}
                            data-testid={`checkbox-doc-${container.id}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            id={`tracking-${container.id}-trackingDescription`}
                            value={getEditValue(container, "trackingDescription") as string || ""}
                            onChange={(e) => setEditValue(container.id, "trackingDescription", e.target.value)}
                            onKeyDown={(e) => handleKeyDown(e, container.id, 11)}
                            className="h-8 text-sm w-full"
                            placeholder="Notes..."
                            data-testid={`input-desc-${container.id}`}
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
        </TabsContent>

        <TabsContent value="sold" className="space-y-4 mt-4">
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
                <h2 className="text-xl font-semibold mb-2">No sold containers found</h2>
                <p className="text-muted-foreground">
                  {soldContainers.length === 0 
                    ? "No containers have been sold yet"
                    : "Try adjusting your search"}
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Container Number</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Sale Date</TableHead>
                      <TableHead className="text-right">Container Cost</TableHead>
                      <TableHead className="text-right">Commission</TableHead>
                      <TableHead className="text-right">Total Amount</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredSoldContainers.map((sale) => (
                      <TableRow key={sale.saleId} data-testid={`row-sale-${sale.saleId}`}>
                        <TableCell className="font-mono font-medium">
                          {sale.containerNumber}
                        </TableCell>
                        <TableCell data-testid={`text-customer-${sale.saleId}`}>
                          {sale.customerName}
                        </TableCell>
                        <TableCell className="font-mono" data-testid={`text-sale-date-${sale.saleId}`}>
                          {new Date(sale.saleDate).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right font-mono" data-testid={`text-sale-price-${sale.saleId}`}>
                          ${parseFloat(sale.containerCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          ${parseFloat(sale.commission || "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold">
                          ${parseFloat(sale.totalAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right">
                          <Link href={`/containers/${sale.containerId}`}>
                            <Button size="sm" variant="outline" data-testid={`button-view-sale-${sale.saleId}`}>
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
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <AddContainerDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
      />
    </div>
  );
}
