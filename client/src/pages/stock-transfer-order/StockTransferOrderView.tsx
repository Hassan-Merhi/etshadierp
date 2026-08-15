import { Fragment } from "react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/PageHeader";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  MapPin,
  Package,
  Trash2,
  Check,
  AlertCircle,
  ArrowRight,
  Settings2,
  CalendarIcon,
  FileDown,
  List,
  GitBranch,
  Upload,
  Plus,
  Search,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/formatNumber";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { RevisionDialog } from "./dialogs/RevisionDialog";
import { ImportDialog } from "./dialogs/ImportDialog";
import { QuantityPickerDialog } from "./dialogs/QuantityPickerDialog";
import { StockMovementDialog } from "./dialogs/StockMovementDialog";
import { DetailDialog } from "./dialogs/DetailDialog";
import type { useStockTransferOrderModel } from "./useStockTransferOrderModel";

type StockTransferOrderModel = ReturnType<typeof useStockTransferOrderModel>;

export function StockTransferOrderView({ model }: { model: StockTransferOrderModel }) {
  const {
    hasDraft,
    editVoucherId,
    discardDraft,
    restoreDraft,
    destinationLocationId,
    setDestinationLocationId,
    availableDestinations,
    locationDialogOpen,
    setLocationDialogOpen,
    selectedLocations,
    locations,
    toggleLocation,
    selectedLocationIds,
    transferDate,
    setTransferDate,
    isOptional,
    setIsOptional,
    navigate,
    orderItems,
    handleExportOrder,
    validationErrors,
    isLoading,
    matrixRef,
    handleMatrixKeyDown,
    summaryData,
    toggleGroup,
    expandedGroups,
    sortedGroupItems,
    flatRowIndexById,
    focusedCell,
    setFocusedCell,
    handleCellClick,
    mobileSheetOpen,
    setMobileSheetOpen,
    mobileSearchTerm,
    setMobileSearchTerm,
    stockItems,
    mobileSelectedItemId,
    setMobileSelectedItemId,
    mobileSourceLocationId,
    setMobileSourceLocationId,
    mobileQty,
    setMobileQty,
    handleMobileAddItem,
    totalBales,
    setImportPreview,
    setImportDialogOpen,
    removeFromOrder,
    autosaveStatus,
    handleValidate,
    handleProcessOrder,
    isProcessing,
    existingTransfer,
    handleSaveAsRevision,
    isSavingRevision,
    revisionsExpanded,
    setRevisionsExpanded,
    revisions,
    computeRevisionItems,
    confirmSaveAsRevision,
    revisionDialogOpen,
    revisionNote,
    setRevisionDialogOpen,
    setRevisionNote,
    applyImport,
    downloadImportTemplate,
    exportPreviewExcel,
    exportPreviewPDF,
    handleImportFile,
    importDialogOpen,
    importFileRef,
    importLoading,
    importPreview,
    pickerQuantity,
    quantityInputRef,
    quantityPicker,
    setPickerQuantity,
    setQuantityPicker,
    handleAddToOrder,
    formatAmount,
    historyData,
    historyDialogOpen,
    historyItem,
    historyLoading,
    historyLocation,
    historyPeriod,
    setDetailDirection,
    setDetailMonth,
    setDetailMonthName,
    setDetailOpen,
    setDetailYear,
    setHistoryDialogOpen,
    setHistoryPeriod,
    detailData,
    detailDirection,
    detailLoading,
    detailMonthName,
    detailOpen,
    detailYear,
  } = model;

  return (
    <div className="space-y-4">
      {hasDraft && !editVoucherId && (
        <div
          className="flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 px-4 py-2 text-sm"
          data-testid="banner-draft-restore"
        >
          <span className="text-amber-800 dark:text-amber-300">
            You have an unsaved draft. Restore it to continue where you left off.
          </span>
          <div className="flex gap-2 flex-shrink-0">
            <Button size="sm" variant="outline" onClick={discardDraft} data-testid="button-discard-draft">
              Discard
            </Button>
            <Button size="sm" onClick={restoreDraft} data-testid="button-restore-draft">
              Restore Draft
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <PageHeader
            title={editVoucherId ? "Edit Stock Transfer Order" : "Stock Transfer Order"}
            subtitle={
              editVoucherId
                ? "Edit and update this stock transfer using the order view"
                : "Build orders by selecting items from multiple source locations"
            }
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Label className="text-sm whitespace-nowrap">Destination:</Label>
            <Select
              value={destinationLocationId?.toString() || ""}
              onValueChange={(value) => setDestinationLocationId(parseInt(value))}
            >
              <SelectTrigger className="w-full sm:w-[200px]" data-testid="select-destination">
                <SelectValue placeholder="Choose destination" />
              </SelectTrigger>
              <SelectContent>
                {availableDestinations.map((location) => (
                  <SelectItem
                    key={location.id}
                    value={location.id.toString()}
                    data-testid={`select-destination-option-${location.id}`}
                  >
                    {location.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Dialog open={locationDialogOpen} onOpenChange={setLocationDialogOpen}>
            <Button variant="outline" onClick={() => setLocationDialogOpen(true)} data-testid="button-select-sources">
              <Settings2 className="h-4 w-4 mr-2" />
              Source Locations ({selectedLocations.length})
            </Button>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Select Source Locations</DialogTitle>
              </DialogHeader>
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {locations.map((location) => (
                  <div
                    key={location.id}
                    className="flex items-center gap-3 p-2 rounded-md hover-elevate cursor-pointer"
                    onClick={() => toggleLocation(location.id)}
                    data-testid={`location-checkbox-${location.id}`}
                  >
                    <Checkbox
                      checked={selectedLocationIds.includes(location.id)}
                      onCheckedChange={() => toggleLocation(location.id)}
                    />
                    <div className="flex-1">
                      <p className="text-sm font-medium">{location.name}</p>
                      <p className="text-xs text-muted-foreground">{location.code}</p>
                    </div>
                  </div>
                ))}
              </div>
              <DialogFooter>
                <Button onClick={() => setLocationDialogOpen(false)}>Done</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-full sm:w-[140px] justify-start text-left font-normal",
                  !transferDate && "text-muted-foreground"
                )}
                data-testid="button-select-date"
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {transferDate ? format(transferDate, "MMM dd, yyyy") : "Pick date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                selected={transferDate}
                onSelect={(date) => date && setTransferDate(date)}
                initialFocus
              />
            </PopoverContent>
          </Popover>

          <div className="flex items-center gap-2">
            <Switch
              id="optional-mode"
              checked={isOptional}
              onCheckedChange={setIsOptional}
              data-testid="switch-optional"
            />
            <Label htmlFor="optional-mode" className="text-sm cursor-pointer">
              Optional
            </Label>
          </div>

          {editVoucherId && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(`/vouchers?edit=${editVoucherId}&tab=transfer`)}
              data-testid="button-switch-to-normal-view"
            >
              <List className="h-4 w-4 mr-2" />
              Normal View
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={orderItems.length === 0} data-testid="button-export-order">
                <FileDown className="h-4 w-4 mr-1" />
                Export
                <ChevronDown className="h-4 w-4 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleExportOrder(false)} data-testid="export-order-no-cost">
                Export without Cost
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExportOrder(true)} data-testid="export-order-with-cost">
                Export with Cost
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {validationErrors.length > 0 && (
        <Card className="border-destructive bg-destructive/5">
          <CardContent className="py-3">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-medium text-destructive">Validation Errors</p>
                <ul className="text-sm text-muted-foreground space-y-1">
                  {validationErrors.map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col lg:flex-row gap-4">
        <Card className="hidden lg:block lg:flex-[3]">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                <CardTitle className="text-base">Inventory Matrix</CardTitle>
              </div>
              <p className="text-xs text-muted-foreground">
                Click to focus, then use arrow keys + spacebar to add / Enter to view history
              </p>
            </div>
          </CardHeader>
          <CardContent>
            {selectedLocations.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <MapPin className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>Select source locations to view inventory</p>
                <Button variant="outline" className="mt-4" onClick={() => setLocationDialogOpen(true)}>
                  Select Locations
                </Button>
              </div>
            ) : isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map((value) => (
                  <Skeleton key={value} className="h-10 w-full" />
                ))}
              </div>
            ) : (
              <div
                ref={matrixRef}
                tabIndex={0}
                onKeyDown={handleMatrixKeyDown}
                className="overflow-auto max-h-[500px] focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded-md border"
              >
                <table className="w-full caption-bottom text-sm border-collapse">
                  <thead className="[&_tr]:border-b sticky top-0 z-30">
                    <tr className="border-b">
                      <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground min-w-[200px] sticky top-0 left-0 bg-muted z-50 border-r shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]">
                        Item
                      </th>
                      {selectedLocations.map((location) => (
                        <th
                          key={location.id}
                          className="h-12 px-4 text-center align-middle font-medium text-muted-foreground min-w-[100px] sticky top-0 bg-muted z-40"
                        >
                          {location.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="[&_tr:last-child]:border-0">
                    {summaryData?.stockGroups.map((group) => (
                      <Fragment key={group.id}>
                        <tr
                          className="border-b transition-colors cursor-pointer hover-elevate bg-muted/50"
                          onClick={() => toggleGroup(group.id)}
                          data-testid={`group-row-${group.id}`}
                        >
                          <td className="p-4 align-middle font-medium sticky left-0 bg-muted/50 z-20 border-r shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]">
                            <div className="flex items-center gap-2">
                              {expandedGroups.has(group.id) ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                              {group.name}
                              <Badge variant="secondary" className="text-xs">
                                {group.items.length}
                              </Badge>
                            </div>
                          </td>
                          {selectedLocations.map((location) => {
                            const quantity = group.locationData[location.id]?.quantity || 0;
                            return (
                              <td key={location.id} className="p-4 align-middle text-center font-mono text-sm">
                                {quantity > 0 ? formatNumber(quantity, 0) : "-"}
                              </td>
                            );
                          })}
                        </tr>

                        {expandedGroups.has(group.id) &&
                          (sortedGroupItems.get(group.id) ?? []).map((item) => {
                            const flatRowIndex = flatRowIndexById.get(item.id) ?? -1;
                            return (
                              <tr
                                key={item.id}
                                data-testid={`item-row-${item.id}`}
                                className="border-b transition-colors hover:bg-muted/50 bg-background"
                              >
                                <td className="p-4 align-middle pl-8 sticky left-0 bg-background z-20 border-r shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]">
                                  <p className="text-sm">{item.name}</p>
                                </td>
                                {selectedLocations.map((location, colIndex) => {
                                  const quantity = item.locationData[location.id]?.quantity || 0;
                                  const hasStock = quantity > 0;
                                  const isFocused =
                                    focusedCell?.row === flatRowIndex && focusedCell?.col === colIndex;
                                  return (
                                    <td
                                      key={location.id}
                                      className="p-1 align-middle"
                                      data-focused={isFocused ? "true" : undefined}
                                    >
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className={cn(
                                          "w-full font-mono",
                                          hasStock && "hover:bg-primary/10 cursor-pointer",
                                          isFocused && "ring-2 ring-primary ring-offset-1"
                                        )}
                                        disabled={!hasStock}
                                        onClick={() => {
                                          setFocusedCell({ row: flatRowIndex, col: colIndex });
                                          handleCellClick(item, location.id, location.name, quantity);
                                        }}
                                        data-testid={`cell-item-${item.id}-loc-${location.id}`}
                                      >
                                        {hasStock ? formatNumber(quantity, 0) : "-"}
                                      </Button>
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex-1 flex flex-col gap-4 lg:min-w-[300px]">
          <div className="lg:hidden">
            <Sheet open={mobileSheetOpen} onOpenChange={setMobileSheetOpen}>
              <Button className="w-full" onClick={() => setMobileSheetOpen(true)} data-testid="button-mobile-add-item">
                <Plus className="h-4 w-4 mr-2" />
                Add Item
              </Button>
              <SheetContent side="bottom" className="h-[85vh] flex flex-col">
                <SheetHeader className="border-b pb-3 shrink-0">
                  <SheetTitle>Add Item to Order</SheetTitle>
                </SheetHeader>
                <div className="flex-1 overflow-y-auto py-4 space-y-4">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Stock Item</Label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        className="pl-9"
                        placeholder="Search stock items..."
                        value={mobileSearchTerm}
                        onChange={(event) => setMobileSearchTerm(event.target.value)}
                        data-testid="input-mobile-search"
                      />
                    </div>
                    <ScrollArea className="h-48 border rounded-md">
                      <div className="p-1 space-y-0.5">
                        {stockItems
                          .filter(
                            (item) =>
                              mobileSearchTerm.trim() === "" ||
                              item.name.toLowerCase().includes(mobileSearchTerm.toLowerCase()) ||
                              item.code.toLowerCase().includes(mobileSearchTerm.toLowerCase())
                          )
                          .map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              className={cn(
                                "w-full text-left px-3 py-2 rounded-md text-sm transition-colors",
                                mobileSelectedItemId === item.id
                                  ? "bg-primary text-primary-foreground"
                                  : "hover:bg-muted"
                              )}
                              onClick={() => setMobileSelectedItemId(item.id)}
                              data-testid={`mobile-item-option-${item.id}`}
                            >
                              <span className="font-medium">{item.name}</span>
                              <span className="ml-2 text-xs opacity-70">{item.code}</span>
                            </button>
                          ))}
                      </div>
                    </ScrollArea>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Source Location</Label>
                    {selectedLocations.length === 0 ? (
                      <div className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
                        No source locations selected. Close this sheet and tap "Source Locations" to add some.
                      </div>
                    ) : (
                      <Select
                        value={mobileSourceLocationId?.toString() || ""}
                        onValueChange={(value) => setMobileSourceLocationId(parseInt(value))}
                      >
                        <SelectTrigger data-testid="select-mobile-source">
                          <SelectValue placeholder="Pick source location" />
                        </SelectTrigger>
                        <SelectContent>
                          {selectedLocations.map((location) => (
                            <SelectItem
                              key={location.id}
                              value={location.id.toString()}
                              data-testid={`mobile-source-option-${location.id}`}
                            >
                              {location.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Quantity</Label>
                    <Input
                      type="number"
                      step="0.001"
                      min="0"
                      placeholder="0"
                      value={mobileQty}
                      onChange={(event) => setMobileQty(event.target.value)}
                      className="font-mono"
                      data-testid="input-mobile-qty"
                    />
                  </div>
                </div>
                <SheetFooter className="border-t pt-3 shrink-0">
                  <Button className="w-full" onClick={handleMobileAddItem} data-testid="button-mobile-confirm-add">
                    <Plus className="h-4 w-4 mr-2" />
                    Add to Order
                  </Button>
                </SheetFooter>
              </SheetContent>
            </Sheet>
          </div>

          {destinationLocationId && (
            <Card className="bg-primary/5 border-primary/20">
              <CardContent className="py-3">
                <div className="flex items-center gap-2 text-sm">
                  <ArrowRight className="h-4 w-4 text-primary" />
                  <span className="text-muted-foreground">Sending to:</span>
                  <span className="font-medium">
                    {locations.find((location) => location.id === destinationLocationId)?.name}
                  </span>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">Transfer Order</CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{orderItems.length} items</Badge>
                  <Badge variant="default" className="font-mono">
                    {formatNumber(totalBales, 0)} bales
                  </Badge>
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => {
                      setImportPreview([]);
                      setImportDialogOpen(true);
                    }}
                    data-testid="button-open-import"
                    title="Import from Excel"
                  >
                    <Upload className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {orderItems.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm hidden lg:block">
                    Click on quantities or use arrow keys + spacebar to add items
                  </p>
                  <p className="text-sm lg:hidden">Tap "Add Item" above to add items to the order</p>
                </div>
              ) : (
                <>
                  <ScrollArea className="h-[300px]">
                    <div className="space-y-2">
                      {orderItems.map((item, index) => (
                        <div
                          key={`${item.stockItemId}-${item.sourceLocationId}`}
                          className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/50"
                          data-testid={`order-item-${index}`}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{item.stockItemName}</p>
                            <p className="text-xs text-muted-foreground">
                              From: {item.sourceLocationName} | {formatNumber(item.quantity, 0)} {item.uom}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeFromOrder(index)}
                            data-testid={`button-remove-order-item-${index}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>

                  <div className="pt-2 border-t space-y-3">
                    <div className="flex justify-between text-sm font-medium">
                      <span>Total Bales:</span>
                      <span className="font-mono text-lg">{formatNumber(totalBales, 0)}</span>
                    </div>

                    {!editVoucherId && autosaveStatus !== "idle" && (
                      <p
                        className={`text-xs text-center ${
                          autosaveStatus === "saved"
                            ? "text-green-600 dark:text-green-400"
                            : autosaveStatus === "failed"
                              ? "text-destructive"
                              : "text-muted-foreground"
                        }`}
                        data-testid="text-autosave-status"
                      >
                        {autosaveStatus === "saving"
                          ? "Saving draft..."
                          : autosaveStatus === "saved"
                            ? "Draft saved"
                            : "Draft save failed"}
                      </p>
                    )}

                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleValidate}
                        className="flex-1"
                        data-testid="button-validate-order"
                      >
                        <Check className="h-4 w-4 mr-1" />
                        Validate
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleProcessOrder}
                        disabled={isProcessing || !destinationLocationId}
                        className="flex-1"
                        data-testid="button-process-order"
                      >
                        {isProcessing
                          ? editVoucherId
                            ? "Updating..."
                            : "Processing..."
                          : editVoucherId
                            ? "Update Order"
                            : "Process"}
                      </Button>
                    </div>

                    {editVoucherId && existingTransfer?.id && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleSaveAsRevision}
                        disabled={isSavingRevision || !destinationLocationId}
                        className="w-full"
                        data-testid="button-save-as-revision"
                      >
                        <GitBranch className="h-4 w-4 mr-1" />
                        Save as Revision
                      </Button>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {editVoucherId && existingTransfer?.id && (
        <Card>
          <CardHeader
            className="p-4 sm:p-5 cursor-pointer select-none"
            onClick={() => setRevisionsExpanded((value) => !value)}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-base">Revision History</CardTitle>
                {revisions.length > 0 && (
                  <Badge variant="secondary" className="ml-1">
                    {revisions.length}
                  </Badge>
                )}
              </div>
              {revisionsExpanded ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </CardHeader>

          {revisionsExpanded && (
            <CardContent className="pt-0 space-y-4">
              {revisions.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  No revisions yet. Use "Save as Revision" to record tracked changes.
                </p>
              ) : (
                revisions.map((revision) => (
                  <div key={revision.id} className="border rounded-md overflow-hidden">
                    <div className="flex items-center justify-between gap-3 p-3 bg-muted/40 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={revision.optional ? "secondary" : "default"}>
                          Rev {revision.revisionNumber}
                        </Badge>
                        {revision.optional && (
                          <Badge variant="outline" className="text-xs">
                            Reference Only
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {revision.revisionDate ? new Date(revision.revisionDate).toLocaleDateString() : ""}
                        </span>
                        {revision.note && (
                          <span className="text-xs italic text-muted-foreground">"{revision.note}"</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-muted-foreground">Reference only:</span>
                          <Switch
                            checked={revision.optional}
                            onCheckedChange={async (checked) => {
                              try {
                                await apiRequest("PATCH", `/api/stock-transfer-revisions/${revision.id}/optional`, {
                                  optional: checked,
                                });
                              } finally {
                                queryClient.invalidateQueries({
                                  queryKey: ["/api/stock-transfers", existingTransfer.id, "revisions"],
                                });
                              }
                            }}
                            data-testid={`switch-revision-optional-${revision.id}`}
                          />
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={async () => {
                            if (!window.confirm(`Delete Rev ${revision.revisionNumber}? This cannot be undone.`)) return;
                            await apiRequest("DELETE", `/api/stock-transfer-revisions/${revision.id}`);
                            queryClient.invalidateQueries({
                              queryKey: ["/api/stock-transfers", existingTransfer.id, "revisions"],
                            });
                          }}
                          data-testid={`button-delete-revision-${revision.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    {revision.items && revision.items.length > 0 && (
                      <div className="table-responsive">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/30">
                            <tr>
                              <th className="text-left p-2 font-medium">Item</th>
                              <th className="text-left p-2 font-medium hidden sm:table-cell">From</th>
                              <th className="text-right p-2 font-medium">Was</th>
                              <th className="text-right p-2 font-medium">Change</th>
                              <th className="text-right p-2 font-medium">Now</th>
                            </tr>
                          </thead>
                          <tbody>
                            {revision.items.map((item, index) => {
                              const delta = parseFloat(String(item.delta));
                              return (
                                <tr key={index} className="border-t">
                                  <td className="p-2 font-medium">{item.stockItemName}</td>
                                  <td className="p-2 text-muted-foreground hidden sm:table-cell">
                                    {item.sourceLocationName || "—"}
                                  </td>
                                  <td className="p-2 text-right font-mono text-muted-foreground">
                                    {formatNumber(parseFloat(String(item.originalQuantity)), 0)}
                                  </td>
                                  <td
                                    className={`p-2 text-right font-mono font-semibold ${
                                      delta > 0
                                        ? "text-emerald-600 dark:text-emerald-400"
                                        : "text-destructive"
                                    }`}
                                  >
                                    {delta > 0 ? "+" : ""}
                                    {formatNumber(delta, 0)}
                                  </td>
                                  <td className="p-2 text-right font-mono font-semibold">
                                    {formatNumber(parseFloat(String(item.newQuantity)), 0)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          )}
        </Card>
      )}

      <RevisionDialog
        computeRevisionItems={computeRevisionItems}
        confirmSaveAsRevision={confirmSaveAsRevision}
        isSavingRevision={isSavingRevision}
        revisionDialogOpen={revisionDialogOpen}
        revisionNote={revisionNote}
        revisions={revisions}
        setRevisionDialogOpen={setRevisionDialogOpen}
        setRevisionNote={setRevisionNote}
      />

      <ImportDialog
        applyImport={applyImport}
        downloadImportTemplate={downloadImportTemplate}
        exportPreviewExcel={exportPreviewExcel}
        exportPreviewPDF={exportPreviewPDF}
        handleImportFile={handleImportFile}
        importDialogOpen={importDialogOpen}
        importFileRef={importFileRef}
        importLoading={importLoading}
        importPreview={importPreview}
        setImportDialogOpen={setImportDialogOpen}
        setImportPreview={setImportPreview}
      />

      <QuantityPickerDialog
        editVoucherId={editVoucherId}
        handleAddToOrder={handleAddToOrder}
        pickerQuantity={pickerQuantity}
        quantityInputRef={quantityInputRef}
        quantityPicker={quantityPicker}
        setPickerQuantity={setPickerQuantity}
        setQuantityPicker={setQuantityPicker}
      />

      <StockMovementDialog
        formatAmount={formatAmount}
        historyData={historyData}
        historyDialogOpen={historyDialogOpen}
        historyItem={historyItem}
        historyLoading={historyLoading}
        historyLocation={historyLocation}
        historyPeriod={historyPeriod}
        matrixRef={matrixRef}
        navigate={navigate}
        setDetailDirection={setDetailDirection}
        setDetailMonth={setDetailMonth}
        setDetailMonthName={setDetailMonthName}
        setDetailOpen={setDetailOpen}
        setDetailYear={setDetailYear}
        setHistoryDialogOpen={setHistoryDialogOpen}
        setHistoryPeriod={setHistoryPeriod}
      />

      <DetailDialog
        detailData={detailData}
        detailDirection={detailDirection}
        detailLoading={detailLoading}
        detailMonthName={detailMonthName}
        detailOpen={detailOpen}
        detailYear={detailYear}
        formatAmount={formatAmount}
        historyItem={historyItem}
        historyLocation={historyLocation}
        setDetailOpen={setDetailOpen}
      />
    </div>
  );
}
