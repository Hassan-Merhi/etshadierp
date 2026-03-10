import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2, Package, Users, Trash2,
  ChevronDown, ChevronUp, Ship, DollarSign, TrendingUp, TrendingDown, Boxes, Tag, CalendarCheck,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

interface DashboardData {
  waste: { totalKg: number; breakdown: Array<{ wasteType: string; kg: number }> };
  workers: { active: number; attendanceToday: number };
  containers: { loaded: number };
}

interface KpiData {
  openingStockKg: string;
  closingStockKg: string;
  balesPressedToday: number;
  kgsUsedToday: string;
  totalBaleWeightToday: string;
  categories: Array<{ name: string; count: number; totalKg: number }>;
  balesDetail: Array<{ id: number; baleCode: string; productName: string; category: string; weightKg: string; pressedAt: string; status: string; quantity: number }>;
}

interface Container {
  id: number;
  containerNumber: string;
  supplierName: string | null;
  status: string;
  totalKg: string;
  actualReceivedKg: string | null;
  arrivalDate: string | null;
  origin: string | null;
}

interface SupplierBalance {
  id: number;
  name: string;
  totalValue: string;
  totalContainers: number;
  isErpOnly?: boolean;
}

const STATUS_ORDER = ["PENDING", "IN_TRANSIT", "ARRIVED", "OFFLOADED", "PARTIALLY_RECEIVED", "RECEIVED"];
const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pending",
  IN_TRANSIT: "In Transit",
  ARRIVED: "Arrived",
  OFFLOADED: "Offloaded",
  PARTIALLY_RECEIVED: "Partially Received",
  RECEIVED: "Received",
};
const STATUS_ACTIVE = new Set(["PENDING", "IN_TRANSIT", "ARRIVED"]);

const WASTE_TYPE_LABEL: Record<string, string> = {
  GARBAGE: "Garbage",
  WIPERS: "Wipers",
  OTHER: "Other",
};

