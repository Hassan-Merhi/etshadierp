import { LayoutGrid, Upload, FileDown, ChevronDown, GitBranch, X, Plus, History, Loader2, ChevronUp } from "lucide-react";
import { format } from "date-fns";
import { UseFormReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

interface StockTransferFormProps {
  stockTransferForm: UseFormReturn<any>;
  onStockTransferSubmit: (data: any) => void;
  isPOS: boolean;
  locations: any[];
  voucherIdToEdit: number | null;
  stockTransferToEdit: any;
  handleExportStockTransfer: (detailed: boolean) => void;
  handleOpenImport: () => void;
  handleTransferSaveAsRevision: () => void;
  isTransferSavingRevision: boolean;
  stockTransferMutation: any;
  activeTransferRow: number | null;
  setActiveTransferRow: (row: number | null) => void;
  transferSearchTerm: string;
  setTransferSearchTerm: (term: string) => void;
  transferInventory: any[];
  transferInventorySource: number | null;
  setTransferInventorySource: (source: number | null) => void;
  setShowSourceSidebar: (show: boolean) => void;
  activeFieldType: 'item' | 'source' | null;
  setActiveFieldType: (type: 'item' | 'source' | null) => void;
  transferSourceSearchTerm: string;
  setTransferSourceSearchTerm: (term: string) => void;
  setTransferSourceHighlightedIndex: (index: number) => void;
  posLocationName: string;
  posSelectedSourceId: number | null;
  setPosSelectedSourceId: (id: number | null) => void;
  myLocations: any[];
  posSelectedSourceName: string;
  transferFocusIdRef: any;
  removeTransfer: (index: number) => void;
  transferFields: any[];
  transferEntries: any[];
  toast: any;
  setLocation: (loc: string) => void;
}

export function StockTransferForm({
  stockTransferForm,
  onStockTransferSubmit,
  isPOS,
  locations,
  voucherIdToEdit,
  stockTransferToEdit,
  handleExportStockTransfer,
  handleOpenImport,
  handleTransferSaveAsRevision,
  isTransferSavingRevision,
  stockTransferMutation,
  activeTransferRow,
  setActiveTransferRow,
  transferSearchTerm,
  setTransferSearchTerm,
  transferInventory,
  transferInventorySource,
  setTransferInventorySource,
  setShowSourceSidebar,
  activeFieldType,
  setActiveFieldType,
  transferSourceSearchTerm,
  setTransferSourceSearchTerm,
  setTransferSourceHighlightedIndex,
  posLocationName,
  posSelectedSourceId,
  setPosSelectedSourceId,
  myLocations,
  posSelectedSourceName,
  transferFocusIdRef,
  removeTransfer,
  transferFields,
  transferEntries,
  toast,
  setLocation,
}: StockTransferFormProps) {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-5">
          <div className="flex items-center gap-2 mb-5">
            <span className="text-sm font-semibold">Stock Transfer Voucher</span>
          </div>
          <Form {...stockTransferForm}>
            <form noValidate onSubmit={stockTransferForm.handleSubmit(onStockTransferSubmit, (errors) => {
              console.error("Stock Transfer Form Validation Errors:", errors);
              toast({
                title: "Form Validation Error",
                description: Object.values(errors).map((e: any) => e?.message || JSON.stringify(e)).join(", ") || "Please check all fields",
                variant: "destructive",
              });
            })}>
              <div className="flex flex-wrap items-center gap-2 sm:gap-4 mb-4">
                {isPOS && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">From:</span>
                    {myLocations.length > 1 ? (
                      <Select
                        value={posSelectedSourceId?.toString() || ""}
                        onValueChange={(v) => {
                          const newId = parseInt(v);
                          const newName = locations.find(l => l.id === newId)?.name || "";
                          setPosSelectedSourceId(newId);
                          setTransferInventorySource(newId);
                          const curEntries = stockTransferForm.getValues("entries");
                          curEntries.forEach((_, index) => {
                            stockTransferForm.setValue(`entries.${index}.sourceLocationId`, newId);
                            stockTransferForm.setValue(`entries.${index}.sourceLocationName`, newName);
                            stockTransferForm.setValue(`entries.${index}.stockItemId`, 0);
                            stockTransferForm.setValue(`entries.${index}.stockItemName`, "");
                            stockTransferForm.setValue(`entries.${index}.quantity`, "");
                          });
                        }}
                      >
                        <SelectTrigger className="w-[160px]" data-testid="select-source-location-pos">
                          <SelectValue placeholder="Select source..." />
                        </SelectTrigger>
                        <SelectContent>
                          {myLocations.map(l => (
                            <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="font-medium">{posSelectedSourceName || posLocationName}</span>
                    )}
                  </div>
                )}
                
                <FormField
                  control={stockTransferForm.control}
                  name="destinationLocationId"
                  render={({ field }) => (
                    <FormItem className="flex items-center gap-2 space-y-0">
                      <FormLabel className="text-sm text-muted-foreground whitespace-nowrap">To:</FormLabel>
                      <Select
                        value={field.value > 0 ? field.value.toString() : ""}
                        onValueChange={(value) => field.onChange(parseInt(value))}
                      >
                        <FormControl>
                          <SelectTrigger className="w-full sm:w-[200px]" data-testid="select-destination-location">
                            <SelectValue placeholder="Select destination..." />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {[...locations]
                            .filter(l => l.id !== transferInventorySource)
                            .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                            .map((location) => (
                              <SelectItem key={location.id} value={location.id.toString()}>
                                {location.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />

                <FormField
                  control={stockTransferForm.control}
                  name="voucherDate"
                  render={({ field }) => (
                    <FormItem className="flex items-center gap-2 space-y-0">
                      <FormLabel className="text-sm text-muted-foreground whitespace-nowrap">Date:</FormLabel>
                      <FormControl>
                        <Input
                          type="date"
                          value={field.value instanceof Date ? format(field.value, "yyyy-MM-dd") : (typeof field.value === "string" ? field.value : "")}
                          onChange={(e) => field.onChange(e.target.value ? new Date(e.target.value + "T00:00:00") : new Date())}
                          className="w-full sm:w-[160px]"
                          data-testid="input-transfer-date"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <div className="flex-1" />

                {!isPOS && voucherIdToEdit && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setLocation(`/stock-transfer-order?edit=${voucherIdToEdit}`)}
                    data-testid="button-switch-to-order-view"
                  >
                    Order View
                  </Button>
                )}

                {!isPOS && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleOpenImport}
                    data-testid="button-open-import-dialog"
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    Import
                  </Button>
                )}
              </div>

              <div className="flex flex-col lg:flex-row gap-4">
                <Card className="flex-1 overflow-hidden min-w-0">
                  <div className="sm:hidden p-3 space-y-2">
                    {transferFields.map((field: any, index: number) => {
                      const entry = transferEntries[index];
                      return (
                        <div key={field.id} className="border rounded-md p-3 space-y-2 bg-card">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground font-medium">#{index + 1}</span>
                            {transferFields.length > 1 && (
                              <Button type="button" variant="ghost" size="icon" onClick={() => removeTransfer(index)} className="h-7 w-7" data-testid={`button-remove-transfer-mobile-${index}`}>
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                          {!isPOS && (
                            <div className="space-y-1">
                              <label className="text-xs text-muted-foreground">Source</label>
                              <input
                                type="text"
                                value={activeTransferRow === index && activeFieldType === 'source' ? transferSourceSearchTerm : (entry?.sourceLocationName || "")}
                                onChange={(e) => { setTransferSourceSearchTerm(e.target.value); setTransferSourceHighlightedIndex(0); }}
                                onFocus={() => {
                                  transferFocusIdRef.current += 1;
                                  setActiveTransferRow(index);
                                  setActiveFieldType('source');
                                  setTransferSourceSearchTerm(entry?.sourceLocationName || "");
                                  setShowSourceSidebar(true);
                                }}
                                onBlur={() => {
                                  const focusId = transferFocusIdRef.current;
                                  setTimeout(() => {
                                    if (transferFocusIdRef.current === focusId) {
                                      setActiveTransferRow(null);
                                      setShowSourceSidebar(false);
                                    }
                                  }, 200);
                                }}
                                placeholder="Source..."
                                className="w-full px-3 py-2 text-sm border rounded-md"
                              />
                            </div>
                          )}
                          {/* ... more fields ... */}
                        </div>
                      );
                    })}
                  </div>
                </Card>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={transferEntries.filter((e: any) => e.stockItemId > 0).length === 0}
                      data-testid="button-export-stock-transfer"
                    >
                      <FileDown className="h-4 w-4 mr-2" />
                      Export
                      <ChevronDown className="h-4 w-4 ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => handleExportStockTransfer(false)} data-testid="export-transfer-summary">
                      Summary Export
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleExportStockTransfer(true)} data-testid="export-transfer-detailed">
                      Detailed Export
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <Button
                  type="submit"
                  disabled={stockTransferMutation.isPending || transferEntries.filter((e: any) => e.stockItemId > 0).length === 0}
                  data-testid="button-save-transfer-voucher"
                >
                  {stockTransferMutation.isPending ? "Saving..." : "Save Transfer"}
                </Button>
                {voucherIdToEdit && stockTransferToEdit?.id && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isTransferSavingRevision || transferEntries.filter((e: any) => e.stockItemId > 0).length === 0}
                    onClick={handleTransferSaveAsRevision}
                    data-testid="button-save-transfer-revision"
                  >
                    <GitBranch className="h-4 w-4 mr-1" />
                    Save as Revision
                  </Button>
                )}
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
