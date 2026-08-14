import { getErrorDetails } from "@shared/errorUtils";
/**
 * ReconciliationRunner — extracted sub-component.
 *
 * Extracted from GcLshiMigration.tsx during the Phase 4 god-file split.
 */
import {useState} from "react";
import {Button} from "@/components/ui/button";
import {Badge} from "@/components/ui/badge";
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from "@/components/ui/table";
import {CheckCircle2, XCircle, AlertTriangle} from "lucide-react";

export function ReconciliationRunner({
  sourceCompanyId,
  targetCompanyId,
}: {
  sourceCompanyId: number;
  targetCompanyId: number;
}) {
  const [report, setReport] = useState<{
    overall: string;
    areas: Array<{ area: string; status: string; detail?: string; details?: string; mismatches?: string[] }>;
    partialMigrationWarning?: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/sp/migration/gc-reconciliation?sourceCompanyId=${sourceCompanyId}&targetCompanyId=${targetCompanyId}`
      );
      const data = await r.json();
      if (!r.ok) throw new Error(data.message ?? `Request failed (${r.status})`);
      setReport(data);
    } catch (err) {
      // Keep the previous report visible; surface the real error instead of silently clearing it.
      setError(getErrorDetails(err).message ?? "Reconciliation failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          Final Reconciliation Report
        </div>
        <Button size="sm" variant="outline" onClick={run} disabled={loading} data-testid="button-run-reconciliation">
          {loading ? "Checking…" : "Check"}
        </Button>
      </div>
      {error && (
        <p className="text-xs text-destructive" data-testid="text-reconciliation-error">
          {error}
        </p>
      )}
      {report?.partialMigrationWarning && (
        <div
          className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 rounded-md px-3 py-2"
          data-testid="text-partial-migration-warning"
        >
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          {report.partialMigrationWarning}
        </div>
      )}
      {report && (
        <div className="border rounded-md overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Area</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.areas.map((a) => (
                <TableRow key={a.area}>
                  <TableCell className="text-sm align-top">{a.area}</TableCell>
                  <TableCell className="align-top">
                    <Badge
                      variant={a.status === "PASS" ? "default" : a.status === "FAIL" ? "destructive" : "secondary"}
                    >
                      {a.status === "PASS" && <CheckCircle2 className="h-3 w-3 mr-1" />}
                      {a.status === "FAIL" && <XCircle className="h-3 w-3 mr-1" />}
                      {a.status === "WARN" && <AlertTriangle className="h-3 w-3 mr-1" />}
                      {a.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground align-top">
                    <p>{a.detail ?? a.details}</p>
                    {(a.mismatches ?? []).length > 0 && (
                      <ul className="mt-1 list-disc list-inside space-y-0.5 max-h-40 overflow-auto">
                        {a.mismatches!.map((m, i) => (
                          <li key={i}>{m}</li>
                        ))}
                      </ul>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
