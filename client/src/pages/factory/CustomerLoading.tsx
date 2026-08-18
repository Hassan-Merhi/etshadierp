import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, PackageCheck, PackageX, Search, ShoppingCart, Truck, UsersRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface CustomerOption { id: number; legalName: string; code?: string | null; }
interface CustomerLoadingProduct {
  id: number; code: string; articleCode: string | null; name: string; nameAr: string | null;
  categoryId: number | null; categoryName: string | null; categoryNameAr: string | null;
  weightPerBaleKg: string | null; sellingPrice: string | null; productionPrice: string | null; active: boolean;
  totalBalesLoaded: number; totalKgLoaded: number; loadingCount: number; lastLoadedAt: string | null;
  loadingStatus: "LOADED" | "NEVER_LOADED";
}
interface CustomerLoadingResponse {
  customer: { id: number; legalName: string };
  summary: { totalProducts: number; loadedProducts: number; neverLoadedProducts: number; productCoveragePct: number; totalBalesLoaded: number; totalKgLoaded: number; };
  products: CustomerLoadingProduct[];
}
type LoadingFilter = "ALL" | "LOADED" | "NEVER_LOADED";

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || "Request failed");
  return payload as T;
}
function formatNumber(value: number, maximumFractionDigits = 0) { return new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(value || 0); }
function formatMoney(value: number | string | null) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount);
}
function formatDate(value: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "2-digit" }).format(date);
}

