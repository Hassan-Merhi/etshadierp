import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ChevronLeft, ChevronRight, ScanLine, X, Download, Loader2, CalendarDays,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatNumber } from "@/lib/formatNumber";
import * as XLSX from "@/lib/excelHelper";

function toLocalDateStr(d: Date): string {
  return d.toLocaleDateString("en-CA");
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return toLocalDateStr(d);
}

function formatDisplay(dateStr: string): string {
  const [y, m, day] = dateStr.split("-");
  return `${day}/${m}/${y}`;
}

interface DailyScanRow {
  id: number;
  scan_date: string;
  reference_number: string;
  article_code: string | null;
  product_name: string | null;
  weight_kg: string | null;
  scanned_at: string;
}

export default function DailyScan() {
  const today = toLocalDateStr(new Date());
  const [selectedDate, setSelectedDate] = useState(today);
  const [scanInput, setScanInput] = useState("");
  const [scanning, setScanning] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    const t = setTimeout(() => scanRef.current?.focus(), 120);
    return () => clearTimeout(t);
  }, [selectedDate]);

  const { data: scans = [], isLoading } = useQuery<DailyScanRow[]>({
    queryKey: ["/api/factory/daily-bale-scans", selectedDate],
    queryFn: () =>
      fetch(`/api/factory/daily-bale-scans?date=${selectedDate}`, { credentials: "include" })
        .then((r) => r.json()),
    refetchInterval: 4000,
  });

  const totalBales = scans.length;
  const totalKg = scans.reduce((s, b) => s + parseFloat(b.weight_kg || "0"), 0);
  const isToday = selectedDate === today;

  const handleScan = async () => {
    const ref = scanInput.trim().toUpperCase();
    if (!ref) return;
    setScanning(true);
    setScanInput("");

    try {
      let articleCode: string | null = null;
      let productName: string | null = null;
      let weightKg: number | null = null;

      const lookupRes = await fetch(`/api/lookup/reference/${encodeURIComponent(ref)}`, {
        credentials: "include",
      });
      if (lookupRes.ok) {
        const d = await lookupRes.json();
        articleCode = d.articleCode ?? d.article_code ?? null;
        productName = d.productName ?? d.product_name ?? null;
        weightKg   = d.weightKg   ?? d.weight_kg   ?? null;
      }

      const saveRes = await apiRequest("POST", "/api/factory/daily-bale-scans", {
        scanDate: selectedDate,
        referenceNumber: ref,
        articleCode,
        productName,
        weightKg,
      });

      if (!saveRes.ok) {
        const err = await saveRes.json();
        toast({
          title: saveRes.status === 409 ? "Already scanned" : "Scan failed",
          description: err.message,
          variant: "destructive",
        });
        return;
      }

      queryClient.invalidateQueries({ queryKey: ["/api/factory/daily-bale-scans", selectedDate] });
    } catch {
      toast({ title: "Error", description: "Failed to record scan.", variant: "destructive" });
    } finally {
      setScanning(false);
      setTimeout(() => scanRef.current?.focus(), 50);
    }
  };

  const removeMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/factory/daily-bale-scans/${id}`);
      if (!res.ok) throw new Error("Failed to remove");
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["/api/factory/daily-bale-scans", selectedDate] }),
    onError: () =>
      toast({ title: "Error", description: "Could not remove scan.", variant: "destructive" }),
  });

  const handleExport = async () => {
    if (scans.length === 0) {
      toast({ title: "Nothing to export", description: "No scans for this day." });
      return;
    }

    const { ExcelJS } = XLSX;
    const wb = new ExcelJS.Workbook();
    wb.creator = "HMD ERP";
    wb.created = new Date();

    const ws = wb.addWorksheet(formatDisplay(selectedDate));

    const NAVY  = "FF1B2A4A";
    const WHITE = "FFFFFFFF";
    const LGRAY = "FFF5F7FA";
    const thinBorder = { style: "thin" as const, color: { argb: "FFD0D7E0" } };
    const allBorders = { top: thinBorder, left: thinBorder, bottom: thinBorder, right: thinBorder };
    const solidFill  = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });

    ws.columns = [
      { key: "num",    width: 6  },
      { key: "date",   width: 14 },
      { key: "ref",    width: 18 },
      { key: "art",    width: 16 },
      { key: "name",   width: 32 },
      { key: "wt",     width: 14 },
      { key: "time",   width: 12 },
    ];

    const headers = ["#", "Date", "Ref Code", "Article Code", "Product Name", "Weight (kg)", "Scanned At"];
    const hRow = ws.addRow(headers);
    hRow.eachCell((cell) => {
      cell.fill = solidFill(NAVY);
      cell.font = { bold: true, color: { argb: WHITE }, size: 11 };
      cell.border = allBorders;
      cell.alignment = { vertical: "middle", horizontal: "center" };
    });
    hRow.height = 22;

    scans.forEach((s, i) => {
      const row = ws.addRow([
        i + 1,
        formatDisplay(s.scan_date),
        s.reference_number,
        s.article_code || "",
        s.product_name || "",
        s.weight_kg ? parseFloat(s.weight_kg) : "",
        new Date(s.scanned_at).toLocaleTimeString("en-GB"),
      ]);
      row.eachCell((cell) => {
        cell.border = allBorders;
        cell.fill = solidFill(i % 2 === 0 ? WHITE : LGRAY);
        cell.alignment = { vertical: "middle" };
      });
      row.getCell(1).alignment  = { horizontal: "center", vertical: "middle" };
      row.getCell(6).alignment  = { horizontal: "right",  vertical: "middle" };
      row.getCell(7).alignment  = { horizontal: "right",  vertical: "middle" };
    });

    const totalRow = ws.addRow(["", "TOTAL", "", "", "", totalKg, ""]);
    totalRow.eachCell((cell, col) => {
      cell.border  = allBorders;
      cell.font    = { bold: true };
      cell.fill    = solidFill("FFE8F0F8");
      if (col === 6) cell.alignment = { horizontal: "right", vertical: "middle" };
    });

    await XLSX.writeFile(wb, `daily-scan-${selectedDate}.xlsx`);
  };

  return (
    <div className="space-y-4 pt-4">
      {/* ── Date navigation ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant="outline"
          size="icon"
          onClick={() => setSelectedDate(addDays(selectedDate, -1))}
          data-testid="button-daily-scan-prev-day"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <div className="flex items-center gap-1.5 border rounded-md px-2 py-1">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <input
            type="date"
            value={selectedDate}
            max={today}
            onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
            className="bg-transparent text-sm font-medium outline-none"
            data-testid="input-daily-scan-date"
          />
        </div>

        <Button
          variant="outline"
          size="icon"
          onClick={() => setSelectedDate(addDays(selectedDate, 1))}
          disabled={isToday}
          data-testid="button-daily-scan-next-day"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>

        {!isToday && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedDate(today)}
            data-testid="button-daily-scan-today"
          >
            Back to Today
          </Button>
        )}

        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-muted-foreground" data-testid="text-daily-scan-summary">
            {totalBales} bale{totalBales !== 1 ? "s" : ""} · {formatNumber(totalKg)} kg
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            data-testid="button-daily-scan-export"
          >
            <Download className="h-4 w-4 mr-1" />
            Export Excel
          </Button>
        </div>
      </div>

      {/* ── Scan input ── */}
      <div className="flex gap-2">
        <Input
          ref={scanRef}
          value={scanInput}
          onChange={(e) => setScanInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleScan()}
          placeholder="Scan ref code / barcode..."
          className="font-mono"
          data-testid="input-daily-scan-ref"
          disabled={scanning}
        />
        <Button
          onClick={handleScan}
          disabled={scanning || !scanInput.trim()}
          data-testid="button-daily-scan-submit"
        >
          {scanning ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <ScanLine className="h-4 w-4 mr-1" />
              Scan
            </>
          )}
        </Button>
      </div>

      {/* ── Table ── */}
      {isLoading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
      ) : scans.length === 0 ? (
        <div className="py-14 text-center text-sm text-muted-foreground">
          No bales scanned for {formatDisplay(selectedDate)}
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Ref Code</TableHead>
                <TableHead>Article Code</TableHead>
                <TableHead>Product Name</TableHead>
                <TableHead className="text-right">Weight (kg)</TableHead>
                <TableHead className="text-right">Scanned At</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {scans.map((s, i) => (
                <TableRow key={s.id} data-testid={`row-daily-scan-${s.id}`}>
                  <TableCell className="text-muted-foreground text-sm">{i + 1}</TableCell>
                  <TableCell className="font-mono font-medium">{s.reference_number}</TableCell>
                  <TableCell className="text-sm">
                    {s.article_code ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-sm">
                    {s.product_name ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {s.weight_kg
                      ? formatNumber(parseFloat(s.weight_kg))
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">
                    {new Date(s.scanned_at).toLocaleTimeString("en-GB")}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeMutation.mutate(s.id)}
                      disabled={removeMutation.isPending}
                      data-testid={`button-remove-daily-scan-${s.id}`}
                    >
                      <X className="h-4 w-4 text-muted-foreground" />
                    </Button>
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
