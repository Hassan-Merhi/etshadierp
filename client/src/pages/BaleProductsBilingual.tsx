import { useEffect, useLayoutEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BaleProductArabicEditBridge } from "@/components/BaleProductArabicEditBridge";
import { FACTORY_CATALOG_LANGUAGE_EVENT } from "@/components/FactoryCatalogLanguageSwitch";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { getApiRequest } from "@/lib/factoryApi";
import { useAppMode } from "@/contexts/AppModeContext";
import type { FactoryCatalogLanguage } from "@shared/factoryBilingualContract";
import { readFactoryCatalogLanguagePreference } from "@/lib/factoryCatalogPreference";
import BaleProductsPage from "./BaleProducts";

type TranslationFilter = "all" | "complete" | "missing-product" | "missing-category";

interface BilingualProduct {
  name?: string | null;
  nameAr?: string | null;
  nameFr?: string | null;
  code?: string | null;
  articleCode?: string | null;
  categoryId?: number | null;
  categoryName?: string | null;
  categoryNameAr?: string | null;
  categoryNameFr?: string | null;
}

function matchesTranslationFilter(product: BilingualProduct, filter: TranslationFilter): boolean {
  const hasProduct = Boolean(product.nameAr?.trim());
  const hasCategory = !product.categoryId || Boolean(product.categoryNameAr?.trim());
  if (filter === "complete") return hasProduct && hasCategory;
  if (filter === "missing-product") return !hasProduct;
  if (filter === "missing-category") return Boolean(product.categoryId) && !hasCategory;
  return true;
}

function matchesCatalogSearch(product: BilingualProduct, search: string): boolean {
  const needle = search.trim().toLocaleLowerCase();
  if (!needle) return true;
  return [
    product.name,
    product.nameAr,
    product.nameFr,
    product.code,
    product.articleCode,
    product.categoryName,
    product.categoryNameAr,
    product.categoryNameFr,
  ].some((value) => value?.toLocaleLowerCase().includes(needle));
}

function CatalogFetchBoundary({
  language,
  search,
  translationFilter,
}: {
  language: FactoryCatalogLanguage;
  search: string;
  translationFilter: TranslationFilter;
}) {
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const originalFetch = window.fetch;
    const patchedFetch: typeof window.fetch = async (input, init) => {
      const requestMethod = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (requestMethod !== "GET") return originalFetch(input, init);
      const rawUrl = typeof input === "string" || input instanceof URL ? input.toString() : input.url;
      const parsed = new URL(rawUrl, window.location.origin);
      const isRelative = rawUrl.startsWith("/");

      if (parsed.pathname === "/api/factory/bale-products") {
        // Phase 4 bandwidth fix: search/status filters are presentation state,
        // not different server datasets. Fetch one language-specific catalog
        // representation and filter it locally so typing does not create a new
        // large HTTP response for every debounced search term.
        parsed.searchParams.delete("q");
        parsed.searchParams.set("lang", language);
        const response = await originalFetch(
          isRelative ? `${parsed.pathname}${parsed.search}` : parsed.toString(),
          init
        );
        if (!response.ok || (!search && translationFilter === "all")) return response;

        const products = (await response.clone().json()) as BilingualProduct[];
        const filtered = products.filter(
          (product) =>
            matchesCatalogSearch(product, search) && matchesTranslationFilter(product, translationFilter)
        );
        const headers = new Headers(response.headers);
        headers.set("content-type", "application/json; charset=utf-8");
        headers.delete("content-length");
        return new Response(JSON.stringify(filtered), {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      }

      if (parsed.pathname === "/api/factory/categories") {
        parsed.searchParams.set("lang", language);
        return originalFetch(isRelative ? `${parsed.pathname}${parsed.search}` : parsed.toString(), init);
      }
      return originalFetch(input, init);
    };

    window.fetch = patchedFetch;
    queryClient.removeQueries({ queryKey: ["/api/factory/bale-products"] });
    queryClient.removeQueries({ queryKey: ["/api/factory/categories"] });
    setReady(true);
    return () => {
      if (window.fetch === patchedFetch) window.fetch = originalFetch;
      queryClient.removeQueries({ queryKey: ["/api/factory/bale-products"] });
      queryClient.removeQueries({ queryKey: ["/api/factory/categories"] });
    };
  }, [language, search, translationFilter]);

  return ready ? <BaleProductsPage /> : null;
}