function fmt(n: number | string, decimals = 0) {
  const v = typeof n === "string" ? parseFloat(n) : n;
  return isNaN(v) ? "0" : v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function CollapsiblePane({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div
      style={{ display: open ? undefined : "none" }}
      className="border-t mt-3 pt-3"
    >
      {children}
    </div>
  );
}

export default function FactoryDashboard() {
  const today = new Date().toISOString().split("T")[0];
  const [date, setDate] = useState(today);
  const [showNetDetails, setShowNetDetails] = useState(false);
  const [showBalesPane, setShowBalesPane] = useState(false);
  const [showCatPane, setShowCatPane] = useState(false);

  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ["/api/factory/dashboard", date],
    queryFn: async () => {
      const res = await fetch(`/api/factory/dashboard?date=${date}`);
      if (!res.ok) throw new Error("Failed to load dashboard");
      return res.json();
    },
  });

  const { data: kpis } = useQuery<KpiData>({
    queryKey: ["/api/factory/dashboard-kpis"],
  });

  const { data: containers } = useQuery<Container[]>({
    queryKey: ["/api/factory/containers"],
  });

  const { data: suppliers } = useQuery<SupplierBalance[]>({
    queryKey: ["/api/factory/suppliers/with-balances"],
  });

  const importCycleContainers = (containers || [])
    .filter(c => STATUS_ACTIVE.has(c.status))
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));

  const netPosition = (suppliers || []).reduce(
    (sum, s) => sum + parseFloat(s.totalValue || "0"), 0
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24" data-testid="loading-spinner">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading dashboard...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-title">Factory Dashboard</h1>
          <p className="text-muted-foreground mt-1">Production overview and operations</p>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Date</Label>
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-44" data-testid="input-date" />
        </div>
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Waste */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Trash2 className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Waste</p>
            </div>
            <p className="text-2xl font-bold font-mono" data-testid="text-waste-kg">
              {fmt(data?.waste?.totalKg ?? 0, 1)} <span className="text-sm font-normal text-muted-foreground">kg</span>
            </p>
            {(data?.waste?.breakdown ?? []).length > 0 && (
              <div className="mt-1 space-y-0.5">
                {(data?.waste?.breakdown ?? []).map(b => (
                  <p key={b.wasteType} className="text-xs text-muted-foreground">
                    {WASTE_TYPE_LABEL[b.wasteType] ?? b.wasteType}: {fmt(b.kg, 1)} kg
                  </p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Loaded Containers */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Package className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Loaded Containers</p>
            </div>
            <p className="text-2xl font-bold font-mono" data-testid="text-containers-loaded">
              {data?.containers?.loaded ?? 0}
            </p>
            <p className="text-xs text-muted-foreground mt-1">customer containers finalized</p>
          </CardContent>
        </Card>

        {/* Active Workers */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Users className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Active Workers</p>
            </div>
            <p className="text-2xl font-bold font-mono" data-testid="text-active-workers">
              {data?.workers?.active ?? 0}
            </p>
          </CardContent>
        </Card>

        {/* Worker Attendance Today */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <CalendarCheck className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Attendance Today</p>
            </div>
            <p className="text-2xl font-bold font-mono" data-testid="text-attendance-today">
              {data?.workers?.attendanceToday ?? 0}
            </p>
            <p className="text-xs text-muted-foreground mt-1">workers present</p>
          </CardContent>
        </Card>
      </div>

      {/* ── Import Cycle ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Ship className="h-4 w-4" />
            Import Cycle
            <Badge variant="outline" className="ml-1">{importCycleContainers.length} active</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {importCycleContainers.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No containers currently in transit or pending</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Container</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Origin</TableHead>
                    <TableHead className="text-right">KG</TableHead>
                    <TableHead>Arrival</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {importCycleContainers.map(c => (
                    <TableRow key={c.id} data-testid={`row-import-container-${c.id}`}>
                      <TableCell className="font-mono text-sm font-medium">{c.containerNumber}</TableCell>
                      <TableCell className="text-sm">{c.supplierName || "—"}</TableCell>
                      <TableCell>
                        <Badge variant={c.status === "IN_TRANSIT" ? "default" : "outline"} className="text-xs">
                          {STATUS_LABEL[c.status] || c.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{c.origin || "—"}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{fmt(c.totalKg, 0)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{c.arrivalDate || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Net Position ── */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Net Position</p>
                <p
                  className={`text-3xl font-bold font-mono tabular-nums ${netPosition >= 0 ? "text-green-600 dark:text-green-400" : "text-destructive"}`}
                  data-testid="text-net-position"
                >
                  {netPosition >= 0 ? "+" : ""}${fmt(netPosition, 2)}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowNetDetails(v => !v)}
              data-testid="button-toggle-net-details"
            >
              {showNetDetails ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
            </Button>
          </div>

          <CollapsiblePane open={showNetDetails}>
            {(!suppliers || suppliers.length === 0) ? (
              <p className="text-sm text-muted-foreground">No supplier data available</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Supplier</TableHead>
                    <TableHead className="text-right">Containers</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {suppliers.map(s => {
                    const bal = parseFloat(s.totalValue || "0");
                    return (
                      <TableRow key={s.id} data-testid={`row-net-supplier-${s.id}`}>
                        <TableCell className="text-sm">
                          {s.name}
                          {s.isErpOnly && <Badge variant="outline" className="ml-2 text-xs">ERP</Badge>}
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">{s.totalContainers}</TableCell>
                        <TableCell className={`text-right font-mono text-sm font-medium ${bal >= 0 ? "text-green-600 dark:text-green-400" : "text-destructive"}`}>
                          {bal >= 0 ? "+" : ""}${fmt(bal, 2)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CollapsiblePane>
        </CardContent>
      </Card>

      {/* ── Total Bales Pressed + Total Categories ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Bales pressed */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Boxes className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Total Bales Pressed</p>
                  <p className="text-3xl font-bold font-mono" data-testid="text-total-bales-pressed">
                    {kpis?.balesPressedToday ?? 0}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {fmt(kpis?.totalBaleWeightToday ?? 0, 1)} kg total
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowBalesPane(v => !v)}
                data-testid="button-toggle-bales-pane"
              >
                {showBalesPane ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
              </Button>
            </div>

            <CollapsiblePane open={showBalesPane}>
              {(!kpis?.balesDetail || kpis.balesDetail.length === 0) ? (
                <p className="text-sm text-muted-foreground">No bales pressed today</p>
              ) : (
                <div className="max-h-64 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Category</TableHead>
                        <TableHead>Product</TableHead>
                        <TableHead className="text-right">Bales</TableHead>
                        <TableHead className="text-right">KG</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {kpis.balesDetail.map((b, i) => (
                        <TableRow key={b.id ?? i} data-testid={`row-bale-${b.id ?? i}`}>
                          <TableCell className="text-sm text-muted-foreground">{b.category || "—"}</TableCell>
                          <TableCell className="text-sm">{b.productName || "—"}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{b.quantity ?? 1}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{fmt(b.weightKg, 2)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CollapsiblePane>
          </CardContent>
        </Card>

        {/* Categories pressed */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Tag className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Total Categories Pressed</p>
                  <p className="text-3xl font-bold font-mono" data-testid="text-total-categories">
                    {kpis?.categories?.length ?? 0}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {kpis?.balesPressedToday ?? 0} bales across categories
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowCatPane(v => !v)}
                data-testid="button-toggle-categories-pane"
              >
                {showCatPane ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
              </Button>
            </div>

            <CollapsiblePane open={showCatPane}>
              {(!kpis?.categories || kpis.categories.length === 0) ? (
                <p className="text-sm text-muted-foreground">No categories pressed today</p>
              ) : (
                <div className="max-h-64 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Category</TableHead>
                        <TableHead className="text-right">Bales</TableHead>
                        <TableHead className="text-right">KG</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {kpis.categories.map((cat, i) => (
                        <TableRow key={i} data-testid={`row-category-${i}`}>
                          <TableCell className="text-sm font-medium">{cat.name}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{cat.count}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{fmt(cat.totalKg, 2)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CollapsiblePane>
          </CardContent>
        </Card>
      </div>

      {/* ── Stock Summary ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Opening Stock</p>
            </div>
            <p className="text-2xl font-bold font-mono" data-testid="text-opening-stock">
              {fmt(kpis?.openingStockKg ?? 0, 1)} <span className="text-sm font-normal text-muted-foreground">kg</span>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingDown className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Closing Stock</p>
            </div>
            <p className="text-2xl font-bold font-mono" data-testid="text-closing-stock">
              {fmt(kpis?.closingStockKg ?? 0, 1)} <span className="text-sm font-normal text-muted-foreground">kg</span>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
