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
  ChevronDown, ChevronRight, FlaskConical, PackageCheck, Trash2, Scale,
  TrendingUp, TrendingDown, Minus,
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
function fmtRate(n: number) {
  return `$${(Math.round(n * 1000) / 1000).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`;
}
function fmtKg(n: number) {
  const r = Math.round(n * 10) / 10;
  return `${r.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} K`;
}

type Preset = "today" | "month" | "lastmonth" | "year" | "custom";

interface ReportData {
  from: string | null;
  to: string | null;
  summary: {
    batchCost: number;
    productionValue: number;
    statusValue: number;
  };
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
  wipersGarbage: {
    totalWipersQty: number;
    totalWipersKg: number;
    totalGarbageQty: number;
    totalGarbageKg: number;
    totalWeightKg: number;
    totalValue: number;
    rows: {
      categoryName: string;
      subType: "wiper" | "garbage" | "other";
      qty: number;
      totalWeightKg: number;
      totalValue: number;
    }[];
  };
  rawMaterial: {
    totalBatches: number;
    totalWeightKg: number;
    totalCost: number;
    blendedCostPerKg: number;
    batches: {
      id: number;
      batchCode: string;
      name: string | null;
      totalWeightKg: string;
      costPerKg: string;
      totalCost: string;
      batchDate: string | null;
      createdAt: string;
    }[];
  };
  balanceOnTable: {
    weightKg: number;
    costPerKg: number;
    value: number;
  };
  kgComparison: {
    producedKg: number;
    mixedKg: number;
    diffKg: number;
    diffLabel: string;
  };
}

function StatRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="text-right">
        <div className="text-sm font-bold">{value}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </div>
    </div>
  );
}

