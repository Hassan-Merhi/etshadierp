/**
 * ImportResult — extracted sub-component.
 *
 * Extracted from FactoryImport.tsx during the Phase 4 god-file split.
 */
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useFactoryText } from "@/i18n/modules/factory";

export function ImportResult({
  result,
  onReset,
}: {
  result: { imported?: number; updated?: number; errors: string[] };
  onReset: () => void;
}) {
  const tUi = useFactoryText();
  const hasErrors = result.errors && result.errors.length > 0;
  const total = (result.imported || 0) + (result.updated || 0);

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex flex-col items-center gap-4">
          {total > 0 ? (
            <div className="h-14 w-14 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <CheckCircle2 className="h-7 w-7 text-green-600 dark:text-green-400" />
            </div>
          ) : (
            <div className="h-14 w-14 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertCircle className="h-7 w-7 text-destructive" />
            </div>
          )}

          <div className="text-center">
            <h3 className="text-lg font-semibold">{tUi("import.complete")}</h3>
            <div className="flex items-center gap-3 mt-2 justify-center flex-wrap">
              {result.imported !== undefined && result.imported > 0 && (
                <Badge variant="secondary" data-testid="badge-imported">
                  {result.imported} created
                </Badge>
              )}
              {result.updated !== undefined && result.updated > 0 && (
                <Badge variant="secondary" data-testid="badge-updated">
                  {result.updated} updated
                </Badge>
              )}
              {hasErrors && (
                <Badge variant="destructive" data-testid="badge-errors">
                  {result.errors.length} errors
                </Badge>
              )}
            </div>
          </div>

          {hasErrors && (
            <div className="w-full max-w-lg border rounded-md p-3 bg-destructive/5 max-h-48 overflow-auto">
              <p className="text-sm font-medium text-destructive mb-2">{tUi("errors")}</p>
              <ul className="text-sm space-y-1">
                {result.errors.map((err, i) => (
                  <li key={i} className="text-muted-foreground flex items-start gap-2">
                    <AlertCircle className="h-3.5 w-3.5 mt-0.5 text-destructive shrink-0" />
                    {err}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Button onClick={onReset} data-testid="button-import-again">
            Import More Data
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
