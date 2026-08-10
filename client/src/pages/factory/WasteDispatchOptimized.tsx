import { Fragment, useEffect, useMemo, useState } from "react";
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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/PageHeader";
import type { Bale } from "./wastedispatch/types";
import { fmt, fmtKg, today } from "./wastedispatch/utils";

type WasteBale = Bale & {
  productId: number;
  articleCode?: string;
};

type GroupSummary = {
  productId: number;
  productName: string;
  categoryName: string;
  baleCount: number;
  totalWeight: number;
  totalCost: number;
  avgRate: number;
};

type Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

type SummaryResponse = {
  groups: GroupSummary[];
  pagination: Pagination;
  totals: { bales: number; weight: number; cost: number };
};

type HistoryItem = {
  id: number;
  dispatchNumber: string;
  dispatchDate: string;
  notes?: string | null;
  totalBales: number;
  totalWeightKg: number;
  totalCostWrittenOff: number;
  createdAt?: string | null;
};

type HistoryResponse = {
  items: HistoryItem[];
  pagination: Pagination;
};

type PrintDispatch = {
  dispatchNumber: string;
  dispatchDate: string;
  notes?: string | null;
};

const GROUP_PAGE_SIZE = 25;
const HISTORY_PAGE_SIZE = 10;

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

async function fetchGroupBales(productId: number): Promise<WasteBale[]> {
  const response = await readJson<{ bales: WasteBale[] }>(
    `/api/factory/waste-dispatch/group-bales/${productId}`
  );
  return response.bales;
}

async function fetchHistoryBales(dispatchId: number): Promise<any[]> {
  const response = await readJson<{ bales: any[] }>(
    `/api/factory/waste-dispatch/history/${dispatchId}/bales`
  );
  return response.bales;
}

