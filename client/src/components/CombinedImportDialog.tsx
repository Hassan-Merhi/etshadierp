import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import * as XLSX from "xlsx";
import { Download } from "lucide-react";

interface CombinedImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CombinedImportDialog({ open, onOpenChange }: CombinedImportDialogProps) {
  const [pricesFile, setPricesFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();

  const importMutation = useMutation({
    mutationFn: async (data: Array<{ barcode: string; sellingPrice: string }>) => {
      return await apiRequest("POST", "/api/stock-items/bulk-update-prices", { prices: data });
    },
    onSuccess: (result: any) => {
      toast({
        title: "Success",
        description: result.message || "Prices imported successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-items"] });
      setPricesFile(null);
      setIsProcessing(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to import prices",
        variant: "destructive",
      });
      setIsProcessing(false);
    },
  });

  const downloadPricesTemplate = () => {
    const template = [
      { Barcode: "BAR001", "Selling Price": 100.00 },
      { Barcode: "BAR002", "Selling Price": 200.00 },
    ];

    const ws = XLSX.utils.json_to_sheet(template);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Prices");
    XLSX.writeFile(wb, "selling_prices_template.xlsx");

    toast({
      title: "Template Downloaded",
      description: "Use this template to prepare your selling prices data",
    });
  };

  const handlePricesFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      setPricesFile(e.target.files[0]);
    }
  };

  const handleImportPrices = async () => {
    if (!pricesFile) {
      toast({
        title: "Error",
        description: "Please select a file",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    try {
      const arrayBuffer = await pricesFile.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: "array" });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(worksheet) as Array<{ Barcode?: string; "Selling Price"?: string | number }>;

      if (data.length === 0) {
        toast({
          title: "Error",
          description: "No data found in file",
          variant: "destructive",
        });
        setIsProcessing(false);
        return;
      }

      const prices = data
        .map((row) => ({
          barcode: String(row.Barcode || "").trim(),
          sellingPrice: String(row["Selling Price"] || "0").trim(),
        }))
        .filter((item) => item.barcode);

      if (prices.length === 0) {
        toast({
          title: "Error",
          description: "No valid barcode entries found",
          variant: "destructive",
        });
        setIsProcessing(false);
        return;
      }

      importMutation.mutate(prices);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to read file",
        variant: "destructive",
      });
      setIsProcessing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" data-testid="dialog-combined-import">
        <DialogHeader>
          <DialogTitle>Import Data</DialogTitle>
          <DialogDescription>
            Choose what you'd like to import
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="prices" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="prices">Import Prices</TabsTrigger>
            <TabsTrigger value="items">Import Items</TabsTrigger>
          </TabsList>

          <TabsContent value="prices" className="space-y-4">
            <div className="space-y-4 mt-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">File</label>
                <Input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handlePricesFileChange}
                  data-testid="input-import-prices-file"
                />
                <p className="text-xs text-muted-foreground">
                  Excel file should have columns: "Barcode" and "Selling Price"
                </p>
              </div>

              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={downloadPricesTemplate}
                data-testid="button-download-prices-template"
              >
                <Download className="h-4 w-4" />
                Download Template
              </Button>

              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  data-testid="button-cancel-prices-import"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleImportPrices}
                  disabled={!pricesFile || isProcessing}
                  data-testid="button-confirm-prices-import"
                >
                  {isProcessing ? "Importing..." : "Import"}
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="items" className="space-y-4">
            <div className="mt-4 p-4 bg-muted/50 rounded-md space-y-3">
              <p className="text-sm text-muted-foreground">
                To import stock items, use the dedicated import page with full validation and preview.
              </p>
              <a href="/import-stock-items">
                <Button className="w-full" data-testid="button-go-to-import-items">
                  Go to Import Items Page
                </Button>
              </a>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
