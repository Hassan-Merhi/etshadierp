import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "@/contexts/LocationContext";
import { useLocation as useRoute } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { ChevronRight, Package, MapPin, Layers, ShoppingCart, List, Printer, Upload, Download, Trash2, Search, AlertCircle, CheckCircle2, Archive, Calendar, X } from "lucide-react";
import { DatePickerInput } from "@/components/ui/date-picker-input";
import { format } from "date-fns";
import { LocationCreateDialog } from "@/components/LocationCreateDialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useReactToPrint } from "react-to-print";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Alert, AlertDescription } from "@/components/ui/alert";
import * as XLSX from "xlsx";
import { formatNumber } from "@/lib/formatNumber";

interface Location {
  id: number;
  code: string;
  name: string;
  city: string | null;
  state: string | null;
  country: string | null;
  createdAt?: string;
}

interface InventoryItem {
  inventoryId: number;
  locationId: number;
  stockItemId: number;
  quantity: string;
  averageRate: string;
  totalValue: string;
  stockItemCode: string;
  stockItemName: string;
  stockItemUom: string;
  stockGroupId: number | null;
  stockGroupName: string | null;
  stockGroupCode: string | null;
}

interface StockGroupSummary {
  groupId: number | null;
  groupCode: string | null;
  groupName: string;
  totalQuantity: number;
  totalValue: number;
  averageRate: number;
  itemCount: number;
  items: InventoryItem[];
}

interface ImportRow {
  Item_barcode: string;
  stockGroupCode?: string;
  quantity: string;
  rate: string;
  value: string;
}

