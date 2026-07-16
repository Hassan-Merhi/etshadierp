import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { useLocation } from "wouter";
import { useCompany } from "@/contexts/CompanyContext";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { useAppMode, useModePrefix } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";
import { queryClient, keyStartsWith } from "@/lib/queryClient";
import { formatNumber } from "@/lib/formatNumber";
import { utils, writeFile } from "@/lib/excelHelper";
import { parseDateLocal } from "@/components/vouchers/PrintTemplate";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  LayoutGrid,
  Upload,
  FileDown,
  ChevronDown,
  ChevronUp,
  GitBranch,
  X,
  Plus,
  History,
  Loader2,
  Search,
  CheckCircle,
  XCircle,
  Download,
  FileSpreadsheet,
} from "lucide-react";

interface StockItem {
  id: number;
  code: string;
  name: string;
  uom: string;
}
interface Location {
  id: number;
  code?: string;
  name: string;
}

const stockTransferEntrySchema = z.object({
  sourceLocationId: z.coerce.number(),
  sourceLocationName: z.string(),
  stockItemId: z.coerce.number(),
  stockItemCode: z.string().default(""),
  stockItemName: z.string(),
  quantity: z.string(),
  rate: z.string(),
});
const stockTransferFormSchema = z.object({
  voucherDate: z.date(),
  destinationLocationId: z.number(),
  entries: z.array(stockTransferEntrySchema),
  notes: z.string().optional(),
  optional: z.boolean().default(false),
});
type StockTransferFormData = z.infer<typeof stockTransferFormSchema>;

interface StockTransferFormProps {
  voucherIdToEdit: number | null;
  isPOS: boolean;
  posUser?: { assignedLocationId?: number };
}

