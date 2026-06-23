import { ChevronDown, ChevronRight, Package, Eye, ExternalLink, Lock, Edit, EyeOff, Trash2 } from "lucide-react";
import { parseISO } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { getVoucherTypeBadge } from "@/lib/voucherTypeBadge";
import { cn } from "@/lib/utils";
import { DaybookRow, Voucher, ViewVoucherEntry } from "./types";

interface DaybookTableProps {
  displayedRows: DaybookRow[];
  visibleRows: DaybookRow[];
  viewMode: "detailed" | "condensed";
  selectedRowId: string | null;
  setSelectedRowId: (id: string | null) => void;
  hiddenRowIds: Set<string>;
  setHiddenRowIds: (ids: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  showHidden: boolean;
  expandedVoucherId: number | null;
  setExpandedVoucherId: (id: number | null) => void;
  expandedCondensedGroups: Set<string>;
  setExpandedCondensedGroups: (ids: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  hideAmounts: boolean;
  accountNameCache: Record<number, string>;
  expandedLoading: boolean;
  expandedEntries: ViewVoucherEntry[];
  formatAmount: (amt: any) => string;
  formatDisplayDate: (date: Date | string) => string;
  formatDisplayTime: (date: string) => string;
  handleView: (v: Voucher) => void;
  handleEdit: (v: Voucher) => void;
  handleDelete: (v: Voucher) => void;
  canEdit: (v: Voucher) => boolean;
  canDelete: () => boolean;
  daybookRowLimit: number;
  setDaybookRowLimit: (n: number | ((prev: number) => number)) => void;
  DAYBOOK_PAGE_SIZE: number;
  navigate: (path: string) => void;
}

export function DaybookTable({
  displayedRows,
  visibleRows,
  viewMode,
  selectedRowId,
  setSelectedRowId,
  hiddenRowIds,
  setHiddenRowIds,
  showHidden,
  expandedVoucherId,
  setExpandedVoucherId,
  expandedCondensedGroups,
  setExpandedCondensedGroups,
  hideAmounts,
  accountNameCache,
  expandedLoading,
  expandedEntries,
  formatAmount,
  formatDisplayDate,
  formatDisplayTime,
  handleView,
  handleEdit,
  handleDelete,
  canEdit,
  canDelete,
  daybookRowLimit,
  setDaybookRowLimit,
  DAYBOOK_PAGE_SIZE,
  navigate,
}: DaybookTableProps) {
  const rowId = (row: DaybookRow): string => {
    return row._type === "voucher" ? `voucher-${(row.data as Voucher).id}` : `offload-${row.data.id}`;
  };

  if (viewMode === "condensed") {
    const groups: Record<string, { total: number; rows: DaybookRow[] }> = {};
    for (const row of visibleRows) {
      const type = row._type === "voucher" ? row.data.voucherType : "Offload";
      if (!groups[type]) groups[type] = { total: 0, rows: [] };
      groups[type].rows.push(row);
      const amt =
        row._type === "voucher"
          ? parseFloat(String(row.data.totalAmount || "0"))
          : parseFloat(String(row.data.itemsTotal || "0"));
      groups[type].total += amt;
    }

    return (
      <Table wrapperClassName="max-h-[calc(100vh-220px)]">
        <TableHeader className="sticky top-0 z-20 bg-background">
          <TableRow>
            <TableHead className="sticky left-0 bg-muted z-10 pl-6">Group / Voucher Type</TableHead>
            <TableHead className="text-right">Entries</TableHead>
            {!hideAmounts && <TableHead className="text-right">Total Amount</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Object.entries(groups).map(([type, g]) => {
            const groupKey = `group-${type}`;
            const isGroupExpanded = expandedCondensedGroups.has(groupKey);
            const badge =
              type === "Offload"
                ? { className: "bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-500/30" }
                : getVoucherTypeBadge(type);
            return (
              <div key={groupKey} style={{ display: "contents" }}>
                <TableRow
                  className="cursor-pointer hover:bg-muted/50 font-medium"
                  onClick={() =>
                    setExpandedCondensedGroups((prev) => {
                      const next = new Set(prev);
                      if (next.has(groupKey)) next.delete(groupKey);
                      else next.add(groupKey);
                      return next;
                    })
                  }
                >
                  <TableCell className="sticky left-0 bg-background z-10 pl-6">
                    <div className="flex items-center gap-2">
                      {isGroupExpanded ? (
                        <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
                      ) : (
                        <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
                      )}
                      <Badge {...badge}>{type}</Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground text-sm font-mono">{g.rows.length}</TableCell>
                  {!hideAmounts && (
                    <TableCell className="text-right font-mono font-medium">{formatAmount(g.total)}</TableCell>
                  )}
                </TableRow>
                {isGroupExpanded &&
                  g.rows.map((row) => {
                    if (row._type === "offload") {
                      const o = row.data;
                      const offloadDesc = [o.containerNumber, o.locationName].filter(Boolean).join(" — ");
                      return (
                        <TableRow key={`${groupKey}-offload-${o.id}`} className="bg-muted/20">
                          <TableCell className="sticky left-0 bg-muted/20 z-10 pl-14 max-w-0 w-full overflow-hidden">
                            <div className="truncate text-sm text-foreground" title={offloadDesc || "—"}>
                              {offloadDesc || "—"}
                            </div>
                          </TableCell>
                          <TableCell />
                          {!hideAmounts && (
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-2">
                                <span className="text-sm font-mono font-medium">
                                  {formatAmount(Number(o.itemsTotal))}
                                </span>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigate(`/offloads/${o.id}`);
                                  }}
                                  title="View"
                                >
                                  <Eye className="w-3 h-3" />
                                </Button>
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    } else {
                      const voucher = row.data as Voucher;
                      const vDesc =
                        voucher.description ||
                        ((voucher.voucherType === "Payment" ||
                          voucher.voucherType === "Receipt" ||
                          voucher.voucherType === "Journal") &&
                        accountNameCache[voucher.id]
                          ? accountNameCache[voucher.id]
                          : null);
                      return (
                        <TableRow key={`${groupKey}-v-${voucher.id}`} className="bg-muted/20">
                          <TableCell className="sticky left-0 bg-muted/20 z-10 pl-14 max-w-0 w-full overflow-hidden">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="truncate text-sm text-foreground" title={vDesc || voucher.voucherNumber}>
                                {vDesc || voucher.voucherNumber}
                              </div>
                              {voucher.optional && (
                                <Badge
                                  variant="outline"
                                  className="text-xs text-muted-foreground shrink-0"
                                  data-testid={`badge-optional-condensed-${voucher.id}`}
                                >
                                  Optional
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell />
                          {!hideAmounts && (
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-2">
                                <span className="text-sm font-mono font-medium">
                                  {formatAmount(voucher.totalAmount)}
                                </span>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleView(voucher);
                                  }}
                                  title="View"
                                >
                                  <Eye className="w-3 h-3" />
                                </Button>
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    }
                  })}
              </div>
            );
          })}
        </TableBody>
      </Table>
    );
  }

  /* ── Detailed view: date separator rows + inline expand ── */
  const tableRows: JSX.Element[] = [];
  let lastDate = "";
  for (const row of displayedRows) {
    const rowDate = row._type === "voucher" ? row.data.voucherDate : row.data.offloadedAt.slice(0, 10);
    if (rowDate !== lastDate) {
      const dayRows = displayedRows.filter((r) => {
        const d = r._type === "voucher" ? r.data.voucherDate : r.data.offloadedAt.slice(0, 10);
        return d === rowDate;
      });
      const dayTotal = dayRows.reduce((sum, r) => {
        const amt =
          r._type === "voucher"
            ? parseFloat(String(r.data.totalAmount || "0"))
            : parseFloat(String(r.data.itemsTotal || "0"));
        return sum + amt;
      }, 0);
      tableRows.push(
        <TableRow key={`date-sep-${rowDate}`} className="bg-muted/30 pointer-events-none select-none">
          <TableCell colSpan={hideAmounts ? 4 : 5} className="sticky left-0 bg-muted/30 z-10 py-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {formatDisplayDate(parseISO(rowDate))}
                <span className="ml-2 font-normal normal-case text-muted-foreground/70">
                  ({dayRows.length} {dayRows.length === 1 ? "entry" : "entries"})
                </span>
              </span>
              {!hideAmounts && (
                <span className="text-xs font-mono font-medium text-muted-foreground">{formatAmount(dayTotal)}</span>
              )}
            </div>
          </TableCell>
        </TableRow>
      );
      lastDate = rowDate;
    }

    if (row._type === "offload") {
      const o = row.data;
      const rid = `offload-${o.id}`;
      tableRows.push(
        <TableRow
          key={rid}
          data-row-id={rid}
          data-testid={`row-offload-${o.id}`}
          className={cn("group cursor-pointer", selectedRowId === rid ? "bg-accent/30" : "hover:bg-muted/40")}
          onClick={() => setSelectedRowId(rid)}
        >
          <TableCell className="font-medium sticky left-0 bg-background z-10">
            {formatDisplayDate(parseISO(o.offloadedAt.slice(0, 10)))}
          </TableCell>
          <TableCell>
            <Badge className="bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-500/30">
              <Package className="w-3 h-3 mr-1" />
              Offload
            </Badge>
          </TableCell>
          <TableCell className="max-w-md truncate">
            {o.containerNumber}
            {o.locationName ? ` — ${o.locationName}` : ""}
          </TableCell>
          {!hideAmounts && (
            <TableCell className="text-right font-mono font-medium">{formatAmount(Number(o.itemsTotal))}</TableCell>
          )}
          <TableCell className="text-right">
            <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate(`/offloads/${o.id}`)}
                data-testid={`button-view-offload-${o.id}`}
              >
                <Eye className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate(`/containers/${o.containerId}`)}
                data-testid={`button-goto-container-${o.id}`}
              >
                <ExternalLink className="w-4 h-4" />
              </Button>
            </div>
          </TableCell>
        </TableRow>
      );
    } else {
      const voucher = row.data as Voucher;
      const isDvPendingSync = voucher.id < 0;
      const dvid = `voucher-${voucher.id}`;
      const isDvHidden = hiddenRowIds.has(dvid);
      const isExpanded = expandedVoucherId === voucher.id;
      const isLockedType = voucher.voucherType === "Sales" || voucher.voucherType === "Purchase";
      tableRows.push(
        <TableRow
          key={dvid}
          data-row-id={dvid}
          data-testid={`row-voucher-${voucher.id}`}
          className={cn(
            "group",
            !isDvPendingSync && "cursor-pointer",
            isDvPendingSync && "opacity-75",
            selectedRowId === dvid && "bg-accent/30",
            isDvHidden && showHidden && "opacity-50",
            isExpanded && "bg-accent/20",
            !isDvPendingSync && !isExpanded && selectedRowId !== dvid && "hover:bg-muted/40"
          )}
          onClick={() => {
            if (isDvPendingSync) return;
            setSelectedRowId(dvid);
            setExpandedVoucherId(isExpanded ? null : voucher.id);
          }}
        >
          <TableCell className="font-medium sticky left-0 bg-background z-10">
            <div className="flex flex-col">
              <span>{formatDisplayDate(parseISO(voucher.voucherDate))}</span>
              <span className="text-xs text-muted-foreground">{formatDisplayTime(voucher.createdAt)}</span>
            </div>
          </TableCell>
          <TableCell>
            <div className="flex items-center gap-2">
              <Badge {...getVoucherTypeBadge(voucher.voucherType)} data-testid={`badge-type-${voucher.id}`}>
                {voucher.voucherType}
              </Badge>
              {isDvPendingSync && (
                <Badge variant="outline" className="text-xs text-amber-600 dark:text-amber-400 border-amber-400">
                  Pending sync
                </Badge>
              )}
              {voucher.optional && (
                <Badge variant="outline" data-testid={`badge-optional-${voucher.id}`} className="text-xs">
                  Optional
                </Badge>
              )}
              {isDvHidden && (
                <Badge variant="outline" className="text-xs text-muted-foreground">
                  Hidden
                </Badge>
              )}
            </div>
          </TableCell>
          <TableCell className="max-w-md">
            <div className="flex items-center gap-1">
              <ChevronRight
                className={cn("w-3 h-3 text-muted-foreground shrink-0 transition-transform", isExpanded && "rotate-90")}
              />
              <span className="truncate">
                {voucher.description ||
                  (voucher.voucherType === "Payment" ||
                  voucher.voucherType === "Receipt" ||
                  voucher.voucherType === "Journal"
                    ? `${voucher.voucherType}${accountNameCache[voucher.id] ? ` (${accountNameCache[voucher.id]})` : ""}`
                    : "-")}
              </span>
            </div>
          </TableCell>
          {!hideAmounts && (
            <TableCell className="text-right font-mono font-medium">{formatAmount(voucher.totalAmount)}</TableCell>
          )}
          <TableCell className="text-right">
            {isDvPendingSync ? (
              <span className="text-xs text-amber-600 dark:text-amber-400 italic">Pending sync</span>
            ) : (
              <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleView(voucher);
                  }}
                  data-testid={`button-view-${voucher.id}`}
                  title="View detail"
                >
                  <Eye className="w-4 h-4" />
                </Button>
                {isLockedType ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEdit(voucher);
                    }}
                    data-testid={`button-edit-${voucher.id}`}
                    title={`Edit in ${voucher.voucherType === "Sales" ? "Sales" : "Containers"}`}
                  >
                    <Lock className="w-4 h-4 text-muted-foreground" />
                  </Button>
                ) : canEdit(voucher) ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEdit(voucher);
                    }}
                    data-testid={`button-edit-${voucher.id}`}
                  >
                    <Edit className="w-4 h-4" />
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isDvHidden) {
                      setHiddenRowIds((prev) => {
                        const next = new Set(prev);
                        next.delete(dvid);
                        return next;
                      });
                    } else {
                      setHiddenRowIds((prev) => {
                        const next = new Set(prev);
                        next.add(dvid);
                        return next;
                      });
                      if (selectedRowId === dvid) setSelectedRowId(null);
                    }
                  }}
                  data-testid={isDvHidden ? `button-unhide-${voucher.id}` : `button-hide-${voucher.id}`}
                  title={isDvHidden ? "Unhide row" : "Hide row"}
                >
                  {isDvHidden ? (
                    <Eye className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <EyeOff className="w-4 h-4 text-muted-foreground" />
                  )}
                </Button>
                {canDelete() && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(voucher);
                    }}
                    data-testid={`button-delete-${voucher.id}`}
                  >
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                )}
              </div>
            )}
          </TableCell>
        </TableRow>
      );
      if (isExpanded) {
        tableRows.push(
          <TableRow key={`${dvid}-expand`} className="bg-muted/10">
            <TableCell colSpan={hideAmounts ? 4 : 5} className="p-0">
              <div className="px-8 py-3 border-t border-dashed">
                {expandedLoading ? (
                  <div className="space-y-1.5">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                  </div>
                ) : expandedEntries.filter((e: ViewVoucherEntry) => !e.isStockItem && !e.stockItemId).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No ledger entries found.</p>
                ) : (
                  <div className="space-y-0.5">
                    {expandedEntries
                      .filter((e: ViewVoucherEntry) => !e.isStockItem && !e.stockItemId)
                      .map((e: ViewVoucherEntry, idx: number) => (
                        <div key={idx} className="flex items-center justify-between text-sm py-0.5">
                          <span className="text-muted-foreground truncate max-w-xs">
                            {e.accountName ||
                              (e as any).supplierName ||
                              (e as any).employeeName ||
                              (e as any).assetName ||
                              "—"}
                            {e.narration && (
                              <span className="ml-2 text-xs italic text-muted-foreground/60">{e.narration}</span>
                            )}
                          </span>
                          <div className="flex items-center gap-4 shrink-0 ml-4">
                            {parseFloat(e.debitAmount || "0") > 0 && !hideAmounts && (
                              <span className="font-mono text-xs text-red-600 dark:text-red-400">
                                Dr {formatAmount(parseFloat(e.debitAmount))}
                              </span>
                            )}
                            {parseFloat(e.creditAmount || "0") > 0 && !hideAmounts && (
                              <span className="font-mono text-xs text-green-600 dark:text-green-400">
                                Cr {formatAmount(parseFloat(e.creditAmount))}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </TableCell>
          </TableRow>
        );
      }
    }
  }

  return (
    <>
      <Table wrapperClassName="max-h-[calc(100vh-220px)]">
        <TableHeader className="sticky top-0 z-20 bg-background">
          <TableRow>
            <TableHead className="sticky left-0 bg-muted z-10">Date</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Description</TableHead>
            {!hideAmounts && <TableHead className="text-right">Amount</TableHead>}
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>{tableRows}</TableBody>
      </Table>
      {displayedRows.length < visibleRows.length && (
        <div className="flex justify-center pt-3 pb-1">
          <Button
            variant="outline"
            onClick={() => setDaybookRowLimit((prev) => prev + DAYBOOK_PAGE_SIZE)}
            data-testid="button-daybook-load-more"
          >
            Show {Math.min(DAYBOOK_PAGE_SIZE, visibleRows.length - displayedRows.length)} more
            <span className="ml-2 text-xs text-muted-foreground">
              ({displayedRows.length} of {visibleRows.length})
            </span>
          </Button>
        </div>
      )}
    </>
  );
}
