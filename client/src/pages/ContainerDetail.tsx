import { useState, useEffect, useRef } from "react";
import { DeleteConfirmDialog } from "@/components/ConfirmationDialog";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { useParams, Link, useLocation } from "wouter";
import { useEscapeToParent } from "@/hooks/use-escape-to-parent";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Package, DollarSign, FileText, Truck, Trash2, HandCoins, Calendar, User, RotateCcw, Edit, Download, Printer, Upload, CheckCircle2, Circle, XCircle, Plus, CreditCard, Ship, ChevronDown, RefreshCw } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { OffloadDialog } from "@/components/OffloadDialog";
import { SpOffloadDialog } from "@/components/SpOffloadDialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useCompany } from "@/contexts/CompanyContext";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import type { Supplier, Customer, ContainerSale } from "@shared/schema";
import { utils, writeFile, read as readExcel, ExcelJS } from "@/lib/excelHelper";

interface ContainerDetailData {
  container: any;
  pos: any[];
  charges: any[];
}

const saleFormSchema = z.object({
  customerId: z.string().min(1, "Customer is required"),
  commission: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Commission must be non-negative"),
  commissionAccountId: z.string().optional(),
  saleDate: z.string().min(1, "Sale date is required"),
});

export default function ContainerDetail({ id: idProp, forceErp }: { id?: string; forceErp?: boolean }) {
  const { formatDisplayDate } = useDateFormat();
  const params = useParams();
  const containerId = idProp ?? params.id;
  const [showOffloadDialog, setShowOffloadDialog] = useState(false);
  const [showSellDialog, setShowSellDialog] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<(() => void) | null>(null);
  const { toast } = useToast();
  const [_location, setLocation] = useLocation();
  useEscapeToParent();
  const { selectedCompany } = useCompany();
  const { formatAmount } = useCurrencyContext();
  const companyId = selectedCompany?.id;
  // forceErp: when an SP company opens an ERP-sourced container, treat it as a regular ERP container
  const isSupplierPartner = forceErp ? false : selectedCompany?.companyType === "supplier_partner";
  const printRef = useRef<HTMLDivElement>(null);
  
  // Check for auto-print query parameter
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('print') === 'true') {
      // Remove the print param from URL to prevent re-printing on refresh
      const newUrl = window.location.pathname;
      window.history.replaceState({}, '', newUrl);
      // Trigger print after a short delay to allow content to load
      setTimeout(() => {
        handlePrint();
      }, 1000);
    }
  }, []);

  const { data: currentUser } = useQuery<{ role?: string }>({ queryKey: ["/api/auth/me"] });
  const isDeveloper = currentUser?.role === "Developer";

  const { data: containerData, isLoading } = useQuery<ContainerDetailData>({
    queryKey: [`/api/containers/${containerId}`],
    enabled: !!containerId && !isSupplierPartner,
  });

  const { data: spContainerData, isLoading: spDetailLoading } = useQuery<any>({
    queryKey: [`/api/sp/containers/${containerId}`],
    queryFn: () =>
      fetch(`/api/sp/containers/${containerId}`, { credentials: "include" }).then(r => r.json()),
    enabled: !!containerId && isSupplierPartner,
  });

  const [showSpOffloadDialog, setShowSpOffloadDialog] = useState(false);

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers", companyId],
    enabled: !!companyId,
  });

  const { data: allLedgerAccounts = [] } = useQuery<any[]>({
    queryKey: ["/api/ledger-accounts", companyId],
    enabled: !!companyId,
  });

  // Filter for income accounts only for commission dropdown
  const incomeAccounts = allLedgerAccounts.filter((account) => account.accountType === "Income");

  const { data: containerSales = [] } = useQuery<ContainerSale[]>({
    queryKey: ["/api/container-sales", companyId],
    enabled: !!companyId,
  });

  const containerSale = containerSales.find((sale: ContainerSale) => sale.containerId === parseInt(containerId!));

  const { data: docsData, isLoading: docsLoading } = useQuery<{
    documents: any[];
    docTypes: any[];
    completeness: { total: number; uploaded: number; complete: boolean };
  }>({
    queryKey: ["/api/factory/containers", containerId, "documents"],
    queryFn: async () => {
      const res = await fetch(`/api/factory/containers/${containerId}/documents`);
      if (!res.ok) throw new Error("Failed to load documents");
      return res.json();
    },
    enabled: !!containerId,
  });

  const { data: freightData = [], isLoading: freightLoading } = useQuery<any[]>({
    queryKey: ["/api/factory/containers", containerId, "freight"],
    queryFn: async () => {
      const res = await fetch(`/api/factory/containers/${containerId}/freight`);
      if (!res.ok) throw new Error("Failed to load freight");
      return res.json();
    },
    enabled: !!containerId,
  });

  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [showFreightDialog, setShowFreightDialog] = useState(false);
  const [showPaymentDialog, setShowPaymentDialog] = useState<number | null>(null);
  const [uploadDocTypeId, setUploadDocTypeId] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showPriceImportDialog, setShowPriceImportDialog] = useState(false);
  const [priceImportPreview, setPriceImportPreview] = useState<any[] | null>(null);
  const [priceImportParsing, setPriceImportParsing] = useState(false);
  const [priceImportError, setPriceImportError] = useState<string | null>(null);
  const priceImportFileRef = useRef<HTMLInputElement>(null);

  const pricePreviewMutation = useMutation({
    mutationFn: async (rows: { barcode: string; price: string }[]) => {
      const res = await apiRequest("POST", `/api/containers/${containerId}/price-import/preview`, { rows });
      return res.json();
    },
    onSuccess: (data: any) => {
      setPriceImportPreview(data.preview || []);
    },
    onError: (e: any) => {
      toast({ title: "Preview failed", description: e.message, variant: "destructive" });
    },
  });

  const priceApplyMutation = useMutation({
    mutationFn: async (rows: { lineItemIds: number[]; newRate: number }[]) => {
      const res = await apiRequest("POST", `/api/containers/${containerId}/price-import/apply`, { rows });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Prices updated", description: `${data.updated} line item(s) updated successfully.` });
      setShowPriceImportDialog(false);
      setPriceImportPreview(null);
      setPriceImportError(null);
      queryClient.invalidateQueries({ queryKey: [`/api/containers/${containerId}`] });
    },
    onError: (e: any) => {
      toast({ title: "Apply failed", description: e.message, variant: "destructive" });
    },
  });

  const handlePriceImportFile = async (file: File) => {
    setPriceImportError(null);
    setPriceImportPreview(null);
    setPriceImportParsing(true);
    try {
      const wb = await readExcel(file);
      const sheetName = wb.SheetNames[0];
      const sheet = wb.Sheets[sheetName];
      const rows: { barcode: string; price: string }[] = [];
      let barcodeCol = -1;
      let priceCol = -1;
      let headerRow = -1;

      sheet.eachRow((row: any, rowNumber: number) => {
        const vals = row.values as any[];
        if (headerRow === -1) {
          vals.forEach((cell: any, colIdx: number) => {
            const v = String(cell || "").toLowerCase().trim();
            if (v === "barcode" || v === "barcodes" || v === "bar_code" || v === "code") barcodeCol = colIdx;
            if (v === "price" || v === "new_price" || v === "newprice" || v === "unit_price" || v === "unit price") priceCol = colIdx;
          });
          if (barcodeCol !== -1 && priceCol !== -1) { headerRow = rowNumber; }
          return;
        }
        const barcode = String(vals[barcodeCol] ?? "").trim();
        const price = String(vals[priceCol] ?? "").trim();
        if (barcode) rows.push({ barcode, price });
      });

      if (rows.length === 0 && (barcodeCol === -1 || priceCol === -1)) {
        const headerKeywords = ["barcode", "barcodes", "bar_code", "code", "price", "new_price", "newprice", "unit_price", "unit price"];
        sheet.eachRow((row: any) => {
          const vals = row.values as any[];
          const firstCell = String(vals[1] ?? "").toLowerCase().trim();
          if (headerKeywords.includes(firstCell)) return;
          const barcode = String(vals[1] ?? "").trim();
          const price = String(vals[2] ?? "").trim();
          if (barcode) rows.push({ barcode, price });
        });
        if (rows.length === 0) {
          setPriceImportError('Could not detect columns. Use headers "barcode" and "price", or put barcodes in column A and prices in column B.');
          setPriceImportParsing(false);
          return;
        }
      }

      if (rows.length === 0) {
        setPriceImportError("No data rows found in the Excel file.");
        setPriceImportParsing(false);
        return;
      }

      pricePreviewMutation.mutate(rows);
    } catch (err: any) {
      setPriceImportError("Could not read Excel file: " + err.message);
    } finally {
      setPriceImportParsing(false);
    }
  };

  const uploadDocMutation = useMutation({
    mutationFn: async ({ docTypeId, file }: { docTypeId: number; file: File }) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("docTypeId", String(docTypeId));
      const res = await fetch(`/api/factory/containers/${containerId}/documents`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/containers", containerId, "documents"] });
      queryClient.invalidateQueries({ queryKey: [`/api/containers/${containerId}`] });
      setShowUploadDialog(false);
      setUploadDocTypeId("");
      setUploadFile(null);
      toast({ title: "Document uploaded" });
    },
    onError: (e: any) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  const deleteDocMutation = useMutation({
    mutationFn: async (docId: number) => {
      await apiRequest("DELETE", `/api/factory/containers/${containerId}/documents/${docId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/containers", containerId, "documents"] });
      queryClient.invalidateQueries({ queryKey: [`/api/containers/${containerId}`] });
      toast({ title: "Document deleted" });
    },
    onError: (e: any) => { if (e?._handledGlobally) return; toast({ title: "Delete failed", description: e.message, variant: "destructive" }); },
  });

  async function handleViewDoc(storageKey: string) {
    try {
      const resp = await fetch(`/api/factory/uploads/${storageKey}`, { credentials: "include" });
      if (!resp.ok) {
        const isJson = resp.headers.get("content-type")?.includes("application/json");
        const msg = isJson ? (await resp.json()).message : await resp.text();
        toast({
          title: resp.status === 404 ? "File no longer available" : "File unavailable",
          description: resp.status === 404
            ? "This file was uploaded before database storage was enabled and cannot be retrieved. Please delete it and re-upload."
            : (msg || `Server returned ${resp.status}`),
          variant: "destructive",
        });
        return;
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      toast({ title: "Could not open file", description: "Network error", variant: "destructive" });
    }
  }

  const freightForm = useForm({
    defaultValues: { vendorName: "", freightAmount: "", currency: "USD", dueDate: "", notes: "" },
  });

  const addFreightMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", `/api/factory/containers/${containerId}/freight`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/containers", containerId, "freight"] });
      setShowFreightDialog(false);
      freightForm.reset();
      toast({ title: "Freight charge added" });
    },
    onError: (e: any) => { if (e?._handledGlobally) return; toast({ title: "Failed", description: e.message, variant: "destructive" }); },
  });

  const deleteFreightMutation = useMutation({
    mutationFn: async (freightId: number) => {
      await apiRequest("DELETE", `/api/factory/containers/${containerId}/freight/${freightId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/containers", containerId, "freight"] });
      toast({ title: "Freight charge removed" });
    },
    onError: (e: any) => { if (e?._handledGlobally) return; toast({ title: "Failed", description: e.message, variant: "destructive" }); },
  });

  const paymentForm = useForm({
    defaultValues: { paymentDate: new Date().toLocaleDateString('en-CA'), amount: "", method: "", reference: "" },
  });

  const addPaymentMutation = useMutation({
    mutationFn: async ({ freightId, data }: { freightId: number; data: any }) => {
      const res = await apiRequest("POST", `/api/factory/freight/${freightId}/payments`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/containers", containerId, "freight"] });
      setShowPaymentDialog(null);
      paymentForm.reset({ paymentDate: new Date().toLocaleDateString('en-CA'), amount: "", method: "", reference: "" });
      toast({ title: "Payment recorded" });
    },
    onError: (e: any) => { if (e?._handledGlobally) return; toast({ title: "Failed", description: e.message, variant: "destructive" }); },
  });

  const deletePaymentMutation = useMutation({
    mutationFn: async ({ freightId, paymentId }: { freightId: number; paymentId: number }) => {
      await apiRequest("DELETE", `/api/factory/freight/${freightId}/payments/${paymentId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/containers", containerId, "freight"] });
      toast({ title: "Payment deleted" });
    },
    onError: (e: any) => { if (e?._handledGlobally) return; toast({ title: "Failed", description: e.message, variant: "destructive" }); },
  });

  const handleExportContainer = async () => {
    if (!navigator.onLine) { toast({ title: "Not available offline", description: "Exports require a connection", variant: "destructive" }); return; }
    try {
      const response = await fetch(`/api/containers/${containerId}/export`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Export failed");

      const rows: { Code: string; Name: string; Qty: string; Rate: string; Value: string }[] = [];
      for (const po of data.purchaseOrders || []) {
        for (const item of po.lineItems || []) {
          rows.push({
            Code: item.stockItemCode || "",
            Name: item.stockItemName || "",
            Qty: item.quantity || "0",
            Rate: item.rate || "0",
            Value: item.lineTotal || "0",
          });
        }
      }

      const worksheet = utils.json_to_sheet(rows);
      const workbook = utils.book_new();
      utils.book_append_sheet(workbook, worksheet, "Container Items");
      await writeFile(workbook, `container_${data.container.containerNumber}.xlsx`);

      toast({ title: "Export successful", description: "Container data downloaded as Excel" });
    } catch (error: any) {
      toast({ title: "Export failed", description: error.message, variant: "destructive" });
    }
  };

  const handleExportContainerNoCost = async () => {
    if (!navigator.onLine) { toast({ title: "Not available offline", description: "Exports require a connection", variant: "destructive" }); return; }
    try {
      const response = await fetch(`/api/containers/${containerId}/export`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Export failed");

      const supplierLabel =
        data.supplier?.code ||
        data.container?.supplierCode ||
        data.supplier?.legalName ||
        data.container?.supplierName ||
        "";
      const containerNumber = data.container?.containerNumber || "";
      const truckNumber =
        data.container?.numberPlate ||
        data.container?.truckNumber ||
        "";

      // ── build ExcelJS workbook directly for full styling support ──
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Container Items");

      // Column definitions: NO | BARCODE (hidden) | DESCRIPTION | Q'TY
      ws.columns = [
        { key: "no",   width: 6 },
        { key: "bc",   width: 20, hidden: true },
        { key: "desc", width: 70 },
        { key: "qty",  width: 18 },
      ];

      // ── Row 1: supplier label (merged A1:D1) ──
      ws.addRow([supplierLabel, "", "", ""]);
      ws.mergeCells("A1:D1");
      const r1 = ws.getRow(1);
      r1.height = 28;
      r1.eachCell((cell) => {
        cell.fill   = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1B2A4A" } };
        cell.font   = { bold: true, color: { argb: "FFFFFFFF" }, size: 13 };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border = {
          top: { style: "thin" }, bottom: { style: "thin" },
          left: { style: "thin" }, right: { style: "thin" },
        };
      });

      // ── Row 2: container (A2:C2) + truck (D2) ──
      ws.addRow([`CONTAINER: ${containerNumber}`, "", "", `TRUCK: ${truckNumber}`]);
      ws.mergeCells("A2:C2");
      const r2 = ws.getRow(2);
      r2.height = 22;
      r2.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill   = { type: "pattern", pattern: "solid", fgColor: { argb: "FFBDD7EE" } };
        cell.font   = { bold: true, size: 11 };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border = {
          top: { style: "thin" }, bottom: { style: "thin" },
          left: { style: "thin" }, right: { style: "thin" },
        };
      });

      // ── Row 3: column headers ──
      ws.addRow(["NO", "BARCODE", "DESCRIPTION", "Q'TY"]);
      const r3 = ws.getRow(3);
      r3.eachCell((cell, colNum) => {
        cell.fill   = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2E3B4E" } };
        cell.font   = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
        cell.alignment = {
          horizontal: colNum === 3 ? "left" : "center",
          vertical: "middle",
        };
        cell.border = {
          top: { style: "thin" }, bottom: { style: "thin" },
          left: { style: "thin" }, right: { style: "thin" },
        };
      });

      // ── Rows 4+: line items ──
      let idx = 1;
      for (const po of data.purchaseOrders || []) {
        for (const item of po.lineItems || []) {
          const isEven = idx % 2 === 0;
          const row = ws.addRow([
            idx,
            item.stockItemCode || "",
            item.stockItemName || "",
            parseFloat(item.quantity) || 0,
          ]);
          row.eachCell({ includeEmpty: true }, (cell, colNum) => {
            if (isEven) {
              cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F6FC" } };
            }
            cell.alignment = {
              horizontal: colNum === 3 ? "left" : "center",
              vertical: "middle",
              wrapText: colNum === 3,
            };
            cell.border = {
              top: { style: "thin" }, bottom: { style: "thin" },
              left: { style: "thin" }, right: { style: "thin" },
            };
            cell.font = { size: 10 };
          });
          idx++;
        }
      }

      // Freeze top 3 rows
      ws.views = [{ state: "frozen", xSplit: 0, ySplit: 3 }];

      // ── download ──
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `container_${containerNumber}_no_cost.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({ title: "No-cost export downloaded" });
    } catch (error: any) {
      toast({ title: "Export failed", description: error.message, variant: "destructive" });
    }
  };



  // Determine the back URL based on container status
  const backUrl = containerData?.container?.status === "SOLD" ? "/sold-containers" : "/containers";

  const form = useForm<z.infer<typeof saleFormSchema>>({
    resolver: zodResolver(saleFormSchema),
    defaultValues: {
      customerId: "",
      commission: "0.00",
      commissionAccountId: "",
      saleDate: new Date().toLocaleDateString('en-CA'),
    },
  });

  // Delete PO mutation
  const deletePOMutation = useMutation({
    mutationFn: async (poId: number) => {
      await apiRequest("DELETE", `/api/purchase-orders/${poId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/containers/${containerId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/containers/active", selectedCompany?.id] });
      toast({
        title: "Purchase Order Deleted",
        description: "The purchase order and associated data have been removed",
      });
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({
        title: "Deletion Failed",
        description: error.message || "Failed to delete purchase order",
        variant: "destructive",
      });
    },
  });

  // Delete Container mutation
  const deleteContainerMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/containers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/containers/active", selectedCompany?.id] });
      toast({
        title: "Container Deleted",
        description: "The container and all associated data have been removed",
      });
      setLocation("/containers");
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({
        title: "Deletion Failed",
        description: error.message || "Failed to delete container",
        variant: "destructive",
      });
    },
  });

  // Sync purchase voucher amounts (fixes $0 balance when items were imported after PO creation)
  const syncVoucherMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/containers/${containerId}/sync-voucher`);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: [`/api/containers/${containerId}`] });
      toast({
        title: "Voucher Synced",
        description: data.message || "Purchase voucher amounts updated successfully",
      });
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to sync voucher amounts",
        variant: "destructive",
      });
    },
  });

  // Reverse Offload mutation
  const reverseOffloadMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("POST", `/api/containers/${id}/reverse-offload`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/containers/${containerId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/containers/active", selectedCompany?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      toast({
        title: "Offload Reversed",
        description: "Container status restored to IN_TRANSIT",
      });
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({
        title: "Reverse Failed",
        description: error.message || "Failed to reverse offload",
        variant: "destructive",
      });
    },
  });

  // Sell Container mutation
  const sellContainerMutation = useMutation({
    mutationFn: async (data: z.infer<typeof saleFormSchema>) => {
      const containerCost = parseFloat(containerData?.container.grandTotal || "0");
      const commission = parseFloat(data.commission);
      const totalAmount = containerCost + commission;

      await apiRequest("POST", "/api/container-sales", {
        containerId: parseInt(containerId!),
        customerId: parseInt(data.customerId),
        saleDate: data.saleDate,
        containerCost: containerCost.toString(),
        commission: data.commission,
        commissionAccountId: data.commissionAccountId ? parseInt(data.commissionAccountId) : undefined,
        totalAmount: totalAmount.toString(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/container-sales", selectedCompany?.id] });
      queryClient.invalidateQueries({ queryKey: [`/api/containers/${containerId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/containers/active", selectedCompany?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/containers/sold", selectedCompany?.id] });
      toast({
        title: "Container Sold",
        description: "Container sale has been recorded successfully",
      });
      setShowSellDialog(false);
      form.reset();
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({
        title: "Sale Failed",
        description: error.message || "Failed to record container sale",
        variant: "destructive",
      });
    },
  });

  const handleDeletePO = async (poId: number, _poNumber: string) => {
    setPendingDelete(() => () => deletePOMutation.mutate(poId));
  };

  const handleDeleteContainer = async () => {
    setPendingDelete(() => () => deleteContainerMutation.mutate(parseInt(containerId!)));
  };

  const handleSellSubmit = async (data: z.infer<typeof saleFormSchema>) => {
    sellContainerMutation.mutate(data);
  };

  const handlePrint = async () => {
    window.print();
  };

  const saleCustomer = customers.find((c) => c.id === containerSale?.customerId);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!containerData && !isSupplierPartner) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <Package className="w-16 h-16 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">Container not found</h2>
        <Link href={backUrl}>
          <Button variant="outline">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Containers
          </Button>
        </Link>
      </div>
    );
  }

  // ── SP early return — all hooks already called above ─────────────────────
  if (isSupplierPartner) {
    const spFmt = (v: any) => {
      const n = parseFloat(String(v ?? "0"));
      return isNaN(n) ? "$0.00" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    if (spDetailLoading) {
      return (
        <div className="space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      );
    }
    if (!spContainerData || (spContainerData as any).error) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[400px]">
          <Package className="w-16 h-16 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold mb-2">Container not found</h2>
          <Link href="/containers">
            <Button variant="outline">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Containers
            </Button>
          </Link>
        </div>
      );
    }

    const spc = spContainerData as any;
    const discFactor = 1 - parseFloat(spc.discountPct || "0") / 100;
    const baseCost = (spc.lines || []).reduce(
      (s: number, l: any) => s + parseFloat(l.qty || "0") * parseFloat(l.unitRateUsd || "0") * discFactor,
      0,
    );

    return (
      <div className="space-y-4 sm:space-y-6" data-testid="sp-container-detail">
        {/* Header */}
        <div className="flex items-start gap-3 flex-wrap">
          <Link href="/containers">
            <Button variant="ghost" size="icon" data-testid="button-sp-back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-semibold truncate">
              {spc.invoiceNumber || spc.containerNumber || `Container #${spc.id}`}
            </h1>
            <p className="text-sm text-muted-foreground">{spc.supplierName}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {spc.status === "offloaded" ? (
              <Badge variant="outline" className="text-green-600 border-green-600/40">Offloaded</Badge>
            ) : (
              <Badge variant="outline" className="text-blue-600 border-blue-600/40">Open / OTW</Badge>
            )}
            {spc.status !== "offloaded" && (
              <Button onClick={() => setShowSpOffloadDialog(true)} data-testid="button-sp-offload">
                <Package className="h-4 w-4 mr-2" />
                Offload
              </Button>
            )}
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Invoice Total</p>
              <p className="font-semibold text-lg tabular-nums">{spFmt(spc.invoiceTotalUsd)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Discount</p>
              <p className="font-semibold text-lg">{spc.discountPct || "0"}%</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Base Cost (discounted)</p>
              <p className="font-semibold text-lg tabular-nums">{spFmt(baseCost)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Invoice Date</p>
              <p className="font-semibold text-lg">{spc.invoiceDate}</p>
            </CardContent>
          </Card>
        </div>

        {/* Line Items */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Line Items</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Article Code</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Rate (USD)</TableHead>
                  <TableHead className="text-right">Disc. Rate</TableHead>
                  <TableHead className="text-right">Line Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(spc.lines || []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-6 text-muted-foreground">No line items</TableCell>
                  </TableRow>
                ) : (
                  (spc.lines || []).map((line: any) => {
                    const discRate = parseFloat(line.unitRateUsd || "0") * discFactor;
                    const lineCost = parseFloat(line.qty || "0") * discRate;
                    return (
                      <TableRow key={line.id} data-testid={`row-sp-line-${line.id}`}>
                        <TableCell className="font-mono text-sm">{line.articleCode}</TableCell>
                        <TableCell className="text-sm">{line.description || "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {parseFloat(line.qty).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{spFmt(line.unitRateUsd)}</TableCell>
                        <TableCell className="text-right tabular-nums">{spFmt(discRate)}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{spFmt(lineCost)}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Prepaid Charges */}
        {(spc.prepaid || []).length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Prepaid Charges</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Amount (USD)</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(spc.prepaid || []).map((p: any) => (
                    <TableRow key={p.id}>
                      <TableCell className="text-sm capitalize">{p.chargeType}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{p.description || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{spFmt(p.amountPaidUsd)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{p.paidDate}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Offload Summary */}
        {spc.status === "offloaded" && spc.offload && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Offload Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4">
                <p className="text-xs text-muted-foreground">Offload Date</p>
                <p className="font-medium">{spc.offload.offloadDate}</p>
              </div>
              {(spc.offloadCharges || []).length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Amount (USD)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(spc.offloadCharges || []).map((c: any) => (
                      <TableRow key={c.id}>
                        <TableCell className="text-sm capitalize">{c.chargeType}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{c.description || "—"}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{spFmt(c.amountUsd)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}

        {/* Notes */}
        {spc.notes && (
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground mb-1">Notes</p>
              <p className="text-sm">{spc.notes}</p>
            </CardContent>
          </Card>
        )}

        <SpOffloadDialog
          open={showSpOffloadDialog}
          onOpenChange={setShowSpOffloadDialog}
          container={spc}
          onSuccess={() =>
            queryClient.invalidateQueries({ queryKey: [`/api/sp/containers/${containerId}`] })
          }
        />
      </div>
    );
  }

  const { container, pos, charges } = containerData;
  const supplier = suppliers.find((s: any) => s.id === container.supplierId);

  // Compute totals live from the actual PO and charges data so they are
  // always accurate, even when the stored container totals are stale.
  const itemsTotal = pos.reduce((sum: number, po: any) => sum + parseFloat(po.itemsTotal || "0"), 0);
  const chargesTotal = charges.reduce((sum: number, c: any) => sum + parseFloat(c.amount || "0"), 0);
  const grandTotal = itemsTotal + chargesTotal;
  
  // Calculate total bales from all line items
  const totalBales = pos.reduce((total: number, po: any) => {
    return total + po.items.reduce((sum: number, item: any) => {
      return sum + parseFloat(item.quantity || "0");
    }, 0);
  }, 0);

  return (
    <div className="space-y-4 p-3 sm:p-0">
      <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
        <Link href={backUrl}>
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg sm:text-2xl font-semibold truncate" data-testid="text-container-number">
            Container {container.containerNumber}
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Imported on {formatDisplayDate(container.importDate)}
          </p>
        </div>
        <Badge variant={container.status === "OTW" ? "default" : "secondary"} data-testid="badge-status">
          {container.status}
        </Badge>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {/* Actions dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="gap-2" data-testid="button-actions-dropdown">
              Actions
              <ChevronDown className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {isDeveloper && (
              <>
                <DropdownMenuItem
                  onClick={() => syncVoucherMutation.mutate()}
                  disabled={syncVoucherMutation.isPending}
                  data-testid="button-sync-voucher"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  {syncVoucherMutation.isPending ? "Syncing..." : "Sync Supplier Balance"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem
              onClick={() => setLocation(`/containers/${containerId}/verification`)}
              data-testid="button-verify-container"
            >
              <FileText className="w-4 h-4 mr-2" />
              Verify
            </DropdownMenuItem>
            {!containerSale && (
              <DropdownMenuItem
                onClick={() => setShowSellDialog(true)}
                data-testid="button-sell-container"
              >
                <HandCoins className="w-4 h-4 mr-2" />
                Sell Container
              </DropdownMenuItem>
            )}
            {container.status !== "OFFLOADED" && (
              <DropdownMenuItem
                onClick={() => setShowOffloadDialog(true)}
                data-testid="button-offload-container"
              >
                <Truck className="w-4 h-4 mr-2" />
                Offload Container
              </DropdownMenuItem>
            )}
            {container.status === "OFFLOADED" && (
              <>
                <DropdownMenuItem
                  onClick={() => setShowOffloadDialog(true)}
                  data-testid="button-edit-offload"
                >
                  <Edit className="w-4 h-4 mr-2" />
                  Edit Offload
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setPendingDelete(() => () => reverseOffloadMutation.mutate(parseInt(containerId!)))}
                  disabled={reverseOffloadMutation.isPending}
                  data-testid="button-reverse-offload"
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Reverse Offload
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Export dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="gap-2" data-testid="button-export-dropdown">
              <Download className="w-4 h-4" />
              Export
              <ChevronDown className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={handleExportContainer} data-testid="button-export-excel">
              <Download className="w-4 h-4 mr-2" />
              Full Export
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleExportContainerNoCost} data-testid="button-export-no-cost">
              <Download className="w-4 h-4 mr-2" />
              No Cost / Freight Export
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handlePrint} data-testid="button-export-pdf">
              <Printer className="w-4 h-4 mr-2" />
              Export PDF
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => { setPriceImportPreview(null); setPriceImportError(null); setShowPriceImportDialog(true); }}
              data-testid="button-import-pricing"
            >
              <Upload className="w-4 h-4 mr-2" />
              Import Pricing (Excel)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="destructive"
          onClick={handleDeleteContainer}
          disabled={deleteContainerMutation.isPending}
          className="gap-2"
          data-testid="button-delete-container"
        >
          <Trash2 className="w-4 h-4" />
          <span className="hidden sm:inline">Delete Container</span>
          <span className="sm:hidden">Delete</span>
        </Button>
      </div>

      {containerSale && (
        <Card className="border-green-500">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HandCoins className="h-5 w-5 text-green-600" />
              Container Sold
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Sold to</p>
                <p className="font-semibold" data-testid="text-sale-customer">
                  {saleCustomer?.legalName || "Unknown Customer"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Sale Date</p>
                <p className="font-semibold" data-testid="text-sale-date">
                  {formatDisplayDate(containerSale.saleDate)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Sale Price</p>
                <p className="font-semibold" data-testid="text-sale-price">
                  {formatAmount(containerSale.containerCost)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Commission</p>
                <p className="font-semibold" data-testid="text-sale-commission">
                  {formatAmount(containerSale.commission)}
                </p>
              </div>
            </div>
            <div className="pt-2 border-t">
              <p className="text-sm text-muted-foreground">Total Amount</p>
              <p className="text-xl font-bold" data-testid="text-sale-total">
                {formatAmount(containerSale.totalAmount)}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Supplier</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-lg font-semibold" data-testid="text-supplier">
              {supplier ? supplier.legalName : "Unknown"}
            </div>
            {supplier && (
              <p className="text-xs text-muted-foreground">{supplier.code}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Items Total</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-items-total">
              {formatAmount(itemsTotal)}
            </div>
            <p className="text-xs text-muted-foreground">
              {pos.reduce((sum: number, po: any) => sum + po.items.length, 0)} items in {pos.length} PO(s)
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Grand Total</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-grand-total">
              {formatAmount(grandTotal)}
            </div>
            <p className="text-xs text-muted-foreground">
              Including {formatAmount(Math.abs(chargesTotal))} in charges
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Purchase Orders & Items</CardTitle>
        </CardHeader>
        <CardContent>
          {pos.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">No purchase orders found</p>
          ) : (
            <div className="space-y-6">
              {pos.map((po: any) => (
                <div key={po.id} className="space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <h3 className="text-base sm:text-lg font-semibold" data-testid={`text-po-${po.poNumber}`}>
                      PO: {po.poNumber}
                    </h3>
                    <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
                      <div className="text-sm">
                        <span className="text-muted-foreground">Currency: </span>
                        <span className="font-medium">{po.currency}</span>
                        <span className="text-muted-foreground ml-2 sm:ml-4">Total: </span>
                        <span className="font-semibold">{formatAmount(po.itemsTotal)}</span>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setLocation(`/purchase-orders/${po.id}/edit`)}
                        data-testid={`button-edit-po-${po.id}`}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDeletePO(po.id, po.poNumber)}
                        disabled={deletePOMutation.isPending}
                        data-testid={`button-delete-po-${po.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="rounded-md border hidden md:block">
                    <Table>
                      <TableHeader className="sticky top-0 z-30 bg-background">
                        <TableRow>
                          <TableHead>Item Name</TableHead>
                          <TableHead className="text-right">Quantity</TableHead>
                          <TableHead className="text-right">Rate</TableHead>
                          <TableHead className="text-right">Line Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {po.items.map((item: any) => (
                          <TableRow key={item.id} data-testid={`row-item-${item.id}`}>
                            <TableCell className="font-medium">{item.itemName}</TableCell>
                            <TableCell className="text-right">{item.quantity}</TableCell>
                            <TableCell className="text-right">{formatAmount(item.rate)}</TableCell>
                            <TableCell className="text-right font-semibold">
                              {formatAmount(item.lineTotal)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="md:hidden space-y-2">
                    {po.items.map((item: any) => (
                      <div key={item.id} className="p-3 rounded-md border text-sm" data-testid={`row-item-${item.id}`}>
                        <div className="font-medium mb-1">{item.itemName}</div>
                        <div className="grid grid-cols-3 gap-2 text-muted-foreground">
                          <div>
                            <div className="text-xs">Qty</div>
                            <div className="font-mono">{item.quantity}</div>
                          </div>
                          <div>
                            <div className="text-xs">Rate</div>
                            <div className="font-mono">{formatAmount(item.rate)}</div>
                          </div>
                          <div>
                            <div className="text-xs">Total</div>
                            <div className="font-mono font-semibold">{formatAmount(item.lineTotal)}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Per-PO charges: show any non-zero charge inline */}
                  {(() => {
                    const poCharges = [
                      { label: "Freight", value: parseFloat(po.freight || "0") },
                      { label: "Surcharge", value: parseFloat(po.surcharge || "0") },
                      { label: "Fumigation", value: parseFloat(po.fumigation || "0") },
                      { label: "Document Charges", value: parseFloat(po.documentCharges || "0") },
                      { label: "Other Charges", value: parseFloat(po.otherCharges || "0") },
                      { label: "Discount", value: -parseFloat(po.discount || "0") },
                    ].filter(c => Math.abs(c.value) > 0.001);
                    if (poCharges.length === 0) return null;
                    return (
                      <div className="mt-2 rounded-md border bg-muted/30 px-4 py-2 space-y-1" data-testid={`po-charges-${po.id}`}>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Charges</p>
                        {poCharges.map(c => (
                          <div key={c.label} className="flex justify-between text-sm">
                            <span className="text-muted-foreground">{c.label}</span>
                            <span className={`font-mono font-medium ${c.value < 0 ? "text-red-500" : ""}`}>{formatAmount(c.value)}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Items Total:</span>
              <span className="font-semibold">{formatAmount(itemsTotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Charges Total:</span>
              <span className="font-semibold">{formatAmount(chargesTotal)}</span>
            </div>
            <div className="flex justify-between pt-2 border-t">
              <span className="text-lg font-bold">Grand Total:</span>
              <span className="text-lg font-bold">{formatAmount(grandTotal)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <OffloadDialog
        open={showOffloadDialog}
        onOpenChange={setShowOffloadDialog}
        containerId={parseInt(containerId!)}
        containerNumber={container.containerNumber}
        totalBales={totalBales}
      />

      <Dialog open={showSellDialog} onOpenChange={setShowSellDialog}>
        <DialogContent data-testid="dialog-sell-container">
          <DialogHeader>
            <DialogTitle>Sell Container</DialogTitle>
            <DialogDescription>
              Record the sale of container {container.containerNumber} to a customer.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form noValidate onSubmit={form.handleSubmit(handleSellSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="customerId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Customer</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-customer">
                          <SelectValue placeholder="Select a customer" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {customers.map((customer) => (
                          <SelectItem key={customer.id} value={customer.id.toString()}>
                            {customer.legalName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="saleDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sale Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} data-testid="input-sale-date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="rounded-md border p-4 bg-muted/50">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-medium">Container Cost</span>
                  <span className="text-lg font-bold">{formatAmount(grandTotal)}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Full balance will be charged to customer
                </p>
              </div>

              <FormField
                control={form.control}
                name="commission"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Commission</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        {...field}
                        data-testid="input-commission"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="commissionAccountId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Commission Account (Optional)</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-commission-account">
                          <SelectValue placeholder="Default commission account" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {incomeAccounts.map((account) => (
                          <SelectItem key={account.id} value={account.id.toString()}>
                            {account.name} ({account.code})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Leave empty to use default commission revenue account
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowSellDialog(false)}
                  data-testid="button-cancel-sale"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={sellContainerMutation.isPending}
                  data-testid="button-submit-sale"
                >
                  {sellContainerMutation.isPending ? "Processing..." : "Record Sale"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
        <DialogContent data-testid="dialog-upload-doc">
          <DialogHeader>
            <DialogTitle>Upload Document</DialogTitle>
            <DialogDescription>Upload a document for this container</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Document Type</label>
              <Select value={uploadDocTypeId} onValueChange={setUploadDocTypeId}>
                <SelectTrigger data-testid="select-doc-type">
                  <SelectValue placeholder="Select document type" />
                </SelectTrigger>
                <SelectContent>
                  {(docsData?.docTypes || []).map((dt: any) => (
                    <SelectItem key={dt.id} value={String(dt.id)}>{dt.label}{dt.isRequired ? " *" : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">File</label>
              <Input
                type="file"
                ref={fileInputRef}
                onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                data-testid="input-doc-file"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowUploadDialog(false)} data-testid="button-cancel-upload">Cancel</Button>
              <Button
                disabled={!uploadDocTypeId || !uploadFile || uploadDocMutation.isPending}
                onClick={() => uploadDocMutation.mutate({ docTypeId: Number(uploadDocTypeId), file: uploadFile! })}
                data-testid="button-submit-upload"
              >
                {uploadDocMutation.isPending ? "Uploading..." : "Upload"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showFreightDialog} onOpenChange={setShowFreightDialog}>
        <DialogContent data-testid="dialog-add-freight">
          <DialogHeader>
            <DialogTitle>Add Freight Charge</DialogTitle>
            <DialogDescription>Record a freight/shipping charge for this container</DialogDescription>
          </DialogHeader>
          <form noValidate
            onSubmit={freightForm.handleSubmit((data) => addFreightMutation.mutate(data))}
            className="space-y-4"
          >
            <div>
              <label className="text-sm font-medium">Vendor Name</label>
              <Input {...freightForm.register("vendorName")} placeholder="Shipping company" data-testid="input-freight-vendor" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-sm font-medium">Amount</label>
                <Input {...freightForm.register("freightAmount")} type="number" step="0.01" placeholder="0.00" data-testid="input-freight-amount" />
              </div>
              <div>
                <label className="text-sm font-medium">Currency</label>
                <Select value={freightForm.watch("currency")} onValueChange={(v) => freightForm.setValue("currency", v)}>
                  <SelectTrigger data-testid="select-freight-currency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="XOF">XOF (CFA)</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Due Date (optional)</label>
              <Input {...freightForm.register("dueDate")} type="date" data-testid="input-freight-due" />
            </div>
            <div>
              <label className="text-sm font-medium">Notes (optional)</label>
              <Textarea {...freightForm.register("notes")} placeholder="Additional details" data-testid="input-freight-notes" />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowFreightDialog(false)} data-testid="button-cancel-freight">Cancel</Button>
              <Button type="submit" disabled={addFreightMutation.isPending} data-testid="button-submit-freight">
                {addFreightMutation.isPending ? "Adding..." : "Add Freight"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={showPaymentDialog !== null} onOpenChange={(open) => { if (!open) setShowPaymentDialog(null); }}>
        <DialogContent data-testid="dialog-add-payment">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
            <DialogDescription>Record a payment toward this freight charge</DialogDescription>
          </DialogHeader>
          <form noValidate
            onSubmit={paymentForm.handleSubmit((data) => {
              if (showPaymentDialog !== null) addPaymentMutation.mutate({ freightId: showPaymentDialog, data });
            })}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-sm font-medium">Payment Date</label>
                <Input {...paymentForm.register("paymentDate")} type="date" data-testid="input-payment-date" />
              </div>
              <div>
                <label className="text-sm font-medium">Amount</label>
                <Input {...paymentForm.register("amount")} type="number" step="0.01" placeholder="0.00" data-testid="input-payment-amount" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-sm font-medium">Method</label>
                <Select value={paymentForm.watch("method")} onValueChange={(v) => paymentForm.setValue("method", v)}>
                  <SelectTrigger data-testid="select-payment-method">
                    <SelectValue placeholder="Select method" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Cash">Cash</SelectItem>
                    <SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
                    <SelectItem value="Mobile Money">Mobile Money</SelectItem>
                    <SelectItem value="Check">Check</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">Reference</label>
                <Input {...paymentForm.register("reference")} placeholder="Transaction ref" data-testid="input-payment-reference" />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowPaymentDialog(null)} data-testid="button-cancel-payment">Cancel</Button>
              <Button type="submit" disabled={addPaymentMutation.isPending} data-testid="button-submit-payment">
                {addPaymentMutation.isPending ? "Recording..." : "Record Payment"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <DeleteConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        onConfirm={() => { pendingDelete?.(); setPendingDelete(null); }}
      />

      {/* Price Import Dialog */}
      <Dialog open={showPriceImportDialog} onOpenChange={(open) => {
        if (!open) { setPriceImportPreview(null); setPriceImportError(null); }
        setShowPriceImportDialog(open);
      }}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Import Pricing from Excel</DialogTitle>
            <DialogDescription>
              Upload an Excel file with columns <strong>barcode</strong> and <strong>price</strong>. Review the preview, then save to apply.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 flex-1 overflow-hidden">
            {/* File upload area */}
            <div
              className="border-2 border-dashed rounded-md p-6 flex flex-col items-center gap-3 cursor-pointer hover-elevate"
              onClick={() => priceImportFileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (file) handlePriceImportFile(file);
              }}
              data-testid="dropzone-price-import"
            >
              <Upload className="w-8 h-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground text-center">
                Click or drag an Excel file here<br />
                <span className="text-xs">Columns: <code>barcode</code> and <code>price</code> (or A/B if no headers)</span>
              </p>
              <input
                ref={priceImportFileRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                data-testid="input-price-import-file"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handlePriceImportFile(file);
                  e.target.value = "";
                }}
              />
            </div>

            {(priceImportParsing || pricePreviewMutation.isPending) && (
              <p className="text-sm text-muted-foreground text-center">Reading file and fetching preview…</p>
            )}

            {priceImportError && (
              <p className="text-sm text-destructive">{priceImportError}</p>
            )}

            {/* Preview table */}
            {priceImportPreview && priceImportPreview.length > 0 && (
              <div className="overflow-auto flex-1 border rounded-md">
                <Table>
                  <TableHeader className="sticky top-0 z-30 bg-background">
                    <TableRow>
                      <TableHead>Code / Barcode</TableHead>
                      <TableHead>Item Name</TableHead>
                      <TableHead>Current Rate</TableHead>
                      <TableHead>New Rate</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {priceImportPreview.map((row: any, i: number) => (
                      <TableRow key={i} data-testid={`row-price-preview-${i}`}>
                        <TableCell className="font-mono text-xs">{row.barcode}</TableCell>
                        <TableCell className="text-sm">{row.itemName || "—"}</TableCell>
                        <TableCell className="text-sm">
                          {row.currentRate != null ? row.currentRate.toFixed(2) : "—"}
                        </TableCell>
                        <TableCell className="text-sm font-medium">
                          {row.newRate != null ? row.newRate.toFixed(2) : "—"}
                        </TableCell>
                        <TableCell>
                          {row.status === "will_update" && <Badge variant="default" data-testid={`status-preview-${i}`}>Will Update</Badge>}
                          {row.status === "no_change" && <Badge variant="secondary" data-testid={`status-preview-${i}`}>No Change</Badge>}
                          {row.status === "not_found" && <Badge variant="destructive" data-testid={`status-preview-${i}`}>Not Found</Badge>}
                          {row.status === "not_in_container" && <Badge variant="secondary" data-testid={`status-preview-${i}`}>Not in Container</Badge>}
                          {row.status === "invalid_price" && <Badge variant="destructive" data-testid={`status-preview-${i}`}>Invalid Price</Badge>}
                          {row.status === "invalid" && <Badge variant="destructive" data-testid={`status-preview-${i}`}>Invalid Row</Badge>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {priceImportPreview && priceImportPreview.length === 0 && (
              <p className="text-sm text-muted-foreground text-center">No rows found in the file.</p>
            )}
          </div>

          {priceImportPreview && priceImportPreview.some((r: any) => r.status === "will_update") && (
            <div className="flex justify-between items-center pt-2 border-t gap-2 flex-wrap">
              <p className="text-sm text-muted-foreground">
                {priceImportPreview.filter((r: any) => r.status === "will_update").length} item(s) will be updated
                {priceImportPreview.some((r: any) => r.status === "not_found") && ` · ${priceImportPreview.filter((r: any) => r.status === "not_found").length} not found`}
                {priceImportPreview.some((r: any) => r.status === "not_in_container") && ` · ${priceImportPreview.filter((r: any) => r.status === "not_in_container").length} not in this container`}
              </p>
              <Button
                onClick={() => {
                  const rows = priceImportPreview
                    .filter((r: any) => r.status === "will_update" && r.lineItemIds?.length)
                    .map((r: any) => ({ lineItemIds: r.lineItemIds, newRate: r.newRate }));
                  priceApplyMutation.mutate(rows);
                }}
                disabled={priceApplyMutation.isPending}
                data-testid="button-save-price-import"
              >
                {priceApplyMutation.isPending ? "Saving…" : "Save Changes"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
