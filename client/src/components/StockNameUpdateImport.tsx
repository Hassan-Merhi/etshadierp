import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { read, utils, writeFile } from "@/lib/excelHelper";
import { CheckCircle2, Download, Upload } from "lucide-react";

type StockItemLite = {
  code: string;
  name: string;
};

type PreviewStatus = "ready" | "unchanged" | "not_found" | "duplicate" | "invalid";

type PreviewRow = {
  rowNumber: number;
  code: string;
  currentName: string;
  newName: string;
  status: PreviewStatus;
};

type RenameResult = {
  message: string;
  updated: number;
  unchanged: number;
  notFound: number;
  notFoundCodes: string[];
};

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[\s_-]+/g, "");
}

function isGloballyHandledError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("_handledGlobally" in error)) return false;
  return Boolean((error as { _handledGlobally?: unknown })._handledGlobally);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown file import error";
}

export function StockNameUpdateImport() {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [isReading, setIsReading] = useState(false);
  const [result, setResult] = useState<RenameResult | null>(null);

  const { data: stockItems = [], isLoading: itemsLoading } = useQuery<StockItemLite[]>({
    queryKey: ["/api/stock-items"],
    staleTime: 60_000,
  });

  const itemByCode = useMemo(
    () =>
      new Map(
        stockItems.map((item) => [
          String(item.code || "")
            .trim()
            .toLowerCase(),
          item,
        ])
      ),
    [stockItems]
  );

  const changeRows = rows.filter((row) => row.status === "ready");
  const unchangedCount = rows.filter((row) => row.status === "unchanged").length;
  const notFoundCount = rows.filter((row) => row.status === "not_found").length;
  const blockingProblemCount = rows.filter((row) => ["duplicate", "invalid"].includes(row.status)).length;

  const mutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/stock-items/update-names-by-code", {
        rows: changeRows.map((row) => ({ code: row.code, newName: row.newName })),
      });
      return response.json() as Promise<RenameResult>;
    },
    onSuccess: (data) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/stock-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-items/light"] });
      toast({ title: "Names updated", description: data.message });
    },
    onError: (error: Error) => {
      if (isGloballyHandledError(error)) return;
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
    },
  });

  const downloadTemplate = async () => {
    const worksheet = utils.json_to_sheet([
      { Code: "ITEM-001", "New Name": "Replacement Item Name" },
      { Code: "ITEM-002", "New Name": "Another Replacement Name" },
    ]);
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, worksheet, "Update Names");
    await writeFile(workbook, "stock_item_name_update_template.xlsx");
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] ?? null;
    setFile(nextFile);
    setRows([]);
    setResult(null);
    if (!nextFile) return;

    setIsReading(true);
    try {
      const workbook = await read(await nextFile.arrayBuffer());
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows = utils.sheet_to_json<Record<string, unknown>>(worksheet);
      if (rawRows.length === 0) throw new Error("The file has no data rows");

      const headers = Object.keys(rawRows[0] ?? {});
      const codeHeader = headers.find((header) => ["code", "itemcode"].includes(normalizeHeader(header)));
      const nameHeader = headers.find((header) => ["newname", "name", "itemname"].includes(normalizeHeader(header)));
      if (!codeHeader || !nameHeader) {
        throw new Error('Expected columns "Code" and "New Name"');
      }

      const parsed = rawRows.map((raw, index) => ({
        rowNumber: index + 2,
        code: String(raw[codeHeader] ?? "").trim(),
        newName: String(raw[nameHeader] ?? "").trim(),
      }));
      const counts = new Map<string, number>();
      for (const row of parsed) {
        const key = row.code.toLowerCase();
        if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
      }

      const preview: PreviewRow[] = parsed.map((row) => {
        const key = row.code.toLowerCase();
        const item = itemByCode.get(key);
        let status: PreviewStatus = "ready";
        if (!row.code || !row.newName || row.newName.length > 500) status = "invalid";
        else if ((counts.get(key) ?? 0) > 1) status = "duplicate";
        else if (!item) status = "not_found";
        else if (item.name === row.newName) status = "unchanged";
        return {
          ...row,
          currentName: item?.name ?? "",
          status,
        };
      });

      setRows(preview);
      const ready = preview.filter((row) => row.status === "ready").length;
      const missing = preview.filter((row) => row.status === "not_found").length;
      toast({
        title: "Preview ready",
        description: `${ready} name change${ready === 1 ? "" : "s"} ready to apply${missing > 0 ? `; ${missing} missing code${missing === 1 ? "" : "s"} will be ignored` : ""}`,
      });
    } catch (error: unknown) {
      toast({
        title: "Could not read file",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setIsReading(false);
    }
  };

  const statusBadge = (status: PreviewStatus) => {
    if (status === "ready") return <Badge>Ready</Badge>;
    if (status === "unchanged") return <Badge variant="secondary">Unchanged</Badge>;
    if (status === "not_found") return <Badge variant="secondary">Ignored — code not found</Badge>;
    if (status === "duplicate") return <Badge variant="destructive">Duplicate code</Badge>;
    return <Badge variant="destructive">Invalid</Badge>;
  };

  return (
    <div className="space-y-4 mt-4">
      <Alert>
        <CheckCircle2 className="h-4 w-4" />
        <AlertDescription>
          Match existing stock items by primary code and replace only the item name. Codes that do not exist are ignored
          and the remaining valid matches still proceed. Stock quantity, costs, selling prices, barcodes, groups, grades
          and categories are not changed.
        </AlertDescription>
      </Alert>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <div className="space-y-2">
          <label className="text-sm font-medium">Excel / CSV file</label>
          <Input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileChange}
            disabled={itemsLoading || isReading || mutation.isPending}
            data-testid="input-update-stock-names-file"
          />
          <p className="text-xs text-muted-foreground">
            {itemsLoading ? "Loading current item codes..." : 'Required columns: "Code" and "New Name".'}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={downloadTemplate}
          className="gap-2"
          data-testid="button-download-stock-name-template"
        >
          <Download className="h-4 w-4" />
          Template
        </Button>
      </div>

      {file && <p className="text-xs text-muted-foreground">Selected: {file.name}</p>}

      {rows.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="secondary">{rows.length} rows</Badge>
            <Badge variant="secondary">{changeRows.length} changes</Badge>
            <Badge variant="secondary">{unchangedCount} unchanged</Badge>
            {notFoundCount > 0 && <Badge variant="secondary">{notFoundCount} ignored (not found)</Badge>}
            {blockingProblemCount > 0 && <Badge variant="destructive">{blockingProblemCount} need attention</Badge>}
          </div>

          <div className="max-h-72 overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted">
                <tr className="border-b">
                  <th className="p-2 text-left">Code</th>
                  <th className="p-2 text-left">Current Name</th>
                  <th className="p-2 text-left">New Name</th>
                  <th className="p-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 150).map((row) => (
                  <tr key={`${row.rowNumber}-${row.code}`} className="border-b last:border-b-0">
                    <td className="p-2 font-mono">{row.code || "—"}</td>
                    <td className="p-2">{row.currentName || "—"}</td>
                    <td className="p-2 font-medium">{row.newName || "—"}</td>
                    <td className="p-2">{statusBadge(row.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 150 && (
              <div className="border-t p-2 text-center text-xs text-muted-foreground">
                Showing first 150 of {rows.length} rows
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <Button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || changeRows.length === 0 || blockingProblemCount > 0}
              className="gap-2"
              data-testid="button-update-stock-names-by-code"
            >
              <Upload className="h-4 w-4" />
              {mutation.isPending ? "Updating..." : `Apply ${changeRows.length} Name Changes`}
            </Button>
          </div>
        </>
      )}

      {result && (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription>{result.message}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
