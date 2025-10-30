import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search, Download, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import * as XLSX from "xlsx";
import { useToast } from "@/hooks/use-toast";

interface StockQueryItem {
  id: number;
  code: string;
  name: string;
  barcode: string | null;
  uom: string;
  stockGroupId: number | null;
  stockGroupCode: string | null;
  stockGroupName: string | null;
  openingQty: string;
  openingRate: string;
  openingValue: string;
  currentQty: string;
  currentValue: string;
  sellingPrice: string;
  active: boolean;
}

interface StockGroup {
  id: number;
  code: string;
  name: string;
}

type SortColumn = "code" | "name" | "stockGroup" | "currentQty" | "currentValue" | "sellingPrice";
type SortDirection = "asc" | "desc" | null;

export default function StockQuery() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedStockGroup, setSelectedStockGroup] = useState<string>("all");
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);

  // Fetch stock items with aggregated data
  const { data: stockItems = [], isLoading } = useQuery<StockQueryItem[]>({
    queryKey: ["/api/stock-query"],
  });

  // Fetch stock groups for filter
  const { data: stockGroups = [] } = useQuery<StockGroup[]>({
    queryKey: ["/api/stock-groups"],
  });

  // Filter and sort data
  const filteredAndSortedData = useMemo(() => {
    let filtered = stockItems.filter((item) => {
      const matchesSearch =
        item.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (item.barcode && item.barcode.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchesGroup =
        selectedStockGroup === "all" ||
        (selectedStockGroup === "null" && !item.stockGroupId) ||
        item.stockGroupId?.toString() === selectedStockGroup;

      return matchesSearch && matchesGroup;
    });

    // Sort data
    if (sortColumn && sortDirection) {
      filtered = [...filtered].sort((a, b) => {
        let aValue: any;
        let bValue: any;

        switch (sortColumn) {
          case "code":
            aValue = a.code;
            bValue = b.code;
            break;
          case "name":
            aValue = a.name;
            bValue = b.name;
            break;
          case "stockGroup":
            aValue = a.stockGroupName || "";
            bValue = b.stockGroupName || "";
            break;
          case "currentQty":
            aValue = parseFloat(a.currentQty || "0");
            bValue = parseFloat(b.currentQty || "0");
            break;
          case "currentValue":
            aValue = parseFloat(a.currentValue || "0");
            bValue = parseFloat(b.currentValue || "0");
            break;
          case "sellingPrice":
            aValue = parseFloat(a.sellingPrice || "0");
            bValue = parseFloat(b.sellingPrice || "0");
            break;
          default:
            return 0;
        }

        if (typeof aValue === "string") {
          return sortDirection === "asc"
            ? aValue.localeCompare(bValue)
            : bValue.localeCompare(aValue);
        } else {
          return sortDirection === "asc" ? aValue - bValue : bValue - aValue;
        }
      });
    }

    return filtered;
  }, [stockItems, searchTerm, selectedStockGroup, sortColumn, sortDirection]);

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      // Cycle through: asc -> desc -> null
      if (sortDirection === "asc") {
        setSortDirection("desc");
      } else if (sortDirection === "desc") {
        setSortColumn(null);
        setSortDirection(null);
      }
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  const getSortIcon = (column: SortColumn) => {
    if (sortColumn !== column) {
      return <ArrowUpDown className="h-4 w-4 ml-1 text-muted-foreground" />;
    }
    if (sortDirection === "asc") {
      return <ArrowUp className="h-4 w-4 ml-1" />;
    }
    return <ArrowDown className="h-4 w-4 ml-1" />;
  };

  const handleExportToExcel = () => {
    const exportData = filteredAndSortedData.map((item) => ({
      Code: item.code,
      Name: item.name,
      Barcode: item.barcode || "",
      UOM: item.uom,
      "Stock Group": item.stockGroupName || "Uncategorized",
      "Opening Qty": item.openingQty,
      "Opening Rate": item.openingRate,
      "Opening Value": item.openingValue,
      "Current Qty": item.currentQty,
      "Current Value": item.currentValue,
      "Selling Price": item.sellingPrice,
      Status: item.active ? "Active" : "Inactive",
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Stock Query");

    // Set column widths
    const colWidths = [
      { wch: 12 }, // Code
      { wch: 30 }, // Name
      { wch: 15 }, // Barcode
      { wch: 10 }, // UOM
      { wch: 20 }, // Stock Group
      { wch: 12 }, // Opening Qty
      { wch: 12 }, // Opening Rate
      { wch: 15 }, // Opening Value
      { wch: 12 }, // Current Qty
      { wch: 15 }, // Current Value
      { wch: 12 }, // Selling Price
      { wch: 10 }, // Status
    ];
    ws["!cols"] = colWidths;

    XLSX.writeFile(wb, `stock_query_${new Date().toISOString().split("T")[0]}.xlsx`);

    toast({
      title: "Export Successful",
      description: `Exported ${filteredAndSortedData.length} stock items to Excel`,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Stock Query</h1>
        <Button
          onClick={handleExportToExcel}
          disabled={filteredAndSortedData.length === 0}
          data-testid="button-export-excel"
        >
          <Download className="h-4 w-4 mr-2" />
          Export to Excel
        </Button>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by code, name, or barcode..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
              data-testid="input-search"
            />
          </div>

          <Select value={selectedStockGroup} onValueChange={setSelectedStockGroup}>
            <SelectTrigger data-testid="select-stock-group-filter">
              <SelectValue placeholder="All Stock Groups" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Stock Groups</SelectItem>
              <SelectItem value="null">Uncategorized</SelectItem>
              {stockGroups.map((group) => (
                <SelectItem key={group.id} value={group.id.toString()}>
                  {group.code} - {group.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="text-sm text-muted-foreground flex items-center justify-end">
            Showing {filteredAndSortedData.length} of {stockItems.length} items
          </div>
        </div>
      </Card>

      <Card className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto p-0 hover:bg-transparent"
                    onClick={() => handleSort("code")}
                    data-testid="sort-code"
                  >
                    <span className="flex items-center">
                      Code
                      {getSortIcon("code")}
                    </span>
                  </Button>
                </TableHead>
                <TableHead>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto p-0 hover:bg-transparent"
                    onClick={() => handleSort("name")}
                    data-testid="sort-name"
                  >
                    <span className="flex items-center">
                      Name
                      {getSortIcon("name")}
                    </span>
                  </Button>
                </TableHead>
                <TableHead>Barcode</TableHead>
                <TableHead>UOM</TableHead>
                <TableHead>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto p-0 hover:bg-transparent"
                    onClick={() => handleSort("stockGroup")}
                    data-testid="sort-stock-group"
                  >
                    <span className="flex items-center">
                      Stock Group
                      {getSortIcon("stockGroup")}
                    </span>
                  </Button>
                </TableHead>
                <TableHead className="text-right">Opening Qty</TableHead>
                <TableHead className="text-right">Opening Rate</TableHead>
                <TableHead className="text-right">Opening Value</TableHead>
                <TableHead className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto p-0 hover:bg-transparent"
                    onClick={() => handleSort("currentQty")}
                    data-testid="sort-current-qty"
                  >
                    <span className="flex items-center">
                      Current Qty
                      {getSortIcon("currentQty")}
                    </span>
                  </Button>
                </TableHead>
                <TableHead className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto p-0 hover:bg-transparent"
                    onClick={() => handleSort("currentValue")}
                    data-testid="sort-current-value"
                  >
                    <span className="flex items-center">
                      Current Value
                      {getSortIcon("currentValue")}
                    </span>
                  </Button>
                </TableHead>
                <TableHead className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto p-0 hover:bg-transparent"
                    onClick={() => handleSort("sellingPrice")}
                    data-testid="sort-selling-price"
                  >
                    <span className="flex items-center">
                      Selling Price
                      {getSortIcon("sellingPrice")}
                    </span>
                  </Button>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : filteredAndSortedData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                    No stock items found
                  </TableCell>
                </TableRow>
              ) : (
                filteredAndSortedData.map((item) => (
                  <TableRow key={item.id} data-testid={`row-stock-${item.id}`}>
                    <TableCell className="font-mono">{item.code}</TableCell>
                    <TableCell>{item.name}</TableCell>
                    <TableCell className="font-mono">{item.barcode || "-"}</TableCell>
                    <TableCell>{item.uom}</TableCell>
                    <TableCell>{item.stockGroupName || "Uncategorized"}</TableCell>
                    <TableCell className="text-right">{parseFloat(item.openingQty || "0").toFixed(3)}</TableCell>
                    <TableCell className="text-right">{parseFloat(item.openingRate || "0").toFixed(2)}</TableCell>
                    <TableCell className="text-right">{parseFloat(item.openingValue || "0").toFixed(2)}</TableCell>
                    <TableCell className="text-right font-medium">{parseFloat(item.currentQty || "0").toFixed(3)}</TableCell>
                    <TableCell className="text-right font-medium">{parseFloat(item.currentValue || "0").toFixed(2)}</TableCell>
                    <TableCell className="text-right font-medium">{parseFloat(item.sellingPrice || "0").toFixed(2)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
