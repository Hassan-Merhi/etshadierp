import { useState, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Upload, CheckCircle, AlertCircle, RefreshCw, Printer, Download, ChevronDown, ChevronUp, Tag, FileSpreadsheet, Eye
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { factoryApiRequest } from "@/lib/factoryApi";
import { useDateFormat } from "@/contexts/DateFormatContext";
import * as XLSX from "xlsx";
import {
  generateCombinedLabelsHtml,
  generateA5LabelsHtml,
  generateStickerLabelsHtml,
  A4_DESIGN_OPTIONS,
  type A4DesignColor,
  type LabelData,
} from "@/lib/labelHtml";

type Step = "upload" | "validate" | "done";

interface ParsedRow {
  currentRef: string;
  rowNum: number;
}

interface ValidationResult {
  currentRef: string;
  valid: boolean;
  error?: string;
  productName?: string;
  articleCode?: string;
  weightKg?: string;
  status?: string;
}

interface ApplyItem {
  oldRef: string;
  newRef: string;
  productName: string;
  articleCode: string;
  weightKg: string;
}

const POSSIBLE_COLUMNS = [
  "current_reference_code", "reference_code", "ref", "barcode", "old_ref",
  "reference", "current_ref", "bale_code", "baleCode", "refcode",
];

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[\s_\-]/g, "");
}

function findRefColumn(headers: string[]): string | null {
  const normalized = headers.map((h) => normalizeHeader(h));
  const candidates = POSSIBLE_COLUMNS.map((c) => normalizeHeader(c));
  for (const candidate of candidates) {
    const idx = normalized.indexOf(candidate);
    if (idx !== -1) return headers[idx];
  }
  return null;
}

function parseExcelFile(file: File): Promise<ParsedRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const wb = XLSX.read(data, { type: "binary" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        if (rows.length === 0) { reject(new Error("No rows found in file")); return; }
        const headers = Object.keys(rows[0]);
        const refCol = findRefColumn(headers);
        if (!refCol) {
          reject(new Error(`Could not find a reference code column. Expected one of: ${POSSIBLE_COLUMNS.slice(0, 6).join(", ")}`));
          return;
        }
        const parsed: ParsedRow[] = rows
          .map((r: any, i: number) => ({ currentRef: String(r[refCol] || "").trim(), rowNum: i + 2 }))
          .filter((r) => r.currentRef);
        resolve(parsed);
      } catch (err: any) {
        reject(new Error(err.message || "Failed to parse file"));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsBinaryString(file);
  });
}

