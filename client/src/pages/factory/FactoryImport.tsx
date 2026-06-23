import { useState, useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import type { FactoryBaleProduct } from "@shared/schema";
import {
  Upload,
  FileSpreadsheet,
  Plus,
  Trash2,
  Download,
  Users,
  Package,
  Boxes,
  AlertCircle,
  CheckCircle2,
  X,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { factoryApiRequest } from "@/lib/factoryApi";
import Papa from "papaparse";

type ImportTab = "suppliers" | "raw-stock" | "bales" | "opening-stock" | "ob-edit";

interface SupplierRow {
  name: string;
  openingBalance: string;
  contactPerson: string;
  phone: string;
  email: string;
}

interface RawStockRow {
  containerNumber: string;
  supplierName: string;
  receivedKg: string;
  usedKg: string;
  costPerKg: string;
  arrivalDate: string;
}

interface BaleRow {
  baleCode: string;
  articleCode: string;
  productName: string;
  category: string;
  grade: string;
  weightKg: string;
  costPerKg: string;
  status: string;
}

const EMPTY_SUPPLIER: SupplierRow = { name: "", openingBalance: "0", contactPerson: "", phone: "", email: "" };
const EMPTY_RAW_STOCK: RawStockRow = {
  containerNumber: "",
  supplierName: "",
  receivedKg: "",
  usedKg: "0",
  costPerKg: "",
  arrivalDate: "",
};
const EMPTY_BALE: BaleRow = {
  baleCode: "",
  articleCode: "",
  productName: "",
  category: "",
  grade: "",
  weightKg: "",
  costPerKg: "0",
  status: "FINALIZED",
};

function downloadTemplate(type: string) {
  window.open(`/api/factory/import/template/${type}`, "_blank");
}

export default function FactoryImport() {
  const [activeTab, setActiveTab] = useState<ImportTab>("suppliers");
  const { toast } = useToast();

  const tabs: { key: ImportTab; label: string; icon: typeof Users }[] = [
    { key: "suppliers", label: "Supplier Balances", icon: Users },
    { key: "raw-stock", label: "Raw Stock", icon: Package },
    { key: "bales", label: "Bales Inventory", icon: Boxes },
    { key: "opening-stock", label: "Opening Raw Stock", icon: Package },
    { key: "ob-edit", label: "Edit Opening Balance", icon: Users },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <Button
              key={tab.key}
              variant={activeTab === tab.key ? "default" : "outline"}
              onClick={() => setActiveTab(tab.key)}
              data-testid={`tab-import-${tab.key}`}
            >
              <Icon className="h-4 w-4 mr-2" />
              {tab.label}
            </Button>
          );
        })}
      </div>

      {activeTab === "suppliers" && <SupplierImport />}
      {activeTab === "raw-stock" && <RawStockImport />}
      {activeTab === "bales" && <BaleImport />}
      {activeTab === "opening-stock" && <OpeningStockImport />}
      {activeTab === "ob-edit" && <SupplierObEdit />}
    </div>
  );
}

