import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useCompany } from "@/contexts/CompanyContext";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { PeriodFilter, PeriodFilterValue, getDefaultPeriodValue } from "@/components/ui/period-filter";
import {
  Search, Filter, ExternalLink, Building2,
  RefreshCw, X, FileText, Receipt, Factory, Eye, Pencil, ChevronLeft, ChevronRight,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface JournalVoucher {
  id: number;
  companyId: number;
  companyName: string;
  voucherNumber: string;
  voucherType: string;
  voucherDate: string;
  totalAmount: string;
  currency: "USD" | "CFA";
  optional: boolean;
  description: string | null;
  narration: string | null;
}

interface SummaryRow {
  companyId: number;
  companyName: string;
  currency: string;
  voucherCount: number;
  totalDebits: string | null;
  totalCredits: string | null;
}

interface CompanyOption {
  id: number;
  name: string;
}

interface JournalResponse {
  vouchers: JournalVoucher[];
  total: number;
  page: number;
  totalPages: number;
  summary: SummaryRow[];
  companies: CompanyOption[];
}

interface VoucherEntry {
  id: number;
  ledgerAccountId: number | null;
  accountName: string | null;
  debitAmount: string;
  creditAmount: string;
  narration: string | null;
}

interface VoucherDetail {
  voucher: JournalVoucher;
  entries: VoucherEntry[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatAmount(val: string | null | undefined) {
  if (!val) return "—";
  const n = parseFloat(val);
  if (isNaN(n) || n === 0) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d: string) {
  try { return format(new Date(d), "dd MMM yyyy"); } catch { return d; }
}

const VOUCHER_TYPE_COLORS: Record<string, string> = {
  Payment:       "bg-red-100    text-red-800    dark:bg-red-900/30    dark:text-red-300",
  Receipt:       "bg-green-100  text-green-800  dark:bg-green-900/30  dark:text-green-300",
  Journal:       "bg-blue-100   text-blue-800   dark:bg-blue-900/30   dark:text-blue-300",
  Sales:         "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  Purchase:      "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  Contra:        "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  "Credit Note": "bg-pink-100   text-pink-800   dark:bg-pink-900/30   dark:text-pink-300",
  "Debit Note":  "bg-rose-100   text-rose-800   dark:bg-rose-900/30   dark:text-rose-300",
};

function VoucherTypeBadge({ type }: { type: string }) {
  const cls = VOUCHER_TYPE_COLORS[type] || "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {type}
    </span>
  );
}

// ─── Company colour pill ───────────────────────────────────────────────────────

const COMPANY_COLORS = [
  "bg-sky-100     text-sky-800     dark:bg-sky-900/30     dark:text-sky-300",
  "bg-violet-100  text-violet-800  dark:bg-violet-900/30  dark:text-violet-300",
  "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  "bg-amber-100   text-amber-800   dark:bg-amber-900/30   dark:text-amber-300",
  "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/30 dark:text-fuchsia-300",
  "bg-teal-100    text-teal-800    dark:bg-teal-900/30    dark:text-teal-300",
];

function companyColor(id: number) {
  return COMPANY_COLORS[id % COMPANY_COLORS.length];
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function TransactionJournal() {
  const [, setLocation] = useLocation();
  const { selectCompany, companies: contextCompanies } = useCompany();
  const { toast } = useToast();
  const { formatCashAmount } = useCurrencyContext();

  // ── Filter state ──
  const [periodFilter,   setPeriodFilter]   = useState<PeriodFilterValue>(getDefaultPeriodValue("today"));
  const [selectedCos,    setSelectedCos]    = useState<number[]>([]);   // empty = all
  const [voucherType,    setVoucherType]    = useState("all");
  const [currency,       setCurrency]       = useState("all");
  const [optionalFilter, setOptionalFilter] = useState("active");
  const [includeFactory, setIncludeFactory] = useState(false);
  const [searchInput,    setSearchInput]    = useState("");
  const [search,         setSearch]         = useState("");
  const [page,           setPage]           = useState(1);
  const LIMIT = 50;

  // ── Detail dialog ──
  const [detailId, setDetailId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [entryBalances, setEntryBalances] = useState<Record<number, string>>({});

  // ── Build query string (memoized to avoid spurious refetches) ──
  const queryParamsStr = useMemo(() => {
    const p = new URLSearchParams({
      ...(periodFilter.fromDate ? { startDate: periodFilter.fromDate } : {}),
      ...(periodFilter.toDate   ? { endDate:   periodFilter.toDate   } : {}),
      voucherType,
      currency,
      optional: optionalFilter,
      includeFactory: String(includeFactory),
      page:  String(page),
      limit: String(LIMIT),
      ...(search             ? { search }                            : {}),
      ...(selectedCos.length ? { companyIds: selectedCos.join(",") } : {}),
    });
    return p.toString();
  }, [periodFilter, voucherType, currency, optionalFilter, includeFactory, page, search, selectedCos]);

  const { data, isLoading, isFetching, refetch } = useQuery<JournalResponse>({
    queryKey: ["/api/global/transactions", queryParamsStr],
    queryFn: async () => {
      const res = await fetch(`/api/global/transactions?${queryParamsStr}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load transactions");
      return res.json();
    },
    // Keep old data visible while a background refresh or filter change is in flight —
    // this prevents the table from blanking out between fetches.
    placeholderData: (prev) => prev,
    // Silent background refresh every 30 seconds, just like Daybook.
    refetchInterval: 30_000,
  });

  const { data: voucherTypes } = useQuery<string[]>({
    queryKey: ["/api/global/transactions/voucher-types"],
  });

  const { data: detailData, isLoading: detailLoading } = useQuery<VoucherDetail>({
    queryKey: ["/api/global/transactions", detailId, "detail"],
    queryFn: async () => {
      const res = await fetch(`/api/global/transactions/${detailId}/detail`);
      if (!res.ok) throw new Error("Not found");
      return res.json();
    },
    enabled: !!detailId,
  });

  const { data: viewEntriesRaw, isLoading: viewEntriesLoading } = useQuery<any>({
    queryKey: ["/api/global/transactions", detailId, "view-entries"],
    queryFn: async () => {
      const res = await fetch(`/api/global/transactions/${detailId}/view-entries`);
      if (!res.ok) throw new Error("Not found");
      return res.json();
    },
    enabled: !!detailId && drawerOpen,
  });

  // Normalise view-entries response (may be array or { entries, purchaseOrder, items })
  const viewEntries: any[] = Array.isArray(viewEntriesRaw)
    ? viewEntriesRaw
    : (viewEntriesRaw?.entries ?? []);
  const viewPurchaseOrder: any | null = viewEntriesRaw?.purchaseOrder ?? null;
  const viewPurchaseItems: any[] = viewEntriesRaw?.items ?? [];

  const openDetail = (id: number) => {
    setEntryBalances({});
    setDetailId(id);
    setDrawerOpen(true);
  };

  // Fetch per-entry account balances for ledger entries when detail opens
  useEffect(() => {
    if (!drawerOpen || !detailData) return;
    const entries = detailData.entries.filter((e) => e.ledgerAccountId || e.customerId);
    if (entries.length === 0) return;
    let cancelled = false;
    (async () => {
      const results: Record<number, string> = {};
      await Promise.all(entries.map(async (e) => {
        try {
          let url: string | null = null;
          if (e.ledgerAccountId) {
            url = `/api/accounts/ledger/${e.ledgerAccountId}/balance`;
          } else if (e.customerId) {
            url = `/api/customers/${e.customerId}/balance`;
          }
          if (!url) return;
          const res = await fetch(url, { credentials: "include" });
          if (!res.ok) return;
          const data = await res.json();
          if (!cancelled) results[e.id] = data.balance?.toString() ?? "0";
        } catch { /* ignore */ }
      }));
      if (!cancelled) setEntryBalances(results);
    })();
    return () => { cancelled = true; };
  }, [drawerOpen, detailData]);

  const handleSearch = useCallback(() => {
    setSearch(searchInput);
    setPage(1);
  }, [searchInput]);

  // ── Switch company and navigate ──
  const openInCompany = async (companyId: number, path: string) => {
    const company = contextCompanies.find((c) => c.id === companyId);
    if (company) {
      selectCompany(company);
      await new Promise((r) => setTimeout(r, 300));
    } else {
      try {
        await apiRequest("POST", "/api/auth/set-company", { companyId });
      } catch {
        toast({ title: "Could not switch company", variant: "destructive" });
        return;
      }
    }
    setDrawerOpen(false);
    setLocation(path);
  };

  const availableCompanies: CompanyOption[] = data?.companies || [];

  // ── Summary aggregation ──
  const summaryByCompany = (data?.summary || []).reduce<
    Record<number, { name: string; count: number; usdDr: number; usdCr: number; cfaDr: number; cfaCr: number }>
  >((acc, row) => {
    if (!acc[row.companyId]) {
      acc[row.companyId] = { name: row.companyName, count: 0, usdDr: 0, usdCr: 0, cfaDr: 0, cfaCr: 0 };
    }
    const entry = acc[row.companyId];
    entry.count += Number(row.voucherCount);
    if (row.currency === "USD") {
      entry.usdDr += parseFloat(row.totalDebits  || "0");
      entry.usdCr += parseFloat(row.totalCredits || "0");
    } else {
      entry.cfaDr += parseFloat(row.totalDebits  || "0");
      entry.cfaCr += parseFloat(row.totalCredits || "0");
    }
    return acc;
  }, {});

  const totalVouchers = data?.total ?? 0;
  const totalPages    = data?.totalPages ?? 0;

  return (
    <div className="flex flex-col gap-4">
      {/* ── Page header ── */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <FileText className="h-5 w-5 text-muted-foreground" />
            All Daybook
            {isFetching && (
              <RefreshCw className="h-4 w-4 text-muted-foreground animate-spin" data-testid="icon-refreshing" />
            )}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            All vouchers across all companies — filtered and searchable
          </p>
        </div>
        <Button variant="outline" size="default" onClick={() => refetch()} disabled={isFetching} data-testid="button-refresh-journal">
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* ── Filters ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Filter className="w-5 h-5" />
              <CardTitle>Filters</CardTitle>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            {/* Period */}
            <div className="space-y-2">
              <Label>Period</Label>
              <PeriodFilter
                value={periodFilter}
                onChange={(v) => { setPeriodFilter(v); setPage(1); }}
                data-testid="period-filter"
              />
            </div>

            {/* Company multi-select */}
            <div className="space-y-2">
              <Label>Companies</Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="min-w-[160px] justify-between" data-testid="button-company-filter">
                    <Building2 className="h-4 w-4 mr-2 shrink-0" />
                    <span className="flex-1 text-left truncate">
                      {selectedCos.length === 0
                        ? "All Companies"
                        : `${selectedCos.length} selected`}
                    </span>
                    <Filter className="h-3.5 w-3.5 ml-1 text-muted-foreground shrink-0" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  <DropdownMenuLabel>Select Companies</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={selectedCos.length === 0}
                    onCheckedChange={() => setSelectedCos([])}
                    data-testid="checkbox-all-companies"
                  >
                    All Companies
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuSeparator />
                  {availableCompanies.map((c) => (
                    <DropdownMenuCheckboxItem
                      key={c.id}
                      checked={selectedCos.includes(c.id)}
                      onCheckedChange={(checked) => {
                        setSelectedCos((prev) =>
                          checked ? [...prev, c.id] : prev.filter((id) => id !== c.id)
                        );
                      }}
                      data-testid={`checkbox-company-${c.id}`}
                    >
                      {c.name}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Voucher type */}
            <div className="space-y-2">
              <Label htmlFor="voucher-type-tj">Voucher Type</Label>
              <Select value={voucherType} onValueChange={(v) => { setVoucherType(v); setPage(1); }}>
                <SelectTrigger id="voucher-type-tj" className="w-[150px]" data-testid="select-voucher-type">
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {(voucherTypes || []).map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Currency */}
            <div className="space-y-2">
              <Label htmlFor="currency-tj">Currency</Label>
              <Select value={currency} onValueChange={(v) => { setCurrency(v); setPage(1); }}>
                <SelectTrigger id="currency-tj" className="w-[110px]" data-testid="select-currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="CFA">CFA</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Status */}
            <div className="space-y-2">
              <Label htmlFor="status-tj">Status</Label>
              <Select value={optionalFilter} onValueChange={(v) => { setOptionalFilter(v); setPage(1); }}>
                <SelectTrigger id="status-tj" className="w-[130px]" data-testid="select-optional">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="active">Active Only</SelectItem>
                  <SelectItem value="optional">Optional Only</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Factory toggle */}
            <div className="space-y-2">
              <Label>Factory</Label>
              <div>
                <Button
                  variant={includeFactory ? "default" : "outline"}
                  className="gap-2"
                  onClick={() => { setIncludeFactory(v => !v); setPage(1); }}
                  data-testid="button-toggle-factory"
                >
                  <Factory className="h-4 w-4" />
                  {includeFactory ? "Included" : "Excluded"}
                </Button>
              </div>
            </div>

            {/* Search */}
            <div className="space-y-2 flex-1 min-w-0 w-full md:min-w-[200px] md:w-auto">
              <Label htmlFor="search-tj">Search</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="search-tj"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    placeholder="Voucher # or narration…"
                    className="pl-8"
                    data-testid="input-search"
                  />
                </div>
                <Button variant="default" className="shrink-0" onClick={handleSearch} data-testid="button-search">
                  Search
                </Button>
                {search && (
                  <Button variant="ghost" size="icon" onClick={() => { setSearchInput(""); setSearch(""); }} data-testid="button-clear-search">
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Type quick-filter chips ── */}
      {(() => {
        const chips = [
          { label: "All",            value: "all" },
          { label: "Payment",        value: "Payment" },
          { label: "Receipt",        value: "Receipt" },
          { label: "Sales",          value: "Sales" },
          { label: "Purchase",       value: "Purchase" },
          { label: "Stock Transfer", value: "Stock Transfer" },
          { label: "Journal",        value: "Journal" },
          { label: "Mixed",          value: "Mixed" },
          { label: "Production",     value: "Production" },
          { label: "Consumption",    value: "Consumption" },
        ];
        return (
          <div className="flex flex-wrap gap-1.5" data-testid="type-chips">
            {chips.map((c) => {
              const active = voucherType === c.value || (c.value === "all" && voucherType === "all");
              return (
                <button
                  key={c.value}
                  onClick={() => setVoucherType(c.value)}
                  data-testid={`chip-type-${c.value.replace(/\s+/g, "-").toLowerCase()}`}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors
                    ${active
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-muted-foreground border-border hover:text-foreground hover:border-foreground/40"
                    }`}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        );
      })()}

      {/* ── Summary cards ── */}
      {!isLoading && Object.keys(summaryByCompany).length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {Object.entries(summaryByCompany).map(([id, row]) => (
            <Card
              key={id}
              className={`cursor-pointer hover-elevate ${selectedCos.includes(Number(id)) ? "ring-1 ring-primary" : ""}`}
              onClick={() => {
                const num = Number(id);
                setSelectedCos((prev) =>
                  prev.includes(num) ? prev.filter((x) => x !== num) : [...prev, num]
                );
              }}
              data-testid={`card-company-summary-${id}`}
            >
              <CardHeader className="pb-1 pt-3 px-3">
                <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded ${companyColor(Number(id))}`}>
                  {row.name}
                </span>
              </CardHeader>
              <CardContent className="px-3 pb-3">
                <div className="text-lg font-semibold">{row.count.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">vouchers</div>
                {row.usdDr > 0 && (
                  <div className="text-xs text-muted-foreground mt-1">
                    USD Dr: {row.usdDr.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </div>
                )}
                {row.cfaDr > 0 && (
                  <div className="text-xs text-muted-foreground">
                    CFA Dr: {row.cfaDr.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── Table ── */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base">
            Vouchers
            {!isLoading && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {totalVouchers.toLocaleString()} total
              </span>
            )}
          </CardTitle>
          {totalPages > 1 && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <Button variant="outline" size="icon" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} data-testid="button-prev-page">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} data-testid="button-next-page">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[110px]">Date</TableHead>
                  <TableHead className="w-[150px]">Company</TableHead>
                  <TableHead className="w-[160px]">Type</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right w-[130px]">Amount</TableHead>
                  <TableHead className="w-[90px] text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 6 }).map((__, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (data?.vouchers || []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                      No transactions found for the selected filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  (data?.vouchers || []).map((v) => (
                    <TableRow
                      key={v.id}
                      data-testid={`row-voucher-${v.id}`}
                    >
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {fmtDate(v.voucherDate)}
                      </TableCell>
                      <TableCell>
                        <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded truncate max-w-[140px] ${companyColor(v.companyId)}`}>
                          {v.companyName}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 flex-wrap">
                          <VoucherTypeBadge type={v.voucherType} />
                          {v.optional && (
                            <Badge variant="outline" className="text-xs">Optional</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm max-w-xs text-muted-foreground">
                        <div className="flex items-center gap-1 truncate">
                          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                          <span className="truncate">{v.description || v.narration || "—"}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-sm font-mono">
                        <span className="text-xs text-muted-foreground mr-1">{v.currency}</span>
                        {formatAmount(v.totalAmount)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openDetail(v.id)}
                            data-testid={`button-preview-voucher-${v.id}`}
                            title="Preview"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openInCompany(v.companyId, `/daybook?voucherId=${v.id}`)}
                            data-testid={`button-edit-voucher-${v.id}`}
                            title="Open in Daybook"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination footer */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <span className="text-sm text-muted-foreground">
                Showing {((page - 1) * LIMIT) + 1}–{Math.min(page * LIMIT, totalVouchers)} of {totalVouchers.toLocaleString()}
              </span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="default" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} data-testid="button-prev-page-footer">
                  <ChevronLeft className="h-4 w-4 mr-1" /> Previous
                </Button>
                <Button variant="outline" size="default" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} data-testid="button-next-page-footer">
                  Next <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Voucher detail dialog ── */}
      <Dialog open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DialogContent className="w-full max-w-[95vw] md:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Voucher Details</DialogTitle>
            <DialogDescription>View voucher information</DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}
            </div>
          ) : detailData ? (
            <div className="flex flex-col gap-4">
              {/* Date + Type + Company row */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Date</p>
                  <p className="text-sm font-semibold">{fmtDate(detailData.voucher.voucherDate)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Type</p>
                  <div className="flex items-center gap-1 flex-wrap">
                    <VoucherTypeBadge type={detailData.voucher.voucherType} />
                    {detailData.voucher.optional && (
                      <Badge variant="outline" className="text-xs">Optional</Badge>
                    )}
                  </div>
                </div>
              </div>

              {/* Description */}
              {(detailData.voucher.description || detailData.voucher.narration) && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Description</p>
                  <p className="text-sm">{detailData.voucher.description || detailData.voucher.narration}</p>
                </div>
              )}

              {/* Rich entries panel — mirrors normal Daybook view structure */}
              {viewEntriesLoading ? (
                <div className="flex flex-col gap-2">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
                </div>
              ) : (() => {
                const vtype = detailData.voucher.voucherType;
                const fmt = (v: any) => {
                  const n = typeof v === "number" ? v : parseFloat(v || "0");
                  if (isNaN(n)) return "—";
                  return formatCashAmount(n);
                };
                const fmtNum = (v: any) => {
                  const n = typeof v === "number" ? v : parseFloat(v || "0");
                  if (isNaN(n)) return "0";
                  return Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 3 });
                };

                // Categorise rows
                const stockRows = viewEntries.filter((e) => e.isStockItem);
                const ledgerRows = viewEntries.filter((e) => !e.isStockItem);

                // ── PAYMENT / RECEIPT ────────────────────────────────────────────────
                if (vtype === "Payment" || vtype === "Receipt") {
                  const sourceEntry = vtype === "Payment"
                    ? viewEntries.find((e) => parseFloat(e.creditAmount || "0") > 0)
                    : viewEntries.find((e) => parseFloat(e.debitAmount  || "0") > 0);

                  const total = vtype === "Payment"
                    ? viewEntries.reduce((s, e) => s + parseFloat(e.debitAmount  || "0"), 0)
                    : viewEntries.reduce((s, e) => s + parseFloat(e.creditAmount || "0"), 0);

                  const displayEntries = viewEntries.filter((e) =>
                    vtype === "Payment"
                      ? parseFloat(e.debitAmount  || "0") > 0
                      : parseFloat(e.creditAmount || "0") > 0
                  );

                  return (
                    <div className="space-y-4">
                      {sourceEntry && (
                        <div className="p-3 md:p-4 bg-muted/50 rounded-md">
                          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
                            <div>
                              <p className="text-sm text-muted-foreground mb-1">
                                {vtype === "Payment" ? "Paid From" : "Received In"}
                              </p>
                              <div className="font-medium text-base md:text-lg">{sourceEntry.accountName}</div>
                              {entryBalances[sourceEntry.id] !== undefined && (
                                <div className="text-sm font-mono mt-2">
                                  Balance: {fmt(entryBalances[sourceEntry.id])}
                                </div>
                              )}
                            </div>
                            <div className="sm:text-right">
                              <p className="text-sm text-muted-foreground mb-1">Total Amount</p>
                              <div className="text-xl md:text-2xl font-bold font-mono">{fmt(total)}</div>
                            </div>
                          </div>
                        </div>
                      )}
                      <div>
                        <h3 className="font-semibold mb-3">Entries</h3>
                        <div className="border rounded-md">
                          <Table>
                            <TableHeader className="sticky top-0 z-10 bg-background">
                              <TableRow>
                                <TableHead>Account</TableHead>
                                <TableHead className="text-right">Amount</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {displayEntries.map((entry) => {
                                const amount = Math.max(parseFloat(entry.debitAmount || "0"), parseFloat(entry.creditAmount || "0"));
                                return (
                                  <TableRow key={entry.id} data-testid={`row-entry-${entry.id}`}>
                                    <TableCell>
                                      <div className="font-medium">{entry.accountName}</div>
                                      {entryBalances[entry.id] !== undefined && (
                                        <div className="text-xs text-muted-foreground mt-0.5">
                                          Balance: {fmt(entryBalances[entry.id])}
                                        </div>
                                      )}
                                    </TableCell>
                                    <TableCell className="text-right font-mono">{fmt(amount)}</TableCell>
                                  </TableRow>
                                );
                              })}
                              <TableRow className="font-bold bg-muted/50">
                                <TableCell>Total</TableCell>
                                <TableCell className="text-right font-mono">{fmt(total)}</TableCell>
                              </TableRow>
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    </div>
                  );
                }

                // ── SALES / POS ──────────────────────────────────────────────────────
                if ((vtype === "Sales" || vtype === "POS") && stockRows.length > 0) {
                  const grandTotal = stockRows.reduce((s, r) => s + parseFloat(r.totalSales || r.totalAmount || "0"), 0);
                  const grandProfit = stockRows.reduce((s, r) => s + parseFloat(r.profit || "0"), 0);
                  const grandHassansProfit = stockRows.reduce((s, r) => s + parseFloat(r.hassansProfit || "0"), 0);
                  const hasHassans = stockRows.some((r) => r.hassansPrice !== undefined && r.hassansPrice !== null);
                  const hasCost = stockRows.some((r) => r.costPrice !== undefined && r.costPrice !== null && parseFloat(r.costPrice || "0") > 0);

                  // Cash / receivable account = the debit entry
                  const cashEntry = ledgerRows.find((e) => parseFloat(e.debitAmount || "0") > 0);

                  return (
                    <div className="space-y-4">
                      {cashEntry && (
                        <div className="p-3 md:p-4 bg-muted/50 rounded-md">
                          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
                            <div>
                              <p className="text-sm text-muted-foreground mb-1">Received In</p>
                              <div className="font-medium text-base md:text-lg">{cashEntry.accountName}</div>
                              {entryBalances[cashEntry.id] !== undefined && (
                                <div className="text-sm font-mono mt-2">
                                  Balance: {fmt(entryBalances[cashEntry.id])}
                                </div>
                              )}
                            </div>
                            <div className="sm:text-right">
                              <p className="text-sm text-muted-foreground mb-1">Total Sales</p>
                              <div className="text-xl md:text-2xl font-bold font-mono">{fmt(grandTotal)}</div>
                            </div>
                          </div>
                        </div>
                      )}

                      <div>
                        <h3 className="font-semibold mb-3">Items Sold</h3>
                        <div className="border rounded-md overflow-x-auto">
                          <Table>
                            <TableHeader className="sticky top-0 z-10 bg-background">
                              <TableRow>
                                <TableHead>Item</TableHead>
                                <TableHead className="text-right w-16">Qty</TableHead>
                                <TableHead className="text-right w-24">Price</TableHead>
                                {hasCost && <TableHead className="text-right w-24">Cost</TableHead>}
                                <TableHead className="text-right w-28">Total</TableHead>
                                <TableHead className="text-right w-24">Profit</TableHead>
                                {hasHassans && <TableHead className="text-right w-28">Hassan's Price</TableHead>}
                                {hasHassans && <TableHead className="text-right w-28">Hassan's Profit</TableHead>}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {stockRows.map((r) => {
                                const profit = parseFloat(r.profit || "0");
                                const hProfit = parseFloat(r.hassansProfit || "0");
                                return (
                                  <TableRow key={r.id} data-testid={`row-sales-item-${r.id}`}>
                                    <TableCell className="py-2">
                                      <div className="text-sm font-medium">{r.stockItemName}</div>
                                      {r.stockItemCode && r.stockItemCode !== "-" && (
                                        <div className="text-xs text-muted-foreground">{r.stockItemCode}</div>
                                      )}
                                    </TableCell>
                                    <TableCell className="text-right text-sm font-mono py-2">{fmtNum(r.quantity)}</TableCell>
                                    <TableCell className="text-right text-sm font-mono py-2">{fmt(r.sellingPrice || r.rate)}</TableCell>
                                    {hasCost && (
                                      <TableCell className="text-right text-sm font-mono py-2 text-muted-foreground">
                                        {fmt(r.costPrice)}
                                      </TableCell>
                                    )}
                                    <TableCell className="text-right text-sm font-mono py-2">{fmt(r.totalSales || r.totalAmount)}</TableCell>
                                    <TableCell className={`text-right text-sm font-mono py-2 ${profit >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                                      {fmt(profit)}
                                    </TableCell>
                                    {hasHassans && (
                                      <TableCell className="text-right text-sm font-mono py-2">{fmt(r.hassansPrice)}</TableCell>
                                    )}
                                    {hasHassans && (
                                      <TableCell className={`text-right text-sm font-mono py-2 ${hProfit >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                                        {fmt(hProfit)}
                                      </TableCell>
                                    )}
                                  </TableRow>
                                );
                              })}
                              <TableRow className="font-bold bg-muted/50">
                                <TableCell colSpan={hasCost ? 4 : 3}>Total</TableCell>
                                <TableCell className="text-right font-mono">{fmt(grandTotal)}</TableCell>
                                <TableCell className={`text-right font-mono ${grandProfit >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                                  {fmt(grandProfit)}
                                </TableCell>
                                {hasHassans && <TableCell />}
                                {hasHassans && (
                                  <TableCell className={`text-right font-mono ${grandHassansProfit >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                                    {fmt(grandHassansProfit)}
                                  </TableCell>
                                )}
                              </TableRow>
                            </TableBody>
                          </Table>
                        </div>
                      </div>

                      {ledgerRows.length > 1 && (
                        <div>
                          <h3 className="font-semibold mb-3">Accounts</h3>
                          <div className="border rounded-md">
                            <Table>
                              <TableBody>
                                {ledgerRows.map((e) => {
                                  const amount = Math.max(parseFloat(e.debitAmount || "0"), parseFloat(e.creditAmount || "0"));
                                  return (
                                    <TableRow key={e.id}>
                                      <TableCell className="py-2">
                                        <div className="font-medium">{e.accountName}</div>
                                        {entryBalances[e.id] !== undefined && (
                                          <div className="text-xs text-muted-foreground">Balance: {fmt(entryBalances[e.id])}</div>
                                        )}
                                      </TableCell>
                                      <TableCell className="text-right font-mono">{fmt(amount)}</TableCell>
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                }

                // ── STOCK TRANSFER ──────────────────────────────────────────────────
                if ((vtype === "Stock Transfer" || vtype === "StockTransfer") && stockRows.length > 0) {
                  const grandTotal = stockRows.reduce((s, r) => s + parseFloat(r.totalAmount || "0"), 0);
                  const grandQty   = stockRows.reduce((s, r) => s + parseFloat(r.quantity    || "0"), 0);
                  return (
                    <div>
                      <h3 className="font-semibold mb-3">Transfer Items</h3>
                      <div className="border rounded-md overflow-x-auto">
                        <Table>
                          <TableHeader className="sticky top-0 z-10 bg-background">
                            <TableRow>
                              <TableHead>Item Name</TableHead>
                              <TableHead className="text-right">Qty</TableHead>
                              <TableHead className="text-right">Rate</TableHead>
                              <TableHead className="text-right">Total Amount</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {stockRows.map((r) => (
                              <TableRow key={r.id} data-testid={`row-transfer-item-${r.id}`}>
                                <TableCell>
                                  <div className="font-medium">{r.stockItemName}</div>
                                  {r.stockItemCode && r.stockItemCode !== "-" && (
                                    <div className="text-xs text-muted-foreground">{r.stockItemCode}</div>
                                  )}
                                </TableCell>
                                <TableCell className="text-right font-mono">{fmtNum(r.quantity)}</TableCell>
                                <TableCell className="text-right font-mono">{fmt(r.rate)}</TableCell>
                                <TableCell className="text-right font-mono">{fmt(r.totalAmount)}</TableCell>
                              </TableRow>
                            ))}
                            <TableRow className="font-bold bg-muted/50">
                              <TableCell>Total</TableCell>
                              <TableCell className="text-right font-mono">{fmtNum(grandQty)}</TableCell>
                              <TableCell />
                              <TableCell className="text-right font-mono">{fmt(grandTotal)}</TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  );
                }

                // ── PRODUCTION / CONSUMPTION / MIXED ────────────────────────────────
                if ((vtype === "Production" || vtype === "Consumption" || vtype === "Mixed") && stockRows.length > 0) {
                  const grandTotal = vtype === "Mixed"
                    ? stockRows.reduce((s, r) => {
                        const amt = Math.abs(parseFloat(r.totalAmount || "0"));
                        return r.adjustmentType === "Production" ? s + amt : s - amt;
                      }, 0)
                    : stockRows.reduce((s, r) => s + Math.abs(parseFloat(r.totalAmount || "0")), 0);
                  const grandQty   = stockRows.reduce((s, r) => s + Math.abs(parseFloat(r.quantity    || "0")), 0);
                  return (
                    <div>
                      <h3 className="font-semibold mb-3">Stock Items</h3>
                      <div className="border rounded-md overflow-x-auto">
                        <Table>
                          <TableHeader className="sticky top-0 z-10 bg-background">
                            <TableRow>
                              <TableHead>Item Name</TableHead>
                              {vtype === "Mixed" && <TableHead>Type</TableHead>}
                              <TableHead className="text-right">Qty</TableHead>
                              <TableHead className="text-right">Rate</TableHead>
                              <TableHead className="text-right">Total Amount</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {stockRows.map((r) => (
                              <TableRow key={r.id} data-testid={`row-adj-item-${r.id}`}>
                                <TableCell>
                                  <div className="font-medium">{r.stockItemName}</div>
                                  {r.stockItemCode && r.stockItemCode !== "-" && (
                                    <div className="text-xs text-muted-foreground">{r.stockItemCode}</div>
                                  )}
                                </TableCell>
                                {vtype === "Mixed" && (
                                  <TableCell>
                                    <Badge variant={r.adjustmentType === "Production" ? "default" : "secondary"} className="text-xs">
                                      {r.adjustmentType}
                                    </Badge>
                                  </TableCell>
                                )}
                                <TableCell className="text-right font-mono">{fmtNum(r.quantity)}</TableCell>
                                <TableCell className="text-right font-mono">{fmt(r.rate)}</TableCell>
                                <TableCell className="text-right font-mono">{fmt(Math.abs(parseFloat(r.totalAmount || "0")))}</TableCell>
                              </TableRow>
                            ))}
                            <TableRow className="font-bold bg-muted/50">
                              <TableCell colSpan={vtype === "Mixed" ? 2 : 1}>Total</TableCell>
                              <TableCell className="text-right font-mono">{fmtNum(grandQty)}</TableCell>
                              <TableCell />
                              <TableCell className="text-right font-mono">{fmt(grandTotal)}</TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  );
                }

                // ── PURCHASE ────────────────────────────────────────────────────────
                if (vtype === "Purchase" && viewPurchaseOrder) {
                  const po = viewPurchaseOrder;
                  const itemsTotal = viewPurchaseItems.reduce((s, r) => s + parseFloat(r.totalAmount || "0"), 0);
                  const charges = [
                    { label: "Freight",          value: po.freight },
                    { label: "Fumigation",       value: po.fumigation },
                    { label: "Surcharge",        value: po.surcharge },
                    { label: "Document Charges", value: po.documentCharges },
                    { label: "Other Charges",    value: po.otherCharges },
                  ].filter((c) => c.value && parseFloat(c.value) !== 0);
                  const discount = parseFloat(po.discount || "0");
                  const chargesTotal = charges.reduce((s, c) => s + parseFloat(c.value || "0"), 0);
                  const grandTotal = itemsTotal + chargesTotal - discount;

                  return (
                    <div className="space-y-4">
                      {/* PO header */}
                      <div className="p-3 md:p-4 bg-muted/50 rounded-md space-y-2">
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                          <div>
                            <span className="text-xs text-muted-foreground">PO Number: </span>
                            <span className="font-semibold">{po.poNumber}</span>
                          </div>
                          {po.status && <Badge variant="outline">{po.status}</Badge>}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
                          {po.supplierName && (
                            <div>
                              <span className="text-muted-foreground">Supplier: </span>
                              <span className="font-medium">{po.supplierName}</span>
                            </div>
                          )}
                          {po.containerNumber && (
                            <div>
                              <span className="text-muted-foreground">Container: </span>
                              <span className="font-medium">{po.containerNumber}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {viewPurchaseItems.length > 0 && (
                        <div>
                          <h3 className="font-semibold mb-3">Line Items</h3>
                          <div className="border rounded-md overflow-x-auto">
                            <Table>
                              <TableHeader className="sticky top-0 z-10 bg-background">
                                <TableRow>
                                  <TableHead>Item</TableHead>
                                  <TableHead className="text-right">Qty</TableHead>
                                  <TableHead className="text-right">Rate</TableHead>
                                  <TableHead className="text-right">Total</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {viewPurchaseItems.map((r) => (
                                  <TableRow key={r.id} data-testid={`row-po-item-${r.id}`}>
                                    <TableCell className="font-medium">{r.accountName}</TableCell>
                                    <TableCell className="text-right font-mono">{fmtNum(r.quantity)}</TableCell>
                                    <TableCell className="text-right font-mono">{fmt(r.rate)}</TableCell>
                                    <TableCell className="text-right font-mono">{fmt(r.totalAmount)}</TableCell>
                                  </TableRow>
                                ))}
                                <TableRow className="bg-muted/30">
                                  <TableCell colSpan={3} className="text-right font-medium">Items Subtotal</TableCell>
                                  <TableCell className="text-right font-mono font-semibold">{fmt(itemsTotal)}</TableCell>
                                </TableRow>
                                {charges.map((c) => (
                                  <TableRow key={c.label}>
                                    <TableCell colSpan={3} className="text-right text-muted-foreground">{c.label}</TableCell>
                                    <TableCell className="text-right font-mono">{fmt(c.value)}</TableCell>
                                  </TableRow>
                                ))}
                                {discount > 0 && (
                                  <TableRow>
                                    <TableCell colSpan={3} className="text-right text-muted-foreground">Discount</TableCell>
                                    <TableCell className="text-right font-mono text-red-600 dark:text-red-400">- {fmt(discount)}</TableCell>
                                  </TableRow>
                                )}
                                <TableRow className="font-bold bg-muted/50">
                                  <TableCell colSpan={3} className="text-right">Grand Total</TableCell>
                                  <TableCell className="text-right font-mono">{fmt(grandTotal)}</TableCell>
                                </TableRow>
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      )}

                      {viewEntries.length > 0 && (
                        <div>
                          <h3 className="font-semibold mb-3">Accounts</h3>
                          <div className="border rounded-md">
                            <Table>
                              <TableBody>
                                {viewEntries.map((e) => {
                                  const amount = Math.max(parseFloat(e.debitAmount || "0"), parseFloat(e.creditAmount || "0"));
                                  return (
                                    <TableRow key={e.id}>
                                      <TableCell>
                                        <div className="font-medium">{e.accountName}</div>
                                        {entryBalances[e.id] !== undefined && (
                                          <div className="text-xs text-muted-foreground">Balance: {fmt(entryBalances[e.id])}</div>
                                        )}
                                      </TableCell>
                                      <TableCell className="text-right font-mono">{fmt(amount)}</TableCell>
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                }

                // ── Default: ledger entries (Payment / Receipt / Journal / etc.) ──────
                const entries = viewEntries.length > 0 ? viewEntries : detailData.entries;
                const grandTotal = entries.reduce((s, e) =>
                  s + Math.max(parseFloat(e.debitAmount || "0"), parseFloat(e.creditAmount || "0")), 0);
                return (
                  <div>
                    <p className="text-sm font-medium mb-2">Entries</p>
                    <div className="rounded-md border overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Account</TableHead>
                            <TableHead className="text-right w-32">Amount</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {entries.map((e) => {
                            const amount = Math.max(parseFloat(e.debitAmount || "0"), parseFloat(e.creditAmount || "0"));
                            const bal = entryBalances[e.id];
                            return (
                              <TableRow key={e.id} data-testid={`row-entry-${e.id}`}>
                                <TableCell className="py-2">
                                  <p className="text-sm font-medium">{e.accountName || `Account #${e.ledgerAccountId}`}</p>
                                  {bal !== undefined && (
                                    <p className="text-xs text-muted-foreground">
                                      Balance: {fmt(parseFloat(bal))}
                                    </p>
                                  )}
                                </TableCell>
                                <TableCell className="text-right text-sm font-mono py-2">
                                  {fmt(amount)}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                          {entries.length > 0 && (
                            <TableRow className="border-t font-semibold bg-muted/20">
                              <TableCell className="py-2 text-sm">Total</TableCell>
                              <TableCell className="text-right text-sm font-mono py-2">
                                {fmt(grandTotal)}
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                );
              })()}

              {/* Footer actions */}
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" onClick={() => setDrawerOpen(false)} data-testid="button-detail-close">
                  Close
                </Button>
                <Button
                  variant="default"
                  onClick={() => {
                    setDrawerOpen(false);
                    openInCompany(detailData.voucher.companyId, `/daybook?voucherId=${detailData.voucher.id}`);
                  }}
                  data-testid="button-detail-edit"
                >
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-center text-muted-foreground py-8">
              Could not load voucher details.
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
