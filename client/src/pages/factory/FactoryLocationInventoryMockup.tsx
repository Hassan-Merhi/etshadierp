import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import {
  Package, Search, Layers, TrendingUp, DollarSign, Weight,
  ArrowLeft, Download, Printer, RefreshCw, ArrowUpDown,
  ChevronUp, ChevronDown, Eye, EyeOff, BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

// ─── Sample data (mockup only — no real backend calls) ───────────────────────

interface MockProduct {
  productId: number;
  articleCode: string;
  productName: string;
  category: string;
  baleCount: number;
  totalWeight: number;
  sellingPrice: number;
  productionPrice: number;
}

const SAMPLE_LOCATION = "HMD INTERNATIONAL GROUP — BEIRUT";

const SAMPLE_PRODUCTS: MockProduct[] = [
  { productId: 1,  articleCode: "HMD12002", productName: "ADULT - JOGGER PANT 40KG",   category: "Adult",    baleCount: 48, totalWeight: 1920, sellingPrice: 650, productionPrice: 520 },
  { productId: 2,  articleCode: "HMD12092", productName: "ADULT - SWEATSHIRT 40KG",    category: "Adult",    baleCount: 35, totalWeight: 1400, sellingPrice: 620, productionPrice: 490 },
  { productId: 3,  articleCode: "HMD11003", productName: "ARMY UNIFORM 40KG",          category: "Uniform",  baleCount: 22, totalWeight:  880, sellingPrice: 800, productionPrice: 720 },
  { productId: 4,  articleCode: "AS10043",  productName: "AS HALLOWEEN",               category: "AS MIX",   baleCount: 10, totalWeight:  400, sellingPrice: 580, productionPrice: 490 },
  { productId: 5,  articleCode: "AS10030",  productName: "AS L MIX SHORT #2",          category: "AS MIX",   baleCount: 65, totalWeight: 2600, sellingPrice: 600, productionPrice: 510 },
  { productId: 6,  articleCode: "HMD10055", productName: "KIDS MIX SHORTS",            category: "Kids",     baleCount: 30, totalWeight: 1200, sellingPrice: 540, productionPrice: 430 },
  { productId: 7,  articleCode: "HMD10022", productName: "LADIES DRESS MIX",           category: "Ladies",   baleCount: 18, totalWeight:  720, sellingPrice: 650, productionPrice: 540 },
  { productId: 8,  articleCode: "HMD10077", productName: "MIXED WINTER JACKETS",       category: "Winter",   baleCount: 42, totalWeight: 2100, sellingPrice: 850, productionPrice: 720 },
  { productId: 9,  articleCode: "HMD11099", productName: "SECURITY UNIFORM",           category: "Uniform",  baleCount:  8, totalWeight:  320, sellingPrice: 900, productionPrice: 790 },
  { productId: 10, articleCode: "AS10088",  productName: "AS SUMMER MIX #4",           category: "AS MIX",   baleCount:  0, totalWeight:    0, sellingPrice: 570, productionPrice: 450 },
  { productId: 11, articleCode: "HMD13010", productName: "ADULT POLO SHIRT 40KG",      category: "Adult",    baleCount: 27, totalWeight: 1080, sellingPrice: 610, productionPrice: 490 },
  { productId: 12, articleCode: "HMD10031", productName: "KIDS WINTER JACKET",         category: "Kids",     baleCount: 14, totalWeight:  700, sellingPrice: 720, productionPrice: 620 },
];

const CATEGORY_COLORS: Record<string, string> = {
  "Adult":   "bg-blue-500/15 text-blue-400 border-blue-500/30",
  "Uniform": "bg-amber-500/15 text-amber-400 border-amber-500/30",
  "AS MIX":  "bg-purple-500/15 text-purple-400 border-purple-500/30",
  "Kids":    "bg-green-500/15 text-green-400 border-green-500/30",
  "Ladies":  "bg-pink-500/15 text-pink-400 border-pink-500/30",
  "Winter":  "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
};
function catColor(cat: string) {
  return CATEGORY_COLORS[cat] ?? "bg-muted text-muted-foreground border-border";
}

type SortField = "name" | "bales" | "kg" | "sell" | "cost";
type SortDir   = "asc" | "desc";

// ─── Stat card ────────────────────────────────────────────────────────────────
interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}
function StatCard({ icon, label, value, sub, accent }: StatCardProps) {
  return (
    <Card className="flex-1 min-w-[140px]">
      <CardContent className="pt-4 pb-3 px-4">
        <div className="flex items-start justify-between mb-2">
          <div className={`p-1.5 rounded-md ${accent ?? "bg-muted"}`}>
            {icon}
          </div>
        </div>
        <div className="text-2xl font-bold font-mono leading-tight" data-testid="mockup-stat-value">
          {value}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
        {sub && <div className="text-xs text-muted-foreground/70 mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

// ─── Main mockup page ─────────────────────────────────────────────────────────
export default function FactoryLocationInventoryMockup() {
  const [, navigate] = useLocation();
  const [search, setSearch]           = useState("");
  const [catFilter, setCatFilter]     = useState("__all__");
  const [sortField, setSortField]     = useState<SortField>("name");
  const [sortDir, setSortDir]         = useState<SortDir>("asc");
  const [showZero, setShowZero]       = useState(false);

  const fmt   = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 });
  const money = (n: number) => "$" + n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  const categories = useMemo(
    () => Array.from(new Set(SAMPLE_PRODUCTS.map((p) => p.category))).sort(),
    [],
  );

  const filtered = useMemo(() => {
    let items = SAMPLE_PRODUCTS;
    if (!showZero) items = items.filter((p) => p.baleCount > 0);
    if (catFilter !== "__all__") items = items.filter((p) => p.category === catFilter);
    if (search.trim()) {
      const t = search.toLowerCase();
      items = items.filter(
        (p) => p.productName.toLowerCase().includes(t) || p.articleCode.toLowerCase().includes(t),
      );
    }
    return [...items].sort((a, b) => {
      let cmp = 0;
      if (sortField === "name") cmp = a.productName.localeCompare(b.productName);
      if (sortField === "bales") cmp = a.baleCount - b.baleCount;
      if (sortField === "kg")    cmp = a.totalWeight - b.totalWeight;
      if (sortField === "sell")  cmp = a.baleCount * a.sellingPrice    - b.baleCount * b.sellingPrice;
      if (sortField === "cost")  cmp = a.baleCount * a.productionPrice - b.baleCount * b.productionPrice;
      return sortDir === "desc" ? -cmp : cmp;
    });
  }, [search, catFilter, sortField, sortDir, showZero]);

  const allActive    = SAMPLE_PRODUCTS.filter((p) => p.baleCount > 0);
  const totalBales   = allActive.reduce((s, p) => s + p.baleCount, 0);
  const totalKg      = allActive.reduce((s, p) => s + p.totalWeight, 0);
  const totalSell    = allActive.reduce((s, p) => s + p.baleCount * p.sellingPrice, 0);
  const totalCost    = allActive.reduce((s, p) => s + p.baleCount * p.productionPrice, 0);
  const margin       = totalSell > 0 ? ((totalSell - totalCost) / totalSell) * 100 : 0;
  const uniqueCats   = new Set(allActive.map((p) => p.category)).size;

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/50" />;
    return sortDir === "asc"
      ? <ChevronUp className="h-3.5 w-3.5 text-primary" />
      : <ChevronDown className="h-3.5 w-3.5 text-primary" />;
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">

      {/* Mockup banner */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-amber-500/10 border border-amber-500/25 text-xs text-amber-700 dark:text-amber-400">
        <BarChart3 className="h-3.5 w-3.5 shrink-0" />
        <span className="font-medium">MOCKUP PREVIEW</span>
        <span className="text-amber-600/70 dark:text-amber-500/70">— Uses sample data only. Real page at</span>
        <button
          className="underline underline-offset-2 hover:text-amber-800 dark:hover:text-amber-200"
          onClick={() => navigate("/factory/location-inventory")}
        >
          /factory/location-inventory
        </button>
      </div>

      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/factory/location-inventory")}
            data-testid="mockup-button-back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-xl md:text-2xl font-bold tracking-tight" data-testid="mockup-title">
              Location Inventory
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Physical bales on ground by category and product
            </p>
            <div className="flex items-center gap-1.5 mt-1.5">
              <Badge variant="outline" className="text-xs font-medium no-default-active-elevate">
                <Package className="h-3 w-3 mr-1" />
                {SAMPLE_LOCATION}
              </Badge>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="ghost" size="icon" title="Refresh" data-testid="mockup-button-refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" data-testid="mockup-button-export">
            <Download className="h-4 w-4 mr-1.5" /> Export
          </Button>
          <Button variant="outline" size="sm" data-testid="mockup-button-print">
            <Printer className="h-4 w-4 mr-1.5" /> Print
          </Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="flex flex-wrap gap-3">
        <StatCard
          icon={<Package className="h-4 w-4 text-blue-400" />}
          label="Total Bales"
          value={totalBales.toLocaleString()}
          sub={`${allActive.length} products`}
          accent="bg-blue-500/10"
        />
        <StatCard
          icon={<Weight className="h-4 w-4 text-emerald-400" />}
          label="Total KG"
          value={fmt(totalKg)}
          sub={`~${fmt(totalKg / totalBales)} KG / bale`}
          accent="bg-emerald-500/10"
        />
        <StatCard
          icon={<Layers className="h-4 w-4 text-purple-400" />}
          label="Categories"
          value={String(uniqueCats)}
          sub={`${SAMPLE_PRODUCTS.length} products total`}
          accent="bg-purple-500/10"
        />
        <StatCard
          icon={<DollarSign className="h-4 w-4 text-amber-400" />}
          label="Cost Value"
          value={money(totalCost)}
          sub="production price basis"
          accent="bg-amber-500/10"
        />
        <StatCard
          icon={<DollarSign className="h-4 w-4 text-green-400" />}
          label="Sell Value"
          value={money(totalSell)}
          sub="at current selling price"
          accent="bg-green-500/10"
        />
        <StatCard
          icon={<TrendingUp className="h-4 w-4 text-cyan-400" />}
          label="Margin"
          value={`${margin.toFixed(1)}%`}
          sub={`${money(totalSell - totalCost)} gross profit`}
          accent="bg-cyan-500/10"
        />
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search products or article codes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="mockup-input-search"
          />
        </div>

        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="w-[160px]" data-testid="mockup-select-category">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={sortField} onValueChange={(v) => setSortField(v as SortField)}>
          <SelectTrigger className="w-[140px]" data-testid="mockup-select-sort">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Name</SelectItem>
            <SelectItem value="bales">Bales</SelectItem>
            <SelectItem value="kg">Total KG</SelectItem>
            <SelectItem value="sell">Sell Value</SelectItem>
            <SelectItem value="cost">Cost Value</SelectItem>
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          size="icon"
          onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
          title={sortDir === "asc" ? "Ascending" : "Descending"}
          data-testid="mockup-button-sort-dir"
        >
          {sortDir === "asc" ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>

        <Button
          variant={showZero ? "default" : "outline"}
          size="sm"
          onClick={() => setShowZero((v) => !v)}
          data-testid="mockup-button-show-zero"
          className="gap-1.5"
        >
          {showZero ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          Zero stock
        </Button>
      </div>

      {/* Result count */}
      <div className="flex items-center justify-between text-sm text-muted-foreground -mb-1">
        <span>
          Showing <strong className="text-foreground">{filtered.length}</strong> product{filtered.length !== 1 ? "s" : ""}
          {catFilter !== "__all__" && <> in <strong className="text-foreground">{catFilter}</strong></>}
        </span>
        {search && (
          <button
            className="text-xs underline underline-offset-2"
            onClick={() => setSearch("")}
          >
            Clear search
          </button>
        )}
      </div>

      {/* Desktop table */}
      <Card className="hidden md:block">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="w-[120px]">Category</TableHead>
                <TableHead>
                  <button
                    className="flex items-center gap-1 font-semibold"
                    onClick={() => toggleSort("name")}
                    data-testid="mockup-sort-name"
                  >
                    Product <SortIcon field="name" />
                  </button>
                </TableHead>
                <TableHead className="text-right w-[90px]">
                  <button className="flex items-center gap-1 ml-auto" onClick={() => toggleSort("bales")}>
                    Bales <SortIcon field="bales" />
                  </button>
                </TableHead>
                <TableHead className="text-right w-[100px]">Avg KG/Bale</TableHead>
                <TableHead className="text-right w-[100px]">Sell Price</TableHead>
                <TableHead className="text-right w-[120px]">
                  <button className="flex items-center gap-1 ml-auto" onClick={() => toggleSort("sell")}>
                    Sell Value <SortIcon field="sell" />
                  </button>
                </TableHead>
                <TableHead className="text-right w-[100px]">Cost Price</TableHead>
                <TableHead className="text-right w-[120px]">
                  <button className="flex items-center gap-1 ml-auto" onClick={() => toggleSort("cost")}>
                    Cost Value <SortIcon field="cost" />
                  </button>
                </TableHead>
                <TableHead className="text-right w-[100px]">
                  <button className="flex items-center gap-1 ml-auto" onClick={() => toggleSort("kg")}>
                    Total KG <SortIcon field="kg" />
                  </button>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-14 text-muted-foreground" data-testid="mockup-empty-state">
                    <Package className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    No products match your filters.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((prod) => {
                  const avgKg     = prod.baleCount > 0 ? prod.totalWeight / prod.baleCount : 0;
                  const sellValue = prod.baleCount * prod.sellingPrice;
                  const costValue = prod.baleCount * prod.productionPrice;
                  const isZero    = prod.baleCount === 0;
                  return (
                    <TableRow
                      key={prod.productId}
                      className={isZero ? "opacity-50" : "cursor-pointer"}
                      data-testid={`mockup-row-product-${prod.productId}`}
                    >
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-xs font-medium no-default-active-elevate ${catColor(prod.category)}`}
                          data-testid={`mockup-badge-category-${prod.productId}`}
                        >
                          {prod.category}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="font-semibold leading-snug" data-testid={`mockup-text-name-${prod.productId}`}>
                          {prod.productName}
                        </div>
                        <div className="text-xs text-muted-foreground font-mono mt-0.5" data-testid={`mockup-text-code-${prod.productId}`}>
                          {prod.articleCode}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold" data-testid={`mockup-text-bales-${prod.productId}`}>
                        {prod.baleCount > 0 ? prod.baleCount.toLocaleString() : <span className="text-muted-foreground/50">—</span>}
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">
                        {avgKg > 0 ? fmt(avgKg) : <span className="text-muted-foreground/50">—</span>}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {money(prod.sellingPrice)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold text-green-600 dark:text-green-400" data-testid={`mockup-text-sell-value-${prod.productId}`}>
                        {sellValue > 0 ? money(sellValue) : <span className="text-muted-foreground/50">—</span>}
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">
                        {money(prod.productionPrice)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground" data-testid={`mockup-text-cost-value-${prod.productId}`}>
                        {costValue > 0 ? money(costValue) : <span className="text-muted-foreground/50">—</span>}
                      </TableCell>
                      <TableCell className="text-right font-mono" data-testid={`mockup-text-kg-${prod.productId}`}>
                        {prod.totalWeight > 0 ? fmt(prod.totalWeight) : <span className="text-muted-foreground/50">—</span>}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
              {/* Totals footer */}
              {filtered.length > 0 && (() => {
                const fb = filtered.reduce((s, p) => s + p.baleCount, 0);
                const fk = filtered.reduce((s, p) => s + p.totalWeight, 0);
                const fs = filtered.reduce((s, p) => s + p.baleCount * p.sellingPrice, 0);
                const fc = filtered.reduce((s, p) => s + p.baleCount * p.productionPrice, 0);
                return (
                  <TableRow className="bg-muted/40 font-bold border-t-2" data-testid="mockup-row-total">
                    <TableCell />
                    <TableCell className="text-sm">
                      Total <span className="text-muted-foreground font-normal">({filtered.length} products)</span>
                    </TableCell>
                    <TableCell className="text-right font-mono">{fb.toLocaleString()}</TableCell>
                    <TableCell />
                    <TableCell />
                    <TableCell className="text-right font-mono text-green-600 dark:text-green-400">{money(fs)}</TableCell>
                    <TableCell />
                    <TableCell className="text-right font-mono">{money(fc)}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(fk)}</TableCell>
                  </TableRow>
                );
              })()}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {filtered.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground" data-testid="mockup-mobile-empty">
              <Package className="h-7 w-7 mx-auto mb-2 opacity-30" />
              No products match your filters.
            </CardContent>
          </Card>
        ) : (
          filtered.map((prod) => {
            const avgKg     = prod.baleCount > 0 ? prod.totalWeight / prod.baleCount : 0;
            const sellValue = prod.baleCount * prod.sellingPrice;
            return (
              <Card key={prod.productId} className={prod.baleCount === 0 ? "opacity-50" : ""} data-testid={`mockup-card-product-${prod.productId}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold leading-snug truncate">{prod.productName}</div>
                      <div className="text-xs text-muted-foreground font-mono mt-0.5">{prod.articleCode}</div>
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-xs shrink-0 no-default-active-elevate ${catColor(prod.category)}`}
                    >
                      {prod.category}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm mt-3">
                    <div>
                      <span className="text-muted-foreground text-xs">Bales</span>
                      <div className="font-mono font-bold">{prod.baleCount > 0 ? prod.baleCount : "—"}</div>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-xs">Avg KG/Bale</span>
                      <div className="font-mono">{avgKg > 0 ? fmt(avgKg) : "—"}</div>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-xs">Total KG</span>
                      <div className="font-mono">{prod.totalWeight > 0 ? fmt(prod.totalWeight) : "—"}</div>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-xs">Sell Value</span>
                      <div className="font-mono font-semibold text-green-600 dark:text-green-400">
                        {sellValue > 0 ? money(sellValue) : "—"}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
