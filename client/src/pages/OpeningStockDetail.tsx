import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useParams, useSearch } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, Package, Search } from "lucide-react";
import { useCompany } from "@/contexts/CompanyContext";

interface StockItemData {
  id: number;
  code: string;
  name: string;
  uom: string;
  opening: {
    quantity: number;
    rate: number;
    value: number;
  };
  closing: {
    quantity: number;
    rate: number;
    value: number;
  };
}

interface StockGroupItemsData {
  items: StockItemData[];
  grandTotal: {
    opening: { quantity: number; value: number };
    closing: { quantity: number; value: number };
  };
  stockGroup: {
    id: number;
    code: string;
    name: string;
  } | null;
}

interface InventoryRecord {
  id: number;
  locationId: number;
  locationName: string | null;
  quantity: number;
  averageRate: number;
  totalValue: number;
  lastUpdated: string;
}

interface DebugData {
  stockItem: {
    id: number;
    code: string;
    name: string;
    stockGroupId: number | null;
    openingQty: string;
    openingRate: string;
    openingValue: string;
  };
  inventoryRecords: InventoryRecord[];
  totals: {
    recordCount: number;
    totalQuantity: number;
    totalValue: number;
    calculatedRate: number;
  };
}

function formatNumber(value: number, decimals: number = 2): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatQty(value: number, uom: string = "BL"): string {
  if (value === 0) return "";
  return `${formatNumber(value)} ${uom}`;
}

function formatValue(value: number): string {
  if (value === 0) return "";
  return formatNumber(value);
}

