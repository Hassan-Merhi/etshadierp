import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ArrowLeft, Upload, Download, CheckCircle2, AlertCircle } from "lucide-react";
import { utils, writeFile, readFile, read, ExcelJS } from "@/lib/excelHelper";
import { useCompany } from "@/contexts/CompanyContext";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PageHeader } from "@/components/PageHeader";

interface ImportRow {
  code: string;
  name: string;
  unit?: string;
  stockGroupCode?: string;
}

interface ValidationError {
  row: number;
  field: string;
  message: string;
}

export default function ImportStockItems() {
  const [_location, navigate] = useLocation();
  const { toast } = useToast();
  const { selectedCompany } = useCompany();
  const [file, setFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<ImportRow[]>([]);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [importComplete, setImportComplete] = useState(false);

  const downloadTemplate = async () => {
    const template = [
      { code: "ITEM001", name: "Cotton Bale Grade A", unit: "Bale", stockGroupCode: "GRP001" },
      { code: "ITEM002", name: "Cotton Bale Grade B", unit: "Bale", stockGroupCode: "GRP001" },
    ];

    const ws = utils.json_to_sheet(template);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "Stock Items");
    await writeFile(wb, "stock_items_template.xlsx");

    toast({
      title: "Template Downloaded",
      description: "Use this template to prepare your stock items data",
    });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setErrors([]);
    setPreviewData([]);
    setImportComplete(false);

    try {
      const data = await selectedFile.arrayBuffer();
      const workbook = await read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = utils.sheet_to_json<any>(worksheet);

      // Validate file has data
      if (jsonData.length === 0) {
        toast({
          title: "Empty File",
          description: "The Excel file is empty. Please add data rows and try again.",
          variant: "destructive",
        });
        return;
      }

      // Read header row explicitly to get all column names (avoids issues with blank first-row cells)
      const headerRow = utils.sheet_to_json<string[]>(worksheet, { header: 1 })[0] || [];
      const columns = headerRow.map((h: any) => String(h || "").trim());
      const requiredCols = ["code", "name"];
      const missingCols = requiredCols.filter(col => !columns.includes(col));
      
      if (missingCols.length > 0) {
        toast({
          title: "Missing Required Columns",
          description: `Expected columns: ${requiredCols.join(", ")}. Found: ${columns.slice(0, 5).join(", ")}${columns.length > 5 ? "..." : ""}. Download the template to see expected format.`,
          variant: "destructive",
        });
        return;
      }

      const validationErrors: ValidationError[] = [];
      const rows: ImportRow[] = [];

      jsonData.forEach((row, index) => {
        const rowNumber = index + 2; // +2 because Excel is 1-indexed and has header row

        if (!row.code || String(row.code).trim() === "") {
          validationErrors.push({
            row: rowNumber,
            field: "code",
            message: "Code is required",
          });
        }

        if (!row.name || String(row.name).trim() === "") {
          validationErrors.push({
            row: rowNumber,
            field: "name",
            message: "Name is required",
          });
        }

        rows.push({
          code: String(row.code || "").trim(),
          name: String(row.name || "").trim(),
          unit: row.unit ? String(row.unit).trim() : "Bale",
          stockGroupCode: row.stockGroupCode ? String(row.stockGroupCode).trim() : undefined,
        });
      });

      setPreviewData(rows);
      setErrors(validationErrors);

      if (validationErrors.length === 0) {
        toast({
          title: "File Validated",
          description: `${rows.length} stock items ready to import`,
        });
      } else {
        toast({
          title: "Validation Errors Found",
          description: `Found ${validationErrors.length} errors. Please fix them before importing.`,
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error Reading File",
        description: "Please ensure the file is a valid Excel file (.xlsx)",
        variant: "destructive",
      });
    }
  };

  const handleImport = async () => {
    if (!selectedCompany) {
      toast({
        title: "No Company Selected",
        description: "Please select a company first",
        variant: "destructive",
      });
      return;
    }

    if (errors.length > 0) {
      toast({
        title: "Cannot Import",
        description: "Please fix validation errors first",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);

    try {
      // Fetch stock groups to map codes to IDs
      const stockGroupsData: any[] = await fetch("/api/stock-groups", {
        credentials: "include",
      }).then(res => res.json());
      
      const stockGroupMap = new Map(
        stockGroupsData.map((sg: any) => [sg.code, sg.id])
      );

      const itemsToImport = previewData.map(row => {
        const item: any = {
          companyId: selectedCompany.id,
          code: row.code,
          name: row.name,
          uom: row.unit || "Bale",
          active: true,
        };

        // Add optional fields only if they have values
        if (row.stockGroupCode && stockGroupMap.has(row.stockGroupCode)) {
          item.stockGroupId = stockGroupMap.get(row.stockGroupCode);
        }

        return item;
      });

      await apiRequest("POST", "/api/stock-items/import", { items: itemsToImport });

      queryClient.invalidateQueries({ queryKey: ["/api/stock-items"] });

      setImportComplete(true);
      toast({
        title: "Import Successful",
        description: `Successfully imported ${itemsToImport.length} stock items`,
      });
    } catch (error: any) {
      toast({
        title: "Import Failed",
        description: error.message || "Failed to import stock items",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReset = async () => {
    setFile(null);
    setPreviewData([]);
    setErrors([]);
    setImportComplete(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/accounting-create")}
          data-testid="button-back"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <PageHeader title="Import Stock Items" subtitle="Bulk import stock items from Excel spreadsheet" />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upload Excel File</CardTitle>
          <CardDescription>
            Download the template, fill in your stock items data, and upload it here
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <Button
              variant="outline"
              onClick={downloadTemplate}
              data-testid="button-download-template"
            >
              <Download className="h-4 w-4 mr-2" />
              Download Template
            </Button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="file-upload">Select Excel File</Label>
            <Input
              id="file-upload"
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileChange}
              disabled={isProcessing || importComplete}
              data-testid="input-file-upload"
            />
            {file && (
              <p className="text-sm text-muted-foreground">
                Selected: {file.name}
              </p>
            )}
          </div>

          {errors.length > 0 && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <div className="font-semibold mb-2">
                  {errors.length} validation error{errors.length > 1 ? "s" : ""} found:
                </div>
                <ul className="list-disc list-inside space-y-1">
                  {errors.slice(0, 10).map((error, index) => (
                    <li key={index} className="text-sm">
                      Row {error.row}, {error.field}: {error.message}
                    </li>
                  ))}
                  {errors.length > 10 && (
                    <li className="text-sm">
                      ... and {errors.length - 10} more errors
                    </li>
                  )}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {importComplete && (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>
                Import completed successfully! {previewData.length} stock items have been created.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {previewData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Preview ({previewData.length} items)</CardTitle>
            <CardDescription>
              Review the data before importing
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="border rounded-md overflow-auto max-h-96">
              <table className="w-full">
                <thead className="sticky top-0 z-30 bg-muted/50">
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-2 text-sm font-medium">Code</th>
                    <th className="text-left p-2 text-sm font-medium">Name</th>
                    <th className="text-left p-2 text-sm font-medium">Unit</th>
                    <th className="text-left p-2 text-sm font-medium">Stock Group</th>
                  </tr>
                </thead>
                <tbody>
                  {previewData.slice(0, 50).map((item, index) => (
                    <tr key={index} className="border-b last:border-b-0">
                      <td className="p-2 text-sm">{item.code}</td>
                      <td className="p-2 text-sm">{item.name}</td>
                      <td className="p-2 text-sm">{item.unit}</td>
                      <td className="p-2 text-sm text-muted-foreground">
                        {item.stockGroupCode || "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {previewData.length > 50 && (
                <div className="p-2 text-center text-sm text-muted-foreground border-t">
                  ... and {previewData.length - 50} more items
                </div>
              )}
            </div>

            <div className="flex gap-4 mt-4">
              <Button
                onClick={handleImport}
                disabled={isProcessing || errors.length > 0 || importComplete}
                data-testid="button-import"
              >
                <Upload className="h-4 w-4 mr-2" />
                {isProcessing ? "Importing..." : "Import Stock Items"}
              </Button>
              {importComplete && (
                <Button
                  variant="outline"
                  onClick={handleReset}
                  data-testid="button-import-another"
                >
                  Import Another File
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
