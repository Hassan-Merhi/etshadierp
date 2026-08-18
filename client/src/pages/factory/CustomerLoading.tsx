import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, PackageCheck, PackageX, Search, Truck, UsersRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface CustomerOption {
  id: number;
  legalName: string;
  code?: string | null;
}

interface CustomerLoadingProduct {
  id: number;
  code: string;
  articleCode: string | null;
  name: string;
  nameAr: string | null;
  categoryId: number | null;
  categoryName: string | null;
  categoryNameAr: string | null;
  weightPerBaleKg: string | null;
  sellingPrice: string | null;
  productionPrice: string | null;
  active: boolean;
  totalBalesLoaded: number;
  totalKgLoaded: number;
  loadingCount: number;
  lastLoadedAt: string | null;
  loadingStatus: "LOADED" | "NEVER_LOADED";
}

interface CustomerLoadingResponse {
  customer: { id: number; legalName: string };
  summary: {
    totalProducts: number;
    loadedProducts: number;
    neverLoadedProducts: number;
    productCoveragePct: number;
    totalBalesLoaded: number;
    totalKgLoaded: number;
  };
  products: CustomerLoadingProduct[];
}

type LoadingFilter = "ALL" | "LOADED" | "NEVER_LOADED";

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || "Request failed");
  return payload as T;
}

function formatNumber(value: number, maximumFractionDigits = 0) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(value || 0);
}

function formatMoney(value: string | null) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(amount);
}

function formatDate(value: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "2-digit" }).format(date);
}

