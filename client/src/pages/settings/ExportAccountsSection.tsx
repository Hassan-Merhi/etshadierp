  import { useState, useEffect, useRef } from "react";
  import { useConnectivity } from "@/contexts/ConnectivityContext";
  import { DeleteConfirmDialog } from "@/components/ConfirmationDialog";
  import { OfflinePrepPanel } from "@/components/OfflinePrepPanel";
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
  import { Skeleton } from "@/components/ui/skeleton";
  import { Switch } from "@/components/ui/switch";
  
  import { useToast } from "@/hooks/use-toast";
  import { useMutation, useQuery } from "@tanstack/react-query";
  import { queryClient, apiRequest } from "@/lib/queryClient";
  import { useAppMode } from "@/contexts/AppModeContext";
  import { getApiRequest, factoryApiRequest } from "@/lib/factoryApi";
  import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
  import { Plus, Edit, Building2, Users, ChevronDown, ChevronUp, Trash2, CalendarRange, Settings2, Wrench, MapPin, ChevronRight, Bot, MessageCircle, RefreshCw, Calculator, Loader2, Shield, AlertTriangle, PieChart, Key, Lock, Package, Eye, History, Clock, Upload, Download, Database, TrendingUp, ShoppingCart, Check, X, Copy, ExternalLink, ArrowLeftRight, WifiOff, Wifi, CheckCircle2, Printer, Layers } from "lucide-react";
