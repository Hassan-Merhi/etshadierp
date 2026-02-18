import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Save, Search, ArrowRight, CheckCircle, Wrench, Upload, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Location {
  id: number;
  name: string;
}

interface FactorySettingsData {
  dashboardEnabled: boolean;
  kpisEnabled: boolean;
  profitabilityEnabled: boolean;
  alertsEnabled: boolean;
  supplierScoringEnabled: boolean;
  mixOptimizerEnabled: boolean;
  traceabilityEnabled: boolean;
  balePhotosEnabled: boolean;
  wasteTrackingEnabled: boolean;
  cashflowEnabled: boolean;
  rolesEnabled: boolean;
  laborCostPerKg: number;
  overheadPerKg: number;
}

const defaultSettings: FactorySettingsData = {
  dashboardEnabled: true,
  kpisEnabled: true,
  profitabilityEnabled: true,
  alertsEnabled: true,
  supplierScoringEnabled: true,
  mixOptimizerEnabled: true,
  traceabilityEnabled: true,
  balePhotosEnabled: true,
  wasteTrackingEnabled: true,
  cashflowEnabled: true,
  rolesEnabled: true,
  laborCostPerKg: 0,
  overheadPerKg: 0,
};

interface RenamePreviewItem {
  id: number;
  code: string;
  currentName: string;
  newName: string;
}

