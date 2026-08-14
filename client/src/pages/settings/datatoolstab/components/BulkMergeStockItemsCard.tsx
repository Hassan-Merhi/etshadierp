import { getErrorDetails } from "@shared/errorUtils";
/**
 * BulkMergeStockItemsCard — extracted sub-component.
 *
 * Extracted from DataToolsTab.tsx during the Phase 4 god-file split.
 */
import {useState, useRef} from "react";
import {Card, CardHeader, CardTitle, CardContent, CardDescription} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import {Alert, AlertDescription} from "@/components/ui/alert";
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from "@/components/ui/table";
import {Badge} from "@/components/ui/badge";
import {useToast} from "@/hooks/use-toast";
import {queryClient, apiRequest} from "@/lib/queryClient";
import {Loader2, AlertTriangle, Upload, Check, X, FileSpreadsheet, FileDown} from "lucide-react";
import {utils, writeFile, readFile} from "@/lib/excelHelper";
import type {BulkMergePairRow, BulkMergeResult} from "../types";

export function BulkMergeStockItemsCard({ embedded }: { embedded?: boolean }) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parsedRows, setParsedRows] = useState<BulkMergePairRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [results, setResults] = useState<BulkMergeResult[] | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  async function downloadTemplate() {
    const wb = utils.book_new();
    const ws = utils.aoa_to_sheet([
      ["old_code", "keep_code"],
      ["ITEM-OLD-001", "ITEM-KEEP-001"],
    ]);
    (ws as any)["!cols"] = [{ wch: 24 }, { wch: 24 }];
    utils.book_append_sheet(wb, ws, "Merge Pairs");
    await writeFile(wb, "bulk_merge_template.xlsx");
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParsedRows([]);
    setParseError(null);
    setResults(null);
    try {
      const wb = await readFile(file);
      const ws = wb.worksheets[0];
      if (!ws) throw new Error("No worksheet found in file");
      const rows = utils.sheet_to_json<Record<string, any>>(ws);
      const parsed: BulkMergePairRow[] = [];
      for (const row of rows) {
        const oldCode = String(row.old_code ?? row.Old_Code ?? row.OLD_CODE ?? "").trim();
        const keepCode = String(row.keep_code ?? row.Keep_Code ?? row.KEEP_CODE ?? "").trim();
        if (oldCode && keepCode) parsed.push({ oldCode, keepCode });
      }
      if (parsed.length === 0)
        throw new Error("No valid rows found. Check that the file has old_code and keep_code columns.");
      setParsedRows(parsed);
    } catch (err) {
      setParseError(getErrorDetails(err).message);
    }
  }

  async function handleRun() {
    if (parsedRows.length === 0) return;
    setIsRunning(true);
    setResults(null);
    try {
      const res = await apiRequest("POST", "/api/stock-items/bulk-merge", { pairs: parsedRows });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Bulk merge failed");
      setResults(data.results ?? []);
      queryClient.invalidateQueries({ queryKey: ["/api/stock-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-items/light"] });
      const succeeded = (data.results as BulkMergeResult[]).filter((r) => r.status === "success").length;
      toast({ title: `Bulk merge done — ${succeeded} of ${data.results.length} merged` });
    } catch (err) {
      toast({ title: "Bulk merge failed", description: getErrorDetails(err).message, variant: "destructive" });
    } finally {
      setIsRunning(false);
    }
  }

  function reset() {
    setParsedRows([]);
    setParseError(null);
    setFileName(null);
    setResults(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const succeeded = results?.filter((r) => r.status === "success").length ?? 0;
  const skipped = results?.filter((r) => r.status === "skipped").length ?? 0;
  const errored = results?.filter((r) => r.status === "error").length ?? 0;

  const bulkContent = (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={downloadTemplate} data-testid="button-bulk-merge-template">
          <FileDown className="h-4 w-4 mr-2" />
          Download Template
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          data-testid="button-bulk-merge-upload"
        >
          <Upload className="h-4 w-4 mr-2" />
          Upload Excel File
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={handleFileChange}
          data-testid="input-bulk-merge-file"
        />
      </div>

      {fileName && <p className="text-sm text-muted-foreground">File: {fileName}</p>}

      {parseError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{parseError}</AlertDescription>
        </Alert>
      )}

      {parsedRows.length > 0 && !results && (
        <div className="space-y-3">
          <p className="text-sm font-medium">
            {parsedRows.length} pair{parsedRows.length !== 1 ? "s" : ""} ready to merge
          </p>
          <div className="border rounded-md overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead>Old code (to remove)</TableHead>
                  <TableHead>Keep code</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {parsedRows.slice(0, 20).map((row, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-muted-foreground tabular-nums">{i + 1}</TableCell>
                    <TableCell className="font-mono text-sm">{row.oldCode}</TableCell>
                    <TableCell className="font-mono text-sm">{row.keepCode}</TableCell>
                  </TableRow>
                ))}
                {parsedRows.length > 20 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-sm text-muted-foreground">
                      …and {parsedRows.length - 20} more rows
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleRun} disabled={isRunning} data-testid="button-bulk-merge-run">
              {isRunning && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {isRunning ? "Merging…" : `Merge ${parsedRows.length} pair${parsedRows.length !== 1 ? "s" : ""}`}
            </Button>
            <Button variant="outline" onClick={reset} disabled={isRunning} data-testid="button-bulk-merge-reset">
              Clear
            </Button>
          </div>
        </div>
      )}

      {results && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3 text-sm">
            <span className="flex items-center gap-1.5">
              <Check className="h-4 w-4 text-green-600" />
              <span>
                <strong>{succeeded}</strong> merged
              </span>
            </span>
            <span className="flex items-center gap-1.5">
              <X className="h-4 w-4 text-yellow-600" />
              <span>
                <strong>{skipped}</strong> skipped
              </span>
            </span>
            {errored > 0 && (
              <span className="flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <span>
                  <strong>{errored}</strong> error{errored !== 1 ? "s" : ""}
                </span>
              </span>
            )}
          </div>

          {(skipped > 0 || errored > 0) && (
            <div className="border rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Old code</TableHead>
                    <TableHead>Keep code</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results
                    .filter((r) => r.status !== "success")
                    .map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-sm">{r.oldCode}</TableCell>
                        <TableCell className="font-mono text-sm">{r.keepCode}</TableCell>
                        <TableCell>
                          <Badge variant={r.status === "error" ? "destructive" : "secondary"}>{r.status}</Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{r.reason ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          )}

          <Button variant="outline" size="sm" onClick={reset} data-testid="button-bulk-merge-done">
            Start another batch
          </Button>
        </div>
      )}
    </div>
  );

  if (embedded) return bulkContent;

  return (
    <Card className="col-span-1 md:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4" />
          Bulk Merge via Excel
        </CardTitle>
        <CardDescription>
          Upload a two-column Excel file (old_code → keep_code) to merge many duplicate items at once. Each pair runs
          the same safe merge logic as the single-item merge above.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">{bulkContent}</CardContent>
    </Card>
  );
}

// ── Merge History / Unmerge Card ─────────────────────────────────────────────
