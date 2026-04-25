import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useReactToPrint } from "react-to-print";
import { formatNumber } from "@/lib/formatNumber";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Upload, FileSpreadsheet, CheckCircle, XCircle, Download, ShoppingCart, AlertTriangle, CreditCard, Printer } from "lucide-react";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { useCompany } from "@/contexts/CompanyContext";
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

interface Customer {
  id: number;
  legalName: string;
}

export default function POSImport() {
  const [_location, navigate] = useLocation();
  const { toast } = useToast();
  const { displayCurrency, exchangeRate, isLoadingCompany } = useCurrencyContext();
  const { selectedCompany } = useCompany();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [validationResult, setValidationResult] = useState<any>(null);
  const [selectedLocation, setSelectedLocation] = useState<string>("");
  const [selectedCashAccount, setSelectedCashAccount] = useState<string>("");
  const [selectedCustomer, setSelectedCustomer] = useState<string>("");
  const [isCreditSale, setIsCreditSale] = useState(false);
  const [saleDate, setSaleDate] = useState<string>(new Date().toLocaleDateString('en-CA'));
  const [showWarningDialog, setShowWarningDialog] = useState(false);
  const [saleCurrency, setSaleCurrency] = useState<"USD" | "CFA">("USD");
  const [showPrintDialog, setShowPrintDialog] = useState(false);
  const [importedSale, setImportedSale] = useState<any>(null);
  const [printTime, setPrintTime] = useState<string>("");
  const printRef   = useRef<HTMLDivElement>(null);
  const errorsRef  = useRef<HTMLDivElement>(null);

  const fmtPrint = (n: number, prefix = "") => {
    const fixed = Math.abs(n).toFixed(2);
    const clean = fixed.replace(/\.00$/, "");
    const parts = clean.split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const num = parts.join(".");
    return prefix ? prefix + "\u00A0" + num : num;
  };

  // Print always shows USD amounts
  const printCurrPrefix = "$";

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  const { data: ledgerAccounts = [] } = useQuery<LedgerAccount[]>({
    queryKey: ["/api/ledger-accounts"],
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers/for-pos"],
    enabled: isCreditSale,
  });

  const { data: authUser } = useQuery<any>({
    queryKey: ["/api/auth/me"],
  });
  const printUserName = authUser?.fullName || authUser?.name || authUser?.username || authUser?.email || "Import";

  // Show currency selector when company has displayCurrency = "CFA" and data has loaded
  const showCurrencySelector = !isLoadingCompany && displayCurrency === "CFA";

  // Default to CFA when company has displayCurrency = CFA
  useEffect(() => {
    if (displayCurrency === "CFA") {
      setSaleCurrency("CFA");
    }
  }, [displayCurrency]);

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
        description: `Found ${data.items.length} item(s) totaling ${formatNumber(data.totalValue)}. Click Validate to check the data.`,
      });
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
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
          description: `Found ${errorCount} error(s). Scroll down to see the full list.`,
          variant: "destructive",
        });
        // Auto-scroll to the error list so the user sees them immediately
        setTimeout(() => {
          errorsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 100);
      }
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Validation error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `${(importedSale?.location?.name || "POS").replace(/\s+/g, "_")}_${new Date().toLocaleDateString('en-CA')}`,
    onAfterPrint: () => {
      setShowPrintDialog(false);
      navigate("/vouchers");
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
      
      const location = locations.find(l => l.id === parseInt(selectedLocation));
      const itemsForPrint = saleCurrency === "CFA" && exchangeRate
        ? (validationResult?.validatedItems || []).map((item: any) => ({
            ...item,
            rate: (parseFloat(item.rate) / exchangeRate).toFixed(2),
          }))
        : (validationResult?.validatedItems || []);
      setImportedSale({
        voucher: data.voucher,
        items: itemsForPrint,
        grandTotal: data.totalSales,
        saleDate,
        location,
        isCreditSale: false,
      });
      setPrintTime(new Date().toLocaleTimeString());
      setShowPrintDialog(true);
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Import error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const creditImportMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/credit-sales-import/import", data);
      return await res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Credit Sale Import successful",
        description: `${data.itemsCount} items imported. Total: $${data.totalSales} to ${data.customerName}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers/for-pos"] });
      
      const location = locations.find(l => l.id === parseInt(selectedLocation));
      const customer = customers.find(c => c.id === parseInt(selectedCustomer));
      const itemsForPrint = saleCurrency === "CFA" && exchangeRate
        ? (validationResult?.validatedItems || []).map((item: any) => ({
            ...item,
            rate: (parseFloat(item.rate) / exchangeRate).toFixed(2),
          }))
        : (validationResult?.validatedItems || []);
      setImportedSale({
        voucher: data.voucher,
        items: itemsForPrint,
        grandTotal: data.totalSales,
        saleDate,
        location,
        isCreditSale: true,
        customer: customer ? { name: customer.legalName } : null,
      });
      setPrintTime(new Date().toLocaleTimeString());
      setShowPrintDialog(true);
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Credit Import error",
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
    if (!navigator.onLine) {
      toast({ title: "Not available offline", description: "File imports require a connection", variant: "destructive" });
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

    if (!isCreditSale && !selectedCashAccount) {
      toast({
        title: "Cash account required",
        description: "Please select a cash account",
        variant: "destructive",
      });
      return;
    }

    if (isCreditSale && !selectedCustomer) {
      toast({
        title: "Customer required",
        description: "Please select a customer for credit sale",
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
    // Convert CFA rates to USD if needed
    let itemsToImport = validationResult.validatedItems;
    if (saleCurrency === "CFA" && exchangeRate) {
      // Convert CFA to USD: CFA_amount / rate = USD_amount
      itemsToImport = validationResult.validatedItems.map((item: any) => ({
        ...item,
        rate: (parseFloat(item.rate) / exchangeRate).toFixed(2),
      }));
    }

    if (isCreditSale) {
      creditImportMutation.mutate({
        locationId: parseInt(selectedLocation),
        customerId: parseInt(selectedCustomer),
        saleDate,
        items: itemsToImport,
      });
    } else {
      importMutation.mutate({
        locationId: parseInt(selectedLocation),
        cashAccountId: parseInt(selectedCashAccount),
        saleDate,
        items: itemsToImport,
      });
    }
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

    if (!isCreditSale && !selectedCashAccount) {
      toast({
        title: "Cash account required",
        description: "Please select a cash account",
        variant: "destructive",
      });
      return;
    }

    if (isCreditSale && !selectedCustomer) {
      toast({
        title: "Customer required",
        description: "Please select a customer for credit sale",
        variant: "destructive",
      });
      return;
    }

    if (saleCurrency === "CFA" && !exchangeRate) {
      toast({
        title: "Exchange rate required",
        description: "Please set an exchange rate in Settings before importing CFA sales",
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
    <div className="container mx-auto p-4 md:p-6 space-y-4 md:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
            {isCreditSale ? <CreditCard className="h-8 w-8" /> : <ShoppingCart className="h-8 w-8" />}
            {isCreditSale ? "Credit Sales Import" : "POS Import"}
          </h1>
          <p className="text-muted-foreground mt-1">
            Import {isCreditSale ? "credit" : "cash"} sales transactions from Excel (Barcode, Quantity, Selling Rate)
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
          <div className="flex flex-wrap items-center gap-4 p-3 rounded-lg bg-muted/50">
            <div className="flex items-center gap-2">
              <Switch
                id="creditSale"
                checked={isCreditSale}
                onCheckedChange={(checked) => {
                  setIsCreditSale(checked);
                  setSelectedCashAccount("");
                  setSelectedCustomer("");
                  setValidationResult(null);
                }}
                data-testid="switch-credit-sale"
              />
              <Label htmlFor="creditSale" className="cursor-pointer">
                Credit Sale
              </Label>
            </div>
            {isCreditSale && (
              <span className="text-sm text-muted-foreground flex items-center gap-1">
                <CreditCard className="h-4 w-4" />
                Sale will be recorded as receivable from customer
              </span>
            )}
          </div>

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

          {showCurrencySelector && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="currency">Currency (Excel rates are in)</Label>
                <Select value={saleCurrency} onValueChange={(v) => setSaleCurrency(v as "USD" | "CFA")}>
                  <SelectTrigger id="currency" data-testid="select-currency">
                    <SelectValue placeholder="Select currency" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="CFA">CFA</SelectItem>
                  </SelectContent>
                </Select>
                {saleCurrency === "CFA" && exchangeRate && (
                  <p className="text-sm text-muted-foreground">
                    Rate: 1 USD = {formatNumber(exchangeRate)} CFA. Amounts will be converted to USD.
                  </p>
                )}
                {saleCurrency === "CFA" && !exchangeRate && (
                  <p className="text-sm text-destructive">
                    No exchange rate set. Please set a rate in Settings before importing CFA sales.
                  </p>
                )}
              </div>
            </div>
          )}

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

            {isCreditSale ? (
              <div className="space-y-2">
                <Label htmlFor="customer">Customer</Label>
                <Select value={selectedCustomer} onValueChange={setSelectedCustomer}>
                  <SelectTrigger id="customer" data-testid="select-customer">
                    <SelectValue placeholder="Select customer" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map((customer) => (
                      <SelectItem key={customer.id} value={customer.id.toString()}>
                        {customer.legalName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
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
            )}
          </div>

          <div className="flex flex-wrap gap-2">
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
              disabled={!preview || !selectedLocation || (!isCreditSale && !selectedCashAccount) || (isCreditSale && !selectedCustomer) || validateMutation.isPending}
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
              disabled={!isValidated || hasValidationErrors || importMutation.isPending || creditImportMutation.isPending}
              data-testid="button-import"
            >
              <Upload className="h-4 w-4 mr-2" />
              {importMutation.isPending || creditImportMutation.isPending ? "Importing..." : "Import"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {validationResult?.errors && validationResult.errors.length > 0 && (
        <Card className="border-destructive" ref={errorsRef}>
          <CardHeader className="pb-3">
            <CardTitle className="text-destructive flex items-center gap-2">
              <XCircle className="h-5 w-5" />
              Validation Errors
              <span className="ml-auto text-sm font-normal bg-destructive text-destructive-foreground rounded-full px-2 py-0.5">
                {validationResult.errors.length} error{validationResult.errors.length !== 1 ? "s" : ""}
              </span>
            </CardTitle>
            <p className="text-sm text-muted-foreground">Fix these barcodes or remove the rows from your Excel file before importing.</p>
          </CardHeader>
          <CardContent>
            <ul className="max-h-72 overflow-y-auto space-y-1.5 pr-1">
              {validationResult.errors.map((error: string, index: number) => (
                <li key={index} className="flex items-start gap-2 text-sm text-destructive bg-destructive/5 rounded px-2 py-1">
                  <span className="font-mono text-xs text-muted-foreground shrink-0 mt-0.5 w-6 text-right">{index + 1}.</span>
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
              Total Sales Value: {saleCurrency === "CFA" ? "CFA " : "$"}{formatNumber(preview.totalValue)}
              {saleCurrency === "CFA" && exchangeRate && (
                <span className="ml-2 text-muted-foreground">
                  (≈ ${formatNumber(preview.totalValue / exchangeRate)} USD after conversion)
                </span>
              )}
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
                    <TableHead className="text-right">Rate ({saleCurrency})</TableHead>
                    <TableHead className="text-right">Total ({saleCurrency})</TableHead>
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
                        <TableCell className="text-right">
                          {saleCurrency === "CFA" ? "CFA " : "$"}{formatNumber(item.rate)}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {saleCurrency === "CFA" ? "CFA " : "$"}{formatNumber(item.quantity * item.rate)}
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

      {/* Print Dialog */}
      <AlertDialog open={showPrintDialog} onOpenChange={setShowPrintDialog}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Import Successful</AlertDialogTitle>
            <AlertDialogDescription>
              Sale has been imported successfully. Would you like to print the invoice?
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          {/* Hidden Print Template - matches POS invoice style */}
          <div className="hidden">
            <div ref={printRef} style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '11pt', padding: '12px', backgroundColor: 'white', color: 'black', width: '100%', fontWeight: 'normal', fontVariantNumeric: 'tabular-nums' }}>
              <style dangerouslySetInnerHTML={{ __html: `
                @media print {
                  body { font-family: Arial, Helvetica, sans-serif !important; }
                  * { font-family: Arial, Helvetica, sans-serif !important; font-variant-numeric: tabular-nums !important; }
                }
              `}} />

              {/* Title */}
              <div style={{ textAlign: 'center', fontWeight: '900', fontSize: '18pt', letterSpacing: '2px', marginBottom: '6px' }}>
                POS INVOICE
              </div>

              {/* Invoice Info */}
              <div style={{ fontSize: '11pt', fontWeight: '700', display: 'flex', justifyContent: 'space-between', borderTop: '2px solid black', borderBottom: '2px solid black', padding: '5px 0', marginBottom: '6px' }}>
                <span>Date: {importedSale?.saleDate}</span>
                <span>User: {printUserName}</span>
              </div>

              {/* Daily Exchange Rate - Only for Mali company */}
              {selectedCompany?.name?.toLowerCase().includes('mali') && (importedSale?.voucher?.exchangeRate || exchangeRate) && (
                <div style={{ fontSize: '11pt', fontWeight: '700', marginBottom: '6px', padding: '4px', border: '2px solid black', textAlign: 'center' }}>
                  <span style={{ fontWeight: '900' }}>Daily Rate:</span> $1 = {formatNumber(parseFloat(importedSale?.voucher?.exchangeRate) || exchangeRate || 0)} CFA
                </div>
              )}

              {/* Credit Sale Customer Info */}
              {importedSale?.isCreditSale && importedSale?.customer && (
                <div style={{ fontSize: '10pt', fontWeight: '700', marginBottom: '6px', padding: '4px', border: '2px solid black' }}>
                  <div style={{ fontWeight: '900' }}>CREDIT SALE</div>
                  <div>Customer: {importedSale.customer.name}</div>
                </div>
              )}

              {/* Items Table */}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11pt', marginBottom: '0', fontVariantNumeric: 'tabular-nums' }}>
                <thead className="sticky top-0 z-10 bg-muted/50">
                  <tr style={{ borderBottom: '2px solid black' }}>
                    <th style={{ textAlign: 'left', padding: '4px 3px', width: '48%', fontWeight: '900', borderRight: '2px solid black' }}>Description</th>
                    <th style={{ textAlign: 'center', padding: '4px 3px', width: '12%', fontWeight: '900' }}>Qty</th>
                    <th style={{ textAlign: 'center', padding: '4px 3px', width: '20%', fontWeight: '900' }}>Rate</th>
                    <th style={{ textAlign: 'center', padding: '4px 3px', width: '20%', fontWeight: '900' }}>Amt</th>
                  </tr>
                </thead>
                <tbody>
                  {(importedSale?.items ?? []).map((item: any, idx: number) => {
                    const rate = parseFloat(item.rate || 0);
                    const qty = parseFloat(item.quantity || 0);
                    return (
                      <tr key={idx} style={{ borderBottom: '1px solid #b0b8c1', backgroundColor: idx % 2 === 0 ? 'white' : '#f2f5f8' }}>
                        <td style={{ padding: '4px 3px', verticalAlign: 'top', wordBreak: 'break-word', fontWeight: '600', lineHeight: '1.3', borderRight: '2px solid black' }}>{item.stockItemName || item.itemCode}</td>
                        <td style={{ textAlign: 'center', padding: '4px 3px', verticalAlign: 'top', fontWeight: '600' }}>{fmtPrint(qty)}</td>
                        <td style={{ textAlign: 'center', padding: '4px 3px', verticalAlign: 'top', fontWeight: '600' }}>{fmtPrint(rate, printCurrPrefix)}</td>
                        <td style={{ textAlign: 'center', padding: '4px 3px', verticalAlign: 'top', fontWeight: '600' }}>{fmtPrint(qty * rate, printCurrPrefix)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid black', fontWeight: '900' }}>
                    <td style={{ padding: '5px 3px', fontWeight: '900', borderRight: '2px solid black' }}>TOTAL</td>
                    <td style={{ textAlign: 'center', padding: '5px 3px' }}>{fmtPrint((importedSale?.items ?? []).reduce((sum: number, item: any) => sum + parseFloat(item.quantity || 0), 0))}</td>
                    <td style={{ padding: '5px 3px' }}></td>
                    <td style={{ textAlign: 'center', padding: '5px 3px', fontWeight: '900' }}>
                      {fmtPrint((importedSale?.items ?? []).reduce((sum: number, item: any) => sum + parseFloat(item.quantity || 0) * parseFloat(item.rate || 0), 0), printCurrPrefix)}
                    </td>
                  </tr>
                </tfoot>
              </table>

              {/* Total Paid */}
              <div style={{ fontSize: '14pt', fontWeight: '900', marginTop: '8px', paddingTop: '8px', borderTop: '2px solid black', display: 'flex', justifyContent: 'space-between' }}>
                <span>TOTAL PAID:</span>
                <span>{fmtPrint((importedSale?.items ?? []).reduce((sum: number, item: any) => sum + parseFloat(item.quantity || 0) * parseFloat(item.rate || 0), 0), printCurrPrefix)}</span>
              </div>

              {/* Notes */}
              {importedSale?.voucher?.description && (
                <div style={{ fontSize: '9pt', fontWeight: '600', marginTop: '8px', padding: '4px', border: '2px solid black' }}>
                  <span style={{ fontWeight: '900' }}>Note:</span> {importedSale.voucher.description}
                </div>
              )}

              {/* Footer */}
              <div style={{ textAlign: 'center', fontSize: '9pt', fontWeight: '700', marginTop: '10px', paddingTop: '5px', borderTop: '2px solid black' }}>
                <div>Thank you for your business!</div>
              </div>
            </div>
          </div>

          <AlertDialogFooter>
            <Button variant="outline" onClick={() => { setShowPrintDialog(false); navigate("/vouchers"); }} data-testid="button-skip-print">
              Skip
            </Button>
            <Button onClick={handlePrint} className="gap-2" data-testid="button-print-imported-invoice">
              <Printer className="h-4 w-4" />
              Print Invoice
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
