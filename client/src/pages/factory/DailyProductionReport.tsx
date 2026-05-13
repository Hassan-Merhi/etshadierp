import { useState, useMemo, useCallback, useEffect } from "react";
import FactoryFinancialSnapshot from "@/pages/factory/FactoryFinancialSnapshot";
import FactoryShippingContainers from "@/pages/factory/FactoryShippingContainers";
import FactoryStatusBuilder from "@/pages/factory/FactoryStatusBuilder";
import FactoryContainerTracking from "@/pages/factory/FactoryContainerTracking";
import { addDays, format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/PageHeader";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ChevronDown, ChevronRight, ChevronLeft, FlaskConical, PackageCheck, Scale,
  TrendingUp, TrendingDown, Minus, Tag, Trash2,
  Package, ShoppingCart, AlertTriangle, Truck, RefreshCw, Layers, Ship,
} from "lucide-react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}
function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function monthEnd() {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return last.toISOString().slice(0, 10);
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

function fmtMoney(n: number | null | undefined) {
  if (n == null || isNaN(n)) return "$0";
  if (n === 0) return "$0";
  const r = Math.round(n * 100) / 100;
  if (Math.abs(r - Math.round(r)) < 0.005) return `$${Math.round(r).toLocaleString("en-US")}`;
  return `$${r.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtRate(n: number | null | undefined) {
  if (n == null || isNaN(n)) return "$0.000";
  return `$${(Math.round(n * 1000) / 1000).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`;
}
function fmtKg(n: number | null | undefined) {
  if (n == null || isNaN(n)) return "0 kg";
  const r = Math.round(n * 10) / 10;
  return `${r.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 1 })} kg`;
}
function fmtSalary(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function daysInCalendarMonth(isoDate: string): number {
  const [yr, mo] = isoDate.substring(0, 7).split("-").map(Number);
  return new Date(yr, mo, 0).getDate();
}
function computeWorkerExpectedSalary(
  worker: { baseSalary: string; salaryType: string; attendance: Record<string, string> },
  dates: { date: string; isWeekend: boolean }[],
): number {
  if (worker.salaryType !== "Monthly") return 0;
  const monthly = parseFloat(worker.baseSalary || "0");
  if (!monthly || !dates.length) return 0;
  let earned = 0;
  for (const d of dates) {
    const dailyRate = monthly / daysInCalendarMonth(d.date);
    if (d.isWeekend) {
      earned += dailyRate;
    } else {
      const status = worker.attendance[d.date];
      if (status === "Present") earned += dailyRate;
      else if (status === "HalfDay") earned += dailyRate * 0.5;
      else if (status === "Leave") earned += dailyRate;
    }
  }
  return earned;
}

type Preset = "today" | "yesterday" | "month" | "lastmonth" | "year" | "alltime" | "custom";

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
      costPricePerBale: number;
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

  const allOpen = categories.length > 0 && openCats.size === categories.length;

  function toggle(cat: string) {
    setOpenCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  function toggleAll() {
    if (allOpen) {
      setOpenCats(new Set());
    } else {
      setOpenCats(new Set(categories.map(c => c.categoryName)));
    }
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
      <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-4 px-2 pb-1 border-b items-center">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Category</span>
        <Button
          variant="outline"
          size="sm"
          onClick={toggleAll}
          data-testid="button-toggle-all-categories"
          className="h-6 text-xs px-2"
        >
          {allOpen ? "Collapse All" : "Show All"}
        </Button>
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
                      <TableHead className="text-xs text-right">Cost / Bale</TableHead>
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
                        <TableCell className="text-xs text-right font-mono py-1.5">{fmtMoney(p.costPricePerBale)}</TableCell>
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
  "#f59e0b", // amber    — Winter
  "#34d399", // emerald  — Bags
  "#fb923c", // orange   — Shoes
  "#f472b6", // pink     — Toys
  "#64748b", // slate    — Wipers/Garbage
  "#94a3b8", // gray     — Other
];

const GROUP_ORDER = ["Summer", "Winter", "Bags", "Shoes", "Toys", "Wipers & Garbage"];

function classifyCategory(name: string): string {
  const u = name.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/ABO\s*SAMAR/.test(u)) return "__skip__";
  if (/SUMMER/.test(u)) return "Summer";
  if (/WINTER/.test(u)) return "Winter";
  if (/BAG/.test(u)) return "Bags";
  if (/SHOE/.test(u)) return "Shoes";
  if (/TOY/.test(u)) return "Toys";
  return "Other";
}

// ── Chart #1: detailed breakdown per sub-type ──────────────────────────────
const DETAILED_ORDER = [
  "Summer 1","Summer 2","Summer 3","Summer 4","Summer Crème",
  "Winter 1","Winter 2","Winter 3","Winter 4","Winter Crème",
  "Bags 1","Bags 2","Bags 3","Bags 4","Bags Crème",
  "Toys 1","Toys 2","Toys 3","Toys 4","Toys Crème",
  "Shoes 1","Shoes 2","Shoes 3","Shoes 4","Shoes Crème",
  "Wipers 1","Wipers 2","Wipers 3","Wipers 4","Wipers Crème",
  "Garbage 1","Garbage 2","Garbage 3","Garbage 4","Garbage Crème",
  "Other",
];
const DETAILED_COLORS: Record<string, string> = {
  "Summer 1":"#312e81","Summer 2":"#4338ca","Summer 3":"#6366f1","Summer 4":"#818cf8","Summer Crème":"#a5b4fc",
  "Winter 1":"#92400e","Winter 2":"#b45309","Winter 3":"#d97706","Winter 4":"#f59e0b","Winter Crème":"#fcd34d",
  "Bags 1":"#064e3b","Bags 2":"#047857","Bags 3":"#059669","Bags 4":"#34d399","Bags Crème":"#6ee7b7",
  "Toys 1":"#831843","Toys 2":"#9d174d","Toys 3":"#db2777","Toys 4":"#ec4899","Toys Crème":"#f9a8d4",
  "Shoes 1":"#4c1d95","Shoes 2":"#5b21b6","Shoes 3":"#7c3aed","Shoes 4":"#8b5cf6","Shoes Crème":"#c4b5fd",
  "Wipers 1":"#0f172a","Wipers 2":"#1e293b","Wipers 3":"#334155","Wipers 4":"#64748b","Wipers Crème":"#94a3b8",
  "Garbage 1":"#713f12","Garbage 2":"#854d0e","Garbage 3":"#a16207","Garbage 4":"#ca8a04","Garbage Crème":"#eab308",
  "Other":"#d1d5db",
};

function classifyDetailed(name: string): string {
  const u = name.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/ABO\s*SAMAR/.test(u)) return "__skip__";
  let cat = "Other";
  if (/SUMMER/.test(u)) cat = "Summer";
  else if (/WINTER/.test(u)) cat = "Winter";
  else if (/BAG/.test(u)) cat = "Bags";
  else if (/TOY/.test(u)) cat = "Toys";
  else if (/SHOE/.test(u)) cat = "Shoes";
  else if (/WIPER/.test(u)) cat = "Wipers";
  else if (/GARBAGE|RAG/.test(u)) cat = "Garbage";
  else return "Other";

  if (/CREME|CRÈME|BIG\s*SIZE/.test(u)) return `${cat} Crème`;
  if (/\b4\b/.test(u)) return `${cat} 4`;
  if (/\b3\b/.test(u)) return `${cat} 3`;
  if (/\b2\b/.test(u)) return `${cat} 2`;
  if (/\b1\b/.test(u)) return `${cat} 1`;
  return cat === "Other" ? "Other" : `${cat} 1`;
}

// ── Chart #2: by grade (Summer+Winter merged into grade numbers) ────────────
const GRADE_ORDER = ["Grade #1","Grade #2","Grade #3","Grade #4","Grade Crème","Bags","Toys","Shoes","Wipers & Garbage","Other"];
const GRADE_COLORS: Record<string, string> = {
  "Grade #1":"#4338ca",
  "Grade #2":"#d97706",
  "Grade #3":"#0891b2",
  "Grade #4":"#7c3aed",
  "Grade Crème":"#a78bfa",
  "Bags":"#059669",
  "Toys":"#db2777",
  "Shoes":"#ea580c",
  "Wipers & Garbage":"#64748b",
  "Other":"#d1d5db",
};

function classifyByGrade(name: string): string {
  if (name === "__WIPERS_GARBAGE__") return "Wipers & Garbage";
  const u = name.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/ABO\s*SAMAR/.test(u)) return "__skip__";
  if (/WIPER|GARBAGE|RAG/.test(u)) return "Wipers & Garbage";
  if (/BAG/.test(u)) return "Bags";
  if (/TOY/.test(u)) return "Toys";
  if (/SHOE/.test(u)) return "Shoes";
  if (/CREME|CRÈME|BIG\s*SIZE/.test(u)) return "Grade Crème";
  if (/\b4\b/.test(u)) return "Grade #4";
  if (/\b3\b/.test(u)) return "Grade #3";
  if (/\b2\b/.test(u)) return "Grade #2";
  if (/\b1\b/.test(u)) return "Grade #1";
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
    <div className="flex items-center gap-1" data-testid="card-category-pie">
      {/* Legend — tight left of pie */}
      <div className="flex flex-col gap-1">
        {slices.map((s) => {
          const pct = ((s.value / total) * 100).toFixed(1);
          return (
            <div key={s.name} className="flex items-center gap-1.5">
              <span className="inline-block rounded-sm flex-shrink-0" style={{ width: 10, height: 10, background: s.color }} />
              <span className="text-xs text-muted-foreground whitespace-nowrap">{s.name}</span>
              <span className="text-xs font-bold tabular-nums">{pct}%</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {Math.round(s.value).toLocaleString()} kg
              </span>
            </div>
          );
        })}
      </div>

      {/* Pie — right of legend */}
      <div style={{ width: 160, height: 160, flexShrink: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              cx="50%"
              cy="50%"
              innerRadius={42}
              outerRadius={72}
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
              contentStyle={{ fontSize: 11, borderRadius: 6 }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Shared mini-pie renderer used by both new charts ──────────────────────
function MiniPieChart({
  title,
  allRows,
  classifyFn,
  order,
  colors,
  testId,
}: {
  title: string;
  allRows: { categoryName: string; totalWeightKg: number }[];
  classifyFn: (name: string) => string;
  order: string[];
  colors: Record<string, string>;
  testId: string;
}) {
  const grouped = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const row of allRows) {
      const group = classifyFn(row.categoryName);
      if (group === "__skip__") continue;
      acc[group] = (acc[group] ?? 0) + row.totalWeightKg;
    }
    return acc;
  }, [allRows, classifyFn]);

  const slices = order
    .filter((g) => (grouped[g] ?? 0) > 0)
    .map((g) => ({ name: g, value: grouped[g]!, color: colors[g] ?? "#94a3b8" }));

  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total === 0) return null;

  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
      <div className="flex items-start gap-3">
        {/* Legend */}
        <div className="flex flex-col gap-1 min-w-0">
          {slices.map((s) => {
            const pct = ((s.value / total) * 100).toFixed(1);
            return (
              <div key={s.name} className="flex items-center gap-1.5">
                <span className="inline-block rounded-sm flex-shrink-0" style={{ width: 9, height: 9, background: s.color }} />
                <span className="text-xs text-muted-foreground whitespace-nowrap">{s.name}</span>
                <span className="text-xs font-bold tabular-nums">{pct}%</span>
                <span className="text-xs text-muted-foreground tabular-nums">{Math.round(s.value).toLocaleString()} kg</span>
              </div>
            );
          })}
        </div>
        {/* Donut */}
        <div style={{ width: 140, height: 140, flexShrink: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={slices} cx="50%" cy="50%" innerRadius={38} outerRadius={62} paddingAngle={2} dataKey="value" strokeWidth={0}>
                {slices.map((s) => <Cell key={s.name} fill={s.color} />)}
              </Pie>
              <Tooltip formatter={(v: number) => [`${Math.round(v).toLocaleString()} kg`, ""]} contentStyle={{ fontSize: 11, borderRadius: 6 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Bale Ledger tab — types, helpers, component
// ─────────────────────────────────────────────

interface BaleDetail { ref: string; weightKg: number; totalCost: number; }
interface BucketRow {
  productId: number | null; productName: string; articleCode: string;
  categoryName: string; baleCount: number; totalWeightKg: number;
  totalCost: number; baleDetails: BaleDetail[];
}
interface SectionTotal { baleCount: number; totalWeightKg: number; totalCost: number; }
interface LedgerData {
  currentStock: BucketRow[]; wasteStock: BucketRow[];
  sold: BucketRow[]; wasteDispatched: BucketRow[]; pendingLoading: BucketRow[];
  totals: {
    currentStock: SectionTotal; wasteStock: SectionTotal; sold: SectionTotal;
    wasteDispatched: SectionTotal; pendingLoading: SectionTotal; grand: SectionTotal;
  };
}

function fmtL(n: number) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 1 }).format(n); }
function fmtNL(n: number) { return new Intl.NumberFormat("en-US").format(n); }
function fmtML(n: number): string {
  if (n === 0) return "$0";
  const r = Math.round(n * 100) / 100;
  return r % 1 === 0
    ? "$" + new Intl.NumberFormat("en-US").format(r)
    : "$" + new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(r);
}
function groupByCategory(rows: BucketRow[]): { category: string; items: BucketRow[] }[] {
  const map = new Map<string, BucketRow[]>();
  for (const row of rows) {
    const cat = row.categoryName || "—";
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat)!.push(row);
  }
  return Array.from(map.entries()).map(([category, items]) => ({ category, items }));
}

interface LedgerSectionProps {
  title: string; subtitle: string; icon: React.ReactNode; badgeColor: string;
  rows: BucketRow[]; total: SectionTotal; defaultOpen?: boolean; showSoldPrice?: boolean;
}
function LedgerSection({ title, subtitle, icon, badgeColor, rows, total, defaultOpen = false, showSoldPrice = false }: LedgerSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  function toggleRow(key: string) {
    setExpandedRows((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  }
  const avgRate = total.baleCount > 0 && total.totalCost > 0 ? total.totalCost / total.baleCount : 0;
  const groups = groupByCategory(rows);
  const colSpan = showSoldPrice ? 7 : 5;
  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover-elevate select-none py-3 px-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                {open ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                <div className="flex items-center gap-2">
                  {icon}
                  <div>
                    <CardTitle className="text-sm">{title}</CardTitle>
                    <p className="text-xs text-muted-foreground font-normal mt-0.5">{subtitle}</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 text-xs flex-wrap">
                <Badge variant="outline" className={`text-xs ${badgeColor}`}>{fmtNL(total.baleCount)} bales</Badge>
                <span className="text-muted-foreground">{fmtL(total.totalWeightKg)} kg</span>
                <span className="font-semibold">{fmtML(total.totalCost)}</span>
                {avgRate > 0 && <span className="text-muted-foreground">avg {fmtML(avgRate)}/bale</span>}
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="p-0">
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground p-4 pt-0 text-center">No records.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs py-2 px-3">Product</TableHead>
                    <TableHead className="text-xs py-2 px-3 text-right">Bales</TableHead>
                    <TableHead className="text-xs py-2 px-3 text-right">Weight (kg)</TableHead>
                    <TableHead className="text-xs py-2 px-3 text-right">Avg Sell/Bale</TableHead>
                    <TableHead className="text-xs py-2 px-3 text-right">Total Sell Value</TableHead>
                    {showSoldPrice && (<><TableHead className="text-xs py-2 px-3 text-right">Avg Sold Rate</TableHead><TableHead className="text-xs py-2 px-3 text-right">Total Sold</TableHead></>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.map(({ category, items }) => {
                    const catBales = items.reduce((s, r) => s + r.baleCount, 0);
                    const catWeight = items.reduce((s, r) => s + r.totalWeightKg, 0);
                    const catCost = items.reduce((s, r) => s + r.totalCost, 0);
                    const catAvg = catBales > 0 && catCost > 0 ? catCost / catBales : 0;
                    return [
                      <TableRow key={`cat-${category}`} className="bg-muted/40">
                        <TableCell colSpan={colSpan} className="py-1.5 px-3 text-xs font-semibold text-muted-foreground tracking-wide">
                          <div className="flex items-center justify-between gap-4 flex-wrap">
                            <span>{category}</span>
                            <div className="flex items-center gap-4 font-normal">
                              <span>{fmtNL(catBales)} bales</span>
                              <span>{fmtL(catWeight)} kg</span>
                              {catAvg > 0 && <span>avg {fmtML(catAvg)}/bale</span>}
                              {catCost > 0 && <span className="font-semibold">{fmtML(catCost)}</span>}
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>,
                      ...items.flatMap((r, i) => {
                        const rowKey = `${category}-${r.productId ?? "null"}-${i}`;
                        const isOpen = expandedRows.has(rowKey);
                        const rowAvgRate = r.baleCount > 0 && r.totalCost > 0 ? r.totalCost / r.baleCount : 0;
                        const hasBaleDetails = r.baleDetails.some((d) => d.ref || d.totalCost > 0);
                        return [
                          <TableRow key={rowKey} className={isOpen ? "bg-muted/10" : ""}>
                            <TableCell className="py-2 px-3 pl-5">
                              <button className="text-xs font-medium text-left hover:underline cursor-pointer flex items-center gap-1 group" onClick={() => toggleRow(rowKey)}>
                                {isOpen ? <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" /> : <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />}
                                {r.productName}
                              </button>
                            </TableCell>
                            <TableCell className="py-2 px-3 text-right text-xs">{fmtNL(r.baleCount)}</TableCell>
                            <TableCell className="py-2 px-3 text-right text-xs">{fmtL(r.totalWeightKg)}</TableCell>
                            <TableCell className="py-2 px-3 text-right text-xs text-muted-foreground">{rowAvgRate > 0 ? fmtML(rowAvgRate) : "—"}</TableCell>
                            <TableCell className="py-2 px-3 text-right text-xs font-medium">{r.totalCost > 0 ? fmtML(r.totalCost) : "—"}</TableCell>
                            {showSoldPrice && (<><TableCell className="py-2 px-3 text-right text-xs text-muted-foreground">—</TableCell><TableCell className="py-2 px-3 text-right text-xs text-muted-foreground">—</TableCell></>)}
                          </TableRow>,
                          isOpen && hasBaleDetails ? (
                            <TableRow key={`${rowKey}-detail`} className="bg-muted/20">
                              <TableCell colSpan={colSpan} className="py-0 px-0">
                                <div className="pl-8 pr-3 py-2">
                                  <table className="w-full text-xs">
                                    <thead className="sticky top-0 z-30 bg-muted/50">
                                      <tr className="border-b border-border/50">
                                        <th className="text-left py-1 pr-4 font-medium text-muted-foreground">Ref #</th>
                                        <th className="text-right py-1 pr-4 font-medium text-muted-foreground">Weight (kg)</th>
                                        <th className="text-right py-1 pr-4 font-medium text-muted-foreground">Qty</th>
                                        <th className="text-right py-1 pr-4 font-medium text-muted-foreground">Avg Cost/Bale</th>
                                        <th className="text-right py-1 font-medium text-muted-foreground">Total Cost</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {r.baleDetails.map((d, di) => (
                                        <tr key={di} className="border-b border-border/20 last:border-0">
                                          <td className="py-1 pr-4 font-mono">{d.ref || "—"}</td>
                                          <td className="py-1 pr-4 text-right text-muted-foreground">{fmtL(d.weightKg)}</td>
                                          <td className="py-1 pr-4 text-right text-muted-foreground">1</td>
                                          <td className="py-1 pr-4 text-right text-muted-foreground">{d.totalCost > 0 ? fmtML(d.totalCost) : "—"}</td>
                                          <td className="py-1 text-right font-medium">{d.totalCost > 0 ? fmtML(d.totalCost) : "—"}</td>
                                        </tr>
                                      ))}
                                      {r.baleDetails.length > 1 && (
                                        <tr className="font-semibold border-t border-border/50">
                                          <td className="py-1 pr-4 text-muted-foreground">Total</td>
                                          <td className="py-1 pr-4 text-right">{fmtL(r.totalWeightKg)}</td>
                                          <td className="py-1 pr-4 text-right">{r.baleCount}</td>
                                          <td className="py-1 pr-4 text-right">{rowAvgRate > 0 ? fmtML(rowAvgRate) : "—"}</td>
                                          <td className="py-1 text-right">{r.totalCost > 0 ? fmtML(r.totalCost) : "—"}</td>
                                        </tr>
                                      )}
                                    </tbody>
                                  </table>
                                </div>
                              </TableCell>
                            </TableRow>
                          ) : isOpen ? (
                            <TableRow key={`${rowKey}-empty`} className="bg-muted/20">
                              <TableCell colSpan={colSpan} className="py-2 px-5 text-xs text-muted-foreground italic">No individual bale records found.</TableCell>
                            </TableRow>
                          ) : null,
                        ].filter(Boolean);
                      }),
                    ];
                  })}
                  <TableRow className="bg-muted/30 font-semibold">
                    <TableCell className="text-xs py-2 px-3">Subtotal</TableCell>
                    <TableCell className="text-right text-xs py-2 px-3">{fmtNL(total.baleCount)}</TableCell>
                    <TableCell className="text-right text-xs py-2 px-3">{fmtL(total.totalWeightKg)}</TableCell>
                    <TableCell className="text-right text-xs py-2 px-3 text-muted-foreground">{avgRate > 0 ? fmtML(avgRate) : "—"}</TableCell>
                    <TableCell className="text-right text-xs py-2 px-3">{total.totalCost > 0 ? fmtML(total.totalCost) : "—"}</TableCell>
                    {showSoldPrice && (<><TableCell className="text-right text-xs py-2 px-3 text-muted-foreground">—</TableCell><TableCell className="text-right text-xs py-2 px-3 text-muted-foreground">—</TableCell></>)}
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

export default function DailyProductionReport() {
  const [activeTab, setActiveTab] = useState("production");
  const [preset, setPreset] = useState<Preset>("today");
  const [customFrom, setCustomFrom] = useState(todayStr());
  const [customTo, setCustomTo] = useState(todayStr());

  const { from, to } = useMemo(() => {
    if (preset === "today") return { from: todayStr(), to: todayStr() };
    if (preset === "yesterday") return { from: yesterdayStr(), to: yesterdayStr() };
    if (preset === "month") return { from: monthStart(), to: monthEnd() };
    if (preset === "lastmonth") {
      const [f, t] = lastMonthRange();
      return { from: f, to: t };
    }
    if (preset === "year") return { from: yearStart(), to: todayStr() };
    if (preset === "alltime") return { from: "", to: "" };
    return { from: customFrom, to: customTo };
  }, [preset, customFrom, customTo]);

  const stepDates = useCallback((n: number) => {
    const fmt = "yyyy-MM-dd";
    const baseFrom = from || todayStr();
    const baseTo   = to   || todayStr();
    setCustomFrom(format(addDays(new Date(baseFrom + "T00:00:00"), n), fmt));
    setCustomTo(  format(addDays(new Date(baseTo   + "T00:00:00"), n), fmt));
    setPreset("custom");
  }, [from, to]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      const isBack    = e.key === "-" || e.code === "Minus";
      const isForward = (e.key === "+" && e.shiftKey) || (e.code === "Equal" && e.shiftKey) || e.key === "=";
      if (isBack)    { e.preventDefault(); stepDates(-1); }
      else if (isForward) { e.preventDefault(); stepDates(1); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [stepDates]);

  const { data, isLoading } = useQuery<ReportData>({
    queryKey: ["/api/factory/production-value-report", from, to],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const qs = params.toString() ? `?${params.toString()}` : "";
      const res = await fetch(`/api/factory/production-value-report${qs}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: preset === "alltime" || (!!from && !!to),
  });

  const { data: ledger, isLoading: ledgerLoading, refetch: ledgerRefetch, isFetching: ledgerFetching } = useQuery<LedgerData>({
    queryKey: ["/api/factory/bale-ledger"],
    staleTime: 30_000,
  });

  const { data: attendanceData } = useQuery<{
    dates: { date: string; isWeekend: boolean }[];
    workers: { baseSalary: string; salaryType: string; attendance: Record<string, string>; paidSalary: string }[];
  }>({
    queryKey: ["/api/factory/workers/attendance-report", from, to],
    queryFn: async () => {
      const res = await fetch(
        `/api/factory/workers/attendance-report?startDate=${from}&endDate=${to}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to load attendance");
      return res.json();
    },
    enabled: !!from && !!to,
  });

  const salaryKpi = useMemo(() => {
    if (!attendanceData || !attendanceData.dates.length) return null;
    let totalExpected = 0;
    let totalPaid = 0;
    for (const w of attendanceData.workers) {
      totalExpected += computeWorkerExpectedSalary(w, attendanceData.dates);
      totalPaid     += parseFloat(w.paidSalary || "0");
    }
    return { totalExpected, totalPaid, totalRemaining: totalExpected - totalPaid };
  }, [attendanceData]);

  const presets: { key: Preset; label: string }[] = [
    { key: "today", label: "Today" },
    { key: "yesterday", label: "Yesterday" },
    { key: "month", label: "This Month" },
    { key: "lastmonth", label: "Last Month" },
    { key: "year", label: "This Year" },
    { key: "alltime", label: "All Time" },
    { key: "custom", label: "Custom" },
  ];

  const statusValue = data?.summary.statusValue ?? 0;
  const statusPositive = statusValue >= 0;
  const grand = ledger?.totals.grand;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b flex-shrink-0">
        <PageHeader title="Production Analytics" subtitle="Manufacturing overview — output metrics &amp; bale lifecycle" />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 overflow-hidden">
        <TabsList className="mx-4 mt-3 mb-0 flex-shrink-0 w-fit" data-testid="tabs-production-analytics">
          <TabsTrigger value="production" data-testid="tab-production">Production</TabsTrigger>
          <TabsTrigger value="snapshot" data-testid="tab-snapshot">Financial Snapshot</TabsTrigger>
          <TabsTrigger value="ledger" data-testid="tab-ledger">Bale Ledger</TabsTrigger>
          <TabsTrigger value="shipping" data-testid="tab-shipping">Shipping Containers</TabsTrigger>
          <TabsTrigger value="sheets" data-testid="tab-sheets">Factory Sheets</TabsTrigger>
          <TabsTrigger value="container-tracking" data-testid="tab-container-tracking" className="flex items-center gap-1.5">
            <Ship className="h-3.5 w-3.5" />
            Container Tracking
          </TabsTrigger>
        </TabsList>

        {/* ── Production tab ── */}
        <TabsContent value="production" className="flex-1 overflow-y-auto p-4 gap-4 flex flex-col mt-0 data-[state=inactive]:hidden">
      {/* Date filter + Pie chart row */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="icon"
            variant="outline"
            onClick={() => stepDates(-1)}
            data-testid="button-date-prev"
            title="Previous day"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

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

          <Button
            size="icon"
            variant="outline"
            onClick={() => stepDates(1)}
            data-testid="button-date-next"
            title="Next day"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Compact pie charts — same row as date picker */}
        {!isLoading && data && (() => {
          // For the Grade chart, use production.byCategory rows + ONE synthetic
          // "__WIPERS_GARBAGE__" row whose weight equals wipersGarbage.totalWeightKg.
          // This guarantees both charts show the identical Wipers & Garbage total,
          // regardless of the actual category names inside wipersGarbage.rows.
          const gradeRows: { categoryName: string; totalWeightKg: number }[] = [
            ...data.production.byCategory.map(c => ({ categoryName: c.categoryName, totalWeightKg: c.totalWeightKg })),
            ...(data.wipersGarbage.totalWeightKg > 0
              ? [{ categoryName: "__WIPERS_GARBAGE__", totalWeightKg: data.wipersGarbage.totalWeightKg }]
              : []),
          ];
          const hasData = gradeRows.some(r => r.totalWeightKg > 0);
          if (!hasData) return null;
          return (
            <div className="flex flex-wrap gap-6">
              <CategoryPieChart
                byCategory={data.production.byCategory}
                wipersGarbageKg={data.wipersGarbage.totalWeightKg}
              />
              <MiniPieChart
                title="By Grade"
                allRows={gradeRows}
                classifyFn={classifyByGrade}
                order={GRADE_ORDER}
                colors={GRADE_COLORS}
                testId="card-grade-pie"
              />
            </div>
          );
        })()}
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
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Production Value</span>
                  <span className="text-base font-bold text-blue-600 dark:text-blue-400" data-testid="text-production-value">
                    {fmtMoney(data?.summary.productionValue ?? 0)}
                  </span>
                </div>
                <div className="w-px h-5 bg-border" />
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Batch Cost</span>
                  <span className="text-base font-bold" data-testid="text-batch-cost">
                    {fmtMoney(data?.summary.batchCost ?? 0)}
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
                const totalKg = productionsKg - origKg;
                const isPositive = totalKg >= 0;
                return (
                  <div className="flex flex-wrap items-center gap-5 pt-2 border-t border-border">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-muted-foreground">Productions</span>
                      <span className="text-base font-bold" data-testid="text-weight-productions">
                        {fmtKg(productionsKg)}
                      </span>
                    </div>
                    <span className="text-muted-foreground text-base font-semibold">&#8722;</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-muted-foreground">Original Batches</span>
                      <span className="text-base font-bold" data-testid="text-weight-batches">
                        {fmtKg(origKg)}
                      </span>
                    </div>
                    <span className="text-muted-foreground text-base font-semibold">=</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-muted-foreground">Total</span>
                      <span
                        className={`text-base font-bold ${isPositive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                        data-testid="text-weight-total"
                      >
                        {fmtKg(totalKg)}
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Salary KPIs ── */}
      {(salaryKpi || preset !== "alltime") && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card data-testid="card-expected-salary">
            <CardContent className="py-3 px-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Expected Salary</p>
              {salaryKpi ? (
                <p className="text-xl font-bold tabular-nums text-foreground" data-testid="text-expected-salary">
                  {fmtSalary(salaryKpi.totalExpected)}
                </p>
              ) : (
                <p className="text-xl font-bold tabular-nums text-muted-foreground">—</p>
              )}
            </CardContent>
          </Card>
          <Card className="border-amber-300 dark:border-amber-700" data-testid="card-remaining-salary">
            <CardContent className="py-3 px-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Remaining Salary</p>
              {salaryKpi ? (
                <p
                  className={
                    salaryKpi.totalRemaining < 0
                      ? "text-xl font-bold tabular-nums text-blue-600 dark:text-blue-400"
                      : salaryKpi.totalRemaining === 0
                        ? "text-xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400"
                        : "text-xl font-bold tabular-nums text-amber-600 dark:text-amber-400"
                  }
                  data-testid="text-remaining-salary"
                >
                  {salaryKpi.totalRemaining < 0
                    ? `Overpaid ${fmtSalary(Math.abs(salaryKpi.totalRemaining))}`
                    : fmtSalary(salaryKpi.totalRemaining)}
                </p>
              ) : (
                <p className="text-xl font-bold tabular-nums text-muted-foreground">—</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

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
                QTY
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
                {/* Big rate display */}
                {(() => {
                  const kg = data?.production.totalWeightKg ?? 0;
                  const val = data?.production.totalValue ?? 0;
                  const rate = kg > 0 ? val / kg : 0;
                  return (
                    <div className="flex flex-col items-center justify-center py-3 mt-1 border-t border-blue-200 dark:border-blue-800/40">
                      <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">Rate / kg</span>
                      <span className="text-3xl font-extrabold text-blue-600 dark:text-blue-400 tabular-nums">
                        {fmtRate(rate)}
                      </span>
                    </div>
                  );
                })()}
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
                QTY
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
                    <span className="text-xs font-normal text-muted-foreground ml-3">{fmtKg(data?.wipersGarbage.totalWipersKg ?? 0)}</span>
                  </span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Garbage</span>
                  <span className="text-sm font-bold flex items-center gap-2">
                    <span className="font-bold">{data?.wipersGarbage.totalGarbageQty ?? 0}</span>
                    <span className="text-xs font-normal text-muted-foreground">{fmtKg(data?.wipersGarbage.totalGarbageKg ?? 0)}</span>
                  </span>
                </div>
                <StatRow label="Value" value={fmtMoney(data?.wipersGarbage.totalValue ?? 0)} />
                <div className="mt-2 pt-2 border-t border-red-200 dark:border-red-800/40 flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wide text-red-700 dark:text-red-400">Total Wiper + Garbage</span>
                  <span className="text-sm font-extrabold tabular-nums">
                    {(data?.wipersGarbage.totalWipersQty ?? 0) + (data?.wipersGarbage.totalGarbageQty ?? 0)}
                    <span className="text-xs font-normal text-muted-foreground ml-3">{fmtKg(data?.wipersGarbage.totalWeightKg ?? 0)}</span>
                  </span>
                </div>
                {(() => {
                  const wgKg = data?.wipersGarbage.totalWeightKg ?? 0;
                  const rawKg = data?.rawMaterial.totalWeightKg ?? 0;
                  const pct = rawKg > 0 ? (wgKg / rawKg) * 100 : 0;
                  const color = pct > 10 ? "text-red-600 dark:text-red-400" : pct > 5 ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400";
                  return (
                    <div className="flex flex-col items-center justify-center py-3 mt-1 border-t border-red-200 dark:border-red-800/40">
                      <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">% of Input</span>
                      <span className={`text-3xl font-extrabold tabular-nums ${color}`} data-testid="text-wg-pct">
                        {pct.toFixed(1)}%
                      </span>
                    </div>
                  );
                })()}
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
              </>
            )}
          </CardContent>
        </Card>
      </div>

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
            products={data.production.byProduct as any}
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
          <div className="table-responsive">
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
        </TabsContent>

        {/* ── Financial Snapshot tab ── */}
        <TabsContent value="snapshot" className="flex-1 overflow-hidden mt-0 data-[state=inactive]:hidden">
          <FactoryFinancialSnapshot />
        </TabsContent>

        {/* ── Bale Ledger tab ── */}
        <TabsContent value="ledger" className="flex-1 overflow-y-auto p-4 gap-3 flex flex-col mt-0 data-[state=inactive]:hidden">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm text-muted-foreground">Complete lifecycle view — stock in hand, wipers/garbages, sold, and waste</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => ledgerRefetch()} disabled={ledgerFetching} data-testid="button-refresh-ledger" className="gap-2">
              <RefreshCw className={`w-4 h-4 ${ledgerFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>

          {ledgerLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <Card key={i}>
                  <CardHeader className="py-3 px-4">
                    <Skeleton className="h-5 w-64" />
                    <Skeleton className="h-3 w-48 mt-1" />
                  </CardHeader>
                </Card>
              ))}
            </div>
          ) : (
            <>
              <LedgerSection
                title="Current Stock — In Hand"
                subtitle="Bales in stock (IN_STOCK / FINALIZED), excluding wipers and garbages"
                icon={<Package className="w-4 h-4 text-green-600" />}
                badgeColor="text-green-700 border-green-200"
                rows={ledger?.currentStock || []}
                total={ledger?.totals.currentStock || { baleCount: 0, totalWeightKg: 0, totalCost: 0 }}
              />
              <LedgerSection
                title="Wipers & Garbages — In Hand"
                subtitle="Waste-category bales currently in stock (IN_STOCK / FINALIZED)"
                icon={<AlertTriangle className="w-4 h-4 text-amber-500" />}
                badgeColor="text-amber-700 border-amber-200"
                rows={ledger?.wasteStock || []}
                total={ledger?.totals.wasteStock || { baleCount: 0, totalWeightKg: 0, totalCost: 0 }}
              />
              <LedgerSection
                title="Stock Sold"
                subtitle="Bales that have been dispatched and sold to customers"
                icon={<ShoppingCart className="w-4 h-4 text-blue-600" />}
                badgeColor="text-blue-700 border-blue-200"
                rows={ledger?.sold || []}
                total={ledger?.totals.sold || { baleCount: 0, totalWeightKg: 0, totalCost: 0 }}
                showSoldPrice={true}
              />
              <LedgerSection
                title="Pending Loading / Verified"
                subtitle="Bales reserved for orders currently in Loading, Pending Verification, or Verified status"
                icon={<Truck className="w-4 h-4 text-purple-500" />}
                badgeColor="text-purple-700 border-purple-200"
                rows={ledger?.pendingLoading || []}
                total={ledger?.totals.pendingLoading || { baleCount: 0, totalWeightKg: 0, totalCost: 0 }}
              />
              <LedgerSection
                title="Waste Dispatched"
                subtitle="Bales removed from stock via waste disposal (Waste Dispatch records)"
                icon={<Trash2 className="w-4 h-4 text-destructive" />}
                badgeColor="text-destructive border-destructive/30"
                rows={ledger?.wasteDispatched || []}
                total={ledger?.totals.wasteDispatched || { baleCount: 0, totalWeightKg: 0, totalCost: 0 }}
              />

              {grand && (
                <Card className="border-primary/20 bg-primary/5">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <div>
                        <p className="font-bold text-sm">Total Production (All Time)</p>
                        <p className="text-xs text-muted-foreground mt-0.5">Sum of all sections — complete production output</p>
                      </div>
                      <div className="flex items-center gap-6 flex-wrap">
                        <div className="text-center">
                          <p className="text-xl font-bold" data-testid="grand-total-bales">{fmtNL(grand.baleCount)}</p>
                          <p className="text-xs text-muted-foreground">total bales</p>
                        </div>
                        <div className="text-center">
                          <p className="text-xl font-bold" data-testid="grand-total-weight">{fmtL(grand.totalWeightKg)}</p>
                          <p className="text-xs text-muted-foreground">kg produced</p>
                        </div>
                        <div className="text-center">
                          <p className="text-xl font-bold" data-testid="grand-total-cost">{fmtML(grand.totalCost)}</p>
                          <p className="text-xs text-muted-foreground">total sell value</p>
                        </div>
                        {grand.baleCount > 0 && grand.totalCost > 0 && (
                          <div className="text-center">
                            <p className="text-xl font-bold">{fmtML(grand.totalCost / grand.baleCount)}</p>
                            <p className="text-xs text-muted-foreground">avg/bale</p>
                          </div>
                        )}
                      </div>
                    </div>
                    {ledger && (
                      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 border-t pt-4 sm:grid-cols-5">
                        {[
                          { label: "In Hand (Regular)", bales: ledger.totals.currentStock.baleCount, kg: ledger.totals.currentStock.totalWeightKg, cost: ledger.totals.currentStock.totalCost, color: "text-green-600" },
                          { label: "In Hand (Waste Cat.)", bales: ledger.totals.wasteStock.baleCount, kg: ledger.totals.wasteStock.totalWeightKg, cost: ledger.totals.wasteStock.totalCost, color: "text-amber-600" },
                          { label: "Pending Loading / Verified", bales: ledger.totals.pendingLoading.baleCount, kg: ledger.totals.pendingLoading.totalWeightKg, cost: ledger.totals.pendingLoading.totalCost, color: "text-purple-600" },
                          { label: "Sold", bales: ledger.totals.sold.baleCount, kg: ledger.totals.sold.totalWeightKg, cost: ledger.totals.sold.totalCost, color: "text-blue-600" },
                          { label: "Waste Dispatched", bales: ledger.totals.wasteDispatched.baleCount, kg: ledger.totals.wasteDispatched.totalWeightKg, cost: ledger.totals.wasteDispatched.totalCost, color: "text-destructive" },
                        ].map((s) => (
                          <div key={s.label} className="text-xs">
                            <p className={`font-semibold ${s.color}`}>{s.label}</p>
                            <p className="text-muted-foreground">{fmtNL(s.bales)} bales · {fmtL(s.kg)} kg</p>
                            {s.cost > 0 && <p className="font-medium">{fmtML(s.cost)}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        {/* ── Shipping Containers tab ── */}
        <TabsContent value="shipping" className="flex-1 overflow-y-auto p-4 mt-0 data-[state=inactive]:hidden">
          <FactoryShippingContainers />
        </TabsContent>

        {/* ── Factory Sheets tab ── */}
        <TabsContent value="sheets" className="flex-1 overflow-hidden flex flex-col mt-0 data-[state=inactive]:hidden">
          <FactoryStatusBuilder />
        </TabsContent>

        {/* ── Container Tracking tab ── */}
        <TabsContent value="container-tracking" className="flex-1 overflow-y-auto p-4 mt-0 data-[state=inactive]:hidden">
          <FactoryContainerTracking />
        </TabsContent>
      </Tabs>
    </div>
  );
}
