import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { PageHeader } from "@/components/PageHeader";

// Format number to remove unnecessary .00 and add commas
const formatCurrency = (num: number) => {
  return num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Upload, FileSpreadsheet, CheckCircle, XCircle, Download, Check, ChevronsUpDown, Printer } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { Supplier } from "@shared/schema";

interface SupplierComboboxProps {
  value: string;
  onValueChange: (value: string) => void;
  suppliers: Supplier[];
  placeholder?: string;
  testId?: string;
}

function SupplierCombobox({ value, onValueChange, suppliers, placeholder = "Select supplier", testId }: SupplierComboboxProps) {
  const [open, setOpen] = useState(false);
  
  const selectedSupplier = suppliers.find((supplier) => supplier.id.toString() === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
          data-testid={testId}
        >
          {selectedSupplier ? selectedSupplier.legalName : placeholder}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0" align="start">
        <Command>
          <CommandInput placeholder="Search suppliers..." />
          <CommandList>
            <CommandEmpty>No supplier found.</CommandEmpty>
            <CommandGroup>
              {suppliers.map((supplier) => (
                <CommandItem
                  key={supplier.id}
                  value={supplier.legalName}
                  onSelect={() => {
                    onValueChange(supplier.id.toString());
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === supplier.id.toString() ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {supplier.legalName}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default function POImport() {
  const [_location, navigate] = useLocation();
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [validationResult, setValidationResult] = useState<any>(null);
  const [selectedSupplier, setSelectedSupplier] = useState<string>("");
  const [containerNumber, setContainerNumber] = useState<string>("");
  const [importDate, setImportDate] = useState<string>(new Date().toLocaleDateString('en-CA'));
  const [showPrintDialog, setShowPrintDialog] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
  });

  const parseMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const res = await fetch("/api/po-import/parse", {
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
      if (data.preview.length > 0) {
        setContainerNumber(data.preview[0].containerNumber || "");
      }
      toast({
        title: "File parsed successfully",
        description: `Found ${data.preview.length} container(s) with ${data.preview.reduce((sum: number, p: any) => sum + p.itemsCount, 0)} items. Click Validate to check the data.`,
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
      const res = await apiRequest("POST", "/api/po-import/validate", data);
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
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Validation error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/po-import/import", data);
      return await res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Import successful",
        description: `Container ${data.containerNumber} imported with ${data.itemsCount} items`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/containers"] });
      setImportResult(data);
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setPreview(null);
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

  const handleImport = () => {
    if (!selectedSupplier) {
      toast({
        title: "Supplier required",
        description: "Please select a supplier",
        variant: "destructive",
      });
      return;
    }

    if (!containerNumber) {
      toast({
        title: "Container number required",
        description: "Please enter a container number",
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

    importMutation.mutate({
      fileHash: preview.fileHash,
      fileName: preview.fileName,
      containerNumber,
      supplierId: parseInt(selectedSupplier),
      importDate,
      preview: preview.preview,
    });
  };

  const handleValidate = () => {
    if (!selectedSupplier) {
      toast({
        title: "Supplier required",
        description: "Please select a supplier",
        variant: "destructive",
      });
      return;
    }

    if (!containerNumber) {
      toast({
        title: "Container number required",
        description: "Please enter a container number",
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
      fileHash: preview.fileHash,
      fileName: preview.fileName,
      containerNumber,
      supplierId: parseInt(selectedSupplier),
      importDate,
      preview: preview.preview,
    });
  };

  const handleCancel = () => {
    setFile(null);
    setPreview(null);
    setValidationResult(null);
    setContainerNumber("");
    setSelectedSupplier("");
  };

  const hasValidationErrors = validationResult && validationResult.errors && validationResult.errors.length > 0;
  const isValidated = validationResult !== null;

  const handleDownloadTemplate = () => {
    window.open("/api/po-import/template", "_blank");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <PageHeader title="PO Import (Excel)" />
        <Button
          variant="outline"
          onClick={handleDownloadTemplate}
          data-testid="button-download-template"
        >
          <Download className="w-4 h-4 mr-2" />
          Download Template
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upload Purchase Order Excel File</CardTitle>
          <CardDescription>
            Three-step process: Parse → Validate → Import. Need help? Download the template above to see the required format.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="file-upload">Step 1: Select & Parse Excel File (.xlsx)</Label>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                id="file-upload"
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileChange}
                data-testid="input-file-upload"
              />
              <Button
                onClick={handleParse}
                disabled={!file || parseMutation.isPending}
                data-testid="button-parse"
              >
                {parseMutation.isPending ? (
                  "Parsing..."
                ) : (
                  <>
                    <FileSpreadsheet className="w-4 h-4 mr-2" />
                    Parse
                  </>
                )}
              </Button>
            </div>
            {file && (
              <p className="text-sm text-muted-foreground">
                Selected: {file.name}
              </p>
            )}
          </div>

          {preview && (
            <>
              <div className="space-y-4">
                <Label>Step 2: Configure Import Details</Label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="supplier">Supplier *</Label>
                    <SupplierCombobox
                      value={selectedSupplier}
                      onValueChange={setSelectedSupplier}
                      suppliers={suppliers}
                      placeholder="Select supplier"
                      testId="select-supplier"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="container-number">Container Number *</Label>
                    <Input
                      id="container-number"
                      value={containerNumber}
                      onChange={(e) => {
                        setContainerNumber(e.target.value);
                        setValidationResult(null);
                      }}
                      placeholder="CNTR-001"
                      data-testid="input-container-number"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="import-date">Import Date</Label>
                    <Input
                      id="import-date"
                      type="date"
                      value={importDate}
                      onChange={(e) => setImportDate(e.target.value)}
                      data-testid="input-import-date"
                    />
                  </div>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {preview && preview.preview.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Preview & Validation</CardTitle>
            <CardDescription>
              Review the data and validate before importing. {preview.preview.length} container(s) found
            </CardDescription>
          </CardHeader>
          <CardContent>
            {validationResult && hasValidationErrors && (
              <div className="mb-4 p-4 bg-destructive/10 border border-destructive rounded-md">
                <div className="flex items-start gap-2">
                  <XCircle className="w-5 h-5 text-destructive mt-0.5" />
                  <div>
                    <h3 className="font-semibold text-destructive">Validation Errors Found</h3>
                    <ul className="mt-2 space-y-1 text-sm text-destructive">
                      {validationResult.errors.map((error: any, idx: number) => (
                        <li key={idx}>• {error}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {validationResult && !hasValidationErrors && (
              <div className="mb-4 p-4 bg-green-500/10 border border-green-500 rounded-md">
                <div className="flex items-start gap-2">
                  <CheckCircle className="w-5 h-5 text-green-600 mt-0.5" />
                  <div>
                    <h3 className="font-semibold text-green-600">Validation Passed</h3>
                    <p className="mt-1 text-sm text-green-600">
                      All items validated successfully. Ready to import.
                    </p>
                  </div>
                </div>
              </div>
            )}
            {preview.preview.map((container: any, idx: number) => (
              <div key={idx} className="space-y-4 mb-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">
                    Container: {container.containerNumber}
                  </h3>
                  <div className="flex gap-4 text-sm">
                    <span className="text-muted-foreground">
                      {container.itemsCount} items
                    </span>
                    <span className="text-muted-foreground">
                      {container.posCount} PO(s)
                    </span>
                  </div>
                </div>

                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>PO Number</TableHead>
                        <TableHead>Item Name</TableHead>
                        <TableHead className="text-right">Quantity</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                        <TableHead className="text-right">Line Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {container.items.map((item: any, itemIdx: number) => (
                        <TableRow key={itemIdx}>
                          <TableCell>{item.poNumber}</TableCell>
                          <TableCell>{item.itemName}</TableCell>
                          <TableCell className="text-right">{formatCurrency(Number(item.quantity))}</TableCell>
                          <TableCell className="text-right">${formatCurrency(Number(item.rate))}</TableCell>
                          <TableCell className="text-right font-medium">${formatCurrency(Number(item.lineTotal))}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 p-4 bg-muted rounded-md">
                  <div>
                    <p className="text-sm text-muted-foreground">Items Total</p>
                    <p className="text-lg font-semibold">${formatCurrency(Number(container.itemsTotal))}</p>
                  </div>
                  {container.charges.freight > 0 && (
                    <div>
                      <p className="text-sm text-muted-foreground">Freight</p>
                      <p className="text-lg font-semibold">${formatCurrency(Number(container.charges.freight))}</p>
                    </div>
                  )}
                  {container.charges.surcharge > 0 && (
                    <div>
                      <p className="text-sm text-muted-foreground">Surcharge</p>
                      <p className="text-lg font-semibold">${formatCurrency(Number(container.charges.surcharge))}</p>
                    </div>
                  )}
                  {container.charges.fumigation > 0 && (
                    <div>
                      <p className="text-sm text-muted-foreground">Fumigation</p>
                      <p className="text-lg font-semibold">${formatCurrency(Number(container.charges.fumigation))}</p>
                    </div>
                  )}
                  {container.charges.discount > 0 && (
                    <div>
                      <p className="text-sm text-muted-foreground">Discount</p>
                      <p className="text-lg font-semibold text-red-500">-${formatCurrency(Number(container.charges.discount))}</p>
                    </div>
                  )}
                  {container.charges.documentCharges > 0 && (
                    <div>
                      <p className="text-sm text-muted-foreground">Document Charges</p>
                      <p className="text-lg font-semibold">${formatCurrency(Number(container.charges.documentCharges))}</p>
                    </div>
                  )}
                  <div className="col-span-full border-t pt-2">
                    <p className="text-sm text-muted-foreground">Grand Total</p>
                    <p className="text-xl font-bold">${formatCurrency(Number(container.grandTotal))}</p>
                  </div>
                </div>
              </div>
            ))}

            <div className="flex flex-wrap gap-2 justify-end mt-4">
              <Button variant="outline" onClick={handleCancel} data-testid="button-cancel">
                Cancel
              </Button>
              <Button
                onClick={handleValidate}
                disabled={validateMutation.isPending || !selectedSupplier || !containerNumber}
                variant={isValidated && !hasValidationErrors ? "secondary" : "default"}
                data-testid="button-validate"
              >
                {validateMutation.isPending ? (
                  "Validating..."
                ) : (
                  <>
                    {isValidated && !hasValidationErrors ? (
                      <CheckCircle className="w-4 h-4 mr-2" />
                    ) : (
                      <FileSpreadsheet className="w-4 h-4 mr-2" />
                    )}
                    {isValidated ? "Re-validate" : "Validate"}
                  </>
                )}
              </Button>
              <Button
                onClick={handleImport}
                disabled={importMutation.isPending || !isValidated || hasValidationErrors}
                data-testid="button-import"
              >
                {importMutation.isPending ? (
                  "Importing..."
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Import
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Print Dialog */}
      <Dialog open={showPrintDialog} onOpenChange={setShowPrintDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import Successful</DialogTitle>
            <DialogDescription>
              Container {importResult?.containerNumber} was imported with {importResult?.itemsCount} items.
              Would you like to print or view the container?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowPrintDialog(false);
                if (importResult?.containerId) {
                  navigate(`/containers/${importResult.containerId}`);
                }
              }}
              data-testid="button-skip-print"
            >
              Skip Print
            </Button>
            <Button
              onClick={() => {
                setShowPrintDialog(false);
                if (importResult?.containerId) {
                  navigate(`/containers/${importResult.containerId}?print=true`);
                }
              }}
              data-testid="button-print-container"
            >
              <Printer className="w-4 h-4 mr-2" />
              Print
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
