import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Plus,
  Trash2,
  Star,
  Pencil,
  FileText,
  Download,
  Truck,
  ArrowRightLeft,
  BookmarkCheck,
  ChevronDown,
  ChevronRight,
  Users,
  Package,
  MoreHorizontal,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DeleteConfirmDialog } from "@/components/ConfirmationDialog";

import { effectivePricePerBale } from "./factoryproformas/utils";
import { useFactoryProformasModel } from "./factoryproformas/useFactoryProformasModel";
import { FactoryProformasHeader } from "./factoryproformas/FactoryProformasHeader";
import { RenameProformaDialog } from "./factory-proformas/dialogs/RenameProformaDialog";
import { TransferProformaDialog } from "./factory-proformas/dialogs/TransferProformaDialog";
import { AddPriceLineDialog } from "./factory-proformas/dialogs/AddPriceLineDialog";
import { EditPriceLineDialog } from "./factory-proformas/dialogs/EditPriceLineDialog";
import { CreatePendingLoadingDialog } from "./factory-proformas/dialogs/CreatePendingLoadingDialog";
import { ImportProformaExcelDialog } from "./factory-proformas/dialogs/ImportProformaExcelDialog";
export default function FactoryProformas() {
  const {
    formatAmount,
    navigate,
    selectedCustomerId,
    setSelectedCustomerId,
    expandedProformaIds,
    setExpandedProformaIds,
    isCreateOpen,
    setIsCreateOpen,
    newProformaName,
    setNewProformaName,
    isAddLineOpen,
    setIsAddLineOpen,
    addLineProformaId: _addLineProformaId,
    setAddLineProformaId,
    newLine,
    setNewLine,
    editingLine,
    setEditingLine,
    editLineValues,
    setEditLineValues,
    pendingDelete,
    setPendingDelete,
    inlineQtyLineId,
    setInlineQtyLineId,
    inlineQtyValue,
    setInlineQtyValue,
    renamingProforma,
    setRenamingProforma,
    renameValue,
    setRenameValue,
    addLineMode,
    setAddLineMode,
    catalogSearch,
    setCatalogSearch,
    catalogSelectedItem,
    setCatalogSelectedItem,
    createLoadingProforma,
    setCreateLoadingProforma,
    createLoadingLocationId,
    setCreateLoadingLocationId,
    transferProforma,
    setTransferProforma,
    transferTargetCustomerId,
    setTransferTargetCustomerId,
    showInactive,
    setShowInactive,
    proformaSearch,
    setProformaSearch,
    isExcelImportOpen,
    setIsExcelImportOpen,
    excelImportName,
    setExcelImportName,
    excelImportLines,
    setExcelImportLines,
    excelImportErrors,
    setExcelImportErrors,
    excelImportLoading,
    excelFileInputRef,
    customerId,
    hideProformaPrice,
    canEdit,
    customers,
    customersLoading,
    proformas,
    proformasLoading,
    expandedProformaStateById,
    allStockItems,
    priceListMap,
    locations,
    createLoadingMutation,
    createProformaMutation,
    toggleActiveMutation,
    deleteProformaMutation,
    renameProformaMutation,
    transferProformaMutation,
    addLineMutation,
    editLineMutation,
    deleteLineMutation,
    inlineQtyMutation: _inlineQtyMutation,
    commitInlineQty,
    formatProformaDate,
    bulkImportMutation,
    downloadProformaTemplate,
    handleExcelFile,
    saveAgreedPricesMutation,
    applyCatalogPricesMutation,
    applyProductionPricesMutation,
    handleCreateProforma,
    handleAddLine,
    handleEditLine,
  } = useFactoryProformasModel();

  return (
    <div className="flex flex-col h-full">
      <FactoryProformasHeader
        customerId={customerId}
        setExcelImportName={setExcelImportName}
        setExcelImportLines={setExcelImportLines}
        setExcelImportErrors={setExcelImportErrors}
        setIsExcelImportOpen={setIsExcelImportOpen}
        setIsCreateOpen={setIsCreateOpen}
        customersLoading={customersLoading}
        selectedCustomerId={selectedCustomerId}
        setSelectedCustomerId={setSelectedCustomerId}
        setExpandedProformaIds={setExpandedProformaIds}
        setProformaSearch={setProformaSearch}
        customers={customers}
        proformaSearch={proformaSearch}
      />

      {/* ── Content area ─────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto px-6 py-5">
        {/* Loading skeletons */}
        {customerId && proformasLoading && (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <Skeleton className="h-20 w-full rounded-lg" key={i} />
            ))}
          </div>
        )}

        {/* Empty: no customer selected */}
        {!customerId && !customersLoading && (
          <div
            className="flex flex-col items-center justify-center py-20 text-center"
            data-testid="text-select-customer"
          >
            <div className="rounded-full bg-muted p-4 mb-4">
              <Users className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="font-medium text-muted-foreground">No customer selected</p>
            <p className="text-sm text-muted-foreground mt-1">Pick a customer above to view their proformas</p>
          </div>
        )}

        {/* Empty: customer selected but no proformas */}
        {customerId && !proformasLoading && proformas.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center" data-testid="text-no-proformas">
            <div className="rounded-full bg-muted p-4 mb-4">
              <FileText className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="font-medium text-muted-foreground">No proformas yet</p>
            <p className="text-sm text-muted-foreground mt-1">Create a proforma to define this customer's pricing</p>
            <Button size="sm" className="mt-4" onClick={() => setIsCreateOpen(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              New Proforma
            </Button>
          </div>
        )}

        {/* Proforma list */}
        {customerId && !proformasLoading && proformas.length > 0 && (
          <div className="space-y-3">
            {/* Inactive toggle + search status */}
            {(() => {
              const inactiveCount = proformas.filter((p) => !p.isActive).length;
              const searchTerm = proformaSearch.trim().toLowerCase();
              const visibleProformas = proformas
                .filter((p) => p.isActive || showInactive)
                .filter((p) => !searchTerm || p.name.toLowerCase().includes(searchTerm));
              const allExpanded =
                visibleProformas.length > 0 && visibleProformas.every((p) => expandedProformaIds.has(p.id));
              return (
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  {searchTerm ? (
                    <p className="text-sm text-muted-foreground">
                      {visibleProformas.length === 0
                        ? `No proformas match "${proformaSearch}"`
                        : `${visibleProformas.length} proforma${visibleProformas.length !== 1 ? "s" : ""} matching "${proformaSearch}"`}
                    </p>
                  ) : (
                    <div />
                  )}
                  <div className="flex items-center gap-2 ml-auto">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (allExpanded) {
                          setExpandedProformaIds(new Set());
                        } else {
                          setExpandedProformaIds(new Set(visibleProformas.map((p) => p.id)));
                        }
                      }}
                      data-testid="button-expand-collapse-all"
                      className="text-muted-foreground"
                    >
                      {allExpanded ? "Collapse all" : "Expand all"}
                    </Button>
                    {inactiveCount > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowInactive((v) => !v)}
                        data-testid="button-toggle-inactive-proformas"
                        className="text-muted-foreground"
                      >
                        {showInactive ? `Hide inactive (${inactiveCount})` : `Show inactive (${inactiveCount})`}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })()}

            {proformas
              .filter((p) => p.isActive || showInactive)
              .filter(
                (p) => !proformaSearch.trim() || p.name.toLowerCase().includes(proformaSearch.trim().toLowerCase())
              )
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((proforma) => {
                const isExpanded = expandedProformaIds.has(proforma.id);
                const detailState = expandedProformaStateById.get(proforma.id);
                const detailProforma = detailState?.data;
                const displayLines = detailProforma?.lines ?? [];
                const totalQty = detailProforma
                  ? displayLines.reduce((s, l) => s + l.quantity, 0)
                  : Number(proforma.totalQty || 0);
                const totalWeight = detailProforma
                  ? displayLines.reduce((s, l) => s + l.quantity * parseFloat(l.weightPerBaleKg || "0"), 0)
                  : Number(proforma.totalWeightKg || 0);
                const totalAmount = detailProforma
                  ? displayLines.reduce((s, l) => s + l.quantity * effectivePricePerBale(l), 0)
                  : Number(proforma.totalAmount || 0);
                const lineCount = detailProforma ? displayLines.length : Number(proforma.lineCount || 0);
                const detailLoading = isExpanded && !detailProforma && (detailState?.isLoading ?? true);
                const detailError = isExpanded && !detailProforma && (detailState?.isError ?? false);
                const d = formatProformaDate(proforma.createdAt, proforma.updatedAt);

                return (
                  <div
                    key={proforma.id}
                    data-testid={`card-proforma-${proforma.id}`}
                    className={`rounded-lg border bg-card transition-shadow ${isExpanded ? "shadow-sm" : ""} ${!proforma.isActive ? "opacity-60" : ""}`}
                  >
                    {/* Card header row */}
                    <div className="flex items-center gap-2 px-4 py-3">
                      {/* Expand toggle */}
                      <button
                        className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
                        onClick={() =>
                          setExpandedProformaIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(proforma.id)) next.delete(proforma.id);
                            else next.add(proforma.id);
                            return next;
                          })
                        }
                        data-testid={`button-expand-proforma-${proforma.id}`}
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                        )}
                        <span className="font-semibold truncate">{proforma.name}</span>
                        {proforma.isActive && (
                          <Badge
                            className="bg-green-600 text-white shrink-0 no-default-hover-elevate no-default-active-elevate"
                            data-testid={`badge-active-${proforma.id}`}
                          >
                            Active
                          </Badge>
                        )}
                      </button>

                      {/* Stats chips (hidden on tiny screens) */}
                      <div className="hidden sm:flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                        <span data-testid={`badge-lines-count-${proforma.id}`} className="flex items-center gap-1">
                          <Package className="h-3 w-3" />
                          {lineCount} lines
                        </span>
                        {totalQty > 0 && (
                          <span data-testid={`text-total-qty-${proforma.id}`} className="font-mono">
                            {totalQty.toLocaleString()} bales
                          </span>
                        )}
                        {totalWeight > 0 && (
                          <span data-testid={`text-total-weight-${proforma.id}`} className="font-mono">
                            {totalWeight.toLocaleString(undefined, {
                              minimumFractionDigits: 0,
                              maximumFractionDigits: 0,
                            })}{" "}
                            kg
                          </span>
                        )}
                        {!hideProformaPrice && totalAmount > 0 && (
                          <span
                            data-testid={`text-total-amount-${proforma.id}`}
                            className="font-mono font-medium text-foreground"
                          >
                            {formatAmount(totalAmount)}
                          </span>
                        )}
                        {d.value && (
                          <span data-testid={`text-proforma-date-${proforma.id}`} className="text-muted-foreground/70">
                            {d.label} {d.value}
                          </span>
                        )}
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-0.5 shrink-0 ml-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => toggleActiveMutation.mutate({ id: proforma.id, isActive: !proforma.isActive })}
                          disabled={toggleActiveMutation.isPending}
                          data-testid={`button-toggle-active-proforma-${proforma.id}`}
                          title={proforma.isActive ? "Deactivate" : "Set active"}
                        >
                          <Star
                            className={
                              proforma.isActive
                                ? "h-4 w-4 fill-yellow-400 text-yellow-500"
                                : "h-4 w-4 text-muted-foreground"
                            }
                          />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            navigate(
                              `/factory/dispatch-batches?customerId=${customerId}&proformaId=${proforma.id}&openCreate=1`
                            )
                          }
                          data-testid={`button-create-dispatch-batch-${proforma.id}`}
                          title="Create dispatch batch"
                        >
                          <Truck className="h-4 w-4 text-muted-foreground" />
                        </Button>
                        {canEdit && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" data-testid={`button-proforma-menu-${proforma.id}`}>
                                <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => {
                                  setRenamingProforma(proforma);
                                  setRenameValue(proforma.name);
                                }}
                                data-testid={`button-rename-proforma-${proforma.id}`}
                              >
                                <Pencil className="h-3.5 w-3.5 mr-2" />
                                Rename
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  setTransferProforma(proforma);
                                  setTransferTargetCustomerId("");
                                }}
                                data-testid={`button-transfer-proforma-${proforma.id}`}
                              >
                                <ArrowRightLeft className="h-3.5 w-3.5 mr-2" />
                                Transfer customer
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setPendingDelete(() => () => deleteProformaMutation.mutate(proforma.id))}
                                data-testid={`button-delete-proforma-${proforma.id}`}
                              >
                                <Trash2 className="h-3.5 w-3.5 mr-2" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </div>

                    {/* Expanded content */}
                    {isExpanded && (
                      <div className="border-t">
                        {/* Toolbar */}
                        <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/30 flex-wrap">
                          {canEdit && (
                            <Button
                              size="sm"
                              onClick={() => {
                                setAddLineProformaId(proforma.id);
                                setAddLineMode("catalog");
                                setCatalogSelectedItem(null);
                                setCatalogSearch("");
                                setNewLine({ articleCode: "", productName: "", quantity: "", pricePerBale: "" });
                                setIsAddLineOpen(true);
                              }}
                              data-testid={`button-add-line-${proforma.id}`}
                            >
                              <Plus className="mr-1.5 h-3.5 w-3.5" />
                              Add Item
                            </Button>
                          )}
                          {canEdit && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                navigate(`/factory/stock-allocation-v5?proformaId=${proforma.id}&openEdit=true`)
                              }
                              data-testid={`button-edit-in-allocation-${proforma.id}`}
                            >
                              <Pencil className="mr-1.5 h-3.5 w-3.5" />
                              Edit in Stock Allocation
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => saveAgreedPricesMutation.mutate(proforma.id)}
                            disabled={saveAgreedPricesMutation.isPending}
                            data-testid={`button-save-agreed-prices-${proforma.id}`}
                            title="Save these prices as the customer's agreed prices"
                          >
                            <BookmarkCheck className="mr-1.5 h-3.5 w-3.5" />
                            Save as Agreed Prices
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => applyProductionPricesMutation.mutate(proforma.id)}
                            disabled={applyProductionPricesMutation.isPending}
                            data-testid={`button-apply-production-prices-${proforma.id}`}
                            title="Set all line prices to the production (cost) price from the catalogue"
                          >
                            Apply Production Price
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => applyCatalogPricesMutation.mutate(proforma.id)}
                            disabled={applyCatalogPricesMutation.isPending}
                            data-testid={`button-apply-selling-prices-${proforma.id}`}
                            title="Set all line prices to the selling price from the catalogue"
                          >
                            Apply Selling Price
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              window.open(`/api/factory/customer-proformas/${proforma.id}/export/excel`, "_blank")
                            }
                            data-testid={`button-export-excel-${proforma.id}`}
                          >
                            <Download className="mr-1.5 h-3.5 w-3.5" />
                            Excel
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              if (!navigator.onLine) {
                                window.print();
                                return;
                              }
                              window.open(`/api/factory/customer-proformas/${proforma.id}/export/pdf`, "_blank");
                            }}
                            data-testid={`button-export-pdf-${proforma.id}`}
                          >
                            <Download className="mr-1.5 h-3.5 w-3.5" />
                            PDF
                          </Button>
                        </div>

                        {/* Price lines table — lazy detail only after expansion */}
                        {detailLoading ? (
                          <div className="space-y-2 px-4 py-5" data-testid={`loading-proforma-lines-${proforma.id}`}>
                            <Skeleton className="h-8 w-full" />
                            <Skeleton className="h-8 w-full" />
                            <Skeleton className="h-8 w-3/4" />
                          </div>
                        ) : detailError ? (
                          <div
                            className="flex flex-col items-center py-8 text-center"
                            data-testid={`error-proforma-lines-${proforma.id}`}
                          >
                            <p className="text-sm text-destructive">Could not load proforma items.</p>
                            <Button size="sm" variant="outline" className="mt-3" onClick={() => detailState?.refetch()}>
                              Retry
                            </Button>
                          </div>
                        ) : displayLines.length > 0 ? (
                          <div>
                            <Table wrapperClassName="max-h-[400px] overflow-auto">
                              <TableHeader className="sticky top-0 z-30 bg-background">
                                <TableRow>
                                  <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                                    Article Code
                                  </TableHead>
                                  <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                                    Product Name
                                  </TableHead>
                                  <TableHead className="text-right text-xs uppercase tracking-wide text-muted-foreground font-medium">
                                    Qty
                                  </TableHead>
                                  <TableHead className="text-right text-xs uppercase tracking-wide text-muted-foreground font-medium">
                                    Kg/Bale
                                  </TableHead>
                                  <TableHead className="text-right text-xs uppercase tracking-wide text-muted-foreground font-medium">
                                    Total Kg
                                  </TableHead>
                                  {!hideProformaPrice && (
                                    <TableHead className="text-right text-xs uppercase tracking-wide text-muted-foreground font-medium">
                                      Price/Bale
                                    </TableHead>
                                  )}
                                  {canEdit && <TableHead className="w-[72px]"></TableHead>}
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {[...displayLines]
                                  .sort((a, b) =>
                                    (a.productName || a.articleCode || "").localeCompare(
                                      b.productName || b.articleCode || ""
                                    )
                                  )
                                  .map((line) => {
                                    const lineWt = parseFloat(line.weightPerBaleKg || "0");
                                    const lineTotal = line.quantity * lineWt;
                                    const isEditingQty = inlineQtyLineId === line.id;
                                    return (
                                      <TableRow
                                        key={line.id}
                                        className="hover:bg-muted/40"
                                        data-testid={`row-line-${line.id}`}
                                      >
                                        <TableCell
                                          className="font-mono text-xs text-muted-foreground py-2.5"
                                          data-testid={`text-article-code-${line.id}`}
                                        >
                                          {line.articleCode}
                                        </TableCell>
                                        <TableCell
                                          className="text-sm font-medium py-2.5"
                                          data-testid={`text-product-name-${line.id}`}
                                        >
                                          {line.productName}
                                        </TableCell>
                                        <TableCell
                                          className="text-right font-mono py-2.5"
                                          data-testid={`text-quantity-${line.id}`}
                                        >
                                          {canEdit && isEditingQty ? (
                                            <Input
                                              type="number"
                                              min="1"
                                              className="w-20 h-7 text-right font-mono text-sm ml-auto"
                                              value={inlineQtyValue}
                                              onChange={(e) => setInlineQtyValue(e.target.value)}
                                              onBlur={() => commitInlineQty(line.id)}
                                              onKeyDown={(e) => {
                                                if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault();
                                                if (e.key === "Enter") commitInlineQty(line.id);
                                                if (e.key === "Escape") setInlineQtyLineId(null);
                                              }}
                                              autoFocus
                                              data-testid={`input-inline-qty-${line.id}`}
                                            />
                                          ) : canEdit ? (
                                            <button
                                              className="font-mono hover:underline hover:text-primary cursor-pointer w-full text-right"
                                              title="Click to edit quantity"
                                              onClick={() => {
                                                setInlineQtyLineId(line.id);
                                                setInlineQtyValue(String(line.quantity));
                                              }}
                                              data-testid={`button-inline-qty-${line.id}`}
                                            >
                                              {line.quantity}
                                            </button>
                                          ) : (
                                            <span className="font-mono">{line.quantity}</span>
                                          )}
                                        </TableCell>
                                        <TableCell
                                          className="text-right font-mono text-sm text-muted-foreground py-2.5"
                                          data-testid={`text-kg-bale-${line.id}`}
                                        >
                                          {lineWt % 1 === 0 ? lineWt.toLocaleString() : lineWt.toFixed(2)}
                                        </TableCell>
                                        <TableCell
                                          className="text-right font-mono text-sm text-muted-foreground py-2.5"
                                          data-testid={`text-total-kg-${line.id}`}
                                        >
                                          {lineTotal > 0
                                            ? lineTotal % 1 === 0
                                              ? lineTotal.toLocaleString()
                                              : lineTotal.toFixed(1)
                                            : "—"}
                                        </TableCell>
                                        {!hideProformaPrice && (
                                          <TableCell
                                            className="text-right font-mono font-medium py-2.5"
                                            data-testid={`text-price-${line.id}`}
                                          >
                                            {formatAmount(effectivePricePerBale(line))}
                                            {line.pricingMode === "per_kg" && line.pricePerKg && (
                                              <div className="text-[10px] text-muted-foreground font-normal">
                                                ${parseFloat(line.pricePerKg).toFixed(2)}/kg
                                              </div>
                                            )}
                                          </TableCell>
                                        )}
                                        {canEdit && (
                                          <TableCell className="py-2.5">
                                            <div className="flex items-center gap-0.5 justify-end">
                                              <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7"
                                                onClick={() => {
                                                  setEditingLine(line);
                                                  setEditLineValues({
                                                    productName: line.productName,
                                                    quantity: String(line.quantity),
                                                    pricePerBale: line.pricePerBale,
                                                    weightPerBaleKg: line.weightPerBaleKg ?? "",
                                                  });
                                                }}
                                                data-testid={`button-edit-line-${line.id}`}
                                              >
                                                <Pencil className="h-3 w-3" />
                                              </Button>
                                              <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7"
                                                onClick={() =>
                                                  setPendingDelete(() => () => deleteLineMutation.mutate(line.id))
                                                }
                                                disabled={deleteLineMutation.isPending}
                                                data-testid={`button-delete-line-${line.id}`}
                                              >
                                                <Trash2 className="h-3 w-3 text-destructive/70" />
                                              </Button>
                                            </div>
                                          </TableCell>
                                        )}
                                      </TableRow>
                                    );
                                  })}
                              </TableBody>
                            </Table>

                            {/* Summary footer */}
                            <div className="flex items-center gap-6 px-4 py-3 bg-muted/20 border-t text-sm flex-wrap">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs text-muted-foreground">Bales</span>
                                <span className="font-semibold font-mono" data-testid={`text-total-qty-${proforma.id}`}>
                                  {totalQty.toLocaleString()}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs text-muted-foreground">Weight</span>
                                <span
                                  className="font-semibold font-mono"
                                  data-testid={`text-total-weight-${proforma.id}`}
                                >
                                  {totalWeight.toLocaleString(undefined, {
                                    minimumFractionDigits: 1,
                                    maximumFractionDigits: 1,
                                  })}{" "}
                                  kg
                                </span>
                              </div>
                              {!hideProformaPrice && (
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs text-muted-foreground">Total</span>
                                  <span
                                    className="font-semibold font-mono"
                                    data-testid={`text-total-amount-${proforma.id}`}
                                  >
                                    {formatAmount(totalAmount)}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div
                            className="flex flex-col items-center py-10 text-center"
                            data-testid={`text-no-lines-${proforma.id}`}
                          >
                            <Package className="h-8 w-8 text-muted-foreground/40 mb-2" />
                            <p className="text-sm text-muted-foreground">No price lines yet</p>
                            {canEdit && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="mt-3"
                                onClick={() => {
                                  setAddLineProformaId(proforma.id);
                                  setAddLineMode("catalog");
                                  setCatalogSelectedItem(null);
                                  setCatalogSearch("");
                                  setNewLine({ articleCode: "", productName: "", quantity: "", pricePerBale: "" });
                                  setIsAddLineOpen(true);
                                }}
                              >
                                <Plus className="mr-1.5 h-3.5 w-3.5" />
                                Add first item
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        )}
      </div>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Proforma</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium mb-1 block">Proforma Name</label>
              <Input
                placeholder="e.g. Summer 2024 Pricing"
                value={newProformaName}
                onChange={(e) => setNewProformaName(e.target.value)}
                data-testid="input-proforma-name"
              />
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setIsCreateOpen(false)} data-testid="button-cancel-create">
                Cancel
              </Button>
              <Button
                onClick={handleCreateProforma}
                disabled={!newProformaName.trim() || createProformaMutation.isPending}
                data-testid="button-confirm-create"
              >
                Create Proforma
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <RenameProformaDialog
        renameProformaMutation={renameProformaMutation}
        renameValue={renameValue}
        renamingProforma={renamingProforma}
        setRenameValue={setRenameValue}
        setRenamingProforma={setRenamingProforma}
      />

      {/* ── Transfer Proforma Dialog ────────────────────────────────────── */}
      <TransferProformaDialog
        customers={customers}
        setTransferProforma={setTransferProforma}
        setTransferTargetCustomerId={setTransferTargetCustomerId}
        transferProforma={transferProforma}
        transferProformaMutation={transferProformaMutation}
        transferTargetCustomerId={transferTargetCustomerId}
      />

      <AddPriceLineDialog
        addLineMode={addLineMode}
        addLineMutation={addLineMutation}
        allStockItems={allStockItems}
        catalogSearch={catalogSearch}
        catalogSelectedItem={catalogSelectedItem}
        handleAddLine={handleAddLine}
        isAddLineOpen={isAddLineOpen}
        newLine={newLine}
        priceListMap={priceListMap}
        setAddLineMode={setAddLineMode}
        setCatalogSearch={setCatalogSearch}
        setCatalogSelectedItem={setCatalogSelectedItem}
        setIsAddLineOpen={setIsAddLineOpen}
        setNewLine={setNewLine}
      />

      <EditPriceLineDialog
        editLineMutation={editLineMutation}
        editLineValues={editLineValues}
        editingLine={editingLine}
        handleEditLine={handleEditLine}
        setEditLineValues={setEditLineValues}
        setEditingLine={setEditingLine}
      />
      <CreatePendingLoadingDialog
        createLoadingLocationId={createLoadingLocationId}
        createLoadingMutation={createLoadingMutation}
        createLoadingProforma={createLoadingProforma}
        locations={locations}
        setCreateLoadingLocationId={setCreateLoadingLocationId}
        setCreateLoadingProforma={setCreateLoadingProforma}
      />

      {/* ── Excel Import Dialog ──────────────────────────────────────────── */}
      <ImportProformaExcelDialog
        bulkImportMutation={bulkImportMutation}
        customerId={customerId}
        customers={customers}
        downloadProformaTemplate={downloadProformaTemplate}
        excelFileInputRef={excelFileInputRef}
        excelImportErrors={excelImportErrors}
        excelImportLines={excelImportLines}
        excelImportLoading={excelImportLoading}
        excelImportName={excelImportName}
        handleExcelFile={handleExcelFile}
        isExcelImportOpen={isExcelImportOpen}
        setExcelImportErrors={setExcelImportErrors}
        setExcelImportLines={setExcelImportLines}
        setExcelImportName={setExcelImportName}
        setIsExcelImportOpen={setIsExcelImportOpen}
      />

      <DeleteConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        onConfirm={() => {
          pendingDelete?.();
          setPendingDelete(null);
        }}
      />
    </div>
  );
}