export default function CustomerLoading() {
  const [customerId, setCustomerId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [loadingFilter, setLoadingFilter] = useState<LoadingFilter>("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [weightFilter, setWeightFilter] = useState("ALL");
  const [draftQuantities, setDraftQuantities] = useState<Record<number, string>>({});

  const customersQuery = useQuery<CustomerOption[]>({
    queryKey: ["/api/factory/customers", "customer-loading-picker"],
    queryFn: () => readJson<CustomerOption[]>("/api/factory/customers"),
    staleTime: 60_000,
  });

  const loadingQuery = useQuery<CustomerLoadingResponse>({
    queryKey: ["/api/factory/customer-loading/products", customerId],
    queryFn: () =>
      readJson<CustomerLoadingResponse>(`/api/factory/customer-loading/products?customerId=${encodeURIComponent(customerId)}`),
    enabled: Boolean(customerId),
    staleTime: 30_000,
  });

  const products = loadingQuery.data?.products ?? [];
  const categories = useMemo(
    () =>
      [...new Set(products.map((product) => product.categoryName).filter((value): value is string => Boolean(value)))]
        .sort((a, b) => a.localeCompare(b)),
    [products]
  );
  const weights = useMemo(
    () =>
      [...new Set(products.map((product) => product.weightPerBaleKg).filter((value): value is string => Boolean(value)))]
        .sort((a, b) => Number(a) - Number(b)),
    [products]
  );

  const filteredProducts = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return products.filter((product) => {
      if (loadingFilter !== "ALL" && product.loadingStatus !== loadingFilter) return false;
      if (categoryFilter !== "ALL" && product.categoryName !== categoryFilter) return false;
      if (weightFilter !== "ALL" && product.weightPerBaleKg !== weightFilter) return false;
      if (!needle) return true;
      return [product.name, product.nameAr, product.code, product.articleCode, product.categoryName]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase().includes(needle));
    });
  }, [products, loadingFilter, categoryFilter, weightFilter, search]);

  const summary = loadingQuery.data?.summary;

  return (
    <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-5 p-4 md:p-6" data-testid="customer-loading-page">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Customer Loading</h1>
        <p className="text-sm text-muted-foreground">
          See which bale products each customer has loaded before and prepare quantities for the next proforma.
        </p>
      </div>

      <Card>
        <CardContent className="grid gap-4 p-4 lg:grid-cols-[minmax(280px,420px)_1fr] lg:items-end">
          <div className="space-y-2">
            <div className="text-sm font-medium">Customer</div>
            <Select
              value={customerId}
              onValueChange={(value) => {
                setCustomerId(value);
                setSearch("");
                setLoadingFilter("ALL");
                setCategoryFilter("ALL");
                setWeightFilter("ALL");
                setDraftQuantities({});
              }}
            >
              <SelectTrigger data-testid="customer-loading-customer-select">
                <SelectValue placeholder={customersQuery.isLoading ? "Loading customers…" : "Choose a customer"} />
              </SelectTrigger>
              <SelectContent>
                {(customersQuery.data ?? []).map((customer) => (
                  <SelectItem key={customer.id} value={String(customer.id)}>
                    {customer.legalName}{customer.code ? ` · ${customer.code}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="text-sm text-muted-foreground lg:text-right">
            {loadingQuery.data?.customer ? `Viewing product history for ${loadingQuery.data.customer.legalName}` : "Select a customer to begin"}
          </div>
        </CardContent>
      </Card>

      {!customerId ? (
        <Card>
          <CardContent className="flex min-h-[300px] flex-col items-center justify-center gap-3 p-8 text-center">
            <div className="rounded-full bg-muted p-4"><UsersRound className="h-7 w-7 text-muted-foreground" /></div>
            <div>
              <div className="font-medium">Choose a customer</div>
              <div className="mt-1 text-sm text-muted-foreground">Their loaded and never-loaded products will appear here.</div>
            </div>
          </CardContent>
        </Card>
      ) : loadingQuery.isLoading ? (
        <div className="flex min-h-[320px] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-muted-foreground" /></div>
      ) : loadingQuery.isError ? (
        <Card><CardContent className="p-6 text-sm text-destructive">{(loadingQuery.error as Error).message}</CardContent></Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Card><CardContent className="flex items-center gap-3 p-4"><div className="rounded-lg bg-muted p-2"><Truck className="h-5 w-5" /></div><div><div className="text-xs text-muted-foreground">Total Products</div><div className="text-xl font-semibold">{formatNumber(summary?.totalProducts ?? 0)}</div></div></CardContent></Card>
            <Card><CardContent className="flex items-center gap-3 p-4"><div className="rounded-lg bg-muted p-2"><PackageCheck className="h-5 w-5" /></div><div><div className="text-xs text-muted-foreground">Loaded Products</div><div className="text-xl font-semibold">{formatNumber(summary?.loadedProducts ?? 0)}</div></div></CardContent></Card>
            <Card><CardContent className="flex items-center gap-3 p-4"><div className="rounded-lg bg-muted p-2"><PackageX className="h-5 w-5" /></div><div><div className="text-xs text-muted-foreground">Never Loaded</div><div className="text-xl font-semibold">{formatNumber(summary?.neverLoadedProducts ?? 0)}</div></div></CardContent></Card>
            <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Product Coverage</div><div className="text-xl font-semibold">{formatNumber(summary?.productCoveragePct ?? 0, 1)}%</div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${Math.min(100, summary?.productCoveragePct ?? 0)}%` }} /></div></CardContent></Card>
            <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Total Bales Loaded</div><div className="text-xl font-semibold">{formatNumber(summary?.totalBalesLoaded ?? 0)}</div><div className="mt-1 text-xs text-muted-foreground">{formatNumber(summary?.totalKgLoaded ?? 0, 1)} kg</div></CardContent></Card>
          </div>

          <Card className="overflow-hidden">
            <div className="flex flex-col gap-3 border-b p-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <div className="font-semibold">Product List</div>
                <div className="text-xs text-muted-foreground">{filteredProducts.length} of {products.length} products shown</div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:flex xl:items-center">
                <div className="relative sm:col-span-2 xl:w-72">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, Arabic, or code" className="pl-9" data-testid="customer-loading-search" />
                </div>
                <Select value={loadingFilter} onValueChange={(value) => setLoadingFilter(value as LoadingFilter)}>
                  <SelectTrigger className="xl:w-44" data-testid="customer-loading-status-filter"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="ALL">All statuses</SelectItem><SelectItem value="LOADED">Loaded</SelectItem><SelectItem value="NEVER_LOADED">Never loaded</SelectItem></SelectContent>
                </Select>
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="xl:w-44"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="ALL">All categories</SelectItem>{categories.map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={weightFilter} onValueChange={setWeightFilter}>
                  <SelectTrigger className="xl:w-36"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="ALL">All weights</SelectItem>{weights.map((weight) => <SelectItem key={weight} value={weight}>{formatNumber(Number(weight), 2)} kg</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            <div className="max-h-[62vh] overflow-auto">
              <table className="w-full min-w-[1260px] border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-card shadow-[0_1px_0_hsl(var(--border))]">
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Article Code</th>
                    <th className="px-4 py-3 font-medium">Product</th>
                    <th className="px-4 py-3 font-medium">Arabic Name</th>
                    <th className="px-4 py-3 font-medium">Category</th>
                    <th className="px-4 py-3 text-right font-medium">Wt/Bale</th>
                    <th className="px-4 py-3 text-right font-medium">Sell Price</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 text-right font-medium">Total Loaded</th>
                    <th className="px-4 py-3 text-right font-medium">Total KG</th>
                    <th className="px-4 py-3 font-medium">Last Loaded</th>
                    <th className="px-4 py-3 text-right font-medium">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map((product) => (
                    <tr key={product.id} className="border-b last:border-b-0 hover:bg-muted/30" data-testid={`customer-loading-product-${product.id}`}>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{product.articleCode || product.code}</td>
                      <td className="px-4 py-3 font-medium">{product.name}</td>
                      <td className="px-4 py-3 text-right" dir="rtl">{product.nameAr || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{product.categoryName || "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{product.weightPerBaleKg ? `${formatNumber(Number(product.weightPerBaleKg), 2)} kg` : "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatMoney(product.sellingPrice)}</td>
                      <td className="px-4 py-3">{product.loadingStatus === "LOADED" ? <Badge variant="secondary">Loaded</Badge> : <Badge variant="outline">Never loaded</Badge>}</td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums">{formatNumber(product.totalBalesLoaded)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatNumber(product.totalKgLoaded, 1)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDate(product.lastLoadedAt)}</td>
                      <td className="px-4 py-2 text-right">
                        <Input
                          inputMode="numeric"
                          min={0}
                          value={draftQuantities[product.id] ?? ""}
                          onChange={(event) => {
                            const value = event.target.value.replace(/[^0-9]/g, "");
                            setDraftQuantities((current) => ({ ...current, [product.id]: value }));
                          }}
                          placeholder="0"
                          className="ml-auto h-8 w-20 text-right tabular-nums"
                          aria-label={`Quantity for ${product.name}`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredProducts.length === 0 && <div className="p-10 text-center text-sm text-muted-foreground">No products match the current filters.</div>}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
