  import { useState, useEffect, Fragment, useRef } from "react";
  import { useForm } from "react-hook-form";
  import { zodResolver } from "@hookform/resolvers/zod";
  import { z } from "zod";
  import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
  import { Button } from "@/components/ui/button";
  import { Input } from "@/components/ui/input";
  import { Label } from "@/components/ui/label";
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
  } from "@/components/ui/dialog";
  import { Alert, AlertDescription } from "@/components/ui/alert";
  import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
  } from "@/components/ui/alert-dialog";
  import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
  } from "@/components/ui/form";
  import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  } from "@/components/ui/select";
  import { Checkbox } from "@/components/ui/checkbox";
  import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
  } from "@/components/ui/table";
  import { Badge } from "@/components/ui/badge";
  import { Switch } from "@/components/ui/switch";
  
  import { useToast } from "@/hooks/use-toast";
  import { useMutation, useQuery } from "@tanstack/react-query";
  import { queryClient, apiRequest } from "@/lib/queryClient";
  import { useAppMode } from "@/contexts/AppModeContext";
  import { getApiRequest, factoryApiRequest } from "@/lib/factoryApi";
  import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
  import { Plus, Edit, Building2, Users, ChevronDown, ChevronUp, Trash2, CalendarRange, Settings2, Wrench, MapPin, ChevronRight, Bot, MessageCircle, RefreshCw, Calculator, Loader2, Shield, AlertTriangle, PieChart, Key, Lock, Package, Eye, History, Clock, Upload, Download, Database, TrendingUp, ShoppingCart, Check, X } from "lucide-react";
