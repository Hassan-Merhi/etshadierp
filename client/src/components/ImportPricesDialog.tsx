import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import * as XLSX from "xlsx";

interface ImportPricesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImportPricesDialog({ open, onOpenChange }: ImportPricesDialogProps) {
  const [file, setFile] = useState<File | null>(null);
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
      setFile(null);
      onOpenChange(false);
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleImport = async () => {
    if (!file) {
      toast({
        title: "Error",
        description: "Please select a file",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
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

      // Validate data format
      const prices = data.map((row) => ({
        barcode: String(row.Barcode || "").trim(),
        sellingPrice: String(row["Selling Price"] || "0").trim(),
      })).filter(item => item.barcode);

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
      <DialogContent data-testid="dialog-import-prices">
        <DialogHeader>
          <DialogTitle>Import Selling Prices</DialogTitle>
          <DialogDescription>
            Upload an Excel file with Barcode and Selling Price columns to update prices
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">File</label>
            <Input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileChange}
              data-testid="input-import-file"
            />
            <p className="text-xs text-muted-foreground">
              Excel file should have columns: "Barcode" and "Selling Price"
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              data-testid="button-cancel-import"
            >
              Cancel
            </Button>
            <Button
              onClick={handleImport}
              disabled={!file || isProcessing}
              data-testid="button-confirm-import"
            >
              {isProcessing ? "Importing..." : "Import"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
