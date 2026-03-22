import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Package,
  Trash2,
  ShoppingCart,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Layers,
} from "lucide-react";

interface BucketRow {
  productId: number | null;
  productName: string;
  articleCode: string;
  categoryName: string;
  baleCount: number;
  totalWeightKg: number;
  totalCost: number;
}

interface SectionTotal {
  baleCount: number;
  totalWeightKg: number;
  totalCost: number;
}

interface LedgerData {
  currentStock: BucketRow[];
  wasteStock: BucketRow[];
  sold: BucketRow[];
  wasteDispatched: BucketRow[];
  totals: {
    currentStock: SectionTotal;
    wasteStock: SectionTotal;
    sold: SectionTotal;
    wasteDispatched: SectionTotal;
    grand: SectionTotal;
  };
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}
function fmtKg(n: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(n);
}
function fmtN(n: number) {
  return new Intl.NumberFormat("en-US").format(n);
}

interface SectionProps {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  badgeColor: string;
  rows: BucketRow[];
  total: SectionTotal;
  defaultOpen?: boolean;
}

function SectionTable({ title, subtitle, icon, badgeColor, rows, total, defaultOpen = false }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader
            className="cursor-pointer hover-elevate select-none"
            data-testid={`section-toggle-${title.replace(/\s+/g, "-").toLowerCase()}`}
          >
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                {open ? (
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                )}
                <div className="flex items-center gap-2">
                  {icon}
                  <div>
                    <CardTitle className="text-base">{title}</CardTitle>
                    <p className="text-xs text-muted-foreground font-normal mt-0.5">{subtitle}</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4 text-sm flex-wrap">
                <Badge variant="outline" className={`text-xs ${badgeColor}`}>
                  {fmtN(total.baleCount)} bales
                </Badge>
                <span className="text-muted-foreground text-xs">
                  {fmtKg(total.totalWeightKg)} kg
                </span>
                <span className="font-medium text-xs">
                  {fmt(total.totalCost)}
                </span>
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
                    <TableHead>Product</TableHead>
                    <TableHead>Article Code</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Bales</TableHead>
                    <TableHead className="text-right">Weight (kg)</TableHead>
                    <TableHead className="text-right">Total Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r, i) => (
                    <TableRow key={`${r.productId ?? "null"}-${i}`} data-testid={`row-product-${r.productId ?? i}`}>
                      <TableCell className="font-medium text-sm">{r.productName}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {r.articleCode}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {r.categoryName}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-sm">{fmtN(r.baleCount)}</TableCell>
                      <TableCell className="text-right text-sm">{fmtKg(r.totalWeightKg)}</TableCell>
                      <TableCell className="text-right text-sm">{fmt(r.totalCost)}</TableCell>
                    </TableRow>
                  ))}
                  {/* Section subtotal */}
                  <TableRow className="bg-muted/30 font-semibold">
                    <TableCell colSpan={3} className="text-sm">
                      Subtotal
                    </TableCell>
                    <TableCell className="text-right text-sm">{fmtN(total.baleCount)}</TableCell>
                    <TableCell className="text-right text-sm">{fmtKg(total.totalWeightKg)}</TableCell>
                    <TableCell className="text-right text-sm">{fmt(total.totalCost)}</TableCell>
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