export default function OpeningStockDetail() {
  const [, navigate] = useLocation();
  const params = useParams<{ groupId: string }>();
  const searchString = useSearch();
  const { selectedCompany } = useCompany();
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);

  const searchParams = new URLSearchParams(searchString);
  const groupName = searchParams.get("name") || "Stock Group";

  const { data, isLoading } = useQuery<StockGroupItemsData>({
    queryKey: [
      `/api/reports/opening-stock-summary/${params.groupId}/items`,
      selectedCompany?.id,
    ],
    enabled: !!selectedCompany?.id && !!params.groupId,
  });

  const { data: debugData, isLoading: debugLoading } = useQuery<DebugData>({
    queryKey: [`/api/debug/inventory/${selectedItemId}`, selectedCompany?.id],
    enabled: !!selectedCompany?.id && !!selectedItemId,
  });

  // Calculate grand total rates
  const openingRate = data?.grandTotal?.opening?.quantity && data.grandTotal.opening.quantity > 0
    ? data.grandTotal.opening.value / data.grandTotal.opening.quantity
    : 0;
  const closingRate = data?.grandTotal?.closing?.quantity && data.grandTotal.closing.quantity > 0
    ? data.grandTotal.closing.value / data.grandTotal.closing.quantity
    : 0;

  const handleItemClick = (itemId: number) => {
    setSelectedItemId(itemId);
  };

  const selectedItem = data?.items.find((i) => i.id === selectedItemId);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/opening-stock")}
          data-testid="button-back"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Package className="h-6 w-6" />
            Stock Group Summary
          </h1>
          <p className="text-muted-foreground text-sm">
            {data?.stockGroup?.name || groupName} - {selectedCompany?.name}
          </p>
        </div>
      </div>

      <Card className="overflow-hidden">
        {/* Header */}
        <div className="bg-primary text-primary-foreground">
          <div className="grid grid-cols-7 p-3 font-semibold text-sm">
            <div className="col-span-1">Particulars</div>
            <div className="col-span-3 text-center border-l border-primary-foreground/30">
              Opening Balance
            </div>
            <div className="col-span-3 text-center border-l border-primary-foreground/30">
              Closing Balance
            </div>
          </div>
          <div className="grid grid-cols-7 px-3 pb-2 text-xs">
            <div></div>
            <div className="text-right">Quantity</div>
            <div className="text-right">Rate</div>
            <div className="text-right">Value</div>
            <div className="text-right border-l border-primary-foreground/30 pl-2">Quantity</div>
            <div className="text-right">Rate</div>
            <div className="text-right">Value</div>
          </div>
        </div>

        {/* Body */}
        <div className="divide-y">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : data?.items && data.items.length > 0 ? (
            <>
              {data.items.map((item) => (
                <div
                  key={item.id}
                  className="grid grid-cols-7 p-3 cursor-pointer hover-elevate"
                  onClick={() => handleItemClick(item.id)}
                  data-testid={`row-stock-item-${item.id}`}
                >
                  <div className="font-medium truncate flex items-center gap-1" title={item.name}>
                    <Search className="h-3 w-3 text-muted-foreground" />
                    {item.name}
                  </div>
                  {/* Opening Balance */}
                  <div className="text-right font-mono text-sm">
                    {formatQty(item.opening.quantity, item.uom)}
                  </div>
                  <div className="text-right font-mono text-sm">
                    {formatValue(item.opening.rate)}
                  </div>
                  <div className="text-right font-mono text-sm">
                    {formatValue(item.opening.value)}
                  </div>
                  {/* Closing Balance */}
                  <div className="text-right font-mono text-sm border-l pl-2">
                    {formatQty(item.closing.quantity, item.uom)}
                  </div>
                  <div className="text-right font-mono text-sm">
                    {formatValue(item.closing.rate)}
                  </div>
                  <div className="text-right font-mono text-sm">
                    {formatValue(item.closing.value)}
                  </div>
                </div>
              ))}
            </>
          ) : (
            <div className="p-8 text-center text-muted-foreground">
              No items in this stock group.
            </div>
          )}
        </div>

        {/* Grand Total */}
        {data?.grandTotal && (
          <div className="bg-muted/50 border-t-2 border-primary">
            <div className="grid grid-cols-7 p-3 font-bold">
              <div>Grand Total</div>
              {/* Opening Total */}
              <div className="text-right font-mono">
                {formatNumber(data.grandTotal.opening.quantity)} BL
              </div>
              <div className="text-right font-mono">
                {formatNumber(openingRate)}
              </div>
              <div className="text-right font-mono">
                {formatNumber(data.grandTotal.opening.value)}
              </div>
              {/* Closing Total */}
              <div className="text-right font-mono border-l pl-2">
                {formatNumber(data.grandTotal.closing.quantity)} BL
              </div>
              <div className="text-right font-mono">
                {formatNumber(closingRate)}
              </div>
              <div className="text-right font-mono">
                {formatNumber(data.grandTotal.closing.value)}
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Debug Dialog */}
      <Dialog open={!!selectedItemId} onOpenChange={(open) => !open && setSelectedItemId(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>
              Inventory Details: {selectedItem?.name || "Loading..."}
            </DialogTitle>
          </DialogHeader>

          {debugLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : debugData ? (
            <div className="space-y-4">
              {/* Stock Item Info */}
              <div className="bg-muted/50 p-4 rounded-lg">
                <h3 className="font-semibold mb-2">Stock Item Master Data</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>Code: <span className="font-mono">{debugData.stockItem.code}</span></div>
                  <div>Name: {debugData.stockItem.name}</div>
                  <div>Opening Qty: <span className="font-mono">{debugData.stockItem.openingQty}</span></div>
                  <div>Opening Rate: <span className="font-mono">{debugData.stockItem.openingRate}</span></div>
                  <div>Opening Value: <span className="font-mono">{debugData.stockItem.openingValue}</span></div>
                </div>
              </div>

              {/* Inventory Records */}
              <div>
                <h3 className="font-semibold mb-2">
                  Inventory Records ({debugData.totals.recordCount} records)
                </h3>
                {debugData.inventoryRecords.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>ID</TableHead>
                        <TableHead>Location</TableHead>
                        <TableHead className="text-right">Quantity</TableHead>
                        <TableHead className="text-right">Avg Rate</TableHead>
                        <TableHead className="text-right">Total Value</TableHead>
                        <TableHead>Last Updated</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {debugData.inventoryRecords.map((rec) => (
                        <TableRow key={rec.id}>
                          <TableCell className="font-mono">{rec.id}</TableCell>
                          <TableCell>{rec.locationName || `Location ${rec.locationId}`}</TableCell>
                          <TableCell className="text-right font-mono">
                            {formatNumber(rec.quantity)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatNumber(rec.averageRate)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatNumber(rec.totalValue)}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {new Date(rec.lastUpdated).toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-muted-foreground text-center py-4">
                    No inventory records found for this item.
                  </p>
                )}
              </div>

              {/* Totals */}
              <div className="bg-primary/10 p-4 rounded-lg">
                <h3 className="font-semibold mb-2">Calculated Totals (Closing Balance)</h3>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <div className="text-2xl font-bold font-mono">
                      {formatNumber(debugData.totals.totalQuantity)}
                    </div>
                    <div className="text-sm text-muted-foreground">Total Quantity</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold font-mono">
                      {formatNumber(debugData.totals.calculatedRate)}
                    </div>
                    <div className="text-sm text-muted-foreground">Weighted Avg Rate</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold font-mono">
                      {formatNumber(debugData.totals.totalValue)}
                    </div>
                    <div className="text-sm text-muted-foreground">Total Value</div>
                  </div>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                The closing balance shown in the summary is calculated by adding up all inventory 
                records above. If this doesn't match your expected inventory, check each location's 
                quantity for discrepancies.
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-8">
              Unable to load inventory details.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