export default function LocationInventory({ posUser }: { posUser?: any } = {}) {
  const [selectedLocationLocal, setSelectedLocationLocal] = useState<Location | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<StockGroupSummary | null>(null);
  const [selectedRowIndex, setSelectedRowIndex] = useState<number>(0);
  const [viewAllItems, setViewAllItems] = useState<boolean>(false);
  const [locationSearchTerm, setLocationSearchTerm] = useState("");
  const [groupSearchTerm, setGroupSearchTerm] = useState("");
  const [itemSearchTerm, setItemSearchTerm] = useState("");
  const [asOfDate, setAsOfDate] = useState<string>("");
  const tableRef = useRef<HTMLDivElement>(null);
  const printRef = useRef<HTMLDivElement>(null);
  const { setSelectedLocation } = useLocation();
  const [_route, navigate] = useRoute();
  const { toast } = useToast();

  // Debug logging
  console.log('[LocationInventory] posUser:', posUser);
  console.log('[LocationInventory] !posUser (query enabled):', !posUser);

  // Import dialog state
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<ImportRow[]>([]);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importComplete, setImportComplete] = useState(false);

  // Cost price import dialog state
  const [costPriceImportOpen, setCostPriceImportOpen] = useState(false);
  const [costPriceFile, setCostPriceFile] = useState<File | null>(null);
  const [costPricePreview, setCostPricePreview] = useState<Array<{ barcode: string; costPrice: number }>>([]);
  const [costPriceErrors, setCostPriceErrors] = useState<string[]>([]);
  const [isImportingCostPrice, setIsImportingCostPrice] = useState(false);
  const [costPriceImportComplete, setCostPriceImportComplete] = useState(false);

  // Delete confirmation dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Archive stock group dialog state
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);

  // Create location dialog state
  const [createLocationDialogOpen, setCreateLocationDialogOpen] = useState(false);

  // Print handler
  const handlePrint = useReactToPrint({
    contentRef: printRef,
  });

  // Fetch all locations (only for non-POS users, POS users use specific query below)
  const { data: locations = [], isLoading: locationsLoading } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
    enabled: !posUser, // Disable for POS users to avoid redundant requests
    staleTime: 0, // Always fetch fresh data
    refetchOnMount: true, // Refetch when component mounts
  });

  // For POS users, automatically set their assigned location
  useEffect(() => {
    if (posUser?.assignedLocationId && locations.length > 0) {
      const assignedLocation = locations.find(loc => loc.id === posUser.assignedLocationId);
      if (assignedLocation) {
        setSelectedLocationLocal(assignedLocation);
      }
    }
  }, [posUser, locations]);

  // If POS user, fetch their specific location
  const { data: posLocation } = useQuery<Location>({
    queryKey: posUser?.assignedLocationId ? [`/api/locations/${posUser.assignedLocationId}`] : [],
    enabled: !!posUser?.assignedLocationId,
  });

  // Auto-select location for POS users
  useEffect(() => {
    if (posUser && posLocation && !selectedLocationLocal) {
      setSelectedLocationLocal(posLocation);
    }
  }, [posUser, posLocation, selectedLocationLocal]);

  // Debug: Log when asOfDate changes
  useEffect(() => {
    console.log('[LocationInventory] asOfDate changed to:', asOfDate);
  }, [asOfDate]);

  // Fetch inventory for selected location (with optional historical date)
  const { data: inventoryData = [], isLoading: inventoryLoading, isFetching } = useQuery<InventoryItem[]>({
    queryKey: selectedLocationLocal 
      ? [`/api/locations/${selectedLocationLocal.id}/inventory`, { asOfDate }] 
      : [],
    queryFn: async () => {
      const url = asOfDate 
        ? `/api/locations/${selectedLocationLocal!.id}/inventory?asOfDate=${asOfDate}`
        : `/api/locations/${selectedLocationLocal!.id}/inventory`;
      console.log('[LocationInventory] Fetching from URL:', url);
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch inventory');
      return response.json();
    },
    enabled: !!selectedLocationLocal,
  });

  // Filter out items with 0 quantity
  const inventory = inventoryData.filter(item => parseFloat(item.quantity || "0") !== 0);

  // Group inventory by stock group
  const stockGroups: StockGroupSummary[] = inventory.reduce((groups, item) => {
    const groupKey = item.stockGroupId || 0;
    let group = groups.find(g => (g.groupId || 0) === groupKey);
    
    if (!group) {
      group = {
        groupId: item.stockGroupId,
        groupCode: item.stockGroupCode,
        groupName: item.stockGroupName || "Uncategorized",
        totalQuantity: 0,
        totalValue: 0,
        averageRate: 0,
        itemCount: 0,
        items: [],
      };
      groups.push(group);
    }

    const qty = parseFloat(item.quantity || "0");
    const value = parseFloat(item.totalValue || "0");
    
    group.totalQuantity += qty;
    group.totalValue += value;
    group.itemCount += 1;
    group.items.push(item);

    return groups;
  }, [] as StockGroupSummary[]);

  // Calculate average rate for each group
  stockGroups.forEach(group => {
    if (group.totalQuantity > 0) {
      group.averageRate = group.totalValue / group.totalQuantity;
    }
  });

  // Sort locations alphabetically (A-Z) by name
  const sortedLocations = [...locations].sort((a, b) => a.name.localeCompare(b.name));

  // Filter locations by search term
  const filteredLocations = sortedLocations.filter((location) =>
    (location.name ?? "").toLowerCase().includes(locationSearchTerm.toLowerCase())
  );

  // Sort stock groups alphabetically (A-Z) by name, nulls/Uncategorized last
  const sortedStockGroups = [...stockGroups].sort((a, b) => {
    if (a.groupId === null) return 1;
    if (b.groupId === null) return -1;
    return a.groupName.localeCompare(b.groupName);
  });

  // Filter stock groups by search term
  const filteredStockGroups = sortedStockGroups.filter((group) =>
    (group.groupName ?? "").toLowerCase().includes(groupSearchTerm.toLowerCase()) ||
    (group.groupCode ?? "").toLowerCase().includes(groupSearchTerm.toLowerCase())
  );

  // Filter and sort stock items alphabetically (A-Z) by name
  const filteredStockItems = (selectedGroup?.items || [])
    .sort((a, b) => (a.stockItemName ?? "").localeCompare(b.stockItemName ?? ""))
    .filter((item) =>
      (item.stockItemName ?? "").toLowerCase().includes(itemSearchTerm.toLowerCase()) ||
      (item.stockItemCode ?? "").toLowerCase().includes(itemSearchTerm.toLowerCase())
    );

  // Handle location selection
  const handleLocationClick = (location: Location) => {
    setSelectedLocationLocal(location);
    setSelectedGroup(null);
  };

  // Handle selecting a location for use in POS/other modules
  const handleUseLocation = (location: Location) => {
    setSelectedLocation(location);
    navigate("/pos");
  };

  // Handle back to locations
  const handleBackToLocations = () => {
    setSelectedLocationLocal(null);
    setSelectedGroup(null);
    setViewAllItems(false);
  };

  // Handle back to groups
  const handleBackToGroups = () => {
    setSelectedGroup(null);
    setViewAllItems(false);
    setSelectedRowIndex(0);
  };

  // Keyboard navigation for table
  useEffect(() => {
    if (!selectedGroup) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const itemCount = selectedGroup.items.length;
      if (itemCount === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedRowIndex((prev) => (prev + 1) % itemCount);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedRowIndex((prev) => (prev - 1 + itemCount) % itemCount);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedGroup]);

  // Reset selected row when group changes
  useEffect(() => {
    setSelectedRowIndex(0);
  }, [selectedGroup]);

  // Import handlers
  const downloadImportTemplate = () => {
    const template = [
      { Item_barcode: "BALE001", stockGroupCode: "FABRIC", quantity: "100", rate: "150.00", value: "15000.00" },
      { Item_barcode: "BALE002", stockGroupCode: "TEXTILE", quantity: "50", rate: "145.50", value: "7275.00" },
    ];

    const ws = XLSX.utils.json_to_sheet(template);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inventory Import");
    XLSX.writeFile(wb, "inventory_import_template.xlsx");

    toast({
      title: "Template Downloaded",
      description: "Use this template to prepare your inventory data",
    });
  };

  const handleImportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setImportFile(selectedFile);
    setImportErrors([]);
    setImportPreview([]);
    setImportComplete(false);

    try {
      const data = await selectedFile.arrayBuffer();
      const workbook = XLSX.read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json<any>(worksheet);

      // Validate file has data
      if (jsonData.length === 0) {
        toast({
          title: "Empty File",
          description: "The Excel file is empty. Please add data rows and try again.",
          variant: "destructive",
        });
        return;
      }

      // Read header row explicitly to get all column names (avoids issues with blank first-row cells)
      const headerRow = XLSX.utils.sheet_to_json<string[]>(worksheet, { header: 1 })[0] || [];
      const columns = headerRow.map((h: any) => String(h || "").trim());
      const requiredCols = ["Item_barcode", "quantity", "rate"];
      const missingCols = requiredCols.filter(col => !columns.includes(col));
      
      if (missingCols.length > 0) {
        toast({
          title: "Missing Required Columns",
          description: `Expected columns: ${requiredCols.join(", ")}. Found: ${columns.slice(0, 5).join(", ")}${columns.length > 5 ? "..." : ""}. Download the template to see expected format.`,
          variant: "destructive",
        });
        return;
      }

      const errors: string[] = [];
      const rows: ImportRow[] = [];

      jsonData.forEach((row, index) => {
        const rowNumber = index + 2;

        if (!row.Item_barcode || String(row.Item_barcode).trim() === "") {
          errors.push(`Row ${rowNumber}: Item_barcode is required`);
        }

        // Allow negative quantities and rates for opening balances from old systems
        if (row.quantity === undefined || row.quantity === null || row.quantity === "") {
          errors.push(`Row ${rowNumber}: Quantity is required`);
        }

        if (row.rate === undefined || row.rate === null || row.rate === "") {
          errors.push(`Row ${rowNumber}: Rate is required`);
        }

        rows.push({
          Item_barcode: String(row.Item_barcode || "").trim(),
          stockGroupCode: row.stockGroupCode ? String(row.stockGroupCode).trim() : undefined,
          quantity: String(row.quantity || "0"),
          rate: String(row.rate || "0"),
          value: String(row.value || "0"),
        });
      });

      setImportPreview(rows);
      setImportErrors(errors);

      if (errors.length === 0) {
        toast({
          title: "File Validated",
          description: `${rows.length} inventory items ready to import`,
        });
      } else {
        toast({
          title: "Validation Errors Found",
          description: `Found ${errors.length} errors. Please fix them before importing.`,
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error Reading File",
        description: "Please ensure the file is a valid Excel file (.xlsx)",
        variant: "destructive",
      });
    }
  };

  const handleImportSubmit = async () => {
    if (!selectedLocationLocal) {
      toast({
        title: "No Location Selected",
        description: "Please select a location first",
        variant: "destructive",
      });
      return;
    }

    if (importErrors.length > 0) {
      toast({
        title: "Cannot Import",
        description: "Please fix validation errors first",
        variant: "destructive",
      });
      return;
    }

    setIsImporting(true);

    try {
      await apiRequest("POST", `/api/locations/${selectedLocationLocal.id}/import-inventory`, {
        items: importPreview,
      });

      queryClient.invalidateQueries({ queryKey: [`/api/locations/${selectedLocationLocal.id}/inventory`] });

      setImportComplete(true);
      toast({
        title: "Import Successful",
        description: `Successfully imported ${importPreview.length} inventory items`,
      });
    } catch (error: any) {
      toast({
        title: "Import Failed",
        description: error.message || "Failed to import inventory",
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleImportDialogClose = () => {
    setImportDialogOpen(false);
    setImportFile(null);
    setImportPreview([]);
    setImportErrors([]);
    setImportComplete(false);
  };

  const downloadCostPriceTemplate = () => {
    const template = [
      { barcode: "ITEM001", costPrice: "125.50" },
      { barcode: "ITEM002", costPrice: "95.75" },
    ];

    const ws = XLSX.utils.json_to_sheet(template);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Cost Price Import");
    XLSX.writeFile(wb, "cost_price_import_template.xlsx");

    toast({
      title: "Template Downloaded",
      description: "Use this template to update cost prices",
    });
  };

  const handleCostPriceFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setCostPriceFile(selectedFile);
    setCostPriceErrors([]);
    setCostPricePreview([]);
    setCostPriceImportComplete(false);

    try {
      const data = await selectedFile.arrayBuffer();
      const workbook = XLSX.read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json<any>(worksheet);

      // Validate file has data
      if (jsonData.length === 0) {
        toast({
          title: "Empty File",
          description: "The Excel file is empty. Please add data rows and try again.",
          variant: "destructive",
        });
        return;
      }

      // Read header row explicitly to get all column names (avoids issues with blank first-row cells)
      const headerRow = XLSX.utils.sheet_to_json<string[]>(worksheet, { header: 1 })[0] || [];
      const columns = headerRow.map((h: any) => String(h || "").trim());
      const requiredCols = ["barcode", "costPrice"];
      const missingCols = requiredCols.filter(col => !columns.includes(col));
      
      if (missingCols.length > 0) {
        toast({
          title: "Missing Required Columns",
          description: `Expected columns: ${requiredCols.join(", ")}. Found: ${columns.slice(0, 5).join(", ")}${columns.length > 5 ? "..." : ""}. Download the template to see expected format.`,
          variant: "destructive",
        });
        return;
      }

      const errors: string[] = [];
      const rows: Array<{ barcode: string; costPrice: number }> = [];

      jsonData.forEach((row, index) => {
        const rowNumber = index + 2;

        if (!row.barcode || String(row.barcode).trim() === "") {
          errors.push(`Row ${rowNumber}: Barcode is required`);
          return;
        }

        const costPrice = parseFloat(row.costPrice || "0");
        if (isNaN(costPrice) || costPrice <= 0) {
          errors.push(`Row ${rowNumber}: Cost price must be a valid number greater than 0`);
          return;
        }

        rows.push({
          barcode: String(row.barcode || "").trim(),
          costPrice: costPrice,
        });
      });

      setCostPricePreview(rows);
      setCostPriceErrors(errors);

      if (errors.length === 0) {
        toast({
          title: "File Validated",
          description: `${rows.length} cost prices ready to import`,
        });
      } else {
        toast({
          title: "Validation Errors Found",
          description: `Found ${errors.length} errors. Please fix them before importing.`,
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error Reading File",
        description: "Please ensure the file is a valid Excel file (.xlsx)",
        variant: "destructive",
      });
    }
  };

  const handleCostPriceImport = async () => {
    if (!selectedLocationLocal) {
      toast({
        title: "No Location Selected",
        description: "Please select a location first",
        variant: "destructive",
      });
      return;
    }

    if (costPriceErrors.length > 0) {
      toast({
        title: "Cannot Import",
        description: "Please fix validation errors first",
        variant: "destructive",
      });
      return;
    }

    setIsImportingCostPrice(true);

    try {
      const res = await apiRequest("POST", `/api/locations/${selectedLocationLocal.id}/import-cost-prices`, {
        updates: costPricePreview,
      });
      const response = await res.json();

      queryClient.invalidateQueries({ queryKey: [`/api/locations/${selectedLocationLocal.id}/inventory`] });

      setCostPriceImportComplete(true);
      toast({
        title: "Import Successful",
        description: `Updated ${response.updated} cost prices. ${response.errors?.length > 0 ? `${response.errors.length} errors encountered.` : ""}`,
      });
    } catch (error: any) {
      toast({
        title: "Import Failed",
        description: error.message || "Failed to update cost prices",
        variant: "destructive",
      });
    } finally {
      setIsImportingCostPrice(false);
    }
  };

  const handleCostPriceDialogClose = () => {
    setCostPriceImportOpen(false);
    setCostPriceFile(null);
    setCostPricePreview([]);
    setCostPriceErrors([]);
    setCostPriceImportComplete(false);
  };

  const handleDeleteLocation = async () => {
    if (!selectedLocationLocal) return;

    setIsDeleting(true);
    try {
      await apiRequest("DELETE", `/api/locations/${selectedLocationLocal.id}`);

      // Invalidate locations cache to refresh the list
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });

      toast({
        title: "Location Deleted",
        description: `${selectedLocationLocal.name} has been deleted successfully`,
      });

      // Navigate back to location list
      setSelectedLocationLocal(null);
      setDeleteDialogOpen(false);
    } catch (error: any) {
      toast({
        title: "Delete Failed",
        description: error.message || "Failed to delete location",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleArchiveStockGroup = async () => {
    if (!selectedLocationLocal || !selectedGroup) return;

    setIsArchiving(true);
    try {
      await apiRequest("POST", "/api/stock-group-archives", {
        locationId: selectedLocationLocal.id,
        stockGroupId: selectedGroup.groupId,
        notes: `Archived from Location Inventory page`,
      });

      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-group-archives"] });

      toast({
        title: "Stock Group Archived",
        description: `${selectedGroup.groupName} has been archived from ${selectedLocationLocal.name}. You can restore it from Orphaned Records.`,
      });

      setSelectedGroup(null);
      setArchiveDialogOpen(false);
    } catch (error: any) {
      toast({
        title: "Archive Failed",
        description: error.message || "Failed to archive stock group",
        variant: "destructive",
      });
    } finally {
      setIsArchiving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader 
        title="Location Inventory" 
        subtitle="Manage inventory across all locations"
      >
        <div className="flex items-center gap-2">
          <Label className="text-sm text-muted-foreground">As of Date:</Label>
          <DatePickerInput
            value={asOfDate}
            onChange={setAsOfDate}
            placeholder="Current (Today)"
            data-testid="input-as-of-date"
          />
          {asOfDate && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setAsOfDate("")}
              data-testid="button-clear-date"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </PageHeader>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <MapPin className="w-4 h-4" />
        {!selectedLocationLocal && <span>Select Location</span>}
        {selectedLocationLocal && !selectedGroup && !viewAllItems && (
          <>
            {!posUser && (
              <>
                <Button
                  variant="ghost"
                  onClick={handleBackToLocations}
                  className="h-auto p-0 text-sm hover:underline"
                  data-testid="button-back-to-locations"
                >
                  Locations
                </Button>
                <ChevronRight className="w-4 h-4" />
              </>
            )}
            <span>{selectedLocationLocal.name}</span>
          </>
        )}
        {selectedLocationLocal && viewAllItems && (
          <>
            {!posUser && (
              <>
                <Button
                  variant="ghost"
                  onClick={handleBackToLocations}
                  className="h-auto p-0 text-sm hover:underline"
                  data-testid="button-back-to-locations-from-all"
                >
                  Locations
                </Button>
                <ChevronRight className="w-4 h-4" />
              </>
            )}
            <Button
              variant="ghost"
              onClick={handleBackToGroups}
              className="h-auto p-0 text-sm hover:underline"
              data-testid="button-back-to-groups-from-all"
            >
              {selectedLocationLocal.name}
            </Button>
            <ChevronRight className="w-4 h-4" />
            <span>All Stock Items</span>
          </>
        )}
        {selectedLocationLocal && selectedGroup && (
          <>
            {!posUser && (
              <>
                <Button
                  variant="ghost"
                  onClick={handleBackToLocations}
                  className="h-auto p-0 text-sm hover:underline"
                  data-testid="button-back-to-locations-2"
                >
                  Locations
                </Button>
                <ChevronRight className="w-4 h-4" />
              </>
            )}
            <Button
              variant="ghost"
              onClick={handleBackToGroups}
              className="h-auto p-0 text-sm hover:underline"
              data-testid="button-back-to-groups"
            >
              {selectedLocationLocal.name}
            </Button>
            <ChevronRight className="w-4 h-4" />
            <span>{selectedGroup.groupName}</span>
          </>
        )}
      </div>

      {/* Location List View */}
      {!selectedLocationLocal && (
        <div>
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-3xl font-bold">Location Inventory</h1>
            <Button
              variant="default"
              onClick={() => setCreateLocationDialogOpen(true)}
              data-testid="button-create-location"
              className="gap-2"
            >
              <MapPin className="w-4 h-4" />
              Create Location
            </Button>
          </div>

          <LocationCreateDialog
            open={createLocationDialogOpen}
            onOpenChange={setCreateLocationDialogOpen}
          />
          
          <Card className="p-4">
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <Input
                placeholder="Search locations by name..."
                value={locationSearchTerm}
                onChange={(e) => setLocationSearchTerm(e.target.value)}
                className="pl-10"
                data-testid="input-search-locations"
              />
            </div>

            {locationsLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : locations.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No locations found. Create a location first.
              </div>
            ) : (
              <div className="rounded-md border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr className="h-12">
                      <th className="text-left px-3 font-medium">Name</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLocations.length === 0 ? (
                      <tr>
                        <td colSpan={1} className="text-center py-8 text-muted-foreground">
                          No locations found matching your search
                        </td>
                      </tr>
                    ) : (
                      filteredLocations.map((location) => (
                        <tr
                          key={location.id}
                          className="border-t hover-elevate cursor-pointer h-12"
                          onClick={() => handleLocationClick(location)}
                          data-testid={`row-location-${location.id}`}
                        >
                          <td className="px-3 font-medium" data-testid={`name-${location.id}`}>
                            <div className="flex items-center gap-2">
                              <MapPin className="h-4 w-4 text-muted-foreground" />
                              {location.name}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
            {!locationsLoading && filteredLocations.length > 0 && (
              <div className="mt-4 text-sm text-muted-foreground">
                Showing {filteredLocations.length} of {locations.length} locations
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Stock Group List View */}
      {selectedLocationLocal && !selectedGroup && !viewAllItems && (
        <div>
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-3xl font-bold">
              {selectedLocationLocal.name} - Stock Groups
            </h1>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => {
                  setViewAllItems(true);
                  // Give the view time to render before printing
                  setTimeout(() => handlePrint(), 100);
                }}
                data-testid="button-print-inventory-quick"
                variant="outline"
                className="gap-2"
              >
                <Printer className="w-4 h-4" />
                Print Inventory
              </Button>
              <Button
                onClick={() => setViewAllItems(true)}
                data-testid="button-view-all-items"
                variant="outline"
                className="gap-2"
              >
                <List className="w-4 h-4" />
                View All Stock Items
              </Button>
              {!posUser && (
                <>
                  <Button
                    onClick={() => handleUseLocation(selectedLocationLocal)}
                    data-testid="button-use-location"
                    className="gap-2"
                  >
                    <ShoppingCart className="w-4 h-4" />
                    Use Location for POS
                  </Button>
                  <Button
                    onClick={() => setDeleteDialogOpen(true)}
                    data-testid="button-delete-location"
                    variant="destructive"
                    className="gap-2"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete Location
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Delete Confirmation Dialog */}
          <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Location</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete "{selectedLocationLocal?.name}"? This action cannot be undone and will remove all associated inventory data.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDeleteLocation}
                  disabled={isDeleting}
                  data-testid="button-confirm-delete"
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {isDeleting ? "Deleting..." : "Delete"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <Card className="p-4">
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <Input
                placeholder="Search stock groups by name..."
                value={groupSearchTerm}
                onChange={(e) => setGroupSearchTerm(e.target.value)}
                className="pl-10"
                data-testid="input-search-groups"
              />
            </div>

            {inventoryLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : stockGroups.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No inventory found at this location.
              </div>
            ) : (
              <div className="rounded-md border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr className="h-12">
                      <th className="text-left px-3 font-medium">Name</th>
                      <th className="text-right px-3 font-medium">Items</th>
                      <th className="text-right px-3 font-medium">Total Qty (BL)</th>
                      {!posUser && (
                        <>
                          <th className="text-right px-3 font-medium">Avg Rate</th>
                          <th className="text-right px-3 font-medium">Total Value</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStockGroups.length === 0 ? (
                      <tr>
                        <td colSpan={posUser ? 3 : 5} className="text-center py-8 text-muted-foreground">
                          No stock groups found matching your search
                        </td>
                      </tr>
                    ) : (
                      <>
                        {filteredStockGroups.map((group) => (
                          <tr
                            key={group.groupId || 0}
                            className="border-t hover-elevate cursor-pointer h-12"
                            onClick={() => setSelectedGroup(group)}
                            data-testid={`row-group-${group.groupId || 'uncategorized'}`}
                          >
                            <td className="px-3 font-medium" data-testid={`name-${group.groupId}`}>
                              <div className="flex items-center gap-2">
                                <Layers className="h-4 w-4 text-muted-foreground" />
                                {group.groupName}
                              </div>
                            </td>
                            <td className="px-3 text-right" data-testid={`items-${group.groupId}`}>
                              {group.itemCount.toLocaleString()}
                            </td>
                            <td className="px-3 text-right font-mono" data-testid={`qty-${group.groupId}`}>
                              {Math.floor(group.totalQuantity).toLocaleString()} BL
                            </td>
                            {!posUser && (
                              <>
                                <td className="px-3 text-right font-mono" data-testid={`rate-${group.groupId}`}>
                                  ${formatNumber(group.averageRate)}
                                </td>
                                <td className="px-3 text-right font-mono font-medium" data-testid={`value-${group.groupId}`}>
                                  ${group.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                              </>
                            )}
                          </tr>
                        ))}
                        {filteredStockGroups.length > 0 && !itemSearchTerm && (
                          <tr className="border-t h-12 bg-muted/50 font-bold">
                            <td className="px-3">Total</td>
                            <td className="px-3 text-right">{filteredStockGroups.reduce((sum, g) => sum + g.itemCount, 0).toLocaleString()}</td>
                            <td className="px-3 text-right font-mono">
                              {Math.floor(filteredStockGroups.reduce((sum, g) => sum + g.totalQuantity, 0)).toLocaleString()} BL
                            </td>
                            {!posUser && (
                              <>
                                <td className="px-3 text-right font-mono"></td>
                                <td className="px-3 text-right font-mono">
                                  ${filteredStockGroups.reduce((sum, g) => sum + g.totalValue, 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                              </>
                            )}
                          </tr>
                        )}
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            )}
            {!inventoryLoading && filteredStockGroups.length > 0 && (
              <div className="mt-4 text-sm text-muted-foreground">
                Showing {filteredStockGroups.length} of {stockGroups.length} stock groups
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Stock Items Table View (Single Group) */}
      {selectedLocationLocal && selectedGroup && (
        <div>
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-3xl font-bold">
              {selectedGroup.groupName} - Stock Items
            </h1>
            {!posUser && (
              <Button
                variant="outline"
                onClick={() => setArchiveDialogOpen(true)}
                data-testid="button-archive-stock-group"
              >
                <Archive className="h-4 w-4 mr-2" />
                Archive Stock Group
              </Button>
            )}
          </div>

          <Card className="p-4">
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <Input
                placeholder="Search items by name..."
                value={itemSearchTerm}
                onChange={(e) => setItemSearchTerm(e.target.value)}
                className="pl-10"
                data-testid="input-search-items"
              />
            </div>

            <div className="rounded-md border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="h-12">
                    <th className="text-left px-3 font-medium">Name</th>
                    <th className="text-right px-3 font-medium">Quantity</th>
                    <th className="text-left px-3 font-medium">UOM</th>
                    {!posUser && (
                      <>
                        <th className="text-right px-3 font-medium">Avg Rate</th>
                        <th className="text-right px-3 font-medium">Total Value</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filteredStockItems.length === 0 ? (
                    <tr>
                      <td colSpan={posUser ? 3 : 5} className="text-center py-8 text-muted-foreground">
                        {itemSearchTerm ? "No items found matching your search" : "No items in this group"}
                      </td>
                    </tr>
                  ) : (
                    filteredStockItems.map((item, index) => (
                      <tr
                        key={item.inventoryId}
                        data-testid={`row-item-${item.stockItemId}`}
                        className={`border-t h-12 ${
                          index === selectedRowIndex ? "bg-accent" : "hover-elevate"
                        }`}
                        onClick={() => setSelectedRowIndex(index)}
                      >
                        <td className="px-3 font-medium">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/locations/${selectedLocationLocal?.id}/stock-items/${item.stockItemId}/history`);
                            }}
                            className="text-left text-primary hover:underline cursor-pointer"
                            data-testid={`link-item-${item.stockItemId}`}
                          >
                            {item.stockItemName}
                          </button>
                        </td>
                        <td className="px-3 text-right font-mono">
                          {Math.floor(parseFloat(item.quantity)).toLocaleString()} {item.stockItemUom}
                        </td>
                        <td className="px-3"></td>
                        {!posUser && (
                          <>
                            <td className="px-3 text-right font-mono">
                              ${formatNumber(parseFloat(item.averageRate))}
                            </td>
                            <td className="px-3 text-right font-mono font-medium">
                              ${formatNumber(parseFloat(item.totalValue))}
                            </td>
                          </>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
                {filteredStockItems.length > 0 && (
                  <tfoot className="bg-muted/50 border-t-2 font-semibold">
                    <tr className="h-12">
                      <td className="px-3 font-bold">Total</td>
                      <td className="px-3 text-right font-mono font-bold">
                        {Math.floor(filteredStockItems.reduce((sum, item) => sum + parseFloat(item.quantity || "0"), 0)).toLocaleString()} {filteredStockItems[0]?.stockItemUom || ""}
                      </td>
                      <td className="px-3"></td>
                      {!posUser && (
                        <>
                          <td className="px-3"></td>
                          <td className="px-3 text-right font-mono font-bold">
                            ${filteredStockItems.reduce((sum, item) => sum + parseFloat(item.totalValue || "0"), 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                        </>
                      )}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            {filteredStockItems.length > 0 && (
              <div className="mt-4 text-sm text-muted-foreground">
                Showing {filteredStockItems.length} of {selectedGroup.items.length} items
              </div>
            )}
          </Card>
        </div>
      )}

      {/* All Stock Items View */}
      {selectedLocationLocal && viewAllItems && (
        <div>
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-3xl font-bold">
              {selectedLocationLocal.name} - All Stock Items
            </h1>
            <Button
              onClick={handlePrint}
              data-testid="button-print-inventory"
              variant="default"
              className="gap-2"
            >
              <Printer className="w-4 h-4" />
              Print Inventory
            </Button>
          </div>

          {/* Printable area */}
          <div ref={printRef}>
            <style>{`
              @media print {
                body {
                  margin: 0.3in;
                }
                .print-header {
                  margin-bottom: 0.3rem !important;
                  padding-bottom: 0.2rem !important;
                  border-bottom: 2px solid #000 !important;
                }
                .print-header h2 {
                  font-size: 16pt !important;
                  margin: 0 !important;
                }
                .print-header p {
                  font-size: 9pt !important;
                  margin: 0 !important;
                }
                .print-inventory-list {
                  font-size: 10pt !important;
                  line-height: 1.2 !important;
                  column-count: 2 !important;
                  column-gap: 1rem !important;
                }
                .print-group-section {
                  break-inside: avoid !important;
                  margin-bottom: 0.4rem !important;
                }
                .print-group-header {
                  font-weight: bold !important;
                  font-size: 11pt !important;
                  margin: 0 !important;
                  padding: 0.15rem 0 !important;
                  display: flex !important;
                  justify-content: space-between !important;
                  background-color: #f0f0f0 !important;
                  padding-left: 0.2rem !important;
                  padding-right: 0.2rem !important;
                }
                .print-item-row {
                  display: flex !important;
                  justify-content: space-between !important;
                  padding: 0.08rem 0 !important;
                  margin-left: 0.3rem !important;
                  font-size: 9pt !important;
                }
                .print-item-name {
                  flex: 1 !important;
                  padding-right: 0.5rem !important;
                  overflow: hidden !important;
                  text-overflow: ellipsis !important;
                  text-decoration: underline !important;
                }
                .print-item-qty {
                  text-align: right !important;
                  white-space: nowrap !important;
                  font-weight: 500 !important;
                  min-width: 60px !important;
                }
                .screen-only {
                  display: none !important;
                }
              }
              @media screen {
                .print-header {
                  display: none !important;
                }
                .print-inventory-list {
                  display: none !important;
                }
              }
            `}</style>
            {/* Print header */}
            <div className="print-header mb-6">
              <h2 className="text-xl font-bold">{selectedLocationLocal.name}</h2>
              <p className="text-xs">
                Inventory Report - {new Date().toLocaleDateString()}
              </p>
            </div>

            {inventoryLoading ? (
              <div className="p-6 text-center">
                <Skeleton className="h-8 w-full" />
              </div>
            ) : inventory.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-center text-muted-foreground">
                  No inventory found at this location.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-6">
                {(() => {
                  // Group items by stock group
                  const sortedInventory = [...inventory].sort((a, b) => {
                    const groupCompare = (a.stockGroupName || "").localeCompare(b.stockGroupName || "");
                    if (groupCompare !== 0) return groupCompare;
                    return a.stockItemName.localeCompare(b.stockItemName);
                  });

                  const groupedInventory = sortedInventory.reduce((acc, item) => {
                    const groupKey = item.stockGroupCode || "UNCAT";
                    const groupName = item.stockGroupName || "Uncategorized";
                    if (!acc[groupKey]) {
                      acc[groupKey] = { name: groupName, items: [] };
                    }
                    acc[groupKey].items.push(item);
                    return acc;
                  }, {} as Record<string, { name: string; items: typeof inventory }>);

                  return (
                    <>
                      {/* Screen view - Spreadsheet table */}
                      <div className="screen-only">
                        <Card>
                          <div className="rounded-md border overflow-hidden">
                            <table className="w-full text-sm">
                              <thead className="bg-muted/50">
                                <tr className="h-10">
                                  <th className="text-left px-3 font-medium">Name</th>
                                  <th className="text-right px-3 font-medium">Quantity</th>
                                  <th className="text-right px-3 font-medium">UOM</th>
                                  {!posUser && (
                                    <>
                                      <th className="text-right px-3 font-medium">Avg Rate</th>
                                      <th className="text-right px-3 font-medium">Total Value</th>
                                    </>
                                  )}
                                </tr>
                              </thead>
                              <tbody>
                                {Object.entries(groupedInventory).map(([groupCode, { name, items }]) => (
                                  <>
                                    {/* Group header row */}
                                    <tr key={`header-${groupCode}`} className="bg-muted/30">
                                      <td colSpan={posUser ? 3 : 5} className="px-3 py-2 font-bold">
                                        {name}
                                      </td>
                                    </tr>
                                    {/* Group items */}
                                    {items.map((item) => (
                                      <tr key={item.inventoryId} className="border-t hover-elevate">
                                        <td className="px-3 py-2">
                                          <button
                                            onClick={() => navigate(`/locations/${selectedLocationLocal?.id}/stock-items/${item.stockItemId}/history`)}
                                            className="text-left text-primary hover:underline cursor-pointer"
                                            data-testid={`link-all-item-${item.stockItemId}`}
                                          >
                                            {item.stockItemName}
                                          </button>
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono">
                                          {Math.floor(parseFloat(item.quantity)).toLocaleString()}
                                        </td>
                                        <td className="px-3 py-2 text-right">{item.stockItemUom}</td>
                                        {!posUser && (
                                          <>
                                            <td className="px-3 py-2 text-right font-mono">
                                              ${formatNumber(parseFloat(item.averageRate))}
                                            </td>
                                            <td className="px-3 py-2 text-right font-mono font-medium">
                                              ${formatNumber(parseFloat(item.totalValue))}
                                            </td>
                                          </>
                                        )}
                                      </tr>
                                    ))}
                                  </>
                                ))}
                                {/* Grand Totals Row */}
                                <tr className="bg-muted/50 border-t-2 font-semibold h-12">
                                  <td className="px-3 font-bold">Grand Total</td>
                                  <td className="px-3 text-right font-mono font-bold">
                                    {Math.floor(inventory.reduce((sum, item) => sum + parseFloat(item.quantity || "0"), 0)).toLocaleString()}
                                  </td>
                                  <td className="px-3"></td>
                                  {!posUser && (
                                    <>
                                      <td className="px-3"></td>
                                      <td className="px-3 text-right font-mono font-bold">
                                        ${inventory.reduce((sum, item) => sum + parseFloat(item.totalValue || "0"), 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                      </td>
                                    </>
                                  )}
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </Card>
                      </div>

                      {/* Print view - Compact two-column layout */}
                      <div className="print-inventory-list">
                        {Object.entries(groupedInventory).map(([groupCode, { name, items }]) => {
                          const groupTotal = items.reduce((sum, item) => sum + parseFloat(item.quantity || "0"), 0);
                          const firstItemUom = items[0]?.stockItemUom || "";
                          
                          return (
                            <div key={groupCode} className="print-group-section">
                              {/* Group header with total */}
                              <div className="print-group-header">
                                <span>{name}</span>
                                <span>{Math.floor(groupTotal).toLocaleString()} {firstItemUom}</span>
                              </div>
                              
                              {/* Group items */}
                              {items.map((item) => (
                                <div key={item.inventoryId} className="print-item-row">
                                  <span className="print-item-name">
                                    {item.stockItemName}
                                  </span>
                                  <span className="print-item-qty">
                                    {Math.floor(parseFloat(item.quantity)).toLocaleString()} {item.stockItemUom}
                                  </span>
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Archive Stock Group Confirmation Dialog - placed at root level */}
      <AlertDialog open={archiveDialogOpen} onOpenChange={setArchiveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive Stock Group</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to archive "{selectedGroup?.groupName}" from "{selectedLocationLocal?.name}"? 
              This will clear all inventory for this stock group at this location. 
              A backup will be saved and you can restore it from Orphaned Records if needed.
              Your POS sales history and monthly reports will not be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-archive">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleArchiveStockGroup}
              disabled={isArchiving}
              data-testid="button-confirm-archive"
            >
              {isArchiving ? "Archiving..." : "Archive"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