function SupplierImport() {
  const [mode, setMode] = useState<"choose" | "csv" | "manual">("choose");
  const [rows, setRows] = useState<SupplierRow[]>([{ ...EMPTY_SUPPLIER }]);
  const [csvData, setCsvData] = useState<SupplierRow[]>([]);
  const [result, setResult] = useState<{ imported: number; updated: number; errors: string[] } | null>(null);
  const { toast } = useToast();

  const importMutation = useMutation({
    mutationFn: async (suppliers: SupplierRow[]) => {
      const res = await factoryApiRequest("POST", "/api/factory/import/suppliers", { suppliers });
      return res.json();
    },
    onSuccess: (data) => {
      setResult(data);
      toast({ title: "Import complete", description: `${data.imported} created, ${data.updated} updated` });
    },
    onError: (err: any) => {
      if (err?._handledGlobally) return;
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    },
  });

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split(".").pop()?.toLowerCase();

    if (ext === "csv" || ext === "txt") {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const parsed: SupplierRow[] = results.data
            .map((row: any) => ({
              name: (row.name || "").trim(),
              openingBalance: (row.openingBalance || row.opening_balance || "0").trim(),
              contactPerson: (row.contactPerson || row.contact_person || "").trim(),
              phone: (row.phone || "").trim(),
              email: (row.email || "").trim(),
            }))
            .filter((r: SupplierRow) => r.name);
          setCsvData(parsed);
          setMode("csv");
        },
      });
    } else if (ext === "xlsx" || ext === "xls") {
      const reader = new FileReader();
      reader.onload = async (evt) => {
        const XLSX = await import("@/lib/excelHelper");
        const wb = await XLSX.read(evt.target?.result, { type: "binary" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws) as any[];
        const parsed: SupplierRow[] = data
          .map((row) => ({
            name: String(row.name || row.Name || "").trim(),
            openingBalance: String(row.openingBalance || row.opening_balance || row["Opening Balance"] || "0").trim(),
            contactPerson: String(row.contactPerson || row.contact_person || row["Contact Person"] || "").trim(),
            phone: String(row.phone || row.Phone || "").trim(),
            email: String(row.email || row.Email || "").trim(),
          }))
          .filter((r) => r.name);
        setCsvData(parsed);
        setMode("csv");
      };
      reader.readAsBinaryString(file);
    }
    e.target.value = "";
  }, []);

  if (result) {
    return (
      <ImportResult
        result={result}
        onReset={() => {
          setResult(null);
          setMode("choose");
          setCsvData([]);
          setRows([{ ...EMPTY_SUPPLIER }]);
        }}
      />
    );
  }

  if (mode === "choose") {
    return (
      <ImportModeChooser
        title="Import Supplier Balances"
        description="Import opening balances for factory suppliers. Existing suppliers will be updated, new ones will be created."
        templateType="suppliers"
        onFileUpload={handleFileUpload}
        onManual={() => setMode("manual")}
      />
    );
  }

  if (mode === "csv") {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-lg">Preview Supplier Data ({csvData.length} rows)</CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setMode("choose");
                  setCsvData([]);
                }}
                data-testid="button-back-csv"
              >
                <X className="h-4 w-4 mr-1" /> Cancel
              </Button>
              <Button
                onClick={() => importMutation.mutate(csvData)}
                disabled={importMutation.isPending}
                data-testid="button-confirm-import-suppliers"
              >
                {importMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Import {csvData.length} Suppliers
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="border rounded-md overflow-auto max-h-96">
            <Table>
              <TableHeader className="sticky top-0 z-30 bg-background">
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Opening Balance</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Email</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {csvData.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>{row.openingBalance}</TableCell>
                    <TableCell>{row.contactPerson}</TableCell>
                    <TableCell>{row.phone}</TableCell>
                    <TableCell>{row.email}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <ManualEntryCard
      title="Add Supplier Balances"
      columns={["Name *", "Opening Balance", "Contact", "Phone", "Email"]}
      rows={rows}
      onAdd={() => setRows([...rows, { ...EMPTY_SUPPLIER }])}
      onRemove={(i) => setRows(rows.filter((_, idx) => idx !== i))}
      onChange={(i, field, value) => {
        const updated = [...rows];
        (updated[i] as any)[field] = value;
        setRows(updated);
      }}
      onSubmit={() => importMutation.mutate(rows.filter((r) => r.name))}
      isPending={importMutation.isPending}
      onBack={() => setMode("choose")}
      renderRow={(row, i, onChange) => (
        <>
          <TableCell>
            <Input
              value={row.name}
              onChange={(e) => onChange(i, "name", e.target.value)}
              placeholder="Supplier name"
              data-testid={`input-supplier-name-${i}`}
            />
          </TableCell>
          <TableCell>
            <Input
              value={row.openingBalance}
              onChange={(e) => onChange(i, "openingBalance", e.target.value)}
              placeholder="0"
              type="number"
              step="0.01"
              data-testid={`input-supplier-balance-${i}`}
            />
          </TableCell>
          <TableCell>
            <Input
              value={row.contactPerson}
              onChange={(e) => onChange(i, "contactPerson", e.target.value)}
              placeholder="Contact person"
              data-testid={`input-supplier-contact-${i}`}
            />
          </TableCell>
          <TableCell>
            <Input
              value={row.phone}
              onChange={(e) => onChange(i, "phone", e.target.value)}
              placeholder="Phone"
              data-testid={`input-supplier-phone-${i}`}
            />
          </TableCell>
          <TableCell>
            <Input
              value={row.email}
              onChange={(e) => onChange(i, "email", e.target.value)}
              placeholder="Email"
              data-testid={`input-supplier-email-${i}`}
            />
          </TableCell>
        </>
      )}
    />
  );
}