export default function BaleProductsBilingual() {
  const [language, setLanguage] = useState<FactoryCatalogLanguage>(() =>
    readFactoryCatalogLanguagePreference(typeof window === "undefined" ? null : window.localStorage)
  );
  const [catalogSearch, setCatalogSearch] = useState("");
  const [requestSearch, setRequestSearch] = useState("");
  const [translationFilter, setTranslationFilter] = useState<TranslationFilter>("all");
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [categoryNameEn, setCategoryNameEn] = useState("");
  const [categoryNameAr, setCategoryNameAr] = useState("");
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);
  const { toast } = useToast();
  const { data: currentUser } = useQuery<{ role?: string }>({ queryKey: ["/api/auth/me"] });
  const isAdmin = ["Admin", "Owner", "Developer"].includes(currentUser?.role ?? "");

  useEffect(() => {
    const handleLanguageChange = (event: Event) => {
      const next = (event as CustomEvent<FactoryCatalogLanguage>).detail;
      if (next !== "en" && next !== "ar" && next !== "fr") return;
      // CatalogFetchBoundary remounts for the new language and clears its own
      // React Query entries. Avoid clearing the same large catalogs twice here.
      setLanguage(next);
    };
    window.addEventListener(FACTORY_CATALOG_LANGUAGE_EVENT, handleLanguageChange);
    return () => window.removeEventListener(FACTORY_CATALOG_LANGUAGE_EVENT, handleLanguageChange);
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => setRequestSearch(catalogSearch.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [catalogSearch]);

  const createCategoryMutation = useMutation({
    mutationFn: async () => {
      const response = await modeApiRequest("POST", "/api/factory/categories", {
        name: categoryNameEn.trim(),
        nameAr: categoryNameAr.trim() || null,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "Failed to create category");
      return payload;
    },
    onSuccess: () => {
      setCategoryNameEn("");
      setCategoryNameAr("");
      setCategoryDialogOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["/api/factory/categories"] });
      toast({ title: language === "ar" ? "تم إنشاء الفئة" : "Category created" });
    },
    onError: (error: Error) => {
      if ((error as Error & { _handledGlobally?: boolean })._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div data-factory-catalog-language={language} dir={language === "ar" ? "rtl" : "ltr"}>
      <div className="container mx-auto px-6 pt-6">
        <div className="rounded-xl border bg-card px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <Select
              value={translationFilter}
              onValueChange={(value) => setTranslationFilter(value as TranslationFilter)}
            >
              <SelectTrigger className="h-8 w-56" data-testid="select-translation-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All translations</SelectItem>
                <SelectItem value="complete">Complete</SelectItem>
                <SelectItem value="missing-product">Missing Arabic product name</SelectItem>
                <SelectItem value="missing-category">Missing Arabic category</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                value={catalogSearch}
                onChange={(event) => setCatalogSearch(event.target.value)}
                placeholder={
                  language === "ar"
                    ? "بحث بالعربي أو الإنجليزي أو الرمز..."
                    : language === "fr"
                      ? "Rechercher en français, anglais, arabe ou par code..."
                      : "Search English, Arabic, or article code..."
                }
                className="h-8 w-72 pl-8 pr-8 text-sm"
                dir="auto"
              />
              {catalogSearch && (
                <button
                  type="button"
                  onClick={() => setCatalogSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {isAdmin && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => setCategoryDialogOpen(true)}
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                {language === "ar"
                  ? "فئة ثنائية اللغة"
                  : language === "fr"
                    ? "Catégorie multilingue"
                    : "Bilingual category"}
              </Button>
            )}
          </div>
        </div>
      </div>

      <CatalogFetchBoundary
        key={`${language}:${requestSearch}:${translationFilter}`}
        language={language}
        search={requestSearch}
        translationFilter={translationFilter}
      />
      {isAdmin && <BaleProductArabicEditBridge />}

      <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
        <DialogContent className="max-w-lg" dir="ltr">
          <DialogHeader>
            <DialogTitle>Create bilingual category</DialogTitle>
            <DialogDescription>English and Arabic are stored on one category record.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="category-name-en">Category name — English *</Label>
              <Input
                id="category-name-en"
                value={categoryNameEn}
                onChange={(event) => setCategoryNameEn(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="category-name-ar">اسم الفئة — العربية</Label>
              <Input
                id="category-name-ar"
                value={categoryNameAr}
                onChange={(event) => setCategoryNameAr(event.target.value)}
                dir="rtl"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setCategoryDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={!categoryNameEn.trim() || createCategoryMutation.isPending}
                onClick={() => createCategoryMutation.mutate()}
              >
                {createCategoryMutation.isPending ? "Creating..." : "Create category"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
