import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ArrowLeft, Building2, ChevronDown, TrendingUp, TrendingDown } from "lucide-react";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { useCompany } from "@/contexts/CompanyContext";

interface SalesItem {
  stockItemId: number;
  stockItemName: string;
  stockGroupName: string | null;
  quantity: string;
  totalSales: string;
  costProfit: string;
  configuredProfit: number;
  configuredProfitPercentage: number;
  costProfitPercentage: number;
  totalConfiguredCost: number;
  companyId: number;
  companyCode: string;
  companyName: string;
}

interface ItemRow {
  stockItemId: number;
  stockItemName: string;
  stockGroupName: string;
  byCompany: Record<string, {
    totalSales: number;
    totalQty: number;
    configuredProfit: number;
    configuredProfitPct: number;
    costProfitPct: number;
  }>;
}

type ViewFilter = "all" | "gaining" | "losing";

export default function SalesReportComparison() {
  const [, navigate] = useLocation();
  const { formatAmount } = useCurrencyContext();
  const { companies: allCompanies } = useCompany();

  const today = new Date().toLocaleDateString("en-CA");
  const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    .toLocaleDateString("en-CA");

  const [startDate, setStartDate] = useState(firstOfMonth);
  const [endDate, setEndDate] = useState(today);
  const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
  const [stockGroupFilter, setStockGroupFilter] = useState("all");
  const [viewFilter, setViewFilter] = useState<ViewFilter>("all");
  const [search, setSearch] = useState("");
  const [companyPopoverOpen, setCompanyPopoverOpen] = useState(false);

  const toggleCompany = (code: string) => {
    setSelectedCodes(prev =>
      prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]
    );
  };

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (startDate) p.set("startDate", startDate);
    if (endDate) p.set("endDate", endDate);
    if (selectedCodes.length > 0) p.set("companyFilter", selectedCodes.join(","));
    return p.toString();
  }, [startDate, endDate, selectedCodes]);

  const enabled = selectedCodes.length >= 2;

  const { data: rawItems = [], isFetching, isLoading } = useQuery<SalesItem[]>({
    queryKey: ["/api/dashboard/sales-report-all", queryString],
    enabled,
  });

  const { data: stockGroups = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/stock-groups"],
  });

  const displayCompanies = useMemo(() =>
    allCompanies.filter(c => selectedCodes.includes(c.code)),
    [allCompanies, selectedCodes]
  );

  const tableData = useMemo((): ItemRow[] => {
    const map = new Map<number, ItemRow>();

    for (const item of rawItems) {
      if (!item.stockItemId) continue;

      if (stockGroupFilter !== "all" && item.stockGroupName !== stockGroupFilter) continue;

      if (!map.has(item.stockItemId)) {
        map.set(item.stockItemId, {
          stockItemId: item.stockItemId,
          stockItemName: item.stockItemName,
          stockGroupName: item.stockGroupName || "",
          byCompany: {},
        });
      }

      const row = map.get(item.stockItemId)!;
      const code = item.companyCode;

      if (!row.byCompany[code]) {
        row.byCompany[code] = {
          totalSales: 0,
          totalQty: 0,
          configuredProfit: 0,
          configuredProfitPct: 0,
          costProfitPct: 0,
        };
      }

      const entry = row.byCompany[code];
      entry.totalSales += parseFloat(item.totalSales || "0");
      entry.totalQty += parseFloat(item.quantity || "0");
      entry.configuredProfit += item.configuredProfit || 0;
      entry.configuredProfitPct = item.configuredProfitPercentage || 0;
      entry.costProfitPct = item.costProfitPercentage || 0;
    }

    let rows = Array.from(map.values());

    if (viewFilter === "gaining") {
      rows = rows.filter(r =>
        displayCompanies.some(c => (r.byCompany[c.code]?.configuredProfit ?? 0) > 0)
      );
    } else if (viewFilter === "losing") {
      rows = rows.filter(r =>
        displayCompanies.some(c => (r.byCompany[c.code]?.configuredProfit ?? 0) < 0)
      );
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(r =>
        r.stockItemName.toLowerCase().includes(q) ||
        r.stockGroupName.toLowerCase().includes(q)
      );
    }

    rows.sort((a, b) => a.stockItemName.localeCompare(b.stockItemName));
    return rows;
  }, [rawItems, stockGroupFilter, viewFilter, search, displayCompanies]);

  const fmt = (n: number) => formatAmount(n);

  const profitBadge = (profit: number, pct: number) => {
    if (profit > 0) return (
      <span className="flex items-center gap-1 text-green-600 dark:text-green-400 font-mono text-xs">
        <TrendingUp className="h-3 w-3" />
        {fmt(profit)}
        <span className="text-muted-foreground">({pct.toFixed(1)}%)</span>
      </span>
    );
    if (profit < 0) return (
      <span className="flex items-center gap-1 text-destructive font-mono text-xs">
        <TrendingDown className="h-3 w-3" />
        {fmt(profit)}
        <span className="text-muted-foreground">({pct.toFixed(1)}%)</span>
      </span>
    );
    return <span className="text-muted-foreground text-xs">—</span>;
  };

  const summaryForCompany = (code: string) => {
    let totalSales = 0, totalProfit = 0;
    for (const row of tableData) {
      const entry = row.byCompany[code];
      if (entry) {
        totalSales += entry.totalSales;
        totalProfit += entry.configuredProfit;
      }
    }
    return { totalSales, totalProfit };
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b px-6 py-4 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/sales-report")} data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Company Comparison</h1>
            <p className="text-sm text-muted-foreground">Compare sales performance across companies</p>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Date range */}
          <div className="flex items-center gap-1">
            <Input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="w-36 h-9 text-sm"
              data-testid="input-start-date"
            />
            <span className="text-muted-foreground text-sm">–</span>
            <Input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="w-36 h-9 text-sm"
              data-testid="input-end-date"
            />
          </div>

          {/* Company selector */}
          <Popover open={companyPopoverOpen} onOpenChange={setCompanyPopoverOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className="gap-2" data-testid="button-company-select">
                <Building2 className="h-4 w-4" />
                {selectedCodes.length === 0
                  ? "Select Companies"
                  : `${selectedCodes.length} Selected`}
                <ChevronDown className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-2" align="end">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-2 pb-2">
                Select 2 or more companies
              </p>
              <div className="space-y-1">
                {allCompanies.map(c => (
                  <div
                    key={c.code}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover-elevate"
                    onClick={() => toggleCompany(c.code)}
                    data-testid={`option-company-${c.code}`}
                  >
                    <Checkbox checked={selectedCodes.includes(c.code)} className="h-4 w-4" />
                    <span className="text-sm">{c.name}</span>
                    <span className="text-xs text-muted-foreground ml-auto">{c.code}</span>
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          {/* Stock group */}
          <Select value={stockGroupFilter} onValueChange={setStockGroupFilter} data-testid="select-stock-group">
            <SelectTrigger className="w-44 h-9">
              <SelectValue placeholder="All Groups" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Groups</SelectItem>
              {stockGroups.map(g => (
                <SelectItem key={g.id} value={g.name}>{g.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* View filter */}
          <div className="flex rounded-md border overflow-hidden">
            {(["all", "gaining", "losing"] as ViewFilter[]).map(v => (
              <button
                key={v}
                onClick={() => setViewFilter(v)}
                className={`px-3 h-9 text-sm capitalize transition-colors ${
                  viewFilter === v
                    ? "bg-primary text-primary-foreground"
                    : "bg-background hover:bg-muted"
                }`}
                data-testid={`filter-${v}`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {!enabled ? (
          <div className="flex flex-col items-center justify-center h-64 text-center text-muted-foreground gap-3">
            <Building2 className="h-10 w-10 opacity-30" />
            <p className="text-base font-medium">Select at least 2 companies to compare</p>
            <p className="text-sm">Use the "Select Companies" button above</p>
          </div>
        ) : (
          <>
            {/* Summary cards per company */}
            <div className="flex flex-wrap gap-3 mb-6">
              {displayCompanies.map(c => {
                const { totalSales, totalProfit } = summaryForCompany(c.code);
                return (
                  <Card key={c.code} className="flex-1 min-w-44">
                    <CardContent className="p-4">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{c.name}</p>
                      <p className="font-mono text-lg font-bold">{fmt(totalSales)}</p>
                      <p className={`font-mono text-sm ${totalProfit >= 0 ? "text-green-600 dark:text-green-400" : "text-destructive"}`}>
                        {totalProfit >= 0 ? "+" : ""}{fmt(totalProfit)}
                      </p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Search */}
            <div className="mb-4">
              <Input
                placeholder="Search items..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="max-w-72"
                data-testid="input-search"
              />
            </div>

            {isFetching && !isLoading && (
              <div className="h-0.5 w-full bg-muted overflow-hidden mb-3 rounded-full">
                <div className="h-full bg-primary w-1/2 rounded-full animate-pulse" />
              </div>
            )}
            {isLoading ? (
              <div className="text-center py-16 text-muted-foreground">Loading comparison data…</div>
            ) : tableData.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">No data found for the selected filters</div>
            ) : (
              <div className="rounded-md border overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[200px] sticky left-0 bg-background z-10">Item</TableHead>
                      <TableHead className="w-36">Group</TableHead>
                      {displayCompanies.map(c => (
                        <TableHead key={c.code} colSpan={3} className="text-center border-l">
                          {c.name}
                        </TableHead>
                      ))}
                    </TableRow>
                    <TableRow className="text-xs text-muted-foreground">
                      <TableHead className="sticky left-0 bg-background z-10" />
                      <TableHead />
                      {displayCompanies.map(c => (
                        <>
                          <TableHead key={`${c.code}-sales`} className="border-l font-normal">Sales</TableHead>
                          <TableHead key={`${c.code}-qty`} className="font-normal">Qty</TableHead>
                          <TableHead key={`${c.code}-profit`} className="font-normal">Profit</TableHead>
                        </>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tableData.map(row => (
                      <TableRow key={row.stockItemId} data-testid={`row-item-${row.stockItemId}`}>
                        <TableCell className="font-medium sticky left-0 bg-background z-10">
                          {row.stockItemName}
                        </TableCell>
                        <TableCell>
                          {row.stockGroupName ? (
                            <Badge variant="secondary" className="text-xs">{row.stockGroupName}</Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                        {displayCompanies.map(c => {
                          const entry = row.byCompany[c.code];
                          if (!entry) return (
                            <>
                              <TableCell key={`${c.code}-s`} className="border-l text-muted-foreground text-center">—</TableCell>
                              <TableCell key={`${c.code}-q`} className="text-muted-foreground text-center">—</TableCell>
                              <TableCell key={`${c.code}-p`} className="text-muted-foreground text-center">—</TableCell>
                            </>
                          );
                          return (
                            <>
                              <TableCell key={`${c.code}-s`} className="border-l font-mono text-sm">
                                {fmt(entry.totalSales)}
                              </TableCell>
                              <TableCell key={`${c.code}-q`} className="font-mono text-sm text-muted-foreground">
                                {entry.totalQty % 1 === 0
                                  ? entry.totalQty.toFixed(0)
                                  : entry.totalQty.toFixed(2)}
                              </TableCell>
                              <TableCell key={`${c.code}-p`}>
                                {profitBadge(entry.configuredProfit, entry.configuredProfitPct)}
                              </TableCell>
                            </>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
