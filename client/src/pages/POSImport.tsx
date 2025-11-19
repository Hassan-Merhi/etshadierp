import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Upload, FileSpreadsheet, CheckCircle, XCircle, Download, ShoppingCart, AlertTriangle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Location {
  id: number;
  name: string;
}

interface LedgerAccount {
  id: number;
  code: string;
  name: string;
  accountType: string;
}

export default function POSImport() {
  const [_location, navigate] = useLocation();
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [validationResult, setValidationResult] = useState<any>(null);
  const [selectedLocation, setSelectedLocation] = useState<string>("");
  const [selectedCashAccount, setSelectedCashAccount] = useState<string>("");
  const [saleDate, setSaleDate] = useState<string>(new Date().toISOString().split("T")[0]);
  const [showWarningDialog, setShowWarningDialog] = useState(false);

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  const { data: ledgerAccounts = [] } = useQuery<LedgerAccount[]>({
    queryKey: ["/api/ledger-accounts"],
  });

  const parseMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const res = await fetch("/api/pos-import/parse", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to parse file");
      }
      return await res.json();
    },
    onSuccess: (data) => {
      setPreview(data);
      setValidationResult(null);
      toast({
        title: "File parsed successfully",
        description: `Found ${data.items.length} item(s) totaling ${data.totalValue.toFixed(2)}. Click Validate to check the data.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Parse error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const validateMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/pos-import/validate", data);
      return await res.json();
    },
    onSuccess: (data) => {
      setValidationResult(data);
      const errorCount = data.errors?.length || 0;
      if (errorCount === 0) {
        toast({
          title: "Validation passed",
          description: "All items validated successfully. You can now import the data.",
        });
      } else {
        toast({
          title: "Validation failed",
          description: `Found ${errorCount} error(s). Please fix them before importing.`,
          variant: "destructive",
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Validation error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/pos-import/import", data);
      return await res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Import successful",
        description: `${data.itemsCount} items imported. Total sales: ${data.totalSales}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      navigate("/vouchers");
    },
    onError: (error: any) => {
      toast({
        title: "Import error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setPreview(null);
      setValidationResult(null);
    }
  };

  const handleParse = () => {
    if (!file) {
      toast({
        title: "No file selected",
        description: "Please select an Excel file to upload",
        variant: "destructive",
      });
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    parseMutation.mutate(formData);
  };

  const handleValidate = () => {
    if (!selectedLocation) {
      toast({
        title: "Location required",
        description: "Please select a location",
        variant: "destructive",
      });
      return;
    }

    if (!selectedCashAccount) {
      toast({
        title: "Cash account required",
        description: "Please select a cash account",
        variant: "destructive",
      });
      return;
    }

    if (!preview) {
      toast({
        title: "No preview data",
        description: "Please parse the file first",
        variant: "destructive",
      });
      return;
    }

    validateMutation.mutate({
      locationId: parseInt(selectedLocation),
      saleDate,
      items: preview.items,
    });
  };

  const doImport = () => {
    importMutation.mutate({
      locationId: parseInt(selectedLocation),
      cashAccountId: parseInt(selectedCashAccount),
      saleDate,
      items: validationResult.validatedItems,
    });
  };

  const handleImport = () => {
    if (!selectedLocation) {
      toast({
        title: "Location required",
        description: "Please select a location",
        variant: "destructive",
      });
      return;
    }

    if (!selectedCashAccount) {
      toast({
        title: "Cash account required",
        description: "Please select a cash account",
        variant: "destructive",
      });
      return;
    }

    if (!preview) {
      toast({
        title: "No preview data",
        description: "Please parse the file first",
        variant: "destructive",
      });
      return;
    }

    if (!isValidated) {
      toast({
        title: "Validation required",
        description: "Please validate the data before importing",
        variant: "destructive",
      });
      return;
    }

    if (hasValidationErrors) {
      toast({
        title: "Validation errors present",
        description: "Please fix validation errors before importing",
        variant: "destructive",
      });
      return;
    }

    if (!validationResult?.validatedItems) {
      toast({
        title: "Validation data missing",
        description: "Please validate again before importing",
        variant: "destructive",
      });
      return;
    }

    // Check if there are inventory warnings
    const hasWarnings = validationResult?.warnings && validationResult.warnings.length > 0;
    
    if (hasWarnings) {
      // Show confirmation dialog
      setShowWarningDialog(true);
    } else {
      // No warnings, proceed with import
      doImport();
    }
  };

  const handleConfirmImport = () => {
    setShowWarningDialog(false);
    doImport();
  };

  const downloadTemplate = () => {
    window.open("/api/pos-import/template", "_blank");
  };

  const isValidated = validationResult !== null;
  const hasValidationErrors = validationResult?.errors && validationResult.errors.length > 0;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <ShoppingCart className="h-8 w-8" />
            POS Import
          </h1>
          <p className="text-muted-foreground mt-1">
            Import sales transactions from Excel (Barcode, Quantity, Selling Rate)
          </p>
        </div>
        <Button variant="outline" onClick={downloadTemplate} data-testid="button-download-template">
          <Download className="h-4 w-4 mr-2" />
          Download Template
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upload Sales Data</CardTitle>
          <CardDescription>
            Upload an Excel file with columns: Barcode, Quantity, Rate
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="file">Excel File</Label>
              <Input
                id="file"
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileChange}
                data-testid="input-file"
              />
              {file && (
                <p className="text-sm text-muted-foreground">
                  Selected: {file.name}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="saleDate">Sale Date</Label>
              <Input
                id="saleDate"
                type="date"
                value={saleDate}
                onChange={(e) => setSaleDate(e.target.value)}
                data-testid="input-sale-date"
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="location">Location</Label>
              <Select value={selectedLocation} onValueChange={setSelectedLocation}>
                <SelectTrigger id="location" data-testid="select-location">
                  <SelectValue placeholder="Select location" />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((location) => (
                    <SelectItem key={location.id} value={location.id.toString()}>
                      {location.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cashAccount">Cash Account</Label>
              <Select value={selectedCashAccount} onValueChange={setSelectedCashAccount}>
                <SelectTrigger id="cashAccount" data-testid="select-cash-account">
                  <SelectValue placeholder="Select cash account" />
                </SelectTrigger>
                <SelectContent>
                  {ledgerAccounts
                    .filter((account) => account.accountType === "Cash")
                    .map((account) => (
                      <SelectItem key={account.id} value={account.id.toString()}>
                        {account.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleParse}
              disabled={!file || parseMutation.isPending}
              data-testid="button-parse"
            >
              <FileSpreadsheet className="h-4 w-4 mr-2" />
              {parseMutation.isPending ? "Parsing..." : "Parse File"}
            </Button>

            <Button
              onClick={handleValidate}
              disabled={!preview || !selectedLocation || !selectedCashAccount || validateMutation.isPending}
              variant="outline"
              data-testid="button-validate"
            >
              {isValidated ? (
                hasValidationErrors ? (
                  <XCircle className="h-4 w-4 mr-2 text-destructive" />
                ) : (
                  <CheckCircle className="h-4 w-4 mr-2 text-green-600" />
                )
              ) : null}
              {validateMutation.isPending ? "Validating..." : "Validate"}
            </Button>

            <Button
              onClick={handleImport}
              disabled={!isValidated || hasValidationErrors || importMutation.isPending}
              data-testid="button-import"
            >
              <Upload className="h-4 w-4 mr-2" />
              {importMutation.isPending ? "Importing..." : "Import"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {validationResult?.errors && validationResult.errors.length > 0 && (
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive">Validation Errors</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc list-inside space-y-1">
              {validationResult.errors.map((error: string, index: number) => (
                <li key={index} className="text-sm text-destructive">
                  {error}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {preview && (
        <Card>
          <CardHeader>
            <CardTitle>Preview ({preview.items.length} items)</CardTitle>
            <CardDescription>
              Total Sales Value: ${preview.totalValue.toFixed(2)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Barcode</TableHead>
                    <TableHead>Item Name</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.items.map((item: any, index: number) => {
                    const validation = validationResult?.validatedItems?.[index];
                    const hasError = validation?.error;

                    return (
                      <TableRow key={index} className={hasError ? "bg-destructive/10" : ""}>
                        <TableCell className="font-mono">{item.barcode}</TableCell>
                        <TableCell>
                          {validation?.stockItemName || (
                            <span className="text-muted-foreground italic">Unknown</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">{item.quantity}</TableCell>
                        <TableCell className="text-right">${item.rate.toFixed(2)}</TableCell>
                        <TableCell className="text-right font-medium">
                          ${(item.quantity * item.rate).toFixed(2)}
                        </TableCell>
                        <TableCell>
                          {validation ? (
                            hasError ? (
                              <div className="flex items-center gap-1 text-destructive">
                                <XCircle className="h-4 w-4" />
                                <span className="text-sm">{validation.error}</span>
                              </div>
                            ) : validation.warning ? (
                              <div className="flex items-center gap-1 text-amber-600">
                                <AlertTriangle className="h-4 w-4" />
                                <span className="text-sm">{validation.warning}</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1 text-green-600">
                                <CheckCircle className="h-4 w-4" />
                                <span className="text-sm">OK</span>
                              </div>
                            )
                          ) : (
                            <span className="text-sm text-muted-foreground">Not validated</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={showWarningDialog} onOpenChange={setShowWarningDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              Inventory Warnings
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>The following items will have inventory issues after this import:</p>
              <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-950/20 rounded-md border border-amber-200 dark:border-amber-800 max-h-60 overflow-y-auto">
                <ul className="list-disc list-inside space-y-1 text-sm">
                  {validationResult?.warnings?.map((warning: string, index: number) => (
                    <li key={index} className="text-amber-900 dark:text-amber-100">
                      {warning}
                    </li>
                  ))}
                </ul>
              </div>
              <p className="mt-3 font-semibold">Are you sure you want to proceed with the import?</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-import">Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleConfirmImport} 
              data-testid="button-confirm-import"
              className="bg-amber-600 hover:bg-amber-700"
            >
              Proceed Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
