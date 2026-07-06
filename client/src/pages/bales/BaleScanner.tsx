import type { RefObject, KeyboardEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Scan } from "lucide-react";

interface BaleScannerProps {
  scanMode: "quick" | "review";
  setScanMode: (mode: "quick" | "review") => void;
  barcodeInput: string;
  setBarcodeInput: (val: string) => void;
  barcodeInputRef: RefObject<HTMLInputElement>;
  onScan: (barcode: string) => void;
}

export function BaleScanner({
  scanMode,
  setScanMode,
  barcodeInput,
  setBarcodeInput,
  barcodeInputRef,
  onScan,
}: BaleScannerProps) {
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      onScan(barcodeInput);
    }
  };

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Scan className="h-5 w-5" />
            Barcode Scanner
          </h2>
          <div className="flex gap-2">
            <Badge
              variant={scanMode === "quick" ? "default" : "outline"}
              className="cursor-pointer hover-elevate"
              onClick={() => setScanMode("quick")}
              data-testid="badge-quick-mode"
            >
              Quick Add
            </Badge>
            <Badge
              variant={scanMode === "review" ? "default" : "outline"}
              className="cursor-pointer hover-elevate"
              onClick={() => setScanMode("review")}
              data-testid="badge-review-mode"
            >
              Review Mode
            </Badge>
          </div>
        </div>

        <div className="flex gap-2">
          <Input
            ref={barcodeInputRef}
            placeholder="Scan or enter barcode..."
            value={barcodeInput}
            onChange={(e) => setBarcodeInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="font-mono text-lg"
            autoFocus
            data-testid="input-barcode-scanner"
          />
          <Button onClick={() => onScan(barcodeInput)} data-testid="button-scan">
            <Scan className="h-4 w-4 mr-2" />
            Scan
          </Button>
        </div>

        <p className="text-sm text-muted-foreground">
          {scanMode === "quick"
            ? "Scan barcode to instantly create bale with default values"
            : "Scan barcode to review details before adding"}
        </p>
      </div>
    </Card>
  );
}
