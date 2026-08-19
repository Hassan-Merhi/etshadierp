/**
 * Condensed Factory Daybook table — matches the ERP Daybook layout:
 * Date/Type | Count | Total, with date separator rows, one collapsible row per
 * (date, txType, currency) group, and expanded entry sub-rows underneath.
 *
 * Split out of FactoryDaybook.tsx unchanged; the "Total" column disappears
 * entirely when ERP cost permissions hide daybook amounts.
 */
import { BookOpen, ChevronDown, ChevronRight, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/formatNumber";
import { cn } from "@/lib/utils";
import { currencySymbol, formatTxType, getFactoryTxTypeBadge, mergeBaleEntries } from "./daybookUtils";
import type { DaybookEntry, DisplayEntry } from "./types";
import { FactoryDaybookEntryRow } from "./FactoryDaybookEntryRow";
import type { CondensedRow, FactoryDaybookModel } from "./useFactoryDaybookModel";

function BaleSummaryRow({
  row,
  colsClass,
  expandedEntries,
  model,
}: {
  row: CondensedRow;
  colsClass: string;
  expandedEntries: DisplayEntry[];
  model: FactoryDaybookModel;
}) {
  const hasEntries = expandedEntries.length > 0;
  const mergedEntry = hasEntries
    ? mergeBaleEntries(expandedEntries.map((e) => (e as DisplayEntry)._source ?? (e as DaybookEntry)))
    : undefined;
  const viewButton = mergedEntry && (
    <Button
      size="icon"
      variant="ghost"
      title="View details"
      onClick={(e) => {
        e.stopPropagation();
        model.setViewEntry(mergedEntry);
      }}
      data-testid="button-view-bale-summary"
    >
      <Eye className="h-3 w-3" />
    </Button>
  );
  return (
    <div className={cn("grid w-full bg-muted/20 border-t items-center", colsClass)}>
      <div className="pl-14 pr-2 py-2 min-w-0">
        <span className="text-sm text-foreground">
          {row.count} bale{row.count !== 1 ? "s" : ""}
        </span>
      </div>
      <div />
      {model.showAmounts ? (
        <div className="flex items-center justify-end gap-1 pr-2 py-2">
          <span className="text-sm font-mono font-medium">
            {currencySymbol(row.currencyCode)}
            {formatNumber(row.totalAmountCurrency)}
          </span>
          {viewButton}
        </div>
      ) : (
        <div className="flex items-center justify-end gap-1 pr-2 py-2">{viewButton}</div>
      )}
    </div>
  );
}

function CondensedGroupRow({
  row,
  colsClass,
  model,
}: {
  row: CondensedRow;
  colsClass: string;
  model: FactoryDaybookModel;
}) {
  const isExpanded = model.expandedRowKey === row.key;
  const expandedEntries = isExpanded ? model.getEntriesForCondensedRow(row.key) : [];
  const { variant: bv, className: bc } = getFactoryTxTypeBadge(row.txType);
  return (
    <div className="w-full border-b last:border-b-0">
      {/* Group type row */}
      <div
        data-testid={`row-condensed-${row.date}-${row.txType}`}
        onClick={() => model.setExpandedRowKey(isExpanded ? null : row.key)}
        className={cn("grid w-full pl-6 pr-4 py-3 cursor-pointer hover-elevate items-center", colsClass)}
      >
        <div className="flex items-center gap-2 min-w-0">
          {isExpanded ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          )}
          <Badge variant={bv} className={cn(bc, "whitespace-nowrap")}>
            {formatTxType(row.txType)}
          </Badge>
        </div>
        <div className="text-center text-muted-foreground text-sm font-mono">{row.count}</div>
        {model.showAmounts && (
          <div className="text-right font-mono font-medium text-sm">
            {currencySymbol(row.currencyCode)}
            {formatNumber(row.totalAmountCurrency)}
            {row.currencyCode !== "USD" && (
              <div className="text-xs text-muted-foreground font-mono">{row.currencyCode}</div>
            )}
          </div>
        )}
      </div>

      {/* Expanded entry sub-rows */}
      {isExpanded && row.txType === "BALE_STOCK_ENTRY" && (
        <BaleSummaryRow row={row} colsClass={colsClass} expandedEntries={expandedEntries} model={model} />
      )}
      {isExpanded &&
        row.txType !== "BALE_STOCK_ENTRY" &&
        expandedEntries.map((entry) => (
          <FactoryDaybookEntryRow
            key={(entry as DisplayEntry)._vKey ?? entry.id}
            entry={entry}
            colsClass={colsClass}
            model={model}
          />
        ))}
    </div>
  );
}

