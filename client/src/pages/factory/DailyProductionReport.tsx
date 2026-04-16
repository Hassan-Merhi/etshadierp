import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ChevronDown, ChevronRight, TrendingUp, Scale, DollarSign, Beaker, Tag,
} from "lucide-react";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function lastMonthRange(): [string, string] {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth(), 0);
  return [first.toISOString().slice(0, 10), last.toISOString().slice(0, 10)];
}
function yearStart() {
  return `${new Date().getFullYear()}-01-01`;
}

function fmtMoney(n: number) {
  if (n === 0) return "$0";
  const r = Math.round(n * 100) / 100;
  if (Math.abs(r - Math.round(r)) < 0.005) return `$${Math.round(r).toLocaleString("en-US")}`;
  return `$${r.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtKg(n: number) {
  const r = Math.round(n * 10) / 10;
  return `${r.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 1 })} kg`;
}

type Preset = "today" | "month" | "lastmonth" | "year" | "custom";

interface ReportData {
  from: string | null;
  to: string | null;
  production: {
    totalBales: number;
    totalWeightKg: number;
    totalValue: number;
    byProduct: {
      articleCode: string;
      productName: string;
      categoryName: string;
      qty: number;
      totalWeightKg: number;
      sellingPricePerBale: number;
      totalValue: number;
    }[];
    byCategory: {
      categoryName: string;
      qty: number;
      totalWeightKg: number;
      totalValue: number;
    }[];
  };
  rawMaterial: {
    totalBatches: number;
    totalWeightKg: number;
    totalCost: number;
    batches: {
      id: number;
      batchCode: string;
      name: string | null;
      totalWeightKg: string;
      costPerKg: string;
      totalCost: string;
      createdAt: string;
    }[];
  };
  kgComparison: {
    producedKg: number;
    mixedKg: number;
    diffKg: number;
    diffLabel: string;
  };
}

export default function DailyProductionReport() {
  const [preset, setPreset] = useState<Preset>("today");
  const [customFrom, setCustomFrom] = useState(todayStr());
  const [customTo, setCustomTo] = useState(todayStr());
  const [productionExpanded, setProductionExpanded] = useState(false);
  const [categoryExpanded, setCategoryExpanded] = useState(true);
  const [mixExpanded, setMixExpanded] = useState(false);

  const { from, to } = useMemo(() => {
    if (preset === "today") return { from: todayStr(), to: todayStr() };
    if (preset === "month") return { from: monthStart(), to: todayStr() };
    if (preset === "lastmonth") {
      const [f, t] = lastMonthRange();
      return { from: f, to: t };
    }
    if (preset === "year") return { from: yearStart(), to: todayStr() };
    return { from: customFrom, to: customTo };
  }, [preset, customFrom, customTo]);

  const { data, isLoading } = useQuery<ReportData>({
    queryKey: ["/api/factory/production-value-report", from, to],
    queryFn: async () => {
      const res = await fetch(`/api/factory/production-value-report?from=${from}&to=${to}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: !!from && !!to,
  });

  const presets: { key: Preset; label: string }[] = [
    { key: "today", label: "Today" },
    { key: "month", label: "This Month" },
    { key: "lastmonth", label: "Last Month" },
    { key: "year", label: "This Year" },
    { key: "custom", label: "Custom" },
  ];

  const kgDiff = data?.kgComparison.diffKg ?? 0;
  const kgDiffPositive = kgDiff >= 0;

  return (
    <div className="flex flex-col h-full p-6 overflow-y-auto gap-6">
      <div>
        <h1 className="text-2xl font-bold">Daily Production Report</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Compare what was pressed vs what was mixed in any period
        </p>
      </div>

      {/* Date filter */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={preset} onValueChange={(v) => setPreset(v as Preset)}>
          <SelectTrigger className="w-40" data-testid="select-preset">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {presets.map((p) => (
              <SelectItem key={p.key} value={p.key} data-testid={`option-preset-${p.key}`}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {preset === "custom" && (
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="border rounded-md px-2 py-1 text-sm bg-background text-foreground"
              data-testid="input-custom-from"
            />
            <span className="text-muted-foreground text-sm">to</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="border rounded-md px-2 py-1 text-sm bg-background text-foreground"
              data-testid="input-custom-to"
            />
          </div>
        )}
      </div>

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card data-testid="card-total-bales">
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Bales Produced</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-24" /> : (
              <div className="text-2xl font-bold" data-testid="text-total-bales">
                {data?.production.totalBales.toLocaleString() ?? "0"}
              </div>
            )}
            {!isLoading && (
              <p className="text-xs text-muted-foreground mt-1">{fmtKg(data?.production.totalWeightKg ?? 0)}</p>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-production-value">
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Production Value</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-24" /> : (
              <div className="text-2xl font-bold" data-testid="text-production-value">
                {fmtMoney(data?.production.totalValue ?? 0)}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">at current selling prices</p>
          </CardContent>
        </Card>

        <Card data-testid="card-mix-cost">
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Raw Material Cost</CardTitle>
            <Beaker className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-24" /> : (
              <div className="text-2xl font-bold" data-testid="text-mix-cost">
                {fmtMoney(data?.rawMaterial.totalCost ?? 0)}
              </div>
            )}
            {!isLoading && (
              <p className="text-xs text-muted-foreground mt-1">
                {data?.rawMaterial.totalBatches ?? 0} mix {(data?.rawMaterial.totalBatches ?? 0) === 1 ? "batch" : "batches"} — {fmtKg(data?.rawMaterial.totalWeightKg ?? 0)}
              </p>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-kg-diff">
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Kg Difference</CardTitle>
            <Scale className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-24" /> : (
              <div className={`text-2xl font-bold ${kgDiffPositive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`} data-testid="text-kg-diff">
                {kgDiffPositive ? "+" : ""}{fmtKg(kgDiff)}
              </div>
            )}
            {!isLoading && (
              <p className="text-xs text-muted-foreground mt-1">{data?.kgComparison.diffLabel ?? ""}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Kg Comparison bar */}
      {!isLoading && data && (
        <Card data-testid="card-kg-comparison">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Kg Comparison</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground w-28 shrink-0">Produced</span>
              <div className="flex-1 bg-muted rounded-full h-4 overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all"
                  style={{ width: `${data.kgComparison.mixedKg > 0 ? Math.min(100, (data.kgComparison.producedKg / Math.max(data.kgComparison.producedKg, data.kgComparison.mixedKg)) * 100) : 100}%` }}
                />
              </div>
              <span className="text-sm font-semibold w-24 text-right shrink-0">{fmtKg(data.kgComparison.producedKg)}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground w-28 shrink-0">Mixed</span>
              <div className="flex-1 bg-muted rounded-full h-4 overflow-hidden">
                <div
                  className="h-full bg-amber-500 rounded-full transition-all"
                  style={{ width: `${data.kgComparison.producedKg > 0 ? Math.min(100, (data.kgComparison.mixedKg / Math.max(data.kgComparison.producedKg, data.kgComparison.mixedKg)) * 100) : 100}%` }}
                />
              </div>
              <span className="text-sm font-semibold w-24 text-right shrink-0">{fmtKg(data.kgComparison.mixedKg)}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Production by Category (expandable, open by default) */}
      <Card data-testid="card-category-breakdown">
        <CardHeader
          className="cursor-pointer pb-3 flex flex-row items-center justify-between gap-1"
          onClick={() => setCategoryExpanded(!categoryExpanded)}
          data-testid="button-toggle-category"
        >
          <CardTitle className="text-base flex items-center gap-2">
            {categoryExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            Production by Category
          </CardTitle>
          {!isLoading && data && (
            <Badge variant="secondary" data-testid="badge-category-count">
              {data.production.byCategory.length} categories
            </Badge>
          )}
        </CardHeader>
        {categoryExpanded && (
          <CardContent className="pt-0">
            {isLoading ? (
              <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : !data || data.production.byCategory.length === 0 ? (
              <p className="text-center text-muted-foreground py-6 text-sm" data-testid="text-no-categories">
                No bales produced in this period
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Qty (Bales)</TableHead>
                      <TableHead className="text-right">Total Weight</TableHead>
                      <TableHead className="text-right">Total Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.production.byCategory.map((row) => (
                      <TableRow key={row.categoryName} data-testid={`row-category-${row.categoryName.replace(/\s+/g, "-").toLowerCase()}`}>
                        <TableCell className="font-medium flex items-center gap-2">
                          <Tag className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          {row.categoryName}
                        </TableCell>
                        <TableCell className="text-right font-mono">{row.qty.toLocaleString()}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{fmtKg(row.totalWeightKg)}</TableCell>
                        <TableCell className="text-right font-mono font-semibold">{fmtMoney(row.totalValue)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <tfoot>
                    <tr className="border-t-2">
                      <td className="px-4 py-2 text-sm font-semibold text-muted-foreground">Totals</td>
                      <td className="px-4 py-2 text-right font-mono font-bold">{data.production.totalBales.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right font-mono font-bold text-sm">{fmtKg(data.production.totalWeightKg)}</td>
                      <td className="px-4 py-2 text-right font-mono font-bold">{fmtMoney(data.production.totalValue)}</td>
                    </tr>
                  </tfoot>
                </Table>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Production by product (expandable) */}
      <Card data-testid="card-production-breakdown">
        <CardHeader
          className="cursor-pointer pb-3 flex flex-row items-center justify-between gap-1"
          onClick={() => setProductionExpanded(!productionExpanded)}
          data-testid="button-toggle-production"
        >
          <CardTitle className="text-base flex items-center gap-2">
            {productionExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            Production by Product
          </CardTitle>
          {!isLoading && data && (
            <Badge variant="secondary" data-testid="badge-product-count">
              {data.production.byProduct.length} products
            </Badge>
          )}
        </CardHeader>
        {productionExpanded && (
          <CardContent className="pt-0">
            {isLoading ? (
              <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : !data || data.production.byProduct.length === 0 ? (
              <p className="text-center text-muted-foreground py-6 text-sm" data-testid="text-no-production">
                No bales produced in this period
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Article Code</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Qty (Bales)</TableHead>
                      <TableHead className="text-right">Total Weight</TableHead>
                      <TableHead className="text-right">Price / Bale</TableHead>
                      <TableHead className="text-right">Total Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.production.byProduct.map((row) => (
                      <TableRow key={row.articleCode} data-testid={`row-product-${row.articleCode}`}>
                        <TableCell className="font-mono text-sm">{row.articleCode}</TableCell>
                        <TableCell className="text-sm">{row.productName}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{row.categoryName}</TableCell>
                        <TableCell className="text-right font-mono">{row.qty.toLocaleString()}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{fmtKg(row.totalWeightKg)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{fmtMoney(row.sellingPricePerBale)}</TableCell>
                        <TableCell className="text-right font-mono font-semibold">{fmtMoney(row.totalValue)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <tfoot>
                    <tr className="border-t-2">
                      <td colSpan={3} className="px-4 py-2 text-sm font-semibold text-muted-foreground">Totals</td>
                      <td className="px-4 py-2 text-right font-mono font-bold">{data.production.totalBales.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right font-mono font-bold text-sm">{fmtKg(data.production.totalWeightKg)}</td>
                      <td />
                      <td className="px-4 py-2 text-right font-mono font-bold">{fmtMoney(data.production.totalValue)}</td>
                    </tr>
                  </tfoot>
                </Table>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Mix batches (expandable) */}
      <Card data-testid="card-mix-breakdown">
        <CardHeader
          className="cursor-pointer pb-3 flex flex-row items-center justify-between gap-1"
          onClick={() => setMixExpanded(!mixExpanded)}
          data-testid="button-toggle-mix"
        >
          <CardTitle className="text-base flex items-center gap-2">
            {mixExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            Raw Material Mix Batches
          </CardTitle>
          {!isLoading && data && (
            <Badge variant="secondary" data-testid="badge-batch-count">
              {data.rawMaterial.totalBatches} batches
            </Badge>
          )}
        </CardHeader>
        {mixExpanded && (
          <CardContent className="pt-0">
            {isLoading ? (
              <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : !data || data.rawMaterial.batches.length === 0 ? (
              <p className="text-center text-muted-foreground py-6 text-sm" data-testid="text-no-batches">
                No mix batches created in this period
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Batch Code</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead className="text-right">Weight (kg)</TableHead>
                      <TableHead className="text-right">Cost / kg</TableHead>
                      <TableHead className="text-right">Total Cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rawMaterial.batches.map((b) => (
                      <TableRow key={b.id} data-testid={`row-batch-${b.id}`}>
                        <TableCell className="font-mono text-sm">{b.batchCode}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{b.name || "—"}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{fmtKg(parseFloat(b.totalWeightKg))}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{fmtMoney(parseFloat(b.costPerKg))}</TableCell>
                        <TableCell className="text-right font-mono font-semibold">{fmtMoney(parseFloat(b.totalCost))}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <tfoot>
                    <tr className="border-t-2">
                      <td colSpan={2} className="px-4 py-2 text-sm font-semibold text-muted-foreground">Totals</td>
                      <td className="px-4 py-2 text-right font-mono font-bold">{fmtKg(data.rawMaterial.totalWeightKg)}</td>
                      <td />
                      <td className="px-4 py-2 text-right font-mono font-bold">{fmtMoney(data.rawMaterial.totalCost)}</td>
                    </tr>
                  </tfoot>
                </Table>
              </div>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
