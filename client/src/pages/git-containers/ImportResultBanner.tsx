import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Undo2, X } from "lucide-react";

interface ImportResultBannerProps {
  importResult: {
    updated: number;
    skipped: number;
    notFound: number;
    errors: string[];
    importId: string | null;
  } | null;
  setImportResult: (v: any) => void;
  undoImportMutation: {
    mutate: (id: string) => void;
    isPending: boolean;
  };
}

export function ImportResultBanner({
  importResult,
  setImportResult,
  undoImportMutation,
}: ImportResultBannerProps) {
  if (!importResult) return null;

  return (
    <Card className="border-green-200 bg-green-50/50 dark:bg-green-900/10 dark:border-green-800/50 animate-in fade-in slide-in-from-top-1 duration-300" data-testid="banner-import-result">
      <CardContent className="p-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-green-800 dark:text-green-300">
              Import Result: {importResult.updated} updated, {importResult.skipped} skipped, {importResult.notFound} not found.
            </p>
            {importResult.errors.length > 0 && (
              <p className="text-xs text-green-700 dark:text-green-400 mt-0.5 truncate">
                Errors: {importResult.errors.join(", ")}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {importResult.importId && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs bg-white dark:bg-slate-900 border-green-200"
              onClick={() => undoImportMutation.mutate(importResult.importId!)}
              disabled={undoImportMutation.isPending}
              data-testid="button-undo-import"
            >
              <Undo2 className="h-3.5 w-3.5 mr-1.5" />
              Undo Import
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-green-700 hover:bg-green-100"
            onClick={() => setImportResult(null)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