function downloadCsv(items: ApplyItem[], filename: string) {
  const header = "old_reference_code,new_reference_code,product_name,article_code,weight_kg,status";
  const rows = items.map((r) =>
    [r.oldRef, r.newRef, `"${r.productName}"`, r.articleCode, r.weightKg, "SUCCESS"].join(",")
  );
  const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadExcelTemplate() {
  const wb = XLSX.utils.book_new();
  const data = [
    ["current_reference_code"],
    ["REF00001"],
    ["REF00002"],
    ["REF00003"],
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = [{ wch: 30 }];
  XLSX.utils.book_append_sheet(wb, ws, "Bale References");
  XLSX.writeFile(wb, "bale-relabeling-template.xlsx");
}

interface LabelPreviewCardProps {
  item: ApplyItem;
  designColor: A4DesignColor;
  printFormat: "A4" | "A5" | "STICKER";
}

function LabelPreviewCard({ item, designColor, printFormat }: LabelPreviewCardProps) {
  const colorOpt = A4_DESIGN_OPTIONS.find((o) => o.value === designColor);
  const accentColor = colorOpt?.color ?? "#6d28d9";

  if (printFormat === "STICKER") {
    return (
      <div
        className="rounded-md border bg-white text-black overflow-hidden shrink-0"
        style={{ width: "3in", minWidth: "3in", height: "1.97in", padding: "3mm 4mm", fontFamily: "Arial, Helvetica, sans-serif", display: "flex", flexDirection: "column", gap: "1mm" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
          <div style={{ fontSize: "11pt", fontWeight: 900, letterSpacing: "1px" }}>HMD</div>
          <div style={{ textAlign: "right", fontSize: "7pt", lineHeight: 1.3 }}>
            <div><strong>PIECES:</strong> 1</div>
            <div><strong>ARTICLE:</strong> {item.articleCode || "—"}</div>
            <div><strong>APRX WEIGHT:</strong> {parseFloat(item.weightKg || "0").toFixed(1)} KGS</div>
          </div>
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <img
            src={`/api/barcode/${encodeURIComponent(item.newRef)}`}
            alt="barcode"
            style={{ width: "100%", height: "11mm", objectFit: "fill" }}
          />
          <div style={{ fontSize: "11pt", fontWeight: 900, letterSpacing: "2px", marginTop: "0.5mm" }}>{item.newRef}</div>
        </div>
        <div style={{ textAlign: "center", fontSize: "7pt", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.5px", flexShrink: 0 }}>
          {item.productName}
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-md border bg-white text-black overflow-hidden shrink-0"
      style={{ width: "220px", fontFamily: "Arial, Helvetica, sans-serif" }}
    >
      <div style={{ background: accentColor, color: "#fff", padding: "6px 10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "10pt", fontWeight: 900, letterSpacing: "1px" }}>HMD</span>
        <span style={{ fontSize: "7pt", fontWeight: 700, opacity: 0.9 }}>{printFormat}</span>
      </div>
      <div style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: "4px" }}>
        <div style={{ fontSize: "7pt", lineHeight: 1.4 }}>
          <div><strong>PIECES:</strong> 1</div>
          <div><strong>ARTICLE:</strong> {item.articleCode || "—"}</div>
          <div><strong>WEIGHT:</strong> {parseFloat(item.weightKg || "0").toFixed(1)} KGS</div>
        </div>
        <div style={{ textAlign: "center", borderTop: "1px solid #eee", paddingTop: "4px" }}>
          <img
            src={`/api/barcode/${encodeURIComponent(item.newRef)}`}
            alt="barcode"
            style={{ width: "100%", height: "32px", objectFit: "fill" }}
          />
          <div style={{ fontSize: "9pt", fontWeight: 900, letterSpacing: "2px", marginTop: "2px" }}>{item.newRef}</div>
        </div>
        <div style={{ textAlign: "center", fontSize: "7pt", fontWeight: 700, textTransform: "uppercase", color: "#333", borderTop: "1px solid #eee", paddingTop: "4px" }}>
          {item.productName}
        </div>
      </div>
    </div>
  );
}

export default function FactoryBaleRelabeling() {
  const { toast } = useToast();
  const { formatDisplayDate } = useDateFormat();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [parseError, setParseError] = useState("");

  const [validationResults, setValidationResults] = useState<ValidationResult[]>([]);
  const [printFormat, setPrintFormat] = useState<"A4" | "A5" | "STICKER">("A4");
  const [designColor, setDesignColor] = useState<A4DesignColor>("purple");

  const [applyResult, setApplyResult] = useState<{ sessionId: number; items: ApplyItem[] } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showLabelPreview, setShowLabelPreview] = useState(true);

  const validRows = validationResults.filter((r) => r.valid);
  const invalidRows = validationResults.filter((r) => !r.valid);

  const { data: sessions = [] } = useQuery<any[]>({
    queryKey: ["/api/factory/bales/relabel/sessions"],
    queryFn: async () => {
      const res = await factoryApiRequest("GET", "/api/factory/bales/relabel/sessions");
      return res.json();
    },
    refetchOnWindowFocus: false,
  });

  const validateMutation = useMutation({
    mutationFn: async (rows: ParsedRow[]) => {
      const res = await factoryApiRequest("POST", "/api/factory/bales/relabel/validate", {
        rows: rows.map((r) => ({ currentRef: r.currentRef })),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      return res.json();
    },
    onSuccess: (data) => {
      setValidationResults(data.results);
      setStep("validate");
    },
    onError: (e: any) => toast({ title: "Validation failed", description: e.message, variant: "destructive" }),
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      const res = await factoryApiRequest("POST", "/api/factory/bales/relabel/apply", {
        rows: validRows.map((r) => ({ currentRef: r.currentRef })),
        printFormat,
        designColor: printFormat === "A4" ? designColor : undefined,
        filename: fileName,
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      return res.json();
    },
    onSuccess: (data) => {
      setApplyResult(data);
      setStep("done");
      toast({ title: "Relabeling applied", description: `${data.items.length} bales recoded successfully` });
    },
    onError: (e: any) => toast({ title: "Apply failed", description: e.message, variant: "destructive" }),
  });

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParseError("");
    setParsedRows([]);
    try {
      const rows = await parseExcelFile(file);
      setParsedRows(rows);
    } catch (err: any) {
      setParseError(err.message);
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const handlePrint = () => {
    if (!applyResult) return;
    const labels: LabelData[] = applyResult.items.map((item) => ({
      referenceNumber: item.newRef,
      articleCode: item.articleCode || "",
      pieces: 1,
      approxWeightKg: item.weightKg || "0",
      productName: item.productName || "",
    }));

    let html = "";
    if (printFormat === "A4") html = generateCombinedLabelsHtml(labels, designColor);
    else if (printFormat === "A5") html = generateA5LabelsHtml(labels);
    else html = generateStickerLabelsHtml(labels);

    const win = window.open("", "_blank");
    if (!win) { toast({ title: "Popup blocked", description: "Allow popups to print labels", variant: "destructive" }); return; }
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 500);
  };

  const handleReset = () => {
    setStep("upload");
    setFileName("");
    setParsedRows([]);
    setParseError("");
    setValidationResults([]);
    setApplyResult(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-title">Bale Relabeling</h1>
          <p className="text-muted-foreground mt-1">Import bales from Excel and generate new reference codes with printable labels</p>
        </div>
        {step !== "upload" && (
          <Button variant="outline" onClick={handleReset} data-testid="button-start-over">
            <RefreshCw className="h-4 w-4 mr-2" /> Start Over
          </Button>
        )}
      </div>

      {/* Progress indicator */}
      <div className="flex items-center gap-2 text-sm">
        {(["upload", "validate", "done"] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-medium ${step === s ? "bg-primary text-primary-foreground border-primary" : step > s || (step === "done" && s !== "done") ? "bg-muted text-muted-foreground border-muted" : "text-muted-foreground border-muted"}`}>
              <span>{i + 1}</span>
              <span>{s === "upload" ? "Upload" : s === "validate" ? "Validate" : "Apply & Print"}</span>
            </div>
            {i < 2 && <div className="h-px w-4 bg-muted-foreground/30" />}
          </div>
        ))}
      </div>

      {/* ── STEP 1: Upload ── */}
      {step === "upload" && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-4 w-4" />
                Upload Excel File
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={downloadExcelTemplate}
                data-testid="button-download-template"
              >
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Download Template
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Upload a <code>.xlsx</code>, <code>.xls</code>, or <code>.csv</code> file with a column containing current bale reference codes.
              Accepted column names: <code>current_reference_code</code>, <code>reference_code</code>, <code>barcode</code>, <code>ref</code>, etc.
            </p>

            {/* Template hint */}
            <div className="flex items-start gap-2 rounded-md bg-muted/50 border p-3 text-sm text-muted-foreground">
              <FileSpreadsheet className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
              <span>
                Not sure of the format? Click <strong>Download Template</strong> above to get a pre-formatted Excel file. Fill in your bale reference codes in the <code>current_reference_code</code> column and upload it here.
              </span>
            </div>

            <div
              className="border-2 border-dashed rounded-md p-8 text-center cursor-pointer hover-elevate"
              onClick={() => fileRef.current?.click()}
              data-testid="drop-zone-upload"
            >
              <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm font-medium">{fileName || "Click to select a file"}</p>
              {fileName && (
                <p className="text-xs text-muted-foreground mt-1">{parsedRows.length} row(s) parsed</p>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={handleFileSelect}
              data-testid="input-file-upload"
            />

            {parseError && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{parseError}</span>
              </div>
            )}

            {parsedRows.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <span>{parsedRows.length} reference code(s) found in file</span>
                </div>
                <div className="max-h-48 overflow-y-auto border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-16">Row</TableHead>
                        <TableHead>Current Reference Code</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {parsedRows.slice(0, 20).map((r) => (
                        <TableRow key={r.rowNum} data-testid={`row-preview-${r.rowNum}`}>
                          <TableCell className="text-muted-foreground text-xs">{r.rowNum}</TableCell>
                          <TableCell className="font-mono text-sm">{r.currentRef}</TableCell>
                        </TableRow>
                      ))}
                      {parsedRows.length > 20 && (
                        <TableRow>
                          <TableCell colSpan={2} className="text-center text-xs text-muted-foreground py-2">
                            +{parsedRows.length - 20} more rows
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
                <Button
                  onClick={() => validateMutation.mutate(parsedRows)}
                  disabled={validateMutation.isPending}
                  data-testid="button-validate"
                >
                  {validateMutation.isPending ? "Validating..." : "Validate References"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── STEP 2: Validate ── */}
      {step === "validate" && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Total Rows", value: validationResults.length, color: "" },
              { label: "Valid", value: validRows.length, color: "text-green-600" },
              { label: "Invalid", value: invalidRows.length, color: invalidRows.length > 0 ? "text-destructive" : "" },
              { label: "File", value: fileName, color: "text-muted-foreground" },
            ].map(({ label, value, color }) => (
              <Card key={label}>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className={`text-lg font-bold truncate ${color}`}>{value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Validation table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Validation Results</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-80 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Current Reference</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Weight (kg)</TableHead>
                      <TableHead>Stock Status</TableHead>
                      <TableHead>Valid</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {validationResults.map((r, i) => (
                      <TableRow key={i} className={r.valid ? "" : "bg-destructive/5"} data-testid={`row-validation-${i}`}>
                        <TableCell className="font-mono text-sm">{r.currentRef}</TableCell>
                        <TableCell className="text-sm">{r.productName || <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="text-sm">{r.weightKg ? parseFloat(r.weightKg).toFixed(1) : "—"}</TableCell>
                        <TableCell>
                          {r.status ? (
                            <Badge variant={r.status === "IN_STOCK" ? "secondary" : "outline"} className="text-xs">
                              {r.status}
                            </Badge>
                          ) : "—"}
                        </TableCell>
                        <TableCell>
                          {r.valid ? (
                            <CheckCircle className="h-4 w-4 text-green-600" />
                          ) : (
                            <div className="flex items-center gap-1 text-destructive text-xs">
                              <AlertCircle className="h-3.5 w-3.5" />
                              {r.error}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Print format */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Printer className="h-4 w-4" />
                Label Format
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Paper Format</Label>
                  <Select value={printFormat} onValueChange={(v) => setPrintFormat(v as any)} data-testid="select-print-format">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="A4">A4 (Full Page)</SelectItem>
                      <SelectItem value="A5">A5 (Half Page)</SelectItem>
                      <SelectItem value="STICKER">Sticker (3"×2")</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {printFormat === "A4" && (
                  <div className="space-y-1.5">
                    <Label>Label Design</Label>
                    <Select value={designColor} onValueChange={(v) => setDesignColor(v as A4DesignColor)} data-testid="select-design-color">
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {A4_DESIGN_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            <div className="flex items-center gap-2">
                              <div className="h-3 w-3 rounded-full border" style={{ backgroundColor: opt.color }} />
                              {opt.label}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {validRows.length === 0 && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              No valid rows found. Please fix your file and start over.
            </div>
          )}

          <div className="flex gap-2 flex-wrap">
            <Button
              onClick={() => applyMutation.mutate()}
              disabled={validRows.length === 0 || applyMutation.isPending}
              data-testid="button-apply"
            >
              {applyMutation.isPending
                ? "Applying..."
                : `Generate New Codes & Apply (${validRows.length} bales)`}
            </Button>
            <Button variant="outline" onClick={handleReset} data-testid="button-cancel">
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Done ── */}
      {step === "done" && applyResult && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-md border border-green-600/30 bg-green-600/10 p-4 text-sm text-green-700 dark:text-green-400">
            <CheckCircle className="h-5 w-5" />
            <span className="font-medium">{applyResult.items.length} bales successfully relabeled.</span>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">Bales Relabeled</p>
                <p className="text-2xl font-bold">{applyResult.items.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">Format</p>
                <p className="text-2xl font-bold">{printFormat}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">Session ID</p>
                <p className="text-2xl font-bold">#{applyResult.sessionId}</p>
              </CardContent>
            </Card>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 flex-wrap">
            <Button onClick={handlePrint} data-testid="button-print-labels">
              <Printer className="h-4 w-4 mr-2" /> Print Labels ({printFormat})
            </Button>
            <Button
              variant="outline"
              onClick={() => downloadCsv(applyResult.items, `relabeling-${applyResult.sessionId}.csv`)}
              data-testid="button-export-csv"
            >
              <Download className="h-4 w-4 mr-2" /> Export Result CSV
            </Button>
          </div>

          {/* ── Label Preview ── */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <CardTitle className="text-base flex items-center gap-2">
                  <Eye className="h-4 w-4" />
                  Label Preview
                  <Badge variant="secondary" className="text-xs font-normal">{printFormat}</Badge>
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowLabelPreview((v) => !v)}
                  data-testid="button-toggle-preview"
                >
                  {showLabelPreview ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  {showLabelPreview ? "Hide" : "Show"}
                </Button>
              </div>
            </CardHeader>
            {showLabelPreview && (
              <CardContent>
                <p className="text-xs text-muted-foreground mb-3">
                  Preview of your labels — showing {Math.min(applyResult.items.length, 6)} of {applyResult.items.length}. Click <strong>Print Labels</strong> above to print all.
                </p>
                <div className="flex gap-4 overflow-x-auto pb-3">
                  {applyResult.items.slice(0, 6).map((item, i) => (
                    <LabelPreviewCard
                      key={i}
                      item={item}
                      designColor={designColor}
                      printFormat={printFormat}
                    />
                  ))}
                </div>
                {applyResult.items.length > 6 && (
                  <p className="text-xs text-muted-foreground mt-2">
                    +{applyResult.items.length - 6} more labels will be included when printing.
                  </p>
                )}
              </CardContent>
            )}
          </Card>

          {/* Mapping table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Tag className="h-4 w-4" />
                Old → New Reference Mapping
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-80 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Old Reference</TableHead>
                      <TableHead>New Reference</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Weight (kg)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {applyResult.items.map((item, i) => (
                      <TableRow key={i} data-testid={`row-result-${i}`}>
                        <TableCell className="font-mono text-sm text-muted-foreground line-through">{item.oldRef}</TableCell>
                        <TableCell className="font-mono text-sm font-medium">{item.newRef}</TableCell>
                        <TableCell className="text-sm">{item.productName}</TableCell>
                        <TableCell className="text-sm">{parseFloat(item.weightKg).toFixed(1)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── History panel ── */}
      <div className="border rounded-md">
        <button
          type="button"
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover-elevate"
          onClick={() => setShowHistory((v) => !v)}
          data-testid="button-toggle-history"
        >
          <span>Recent Relabeling Sessions</span>
          {showHistory ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {showHistory && (
          <div className="border-t px-4 pb-4 pt-2">
            {sessions.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No sessions yet</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>File</TableHead>
                    <TableHead>Format</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Valid</TableHead>
                    <TableHead>Invalid</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.map((s: any) => (
                    <TableRow key={s.id} data-testid={`row-session-${s.id}`}>
                      <TableCell className="text-sm">{formatDisplayDate(s.createdAt?.split("T")[0] || "")}</TableCell>
                      <TableCell className="text-sm text-muted-foreground truncate max-w-40">{s.uploadedFilename || "—"}</TableCell>
                      <TableCell><Badge variant="secondary" className="text-xs">{s.printFormat}</Badge></TableCell>
                      <TableCell className="text-sm">{s.totalRows}</TableCell>
                      <TableCell className="text-sm text-green-600">{s.validRows}</TableCell>
                      <TableCell className="text-sm text-destructive">{s.invalidRows}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
