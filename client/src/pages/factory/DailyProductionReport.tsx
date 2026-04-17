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
  ChevronDown, ChevronRight, FlaskConical, PackageCheck, Scale,
  TrendingUp, TrendingDown, Minus, Tag, Trash2,
} from "lucide-react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";

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
  return `${r.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 1 })} kg`;
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

function SkeletonBox() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-6 w-32" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}

function ExpandableCard({
  title,
  badge,
  icon: Icon,
  children,
  testId,
}: {
  title: string;
  badge?: string;
  icon: React.ElementType;
  children: React.ReactNode;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card data-testid={testId}>
      <CardHeader
        className="cursor-pointer py-3 px-4 flex flex-row items-center justify-between gap-2"
        onClick={() => setOpen(!open)}
      >
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          {open
            ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
            : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          <Icon className="h-4 w-4 text-muted-foreground" />
          {title}
        </CardTitle>
        {badge !== undefined && (
          <Badge variant="secondary" className="text-xs">
            {badge}
          </Badge>
        )}
      </CardHeader>
      {open && (
        <CardContent className="pt-0 px-4 pb-4">
          {children}
        </CardContent>
      )}
    </Card>
  );
}

function CategoryProductBreakdown({
  categories,
  products,
  totalBales,
  totalWeightKg,
  totalValue,
}: {
  categories: { categoryName: string; qty: number; totalWeightKg: number; totalValue: number }[];
  products: { articleCode: string; productName: string; categoryName: string; qty: number; totalWeightKg: number; sellingPricePerBale: number; totalValue: number }[];
  totalBales: number;
  totalWeightKg: number;
  totalValue: number;
}) {
  const [openCats, setOpenCats] = useState<Set<string>>(new Set());

  function toggle(cat: string) {
    setOpenCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  const productsByCategory = useMemo(() => {
    const map = new Map<string, typeof products>();
    for (const p of products) {
      const key = p.categoryName;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return map;
  }, [products]);

  return (
    <div className="space-y-1">
      {/* Header row */}
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 px-2 pb-1 border-b">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Category</span>
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right w-16">Qty</span>
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right w-24">Weight</span>
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right w-24">Value</span>
      </div>

      {categories.map((cat) => {
        const isOpen = openCats.has(cat.categoryName);
        const catProducts = productsByCategory.get(cat.categoryName) ?? [];
        return (
          <div key={cat.categoryName} data-testid={`section-category-${cat.categoryName.replace(/\s+/g, "-").toLowerCase()}`}>
            {/* Category row — clickable */}
            <button
              className="w-full grid grid-cols-[1fr_auto_auto_auto] gap-x-4 px-2 py-2 rounded-md hover-elevate text-left items-center"
              onClick={() => toggle(cat.categoryName)}
            >
              <span className="flex items-center gap-1.5 font-medium text-sm">
                {isOpen
                  ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                <Tag className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                {cat.categoryName}
                <Badge variant="secondary" className="text-xs ml-1 no-default-active-elevate">
                  {catProducts.length} products
                </Badge>
              </span>
              <span className="text-sm font-mono text-right w-16">{cat.qty.toLocaleString()}</span>
              <span className="text-sm font-mono text-right w-24">{fmtKg(cat.totalWeightKg)}</span>
              <span className="text-sm font-mono font-semibold text-right w-24">{fmtMoney(cat.totalValue)}</span>
            </button>

            {/* Products sub-table */}
            {isOpen && catProducts.length > 0 && (
              <div className="ml-6 mb-2 overflow-x-auto border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Article Code</TableHead>
                      <TableHead className="text-xs">Product</TableHead>
                      <TableHead className="text-xs text-right">Qty</TableHead>
                      <TableHead className="text-xs text-right">Weight</TableHead>
                      <TableHead className="text-xs text-right">Price / Bale</TableHead>
                      <TableHead className="text-xs text-right">Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {catProducts.map((p) => (
                      <TableRow key={p.articleCode} data-testid={`row-product-${p.articleCode}`}>
                        <TableCell className="text-xs font-mono py-1.5">{p.articleCode}</TableCell>
                        <TableCell className="text-xs py-1.5">{p.productName}</TableCell>
                        <TableCell className="text-xs text-right font-mono py-1.5">{p.qty.toLocaleString()}</TableCell>
                        <TableCell className="text-xs text-right font-mono py-1.5">{fmtKg(p.totalWeightKg)}</TableCell>
                        <TableCell className="text-xs text-right font-mono py-1.5">{fmtMoney(p.sellingPricePerBale)}</TableCell>
                        <TableCell className="text-xs text-right font-mono font-semibold py-1.5">{fmtMoney(p.totalValue)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        );
      })}

      {/* Totals footer */}
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 px-2 pt-2 border-t">
        <span className="text-sm font-semibold text-muted-foreground">Totals</span>
        <span className="text-sm font-mono font-bold text-right w-16">{totalBales.toLocaleString()}</span>
        <span className="text-sm font-mono font-bold text-right w-24">{fmtKg(totalWeightKg)}</span>
        <span className="text-sm font-mono font-bold text-right w-24">{fmtMoney(totalValue)}</span>
      </div>
    </div>
  );
}

const PIE_COLORS = [
  "#6366f1", // indigo   — Summer
  "#22d3ee", // cyan     — Summer (Crème group)
  "#f59e0b", // amber    — Winter
  "#a78bfa", // violet   — Winter (Crème group)
  "#34d399", // emerald  — Bags
  "#fb923c", // orange   — Shoes
  "#f472b6", // pink     — Toys
  "#64748b", // slate    — Wipers/Garbage
  "#94a3b8", // gray     — Other
];

const GROUP_ORDER = ["Summer 1–4", "Summer Crème / Big Size", "Winter 1–4", "Winter Crème", "Bags", "Shoes", "Toys", "Wipers & Garbage", "Other"];

function classifyCategory(name: string): string {
  const u = name.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/ABO\s*SAMAR/.test(u)) return "__skip__";
  if (/CREME|CRÈME|BIG\s*SIZE/.test(u)) {
    if (/SUMMER/.test(u)) return "Summer Crème / Big Size";
    if (/WINTER/.test(u)) return "Winter Crème";
    return "Summer Crème / Big Size";
  }
  if (/SUMMER/.test(u)) return "Summer 1–4";
  if (/WINTER/.test(u)) return "Winter 1–4";
  if (/BAG/.test(u)) return "Bags";
  if (/SHOE/.test(u)) return "Shoes";
  if (/TOY/.test(u)) return "Toys";
  return "Other";
}

function CategoryPieChart({
  byCategory,
  wipersGarbageKg,
}: {
  byCategory: { categoryName: string; totalWeightKg: number }[];
  wipersGarbageKg: number;
}) {
  const grouped = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const cat of byCategory) {
      const group = classifyCategory(cat.categoryName);
      if (group === "__skip__") continue;
      acc[group] = (acc[group] ?? 0) + cat.totalWeightKg;
    }
    if (wipersGarbageKg > 0) {
      acc["Wipers & Garbage"] = (acc["Wipers & Garbage"] ?? 0) + wipersGarbageKg;
    }
    return acc;
  }, [byCategory, wipersGarbageKg]);

  const slices = GROUP_ORDER
    .filter((g) => (grouped[g] ?? 0) > 0)
    .map((g, i) => ({ name: g, value: grouped[g] ?? 0, color: PIE_COLORS[GROUP_ORDER.indexOf(g) % PIE_COLORS.length] }));

  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total === 0) return null;

  return (
    <Card data-testid="card-category-pie">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
          <Tag className="h-3.5 w-3.5" />
          Production by Group (kg)
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="flex flex-col sm:flex-row items-center gap-4">
          {/* Legend on the left */}
          <div className="flex flex-col gap-1.5 min-w-[200px] w-full sm:w-auto">
            {slices.map((s) => {
              const pct = ((s.value / total) * 100).toFixed(1);
              return (
                <div key={s.name} className="flex items-center gap-2">
                  <span className="inline-block rounded-sm flex-shrink-0" style={{ width: 12, height: 12, background: s.color }} />
                  <span className="text-xs text-muted-foreground flex-1 truncate">{s.name}</span>
                  <span className="text-xs font-bold tabular-nums ml-1">{pct}%</span>
                  <span className="text-xs text-muted-foreground tabular-nums w-20 text-right">
                    {Math.round(s.value).toLocaleString()} kg
                  </span>
                </div>
              );
            })}
          </div>

          {/* Pie on the right */}
          <div className="flex-1 flex justify-center items-center" style={{ minHeight: 220, minWidth: 220 }}>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={slices}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={105}
                  paddingAngle={2}
                  dataKey="value"
                  strokeWidth={0}
                >
                  {slices.map((s) => (
                    <Cell key={s.name} fill={s.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v: number) => [`${Math.round(v).toLocaleString()} kg`, ""]}
                  contentStyle={{ fontSize: 12, borderRadius: 6 }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </CardContent>
    </Card>
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
        <p className="text-xs text-muted-foreground mt-0.5">Raw material vs output summary</p>
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
            <div className="flex flex-col gap-2">
              {/* Row 1 — money summary */}
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

              {/* Row 2 — weight breakdown */}
              {(() => {
                const origKg = data?.rawMaterial.totalWeightKg ?? 0;
                const productionsKg = (data?.production.totalWeightKg ?? 0) + (data?.wipersGarbage.totalWeightKg ?? 0);
                const balanceKg = origKg - productionsKg;
                const isPositive = balanceKg >= 0;
                return (
                  <div className="flex flex-wrap items-center gap-5 pt-2 border-t border-border">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-muted-foreground">Original Batches</span>
                      <span className="text-base font-bold" data-testid="text-weight-batches">
                        {fmtKg(origKg)}
                      </span>
                    </div>
                    <span className="text-muted-foreground text-base font-semibold">&#8722;</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-muted-foreground">Productions</span>
                      <span className="text-base font-bold" data-testid="text-weight-productions">
                        {fmtKg(productionsKg)}
                      </span>
                    </div>
                    <span className="text-muted-foreground text-base font-semibold">=</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-muted-foreground">Total</span>
                      <span
                        className={`text-base font-bold ${isPositive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                        data-testid="text-weight-total"
                      >
                        {fmtKg(balanceKg)}
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Four colored boxes ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">

        {/* 1 — Original Batches */}
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
              <Badge variant="secondary" className="text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 no-default-active-elevate">
                {data.rawMaterial.totalBatches} {data.rawMaterial.totalBatches === 1 ? "batch" : "batches"}
              </Badge>
            )}
          </CardHeader>
          <CardContent className="pt-0 space-y-0.5">
            {isLoading ? <SkeletonBox /> : (
              <>
                <StatRow label="Weight" value={fmtKg(data?.rawMaterial.totalWeightKg ?? 0)} />
                <StatRow label="Batch Rate" value={fmtRate(data?.rawMaterial.blendedCostPerKg ?? 0)} sub="per kg" />
                <StatRow label="Value" value={fmtMoney(data?.rawMaterial.totalCost ?? 0)} />
              </>
            )}
          </CardContent>
        </Card>

        {/* 2 — Bales Produced */}
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
              <Badge variant="secondary" className="text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 no-default-active-elevate">
                QNTY
              </Badge>
            )}
          </CardHeader>
          <CardContent className="pt-0 space-y-0.5">
            {isLoading ? <SkeletonBox /> : (
              <>
                <div className="flex items-center justify-between py-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"># Bales</span>
                  <span className="text-sm font-bold">
                    {data?.production.totalBales ?? 0}
                  </span>
                </div>
                <StatRow label="Weight" value={fmtKg(data?.production.totalWeightKg ?? 0)} />
                <StatRow label="Value" value={fmtMoney(data?.production.totalValue ?? 0)} />
              </>
            )}
          </CardContent>
        </Card>

        {/* 3 — Wipers & Garbage */}
        <Card
          className="border-red-200 dark:border-red-800/50 bg-red-50/60 dark:bg-red-950/20"
          data-testid="card-wipers-garbage"
        >
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-wide text-red-700 dark:text-red-400 flex items-center gap-1.5">
              <Trash2 className="h-3.5 w-3.5" />
              Wipers &amp; Garbage
            </CardTitle>
            {!isLoading && data && (
              <Badge variant="secondary" className="text-xs bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 no-default-active-elevate">
                QNTY
              </Badge>
            )}
          </CardHeader>
          <CardContent className="pt-0 space-y-0.5">
            {isLoading ? <SkeletonBox /> : (
              <>
                <div className="flex items-center justify-between py-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Wipers</span>
                  <span className="text-sm font-bold">
                    <span className="font-bold">{data?.wipersGarbage.totalWipersQty ?? 0}</span>
                    <span className="text-xs font-normal text-muted-foreground ml-1">{fmtKg(data?.wipersGarbage.totalWipersKg ?? 0)}</span>
                  </span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Garbage</span>
                  <span className="text-sm font-bold">
                    <span className="font-bold">{data?.wipersGarbage.totalGarbageQty ?? 0}</span>
                    <span className="text-xs font-normal text-muted-foreground ml-1">{fmtKg(data?.wipersGarbage.totalGarbageKg ?? 0)}</span>
                  </span>
                </div>
                <StatRow label="Value" value={fmtMoney(data?.wipersGarbage.totalValue ?? 0)} />
                <div className="mt-3 pt-1 flex justify-center">
                  <div className="rounded-md bg-background/80 dark:bg-background/60 border border-border px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-foreground">
                    Total Wiper + Garbage&ensp;
                    <span className="font-mono">{fmtKg(data?.wipersGarbage.totalWeightKg ?? 0)}</span>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* 4 — Balance on Table */}
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
                <StatRow label="Weight" value={fmtKg(data?.balanceOnTable.weightKg ?? 0)} />
                <StatRow label="Batch Rate" value={fmtRate(data?.balanceOnTable.costPerKg ?? 0)} sub="per kg" />
                <StatRow label="Value" value={fmtMoney(data?.balanceOnTable.value ?? 0)} />
                <div className="mt-2 pt-2 border-t border-violet-200 dark:border-violet-800/40 space-y-0.5">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Original input</span>
                    <span className="font-mono">{fmtKg(data?.rawMaterial.totalWeightKg ?? 0)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>&#8722; Bales produced</span>
                    <span className="font-mono">{fmtKg(data?.production.totalWeightKg ?? 0)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>&#8722; Wipers/Garbage</span>
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

      {/* ── Category Pie Chart ── */}
      {!isLoading && data && data.production.byCategory.length > 0 && (
        <CategoryPieChart
          byCategory={data.production.byCategory}
          wipersGarbageKg={data.wipersGarbage.totalWeightKg}
        />
      )}

      {/* ── Expandable detail rows ── */}

      {/* Production by Category (each category expands to show its products) */}
      <ExpandableCard
        title="Production by Category"
        badge={isLoading ? undefined : `${data?.production.byCategory.length ?? 0} categories · ${data?.production.byProduct.length ?? 0} products`}
        icon={Tag}
        testId="card-category-breakdown"
      >
        {isLoading ? (
          <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : !data || data.production.byCategory.length === 0 ? (
          <p className="text-center text-muted-foreground py-6 text-sm">No bales produced in this period</p>
        ) : (
          <CategoryProductBreakdown
            categories={data.production.byCategory}
            products={data.production.byProduct}
            totalBales={data.production.totalBales}
            totalWeightKg={data.production.totalWeightKg}
            totalValue={data.production.totalValue}
          />
        )}
      </ExpandableCard>

      {/* Mix Batches */}
      <ExpandableCard
        title="Mix Batches"
        badge={isLoading ? undefined : `${data?.rawMaterial.totalBatches ?? 0} ${(data?.rawMaterial.totalBatches ?? 0) === 1 ? "batch" : "batches"}`}
        icon={FlaskConical}
        testId="card-mix-breakdown"
      >
        {isLoading ? (
          <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
        ) : !data || data.rawMaterial.batches.length === 0 ? (
          <p className="text-center text-muted-foreground py-6 text-sm">No mix batches in this period</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Date</TableHead>
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
                    <TableCell className="text-sm text-muted-foreground">{b.batchDate || b.createdAt?.slice(0, 10) || "—"}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{fmtKg(parseFloat(b.totalWeightKg))}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{fmtRate(parseFloat(b.costPerKg))}</TableCell>
                    <TableCell className="text-right font-mono font-semibold">{fmtMoney(parseFloat(b.totalCost))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <tfoot>
                <tr className="border-t-2">
                  <td colSpan={3} className="px-4 py-2 text-sm font-semibold text-muted-foreground">Totals</td>
                  <td className="px-4 py-2 text-right font-mono font-bold">{fmtKg(data?.rawMaterial.totalWeightKg ?? 0)}</td>
                  <td />
                  <td className="px-4 py-2 text-right font-mono font-bold">{fmtMoney(data?.rawMaterial.totalCost ?? 0)}</td>
                </tr>
              </tfoot>
            </Table>
          </div>
        )}
      </ExpandableCard>
    </div>
  );
}