export default function CustomerLoading() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [customerId, setCustomerId] = useState("");
  const [search, setSearch] = useState("");
  const [loadingFilter, setLoadingFilter] = useState<LoadingFilter>("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [weightFilter, setWeightFilter] = useState("ALL");
  const [selectedProductIds, setSelectedProductIds] = useState<Set<number>>(new Set());
  const [draftQuantities, setDraftQuantities] = useState<Record<number, string>>({});
  const [draftPrices, setDraftPrices] = useState<Record<number, string>>({});
  const [previewOpen, setPreviewOpen] = useState(false);
  const [proformaName, setProformaName] = useState("");

  const customersQuery = useQuery<CustomerOption[]>({
    queryKey: ["/api/factory/customers", "customer-loading-picker"],
    queryFn: () => readJson<CustomerOption[]>("/api/factory/customers"), staleTime: 60_000,
  });
  const loadingQuery = useQuery<CustomerLoadingResponse>({
    queryKey: ["/api/factory/customer-loading/products", customerId],
    queryFn: () => readJson<CustomerLoadingResponse>(`/api/factory/customer-loading/products?customerId=${encodeURIComponent(customerId)}`),
    enabled: Boolean(customerId), staleTime: 30_000,
  });

  const products = loadingQuery.data?.products ?? [];
  const categories = useMemo(() => [...new Set(products.map((p) => p.categoryName).filter((v): v is string => Boolean(v)))].sort((a, b) => a.localeCompare(b)), [products]);
  const weights = useMemo(() => [...new Set(products.map((p) => p.weightPerBaleKg).filter((v): v is string => Boolean(v)))].sort((a, b) => Number(a) - Number(b)), [products]);
  const filteredProducts = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return products.filter((product) => {
      if (loadingFilter !== "ALL" && product.loadingStatus !== loadingFilter) return false;
      if (categoryFilter !== "ALL" && product.categoryName !== categoryFilter) return false;
      if (weightFilter !== "ALL" && product.weightPerBaleKg !== weightFilter) return false;
      if (!needle) return true;
      return [product.name, product.nameAr, product.code, product.articleCode, product.categoryName].filter(Boolean).some((value) => String(value).toLocaleLowerCase().includes(needle));
    });
  }, [products, loadingFilter, categoryFilter, weightFilter, search]);

  const selectedLines = useMemo(() => products.filter((p) => selectedProductIds.has(p.id)).map((product) => {
    const quantity = Math.max(0, Number.parseInt(draftQuantities[product.id] || "0", 10) || 0);
    const rawPrice = draftPrices[product.id] ?? product.sellingPrice ?? "0";
    const parsedPrice = Number(rawPrice);
    const pricePerBale = Number.isFinite(parsedPrice) && parsedPrice >= 0 ? parsedPrice : 0;
    const weightPerBale = Number(product.weightPerBaleKg ?? 0) || 0;
    return { product, quantity, pricePerBale, priceValid: rawPrice !== "" && Number.isFinite(parsedPrice) && parsedPrice >= 0, totalKg: quantity * weightPerBale, lineTotal: quantity * pricePerBale };
  }), [products, selectedProductIds, draftQuantities, draftPrices]);
  const validSelectedLines = selectedLines.filter((line) => line.quantity > 0 && line.priceValid && Boolean(line.product.articleCode || line.product.code));
  const hasInvalidSelectedLine = selectedLines.some((line) => line.quantity <= 0 || !line.priceValid || !Boolean(line.product.articleCode || line.product.code));
  const selectedTotals = validSelectedLines.reduce((t, line) => ({ lines: t.lines + 1, quantity: t.quantity + line.quantity, kg: t.kg + line.totalKg, amount: t.amount + line.lineTotal }), { lines: 0, quantity: 0, kg: 0, amount: 0 });

  const createProformaMutation = useMutation({
    mutationFn: async () => {
      if (!customerId || validSelectedLines.length === 0 || hasInvalidSelectedLine) throw new Error("Every selected product needs a quantity and a valid non-negative price.");
      const name = proformaName.trim();
      if (!name) throw new Error("Proforma name is required.");
      const response = await apiRequest("POST", "/api/factory/customer-proformas/bulk", {
        customerId: Number(customerId), name, isActive: true,
        lines: validSelectedLines.map(({ product, quantity, pricePerBale }) => ({
          articleCode: product.articleCode || product.code, productName: product.name, quantity,
          pricePerBale: String(pricePerBale), productionPricePerBale: String(product.productionPrice ?? "0"), pricingMode: "per_bale",
        })),
      });
      return response.json();
    },
    onSuccess: (created) => {
      setPreviewOpen(false); setSelectedProductIds(new Set()); setDraftQuantities({}); setDraftPrices({}); setProformaName("");
      void queryClient.invalidateQueries({ queryKey: ["/api/factory/customer-proformas"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/factory/v2/stock-allocation"] });
      toast({ title: "Proforma created", description: created?.name ? `${created.name} was created successfully.` : "The proforma was created successfully." });
    },
    onError: (error: Error) => toast({ title: "Failed to create proforma", description: error.message, variant: "destructive" }),
  });

  const summary = loadingQuery.data?.summary;
  const allVisibleSelected = filteredProducts.length > 0 && filteredProducts.every((p) => selectedProductIds.has(p.id));
  function resetSelection() { setSelectedProductIds(new Set()); setDraftQuantities({}); setDraftPrices({}); }
  function toggleProduct(product: CustomerLoadingProduct, checked: boolean) {
    setSelectedProductIds((current) => { const next = new Set(current); checked ? next.add(product.id) : next.delete(product.id); return next; });
    if (checked && !draftQuantities[product.id]) setDraftQuantities((current) => ({ ...current, [product.id]: "1" }));
  }
  function openPreview() {
    if (validSelectedLines.length === 0 || hasInvalidSelectedLine) {
      toast({ title: "Check selected products", description: "Every selected product needs a quantity and a valid non-negative price.", variant: "destructive" });
      return;
    }
    if (!proformaName.trim()) setProformaName(`${loadingQuery.data?.customer.legalName || "Customer"} - ${new Date().toISOString().slice(0, 10)}`);
    setPreviewOpen(true);
  }

  return (
    <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-5 p-4 pb-24 md:p-6 md:pb-24" data-testid="customer-loading-page">
      <div className="flex flex-col gap-1"><h1 className="text-2xl font-semibold tracking-tight">Customer Loading</h1><p className="text-sm text-muted-foreground">See which bale products each customer has loaded before, select items, enter quantities, and create a proforma directly.</p></div>
      <Card><CardContent className="grid gap-4 p-4 lg:grid-cols-[minmax(280px,420px)_1fr] lg:items-end">
        <div className="space-y-2"><div className="text-sm font-medium">Customer</div><Select value={customerId} onValueChange={(value) => { setCustomerId(value); setSearch(""); setLoadingFilter("ALL"); setCategoryFilter("ALL"); setWeightFilter("ALL"); resetSelection(); setProformaName(""); }}><SelectTrigger data-testid="customer-loading-customer-select"><SelectValue placeholder={customersQuery.isLoading ? "Loading customers…" : "Choose a customer"} /></SelectTrigger><SelectContent>{(customersQuery.data ?? []).map((customer) => <SelectItem key={customer.id} value={String(customer.id)}>{customer.legalName}{customer.code ? ` · ${customer.code}` : ""}</SelectItem>)}</SelectContent></Select></div>
        <div className="text-sm text-muted-foreground lg:text-right">{loadingQuery.data?.customer ? `Viewing product history for ${loadingQuery.data.customer.legalName}` : "Select a customer to begin"}</div>
      </CardContent></Card>

      {!customerId ? <Card><CardContent className="flex min-h-[300px] flex-col items-center justify-center gap-3 p-8 text-center"><div className="rounded-full bg-muted p-4"><UsersRound className="h-7 w-7 text-muted-foreground" /></div><div><div className="font-medium">Choose a customer</div><div className="mt-1 text-sm text-muted-foreground">Their loaded and never-loaded products will appear here.</div></div></CardContent></Card>
      : loadingQuery.isLoading ? <div className="flex min-h-[320px] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-muted-foreground" /></div>
      : loadingQuery.isError ? <Card><CardContent className="p-6 text-sm text-destructive">{(loadingQuery.error as Error).message}</CardContent></Card>
      : <>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Card><CardContent className="flex items-center gap-3 p-4"><div className="rounded-lg bg-muted p-2"><Truck className="h-5 w-5" /></div><div><div className="text-xs text-muted-foreground">Total Products</div><div className="text-xl font-semibold">{formatNumber(summary?.totalProducts ?? 0)}</div></div></CardContent></Card>
          <Card><CardContent className="flex items-center gap-3 p-4"><div className="rounded-lg bg-muted p-2"><PackageCheck className="h-5 w-5" /></div><div><div className="text-xs text-muted-foreground">Loaded Products</div><div className="text-xl font-semibold">{formatNumber(summary?.loadedProducts ?? 0)}</div></div></CardContent></Card>
          <Card><CardContent className="flex items-center gap-3 p-4"><div className="rounded-lg bg-muted p-2"><PackageX className="h-5 w-5" /></div><div><div className="text-xs text-muted-foreground">Never Loaded</div><div className="text-xl font-semibold">{formatNumber(summary?.neverLoadedProducts ?? 0)}</div></div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Product Coverage</div><div className="text-xl font-semibold">{formatNumber(summary?.productCoveragePct ?? 0, 1)}%</div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${Math.min(100, summary?.productCoveragePct ?? 0)}%` }} /></div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Total Bales Loaded</div><div className="text-xl font-semibold">{formatNumber(summary?.totalBalesLoaded ?? 0)}</div><div className="mt-1 text-xs text-muted-foreground">{formatNumber(summary?.totalKgLoaded ?? 0, 1)} kg</div></CardContent></Card>
        </div>
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-3 border-b p-4 xl:flex-row xl:items-center xl:justify-between"><div><div className="font-semibold">Product List</div><div className="text-xs text-muted-foreground">{filteredProducts.length} of {products.length} products shown · {selectedProductIds.size} selected</div></div><div className="grid gap-2 sm:grid-cols-2 xl:flex xl:items-center">
            <div className="relative sm:col-span-2 xl:w-72"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, Arabic, or code" className="pl-9" data-testid="customer-loading-search" /></div>
            <Select value={loadingFilter} onValueChange={(v) => setLoadingFilter(v as LoadingFilter)}><SelectTrigger className="xl:w-44" data-testid="customer-loading-status-filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">All statuses</SelectItem><SelectItem value="LOADED">Loaded</SelectItem><SelectItem value="NEVER_LOADED">Never loaded</SelectItem></SelectContent></Select>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}><SelectTrigger className="xl:w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">All categories</SelectItem>{categories.map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent></Select>
            <Select value={weightFilter} onValueChange={setWeightFilter}><SelectTrigger className="xl:w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">All weights</SelectItem>{weights.map((weight) => <SelectItem key={weight} value={weight}>{formatNumber(Number(weight), 2)} kg</SelectItem>)}</SelectContent></Select>
          </div></div>
          <div className="max-h-[62vh] overflow-auto"><table className="w-full min-w-[1420px] border-collapse text-sm"><thead className="sticky top-0 z-10 bg-card shadow-[0_1px_0_hsl(var(--border))]"><tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="w-12 px-4 py-3"><Checkbox checked={allVisibleSelected} onCheckedChange={(checked) => { const select = checked === true; setSelectedProductIds((current) => { const next = new Set(current); for (const product of filteredProducts) select ? next.add(product.id) : next.delete(product.id); return next; }); if (select) setDraftQuantities((current) => { const next = { ...current }; for (const product of filteredProducts) if (!next[product.id]) next[product.id] = "1"; return next; }); }} aria-label="Select visible products" /></th>
            <th className="px-4 py-3 font-medium">Article Code</th><th className="px-4 py-3 font-medium">Product</th><th className="px-4 py-3 font-medium">Arabic Name</th><th className="px-4 py-3 font-medium">Category</th><th className="px-4 py-3 text-right font-medium">Wt/Bale</th><th className="px-4 py-3 text-right font-medium">Sell Price</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 text-right font-medium">Total Loaded</th><th className="px-4 py-3 font-medium">Last Loaded</th><th className="px-4 py-3 text-right font-medium">Qty</th><th className="px-4 py-3 text-right font-medium">Line Total</th>
          </tr></thead><tbody>{filteredProducts.map((product) => { const selected = selectedProductIds.has(product.id); const qty = Number.parseInt(draftQuantities[product.id] || "0", 10) || 0; const rawPrice = draftPrices[product.id] ?? product.sellingPrice ?? "0"; const price = Number(rawPrice); const priceValid = rawPrice !== "" && Number.isFinite(price) && price >= 0; return <tr key={product.id} className={`border-b last:border-b-0 hover:bg-muted/30 ${selected ? "bg-primary/5" : ""}`} data-testid={`customer-loading-product-${product.id}`}>
            <td className="px-4 py-3"><Checkbox checked={selected} onCheckedChange={(checked) => toggleProduct(product, checked === true)} aria-label={`Select ${product.name}`} /></td><td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{product.articleCode || product.code}</td><td className="px-4 py-3 font-medium">{product.name}</td><td className="px-4 py-3 text-right" dir="rtl">{product.nameAr || "—"}</td><td className="px-4 py-3 text-muted-foreground">{product.categoryName || "—"}</td><td className="px-4 py-3 text-right tabular-nums">{product.weightPerBaleKg ? `${formatNumber(Number(product.weightPerBaleKg), 2)} kg` : "—"}</td>
            <td className="px-4 py-2 text-right"><Input inputMode="decimal" value={rawPrice} onChange={(e) => { const value = e.target.value.replace(/[^0-9.]/g, ""); setDraftPrices((current) => ({ ...current, [product.id]: value })); if (value && !selected) toggleProduct(product, true); }} className={`ml-auto h-8 w-24 text-right tabular-nums ${selected && !priceValid ? "border-destructive" : ""}`} aria-label={`Price for ${product.name}`} /></td>
            <td className="px-4 py-3">{product.loadingStatus === "LOADED" ? <Badge variant="secondary">Loaded</Badge> : <Badge variant="outline">Never loaded</Badge>}</td><td className="px-4 py-3 text-right font-medium tabular-nums">{formatNumber(product.totalBalesLoaded)}</td><td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDate(product.lastLoadedAt)}</td>
            <td className="px-4 py-2 text-right"><Input inputMode="numeric" min={0} value={draftQuantities[product.id] ?? ""} onChange={(e) => { const value = e.target.value.replace(/[^0-9]/g, ""); setDraftQuantities((current) => ({ ...current, [product.id]: value })); const numeric = Number.parseInt(value || "0", 10) || 0; if (numeric > 0 && !selected) toggleProduct(product, true); if (numeric === 0 && selected) setSelectedProductIds((current) => { const next = new Set(current); next.delete(product.id); return next; }); }} placeholder="0" className="ml-auto h-8 w-20 text-right tabular-nums" aria-label={`Quantity for ${product.name}`} /></td><td className="px-4 py-3 text-right font-medium tabular-nums">{qty > 0 && priceValid ? formatMoney(qty * price) : "—"}</td>
          </tr>; })}</tbody></table>{filteredProducts.length === 0 && <div className="p-10 text-center text-sm text-muted-foreground">No products match the current filters.</div>}</div>
        </Card>
      </>}

      {customerId && selectedProductIds.size > 0 && <div className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 px-4 py-3 shadow-lg backdrop-blur md:px-6" data-testid="customer-loading-selection-bar"><div className="mx-auto flex max-w-[1800px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm"><span><strong>{selectedTotals.lines}</strong> products</span><span><strong>{formatNumber(selectedTotals.quantity)}</strong> bales</span><span><strong>{formatNumber(selectedTotals.kg, 1)}</strong> kg</span><span>Total <strong>{formatMoney(selectedTotals.amount)}</strong></span>{hasInvalidSelectedLine && <span className="text-destructive">Complete selected quantities/prices</span>}</div><div className="flex gap-2"><Button variant="outline" onClick={resetSelection}>Clear</Button><Button onClick={openPreview} disabled={validSelectedLines.length === 0 || hasInvalidSelectedLine} data-testid="customer-loading-create-proforma"><ShoppingCart className="mr-2 h-4 w-4" /> Create Proforma</Button></div></div></div>}

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}><DialogContent className="max-w-4xl"><DialogHeader><DialogTitle>Review Proforma</DialogTitle><DialogDescription>Confirm the customer, quantities, prices, and totals before creating the proforma.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>Customer</Label><Input value={loadingQuery.data?.customer.legalName || ""} disabled /></div><div className="space-y-2"><Label htmlFor="customer-loading-proforma-name">Proforma Name</Label><Input id="customer-loading-proforma-name" value={proformaName} onChange={(e) => setProformaName(e.target.value)} data-testid="customer-loading-proforma-name" /></div></div><div className="max-h-[45vh] overflow-auto rounded-md border"><table className="w-full min-w-[720px] text-sm"><thead className="sticky top-0 bg-muted"><tr><th className="px-3 py-2 text-left">Product</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">KG</th><th className="px-3 py-2 text-right">Price</th><th className="px-3 py-2 text-right">Total</th></tr></thead><tbody>{validSelectedLines.map((line) => <tr key={line.product.id} className="border-t"><td className="px-3 py-2"><div className="font-medium">{line.product.name}</div><div className="text-xs text-muted-foreground">{line.product.articleCode || line.product.code}</div></td><td className="px-3 py-2 text-right tabular-nums">{formatNumber(line.quantity)}</td><td className="px-3 py-2 text-right tabular-nums">{formatNumber(line.totalKg, 1)}</td><td className="px-3 py-2 text-right tabular-nums">{formatMoney(line.pricePerBale)}</td><td className="px-3 py-2 text-right font-medium tabular-nums">{formatMoney(line.lineTotal)}</td></tr>)}</tbody><tfoot className="border-t bg-muted/40 font-medium"><tr><td className="px-3 py-3">Grand Total</td><td className="px-3 py-3 text-right">{formatNumber(selectedTotals.quantity)}</td><td className="px-3 py-3 text-right">{formatNumber(selectedTotals.kg, 1)}</td><td></td><td className="px-3 py-3 text-right">{formatMoney(selectedTotals.amount)}</td></tr></tfoot></table></div><DialogFooter><Button variant="outline" onClick={() => setPreviewOpen(false)} disabled={createProformaMutation.isPending}>Back</Button><Button onClick={() => createProformaMutation.mutate()} disabled={!proformaName.trim() || createProformaMutation.isPending} data-testid="customer-loading-confirm-proforma">{createProformaMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create Proforma</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}
