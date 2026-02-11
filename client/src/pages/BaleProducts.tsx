import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Package, Upload, ChevronDown, ChevronRight, LayoutGrid, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { CreateBaleProductDialog } from "../components/CreateBaleProductDialog";
import type { BaleProduct } from "@shared/schema";

interface ImportPreviewRow {
  code: string;
  articleCode?: string;
  name: string;
  description?: string;
  weightPerBaleKg?: string;
  active?: boolean;
}

interface GroupedProduct {
  code: string;
  name: string;
  count: number;
  items: BaleProduct[];
}

export default function BaleProducts() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreviewRow[]>([]);
  const [importError, setImportError] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [condensedView, setCondensedView] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const { data: products, isLoading } = useQuery<BaleProduct[]>({
    queryKey: ["/api/bale-products"],
  });

  const activeProducts = products?.filter((p) => p.active);

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/bale-products/import-excel", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Import failed");
      }
      return response.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/bale-products"] });
      toast({ title: "Success", description: `Imported ${result.count} products` });
      setImportDialogOpen(false);
      setImportPreview([]);
      setImportFile(null);
    },
    onError: (error: Error) => {
      toast({ title: "Import Error", description: error.message, variant: "destructive" });
    },
  });

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError("");
    setImportPreview([]);
    setImportFile(file);

    try {
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const rows: any[] = XLSX.utils.sheet_to_json(worksheet);

      if (rows.length === 0) {
        setImportError("Excel file is empty");
        setImportFile(null);
        return;
      }

      const preview: ImportPreviewRow[] = rows.map((row) => {
        const itemNumber = row.itemNumber || row.item_number || row.ItemNumber;
        let articleCode = row.articleCode || row.article_code || row.ArticleCode || "";
        if (!articleCode && itemNumber) {
          const num = parseInt(String(itemNumber));
          if (!isNaN(num) && num >= 1 && num <= 99) {
            articleCode = `HMD${String(num).padStart(2, "0")}000`;
          }
        }
        return {
          code: row.code || row.Code || row.product_code || "",
          articleCode: articleCode || undefined,
          name: row.name || row.Name || row.product_name || "",
          description: row.description || row.Description || "",
          weightPerBaleKg: row.weightPerBaleKg || row.weight_per_bale_kg || row.weight || undefined,
          active: row.active === undefined ? true : Boolean(row.active),
        };
      });

      const missing = preview.filter((r) => !r.code || !r.name);
      if (missing.length > 0) {
        setImportError(`${missing.length} row(s) missing required code or name`);
      }

      setImportPreview(preview.filter((r) => r.code && r.name));
      setImportDialogOpen(true);
    } catch (err: any) {
      setImportError(err.message || "Failed to parse Excel file");
      setImportFile(null);
      toast({ title: "Parse Error", description: err.message, variant: "destructive" });
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleConfirmImport = () => {
    if (!importFile) {
      toast({ title: "No file", description: "Please select a file first", variant: "destructive" });
      return;
    }
    importMutation.mutate(importFile);
  };

  const toggleGroup = (code: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const groupedProducts: GroupedProduct[] = (() => {
    if (!activeProducts) return [];
    const groups: Record<string, GroupedProduct> = {};
    for (const p of activeProducts) {
      const key = p.code;
      if (!groups[key]) {
        groups[key] = { code: p.code, name: p.name, count: 0, items: [] };
      }
      groups[key].count++;
      groups[key].items.push(p);
    }
    return Object.values(groups).sort((a, b) => a.code.localeCompare(b.code));
  })();

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Bale Products</h1>
          <p className="text-muted-foreground mt-1">Manage product types for bale production</p>
        </div>
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={handleFileSelect}
            data-testid="input-import-file"
          />
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            data-testid="button-import-excel"
          >
            <Upload className="h-4 w-4 mr-2" />
            Import Excel
          </Button>
          <Button onClick={() => setCreateDialogOpen(true)} data-testid="button-create-product">
            <Plus className="h-4 w-4 mr-2" />
            Create Product
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Product List</CardTitle>
            <div className="flex items-center gap-2">
              <List className="h-4 w-4 text-muted-foreground" />
              <Switch
                checked={condensedView}
                onCheckedChange={setCondensedView}
                data-testid="switch-condensed-view"
              />
              <LayoutGrid className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{condensedView ? "Condensed" : "Normal"}</span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : condensedView ? (
            groupedProducts.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groupedProducts.map((group) => (
                    <>
                      <TableRow
                        key={group.code}
                        className="cursor-pointer hover-elevate"
                        onClick={() => toggleGroup(group.code)}
                        data-testid={`row-group-${group.code}`}
                      >
                        <TableCell>
                          {expandedGroups.has(group.code) ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </TableCell>
                        <TableCell className="font-mono font-medium">{group.code}</TableCell>
                        <TableCell className="font-medium">{group.name}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant="secondary">{group.count}</Badge>
                        </TableCell>
                      </TableRow>
                      {expandedGroups.has(group.code) &&
                        group.items.map((product) => (
                          <TableRow key={product.id} className="bg-muted/30" data-testid={`row-product-${product.id}`}>
                            <TableCell></TableCell>
                            <TableCell className="font-mono text-muted-foreground text-sm pl-8">
                              {product.articleCode || "-"}
                            </TableCell>
                            <TableCell className="text-sm">{product.name}</TableCell>
                            <TableCell className="text-right text-sm text-muted-foreground">
                              {product.weightPerBaleKg ? `${product.weightPerBaleKg} kg` : "-"}
                            </TableCell>
                          </TableRow>
                        ))}
                    </>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState onCreateClick={() => setCreateDialogOpen(true)} />
            )
          ) : activeProducts && activeProducts.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Article Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Weight/Bale (kg)</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeProducts.map((product) => (
                  <TableRow key={product.id} data-testid={`row-product-${product.id}`}>
                    <TableCell className="font-mono font-medium">{product.code}</TableCell>
                    <TableCell className="font-mono text-muted-foreground">{product.articleCode || "-"}</TableCell>
                    <TableCell className="font-medium">{product.name}</TableCell>
                    <TableCell className="text-right font-mono">{product.weightPerBaleKg || "-"}</TableCell>
                    <TableCell className="text-muted-foreground">{product.description || "-"}</TableCell>
                    <TableCell>
                      <Badge variant={product.active ? "secondary" : "outline"}>
                        {product.active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(product.createdAt).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState onCreateClick={() => setCreateDialogOpen(true)} />
          )}
        </CardContent>
      </Card>

      <CreateBaleProductDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />

      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import Preview</DialogTitle>
            <DialogDescription>
              Review the {importPreview.length} product(s) to import. Click confirm to proceed.
            </DialogDescription>
          </DialogHeader>

          {importError && (
            <div className="text-destructive text-sm p-2 rounded-md bg-destructive/10">{importError}</div>
          )}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Article Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Weight/Bale</TableHead>
                <TableHead>Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {importPreview.map((row, idx) => (
                <TableRow key={idx}>
                  <TableCell className="font-mono">{row.code}</TableCell>
                  <TableCell className="font-mono text-muted-foreground">{row.articleCode || "-"}</TableCell>
                  <TableCell>{row.name}</TableCell>
                  <TableCell>{row.weightPerBaleKg || "-"}</TableCell>
                  <TableCell className="text-muted-foreground">{row.description || "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setImportDialogOpen(false)} data-testid="button-cancel-import">
              Cancel
            </Button>
            <Button
              onClick={handleConfirmImport}
              disabled={importMutation.isPending || importPreview.length === 0}
              data-testid="button-confirm-import"
            >
              {importMutation.isPending ? "Importing..." : `Import ${importPreview.length} Products`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptyState({ onCreateClick }: { onCreateClick: () => void }) {
  return (
    <div className="text-center py-12">
      <Package className="mx-auto h-12 w-12 text-muted-foreground" />
      <h3 className="mt-4 text-lg font-semibold">No products found</h3>
      <p className="text-muted-foreground mt-2">Create your first product to get started</p>
      <Button className="mt-4" onClick={onCreateClick}>
        <Plus className="h-4 w-4 mr-2" />
        Create Product
      </Button>
    </div>
  );
}