function RawStockImport() {
  const [mode, setMode] = useState<"choose" | "csv" | "manual">("choose");
  const [rows, setRows] = useState<RawStockRow[]>([{ ...EMPTY_RAW_STOCK }]);
  const [csvData, setCsvData] = useState<RawStockRow[]>([]);
  const [result, setResult] = useState<{ imported: number; errors: string[] } | null>(null);
  const { toast } = useToast();

  const importMutation = useMutation({
    mutationFn: async (items: RawStockRow[]) => {
      const res = await factoryApiRequest("POST", "/api/factory/import/raw-stock", { items });
      return res.json();
    },
    onSuccess: (data) => {
      setResult(data);
      toast({ title: "Import complete", description: `${data.imported} raw stock records imported` });
    },
    onError: (err: any) => {
      if (err?._handledGlobally) return;
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    },
  });

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase();

    if (ext === "csv" || ext === "txt") {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const parsed: RawStockRow[] = results.data
            .map((row: any) => ({
              containerNumber: (row.containerNumber || row.container_number || "").trim(),
              supplierName: (row.supplierName || row.supplier_name || "").trim(),
              receivedKg: (row.receivedKg || row.received_kg || "").trim(),
              usedKg: (row.usedKg || row.used_kg || "0").trim(),
              costPerKg: (row.costPerKg || row.cost_per_kg || "").trim(),
              arrivalDate: (row.arrivalDate || row.arrival_date || "").trim(),
            }))
            .filter((r: RawStockRow) => r.containerNumber && r.receivedKg);
          setCsvData(parsed);
          setMode("csv");
        },
      });
    } else if (ext === "xlsx" || ext === "xls") {
      const reader = new FileReader();
      reader.onload = async (evt) => {
        const XLSX = await import("@/lib/excelHelper");
        const wb = await XLSX.read(evt.target?.result, { type: "binary" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws) as any[];
        const parsed: RawStockRow[] = data
          .map((row) => ({
            containerNumber: String(
              row.containerNumber || row.container_number || row["Container Number"] || ""
            ).trim(),
            supplierName: String(row.supplierName || row.supplier_name || row["Supplier Name"] || "").trim(),
            receivedKg: String(row.receivedKg || row.received_kg || row["Received Kg"] || "").trim(),
            usedKg: String(row.usedKg || row.used_kg || row["Used Kg"] || "0").trim(),
            costPerKg: String(row.costPerKg || row.cost_per_kg || row["Cost Per Kg"] || "").trim(),
            arrivalDate: String(row.arrivalDate || row.arrival_date || row["Arrival Date"] || "").trim(),
          }))
          .filter((r) => r.containerNumber && r.receivedKg);
        setCsvData(parsed);
        setMode("csv");
      };
      reader.readAsBinaryString(file);
    }
    e.target.value = "";
  }, []);

  if (result) {
    return (
      <ImportResult
        result={result}
        onReset={() => {
          setResult(null);
          setMode("choose");
          setCsvData([]);
          setRows([{ ...EMPTY_RAW_STOCK }]);
        }}
      />
    );
  }

  if (mode === "choose") {
    return (
      <ImportModeChooser
        title="Import Raw Stock Balances"
        description="Import opening raw material inventory. Containers will be created automatically if they don't exist."
        templateType="raw-stock"
        onFileUpload={handleFileUpload}
        onManual={() => setMode("manual")}
      />
    );
  }

  if (mode === "csv") {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-lg">Preview Raw Stock Data ({csvData.length} rows)</CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setMode("choose");
                  setCsvData([]);
                }}
                data-testid="button-back-csv-rawstock"
              >
                <X className="h-4 w-4 mr-1" /> Cancel
              </Button>
              <Button
                onClick={() => importMutation.mutate(csvData)}
                disabled={importMutation.isPending}
                data-testid="button-confirm-import-rawstock"
              >
                {importMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Import {csvData.length} Records
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="border rounded-md overflow-auto max-h-96">
            <Table>
              <TableHeader className="sticky top-0 z-30 bg-background">
                <TableRow>
                  <TableHead>Container #</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Received Kg</TableHead>
                  <TableHead>Used Kg</TableHead>
                  <TableHead>Cost/Kg</TableHead>
                  <TableHead>Arrival Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {csvData.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{row.containerNumber}</TableCell>
                    <TableCell>{row.supplierName}</TableCell>
                    <TableCell>{row.receivedKg}</TableCell>
                    <TableCell>{row.usedKg}</TableCell>
                    <TableCell>{row.costPerKg}</TableCell>
                    <TableCell>{row.arrivalDate}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <ManualEntryCard
      title="Add Raw Stock Records"
      columns={["Container # *", "Supplier", "Received Kg *", "Used Kg", "Cost/Kg *", "Arrival Date"]}
      rows={rows}
      onAdd={() => setRows([...rows, { ...EMPTY_RAW_STOCK }])}
      onRemove={(i) => setRows(rows.filter((_, idx) => idx !== i))}
      onChange={(i, field, value) => {
        const updated = [...rows];
        (updated[i] as any)[field] = value;
        setRows(updated);
      }}
      onSubmit={() => importMutation.mutate(rows.filter((r) => r.containerNumber && r.receivedKg))}
      isPending={importMutation.isPending}
      onBack={() => setMode("choose")}
      renderRow={(row, i, onChange) => (
        <>
          <TableCell>
            <Input
              value={row.containerNumber}
              onChange={(e) => onChange(i, "containerNumber", e.target.value)}
              placeholder="Container number"
              data-testid={`input-rawstock-container-${i}`}
            />
          </TableCell>
          <TableCell>
            <Input
              value={row.supplierName}
              onChange={(e) => onChange(i, "supplierName", e.target.value)}
              placeholder="Supplier name"
              data-testid={`input-rawstock-supplier-${i}`}
            />
          </TableCell>
          <TableCell>
            <Input
              value={row.receivedKg}
              onChange={(e) => onChange(i, "receivedKg", e.target.value)}
              placeholder="0"
              type="number"
              step="0.001"
              data-testid={`input-rawstock-received-${i}`}
            />
          </TableCell>
          <TableCell>
            <Input
              value={row.usedKg}
              onChange={(e) => onChange(i, "usedKg", e.target.value)}
              placeholder="0"
              type="number"
              step="0.001"
              data-testid={`input-rawstock-used-${i}`}
            />
          </TableCell>
          <TableCell>
            <Input
              value={row.costPerKg}
              onChange={(e) => onChange(i, "costPerKg", e.target.value)}
              placeholder="0"
              type="number"
              step="0.0001"
              data-testid={`input-rawstock-cost-${i}`}
            />
          </TableCell>
          <TableCell>
            <Input
              value={row.arrivalDate}
              onChange={(e) => onChange(i, "arrivalDate", e.target.value)}
              placeholder="YYYY-MM-DD"
              type="date"
              data-testid={`input-rawstock-date-${i}`}
            />
          </TableCell>
        </>
      )}
    />
  );
}

