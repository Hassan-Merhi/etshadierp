import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/PageHeader";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { FileText, Search, Pencil, Check, Trash2, X, Filter } from "lucide-react";
import { format } from "date-fns";

export default function OptionalVouchers() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [typeFilter, setTypeFilter] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [search, setSearch] = useState("");
  const [finalizeVoucherId, setFinalizeVoucherId] = useState<number | null>(null);
  const [deleteVoucherId, setDeleteVoucherId] = useState<number | null>(null);

  const queryParams = new URLSearchParams();
  if (typeFilter && typeFilter !== "all") queryParams.set("type", typeFilter);
  if (startDate) queryParams.set("startDate", startDate);
  if (endDate) queryParams.set("endDate", endDate);
  if (search) queryParams.set("search", search);
  const queryString = queryParams.toString();
  const queryUrl = `/api/vouchers/optional${queryString ? `?${queryString}` : ""}`;

  const { data: vouchers = [], isLoading, isError, error } = useQuery<any[]>({
    queryKey: ["/api/vouchers/optional", typeFilter, startDate, endDate, search],
    queryFn: async () => {
      const res = await apiRequest("GET", queryUrl);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(err.message || "Failed to load optional vouchers");
      }
      return res.json();
    },
  });

  const finalizeMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("POST", `/api/vouchers/${id}/finalize`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers/optional"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daybook"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-by-location"] });
      queryClient.invalidateQueries({ queryKey: ["/api/location-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers/list"] });
      toast({ title: "Voucher Finalized", description: "The voucher has been posted successfully." });
      setFinalizeVoucherId(null);
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/vouchers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers/optional"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daybook"] });
      toast({ title: "Voucher Deleted", description: "The voucher has been deleted." });
      setDeleteVoucherId(null);
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const clearFilters = () => {
    setTypeFilter("all");
    setStartDate("");
    setEndDate("");
    setSearch("");
  };

  const hasFilters = typeFilter !== "all" || startDate || endDate || search;

  const voucherTypes = ["Sales", "Payment", "Receipt", "Journal", "Stock Transfer", "Purchase", "Contra", "Credit Note", "Debit Note"];

  const getTypeBadgeVariant = (type: string) => {
    switch (type) {
      case "Sales": return "default";
      case "Payment": return "secondary";
      case "Receipt": return "outline";
      default: return "secondary";
    }
  };

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-6 w-full min-w-0">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <PageHeader title="Optional Vouchers" subtitle="Draft/unposted vouchers that can be edited or finalized" icon={<FileText className="h-5 w-5" />} />
        </div>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="button-clear-filters">
            <X className="h-4 w-4 mr-1" />
            Clear Filters
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger data-testid="select-voucher-type">
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {voucherTypes.map(t => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search voucher #, notes..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
                data-testid="input-search-vouchers"
              />
            </div>

            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              placeholder="Start Date"
              data-testid="input-start-date"
            />

            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              placeholder="End Date"
              data-testid="input-end-date"
            />
          </div>

          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : isError ? (
            <div className="text-center py-12 text-destructive" data-testid="text-optional-vouchers-error">
              <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-lg font-medium">Failed to load optional vouchers</p>
              <p className="text-sm mt-1">{(error as any)?.message}</p>
            </div>
          ) : vouchers.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground" data-testid="text-no-optional-vouchers">
              <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-lg font-medium">No optional vouchers found</p>
              <p className="text-sm mt-1">All vouchers are finalized, or try adjusting your filters.</p>
            </div>
          ) : (
            <>
              <div className="text-sm text-muted-foreground mb-2" data-testid="text-voucher-count">
                {vouchers.length} optional voucher(s)
              </div>
              <div className="table-responsive rounded-md border">
                <Table>
                  <TableHeader className="sticky top-0 z-30 bg-background">
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="hidden sm:table-cell">Location</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vouchers.map((v: any) => (
                      <TableRow key={v.id} data-testid={`row-voucher-${v.id}`}>
                        <TableCell className="whitespace-nowrap">
                          {v.voucherDate ? format(new Date(v.voucherDate + "T00:00:00"), "dd MMM yyyy") : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={getTypeBadgeVariant(v.voucherType)}>{v.voucherType}</Badge>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-muted-foreground">
                          {v.locationName || "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {parseFloat(v.totalAmount || "0").toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => {
                                const voucherTypeMap: Record<string, string> = {
                                  Payment: "payment",
                                  Receipt: "receipt",
                                  Journal: "journal",
                                  Consumption: "adjustment",
                                  Production: "adjustment",
                                  Mixed: "adjustment",
                                  StockTransfer: "transfer",
                                  "Stock Transfer": "transfer",
                                  "Credit Note": "creditnote",
                                  "Debit Note": "creditnote",
                                };
                                const tab = voucherTypeMap[v.voucherType];
                                if (tab) {
                                  navigate(`/vouchers?edit=${v.id}&tab=${tab}`);
                                } else {
                                  navigate(`/vouchers/${v.id}/edit`);
                                }
                              }}
                              data-testid={`button-edit-voucher-${v.id}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => setFinalizeVoucherId(v.id)}
                              data-testid={`button-finalize-voucher-${v.id}`}
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => setDeleteVoucherId(v.id)}
                              data-testid={`button-delete-voucher-${v.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter className="sticky bottom-0 z-10 bg-background border-t">
                    <TableRow className="font-semibold">
                      <TableCell colSpan={3}>Total ({vouchers.length} voucher{vouchers.length !== 1 ? "s" : ""})</TableCell>
                      <TableCell className="text-right font-mono" data-testid="text-optional-grand-total">
                        {vouchers.reduce((sum, v: any) => sum + parseFloat(v.totalAmount || "0"), 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={finalizeVoucherId !== null}
        onOpenChange={(open) => !open && setFinalizeVoucherId(null)}
        title="Finalize Voucher"
        description="Are you sure you want to finalize this voucher? Once posted, it will be included in all financial calculations and reports. This cannot be undone easily."
        confirmText={finalizeMutation.isPending ? "Finalizing..." : "Finalize"}
        loading={finalizeMutation.isPending}
        onConfirm={() => { if (finalizeVoucherId) finalizeMutation.mutate(finalizeVoucherId); }}
      />

      <ConfirmDialog
        open={deleteVoucherId !== null}
        onOpenChange={(open) => !open && setDeleteVoucherId(null)}
        title="Delete Voucher"
        description="Are you sure you want to delete this optional voucher? This action will remove it from the system."
        tone="destructive"
        confirmText={deleteMutation.isPending ? "Deleting..." : "Delete"}
        loading={deleteMutation.isPending}
        onConfirm={() => { if (deleteVoucherId) deleteMutation.mutate(deleteVoucherId); }}
      />
    </div>
  );
}
