import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { SaleRow } from "./posTypes";

export interface SaleGridProps {
  rows: SaleRow[];
  columns: any[];
  selectedCell: { row: number; col: number };
  setSelectedCell: (cell: { row: number; col: number }) => void;
  updateRow: (index: number, field: keyof SaleRow, value: string | number) => void;
  handleDeleteRow: (index: number) => void;
  handleKeyDown: (e: React.KeyboardEvent, rowIndex: number, colIndex: number) => void;
  setActiveRow: (row: number | null) => void;
  setSearchTerm: (term: string) => void;
  setHighlightedIndex: (index: number) => void;
  getStockWarning: (row: SaleRow) => string | null;
  formatDisplayAmount: (amount: number) => string;
  activeCurrency: string;
  exchangeRate: number;
  inputRefs: React.MutableRefObject<{ [key: string]: HTMLInputElement }>;
  clearActiveRowTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  focusCell: (rowIndex: number, colIndex: number) => void;
  toast: any;
}

export function SaleGrid({
  rows,
  columns,
  selectedCell,
  setSelectedCell,
  updateRow,
  handleDeleteRow,
  handleKeyDown,
  setActiveRow,
  setSearchTerm,
  setHighlightedIndex,
  getStockWarning,
  formatDisplayAmount,
  activeCurrency,
  exchangeRate,
  inputRefs,
  clearActiveRowTimerRef,
  focusCell,
  toast,
}: SaleGridProps) {
  return (
    <Card className="flex-1 overflow-hidden min-w-0">
      <div className="table-responsive">
        <div className="min-w-[340px] sm:min-w-[500px]">
          {/* Header */}
          <div className="flex bg-foreground/[0.06] dark:bg-muted/40 border-b border-border sticky top-0 z-30">
            <div className="w-8 sm:w-12 flex items-center justify-center border-r border-border/50 h-9 text-[11px] font-semibold text-muted-foreground">
              #
            </div>
            {columns.map((col) => (
              <div
                key={col.key}
                className={`${col.width} flex items-center px-1.5 sm:px-3 border-r border-border/50 h-9 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide`}
              >
                {col.label}
              </div>
            ))}
          </div>

          {/* Rows */}
          <div className="max-h-[calc(100vh-24rem)] overflow-y-auto">
            {rows.map((row, rowIndex) => (
              <div key={row.id}>
                <div className="group flex border-b border-muted/50 hover-elevate">
                  <div className="w-8 sm:w-12 flex items-center justify-center border-r border-muted/50 h-10 sm:h-10 text-xs text-muted-foreground">
                    {rowIndex + 1}
                  </div>
                  {columns.map((col, colIndex) => (
                    <div
                      key={col.key}
                      className={`${col.width} border-r h-10 sm:h-10 ${col.key === "amount" ? "bg-muted/30" : ""}`}
                      onMouseDown={(e) => {
                        const invalidIdx = rows.findIndex((r) => r.itemName?.trim() && !r.stockItemId);
                        if (invalidIdx !== -1 && !(rowIndex === invalidIdx && col.key === "itemName")) {
                          e.preventDefault();
                          toast({
                            title: "Select an item first",
                            description: `Row ${invalidIdx + 1} has an incomplete item. Please choose an item from the list.`,
                            variant: "destructive",
                          });
                          focusCell(invalidIdx, 0);
                        }
                      }}
                    >
                      {col.key === "delete" ? (
                        <div className="flex items-center justify-center h-full opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                          {rowIndex > 0 && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDeleteRow(rowIndex)}
                              className="h-8 w-8"
                              data-testid={`button-delete-row-${rowIndex}`}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      ) : col.key === "plBale" || col.key === "totalPL" ? (
                        (() => {
                          const cfgUSD = row.configuredPrice ?? 0;
                          const plBaleUSD = row.rateUSD - cfgUSD;
                          const plBaleDisplay =
                            activeCurrency === "CFA" && exchangeRate ? plBaleUSD * exchangeRate : plBaleUSD;
                          const val = col.key === "plBale" ? plBaleDisplay : plBaleDisplay * row.quantity;
                          const hasConfig = row.stockItemId && cfgUSD > 0;
                          const color = !hasConfig
                            ? undefined
                            : val > 0
                              ? "text-green-700 dark:text-green-400"
                              : val < 0
                                ? "text-red-600 dark:text-red-400"
                                : "text-muted-foreground";
                          return (
                            <div
                              className={`flex items-center justify-end h-full px-1.5 sm:px-2 font-mono text-xs sm:text-sm ${color ?? "text-muted-foreground"}`}
                            >
                              {hasConfig ? formatDisplayAmount(Math.abs(val)) : "—"}
                            </div>
                          );
                        })()
                      ) : (
                        <input
                          ref={(el) => {
                            if (el) inputRefs.current[`${rowIndex}-${colIndex}`] = el;
                          }}
                          type={col.key === "quantity" || col.key === "rate" ? "number" : "text"}
                          inputMode={col.key === "quantity" || col.key === "rate" ? "decimal" : undefined}
                          value={
                            col.key === "amount"
                              ? formatDisplayAmount(row.amount)
                              : col.key === "quantity" || col.key === "rate"
                                ? row[col.key as keyof SaleRow] === 0
                                  ? ""
                                  : row[col.key as keyof SaleRow]
                                : row[col.key as keyof SaleRow]
                          }
                          onChange={(e) => {
                            if (col.key !== "amount") {
                              updateRow(rowIndex, col.key as keyof SaleRow, e.target.value);
                              if (col.key === "itemName") {
                                setSearchTerm(e.target.value);
                                setHighlightedIndex(0);
                              }
                            }
                          }}
                          onKeyDown={(e) => handleKeyDown(e, rowIndex, colIndex)}
                          onFocus={() => {
                            setSelectedCell({ row: rowIndex, col: colIndex });
                            if (col.key === "itemName") {
                              setActiveRow(rowIndex);
                              setSearchTerm(row.itemName);
                              setHighlightedIndex(0);
                            } else if (
                              (col.key === "quantity" || col.key === "rate") &&
                              row.itemName?.trim() &&
                              !row.stockItemId
                            ) {
                              toast({
                                title: "Invalid item",
                                description: "Please select an item from the list.",
                                variant: "destructive",
                              });
                              setTimeout(() => {
                                setSelectedCell({ row: rowIndex, col: 0 });
                                focusCell(rowIndex, 0);
                                setActiveRow(rowIndex);
                                setSearchTerm(row.itemName);
                                setHighlightedIndex(0);
                              }, 0);
                              return;
                            }
                          }}
                          onBlur={() => {
                            if (col.key === "itemName") {
                              clearActiveRowTimerRef.current = setTimeout(() => {
                                setActiveRow(null);
                              }, 200);
                            }
                          }}
                          readOnly={col.key === "amount"}
                          className={`w-full h-full px-1.5 sm:px-3 bg-transparent outline-none focus:bg-accent/20 text-xs sm:text-sm ${
                            col.key === "quantity" || col.key === "rate" || col.key === "amount"
                              ? "font-mono text-right"
                              : ""
                          } ${col.key === "amount" ? "cursor-not-allowed" : ""} ${
                            col.key === "quantity" && getStockWarning(row) ? "text-destructive font-bold" : ""
                          }`}
                          placeholder={col.key === "itemName" ? "Type to search..." : ""}
                          style={col.key === "quantity" || col.key === "rate" ? { fontSize: "16px" } : undefined}
                          data-testid={`input-${col.key}-${rowIndex}`}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
