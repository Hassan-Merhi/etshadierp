import { useRef, useState } from "react";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

type ImportMode = "fill-missing" | "replace";

interface TranslationPreview {
  totalRows: number;
  matchedProducts: number;
  unchangedRows: number;
  productsToUpdate: number;
  categoriesToUpdate: number;
  unknownArticleCodes: string[];
  duplicateArticleCodes: string[];
  blankOrInvalidArabicNames: number;
  categoryConflicts: number;
  blocked: boolean;
}

async function downloadResponse(response: Response, fallbackName: string): Promise<void> {
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || "Download failed");
  }
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") || "";
  const match = disposition.match(/filename\*?=(?:UTF-8''|\")?([^\";]+)/i);
  const fileName = match ? decodeURIComponent(match[1].replace(/\"/g, "")) : fallbackName;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function createFormData(file: File, mode: ImportMode): FormData {
  const form = new FormData();
  form.append("file", file);
  form.append("mode", mode);
  return form;
}

export function FactoryArabicTranslationActions() {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<ImportMode>("fill-missing");
  const [preview, setPreview] = useState<TranslationPreview | null>(null);

  const previewMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose an .xlsx workbook first");
      const response = await fetch("/api/factory/bale-products/arabic-import/preview", {
        method: "POST",
        credentials: "include",
        body: createFormData(file, mode),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || "Preview failed");
      return payload as TranslationPreview;
    },
    onSuccess: setPreview,
    onError: (error: Error) => toast({ title: "Preview failed", description: error.message, variant: "destructive" }),
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!file || !preview) throw new Error("Preview the workbook before applying it");
      if (preview.blocked) throw new Error("Resolve duplicate article codes and category conflicts first");
      const response = await fetch("/api/factory/bale-products/arabic-import/apply", {
        method: "POST",
        credentials: "include",
        body: createFormData(file, mode),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || "Import failed");
      return payload;
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/factory/bale-products"], exact: false }),
        queryClient.invalidateQueries({ queryKey: ["/api/factory/categories"], exact: false }),
        queryClient.invalidateQueries({ queryKey: ["/api/factory/bale-products/lookup"], exact: false }),
      ]);
      toast({
        title: "Arabic translations updated",
        description: `${result.changedProductIds?.length || 0} products and ${result.changedCategoryIds?.length || 0} categories changed.`,
      });
      setOpen(false);
      setFile(null);
      setPreview(null);
      if (inputRef.current) inputRef.current.value = "";
    },
    onError: (error: Error) => toast({ title: "Import failed", description: error.message, variant: "destructive" }),
  });

  const exportTemplate = async () => {
    try {
      await downloadResponse(
        await fetch("/api/factory/bale-products/arabic-template", { credentials: "include" }),
        "factory-arabic-names-template.xlsx"
      );
    } catch (error) {
      toast({ title: "Export failed", description: (error as Error).message, variant: "destructive" });
    }
  };

  const downloadErrors = async () => {
    if (!file) return;
    try {
      await downloadResponse(
        await fetch("/api/factory/bale-products/arabic-import/errors", {
          method: "POST",
          credentials: "include",
          body: createFormData(file, mode),
        }),
        "factory-arabic-import-errors.xlsx"
      );
    } catch (error) {
      toast({ title: "Error workbook failed", description: (error as Error).message, variant: "destructive" });
    }
  };

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={exportTemplate}>
          <Download className="mr-2 h-4 w-4" /> Export Arabic Names Template
        </Button>
        <Button variant="outline" onClick={() => setOpen(true)}>
          <Upload className="mr-2 h-4 w-4" /> Import Arabic Names
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import Arabic product and category names</DialogTitle>
            <DialogDescription>
              Products are matched only by their exact article code/barcode in the current Factory company. English names,
              prices, weights, quantities, stock and accounting records are never changed.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="factory-arabic-workbook">Arabic translation workbook (.xlsx)</Label>
              <input
                ref={inputRef}
                id="factory-arabic-workbook"
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(event) => {
                  setFile(event.target.files?.[0] || null);
                  setPreview(null);
                }}
              />
            </div>

            <div className="space-y-2">
              <Label>Update mode</Label>
              <Select value={mode} onValueChange={(value) => { setMode(value as ImportMode); setPreview(null); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="fill-missing">Fill missing Arabic names only</SelectItem>
                  <SelectItem value="replace">Replace existing Arabic names</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {preview && (
              <div className="rounded-md border p-4 text-sm">
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                  <span>Total rows: {preview.totalRows}</span>
                  <span>Matched: {preview.matchedProducts}</span>
                  <span>Unchanged: {preview.unchangedRows}</span>
                  <span>Products to update: {preview.productsToUpdate}</span>
                  <span>Categories to update: {preview.categoriesToUpdate}</span>
                  <span>Unknown codes: {preview.unknownArticleCodes.length}</span>
                  <span>Duplicate codes: {preview.duplicateArticleCodes.length}</span>
                  <span>Invalid Arabic names: {preview.blankOrInvalidArabicNames}</span>
                  <span>Category conflicts: {preview.categoryConflicts}</span>
                </div>
                {preview.blocked && (
                  <p className="mt-3 font-medium text-destructive">
                    Apply is blocked until duplicate article codes and category conflicts are corrected.
                  </p>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="flex-wrap gap-2">
            {preview && (preview.unknownArticleCodes.length > 0 || preview.duplicateArticleCodes.length > 0 || preview.blankOrInvalidArabicNames > 0 || preview.categoryConflicts > 0) && (
              <Button variant="outline" onClick={downloadErrors}>
                <FileSpreadsheet className="mr-2 h-4 w-4" /> Download error workbook
              </Button>
            )}
            <Button variant="outline" disabled={!file || previewMutation.isPending} onClick={() => previewMutation.mutate()}>
              {previewMutation.isPending ? "Previewing…" : "Preview"}
            </Button>
            <Button disabled={!preview || preview.blocked || applyMutation.isPending} onClick={() => applyMutation.mutate()}>
              {applyMutation.isPending ? "Applying…" : "Apply Arabic translations"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
