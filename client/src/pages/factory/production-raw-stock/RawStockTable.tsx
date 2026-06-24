import { useState, useMemo } from "react";
import { formatNumber } from "@/lib/formatNumber";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, ChevronDown, FlaskRound, Plus, MinusCircle, Layers } from "lucide-react";
import { SupplierMixBatchHistoryDialog } from "./SupplierMixBatchHistoryDialog";

interface RawStockRow {
  supplierName: string;
  supplierId: number | null;
  categoryId: number | null;
  categoryName: string | null;
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

interface RawStockTableProps {
  rawStock: RawStockRow[];
  onAdjust: (row: RawStockRow) => void;
  onDeduct: (row: RawStockRow) => void;
  onAddToBatch: (row: RawStockRow) => void;
}

export function RawStockTable({ rawStock, onAdjust, onDeduct, onAddToBatch }: RawStockTableProps) {
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({ Uncategorized: true });
  const [historyDialog, setHistoryDialog] = useState<{ supplierId: number; supplierName: string } | null>(null);

  const groupedStock = useMemo(() => {
    const groups: Record<string, RawStockRow[]> = {};
    (rawStock || []).forEach((r) => {
      const cat = r.categoryName || "Uncategorized";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(r);
    });
    return groups;
  }, [rawStock]);

  const categories = useMemo(() => Object.keys(groupedStock).sort(), [groupedStock]);

  const toggleCategory = (cat: string) => {
    setExpandedCategories((prev) => ({ ...prev, [cat]: !prev[cat] }));
  };

  return (
    <>
    <div className="border rounded-md overflow-hidden bg-card shadow-sm">
      <Table>
        <TableHeader className="bg-muted/50">
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[300px] py-4">Source / Supplier</TableHead>
            <TableHead className="text-right py-4">Total Received</TableHead>
            <TableHead className="text-right py-4">Total Used</TableHead>
            <TableHead className="text-right py-4">Reserved (Mix)</TableHead>
            <TableHead className="text-right py-4 font-semibold text-foreground">Available (Free)</TableHead>
            <TableHead className="text-right py-4">Value (USD)</TableHead>
            <TableHead className="w-[120px] py-4"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {categories.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                No raw stock available
              </TableCell>
            </TableRow>
          ) : (
            categories.map((cat) => {
              const rows = groupedStock[cat];
              const isExpanded = expandedCategories[cat];
              const catReceived = rows.reduce((s, r) => s + parseFloat(r.receivedKg), 0);
              const catUsed = rows.reduce((s, r) => s + parseFloat(r.usedKg), 0);
              const catRemaining = rows.reduce((s, r) => s + parseFloat(r.remainingKg), 0);
              const catFree = rows.reduce((s, r) => s + parseFloat(r.freeKg || "0"), 0);
              const catValue = rows.reduce((s, r) => s + parseFloat(r.valueRemainingUsd), 0);

              return (
                <>
                  <TableRow
                    key={`cat-${cat}`}
                    className="bg-muted/30 cursor-pointer hover:bg-muted/50 group/cat select-none"
                    onClick={() => toggleCategory(cat)}
                  >
                    <TableCell className="font-semibold py-3 flex items-center gap-2">
                      <div className="flex items-center justify-center w-5 h-5 rounded hover:bg-muted transition-colors">
                        {isExpanded ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                      </div>
                      <FlaskRound className="h-4 w-4 text-primary/70" />
                      {cat}
                      <Badge variant="outline" className="ml-2 font-normal text-[10px] px-1.5 h-4.5 bg-background/50">
                        {rows.length} source{rows.length !== 1 ? "s" : ""}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm py-3 text-muted-foreground">
                      {formatNumber(catReceived)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm py-3 text-muted-foreground">
                      {formatNumber(catUsed)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm py-3 text-muted-foreground">
                      {formatNumber(catRemaining - catFree)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm py-3 font-semibold text-foreground">
                      {formatNumber(catFree)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm py-3 text-muted-foreground">
                      ${formatNumber(catValue)}
                    </TableCell>
                    <TableCell className="py-3" />
                  </TableRow>

                  {isExpanded &&
                    rows.map((row, idx) => (
                      <TableRow
                        key={`${cat}-${idx}`}
                        className="group hover:bg-accent/5 transition-colors"
                        data-testid={`row-raw-stock-${row.supplierId}`}
                      >
                        <TableCell className="pl-12 py-3">
                          <div className="flex flex-col">
                            <button
                              className="font-medium text-sm text-foreground hover:text-primary hover:underline text-left w-fit cursor-pointer"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (row.supplierId)
                                  setHistoryDialog({ supplierId: row.supplierId, supplierName: row.supplierName });
                              }}
                              data-testid={`link-supplier-name-${row.supplierId}`}
                            >
                              {row.supplierName}
                            </button>
                            <span className="text-[10px] text-muted-foreground flex items-center gap-2 mt-0.5">
                              Last offload: {new Date(row.lastOffloaded).toLocaleDateString()}
                              {row.sourceType === "OPENING_BALANCE" && (
                                <span className="inline-flex items-center px-1.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-800 font-medium">
                                  OB
                                </span>
                              )}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs text-muted-foreground py-3">
                          {formatNumber(parseFloat(row.receivedKg))}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs text-muted-foreground py-3">
                          {formatNumber(parseFloat(row.usedKg))}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs text-muted-foreground py-3">
                          {formatNumber(parseFloat(row.reservedKg || "0"))}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm py-3 font-medium text-foreground">
                          {formatNumber(parseFloat(row.freeKg || "0"))}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs text-muted-foreground py-3">
                          <div className="flex flex-col items-end">
                            <span>${formatNumber(parseFloat(row.valueRemainingUsd))}</span>
                            <span className="text-[10px] opacity-60">
                              ${parseFloat(row.costPerKgUsd || "0").toFixed(4)}/kg
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="py-3 text-right pr-4">
                          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-primary hover:bg-primary/10"
                              onClick={() => onAdjust(row)}
                              title="Adjust stock cost/qty"
                              data-testid={`button-adjust-${row.supplierId}`}
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-destructive hover:bg-destructive/10"
                              onClick={() => onDeduct(row)}
                              title="Deduct damaged/wasted stock"
                              data-testid={`button-deduct-${row.supplierId}`}
                            >
                              <MinusCircle className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-emerald-600 hover:bg-emerald-50"
                              onClick={() => onAddToBatch(row)}
                              title="Add to mix batch"
                              data-testid={`button-batch-${row.supplierId}`}
                            >
                              <Layers className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                </>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>

      {historyDialog && (
        <SupplierMixBatchHistoryDialog
          supplierId={historyDialog.supplierId}
          supplierName={historyDialog.supplierName}
          open={!!historyDialog}
          onClose={() => setHistoryDialog(null)}
        />
      )}
    </>
  );
}