import { utils, writeFile, readFile, read, ExcelJS } from "@/lib/excelHelper";
  import { Link } from "wouter";
  import { useDateFormat } from "@/contexts/DateFormatContext";
  import { insertUserSchema, insertCompanySchema, insertUserCompanyRoleSchema, FEATURE_KEYS, FEATURE_PAGE_INFO, type FeatureKey } from "@shared/schema";
  import { FACTORY_NAV_PAGES } from "@/components/FactorySidebar";
  import { FiscalPeriodTab } from "@/components/FiscalPeriodTab";
  import { useCompany } from "@/contexts/CompanyContext";
  import { ExchangeRateSettings } from "@/components/ExchangeRateSettings";
  import { formatNumber } from "@/lib/formatNumber";
  
  const userFormSchema = insertUserSchema;
  const companyFormSchema = insertCompanySchema;
  const roleAssignmentSchema = insertUserCompanyRoleSchema.refine(
    (data) => {
      // If role is POS, assignedLocationId must be present
      if (data.role === "POS" && !data.assignedLocationId) {
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


export function ExportAccountsSection() {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [exporting, setExporting] = useState(false);
  const [search, setSearch] = useState("");
  const { toast } = useToast();

  const { data: allAccounts = [] } = useQuery<any[]>({
    queryKey: ["/api/accounts/all"],
  });

  const typeLabels: Record<string, string> = {
    ledger: "Ledger Accounts",
    bank: "Bank Accounts",
    "fixed asset": "Fixed Assets",
    supplier: "Suppliers",
    customer: "Customers",
    employee: "Employees",
    factoryWorker: "Workers",
    factorySupplier: "Factory Suppliers",
  };

  const typeOrder = ["ledger", "bank", "fixed asset", "supplier", "customer", "employee", "factoryWorker", "factorySupplier"];

  const filtered = allAccounts.filter((a: any) =>
    a.name.toLowerCase().includes(search.toLowerCase())
  );

  const grouped = filtered.reduce<Record<string, any[]>>((acc, account: any) => {
    const type = account.type || "ledger";
    if (!acc[type]) acc[type] = [];
    acc[type].push(account);
    return acc;
  }, {});

  const sortedGroupKeys = [...Object.keys(grouped)].sort(
    (a, b) => (typeOrder.indexOf(a) === -1 ? 99 : typeOrder.indexOf(a)) - (typeOrder.indexOf(b) === -1 ? 99 : typeOrder.indexOf(b))
  );

  const toggleAccount = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(
    filtered
      .filter((a: any) => a.type !== "customer" && parseFloat(a.balance ?? "0") !== 0)
      .map((a: any) => a.accountId)
  ));
  const clearAll = () => setSelectedIds(new Set());

  const getTransactionUrl = (acc: any): string => {
    const params = new URLSearchParams();
    if (fromDate) params.append("startDate", fromDate);
    if (toDate) params.append("endDate", toDate);
    const qs = params.toString() ? `?${params.toString()}` : "";
    if (acc.type === "factoryWorker") {
      return `/api/factory/workers/${acc.accountId}/statement${qs}`;
    }
    const accountType = (acc.type || "").toLowerCase().replace(/ /g, "-");
    return `/api/accounts/${accountType}/${acc.accountId}/transactions${qs}`;
  };

  const MAX_ROWS_PER_SHEET = 60000;

  const addSheetForChunk = (wb: ExcelJS.Workbook, baseName: string, part: number, totalParts: number, txnsChunk: any[], startBalance: number) => {
    const suffix = totalParts > 1 ? ` ${part}` : "";
    const rawName = `${baseName}${suffix}`;
    const sheetName = rawName.replace(/[\\\/\?\*\[\]:]/g, "").substring(0, 31);
    const ws = wb.addWorksheet(sheetName);

    ws.columns = [
      { header: "Date", key: "date", width: 14 },
      { header: "Voucher No.", key: "voucherNo", width: 16 },
      { header: "Type", key: "type", width: 16 },
      { header: "Description", key: "description", width: 40 },
      { header: "Debit", key: "debit", width: 14 },
      { header: "Credit", key: "credit", width: 14 },
      { header: "Balance", key: "balance", width: 14 },
    ];

    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true, size: 11 };
    headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EAF6" } };
    headerRow.alignment = { horizontal: "center" };

    let runningBalance = startBalance;
    for (const txn of txnsChunk) {
      const debit = parseFloat(txn.debitAmount || "0");
      const credit = parseFloat(txn.creditAmount || "0");
      runningBalance += debit - credit;
      const row = ws.addRow({
        date: txn.voucherDate ? new Date(txn.voucherDate).toLocaleDateString("en-GB") : "",
        voucherNo: txn.voucherNumber || "",
        type: txn.voucherType || "",
        description: txn.narration || txn.voucherDescription || "",
        debit: debit > 0 ? debit : null,
        credit: credit > 0 ? credit : null,
        balance: runningBalance,
      });
      row.getCell("balance").font = { color: { argb: runningBalance >= 0 ? "FF1B5E20" : "FFB71C1C" } };
    }

    if (txnsChunk.length > 0) {
      const totalRow = ws.addRow({
        date: "", voucherNo: "", type: "", description: "TOTAL",
        debit: { formula: `SUM(E2:E${txnsChunk.length + 1})` },
        credit: { formula: `SUM(F2:F${txnsChunk.length + 1})` },
        balance: "",
      });
      totalRow.font = { bold: true };
      totalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F5" } };
    }

    ["debit", "credit", "balance"].forEach(key => {
      ws.getColumn(key).numFmt = '#,##0.00';
      ws.getColumn(key).alignment = { horizontal: "right" };
    });

    return runningBalance;
  };

  const handleExport = async () => {
    if (selectedIds.size === 0) {
      toast({ title: "No accounts selected", description: "Please select at least one account.", variant: "destructive" });
      return;
    }
    setExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = "ERP System";
      wb.created = new Date();

      for (const accId of selectedIds) {
        const acc = allAccounts.find((a: any) => a.accountId === accId);
        if (!acc) continue;

        let txns: any[] = [];
        try {
          const res = await fetch(getTransactionUrl(acc), { credentials: "include" });
          if (res.ok) txns = await res.json();
        } catch {}

        const baseName = acc.name.replace(/[\\\/\?\*\[\]:]/g, "").substring(0, 28) || `Acct_${accId}`;

        if (txns.length <= MAX_ROWS_PER_SHEET) {
          addSheetForChunk(wb, baseName, 1, 1, txns, 0);
        } else {
          const totalParts = Math.ceil(txns.length / MAX_ROWS_PER_SHEET);
          let carryBalance = 0;
          for (let part = 1; part <= totalParts; part++) {
            const chunk = txns.slice((part - 1) * MAX_ROWS_PER_SHEET, part * MAX_ROWS_PER_SHEET);
            carryBalance = addSheetForChunk(wb, baseName, part, totalParts, chunk, carryBalance);
          }
        }
      }

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const dlUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = dlUrl;
      a.download = `Account_Export_${new Date().toLocaleDateString('en-CA')}.xlsx`;
      a.click();
      URL.revokeObjectURL(dlUrl);
      toast({ title: "Export complete", description: `${selectedIds.size} account${selectedIds.size !== 1 ? "s" : ""} exported successfully.` });
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Export Accounts</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Select accounts and an optional date range. Each account gets its own sheet in a single Excel workbook.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between flex-wrap gap-2">
              <span>Select Accounts</span>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" data-testid="badge-selected-count">{selectedIds.size} selected</Badge>
                <Button variant="ghost" size="sm" onClick={selectAll} data-testid="button-select-all-accounts">Select All</Button>
                <Button variant="ghost" size="sm" onClick={clearAll} data-testid="button-clear-accounts">Clear</Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              placeholder="Search accounts..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              data-testid="input-account-search"
            />
            <div className="border rounded-md overflow-y-auto max-h-80 divide-y">
              {sortedGroupKeys.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">No accounts found</p>
              )}
              {sortedGroupKeys.map(type => (
                <div key={type}>
                  <div className="text-xs font-semibold text-muted-foreground px-3 py-2 bg-muted/40 uppercase tracking-wide sticky top-0">
                    {typeLabels[type] || type}
                  </div>
                  {grouped[type].map((acc: any) => (
                    <label
                      key={acc.accountId}
                      className="flex items-center gap-3 px-3 py-2 cursor-pointer hover-elevate"
                      data-testid={`label-account-${acc.accountId}`}
                    >
                      <Checkbox
                        checked={selectedIds.has(acc.accountId)}
                        onCheckedChange={() => toggleAccount(acc.accountId)}
                        data-testid={`checkbox-account-${acc.accountId}`}
                      />
                      <span className="text-sm flex-1">{acc.name}</span>
                      {acc.balance !== undefined && (
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {acc.balanceSide} {Math.abs(acc.balance).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Date Range</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>From</Label>
                <Input
                  type="date"
                  value={fromDate}
                  onChange={e => setFromDate(e.target.value)}
                  data-testid="input-export-from-date"
                />
              </div>
              <div className="space-y-1.5">
                <Label>To</Label>
                <Input
                  type="date"
                  value={toDate}
                  onChange={e => setToDate(e.target.value)}
                  data-testid="input-export-to-date"
                />
              </div>
              <p className="text-xs text-muted-foreground">Leave blank to include all transactions.</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-5 space-y-3">
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Accounts</span>
                  <span className="font-medium">{selectedIds.size}</span>
                </div>
                {fromDate && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">From</span>
                    <span className="font-medium">{fromDate}</span>
                  </div>
                )}
                {toDate && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">To</span>
                    <span className="font-medium">{toDate}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Format</span>
                  <span className="font-medium">Excel (.xlsx)</span>
                </div>
              </div>
              <Button
                className="w-full"
                onClick={handleExport}
                disabled={exporting || selectedIds.size === 0}
                data-testid="button-export-accounts"
              >
                {exporting ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Exporting…</>
                ) : (
                  <><Download className="h-4 w-4 mr-2" />Export to Excel</>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

