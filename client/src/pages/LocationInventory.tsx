import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "@/contexts/LocationContext";
import { useLocation as useRoute } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronRight, Package, MapPin, Layers, ShoppingCart, List, Printer, Upload, Download } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import * as XLSX from "xlsx";

interface Location {
  id: number;
  code: string;
  name: string;
  city: string | null;
  state: string | null;
  country: string | null;
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
  const tableRef = useRef<HTMLDivElement>(null);
  const printRef = useRef<HTMLDivElement>(null);
  const { setSelectedLocation } = useLocation();
  const [, navigate] = useRoute();
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

  // Fetch inventory for selected location
  const { data: inventory = [], isLoading: inventoryLoading } = useQuery<InventoryItem[]>({
    queryKey: selectedLocationLocal ? [`/api/locations/${selectedLocationLocal.id}/inventory`] : [],
    enabled: !!selectedLocationLocal,
  });

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

      const errors: string[] = [];
      const rows: ImportRow[] = [];

      jsonData.forEach((row, index) => {
        const rowNumber = index + 2;

        if (!row.Item_barcode || String(row.Item_barcode).trim() === "") {
          errors.push(`Row ${rowNumber}: Item_barcode is required`);
        }

        if (!row.quantity || parseFloat(row.quantity) <= 0) {
          errors.push(`Row ${rowNumber}: Quantity must be greater than 0`);
        }

        if (!row.rate || parseFloat(row.rate) <= 0) {
          errors.push(`Row ${rowNumber}: Rate must be greater than 0`);
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

  return (
    <div className="flex flex-col gap-6 p-6">
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
          <h1 className="text-3xl font-bold mb-6">Location Inventory</h1>
          {locationsLoading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map(i => (
                <Card key={i}>
                  <CardHeader>
                    <Skeleton className="h-6 w-3/4" />
                    <Skeleton className="h-4 w-1/2 mt-2" />
                  </CardHeader>
                </Card>
              ))}
            </div>
          ) : locations.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-muted-foreground">
                No locations found. Create a location first.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {locations.map((location) => (
                <Card
                  key={location.id}
                  className="hover-elevate active-elevate-2 cursor-pointer"
                  onClick={() => handleLocationClick(location)}
                  data-testid={`card-location-${location.id}`}
                >
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <MapPin className="w-5 h-5" />
                      {location.name}
                    </CardTitle>
                    <CardDescription>
                      {location.code}
                      {location.city && ` • ${location.city}`}
                      {location.state && `, ${location.state}`}
                    </CardDescription>
                  </CardHeader>
                </Card>
              ))}
            </div>
          )}
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
              <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    data-testid="button-import-stock"
                    className="gap-2"
                  >
                    <Upload className="w-4 h-4" />
                    Import Stock
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Import Inventory from Excel</DialogTitle>
                    <DialogDescription>
                      Upload an Excel file with code, quantity, rate, and value columns
                    </DialogDescription>
                  </DialogHeader>
                  
                  <div className="space-y-4">
                    <div>
                      <Button
                        variant="outline"
                        onClick={downloadImportTemplate}
                        data-testid="button-download-import-template"
                        size="sm"
                      >
                        <Download className="h-4 w-4 mr-2" />
                        Download Template
                      </Button>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="import-file-upload">Select Excel File</Label>
                      <Input
                        id="import-file-upload"
                        type="file"
                        accept=".xlsx,.xls"
                        onChange={handleImportFileChange}
                        disabled={isImporting || importComplete}
                        data-testid="input-import-file-upload"
                      />
                      {importFile && (
                        <p className="text-sm text-muted-foreground">
                          Selected: {importFile.name}
                        </p>
                      )}
                    </div>

                    {importErrors.length > 0 && (
                      <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>
                          <div className="font-semibold mb-2">
                            {importErrors.length} validation error{importErrors.length > 1 ? "s" : ""} found:
                          </div>
                          <ul className="list-disc list-inside space-y-1">
                            {importErrors.slice(0, 5).map((error, index) => (
                              <li key={index} className="text-sm">{error}</li>
                            ))}
                            {importErrors.length > 5 && (
                              <li className="text-sm">... and {importErrors.length - 5} more errors</li>
                            )}
                          </ul>
                        </AlertDescription>
                      </Alert>
                    )}

                    {importComplete && (
                      <Alert>
                        <CheckCircle2 className="h-4 w-4" />
                        <AlertDescription>
                          Import completed successfully! {importPreview.length} inventory items have been added.
                        </AlertDescription>
                      </Alert>
                    )}

                    {importPreview.length > 0 && (
                      <div>
                        <p className="text-sm font-medium mb-2">Preview ({importPreview.length} items)</p>
                        <div className="border rounded-md overflow-auto max-h-48">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b bg-muted/50">
                                <th className="text-left p-2">Item_barcode</th>
                                <th className="text-right p-2">Quantity</th>
                                <th className="text-right p-2">Rate</th>
                                <th className="text-right p-2">Value</th>
                              </tr>
                            </thead>
                            <tbody>
                              {importPreview.slice(0, 20).map((item, index) => (
                                <tr key={index} className="border-b last:border-b-0">
                                  <td className="p-2">{item.Item_barcode}</td>
                                  <td className="p-2 text-right">{parseFloat(item.quantity).toLocaleString()}</td>
                                  <td className="p-2 text-right">${parseFloat(item.rate).toFixed(2)}</td>
                                  <td className="p-2 text-right">${parseFloat(item.value).toFixed(2)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {importPreview.length > 20 && (
                            <div className="p-2 text-center text-xs text-muted-foreground border-t">
                              ... and {importPreview.length - 20} more items
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="flex gap-2 justify-end">
                      {!importComplete ? (
                        <>
                          <Button
                            variant="outline"
                            onClick={handleImportDialogClose}
                            data-testid="button-cancel-import"
                          >
                            Cancel
                          </Button>
                          <Button
                            onClick={handleImportSubmit}
                            disabled={isImporting || importErrors.length > 0 || importPreview.length === 0}
                            data-testid="button-submit-import"
                          >
                            {isImporting ? "Importing..." : "Import"}
                          </Button>
                        </>
                      ) : (
                        <Button
                          onClick={handleImportDialogClose}
                          data-testid="button-close-import"
                        >
                          Close
                        </Button>
                      )}
                    </div>
                  </div>
                </DialogContent>
              </Dialog>

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
                <Button
                  onClick={() => handleUseLocation(selectedLocationLocal)}
                  data-testid="button-use-location"
                  className="gap-2"
                >
                  <ShoppingCart className="w-4 h-4" />
                  Use Location for POS
                </Button>
              )}
            </div>
          </div>
          {inventoryLoading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map(i => (
                <Card key={i}>
                  <CardHeader>
                    <Skeleton className="h-6 w-3/4" />
                    <Skeleton className="h-4 w-1/2 mt-2" />
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-4 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : stockGroups.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-muted-foreground">
                No inventory found at this location.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {stockGroups.map((group) => (
                <Card
                  key={group.groupId || 0}
                  className="hover-elevate active-elevate-2 cursor-pointer"
                  onClick={() => setSelectedGroup(group)}
                  data-testid={`card-group-${group.groupId || 'uncategorized'}`}
                >
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Layers className="w-5 h-5" />
                      {group.groupName}
                    </CardTitle>
                    {group.groupCode && (
                      <CardDescription>{group.groupCode}</CardDescription>
                    )}
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Items:</span>
                        <span className="font-medium">{group.itemCount}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Total Qty:</span>
                        <span className="font-medium">{group.totalQuantity.toFixed(3)}</span>
                      </div>
                      {!posUser && (
                        <>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Avg Rate:</span>
                            <span className="font-medium">${group.averageRate.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Total Value:</span>
                            <span className="font-medium text-primary">${group.totalValue.toFixed(2)}</span>
                          </div>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Stock Items Table View (Single Group) */}
      {selectedLocationLocal && selectedGroup && (
        <div>
          <h1 className="text-3xl font-bold mb-6">
            {selectedGroup.groupName} - Stock Items
          </h1>
          <div ref={tableRef} className="border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead>UOM</TableHead>
                  {!posUser && (
                    <>
                      <TableHead className="text-right">Avg Rate</TableHead>
                      <TableHead className="text-right">Total Value</TableHead>
                    </>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {selectedGroup.items.map((item, index) => (
                  <TableRow
                    key={item.inventoryId}
                    data-testid={`row-item-${item.stockItemId}`}
                    className={`cursor-pointer ${
                      index === selectedRowIndex
                        ? "bg-accent"
                        : ""
                    }`}
                    onClick={() => setSelectedRowIndex(index)}
                  >
                    <TableCell className="font-medium">{item.stockItemCode}</TableCell>
                    <TableCell>{item.stockItemName}</TableCell>
                    <TableCell className="text-right font-mono">
                      {parseFloat(item.quantity).toFixed(3)}
                    </TableCell>
                    <TableCell>{item.stockItemUom}</TableCell>
                    {!posUser && (
                      <>
                        <TableCell className="text-right font-mono">
                          ${parseFloat(item.averageRate).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right font-mono font-medium">
                          ${parseFloat(item.totalValue).toFixed(2)}
                        </TableCell>
                      </>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
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
                .print-compact-table th,
                .print-compact-table td {
                  padding: 0.25rem 0.375rem !important;
                  font-size: 0.875rem !important;
                  line-height: 1.25rem !important;
                }
                .print-compact-table th {
                  font-weight: 600 !important;
                }
                .print-header {
                  margin-bottom: 1rem !important;
                }
              }
            `}</style>
            {/* Print header (hidden on screen) */}
            <div className="hidden print:block print-header mb-6">
              <h2 className="text-2xl font-bold">{selectedLocationLocal.name}</h2>
              <p className="text-sm text-muted-foreground">Full Inventory Report</p>
              <p className="text-sm text-muted-foreground">
                Printed: {new Date().toLocaleDateString()}
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
                    const groupName = item.stockGroupName || "Uncategorized";
                    if (!acc[groupName]) acc[groupName] = [];
                    acc[groupName].push(item);
                    return acc;
                  }, {} as Record<string, typeof inventory>);

                  return Object.entries(groupedInventory).map(([groupName, items]) => (
                    <div key={groupName} className="print:break-inside-avoid">
                      <h3 className="text-lg font-semibold mb-2 print:text-base">{groupName}</h3>
                      <div className="border rounded-md">
                        <Table className="print-compact-table">
                          <TableHeader>
                            <TableRow>
                              <TableHead>Code</TableHead>
                              <TableHead>Name</TableHead>
                              <TableHead className="text-right">Quantity</TableHead>
                              <TableHead>UOM</TableHead>
                              {!posUser && (
                                <>
                                  <TableHead className="text-right">Avg Rate</TableHead>
                                  <TableHead className="text-right">Total Value</TableHead>
                                </>
                              )}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {items.map((item) => (
                              <TableRow
                                key={item.inventoryId}
                                data-testid={`row-all-items-${item.stockItemId}`}
                              >
                                <TableCell className="font-medium">{item.stockItemCode}</TableCell>
                                <TableCell>{item.stockItemName}</TableCell>
                                <TableCell className="text-right font-mono">
                                  {parseFloat(item.quantity).toFixed(3)}
                                </TableCell>
                                <TableCell>{item.stockItemUom}</TableCell>
                                {!posUser && (
                                  <>
                                    <TableCell className="text-right font-mono">
                                      ${parseFloat(item.averageRate).toFixed(2)}
                                    </TableCell>
                                    <TableCell className="text-right font-mono font-medium">
                                      ${parseFloat(item.totalValue).toFixed(2)}
                                    </TableCell>
                                  </>
                                )}
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  ));
                })()}
              </div>
            )}

            {/* Print summary (hidden on screen, visible when printing) */}
            {!posUser && (
              <div className="hidden print:block mt-6">
                <p className="text-sm">
                  Total Items: {inventory.length} | Total Inventory Value: $
                  {inventory.reduce((sum, item) => sum + parseFloat(item.totalValue || "0"), 0).toFixed(2)}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