function ExpandableSection({
  title, badge, icon: Icon, children, defaultOpen = false,
}: {
  title: string;
  badge?: string;
  icon: React.ElementType;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mt-3">
      <button
        className="flex items-center gap-2 w-full text-left py-1"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{title}</span>
        {badge && (
          <Badge variant="secondary" className="ml-auto text-xs">
            {badge}
          </Badge>
        )}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

function SkeletonBox() {
  return (
    <div className="space-y-2 p-4">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-6 w-32" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}

export default function DailyProductionReport() {
  const [preset, setPreset] = useState<Preset>("today");
  const [customFrom, setCustomFrom] = useState(todayStr());
  const [customTo, setCustomTo] = useState(todayStr());

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

  const statusValue = data?.summary.statusValue ?? 0;
  const statusPositive = statusValue >= 0;

  return (
    <div className="flex flex-col h-full p-4 overflow-y-auto gap-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold">Production Report</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Raw material vs output summary
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

      {/* ── Top Summary Bar ── */}
      <Card data-testid="card-summary-bar">
        <CardContent className="py-3 px-4">
          {isLoading ? (
            <div className="flex gap-6 flex-wrap">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-5 w-40" />
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Batch Cost</span>
                <span className="text-base font-bold" data-testid="text-batch-cost">
                  {fmtMoney(data?.summary.batchCost ?? 0)}
                </span>
              </div>
              <div className="w-px h-5 bg-border" />
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Production Value</span>
                <span className="text-base font-bold text-blue-600 dark:text-blue-400" data-testid="text-production-value">
                  {fmtMoney(data?.summary.productionValue ?? 0)}
                </span>
              </div>
              <div className="w-px h-5 bg-border" />
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</span>
                <span
                  className={`text-base font-bold px-3 py-0.5 rounded-md ${
                    statusPositive
                      ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                      : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                  }`}
                  data-testid="text-status-value"
                >
                  {statusPositive ? "+" : ""}{fmtMoney(statusValue)}
                </span>
                {statusPositive
                  ? <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" />
                  : statusValue === 0
                    ? <Minus className="h-4 w-4 text-muted-foreground" />
                    : <TrendingDown className="h-4 w-4 text-red-600 dark:text-red-400" />}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Four colored boxes ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">

        {/* 1 — Original Batches (amber/gold tones) */}
        <Card
          className="border-amber-200 dark:border-amber-800/50 bg-amber-50/60 dark:bg-amber-950/20"
          data-testid="card-original-batches"
        >
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
              <FlaskConical className="h-3.5 w-3.5" />
              Original Batches
            </CardTitle>
            {!isLoading && data && (
              <Badge variant="secondary" className="text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
                {data.rawMaterial.totalBatches} {data.rawMaterial.totalBatches === 1 ? "batch" : "batches"}
              </Badge>
            )}
          </CardHeader>
          <CardContent className="pt-0 space-y-0.5">
            {isLoading ? <SkeletonBox /> : (
              <>
                <StatRow
                  label="Weight"
                  value={fmtKg(data?.rawMaterial.totalWeightKg ?? 0)}
                />
                <StatRow
                  label="Batch Rate"
                  value={fmtRate(data?.rawMaterial.blendedCostPerKg ?? 0)}
                  sub="per kg"
                />
                <StatRow
                  label="Value"
                  value={fmtMoney(data?.rawMaterial.totalCost ?? 0)}
                />
                <ExpandableSection title="Mix Batches" icon={FlaskConical} badge={String(data?.rawMaterial.batches.length ?? 0)}>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Code</TableHead>
                          <TableHead className="text-xs text-right">Kg</TableHead>
                          <TableHead className="text-xs text-right">Cost</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(data?.rawMaterial.batches ?? []).map((b) => (
                          <TableRow key={b.id} data-testid={`row-batch-${b.id}`}>
                            <TableCell className="text-xs font-mono py-1">{b.batchCode}</TableCell>
                            <TableCell className="text-xs text-right font-mono py-1">{fmtKg(parseFloat(b.totalWeightKg))}</TableCell>
                            <TableCell className="text-xs text-right font-mono py-1">{fmtMoney(parseFloat(b.totalCost))}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </ExpandableSection>
              </>
            )}
          </CardContent>
        </Card>

        {/* 2 — Bales Produced (blue/indigo tones) */}
        <Card
          className="border-blue-200 dark:border-blue-800/50 bg-blue-50/60 dark:bg-blue-950/20"
          data-testid="card-bales-produced"
        >
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-wide text-blue-700 dark:text-blue-400 flex items-center gap-1.5">
              <PackageCheck className="h-3.5 w-3.5" />
              Bales Produced
            </CardTitle>
            {!isLoading && data && (
              <Badge variant="secondary" className="text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
                QNTY
              </Badge>
            )}
          </CardHeader>
          <CardContent className="pt-0 space-y-0.5">
            {isLoading ? <SkeletonBox /> : (
              <>
                <StatRow
                  label="# Bales"
                  value={String(data?.production.totalBales ?? 0)}
                />
                <StatRow
                  label="Weight"
                  value={fmtKg(data?.production.totalWeightKg ?? 0)}
                />
                <StatRow
                  label="Value"
                  value={fmtMoney(data?.production.totalValue ?? 0)}
                />
                <ExpandableSection title="By Category" icon={PackageCheck} badge={String(data?.production.byCategory.length ?? 0)} defaultOpen>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Category</TableHead>
                          <TableHead className="text-xs text-right">Qty</TableHead>
                          <TableHead className="text-xs text-right">Kg</TableHead>
                          <TableHead className="text-xs text-right">Value</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(data?.production.byCategory ?? []).map((row) => (
                          <TableRow key={row.categoryName} data-testid={`row-category-${row.categoryName.replace(/\s+/g, "-").toLowerCase()}`}>
                            <TableCell className="text-xs py-1">{row.categoryName}</TableCell>
                            <TableCell className="text-xs text-right font-mono py-1">{row.qty}</TableCell>
                            <TableCell className="text-xs text-right font-mono py-1">{fmtKg(row.totalWeightKg)}</TableCell>
                            <TableCell className="text-xs text-right font-mono py-1">{fmtMoney(row.totalValue)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </ExpandableSection>
                <ExpandableSection title="By Product" icon={PackageCheck} badge={String(data?.production.byProduct.length ?? 0)}>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Code</TableHead>
                          <TableHead className="text-xs">Product</TableHead>
                          <TableHead className="text-xs text-right">Qty</TableHead>
                          <TableHead className="text-xs text-right">Value</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(data?.production.byProduct ?? []).map((row) => (
                          <TableRow key={row.articleCode} data-testid={`row-product-${row.articleCode}`}>
                            <TableCell className="text-xs font-mono py-1">{row.articleCode}</TableCell>
                            <TableCell className="text-xs py-1 max-w-[80px] truncate">{row.productName}</TableCell>
                            <TableCell className="text-xs text-right font-mono py-1">{row.qty}</TableCell>
                            <TableCell className="text-xs text-right font-mono py-1">{fmtMoney(row.totalValue)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </ExpandableSection>
              </>
            )}
          </CardContent>
        </Card>

        {/* 3 — Wipers & Garbage (rose/pink tones) */}
        <Card
          className="border-rose-200 dark:border-rose-800/50 bg-rose-50/60 dark:bg-rose-950/20"
          data-testid="card-wipers-garbage"
        >
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-wide text-rose-700 dark:text-rose-400 flex items-center gap-1.5">
              <Trash2 className="h-3.5 w-3.5" />
              Wipers &amp; Garbage
            </CardTitle>
            {!isLoading && data && (
              <Badge variant="secondary" className="text-xs bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300">
                QNTY
              </Badge>
            )}
          </CardHeader>
          <CardContent className="pt-0 space-y-0.5">
            {isLoading ? <SkeletonBox /> : (
              <>
                <div className="flex items-center justify-between py-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Wipers</span>
                  <span className="text-sm font-bold text-right">
                    {data?.wipersGarbage.totalWipersQty ?? 0}
                    <span className="text-xs font-normal text-muted-foreground ml-1">{fmtKg(data?.wipersGarbage.totalWipersKg ?? 0)}</span>
                  </span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Garbage</span>
                  <span className="text-sm font-bold text-right">
                    {data?.wipersGarbage.totalGarbageQty ?? 0}
                    <span className="text-xs font-normal text-muted-foreground ml-1">{fmtKg(data?.wipersGarbage.totalGarbageKg ?? 0)}</span>
                  </span>
                </div>
                <StatRow
                  label="Value"
                  value={fmtMoney(data?.wipersGarbage.totalValue ?? 0)}
                />
                {(data?.wipersGarbage.rows ?? []).length > 0 && (
                  <ExpandableSection title="Breakdown" icon={Trash2} badge={String(data?.wipersGarbage.rows.length ?? 0)}>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Category</TableHead>
                            <TableHead className="text-xs text-right">Qty</TableHead>
                            <TableHead className="text-xs text-right">Kg</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(data?.wipersGarbage.rows ?? []).map((row) => (
                            <TableRow key={row.categoryName}>
                              <TableCell className="text-xs py-1">{row.categoryName}</TableCell>
                              <TableCell className="text-xs text-right font-mono py-1">{row.qty}</TableCell>
                              <TableCell className="text-xs text-right font-mono py-1">{fmtKg(row.totalWeightKg)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </ExpandableSection>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* 4 — Balance on Table (violet/purple tones) */}
        <Card
          className="border-violet-200 dark:border-violet-800/50 bg-violet-50/60 dark:bg-violet-950/20"
          data-testid="card-balance-on-table"
        >
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-wide text-violet-700 dark:text-violet-400 flex items-center gap-1.5">
              <Scale className="h-3.5 w-3.5" />
              Balance on Table
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-0.5">
            {isLoading ? <SkeletonBox /> : (
              <>
                <StatRow
                  label="Weight"
                  value={fmtKg(data?.balanceOnTable.weightKg ?? 0)}
                />
                <StatRow
                  label="Batch Rate"
                  value={fmtRate(data?.balanceOnTable.costPerKg ?? 0)}
                  sub="per kg"
                />
                <StatRow
                  label="Value"
                  value={fmtMoney(data?.balanceOnTable.value ?? 0)}
                />
                {/* Mini breakdown: how balance is derived */}
                <div className="mt-3 pt-2 border-t border-violet-200 dark:border-violet-800/40 space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Original input</span>
                    <span className="font-mono">{fmtKg(data?.rawMaterial.totalWeightKg ?? 0)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>− Bales produced</span>
                    <span className="font-mono">{fmtKg(data?.production.totalWeightKg ?? 0)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>− Wipers/Garbage</span>
                    <span className="font-mono">{fmtKg(data?.wipersGarbage.totalWeightKg ?? 0)}</span>
                  </div>
                  <div className="flex justify-between text-xs font-semibold text-violet-700 dark:text-violet-300 pt-1 border-t border-violet-200 dark:border-violet-800/40">
                    <span>= Balance</span>
                    <span className="font-mono">{fmtKg(data?.balanceOnTable.weightKg ?? 0)}</span>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
