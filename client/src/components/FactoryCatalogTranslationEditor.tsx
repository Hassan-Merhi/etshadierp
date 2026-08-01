import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

interface ProductOption {
  id: number;
  articleCode: string;
  nameEn?: string | null;
  name?: string | null;
  nameAr?: string | null;
  descriptionAr?: string | null;
}

interface CategoryOption {
  id: number;
  nameEn?: string | null;
  name?: string | null;
  nameAr?: string | null;
}

async function patchJson(path: string, body: unknown): Promise<void> {
  const response = await fetch(path, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "Unable to update translation");
}

export function FactoryCatalogTranslationEditor() {
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [productNameAr, setProductNameAr] = useState("");
  const [descriptionAr, setDescriptionAr] = useState("");
  const [categoryNameAr, setCategoryNameAr] = useState("");
  const { toast } = useToast();

  const { data: products = [] } = useQuery<ProductOption[]>({
    queryKey: ["/api/factory/bale-products", "translation-editor"],
    queryFn: async () => {
      const response = await fetch("/api/factory/bale-products?lang=en", { credentials: "include" });
      if (!response.ok) throw new Error("Unable to load products");
      return response.json();
    },
    enabled: open,
  });
  const { data: categories = [] } = useQuery<CategoryOption[]>({
    queryKey: ["/api/factory/categories", "translation-editor"],
    queryFn: async () => {
      const response = await fetch("/api/factory/categories?lang=en", { credentials: "include" });
      if (!response.ok) throw new Error("Unable to load categories");
      return response.json();
    },
    enabled: open,
  });

  const selectedProduct = useMemo(
    () => products.find((product) => String(product.id) === productId),
    [productId, products]
  );
  const selectedCategory = useMemo(
    () => categories.find((category) => String(category.id) === categoryId),
    [categoryId, categories]
  );

  useEffect(() => {
    setProductNameAr(selectedProduct?.nameAr ?? "");
    setDescriptionAr(selectedProduct?.descriptionAr ?? "");
  }, [selectedProduct]);
  useEffect(() => setCategoryNameAr(selectedCategory?.nameAr ?? ""), [selectedCategory]);

  const productMutation = useMutation({
    mutationFn: () => patchJson(`/api/factory/bale-products/${productId}`, {
      nameAr: productNameAr.trim() || null,
      descriptionAr: descriptionAr.trim() || null,
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/factory/bale-products"] });
      toast({ title: "Arabic product translation updated" });
    },
    onError: (error: Error) => toast({ title: "Update failed", description: error.message, variant: "destructive" }),
  });

  const categoryMutation = useMutation({
    mutationFn: () => patchJson(`/api/factory/categories/${categoryId}`, {
      nameAr: categoryNameAr.trim() || null,
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/factory/categories"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/factory/bale-products"] });
      toast({ title: "Arabic category translation updated" });
    },
    onError: (error: Error) => toast({ title: "Update failed", description: error.message, variant: "destructive" }),
  });

  return (
    <>
      <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => setOpen(true)}>
        <Languages className="mr-1.5 h-3.5 w-3.5" />
        Edit Arabic translations
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl" dir="ltr">
          <DialogHeader>
            <DialogTitle>Edit Arabic catalog translations</DialogTitle>
            <DialogDescription>
              Update Arabic text on the existing product or category record. English names and commercial fields are untouched.
            </DialogDescription>
          </DialogHeader>
          <Tabs defaultValue="product">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="product">Product</TabsTrigger>
              <TabsTrigger value="category">Category</TabsTrigger>
            </TabsList>
            <TabsContent value="product" className="space-y-4 pt-3">
              <div className="space-y-2">
                <Label>Existing product</Label>
                <Select value={productId} onValueChange={setProductId}>
                  <SelectTrigger><SelectValue placeholder="Select article code or product" /></SelectTrigger>
                  <SelectContent>
                    {products.map((product) => (
                      <SelectItem key={product.id} value={String(product.id)}>
                        {product.articleCode} — {product.nameEn || product.name || product.articleCode}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="translation-product-ar">Arabic product name</Label>
                <Input id="translation-product-ar" dir="rtl" value={productNameAr} onChange={(event) => setProductNameAr(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="translation-description-ar">Arabic description</Label>
                <Textarea id="translation-description-ar" dir="rtl" value={descriptionAr} onChange={(event) => setDescriptionAr(event.target.value)} />
              </div>
              <div className="flex justify-end">
                <Button disabled={!productId || productMutation.isPending} onClick={() => productMutation.mutate()}>
                  {productMutation.isPending ? "Saving..." : "Save product translation"}
                </Button>
              </div>
            </TabsContent>
            <TabsContent value="category" className="space-y-4 pt-3">
              <div className="space-y-2">
                <Label>Existing category</Label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent>
                    {categories.map((category) => (
                      <SelectItem key={category.id} value={String(category.id)}>
                        {category.nameEn || category.name || `Category ${category.id}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="translation-category-ar">Arabic category name</Label>
                <Input id="translation-category-ar" dir="rtl" value={categoryNameAr} onChange={(event) => setCategoryNameAr(event.target.value)} />
              </div>
              <div className="flex justify-end">
                <Button disabled={!categoryId || categoryMutation.isPending} onClick={() => categoryMutation.mutate()}>
                  {categoryMutation.isPending ? "Saving..." : "Save category translation"}
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}
