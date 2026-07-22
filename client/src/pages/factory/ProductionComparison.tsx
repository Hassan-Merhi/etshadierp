import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TrendingUp, TrendingDown, Minus, AlertTriangle, Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Date helpers ─────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}
function thisMonthRange(): [string, string] {
  const d = new Date();
  const first = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
  return [first, last];
}
function lastMonthRange(): [string, string] {
  const d = new Date();
  const first = new Date(d.getFullYear(), d.getMonth() - 1, 1).toISOString().slice(0, 10);
  const last = new Date(d.getFullYear(), d.getMonth(), 0).toISOString().slice(0, 10);
  return [first, last];
}
function thisYearRange(): [string, string] {
  const y = new Date().getFullYear();
  return [`${y}-01-01`, `${y}-12-31`];
}
function lastYearRange(): [string, string] {
  const y = new Date().getFullYear() - 1;
  return [`${y}-01-01`, `${y}-12-31`];
}
function fmtDateRange(from: string, to: string) {
  if (from === to) return from;
  return `${from} → ${to}`;
}

// ── Grade derivation ─────────────────────────────────────────────────────────

const GRADE_PREFIXES: [string, string][] = [
  ["HMD10", "CREAM"],
  ["HMD11", "#1"],
  ["HMD12", "#2"],
  ["HMD13", "#3"],
  ["HMD14", "#4"],
  ["HMD16", "Garbage"],
];
function deriveGrade(articleCode: string): string {
  const code = (articleCode || "").toUpperCase();
  for (const [prefix, grade] of GRADE_PREFIXES) {
    if (code.startsWith(prefix)) return grade;
  }
  return "—";
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProductRow {
  articleCode: string;
  productName: string;
  categoryName: string;
  qty: number;
  totalWeightKg: number;
}
interface ReportData {
  production: {
    totalBales: number;
    totalWeightKg: number;
    byProduct: ProductRow[];
  };
}
type Preset = "today-yesterday" | "month" | "year" | "custom";

interface MergedRow {
  articleCode: string;
  productName: string;
  categoryName: string;
  grade: string;
  aQty: number;
  bQty: number;
  aKg: number;
  bKg: number;
}

// ── Formatting ────────────────────────────────────────────────────────────────

function fmtKg(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
function fmtNum(n: number) {
  return n.toLocaleString("en-US");
}
function pctChange(a: number, b: number): number | null {
  if (b === 0 && a === 0) return 0;
  if (b === 0) return null;
  return ((a - b) / b) * 100;
}
function fmtPct(p: number | null) {
  if (p === null) return "N/A";
  const sign = p > 0 ? "+" : "";
  return `${sign}${p.toFixed(1)}%`;
}

// ── MultiSelectFilter ─────────────────────────────────────────────────────────

function MultiSelectFilter({
  options,
  selected,
  onChange,
  placeholder,
  allLabel,
  className,
}: {
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  allLabel: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  const label =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? selected[0]
        : `${selected.length} selected`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "inline-flex items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-sm shadow-sm hover:bg-accent transition-colors min-w-[140px]",
            selected.length > 0 && "border-primary/50",
            className,
          )}
        >
          <span className="truncate">{label}</span>
          <div className="flex items-center gap-1 shrink-0">
            {selected.length > 0 && (
              <span
                role="button"
                tabIndex={0}
                className="rounded-full hover:bg-muted p-0.5"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange([]);
                }}
                onKeyDown={(e) => e.key === "Enter" && (e.stopPropagation(), onChange([]))}
              >
                <X className="h-3 w-3 text-muted-foreground" />
              </span>
            )}
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-0" align="start">
        <Command>
          <CommandInput placeholder={`Search ${placeholder.toLowerCase()}…`} />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => {
                const checked = selected.includes(opt);
                return (
                  <CommandItem
                    key={opt}
                    value={opt}
                    onSelect={() => toggle(opt)}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <div
                      className={cn(
                        "flex h-4 w-4 items-center justify-center rounded border shrink-0",
                        checked
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground/40",
                      )}
                    >
                      {checked && <Check className="h-3 w-3" />}
                    </div>
                    <span className="truncate">{opt}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function DiffCell({
  value,
  fmt,
  isInfinite,
}: {
  value: number;
  fmt: (n: number) => string;
  isInfinite?: boolean;
}) {
  if (isInfinite)
    return <span className="text-xs text-muted-foreground">N/A</span>;
  if (value > 0)
    return (
      <span className="inline-flex items-center justify-end gap-0.5 text-emerald-600 font-medium tabular-nums">
        <TrendingUp className="h-3.5 w-3.5 shrink-0" />
        {fmt(value)}
      </span>
    );
  if (value < 0)
    return (
      <span className="inline-flex items-center justify-end gap-0.5 text-red-500 font-medium tabular-nums">
        <TrendingDown className="h-3.5 w-3.5 shrink-0" />
        {fmt(value)}
      </span>
    );
  return (
    <span className="inline-flex items-center justify-end gap-0.5 text-muted-foreground tabular-nums">
      <Minus className="h-3.5 w-3.5 shrink-0" />0
    </span>
  );
}

function PctCell({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-xs text-muted-foreground">N/A</span>;
  if (pct > 0)
    return (
      <span className="inline-flex items-center justify-end gap-0.5 text-emerald-600 font-medium tabular-nums">
        <TrendingUp className="h-3.5 w-3.5 shrink-0" />
        {fmtPct(pct)}
      </span>
    );
  if (pct < 0)
    return (
      <span className="inline-flex items-center justify-end gap-0.5 text-red-500 font-medium tabular-nums">
        <TrendingDown className="h-3.5 w-3.5 shrink-0" />
        {fmtPct(pct)}
      </span>
    );
  return (
    <span className="inline-flex items-center justify-end gap-0.5 text-muted-foreground tabular-nums">
      <Minus className="h-3.5 w-3.5 shrink-0" />
      0.0%
    </span>
  );
}

function StatCard({
  title,
  value,
  sub,
  valueClass,
}: {
  title: string;
  value: string;
  sub?: string;
  valueClass?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-1 pt-4 px-4">
        <CardTitle className="text-xs font-medium text-muted-foreground tracking-wide uppercase">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <p className={`text-2xl font-bold leading-none ${valueClass ?? ""}`}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ProductionComparison() {
  const [preset, setPreset] = useState<Preset>("month");

  const [customA, setCustomA] = useState<[string, string]>([todayStr(), todayStr()]);
  const [customB, setCustomB] = useState<[string, string]>([yesterdayStr(), yesterdayStr()]);

  // Filters — multi-select for category and grade
  const [filterCategories, setFilterCategories] = useState<string[]>([]);
  const [filterGrades, setFilterGrades] = useState<string[]>([]);
  const [filterProduct, setFilterProduct] = useState("");

  const [rangeA, rangeB] = useMemo<[[string, string], [string, string]]>(() => {
    if (preset === "today-yesterday")
      return [[todayStr(), todayStr()], [yesterdayStr(), yesterdayStr()]];
    if (preset === "month") return [thisMonthRange(), lastMonthRange()];
    if (preset === "year") return [thisYearRange(), lastYearRange()];
    return [customA, customB];
  }, [preset, customA, customB]);

  const labelA =
    preset === "today-yesterday"
      ? "Today"
      : preset === "month"
        ? "This Month"
        : preset === "year"
          ? "This Year"
          : "Period A";
  const labelB =
    preset === "today-yesterday"
      ? "Yesterday"
      : preset === "month"
        ? "Last Month"
        : preset === "year"
          ? "Last Year"
          : "Period B";

  const qA = useQuery<ReportData>({
    queryKey: ["/api/factory/production-value-report", rangeA[0], rangeA[1]],
    queryFn: async () => {
      const r = await fetch(
        `/api/factory/production-value-report?from=${rangeA[0]}&to=${rangeA[1]}`,
        { credentials: "include" },
      );
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? "Request failed");
      return r.json();
    },
  });

  const qB = useQuery<ReportData>({
    queryKey: ["/api/factory/production-value-report", rangeB[0], rangeB[1]],
    queryFn: async () => {
      const r = await fetch(
        `/api/factory/production-value-report?from=${rangeB[0]}&to=${rangeB[1]}`,
        { credentials: "include" },
      );
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? "Request failed");
      return r.json();
    },
  });

  const isLoading = qA.isLoading || qB.isLoading;
  const fetchError = qA.error || qB.error;

  const { categories, grades } = useMemo(() => {
    const catSet = new Set<string>();
    const gradeSet = new Set<string>();
    for (const row of [
      ...(qA.data?.production.byProduct ?? []),
      ...(qB.data?.production.byProduct ?? []),
    ]) {
      if (row.categoryName) catSet.add(row.categoryName);
      const g = deriveGrade(row.articleCode);
      if (g !== "—") gradeSet.add(g);
    }
    return { categories: [...catSet].sort(), grades: [...gradeSet].sort() };
  }, [qA.data, qB.data]);

  const mergedAll = useMemo<MergedRow[]>(() => {
    const map = new Map<string, MergedRow>();
    for (const row of qA.data?.production.byProduct ?? []) {
      map.set(row.articleCode, {
        articleCode: row.articleCode,
        productName: row.productName,
        categoryName: row.categoryName,
        grade: deriveGrade(row.articleCode),
        aQty: row.qty,
        bQty: 0,
        aKg: row.totalWeightKg,
        bKg: 0,
      });
    }
    for (const row of qB.data?.production.byProduct ?? []) {
      const ex = map.get(row.articleCode);
      if (ex) {
        ex.bQty = row.qty;
        ex.bKg = row.totalWeightKg;
      } else {
        map.set(row.articleCode, {
          articleCode: row.articleCode,
          productName: row.productName,
          categoryName: row.categoryName,
          grade: deriveGrade(row.articleCode),
          aQty: 0,
          bQty: row.qty,
          aKg: 0,
          bKg: row.totalWeightKg,
        });
      }
    }
    return [...map.values()];
  }, [qA.data, qB.data]);

  const filtered = useMemo(
    () =>
      mergedAll
        .filter(
          (r) =>
            filterCategories.length === 0 || filterCategories.includes(r.categoryName),
        )
        .filter(
          (r) => filterGrades.length === 0 || filterGrades.includes(r.grade),
        )
        .filter((r) => {
          if (!filterProduct) return true;
          const q = filterProduct.toLowerCase();
          return (
            r.articleCode.toLowerCase().includes(q) ||
            r.productName.toLowerCase().includes(q)
          );
        })
        .sort((a, b) => Math.abs(b.aQty - b.bQty) - Math.abs(a.aQty - a.bQty)),
    [mergedAll, filterCategories, filterGrades, filterProduct],
  );

  const totalABales = filtered.reduce((s, r) => s + r.aQty, 0);
  const totalBBales = filtered.reduce((s, r) => s + r.bQty, 0);
  const totalAKg = filtered.reduce((s, r) => s + r.aKg, 0);
  const totalBKg = filtered.reduce((s, r) => s + r.bKg, 0);
  const baleDiff = totalABales - totalBBales;
  const kgDiff = totalAKg - totalBKg;
  const balePct = pctChange(totalABales, totalBBales);
  const kgPct = pctChange(totalAKg, totalBKg);

  const hasActiveFilter =
    filterCategories.length > 0 || filterGrades.length > 0 || filterProduct !== "";

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      {/* Header + preset buttons */}
      <PageHeader
        title="Production Comparison"
        subtitle="Compare output across two time periods"
      >
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["today-yesterday", "Today vs Yesterday"],
              ["month", "This Month vs Last Month"],
              ["year", "This Year vs Last Year"],
              ["custom", "Custom"],
            ] as [Preset, string][]
          ).map(([p, label]) => (
            <Button
              key={p}
              variant={preset === p ? "default" : "outline"}
              size="sm"
              onClick={() => setPreset(p)}
            >
              {label}
            </Button>
          ))}
        </div>
      </PageHeader>

      {/* Custom date pickers */}
      {preset === "custom" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-lg border bg-muted/40 p-4">
          <div className="space-y-2">
            <p className="text-sm font-semibold">Period A</p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                className="rounded-md border bg-background px-2.5 py-1.5 text-sm"
                value={customA[0]}
                onChange={(e) => setCustomA([e.target.value, customA[1]])}
              />
              <span className="text-sm text-muted-foreground">to</span>
              <input
                type="date"
                className="rounded-md border bg-background px-2.5 py-1.5 text-sm"
                value={customA[1]}
                onChange={(e) => setCustomA([customA[0], e.target.value])}
              />
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-semibold">Period B</p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                className="rounded-md border bg-background px-2.5 py-1.5 text-sm"
                value={customB[0]}
                onChange={(e) => setCustomB([e.target.value, customB[1]])}
              />
              <span className="text-sm text-muted-foreground">to</span>
              <input
                type="date"
                className="rounded-md border bg-background px-2.5 py-1.5 text-sm"
                value={customB[1]}
                onChange={(e) => setCustomB([customB[0], e.target.value])}
              />
            </div>
          </div>
        </div>
      )}

      {/* Loading skeletons */}
      {isLoading && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-xl" />
        </div>
      )}

      {/* Error state */}
      {!isLoading && fetchError && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Failed to load production data</p>
            <p className="text-xs mt-0.5 opacity-80">{(fetchError as Error).message}</p>
          </div>
        </div>
      )}

      {/* Content */}
      {!isLoading && !fetchError && (
        <>
          {/* Row 1: A bales, B bales, A kg, B kg */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard
              title={`${labelA} — Bales`}
              value={fmtNum(totalABales)}
              sub={fmtDateRange(rangeA[0], rangeA[1])}
            />
            <StatCard
              title={`${labelB} — Bales`}
              value={fmtNum(totalBBales)}
              sub={fmtDateRange(rangeB[0], rangeB[1])}
            />
            <StatCard
              title={`${labelA} — Kilograms`}
              value={`${fmtKg(totalAKg)} kg`}
              sub={fmtDateRange(rangeA[0], rangeA[1])}
            />
            <StatCard
              title={`${labelB} — Kilograms`}
              value={`${fmtKg(totalBKg)} kg`}
              sub={fmtDateRange(rangeB[0], rangeB[1])}
            />
          </div>

          {/* Row 2: bale diff, kg diff, % change */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <StatCard
              title="Bale Difference"
              value={`${baleDiff > 0 ? "+" : ""}${fmtNum(baleDiff)}`}
              sub={`${labelA} vs ${labelB}`}
              valueClass={
                baleDiff > 0
                  ? "text-emerald-600"
                  : baleDiff < 0
                    ? "text-red-500"
                    : "text-muted-foreground"
              }
            />
            <StatCard
              title="Kilogram Difference"
              value={`${kgDiff > 0 ? "+" : ""}${fmtKg(kgDiff)} kg`}
              sub={`${labelA} vs ${labelB}`}
              valueClass={
                kgDiff > 0
                  ? "text-emerald-600"
                  : kgDiff < 0
                    ? "text-red-500"
                    : "text-muted-foreground"
              }
            />
            <StatCard
              title="% Change"
              value={fmtPct(balePct)}
              sub={`Bales · Kg: ${fmtPct(kgPct)}`}
              valueClass={
                (balePct ?? 0) > 0
                  ? "text-emerald-600"
                  : (balePct ?? 0) < 0
                    ? "text-red-500"
                    : "text-muted-foreground"
              }
            />
          </div>

          {/* ── Filters ── */}
          <div className="flex flex-wrap gap-3 items-center">
            <MultiSelectFilter
              options={categories}
              selected={filterCategories}
              onChange={setFilterCategories}
              placeholder="Categories"
              allLabel="All Categories"
              className="w-48"
            />

            <MultiSelectFilter
              options={grades}
              selected={filterGrades}
              onChange={setFilterGrades}
              placeholder="Grades"
              allLabel="All Grades"
              className="w-36"
            />

            <Input
              placeholder="Search product…"
              className="w-52"
              value={filterProduct}
              onChange={(e) => setFilterProduct(e.target.value)}
            />

            {hasActiveFilter && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFilterCategories([]);
                  setFilterGrades([]);
                  setFilterProduct("");
                }}
              >
                Clear filters
              </Button>
            )}

            {hasActiveFilter && (
              <span className="text-xs text-muted-foreground">
                {filtered.length} of {mergedAll.length} products
              </span>
            )}
          </div>

          {/* ── Comparison table ── */}
          {filtered.length === 0 ? (
            <div className="rounded-lg border p-12 text-center text-sm text-muted-foreground">
              {mergedAll.length === 0
                ? "No production data found for either period."
                : "No products match the active filters."}
            </div>
          ) : (
            <div className="rounded-lg border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[180px]">Product</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Grade</TableHead>
                    <TableHead className="text-right">{labelA} Qty</TableHead>
                    <TableHead className="text-right">{labelB} Qty</TableHead>
                    <TableHead className="text-right">Qty Diff</TableHead>
                    <TableHead className="text-right">%</TableHead>
                    <TableHead className="text-right">{labelA} Kg</TableHead>
                    <TableHead className="text-right">{labelB} Kg</TableHead>
                    <TableHead className="text-right">Kg Diff</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((row) => {
                    const qDiff = row.aQty - row.bQty;
                    const kDiff = row.aKg - row.bKg;
                    const pct = pctChange(row.aQty, row.bQty);
                    return (
                      <TableRow key={row.articleCode}>
                        <TableCell>
                          <div className="text-sm font-medium leading-snug">
                            {row.productName || row.articleCode}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {row.categoryName || "—"}
                        </TableCell>
                        <TableCell>
                          {row.grade !== "—" ? (
                            <Badge variant="secondary" className="text-xs">
                              {row.grade}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium">
                          {fmtNum(row.aQty)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {fmtNum(row.bQty)}
                        </TableCell>
                        <TableCell className="text-right">
                          <DiffCell
                            value={qDiff}
                            fmt={(n) => (n > 0 ? "+" : "") + fmtNum(n)}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <PctCell pct={pct} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          {fmtKg(row.aKg)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                          {fmtKg(row.bKg)}
                        </TableCell>
                        <TableCell className="text-right">
                          <DiffCell
                            value={kDiff}
                            fmt={(n) => (n > 0 ? "+" : "") + fmtKg(n)}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
