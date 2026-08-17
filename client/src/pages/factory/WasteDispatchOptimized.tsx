import { Fragment, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import {
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  History,
  Loader2,
  Printer,
  ScanLine,
  Search,
  Trash2,
  Weight,
  X,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/PageHeader";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { baleMatchesSearch, fetchGroupBales, fetchHistoryBales, readWasteJson } from "./wastedispatch/optimizedData";
import { printDispatchDocument } from "./wastedispatch/optimizedPrint";
import { ConfirmDisposalDialog, DeleteDispatchDialog, PrintDispatchDialog } from "./wastedispatch/OptimizedDialogs";
import type {
  GroupSummary,
  HistoryBale,
  HistoryItem,
  HistoryResponse,
  PrintDispatch,
  SummaryResponse,
  WasteBale,
} from "./wastedispatch/optimizedTypes";
import { fmt, fmtKg, today } from "./wastedispatch/utils";

const GROUP_PAGE_SIZE = 25;
const HISTORY_PAGE_SIZE = 10;
const DETAIL_STALE_MS = 5 * 60_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isGloballyHandled(error: unknown): boolean {
  return Boolean(
    typeof error === "object" &&
    error !== null &&
    "_handledGlobally" in error &&
    (error as { _handledGlobally?: boolean })._handledGlobally
  );
}

export default function WasteDispatchOptimized() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [balePage, setBalePage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [scanInput, setScanInput] = useState("");
  const [dispatchDate, setDispatchDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [selected, setSelected] = useState<Map<number, WasteBale>>(new Map());
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
  const [expandedHistoryIds, setExpandedHistoryIds] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [deleteDispatchId, setDeleteDispatchId] = useState<number | null>(null);
  const [printData, setPrintData] = useState<{ dispatch: PrintDispatch; bales: HistoryBale[] } | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setBalePage(1);
      setExpandedGroups(new Set());
    }, 400);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setExpandedGroups(new Set());
  }, [balePage]);

  useEffect(() => {
    setExpandedHistoryIds(new Set());
  }, [historyPage]);

  const summaryParams = new URLSearchParams({
    page: String(balePage),
    limit: String(GROUP_PAGE_SIZE),
  });
  if (debouncedSearch) summaryParams.set("search", debouncedSearch);

  const { data: summary, isLoading: summaryLoading } = useQuery<SummaryResponse>({
    queryKey: ["/api/factory/waste-dispatch/summary", balePage, debouncedSearch],
    queryFn: () => readWasteJson(`/api/factory/waste-dispatch/summary?${summaryParams.toString()}`),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: (previous) => previous,
  });

  const { data: history, isLoading: historyLoading } = useQuery<HistoryResponse>({
    queryKey: ["/api/factory/waste-dispatch/history-summary", historyPage],
    queryFn: () =>
      readWasteJson(`/api/factory/waste-dispatch/history-summary?page=${historyPage}&limit=${HISTORY_PAGE_SIZE}`),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: (previous) => previous,
  });

  useEffect(() => {
    const totalPages = summary?.pagination.totalPages || 1;
    if (balePage > totalPages) setBalePage(totalPages);
  }, [balePage, summary?.pagination.totalPages]);

  useEffect(() => {
    const totalPages = history?.pagination.totalPages || 1;
    if (historyPage > totalPages) setHistoryPage(totalPages);
  }, [historyPage, history?.pagination.totalPages]);

  const groups = useMemo(() => summary?.groups ?? [], [summary?.groups]);
  const summaryTotals = summary?.totals ?? { bales: 0, weight: 0, cost: 0 };
  const summaryPagination = summary?.pagination ?? { page: 1, limit: GROUP_PAGE_SIZE, total: 0, totalPages: 1 };
  const historyItems = useMemo(() => history?.items ?? [], [history?.items]);
  const historyPagination = history?.pagination ?? { page: 1, limit: HISTORY_PAGE_SIZE, total: 0, totalPages: 1 };

  const visibleExpandedProductIds = useMemo(
    () => Array.from(expandedGroups).filter((productId) => groups.some((group) => group.productId === productId)),
    [expandedGroups, groups]
  );
  const groupQueries = useQueries({
    queries: visibleExpandedProductIds.map((productId) => ({
      queryKey: ["/api/factory/waste-dispatch/group-bales", productId, debouncedSearch],
      queryFn: () => fetchGroupBales(productId, debouncedSearch),
      staleTime: DETAIL_STALE_MS,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    })),
  });
  const groupQueryById = useMemo(
    () => new Map(visibleExpandedProductIds.map((productId, index) => [productId, groupQueries[index]])),
    [visibleExpandedProductIds, groupQueries]
  );

  const visibleExpandedHistoryIds = useMemo(
    () => Array.from(expandedHistoryIds).filter((dispatchId) => historyItems.some((item) => item.id === dispatchId)),
    [expandedHistoryIds, historyItems]
  );
  const historyDetailQueries = useQueries({
    queries: visibleExpandedHistoryIds.map((dispatchId) => ({
      queryKey: ["/api/factory/waste-dispatch/history-bales", dispatchId],
      queryFn: () => fetchHistoryBales(dispatchId),
      staleTime: DETAIL_STALE_MS,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    })),
  });
  const historyQueryById = useMemo(
    () => new Map(visibleExpandedHistoryIds.map((dispatchId, index) => [dispatchId, historyDetailQueries[index]])),
    [visibleExpandedHistoryIds, historyDetailQueries]
  );

  const selectedBales = useMemo(() => Array.from(selected.values()), [selected]);
  const selectedTotals = useMemo(
    () => ({
      weight: selectedBales.reduce((sum, bale) => sum + Number(bale.weightKg || 0), 0),
      cost: selectedBales.reduce((sum, bale) => sum + Number(bale.totalCost || 0), 0),
    }),
    [selectedBales]
  );

  const clearSelectedBales = () => setSelected(new Map<number, WasteBale>());

  const toggleBale = (bale: WasteBale) => {
    setSelected((previous) => {
      const next = new Map(previous);
      if (next.has(bale.id)) next.delete(bale.id);
      else next.set(bale.id, bale);
      return next;
    });
  };

  const toggleExpandGroup = (productId: number) => {
    setExpandedGroups((previous) => {
      const next = new Set(previous);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  const toggleGroupSelection = async (group: GroupSummary) => {
    try {
      const bales = await queryClient.fetchQuery({
        queryKey: ["/api/factory/waste-dispatch/group-bales", group.productId, debouncedSearch],
        queryFn: () => fetchGroupBales(group.productId, debouncedSearch),
        staleTime: DETAIL_STALE_MS,
      });
      setSelected((previous) => {
        const allSelected = bales.length > 0 && bales.every((bale) => previous.has(bale.id));
        const next = new Map(previous);
        for (const bale of bales) {
          if (allSelected) next.delete(bale.id);
          else next.set(bale.id, bale);
        }
        return next;
      });
    } catch (error: unknown) {
      toast({ title: "Could not load product bales", description: errorMessage(error), variant: "destructive" });
    }
  };

  const selectAllMutation = useMutation({
    mutationFn: async () => {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("search", debouncedSearch);
      return readWasteJson<{ bales: WasteBale[] }>(`/api/factory/waste-dispatch/select-all?${params.toString()}`);
    },
    onSuccess: ({ bales }) => {
      setSelected(new Map(bales.map((bale) => [bale.id, bale])));
      toast({ title: "Selection updated", description: `${bales.length} matching bale(s) selected.` });
    },
    onError: (error: unknown) => {
      toast({ title: "Could not select bales", description: errorMessage(error), variant: "destructive" });
    },
  });

  const handleScan = async (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    const reference = scanInput.trim();
    if (!reference) return;
    try {
      const response = await readWasteJson<{ bale: WasteBale }>(
        `/api/factory/waste-dispatch/scan?ref=${encodeURIComponent(reference)}`
      );
      setSelected((previous) => new Map(previous).set(response.bale.id, response.bale));
      if (baleMatchesSearch(response.bale, debouncedSearch)) {
        setExpandedGroups((previous) => new Set(previous).add(response.bale.productId));
      }
      setScanInput("");
      toast({ title: "Bale added", description: `${response.bale.referenceNumber} — ${response.bale.productName}` });
    } catch (error: unknown) {
      toast({ title: "Not found", description: errorMessage(error), variant: "destructive" });
      setScanInput("");
    }
  };

  const invalidateWasteReads = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/factory/waste-dispatch/summary"] });
    queryClient.invalidateQueries({ queryKey: ["/api/factory/waste-dispatch/group-bales"] });
    queryClient.invalidateQueries({ queryKey: ["/api/factory/waste-dispatch/history-summary"] });
    queryClient.invalidateQueries({ queryKey: ["/api/factory/waste-dispatch/history-bales"] });
  };

  const submitMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/factory/waste-dispatch/submit", {
        baleIds: Array.from(selected.keys()),
        dispatchDate,
        notes: notes.trim() || undefined,
      });
      return response.json();
    },
    onSuccess: (result) => {
      const dispatchedBales: HistoryBale[] = Array.from(selected.values()).map((bale) => ({
        id: bale.id,
        referenceNumber: bale.referenceNumber,
        productName: bale.productName,
        weightKg: bale.weightKg,
        totalCost: bale.totalCost,
      }));
      invalidateWasteReads();
      setSelected(new Map<number, WasteBale>());
      setExpandedGroups(new Set());
      setNotes("");
      setConfirming(false);
      setPrintData({
        dispatch: {
          dispatchNumber: result.dispatch.dispatchNumber,
          dispatchDate: result.dispatch.dispatchDate,
          notes: result.dispatch.notes,
        },
        bales: dispatchedBales,
      });
      toast({
        title: "Waste disposed",
        description: `${result.totalBales} bale(s) marked as disposed (${result.dispatch.dispatchNumber})`,
      });
    },
    onError: (error: unknown) => {
      if (isGloballyHandled(error)) return;
      toast({ title: "Error", description: errorMessage(error), variant: "destructive" });
      setConfirming(false);
    },
  });

  const deleteDispatchMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("DELETE", `/api/factory/waste-dispatch/${id}`);
      return response.json();
    },
    onSuccess: (result, id) => {
      invalidateWasteReads();
      queryClient.removeQueries({ queryKey: ["/api/factory/waste-dispatch/history-bales", id] });
      setDeleteDispatchId(null);
      setExpandedHistoryIds((previous) => {
        const next = new Set(previous);
        next.delete(id);
        return next;
      });
      toast({ title: "Dispatch deleted", description: `${result.restoredBales} bale(s) restored to stock.` });
    },
    onError: (error: unknown) => {
      if (isGloballyHandled(error)) return;
      toast({ title: "Error", description: errorMessage(error), variant: "destructive" });
      setDeleteDispatchId(null);
    },
  });

  const toggleHistoryItem = (id: number) => {
    setExpandedHistoryIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleHistoryPrint = async (dispatch: HistoryItem) => {
    try {
      const bales = await queryClient.fetchQuery({
        queryKey: ["/api/factory/waste-dispatch/history-bales", dispatch.id],
        queryFn: () => fetchHistoryBales(dispatch.id),
        staleTime: DETAIL_STALE_MS,
      });
      printDispatchDocument(dispatch, bales);
    } catch (error: unknown) {
      toast({ title: "Could not load dispatch", description: errorMessage(error), variant: "destructive" });
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b px-6 py-3">
        <PageHeader
          title="Waste Dispatch"
          subtitle="Select and dispatch Garbage or Wiper bales from factory stock"
          icon={<Trash2 className="h-5 w-5" />}
        />
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <div className="flex flex-wrap gap-3">
          <Card className="min-w-60 flex-1">
            <CardContent className="p-3">
              <div className="flex flex-wrap gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Dispatch Date
                  </label>
                  <Input
                    type="date"
                    value={dispatchDate}
                    onChange={(event) => setDispatchDate(event.target.value)}
                    className="w-40"
                    data-testid="input-dispatch-date"
                  />
                </div>
                <div className="flex min-w-40 flex-1 flex-col gap-1">
                  <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Notes (optional)
                  </label>
                  <Textarea
                    placeholder="Reason for disposal..."
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    rows={1}
                    className="resize-none"
                    data-testid="input-notes"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="min-w-56">
            <CardContent className="flex h-full flex-col justify-center p-3">
              <label className="mb-1 flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <ScanLine className="h-3 w-3" /> Scan / Enter Ref
              </label>
              <div className="relative">
                <ScanLine className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={scanInput}
                  onChange={(event) => setScanInput(event.target.value)}
                  onKeyDown={handleScan}
                  placeholder="REF123456 + Enter"
                  className="pl-9 font-mono text-sm"
                  data-testid="input-scan-ref"
                  autoComplete="off"
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="px-4 pb-2 pt-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <CardTitle className="text-sm">Available Waste Bales</CardTitle>
                {!summaryLoading && (
                  <Badge variant="outline" className="text-xs">
                    {summaryTotals.bales} bales · {summaryPagination.total} products
                  </Badge>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Filter bales or products..."
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="h-8 w-52 pl-8 text-xs"
                    data-testid="input-search-bales"
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-3 text-xs"
                  disabled={summaryTotals.bales === 0 || selectAllMutation.isPending}
                  onClick={() => selectAllMutation.mutate()}
                  data-testid="button-select-all-waste"
                >
                  {selectAllMutation.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                  Select all matching
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {summaryLoading && !summary ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : groups.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                <Trash2 className="mx-auto mb-3 h-10 w-10 opacity-25" />
                <p className="text-sm">No matching Garbage or Wiper bales in stock.</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40">
                        <TableHead className="w-8 px-3 py-2" />
                        <TableHead className="px-3 py-2 text-xs">Product</TableHead>
                        <TableHead className="px-3 py-2 text-xs">Category</TableHead>
                        <TableHead className="px-3 py-2 text-right text-xs">Bales</TableHead>
                        <TableHead className="px-3 py-2 text-right text-xs">Weight (kg)</TableHead>
                        <TableHead className="px-3 py-2 text-right text-xs">Avg Rate</TableHead>
                        <TableHead className="px-3 py-2 text-right text-xs">Total Cost</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {groups.map((group) => {
                        const isExpanded = expandedGroups.has(group.productId);
                        const selectedInGroup = selectedBales.filter(
                          (bale) => bale.productId === group.productId && baleMatchesSearch(bale, debouncedSearch)
                        ).length;
                        const allSelected = group.baleCount > 0 && selectedInGroup === group.baleCount;
                        const partiallySelected = selectedInGroup > 0 && !allSelected;
                        const groupCheckState: boolean | "indeterminate" = allSelected
                          ? true
                          : partiallySelected
                            ? "indeterminate"
                            : false;
                        const detailQuery = groupQueryById.get(group.productId);
                        const bales = (detailQuery?.data as WasteBale[] | undefined) ?? [];

                        return (
                          <Fragment key={group.productId}>
                            <TableRow
                              className={allSelected ? "bg-destructive/5" : partiallySelected ? "bg-destructive/3" : ""}
                            >
                              <TableCell className="px-3 py-2">
                                <Checkbox
                                  checked={groupCheckState}
                                  onCheckedChange={() => void toggleGroupSelection(group)}
                                  data-testid={`checkbox-group-${group.productId}`}
                                />
                              </TableCell>
                              <TableCell
                                className="cursor-pointer px-3 py-2"
                                onClick={() => toggleExpandGroup(group.productId)}
                              >
                                <div className="flex items-center gap-2">
                                  {isExpanded ? (
                                    <ChevronDown className="h-3.5 w-3.5" />
                                  ) : (
                                    <ChevronRight className="h-3.5 w-3.5" />
                                  )}
                                  <span className="text-sm font-semibold">{group.productName}</span>
                                  {selectedInGroup > 0 && (
                                    <Badge variant="outline" className="text-xs">
                                      {selectedInGroup} selected
                                    </Badge>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell
                                className="cursor-pointer px-3 py-2"
                                onClick={() => toggleExpandGroup(group.productId)}
                              >
                                <Badge variant="outline" className="text-xs">
                                  {group.categoryName}
                                </Badge>
                              </TableCell>
                              <TableCell
                                className="cursor-pointer px-3 py-2 text-right text-sm"
                                onClick={() => toggleExpandGroup(group.productId)}
                              >
                                {group.baleCount}
                              </TableCell>
                              <TableCell
                                className="cursor-pointer px-3 py-2 text-right text-sm"
                                onClick={() => toggleExpandGroup(group.productId)}
                              >
                                {fmtKg(group.totalWeight)}
                              </TableCell>
                              <TableCell
                                className="cursor-pointer px-3 py-2 text-right text-xs text-muted-foreground"
                                onClick={() => toggleExpandGroup(group.productId)}
                              >
                                {group.avgRate > 0 ? fmt(group.avgRate) : "—"}
                              </TableCell>
                              <TableCell
                                className="cursor-pointer px-3 py-2 text-right text-sm font-medium"
                                onClick={() => toggleExpandGroup(group.productId)}
                              >
                                {group.totalCost > 0 ? fmt(group.totalCost) : "—"}
                              </TableCell>
                            </TableRow>

                            {isExpanded && detailQuery?.isLoading && (
                              <TableRow>
                                <TableCell colSpan={7} className="py-4 text-center">
                                  <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                                </TableCell>
                              </TableRow>
                            )}
                            {isExpanded && detailQuery?.isError && (
                              <TableRow>
                                <TableCell colSpan={7} className="py-3 text-center text-xs text-destructive">
                                  Could not load bale details.
                                </TableCell>
                              </TableRow>
                            )}
                            {isExpanded &&
                              !detailQuery?.isLoading &&
                              bales.map((bale) => (
                                <TableRow
                                  key={bale.id}
                                  className={`cursor-pointer text-xs ${selected.has(bale.id) ? "bg-destructive/8" : "bg-muted/10"}`}
                                  onClick={() => toggleBale(bale)}
                                  data-testid={`row-bale-${bale.id}`}
                                >
                                  <TableCell className="px-3 py-1.5 pl-5" onClick={(event) => event.stopPropagation()}>
                                    <Checkbox
                                      checked={selected.has(bale.id)}
                                      onCheckedChange={() => toggleBale(bale)}
                                    />
                                  </TableCell>
                                  <TableCell className="px-3 py-1.5 pl-8" colSpan={2}>
                                    <div className="flex items-center gap-2">
                                      <span className="font-mono font-semibold text-primary">
                                        {bale.referenceNumber}
                                      </span>
                                      <span className="text-muted-foreground">{bale.locationName}</span>
                                    </div>
                                  </TableCell>
                                  <TableCell className="px-3 py-1.5 text-right">1</TableCell>
                                  <TableCell className="px-3 py-1.5 text-right">{fmtKg(bale.weightKg)}</TableCell>
                                  <TableCell className="px-3 py-1.5 text-right text-muted-foreground">
                                    {bale.totalCost > 0 ? fmt(bale.totalCost) : "—"}
                                  </TableCell>
                                  <TableCell className="px-3 py-1.5 text-right">
                                    {bale.totalCost > 0 ? fmt(bale.totalCost) : "—"}
                                  </TableCell>
                                </TableRow>
                              ))}
                          </Fragment>
                        );
                      })}

                      <TableRow className="border-t-2 bg-muted/50 font-bold">
                        <TableCell className="px-3 py-2" />
                        <TableCell className="px-3 py-2 text-xs" colSpan={2}>
                          TOTAL — {summaryPagination.total} product{summaryPagination.total !== 1 ? "s" : ""}
                        </TableCell>
                        <TableCell className="px-3 py-2 text-right text-xs">{summaryTotals.bales}</TableCell>
                        <TableCell className="px-3 py-2 text-right text-xs">{fmtKg(summaryTotals.weight)}</TableCell>
                        <TableCell className="px-3 py-2 text-right text-xs text-muted-foreground">
                          {summaryTotals.bales > 0 && summaryTotals.cost > 0
                            ? fmt(summaryTotals.cost / summaryTotals.bales)
                            : "—"}
                        </TableCell>
                        <TableCell className="px-3 py-2 text-right text-xs">
                          {summaryTotals.cost > 0 ? fmt(summaryTotals.cost) : "—"}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>

                <div className="flex items-center justify-between border-t px-4 py-2">
                  <span className="text-xs text-muted-foreground">
                    Page {summaryPagination.page} of {summaryPagination.totalPages}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2"
                      disabled={balePage <= 1}
                      onClick={() => setBalePage((page) => Math.max(1, page - 1))}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" /> Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2"
                      disabled={balePage >= summaryPagination.totalPages}
                      onClick={() => setBalePage((page) => Math.min(summaryPagination.totalPages, page + 1))}
                    >
                      Next <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {selected.size > 0 && (
          <Card className="border-destructive/30 bg-destructive/3">
            <CardContent className="p-3">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-5">
                  <div className="flex items-center gap-2">
                    <CheckSquare className="h-4 w-4 text-destructive" />
                    <span className="text-sm font-semibold text-destructive" data-testid="text-selected-count">
                      {selected.size} bale{selected.size !== 1 ? "s" : ""} selected
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Weight className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm" data-testid="text-total-weight">
                      {fmtKg(selectedTotals.weight)} kg
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm font-medium" data-testid="text-total-cost">
                      {fmt(selectedTotals.cost)} write-off
                    </span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={clearSelectedBales}>
                    <X className="mr-1.5 h-3.5 w-3.5" /> Clear
                  </Button>
                  <Button variant="destructive" onClick={() => setConfirming(true)} data-testid="button-dispatch-waste">
                    <Trash2 className="mr-2 h-4 w-4" /> Dispatch {selected.size} Bale{selected.size !== 1 ? "s" : ""}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 px-4 pb-2 pt-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <History className="h-4 w-4 text-muted-foreground" /> Dispatch History
            </CardTitle>
            <span className="text-xs text-muted-foreground">
              {historyPagination.total} dispatch{historyPagination.total !== 1 ? "es" : ""}
            </span>
          </CardHeader>
          <CardContent className="p-0">
            {historyLoading && !history ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : historyItems.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No dispatches yet.</p>
            ) : (
              <>
                <div className="divide-y">
                  {historyItems.map((dispatch) => {
                    const isOpen = expandedHistoryIds.has(dispatch.id);
                    const detailQuery = historyQueryById.get(dispatch.id);
                    const bales = (detailQuery?.data as HistoryBale[] | undefined) ?? [];
                    return (
                      <div key={dispatch.id}>
                        <div
                          className="flex cursor-pointer items-center justify-between px-4 py-2.5 hover:bg-muted/30"
                          onClick={() => toggleHistoryItem(dispatch.id)}
                          data-testid={`row-dispatch-${dispatch.id}`}
                        >
                          <div className="flex items-center gap-2">
                            <ChevronRight
                              className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`}
                            />
                            <div>
                              <p className="text-xs font-semibold">{dispatch.dispatchNumber}</p>
                              <p className="text-xs text-muted-foreground">{dispatch.dispatchDate}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 text-xs">
                            <span className="text-muted-foreground">
                              {dispatch.totalBales} bale{dispatch.totalBales !== 1 ? "s" : ""}
                            </span>
                            <span className="text-muted-foreground">{fmtKg(dispatch.totalWeightKg)} kg</span>
                            <Badge variant="outline" className="border-destructive/30 text-xs text-destructive">
                              {fmt(dispatch.totalCostWrittenOff)}
                            </Badge>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-xs"
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleHistoryPrint(dispatch);
                              }}
                              data-testid={`button-reprint-${dispatch.id}`}
                            >
                              <Printer className="mr-1 h-3 w-3" /> Print
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-xs text-destructive hover:text-destructive"
                              onClick={(event) => {
                                event.stopPropagation();
                                setDeleteDispatchId(dispatch.id);
                              }}
                              data-testid={`button-delete-dispatch-${dispatch.id}`}
                            >
                              <Trash2 className="mr-1 h-3 w-3" /> Delete
                            </Button>
                          </div>
                        </div>

                        {isOpen && (
                          <div className="bg-muted/30 px-4 pb-4 pt-2">
                            {dispatch.notes && (
                              <p className="mb-2 text-xs text-muted-foreground">
                                <span className="font-medium">Note:</span> {dispatch.notes}
                              </p>
                            )}
                            {detailQuery?.isLoading ? (
                              <div className="py-4 text-center">
                                <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                              </div>
                            ) : detailQuery?.isError ? (
                              <p className="text-xs text-destructive">Could not load bale details.</p>
                            ) : bales.length === 0 ? (
                              <p className="text-xs text-muted-foreground">No bale details available.</p>
                            ) : (
                              <table className="mt-1 w-full border-collapse text-xs">
                                <thead>
                                  <tr className="border-b">
                                    <th className="py-1.5 text-left">Reference</th>
                                    <th className="py-1.5 text-left">Product</th>
                                    <th className="py-1.5 text-right">Weight (kg)</th>
                                    <th className="py-1.5 text-right">Cost W/O</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {bales.map((bale) => (
                                    <tr key={bale.id} className="border-b border-border/40 last:border-0">
                                      <td className="py-1 font-mono text-primary">{bale.referenceNumber}</td>
                                      <td className="py-1">{bale.productName}</td>
                                      <td className="py-1 text-right">{fmtKg(Number(bale.weightKg || 0))}</td>
                                      <td className="py-1 text-right">{fmt(Number(bale.totalCost || 0))}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-center justify-between border-t px-4 py-2">
                  <span className="text-xs text-muted-foreground">
                    Page {historyPagination.page} of {historyPagination.totalPages}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2"
                      disabled={historyPage <= 1}
                      onClick={() => setHistoryPage((page) => Math.max(1, page - 1))}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" /> Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2"
                      disabled={historyPage >= historyPagination.totalPages}
                      onClick={() => setHistoryPage((page) => Math.min(historyPagination.totalPages, page + 1))}
                    >
                      Next <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <ConfirmDisposalDialog
        open={confirming}
        onOpenChange={setConfirming}
        baleCount={selected.size}
        weight={selectedTotals.weight}
        cost={selectedTotals.cost}
        dispatchDate={dispatchDate}
        notes={notes}
        isPending={submitMutation.isPending}
        onConfirm={() => submitMutation.mutate()}
      />

      <DeleteDispatchDialog
        dispatchId={deleteDispatchId}
        onClose={() => setDeleteDispatchId(null)}
        isPending={deleteDispatchMutation.isPending}
        onConfirm={(id) => deleteDispatchMutation.mutate(id)}
      />

      <PrintDispatchDialog printData={printData} onClose={() => setPrintData(null)} />
    </div>
  );
}