import { utils, writeFile, readFile, read, ExcelJS } from "@/lib/excelHelper";
  import { Link } from "wouter";
  import { useDateFormat } from "@/contexts/DateFormatContext";
  import { insertUserSchema, insertCompanySchema, insertUserCompanyRoleSchema, FEATURE_KEYS, type FeatureKey } from "@shared/schema";
  import { FiscalPeriodTab } from "@/components/FiscalPeriodTab";
  import { useCompany } from "@/contexts/CompanyContext";
  import { ExchangeRateSettings } from "@/components/ExchangeRateSettings";
  import { formatNumber } from "@/lib/formatNumber";
  
  const userFormSchema = insertUserSchema;
  const companyFormSchema = insertCompanySchema;
  const roleAssignmentSchema = insertUserCompanyRoleSchema.refine(
    (data) => {
      // If role is POS, assignedLocationId must be present
      if (data.role.startsWith("POS") && !data.assignedLocationId) {
        return false;
      }
      return true;
    },
    {
      message: "POS roles require an assigned location",
      path: ["assignedLocationId"],
    }
  );
  
  type UserFormData = z.infer<typeof userFormSchema>;
  type CompanyFormData = z.infer<typeof companyFormSchema>;
  type RoleAssignmentData = z.infer<typeof roleAssignmentSchema>;

  function ParentCreditAccountSelect({ company }: { company: any }) {
    const { toast } = useToast();
    const appMode = useAppMode();
    const modeApiRequest = getApiRequest(appMode);
    const [isCreating, setIsCreating] = useState(false);
    const [newAccountName, setNewAccountName] = useState("");

    const { data: companySettings } = useQuery<any>({
      queryKey: ["/api/company-settings", company.id],
      queryFn: async () => {
        try {
          const res = await fetch(`/api/company-settings?companyId=${company.id}`, { credentials: "include" });
          if (res.status === 404) return { companyId: company.id, parentCreditAccountId: null };
          if (!res.ok) throw new Error("Failed to fetch settings");
          return res.json();
        } catch {
          return { companyId: company.id, parentCreditAccountId: null };
        }
      },
    });

    const { data: ledgerAccounts = [] } = useQuery<any[]>({
      queryKey: ["/api/ledger-accounts", company.id],
      queryFn: async () => {
        try {
          const res = await fetch(`/api/ledger-accounts?companyId=${company.id}`, { credentials: "include" });
          if (!res.ok) return [];
          return res.json();
        } catch {
          return [];
        }
      },
    });

    const liabilityAccounts = ledgerAccounts.filter(
      (acc: any) => acc.accountType === "Liability" && acc.active && !acc.deletedAt
    );

    const updateSettingsMutation = useMutation({
      mutationFn: async (parentCreditAccountId: number | null) => {
        const res = await modeApiRequest("POST", "/api/company-settings", {
          companyId: company.id,
          parentCreditAccountId,
        });
        return res.json();
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/company-settings"] });
        queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
        toast({ title: "Saved", description: "Parent credit account updated" });
      },
      onError: (error: any) => {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      },
    });

    const createAccountMutation = useMutation({
      mutationFn: async (name: string) => {
        const res = await modeApiRequest("POST", "/api/ledger-accounts", {
          companyId: company.id,
          name,
          accountType: "Liability",
          subType: "Current Liability",
        });
        return res.json();
      },
      onSuccess: (newAccount) => {
        queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts"] });
        updateSettingsMutation.mutate(newAccount.id);
        setIsCreating(false);
        setNewAccountName("");
      },
      onError: (error: any) => {
        toast({ title: "Error creating account", description: error.message, variant: "destructive" });
      },
    });

    const currentAccountId = companySettings?.parentCreditAccountId;
    const currentAccount = ledgerAccounts.find((acc: any) => acc.id === currentAccountId);

    if (isCreating) {
      return (
        <div className="flex gap-1 items-center">
          <Input
            value={newAccountName}
            onChange={(e) => setNewAccountName(e.target.value)}
            placeholder="Account name..."
            className="h-8 w-32 text-xs"
            data-testid={`input-new-credit-account-${company.id}`}
          />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => newAccountName && createAccountMutation.mutate(newAccountName)}
            disabled={!newAccountName || createAccountMutation.isPending}
            data-testid={`button-save-credit-account-${company.id}`}
          >
            {createAccountMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => { setIsCreating(false); setNewAccountName(""); }}
            data-testid={`button-cancel-credit-account-${company.id}`}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      );
    }

    return (
      <Select
        value={currentAccountId?.toString() || "none"}
        onValueChange={(value) => {
          if (value === "create_new") {
            setIsCreating(true);
          } else {
            const accountId = value === "none" ? null : parseInt(value, 10);
            updateSettingsMutation.mutate(accountId);
          }
        }}
        disabled={updateSettingsMutation.isPending}
      >
        <SelectTrigger className="w-40 h-8 text-xs" data-testid={`select-credit-account-${company.id}`}>
          <SelectValue placeholder="Not Set">
            {currentAccount ? currentAccount.name : "Not Set"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Not Set</SelectItem>
          {liabilityAccounts.map((acc: any) => (
            <SelectItem key={acc.id} value={acc.id.toString()}>
              {acc.name}
            </SelectItem>
          ))}
          <SelectItem value="create_new" className="text-primary font-medium">
            + Create New Account
          </SelectItem>
        </SelectContent>
      </Select>
    );
  }

  function NetPositionAdjustmentCard() {
    const { toast } = useToast();
    const { selectedCompany } = useCompany();
    const appMode = useAppMode();
    const modeApiRequest = getApiRequest(appMode);
    const [adjustmentValue, setAdjustmentValue] = useState<string>("");
    const [isEditing, setIsEditing] = useState(false);

    // Get current user role
    const { data: currentUser } = useQuery<{ role?: string }>({
      queryKey: ["/api/auth/me"],
    });

    // Get company settings to fetch current adjustment value
    const { data: companySettings } = useQuery<any>({
      queryKey: ["/api/company-settings", selectedCompany?.id],
      enabled: !!selectedCompany?.id,
      queryFn: async () => {
        try {
          const res = await fetch(`/api/company-settings?companyId=${selectedCompany?.id}`, { credentials: "include" });
          if (res.status === 404) return { companyId: selectedCompany?.id, netPositionAdjustment: "0" };
          if (!res.ok) throw new Error("Failed to fetch settings");
          return res.json();
        } catch {
          return { companyId: selectedCompany?.id, netPositionAdjustment: "0" };
        }
      },
    });

    const currentAdjustment = parseFloat(companySettings?.netPositionAdjustment || "0");

    const updateAdjustmentMutation = useMutation({
      mutationFn: async (value: string) => {
        const res = await modeApiRequest("POST", "/api/company-settings", {
          companyId: selectedCompany?.id,
          netPositionAdjustment: value,
        });
        return res.json();
      },
      onSuccess: () => {
        toast({
          title: "Updated",
          description: "Net Position Adjustment has been updated.",
        });
        queryClient.invalidateQueries({ queryKey: ["/api/company-settings"] });
        queryClient.invalidateQueries({ queryKey: ["/api/stats/profit"] });
        setIsEditing(false);
      },
      onError: (error: any) => {
        toast({
          title: "Error",
          description: error.message || "Failed to update adjustment",
          variant: "destructive",
        });
      },
    });

    if (!selectedCompany) {
      return (
        <Card className="p-6">
          <p className="text-muted-foreground">Select a company to set Net Position Adjustment.</p>
        </Card>
      );
    }

    return (
      <Card className="p-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-500/10 rounded-lg">
              <Calculator className="h-6 w-6 text-blue-500" />
            </div>
            <div>
              <h3 className="font-semibold" data-testid="text-net-position-adjustment-title">Net Position Adjustment</h3>
              <p className="text-sm text-muted-foreground">
                Reduce the Net Position by a fixed amount (for {selectedCompany.name}). This does not affect Import Cycle Balance.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isEditing ? (
              <>
                <Input
                  type="number"
                  value={adjustmentValue}
                  onChange={(e) => setAdjustmentValue(e.target.value)}
                  placeholder="0"
                  className="w-32"
                  data-testid="input-net-position-adjustment"
                />
                <Button
                  size="sm"
                  onClick={() => updateAdjustmentMutation.mutate(adjustmentValue)}
                  disabled={updateAdjustmentMutation.isPending}
                  data-testid="button-save-adjustment"
                >
                  {updateAdjustmentMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setIsEditing(false)}
                  data-testid="button-cancel-adjustment"
                >
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <span className="font-mono text-lg" data-testid="text-current-adjustment">
                  ${formatNumber(currentAdjustment)}
                </span>
                {currentUser?.role === "Admin" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setAdjustmentValue(currentAdjustment.toString());
                      setIsEditing(true);
                    }}
                    data-testid="button-edit-adjustment"
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                )}
              </>
            )}
            {currentUser?.role !== "Admin" && !isEditing && (
              <span className="text-xs text-muted-foreground">(Admin only)</span>
            )}
          </div>
        </div>
      </Card>
    );
  }

  function ActiveUsersSection() {
    const { data: presenceData, isLoading } = useQuery<any[]>({
      queryKey: ["/api/user-presence"],
      refetchInterval: 30000, // Refresh every 30 seconds
    });

    const { data: companies } = useQuery<any[]>({
      queryKey: ["/api/companies"],
    });

    const formatTimeAgo = (dateStr: string) => {
      const date = new Date(dateStr);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      
      if (diffMins < 1) return "Just now";
      if (diffMins === 1) return "1 min ago";
      if (diffMins < 60) return `${diffMins} mins ago`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours === 1) return "1 hour ago";
      return `${diffHours} hours ago`;
    };

    const getCompanyName = (companyId: number | null) => {
      if (!companyId || !companies) return "—";
      const company = companies.find((c: any) => c.id === companyId);
      return company?.name || "Unknown";
    };

    const getPageLabel = (route: string) => {
      if (!route || route === "/") return "Dashboard";
      const routeLabels: Record<string, string> = {
        "/": "Dashboard",
        "/dashboard": "Dashboard",
        "/locations": "Locations",
        "/locations/inventory": "Location Inventory",
        "/stock-items": "Stock Items",
        "/stock-groups": "Stock Groups",
        "/ledger-accounts": "Ledger Accounts",
        "/vouchers": "Vouchers",
        "/vouchers/payment": "Payment Vouchers",
        "/vouchers/receipt": "Receipt Vouchers",
        "/vouchers/journal": "Journal Vouchers",
        "/vouchers/sales": "Sales Vouchers",
        "/purchase-orders": "Purchase Orders",
        "/containers": "Containers",
        "/containers/otw": "Containers OTW",
        "/employees": "Employees",
        "/customers": "Customers",
        "/suppliers": "Suppliers",
        "/bank-accounts": "Bank Accounts",
        "/reports": "Reports",
        "/reports/profit-loss": "Profit & Loss",
        "/reports/balance-sheet": "Balance Sheet",
        "/settings": "Settings",
        "/pos": "Point of Sale",
        "/pos/sales": "POS Sales",
        "/chatbot": "AI Chatbot",
        "/deleted-items": "Deleted Items",
      };
      if (routeLabels[route]) return routeLabels[route];
      const cleanRoute = route.replace(/^\//, "").replace(/-/g, " ").replace(/\//g, " > ");
      return cleanRoute.split(" ").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    };

    // Group users by company
    const groupedUsers = presenceData?.reduce((acc: any, presence: any) => {
      const companyId = presence.companyId || "unassigned";
      if (!acc[companyId]) {
        acc[companyId] = [];
      }
      acc[companyId].push(presence);
      return acc;
    }, {} as Record<string, any[]>) || {};

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Eye className="h-5 w-5" />
          <h2 className="text-2xl font-semibold">Active Users</h2>
        </div>
        <p className="text-muted-foreground">
          Monitor currently active users and their location in the application.
        </p>

        {isLoading ? (
          <Card className="p-6">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Loading active users...</span>
            </div>
          </Card>
        ) : !presenceData || presenceData.length === 0 ? (
          <Card className="p-6">
            <p className="text-muted-foreground">No active users at the moment.</p>
          </Card>
        ) : (
          <div className="space-y-4">
            {Object.entries(groupedUsers).map(([companyId, users]: [string, any]) => (
              <Card key={companyId} className="overflow-hidden">
                <div className="px-4 py-3 bg-muted/50 border-b">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    <h3 className="font-medium">
                      {companyId === "unassigned" ? "No Company Selected" : getCompanyName(Number(companyId))}
                    </h3>
                    <Badge variant="secondary" className="ml-2">{users.length}</Badge>
                  </div>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Current Page</TableHead>
                      <TableHead>Last Active</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((presence: any) => (
                      <TableRow key={presence.id} data-testid={`row-presence-${presence.id}`}>
                        <TableCell className="font-medium">{presence.username}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{presence.role || "—"}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {getPageLabel(presence.currentRoute)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatTimeAgo(presence.lastSeen)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  }

// Data Tools Tab component - consolidates administrative utilities
function DataToolsTab() {
  const { toast } = useToast();
  const { selectedCompany } = useCompany();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);
  
  // Separate location selection for each import operation
  const [costPriceLocationId, setCostPriceLocationId] = useState<string>("");
  const [stockLocationId, setStockLocationId] = useState<string>("");
  
  // Cost price import state
  const [costPriceImportOpen, setCostPriceImportOpen] = useState(false);
  const [costPriceFile, setCostPriceFile] = useState<File | null>(null);
  const [costPricePreview, setCostPricePreview] = useState<Array<{ barcode: string; costPrice: number }>>([]);
  const [costPriceErrors, setCostPriceErrors] = useState<string[]>([]);
  const [isImportingCostPrice, setIsImportingCostPrice] = useState(false);
  const [costPriceImportComplete, setCostPriceImportComplete] = useState(false);

  // Stock import state
  const [stockImportOpen, setStockImportOpen] = useState(false);
  const [stockFile, setStockFile] = useState<File | null>(null);
  const [stockPreview, setStockPreview] = useState<Array<{ Item_barcode: string; stockGroupCode?: string; quantity: string; rate: string; value: string }>>([]);
  const [stockErrors, setStockErrors] = useState<string[]>([]);
  const [isImportingStock, setIsImportingStock] = useState(false);
  const [stockImportComplete, setStockImportComplete] = useState(false);

  // Fetch locations (filtered by company context - locations are already company-scoped by the API)
  const { data: locations = [] } = useQuery<any[]>({
    queryKey: ["/api/locations"],
    enabled: !!selectedCompany,
  });

  // Convert Bale to BL mutation
  const updateUOMMutation = useMutation({
    mutationFn: async () => {
      return await modeApiRequest("POST", "/api/stock-items/bulk-update-uom", {});
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/stock-items"] });
      toast({
        title: "Success",
        description: data.message || "UOM updated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update UOM",
        variant: "destructive",
      });
    },
  });

  // Fix Cost Prices mutation
  const recalculateCostsMutation = useMutation({
    mutationFn: async () => {
      return modeApiRequest("POST", "/api/sales-report/recalculate-costs", {});
    },
    onSuccess: (data: any) => {
      toast({
        title: "Cost Prices Updated",
        description: `Updated ${data.updatedCount} of ${data.totalChecked} sales items`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-report"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Cost price import functions
  const downloadCostPriceTemplate = () => {
    const template = [
      { barcode: "ITEM001", costPrice: "125.50" },
      { barcode: "ITEM002", costPrice: "95.75" },
    ];
    const ws = utils.json_to_sheet(template);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "Cost Price Import");
    writeFile(wb, "cost_price_import_template.xlsx");
    toast({
      title: "Template Downloaded",
      description: "Use this template to update cost prices",
    });
  };

  const handleCostPriceFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setCostPriceFile(selectedFile);
    setCostPriceErrors([]);
    setCostPricePreview([]);
    setCostPriceImportComplete(false);

    try {
      const data = await selectedFile.arrayBuffer();
      const workbook = await read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = utils.sheet_to_json<any>(worksheet);

      if (jsonData.length === 0) {
        toast({ title: "Empty File", description: "The Excel file is empty.", variant: "destructive" });
        return;
      }

      const headerRow = utils.sheet_to_json<string[]>(worksheet, { header: 1 })[0] || [];
      const columns = headerRow.map((h: any) => String(h || "").trim());
      const requiredCols = ["barcode", "costPrice"];
      const missingCols = requiredCols.filter(col => !columns.includes(col));
      
      if (missingCols.length > 0) {
        toast({
          title: "Missing Required Columns",
          description: `Expected: ${requiredCols.join(", ")}. Download template for format.`,
          variant: "destructive",
        });
        return;
      }

      const errors: string[] = [];
      const rows: Array<{ barcode: string; costPrice: number }> = [];

      jsonData.forEach((row: any, index: number) => {
        const rowNumber = index + 2;
        if (!row.barcode || String(row.barcode).trim() === "") {
          errors.push(`Row ${rowNumber}: Barcode is required`);
          return;
        }
        const costPrice = parseFloat(row.costPrice || "0");
        if (isNaN(costPrice) || costPrice <= 0) {
          errors.push(`Row ${rowNumber}: Cost price must be > 0`);
          return;
        }
        rows.push({ barcode: String(row.barcode).trim(), costPrice });
      });

      setCostPricePreview(rows);
      setCostPriceErrors(errors);
    } catch (error) {
      toast({ title: "Error Reading File", description: "Please ensure valid Excel file.", variant: "destructive" });
    }
  };

  const handleCostPriceImport = async () => {
    if (!costPriceLocationId) {
      toast({ title: "No Location Selected", description: "Please select a location first", variant: "destructive" });
      return;
    }
    if (costPriceErrors.length > 0) {
      toast({ title: "Cannot Import", description: "Please fix validation errors first", variant: "destructive" });
      return;
    }

    setIsImportingCostPrice(true);
    try {
      const res = await modeApiRequest("POST", `/api/locations/${costPriceLocationId}/import-cost-prices`, {
        updates: costPricePreview,
      });
      const response = await res.json();
      queryClient.invalidateQueries({ queryKey: [`/api/locations/${costPriceLocationId}/inventory`] });
      setCostPriceImportComplete(true);
      toast({
        title: "Import Successful",
        description: `Updated ${response.updated} cost prices.`,
      });
    } catch (error: any) {
      toast({ title: "Import Failed", description: error.message || "Failed to import", variant: "destructive" });
    } finally {
      setIsImportingCostPrice(false);
    }
  };

  const handleCostPriceDialogClose = () => {
    setCostPriceImportOpen(false);
    setCostPriceFile(null);
    setCostPricePreview([]);
    setCostPriceErrors([]);
    setCostPriceImportComplete(false);
  };

  // Stock import functions
  const downloadStockTemplate = () => {
    const template = [
      { Item_barcode: "ITEM-001", stockGroupCode: "GRP01", quantity: "100", rate: "50.00", value: "5000.00" },
      { Item_barcode: "ITEM-002", stockGroupCode: "GRP02", quantity: "50", rate: "100.00", value: "5000.00" },
    ];
    const ws = utils.json_to_sheet(template);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "Stock Import");
    writeFile(wb, "stock_import_template.xlsx");
    toast({ title: "Template Downloaded", description: "Use this template to import stock" });
  };

  const handleStockFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setStockFile(selectedFile);
    setStockErrors([]);
    setStockPreview([]);
    setStockImportComplete(false);

    try {
      const data = await selectedFile.arrayBuffer();
      const workbook = await read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = utils.sheet_to_json<any>(worksheet);

      if (jsonData.length === 0) {
        toast({ title: "Empty File", description: "The Excel file is empty.", variant: "destructive" });
        return;
      }

      const headerRow = utils.sheet_to_json<string[]>(worksheet, { header: 1 })[0] || [];
      const columns = headerRow.map((h: any) => String(h || "").trim());
      const requiredCols = ["Item_barcode", "quantity", "rate", "value"];
      const missingCols = requiredCols.filter(col => !columns.includes(col));
      
      if (missingCols.length > 0) {
        toast({
          title: "Missing Required Columns",
          description: `Expected: ${requiredCols.join(", ")}. Download template for format.`,
          variant: "destructive",
        });
        return;
      }

      const errors: string[] = [];
      const rows: Array<{ Item_barcode: string; stockGroupCode?: string; quantity: string; rate: string; value: string }> = [];

      jsonData.forEach((row: any, index: number) => {
        const rowNumber = index + 2;
        if (!row.Item_barcode || String(row.Item_barcode).trim() === "") {
          errors.push(`Row ${rowNumber}: Item_barcode is required`);
          return;
        }
        const quantity = parseFloat(row.quantity || "0");
        const rate = parseFloat(row.rate || "0");
        const value = parseFloat(row.value || "0");
        if (isNaN(quantity) || quantity === 0) {
          errors.push(`Row ${rowNumber}: Quantity must be a non-zero number (negative quantities are allowed)`);
          return;
        }
        if (isNaN(rate) || rate < 0) {
          errors.push(`Row ${rowNumber}: Rate must be >= 0`);
          return;
        }
        rows.push({
          Item_barcode: String(row.Item_barcode).trim(),
          stockGroupCode: row.stockGroupCode ? String(row.stockGroupCode).trim() : undefined,
          quantity: String(quantity),
          rate: String(rate),
          value: String(value),
        });
      });

      setStockPreview(rows);
      setStockErrors(errors);
    } catch (error) {
      toast({ title: "Error Reading File", description: "Please ensure valid Excel file.", variant: "destructive" });
    }
  };

  const handleStockImport = async () => {
    if (!stockLocationId) {
      toast({ title: "No Location Selected", description: "Please select a location first", variant: "destructive" });
      return;
    }
    if (stockErrors.length > 0) {
      toast({ title: "Cannot Import", description: "Please fix validation errors first", variant: "destructive" });
      return;
    }

    setIsImportingStock(true);
    try {
      const res = await modeApiRequest("POST", `/api/locations/${stockLocationId}/import-inventory`, {
        items: stockPreview,
      });
      const response = await res.json();
      queryClient.invalidateQueries({ queryKey: [`/api/locations/${stockLocationId}/inventory`] });
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      setStockImportComplete(true);
      toast({
        title: "Import Successful",
        description: `Imported ${response.imported || stockPreview.length} inventory items`,
      });
    } catch (error: any) {
      toast({ title: "Import Failed", description: error.message || "Failed to import", variant: "destructive" });
    } finally {
      setIsImportingStock(false);
    }
  };

  const handleStockDialogClose = () => {
    setStockImportOpen(false);
    setStockFile(null);
    setStockPreview([]);
    setStockErrors([]);
    setStockImportComplete(false);
  };

  if (!selectedCompany) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5" />
          <h2 className="text-2xl font-semibold">Data Tools</h2>
        </div>
        <p className="text-muted-foreground">
          Please select a company to access data tools.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Database className="h-5 w-5" />
        <h2 className="text-2xl font-semibold">Data Tools</h2>
      </div>
      <p className="text-muted-foreground">
        Administrative utilities for bulk data operations and maintenance tasks.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Import Cost Prices Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-4 w-4" />
              Import Cost Prices
            </CardTitle>
            <CardDescription>
              Bulk update inventory cost prices from Excel file
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Select Location</Label>
              <Select value={costPriceLocationId} onValueChange={setCostPriceLocationId}>
                <SelectTrigger data-testid="select-location-cost-price">
                  <SelectValue placeholder="Choose location..." />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((loc: any) => (
                    <SelectItem key={loc.id} value={String(loc.id)}>{loc.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setCostPriceImportOpen(true)}
              disabled={!costPriceLocationId}
              data-testid="button-open-cost-price-import"
            >
              <Upload className="h-4 w-4 mr-2" />
              Import Cost Prices
            </Button>
          </CardContent>
        </Card>

        {/* Import Stock Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-4 w-4" />
              Import Stock
            </CardTitle>
            <CardDescription>
              Bulk import inventory quantities from Excel file
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Select Location</Label>
              <Select value={stockLocationId} onValueChange={setStockLocationId}>
                <SelectTrigger data-testid="select-location-stock-import">
                  <SelectValue placeholder="Choose location..." />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((loc: any) => (
                    <SelectItem key={loc.id} value={String(loc.id)}>{loc.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setStockImportOpen(true)}
              disabled={!stockLocationId}
              data-testid="button-open-stock-import"
            >
              <Upload className="h-4 w-4 mr-2" />
              Import Stock
            </Button>
          </CardContent>
        </Card>

        {/* Convert Bale to BL Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4" />
              Convert Bale to BL
            </CardTitle>
            <CardDescription>
              Update all stock items with "Bale" UOM to "BL"
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => updateUOMMutation.mutate()}
              disabled={updateUOMMutation.isPending}
              data-testid="button-convert-bale-bl"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${updateUOMMutation.isPending ? "animate-spin" : ""}`} />
              {updateUOMMutation.isPending ? "Converting..." : "Convert Bale to BL"}
            </Button>
          </CardContent>
        </Card>

        {/* Fix Cost Prices Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calculator className="h-4 w-4" />
              Fix Cost Prices
            </CardTitle>
            <CardDescription>
              Recalculate sales cost prices based on inventory records
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => recalculateCostsMutation.mutate()}
              disabled={recalculateCostsMutation.isPending}
              data-testid="button-fix-cost-prices"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${recalculateCostsMutation.isPending ? "animate-spin" : ""}`} />
              {recalculateCostsMutation.isPending ? "Updating..." : "Fix Cost Prices"}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Cost Price Import Dialog */}
      <Dialog open={costPriceImportOpen} onOpenChange={handleCostPriceDialogClose}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import Cost Prices from Excel</DialogTitle>
            <DialogDescription>
              Upload an Excel file with barcode and costPrice columns
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Button variant="outline" onClick={downloadCostPriceTemplate} size="sm" data-testid="button-download-cost-price-template">
              <Download className="h-4 w-4 mr-2" />
              Download Template
            </Button>
            <div className="space-y-2">
              <Label htmlFor="cost-price-file">Select Excel File</Label>
              <Input
                id="cost-price-file"
                type="file"
                accept=".xlsx,.xls"
                onChange={handleCostPriceFileChange}
                disabled={isImportingCostPrice || costPriceImportComplete}
                data-testid="input-cost-price-file"
              />
              {costPriceFile && <p className="text-sm text-muted-foreground">Selected: {costPriceFile.name}</p>}
            </div>
            {costPriceErrors.length > 0 && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <div className="font-semibold mb-2">{costPriceErrors.length} validation error(s):</div>
                  <ul className="list-disc list-inside space-y-1">
                    {costPriceErrors.slice(0, 5).map((err, i) => <li key={i} className="text-sm">{err}</li>)}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            {costPricePreview.length > 0 && costPriceErrors.length === 0 && (
              <Alert>
                <Package className="h-4 w-4" />
                <AlertDescription>{costPricePreview.length} records ready to import</AlertDescription>
              </Alert>
            )}
            {costPriceImportComplete && (
              <Alert>
                <Package className="h-4 w-4" />
                <AlertDescription>Cost prices imported successfully</AlertDescription>
              </Alert>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={handleCostPriceDialogClose} disabled={isImportingCostPrice}>Close</Button>
              <Button
                onClick={handleCostPriceImport}
                disabled={costPricePreview.length === 0 || costPriceErrors.length > 0 || isImportingCostPrice || costPriceImportComplete}
                data-testid="button-submit-cost-price-import"
              >
                {isImportingCostPrice ? "Importing..." : "Import Cost Prices"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Stock Import Dialog */}
      <Dialog open={stockImportOpen} onOpenChange={handleStockDialogClose}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import Stock from Excel</DialogTitle>
            <DialogDescription>
              Upload an Excel file with Item_barcode, quantity, rate, value columns
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Button variant="outline" onClick={downloadStockTemplate} size="sm" data-testid="button-download-stock-template">
              <Download className="h-4 w-4 mr-2" />
              Download Template
            </Button>
            <div className="space-y-2">
              <Label htmlFor="stock-file">Select Excel File</Label>
              <Input
                id="stock-file"
                type="file"
                accept=".xlsx,.xls"
                onChange={handleStockFileChange}
                disabled={isImportingStock || stockImportComplete}
                data-testid="input-stock-file"
              />
              {stockFile && <p className="text-sm text-muted-foreground">Selected: {stockFile.name}</p>}
            </div>
            {stockErrors.length > 0 && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <div className="font-semibold mb-2">{stockErrors.length} validation error(s):</div>
                  <ul className="list-disc list-inside space-y-1">
                    {stockErrors.slice(0, 5).map((err, i) => <li key={i} className="text-sm">{err}</li>)}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            {stockPreview.length > 0 && stockErrors.length === 0 && (
              <Alert>
                <Package className="h-4 w-4" />
                <AlertDescription>{stockPreview.length} records ready to import</AlertDescription>
              </Alert>
            )}
            {stockImportComplete && (
              <Alert>
                <Package className="h-4 w-4" />
                <AlertDescription>Stock imported successfully</AlertDescription>
              </Alert>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={handleStockDialogClose} disabled={isImportingStock}>Close</Button>
              <Button
                onClick={handleStockImport}
                disabled={stockPreview.length === 0 || stockErrors.length > 0 || isImportingStock || stockImportComplete}
                data-testid="button-submit-stock-import"
              >
                {isImportingStock ? "Importing..." : "Import Stock"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Edit Log Table component
function EditLogTable({ companyId }: { companyId?: number }) {
  const { data: auditLogs = [], isLoading, error } = useQuery<any[]>({
    queryKey: ["/api/audit-log", companyId],
    enabled: !!companyId,
  });

  const formatDate = (date: string) => {
    return new Date(date).toLocaleString();
  };

  const formatChanges = (changes: any) => {
    if (!changes) return null;
    return Object.entries(changes).map(([field, values]: [string, any]) => (
      <div key={field} className="text-xs">
        <span className="font-medium">{field}:</span>{" "}
        <span className="text-red-500 line-through">{values?.old ?? "null"}</span>
        {" → "}
        <span className="text-green-500">{values?.new ?? "null"}</span>
      </div>
    ));
  };

  if (!companyId) {
    return <p className="text-muted-foreground">Select a company to view edit logs.</p>;
  }

  if (isLoading) {
    return <div className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</div>;
  }

  if (error) {
    return <p className="text-red-500">Error loading audit logs</p>;
  }

  if (auditLogs.length === 0) {
    return <p className="text-muted-foreground">No edit logs found. Changes will appear here when records are modified.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 bg-muted z-10">Date</TableHead>
            <TableHead>User</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Table</TableHead>
            <TableHead>Record</TableHead>
            <TableHead>Changes</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {auditLogs.map((log: any) => (
            <TableRow key={log.id}>
              <TableCell className="sticky left-0 bg-background z-10 text-xs whitespace-nowrap">
                {formatDate(log.createdAt)}
              </TableCell>
              <TableCell>{log.username}</TableCell>
              <TableCell>
                <Badge variant={log.action === "delete" ? "destructive" : log.action === "create" ? "default" : "secondary"}>
                  {log.action}
                </Badge>
              </TableCell>
              <TableCell>{log.tableName}</TableCell>
              <TableCell>{log.recordIdentifier || log.recordId}</TableCell>
              <TableCell className="max-w-xs">{formatChanges(log.changes)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}


function PosSettingsTab() {
  const { toast } = useToast();
  const { selectedCompany } = useCompany();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);

  const { data: companySettings } = useQuery<any>({
    queryKey: ["/api/company-settings", selectedCompany?.id],
    enabled: !!selectedCompany?.id,
    queryFn: async () => {
      const res = await fetch(`/api/company-settings?companyId=${selectedCompany?.id}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await modeApiRequest("POST", "/api/company-settings", {
        companyId: selectedCompany?.id,
        posExcelImportEnabled: enabled,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company-settings", selectedCompany?.id] });
      toast({ title: "Updated", description: "POS Excel Import setting has been saved." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  if (!selectedCompany) {
    return (
      <Card className="p-6">
        <p className="text-muted-foreground">Select a company to configure POS settings.</p>
      </Card>
    );
  }

  const isEnabled = companySettings?.posExcelImportEnabled ?? false;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ShoppingCart className="h-5 w-5" />
        <h2 className="text-lg font-semibold" data-testid="text-pos-settings-title">POS Settings</h2>
      </div>
      <p className="text-sm text-muted-foreground">Configure features available to POS users for {selectedCompany.name}.</p>

      <Card className="p-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-green-500/10 rounded-lg">
              <Upload className="h-6 w-6 text-green-500" />
            </div>
            <div>
              <h3 className="font-semibold" data-testid="text-pos-excel-import-title">POS Excel Import</h3>
              <p className="text-sm text-muted-foreground">
                Allow POS users to import sales from Excel files. When enabled, a "POS Import" option appears in their sidebar.
              </p>
            </div>
          </div>
          <Switch
            checked={isEnabled}
            onCheckedChange={(checked) => toggleMutation.mutate(checked)}
            disabled={toggleMutation.isPending}
            data-testid="switch-pos-excel-import"
          />
        </div>
      </Card>
    </div>
  );
}


function FileStorageTab() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [description, setDescription] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const { data: files = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/files"],
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ file, desc }: { file: File; desc: string }) => {
      const formData = new FormData();
      formData.append("file", file);
      if (desc) formData.append("description", desc);
      const res = await fetch("/api/files/upload", {
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
    onSuccess: () => {
      toast({ title: "File uploaded", description: "Your file has been stored." });
      setDescription("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      queryClient.invalidateQueries({ queryKey: ["/api/files"] });
    },
    onError: (error: any) => {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/files/${id}`),
    onSuccess: () => {
      toast({ title: "File deleted" });
      setDeleteId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/files"] });
    },
    onError: (error: any) => {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadMutation.mutate({ file, desc: description });
  };

  const handleDownload = async (id: number, fileName: string) => {
    try {
      const res = await fetch(`/api/files/${id}/download`, { credentials: "include" });
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Download failed", variant: "destructive" });
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Upload className="h-5 w-5" />
        <h2 className="text-2xl font-semibold">File Storage</h2>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload a File</CardTitle>
          <CardDescription>Store documents, reports, or any files (max 10 MB each).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              placeholder="Description (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="flex-1"
              data-testid="input-file-description"
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadMutation.isPending}
              data-testid="button-upload-file"
            >
              {uploadMutation.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" />Uploading...</>
              ) : (
                <><Upload className="h-4 w-4 mr-2" />Choose File</>
              )}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleFileSelect}
              data-testid="input-file-picker"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Stored Files</CardTitle>
          <CardDescription>{files.length} file{files.length !== 1 ? "s" : ""} stored</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 bg-muted animate-pulse rounded-md" />
              ))}
            </div>
          ) : files.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <Database className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p>No files stored yet. Upload a file above.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((file: any) => (
                  <TableRow key={file.id} data-testid={`row-file-${file.id}`}>
                    <TableCell className="font-medium max-w-[200px] truncate">{file.fileName}</TableCell>
                    <TableCell className="text-muted-foreground max-w-[200px] truncate">{file.description || "—"}</TableCell>
                    <TableCell className="text-muted-foreground font-mono text-sm">{formatSize(file.fileSize)}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(file.uploadedAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleDownload(file.id, file.fileName)}
                          data-testid={`button-download-${file.id}`}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <AlertDialog open={deleteId === file.id} onOpenChange={(open) => !open && setDeleteId(null)}>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => setDeleteId(file.id)}
                              data-testid={`button-delete-file-${file.id}`}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete file?</AlertDialogTitle>
                              <AlertDialogDescription>
                                "{file.fileName}" will be permanently deleted. This cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteMutation.mutate(file.id)}
                                className="bg-destructive text-destructive-foreground"
                                data-testid={`button-confirm-delete-${file.id}`}
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BulkRenameTab() {
  const { toast } = useToast();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);
  const [findText, setFindText] = useState("");
  const [replaceWith, setReplaceWith] = useState("");
  const [wholeWordOnly, setWholeWordOnly] = useState(false);
  const [caseInsensitive, setCaseInsensitive] = useState(true);
  const [matchingItems, setMatchingItems] = useState<{ id: number; code: string; name: string }[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isSearching, setIsSearching] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  const buildRegex = () => {
    if (!findText.trim()) return null;
    const escaped = findText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = wholeWordOnly ? `\\b${escaped}\\b` : escaped;
    const flags = caseInsensitive ? "gi" : "g";
    return new RegExp(pattern, flags);
  };

  const handleSearch = async () => {
    if (!findText.trim()) {
      toast({ title: "Error", description: "Please enter text to find", variant: "destructive" });
      return;
    }
    setIsSearching(true);
    try {
      const res = await fetch("/api/stock-items", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch stock items");
      const allItems = await res.json();
      const regex = buildRegex();
      if (!regex) return;
      const matches = allItems.filter((item: any) => regex.test(item.name)).map((item: any) => ({
        id: item.id,
        code: item.code || "",
        name: item.name,
      }));
      regex.lastIndex = 0;
      setMatchingItems(matches);
      setSelectedIds(new Set(matches.map((m: any) => m.id)));
      if (matches.length === 0) {
        toast({ title: "No matches", description: "No stock items matched the search text" });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setIsSearching(false);
    }
  };

  const getPreviewName = (name: string) => {
    const regex = buildRegex();
    if (!regex) return name;
    return name.replace(regex, replaceWith);
  };

  const renderPreviewName = (name: string) => {
    const regex = buildRegex();
    if (!regex) return name;
    const parts: (string | JSX.Element)[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    const r = new RegExp(regex.source, regex.flags);
    while ((match = r.exec(name)) !== null) {
      if (match.index > lastIndex) {
        parts.push(name.slice(lastIndex, match.index));
      }
      parts.push(
        <span key={match.index} className="text-green-600 dark:text-green-400 font-medium">
          {replaceWith}
        </span>
      );
      lastIndex = match.index + match[0].length;
      if (match[0].length === 0) {
        r.lastIndex++;
      }
    }
    if (lastIndex < name.length) {
      parts.push(name.slice(lastIndex));
    }
    return <>{parts}</>;
  };

  const handleApply = async () => {
    if (selectedIds.size === 0) return;
    setIsApplying(true);
    try {
      const res = await modeApiRequest("POST", "/api/stock-items/bulk-rename", {
        findText,
        replaceWith,
        itemIds: Array.from(selectedIds),
        wholeWordOnly,
        caseInsensitive,
      });
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/stock-items"] });
      toast({
        title: "Bulk Rename Complete",
        description: `${data.updated} item(s) renamed successfully`,
      });
      if (data.failures && data.failures.length > 0) {
        toast({
          title: "Some items failed",
          description: data.failures.map((f: any) => `${f.name}: ${f.reason}`).join(", "),
          variant: "destructive",
        });
      }
      setMatchingItems([]);
      setSelectedIds(new Set());
      setFindText("");
      setReplaceWith("");
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setIsApplying(false);
    }
  };

  const toggleItem = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(matchingItems.map((m) => m.id)));
  const clearAll = () => setSelectedIds(new Set());

  return (
    <Card>
      <CardHeader>
        <CardTitle data-testid="text-bulk-rename-title">Bulk Rename Stock Items</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="bulk-find-text">Find Text</Label>
            <Input
              id="bulk-find-text"
              value={findText}
              onChange={(e) => setFindText(e.target.value)}
              placeholder="Text to find in item names..."
              data-testid="input-bulk-find-text"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bulk-replace-with">Replace With</Label>
            <Input
              id="bulk-replace-with"
              value={replaceWith}
              onChange={(e) => setReplaceWith(e.target.value)}
              placeholder="Replacement text..."
              data-testid="input-bulk-replace-with"
            />
          </div>
        </div>
        <div className="flex items-center gap-6 flex-wrap">
          <div className="flex items-center gap-2">
            <Checkbox
              id="bulk-whole-word"
              checked={wholeWordOnly}
              onCheckedChange={(checked) => setWholeWordOnly(checked === true)}
              data-testid="checkbox-whole-word"
            />
            <Label htmlFor="bulk-whole-word" className="cursor-pointer">Whole word only</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="bulk-case-insensitive"
              checked={caseInsensitive}
              onCheckedChange={(checked) => setCaseInsensitive(checked === true)}
              data-testid="checkbox-case-insensitive"
            />
            <Label htmlFor="bulk-case-insensitive" className="cursor-pointer">Case insensitive</Label>
          </div>
          <Button onClick={handleSearch} disabled={isSearching || !findText.trim()} data-testid="button-bulk-search">
            {isSearching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Search
          </Button>
        </div>

        {matchingItems.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-sm text-muted-foreground" data-testid="text-match-count">
                {matchingItems.length} item(s) found, {selectedIds.size} selected
              </span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={selectAll} data-testid="button-select-all">
                  Select All
                </Button>
                <Button size="sm" variant="outline" onClick={clearAll} data-testid="button-clear-all">
                  Clear All
                </Button>
              </div>
            </div>
            <div className="border rounded-md overflow-auto max-h-96">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead>Item Code</TableHead>
                    <TableHead>Current Name</TableHead>
                    <TableHead>Preview New Name</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {matchingItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.has(item.id)}
                          onCheckedChange={() => toggleItem(item.id)}
                          data-testid={`checkbox-item-${item.id}`}
                        />
                      </TableCell>
                      <TableCell data-testid={`text-item-code-${item.id}`}>{item.code}</TableCell>
                      <TableCell data-testid={`text-item-name-${item.id}`}>{item.name}</TableCell>
                      <TableCell data-testid={`text-item-preview-${item.id}`}>{renderPreviewName(item.name)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex justify-end">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button disabled={selectedIds.size === 0 || isApplying} data-testid="button-apply-rename">
                    {isApplying ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    Apply Changes
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Rename {selectedIds.size} items?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will replace "{findText}" with "{replaceWith}" in {selectedIds.size} selected item name(s). This action cannot be easily undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel data-testid="button-cancel-rename">Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleApply} data-testid="button-confirm-rename">
                      Confirm Rename
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const ALL_FACTORY_PAGES_SETTINGS: { key: string; label: string; group: string }[] = [
  { key: "factory/dashboard", label: "Dashboard", group: "Overview" },
  { key: "factory/daybook", label: "Daybook", group: "Overview" },
  { key: "factory/suppliers", label: "Suppliers", group: "Master Data" },
  { key: "factory/customers", label: "Customers", group: "Master Data" },
  { key: "factory/containers", label: "Containers", group: "Master Data" },
  { key: "factory/bale-products", label: "Bale Products", group: "Master Data" },
  { key: "factory/workers", label: "Workers", group: "Master Data" },
  { key: "factory/raw-stock", label: "Raw Stock", group: "Raw Materials" },
  { key: "factory/mix-batches", label: "Mix Batches", group: "Raw Materials" },
  { key: "factory/stock-entry", label: "Stock Entry", group: "Production" },
  { key: "factory/bales-history", label: "Bales History", group: "Production" },
  { key: "factory/sales/new", label: "New Invoice", group: "Sales" },
  { key: "factory/sales/loading/new", label: "Container Loading", group: "Sales" },
  { key: "factory/sales/loading/pending", label: "Pending Loadings", group: "Sales" },
  { key: "factory/sales/pending-invoices", label: "Pending Invoices", group: "Sales" },
  { key: "factory/sales/invoices", label: "Invoices", group: "Sales" },
  { key: "factory/sales/proformas", label: "Proformas", group: "Sales" },
  { key: "factory/bale-transfers", label: "Bale Transfers", group: "Logistics" },
  { key: "factory/location-inventory", label: "Location Inventory", group: "Inventory" },
  { key: "factory/stock-otw", label: "Stock OTW", group: "Inventory" },
  { key: "factory/stock-query", label: "Stock Query", group: "Inventory" },
  { key: "factory/accounts", label: "Accounts", group: "Accounting" },
  { key: "factory/vouchers", label: "Vouchers", group: "Accounting" },
  { key: "factory/create", label: "Create Voucher", group: "Accounting" },
  { key: "factory/analytics", label: "Analytics", group: "Finance" },
  { key: "factory/production-summary", label: "Production Summary", group: "Finance" },
  { key: "factory/supplier-report", label: "Supplier Report", group: "Reports" },
  { key: "factory/intelligence/dashboard", label: "Factory Dashboard", group: "Intelligence" },
  { key: "factory/intelligence/kpis", label: "KPIs", group: "Intelligence" },
  { key: "factory/intelligence/profitability", label: "Profitability", group: "Intelligence" },
  { key: "factory/intelligence/waste", label: "Waste Tracking", group: "Intelligence" },
  { key: "factory/intelligence/alerts", label: "Alerts", group: "Intelligence" },
  { key: "factory/intelligence/supplier-scores", label: "Supplier Scores", group: "Intelligence" },
  { key: "factory/intelligence/mix-optimizer", label: "Mix Optimizer", group: "Intelligence" },
  { key: "factory/intelligence/cashflow", label: "Cash Flow", group: "Intelligence" },
  { key: "factory/intelligence/settings", label: "Intelligence Settings", group: "Intelligence" },
  { key: "factory/barcode-lookup", label: "Barcode Lookup", group: "Traceability" },
  { key: "factory/import", label: "Import Data", group: "Data" },
  { key: "factory/users", label: "User Management", group: "Data" },
  { key: "factory/chat", label: "Chat", group: "Data" },
  { key: "factory/settings", label: "Settings", group: "Data" },
];
const FACTORY_PAGE_GROUPS_SETTINGS = Array.from(new Set(ALL_FACTORY_PAGES_SETTINGS.map(p => p.group)));

const ALL_ERP_PAGES: { key: string; label: string; group: string }[] = [
  { key: "dashboard", label: "Dashboard", group: "Overview" },
  { key: "pos", label: "Point of Sale", group: "Sales & POS" },
  { key: "pos_daybook", label: "POS Daybook", group: "Sales & POS" },
  { key: "stock_items", label: "Stock Items", group: "Inventory" },
  { key: "location_inventory", label: "Location Inventory", group: "Inventory" },
  { key: "containers", label: "Containers", group: "Inventory" },
  { key: "stock_otw", label: "Stock OTW", group: "Inventory" },
  { key: "stock_query", label: "Stock Query", group: "Inventory" },
  { key: "location_summary", label: "Location Summary", group: "Inventory" },
  { key: "accounts", label: "Accounts", group: "Accounting" },
  { key: "suppliers", label: "Suppliers", group: "Accounting" },
  { key: "customers", label: "Customers", group: "Accounting" },
  { key: "daybook", label: "Daybook", group: "Accounting" },
  { key: "payroll", label: "Payroll", group: "Accounting" },
  { key: "vouchers", label: "Vouchers", group: "Vouchers" },
  { key: "optional_vouchers", label: "Optional Vouchers", group: "Vouchers" },
  { key: "create", label: "Create Voucher", group: "Vouchers" },
  { key: "analytics", label: "Analytics", group: "Analytics" },
  { key: "sales_report", label: "Sales Report", group: "Analytics" },
  { key: "factory_production", label: "Factory Production", group: "Analytics" },
  { key: "settings", label: "Settings", group: "System" },
];

const ERP_PAGE_GROUPS = Array.from(new Set(ALL_ERP_PAGES.map(p => p.group)));

const ERP_COST_FIELDS = [
  { key: "daybook_amounts",      label: "Daybook: Transaction Amounts" },
  { key: "accounts_balances",    label: "Accounts: Account Balances" },
  { key: "container_costs",      label: "Containers: Cost & Fee Columns" },
  { key: "stock_rates",          label: "Stock Items: Rate / Price Columns" },
  { key: "analytics_financials", label: "Analytics & P&L: Revenue & Profit" },
  { key: "voucher_amounts",      label: "Vouchers: Amount Columns" },
];

const FACTORY_COST_FIELDS = [
  { key: "inventory_avg_rate",      label: "Location Inventory: Avg Rate" },
  { key: "inventory_total_value",   label: "Location Inventory: Total Value" },
  { key: "bale_history_cost_per_kg", label: "Bale History: Cost/KG" },
  { key: "bale_history_total_cost", label: "Bale History: Total Cost" },
  { key: "bales_list_cost_per_kg",  label: "Bales List: Cost/kg" },
];

function PageAccessSection({ users, companies, selectedCompany, featureLabels, toast }: any) {
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [pageTab, setPageTab] = useState<"erp" | "factory">("erp");
  const [selectedPages, setSelectedPages] = useState<Set<string>>(new Set());
  const [factorySelectedPages, setFactorySelectedPages] = useState<Set<string>>(new Set());
  const [hiddenCostFields, setHiddenCostFields] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const { data: userCompanyRoles = [] } = useQuery<any[]>({
    queryKey: ["/api/users", selectedCompany?.id],
    enabled: !!selectedCompany,
    queryFn: async () => {
      const res = await fetch("/api/users", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: pageAccess, isLoading: isLoadingAccess } = useQuery<{ pageKeys: string[] }>({
    queryKey: ["/api/erp-user-page-access", selectedUserId, selectedCompany?.id],
    enabled: !!selectedUserId && !!selectedCompany,
    queryFn: async () => {
      const res = await fetch(`/api/erp-user-page-access/${selectedUserId}`, { credentials: "include" });
      if (!res.ok) return { pageKeys: [] };
      return res.json();
    },
  });

  const { data: factoryUsers } = useQuery<any[]>({
    queryKey: ["/api/factory/users", selectedCompany?.id],
    enabled: !!selectedUserId && !!selectedCompany,
    queryFn: async () => {
      const res = await factoryApiRequest("GET", "/api/factory/users");
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: hiddenCostData } = useQuery<{ hiddenCostFields: string[] }>({
    queryKey: ["/api/erp-user-hidden-costs", selectedUserId],
    enabled: !!selectedUserId,
    queryFn: async () => {
      const res = await fetch(`/api/erp-user-hidden-costs/${selectedUserId}`, { credentials: "include" });
      if (!res.ok) return { hiddenCostFields: [] };
      return res.json();
    },
  });

  useEffect(() => {
    if (pageAccess) {
      setSelectedPages(new Set(pageAccess.pageKeys));
    }
  }, [pageAccess]);

  useEffect(() => {
    if (factoryUsers && selectedUserId) {
      const factoryUser = factoryUsers.find((u: any) => u.id === selectedUserId);
      setFactorySelectedPages(new Set(factoryUser?.pageAccess || []));
    }
  }, [factoryUsers, selectedUserId]);

  useEffect(() => {
    if (hiddenCostData) {
      setHiddenCostFields(hiddenCostData.hiddenCostFields);
    }
  }, [hiddenCostData]);

  const saveMutation = useMutation({
    mutationFn: async (pageKeys: string[]) => {
      const res = await apiRequest("PUT", `/api/erp-user-page-access/${selectedUserId}`, { pageKeys });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp-user-page-access", selectedUserId] });
      toast({ title: "ERP Page Access Updated", description: "User ERP page access has been saved." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const saveFactoryMutation = useMutation({
    mutationFn: async (pageKeys: string[]) => {
      const res = await factoryApiRequest("PUT", `/api/factory/users/${selectedUserId}`, { pageAccess: pageKeys });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message || "Failed to save"); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/users", selectedCompany?.id] });
      toast({ title: "Factory Page Access Updated", description: "User factory page access has been saved." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const saveCostMutation = useMutation({
    mutationFn: async (fields: string[]) => {
      const res = await apiRequest("PUT", `/api/erp-user-hidden-costs/${selectedUserId}`, { hiddenCostFields: fields });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp-user-hidden-costs", selectedUserId] });
      toast({ title: "Cost Visibility Updated", description: "User cost visibility has been saved." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const activePageList = pageTab === "erp" ? ALL_ERP_PAGES : ALL_FACTORY_PAGES_SETTINGS;
  const activePageGroups = pageTab === "erp" ? ERP_PAGE_GROUPS : FACTORY_PAGE_GROUPS_SETTINGS;
  const activeSelected = pageTab === "erp" ? selectedPages : factorySelectedPages;
  const setActiveSelected = pageTab === "erp" ? setSelectedPages : setFactorySelectedPages;

  const togglePage = (key: string) => {
    setActiveSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleGroup = (group: string) => {
    const groupPages = activePageList.filter(p => p.group === group).map(p => p.key);
    const allSelected = groupPages.every(k => activeSelected.has(k));
    setActiveSelected(prev => {
      const next = new Set(prev);
      groupPages.forEach(k => allSelected ? next.delete(k) : next.add(k));
      return next;
    });
  };

  const toggleCostField = (key: string) => {
    setHiddenCostFields(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const selectAll = () => setActiveSelected(new Set(activePageList.map(p => p.key)));
  const selectNone = () => setActiveSelected(new Set());

  const selectedUser = users.find((u: any) => u.id === selectedUserId);
  const isAdmin = selectedUser && users.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Shield className="h-5 w-5" />
        <h2 className="text-2xl font-semibold" data-testid="text-page-access-title">Page Access</h2>
      </div>

      <p className="text-muted-foreground">
        Configure which pages each user can access. Admin users always have full access. Select a user to manage their page access for the current company.
      </p>

      {!selectedCompany ? (
        <Card className="p-6">
          <p className="text-muted-foreground">Please select a company first.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex items-center gap-3 flex-wrap">
              <Label className="font-medium">User:</Label>
              <Select value={selectedUserId} onValueChange={(val) => setSelectedUserId(val)}>
                <SelectTrigger className="w-64" data-testid="select-page-access-user">
                  <SelectValue placeholder="Select a user..." />
                </SelectTrigger>
                <SelectContent>
                  {users
                    .filter((u: any) => u.active)
                    .map((u: any) => (
                      <SelectItem key={u.id} value={u.id} data-testid={`option-user-${u.id}`}>
                        {u.username} {u.fullName ? `(${u.fullName})` : ""}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </Card>

          {selectedUserId && (
            <Card className="p-4 space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Label className="text-base font-semibold">Pages for {selectedUser?.username || "User"}</Label>
                  {isLoadingAccess && <Loader2 className="h-4 w-4 animate-spin" />}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={selectAll} data-testid="button-page-select-all">
                    All
                  </Button>
                  <Button variant="outline" size="sm" onClick={selectNone} data-testid="button-page-select-none">
                    None
                  </Button>
                </div>
              </div>

              <Tabs value={pageTab} onValueChange={(v) => setPageTab(v as "erp" | "factory")}>
                <TabsList className="w-full">
                  <TabsTrigger value="erp" className="flex-1" data-testid="tab-erp-pages">
                    ERP Pages
                  </TabsTrigger>
                  <TabsTrigger value="factory" className="flex-1" data-testid="tab-factory-pages">
                    Factory Pages
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              <div className="space-y-4 border rounded-md p-4 max-h-96 overflow-y-auto">
                {activePageGroups.map(group => {
                  const groupPages = activePageList.filter(p => p.group === group);
                  const allGroupSelected = groupPages.every(p => activeSelected.has(p.key));
                  const someGroupSelected = groupPages.some(p => activeSelected.has(p.key));

                  return (
                    <div key={group} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          checked={allGroupSelected}
                          onCheckedChange={() => toggleGroup(group)}
                          data-testid={`checkbox-page-group-${group.toLowerCase().replace(/\s+/g, '-')}`}
                        />
                        <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                          {group}
                        </span>
                        {someGroupSelected && !allGroupSelected && (
                          <span className="text-xs text-muted-foreground">(partial)</span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-1 ml-6">
                        {groupPages.map(page => (
                          <div key={page.key} className="flex items-center gap-2">
                            <Checkbox
                              checked={activeSelected.has(page.key)}
                              onCheckedChange={() => togglePage(page.key)}
                              data-testid={`checkbox-page-${page.key.replace(/\//g, '-')}`}
                            />
                            <span className="text-sm">{page.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {activeSelected.size > 0 && (
                <p className="text-sm text-muted-foreground">
                  {activeSelected.size} of {activePageList.length} pages selected
                </p>
              )}

              <div className="flex justify-end">
                <Button
                  onClick={() => {
                    if (pageTab === "erp") {
                      saveMutation.mutate(Array.from(selectedPages));
                    } else {
                      saveFactoryMutation.mutate(Array.from(factorySelectedPages));
                    }
                  }}
                  disabled={saveMutation.isPending || saveFactoryMutation.isPending}
                  data-testid="button-save-page-access"
                >
                  {(saveMutation.isPending || saveFactoryMutation.isPending) ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    `Save ${pageTab === "erp" ? "ERP" : "Factory"} Page Access`
                  )}
                </Button>
              </div>

              <div className="space-y-3 pt-2 border-t">
                <div>
                  <Label className="text-base font-semibold">Cost &amp; Pricing Visibility</Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    Toggle off to hide financial/cost data from this user. On = visible, Off = hidden.
                  </p>
                </div>
                <div className="border rounded-md divide-y">
                  {ERP_COST_FIELDS.map(field => (
                    <div key={field.key} className="flex items-center justify-between px-4 py-3">
                      <span className="text-sm">{field.label}</span>
                      <Switch
                        checked={!hiddenCostFields.includes(field.key)}
                        onCheckedChange={() => toggleCostField(field.key)}
                        data-testid={`switch-erp-cost-${field.key}`}
                      />
                    </div>
                  ))}
                </div>
                <div className="flex justify-end">
                  <Button
                    onClick={() => saveCostMutation.mutate(hiddenCostFields)}
                    disabled={saveCostMutation.isPending}
                    data-testid="button-save-cost-visibility"
                  >
                    {saveCostMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      "Save Cost Visibility"
                    )}
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function LoginHistoryTab() {
  const { data: history, isLoading } = useQuery<any[]>({
    queryKey: ["/api/login-history"],
  });
  
  const [filterUser, setFilterUser] = useState("");
  
  const filteredHistory = history?.filter((entry: any) => {
    if (!filterUser) return true;
    return entry.username.toLowerCase().includes(filterUser.toLowerCase());
  }) || [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="section-login-history">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold" data-testid="text-login-history-title">Login History</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            placeholder="Filter by username..."
            value={filterUser}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFilterUser(e.target.value)}
            className="w-48"
            data-testid="input-filter-username"
          />
        </div>
      </div>
      
      {filteredHistory.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No login history found.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="table-login-history">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3 font-medium">User</th>
                  <th className="text-left p-3 font-medium">Company</th>
                  <th className="text-left p-3 font-medium">Date & Time</th>
                  <th className="text-left p-3 font-medium">IP Address</th>
                  <th className="text-left p-3 font-medium">Location</th>
                  <th className="text-left p-3 font-medium">Device</th>
                </tr>
              </thead>
              <tbody>
                {filteredHistory.map((entry: any) => {
                  const loginDate = new Date(entry.loginAt);
                  const locationParts = [entry.city, entry.country].filter(Boolean);
                  const locationStr = locationParts.length > 0 ? locationParts.join(", ") : "Unknown";
                  
                  const ua = entry.userAgent || "";
                  let deviceStr = "Unknown";
                  if (ua.includes("Mobile")) deviceStr = "Mobile";
                  else if (ua.includes("Tablet")) deviceStr = "Tablet";
                  else if (ua.includes("Windows")) deviceStr = "Windows";
                  else if (ua.includes("Mac")) deviceStr = "Mac";
                  else if (ua.includes("Linux")) deviceStr = "Linux";
                  else if (ua.includes("Chrome")) deviceStr = "Chrome";
                  else if (ua.includes("Firefox")) deviceStr = "Firefox";
                  
                  return (
                    <tr key={entry.id} className="border-b last:border-0 hover-elevate" data-testid={`row-login-${entry.id}`}>
                      <td className="p-3 font-medium" data-testid={`text-login-user-${entry.id}`}>{entry.username}</td>
                      <td className="p-3 text-muted-foreground" data-testid={`text-login-company-${entry.id}`}>{entry.companyName || "-"}</td>
                      <td className="p-3 text-muted-foreground" data-testid={`text-login-date-${entry.id}`}>
                        {loginDate.toLocaleDateString()} {loginDate.toLocaleTimeString()}
                      </td>
                      <td className="p-3 font-mono text-xs text-muted-foreground" data-testid={`text-login-ip-${entry.id}`}>{entry.ipAddress || "-"}</td>
                      <td className="p-3 text-muted-foreground" data-testid={`text-login-location-${entry.id}`}>{locationStr}</td>
                      <td className="p-3 text-muted-foreground" data-testid={`text-login-device-${entry.id}`}>{deviceStr}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      
      <p className="text-xs text-muted-foreground">
        Showing last {filteredHistory.length} login events. Location data is approximate and based on IP address.
      </p>
    </div>
  );
}

  export default function Settings() {
    const { toast } = useToast();
    const { selectedCompany } = useCompany();
    const { dateFormat, setDateFormat, isPending: isDateFormatPending } = useDateFormat();
    const appMode = useAppMode();
    const modeApiRequest = getApiRequest(appMode);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<any>(null);
    const [isCompanyDialogOpen, setIsCompanyDialogOpen] = useState(false);
    const [editingCompany, setEditingCompany] = useState<any>(null);
    const [companyToDelete, setCompanyToDelete] = useState<any>(null);
    const [userToDelete, setUserToDelete] = useState<any>(null);
    const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
    const [isRoleDialogOpen, setIsRoleDialogOpen] = useState(false);
    const [isZeroBalanceDialogOpen, setIsZeroBalanceDialogOpen] = useState(false);
    const [selectedAccountsToZero, setSelectedAccountsToZero] = useState<number[]>([]);
    const [editingRole, setEditingRole] = useState<any>(null);
    const [selectedLocationIds, setSelectedLocationIds] = useState<number[]>([]);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [isInitBalancesDialogOpen, setIsInitBalancesDialogOpen] = useState(false);
    const [initBalancesResult, setInitBalancesResult] = useState<any>(null);
    const [expandedBreakdownId, setExpandedBreakdownId] = useState<number | null>(null);
    const [isFixPOCreditsDialogOpen, setIsFixPOCreditsDialogOpen] = useState(false);
    const [fixPOCreditsResult, setFixPOCreditsResult] = useState<any>(null);
    const [selectedCompanyForFix, setSelectedCompanyForFix] = useState<string>("");
    const [selectedParentCompanyForFix, setSelectedParentCompanyForFix] = useState<string>("");
    const [reversePOCreditsResult, setReversePOCreditsResult] = useState<any>(null);
    const [isResetDataDialogOpen, setIsResetDataDialogOpen] = useState(false);
    const [resetDataResult, setResetDataResult] = useState<any>(null);
    const [selectedCompanyForReset, setSelectedCompanyForReset] = useState<string>("");
    const [userToResetPassword, setUserToResetPassword] = useState<any>(null);
    const [newPasswordForReset, setNewPasswordForReset] = useState("");
    const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
    const [changePasswordData, setChangePasswordData] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
    const [orphanedChargesDiagnostic, setOrphanedChargesDiagnostic] = useState<{ count: number; impact: number; vouchers: any[] } | null>(null);
    const [isFixingOrphanedCharges, setIsFixingOrphanedCharges] = useState(false);
    const [orphanedPosSalesDiagnostic, setOrphanedPosSalesDiagnostic] = useState<{ count: number; totalImpact: number; vouchers: any[] } | null>(null);
    const [isFixingOrphanedPosSales, setIsFixingOrphanedPosSales] = useState(false);
    const [isLoadingOrphanedPosSales, setIsLoadingOrphanedPosSales] = useState(false);
    const [selectedContainerForDiag, setSelectedContainerForDiag] = useState<string>("");
    const [containerDiagResult, setContainerDiagResult] = useState<any>(null);
    const [isLoadingContainerDiag, setIsLoadingContainerDiag] = useState(false);

    // Factory user management state
    const [factoryCreateOpen, setFactoryCreateOpen] = useState(false);
    const [factoryEditingUser, setFactoryEditingUser] = useState<any>(null);
    const [factoryDeletingUser, setFactoryDeletingUser] = useState<any>(null);
    const [factoryUserFormData, setFactoryUserFormData] = useState({
      username: "", password: "", displayName: "", hasErpAccess: true, hasFactoryAccess: true,
    });
    const [factoryUserPages, setFactoryUserPages] = useState<Set<string>>(new Set());
    const [factoryUserHiddenCostFields, setFactoryUserHiddenCostFields] = useState<string[]>([]);
  
    const { data: companies = [], isLoading: isLoadingCompanies } = useQuery<any[]>({
      queryKey: ["/api/companies"],
    });
  
    const { data: users = [], isLoading } = useQuery<any[]>({
      queryKey: ["/api/users"],
    });

    // Get current user role for fiscal period access
    const { data: currentUser } = useQuery<{ role?: string }>({
      queryKey: ["/api/auth/me"],
    });

    // Query for ledger accounts for zero balance feature
    const { data: allLedgerAccounts = [] } = useQuery<any[]>({
      queryKey: ["/api/ledger-accounts", selectedCompany?.id],
      enabled: !!selectedCompany && isZeroBalanceDialogOpen,
    });
  
    // Query for user company roles when a user is expanded
    const { data: userCompanyRoles = [] } = useQuery<any[]>({
      queryKey: [`/api/users/${expandedUserId}/company-roles`],
      enabled: !!expandedUserId,
    });

    // Query for role feature permissions
    const { data: rolePermissions = [], isLoading: isLoadingPermissions } = useQuery<any[]>({
      queryKey: ["/api/settings/role-permissions", selectedCompany?.id],
      enabled: !!selectedCompany,
    });

    // Query for containers for offload diagnostics
    const { data: containersForDiag = [] } = useQuery<any[]>({
      queryKey: ["/api/admin/containers-for-diagnostics"],
      enabled: !!selectedCompany && currentUser?.role === "Admin",
    });

    // Factory users query (used in Users section when in factory mode)
    const { data: factoryUsersData = [], isLoading: isLoadingFactoryUsers } = useQuery<any[]>({
      queryKey: ["/api/factory/users"],
      enabled: appMode === "factory",
    });

    const createFactoryUserMutation = useMutation({
      mutationFn: async (data: any) => {
        const res = await factoryApiRequest("POST", "/api/factory/users", data);
        if (!res.ok) { const err = await res.json(); throw new Error(err.message || "Failed to create user"); }
        return res.json();
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/factory/users"] });
        toast({ title: "Created", description: "User created successfully" });
        resetFactoryUserForm();
        setFactoryCreateOpen(false);
      },
      onError: (err: Error) => { toast({ title: "Error", description: err.message, variant: "destructive" }); },
    });

    const updateFactoryUserMutation = useMutation({
      mutationFn: async ({ userId, data }: { userId: string; data: any }) => {
        const res = await factoryApiRequest("PUT", `/api/factory/users/${userId}`, data);
        if (!res.ok) { const err = await res.json(); throw new Error(err.message || "Failed to update user"); }
        return res.json();
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/factory/users"] });
        toast({ title: "Updated", description: "User updated successfully" });
        resetFactoryUserForm();
        setFactoryEditingUser(null);
      },
      onError: (err: Error) => { toast({ title: "Error", description: err.message, variant: "destructive" }); },
    });

    const toggleFactoryAccessMutation = useMutation({
      mutationFn: async ({ userId, data }: { userId: string; data: any }) => {
        const res = await factoryApiRequest("PUT", `/api/factory/users/${userId}`, data);
        if (!res.ok) { const err = await res.json(); throw new Error(err.message || "Failed to update"); }
        return res.json();
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/factory/users"] });
        toast({ title: "Updated", description: "Access updated" });
      },
      onError: (err: Error) => { toast({ title: "Error", description: err.message, variant: "destructive" }); },
    });

    const deleteFactoryUserMutation = useMutation({
      mutationFn: async (userId: string) => {
        const res = await factoryApiRequest("DELETE", `/api/factory/users/${userId}`, {});
        if (!res.ok) { const err = await res.json(); throw new Error(err.message || "Failed to remove"); }
        return res.json();
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/factory/users"] });
        toast({ title: "Removed", description: "User removed" });
        setFactoryDeletingUser(null);
      },
      onError: (err: Error) => { toast({ title: "Error", description: err.message, variant: "destructive" }); },
    });

    const resetFactoryUserForm = () => {
      setFactoryUserFormData({ username: "", password: "", displayName: "", hasErpAccess: true, hasFactoryAccess: true });
      setFactoryUserPages(new Set());
      setFactoryUserHiddenCostFields([]);
    };

    const openFactoryUserEdit = (user: any) => {
      setFactoryEditingUser(user);
      setFactoryUserFormData({ username: user.username, password: "", displayName: user.displayName || "", hasErpAccess: user.hasErpAccess ?? true, hasFactoryAccess: user.hasFactoryAccess ?? true });
      setFactoryUserPages(new Set(user.pageAccess));
      setFactoryUserHiddenCostFields(user.hiddenCostFields ?? []);
    };

    const isFactoryAdminOrOwner = (user: any) => ["admin", "owner"].includes(user.role?.toLowerCase());

    const toggleFactoryUserPage = (pageKey: string) => {
      setFactoryUserPages(prev => { const next = new Set(prev); next.has(pageKey) ? next.delete(pageKey) : next.add(pageKey); return next; });
    };

    const toggleFactoryUserGroup = (group: string) => {
      const groupPages = ALL_FACTORY_PAGES_SETTINGS.filter(p => p.group === group).map(p => p.key);
      const allSelected = groupPages.every(k => factoryUserPages.has(k));
      setFactoryUserPages(prev => { const next = new Set(prev); groupPages.forEach(k => allSelected ? next.delete(k) : next.add(k)); return next; });
    };

    const handleFactoryUserSubmit = () => {
      if (factoryEditingUser) {
        const privileged = isFactoryAdminOrOwner(factoryEditingUser);
        updateFactoryUserMutation.mutate({
          userId: factoryEditingUser.id,
          data: {
            username: factoryUserFormData.username !== factoryEditingUser.username ? factoryUserFormData.username : undefined,
            displayName: factoryUserFormData.displayName,
            pageAccess: Array.from(factoryUserPages),
            password: factoryUserFormData.password || undefined,
            hasErpAccess: privileged ? true : factoryUserFormData.hasErpAccess,
            hasFactoryAccess: privileged ? true : factoryUserFormData.hasFactoryAccess,
            hiddenCostFields: privileged ? [] : factoryUserHiddenCostFields,
          },
        });
      } else {
        createFactoryUserMutation.mutate({
          username: factoryUserFormData.username,
          password: factoryUserFormData.password,
          displayName: factoryUserFormData.displayName,
          pageAccess: Array.from(factoryUserPages),
          hasErpAccess: factoryUserFormData.hasErpAccess,
          hasFactoryAccess: factoryUserFormData.hasFactoryAccess,
          hiddenCostFields: factoryUserHiddenCostFields,
        });
      }
    };

    // Build a lookup map for role permissions: { "role:featureKey": enabled }
    const permissionMap = new Map<string, boolean>();
    rolePermissions.forEach((p: any) => {
      permissionMap.set(`${p.role}:${p.featureKey}`, p.enabled);
    });

    // Get permission value for a role/feature
    const getPermission = (role: string, featureKey: string): boolean => {
      // Admin always has all permissions
      if (role === "Admin") return true;
      const key = `${role}:${featureKey}`;
      // Default to false if not explicitly set (disabled by default)
      return permissionMap.has(key) ? permissionMap.get(key)! : false;
    };

    // Mutation for updating role permissions
    const updateRolePermissionMutation = useMutation({
      mutationFn: async ({ role, featureKey, enabled }: { role: string; featureKey: string; enabled: boolean }) => {
        if (!selectedCompany?.id) throw new Error("No company selected");
        const res = await modeApiRequest("PUT", "/api/settings/role-permissions", {
          companyId: selectedCompany.id,
          permissions: [{ role, featureKey, enabled }],
        });
        return await res.json();
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/settings/role-permissions", selectedCompany?.id] });
        toast({
          title: "Permission Updated",
          description: "Role permission has been updated successfully.",
        });
      },
      onError: (error: any) => {
        toast({
          title: "Error",
          description: error.message || "Failed to update permission",
          variant: "destructive",
        });
      },
    });

    // Roles that can be configured (exclude Admin since they always have full access)
    const configurableRoles = ["Owner", "Manager", "POS1", "POS2", "POS3", "POS4", "POS5", "POS6"];

    // Parent Company setting query and mutation
    const { data: parentCompanyData } = useQuery<{ parentCompanyId: number | null }>({
      queryKey: ["/api/system/parent-company"],
    });

    const setParentCompanyMutation = useMutation({
      mutationFn: async (companyId: number | null) => {
        const res = await modeApiRequest("POST", "/api/system/parent-company", { parentCompanyId: companyId });
        return await res.json();
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/system/parent-company"] });
        toast({
          title: "Success",
          description: "Parent company setting has been updated.",
        });
      },
      onError: (error: any) => {
        toast({
          title: "Error",
          description: error.message || "Failed to update parent company setting",
          variant: "destructive",
        });
      },
    });

    // Feature key to readable name
    const featureLabels: Record<FeatureKey, string> = {
      dashboard: "Dashboard",
      pos: "Point of Sale",
      pos_daybook: "POS Daybook",
      stock_items: "Stock Items",
      location_inventory: "Location Inventory",
      containers: "Containers",
      stock_otw: "Stock OTW",
      factory_production: "Factory Production",
      analytics: "Analytics",
      accounts: "Accounts",
      suppliers: "Suppliers",
      customers: "Customers",
      vouchers: "Vouchers",
      daybook: "Daybook",
      payroll: "Payroll",
      create: "Create",
      stock_query: "Stock Query",
      location_summary: "Location Summary",
      sales_report: "Sales Report",
      settings: "Settings",
      optional_vouchers: "Optional Vouchers",
    };
  
    const companyForm = useForm<CompanyFormData>({
      resolver: zodResolver(companyFormSchema),
      defaultValues: {
        name: "",
        code: "",
        companyType: "erp",
        baseCurrency: "USD",
        displayCurrency: "none",
        active: true,
      },
    });
  
    const form = useForm<UserFormData>({
      resolver: zodResolver(userFormSchema),
      defaultValues: {
        username: "",
        password: "",
        active: true,
      },
    });
  
    const roleForm = useForm<RoleAssignmentData>({
      resolver: zodResolver(roleAssignmentSchema),
      defaultValues: {
        userId: "",
        companyId: 0,
        role: "Manager",
      },
    });
  
    const selectedRole = roleForm.watch("role");
    const selectedCompanyId = roleForm.watch("companyId");
    
    // Load locations for the selected company when assigning roles
    const { data: locations = [] } = useQuery<any[]>({
      queryKey: ["/api/locations", { companyId: selectedCompanyId }],
      queryFn: async () => {
        if (!selectedCompanyId) return [];
        const res = await fetch(`/api/locations?companyId=${selectedCompanyId}`);
        if (!res.ok) throw new Error("Failed to fetch locations");
        return res.json();
      },
      enabled: !!selectedCompanyId && isRoleDialogOpen,
    });
  
    // Load bank accounts (cash accounts) for the selected company
    const { data: bankAccounts = [] } = useQuery<any[]>({
      queryKey: ["/api/bank-accounts", { companyId: selectedCompanyId }],
      queryFn: async () => {
        if (!selectedCompanyId) return [];
        const res = await fetch(`/api/bank-accounts?companyId=${selectedCompanyId}`);
        if (!res.ok) throw new Error("Failed to fetch bank accounts");
        return res.json();
      },
      enabled: !!selectedCompanyId && isRoleDialogOpen,
    });
  
    // Load ledger accounts for the selected company (for role dialog)
    const { data: roleDialogLedgerAccounts = [] } = useQuery<any[]>({
      queryKey: ["/api/ledger-accounts", { companyId: selectedCompanyId }],
      queryFn: async () => {
        if (!selectedCompanyId) return [];
        const res = await fetch(`/api/ledger-accounts?companyId=${selectedCompanyId}`);
        if (!res.ok) throw new Error("Failed to fetch ledger accounts");
        return res.json();
      },
      enabled: !!selectedCompanyId && isRoleDialogOpen,
    });
  
    // Filter for Cash type ledger accounts only
    const cashAccounts = roleDialogLedgerAccounts.filter((account: any) => account.accountType === "Cash");
  
    const createCompanyMutation = useMutation({
      mutationFn: async (data: CompanyFormData) => {
        if (editingCompany) {
          const res = await modeApiRequest("PATCH", `/api/companies/${editingCompany.id}`, data);
          return await res.json();
        } else {
          const res = await modeApiRequest("POST", "/api/companies", data);
          return await res.json();
        }
      },
      onSuccess: () => {
        toast({
          title: "Success",
          description: editingCompany ? "Company updated successfully" : "Company created successfully",
        });
        queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
        setIsCompanyDialogOpen(false);
        setEditingCompany(null);
        companyForm.reset({
          name: "",
          code: "",
          companyType: "erp",
          baseCurrency: "USD",
          displayCurrency: "none",
          active: true,
        });
      },
      onError: (error: any) => {
        toast({
          title: "Error",
          description: error.message || "Failed to save company",
          variant: "destructive",
        });
      },
    });
  
    const deleteCompanyMutation = useMutation({
      mutationFn: async (companyId: number) => {
        const res = await modeApiRequest("DELETE", `/api/companies/${companyId}`);
        return await res.json();
      },
      onSuccess: () => {
        toast({
          title: "Success",
          description: "Company and all associated data deleted successfully",
        });
        queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
        queryClient.invalidateQueries({ queryKey: ["/api/user/companies"] });
        setCompanyToDelete(null);
      },
      onError: (error: any) => {
        toast({
          title: "Error",
          description: error.message || "Failed to delete company",
          variant: "destructive",
        });
      },
    });
  
    const createUserMutation = useMutation({
      mutationFn: async (data: UserFormData) => {
        if (editingUser) {
          const res = await modeApiRequest("PATCH", `/api/users/${editingUser.id}`, data);
          return await res.json();
        } else {
          const res = await modeApiRequest("POST", "/api/users", data);
          return await res.json();
        }
      },
      onSuccess: () => {
        toast({
          title: "Success",
          description: editingUser ? "User updated successfully" : "User created successfully",
        });
        queryClient.invalidateQueries({ queryKey: ["/api/users"] });
        setIsDialogOpen(false);
        setEditingUser(null);
        form.reset({
          username: "",
          password: "",
          active: true,
        });
      },
      onError: (error: any) => {
        toast({
          title: "Error",
          description: error.message || "Failed to save user",
          variant: "destructive",
        });
      },
    });

    const deleteUserMutation = useMutation({
      mutationFn: async (userId: string) => {
        const res = await modeApiRequest("DELETE", `/api/users/${userId}`);
        return await res.json();
      },
      onSuccess: () => {
        toast({
          title: "Success",
          description: "User deleted successfully",
        });
        queryClient.invalidateQueries({ queryKey: ["/api/users"] });
        setUserToDelete(null);
      },
      onError: (error: any) => {
        toast({
          title: "Error",
          description: error.message || "Failed to delete user",
          variant: "destructive",
        });
      },
    });

    const resetPasswordMutation = useMutation({
      mutationFn: async ({ userId, newPassword }: { userId: string; newPassword: string }) => {
        const res = await modeApiRequest("POST", `/api/admin/reset-password/${userId}`, { newPassword });
        return res.json();
      },
      onSuccess: (data) => {
        toast({
          title: "Success",
          description: data.message || "Password reset successfully",
        });
        setUserToResetPassword(null);
        setNewPasswordForReset("");
      },
      onError: (error: any) => {
        toast({
          title: "Error",
          description: error.message || "Failed to reset password",
          variant: "destructive",
        });
      },
    });

    const changePasswordMutation = useMutation({
      mutationFn: async ({ currentPassword, newPassword }: { currentPassword: string; newPassword: string }) => {
        const res = await modeApiRequest("POST", "/api/user/change-password", { currentPassword, newPassword });
        return res.json();
      },
      onSuccess: () => {
        toast({
          title: "Success",
          description: "Password changed successfully",
        });
        setIsChangePasswordOpen(false);
        setChangePasswordData({ currentPassword: "", newPassword: "", confirmPassword: "" });
      },
      onError: (error: any) => {
        toast({
          title: "Error",
          description: error.message || "Failed to change password",
          variant: "destructive",
        });
      },
    });
  
    const createRoleMutation = useMutation({
      mutationFn: async (data: RoleAssignmentData) => {
        let result;
        if (editingRole) {
          const res = await modeApiRequest("PATCH", `/api/user-company-roles/${editingRole.id}`, data);
          result = await res.json();
        } else {
          const res = await modeApiRequest("POST", "/api/user-company-roles", data);
          result = await res.json();
        }
        if (data.role?.startsWith("POS") && selectedLocationIds.length > 0) {
          await modeApiRequest("PUT", `/api/user-locations/${data.userId}/${data.companyId}`, {
            locationIds: selectedLocationIds,
          });
        }
        return result;
      },
      onSuccess: () => {
        const userId = currentUserId;
        
        toast({
          title: "Success",
          description: editingRole ? "Role updated successfully" : "Role assigned successfully",
        });
        queryClient.invalidateQueries({ queryKey: [`/api/users/${userId}/company-roles`] });
        setIsRoleDialogOpen(false);
        setEditingRole(null);
        setCurrentUserId(null);
        setSelectedLocationIds([]);
        roleForm.reset({
          userId: "",
          companyId: 0,
          role: "Manager",
        });
      },
      onError: (error: any) => {
        toast({
          title: "Error",
          description: error.message || "Failed to save role",
          variant: "destructive",
        });
      },
    });
  
    const deleteRoleMutation = useMutation({
      mutationFn: async (roleId: number) => {
        await modeApiRequest("DELETE", `/api/user-company-roles/${roleId}`, {});
      },
      onSuccess: () => {
        // Capture userId before it potentially changes
        const userId = currentUserId;
        
        toast({
          title: "Success",
          description: "Role assignment removed successfully",
        });
        queryClient.invalidateQueries({ queryKey: [`/api/users/${userId}/company-roles`] });
      },
      onError: (error: any) => {
        toast({
          title: "Error",
          description: error.message || "Failed to delete role",
          variant: "destructive",
        });
      },
    });

    const zeroBalancesMutation = useMutation({
      mutationFn: async (accountIds: number[]) => {
        const res = await modeApiRequest("POST", "/api/ledger-accounts/zero-balances", { accountIds });
        return await res.json();
      },
      onSuccess: (data) => {
        toast({
          title: "Success",
          description: `Opening balances zeroed for ${data.count} account(s)`,
        });
        queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts"] });
        setIsZeroBalanceDialogOpen(false);
        setSelectedAccountsToZero([]);
      },
      onError: (error: any) => {
        toast({
          title: "Error",
          description: error.message || "Failed to zero balances",
          variant: "destructive",
        });
      },
    });

    const initializeBalancesMutation = useMutation({
      mutationFn: async () => {
        const res = await modeApiRequest("POST", "/api/admin/initialize-accounting-balances", {});
        return await res.json();
      },
      onSuccess: (data) => {
        setInitBalancesResult(data);
        toast({
          title: "Success",
          description: data.message,
        });
        queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts"] });
        queryClient.invalidateQueries({ queryKey: ["/api/stats/import-cycle-balance"] });
      },
      onError: (error: any) => {
        console.error("Initialize balances error:", error);
        toast({
          title: "Error",
          description: error.message || "Failed to initialize balances",
          variant: "destructive",
        });
        // Reset the result so button shows again for retry
        setInitBalancesResult(null);
      },
    });

    const fixPOCreditsMutation = useMutation({
      mutationFn: async ({ companyId, parentCompanyId }: { companyId: number; parentCompanyId: number }) => {
        const res = await modeApiRequest("POST", "/api/fix-old-po-credits", { companyId, parentCompanyId });
        return await res.json();
      },
      onSuccess: (data) => {
        setFixPOCreditsResult(data);
        toast({
          title: "Success",
          description: data.message,
        });
        queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts"] });
        queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      },
      onError: (error: any) => {
        console.error("Fix PO credits error:", error);
        toast({
          title: "Error",
          description: error.message || "Failed to fix PO credits",
          variant: "destructive",
        });
        setFixPOCreditsResult(null);
      },
    });

    const fixParentPOSupplierMutation = useMutation({
      mutationFn: async () => {
        const res = await modeApiRequest("POST", "/api/fix-parent-po-supplier-entries", {});
        return await res.json();
      },
      onSuccess: (data) => {
        toast({
          title: "Success",
          description: data.message,
        });
        queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
        queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
        queryClient.invalidateQueries({ queryKey: ["/api/import-cycle-balance"] });
      },
      onError: (error: any) => {
        console.error("Fix parent PO supplier entries error:", error);
        toast({
          title: "Error",
          description: error.message || "Failed to fix supplier entries",
          variant: "destructive",
        });
      },
    });

    const resetCompanyDataMutation = useMutation({
      mutationFn: async (companyId: number) => {
        const res = await modeApiRequest("POST", "/api/admin/reset-company-data", { companyId });
        return await res.json();
      },
      onSuccess: (data) => {
        setResetDataResult(data);
        toast({
          title: "Reset Complete",
          description: data.message,
        });
        queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
        queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts"] });
        queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      },
      onError: (error: any) => {
        console.error("Reset company data error:", error);
        toast({
          title: "Error",
          description: error.message,
          variant: "destructive",
        });
      },
    });

    const reversePOCreditsMutation = useMutation({
      mutationFn: async ({ companyId, parentCompanyId }: { companyId: number; parentCompanyId: number }) => {
        const res = await modeApiRequest("POST", "/api/reverse-po-credits", { companyId, parentCompanyId });
        return await res.json();
      },
      onSuccess: (data) => {
        setReversePOCreditsResult(data);
        toast({
          title: "Success",
          description: data.message,
        });
        queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts"] });
        queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      },
      onError: (error: any) => {
        console.error("Reverse PO credits error:", error);
        toast({
          title: "Error",
          description: error.message || "Failed to reverse PO credits",
          variant: "destructive",
        });
        setReversePOCreditsResult(null);
      },
    });
  
    const updatePermissionMutation = useMutation({
      mutationFn: async ({ roleId, userId, companyId, data }: { roleId: number; userId: string; companyId: number; data: any }) => {
        const res = await modeApiRequest("PATCH", `/api/user-company-roles/${roleId}`, data);
        return await res.json();
      },
      onSuccess: async (_, variables) => {
        // Invalidate the user's company roles query
        queryClient.invalidateQueries({ queryKey: [`/api/users/${variables.userId}/company-roles`] });
        
        // Invalidate the aggregate permissions query so the permissions table updates
        queryClient.invalidateQueries({ queryKey: ["/api/user-company-roles"] });
        
        let isCurrentUser = false;
        
        // Check if we need to refresh current user's session
        const currentUserRes = await fetch("/api/auth/me");
        if (currentUserRes.ok) {
          const currentUser = await currentUserRes.json();
          isCurrentUser = currentUser.id === variables.userId;
          
          // If we just updated the current user's permissions for the current company, refresh the session
          if (isCurrentUser) {
            const currentCompanyRes = await fetch("/api/user/companies");
            if (currentCompanyRes.ok) {
              const userCompanies = await currentCompanyRes.json();
              const currentCompany = userCompanies.find((uc: any) => uc.companyId === variables.companyId);
              if (currentCompany) {
                // Refresh session by re-selecting the company
                await modeApiRequest("POST", "/api/auth/set-company", { companyId: variables.companyId });
                // Invalidate current user query to refresh UI
                queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
              }
            }
          }
        }
        
        toast({
          title: "Success",
          description: isCurrentUser 
            ? "Permission updated successfully"
            : "Permission updated successfully. The user will need to log out and log back in for this change to take effect.",
        });
      },
      onError: (error: any) => {
        toast({
          title: "Error",
          description: error.message || "Failed to update permission",
          variant: "destructive",
        });
      },
    });
  
    const handleEditCompany = (company: any) => {
      setEditingCompany(company);
      companyForm.reset({
        name: company.name,
        code: company.code,
        companyType: company.companyType || "erp",
        baseCurrency: company.baseCurrency || "USD",
        displayCurrency: company.displayCurrency || "none",
        active: company.active,
      });
      setIsCompanyDialogOpen(true);
    };
  
    const handleEdit = (user: any) => {
      setEditingUser(user);
      form.reset({
        username: user.username,
        password: "",
        active: user.active,
      });
      setIsDialogOpen(true);
    };
  
    const handleSubmitCompany = (data: CompanyFormData) => {
      createCompanyMutation.mutate(data);
    };
  
    const handleSubmit = (data: UserFormData) => {
      // If editing and password is empty, remove it from the update
      if (editingUser && !data.password) {
        const { password, ...dataWithoutPassword } = data;
        createUserMutation.mutate(dataWithoutPassword as UserFormData);
      } else {
        createUserMutation.mutate(data);
      }
    };
  
    const handleAddRole = (userId: string) => {
      setCurrentUserId(userId);
      setEditingRole(null);
      setSelectedLocationIds([]);
      roleForm.reset({
        userId,
        companyId: companies[0]?.id || 0,
        role: "Manager",
      });
      setIsRoleDialogOpen(true);
    };
  
    const handleEditRole = async (role: any) => {
      setCurrentUserId(role.userId);
      setEditingRole(role);
      roleForm.reset({
        userId: role.userId,
        companyId: role.companyId,
        role: role.role,
        assignedLocationId: role.assignedLocationId,
        posStation: role.posStation,
      });
      if (role.role?.startsWith("POS")) {
        try {
          const res = await fetch(`/api/user-locations/${role.userId}/${role.companyId}`);
          const locs = await res.json();
          setSelectedLocationIds(locs.map((l: any) => l.locationId));
        } catch {
          setSelectedLocationIds(role.assignedLocationId ? [role.assignedLocationId] : []);
        }
      } else {
        setSelectedLocationIds([]);
      }
      setIsRoleDialogOpen(true);
    };
  
    const handleSubmitRole = (data: RoleAssignmentData) => {
      createRoleMutation.mutate(data);
    };
  
    const handleDeleteRole = (roleId: number, userId: string) => {
      setCurrentUserId(userId);
      if (confirm("Are you sure you want to remove this role assignment?")) {
        deleteRoleMutation.mutate(roleId);
      }
    };
  
    const toggleUserExpansion = (userId: string) => {
      setExpandedUserId(expandedUserId === userId ? null : userId);
    };
  
    const handlePermissionToggle = (roleId: number, userId: string, companyId: number, field: string, value: boolean) => {
      updatePermissionMutation.mutate({
        roleId,
        userId,
        companyId,
        data: { [field]: value },
      });
    };

    const handleDaybookDaysChange = (roleId: number, userId: string, companyId: number, days: number) => {
      updatePermissionMutation.mutate({
        roleId,
        userId,
        companyId,
        data: { daybookEditDays: days },
      });
    };
  
    const isPOSRole = selectedRole?.startsWith("POS");
  
    const [activeSection, setActiveSection] = useState("companies");

    const sidebarGroups = [
      {
        label: "General",
        items: [
          { key: "companies", label: "Companies", icon: Building2 },
          { key: "preferences", label: "Preferences", icon: Settings2 },
          { key: "fiscal", label: "Fiscal Period", icon: CalendarRange },
          { key: "exchange-rates", label: "Exchange Rates", icon: TrendingUp },
        ],
      },
      {
        label: "Users & Access",
        items: [
          { key: "users", label: "Users", icon: Users },
          { key: "page-access", label: "Page Access", icon: Shield },
          { key: "active-users", label: "Active Users", icon: Eye },
          { key: "login-history", label: "Login History", icon: Clock },
        ],
      },
      {
        label: "Tools",
        items: [
          { key: "data-tools", label: "Data Tools", icon: Database },
          { key: "bulk-rename", label: "Bulk Rename", icon: Package },
          { key: "edit-log", label: "Edit Log", icon: History },
          { key: "files", label: "File Storage", icon: Upload },
        ],
      },
      {
        label: "POS",
        items: appMode !== "factory" ? [
          { key: "pos-settings", label: "POS Settings", icon: ShoppingCart },
        ] : [],
      },
      {
        label: "System",
        items: [
          { key: "system", label: "System Tools", icon: Wrench },
        ],
      },
    ];

    return (
      <div className="flex h-full">
        <nav className="w-56 shrink-0 border-r bg-muted/30 p-3 space-y-4 overflow-y-auto" data-testid="tabs-settings">
          {sidebarGroups.map((group) => (
            <div key={group.label}>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-1">{group.label}</p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeSection === item.key;
                  return (
                    <button
                      key={item.key}
                      onClick={() => setActiveSection(item.key)}
                      className={`flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-sm transition-colors ${isActive ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover-elevate"}`}
                      data-testid={`tab-${item.key}`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto p-6">

          {activeSection === "companies" && (
            <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              <h2 className="text-2xl font-semibold">Company Management</h2>
            </div>
            <Dialog open={isCompanyDialogOpen} onOpenChange={setIsCompanyDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  onClick={() => {
                    setEditingCompany(null);
                    companyForm.reset({
                      name: "",
                      code: "",
                      companyType: "erp",
                      active: true,
                    });
                  }}
                  data-testid="button-add-company"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Company
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>{editingCompany ? "Edit Company" : "Create New Company"}</DialogTitle>
                </DialogHeader>
                <Form {...companyForm}>
                  <form onSubmit={companyForm.handleSubmit(handleSubmitCompany)} className="space-y-4">
                    <FormField
                      control={companyForm.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Company Name *</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              placeholder="ABC Textiles Inc."
                              data-testid="input-company-name"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
  
                    <FormField
                      control={companyForm.control}
                      name="code"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Company Code *</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              placeholder="ABC"
                              data-testid="input-company-code"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
  
                    <FormField
                      control={companyForm.control}
                      name="companyType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Company Type</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value || "erp"}>
                            <FormControl>
                              <SelectTrigger data-testid="select-company-type">
                                <SelectValue placeholder="Select type" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="erp">Normal ERP</SelectItem>
                              <SelectItem value="factory">Factory Production</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={companyForm.control}
                        name="baseCurrency"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Base Currency</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value || "USD"}>
                              <FormControl>
                                <SelectTrigger data-testid="select-base-currency">
                                  <SelectValue placeholder="Select currency" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="USD">USD</SelectItem>
                                <SelectItem value="EUR">EUR</SelectItem>
                                <SelectItem value="GBP">GBP</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={companyForm.control}
                        name="displayCurrency"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Display Currency</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value || "none"}>
                              <FormControl>
                                <SelectTrigger data-testid="select-display-currency">
                                  <SelectValue placeholder="None (single currency)" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="none">None</SelectItem>
                                <SelectItem value="CFA">CFA</SelectItem>
                                <SelectItem value="EUR">EUR</SelectItem>
                                <SelectItem value="GBP">GBP</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={companyForm.control}
                      name="active"
                      render={({ field }) => (
                        <FormItem className="flex items-center gap-2 space-y-0">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              data-testid="checkbox-company-active"
                            />
                          </FormControl>
                          <FormLabel className="!mt-0">Active</FormLabel>
                        </FormItem>
                      )}
                    />
  
                    <div className="flex gap-2 justify-end border-t pt-4">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setIsCompanyDialogOpen(false);
                          setEditingCompany(null);
                        }}
                        disabled={createCompanyMutation.isPending}
                        data-testid="button-cancel-company"
                      >
                        Cancel
                      </Button>
                      <Button type="submit" disabled={createCompanyMutation.isPending} data-testid="button-save-company">
                        {createCompanyMutation.isPending ? "Saving..." : "Save"}
                      </Button>
                    </div>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>
  
          <Card className="p-6">
            {isLoadingCompanies ? (
              <p className="text-center text-muted-foreground">Loading companies...</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Company Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Parent Credit Account</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {companies.map((company: any) => (
                    <TableRow key={company.id}>
                      <TableCell className="font-medium" data-testid={`text-company-name-${company.id}`}>
                        {company.name}
                      </TableCell>
                      <TableCell data-testid={`text-company-type-${company.id}`}>
                        <Badge variant={company.companyType === "factory" ? "default" : "secondary"}>
                          {company.companyType === "factory" ? "Factory" : "ERP"}
                        </Badge>
                      </TableCell>
                      <TableCell data-testid={`text-company-status-${company.id}`}>
                        {company.active ? "Active" : "Inactive"}
                      </TableCell>
                      <TableCell>
                        <ParentCreditAccountSelect company={company} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-1 justify-end">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleEditCompany(company)}
                            data-testid={`button-edit-company-${company.id}`}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setCompanyToDelete(company)}
                            data-testid={`button-delete-company-${company.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
  
          <AlertDialog open={!!companyToDelete} onOpenChange={(open) => !open && setCompanyToDelete(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Company</AlertDialogTitle>
                <AlertDialogDescription className="space-y-2">
                  <p>
                    Are you sure you want to delete <strong>{companyToDelete?.name}</strong>?
                  </p>
                  <p className="text-destructive font-medium">
                    This will permanently delete ALL data associated with this company, including:
                  </p>
                  <ul className="list-disc list-inside text-sm space-y-1 ml-2">
                    <li>All locations and inventory</li>
                    <li>All ledger accounts and bank accounts</li>
                    <li>All vouchers and transactions</li>
                    <li>All purchase orders and containers</li>
                    <li>All employees and customers</li>
                    <li>All user role assignments for this company</li>
                  </ul>
                  <p className="font-bold text-destructive mt-2">
                    This action cannot be undone!
                  </p>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="button-cancel-delete-company">Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => companyToDelete && deleteCompanyMutation.mutate(companyToDelete.id)}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={deleteCompanyMutation.isPending}
                  data-testid="button-confirm-delete-company"
                >
                  {deleteCompanyMutation.isPending ? "Deleting..." : "Delete Company"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
          )}

          {/* User Delete Confirmation Dialog */}
          <AlertDialog open={!!userToDelete} onOpenChange={(open) => !open && setUserToDelete(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete User</AlertDialogTitle>
                <AlertDialogDescription className="space-y-2">
                  <p>
                    Are you sure you want to delete user <strong>{userToDelete?.username}</strong>?
                  </p>
                  <p className="text-destructive font-medium">
                    This will permanently delete the user and all their company role assignments.
                  </p>
                  <p className="font-bold text-destructive mt-2">
                    This action cannot be undone!
                  </p>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="button-cancel-delete-user">Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => userToDelete && deleteUserMutation.mutate(userToDelete.id)}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={deleteUserMutation.isPending}
                  data-testid="button-confirm-delete-user"
                >
                  {deleteUserMutation.isPending ? "Deleting..." : "Delete User"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Admin Reset Password Dialog */}
          <Dialog open={!!userToResetPassword} onOpenChange={(open) => {
            if (!open) {
              setUserToResetPassword(null);
              setNewPasswordForReset("");
            }
          }}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Reset Password for {userToResetPassword?.username}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Enter a new password for this user. They will be able to log in with this password immediately.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="reset-new-password">New Password</Label>
                  <Input
                    id="reset-new-password"
                    type="password"
                    value={newPasswordForReset}
                    onChange={(e) => setNewPasswordForReset(e.target.value)}
                    placeholder="Enter new password (min 4 characters)"
                    data-testid="input-reset-new-password"
                  />
                </div>
                <div className="flex gap-2 justify-end border-t pt-4">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setUserToResetPassword(null);
                      setNewPasswordForReset("");
                    }}
                    disabled={resetPasswordMutation.isPending}
                    data-testid="button-cancel-reset-password"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => {
                      if (newPasswordForReset.length < 4) {
                        toast({
                          title: "Error",
                          description: "Password must be at least 4 characters",
                          variant: "destructive",
                        });
                        return;
                      }
                      resetPasswordMutation.mutate({
                        userId: userToResetPassword.id,
                        newPassword: newPasswordForReset,
                      });
                    }}
                    disabled={resetPasswordMutation.isPending || newPasswordForReset.length < 4}
                    data-testid="button-submit-reset-password"
                  >
                    {resetPasswordMutation.isPending ? "Resetting..." : "Reset Password"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
  
          {/* Users Tab */}
          {activeSection === "users" && appMode === "factory" && (
            <div className="space-y-6">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h2 className="text-2xl font-semibold" data-testid="text-factory-users-title">User Management</h2>
                  <p className="text-muted-foreground mt-1">Create users and control which pages they can access</p>
                </div>
                <Button onClick={() => { resetFactoryUserForm(); setFactoryCreateOpen(true); }} data-testid="button-add-factory-user">
                  <Plus className="h-4 w-4 mr-2" />Add User
                </Button>
              </div>

              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <Users className="h-5 w-5 text-muted-foreground" />
                    <CardTitle className="text-lg">Users ({factoryUsersData.length})</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  {isLoadingFactoryUsers ? (
                    <p className="text-center text-muted-foreground py-8">Loading users...</p>
                  ) : factoryUsersData.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Username</TableHead>
                          <TableHead>Display Name</TableHead>
                          <TableHead>ERP Access</TableHead>
                          <TableHead>Factory Access</TableHead>
                          <TableHead>Pages</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="w-24">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {factoryUsersData.map((user: any) => (
                          <TableRow key={user.id} data-testid={`row-factory-user-${user.id}`}>
                            <TableCell className="font-medium font-mono">{user.username}</TableCell>
                            <TableCell className="text-muted-foreground">{user.displayName || "-"}</TableCell>
                            <TableCell>
                              <Switch
                                checked={isFactoryAdminOrOwner(user) ? true : (user.hasErpAccess ?? true)}
                                disabled={isFactoryAdminOrOwner(user) || toggleFactoryAccessMutation.isPending}
                                onCheckedChange={(checked) => toggleFactoryAccessMutation.mutate({ userId: user.id, data: { hasErpAccess: checked } })}
                                data-testid={`switch-erp-access-${user.id}`}
                              />
                            </TableCell>
                            <TableCell>
                              <Switch
                                checked={isFactoryAdminOrOwner(user) ? true : (user.hasFactoryAccess ?? true)}
                                disabled={isFactoryAdminOrOwner(user) || toggleFactoryAccessMutation.isPending}
                                onCheckedChange={(checked) => toggleFactoryAccessMutation.mutate({ userId: user.id, data: { hasFactoryAccess: checked } })}
                                data-testid={`switch-factory-access-${user.id}`}
                              />
                            </TableCell>
                            <TableCell>
                              {user.pageAccess.length > 0 ? (
                                <Badge variant="secondary">{user.pageAccess.length} pages</Badge>
                              ) : (
                                <span className="text-xs text-muted-foreground">Full access</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant={user.active ? "default" : "secondary"}>{user.active ? "Active" : "Inactive"}</Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <Button variant="ghost" size="icon" onClick={() => openFactoryUserEdit(user)} data-testid={`button-edit-user-${user.id}`}>
                                  <Edit className="h-4 w-4" />
                                </Button>
                                {!isFactoryAdminOrOwner(user) && (
                                  <Button variant="ghost" size="icon" onClick={() => setFactoryDeletingUser(user)} data-testid={`button-delete-user-${user.id}`} className="text-destructive">
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <Users className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p className="text-lg font-medium">No users configured</p>
                      <p className="text-sm mt-1">Add users and assign them specific page access</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Factory user create/edit dialog */}
              <Dialog open={factoryCreateOpen || !!factoryEditingUser} onOpenChange={(open) => { if (!open) { setFactoryCreateOpen(false); setFactoryEditingUser(null); resetFactoryUserForm(); } }}>
                <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <Shield className="h-5 w-5" />
                      {factoryEditingUser ? `Edit User: ${factoryEditingUser.username}` : "Add New User"}
                    </DialogTitle>
                    <DialogDescription>
                      {factoryEditingUser ? "Update display name, password, or page access" : "Create a new user and choose which factory pages they can see"}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-5">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>Username *</Label>
                        <Input value={factoryUserFormData.username} onChange={(e) => setFactoryUserFormData({ ...factoryUserFormData, username: e.target.value })} placeholder="Enter username" data-testid="input-factory-username" />
                        {factoryEditingUser && factoryUserFormData.username !== factoryEditingUser.username && (
                          <p className="text-xs text-muted-foreground mt-1">Username will be changed on save</p>
                        )}
                      </div>
                      <div>
                        <Label>{factoryEditingUser ? "New Password (leave blank to keep)" : "Password *"}</Label>
                        <Input type="password" value={factoryUserFormData.password} onChange={(e) => setFactoryUserFormData({ ...factoryUserFormData, password: e.target.value })} placeholder={factoryEditingUser ? "Leave blank to keep" : "Min 4 characters"} data-testid="input-factory-password" />
                      </div>
                    </div>
                    <div>
                      <Label>Display Name</Label>
                      <Input value={factoryUserFormData.displayName} onChange={(e) => setFactoryUserFormData({ ...factoryUserFormData, displayName: e.target.value })} placeholder="Name shown in the system" data-testid="input-factory-display-name" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex items-center justify-between rounded-md border p-3">
                        <Label className="cursor-pointer">ERP Access</Label>
                        <Switch checked={factoryEditingUser && isFactoryAdminOrOwner(factoryEditingUser) ? true : factoryUserFormData.hasErpAccess} disabled={!!factoryEditingUser && isFactoryAdminOrOwner(factoryEditingUser)} onCheckedChange={(v) => setFactoryUserFormData({ ...factoryUserFormData, hasErpAccess: v })} data-testid="switch-form-erp-access" />
                      </div>
                      <div className="flex items-center justify-between rounded-md border p-3">
                        <Label className="cursor-pointer">Factory Access</Label>
                        <Switch checked={factoryEditingUser && isFactoryAdminOrOwner(factoryEditingUser) ? true : factoryUserFormData.hasFactoryAccess} disabled={!!factoryEditingUser && isFactoryAdminOrOwner(factoryEditingUser)} onCheckedChange={(v) => setFactoryUserFormData({ ...factoryUserFormData, hasFactoryAccess: v })} data-testid="switch-form-factory-access" />
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <Label className="text-base font-semibold">Page Access</Label>
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={() => setFactoryUserPages(new Set(ALL_FACTORY_PAGES_SETTINGS.map(p => p.key)))} data-testid="button-select-all-pages"><Check className="h-3 w-3 mr-1" />All</Button>
                          <Button variant="outline" size="sm" onClick={() => setFactoryUserPages(new Set())} data-testid="button-select-none-pages"><X className="h-3 w-3 mr-1" />None</Button>
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground">Select which pages this user can see. If none selected, user gets full access.</p>
                      <div className="space-y-4 border rounded-md p-4 max-h-72 overflow-y-auto">
                        {FACTORY_PAGE_GROUPS_SETTINGS.map(group => {
                          const groupPages = ALL_FACTORY_PAGES_SETTINGS.filter(p => p.group === group);
                          const allSelected = groupPages.every(p => factoryUserPages.has(p.key));
                          const someSelected = groupPages.some(p => factoryUserPages.has(p.key));
                          return (
                            <div key={group} className="space-y-2">
                              <div className="flex items-center gap-2">
                                <Checkbox checked={allSelected} onCheckedChange={() => toggleFactoryUserGroup(group)} data-testid={`checkbox-group-${group.toLowerCase().replace(/\s+/g, '-')}`} />
                                <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{group}</span>
                                {someSelected && !allSelected && <Badge variant="secondary" className="text-xs">partial</Badge>}
                              </div>
                              <div className="ml-6 grid grid-cols-2 gap-1">
                                {groupPages.map(page => (
                                  <div key={page.key} className="flex items-center gap-2">
                                    <Checkbox checked={factoryUserPages.has(page.key)} onCheckedChange={() => toggleFactoryUserPage(page.key)} data-testid={`checkbox-page-${page.key.replace(/\//g, '-')}`} />
                                    <span className="text-sm">{page.label}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    {!(factoryEditingUser && isFactoryAdminOrOwner(factoryEditingUser)) && (
                      <div className="space-y-3">
                        <Label className="text-base font-semibold">Hidden Cost Fields</Label>
                        <p className="text-sm text-muted-foreground">Select which cost/price fields to hide from this user.</p>
                        <div className="space-y-2 border rounded-md p-4">
                          {FACTORY_COST_FIELDS.map(field => (
                            <div key={field.key} className="flex items-center gap-2">
                              <Checkbox checked={factoryUserHiddenCostFields.includes(field.key)} onCheckedChange={() => setFactoryUserHiddenCostFields(prev => prev.includes(field.key) ? prev.filter(k => k !== field.key) : [...prev, field.key])} data-testid={`checkbox-cost-${field.key}`} />
                              <span className="text-sm">{field.label}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <DialogFooter className="mt-6">
                    <Button variant="outline" onClick={() => { setFactoryCreateOpen(false); setFactoryEditingUser(null); resetFactoryUserForm(); }} disabled={createFactoryUserMutation.isPending || updateFactoryUserMutation.isPending}>Cancel</Button>
                    <Button onClick={handleFactoryUserSubmit} disabled={createFactoryUserMutation.isPending || updateFactoryUserMutation.isPending} data-testid="button-save-factory-user">
                      {(createFactoryUserMutation.isPending || updateFactoryUserMutation.isPending) ? "Saving..." : factoryEditingUser ? "Save Changes" : "Create User"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* Factory user delete confirm */}
              <Dialog open={!!factoryDeletingUser} onOpenChange={(open) => { if (!open) setFactoryDeletingUser(null); }}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Remove User</DialogTitle>
                    <DialogDescription>Remove <strong>{factoryDeletingUser?.username}</strong> from this company? Their account will be deactivated.</DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setFactoryDeletingUser(null)} disabled={deleteFactoryUserMutation.isPending}>Cancel</Button>
                    <Button variant="destructive" onClick={() => factoryDeletingUser && deleteFactoryUserMutation.mutate(factoryDeletingUser.id)} disabled={deleteFactoryUserMutation.isPending} data-testid="button-confirm-delete-factory-user">
                      {deleteFactoryUserMutation.isPending ? "Removing..." : "Remove User"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          )}

          {activeSection === "users" && appMode !== "factory" && (
            <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              <h2 className="text-2xl font-semibold">User Management</h2>
            </div>
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  onClick={() => {
                    setEditingUser(null);
                    form.reset({
                      username: "",
                      password: "",
                      active: true,
                    });
                  }}
                  data-testid="button-add-user"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add User
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>{editingUser ? "Edit User" : "Create New User"}</DialogTitle>
                </DialogHeader>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                    <FormField
                      control={form.control}
                      name="username"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Username *</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              placeholder="john.doe"
                              data-testid="input-username"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
  
                    <FormField
                      control={form.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            Password {!editingUser && "*"}
                            {editingUser && " (leave blank to keep current)"}
                          </FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              type="password"
                              placeholder={editingUser ? "Leave blank to keep current" : "Enter password"}
                              data-testid="input-password"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
  
                    <FormField
                      control={form.control}
                      name="active"
                      render={({ field }) => (
                        <FormItem className="flex items-center gap-2 space-y-0">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              data-testid="checkbox-active"
                            />
                          </FormControl>
                          <FormLabel className="!mt-0">Active</FormLabel>
                        </FormItem>
                      )}
                    />
  
                    <div className="flex gap-2 justify-end border-t pt-4">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setIsDialogOpen(false);
                          setEditingUser(null);
                        }}
                        disabled={createUserMutation.isPending}
                        data-testid="button-cancel"
                      >
                        Cancel
                      </Button>
                      <Button type="submit" disabled={createUserMutation.isPending} data-testid="button-save">
                        {createUserMutation.isPending ? "Saving..." : "Save"}
                      </Button>
                    </div>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>
  
          <Card className="p-6">
            {isLoading ? (
              <p className="text-center text-muted-foreground">Loading users...</p>
            ) : (
              <div className="space-y-2">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12"></TableHead>
                      <TableHead>Username</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Company Assignments</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((user: any) => (
                      <Fragment key={user.id}>
                        <TableRow>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleUserExpansion(user.id)}
                              data-testid={`button-expand-${user.id}`}
                            >
                              {expandedUserId === user.id ? (
                                <ChevronUp className="h-4 w-4" />
                              ) : (
                                <ChevronDown className="h-4 w-4" />
                              )}
                            </Button>
                          </TableCell>
                          <TableCell className="font-medium" data-testid={`text-username-${user.id}`}>
                            {user.username}
                          </TableCell>
                          <TableCell data-testid={`text-status-${user.id}`}>
                            {user.active ? "Active" : "Inactive"}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                toggleUserExpansion(user.id);
                              }}
                              data-testid={`button-view-roles-${user.id}`}
                            >
                              View Roles
                            </Button>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex gap-1 justify-end">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleEdit(user)}
                                data-testid={`button-edit-${user.id}`}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setUserToResetPassword(user)}
                                title="Reset Password"
                                data-testid={`button-reset-password-${user.id}`}
                              >
                                <Key className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setUserToDelete(user)}
                                data-testid={`button-delete-${user.id}`}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                        {expandedUserId === user.id && (
                          <TableRow>
                            <TableCell colSpan={5} className="bg-muted/50">
                              <div className="p-4 space-y-3">
                                <div className="flex items-center justify-between">
                                  <h4 className="font-medium">Company Role Assignments</h4>
                                  <Button
                                    size="sm"
                                    onClick={() => handleAddRole(user.id)}
                                    data-testid={`button-add-role-${user.id}`}
                                  >
                                    <Plus className="h-3 w-3 mr-1" />
                                    Add Role
                                  </Button>
                                </div>
                                {userCompanyRoles.length === 0 ? (
                                  <p className="text-sm text-muted-foreground">No company assignments yet</p>
                                ) : (
                                  <div className="space-y-2">
                                    {userCompanyRoles.map((role: any) => {
                                      const company = companies.find((c: any) => c.id === role.companyId);
                                      const location = locations.find((l: any) => l.id === role.assignedLocationId);
                                      return (
                                        <div
                                          key={role.id}
                                          className="p-3 bg-background rounded-md border space-y-3"
                                          data-testid={`role-assignment-${role.id}`}
                                        >
                                          <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                              <div>
                                                <div className="font-medium">{company?.name || "Unknown Company"}</div>
                                                <div className="text-sm text-muted-foreground">
                                                  <Badge variant="outline" className="mr-2">{role.role}</Badge>
                                                  {location && <span className="text-xs">Location: {location.name}</span>}
                                                  {role.posStation && <span className="text-xs ml-2">Station: {role.posStation}</span>}
                                                </div>
                                              </div>
                                            </div>
                                            <div className="flex gap-1">
                                              <Button
                                                size="sm"
                                                variant="ghost"
                                                onClick={() => handleEditRole(role)}
                                                data-testid={`button-edit-role-${role.id}`}
                                              >
                                                <Edit className="h-3 w-3" />
                                              </Button>
                                              <Button
                                                size="sm"
                                                variant="ghost"
                                                onClick={() => handleDeleteRole(role.id, user.id)}
                                                data-testid={`button-delete-role-${role.id}`}
                                              >
                                                <Trash2 className="h-3 w-3" />
                                              </Button>
                                            </div>
                                          </div>
                                          <div className="flex gap-6 pl-1">
                                            <div className="flex items-center gap-2">
                                              <Switch
                                                checked={["Admin", "Owner", "Manager"].includes(role.role) ? true : role.canSellNegativeStock}
                                                onCheckedChange={(checked) =>
                                                  handlePermissionToggle(role.id, user.id, role.companyId, "canSellNegativeStock", checked)
                                                }
                                                disabled={updatePermissionMutation.isPending || ["Admin", "Owner", "Manager"].includes(role.role)}
                                                data-testid={`toggle-can-sell-${role.id}`}
                                              />
                                              <Label className="text-sm cursor-pointer">Can Sell</Label>
                                            </div>
                                            <div className="flex items-center gap-2">
                                              <Switch
                                                checked={role.canAccessCustomers || false}
                                                onCheckedChange={(checked) =>
                                                  handlePermissionToggle(role.id, user.id, role.companyId, "canAccessCustomers", checked)
                                                }
                                                disabled={updatePermissionMutation.isPending}
                                                data-testid={`toggle-can-access-customers-${role.id}`}
                                              />
                                              <Label className="text-sm cursor-pointer">Customers</Label>
                                            </div>
                                            <div className="flex items-center gap-2">
                                              <Label className="text-sm">Edit Daybook:</Label>
                                              <Select
                                                value={String(role.daybookEditDays || 0)}
                                                onValueChange={(value) =>
                                                  handleDaybookDaysChange(role.id, user.id, role.companyId, parseInt(value))
                                                }
                                                disabled={updatePermissionMutation.isPending}
                                              >
                                                <SelectTrigger className="w-24" data-testid={`select-daybook-days-${role.id}`}>
                                                  <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                  <SelectItem value="0">None</SelectItem>
                                                  <SelectItem value="1">1 day</SelectItem>
                                                  <SelectItem value="2">2 days</SelectItem>
                                                  <SelectItem value="3">3 days</SelectItem>
                                                  <SelectItem value="5">5 days</SelectItem>
                                                  <SelectItem value="7">7 days</SelectItem>
                                                  <SelectItem value="10">10 days</SelectItem>
                                                </SelectContent>
                                              </Select>
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        </div>
          )}
  
  
          {/* Fiscal Period Tab */}
          {activeSection === "fiscal" && (
            <FiscalPeriodTab 
              currentCompanyId={selectedCompany?.id} 
              userRole={currentUser?.role} 
            />
          )}
  
          {/* Preferences Tab */}
          {activeSection === "preferences" && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Settings2 className="h-5 w-5" />
                <h2 className="text-2xl font-semibold">User Preferences</h2>
              </div>
  
              <Card className="p-6">
                <div className="space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="date-format" className="text-base font-medium">
                      Date Format
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Choose how dates are displayed throughout the application.
                    </p>
                    <Select
                      value={dateFormat}
                      onValueChange={(value: "MM/DD/YYYY" | "DD/MM/YYYY") => {
                        setDateFormat(value);
                        toast({
                          title: "Date format updated",
                          description: `Dates will now be displayed as ${value}`,
                        });
                      }}
                      disabled={isDateFormatPending}
                    >
                      <SelectTrigger id="date-format" className="w-64" data-testid="select-date-format">
                        <SelectValue placeholder="Select date format" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MM/DD/YYYY">MM/DD/YYYY (e.g., 12/31/2025)</SelectItem>
                        <SelectItem value="DD/MM/YYYY">DD/MM/YYYY (e.g., 31/12/2025)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </Card>

              <Card className="p-6">
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Lock className="h-5 w-5" />
                    <h3 className="text-lg font-medium">Change Password</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Update your account password. You will need to enter your current password.
                  </p>
                  <Button 
                    variant="outline" 
                    onClick={() => setIsChangePasswordOpen(true)}
                    data-testid="button-open-change-password"
                  >
                    <Key className="h-4 w-4 mr-2" />
                    Change Password
                  </Button>
                </div>
              </Card>
            </div>
          )}

          {/* Change Password Dialog */}
          <Dialog open={isChangePasswordOpen} onOpenChange={(open) => {
            setIsChangePasswordOpen(open);
            if (!open) setChangePasswordData({ currentPassword: "", newPassword: "", confirmPassword: "" });
          }}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Change Password</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="current-password">Current Password</Label>
                  <Input
                    id="current-password"
                    type="password"
                    value={changePasswordData.currentPassword}
                    onChange={(e) => setChangePasswordData(prev => ({ ...prev, currentPassword: e.target.value }))}
                    placeholder="Enter current password"
                    data-testid="input-current-password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-password">New Password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    value={changePasswordData.newPassword}
                    onChange={(e) => setChangePasswordData(prev => ({ ...prev, newPassword: e.target.value }))}
                    placeholder="Enter new password (min 4 characters)"
                    data-testid="input-new-password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm New Password</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    value={changePasswordData.confirmPassword}
                    onChange={(e) => setChangePasswordData(prev => ({ ...prev, confirmPassword: e.target.value }))}
                    placeholder="Confirm new password"
                    data-testid="input-confirm-password"
                  />
                </div>
                <div className="flex gap-2 justify-end border-t pt-4">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsChangePasswordOpen(false);
                      setChangePasswordData({ currentPassword: "", newPassword: "", confirmPassword: "" });
                    }}
                    disabled={changePasswordMutation.isPending}
                    data-testid="button-cancel-change-password"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => {
                      if (changePasswordData.newPassword !== changePasswordData.confirmPassword) {
                        toast({
                          title: "Error",
                          description: "New passwords do not match",
                          variant: "destructive",
                        });
                        return;
                      }
                      if (changePasswordData.newPassword.length < 4) {
                        toast({
                          title: "Error",
                          description: "New password must be at least 4 characters",
                          variant: "destructive",
                        });
                        return;
                      }
                      changePasswordMutation.mutate({
                        currentPassword: changePasswordData.currentPassword,
                        newPassword: changePasswordData.newPassword,
                      });
                    }}
                    disabled={changePasswordMutation.isPending || !changePasswordData.currentPassword || !changePasswordData.newPassword || !changePasswordData.confirmPassword}
                    data-testid="button-submit-change-password"
                  >
                    {changePasswordMutation.isPending ? "Changing..." : "Change Password"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
  
          {/* System Tab */}
          {activeSection === "system" && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Wrench className="h-5 w-5" />
                <h2 className="text-2xl font-semibold">System Tools</h2>
              </div>
  
              <div className="grid gap-4 md:grid-cols-2">
                <Link href="/deleted-items">
                  <Card className="p-6 hover-elevate cursor-pointer">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="p-3 bg-destructive/10 rounded-lg">
                          <Trash2 className="h-6 w-6 text-destructive" />
                        </div>
                        <div>
                          <h3 className="font-semibold" data-testid="link-deleted-items">Deleted Items</h3>
                          <p className="text-sm text-muted-foreground">
                            View and restore deleted records or permanently remove them
                          </p>
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    </div>
                  </Card>
                </Link>
  
                <Link href="/orphaned-records">
                  <Card className="p-6 hover-elevate cursor-pointer">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="p-3 bg-orange-500/10 rounded-lg">
                          <MapPin className="h-6 w-6 text-orange-500" />
                        </div>
                        <div>
                          <h3 className="font-semibold" data-testid="link-orphaned-records">Orphaned Records</h3>
                          <p className="text-sm text-muted-foreground">
                            Find and reassign records that reference deleted locations
                          </p>
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    </div>
                  </Card>
                </Link>
  
                <Link href="/chatbot-settings">
                  <Card className="p-6 hover-elevate cursor-pointer">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="p-3 bg-primary/10 rounded-lg">
                          <Bot className="h-6 w-6 text-primary" />
                        </div>
                        <div>
                          <h3 className="font-semibold" data-testid="link-chatbot-settings">AI Chatbot Settings</h3>
                          <p className="text-sm text-muted-foreground">
                            Manage AI assistant access and view conversation history
                          </p>
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    </div>
                  </Card>
                </Link>

                <Link href="/import-cycle-diagnostics">
                  <Card className="p-6 hover-elevate cursor-pointer">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="p-3 bg-yellow-500/10 rounded-lg">
                          <AlertTriangle className="h-6 w-6 text-yellow-500" />
                        </div>
                        <div>
                          <h3 className="font-semibold" data-testid="link-import-diagnostics">Import Cycle Diagnostics</h3>
                          <p className="text-sm text-muted-foreground">
                            Detect and diagnose issues causing import cycle imbalance
                          </p>
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    </div>
                  </Card>
                </Link>

                <Link href="/net-profit-details">
                  <Card className="p-6 hover-elevate cursor-pointer">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="p-3 bg-purple-500/10 rounded-lg">
                          <PieChart className="h-6 w-6 text-purple-500" />
                        </div>
                        <div>
                          <h3 className="font-semibold" data-testid="link-net-profit-details">Net Profit Details</h3>
                          <p className="text-sm text-muted-foreground">
                            View detailed breakdown of income, expenses, and net position
                          </p>
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    </div>
                  </Card>
                </Link>


                <Link href="/company-data-reset">
                  <Card className="p-6 hover-elevate cursor-pointer">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="p-3 bg-red-500/10 rounded-lg">
                          <Trash2 className="h-6 w-6 text-red-500" />
                        </div>
                        <div>
                          <h3 className="font-semibold" data-testid="link-company-data-reset">Company Data Reset</h3>
                          <p className="text-sm text-muted-foreground">
                            Clear vouchers and opening balances for selected accounts
                          </p>
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    </div>
                  </Card>
                </Link>
                <Card className="p-6">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-green-500/10 rounded-lg">
                        <Calculator className="h-6 w-6 text-green-500" />
                      </div>
                      <div>
                        <h3 className="font-semibold" data-testid="text-init-balances-title">Initialize Accounting Balances</h3>
                        <p className="text-sm text-muted-foreground">
                          Create Owner's Capital accounts to balance the Import Cycle for all companies
                        </p>
                      </div>
                    </div>
                    <Button
                      onClick={() => {
                        setInitBalancesResult(null);
                        setIsInitBalancesDialogOpen(true);
                      }}
                      disabled={initializeBalancesMutation.isPending}
                      data-testid="button-init-accounting"
                    >
                      {initializeBalancesMutation.isPending ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processing...</>
                      ) : (
                        "Initialize"
                      )}
                    </Button>
                  </div>
                </Card>

                <Card className="p-6">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-blue-500/10 rounded-lg">
                        <RefreshCw className="h-6 w-6 text-blue-500" />
                      </div>
                      <div>
                        <h3 className="font-semibold" data-testid="text-fix-po-credits-title">Fix Old PO Inter-Company Credits</h3>
                        <p className="text-sm text-muted-foreground">
                          Create "Lubumbashi Credit" entries for old POs that were imported before this feature existed
                        </p>
                      </div>
                    </div>
                    <Button
                      onClick={() => {
                        setFixPOCreditsResult(null);
                        setIsFixPOCreditsDialogOpen(true);
                      }}
                      disabled={fixPOCreditsMutation.isPending}
                      data-testid="button-fix-po-credits"
                    >
                      {fixPOCreditsMutation.isPending ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processing...</>
                      ) : (
                        "Fix Credits"
                      )}
                    </Button>
                  </div>
                </Card>

                <Card className="p-6">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-orange-500/10 rounded-lg">
                        <RefreshCw className="h-6 w-6 text-orange-500" />
                      </div>
                      <div>
                        <h3 className="font-semibold" data-testid="text-fix-parent-po-title">Fix Parent Company PO Supplier Entries</h3>
                        <p className="text-sm text-muted-foreground">
                          Add missing supplier entries to POs imported directly to the parent company
                        </p>
                      </div>
                    </div>
                    <Button
                      onClick={() => fixParentPOSupplierMutation.mutate()}
                      disabled={fixParentPOSupplierMutation.isPending}
                      data-testid="button-fix-parent-po-supplier"
                    >
                      {fixParentPOSupplierMutation.isPending ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processing...</>
                      ) : (
                        "Fix Supplier Entries"
                      )}
                    </Button>
                  </div>
                </Card>

                <Card className="p-6">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-teal-500/10 rounded-lg">
                        <RefreshCw className="h-6 w-6 text-teal-500" />
                      </div>
                      <div>
                        <h3 className="font-semibold" data-testid="text-fix-sales-inventory-title">Fix Sales Inventory</h3>
                        <p className="text-sm text-muted-foreground">
                          Clean up orphaned negative inventory from POS sales edited with wrong locations
                        </p>
                      </div>
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button data-testid="button-fix-sales-inventory">
                          Fix Inventory
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Fix Sales Inventory</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will find and reset orphaned negative inventory records that were caused by editing POS sales with incorrect locations. Are you sure you want to proceed?
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={async () => {
                              try {
                                const response = await fetch("/api/admin/fix-sales-inventory", {
                                  method: "POST",
                                  credentials: "include",
                                });
                                const result = await response.json();
                                if (response.ok) {
                                  toast({
                                    title: "Inventory Fixed",
                                    description: `Fixed ${result.cleaned?.length || 0} orphaned records. ${result.negativeInventoryFound || 0} negative inventory items found total.`,
                                  });
                                  // Invalidate inventory queries
                                  queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
                                } else {
                                  toast({
                                    title: "Error",
                                    description: result.message,
                                    variant: "destructive",
                                  });
                                }
                              } catch (error: any) {
                                toast({
                                  title: "Error",
                                  description: error.message,
                                  variant: "destructive",
                                });
                              }
                            }}
                          >
                            Fix Inventory
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </Card>

                                <Card className="p-6">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-orange-500/10 rounded-lg">
                        <Trash2 className="h-6 w-6 text-orange-500" />
                      </div>
                      <div>
                        <h3 className="font-semibold" data-testid="text-reset-company-title">Reset Company Data</h3>
                        <p className="text-sm text-muted-foreground">
                          Delete Payment/Receipt/Journal vouchers for a company (keeps POS, inventory, containers, POs)
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="destructive"
                      onClick={() => {
                        setResetDataResult(null);
                        setSelectedCompanyForReset("");
                        setIsResetDataDialogOpen(true);
                      }}
                      disabled={resetCompanyDataMutation.isPending}
                      data-testid="button-reset-company-data"
                    >
                      {resetCompanyDataMutation.isPending ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Resetting...</>
                      ) : (
                        "Reset Data"
                      )}
                    </Button>
                  </div>
                </Card>

                <Card className="p-6">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-red-500/10 rounded-lg">
                        <Calculator className="h-6 w-6 text-red-500" />
                      </div>
                      <div>
                        <h3 className="font-semibold" data-testid="text-zero-balances-title">Zero Account Balances</h3>
                        <p className="text-sm text-muted-foreground">
                          Reset opening balances to zero for selected accounts (fresh start for new period)
                        </p>
                      </div>
                    </div>
                    <Button
                      onClick={() => {
                        setSelectedAccountsToZero([]);
                        setIsZeroBalanceDialogOpen(true);
                      }}
                      disabled={!selectedCompany}
                      data-testid="button-zero-balances"
                    >
                      Zero Balances
                    </Button>
                  </div>
                </Card>

                <Card className="p-6">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-cyan-500/10 rounded-lg">
                        <Trash2 className="h-6 w-6 text-cyan-500" />
                      </div>
                      <div>
                        <h3 className="font-semibold" data-testid="text-fix-orphaned-pos-title">Fix Orphaned POS Data</h3>
                        <p className="text-sm text-muted-foreground">
                          Clean up orphaned sales items and voucher entries that may cause Import Cycle imbalance
                        </p>
                      </div>
                    </div>
                    <Button
                      onClick={async () => {
                        try {
                          const response = await fetch("/api/admin/fix-orphaned-pos-data", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            credentials: "include",
                          });
                          const result = await response.json();
                          if (response.ok) {
                            toast({
                              title: "Cleanup Complete",
                              description: result.message,
                            });
                          } else {
                            toast({
                              title: "Error",
                              description: result.message,
                              variant: "destructive",
                            });
                          }
                        } catch (error: any) {
                          toast({
                            title: "Error",
                            description: error.message,
                            variant: "destructive",
                          });
                        }
                      }}
                      data-testid="button-fix-orphaned-pos"
                    >
                      Fix Orphaned
                    </Button>
                  </div>
                </Card>

                <Card className="p-6">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-purple-500/10 rounded-lg">
                        <RefreshCw className="h-6 w-6 text-purple-500" />
                      </div>
                      <div>
                        <h3 className="font-semibold" data-testid="text-recalc-equity-title">Recalculate Equity Adjustment</h3>
                        <p className="text-sm text-muted-foreground">
                          Zero out the Import Cycle Balance by adjusting the opening balance equity offset
                        </p>
                      </div>
                    </div>
                    <Button
                      onClick={async () => {
                        try {
                          // First fetch the current import cycle balance
                          const balanceRes = await fetch("/api/stats/import-cycle-balance", {
                            credentials: "include",
                          });
                          if (!balanceRes.ok) {
                            throw new Error("Failed to fetch current balance");
                          }
                          const balanceData = await balanceRes.json();
                          const currentBalance = balanceData.netImportCycleBalance;

                          // Now recalculate with that balance
                          const response = await fetch("/api/admin/recalculate-equity-adjustment", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            credentials: "include",
                            body: JSON.stringify({ currentBalance }),
                          });
                          const result = await response.json();
                          if (response.ok) {
                            toast({
                              title: "Equity Adjusted",
                              description: result.message,
                            });
                            // Refresh dashboard stats
                            queryClient.invalidateQueries({ queryKey: ["/api/stats/import-cycle-balance"] });
                          } else {
                            toast({
                              title: "Error",
                              description: result.message,
                              variant: "destructive",
                            });
                          }
                        } catch (error: any) {
                          toast({
                            title: "Error",
                            description: error.message,
                            variant: "destructive",
                          });
                        }
                      }}
                      data-testid="button-recalc-equity"
                    >
                      Recalculate
                    </Button>
                  </div>
                </Card>

                <Card className="p-6">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-4">
                        <div className="p-3 bg-amber-500/10 rounded-lg">
                          <AlertTriangle className="h-6 w-6 text-amber-500" />
                        </div>
                        <div>
                          <h3 className="font-semibold" data-testid="text-fix-orphaned-charges-title">Fix Orphaned Charge Vouchers</h3>
                          <p className="text-sm text-muted-foreground">
                            Delete charge vouchers (DUTY, TRANS, etc.) that shouldn't exist for OTW containers
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          onClick={async () => {
                            try {
                              setOrphanedChargesDiagnostic(null);
                              const response = await fetch("/api/debug/orphaned-charge-vouchers", {
                                method: "GET",
                                credentials: "include",
                              });
                              const result = await response.json();
                              if (response.ok) {
                                setOrphanedChargesDiagnostic({
                                  count: result.orphanedVoucherCount,
                                  impact: result.totalImpact,
                                  vouchers: result.orphanedVouchers || [],
                                });
                                if (result.orphanedVoucherCount === 0) {
                                  toast({
                                    title: "No Orphaned Vouchers",
                                    description: "All OTW containers have no leftover charge vouchers.",
                                  });
                                }
                              } else {
                                toast({
                                  title: "Error",
                                  description: result.message,
                                  variant: "destructive",
                                });
                              }
                            } catch (error: any) {
                              toast({
                                title: "Error",
                                description: error.message,
                                variant: "destructive",
                              });
                            }
                          }}
                          data-testid="button-diagnose-orphaned-charges"
                        >
                          Diagnose
                        </Button>
                        <Button
                          variant="destructive"
                          disabled={!orphanedChargesDiagnostic || orphanedChargesDiagnostic.count === 0 || isFixingOrphanedCharges}
                          onClick={async () => {
                            if (!orphanedChargesDiagnostic || orphanedChargesDiagnostic.count === 0) return;
                            if (!confirm(`Delete ${orphanedChargesDiagnostic.count} orphaned vouchers with impact of $${orphanedChargesDiagnostic.impact.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}? This cannot be undone.`)) {
                              return;
                            }
                            try {
                              setIsFixingOrphanedCharges(true);
                              const response = await fetch("/api/admin/fix-orphaned-charge-vouchers", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                credentials: "include",
                              });
                              const result = await response.json();
                              if (response.ok) {
                                toast({
                                  title: "Cleanup Complete",
                                  description: result.message,
                                });
                                setOrphanedChargesDiagnostic(null);
                                queryClient.invalidateQueries({ queryKey: ["/api/stats/import-cycle-balance"] });
                              } else {
                                toast({
                                  title: "Error",
                                  description: result.message,
                                  variant: "destructive",
                                });
                              }
                            } catch (error: any) {
                              toast({
                                title: "Error",
                                description: error.message,
                                variant: "destructive",
                              });
                            } finally {
                              setIsFixingOrphanedCharges(false);
                            }
                          }}
                          data-testid="button-fix-orphaned-charges"
                        >
                          {isFixingOrphanedCharges ? "Deleting..." : "Delete Orphaned"}
                        </Button>
                      </div>
                    </div>
                    {orphanedChargesDiagnostic && orphanedChargesDiagnostic.count > 0 && (
                      <div className="bg-destructive/10 p-4 rounded-lg space-y-2">
                        <p className="font-medium text-destructive">
                          Found {orphanedChargesDiagnostic.count} orphaned vouchers (Impact: ${orphanedChargesDiagnostic.impact.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })})
                        </p>
                        <div className="max-h-32 overflow-y-auto text-sm">
                          {orphanedChargesDiagnostic.vouchers.map((v: any, i: number) => (
                            <div key={i} className="flex justify-between text-muted-foreground py-1 border-b last:border-0">
                              <span>{v.voucherNumber}</span>
                              <span>Container: {v.containerNumber}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </Card>

                <Card className="p-6">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-4">
                        <div className="p-3 bg-red-500/10 rounded-lg">
                          <Trash2 className="h-6 w-6 text-red-500" />
                        </div>
                        <div>
                          <h3 className="font-semibold" data-testid="text-orphaned-pos-sales-title">Orphaned POS Sales at Deleted Locations</h3>
                          <p className="text-sm text-muted-foreground">
                            Find and delete POS sale vouchers linked to deleted locations
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          disabled={isLoadingOrphanedPosSales}
                          onClick={async () => {
                            try {
                              setIsLoadingOrphanedPosSales(true);
                              const response = await fetch("/api/admin/orphaned-pos-sales", {
                                method: "GET",
                                credentials: "include",
                              });
                              const result = await response.json();
                              if (response.ok) {
                                setOrphanedPosSalesDiagnostic({
                                  count: result.count,
                                  totalImpact: result.totalImpact,
                                  vouchers: result.vouchers || [],
                                });
                                if (result.count === 0) {
                                  toast({
                                    title: "No Orphaned Sales Found",
                                    description: "All POS sales are linked to valid locations.",
                                  });
                                }
                              } else {
                                toast({
                                  title: "Error",
                                  description: result.message,
                                  variant: "destructive",
                                });
                              }
                            } catch (error: any) {
                              toast({
                                title: "Error",
                                description: error.message,
                                variant: "destructive",
                              });
                            } finally {
                              setIsLoadingOrphanedPosSales(false);
                            }
                          }}
                          data-testid="button-diagnose-orphaned-pos-sales"
                        >
                          {isLoadingOrphanedPosSales ? "Checking..." : "Diagnose"}
                        </Button>
                        <Button
                          variant="destructive"
                          disabled={!orphanedPosSalesDiagnostic || orphanedPosSalesDiagnostic.count === 0 || isFixingOrphanedPosSales}
                          onClick={async () => {
                            if (!orphanedPosSalesDiagnostic || orphanedPosSalesDiagnostic.count === 0) return;
                            if (!confirm(`Delete ${orphanedPosSalesDiagnostic.count} orphaned POS vouchers with impact of $${orphanedPosSalesDiagnostic.totalImpact.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}? This cannot be undone.`)) {
                              return;
                            }
                            try {
                              setIsFixingOrphanedPosSales(true);
                              const response = await fetch("/api/admin/delete-orphaned-pos-sales", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                credentials: "include",
                              });
                              const result = await response.json();
                              if (response.ok) {
                                toast({
                                  title: "Cleanup Complete",
                                  description: result.message,
                                });
                                setOrphanedPosSalesDiagnostic(null);
                              } else {
                                toast({
                                  title: "Error",
                                  description: result.message,
                                  variant: "destructive",
                                });
                              }
                            } catch (error: any) {
                              toast({
                                title: "Error",
                                description: error.message,
                                variant: "destructive",
                              });
                            } finally {
                              setIsFixingOrphanedPosSales(false);
                            }
                          }}
                          data-testid="button-delete-orphaned-pos-sales"
                        >
                          {isFixingOrphanedPosSales ? "Deleting..." : "Delete Orphaned"}
                        </Button>
                      </div>
                    </div>
                    {orphanedPosSalesDiagnostic && orphanedPosSalesDiagnostic.count > 0 && (
                      <div className="bg-destructive/10 p-4 rounded-lg space-y-2">
                        <p className="font-medium text-destructive">
                          Found {orphanedPosSalesDiagnostic.count} orphaned POS vouchers (Impact: ${orphanedPosSalesDiagnostic.totalImpact.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })})
                        </p>
                        <div className="max-h-32 overflow-y-auto text-sm">
                          {orphanedPosSalesDiagnostic.vouchers.slice(0, 20).map((v: any, i: number) => (
                            <div key={i} className="flex justify-between text-muted-foreground py-1 border-b last:border-0">
                              <span>{v.voucherNumber}</span>
                              <span>Location ID: {v.locationId} (deleted)</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </Card>

                <Card className="p-6 md:col-span-2">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <div className="flex items-center gap-4">
                        <div className="p-3 bg-blue-500/10 rounded-lg">
                          <Package className="h-6 w-6 text-blue-500" />
                        </div>
                        <div>
                          <h3 className="font-semibold" data-testid="text-container-offload-analysis">Container Offload Analysis</h3>
                          <p className="text-sm text-muted-foreground">
                            Analyze PO line items for a container to detect duplicates, blank quantities, and other issues
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Select
                          value={selectedContainerForDiag}
                          onValueChange={setSelectedContainerForDiag}
                        >
                          <SelectTrigger className="w-[200px]" data-testid="select-container-for-diag">
                            <SelectValue placeholder="Select container" />
                          </SelectTrigger>
                          <SelectContent>
                            {containersForDiag.map((c: any) => (
                              <SelectItem key={c.id} value={c.id.toString()}>
                                {c.containerNumber} ({c.status})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          variant="outline"
                          disabled={!selectedContainerForDiag || isLoadingContainerDiag}
                          onClick={async () => {
                            if (!selectedContainerForDiag) return;
                            try {
                              setIsLoadingContainerDiag(true);
                              setContainerDiagResult(null);
                              const response = await fetch(`/api/containers/${selectedContainerForDiag}/offload-diagnostics`, {
                                method: "GET",
                                credentials: "include",
                              });
                              const result = await response.json();
                              if (response.ok) {
                                setContainerDiagResult(result);
                                if (!result.hasIssues) {
                                  toast({
                                    title: "No Issues Found",
                                    description: `Container ${result.containerNumber} has ${result.lineItemCount} valid line items, total ${result.totalQuantity} bales.`,
                                  });
                                }
                              } else {
                                toast({
                                  title: "Error",
                                  description: result.message,
                                  variant: "destructive",
                                });
                              }
                            } catch (error: any) {
                              toast({
                                title: "Error",
                                description: error.message,
                                variant: "destructive",
                              });
                            } finally {
                              setIsLoadingContainerDiag(false);
                            }
                          }}
                          data-testid="button-analyze-container"
                        >
                          {isLoadingContainerDiag ? "Analyzing..." : "Analyze"}
                        </Button>
                      </div>
                    </div>
                    {containerDiagResult && (
                      <div className={`p-4 rounded-lg space-y-3 ${containerDiagResult.hasIssues ? 'bg-destructive/10' : 'bg-green-500/10'}`}>
                        <div className="flex items-center justify-between">
                          <p className={`font-medium ${containerDiagResult.hasIssues ? 'text-destructive' : 'text-green-600'}`}>
                            {containerDiagResult.containerNumber} ({containerDiagResult.containerStatus})
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {containerDiagResult.poCount} POs, {containerDiagResult.lineItemCount} line items
                          </p>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div>
                            <p className="text-muted-foreground">Total Quantity</p>
                            <p className="font-semibold">{containerDiagResult.totalQuantity} bales</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Valid Items</p>
                            <p className="font-semibold text-green-600">{containerDiagResult.summary?.valid || 0}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Invalid Items</p>
                            <p className={`font-semibold ${containerDiagResult.summary?.invalid > 0 ? 'text-destructive' : ''}`}>
                              {containerDiagResult.summary?.invalid || 0}
                            </p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Duplicates</p>
                            <p className={`font-semibold ${containerDiagResult.duplicateCount > 0 ? 'text-destructive' : ''}`}>
                              {containerDiagResult.duplicateCount}
                            </p>
                          </div>
                        </div>
                        {containerDiagResult.hasIssues && (
                          <div className="space-y-2">
                            <p className="text-sm font-medium text-destructive">Issues Found:</p>
                            <div className="max-h-48 overflow-y-auto text-sm space-y-1">
                              {containerDiagResult.lineItems
                                .filter((item: any) => !item.isValid)
                                .map((item: any, i: number) => (
                                  <div key={i} className="flex justify-between gap-2 py-1 border-b last:border-0">
                                    <span className="truncate">
                                      {item.poNumber} - {item.stockItemCode || 'No stock item'} (Qty: {item.quantity})
                                    </span>
                                    <span className="text-destructive whitespace-nowrap">
                                      {item.issues.join(', ')}
                                    </span>
                                  </div>
                                ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </Card>

                <Card className="p-6 md:col-span-2">
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-purple-500/10 rounded-lg">
                        <Building2 className="h-6 w-6 text-purple-500" />
                      </div>
                      <div>
                        <h3 className="font-semibold" data-testid="text-parent-company-title">Parent Company for Net Position</h3>
                        <p className="text-sm text-muted-foreground">
                          Set which company is the parent for supplier balance reporting. Suppliers are only counted in the parent company's Net Position.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Select
                        value={parentCompanyData?.parentCompanyId?.toString() || "none"}
                        onValueChange={(value) => {
                          const companyId = value === "none" ? null : parseInt(value, 10);
                          setParentCompanyMutation.mutate(companyId);
                        }}
                        disabled={setParentCompanyMutation.isPending || currentUser?.role !== "Admin"}
                      >
                        <SelectTrigger className="w-[200px]" data-testid="select-parent-company">
                          <SelectValue placeholder="Select parent company" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Not Set</SelectItem>
                          {companies.map((company: any) => (
                            <SelectItem key={company.id} value={company.id.toString()}>
                              {company.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {currentUser?.role !== "Admin" && (
                        <span className="text-xs text-muted-foreground">(Admin only)</span>
                      )}
                    </div>
                  </div>
                </Card>

                <NetPositionAdjustmentCard />
              </div>
            </div>
          )}

          {/* Active Users Tab */}
          {activeSection === "active-users" && (
            <ActiveUsersSection />
          )}

          {activeSection === "login-history" && <LoginHistoryTab />}

          {/* Page Access Tab */}
          {activeSection === "page-access" && (
            <PageAccessSection
              users={users}
              companies={companies}
              selectedCompany={selectedCompany}
              featureLabels={featureLabels}
              toast={toast}
            />
          )}

          {activeSection === "edit-log" && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <History className="h-5 w-5" />
                <h2 className="text-2xl font-semibold">Edit Log</h2>
              </div>
              <p className="text-muted-foreground">
                Track all changes made to records across the system with before/after values.
              </p>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    Recent Changes
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <EditLogTable companyId={selectedCompany?.id} />
                </CardContent>
              </Card>
            </div>
          )}

          {activeSection === "data-tools" && (
            <DataToolsTab />
          )}
          {activeSection === "exchange-rates" && (
            <ExchangeRateSettings />
          )}
          {activeSection === "bulk-rename" && (
            <BulkRenameTab />
          )}
          {activeSection === "pos-settings" && (
            <PosSettingsTab />
          )}
          {activeSection === "files" && (
            <FileStorageTab />
          )}
        </div>

        {/* Initialize Accounting Balances Dialog */}
        <AlertDialog open={isInitBalancesDialogOpen} onOpenChange={setIsInitBalancesDialogOpen}>
          <AlertDialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
            <AlertDialogHeader>
              <AlertDialogTitle>Initialize Accounting Balances</AlertDialogTitle>
              <AlertDialogDescription asChild>
                {!initBalancesResult ? (
                  <p>This will create Owner's Capital accounts for each company to balance the Import Cycle. This action cannot be easily undone.</p>
                ) : (
                  <div className="space-y-4 mt-4">
                    <div className="text-foreground font-medium">{initBalancesResult.message}</div>
                    {initBalancesResult.results?.map((r: any) => (
                      <div key={r.companyId} className="p-3 border rounded-md space-y-2">
                        <div className="font-medium">{r.companyName}</div>
                        <div className="text-sm">Imbalance: ${formatNumber(r.imbalance || 0)}</div>
                        <div className="text-sm">{r.message}</div>
                        
                        {r.components && (
                          <div className="text-sm mt-3 border-t pt-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="w-full justify-between"
                              onClick={() => setExpandedBreakdownId(expandedBreakdownId === r.companyId ? null : r.companyId)}
                              data-testid={`button-expand-breakdown-${r.companyId}`}
                            >
                              <span>View Calculation Breakdown</span>
                              {expandedBreakdownId === r.companyId ? (
                                <ChevronUp className="h-4 w-4 ml-2" />
                              ) : (
                                <ChevronDown className="h-4 w-4 ml-2" />
                              )}
                            </Button>
                            {expandedBreakdownId === r.companyId && (
                              <>
                                <div className="mt-2 grid grid-cols-2 gap-4 p-2 bg-muted/50 rounded">
                                  <div>
                                    <div className="font-medium text-green-600 dark:text-green-400 mb-1">Assets (Debit)</div>
                                    {r.components.assets?.map((c: any, i: number) => (
                                      <div key={i} className="flex justify-between">
                                        <span>{c.name}</span>
                                        <span>${formatNumber(c.value)}</span>
                                      </div>
                                    ))}
                                    <div className="border-t mt-1 pt-1 font-medium flex justify-between">
                                      <span>Total Assets</span>
                                      <span>${formatNumber(r.components.totalAssets || 0)}</span>
                                    </div>
                                  </div>
                                  <div>
                                    <div className="font-medium text-red-600 dark:text-red-400 mb-1">Liabilities (Credit)</div>
                                    {r.components.liabilities?.map((c: any, i: number) => (
                                      <div key={i} className="flex justify-between">
                                        <span>{c.name}</span>
                                        <span>${formatNumber(c.value)}</span>
                                      </div>
                                    ))}
                                    <div className="border-t mt-1 pt-1 font-medium flex justify-between">
                                      <span>Total Liabilities</span>
                                      <span>${formatNumber(r.components.totalLiabilities || 0)}</span>
                                    </div>
                                  </div>
                                </div>
                                <div className="mt-2 p-2 bg-muted rounded text-center font-medium">
                                  Net Imbalance = ${formatNumber(r.components.totalAssets || 0)} - ${formatNumber(r.components.totalLiabilities || 0)} = ${formatNumber(r.imbalance || 0)}
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                    {initBalancesResult.sqlForProduction && (
                      <div className="mt-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="font-medium">SQL for Production (Copy to Render):</div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              navigator.clipboard.writeText(initBalancesResult.sqlForProduction);
                              toast({
                                title: "Copied",
                                description: "SQL copied to clipboard",
                              });
                            }}
                            data-testid="button-copy-sql"
                          >
                            Copy SQL
                          </Button>
                        </div>
                        <pre className="p-3 bg-muted rounded-md text-xs overflow-x-auto whitespace-pre-wrap">
                          {initBalancesResult.sqlForProduction}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Close</AlertDialogCancel>
              {!initBalancesResult && (
                <AlertDialogAction
                  onClick={() => initializeBalancesMutation.mutate()}
                  disabled={initializeBalancesMutation.isPending}
                >
                  {initializeBalancesMutation.isPending ? "Processing..." : "Initialize All Companies"}
                </AlertDialogAction>
              )}
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Fix Old PO Credits Dialog */}
        <AlertDialog open={isFixPOCreditsDialogOpen} onOpenChange={(open) => {
          setIsFixPOCreditsDialogOpen(open);
          if (!open) {
            setSelectedCompanyForFix("");
            setSelectedParentCompanyForFix("");
            setFixPOCreditsResult(null);
            setReversePOCreditsResult(null);
          }
        }}>
          <AlertDialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <AlertDialogHeader>
              <AlertDialogTitle>Inter-Company Credit Management</AlertDialogTitle>
              <AlertDialogDescription asChild>
                {!fixPOCreditsResult && !reversePOCreditsResult ? (
                  <div className="space-y-4">
                    <p>
                      <strong>Fix:</strong> Creates inter-company credit entries for old offloaded POs.
                      <br />
                      <strong>Reverse:</strong> Removes all inter-company (INTERCO) vouchers.
                    </p>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium text-foreground">Subsidiary Company (source)</label>
                        <Select
                          value={selectedCompanyForFix}
                          onValueChange={setSelectedCompanyForFix}
                        >
                          <SelectTrigger className="mt-1" data-testid="select-company-for-fix">
                            <SelectValue placeholder="Choose subsidiary..." />
                          </SelectTrigger>
                          <SelectContent>
                            {companies
                              .filter((c: any) => c.id.toString() !== selectedParentCompanyForFix)
                              .map((company: any) => (
                                <SelectItem key={company.id} value={company.id.toString()}>
                                  {company.name}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground mt-1">The company whose POs need fixing</p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-foreground">Parent Company (receiver)</label>
                        <Select
                          value={selectedParentCompanyForFix}
                          onValueChange={setSelectedParentCompanyForFix}
                        >
                          <SelectTrigger className="mt-1" data-testid="select-parent-for-fix">
                            <SelectValue placeholder="Choose parent..." />
                          </SelectTrigger>
                          <SelectContent>
                            {companies
                              .filter((c: any) => c.id.toString() !== selectedCompanyForFix)
                              .map((company: any) => (
                                <SelectItem key={company.id} value={company.id.toString()}>
                                  {company.name}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground mt-1">The company that paid suppliers</p>
                      </div>
                    </div>
                    {selectedCompanyForFix && selectedParentCompanyForFix && (
                      <div className="p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-md">
                        <p className="text-sm text-blue-800 dark:text-blue-200">
                          This will create credit entries for <strong>{companies.find((c: any) => c.id.toString() === selectedCompanyForFix)?.name}</strong> towards <strong>{companies.find((c: any) => c.id.toString() === selectedParentCompanyForFix)?.name}</strong>.
                        </p>
                      </div>
                    )}
                  </div>
                ) : fixPOCreditsResult ? (
                  <div className="space-y-4 mt-4">
                    <div className="text-foreground font-medium">{fixPOCreditsResult.message}</div>
                    <div className="grid grid-cols-2 gap-4 p-3 bg-muted/50 rounded">
                      <div>
                        <div className="text-sm text-muted-foreground">POs Fixed</div>
                        <div className="text-lg font-semibold">{fixPOCreditsResult.fixed}</div>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground">Total Amount</div>
                        <div className="text-lg font-semibold">${formatNumber(parseFloat(fixPOCreditsResult.totalAmount || 0))}</div>
                      </div>
                    </div>
                    {fixPOCreditsResult.details?.length > 0 && (
                      <div className="mt-4">
                        <div className="font-medium mb-2">Details:</div>
                        <div className="max-h-60 overflow-y-auto border rounded">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Company</TableHead>
                                <TableHead>PO Number</TableHead>
                                <TableHead className="text-right">Amount</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {fixPOCreditsResult.details.map((d: any, i: number) => (
                                <TableRow key={i}>
                                  <TableCell>{d.company}</TableCell>
                                  <TableCell>{d.poNumber}</TableCell>
                                  <TableCell className="text-right">${formatNumber(d.amount)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    )}
                  </div>
                ) : reversePOCreditsResult ? (
                  <div className="space-y-4 mt-4">
                    <div className="text-foreground font-medium">{reversePOCreditsResult.message}</div>
                    <div className="p-3 bg-muted/50 rounded">
                      <div className="text-sm text-muted-foreground">Vouchers Reversed</div>
                      <div className="text-lg font-semibold">{reversePOCreditsResult.reversed}</div>
                    </div>
                    {reversePOCreditsResult.details?.length > 0 && (
                      <div className="mt-4">
                        <div className="font-medium mb-2">Deleted Vouchers:</div>
                        <div className="max-h-60 overflow-y-auto border rounded">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Company</TableHead>
                                <TableHead>Voucher Number</TableHead>
                                <TableHead className="text-right">Amount</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {reversePOCreditsResult.details.map((d: any, i: number) => (
                                <TableRow key={i}>
                                  <TableCell>{d.company}</TableCell>
                                  <TableCell>{d.voucherNumber}</TableCell>
                                  <TableCell className="text-right">${formatNumber(parseFloat(d.amount))}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="gap-2">
              <AlertDialogCancel>Close</AlertDialogCancel>
              {!fixPOCreditsResult && !reversePOCreditsResult && (
                <>
                  <Button
                    variant="destructive"
                    onClick={() => reversePOCreditsMutation.mutate({ 
                      companyId: parseInt(selectedCompanyForFix), 
                      parentCompanyId: parseInt(selectedParentCompanyForFix) 
                    })}
                    disabled={reversePOCreditsMutation.isPending || fixPOCreditsMutation.isPending || !selectedCompanyForFix || !selectedParentCompanyForFix}
                    data-testid="button-reverse-po-credits"
                  >
                    {reversePOCreditsMutation.isPending ? "Reversing..." : "Reverse Credits"}
                  </Button>
                  <AlertDialogAction
                    onClick={() => fixPOCreditsMutation.mutate({ 
                      companyId: parseInt(selectedCompanyForFix), 
                      parentCompanyId: parseInt(selectedParentCompanyForFix) 
                    })}
                    disabled={fixPOCreditsMutation.isPending || reversePOCreditsMutation.isPending || !selectedCompanyForFix || !selectedParentCompanyForFix}
                  >
                    {fixPOCreditsMutation.isPending ? "Processing..." : "Fix Credits"}
                  </AlertDialogAction>
                </>
              )}
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Reset Company Data Dialog */}
        <AlertDialog open={isResetDataDialogOpen} onOpenChange={(open) => {
          setIsResetDataDialogOpen(open);
          if (!open) {
            setSelectedCompanyForReset("");
            setResetDataResult(null);
          }
        }}>
          <AlertDialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <AlertDialogHeader>
              <AlertDialogTitle>Reset Company Data</AlertDialogTitle>
              <AlertDialogDescription asChild>
                {!resetDataResult ? (
                  <div className="space-y-4">
                    <div className="p-3 bg-orange-50 dark:bg-orange-950 border border-orange-200 dark:border-orange-800 rounded-md">
                      <p className="text-sm text-orange-800 dark:text-orange-200 font-medium">
                        Warning: This action permanently deletes data. This cannot be undone.
                      </p>
                    </div>
                    
                    <div>
                      <label className="text-sm font-medium text-foreground">Select Company to Reset</label>
                      <Select
                        value={selectedCompanyForReset}
                        onValueChange={setSelectedCompanyForReset}
                      >
                        <SelectTrigger className="mt-1" data-testid="select-company-for-reset">
                          <SelectValue placeholder="Choose a company..." />
                        </SelectTrigger>
                        <SelectContent>
                          {companies.map((company: any) => (
                            <SelectItem key={company.id} value={company.id.toString()}>
                              {company.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4 mt-4">
                      <div>
                        <h4 className="text-sm font-medium text-red-600 mb-2">Will be DELETED:</h4>
                        <ul className="text-xs text-muted-foreground space-y-1">
                          <li>• Payment vouchers</li>
                          <li>• Receipt vouchers</li>
                          <li>• Journal vouchers</li>
                          <li>• Associated voucher entries</li>
                        </ul>
                      </div>
                      <div>
                        <h4 className="text-sm font-medium text-green-600 mb-2">Will be PRESERVED:</h4>
                        <ul className="text-xs text-muted-foreground space-y-1">
                          <li>• All containers & offloads</li>
                          <li>• Inventory/stock balances</li>
                          <li>• Locations & accounts</li>
                          <li>• POS vouchers</li>
                          <li>• Production/Consumption/Stock Transfer</li>
                          <li>• Purchase Orders</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 mt-4">
                    <div className="text-foreground font-medium">{resetDataResult.message}</div>
                    <div className="grid grid-cols-2 gap-4 p-3 bg-muted/50 rounded">
                      <div>
                        <span className="text-sm text-muted-foreground">Vouchers Deleted:</span>
                        <span className="ml-2 font-medium">{resetDataResult.deletedVouchers}</span>
                      </div>
                      <div>
                        <span className="text-sm text-muted-foreground">Entries Deleted:</span>
                        <span className="ml-2 font-medium">{resetDataResult.deletedEntries}</span>
                      </div>
                    </div>
                    {resetDataResult.typeSummary && (
                      <div className="text-sm space-y-1">
                        <div className="font-medium">Breakdown by type:</div>
                        {resetDataResult.typeSummary.map((ts: any) => (
                          <div key={ts.type} className="flex justify-between text-muted-foreground">
                            <span>{ts.type}:</span>
                            <span>{ts.count}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="gap-2">
              <AlertDialogCancel>Close</AlertDialogCancel>
              {!resetDataResult && (
                <Button
                  variant="destructive"
                  onClick={() => resetCompanyDataMutation.mutate(parseInt(selectedCompanyForReset))}
                  disabled={resetCompanyDataMutation.isPending || !selectedCompanyForReset}
                  data-testid="button-confirm-reset"
                >
                  {resetCompanyDataMutation.isPending ? "Resetting..." : "Reset Company Data"}
                </Button>
              )}
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Zero Account Balances Dialog */}
        <AlertDialog open={isZeroBalanceDialogOpen} onOpenChange={(open) => {
          setIsZeroBalanceDialogOpen(open);
          if (!open) {
            setSelectedAccountsToZero([]);
          }
        }}>
          <AlertDialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <Calculator className="h-5 w-5 text-red-500" />
                Zero Account Balances
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-4">
                  <p>
                    Select accounts to zero their opening balances. This gives you a fresh start for a new period while keeping all historical vouchers intact.
                  </p>
                  
                  {!selectedCompany ? (
                    <p className="text-destructive">Please select a company first.</p>
                  ) : (
                    <>
                      <div className="flex items-center justify-between border-b pb-2">
                        <div className="flex items-center gap-4">
                          <Checkbox
                            checked={allLedgerAccounts.length > 0 && selectedAccountsToZero.length === allLedgerAccounts.filter((a: any) => parseFloat(a.openingBalance || "0") !== 0).length}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedAccountsToZero(allLedgerAccounts.filter((a: any) => parseFloat(a.openingBalance || "0") !== 0).map((a: any) => a.id));
                              } else {
                                setSelectedAccountsToZero([]);
                              }
                            }}
                            data-testid="checkbox-select-all-accounts"
                          />
                          <Label className="font-medium">Select All with Non-Zero Balances</Label>
                        </div>
                        <Badge variant="outline">
                          {selectedAccountsToZero.length} selected
                        </Badge>
                      </div>

                      <div className="max-h-96 overflow-y-auto border rounded">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-12"></TableHead>
                              <TableHead>Account Name</TableHead>
                              <TableHead>Type</TableHead>
                              <TableHead className="text-right">Opening Balance</TableHead>
                              <TableHead className="text-center">Side</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {allLedgerAccounts
                              .filter((account: any) => !account.deletedAt && account.active)
                              .sort((a: any, b: any) => a.accountType.localeCompare(b.accountType) || a.name.localeCompare(b.name))
                              .map((account: any) => {
                                const balance = parseFloat(account.openingBalance || "0");
                                const hasBalance = balance !== 0;
                                return (
                                  <TableRow key={account.id} className={hasBalance ? "" : "opacity-50"}>
                                    <TableCell>
                                      <Checkbox
                                        checked={selectedAccountsToZero.includes(account.id)}
                                        disabled={!hasBalance}
                                        onCheckedChange={(checked) => {
                                          if (checked) {
                                            setSelectedAccountsToZero([...selectedAccountsToZero, account.id]);
                                          } else {
                                            setSelectedAccountsToZero(selectedAccountsToZero.filter(id => id !== account.id));
                                          }
                                        }}
                                        data-testid={`checkbox-account-${account.id}`}
                                      />
                                    </TableCell>
                                    <TableCell className="font-medium">{account.name}</TableCell>
                                    <TableCell>
                                      <Badge variant="outline" className="text-xs">
                                        {account.accountType}
                                      </Badge>
                                    </TableCell>
                                    <TableCell className={`text-right ${hasBalance ? "font-medium" : ""}`}>
                                      {formatNumber(Math.abs(balance))}
                                    </TableCell>
                                    <TableCell className="text-center">
                                      {account.openingBalanceSide || "-"}
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                          </TableBody>
                        </Table>
                      </div>

                      {selectedAccountsToZero.length > 0 && (
                        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md">
                          <p className="text-sm font-medium text-destructive">
                            Warning: This will set the opening balance to $0.00 for {selectedAccountsToZero.length} account(s). This action cannot be easily undone.
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="button-cancel-zero-balances">Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => zeroBalancesMutation.mutate(selectedAccountsToZero)}
                disabled={zeroBalancesMutation.isPending || selectedAccountsToZero.length === 0}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                data-testid="button-confirm-zero-balances"
              >
                {zeroBalancesMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processing...</>
                ) : (
                  `Zero ${selectedAccountsToZero.length} Account(s)`
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
  
        {/* Role Assignment Dialog */}
        <Dialog open={isRoleDialogOpen} onOpenChange={setIsRoleDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editingRole ? "Edit Role Assignment" : "Add Role Assignment"}</DialogTitle>
            </DialogHeader>
            <Form {...roleForm}>
              <form onSubmit={roleForm.handleSubmit(handleSubmitRole)} className="space-y-4">
                <FormField
                  control={roleForm.control}
                  name="companyId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Company *</FormLabel>
                      <Select
                        onValueChange={(v) => field.onChange(parseInt(v))}
                        value={field.value?.toString() || ""}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-company">
                            <SelectValue placeholder="Select company" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {companies.map((company: any) => (
                            <SelectItem key={company.id} value={company.id.toString()}>
                              {company.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
  
                <FormField
                  control={roleForm.control}
                  name="role"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Role *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-role">
                            <SelectValue placeholder="Select role" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Admin">Admin</SelectItem>
                          <SelectItem value="Owner">Owner</SelectItem>
                          <SelectItem value="Manager">Manager</SelectItem>
                          <SelectItem value="POS1">POS 1</SelectItem>
                          <SelectItem value="POS2">POS 2</SelectItem>
                          <SelectItem value="POS3">POS 3</SelectItem>
                          <SelectItem value="POS4">POS 4</SelectItem>
                          <SelectItem value="POS5">POS 5</SelectItem>
                          <SelectItem value="POS6">POS 6</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
  
                {isPOSRole && (
                  <>
                    <FormField
                      control={roleForm.control}
                      name="assignedLocationId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Assigned Locations *</FormLabel>
                          <div className="border rounded-md p-3 space-y-2 max-h-48 overflow-y-auto" data-testid="select-locations">
                            {locations.map((loc: any) => {
                              const isChecked = (selectedLocationIds || []).includes(loc.id);
                              return (
                                <label
                                  key={loc.id}
                                  className="flex items-center gap-2 cursor-pointer text-sm"
                                  data-testid={`checkbox-location-${loc.id}`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={(e) => {
                                      const newIds = e.target.checked
                                        ? [...(selectedLocationIds || []), loc.id]
                                        : (selectedLocationIds || []).filter((id: number) => id !== loc.id);
                                      setSelectedLocationIds(newIds);
                                      if (newIds.length > 0) {
                                        field.onChange(newIds[0]);
                                      } else {
                                        field.onChange(undefined);
                                      }
                                    }}
                                    className="rounded"
                                  />
                                  {loc.name} ({loc.code})
                                </label>
                              );
                            })}
                          </div>
                          {(selectedLocationIds || []).length === 0 && (
                            <p className="text-sm text-destructive">At least one location is required for POS roles</p>
                          )}
                          <FormMessage />
                        </FormItem>
                      )}
                    />
  
                    <FormField
                      control={roleForm.control}
                      name="posStation"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>POS Station Number</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              type="number"
                              min="1"
                              max="6"
                              placeholder="1-6"
                              data-testid="input-pos-station"
                              onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                              value={field.value || ""}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </>
                )}
  
                <FormField
                  control={roleForm.control}
                  name="cashAccountId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cash Account (Optional)</FormLabel>
                      <Select
                        onValueChange={(v) => field.onChange(v ? parseInt(v) : undefined)}
                        value={field.value?.toString() || ""}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-cash-account">
                            <SelectValue placeholder="Select cash account" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {cashAccounts.map((account: any) => (
                            <SelectItem key={account.id} value={account.id.toString()}>
                              {account.name} ({account.code})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
  
                <div className="flex gap-2 justify-end border-t pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setIsRoleDialogOpen(false);
                      setEditingRole(null);
                      setCurrentUserId(null);
                    }}
                    disabled={createRoleMutation.isPending}
                    data-testid="button-cancel-role"
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createRoleMutation.isPending} data-testid="button-save-role">
                    {createRoleMutation.isPending ? "Saving..." : "Save"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>
    );
  }
  