function printDispatchDocument(dispatch: PrintDispatch, bales: any[]) {
  const totalWeight = bales.reduce((sum, bale) => sum + Number(bale.weightKg || 0), 0);
  const totalCost = bales.reduce((sum, bale) => sum + Number(bale.totalCost || 0), 0);
  const rows = bales
    .map(
      (bale) => `<tr>
        <td>${String(bale.referenceNumber || "")}</td>
        <td>${String(bale.productName || "")}</td>
        <td class="num">${fmtKg(Number(bale.weightKg || 0))}</td>
        <td class="num">${fmt(Number(bale.totalCost || 0))}</td>
      </tr>`
    )
    .join("");

  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(`<!doctype html><html><head><title>Waste Disposal — ${dispatch.dispatchNumber}</title>
    <style>
      body{font-family:Arial,sans-serif;font-size:12px;margin:20px;color:#111}
      h1{font-size:18px;margin:0 0 4px}.sub{color:#555;font-size:11px;margin-bottom:16px}
      table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}
      th{background:#f3f4f6}.num{text-align:right}.total{font-weight:700}.note{margin-top:8px;color:#555}
    </style></head><body>
    <h1>Waste Disposal Record</h1>
    <div class="sub">Dispatch No: ${dispatch.dispatchNumber} &nbsp;|&nbsp; Date: ${dispatch.dispatchDate}</div>
    ${dispatch.notes ? `<div class="note">Note: ${dispatch.notes}</div>` : ""}
    <table><thead><tr><th>Reference</th><th>Product</th><th class="num">Weight (kg)</th><th class="num">Cost Written Off</th></tr></thead>
    <tbody>${rows}</tbody><tfoot><tr class="total"><td colspan="2">TOTAL — ${bales.length} bale(s)</td><td class="num">${fmtKg(totalWeight)}</td><td class="num">${fmt(totalCost)}</td></tr></tfoot></table>
    </body></html>`);
  win.document.close();
  win.focus();
  win.print();
  win.close();
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
  const [printData, setPrintData] = useState<{ dispatch: PrintDispatch; bales: WasteBale[] } | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setBalePage(1);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [search]);

  const summaryParams = new URLSearchParams({
    page: String(balePage),
    limit: String(GROUP_PAGE_SIZE),
  });
  if (debouncedSearch) summaryParams.set("search", debouncedSearch);

  const { data: summary, isLoading: summaryLoading } = useQuery<SummaryResponse>({
    queryKey: ["/api/factory/waste-dispatch/summary", balePage, debouncedSearch],
    queryFn: () => readJson(`/api/factory/waste-dispatch/summary?${summaryParams.toString()}`),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    placeholderData: (previous) => previous,
  });

  const { data: history, isLoading: historyLoading } = useQuery<HistoryResponse>({
    queryKey: ["/api/factory/waste-dispatch/history-summary", historyPage],
    queryFn: () =>
      readJson(`/api/factory/waste-dispatch/history-summary?page=${historyPage}&limit=${HISTORY_PAGE_SIZE}`),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
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

  const expandedProductIds = useMemo(() => Array.from(expandedGroups), [expandedGroups]);
  const groupQueries = useQueries({
    queries: expandedProductIds.map((productId) => ({
      queryKey: ["/api/factory/waste-dispatch/group-bales", productId],
      queryFn: () => fetchGroupBales(productId),
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    })),
  });
  const groupQueryById = useMemo(
    () => new Map(expandedProductIds.map((productId, index) => [productId, groupQueries[index]])),
    [expandedProductIds, groupQueries]
  );

  const expandedHistoryList = useMemo(() => Array.from(expandedHistoryIds), [expandedHistoryIds]);
  const historyDetailQueries = useQueries({
    queries: expandedHistoryList.map((dispatchId) => ({
      queryKey: ["/api/factory/waste-dispatch/history-bales", dispatchId],
      queryFn: () => fetchHistoryBales(dispatchId),
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    })),
  });
  const historyQueryById = useMemo(
    () => new Map(expandedHistoryList.map((dispatchId, index) => [dispatchId, historyDetailQueries[index]])),
    [expandedHistoryList, historyDetailQueries]
  );

  const selectedBales = useMemo(() => Array.from(selected.values()), [selected]);
  const selectedTotals = useMemo(
    () => ({
      weight: selectedBales.reduce((sum, bale) => sum + Number(bale.weightKg || 0), 0),
      cost: selectedBales.reduce((sum, bale) => sum + Number(bale.totalCost || 0), 0),
    }),
    [selectedBales]
  );

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
        queryKey: ["/api/factory/waste-dispatch/group-bales", group.productId],
        queryFn: () => fetchGroupBales(group.productId),
        staleTime: 5 * 60_000,
      });
      const allSelected = bales.length > 0 && bales.every((bale) => selected.has(bale.id));
      setSelected((previous) => {
        const next = new Map(previous);
        for (const bale of bales) {
          if (allSelected) next.delete(bale.id);
          else next.set(bale.id, bale);
        }
        return next;
      });
    } catch (error: any) {
      toast({ title: "Could not load product bales", description: error.message, variant: "destructive" });
    }
  };

  const selectAllMutation = useMutation({
    mutationFn: async () => {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("search", debouncedSearch);
      return readJson<{ bales: WasteBale[] }>(`/api/factory/waste-dispatch/select-all?${params.toString()}`);
    },
    onSuccess: ({ bales }) => {
      setSelected(new Map(bales.map((bale) => [bale.id, bale])));
      toast({ title: "Selection updated", description: `${bales.length} matching bale(s) selected.` });
    },
    onError: (error: any) => {
      toast({ title: "Could not select bales", description: error.message, variant: "destructive" });
    },
  });

  const handleScan = async (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    const reference = scanInput.trim();
    if (!reference) return;
    try {
      const response = await readJson<{ bale: WasteBale }>(
        `/api/factory/waste-dispatch/scan?ref=${encodeURIComponent(reference)}`
      );
      setSelected((previous) => new Map(previous).set(response.bale.id, response.bale));
      setExpandedGroups((previous) => new Set(previous).add(response.bale.productId));
      setScanInput("");
      toast({
        title: "Bale added",
        description: `${response.bale.referenceNumber} — ${response.bale.productName}`,
      });
    } catch (error: any) {
      toast({ title: "Not found", description: error.message, variant: "destructive" });
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
      const dispatchedBales = Array.from(selected.values());
      invalidateWasteReads();
      setSelected(new Map());
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
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
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
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
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
        staleTime: 5 * 60_000,
      });
      printDispatchDocument(dispatch, bales);
    } catch (error: any) {
      toast({ title: "Could not load dispatch", description: error.message, variant: "destructive" });
    }
  };

  const groups = summary?.groups ?? [];
  const summaryTotals = summary?.totals ?? { bales: 0, weight: 0, cost: 0 };
  const summaryPagination = summary?.pagination ?? { page: 1, limit: GROUP_PAGE_SIZE, total: 0, totalPages: 1 };
  const historyItems = history?.items ?? [];
  const historyPagination = history?.pagination ?? { page: 1, limit: HISTORY_PAGE_SIZE, total: 0, totalPages: 1 };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b px-6 py-3">
        <PageHeader
          title="Waste Dispatch"
          subtitle="Manage waste bales — bandwidth-optimized grouped loading"
          icon={<Trash2 className="h-5 w-5" />}
        />
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <div className="flex flex-wrap gap-3">
          <Card className="min-w-60 flex-1">
            <CardContent className="p-3">
              <div className="flex flex-wrap gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Dispatch Date</label>
                  <Input
                    type="date"
                    value={dispatchDate}
                    onChange={(event) => setDispatchDate(event.target.value)}
                    className="w-40"
                    data-testid="input-dispatch-date"
                  />
                </div>
                <div className="flex min-w-40 flex-1 flex-col gap-1">
                  <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Notes (optional)</label>
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
              <p className="mt-1 text-xs text-muted-foreground">Exact lookup works even when the bale is on another page.</p>
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
                    placeholder="Filter products..."
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="h-8 w-48 pl-8 text-xs"
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
                  {selectAllMutation.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
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
                        const selectedInGroup = selectedBales.filter((bale) => bale.productId === group.productId).length;
                        const allSelected = group.baleCount > 0 && selectedInGroup === group.baleCount;
                        const partiallySelected = selectedInGroup > 0 && !allSelected;
                        const detailQuery = groupQueryById.get(group.productId);
                        const bales = (detailQuery?.data as WasteBale[] | undefined) ?? [];

                        return (
                          <Fragment key={group.productId}>
                            <TableRow className={allSelected ? "bg-destructive/5" : partiallySelected ? "bg-destructive/3" : ""}>
                              <TableCell className="px-3 py-2">
                                <Checkbox
                                  checked={allSelected}
                                  data-state={partiallySelected ? "indeterminate" : allSelected ? "checked" : "unchecked"}
                                  onCheckedChange={() => void toggleGroupSelection(group)}
                                  data-testid={`checkbox-group-${group.productId}`}
                                />
                              </TableCell>
                              <TableCell className="cursor-pointer px-3 py-2" onClick={() => toggleExpandGroup(group.productId)}>
                                <div className="flex items-center gap-2">
                                  {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                  <span className="text-sm font-semibold">{group.productName}</span>
                                  {selectedInGroup > 0 && <Badge variant="outline" className="text-xs">{selectedInGroup} selected</Badge>}
                                </div>
                              </TableCell>
                              <TableCell className="cursor-pointer px-3 py-2" onClick={() => toggleExpandGroup(group.productId)}>
                                <Badge variant="outline" className="text-xs">{group.categoryName}</Badge>
                              </TableCell>
                              <TableCell className="cursor-pointer px-3 py-2 text-right text-sm" onClick={() => toggleExpandGroup(group.productId)}>{group.baleCount}</TableCell>
                              <TableCell className="cursor-pointer px-3 py-2 text-right text-sm" onClick={() => toggleExpandGroup(group.productId)}>{fmtKg(group.totalWeight)}</TableCell>
                              <TableCell className="cursor-pointer px-3 py-2 text-right text-xs text-muted-foreground" onClick={() => toggleExpandGroup(group.productId)}>{group.avgRate > 0 ? fmt(group.avgRate) : "—"}</TableCell>
                              <TableCell className="cursor-pointer px-3 py-2 text-right text-sm font-medium" onClick={() => toggleExpandGroup(group.productId)}>{group.totalCost > 0 ? fmt(group.totalCost) : "—"}</TableCell>
                            </TableRow>

                            {isExpanded && detailQuery?.isLoading && (
                              <TableRow><TableCell colSpan={7} className="py-4 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></TableCell></TableRow>
                            )}
                            {isExpanded && detailQuery?.isError && (
                              <TableRow><TableCell colSpan={7} className="py-3 text-center text-xs text-destructive">Could not load bale details.</TableCell></TableRow>
                            )}
                            {isExpanded && !detailQuery?.isLoading && bales.map((bale) => (
                              <TableRow
                                key={bale.id}
                                className={`cursor-pointer text-xs ${selected.has(bale.id) ? "bg-destructive/8" : "bg-muted/10"}`}
                                onClick={() => toggleBale(bale)}
                                data-testid={`row-bale-${bale.id}`}
                              >
                                <TableCell className="px-3 py-1.5 pl-5" onClick={(event) => event.stopPropagation()}>
                                  <Checkbox checked={selected.has(bale.id)} onCheckedChange={() => toggleBale(bale)} />
                                </TableCell>
                                <TableCell className="px-3 py-1.5 pl-8" colSpan={2}>
                                  <div className="flex items-center gap-2"><span className="font-mono font-semibold text-primary">{bale.referenceNumber}</span><span className="text-muted-foreground">{bale.locationName}</span></div>
                                </TableCell>
                                <TableCell className="px-3 py-1.5 text-right">1</TableCell>
                                <TableCell className="px-3 py-1.5 text-right">{fmtKg(bale.weightKg)}</TableCell>
                                <TableCell className="px-3 py-1.5 text-right text-muted-foreground">{bale.totalCost > 0 ? fmt(bale.totalCost) : "—"}</TableCell>
                                <TableCell className="px-3 py-1.5 text-right">{bale.totalCost > 0 ? fmt(bale.totalCost) : "—"}</TableCell>
                              </TableRow>
                            ))}
                          </Fragment>
                        );
                      })}

                      <TableRow className="border-t-2 bg-muted/50 font-bold">
                        <TableCell className="px-3 py-2" />
                        <TableCell className="px-3 py-2 text-xs" colSpan={2}>TOTAL — {summaryPagination.total} product{summaryPagination.total !== 1 ? "s" : ""}</TableCell>
                        <TableCell className="px-3 py-2 text-right text-xs">{summaryTotals.bales}</TableCell>
                        <TableCell className="px-3 py-2 text-right text-xs">{fmtKg(summaryTotals.weight)}</TableCell>
                        <TableCell className="px-3 py-2 text-right text-xs text-muted-foreground">{summaryTotals.bales > 0 && summaryTotals.cost > 0 ? fmt(summaryTotals.cost / summaryTotals.bales) : "—"}</TableCell>
                        <TableCell className="px-3 py-2 text-right text-xs">{summaryTotals.cost > 0 ? fmt(summaryTotals.cost) : "—"}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
                <div className="flex items-center justify-between border-t px-4 py-2">
                  <span className="text-xs text-muted-foreground">Page {summaryPagination.page} of {summaryPagination.totalPages}</span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="h-7 px-2" disabled={balePage <= 1} onClick={() => setBalePage((page) => Math.max(1, page - 1))}><ChevronLeft className="h-3.5 w-3.5" /> Previous</Button>
                    <Button variant="outline" size="sm" className="h-7 px-2" disabled={balePage >= summaryPagination.totalPages} onClick={() => setBalePage((page) => Math.min(summaryPagination.totalPages, page + 1))}>Next <ChevronRight className="h-3.5 w-3.5" /></Button>
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
                  <div className="flex items-center gap-2"><CheckSquare className="h-4 w-4 text-destructive" /><span className="text-sm font-semibold text-destructive" data-testid="text-selected-count">{selected.size} bale{selected.size !== 1 ? "s" : ""} selected</span></div>
                  <div className="flex items-center gap-1.5"><Weight className="h-3.5 w-3.5 text-muted-foreground" /><span className="text-sm" data-testid="text-total-weight">{fmtKg(selectedTotals.weight)} kg</span></div>
                  <div className="flex items-center gap-1.5"><DollarSign className="h-3.5 w-3.5 text-muted-foreground" /><span className="text-sm font-medium" data-testid="text-total-cost">{fmt(selectedTotals.cost)} write-off</span></div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setSelected(new Map())}><X className="mr-1.5 h-3.5 w-3.5" />Clear</Button>
                  <Button variant="destructive" onClick={() => setConfirming(true)} data-testid="button-dispatch-waste"><Trash2 className="mr-2 h-4 w-4" />Dispatch {selected.size} Bale{selected.size !== 1 ? "s" : ""}</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 px-4 pb-2 pt-3">
            <CardTitle className="flex items-center gap-2 text-sm"><History className="h-4 w-4 text-muted-foreground" />Dispatch History</CardTitle>
            <span className="text-xs text-muted-foreground">{historyPagination.total} dispatch{historyPagination.total !== 1 ? "es" : ""}</span>
          </CardHeader>
          <CardContent className="p-0">
            {historyLoading && !history ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : historyItems.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No dispatches yet.</p>
            ) : (
              <>
                <div className="divide-y">
                  {historyItems.map((dispatch) => {
                    const isOpen = expandedHistoryIds.has(dispatch.id);
                    const detailQuery = historyQueryById.get(dispatch.id);
                    const bales = (detailQuery?.data as any[] | undefined) ?? [];
                    return (
                      <div key={dispatch.id}>
                        <div className="flex cursor-pointer items-center justify-between px-4 py-2.5 hover:bg-muted/30" onClick={() => toggleHistoryItem(dispatch.id)} data-testid={`row-dispatch-${dispatch.id}`}>
                          <div className="flex items-center gap-2">
                            <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`} />
                            <div><p className="text-xs font-semibold">{dispatch.dispatchNumber}</p><p className="text-xs text-muted-foreground">{dispatch.dispatchDate}</p></div>
                          </div>
                          <div className="flex items-center gap-3 text-xs">
                            <span className="text-muted-foreground">{dispatch.totalBales} bale{dispatch.totalBales !== 1 ? "s" : ""}</span>
                            <span className="text-muted-foreground">{fmtKg(dispatch.totalWeightKg)} kg</span>
                            <Badge variant="outline" className="border-destructive/30 text-xs text-destructive">{fmt(dispatch.totalCostWrittenOff)}</Badge>
                            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={(event) => { event.stopPropagation(); void handleHistoryPrint(dispatch); }} data-testid={`button-reprint-${dispatch.id}`}><Printer className="mr-1 h-3 w-3" />Print</Button>
                            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-destructive hover:text-destructive" onClick={(event) => { event.stopPropagation(); setDeleteDispatchId(dispatch.id); }} data-testid={`button-delete-dispatch-${dispatch.id}`}><Trash2 className="mr-1 h-3 w-3" />Delete</Button>
                          </div>
                        </div>
                        {isOpen && (
                          <div className="bg-muted/30 px-4 pb-4 pt-2">
                            {dispatch.notes && <p className="mb-2 text-xs text-muted-foreground"><span className="font-medium">Note:</span> {dispatch.notes}</p>}
                            {detailQuery?.isLoading ? (
                              <div className="py-4 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></div>
                            ) : detailQuery?.isError ? (
                              <p className="text-xs text-destructive">Could not load bale details.</p>
                            ) : bales.length === 0 ? (
                              <p className="text-xs text-muted-foreground">No bale details available.</p>
                            ) : (
                              <table className="mt-1 w-full border-collapse text-xs">
                                <thead><tr className="border-b"><th className="py-1.5 text-left">Reference</th><th className="py-1.5 text-left">Product</th><th className="py-1.5 text-right">Weight (kg)</th><th className="py-1.5 text-right">Cost W/O</th></tr></thead>
                                <tbody>{bales.map((bale) => <tr key={bale.id} className="border-b border-border/40 last:border-0"><td className="py-1 font-mono text-primary">{bale.referenceNumber}</td><td className="py-1">{bale.productName}</td><td className="py-1 text-right">{fmtKg(Number(bale.weightKg || 0))}</td><td className="py-1 text-right">{fmt(Number(bale.totalCost || 0))}</td></tr>)}</tbody>
                              </table>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between border-t px-4 py-2">
                  <span className="text-xs text-muted-foreground">Page {historyPagination.page} of {historyPagination.totalPages}</span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="h-7 px-2" disabled={historyPage <= 1} onClick={() => setHistoryPage((page) => Math.max(1, page - 1))}><ChevronLeft className="h-3.5 w-3.5" /> Previous</Button>
                    <Button variant="outline" size="sm" className="h-7 px-2" disabled={historyPage >= historyPagination.totalPages} onClick={() => setHistoryPage((page) => Math.min(historyPagination.totalPages, page + 1))}>Next <ChevronRight className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2 text-destructive"><Trash2 className="h-5 w-5" />Confirm Waste Disposal</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">You are about to remove the selected bales from stock as waste.</p>
            <div className="space-y-1.5 rounded-md border border-destructive/20 bg-destructive/5 p-3">
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Bales</span><span className="font-medium">{selected.size}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Total Weight</span><span className="font-medium">{fmtKg(selectedTotals.weight)} kg</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Cost Written Off</span><span className="font-medium text-destructive">{fmt(selectedTotals.cost)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Date</span><span className="font-medium">{dispatchDate}</span></div>
              {notes && <div className="flex justify-between text-sm"><span className="text-muted-foreground">Notes</span><span className="max-w-xs text-right font-medium">{notes}</span></div>}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={submitMutation.isPending}>Cancel</Button>
            <Button variant="destructive" onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending || selected.size === 0} data-testid="button-confirm-dispatch">{submitMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing...</> : <><Trash2 className="mr-2 h-4 w-4" />Confirm Disposal</>}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDispatchId !== null} onOpenChange={(open) => { if (!open) setDeleteDispatchId(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2 text-destructive"><Trash2 className="h-5 w-5" />Delete Waste Dispatch?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">This will delete the dispatch record, restore all linked bales to stock, and remove its daybook entry.</p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteDispatchId(null)} disabled={deleteDispatchMutation.isPending}>Cancel</Button>
            <Button variant="destructive" disabled={deleteDispatchMutation.isPending} onClick={() => { if (deleteDispatchId !== null) deleteDispatchMutation.mutate(deleteDispatchId); }} data-testid="button-confirm-delete-dispatch">{deleteDispatchMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Deleting...</> : <><Trash2 className="mr-2 h-4 w-4" />Delete & Restore Bales</>}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={printData !== null} onOpenChange={(open) => { if (!open) setPrintData(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Waste Dispatch Created</DialogTitle></DialogHeader>
          {printData && <div className="space-y-2 text-sm"><p><span className="text-muted-foreground">Dispatch:</span> {printData.dispatch.dispatchNumber}</p><p><span className="text-muted-foreground">Bales:</span> {printData.bales.length}</p><p><span className="text-muted-foreground">Weight:</span> {fmtKg(printData.bales.reduce((sum, bale) => sum + bale.weightKg, 0))} kg</p></div>}
          <DialogFooter><Button variant="outline" onClick={() => setPrintData(null)}>Close</Button><Button onClick={() => { if (printData) printDispatchDocument(printData.dispatch, printData.bales); }}><Printer className="mr-2 h-4 w-4" />Print</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
