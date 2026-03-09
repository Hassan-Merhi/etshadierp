import { useState } from "react";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2, Package, Users, Truck, AlertTriangle, Activity, Scale, Trash2,
  ChevronDown, ChevronUp, Ship, DollarSign, TrendingUp, TrendingDown, Boxes, Tag
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

interface DashboardData {
  today: { kgPressed: number; balesProduced: number; wasteKg: number };
  workers: { active: number; totalBalesToday: number };
  containers: { total: number; missingDocs: number };
  freight: { unpaidCount: number; partialCount: number; totalOwed: number };
  recentActivity: Array<{ id?: number; date: string; txType: string; description: string }>;
}

interface KpiData {
  openingStockKg: string;
  closingStockKg: string;
  balesPressedToday: number;
  kgsUsedToday: string;
  totalBaleWeightToday: string;
  categories: Array<{ name: string; count: number; totalKg: number }>;
  balesDetail: Array<{ id: number; baleCode: string; productName: string; category: string; weightKg: string; pressedAt: string; status: string }>;
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
  const { formatDisplayDate } = useDateFormat();
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

      {/* ── Row 1: Production KPIs ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Scale className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">KG Pressed</p>
            </div>
            <p className="text-2xl font-bold font-mono" data-testid="text-kg-pressed">
              {fmt(data?.today?.kgPressed ?? 0, 1)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Package className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Bales Produced</p>
            </div>
            <p className="text-2xl font-bold font-mono" data-testid="text-bales-produced">
              {data?.today?.balesProduced ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Trash2 className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Waste</p>
            </div>
            <p className="text-2xl font-bold font-mono" data-testid="text-waste-kg">
              {fmt(data?.today?.wasteKg ?? 0, 1)} <span className="text-sm font-normal text-muted-foreground">kg</span>
            </p>
          </CardContent>
        </Card>
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
      </div>

      {/* ── Row 2: Ops cards ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Package className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Containers</p>
            </div>
            <p className="text-2xl font-bold font-mono" data-testid="text-containers-total">
              {data?.containers?.total ?? 0} <span className="text-sm font-normal text-muted-foreground">total</span>
            </p>
            <p className="text-sm mt-1" data-testid="text-containers-missing-docs">
              {(data?.containers?.missingDocs ?? 0) > 0 ? (
                <span className="text-destructive flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  {data?.containers?.missingDocs} missing docs
                </span>
              ) : (
                <span className="text-muted-foreground">No missing docs</span>
              )}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Truck className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Freight</p>
            </div>
            <div className="flex items-center gap-2 mt-1" data-testid="text-freight-summary">
              <Badge variant="outline">{data?.freight?.unpaidCount ?? 0} unpaid</Badge>
              <Badge variant="outline">{data?.freight?.partialCount ?? 0} partial</Badge>
            </div>
            {(data?.freight?.totalOwed ?? 0) > 0 && (
              <p className="text-sm text-muted-foreground mt-1">${fmt(data!.freight.totalOwed, 2)} owed</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Workers Today</p>
            </div>
            <p className="text-2xl font-bold font-mono" data-testid="text-workers-bales-today">
              {data?.workers?.totalBalesToday ?? 0} <span className="text-sm font-normal text-muted-foreground">bales</span>
            </p>
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
                        <TableHead>Code</TableHead>
                        <TableHead>Product</TableHead>
                        <TableHead className="text-right">KG</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {kpis.balesDetail.map((b, i) => (
                        <TableRow key={b.id ?? i} data-testid={`row-bale-${b.id ?? i}`}>
                          <TableCell className="font-mono text-xs">{b.baleCode}</TableCell>
                          <TableCell className="text-sm">{b.productName || b.category || "—"}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{fmt(b.weightKg, 2)}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">{b.status}</Badge>
                          </TableCell>
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

      {/* ── Recent Activity ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!data?.recentActivity || data.recentActivity.length === 0 ? (
            <div className="text-center py-8">
              <Activity className="mx-auto h-10 w-10 text-muted-foreground" />
              <p className="text-muted-foreground mt-2">No recent activity</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recentActivity.map((entry, idx) => (
                    <TableRow key={entry.id ?? idx} data-testid={`row-activity-${entry.id ?? idx}`}>
                      <TableCell className="font-mono text-sm">{entry.date ? formatDisplayDate(entry.date) : "—"}</TableCell>
                      <TableCell><Badge variant="outline">{entry.txType}</Badge></TableCell>
                      <TableCell className="text-muted-foreground">{entry.description}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