export default function BaleLedger() {
  const { data, isLoading, refetch, isFetching } = useQuery<LedgerData>({
    queryKey: ["/api/factory/bale-ledger"],
    queryFn: async () => {
      const r = await fetch("/api/factory/bale-ledger", { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    staleTime: 30_000,
  });

  const grand = data?.totals.grand;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-6 py-4 border-b flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Layers className="w-5 h-5" />
            Bale Production Ledger
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Complete lifecycle view — stock in hand, wipers/garbages, sold, and waste
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => refetch()}
          disabled={isFetching}
          data-testid="button-refresh"
          className="gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-6 w-64" />
                  <Skeleton className="h-4 w-48 mt-1" />
                </CardHeader>
              </Card>
            ))}
          </div>
        ) : (
          <>
            {/* Table 1: Current Stock */}
            <SectionTable
              title="Current Stock — In Hand"
              subtitle="Bales in stock (IN_STOCK / FINALIZED), excluding wipers and garbages"
              icon={<Package className="w-4 h-4 text-green-600" />}
              badgeColor="text-green-700 border-green-200"
              rows={data?.currentStock || []}
              total={data?.totals.currentStock || { baleCount: 0, totalWeightKg: 0, totalCost: 0 }}
              defaultOpen
            />

            {/* Table 2: Wipers & Garbages */}
            <SectionTable
              title="Wipers & Garbages — In Hand"
              subtitle="Waste-category bales currently in stock (IN_STOCK / FINALIZED)"
              icon={<AlertTriangle className="w-4 h-4 text-amber-500" />}
              badgeColor="text-amber-700 border-amber-200"
              rows={data?.wasteStock || []}
              total={data?.totals.wasteStock || { baleCount: 0, totalWeightKg: 0, totalCost: 0 }}
              defaultOpen
            />

            {/* Table 3: Sold */}
            <SectionTable
              title="Stock Sold"
              subtitle="Bales that have been dispatched and sold to customers"
              icon={<ShoppingCart className="w-4 h-4 text-blue-600" />}
              badgeColor="text-blue-700 border-blue-200"
              rows={data?.sold || []}
              total={data?.totals.sold || { baleCount: 0, totalWeightKg: 0, totalCost: 0 }}
              defaultOpen
            />

            {/* Table 4: Waste Dispatched */}
            <SectionTable
              title="Waste Dispatched"
              subtitle="Bales removed from stock via waste disposal (Waste Dispatch records)"
              icon={<Trash2 className="w-4 h-4 text-destructive" />}
              badgeColor="text-destructive border-destructive/30"
              rows={data?.wasteDispatched || []}
              total={data?.totals.wasteDispatched || { baleCount: 0, totalWeightKg: 0, totalCost: 0 }}
              defaultOpen
            />

            {/* Table 5: Grand Total */}
            {grand && (
              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div>
                      <p className="font-bold text-base">Total Production (All Time)</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Sum of tables 1 + 2 + 3 + 4 — tracks the complete production output
                      </p>
                    </div>
                    <div className="flex items-center gap-6 flex-wrap">
                      <div className="text-center">
                        <p className="text-2xl font-bold" data-testid="grand-total-bales">
                          {fmtN(grand.baleCount)}
                        </p>
                        <p className="text-xs text-muted-foreground">total bales</p>
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-bold" data-testid="grand-total-weight">
                          {fmtKg(grand.totalWeightKg)}
                        </p>
                        <p className="text-xs text-muted-foreground">kg produced</p>
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-bold" data-testid="grand-total-cost">
                          {fmt(grand.totalCost)}
                        </p>
                        <p className="text-xs text-muted-foreground">total cost</p>
                      </div>
                    </div>
                  </div>

                  {/* Breakdown row */}
                  {data && (
                    <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 border-t pt-4 sm:grid-cols-4">
                      {[
                        {
                          label: "In Hand (Regular)",
                          bales: data.totals.currentStock.baleCount,
                          kg: data.totals.currentStock.totalWeightKg,
                          color: "text-green-600",
                        },
                        {
                          label: "In Hand (Waste Cat.)",
                          bales: data.totals.wasteStock.baleCount,
                          kg: data.totals.wasteStock.totalWeightKg,
                          color: "text-amber-600",
                        },
                        {
                          label: "Sold",
                          bales: data.totals.sold.baleCount,
                          kg: data.totals.sold.totalWeightKg,
                          color: "text-blue-600",
                        },
                        {
                          label: "Waste Dispatched",
                          bales: data.totals.wasteDispatched.baleCount,
                          kg: data.totals.wasteDispatched.totalWeightKg,
                          color: "text-destructive",
                        },
                      ].map((s) => (
                        <div key={s.label} className="text-sm">
                          <p className={`font-medium ${s.color}`}>{s.label}</p>
                          <p className="text-muted-foreground text-xs">
                            {fmtN(s.bales)} bales · {fmtKg(s.kg)} kg
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
