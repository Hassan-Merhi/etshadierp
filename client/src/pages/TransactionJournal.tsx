import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useCompany } from "@/contexts/CompanyContext";
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
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
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
  RefreshCw, X, FileText, Receipt, Factory, Eye, Pencil,
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

  // ── Filter state ──
  const [periodFilter,   setPeriodFilter]   = useState<PeriodFilterValue>(getDefaultPeriodValue("last_1_month"));
  const [selectedCos,    setSelectedCos]    = useState<number[]>([]);   // empty = all
  const [voucherType,    setVoucherType]    = useState("all");
  const [currency,       setCurrency]       = useState("all");
  const [optionalFilter, setOptionalFilter] = useState("active");
  const [includeFactory, setIncludeFactory] = useState(false);
  const [searchInput,    setSearchInput]    = useState("");
  const [search,         setSearch]         = useState("");
  const [page,           setPage]           = useState(1);
  const LIMIT = 50;

  // ── Detail drawer ──
  const [detailId, setDetailId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

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

  const openDetail = (id: number) => {
    setDetailId(id);
    setDrawerOpen(true);
  };

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
                  <TableHead className="w-[150px]">Voucher #</TableHead>
                  <TableHead className="w-[120px]">Type</TableHead>
                  <TableHead>Narration</TableHead>
                  <TableHead className="text-right w-[130px]">Amount</TableHead>
                  <TableHead className="w-[90px] text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 7 }).map((__, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (data?.vouchers || []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
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
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {v.voucherNumber}
                      </TableCell>
                      <TableCell>
                        <VoucherTypeBadge type={v.voucherType} />
                        {v.optional && (
                          <Badge variant="outline" className="ml-1 text-xs">Draft</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm max-w-xs truncate text-muted-foreground">
                        {v.narration || "—"}
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
                            onClick={() => window.open(`/daybook?voucherId=${v.id}`, "_blank")}
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

      {/* ── Voucher detail drawer ── */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto flex flex-col gap-4">
          {detailLoading ? (
            <div className="flex flex-col gap-3 mt-4">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}
            </div>
          ) : detailData ? (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <Receipt className="h-5 w-5 text-muted-foreground" />
                  {detailData.voucher.voucherNumber}
                </SheetTitle>
                <SheetDescription>
                  {detailData.voucher.companyName} · {fmtDate(detailData.voucher.voucherDate)}
                </SheetDescription>
              </SheetHeader>

              {/* Meta chips */}
              <div className="flex flex-wrap gap-2 items-center">
                <VoucherTypeBadge type={detailData.voucher.voucherType} />
                <Badge variant="outline" className="font-mono">{detailData.voucher.currency}</Badge>
                {detailData.voucher.optional && (
                  <Badge variant="outline">Draft / Optional</Badge>
                )}
                <span className={`text-xs font-medium px-2 py-0.5 rounded ${companyColor(detailData.voucher.companyId)}`}>
                  {detailData.voucher.companyName}
                </span>
              </div>

              {/* Amount */}
              <div className="rounded-md border px-4 py-3 bg-muted/30">
                <div className="text-xs text-muted-foreground mb-1">Total Amount</div>
                <div className="text-2xl font-semibold font-mono">
                  {detailData.voucher.currency} {parseFloat(detailData.voucher.totalAmount || "0").toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </div>
              </div>

              {/* Entries table */}
              <div>
                <div className="text-sm font-medium mb-2">Journal Entries</div>
                <div className="rounded-md border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Account</TableHead>
                        <TableHead>Narration</TableHead>
                        <TableHead className="text-right w-24">Debit</TableHead>
                        <TableHead className="text-right w-24">Credit</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detailData.entries.map((e) => (
                        <TableRow key={e.id} data-testid={`row-entry-${e.id}`}>
                          <TableCell className="text-sm font-medium">
                            {e.accountName || `Account #${e.ledgerAccountId}`}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground max-w-[180px] truncate">
                            {e.narration || "—"}
                          </TableCell>
                          <TableCell className="text-right text-sm font-mono">
                            {formatAmount(e.debitAmount)}
                          </TableCell>
                          <TableCell className="text-right text-sm font-mono">
                            {formatAmount(e.creditAmount)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Totals row */}
              {detailData.entries.length > 0 && (() => {
                const totalDr = detailData.entries.reduce((s, e) => s + parseFloat(e.debitAmount  || "0"), 0);
                const totalCr = detailData.entries.reduce((s, e) => s + parseFloat(e.creditAmount || "0"), 0);
                return (
                  <div className="flex gap-6 rounded-md border px-4 py-2 bg-muted/20 text-sm">
                    <span className="text-muted-foreground">Total Debit:</span>
                    <span className="font-mono font-medium">{totalDr.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                    <span className="text-muted-foreground ml-4">Total Credit:</span>
                    <span className="font-mono font-medium">{totalCr.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                  </div>
                );
              })()}

              {/* Actions */}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  variant="default"
                  onClick={() => openInCompany(
                    detailData.voucher.companyId,
                    `/voucher-detail/${detailData.voucher.id}`
                  )}
                  data-testid="button-open-in-company"
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open in {detailData.voucher.companyName}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => openInCompany(
                    detailData.voucher.companyId,
                    `/daybook`
                  )}
                  data-testid="button-open-daybook"
                >
                  Open Daybook
                </Button>
              </div>
            </>
          ) : (
            <div className="text-center text-muted-foreground py-8">
              Could not load voucher details.
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