export default function FactorySettings() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<FactorySettingsData>(defaultSettings);

  const [codePrefix, setCodePrefix] = useState("HMD13");
  const [findStr, setFindStr] = useState("-");
  const [replaceStr, setReplaceStr] = useState(" ");
  const [renamePreview, setRenamePreview] = useState<RenamePreviewItem[] | null>(null);
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [excelResult, setExcelResult] = useState<{ created: number; updated: number; categoriesCreated: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [baleImportFile, setBaleImportFile] = useState<File | null>(null);
  const [baleImportResult, setBaleImportResult] = useState<{ totalBalesCreated: number; skippedRows: number; skippedDetails: string[] } | null>(null);
  const baleFileInputRef = useRef<HTMLInputElement>(null);
  const [baleImportLocationId, setBaleImportLocationId] = useState<string>("");

  const previewMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/factory/bale-products/bulk-rename-preview", {
        codePrefix,
        find: findStr,
        replace: replaceStr,
      });
      return res.json();
    },
    onSuccess: (data: { total: number; matches: RenamePreviewItem[] }) => {
      setRenamePreview(data.matches);
      if (data.matches.length === 0) {
        toast({ title: "No matches", description: `Found ${data.total} products with code prefix "${codePrefix}" but none have "${findStr}" in their name.` });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const applyMutation = useMutation({
    mutationFn: async (items: RenamePreviewItem[]) => {
      const res = await apiRequest("POST", "/api/factory/bale-products/bulk-rename-apply", { items });
      return res.json();
    },
    onSuccess: (data: { updated: number }) => {
      toast({ title: "Renamed successfully", description: `${data.updated} product name(s) updated.` });
      setRenamePreview(null);
      queryClient.invalidateQueries({ queryKey: ['/api/factory/bale-products'] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const excelUploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/factory/bale-products/import-excel", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Upload failed");
      }
      return res.json();
    },
    onSuccess: (data: { created: number; updated: number; categoriesCreated: number }) => {
      setExcelResult(data);
      setExcelFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bale-products"] });
      toast({
        title: "Excel import complete",
        description: `${data.updated} updated, ${data.created} created${data.categoriesCreated > 0 ? `, ${data.categoriesCreated} categories created` : ""}`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Import error", description: error.message, variant: "destructive" });
    },
  });

  const baleImportMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      if (baleImportLocationId) formData.append("locationId", baleImportLocationId);
      const res = await fetch("/api/factory/bales/import-excel", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Upload failed");
      }
      return res.json();
    },
    onSuccess: (data: { totalBalesCreated: number; skippedRows: number; skippedDetails: string[] }) => {
      setBaleImportResult(data);
      setBaleImportFile(null);
      if (baleFileInputRef.current) baleFileInputRef.current.value = "";
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bales"] });
      toast({
        title: "Bale import complete",
        description: `${data.totalBalesCreated} bale(s) created${data.skippedRows > 0 ? `, ${data.skippedRows} row(s) skipped` : ""}`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Import error", description: error.message, variant: "destructive" });
    },
  });

  const { data: locations } = useQuery<Location[]>({ queryKey: ["/api/locations"] });

  const { data, isLoading } = useQuery<FactorySettingsData>({
    queryKey: ['/api/factory/settings'],
  });

  useEffect(() => {
    if (data) {
      setSettings(data);
    }
  }, [data]);

  const mutation = useMutation({
    mutationFn: async (updated: FactorySettingsData) => {
      const res = await apiRequest("PUT", "/api/factory/settings", updated);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/factory/settings'] });
      toast({ title: "Settings saved", description: "Factory settings have been updated successfully." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleToggle = (key: keyof FactorySettingsData) => {
    setSettings((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleNumberChange = (key: keyof FactorySettingsData, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: parseFloat(value) || 0 }));
  };

  const handleSave = () => {
    mutation.mutate(settings);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12" data-testid="loading-spinner">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading factory settings...</span>
      </div>
    );
  }

  const toggleItem = (label: string, key: keyof FactorySettingsData) => (
    <div className="flex items-center justify-between gap-4 py-3" key={key} data-testid={`toggle-row-${key}`}>
      <Label htmlFor={key} className="text-sm font-medium cursor-pointer">{label}</Label>
      <Switch
        id={key}
        checked={!!settings[key]}
        onCheckedChange={() => handleToggle(key)}
        data-testid={`switch-${key}`}
      />
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-title">Factory Settings</h1>
          <p className="text-muted-foreground mt-1">Toggle factory intelligence features on or off</p>
        </div>
        <Button onClick={handleSave} disabled={mutation.isPending} data-testid="button-save-settings">
          {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          Save Settings
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle data-testid="text-section-production">Production Intelligence</CardTitle>
            <CardDescription>Core production monitoring and analytics</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            {toggleItem("Dashboard", "dashboardEnabled")}
            {toggleItem("KPIs", "kpisEnabled")}
            {toggleItem("Waste Tracking", "wasteTrackingEnabled")}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle data-testid="text-section-financial">Financial Intelligence</CardTitle>
            <CardDescription>Profitability and cash flow analysis</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            {toggleItem("Profitability Engine", "profitabilityEnabled")}
            {toggleItem("Cash Flow", "cashflowEnabled")}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle data-testid="text-section-supply-chain">Supply Chain</CardTitle>
            <CardDescription>Supplier management, optimization, and traceability</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            {toggleItem("Supplier Scoring", "supplierScoringEnabled")}
            {toggleItem("Mix Optimizer", "mixOptimizerEnabled")}
            {toggleItem("Traceability", "traceabilityEnabled")}
            {toggleItem("Bale Photos", "balePhotosEnabled")}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle data-testid="text-section-operations">Operations</CardTitle>
            <CardDescription>Alerts and access control</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            {toggleItem("Alerts System", "alertsEnabled")}
            {toggleItem("Roles & Permissions", "rolesEnabled")}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle data-testid="text-section-cost">Cost Configuration</CardTitle>
            <CardDescription>Default cost parameters for profitability calculations</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="laborCostPerKg">Labor Cost per KG</Label>
                <Input
                  id="laborCostPerKg"
                  type="number"
                  step="0.01"
                  min="0"
                  value={settings.laborCostPerKg}
                  onChange={(e) => handleNumberChange("laborCostPerKg", e.target.value)}
                  data-testid="input-laborCostPerKg"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="overheadPerKg">Overhead per KG</Label>
                <Input
                  id="overheadPerKg"
                  type="number"
                  step="0.01"
                  min="0"
                  value={settings.overheadPerKg}
                  onChange={(e) => handleNumberChange("overheadPerKg", e.target.value)}
                  data-testid="input-overheadPerKg"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="md:col-span-2">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Wrench className="h-5 w-5 text-muted-foreground" />
            <CardTitle data-testid="text-section-data-cleanup">Data Cleanup</CardTitle>
          </div>
          <CardDescription>Find products by code prefix and rename them in bulk</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="codePrefix">Code Prefix</Label>
              <Input
                id="codePrefix"
                value={codePrefix}
                onChange={(e) => { setCodePrefix(e.target.value); setRenamePreview(null); }}
                placeholder="e.g. HMD13"
                data-testid="input-code-prefix"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="findStr">Find in Name</Label>
              <Input
                id="findStr"
                value={findStr}
                onChange={(e) => { setFindStr(e.target.value); setRenamePreview(null); }}
                placeholder="e.g. -"
                data-testid="input-find-str"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="replaceStr">Replace With</Label>
              <Input
                id="replaceStr"
                value={replaceStr}
                onChange={(e) => { setReplaceStr(e.target.value); setRenamePreview(null); }}
                placeholder="e.g. (space)"
                data-testid="input-replace-str"
              />
            </div>
          </div>
          <Button
            onClick={() => previewMutation.mutate()}
            disabled={previewMutation.isPending || !codePrefix.trim() || !findStr}
            data-testid="button-preview-rename"
          >
            {previewMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
            Preview Changes
          </Button>

          {renamePreview && renamePreview.length > 0 && (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                {renamePreview.length} product(s) will be renamed:
              </div>
              <div className="max-h-80 overflow-y-auto border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Current Name</TableHead>
                      <TableHead className="w-8"></TableHead>
                      <TableHead>New Name</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {renamePreview.map((item) => (
                      <TableRow key={item.id} data-testid={`row-rename-${item.id}`}>
                        <TableCell className="font-mono text-xs">{item.code}</TableCell>
                        <TableCell>{item.currentName}</TableCell>
                        <TableCell><ArrowRight className="h-4 w-4 text-muted-foreground" /></TableCell>
                        <TableCell className="font-medium">{item.newName}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Button
                onClick={() => applyMutation.mutate(renamePreview)}
                disabled={applyMutation.isPending}
                data-testid="button-apply-rename"
              >
                {applyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
                Apply {renamePreview.length} Rename(s)
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-muted-foreground" />
            <CardTitle data-testid="text-section-excel-import">Excel Product Import</CardTitle>
          </div>
          <CardDescription>Upload an Excel file to update bale product names, weights, and categories by matching on article code</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-muted-foreground space-y-1">
            <p>Your Excel file should have these column headers:</p>
            <ul className="list-disc list-inside ml-2 space-y-0.5">
              <li><span className="font-mono text-xs">articleCode</span> (required) - matches existing products</li>
              <li><span className="font-mono text-xs">name</span> - new product name</li>
              <li><span className="font-mono text-xs">weightPerBaleKg</span> - weight per bale in KG</li>
              <li><span className="font-mono text-xs">category</span> - product category (auto-created if new)</li>
              <li><span className="font-mono text-xs">description</span> - product description (optional)</li>
            </ul>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => {
                setExcelFile(e.target.files?.[0] || null);
                setExcelResult(null);
              }}
              className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90 cursor-pointer"
              data-testid="input-excel-file"
            />
            <Button
              onClick={() => excelFile && excelUploadMutation.mutate(excelFile)}
              disabled={!excelFile || excelUploadMutation.isPending}
              data-testid="button-upload-excel"
            >
              {excelUploadMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
              {excelUploadMutation.isPending ? "Importing..." : "Import"}
            </Button>
          </div>
          {excelResult && (
            <div className="flex items-center gap-2 p-3 rounded-md bg-muted text-sm" data-testid="text-excel-result">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <span>{excelResult.updated} product(s) updated, {excelResult.created} new product(s) created{excelResult.categoriesCreated > 0 ? `, ${excelResult.categoriesCreated} new category(ies)` : ""}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-muted-foreground" />
            <CardTitle data-testid="text-section-bale-import">Import Historical Bales</CardTitle>
          </div>
          <CardDescription>Upload an Excel file to import old stock as bales. Each row creates bales with automatic REF codes and the specified production date.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-muted-foreground space-y-1">
            <p>Your Excel file should have these column headers:</p>
            <ul className="list-disc list-inside ml-2 space-y-0.5">
              <li><span className="font-mono text-xs">ITEM BARCODE</span> (required) - article code to match existing products (e.g. HMD11298)</li>
              <li><span className="font-mono text-xs">QUANTITY</span> - number of bales to create (default: 1)</li>
              <li><span className="font-mono text-xs">PRODUCTION DATE</span> - date the bales were produced (required)</li>
            </ul>
            <p className="mt-2 text-xs">Products must already exist in the system. The weight will be taken from the product definition.</p>
          </div>
          <div className="space-y-2">
            <Label>Location / Warehouse</Label>
            <Select value={baleImportLocationId} onValueChange={setBaleImportLocationId}>
              <SelectTrigger className="w-64" data-testid="select-bale-import-location">
                <SelectValue placeholder="Select location..." />
              </SelectTrigger>
              <SelectContent>
                {locations?.map((loc) => (
                  <SelectItem key={loc.id} value={String(loc.id)}>{loc.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <Button
              variant="outline"
              onClick={() => {
                const header = "ITEM BARCODE\tQUANTITY\tPRODUCTION DATE\n";
                const example = "HMD11298\t1\t2/11/2026\n";
                const blob = new Blob([header + example], { type: "application/vnd.ms-excel" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "bale_import_template.xls";
                a.click();
                URL.revokeObjectURL(url);
              }}
              data-testid="button-download-bale-template"
            >
              <Download className="h-4 w-4 mr-2" />
              Download Template
            </Button>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <input
              ref={baleFileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => {
                setBaleImportFile(e.target.files?.[0] || null);
                setBaleImportResult(null);
              }}
              className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90 cursor-pointer"
              data-testid="input-bale-import-file"
            />
            <Button
              onClick={() => baleImportFile && baleImportMutation.mutate(baleImportFile)}
              disabled={!baleImportFile || baleImportMutation.isPending}
              data-testid="button-import-bales"
            >
              {baleImportMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
              {baleImportMutation.isPending ? "Importing Bales..." : "Import Bales"}
            </Button>
          </div>
          {baleImportResult && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 p-3 rounded-md bg-muted text-sm" data-testid="text-bale-import-result">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <span>{baleImportResult.totalBalesCreated} bale(s) created with automatic REF codes{baleImportResult.skippedRows > 0 ? ` | ${baleImportResult.skippedRows} row(s) skipped` : ""}</span>
              </div>
              {baleImportResult.skippedDetails.length > 0 && (
                <div className="text-xs text-muted-foreground p-2 rounded-md border space-y-0.5">
                  <p className="font-medium">Skipped rows:</p>
                  {baleImportResult.skippedDetails.map((detail, i) => (
                    <p key={i}>{detail}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