function CondensedRows({ model }: { model: FactoryDaybookModel }) {
  const { condensedRows, showAmounts, formatDisplayDate } = model;
  const dateMap = new Map<string, CondensedRow[]>();
  for (const row of condensedRows) {
    if (!dateMap.has(row.date)) dateMap.set(row.date, []);
    dateMap.get(row.date)!.push(row);
  }
  const colsClass = showAmounts ? "grid-cols-[minmax(0,1fr)_100px_180px]" : "grid-cols-[minmax(0,1fr)_100px]";
  return (
    <>
      {Array.from(dateMap.entries()).map(([date, rows]) => {
        const dayTotal = rows.reduce((s, r) => s + r.totalAmountCurrency, 0);
        const dayCcy = rows[0]?.currencyCode ?? "USD";
        return (
          <div key={date} className="w-full">
            {/* Date separator row */}
            <div className={cn("grid w-full px-4 py-1.5 bg-muted/40 border-b", colsClass)}>
              <span className="font-semibold text-sm">{formatDisplayDate(date + "T00:00:00")}</span>
              <span />
              {showAmounts && (
                <span className="font-mono font-medium text-sm text-right">
                  {currencySymbol(dayCcy)}
                  {formatNumber(dayTotal)}
                </span>
              )}
            </div>

            {/* Type rows under this date */}
            {rows.map((row) => (
              <CondensedGroupRow key={row.key} row={row} colsClass={colsClass} model={model} />
            ))}
          </div>
        );
      })}
    </>
  );
}

export function FactoryDaybookTable({ model }: { model: FactoryDaybookModel }) {
  const { isLoading, filteredEntries, condensedRows, hasActiveFilters, showAmounts } = model;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Transactions
            {filteredEntries.length > 0 && (
              <span className="text-sm font-normal text-muted-foreground">
                ({`${condensedRows.length} group${condensedRows.length === 1 ? "" : "s"}`})
              </span>
            )}
          </CardTitle>
        </div>
        <CardDescription>All factory transactions in one view</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="space-y-2 p-6">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            {hasActiveFilters ? (
              <div>
                <p className="mb-2">No transactions found matching your filters.</p>
                <Button variant="outline" onClick={model.clearFilters} data-testid="button-clear-filters-empty">
                  Clear Filters
                </Button>
              </div>
            ) : (
              <>
                <BookOpen className="mx-auto h-12 w-12 text-muted-foreground" />
                <h3 className="mt-4 text-lg font-semibold">No transactions found</h3>
                <p className="mt-2">Factory transactions will appear here as you perform operations</p>
              </>
            )}
          </div>
        ) : (
          /* ── CONDENSED VIEW — matches ERP Daybook: Date/Type | Count | Total ── */
          <div className="w-full">
            {/* Header */}
            <div
              className={cn(
                "sticky top-0 z-30 bg-background border-b grid w-full px-4 py-2",
                showAmounts ? "grid-cols-[minmax(0,1fr)_100px_180px]" : "grid-cols-[minmax(0,1fr)_100px]"
              )}
            >
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Date / Type</span>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider text-center">
                Count
              </span>
              {showAmounts && (
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider text-right">
                  Total
                </span>
              )}
            </div>
            <CondensedRows model={model} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
