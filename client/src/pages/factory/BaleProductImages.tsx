import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Upload, Trash2, ImagePlus, Search, Images, ChevronLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { FactoryBaleProductImage } from "@shared/schema";
import { PageHeader } from "@/components/PageHeader";

interface BaleProduct {
  id: number;
  code: string;
  articleCode: string;
  name: string;
  categoryId?: number;
  active?: boolean;
}

export default function BaleProductImages() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<BaleProduct | null>(null);
  const [showList, setShowList] = useState(true);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const productsQuery = useQuery<BaleProduct[]>({
    queryKey: ["/api/factory/bale-products"],
  });

  const imagesQueryKey = selectedProduct
    ? `/api/factory/bale-product-images?articleCode=${encodeURIComponent(selectedProduct.articleCode)}`
    : null;

  const imagesQuery = useQuery<FactoryBaleProductImage[]>({
    queryKey: [imagesQueryKey],
    enabled: !!imagesQueryKey,
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!selectedProduct) throw new Error("No product selected");
      const formData = new FormData();
      formData.append("image", file);
      formData.append("articleCode", selectedProduct.articleCode);
      formData.append("productId", String(selectedProduct.id));
      const res = await fetch("/api/factory/bale-product-images", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Upload failed");
      }
      return res.json();
    },
    onSuccess: () => {
      if (imagesQueryKey) queryClient.invalidateQueries({ queryKey: [imagesQueryKey] });
      toast({ title: "Image uploaded" });
    },
    onError: (e: any) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/factory/bale-product-images/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Delete failed");
      }
      return res.json();
    },
    onSuccess: () => {
      if (imagesQueryKey) queryClient.invalidateQueries({ queryKey: [imagesQueryKey] });
      toast({ title: "Image deleted" });
    },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    Array.from(files).forEach((f) => {
      if (f.type.startsWith("image/")) uploadMutation.mutate(f);
    });
  }, [uploadMutation]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const filteredProducts = (productsQuery.data ?? []).filter((p) => {
    const q = search.toLowerCase();
    return !q || p.name.toLowerCase().includes(q) || p.articleCode.toLowerCase().includes(q) || p.code.toLowerCase().includes(q);
  });

  const images = imagesQuery.data ?? [];

  return (
    <div className="flex flex-col md:flex-row h-full min-h-0">
      {/* ── Left: Product List ─────────────────────────────────── */}
      <div className={`flex-shrink-0 flex-col md:w-72 md:border-r ${showList ? "flex border-b md:border-b-0" : "hidden md:flex"}`}>
        <div className="p-4 border-b">
          <h2 className="text-lg font-semibold mb-3" data-testid="text-product-list-title">Bale Products</h2>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search products..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-search-products"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {productsQuery.isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filteredProducts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8 px-4">No products found</p>
          ) : (
            <div className="divide-y">
              {filteredProducts.map((p) => (
                <button
                  key={p.id}
                  className={`w-full text-left px-4 py-3 hover-elevate transition-colors ${
                    selectedProduct?.id === p.id ? "bg-accent text-accent-foreground" : ""
                  }`}
                  onClick={() => { setSelectedProduct(p); setShowList(false); }}
                  data-testid={`button-product-${p.id}`}
                >
                  <div className="font-medium text-sm truncate">{p.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{p.articleCode}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Right: Image Manager ───────────────────────────────── */}
      <div className={`flex-1 flex-col min-w-0 overflow-y-auto ${!showList ? "flex" : "hidden md:flex"}`}>
        {!selectedProduct ? (
          <div className="flex flex-col items-center justify-center flex-1 text-center p-8 text-muted-foreground">
            <Images className="h-12 w-12 mb-4 opacity-30" />
            <p className="text-sm">Select a product to manage its images</p>
          </div>
        ) : (
          <div className="p-6 space-y-6">
            {/* Mobile back button */}
            <div className="md:hidden -mb-2">
              <Button variant="ghost" size="sm" onClick={() => setShowList(true)} data-testid="button-back-to-products">
                <ChevronLeft className="h-4 w-4 mr-1" />
                Back to Products
              </Button>
            </div>
            {/* Header */}
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <PageHeader title={selectedProduct.name} />
                <p className="text-muted-foreground text-sm mt-1">
                  Article code: <span className="font-mono font-medium">{selectedProduct.articleCode}</span>
                </p>
              </div>
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadMutation.isPending}
                data-testid="button-upload-image"
              >
                {uploadMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Upload className="h-4 w-4 mr-2" />
                )}
                Upload Images
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => handleFiles(e.target.files)}
                data-testid="input-file-upload"
              />
            </div>

            {/* Drop zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-md p-8 text-center cursor-pointer transition-colors ${
                dragging ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-primary/50"
              }`}
              data-testid="dropzone-images"
            >
              <ImagePlus className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Drag & drop images here, or <span className="text-primary font-medium">click to browse</span>
              </p>
              <p className="text-xs text-muted-foreground mt-1">PNG, JPG, WebP — max 10 MB each</p>
            </div>

            {/* Image grid */}
            {imagesQuery.isLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : images.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No images yet. Upload the first one above.
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-muted-foreground">
                    {images.length} image{images.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                  {images.map((img) => (
                    <Card key={img.id} className="overflow-hidden group relative" data-testid={`card-image-${img.id}`}>
                      <div className="aspect-square bg-muted relative">
                        <img
                          src={img.url}
                          alt={img.fileName ?? "product image"}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                          <Button
                            size="icon"
                            variant="destructive"
                            className="opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => deleteMutation.mutate(img.id)}
                            disabled={deleteMutation.isPending}
                            data-testid={`button-delete-image-${img.id}`}
                          >
                            {deleteMutation.isPending && deleteMutation.variables === img.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>
                      <CardContent className="p-2">
                        <p
                          className="text-xs text-muted-foreground truncate"
                          title={img.fileName ?? undefined}
                          data-testid={`text-image-filename-${img.id}`}
                        >
                          {img.fileName ?? "image"}
                        </p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
