import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Settings, Printer, TestTube } from "lucide-react";
import {
  getPrintMode,
  setPrintMode,
  getPrinterName,
  setPrinterName,
  listPrinters,
  printRawZpl,
  type PrintMode,
} from "@/lib/zebraPrint";
import { buildZplTestLabel } from "@/lib/zplBuilder";

export type PaperFormat = "A4" | "A5";

const PAPER_FORMAT_KEY = "label_paper_format";

export function getPaperFormat(): PaperFormat {
  const val = localStorage.getItem(PAPER_FORMAT_KEY);
  if (val === "A5") return "A5";
  return "A4";
}

export function setPaperFormatSetting(format: PaperFormat) {
  localStorage.setItem(PAPER_FORMAT_KEY, format);
}

export function LabelPrintSettings() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<PrintMode>(getPrintMode());
  const [printer, setPrinter] = useState(getPrinterName());
  const [paperFormat, setPaperFormat] = useState<PaperFormat>(getPaperFormat());
  const [printers, setPrinters] = useState<string[]>([]);
  const [loadingPrinters, setLoadingPrinters] = useState(false);
  const [testPrinting, setTestPrinting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    setMode(getPrintMode());
    setPrinter(getPrinterName());
    setPaperFormat(getPaperFormat());
  }, [open]);

  const handleModeChange = (newMode: string) => {
    const m = newMode as PrintMode;
    setMode(m);
    setPrintMode(m);
  };

  const handlePrinterChange = (name: string) => {
    setPrinter(name);
    setPrinterName(name);
  };

  const handleRefreshPrinters = async () => {
    setLoadingPrinters(true);
    try {
      const list = await listPrinters();
      setPrinters(list);
      if (list.length === 0) {
        toast({ title: "No printers found", description: "Make sure QZ Tray is running", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Error loading printers", description: err.message, variant: "destructive" });
    } finally {
      setLoadingPrinters(false);
    }
  };

  const handleTestPrint = async () => {
    setTestPrinting(true);
    try {
      const zpl = buildZplTestLabel();
      await printRawZpl(zpl);
      toast({ title: "Test label sent", description: "Check your Zebra printer" });
    } catch (err: any) {
      toast({ title: "Test print failed", description: err.message, variant: "destructive" });
    } finally {
      setTestPrinting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid="button-label-print-settings">
          <Settings className="w-4 h-4 mr-1" />
          Print Settings
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Label Print Settings</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Paper Format</Label>
            <Select
              value={paperFormat}
              onValueChange={(val) => {
                const f = val as PaperFormat;
                setPaperFormat(f);
                setPaperFormatSetting(f);
              }}
            >
              <SelectTrigger data-testid="select-paper-format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="A4">A4 - 1 label per sheet</SelectItem>
                <SelectItem value="A5">A5 - For A5 printers</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {paperFormat === "A4"
                ? "Each A4 sheet prints one label: detail block on top half, product name on bottom half."
                : "Each bale prints 2 A5 portrait pages: page 1 has detail block on top + product name below, page 2 has large product name. Select A5 paper and Portrait in print dialog."}
            </p>
          </div>

          <div className="space-y-2">
            <Label>Print Mode</Label>
            <Select value={mode} onValueChange={handleModeChange}>
              <SelectTrigger data-testid="select-print-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BROWSER">Browser Print (Default)</SelectItem>
                <SelectItem value="ZEBRA_RAW">Zebra RAW (ZPL via QZ Tray)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {mode === "BROWSER"
                ? "Labels print through browser print dialog (works with any printer)."
                : "Labels sent as raw ZPL directly to Zebra thermal printer via QZ Tray. Requires QZ Tray installed."}
            </p>
          </div>

          {mode === "ZEBRA_RAW" && (
            <>
              <div className="space-y-2">
                <Label>Zebra Printer</Label>
                <div className="flex gap-2">
                  <Select value={printer} onValueChange={handlePrinterChange}>
                    <SelectTrigger data-testid="select-zebra-printer" className="flex-1">
                      <SelectValue placeholder="Select printer..." />
                    </SelectTrigger>
                    <SelectContent>
                      {printers.map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleRefreshPrinters}
                    disabled={loadingPrinters}
                    data-testid="button-refresh-printers"
                  >
                    <Printer className="w-4 h-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Click the printer icon to scan for available printers. QZ Tray must be running.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Test Print</Label>
                <Button
                  variant="outline"
                  onClick={handleTestPrint}
                  disabled={testPrinting || !printer}
                  data-testid="button-test-zebra-print"
                  className="w-full"
                >
                  <TestTube className="w-4 h-4 mr-1" />
                  {testPrinting ? "Sending..." : "Print Test Label (Darkness Check)"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Prints a test label with ^MD30 darkness to verify output is dark enough.
                </p>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
