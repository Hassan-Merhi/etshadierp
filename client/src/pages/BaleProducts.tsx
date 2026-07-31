import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Languages, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { getApiRequest } from "@/lib/factoryApi";
import { useAppMode } from "@/contexts/AppModeContext";
import type { FactoryCatalogLanguage } from "@shared/factoryBilingualContract";
import {
  persistFactoryCatalogLanguagePreference,
  persistFactoryCatalogSearch,
  readFactoryCatalogLanguagePreference,
} from "@/lib/factoryCatalogPreference";
import BaleProductsLegacy from "./BaleProductsLegacy";

export default function BaleProducts() {
  const [language, setLanguage] = useState<FactoryCatalogLanguage>(() =>
    readFactoryCatalogLanguagePreference(typeof window === "undefined" ? null : window.localStorage)
  );
  const [catalogSearch, setCatalogSearch] = useState("");
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [categoryNameEn, setCategoryNameEn] = useState("");
  const [categoryNameAr, setCategoryNameAr] = useState("");
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);
  const { toast } = useToast();

  const { data: currentUser } = useQuery<{ role?: string }>({ queryKey: ["/api/auth/me"] });
  const isAdmin = ["Admin", "Owner", "Developer"].includes(currentUser?.role ?? "");

  useEffect(() => {
    persistFactoryCatalogLanguagePreference(
      language,
      typeof window === "undefined" ? null : window.localStorage,
      typeof document === "undefined" ? null : document
    );
    void queryClient.invalidateQueries({ queryKey: ["/api/factory/bale-products"] });
    void queryClient.invalidateQueries({ queryKey: ["/api/factory/categories"] });
  }, [language]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      persistFactoryCatalogSearch(catalogSearch, document);
      void queryClient.invalidateQueries({ queryKey: ["/api/factory/bale-products"] });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [catalogSearch]);

  useEffect(
    () => () => {
      persistFactoryCatalogSearch("", typeof document === "undefined" ? null : document);
    },
    []
  );

  const createCategoryMutation = useMutation({
    mutationFn: async () => {
      const response = await modeApiRequest("POST", "/api/factory/catalog-bilingual/categories", {
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
    <div data-factory-catalog-language={language}>
      <div className="container mx-auto px-6 pt-6">
        <div className="rounded-xl border bg-card px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <Languages className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Catalog language</span>
            <div className="inline-flex rounded-md border p-0.5 bg-muted/30" role="group" aria-label="Catalog language">
              <Button
                type="button"
                size="sm"
                variant={language === "en" ? "default" : "ghost"}
                className="h-7 rounded-sm px-3"
                onClick={() => setLanguage("en")}
                aria-pressed={language === "en"}
                data-testid="button-catalog-language-en"
              >
                English
              </Button>
              <Button
                type="button"
                size="sm"
                variant={language === "ar" ? "default" : "ghost"}
                className="h-7 rounded-sm px-3"
                onClick={() => setLanguage("ar")}
                aria-pressed={language === "ar"}
                data-testid="button-catalog-language-ar"
              >
                العربية
              </Button>
            </div>
            <span className="text-xs text-muted-foreground">
              {language === "ar"
                ? "يعرض الاسم العربي، ثم الإنجليزي، ثم رمز الصنف عند عدم وجود ترجمة."
                : "Shows English, then Arabic, then the article code when a translation is missing."}
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                value={catalogSearch}
                onChange={(event) => setCatalogSearch(event.target.value)}
                placeholder={language === "ar" ? "بحث بالعربي أو الإنجليزي أو الرمز..." : "Search English, Arabic, or article code..."}
                className="h-8 w-72 pl-8 pr-8 text-sm"
                data-testid="input-bilingual-catalog-search"
                dir="auto"
              />
              {catalogSearch && (
                <button
                  type="button"
                  onClick={() => setCatalogSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Clear bilingual search"
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
                data-testid="button-create-bilingual-category"
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                {language === "ar" ? "فئة ثنائية اللغة" : "Bilingual category"}
              </Button>
            )}
          </div>
        </div>
      </div>

      <BaleProductsLegacy />

      <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create bilingual category</DialogTitle>
            <DialogDescription>
              One category record stores both names. English remains the required canonical name; Arabic is optional.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="category-name-en">Category name — English *</Label>
              <Input
                id="category-name-en"
                value={categoryNameEn}
                onChange={(event) => setCategoryNameEn(event.target.value)}
                placeholder="Bags & Belts"
                data-testid="input-category-name-en"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="category-name-ar">اسم الفئة — العربية</Label>
              <Input
                id="category-name-ar"
                value={categoryNameAr}
                onChange={(event) => setCategoryNameAr(event.target.value)}
                placeholder="الحقائب والأحزمة"
                dir="rtl"
                data-testid="input-category-name-ar"
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
                data-testid="button-save-bilingual-category"
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