function BaleImport() {
  const [mode, setMode] = useState<"choose" | "csv" | "manual">("choose");
  const [rows, setRows] = useState<BaleRow[]>([{ ...EMPTY_BALE }]);
  const [csvData, setCsvData] = useState<BaleRow[]>([]);
  const [result, setResult] = useState<{ imported: number; errors: string[] } | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string>("import.xlsx");
  const { toast } = useToast();

  const { data: baleProducts } = useQuery<FactoryBaleProduct[]>({
    queryKey: ["/api/factory/bale-products"],
  });

  const productByArticleCode = new Map<string, FactoryBaleProduct>();
  if (baleProducts) {
    for (const p of baleProducts) {
      if (p.articleCode) productByArticleCode.set(p.articleCode.toLowerCase(), p);
    }
  }

  const importMutation = useMutation({
    mutationFn: async (bales: BaleRow[]) => {
      const res = await factoryApiRequest("POST", "/api/factory/import/bales", { bales, fileName: uploadedFileName });
      return res.json();
    },
    onSuccess: (data) => {
      setResult(data);
      toast({ title: "Import complete", description: `${data.imported} bales imported` });
    },
    onError: (err: any) => {
      if (err?._handledGlobally) return;
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    },
  });

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase();
    setUploadedFileName(file.name);

    if (ext === "csv" || ext === "txt") {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const parsed: BaleRow[] = results.data
            .map((row: any) => ({
              baleCode: (row.baleCode || row.bale_code || "").trim(),
              articleCode: (row.articleCode || row.article_code || "").trim(),
              productName: (row.productName || row.product_name || "").trim(),
              category: (row.category || "").trim(),
              grade: (row.grade || "").trim(),
              weightKg: (row.weightKg || row.weight_kg || "").trim(),
              costPerKg: (row.costPerKg || row.cost_per_kg || "0").trim(),
              status: (row.status || "FINALIZED").trim().toUpperCase(),
            }))
            .filter((r: BaleRow) => r.baleCode && r.weightKg);
          setCsvData(parsed);
          setMode("csv");
        },
      });
    } else if (ext === "xlsx" || ext === "xls") {
      const reader = new FileReader();
      reader.onload = async (evt) => {
        const XLSX = await import("@/lib/excelHelper");
        const wb = await XLSX.read(evt.target?.result, { type: "binary" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws) as any[];
        const parsed: BaleRow[] = data
          .map((row) => ({
            baleCode: String(row.baleCode || row.bale_code || row["Bale Code"] || "").trim(),
            articleCode: String(row.articleCode || row.article_code || row["Article Code"] || "").trim(),
            productName: String(row.productName || row.product_name || row["Product Name"] || "").trim(),
            category: String(row.category || row.Category || "").trim(),
            grade: String(row.grade || row.Grade || "").trim(),
            weightKg: String(row.weightKg || row.weight_kg || row["Weight Kg"] || "").trim(),
            costPerKg: String(row.costPerKg || row.cost_per_kg || row["Cost Per Kg"] || "0").trim(),
            status: String(row.status || row.Status || "FINALIZED")
              .trim()
              .toUpperCase(),
          }))
          .filter((r) => r.baleCode && r.weightKg);
        setCsvData(parsed);
        setMode("csv");
      };
      reader.readAsBinaryString(file);
    }
    e.target.value = "";
  }, []);

  if (result) {
    return (
      <ImportResult
        result={result}
        onReset={() => {
          setResult(null);
          setMode("choose");
          setCsvData([]);
          setRows([{ ...EMPTY_BALE }]);
        }}
      />
    );
  }

  if (mode === "choose") {
    return (
      <ImportModeChooser
        title="Import Bales Inventory"
        description="Import existing bales into the system. Reference numbers will be generated automatically."
        templateType="bales"
        onFileUpload={handleFileUpload}
        onManual={() => setMode("manual")}
      />
    );
  }

  if (mode === "csv") {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-lg">Preview Bale Data ({csvData.length} rows)</CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setMode("choose");
                  setCsvData([]);
                }}
                data-testid="button-back-csv-bales"
              >
                <X className="h-4 w-4 mr-1" /> Cancel
              </Button>
              <Button
                onClick={() => importMutation.mutate(csvData)}
                disabled={importMutation.isPending}
                data-testid="button-confirm-import-bales"
              >
                {importMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Import {csvData.length} Bales
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="border rounded-md overflow-auto max-h-96">
            <Table>
              <TableHeader className="sticky top-0 z-30 bg-background">
                <TableRow>
                  <TableHead>Bale Code</TableHead>
                  <TableHead>Article Code</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Grade</TableHead>
                  <TableHead>Weight (kg)</TableHead>
                  <TableHead>Cost/Kg</TableHead>
                  <TableHead className="text-right">Prod. Price</TableHead>
                  <TableHead className="text-right">Sell Price</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {csvData.map((row, i) => {
                  const matched = row.articleCode ? productByArticleCode.get(row.articleCode.toLowerCase()) : undefined;
                  return (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{row.baleCode}</TableCell>
                      <TableCell>{row.articleCode}</TableCell>
                      <TableCell>{row.productName || matched?.name || "-"}</TableCell>
                      <TableCell>{row.category}</TableCell>
                      <TableCell>{row.grade}</TableCell>
                      <TableCell>{row.weightKg}</TableCell>
                      <TableCell>{row.costPerKg}</TableCell>
                      <TableCell className="text-right font-mono">
                        {matched?.productionPrice && parseFloat(matched.productionPrice) > 0 ? (
                          parseFloat(matched.productionPrice).toLocaleString()
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {matched?.sellingPrice && parseFloat(matched.sellingPrice) > 0 ? (
                          parseFloat(matched.sellingPrice).toLocaleString()
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{row.status}</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <ManualEntryCard
      title="Add Bales"
      columns={["Bale Code *", "Article Code", "Product", "Category", "Grade", "Weight (kg) *", "Cost/Kg", "Status"]}
      rows={rows}
      onAdd={() => setRows([...rows, { ...EMPTY_BALE }])}
      onRemove={(i) => setRows(rows.filter((_, idx) => idx !== i))}
      onChange={(i, field, value) => {
        const updated = [...rows];
        (updated[i] as any)[field] = value;
        setRows(updated);
      }}
      onSubmit={() => importMutation.mutate(rows.filter((r) => r.baleCode && r.weightKg))}
      isPending={importMutation.isPending}
      onBack={() => setMode("choose")}
      renderRow={(row, i, onChange) => (
        <>
          <TableCell>
            <Input
              value={row.baleCode}
              onChange={(e) => onChange(i, "baleCode", e.target.value)}
              placeholder="Bale code"
              data-testid={`input-bale-code-${i}`}
            />
          </TableCell>
          <TableCell>
            <Input
              value={row.articleCode}
              onChange={(e) => onChange(i, "articleCode", e.target.value)}
              placeholder="Article code"
              data-testid={`input-bale-article-${i}`}
            />
          </TableCell>
          <TableCell>
            <Input
              value={row.productName}
              onChange={(e) => onChange(i, "productName", e.target.value)}
              placeholder="Product name"
              data-testid={`input-bale-product-${i}`}
            />
          </TableCell>
          <TableCell>
            <Input
              value={row.category}
              onChange={(e) => onChange(i, "category", e.target.value)}
              placeholder="Category"
              data-testid={`input-bale-category-${i}`}
            />
          </TableCell>
          <TableCell>
            <Input
              value={row.grade}
              onChange={(e) => onChange(i, "grade", e.target.value)}
              placeholder="Grade"
              data-testid={`input-bale-grade-${i}`}
            />
          </TableCell>
          <TableCell>
            <Input
              value={row.weightKg}
              onChange={(e) => onChange(i, "weightKg", e.target.value)}
              placeholder="0"
              type="number"
              step="0.001"
              data-testid={`input-bale-weight-${i}`}
            />
          </TableCell>
          <TableCell>
            <Input
              value={row.costPerKg}
              onChange={(e) => onChange(i, "costPerKg", e.target.value)}
              placeholder="0"
              type="number"
              step="0.01"
              data-testid={`input-bale-costperkg-${i}`}
            />
          </TableCell>
          <TableCell>
            <Select value={row.status} onValueChange={(v) => onChange(i, "status", v)}>
              <SelectTrigger data-testid={`select-bale-status-${i}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="FINALIZED">Finalized</SelectItem>
                <SelectItem value="PENDING_PRESSING">Pending</SelectItem>
              </SelectContent>
            </Select>
          </TableCell>
        </>
      )}
    />
  );
}

function ImportModeChooser({
  title,
  description,
  templateType,
  onFileUpload,
  onManual,
}: {
  title: string;
  description: string;
  templateType: string;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onManual: () => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="hover-elevate cursor-pointer" data-testid={`card-upload-${templateType}`}>
          <CardContent className="pt-6">
            <label className="flex flex-col items-center gap-3 cursor-pointer">
              <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
                <Upload className="h-6 w-6 text-primary" />
              </div>
              <div className="text-center">
                <p className="font-medium">Upload CSV / Excel</p>
                <p className="text-sm text-muted-foreground mt-1">Upload a .csv or .xlsx file with your data</p>
              </div>
              <input
                type="file"
                accept=".csv,.xlsx,.txt"
                className="hidden"
                onChange={onFileUpload}
                data-testid={`input-file-${templateType}`}
              />
            </label>
          </CardContent>
        </Card>

        <Card className="hover-elevate cursor-pointer" onClick={onManual} data-testid={`card-manual-${templateType}`}>
          <CardContent className="pt-6">
            <div className="flex flex-col items-center gap-3">
              <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
                <Plus className="h-6 w-6 text-primary" />
              </div>
              <div className="text-center">
                <p className="font-medium">Enter Manually</p>
                <p className="text-sm text-muted-foreground mt-1">Add records one by one using a form</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Button
        variant="outline"
        onClick={() => downloadTemplate(templateType)}
        data-testid={`button-template-${templateType}`}
      >
        <Download className="h-4 w-4 mr-2" /> Download CSV Template
      </Button>
    </div>
  );
}

function ManualEntryCard<T>({
  title,
  columns,
  rows,
  onAdd,
  onRemove,
  onChange,
  onSubmit,
  isPending,
  onBack,
  renderRow,
}: {
  title: string;
  columns: string[];
  rows: T[];
  onAdd: () => void;
  onRemove: (i: number) => void;
  onChange: (i: number, field: string, value: string) => void;
  onSubmit: () => void;
  isPending: boolean;
  onBack: () => void;
  renderRow: (row: T, i: number, onChange: (i: number, field: string, value: string) => void) => JSX.Element;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-lg">{title}</CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onBack} data-testid="button-back-manual">
              <X className="h-4 w-4 mr-1" /> Cancel
            </Button>
            <Button variant="outline" onClick={onAdd} data-testid="button-add-row">
              <Plus className="h-4 w-4 mr-1" /> Add Row
            </Button>
            <Button onClick={onSubmit} disabled={isPending} data-testid="button-submit-manual">
              {isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Import
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="border rounded-md overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-30 bg-background">
              <TableRow>
                {columns.map((col) => (
                  <TableHead key={col}>{col}</TableHead>
                ))}
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => (
                <TableRow key={i}>
                  {renderRow(row, i, onChange)}
                  <TableCell>
                    {rows.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onRemove(i)}
                        data-testid={`button-remove-row-${i}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

interface OpeningStockRow {
  supplier: string;
  kg: string;
  costPerKg: string;
  currency: string;
  fxRateToUsd: string;
  openingDate: string;
  notes: string;
}

function OpeningStockImport() {
  const [mode, setMode] = useState<"choose" | "csv">("choose");
  const [csvData, setCsvData] = useState<OpeningStockRow[]>([]);
  const [result, setResult] = useState<{ imported: number; errors: string[]; recalcStats?: any } | null>(null);
  const { toast } = useToast();

  const importMutation = useMutation({
    mutationFn: async (items: OpeningStockRow[]) => {
      const res = await factoryApiRequest("POST", "/api/factory/import/opening-raw-stock", { items });
      return res.json();
    },
    onSuccess: (data) => {
      setResult(data);
      toast({ title: "Import complete", description: `${data.imported} opening stock records imported` });
    },
    onError: (err: any) => {
      if (err?._handledGlobally) return;
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    },
  });

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase();

    const parse = (rows: any[]) => {
      const parsed: OpeningStockRow[] = rows
        .map((row: any) => ({
          supplier: String(row.supplier || row.Supplier || "").trim(),
          kg: String(row.kg || row.Kg || row.KG || "").trim(),
          costPerKg: String(row.costPerKg || row.cost_per_kg || row["Cost Per Kg"] || row["costperkg"] || "").trim(),
          currency: String(row.currency || row.Currency || "USD").trim(),
          fxRateToUsd: String(
            row.fxRateToUsd || row.fx_rate_to_usd || row["FX Rate"] || row["fxratetousd"] || "1"
          ).trim(),
          openingDate: String(
            row.openingDate || row.opening_date || row["Opening Date"] || row["openingdate"] || ""
          ).trim(),
          notes: String(row.notes || row.Notes || "").trim(),
        }))
        .filter((r: OpeningStockRow) => r.supplier);
      setCsvData(parsed);
      setMode("csv");
    };

    if (ext === "csv" || ext === "txt") {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => parse(results.data as any[]),
      });
    } else if (ext === "xlsx" || ext === "xls") {
      const reader = new FileReader();
      reader.onload = async (evt) => {
        const XLSX = await import("@/lib/excelHelper");
        const wb = await XLSX.read(evt.target?.result, { type: "binary" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        parse(XLSX.utils.sheet_to_json(ws) as any[]);
      };
      reader.readAsBinaryString(file);
    }
    e.target.value = "";
  }, []);

  if (result) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col items-center gap-4">
            {result.imported > 0 ? (
              <div className="h-14 w-14 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <CheckCircle2 className="h-7 w-7 text-green-600 dark:text-green-400" />
              </div>
            ) : (
              <div className="h-14 w-14 rounded-full bg-destructive/10 flex items-center justify-center">
                <AlertCircle className="h-7 w-7 text-destructive" />
              </div>
            )}
            <div className="text-center">
              <h3 className="text-lg font-semibold">Import Complete</h3>
              <div className="flex items-center gap-3 mt-2 justify-center flex-wrap">
                {result.imported > 0 && <Badge variant="secondary">{result.imported} records created</Badge>}
                {result.errors.length > 0 && <Badge variant="destructive">{result.errors.length} errors</Badge>}
                {result.recalcStats && result.recalcStats.totalAllocatedKg > 0 && (
                  <Badge variant="outline">{result.recalcStats.totalAllocatedKg.toFixed(1)} kg allocated</Badge>
                )}
              </div>
            </div>
            {result.errors.length > 0 && (
              <div className="w-full max-w-lg border rounded-md p-3 bg-destructive/5 max-h-48 overflow-auto">
                <p className="text-sm font-medium text-destructive mb-2">Errors:</p>
                <ul className="text-sm space-y-1">
                  {result.errors.map((err, i) => (
                    <li key={i} className="text-muted-foreground flex items-start gap-2">
                      <AlertCircle className="h-3.5 w-3.5 mt-0.5 text-destructive shrink-0" />
                      {err}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Button
              onClick={() => {
                setResult(null);
                setMode("choose");
                setCsvData([]);
              }}
              data-testid="button-import-again-opening"
            >
              Import More
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (mode === "choose") {
    return (
      <ImportModeChooser
        title="Import Opening Raw Stock"
        description="Import opening stock by supplier with per-supplier currency and rate. Existing bale consumption will be auto-deducted via FIFO allocation."
        templateType="opening-raw-stock"
        onFileUpload={handleFileUpload}
        onManual={() => {}}
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-lg">Preview Opening Raw Stock ({csvData.length} rows)</CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setMode("choose");
                setCsvData([]);
              }}
              data-testid="button-back-opening"
            >
              <X className="h-4 w-4 mr-1" /> Cancel
            </Button>
            <Button
              onClick={() => importMutation.mutate(csvData)}
              disabled={importMutation.isPending}
              data-testid="button-confirm-import-opening"
            >
              {importMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Import {csvData.length} Records
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="border rounded-md overflow-auto max-h-96">
          <Table>
            <TableHeader className="sticky top-0 z-30 bg-background">
              <TableRow>
                <TableHead>Supplier</TableHead>
                <TableHead>KG</TableHead>
                <TableHead>Cost/kg</TableHead>
                <TableHead>Currency</TableHead>
                <TableHead>FX Rate</TableHead>
                <TableHead>Opening Date</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {csvData.map((row, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{row.supplier}</TableCell>
                  <TableCell className="font-mono">{row.kg}</TableCell>
                  <TableCell className="font-mono">{row.costPerKg}</TableCell>
                  <TableCell>{row.currency}</TableCell>
                  <TableCell className="font-mono">{row.fxRateToUsd}</TableCell>
                  <TableCell>{row.openingDate}</TableCell>
                  <TableCell className="text-muted-foreground max-w-[150px] truncate">{row.notes || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function ImportResult({
  result,
  onReset,
}: {
  result: { imported?: number; updated?: number; errors: string[] };
  onReset: () => void;
}) {
  const hasErrors = result.errors && result.errors.length > 0;
  const total = (result.imported || 0) + (result.updated || 0);

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex flex-col items-center gap-4">
          {total > 0 ? (
            <div className="h-14 w-14 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <CheckCircle2 className="h-7 w-7 text-green-600 dark:text-green-400" />
            </div>
          ) : (
            <div className="h-14 w-14 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertCircle className="h-7 w-7 text-destructive" />
            </div>
          )}

          <div className="text-center">
            <h3 className="text-lg font-semibold">Import Complete</h3>
            <div className="flex items-center gap-3 mt-2 justify-center flex-wrap">
              {result.imported !== undefined && result.imported > 0 && (
                <Badge variant="secondary" data-testid="badge-imported">
                  {result.imported} created
                </Badge>
              )}
              {result.updated !== undefined && result.updated > 0 && (
                <Badge variant="secondary" data-testid="badge-updated">
                  {result.updated} updated
                </Badge>
              )}
              {hasErrors && (
                <Badge variant="destructive" data-testid="badge-errors">
                  {result.errors.length} errors
                </Badge>
              )}
            </div>
          </div>

          {hasErrors && (
            <div className="w-full max-w-lg border rounded-md p-3 bg-destructive/5 max-h-48 overflow-auto">
              <p className="text-sm font-medium text-destructive mb-2">Errors:</p>
              <ul className="text-sm space-y-1">
                {result.errors.map((err, i) => (
                  <li key={i} className="text-muted-foreground flex items-start gap-2">
                    <AlertCircle className="h-3.5 w-3.5 mt-0.5 text-destructive shrink-0" />
                    {err}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Button onClick={onReset} data-testid="button-import-again">
            Import More Data
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SupplierObEdit() {
  const { toast } = useToast();
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [obValue, setObValue] = useState("");

  const { data: suppliers } = useQuery<{ id: number; name: string; openingBalance: string; parentId: number | null }[]>(
    {
      queryKey: ["/api/factory/suppliers/with-balances"],
      select: (data: any[]) =>
        data.map((s) => ({
          id: s.id,
          name: s.name,
          openingBalance: s.openingBalance || "0",
          parentId: s.parentId ?? null,
        })),
    }
  );

  const selectedSupplier = suppliers?.find((s) => s.id.toString() === selectedSupplierId);

  const updateMutation = useMutation({
    mutationFn: async () => {
      const res = await factoryApiRequest("PATCH", `/api/factory/suppliers/${selectedSupplierId}/opening-balance`, {
        openingBalance: obValue,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to update");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers/with-balances"] });
      toast({ title: "Saved", description: `Opening balance for ${selectedSupplier?.name} updated to ${obValue}` });
      setSelectedSupplierId("");
      setObValue("");
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Edit Supplier Opening Balance</CardTitle>
        <p className="text-sm text-muted-foreground">
          Directly overwrite the opening balance for any factory supplier or sub-supplier. This does not import new
          records — it only updates the opening balance value.
        </p>
      </CardHeader>
      <CardContent className="space-y-4 max-w-md">
        <div className="space-y-2">
          <Label>Supplier</Label>
          <Select
            value={selectedSupplierId}
            onValueChange={(val) => {
              setSelectedSupplierId(val);
              const sup = suppliers?.find((s) => s.id.toString() === val);
              if (sup) setObValue(sup.openingBalance);
            }}
          >
            <SelectTrigger data-testid="select-ob-supplier">
              <SelectValue placeholder="Select supplier..." />
            </SelectTrigger>
            <SelectContent>
              {suppliers?.map((s) => (
                <SelectItem key={s.id} value={s.id.toString()}>
                  {s.parentId ? "  └ " : ""}
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedSupplier && (
          <>
            <div className="p-3 rounded-md bg-muted text-sm">
              Current opening balance: <span className="font-mono font-medium">{selectedSupplier.openingBalance}</span>
            </div>
            <div className="space-y-2">
              <Label>New Opening Balance (USD)</Label>
              <Input
                type="number"
                step="0.01"
                value={obValue}
                onChange={(e) => setObValue(e.target.value)}
                data-testid="input-ob-new-value"
              />
            </div>
            <Button
              onClick={() => updateMutation.mutate()}
              disabled={updateMutation.isPending || !obValue}
              data-testid="button-ob-save"
            >
              {updateMutation.isPending ? "Saving..." : "Save Opening Balance"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