export function StockTransferForm({ voucherIdToEdit, isPOS, posUser }: StockTransferFormProps) {
  const { toast } = useToast();
  const { selectedCompany } = useCompany();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);
  const modePrefix = useModePrefix();
  const { formatAmount } = useCurrencyContext();
  const [, setLocation] = useLocation();
  const posLocationId = posUser?.assignedLocationId;
  const hydratedVoucherIdRef = useRef<number | null>(null);
  const lastKnownTransferIdRef = useRef<number | null>(null);

  const { data: stockItems = [] } = useQuery<StockItem[]>({
    queryKey: ["/api/stock-items", selectedCompany?.id],
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations", selectedCompany?.id],
  });
  const { data: myLocations = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/my-locations"],
    enabled: isPOS,
  });

  const posLocation = isPOS && posLocationId ? locations.find((l) => l.id === posLocationId) : null;
  const posLocationName = posLocation?.name || "";

  const { data: voucherToEdit } = useQuery({
    queryKey: ["/api/vouchers", voucherIdToEdit],
    enabled: !!voucherIdToEdit,
    queryFn: async () => {
      const res = await fetch(`/api/vouchers/${voucherIdToEdit}`);
      if (!res.ok) throw new Error("Failed to fetch voucher");
      return res.json();
    },
  });

  const { data: stockTransferToEdit } = useQuery({
    queryKey: ["/api/stock-transfers", voucherIdToEdit],
    enabled: !!voucherIdToEdit,
    queryFn: async () => {
      const res = await fetch(`/api/stock-transfers?voucherId=${voucherIdToEdit}`);
      if (!res.ok) throw new Error("Failed to fetch stock transfer");
      const data = await res.json();
      return Array.isArray(data) ? data[0] : data;
    },
    staleTime: 15000,
  });

  if (stockTransferToEdit?.id) lastKnownTransferIdRef.current = stockTransferToEdit.id;
  const stableTransferId = stockTransferToEdit?.id ?? lastKnownTransferIdRef.current;

  const { data: transferRevisions = [] } = useQuery<any[]>({
    queryKey: ["/api/stock-transfers", stableTransferId, "revisions"],
    queryFn: async () => {
      const res = await fetch(`/api/stock-transfers/${stableTransferId}/revisions`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch revisions");
      return res.json();
    },
    enabled: !!stableTransferId,
  });

  const stockTransferForm = useForm<StockTransferFormData>({
    resolver: zodResolver(stockTransferFormSchema),
    defaultValues: {
      voucherDate: new Date(),
      destinationLocationId: 0,
      entries: [
        {
          sourceLocationId: 0,
          sourceLocationName: "",
          stockItemId: 0,
          stockItemCode: "",
          stockItemName: "",
          quantity: "",
          rate: "",
        },
      ],
      notes: "",
      optional: false,
    },
  });

  const {
    fields: transferFields,
    append: appendTransfer,
    remove: removeTransfer,
  } = useFieldArray({
    control: stockTransferForm.control,
    name: "entries",
  });
  const transferEntries = stockTransferForm.watch("entries");
  const transferTotal = transferEntries.reduce(
    (sum, entry) => sum + parseFloat(entry.quantity || "0") * parseFloat(entry.rate || "0"),
    0
  );

  const [activeTransferRow, setActiveTransferRow] = useState<number | null>(null);
  const [transferInventorySource, setTransferInventorySource] = useState<number | null>(
    isPOS && posLocationId ? posLocationId : null
  );
  const [transferSearchTerm, setTransferSearchTerm] = useState("");
  const [transferHighlightedIndex, setTransferHighlightedIndex] = useState(0);
  const [transferSourceSearchTerm, setTransferSourceSearchTerm] = useState("");
  const [transferSourceHighlightedIndex, setTransferSourceHighlightedIndex] = useState(0);
  const [showSourceSidebar, setShowSourceSidebar] = useState(false);
  const [showItemSidebar, setShowItemSidebar] = useState(false);
  const [activeFieldType, setActiveFieldType] = useState<"source" | "item" | null>(null);
  const transferSidebarRef = useRef<HTMLDivElement>(null);
  const transferFocusIdRef = useRef(0);

  const [posSelectedSourceId, setPosSelectedSourceId] = useState<number | null>(posLocationId ?? null);
  const posSelectedSourceName = isPOS
    ? locations.find((l) => l.id === posSelectedSourceId)?.name || posLocationName
    : "";

  const [transferRevisionDialogOpen, setTransferRevisionDialogOpen] = useState(false);
  const [transferRevisionNote, setTransferRevisionNote] = useState("");
  const [isTransferSavingRevision, setIsTransferSavingRevision] = useState(false);
  const [transferRevisionsExpanded, setTransferRevisionsExpanded] = useState(false);
  const [approveRevisionTarget, setApproveRevisionTarget] = useState<any | null>(null);
  const [transferQtyDraft, setTransferQtyDraft] = useState<Record<number | string, string>>({});

  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<any>(null);
  const [importValidationResult, setImportValidationResult] = useState<any>(null);
  const [importDestLocation, setImportDestLocation] = useState<string>("");
  const [importDate, setImportDate] = useState<string>(new Date().toLocaleDateString("en-CA"));
  const [importNotes, setImportNotes] = useState<string>("");
  const [importConfirmDialogOpen, setImportConfirmDialogOpen] = useState(false);

  const importIsValidated = importValidationResult !== null;
  const importHasErrors = importValidationResult?.errors && importValidationResult.errors.length > 0;
  const importValidItems = importValidationResult?.validatedItems?.filter((item: any) => !item.error) || [];
  const importValidItemsCount = importValidItems.length;
  const importTotalItemsCount = importValidationResult?.validatedItems?.length || 0;

  const { data: transferInventory = [] } = useQuery<any[]>({
    queryKey: transferInventorySource ? [`/api/locations/${transferInventorySource}/inventory`] : [],
    enabled: !!transferInventorySource && transferInventorySource > 0,
  });

  useEffect(() => {
    if (isPOS && posSelectedSourceId && posSelectedSourceName) {
      const entries = stockTransferForm.getValues("entries");
      entries.forEach((_, index) => {
        stockTransferForm.setValue(`entries.${index}.sourceLocationId`, posSelectedSourceId);
        stockTransferForm.setValue(`entries.${index}.sourceLocationName`, posSelectedSourceName);
      });
      setTransferInventorySource(posSelectedSourceId);
    }
  }, [isPOS, posSelectedSourceId, posSelectedSourceName]); // eslint-disable-line

  useEffect(() => {
    transferEntries.forEach((entry, index) => {
      if (entry.sourceLocationId > 0 && entry.stockItemId > 0 && !entry.rate) {
        fetch(`/api/locations/${entry.sourceLocationId}/inventory`)
          .then((res) => res.json())
          .then((inventory) => {
            const inv = inventory.find((item: any) => item.stockItemId === entry.stockItemId);
            if (inv?.averageRate) stockTransferForm.setValue(`entries.${index}.rate`, inv.averageRate);
          })
          .catch(() => {});
      }
    });
  }, [transferEntries.map((e) => `${e.sourceLocationId}-${e.stockItemId}`).join(",")]); // eslint-disable-line

  useEffect(() => {
    if (
      stockTransferToEdit &&
      stockTransferToEdit.items &&
      voucherToEdit &&
      locations.length > 0 &&
      stockItems.length > 0
    ) {
      if (hydratedVoucherIdRef.current === voucherIdToEdit) return;
      const formEntries = stockTransferToEdit.items.map((item: any) => {
        const sourceLocation = locations.find((l) => l.id === item.sourceLocationId);
        const stockItem = stockItems.find((s) => s.id === item.stockItemId);
        return {
          sourceLocationId: item.sourceLocationId || 0,
          sourceLocationName: sourceLocation?.name || "",
          stockItemId: item.stockItemId || 0,
          stockItemCode: stockItem?.code || "",
          stockItemName: stockItem?.name || "",
          quantity: item.quantity || "0",
          rate: item.rate || "0",
        };
      });
      stockTransferForm.reset({
        voucherDate: voucherToEdit ? parseDateLocal(voucherToEdit.voucherDate) : new Date(),
        destinationLocationId: stockTransferToEdit.destinationLocationId || 0,
        entries:
          formEntries.length > 0
            ? formEntries
            : [
                {
                  sourceLocationId: 0,
                  sourceLocationName: "",
                  stockItemId: 0,
                  stockItemCode: "",
                  stockItemName: "",
                  quantity: "",
                  rate: "",
                },
              ],
        notes: stockTransferToEdit.notes || "",
        optional: voucherToEdit?.optional || false,
      });
      hydratedVoucherIdRef.current = voucherIdToEdit;
    }
  }, [stockTransferToEdit, voucherToEdit, locations, stockItems, stockTransferForm]); // eslint-disable-line

  useEffect(() => {
    if (showItemSidebar && transferSidebarRef.current) {
      const container = transferSidebarRef.current;
      const highlighted = container.querySelector(`[data-transfer-idx="${transferHighlightedIndex}"]`);
      if (highlighted) highlighted.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [transferHighlightedIndex, showItemSidebar]);

  const approveRevisionMutation = useMutation({
    mutationFn: async (revisionId: number) => {
      return modeApiRequest("POST", `/api/stock-transfer-revisions/${revisionId}/approve`, {});
    },
    onSuccess: () => {
      toast({ title: "Revision approved", description: "Quantities have been updated." });
      setApproveRevisionTarget(null);
      setTransferRevisionsExpanded(true);
      hydratedVoucherIdRef.current = null;
      queryClient.invalidateQueries({
        queryKey: ["/api/stock-transfers", lastKnownTransferIdRef.current, "revisions"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers", voucherIdToEdit] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers/list"] });
    },
    onError: (err: any) => {
      toast({ title: "Approval failed", description: err.message, variant: "destructive" });
    },
  });

  const importParseMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const res = await fetch("/api/stock-transfer-import/parse-multi-source", { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to parse file");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setImportPreview(data);
      setImportValidationResult(null);
      toast({
        title: "File parsed successfully",
        description: `Found ${data.items.length} item(s). Click Validate to check the data.`,
      });
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({ title: "Parse error", description: error.message, variant: "destructive" });
    },
  });

  const importValidateMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await modeApiRequest("POST", "/api/stock-transfer-import/validate-multi-source", data);
      return res.json();
    },
    onSuccess: (data) => {
      setImportValidationResult(data);
      const errorCount = data.errors?.length || 0;
      if (errorCount === 0) {
        toast({
          title: "Validation passed",
          description: "All items validated successfully. You can now import the data.",
        });
      } else {
        toast({
          title: "Validation issues found",
          description: `Found ${errorCount} issue(s). Please review before importing.`,
          variant: "destructive",
        });
      }
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({ title: "Validation error", description: error.message, variant: "destructive" });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await modeApiRequest("POST", "/api/stock-transfer-import/import-multi-source", data);
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Import successful", description: `${data.itemsCount} items transferred successfully.` });
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-by-location"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daybook"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/daybook"] });
      queryClient.invalidateQueries({ queryKey: ["/api/location-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers/list"] });
      setImportDialogOpen(false);
      setImportFile(null);
      setImportPreview(null);
      setImportValidationResult(null);
      setImportDestLocation("");
      setImportNotes("");
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({ title: "Import error", description: error.message, variant: "destructive" });
    },
  });

  const stockTransferMutation = useMutation({
    mutationFn: async (data: StockTransferFormData) => {
      const isEditMode = !!voucherIdToEdit;
      const validEntries = data.entries.filter(
        (e) => e.stockItemId > 0 && e.sourceLocationId > 0 && parseFloat(e.quantity || "0") > 0
      );
      const totalAmount = validEntries
        .reduce((sum, e) => sum + parseFloat(e.quantity || "0") * parseFloat(e.rate || "0"), 0)
        .toString();

      if (isEditMode) {
        const destLoc = locations.find((l) => l.id === data.destinationLocationId);
        await modeApiRequest("PATCH", `/api/vouchers/${voucherIdToEdit}`, {
          voucherDate: format(data.voucherDate, "yyyy-MM-dd"),
          description: `Stock transfer to ${destLoc?.name || ""}`,
          totalAmount,
          optional: data.optional,
        });
        if (stockTransferToEdit?.id) {
          await modeApiRequest("PUT", `/api/stock-transfers/${stockTransferToEdit.id}`, {
            destinationLocationId: data.destinationLocationId,
            notes: data.notes || "",
            items: validEntries.map((e) => ({
              stockItemId: e.stockItemId,
              sourceLocationId: e.sourceLocationId,
              quantity: e.quantity,
              rate: e.rate,
            })),
          });
        }
        return { id: voucherIdToEdit };
      } else {
        const destLoc = locations.find((l) => l.id === data.destinationLocationId);
        const voucherRes = await modeApiRequest("POST", "/api/vouchers", {
          companyId: selectedCompany?.id,
          voucherType: "Transfer",
          voucherNumber: `TRANSFER-${Date.now()}`,
          voucherDate: format(data.voucherDate, "yyyy-MM-dd"),
          description: `Stock transfer to ${destLoc?.name || ""}`,
          totalAmount,
          optional: data.optional,
        });
        const voucher = await voucherRes.json();
        await modeApiRequest("POST", "/api/stock-transfers", {
          voucherId: voucher.id,
          destinationLocationId: data.destinationLocationId,
          notes: data.notes || "",
          items: validEntries.map((e) => ({
            stockItemId: e.stockItemId,
            sourceLocationId: e.sourceLocationId,
            quantity: e.quantity,
            rate: e.rate,
          })),
        });
        return voucher;
      }
    },
    onSuccess: () => {
      const isEditMode = !!voucherIdToEdit;
      toast({ title: "Success", description: `Stock transfer ${isEditMode ? "updated" : "created"} successfully` });
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daybook"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/daybook"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-by-location"] });
      queryClient.invalidateQueries({ queryKey: ["/api/location-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers/list"] });
      if (isEditMode) {
        setLocation(`${modePrefix}/daybook`);
      } else {
        stockTransferForm.reset({
          voucherDate: new Date(),
          destinationLocationId: 0,
          entries: [
            {
              sourceLocationId: 0,
              sourceLocationName: "",
              stockItemId: 0,
              stockItemCode: "",
              stockItemName: "",
              quantity: "",
              rate: "",
            },
          ],
          notes: "",
        });
      }
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      const isEditMode = !!voucherIdToEdit;
      toast({
        title: "Error",
        description: error.message || `Failed to ${isEditMode ? "update" : "create"} stock transfer`,
        variant: "destructive",
      });
    },
  });

  const computeTransferRevisionItems = () => {
    if (!stockTransferToEdit?.items) return [];
    type RevKey = string;
    const originalMap = new Map<
      RevKey,
      { qty: number; stockItemId: number; stockItemName: string; sourceLocationId: number; sourceLocationName: string }
    >();
    for (const item of stockTransferToEdit.items) {
      const key: RevKey = `${item.stockItemId}-${item.sourceLocationId ?? "null"}`;
      const si = stockItems.find((s: any) => s.id === item.stockItemId);
      const sl = locations.find((l: any) => l.id === item.sourceLocationId);
      originalMap.set(key, {
        qty: parseFloat(item.quantity) || 0,
        stockItemId: item.stockItemId,
        stockItemName: si?.name || "",
        sourceLocationId: item.sourceLocationId ?? null,
        sourceLocationName: sl?.name || "",
      });
    }
    const currentEntries = stockTransferForm.getValues("entries");
    const currentMap = new Map<RevKey, (typeof currentEntries)[0]>();
    for (const entry of currentEntries) {
      if (!entry.stockItemId || entry.stockItemId <= 0) continue;
      const key: RevKey = `${entry.stockItemId}-${entry.sourceLocationId ?? "null"}`;
      currentMap.set(key, entry);
    }
    const allKeys = new Set([...originalMap.keys(), ...currentMap.keys()]);
    const result: Array<{
      stockItemId: number;
      stockItemName: string;
      sourceLocationId: number | null;
      sourceLocationName: string;
      originalQuantity: number;
      delta: number;
      newQuantity: number;
    }> = [];
    for (const key of allKeys) {
      const orig = originalMap.get(key);
      const cur = currentMap.get(key);
      const origQty = orig?.qty ?? 0;
      const curQty = parseFloat(cur?.quantity || "0");
      const delta = curQty - origQty;
      if (Math.abs(delta) < 0.001) continue;
      result.push({
        stockItemId: cur?.stockItemId ?? orig?.stockItemId ?? 0,
        stockItemName: cur?.stockItemName || orig?.stockItemName || "",
        sourceLocationId: cur?.sourceLocationId ?? orig?.sourceLocationId ?? null,
        sourceLocationName: cur?.sourceLocationName || orig?.sourceLocationName || "",
        originalQuantity: origQty,
        delta,
        newQuantity: curQty,
      });
    }
    return result;
  };

  const handleTransferSaveAsRevision = () => {
    if (!voucherIdToEdit || !stockTransferToEdit?.id) return;
    setTransferRevisionDialogOpen(true);
  };

  const confirmTransferSaveAsRevision = async () => {
    const revisionItems = computeTransferRevisionItems();
    if (revisionItems.length === 0) {
      toast({
        title: "No Changes",
        description: "No differences found compared to the saved order",
        variant: "destructive",
      });
      setTransferRevisionDialogOpen(false);
      return;
    }
    setIsTransferSavingRevision(true);
    try {
      await stockTransferForm.handleSubmit(async (data) => {
        await onStockTransferSubmit(data);
      })();
      await modeApiRequest("POST", `/api/stock-transfers/${stockTransferToEdit!.id}/revisions`, {
        note: transferRevisionNote.trim() || null,
        items: revisionItems,
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/stock-transfers", lastKnownTransferIdRef.current, "revisions"],
      });
      setTransferRevisionNote("");
      setTransferRevisionDialogOpen(false);
      setTransferRevisionsExpanded(true);
      const nextRevNum = transferRevisions.length + 1;
      toast({ title: "Revision Saved", description: `Rev ${nextRevNum} recorded and transfer updated` });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to save revision", variant: "destructive" });
    } finally {
      setIsTransferSavingRevision(false);
    }
  };

  const onStockTransferSubmit = async (data: StockTransferFormData) => {
    if (!data.destinationLocationId || data.destinationLocationId <= 0) {
      toast({ title: "Validation Error", description: "Please select a destination location", variant: "destructive" });
      return;
    }
    const validEntries = data.entries.filter(
      (e) => e.stockItemId > 0 && e.sourceLocationId > 0 && parseFloat(e.quantity || "0") > 0
    );
    if (validEntries.length === 0) {
      toast({
        title: "Validation Error",
        description: "Please add at least one valid entry with source location, item, and quantity",
        variant: "destructive",
      });
      return;
    }
    const entriesWithMissingRates = validEntries.filter((e) => !e.rate || e.rate === "" || e.rate === "0");
    if (entriesWithMissingRates.length > 0) {
      const ratePromises = entriesWithMissingRates.map(async (entry) => {
        try {
          const res = await fetch(`/api/locations/${entry.sourceLocationId}/inventory`);
          if (res.ok) {
            const inventory = await res.json();
            const inv = inventory.find((item: any) => item.stockItemId === entry.stockItemId);
            return {
              stockItemId: entry.stockItemId,
              sourceLocationId: entry.sourceLocationId,
              rate: inv?.averageRate || "0",
            };
          }
        } catch {}
        return { stockItemId: entry.stockItemId, sourceLocationId: entry.sourceLocationId, rate: "0" };
      });
      const fetchedRates = await Promise.all(ratePromises);
      for (const entry of validEntries) {
        if (!entry.rate || entry.rate === "" || entry.rate === "0") {
          const fetched = fetchedRates.find(
            (r) => r.stockItemId === entry.stockItemId && r.sourceLocationId === entry.sourceLocationId
          );
          if (fetched) entry.rate = fetched.rate;
        }
      }
    }
    data.entries = data.entries.filter(
      (e) => !(e.stockItemId > 0 && e.sourceLocationId > 0 && parseFloat(e.quantity) === 0)
    );
    const isEditMode = !!voucherIdToEdit;
    let originalItems: any[] = [];
    if (isEditMode && voucherIdToEdit) {
      let st = stockTransferToEdit as any | undefined;
      if (!st) {
        try {
          const res = await fetch(`/api/stock-transfers?voucherId=${voucherIdToEdit}`);
          if (res.ok) {
            const d = await res.json();
            st = Array.isArray(d) ? d[0] : d;
          }
        } catch {}
      }
      if (st?.items) originalItems = st.items;
    }
    stockTransferMutation.mutate(data);
  };

  const handleExportStockTransfer = async (detailed: boolean) => {
    const formData = stockTransferForm.getValues();
    const voucherDate = formData.voucherDate
      ? format(formData.voucherDate, "yyyy-MM-dd")
      : format(new Date(), "yyyy-MM-dd");
    const validEntries = formData.entries.filter((e: any) => e.stockItemId > 0 && parseFloat(e.quantity) > 0);
    if (validEntries.length === 0) {
      toast({
        title: "No data to export",
        description: "Add at least one entry before exporting.",
        variant: "destructive",
      });
      return;
    }
    const destLoc = locations?.find((l: any) => l.id === formData.destinationLocationId);
    const destLocationName = destLoc?.name || "";
    if (detailed) {
      const exportData = validEntries.map((entry: any) => ({
        Date: voucherDate,
        "Source Location": entry.sourceLocationName || "",
        "Destination Location": destLocationName,
        "Item Code": entry.stockItemCode || "",
        "Item Name": entry.stockItemName || "",
        Quantity: parseFloat(entry.quantity).toFixed(2),
        Rate: parseFloat(entry.rate || "0").toFixed(2),
        Amount: (parseFloat(entry.quantity) * parseFloat(entry.rate || "0")).toFixed(2),
        Notes: formData.notes || "",
        Optional: formData.optional ? "Yes" : "No",
      }));
      const worksheet = utils.json_to_sheet(exportData);
      const workbook = utils.book_new();
      utils.book_append_sheet(workbook, worksheet, "Stock Transfer Detailed");
      const fileName = `Stock_Transfer_Detailed_${voucherDate}.xlsx`;
      await writeFile(workbook, fileName);
      toast({ title: "Export successful", description: `Downloaded ${fileName} with ${validEntries.length} items.` });
    } else {
      const totalQty = validEntries.reduce((sum: number, e: any) => sum + parseFloat(e.quantity), 0);
      const totalAmount = validEntries.reduce(
        (sum: number, e: any) => sum + parseFloat(e.quantity) * parseFloat(e.rate || "0"),
        0
      );
      const exportData = [
        {
          "Voucher Type": "Stock Transfer",
          Date: voucherDate,
          "Destination Location": destLocationName,
          "Total Items": validEntries.length,
          "Total Quantity": totalQty.toFixed(2),
          "Total Amount": totalAmount.toFixed(2),
          Notes: formData.notes || "",
          Optional: formData.optional ? "Yes" : "No",
        },
      ];
      const worksheet = utils.json_to_sheet(exportData);
      const workbook = utils.book_new();
      utils.book_append_sheet(workbook, worksheet, "Stock Transfer Summary");
      const fileName = `Stock_Transfer_Summary_${voucherDate}.xlsx`;
      await writeFile(workbook, fileName);
      toast({ title: "Export successful", description: `Downloaded ${fileName}.` });
    }
  };

  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setImportFile(selectedFile);
      setImportPreview(null);
      setImportValidationResult(null);
    }
  };
  const handleImportParse = () => {
    if (!importFile) {
      toast({
        title: "No file selected",
        description: "Please select an Excel file to upload",
        variant: "destructive",
      });
      return;
    }
    const formData = new FormData();
    formData.append("file", importFile);
    importParseMutation.mutate(formData);
  };
  const handleImportValidate = () => {
    if (!importDestLocation) {
      toast({
        title: "Destination required",
        description: "Please select a destination location",
        variant: "destructive",
      });
      return;
    }
    if (!importPreview) {
      toast({ title: "No preview data", description: "Please parse the file first", variant: "destructive" });
      return;
    }
    importValidateMutation.mutate({ destinationLocationId: parseInt(importDestLocation), items: importPreview.items });
  };
  const handleImportSubmit = () => {
    if (!importDestLocation || !importPreview || !importValidationResult?.validatedItems) {
      toast({
        title: "Cannot import",
        description: "Please parse, validate, and fix any errors first",
        variant: "destructive",
      });
      return;
    }
    const validItems = importValidationResult.validatedItems.filter((item: any) => !item.error);
    if (importValidationResult?.errors?.length > 0) {
      setImportConfirmDialogOpen(true);
      return;
    }
    importMutation.mutate({
      destinationLocationId: parseInt(importDestLocation),
      transferDate: importDate,
      notes: importNotes,
      items: validItems,
    });
  };
  const handleConfirmedImport = () => {
    const validItems = importValidationResult?.validatedItems?.filter((item: any) => !item.error) || [];
    setImportConfirmDialogOpen(false);
    if (validItems.length === 0) {
      setImportDialogOpen(false);
      setImportFile(null);
      setImportPreview(null);
      setImportValidationResult(null);
      setImportDestLocation("");
      setImportDate(new Date().toLocaleDateString("en-CA"));
      setImportNotes("");
      toast({ title: "No items imported", description: "All items had validation errors. No transfer was created." });
      return;
    }
    importMutation.mutate({
      destinationLocationId: parseInt(importDestLocation),
      transferDate: importDate,
      notes: importNotes,
      items: validItems,
    });
  };
  const downloadImportTemplate = () => window.open("/api/stock-transfer-import/template-multi-source", "_blank");

  return (
    <div className="space-y-4">
      <Form {...stockTransferForm}>
        <form
          noValidate
          onSubmit={stockTransferForm.handleSubmit(onStockTransferSubmit, (errors) => {
            console.error("Stock Transfer Form Validation Errors:", errors);
            toast({
              title: "Form Validation Error",
              description:
                Object.values(errors)
                  .map((e: any) => e?.message || JSON.stringify(e))
                  .join(", ") || "Please check all fields",
              variant: "destructive",
            });
          })}
        >
          {/* Header Row */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-4 mb-4">
            {isPOS && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">From:</span>
                {myLocations.length > 1 ? (
                  <Select
                    value={posSelectedSourceId?.toString() || ""}
                    onValueChange={(v) => {
                      const newId = parseInt(v);
                      const newName = locations.find((l) => l.id === newId)?.name || "";
                      setPosSelectedSourceId(newId);
                      setTransferInventorySource(newId);
                      const curEntries = stockTransferForm.getValues("entries");
                      curEntries.forEach((_, index) => {
                        stockTransferForm.setValue(`entries.${index}.sourceLocationId`, newId);
                        stockTransferForm.setValue(`entries.${index}.sourceLocationName`, newName);
                        stockTransferForm.setValue(`entries.${index}.stockItemId`, 0);
                        stockTransferForm.setValue(`entries.${index}.stockItemName`, "");
                        stockTransferForm.setValue(`entries.${index}.quantity`, "");
                      });
                    }}
                  >
                    <SelectTrigger className="w-[160px]" data-testid="select-source-location-pos">
                      <SelectValue placeholder="Select source..." />
                    </SelectTrigger>
                    <SelectContent>
                      {myLocations.map((l) => (
                        <SelectItem key={l.id} value={String(l.id)}>
                          {l.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="font-medium">{posSelectedSourceName || posLocationName}</span>
                )}
              </div>
            )}

            <FormField
              control={stockTransferForm.control}
              name="destinationLocationId"
              render={({ field }) => (
                <FormItem className="flex items-center gap-2 space-y-0">
                  <FormLabel className="text-sm text-muted-foreground whitespace-nowrap">To:</FormLabel>
                  <Select
                    value={field.value > 0 ? field.value.toString() : ""}
                    onValueChange={(value) => field.onChange(parseInt(value))}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full sm:w-[200px]" data-testid="select-destination-location">
                        <SelectValue placeholder="Select destination..." />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {[...locations]
                        .filter((l) => l.id !== transferInventorySource)
                        .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
                        .map((location) => (
                          <SelectItem key={location.id} value={location.id.toString()}>
                            {location.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )}
            />

            <FormField
              control={stockTransferForm.control}
              name="voucherDate"
              render={({ field }) => (
                <FormItem className="flex items-center gap-2 space-y-0">
                  <FormLabel className="text-sm text-muted-foreground whitespace-nowrap">Date:</FormLabel>
                  <FormControl>
                    <Input
                      type="date"
                      value={
                        field.value instanceof Date
                          ? format(field.value, "yyyy-MM-dd")
                          : typeof field.value === "string"
                            ? field.value
                            : ""
                      }
                      onChange={(e) =>
                        field.onChange(e.target.value ? new Date(e.target.value + "T00:00:00") : new Date())
                      }
                      className="w-full sm:w-[160px]"
                      data-testid="input-transfer-date"
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <div className="flex-1" />

            {!isPOS && voucherIdToEdit && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setLocation(`/stock-transfer-order?edit=${voucherIdToEdit}`)}
                data-testid="button-switch-to-order-view"
              >
                <LayoutGrid className="h-4 w-4 mr-2" />
                Order View
              </Button>
            )}

            {!isPOS && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setImportDialogOpen(true)}
                data-testid="button-open-import-dialog"
              >
                <Upload className="h-4 w-4 mr-2" />
                Import
              </Button>
            )}
          </div>

          <div className="flex flex-col lg:flex-row gap-4">
            {/* Main Spreadsheet Area */}
            <Card className="flex-1 overflow-hidden min-w-0">
              {/* Mobile: card-per-row */}
              <div className="sm:hidden p-3 space-y-2">
                {transferFields.map((field, index) => {
                  const entry = transferEntries[index];
                  const mobileFilteredItems =
                    activeTransferRow === index && activeFieldType === "item"
                      ? transferInventory
                          .filter((item: any) => {
                            if (!transferSearchTerm.trim()) return true;
                            const term = transferSearchTerm.toLowerCase();
                            return (
                              item.stockItemName?.toLowerCase().includes(term) ||
                              item.stockItemCode?.toLowerCase().includes(term)
                            );
                          })
                          .sort((a: any, b: any) => (a.stockItemName || "").localeCompare(b.stockItemName || ""))
                          .slice(0, 10)
                      : [];
                  const mobileFilteredLocs =
                    activeTransferRow === index && activeFieldType === "source"
                      ? locations
                          .filter((loc: any) => {
                            if (!transferSourceSearchTerm.trim()) return true;
                            const term = transferSourceSearchTerm.toLowerCase();
                            return (loc.name || "").toLowerCase().includes(term);
                          })
                          .sort((a: any, b: any) => (a.name || "").localeCompare(b.name || ""))
                          .slice(0, 8)
                      : [];
                  return (
                    <div key={field.id} className="border rounded-md p-3 space-y-2 bg-card">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground font-medium">#{index + 1}</span>
                        {transferFields.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeTransfer(index)}
                            className="h-7 w-7"
                            data-testid={`button-remove-transfer-mobile-${index}`}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                      {!isPOS && (
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">Source</label>
                          <input
                            type="text"
                            value={
                              activeTransferRow === index && activeFieldType === "source"
                                ? transferSourceSearchTerm
                                : entry?.sourceLocationName || ""
                            }
                            onChange={(e) => {
                              setTransferSourceSearchTerm(e.target.value);
                              setTransferSourceHighlightedIndex(0);
                            }}
                            onFocus={() => {
                              transferFocusIdRef.current += 1;
                              setActiveTransferRow(index);
                              setActiveFieldType("source");
                              setTransferSourceSearchTerm(entry?.sourceLocationName || "");
                              setTransferSourceHighlightedIndex(0);
                              setShowSourceSidebar(true);
                              setShowItemSidebar(false);
                            }}
                            onBlur={() => {
                              const focusId = transferFocusIdRef.current;
                              setTimeout(() => {
                                if (transferFocusIdRef.current === focusId) {
                                  setActiveTransferRow(null);
                                  setActiveFieldType(null);
                                  setTransferSourceSearchTerm("");
                                  setShowSourceSidebar(false);
                                }
                              }, 250);
                            }}
                            placeholder="Type location..."
                            data-testid={`input-source-mobile-${index}`}
                            className="w-full px-3 py-2 text-sm border rounded-md bg-background outline-none focus:ring-1 focus:ring-ring"
                          />
                          {mobileFilteredLocs.length > 0 && (
                            <div className="border rounded-md bg-popover shadow-md max-h-36 overflow-y-auto z-20 relative">
                              {mobileFilteredLocs.map((loc: any) => (
                                <button
                                  key={loc.id}
                                  type="button"
                                  className="w-full text-left px-3 py-2 text-sm hover-elevate border-b last:border-b-0"
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    stockTransferForm.setValue(`entries.${index}.sourceLocationId`, loc.id);
                                    stockTransferForm.setValue(`entries.${index}.sourceLocationName`, loc.name);
                                    setTransferInventorySource(loc.id);
                                    setTransferSourceSearchTerm("");
                                    setShowSourceSidebar(false);
                                  }}
                                >
                                  {loc.name}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Item</label>
                        <input
                          type="text"
                          value={
                            activeTransferRow === index && activeFieldType === "item"
                              ? transferSearchTerm
                              : entry?.stockItemName || ""
                          }
                          onChange={(e) => {
                            setTransferSearchTerm(e.target.value);
                            setTransferHighlightedIndex(0);
                            if (!e.target.value) {
                              stockTransferForm.setValue(`entries.${index}.stockItemId`, 0);
                              stockTransferForm.setValue(`entries.${index}.stockItemCode`, "");
                              stockTransferForm.setValue(`entries.${index}.stockItemName`, "");
                            }
                          }}
                          onFocus={() => {
                            transferFocusIdRef.current += 1;
                            setActiveTransferRow(index);
                            setActiveFieldType("item");
                            setTransferHighlightedIndex(0);
                            setTransferSearchTerm(entry?.stockItemName || "");
                            setShowItemSidebar(true);
                            setShowSourceSidebar(false);
                            if (entry?.sourceLocationId > 0) setTransferInventorySource(entry.sourceLocationId);
                            else if (isPOS && posSelectedSourceId) setTransferInventorySource(posSelectedSourceId);
                          }}
                          onBlur={() => {
                            const focusId = transferFocusIdRef.current;
                            setTimeout(() => {
                              if (transferFocusIdRef.current === focusId) {
                                setActiveTransferRow(null);
                                setActiveFieldType(null);
                                setTransferSearchTerm("");
                                setShowItemSidebar(false);
                              }
                            }, 200);
                          }}
                          placeholder="Type to search item..."
                          data-testid={`input-item-name-mobile-${index}`}
                          className="w-full px-3 py-2 text-sm border rounded-md bg-background outline-none focus:ring-1 focus:ring-ring"
                        />
                        {mobileFilteredItems.length > 0 && (
                          <div className="border rounded-md bg-popover shadow-md max-h-40 overflow-y-auto z-20 relative">
                            {mobileFilteredItems.map((item: any) => (
                              <button
                                key={item.stockItemId}
                                type="button"
                                className="w-full text-left px-3 py-2 text-sm hover-elevate border-b last:border-b-0"
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  const sourceId = Number(transferInventorySource);
                                  if (!(sourceId > 0)) return;
                                  const sourceLocation = locations.find((l: any) => l.id === sourceId);
                                  stockTransferForm.setValue(`entries.${index}.sourceLocationId`, sourceId, {
                                    shouldValidate: true,
                                  });
                                  stockTransferForm.setValue(
                                    `entries.${index}.sourceLocationName`,
                                    sourceLocation?.name || ""
                                  );
                                  stockTransferForm.setValue(`entries.${index}.stockItemId`, item.stockItemId, {
                                    shouldValidate: true,
                                  });
                                  stockTransferForm.setValue(
                                    `entries.${index}.stockItemCode`,
                                    item.stockItemCode || ""
                                  );
                                  stockTransferForm.setValue(`entries.${index}.stockItemName`, item.stockItemName);
                                  stockTransferForm.setValue(`entries.${index}.rate`, item.averageRate || "0");
                                  setTransferSearchTerm("");
                                  setShowItemSidebar(false);
                                }}
                              >
                                <div className="font-medium truncate">{item.stockItemName}</div>
                                <div className="text-xs text-muted-foreground">
                                  Qty: {formatNumber(item.quantity, 0)}
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">Qty</label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={
                              transferQtyDraft[`m${index}`] !== undefined
                                ? transferQtyDraft[`m${index}`]
                                : entry?.quantity || ""
                            }
                            onFocus={() =>
                              setTransferQtyDraft((prev) => ({ ...prev, [`m${index}`]: entry?.quantity || "" }))
                            }
                            onChange={(e) => {
                              const raw = e.target.value;
                              setTransferQtyDraft((prev) => ({ ...prev, [`m${index}`]: raw }));
                              if (!raw.startsWith("+") && !raw.startsWith("-")) {
                                stockTransferForm.setValue(`entries.${index}.quantity`, raw);
                              }
                            }}
                            onBlur={() => {
                              const raw = (transferQtyDraft[`m${index}`] ?? "").trim();
                              setTransferQtyDraft((prev) => {
                                const n = { ...prev };
                                delete n[`m${index}`];
                                return n;
                              });
                              const delta = parseFloat(raw.startsWith("+") ? raw.slice(1) : raw);
                              if (isNaN(delta)) return;
                              if (voucherIdToEdit && stockTransferToEdit?.items) {
                                const origItem = (stockTransferToEdit.items as any[]).find(
                                  (item) =>
                                    item.stockItemId === entry.stockItemId &&
                                    item.sourceLocationId === entry.sourceLocationId
                                );
                                const origQty = origItem ? parseFloat(origItem.quantity) || 0 : 0;
                                stockTransferForm.setValue(
                                  `entries.${index}.quantity`,
                                  Math.max(0, origQty + delta).toString()
                                );
                              } else {
                                stockTransferForm.setValue(`entries.${index}.quantity`, Math.max(0, delta).toString());
                              }
                            }}
                            placeholder={voucherIdToEdit ? "-1 to reduce, 2 to add" : "0"}
                            data-testid={`input-transfer-quantity-mobile-${index}`}
                            className="w-full px-3 py-2 text-sm border rounded-md bg-background outline-none focus:ring-1 focus:ring-ring font-mono text-right"
                          />
                        </div>
                        {!isPOS && (
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">Rate</label>
                            <input
                              type="number"
                              step="0.01"
                              value={entry?.rate || ""}
                              onChange={(e) => stockTransferForm.setValue(`entries.${index}.rate`, e.target.value)}
                              placeholder="0.00"
                              data-testid={`input-transfer-rate-mobile-${index}`}
                              className="w-full px-3 py-2 text-sm border rounded-md bg-background outline-none focus:ring-1 focus:ring-ring font-mono text-right"
                            />
                          </div>
                        )}
                      </div>
                      {!isPOS && (
                        <div className="flex items-center justify-between px-1">
                          <span className="text-xs text-muted-foreground">Amount</span>
                          <span className="text-sm font-mono font-medium">
                            {formatAmount(parseFloat(entry?.quantity || "0") * parseFloat(entry?.rate || "0"))}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
                <div className="flex items-center justify-between pt-1 px-0.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      appendTransfer({
                        sourceLocationId: 0,
                        sourceLocationName: "",
                        stockItemId: 0,
                        stockItemCode: "",
                        stockItemName: "",
                        quantity: "",
                        rate: "",
                      })
                    }
                    data-testid="button-add-transfer-row-mobile"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Row
                  </Button>
                  {!isPOS && <div className="font-bold font-mono text-sm">Total: {formatAmount(transferTotal)}</div>}
                </div>
              </div>

              {/* Desktop: spreadsheet */}
              <div className="hidden sm:block overflow-x-auto">
                <div className="min-w-[400px]">
                  <div className="flex bg-muted/50 border-b sticky top-0 z-30">
                    <div className="w-10 sm:w-12 flex items-center justify-center border-r h-9 sm:h-10 font-medium text-xs">
                      #
                    </div>
                    {!isPOS && (
                      <div className="w-28 sm:w-40 flex items-center px-2 sm:px-3 border-r h-9 sm:h-10 font-medium text-xs sm:text-sm">
                        Source
                      </div>
                    )}
                    <div className="flex-1 min-w-[120px] flex items-center px-2 sm:px-3 border-r h-9 sm:h-10 font-medium text-xs sm:text-sm">
                      Item
                    </div>
                    <div className="w-16 sm:w-24 flex items-center px-2 sm:px-3 border-r h-9 sm:h-10 font-medium text-xs sm:text-sm">
                      Qty
                    </div>
                    {!isPOS && (
                      <>
                        <div className="w-16 sm:w-24 flex items-center px-2 sm:px-3 border-r h-9 sm:h-10 font-medium text-xs sm:text-sm">
                          Rate
                        </div>
                        <div className="w-20 sm:w-28 flex items-center px-2 sm:px-3 border-r h-9 sm:h-10 font-medium text-xs sm:text-sm bg-muted/30">
                          Amt
                        </div>
                      </>
                    )}
                    <div className="w-10 sm:w-12 flex items-center justify-center h-9 sm:h-10" />
                  </div>
                  <div className="max-h-[calc(100vh-24rem)] overflow-y-auto">
                    {transferFields.map((field, index) => (
                      <div key={field.id} className="flex border-b hover-elevate">
                        <div className="w-10 sm:w-12 flex items-center justify-center border-r h-9 sm:h-10 text-xs text-muted-foreground">
                          {index + 1}
                        </div>
                        {!isPOS && (
                          <div className="w-28 sm:w-40 border-r h-9 sm:h-10">
                            <input
                              type="text"
                              value={
                                activeTransferRow === index && activeFieldType === "source"
                                  ? transferSourceSearchTerm
                                  : transferEntries[index]?.sourceLocationName || ""
                              }
                              onChange={(e) => {
                                setTransferSourceSearchTerm(e.target.value);
                                setTransferSourceHighlightedIndex(0);
                              }}
                              onFocus={() => {
                                transferFocusIdRef.current += 1;
                                setActiveTransferRow(index);
                                setActiveFieldType("source");
                                setTransferSourceSearchTerm(transferEntries[index]?.sourceLocationName || "");
                                setTransferSourceHighlightedIndex(0);
                                setShowSourceSidebar(true);
                                setShowItemSidebar(false);
                              }}
                              onBlur={() => {
                                const focusIdAtBlur = transferFocusIdRef.current;
                                setTimeout(() => {
                                  if (transferFocusIdRef.current === focusIdAtBlur) {
                                    setActiveTransferRow(null);
                                    setActiveFieldType(null);
                                    setTransferSourceSearchTerm("");
                                    setShowSourceSidebar(false);
                                  }
                                }, 250);
                              }}
                              onKeyDown={(e) => {
                                const filteredLocs = locations
                                  .filter((loc) => {
                                    if (!transferSourceSearchTerm.trim()) return true;
                                    const term = transferSourceSearchTerm.toLowerCase();
                                    return (
                                      (loc.name || "").toLowerCase().includes(term) ||
                                      (loc.code && loc.code.toLowerCase().includes(term))
                                    );
                                  })
                                  .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
                                if (e.key === "Enter" && filteredLocs.length > 0) {
                                  e.preventDefault();
                                  const selectedLoc = filteredLocs[transferSourceHighlightedIndex] || filteredLocs[0];
                                  stockTransferForm.setValue(`entries.${index}.sourceLocationId`, selectedLoc.id);
                                  stockTransferForm.setValue(`entries.${index}.sourceLocationName`, selectedLoc.name);
                                  setTransferInventorySource(selectedLoc.id);
                                  setTransferSourceSearchTerm("");
                                  setShowSourceSidebar(false);
                                  setTimeout(() => {
                                    const itemInput = document.querySelector(
                                      `[data-testid="input-item-name-${index}"]`
                                    ) as HTMLInputElement;
                                    if (itemInput) {
                                      itemInput.focus();
                                      itemInput.select();
                                    }
                                  }, 50);
                                } else if (e.key === "ArrowUp") {
                                  e.preventDefault();
                                  if (showSourceSidebar && filteredLocs.length > 0)
                                    setTransferSourceHighlightedIndex(Math.max(0, transferSourceHighlightedIndex - 1));
                                  else if (index > 0)
                                    setTimeout(() => {
                                      const prev = document.querySelector(
                                        `[data-testid="input-source-${index - 1}"]`
                                      ) as HTMLInputElement;
                                      if (prev) {
                                        prev.focus();
                                        prev.select();
                                      }
                                    }, 50);
                                } else if (e.key === "ArrowDown") {
                                  e.preventDefault();
                                  if (showSourceSidebar && filteredLocs.length > 0)
                                    setTransferSourceHighlightedIndex(
                                      Math.min(filteredLocs.length - 1, transferSourceHighlightedIndex + 1)
                                    );
                                  else if (index < transferFields.length - 1)
                                    setTimeout(() => {
                                      const next = document.querySelector(
                                        `[data-testid="input-source-${index + 1}"]`
                                      ) as HTMLInputElement;
                                      if (next) {
                                        next.focus();
                                        next.select();
                                      }
                                    }, 50);
                                } else if (e.key === "ArrowRight" || (e.key === "Tab" && !e.shiftKey)) {
                                  e.preventDefault();
                                  setTimeout(() => {
                                    const item = document.querySelector(
                                      `[data-testid="input-item-name-${index}"]`
                                    ) as HTMLInputElement;
                                    if (item) {
                                      item.focus();
                                      item.select();
                                    }
                                  }, 50);
                                }
                              }}
                              placeholder="Type location..."
                              className="w-full h-full px-3 bg-transparent outline-none focus:bg-accent/20"
                              data-testid={`input-source-${index}`}
                            />
                          </div>
                        )}
                        <div className="flex-1 min-w-[120px] border-r h-9 sm:h-10">
                          <input
                            type="text"
                            value={
                              activeTransferRow === index && activeFieldType === "item"
                                ? transferSearchTerm
                                : transferEntries[index]?.stockItemName || ""
                            }
                            onChange={(e) => {
                              setTransferSearchTerm(e.target.value);
                              setTransferHighlightedIndex(0);
                              if (!e.target.value) {
                                stockTransferForm.setValue(`entries.${index}.stockItemId`, 0);
                                stockTransferForm.setValue(`entries.${index}.stockItemCode`, "");
                                stockTransferForm.setValue(`entries.${index}.stockItemName`, "");
                              }
                            }}
                            onFocus={() => {
                              transferFocusIdRef.current += 1;
                              setActiveTransferRow(index);
                              setActiveFieldType("item");
                              setTransferHighlightedIndex(0);
                              setTransferSearchTerm(transferEntries[index]?.stockItemName || "");
                              setShowItemSidebar(true);
                              setShowSourceSidebar(false);
                              if (transferEntries[index]?.sourceLocationId > 0)
                                setTransferInventorySource(transferEntries[index].sourceLocationId);
                              else if (isPOS && posSelectedSourceId) setTransferInventorySource(posSelectedSourceId);
                              else setTransferInventorySource(0);
                            }}
                            onBlur={() => {
                              const focusIdAtBlur = transferFocusIdRef.current;
                              setTimeout(() => {
                                if (transferFocusIdRef.current === focusIdAtBlur) {
                                  setActiveTransferRow(null);
                                  setActiveFieldType(null);
                                  setTransferSearchTerm("");
                                  setShowItemSidebar(false);
                                }
                              }, 200);
                            }}
                            onKeyDown={(e) => {
                              const filteredInventory = transferInventory
                                .filter((item: any) => {
                                  if (!transferSearchTerm.trim()) return true;
                                  const term = transferSearchTerm.toLowerCase();
                                  return (
                                    item.stockItemName?.toLowerCase().includes(term) ||
                                    item.stockItemCode?.toLowerCase().includes(term)
                                  );
                                })
                                .sort((a: any, b: any) => (a.stockItemName || "").localeCompare(b.stockItemName || ""));
                              if (e.key === "ArrowUp" && !e.shiftKey) {
                                e.preventDefault();
                                if (showItemSidebar && filteredInventory.length > 0)
                                  setTransferHighlightedIndex(Math.max(0, transferHighlightedIndex - 1));
                                else if (index > 0)
                                  setTimeout(() => {
                                    const prev = document.querySelector(
                                      `[data-testid="input-item-name-${index - 1}"]`
                                    ) as HTMLInputElement;
                                    if (prev) {
                                      prev.focus();
                                      prev.select();
                                    }
                                  }, 50);
                              } else if (e.key === "ArrowDown" && !e.shiftKey) {
                                e.preventDefault();
                                if (showItemSidebar && filteredInventory.length > 0)
                                  setTransferHighlightedIndex(
                                    Math.min(filteredInventory.length - 1, transferHighlightedIndex + 1)
                                  );
                                else if (index < transferFields.length - 1)
                                  setTimeout(() => {
                                    const next = document.querySelector(
                                      `[data-testid="input-item-name-${index + 1}"]`
                                    ) as HTMLInputElement;
                                    if (next) {
                                      next.focus();
                                      next.select();
                                    }
                                  }, 50);
                              } else if (e.key === "ArrowLeft" && !isPOS) {
                                e.preventDefault();
                                setShowItemSidebar(false);
                                setTransferSearchTerm("");
                                setTimeout(() => {
                                  const src = document.querySelector(
                                    `[data-testid="input-source-${index}"]`
                                  ) as HTMLInputElement;
                                  if (src) {
                                    src.focus();
                                    src.select();
                                  }
                                }, 50);
                              } else if (e.key === "ArrowRight") {
                                e.preventDefault();
                                setTimeout(() => {
                                  const qty = document.querySelector(
                                    `[data-testid="input-transfer-quantity-${index}"]`
                                  ) as HTMLInputElement;
                                  if (qty) {
                                    qty.focus();
                                    qty.select();
                                  }
                                }, 50);
                              } else if (e.key === "Tab" && !e.shiftKey) {
                                e.preventDefault();
                                setTimeout(() => {
                                  const qty = document.querySelector(
                                    `[data-testid="input-transfer-quantity-${index}"]`
                                  ) as HTMLInputElement;
                                  if (qty) {
                                    qty.focus();
                                    qty.select();
                                  }
                                }, 50);
                              } else if (e.key === "Enter") {
                                e.preventDefault();
                                if (filteredInventory.length > 0) {
                                  const item = filteredInventory[transferHighlightedIndex] || filteredInventory[0];
                                  const stockItem = stockItems.find((s) => s.id === item.stockItemId);
                                  if (stockItem) {
                                    const sourceId = Number(transferInventorySource);
                                    if (!(sourceId > 0)) {
                                      toast({
                                        title: "Select a source location first",
                                        description:
                                          "Please select a source location from the inventory sidebar before adding items.",
                                        variant: "destructive",
                                      });
                                      return;
                                    }
                                    const sourceLocation = locations.find((l) => l.id === sourceId);
                                    stockTransferForm.setValue(`entries.${index}.sourceLocationId`, sourceId, {
                                      shouldValidate: true,
                                      shouldDirty: true,
                                      shouldTouch: true,
                                    });
                                    stockTransferForm.setValue(
                                      `entries.${index}.sourceLocationName`,
                                      sourceLocation?.name || ""
                                    );
                                    stockTransferForm.setValue(`entries.${index}.stockItemId`, item.stockItemId, {
                                      shouldValidate: true,
                                      shouldDirty: true,
                                      shouldTouch: true,
                                    });
                                    stockTransferForm.setValue(`entries.${index}.stockItemCode`, stockItem.code || "");
                                    stockTransferForm.setValue(`entries.${index}.stockItemName`, stockItem.name);
                                    stockTransferForm.setValue(`entries.${index}.rate`, item.averageRate || "0");
                                    setTransferSearchTerm("");
                                    setTimeout(() => {
                                      const qty = document.querySelector(
                                        `[data-testid="input-transfer-quantity-${index}"]`
                                      ) as HTMLInputElement;
                                      if (qty) {
                                        qty.focus();
                                        qty.select();
                                      }
                                    }, 50);
                                  }
                                }
                              }
                            }}
                            placeholder="Type to search..."
                            className="w-full h-full px-3 bg-transparent outline-none focus:bg-accent/20"
                            data-testid={`input-item-name-${index}`}
                          />
                        </div>
                        <div className="w-16 sm:w-24 border-r h-9 sm:h-10">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={
                              transferQtyDraft[index] !== undefined
                                ? transferQtyDraft[index]
                                : transferEntries[index]?.quantity || ""
                            }
                            onFocus={() =>
                              setTransferQtyDraft((prev) => ({
                                ...prev,
                                [index]: transferEntries[index]?.quantity || "",
                              }))
                            }
                            onChange={(e) => {
                              const raw = e.target.value;
                              setTransferQtyDraft((prev) => ({ ...prev, [index]: raw }));
                              if (!raw.startsWith("+") && !raw.startsWith("-")) {
                                stockTransferForm.setValue(`entries.${index}.quantity`, raw);
                              }
                            }}
                            onBlur={(e) => {
                              const raw = (transferQtyDraft[index] ?? e.target.value).trim();
                              setTransferQtyDraft((prev) => {
                                const n = { ...prev };
                                delete n[index];
                                return n;
                              });
                              const delta = parseFloat(raw.startsWith("+") ? raw.slice(1) : raw);
                              if (isNaN(delta)) return;
                              if (voucherIdToEdit && stockTransferToEdit?.items) {
                                const entry = stockTransferForm.getValues(`entries.${index}`);
                                const origItem = (stockTransferToEdit.items as any[]).find(
                                  (item) =>
                                    item.stockItemId === entry.stockItemId &&
                                    item.sourceLocationId === entry.sourceLocationId
                                );
                                const origQty = origItem ? parseFloat(origItem.quantity) || 0 : 0;
                                stockTransferForm.setValue(
                                  `entries.${index}.quantity`,
                                  Math.max(0, origQty + delta).toString()
                                );
                              } else {
                                stockTransferForm.setValue(`entries.${index}.quantity`, Math.max(0, delta).toString());
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "ArrowUp") {
                                e.preventDefault();
                                if (index > 0)
                                  setTimeout(() => {
                                    const prev = document.querySelector(
                                      `[data-testid="input-transfer-quantity-${index - 1}"]`
                                    ) as HTMLInputElement;
                                    if (prev) {
                                      prev.focus();
                                      prev.select();
                                    }
                                  }, 50);
                              } else if (e.key === "ArrowDown") {
                                e.preventDefault();
                                if (index < transferFields.length - 1)
                                  setTimeout(() => {
                                    const next = document.querySelector(
                                      `[data-testid="input-transfer-quantity-${index + 1}"]`
                                    ) as HTMLInputElement;
                                    if (next) {
                                      next.focus();
                                      next.select();
                                    }
                                  }, 50);
                              } else if (e.key === "ArrowLeft") {
                                e.preventDefault();
                                setTimeout(() => {
                                  const nm = document.querySelector(
                                    `[data-testid="input-item-name-${index}"]`
                                  ) as HTMLInputElement;
                                  if (nm) {
                                    nm.focus();
                                    nm.select();
                                  }
                                }, 50);
                              } else if (e.key === "ArrowRight" && !isPOS) {
                                e.preventDefault();
                                setTimeout(() => {
                                  const rt = document.querySelector(
                                    `[data-testid="input-transfer-rate-${index}"]`
                                  ) as HTMLInputElement;
                                  if (rt) {
                                    rt.focus();
                                    rt.select();
                                  }
                                }, 50);
                              } else if (e.key === "Tab" && !e.shiftKey) {
                                e.preventDefault();
                                if (!isPOS)
                                  setTimeout(() => {
                                    const rt = document.querySelector(
                                      `[data-testid="input-transfer-rate-${index}"]`
                                    ) as HTMLInputElement;
                                    if (rt) {
                                      rt.focus();
                                      rt.select();
                                    }
                                  }, 50);
                                else if (index < transferFields.length - 1)
                                  setTimeout(() => {
                                    const next = document.querySelector(
                                      `[data-testid="input-item-name-${index + 1}"]`
                                    ) as HTMLInputElement;
                                    if (next) {
                                      next.focus();
                                      next.select();
                                    }
                                  }, 50);
                              } else if (e.key === "Enter") {
                                e.preventDefault();
                                if (index === transferFields.length - 1) {
                                  appendTransfer({
                                    sourceLocationId: 0,
                                    sourceLocationName: "",
                                    stockItemId: 0,
                                    stockItemCode: "",
                                    stockItemName: "",
                                    quantity: "",
                                    rate: "",
                                  });
                                  setTimeout(() => {
                                    const newInput = isPOS
                                      ? (document.querySelector(
                                          `[data-testid="input-item-name-${index + 1}"]`
                                        ) as HTMLInputElement)
                                      : (document.querySelector(
                                          `[data-testid="input-source-${index + 1}"]`
                                        ) as HTMLInputElement);
                                    if (newInput) newInput.focus();
                                  }, 100);
                                }
                              }
                            }}
                            placeholder={voucherIdToEdit ? "-1 to reduce, 2 to add" : "0"}
                            className="w-full h-full px-3 bg-transparent outline-none focus:bg-accent/20 font-mono text-right"
                            data-testid={`input-transfer-quantity-${index}`}
                          />
                        </div>
                        {!isPOS && (
                          <>
                            <div className="w-16 sm:w-24 border-r h-9 sm:h-10">
                              <input
                                type="number"
                                step="0.01"
                                value={transferEntries[index]?.rate || ""}
                                onChange={(e) => stockTransferForm.setValue(`entries.${index}.rate`, e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "ArrowUp") {
                                    e.preventDefault();
                                    if (index > 0)
                                      setTimeout(() => {
                                        const prev = document.querySelector(
                                          `[data-testid="input-transfer-rate-${index - 1}"]`
                                        ) as HTMLInputElement;
                                        if (prev) {
                                          prev.focus();
                                          prev.select();
                                        }
                                      }, 50);
                                  } else if (e.key === "ArrowDown") {
                                    e.preventDefault();
                                    if (index < transferFields.length - 1)
                                      setTimeout(() => {
                                        const next = document.querySelector(
                                          `[data-testid="input-transfer-rate-${index + 1}"]`
                                        ) as HTMLInputElement;
                                        if (next) {
                                          next.focus();
                                          next.select();
                                        }
                                      }, 50);
                                  } else if (e.key === "ArrowLeft") {
                                    e.preventDefault();
                                    setTimeout(() => {
                                      const qty = document.querySelector(
                                        `[data-testid="input-transfer-quantity-${index}"]`
                                      ) as HTMLInputElement;
                                      if (qty) {
                                        qty.focus();
                                        qty.select();
                                      }
                                    }, 50);
                                  } else if (e.key === "Tab" && !e.shiftKey) {
                                    e.preventDefault();
                                    if (index < transferFields.length - 1)
                                      setTimeout(() => {
                                        const next = document.querySelector(
                                          `[data-testid="input-item-name-${index + 1}"]`
                                        ) as HTMLInputElement;
                                        if (next) {
                                          next.focus();
                                          next.select();
                                        }
                                      }, 50);
                                  } else if (e.key === "Enter") {
                                    e.preventDefault();
                                    if (index === transferFields.length - 1) {
                                      appendTransfer({
                                        sourceLocationId: 0,
                                        sourceLocationName: "",
                                        stockItemId: 0,
                                        stockItemCode: "",
                                        stockItemName: "",
                                        quantity: "",
                                        rate: "",
                                      });
                                      setTimeout(() => {
                                        const newInput = document.querySelector(
                                          `[data-testid="input-source-${index + 1}"]`
                                        ) as HTMLInputElement;
                                        if (newInput) newInput.focus();
                                      }, 100);
                                    }
                                  }
                                }}
                                placeholder="0"
                                className="w-full h-full px-3 bg-transparent outline-none focus:bg-accent/20 font-mono text-right"
                                data-testid={`input-transfer-rate-${index}`}
                              />
                            </div>
                            <div className="w-20 sm:w-28 border-r h-9 sm:h-10 bg-muted/30 flex items-center justify-end px-2 sm:px-3 font-mono text-xs sm:text-sm">
                              {formatAmount(
                                parseFloat(transferEntries[index]?.quantity || "0") *
                                  parseFloat(transferEntries[index]?.rate || "0")
                              )}
                            </div>
                          </>
                        )}
                        <div className="w-10 sm:w-12 flex items-center justify-center h-9 sm:h-10">
                          {transferFields.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => removeTransfer(index)}
                              className="h-8 w-8"
                              data-testid={`button-remove-transfer-${index}`}
                            >
                              <X className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Total Section */}
              <div className="border-t bg-muted/20 p-4">
                <div className="flex flex-wrap justify-end items-center gap-2 sm:gap-8 max-w-lg ml-auto">
                  <div className="text-xs text-muted-foreground">Total Items:</div>
                  <div className="text-xs font-mono font-medium">
                    {transferEntries.filter((e) => e.stockItemId > 0).length}
                  </div>
                  <div className="text-xs text-muted-foreground">Total Qty:</div>
                  <div className="text-xs font-mono font-medium">
                    {Math.floor(transferEntries.reduce((sum, e) => sum + parseFloat(e.quantity || "0"), 0))}
                  </div>
                  {!isPOS && (
                    <>
                      <div className="text-xs font-semibold">Grand Total:</div>
                      <div className="text-sm font-bold font-mono" data-testid="text-transfer-total">
                        {formatAmount(transferTotal)}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </Card>

            {/* Item Search Sidebar */}
            {showItemSidebar && (
              <Card className="hidden sm:flex flex-col w-full lg:w-80 lg:sticky lg:top-4 max-h-[60vh] lg:max-h-[calc(100vh-12rem)] self-start">
                <div className="p-4 border-b">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <h3 className="text-sm font-semibold">Search Items</h3>
                    <button
                      onClick={() => setShowItemSidebar(false)}
                      className="text-xs text-muted-foreground hover:text-foreground"
                      data-testid="button-close-item-sidebar"
                    >
                      ✕
                    </button>
                  </div>
                  {transferInventorySource && (
                    <p className="text-xs text-muted-foreground mb-3">
                      {locations.find((l) => l.id === transferInventorySource)?.name}
                    </p>
                  )}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by name or code..."
                      value={transferSearchTerm}
                      onChange={(e) => {
                        setTransferSearchTerm(e.target.value);
                        setTransferHighlightedIndex(0);
                      }}
                      className="pl-9"
                      data-testid="input-transfer-sidebar-search"
                    />
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-2" ref={transferSidebarRef}>
                  <div className="space-y-1">
                    {!transferInventorySource ? (
                      <div className="text-center py-8 text-sm text-muted-foreground">
                        Select a source location to see available items
                      </div>
                    ) : (
                      (() => {
                        const filteredInventory = transferInventory
                          .filter((item: any) => {
                            if (!transferSearchTerm.trim()) return true;
                            const term = transferSearchTerm.toLowerCase();
                            return (
                              item.stockItemName?.toLowerCase().includes(term) ||
                              item.stockItemCode?.toLowerCase().includes(term)
                            );
                          })
                          .sort((a: any, b: any) => (a.stockItemName || "").localeCompare(b.stockItemName || ""));
                        if (filteredInventory.length === 0)
                          return <div className="text-center py-8 text-sm text-muted-foreground">No items found</div>;
                        return filteredInventory.map((item: any, idx: number) => {
                          const stock = parseFloat(item.quantity || "0");
                          const isHighlighted = idx === transferHighlightedIndex && activeTransferRow !== null;
                          return (
                            <button
                              key={item.stockItemId}
                              type="button"
                              data-transfer-idx={idx}
                              className={`w-full text-left px-3 py-3 rounded-md hover-elevate active-elevate-2 ${stock === 0 ? "opacity-60" : ""} ${isHighlighted ? "bg-accent" : ""}`}
                              data-testid={`button-suggest-item-${item.stockItemId}`}
                              onClick={() => {
                                if (activeTransferRow !== null) {
                                  const stockItem = stockItems.find((s) => s.id === item.stockItemId);
                                  if (stockItem) {
                                    const sourceId = Number(transferInventorySource);
                                    if (!(sourceId > 0)) {
                                      toast({
                                        title: "Select a source location first",
                                        description:
                                          "Please select a source location from the inventory sidebar before adding items.",
                                        variant: "destructive",
                                      });
                                      return;
                                    }
                                    const sourceLocation = locations.find((l) => l.id === sourceId);
                                    stockTransferForm.setValue(
                                      `entries.${activeTransferRow}.sourceLocationId`,
                                      sourceId,
                                      { shouldValidate: true, shouldDirty: true, shouldTouch: true }
                                    );
                                    stockTransferForm.setValue(
                                      `entries.${activeTransferRow}.sourceLocationName`,
                                      sourceLocation?.name || ""
                                    );
                                    stockTransferForm.setValue(
                                      `entries.${activeTransferRow}.stockItemId`,
                                      item.stockItemId,
                                      { shouldValidate: true, shouldDirty: true, shouldTouch: true }
                                    );
                                    stockTransferForm.setValue(
                                      `entries.${activeTransferRow}.stockItemCode`,
                                      stockItem.code || ""
                                    );
                                    stockTransferForm.setValue(
                                      `entries.${activeTransferRow}.stockItemName`,
                                      stockItem.name
                                    );
                                    stockTransferForm.setValue(
                                      `entries.${activeTransferRow}.rate`,
                                      item.averageRate || "0"
                                    );
                                    setTransferSearchTerm("");
                                    setTimeout(() => {
                                      const qty = document.querySelector(
                                        `[data-testid="input-transfer-quantity-${activeTransferRow}"]`
                                      ) as HTMLInputElement;
                                      if (qty) {
                                        qty.focus();
                                        qty.select();
                                      }
                                    }, 50);
                                  }
                                }
                              }}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-medium mb-1 truncate">{item.stockItemName}</div>
                                </div>
                                <div className="flex items-center">
                                  <div
                                    className={`text-xs font-medium px-2 py-0.5 rounded ${stock === 0 ? "bg-destructive/10 text-destructive" : stock < 10 ? "bg-chart-3/10 text-chart-3" : "bg-chart-2/10 text-chart-2"}`}
                                  >
                                    {stock === 0 ? "Out" : `${stock.toFixed(0)}`}
                                  </div>
                                </div>
                              </div>
                            </button>
                          );
                        });
                      })()
                    )}
                  </div>
                </div>
              </Card>
            )}

            {/* Source Location Sidebar */}
            {!isPOS && showSourceSidebar && (
              <Card className="hidden sm:flex flex-col w-full lg:w-80 lg:sticky lg:top-4 max-h-[60vh] lg:max-h-[calc(100vh-12rem)] self-start">
                <div className="p-4 border-b">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <h3 className="text-sm font-semibold">Select Source</h3>
                    <button
                      onClick={() => setShowSourceSidebar(false)}
                      className="text-xs text-muted-foreground hover:text-foreground"
                      data-testid="button-close-source-sidebar"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search locations..."
                      value={transferSourceSearchTerm}
                      onChange={(e) => {
                        setTransferSourceSearchTerm(e.target.value);
                        setTransferSourceHighlightedIndex(0);
                      }}
                      className="pl-9"
                      data-testid="input-transfer-source-search"
                    />
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-2">
                  <div className="space-y-1">
                    {(() => {
                      const filteredLocations = locations
                        .filter((loc) => {
                          if (!transferSourceSearchTerm.trim()) return true;
                          const term = transferSourceSearchTerm.toLowerCase();
                          return (
                            (loc.name || "").toLowerCase().includes(term) ||
                            (loc.code && loc.code.toLowerCase().includes(term))
                          );
                        })
                        .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
                      if (filteredLocations.length === 0)
                        return <div className="text-center py-8 text-sm text-muted-foreground">No locations found</div>;
                      return filteredLocations.map((loc, idx) => {
                        const isHighlighted = idx === transferSourceHighlightedIndex && activeTransferRow !== null;
                        return (
                          <button
                            key={loc.id}
                            type="button"
                            className={`w-full text-left px-3 py-3 rounded-md hover-elevate active-elevate-2 ${isHighlighted ? "bg-accent" : ""}`}
                            data-testid={`button-select-source-location-${loc.id}`}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              transferFocusIdRef.current += 1;
                            }}
                            onClick={() => {
                              if (activeTransferRow !== null) {
                                const rowIndex = activeTransferRow;
                                stockTransferForm.setValue(`entries.${rowIndex}.sourceLocationId`, loc.id);
                                stockTransferForm.setValue(`entries.${rowIndex}.sourceLocationName`, loc.name);
                                setTransferInventorySource(loc.id);
                                setTransferSourceSearchTerm("");
                                setShowSourceSidebar(false);
                                setActiveTransferRow(null);
                                setActiveFieldType(null);
                                setTimeout(() => {
                                  const item = document.querySelector(
                                    `[data-testid="input-item-name-${rowIndex}"]`
                                  ) as HTMLInputElement;
                                  if (item) {
                                    item.focus();
                                    item.select();
                                  }
                                }, 50);
                              }
                            }}
                          >
                            <div className="text-sm font-medium">{loc.name}</div>
                          </button>
                        );
                      });
                    })()}
                  </div>
                </div>
              </Card>
            )}
          </div>

          {/* Notes and Options */}
          <div className="mt-4 flex flex-wrap items-start gap-2 sm:gap-4">
            <FormField
              control={stockTransferForm.control}
              name="notes"
              render={({ field }) => (
                <FormItem className="flex-1">
                  <FormControl>
                    <Textarea
                      {...field}
                      placeholder="Notes (optional)"
                      className="resize-none h-9"
                      data-testid="input-transfer-notes"
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={stockTransferForm.control}
              name="optional"
              render={({ field }) => (
                <FormItem className="flex items-center gap-2 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      data-testid="checkbox-transfer-optional"
                    />
                  </FormControl>
                  <FormLabel className="text-sm">Optional</FormLabel>
                </FormItem>
              )}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  disabled={transferEntries.filter((e) => e.stockItemId > 0).length === 0}
                  data-testid="button-export-stock-transfer"
                >
                  <FileDown className="h-4 w-4 mr-2" />
                  Export
                  <ChevronDown className="h-4 w-4 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => handleExportStockTransfer(false)}
                  data-testid="export-transfer-summary"
                >
                  Summary Export
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleExportStockTransfer(true)}
                  data-testid="export-transfer-detailed"
                >
                  Detailed Export
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              type="submit"
              disabled={
                stockTransferMutation.isPending || transferEntries.filter((e) => e.stockItemId > 0).length === 0
              }
              data-testid="button-save-transfer-voucher"
            >
              {stockTransferMutation.isPending ? "Saving..." : "Save Transfer"}
            </Button>
            {voucherIdToEdit && stockTransferToEdit?.id && (
              <Button
                type="button"
                variant="outline"
                disabled={isTransferSavingRevision || transferEntries.filter((e) => e.stockItemId > 0).length === 0}
                onClick={handleTransferSaveAsRevision}
                data-testid="button-save-transfer-revision"
              >
                <GitBranch className="h-4 w-4 mr-1" />
                Save as Revision
              </Button>
            )}
          </div>
        </form>
      </Form>

      {/* Revision Approve Dialog */}
      <Dialog
        open={!!approveRevisionTarget}
        onOpenChange={(open) => {
          if (!open) setApproveRevisionTarget(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Approve Revision</DialogTitle>
            <DialogDescription>
              The following quantity changes will be applied to the transfer. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {approveRevisionTarget && (
            <div className="table-responsive rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left p-2 font-medium">Item</th>
                    <th className="text-right p-2 font-medium">Was</th>
                    <th className="text-right p-2 font-medium">Change</th>
                    <th className="text-right p-2 font-medium">Now</th>
                  </tr>
                </thead>
                <tbody>
                  {(approveRevisionTarget.items ?? [])
                    .filter((item: any) => parseFloat(item.delta) !== 0)
                    .map((item: any, idx: number) => {
                      const delta = parseFloat(item.delta);
                      return (
                        <tr key={idx} className="border-t">
                          <td className="p-2 font-medium">{item.stockItemName}</td>
                          <td className="p-2 text-right font-mono text-muted-foreground">
                            {formatNumber(parseFloat(item.originalQuantity), 0)}
                          </td>
                          <td
                            className={`p-2 text-right font-mono font-semibold ${delta > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}
                          >
                            {delta > 0 ? "+" : ""}
                            {formatNumber(delta, 0)}
                          </td>
                          <td className="p-2 text-right font-mono font-semibold">
                            {formatNumber(parseFloat(item.newQuantity), 0)}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setApproveRevisionTarget(null)}
              data-testid="button-approve-revision-cancel"
            >
              Cancel
            </Button>
            <Button
              variant="default"
              disabled={approveRevisionMutation.isPending}
              onClick={() => approveRevisionTarget && approveRevisionMutation.mutate(approveRevisionTarget.id)}
              data-testid="button-approve-revision-confirm"
            >
              {approveRevisionMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  Applying…
                </>
              ) : (
                "Approve & Apply"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revision History Panel */}
      {voucherIdToEdit && stableTransferId && (
        <div className="mt-4 border rounded-xl overflow-hidden">
          <button
            type="button"
            className="w-full flex items-center justify-between gap-2 px-4 py-3 bg-muted/40 hover:bg-muted/60 transition-colors text-left cursor-pointer select-none"
            onClick={() => setTransferRevisionsExpanded((v) => !v)}
          >
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Revision History</span>
              {transferRevisions.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-xs no-default-active-elevate">
                  {transferRevisions.length}
                </Badge>
              )}
            </div>
            {transferRevisionsExpanded ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
          {transferRevisionsExpanded && (
            <div className="p-4 space-y-4">
              {transferRevisions.length === 0 ? (
                <EmptyState
                  icon={History}
                  title="No revisions yet"
                  description='Use "Save as Revision" to record tracked changes to this transfer.'
                />
              ) : (
                transferRevisions.map((rev: any) => (
                  <div key={rev.id} className="border rounded-md overflow-hidden">
                    {rev.optional && (
                      <div className="flex items-center justify-between gap-3 px-3 py-2 status-warning border-b">
                        <span className="text-xs font-medium">Pending POS adjustment — awaiting admin approval</span>
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => setApproveRevisionTarget(rev)}
                          data-testid={`button-approve-revision-${rev.id}`}
                        >
                          Approve
                        </Button>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-3 p-3 bg-muted/40 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={rev.optional ? "secondary" : "default"}>Rev {rev.revisionNumber}</Badge>
                        {rev.optional && (
                          <Badge variant="outline" className="text-xs">
                            Reference Only
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {rev.revisionDate ? new Date(rev.revisionDate).toLocaleDateString() : ""}
                        </span>
                        {rev.note && <span className="text-xs italic text-muted-foreground">"{rev.note}"</span>}
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground">Reference only:</span>
                        <Switch
                          checked={rev.optional}
                          onCheckedChange={async (checked) => {
                            try {
                              await modeApiRequest("PATCH", `/api/stock-transfer-revisions/${rev.id}/optional`, {
                                optional: checked,
                              });
                            } finally {
                              setTransferRevisionsExpanded(true);
                              queryClient.invalidateQueries({
                                queryKey: ["/api/stock-transfers", lastKnownTransferIdRef.current, "revisions"],
                              });
                            }
                          }}
                          data-testid={`switch-transfer-revision-optional-${rev.id}`}
                        />
                      </div>
                    </div>
                    {rev.items && rev.items.length > 0 && (
                      <div className="table-responsive">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/30">
                            <tr>
                              <th className="text-left p-2 font-medium">Item</th>
                              <th className="text-left p-2 font-medium hidden sm:table-cell">From</th>
                              <th className="text-right p-2 font-medium">Was</th>
                              <th className="text-right p-2 font-medium">Change</th>
                              <th className="text-right p-2 font-medium">Now</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rev.items
                              .filter((item: any) => parseFloat(item.delta) !== 0)
                              .map((item: any, idx: number) => {
                                const delta = parseFloat(item.delta);
                                return (
                                  <tr key={idx} className="border-t">
                                    <td className="p-2 font-medium">{item.stockItemName}</td>
                                    <td className="p-2 text-muted-foreground hidden sm:table-cell">
                                      {item.sourceLocationName || "—"}
                                    </td>
                                    <td className="p-2 text-right font-mono text-muted-foreground">
                                      {formatNumber(parseFloat(item.originalQuantity), 0)}
                                    </td>
                                    <td
                                      className={`p-2 text-right font-mono font-semibold ${delta > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}
                                    >
                                      {delta > 0 ? "+" : ""}
                                      {formatNumber(delta, 0)}
                                    </td>
                                    <td className="p-2 text-right font-mono font-semibold">
                                      {formatNumber(parseFloat(item.newQuantity), 0)}
                                    </td>
                                  </tr>
                                );
                              })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* Transfer Revision Note Dialog */}
      <Dialog open={transferRevisionDialogOpen} onOpenChange={setTransferRevisionDialogOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitBranch className="h-4 w-4" />
              Save as Revision
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This will update the transfer <strong>and</strong> record the changes as{" "}
              <strong>Rev {transferRevisions.length + 1}</strong>.
            </p>
            {(() => {
              const items = computeTransferRevisionItems();
              return items.length === 0 ? (
                <p className="text-sm status-warning rounded-md px-3 py-2">
                  No differences detected compared to the saved transfer.
                </p>
              ) : (
                <div className="border rounded-md overflow-hidden text-sm">
                  <table className="w-full">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-2 font-medium">Item</th>
                        <th className="text-right p-2 font-medium">Was</th>
                        <th className="text-right p-2 font-medium">Change</th>
                        <th className="text-right p-2 font-medium">Now</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item, idx) => (
                        <tr key={idx} className="border-t">
                          <td className="p-2 font-medium truncate max-w-[120px]">{item.stockItemName}</td>
                          <td className="p-2 text-right font-mono text-muted-foreground">
                            {formatNumber(item.originalQuantity, 0)}
                          </td>
                          <td
                            className={`p-2 text-right font-mono font-semibold ${item.delta > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}
                          >
                            {item.delta > 0 ? "+" : ""}
                            {formatNumber(item.delta, 0)}
                          </td>
                          <td className="p-2 text-right font-mono">{formatNumber(item.newQuantity, 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}
            <div className="space-y-1.5">
              <Label htmlFor="transfer-revision-note">Note (optional)</Label>
              <Textarea
                id="transfer-revision-note"
                placeholder="Why was this revised? e.g. Shop sold 10 bales"
                value={transferRevisionNote}
                onChange={(e) => setTransferRevisionNote(e.target.value)}
                rows={2}
                data-testid="input-transfer-revision-note"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setTransferRevisionDialogOpen(false)}
              disabled={isTransferSavingRevision}
            >
              Cancel
            </Button>
            <Button
              onClick={confirmTransferSaveAsRevision}
              disabled={isTransferSavingRevision || computeTransferRevisionItems().length === 0}
              data-testid="button-confirm-transfer-revision"
            >
              {isTransferSavingRevision ? "Saving..." : "Save Revision"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stock Transfer Import Dialog */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="w-[95vw] sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Import Stock Transfer from Excel
            </DialogTitle>
            <DialogDescription>
              Upload an Excel file with columns: Source Location, Barcode, Quantity. Each row can have a different
              source location.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex-1 w-full sm:w-auto">
                <Label htmlFor="import-file">Excel File</Label>
                <Input
                  id="import-file"
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleImportFileChange}
                  className="mt-1"
                  data-testid="input-import-file"
                />
                {importFile && <p className="text-sm text-muted-foreground mt-1">Selected: {importFile.name}</p>}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={downloadImportTemplate}
                className="mt-6"
                data-testid="button-download-import-template"
              >
                <Download className="h-4 w-4 mr-2" />
                Template
              </Button>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="import-dest-location">Destination Location</Label>
                <Select value={importDestLocation} onValueChange={setImportDestLocation}>
                  <SelectTrigger id="import-dest-location" className="mt-1" data-testid="select-import-dest-location">
                    <SelectValue placeholder="Select destination..." />
                  </SelectTrigger>
                  <SelectContent>
                    {[...locations]
                      .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
                      .map((location) => (
                        <SelectItem key={location.id} value={location.id.toString()}>
                          {location.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="import-date">Transfer Date</Label>
                <Input
                  id="import-date"
                  type="date"
                  value={importDate}
                  onChange={(e) => setImportDate(e.target.value)}
                  className="mt-1"
                  data-testid="input-import-date"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="import-notes">Notes (Optional)</Label>
              <Textarea
                id="import-notes"
                value={importNotes}
                onChange={(e) => setImportNotes(e.target.value)}
                placeholder="Optional notes for this transfer..."
                rows={2}
                className="mt-1"
                data-testid="input-import-notes"
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button
                onClick={handleImportParse}
                disabled={!importFile || importParseMutation.isPending}
                variant="outline"
                data-testid="button-import-parse"
              >
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                {importParseMutation.isPending ? "Parsing..." : "Parse File"}
              </Button>
              <Button
                onClick={handleImportValidate}
                disabled={!importPreview || !importDestLocation || importValidateMutation.isPending}
                variant="outline"
                data-testid="button-import-validate"
              >
                {importIsValidated ? (
                  importHasErrors ? (
                    <XCircle className="h-4 w-4 mr-2 text-destructive" />
                  ) : (
                    <CheckCircle className="h-4 w-4 mr-2 text-green-600" />
                  )
                ) : null}
                {importValidateMutation.isPending ? "Validating..." : "Validate"}
              </Button>
              <Button
                onClick={handleImportSubmit}
                disabled={!importIsValidated || importMutation.isPending}
                data-testid="button-import-submit"
              >
                <Upload className="h-4 w-4 mr-2" />
                {importMutation.isPending
                  ? "Importing..."
                  : importHasErrors
                    ? `Import Transfer (${importValidItemsCount} valid)`
                    : "Import Transfer"}
              </Button>
            </div>
            {importValidationResult?.errors && importValidationResult.errors.length > 0 && (
              <div className="p-3 border border-destructive rounded-md bg-destructive/10">
                <p className="font-medium text-destructive mb-2">Validation Errors:</p>
                <ul className="list-disc list-inside space-y-1">
                  {importValidationResult.errors.map((error: string, index: number) => (
                    <li key={index} className="text-sm text-destructive">
                      {error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {importPreview && (
              <div className="border rounded-md">
                <div className="p-3 border-b bg-muted/50">
                  <p className="font-medium">Preview ({importPreview.items.length} items)</p>
                </div>
                <div className="hidden sm:block max-h-60 overflow-y-auto overflow-x-auto">
                  <Table>
                    <TableHeader className="sticky top-0 z-20 bg-background">
                      <TableRow>
                        <TableHead className="sticky left-0 bg-muted z-10">Source Location</TableHead>
                        <TableHead>Barcode</TableHead>
                        <TableHead>Item Name</TableHead>
                        <TableHead className="text-right">Quantity</TableHead>
                        <TableHead className="text-right">Available</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {importPreview.items.map((item: any, index: number) => {
                        const validation = importValidationResult?.validatedItems?.[index];
                        const hasError = validation?.error;
                        return (
                          <TableRow
                            key={index}
                            className={hasError ? "bg-destructive/10" : ""}
                            data-testid={`import-preview-row-${index}`}
                          >
                            <TableCell className="sticky left-0 bg-background z-10">
                              {item.sourceLocation || "-"}
                            </TableCell>
                            <TableCell className="font-mono">{item.barcode}</TableCell>
                            <TableCell>
                              {validation?.stockItemName || (
                                <span className="text-muted-foreground italic">Unknown</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right">{item.quantity}</TableCell>
                            <TableCell className="text-right">
                              {validation?.currentStock !== undefined ? formatNumber(validation.currentStock) : "-"}
                            </TableCell>
                            <TableCell>
                              {validation ? (
                                hasError ? (
                                  <div className="flex items-center gap-1 text-destructive">
                                    <XCircle className="h-4 w-4" />
                                    <span className="text-sm">{validation.error}</span>
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
                <div className="sm:hidden max-h-60 overflow-y-auto p-2 space-y-2">
                  {importPreview.items.map((item: any, index: number) => {
                    const validation = importValidationResult?.validatedItems?.[index];
                    const hasError = validation?.error;
                    return (
                      <div
                        key={index}
                        className={cn(
                          "p-3 rounded-md border text-sm space-y-1",
                          hasError ? "bg-destructive/10 border-destructive/30" : "bg-background"
                        )}
                        data-testid={`import-preview-card-${index}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium truncate">
                            {validation?.stockItemName || <span className="text-muted-foreground italic">Unknown</span>}
                          </span>
                          {validation ? (
                            hasError ? (
                              <XCircle className="h-4 w-4 text-destructive shrink-0" />
                            ) : (
                              <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
                            )
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>Source: {item.sourceLocation || "-"}</span>
                          <span className="font-mono">Code: {item.barcode}</span>
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                          <span>
                            Qty: <span className="font-mono">{item.quantity}</span>
                          </span>
                          <span>
                            Avail:{" "}
                            <span className="font-mono">
                              {validation?.currentStock !== undefined ? formatNumber(validation.currentStock) : "-"}
                            </span>
                          </span>
                        </div>
                        {hasError && <div className="text-xs text-destructive">{validation.error}</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Import Confirmation Dialog */}
      <AlertDialog open={importConfirmDialogOpen} onOpenChange={setImportConfirmDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Import with Validation Errors?</AlertDialogTitle>
            <AlertDialogDescription>
              {importValidItemsCount === 0 ? (
                <>All {importTotalItemsCount} items have validation errors. Nothing will be imported.</>
              ) : (
                <>
                  {importTotalItemsCount - importValidItemsCount} of {importTotalItemsCount} items have validation
                  errors and will be skipped.
                  <br />
                  <br />
                  <strong>{importValidItemsCount} valid item(s)</strong> will be transferred.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-import-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmedImport} data-testid="button-import-confirm">
              {importValidItemsCount === 0 ? "OK" : `Import ${importValidItemsCount} Item(s)`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
