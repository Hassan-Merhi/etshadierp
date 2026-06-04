import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  MessageCircle,
  X,
  Send,
  Bot,
  User,
  Loader2,
  MinimizeIcon,
  Maximize2,
  ThumbsUp,
  ThumbsDown,
  Sparkles,
  RefreshCw,
  AlertTriangle,
  Package,
  Users,
  FileText,
  Clock,
  ChevronDown,
  ChevronUp,
  Check,
  XCircle,
  Search,
  Paperclip,
  Upload,
  ShoppingCart,
  Download,
  FileCheck,
  ArrowLeftRight,
  TrendingUp,
  Circle,
  Copy,
  Eye,
  EyeOff,
  Cpu,
  FileCode,
  GitBranch,
  GitCommit,
  Plus,
  Minus,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  message: string;
  createdAt: string;
}

interface ChatStatus {
  enabled: boolean;
  hasApiKey: boolean;
  isAdminOrOwner: boolean;
}

interface StockCandidate {
  id: number;
  name: string;
  code?: string;
}

interface LocationCandidate {
  id: number;
  name: string;
}

interface StockAdjustmentDraft {
  date: string;
  locationId: number;
  locationName: string;
  locationCandidates?: LocationCandidate[];
  notes: string;
  optional?: boolean;
  items: {
    type: "PRODUCE" | "CONSUME";
    stockItemId: number;
    stockItemName: string;
    quantity: number;
    rate: number;
    candidates?: StockCandidate[];
  }[];
}

interface VoucherSearchResult {
  id: number;
  voucherNumber: string;
  voucherType: string;
  voucherDate: string;
  description: string | null;
  totalAmount: string;
  optional: boolean;
}

interface StockItemDraft {
  name: string;
  code: string;
  uom: string;
  stockGroupId: number | null;
  stockGroupName: string;
  groupCandidates: { id: number; name: string }[];
}

interface PriceUpdateDraft {
  stockItemId: number;
  stockItemName: string;
  stockItemCode: string;
  locationId: number | null;
  locationName: string;
  newPrice: number;
  followerCount: number;
  itemCandidates: { id: number; name: string; code: string }[];
  locationCandidates: { id: number; name: string }[];
  allLocations: { id: number; name: string }[];
}

interface AccountTransaction {
  voucherId: number;
  voucherNumber: string;
  voucherType: string;
  voucherDate: string;
  description: string | null;
  narration: string | null;
  debitAmount: string;
  creditAmount: string;
  totalAmount?: string;
  balanceAfter?: number;
}

interface AccountQueryResult {
  queryType: "balance" | "transactions" | "balance_history";
  accountId: number;
  accountName: string;
  balance?: number;
  searchTerm?: string;
  searchAmount?: number;
  targetBalance?: number;
  transactions?: AccountTransaction[];
  matches?: (AccountTransaction & { balanceAfter: number })[];
}

interface PODraftLine {
  rawName: string;
  rawCode: string;
  stockItemId: number | null;
  stockItemName: string;
  qty: string;
  rate: string;
  lineTotal: string;
  itemName?: string;
}

interface POImportDraft {
  poNumber: string;
  containerNumber: string;
  importDate: string;
  currency: string;
  supplierId: number | null;
  supplierName: string;
  supplierRaw: string;
  lines: PODraftLine[];
  charges: {
    freight: number;
    surcharge: number;
    fumigation: number;
    documentCharges: number;
    discount: number;
    otherCharges: number;
  };
  itemsTotal: string;
  grandTotal: string;
  unresolvedSupplier: boolean;
  unresolvedItems: { index: number; rawName: string; rawCode: string }[];
  allSuppliers: { id: number; name: string; code: string }[];
  allStockItems: { id: number; name: string; code: string }[];
}

interface POImportResult {
  success: boolean;
  poId: number;
  poNumber: string;
  containerNumber: string;
  containerId: number;
  supplierId: number;
  lineCount: number;
  itemsTotal: string;
  grandTotal: string;
  crossCompany: boolean;
  availableProformas: { id: number; reference: string }[];
}

interface VerifyContainerDraft {
  containerNumber: string;
  containerId: number;
  supplierId: number;
  supplierName: string;
  proformas: { id: number; reference: string }[];
}

interface DataQueryResult {
  queryType: string;
  title: string;
  subtitle?: string;
  stats?: Array<{
    label: string;
    value: string;
    subtext?: string;
    highlight?: "positive" | "negative" | "muted" | "neutral";
  }>;
  table?: {
    headers: string[];
    rows: string[][];
  };
  summary?: string;
  noData?: boolean;
}

interface FilePatchDraft {
  filePath: string;
  description: string;
  originalContent: string;
  newContent: string;
}

interface ChatResponse {
  response: string;
  suggestions: string[];
  provider?: string;
  voucherDraft?: VoucherDraft | null;
  stockAdjustmentDraft?: StockAdjustmentDraft | null;
  stockTransferDraft?: StockTransferDraft | null;
  voucherSearchResults?: VoucherSearchResult[] | null;
  stockItemDraft?: StockItemDraft | null;
  priceUpdateDraft?: PriceUpdateDraft | null;
  accountQueryResult?: AccountQueryResult | null;
  verifyContainerDraft?: VerifyContainerDraft | null;
  dataQueryResult?: DataQueryResult | null;
  filePatchDraft?: FilePatchDraft | null;
}

interface VoucherDraft {
  type: "Payment" | "Receipt" | "Journal";
  date: string;
  description: string;
  optional?: boolean;
  entries: {
    accountId: number;
    accountName: string;
    debit: number;
    credit: number;
    balanceBefore?: number;
  }[];
}

interface StockTransferDraft {
  date: string;
  sourceLocationId: number;
  sourceLocationName: string;
  destinationLocationId: number;
  destinationLocationName: string;
  notes?: string;
  items: {
    stockItemId: number;
    stockItemName: string;
    quantity: number;
    currentStock?: number;
    candidates?: { id: number; name: string; code?: string }[];
  }[];
  locationCandidates?: { id: number; name: string }[];
}

interface AlertDigest {
  lowStock: { id: number; name: string; code: string; qty: number; reorderLevel: number }[];
  openPOs: { id: number; poNumber: string }[];
  overdueCustomers: { customerId: number; name: string; balance: number }[];
  pendingPayrolls: { id: number; periodStart: string; periodEnd: string; status: string }[];
}

// ── Alerts Digest Card ────────────────────────────────────────────────
function AlertsDigest({ onClose, onPrefill }: { onClose: () => void; onPrefill: (text: string) => void }) {
  const [expanded, setExpanded] = useState(false);

  const { data: alerts, isLoading } = useQuery<AlertDigest>({
    queryKey: ["/api/chatbot/alerts"],
    staleTime: 5 * 60 * 1000,
  });

  const totalAlerts =
    (alerts?.lowStock.length ?? 0) +
    (alerts?.openPOs.length ?? 0) +
    (alerts?.overdueCustomers.length ?? 0) +
    (alerts?.pendingPayrolls.length ?? 0);

  if (!isLoading && totalAlerts === 0) return null;

  return (
    <div className="mx-3 mt-3 mb-1 rounded-md border border-amber-500/30 bg-amber-50/60 dark:bg-amber-950/30 text-sm overflow-hidden" data-testid="alerts-digest">
      <button
        className="w-full flex items-center justify-between px-3 py-2 text-amber-700 dark:text-amber-400 font-medium"
        onClick={() => setExpanded(v => !v)}
        data-testid="button-toggle-alerts"
      >
        <span className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {isLoading ? "Loading alerts…" : `${totalAlerts} item${totalAlerts !== 1 ? "s" : ""} need attention`}
        </span>
        <span className="flex items-center gap-1">
          <button
            className="text-amber-500 hover:text-amber-700 p-0.5"
            onClick={e => { e.stopPropagation(); onClose(); }}
            data-testid="button-dismiss-alerts"
            title="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </span>
      </button>

      {expanded && !isLoading && alerts && (
        <div className="px-3 pb-3 space-y-2 border-t border-amber-500/20">
          {alerts.lowStock.length > 0 && (
            <div>
              <p className="flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-400 mt-2 mb-1">
                <Package className="h-3 w-3" /> Low Stock ({alerts.lowStock.length})
              </p>
              <ul className="space-y-0.5">
                {alerts.lowStock.slice(0, 4).map(item => (
                  <li key={item.id} className="text-xs text-muted-foreground flex items-center justify-between gap-2">
                    <span className="truncate">{item.name}</span>
                    <span className="flex items-center gap-1 shrink-0">
                      <span className="text-amber-600 dark:text-amber-400">{item.qty} / {item.reorderLevel}</span>
                      <button
                        className="text-xs text-primary underline shrink-0"
                        onClick={() => onPrefill(`Record stock adjustment for "${item.name}" (code: ${item.code})`)}
                        data-testid={`alert-action-stock-adj-${item.id}`}
                        title="Record adjustment"
                      >Adjust</button>
                    </span>
                  </li>
                ))}
                {alerts.lowStock.length > 4 && (
                  <li className="text-xs text-muted-foreground italic">+{alerts.lowStock.length - 4} more</li>
                )}
              </ul>
            </div>
          )}

          {alerts.openPOs.length > 0 && (
            <div>
              <p className="flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1">
                <FileText className="h-3 w-3" /> Open POs ({alerts.openPOs.length})
              </p>
              <ul className="space-y-0.5">
                {alerts.openPOs.slice(0, 3).map(po => (
                  <li key={po.id} className="text-xs text-muted-foreground flex items-center justify-between gap-2">
                    <span>{po.poNumber}</span>
                    <button
                      className="text-xs text-primary underline shrink-0"
                      onClick={() => onPrefill(`Show details for purchase order ${po.poNumber}`)}
                      data-testid={`alert-action-po-${po.id}`}
                    >Details</button>
                  </li>
                ))}
                {alerts.openPOs.length > 3 && (
                  <li className="text-xs text-muted-foreground italic">+{alerts.openPOs.length - 3} more</li>
                )}
              </ul>
            </div>
          )}

          {alerts.overdueCustomers.length > 0 && (
            <div>
              <p className="flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1">
                <Users className="h-3 w-3" /> Customer Receivables ({alerts.overdueCustomers.length})
              </p>
              <ul className="space-y-0.5">
                {alerts.overdueCustomers.slice(0, 3).map(c => (
                  <li key={c.customerId} className="text-xs text-muted-foreground flex items-center justify-between gap-2">
                    <span className="truncate">{c.name}</span>
                    <span className="flex items-center gap-1 shrink-0">
                      <span className="text-amber-600 dark:text-amber-400">${c.balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                      <button
                        className="text-xs text-primary underline"
                        onClick={() => onPrefill(`Record a payment receipt from customer "${c.name}"`)}
                        data-testid={`alert-action-customer-${c.customerId}`}
                      >Receipt</button>
                    </span>
                  </li>
                ))}
                {alerts.overdueCustomers.length > 3 && (
                  <li className="text-xs text-muted-foreground italic">+{alerts.overdueCustomers.length - 3} more</li>
                )}
              </ul>
            </div>
          )}

          {alerts.pendingPayrolls.length > 0 && (
            <div>
              <p className="flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1">
                <Clock className="h-3 w-3" /> Pending Payrolls ({alerts.pendingPayrolls.length})
              </p>
              <ul className="space-y-0.5">
                {alerts.pendingPayrolls.map(p => (
                  <li key={p.id} className="text-xs text-muted-foreground flex items-center justify-between gap-2">
                    <span>{p.periodStart} – {p.periodEnd}</span>
                    <button
                      className="text-xs text-primary underline shrink-0"
                      onClick={() => onPrefill(`Show payroll summary for ${p.periodStart} to ${p.periodEnd}`)}
                      data-testid={`alert-action-payroll-${p.id}`}
                    >Details</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Stock Adjustment Confirmation Card ───────────────────────────────
function StockAdjustmentConfirmCard({
  draft,
  onConfirm,
  onDismiss,
  isSubmitting,
}: {
  draft: StockAdjustmentDraft;
  onConfirm: (resolved: StockAdjustmentDraft) => void;
  onDismiss: () => void;
  isSubmitting: boolean;
}) {
  const [selectedItems, setSelectedItems] = useState<{ id: number; name: string }[]>(
    () => draft.items.map(i => ({ id: i.stockItemId, name: i.stockItemName }))
  );
  const [selectedLocationId, setSelectedLocationId] = useState(draft.locationId);
  const [selectedLocationName, setSelectedLocationName] = useState(draft.locationName);

  const produces = draft.items.filter(i => i.type === "PRODUCE");
  const consumes = draft.items.filter(i => i.type === "CONSUME");
  const adjType = produces.length > 0 && consumes.length > 0 ? "Mixed" : produces.length > 0 ? "Production" : "Consumption";

  const locCandidates = draft.locationCandidates ?? [];
  const hasLocChoice = locCandidates.length > 1;

  const handleConfirm = () => {
    const resolved: StockAdjustmentDraft = {
      ...draft,
      locationId: selectedLocationId,
      locationName: selectedLocationName,
      items: draft.items.map((item, i) => ({
        ...item,
        stockItemId: selectedItems[i].id,
        stockItemName: selectedItems[i].name,
      })),
    };
    onConfirm(resolved);
  };

  return (
    <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/5 overflow-hidden" data-testid="stock-adj-confirm-card">
      <div className="px-3 py-2 bg-amber-500/10 flex items-center gap-2">
        <Package className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
        <span className="text-sm font-semibold text-amber-700 dark:text-amber-400">
          Create {adjType} Voucher?
        </span>
      </div>
      <div className="px-3 py-2 space-y-2 text-xs">
        <div className="flex justify-between gap-2 text-muted-foreground items-center">
          <span className="shrink-0">Date</span>
          <span className="font-medium text-foreground">{draft.date}</span>
        </div>

        {/* Location — dropdown if multiple candidates */}
        <div className="flex justify-between gap-2 text-muted-foreground items-center">
          <span className="shrink-0">Location</span>
          {hasLocChoice ? (
            <select
              className="text-xs font-medium text-foreground bg-background border rounded px-1.5 py-0.5 max-w-[180px]"
              value={selectedLocationId}
              onChange={e => {
                const id = Number(e.target.value);
                const loc = locCandidates.find(l => l.id === id);
                if (loc) { setSelectedLocationId(id); setSelectedLocationName(loc.name); }
              }}
            >
              {locCandidates.map(l => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          ) : (
            <span className="font-medium text-foreground">{selectedLocationName}</span>
          )}
        </div>

        {draft.notes && (
          <div className="flex justify-between gap-2 text-muted-foreground">
            <span>Notes</span><span className="font-medium text-foreground truncate max-w-[180px]">{draft.notes}</span>
          </div>
        )}
        {draft.optional && (
          <div className="flex justify-between gap-2 text-muted-foreground">
            <span>Status</span><span className="font-medium text-amber-600 dark:text-amber-400">Optional</span>
          </div>
        )}

        {/* Items table */}
        <div className="border-t pt-1.5 mt-0.5 space-y-1.5">
          {(() => {
            const hasStockPreview = draft.items.some(i => i.currentStock !== undefined);
            const cols = hasStockPreview
              ? "grid-cols-[1fr_42px_32px_48px_70px]"
              : "grid-cols-[1fr_50px_36px_48px]";
            return (
              <>
                <div className={`grid ${cols} gap-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide`}>
                  <span>Item</span>
                  <span className="text-center">Type</span>
                  <span className="text-right">Qty</span>
                  <span className="text-right">Rate</span>
                  {hasStockPreview && <span className="text-right">Stock</span>}
                </div>
                {draft.items.map((item, i) => {
                  const candidates = item.candidates ?? [];
                  const hasChoice = candidates.length > 1;
                  const isNegative = item.projectedStock !== undefined && item.projectedStock < 0;
                  return (
                    <div key={i} className={`grid ${cols} gap-1 items-center`}>
                      {hasChoice ? (
                        <select
                          className="text-xs font-medium text-foreground bg-background border rounded px-1.5 py-0.5 w-full"
                          value={selectedItems[i].id}
                          onChange={e => {
                            const id = Number(e.target.value);
                            const c = candidates.find(c => c.id === id);
                            if (c) {
                              setSelectedItems(prev => prev.map((s, idx) => idx === i ? { id: c.id, name: c.name } : s));
                            }
                          }}
                        >
                          {candidates.map(c => (
                            <option key={c.id} value={c.id}>{c.name}{c.code ? ` (${c.code})` : ""}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="truncate text-foreground">{selectedItems[i].name}</span>
                      )}
                      <span className={`text-center text-[10px] font-semibold ${item.type === "PRODUCE" ? "text-green-600 dark:text-green-400" : "text-destructive"}`}>
                        {item.type === "PRODUCE" ? "Produce" : "Consume"}
                      </span>
                      <span className="text-right text-foreground">{item.quantity.toLocaleString()}</span>
                      <span className="text-right text-muted-foreground">
                        {item.rate > 0 ? item.rate.toLocaleString(undefined, { maximumFractionDigits: 2 }) : <span className="italic text-[10px]">—</span>}
                      </span>
                      {hasStockPreview && (
                        <span className={`text-right text-[10px] ${isNegative ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
                          {item.currentStock !== undefined ? `${item.currentStock}→` : ""}
                          {item.projectedStock !== undefined ? (
                            <span className={isNegative ? "text-destructive" : "text-green-600 dark:text-green-400"}>
                              {item.projectedStock}
                            </span>
                          ) : null}
                        </span>
                      )}
                    </div>
                  );
                })}
              </>
            );
          })()}
        </div>
        {draft.items.some(i => i.projectedStock !== undefined && i.projectedStock < 0) && (
          <p className="text-[10px] text-destructive border-t pt-1">Warning: stock would go negative for one or more items.</p>
        )}
      </div>
      <div className="px-3 py-2 border-t flex gap-2 justify-end">
        <Button variant="outline" size="sm" onClick={onDismiss} disabled={isSubmitting} data-testid="button-dismiss-stock-adj">
          <XCircle className="h-3.5 w-3.5 mr-1" /> Dismiss
        </Button>
        <Button size="sm" onClick={handleConfirm} disabled={isSubmitting} data-testid="button-confirm-stock-adj">
          {isSubmitting ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Check className="h-3.5 w-3.5 mr-1" />}
          Confirm & Create
        </Button>
      </div>
    </div>
  );
}

// ── Voucher Search Results Card ──────────────────────────────────────
const VOUCHER_TYPE_TAB: Record<string, string> = {
  Payment: "payment",
  Receipt: "receipt",
  Journal: "journal",
  "Stock Transfer": "transfer",
  Production: "adjustment",
  Consumption: "adjustment",
  Mixed: "adjustment",
  "Credit Note": "creditnote",
};

function VoucherSearchResultsCard({
  results,
  onDismiss,
}: {
  results: VoucherSearchResult[];
  onDismiss: () => void;
}) {
  const [, setLocation] = useLocation();
  return (
    <div className="mt-2 rounded-md border border-blue-500/30 bg-blue-500/5 overflow-hidden" data-testid="voucher-search-results-card">
      <div className="px-3 py-2 bg-blue-500/10 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
          <span className="text-sm font-semibold text-blue-700 dark:text-blue-400">
            {results.length} Voucher{results.length !== 1 ? "s" : ""} Found
          </span>
        </div>
        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onDismiss}>
          <X className="h-3 w-3" />
        </Button>
      </div>
      <div className="divide-y">
        {results.map(v => {
          const tab = VOUCHER_TYPE_TAB[v.voucherType] ?? "payment";
          const amount = parseFloat(v.totalAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          return (
            <div key={v.id} className="px-3 py-2 flex items-start justify-between gap-2 hover-elevate">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs font-semibold text-foreground">{v.voucherNumber}</span>
                  <span className="text-[10px] text-muted-foreground bg-muted rounded px-1 py-0.5">{v.voucherType}</span>
                  {v.optional && <span className="text-[10px] text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded px-1 py-0.5">Optional</span>}
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{v.description || "—"}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-muted-foreground">{v.voucherDate}</span>
                  <span className="text-[10px] font-medium text-foreground">${amount}</span>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 text-xs h-7 px-2"
                onClick={() => setLocation(`/vouchers?tab=${tab}`)}
                data-testid={`button-view-voucher-${v.id}`}
              >
                View
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Stock Item Confirmation Card ────────────────────────────────────
function StockItemConfirmCard({
  draft,
  onConfirm,
  onDismiss,
  isSubmitting,
}: {
  draft: StockItemDraft;
  onConfirm: (resolved: StockItemDraft) => void;
  onDismiss: () => void;
  isSubmitting: boolean;
}) {
  const [name, setName] = useState(draft.name);
  const [code, setCode] = useState(draft.code);
  const [uom, setUom] = useState(draft.uom);
  const [groupId, setGroupId] = useState<number | null>(draft.stockGroupId);
  const [groupName, setGroupName] = useState(draft.stockGroupName);

  const handleGroupChange = (val: string) => {
    const id = parseInt(val, 10);
    const found = draft.groupCandidates.find(g => g.id === id);
    setGroupId(id);
    setGroupName(found?.name ?? "");
  };

  const handleConfirm = () => {
    onConfirm({ ...draft, name, code, uom, stockGroupId: groupId, stockGroupName: groupName });
  };

  return (
    <div className="mt-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 overflow-hidden" data-testid="stock-item-confirm-card">
      <div className="px-3 py-2 bg-emerald-500/10 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Create Stock Item?</span>
        </div>
        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onDismiss} disabled={isSubmitting}>
          <X className="h-3 w-3" />
        </Button>
      </div>
      <div className="px-3 py-3 space-y-2 text-sm">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium">Item Name</label>
            <input
              className="w-full rounded-md border bg-background px-2 py-1 text-sm"
              value={name}
              onChange={e => setName(e.target.value)}
              data-testid="input-stock-item-name"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium">Code</label>
            <input
              className="w-full rounded-md border bg-background px-2 py-1 text-sm uppercase"
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              data-testid="input-stock-item-code"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium">UOM</label>
            <input
              className="w-full rounded-md border bg-background px-2 py-1 text-sm uppercase"
              value={uom}
              onChange={e => setUom(e.target.value.toUpperCase())}
              data-testid="input-stock-item-uom"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium">Stock Group</label>
            {draft.groupCandidates.length > 0 ? (
              <select
                className="w-full rounded-md border bg-background px-2 py-1 text-sm"
                value={groupId ?? ""}
                onChange={e => handleGroupChange(e.target.value)}
                data-testid="select-stock-item-group"
              >
                <option value="">— Select group —</option>
                {draft.groupCandidates.map(g => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            ) : (
              <input
                className="w-full rounded-md border bg-background px-2 py-1 text-sm"
                value={groupName}
                readOnly
                data-testid="input-stock-item-group"
              />
            )}
          </div>
        </div>
        {!groupId && (
          <p className="text-xs text-amber-600 dark:text-amber-400">A stock group is required to create the item.</p>
        )}
      </div>
      <div className="px-3 pb-3 flex items-center gap-2 justify-end">
        <Button size="sm" variant="outline" onClick={onDismiss} disabled={isSubmitting} data-testid="button-cancel-stock-item">
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={handleConfirm}
          disabled={isSubmitting || !name.trim() || !code.trim() || !uom.trim() || !groupId}
          data-testid="button-confirm-stock-item"
        >
          {isSubmitting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Check className="h-3 w-3 mr-1" />}
          Create Item
        </Button>
      </div>
    </div>
  );
}

// ── Price Update Confirmation Card ──────────────────────────────────
function PriceUpdateConfirmCard({
  draft,
  onConfirm,
  onDismiss,
  isSubmitting,
}: {
  draft: PriceUpdateDraft;
  onConfirm: (resolved: PriceUpdateDraft) => void;
  onDismiss: () => void;
  isSubmitting: boolean;
}) {
  const [itemId, setItemId] = useState(draft.stockItemId);
  const [itemName, setItemName] = useState(draft.stockItemName);
  const [itemCode, setItemCode] = useState(draft.stockItemCode);
  const [locationId, setLocationId] = useState<number | null>(draft.locationId);
  const [locationName, setLocationName] = useState(draft.locationName);
  const [price, setPrice] = useState(String(draft.newPrice));

  const followerCount = draft.allLocations.length > 0
    ? (draft.allLocations.find(l => l.id === locationId) ? draft.followerCount : 0)
    : draft.followerCount;

  const handleItemChange = (val: string) => {
    const id = parseInt(val, 10);
    const found = draft.itemCandidates.find(c => c.id === id);
    setItemId(id);
    setItemName(found?.name ?? "");
    setItemCode(found?.code ?? "");
  };

  const handleLocationChange = (val: string) => {
    const id = parseInt(val, 10);
    const found = draft.allLocations.find(l => l.id === id);
    setLocationId(id);
    setLocationName(found?.name ?? "");
  };

  const priceNum = parseFloat(price);
  const valid = itemId > 0 && locationId && !isNaN(priceNum) && priceNum > 0;

  return (
    <div className="mt-2 rounded-md border border-violet-500/30 bg-violet-500/5 overflow-hidden" data-testid="price-update-confirm-card">
      <div className="px-3 py-2 bg-violet-500/10 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-violet-600 dark:text-violet-400 shrink-0" />
          <span className="text-sm font-semibold text-violet-700 dark:text-violet-400">Update Price List?</span>
        </div>
        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onDismiss} disabled={isSubmitting}>
          <X className="h-3 w-3" />
        </Button>
      </div>
      <div className="px-3 py-3 space-y-2 text-sm">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground font-medium">Stock Item</label>
          {draft.itemCandidates.length > 1 ? (
            <select
              className="w-full rounded-md border bg-background px-2 py-1 text-sm"
              value={itemId}
              onChange={e => handleItemChange(e.target.value)}
              data-testid="select-price-item"
            >
              {draft.itemCandidates.map(c => (
                <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
              ))}
            </select>
          ) : (
            <p className="text-sm font-medium">{itemName} <span className="text-xs text-muted-foreground">({itemCode})</span></p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium">Price Group / Location</label>
            {draft.allLocations.length > 0 ? (
              <select
                className="w-full rounded-md border bg-background px-2 py-1 text-sm"
                value={locationId ?? ""}
                onChange={e => handleLocationChange(e.target.value)}
                data-testid="select-price-location"
              >
                <option value="">— Select —</option>
                {draft.allLocations.map(l => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            ) : (
              <p className="text-sm font-medium">{locationName || "—"}</p>
            )}
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium">New Price</label>
            <input
              type="number"
              min="0"
              step="0.01"
              className="w-full rounded-md border bg-background px-2 py-1 text-sm"
              value={price}
              onChange={e => setPrice(e.target.value)}
              data-testid="input-new-price"
            />
          </div>
        </div>
        {locationId && draft.followerCount > 0 && (
          <p className="text-xs text-violet-600 dark:text-violet-400">
            This price group has {draft.followerCount} follower location{draft.followerCount !== 1 ? "s" : ""} — price will cascade to all of them automatically.
          </p>
        )}
      </div>
      <div className="px-3 pb-3 flex items-center gap-2 justify-end">
        <Button size="sm" variant="outline" onClick={onDismiss} disabled={isSubmitting} data-testid="button-cancel-price-update">
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={() => onConfirm({ ...draft, stockItemId: itemId, stockItemName: itemName, stockItemCode: itemCode, locationId, locationName, newPrice: priceNum })}
          disabled={isSubmitting || !valid}
          data-testid="button-confirm-price-update"
        >
          {isSubmitting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Check className="h-3 w-3 mr-1" />}
          Update Price
        </Button>
      </div>
    </div>
  );
}

// ── PO Import Draft Card ─────────────────────────────────────────────
function POImportDraftCard({
  draft,
  onConfirm,
  onDismiss,
  isSubmitting,
  result,
  importError,
}: {
  draft: POImportDraft;
  onConfirm: (resolved: any) => void;
  onDismiss: () => void;
  isSubmitting: boolean;
  result: POImportResult | null;
  importError: string | null;
}) {
  const [, setLocation] = useLocation();
  const fmt = (n: number | string) =>
    parseFloat(String(n)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const [supplierId, setSupplierId] = useState<number | null>(draft.supplierId);
  const [poNumber, setPoNumber] = useState(draft.poNumber);
  const [containerNumber, setContainerNumber] = useState(draft.containerNumber);
  const [importDate, setImportDate] = useState(draft.importDate);
  const [lines, setLines] = useState<PODraftLine[]>(draft.lines);
  const [charges, setCharges] = useState(draft.charges);
  const [showCharges, setShowCharges] = useState(false);

  const resolveItem = (idx: number, itemId: number) => {
    const item = draft.allStockItems.find(s => s.id === itemId);
    setLines(prev => prev.map((l, i) =>
      i === idx ? { ...l, stockItemId: itemId, stockItemName: item?.name || "", itemName: item?.name || l.rawName } : l
    ));
  };

  const itemsTotal = lines.reduce((s, l) => s + parseFloat(l.qty) * parseFloat(l.rate), 0);
  const chargesTotal = charges.freight + charges.surcharge + charges.fumigation +
    charges.documentCharges - charges.discount + charges.otherCharges;
  const grandTotal = itemsTotal + chargesTotal;

  const unresolvedCount = lines.filter(l => !l.stockItemId).length;
  const canImport = supplierId && poNumber && containerNumber && unresolvedCount === 0;

  const handleImport = () => {
    onConfirm({
      poNumber,
      containerNumber,
      importDate,
      currency: draft.currency,
      supplierId,
      lines: lines.map(l => ({ ...l, itemName: l.itemName || l.rawName })),
      charges,
    });
  };

  return (
    <div className="mt-2 rounded-md border border-orange-500/30 bg-orange-500/5 overflow-hidden" data-testid="po-import-draft-card">
      <div className="px-3 py-2 bg-orange-500/10 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShoppingCart className="h-4 w-4 text-orange-600 dark:text-orange-400 shrink-0" />
          <span className="text-sm font-semibold text-orange-700 dark:text-orange-400">
            PO Import Preview
          </span>
          {unresolvedCount > 0 && (
            <Badge variant="outline" className="text-[10px] px-1.5 text-orange-600 border-orange-400">
              {unresolvedCount} unresolved
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onDismiss} data-testid="button-dismiss-po-import">
          <X className="h-3 w-3" />
        </Button>
      </div>

      {result ? (
        <div className="px-3 py-3">
          <div className="flex items-center gap-2 mb-2">
            <Check className="h-4 w-4 text-green-600" />
            <span className="text-sm font-semibold text-green-700 dark:text-green-400">PO Imported Successfully</span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <span className="text-muted-foreground">PO Number</span>
            <span className="font-medium">{result.poNumber}</span>
            <span className="text-muted-foreground">Container</span>
            <span className="font-medium">{result.containerNumber}</span>
            <span className="text-muted-foreground">Items</span>
            <span className="font-medium">{result.lineCount}</span>
            <span className="text-muted-foreground">Items Total</span>
            <span className="font-medium">{fmt(result.itemsTotal)}</span>
            <span className="text-muted-foreground">Grand Total</span>
            <span className="font-semibold text-foreground">{fmt(result.grandTotal)}</span>
          </div>
          {result.crossCompany && (
            <p className="text-[11px] text-muted-foreground mt-2 italic">
              Cross-company transfer vouchers created in parent company.
            </p>
          )}
          <div className="flex gap-2 mt-3 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => setLocation(`/containers`)}
              data-testid="button-view-po"
            >
              View Containers
            </Button>
          </div>
          {result.availableProformas && result.availableProformas.length > 0 && (
            <div className="mt-3 border-t pt-3">
              <p className="text-[11px] font-semibold text-muted-foreground mb-1.5">Download Verification Excel</p>
              {result.availableProformas.length === 1 ? (
                <a
                  href={`/api/suppliers/${result.supplierId}/containers/${result.containerId}/verification-export.xlsx?proformaId=${result.availableProformas[0].id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Button size="sm" variant="outline" className="h-7 text-xs w-full" data-testid="button-download-verification-excel">
                    <Download className="h-3 w-3 mr-1.5" />
                    {result.availableProformas[0].reference}
                  </Button>
                </a>
              ) : (
                <div className="space-y-1">
                  {result.availableProformas.map(p => (
                    <a
                      key={p.id}
                      href={`/api/suppliers/${result.supplierId}/containers/${result.containerId}/verification-export.xlsx?proformaId=${p.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="block"
                    >
                      <Button variant="outline" size="sm" className="w-full h-7 text-xs justify-start" data-testid={`button-download-proforma-${p.id}`}>
                        <Download className="h-3 w-3 mr-1.5 shrink-0" />{p.reference}
                      </Button>
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div>
          {/* PO header fields */}
          <div className="px-3 pt-2 pb-1 grid grid-cols-2 gap-x-3 gap-y-1.5">
            <div>
              <p className="text-[10px] text-muted-foreground mb-0.5">PO Number</p>
              <Input
                value={poNumber}
                onChange={e => setPoNumber(e.target.value)}
                className="h-7 text-xs"
                placeholder="PO-2024-001"
                data-testid="input-po-number"
              />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground mb-0.5">Container</p>
              <Input
                value={containerNumber}
                onChange={e => setContainerNumber(e.target.value)}
                className="h-7 text-xs"
                placeholder="CONT-001"
                data-testid="input-container-number"
              />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground mb-0.5">Import Date</p>
              <Input
                type="date"
                value={importDate}
                onChange={e => setImportDate(e.target.value)}
                className="h-7 text-xs"
                data-testid="input-import-date"
              />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground mb-0.5">
                Supplier {draft.unresolvedSupplier && <span className="text-orange-500">(not matched)</span>}
              </p>
              <Select
                value={supplierId ? String(supplierId) : ""}
                onValueChange={v => setSupplierId(Number(v))}
              >
                <SelectTrigger className="h-7 text-xs" data-testid="select-supplier">
                  <SelectValue placeholder={draft.supplierRaw || "Pick supplier"} />
                </SelectTrigger>
                <SelectContent>
                  {draft.allSuppliers.map(s => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name} {s.code ? `(${s.code})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Line items */}
          <div className="border-t mt-1">
            <div className="grid grid-cols-[1fr_48px_56px_60px] gap-x-1 px-3 py-1 bg-muted/40 text-[10px] text-muted-foreground font-medium">
              <span>Item</span>
              <span className="text-right">Qty</span>
              <span className="text-right">Rate</span>
              <span className="text-right">Total</span>
            </div>
            <div className="divide-y max-h-52 overflow-y-auto">
              {lines.map((line, i) => (
                <div key={i} className="px-3 py-1.5">
                  {line.stockItemId ? (
                    <div className="grid grid-cols-[1fr_48px_56px_60px] gap-x-1 items-center">
                      <span className="text-xs truncate" title={line.stockItemName || line.rawName}>
                        {line.stockItemName || line.rawName}
                      </span>
                      <span className="text-xs text-right">{parseFloat(line.qty).toLocaleString()}</span>
                      <span className="text-xs text-right">{fmt(line.rate)}</span>
                      <span className="text-xs text-right font-medium">{fmt(line.lineTotal)}</span>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className="text-xs text-orange-600 dark:text-orange-400 truncate">
                          {line.rawName} {line.rawCode ? `(${line.rawCode})` : ""}
                        </span>
                        <span className="text-xs text-right shrink-0">{fmt(line.lineTotal)}</span>
                      </div>
                      <Select
                        value=""
                        onValueChange={v => resolveItem(i, Number(v))}
                      >
                        <SelectTrigger className="h-6 text-[11px]" data-testid={`select-item-${i}`}>
                          <SelectValue placeholder="Map to stock item..." />
                        </SelectTrigger>
                        <SelectContent>
                          {draft.allStockItems.map(s => (
                            <SelectItem key={s.id} value={String(s.id)}>
                              {s.name} {s.code ? `(${s.code})` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Charges collapsible */}
          <div className="border-t">
            <button
              className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-muted/30"
              onClick={() => setShowCharges(s => !s)}
            >
              <span>Charges &amp; Deductions</span>
              <div className="flex items-center gap-1">
                <span className="text-foreground font-medium">{fmt(chargesTotal)}</span>
                {showCharges ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </div>
            </button>
            {showCharges && (
              <div className="px-3 pb-2 grid grid-cols-2 gap-x-3 gap-y-1">
                {(["freight", "surcharge", "fumigation", "documentCharges", "discount", "otherCharges"] as const).map(key => (
                  <div key={key}>
                    <p className="text-[10px] text-muted-foreground capitalize mb-0.5">
                      {key === "documentCharges" ? "Doc Charges" : key === "otherCharges" ? "Other" : key.charAt(0).toUpperCase() + key.slice(1)}
                    </p>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={charges[key]}
                      onChange={e => setCharges(prev => ({ ...prev, [key]: parseFloat(e.target.value) || 0 }))}
                      className="h-6 text-xs"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Totals + Import */}
          <div className="border-t px-3 py-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-0.5">
              <span>Items Total</span>
              <span>{fmt(itemsTotal)}</span>
            </div>
            {chargesTotal !== 0 && (
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-0.5">
                <span>Charges</span>
                <span>{fmt(chargesTotal)}</span>
              </div>
            )}
            <div className="flex items-center justify-between text-sm font-semibold mt-1 mb-2">
              <span>Grand Total</span>
              <span>{draft.currency} {fmt(grandTotal)}</span>
            </div>
            {unresolvedCount > 0 && (
              <p className="text-[11px] text-orange-600 dark:text-orange-400 mb-2">
                {unresolvedCount} item(s) still need to be mapped before importing.
              </p>
            )}
            {!supplierId && (
              <p className="text-[11px] text-orange-600 dark:text-orange-400 mb-2">
                Please select a supplier before importing.
              </p>
            )}
            {importError && (
              <p className="text-[11px] text-red-600 dark:text-red-400 mb-2 bg-red-50 dark:bg-red-950/30 rounded px-2 py-1.5">
                {importError}
              </p>
            )}
            <Button
              size="sm"
              className="w-full h-7 text-xs bg-orange-600 hover:bg-orange-600 text-white"
              onClick={handleImport}
              disabled={!canImport || isSubmitting}
              data-testid="button-confirm-po-import"
            >
              {isSubmitting ? (
                <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Importing...</>
              ) : (
                <><Upload className="h-3 w-3 mr-1" /> Import PO</>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Account Query Result Card ────────────────────────────────────────
function AccountQueryResultCard({
  result,
  onDismiss,
}: {
  result: AccountQueryResult;
  onDismiss: () => void;
}) {
  const [, setLocation] = useLocation();
  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtAmt = (s: string | undefined) => s ? parseFloat(s).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00";

  const headerColor = "border-teal-500/30 bg-teal-500/5";
  const headerBg = "bg-teal-500/10";
  const textColor = "text-teal-700 dark:text-teal-400";

  const goToAccount = () => setLocation(`/accounts?accountId=${result.accountId}`);

  return (
    <div className={`mt-2 rounded-md border ${headerColor} overflow-hidden`} data-testid="account-query-result-card">
      <div className={`px-3 py-2 ${headerBg} flex items-center justify-between gap-2`}>
        <div className="flex items-center gap-2">
          <FileText className={`h-4 w-4 ${textColor} shrink-0`} />
          <span className={`text-sm font-semibold ${textColor}`}>
            {result.queryType === "balance" && `Balance: ${result.accountName}`}
            {result.queryType === "transactions" && `Transactions: ${result.accountName}`}
            {result.queryType === "balance_history" && `Balance History: ${result.accountName}`}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={goToAccount} data-testid="button-open-account">
            Open
          </Button>
          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onDismiss}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {result.queryType === "balance" && (
        <div className="px-3 py-3">
          <p className="text-xs text-muted-foreground mb-1">Current Balance</p>
          <p className={`text-2xl font-bold ${(result.balance ?? 0) >= 0 ? "text-foreground" : "text-red-500 dark:text-red-400"}`}>
            {(result.balance ?? 0) < 0 ? "-" : ""}{fmt(Math.abs(result.balance ?? 0))}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {(result.balance ?? 0) >= 0 ? "Debit balance (Dr)" : "Credit balance (Cr)"}
          </p>
        </div>
      )}

      {result.queryType === "transactions" && (
        <div>
          {(!result.transactions || result.transactions.length === 0) ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">No matching transactions found.</p>
          ) : (
            <div className="divide-y">
              {result.transactions.map((tx, i) => {
                const dr = parseFloat(tx.debitAmount || "0");
                const cr = parseFloat(tx.creditAmount || "0");
                const isDebit = dr > 0;
                const amt = isDebit ? dr : cr;
                return (
                  <div key={`${tx.voucherId}-${i}`} className="px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-semibold">{tx.voucherNumber}</span>
                          <span className="text-[10px] text-muted-foreground bg-muted rounded px-1 py-0.5">{tx.voucherType}</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{tx.description || tx.narration || "—"}</p>
                        <span className="text-[10px] text-muted-foreground">{tx.voucherDate}</span>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`text-xs font-semibold ${isDebit ? "text-red-500 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
                          {isDebit ? "Dr" : "Cr"} {fmtAmt(String(amt))}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {result.queryType === "balance_history" && (
        <div>
          {(!result.matches || result.matches.length === 0) ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">
              No point found where the balance was close to {fmt(result.targetBalance ?? 0)}.
            </p>
          ) : (
            <>
              <p className="px-3 pt-2 text-xs text-muted-foreground">
                Transactions where balance was ~{fmt(result.targetBalance ?? 0)}:
              </p>
              <div className="divide-y">
                {result.matches.map((m, i) => (
                  <div key={`${m.voucherId}-${i}`} className="px-3 py-2 flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-semibold">{m.voucherNumber}</span>
                        <span className="text-[10px] text-muted-foreground bg-muted rounded px-1 py-0.5">{m.voucherType}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{m.description || "—"}</p>
                      <span className="text-[10px] text-muted-foreground">{m.voucherDate}</span>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[10px] text-muted-foreground">Balance after</p>
                      <p className="text-xs font-semibold">{fmt(m.balanceAfter)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Voucher Confirmation Card ────────────────────────────────────────
function VoucherConfirmCard({
  draft,
  onConfirm,
  onDismiss,
  isSubmitting,
}: {
  draft: VoucherDraft;
  onConfirm: (edited: VoucherDraft) => void;
  onDismiss: () => void;
  isSubmitting: boolean;
}) {
  const [editDate, setEditDate] = useState(draft.date);
  const [editDesc, setEditDesc] = useState(draft.description);
  const [editEntries, setEditEntries] = useState(
    () => draft.entries.map(e => ({ ...e, debitStr: e.debit > 0 ? String(e.debit) : "", creditStr: e.credit > 0 ? String(e.credit) : "" }))
  );

  const parsedEntries = editEntries.map(e => ({
    ...e,
    debit: parseFloat(e.debitStr) || 0,
    credit: parseFloat(e.creditStr) || 0,
  }));
  const totalDebit = parsedEntries.reduce((s, e) => s + e.debit, 0);
  const totalCredit = parsedEntries.reduce((s, e) => s + e.credit, 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01;

  const handleConfirmClick = () => {
    const edited: VoucherDraft = {
      ...draft,
      date: editDate,
      description: editDesc,
      entries: parsedEntries.map(e => ({
        accountId: e.accountId,
        accountName: e.accountName,
        debit: e.debit,
        credit: e.credit,
        balanceBefore: e.balanceBefore,
      })),
    };
    onConfirm(edited);
  };

  const setEntryField = (i: number, field: "debitStr" | "creditStr", val: string) => {
    setEditEntries(prev => prev.map((e, idx) => idx === i ? { ...e, [field]: val } : e));
  };

  const hasBalanceBefore = draft.entries.some(e => e.balanceBefore !== undefined);

  return (
    <div className="mt-2 rounded-md border border-primary/30 bg-primary/5 overflow-hidden" data-testid="voucher-confirm-card">
      <div className="px-3 py-2 bg-primary/10 flex items-center gap-2">
        <FileText className="h-4 w-4 text-primary shrink-0" />
        <span className="text-sm font-semibold text-primary">
          Create {draft.type} Voucher?
        </span>
      </div>
      <div className="px-3 py-2 space-y-1.5 text-xs">
        <div className="flex justify-between gap-2 text-muted-foreground items-center">
          <span className="shrink-0">Date</span>
          <input
            type="date"
            value={editDate}
            onChange={e => setEditDate(e.target.value)}
            className="text-xs font-medium text-foreground bg-background border rounded px-1.5 py-0.5"
            data-testid="input-voucher-date"
          />
        </div>
        <div className="flex justify-between gap-2 text-muted-foreground items-center">
          <span className="shrink-0">Description</span>
          <input
            type="text"
            value={editDesc}
            onChange={e => setEditDesc(e.target.value)}
            className="text-xs font-medium text-foreground bg-background border rounded px-1.5 py-0.5 max-w-[170px] w-full"
            data-testid="input-voucher-description"
          />
        </div>
        <div className="border-t pt-1.5 mt-1.5 space-y-1.5">
          <div className={`grid gap-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide ${hasBalanceBefore ? "grid-cols-[1fr_52px_52px_60px]" : "grid-cols-3"}`}>
            <span>Account</span>
            <span className="text-right">Debit</span>
            <span className="text-right">Credit</span>
            {hasBalanceBefore && <span className="text-right">Balance</span>}
          </div>
          {editEntries.map((e, i) => {
            const debit = parseFloat(e.debitStr) || 0;
            const credit = parseFloat(e.creditStr) || 0;
            const balAfter = e.balanceBefore !== undefined ? e.balanceBefore + debit - credit : undefined;
            return (
              <div key={i} className={`grid gap-1 items-center ${hasBalanceBefore ? "grid-cols-[1fr_52px_52px_60px]" : "grid-cols-3"}`}>
                <span className="truncate text-foreground">{e.accountName}</span>
                <input
                  type="number"
                  min="0"
                  value={e.debitStr}
                  onChange={ev => setEntryField(i, "debitStr", ev.target.value)}
                  className="text-right text-foreground bg-background border rounded px-1 py-0.5 text-[11px] w-full"
                  placeholder="0"
                  data-testid={`input-voucher-debit-${i}`}
                />
                <input
                  type="number"
                  min="0"
                  value={e.creditStr}
                  onChange={ev => setEntryField(i, "creditStr", ev.target.value)}
                  className="text-right text-foreground bg-background border rounded px-1 py-0.5 text-[11px] w-full"
                  placeholder="0"
                  data-testid={`input-voucher-credit-${i}`}
                />
                {hasBalanceBefore && (
                  <span className={`text-right text-[10px] ${balAfter !== undefined && balAfter < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                    {e.balanceBefore !== undefined ? (
                      <>{e.balanceBefore.toLocaleString(undefined, { maximumFractionDigits: 0 })} → <span className={balAfter !== undefined && balAfter < 0 ? "text-destructive font-semibold" : "text-foreground"}>{balAfter !== undefined ? balAfter.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "?"}</span></>
                    ) : "—"}
                  </span>
                )}
              </div>
            );
          })}
          <div className={`grid gap-1 border-t pt-1 font-semibold text-xs ${hasBalanceBefore ? "grid-cols-[1fr_52px_52px_60px]" : "grid-cols-3"}`}>
            <span>Total</span>
            <span className="text-right">{totalDebit > 0 ? totalDebit.toLocaleString(undefined, { maximumFractionDigits: 2 }) : ""}</span>
            <span className="text-right">{totalCredit > 0 ? totalCredit.toLocaleString(undefined, { maximumFractionDigits: 2 }) : ""}</span>
            {hasBalanceBefore && <span />}
          </div>
          {!balanced && (
            <p className="text-destructive text-[10px]">Warning: debits and credits don't balance (diff: {Math.abs(totalDebit - totalCredit).toFixed(2)}).</p>
          )}
        </div>
      </div>
      <div className="px-3 py-2 border-t flex gap-2 justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={onDismiss}
          disabled={isSubmitting}
          data-testid="button-dismiss-voucher"
        >
          <XCircle className="h-3.5 w-3.5 mr-1" />
          Dismiss
        </Button>
        <Button
          size="sm"
          onClick={handleConfirmClick}
          disabled={isSubmitting || !balanced}
          data-testid="button-confirm-voucher"
        >
          {isSubmitting ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Check className="h-3.5 w-3.5 mr-1" />}
          Confirm & Create
        </Button>
      </div>
    </div>
  );
}

// ── Stock Transfer Confirm Card ─────────────────────────────────────────
function StockTransferConfirmCard({
  draft,
  onConfirm,
  onDismiss,
  isSubmitting,
}: {
  draft: StockTransferDraft;
  onConfirm: (resolved: StockTransferDraft) => void;
  onDismiss: () => void;
  isSubmitting: boolean;
}) {
  const [editDate, setEditDate] = useState(draft.date);
  const [editNotes, setEditNotes] = useState(draft.notes || "");
  const [editItems, setEditItems] = useState(() => draft.items.map(i => ({ ...i, selectedId: i.stockItemId, selectedName: i.stockItemName, qtyStr: String(i.quantity) })));

  const hasInsufficientStock = editItems.some(i => {
    const qty = parseFloat(i.qtyStr) || 0;
    return i.currentStock !== undefined && qty > i.currentStock;
  });

  const handleConfirmClick = () => {
    const resolved: StockTransferDraft = {
      ...draft,
      date: editDate,
      notes: editNotes,
      items: editItems.map(i => ({
        ...i,
        stockItemId: i.selectedId,
        stockItemName: i.selectedName,
        quantity: parseFloat(i.qtyStr) || i.quantity,
      })),
    };
    onConfirm(resolved);
  };

  return (
    <div className="mt-2 rounded-md border border-blue-500/30 bg-blue-500/5 overflow-hidden" data-testid="stock-transfer-confirm-card">
      <div className="px-3 py-2 bg-blue-500/10 flex items-center gap-2">
        <ArrowLeftRight className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
        <span className="text-sm font-semibold text-blue-700 dark:text-blue-400">Stock Transfer?</span>
      </div>
      <div className="px-3 py-2 space-y-1.5 text-xs">
        <div className="flex justify-between gap-2 text-muted-foreground items-center">
          <span className="shrink-0">Date</span>
          <input
            type="date"
            value={editDate}
            onChange={e => setEditDate(e.target.value)}
            className="text-xs font-medium text-foreground bg-background border rounded px-1.5 py-0.5"
            data-testid="input-transfer-date"
          />
        </div>
        <div className="flex justify-between gap-2 text-muted-foreground items-center">
          <span className="shrink-0">From</span>
          <span className="font-medium text-foreground truncate max-w-[170px]">{draft.sourceLocationName}</span>
        </div>
        <div className="flex justify-between gap-2 text-muted-foreground items-center">
          <span className="shrink-0">To</span>
          <span className="font-medium text-foreground truncate max-w-[170px]">{draft.destinationLocationName}</span>
        </div>
        <div className="flex justify-between gap-2 text-muted-foreground items-center">
          <span className="shrink-0">Notes</span>
          <input
            type="text"
            value={editNotes}
            onChange={e => setEditNotes(e.target.value)}
            placeholder="Optional notes"
            className="text-xs font-medium text-foreground bg-background border rounded px-1.5 py-0.5 max-w-[170px] w-full"
            data-testid="input-transfer-notes"
          />
        </div>
        <div className="border-t pt-1.5 mt-1.5 space-y-1.5">
          <div className="grid grid-cols-[1fr_50px_60px] gap-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
            <span>Item</span><span className="text-right">Qty</span><span className="text-right">In Stock</span>
          </div>
          {editItems.map((item, i) => {
            const qty = parseFloat(item.qtyStr) || 0;
            const insufficient = item.currentStock !== undefined && qty > item.currentStock;
            const candidates = item.candidates ?? [];
            const hasChoice = candidates.length > 1;
            return (
              <div key={i} className="grid grid-cols-[1fr_50px_60px] gap-1 items-center">
                {hasChoice ? (
                  <select
                    className="text-xs font-medium text-foreground bg-background border rounded px-1.5 py-0.5 w-full"
                    value={item.selectedId}
                    onChange={e => {
                      const id = Number(e.target.value);
                      const c = candidates.find(c => c.id === id);
                      if (c) setEditItems(prev => prev.map((it, idx) => idx === i ? { ...it, selectedId: c.id, selectedName: c.name } : it));
                    }}
                  >
                    {candidates.map(c => <option key={c.id} value={c.id}>{c.name}{c.code ? ` (${c.code})` : ""}</option>)}
                  </select>
                ) : (
                  <span className="truncate text-foreground">{item.selectedName}</span>
                )}
                <input
                  type="number"
                  min="0"
                  value={item.qtyStr}
                  onChange={e => setEditItems(prev => prev.map((it, idx) => idx === i ? { ...it, qtyStr: e.target.value } : it))}
                  className={`text-right text-foreground bg-background border rounded px-1 py-0.5 text-[11px] w-full ${insufficient ? "border-destructive" : ""}`}
                  data-testid={`input-transfer-qty-${i}`}
                />
                <span className={`text-right text-[10px] ${insufficient ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
                  {item.currentStock !== undefined ? item.currentStock.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}
                </span>
              </div>
            );
          })}
        </div>
        {hasInsufficientStock && (
          <p className="text-[10px] text-destructive border-t pt-1">Warning: transfer quantity exceeds available stock for one or more items.</p>
        )}
      </div>
      <div className="px-3 py-2 border-t flex gap-2 justify-end">
        <Button variant="outline" size="sm" onClick={onDismiss} disabled={isSubmitting} data-testid="button-dismiss-stock-transfer">
          <XCircle className="h-3.5 w-3.5 mr-1" /> Dismiss
        </Button>
        <Button size="sm" onClick={handleConfirmClick} disabled={isSubmitting} data-testid="button-confirm-stock-transfer">
          {isSubmitting ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <ArrowLeftRight className="h-3.5 w-3.5 mr-1" />}
          Confirm Transfer
        </Button>
      </div>
    </div>
  );
}

// ── Verify Container Card ─────────────────────────────────────────────
function VerifyContainerCard({
  draft,
  onDismiss,
}: {
  draft: VerifyContainerDraft;
  onDismiss: () => void;
}) {
  const downloadUrl = (proformaId: number) =>
    `/api/suppliers/${draft.supplierId}/containers/${draft.containerId}/verification-export.xlsx?proformaId=${proformaId}`;

  return (
    <div className="mt-2 rounded-md border border-blue-500/30 bg-blue-500/5 overflow-hidden" data-testid="verify-container-card">
      <div className="px-3 py-2 bg-blue-500/10 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileCheck className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
          <span className="text-sm font-semibold text-blue-700 dark:text-blue-400">
            Container Verification: {draft.containerNumber}
          </span>
        </div>
        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onDismiss} data-testid="button-dismiss-verify-container">
          <X className="h-3 w-3" />
        </Button>
      </div>
      <div className="px-3 py-3">
        {draft.supplierName && (
          <p className="text-xs text-muted-foreground mb-2">Supplier: {draft.supplierName}</p>
        )}
        {draft.proformas.length === 0 ? (
          <p className="text-sm text-muted-foreground">No proformas found for this supplier. Please create a proforma first.</p>
        ) : draft.proformas.length === 1 ? (
          <div>
            <p className="text-xs text-muted-foreground mb-2">Proforma: <span className="font-medium text-foreground">{draft.proformas[0].reference}</span></p>
            <a href={downloadUrl(draft.proformas[0].id)} target="_blank" rel="noreferrer">
              <Button size="sm" className="w-full h-7 text-xs" data-testid="button-download-verify-excel">
                <Download className="h-3 w-3 mr-1.5" />
                Download Verification Excel
              </Button>
            </a>
          </div>
        ) : (
          <div>
            <p className="text-xs text-muted-foreground mb-2">Select a proforma to compare against:</p>
            <div className="space-y-1">
              {draft.proformas.map(p => (
                <a key={p.id} href={downloadUrl(p.id)} target="_blank" rel="noreferrer" className="block">
                  <Button variant="outline" size="sm" className="w-full h-7 text-xs justify-start" data-testid={`button-verify-proforma-${p.id}`}>
                    <Download className="h-3 w-3 mr-1.5 shrink-0" />
                    {p.reference}
                  </Button>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Phase 1: Data Query Result Card ──────────────────────────────────
function DataQueryResultCard({ result, onDismiss }: { result: DataQueryResult; onDismiss: () => void }) {
  const highlightClass = (h?: string) => {
    if (h === "positive") return "text-green-600 dark:text-green-400";
    if (h === "negative") return "text-red-600 dark:text-red-400";
    if (h === "muted") return "text-muted-foreground";
    return "";
  };

  return (
    <div className="mt-2 rounded-md border border-border bg-muted/20 overflow-hidden" data-testid="data-query-result-card">
      <div className="px-3 py-2 bg-muted/30 flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight">{result.title}</p>
          {result.subtitle && <p className="text-xs text-muted-foreground mt-0.5">{result.subtitle}</p>}
        </div>
        <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={onDismiss} data-testid="button-dismiss-data-query">
          <X className="h-3 w-3" />
        </Button>
      </div>
      <div className="px-3 py-3 space-y-3">
        {result.summary && (
          <p className="text-sm text-muted-foreground">{result.summary}</p>
        )}
        {result.noData && !result.summary && (
          <p className="text-sm text-muted-foreground">No data found for this period.</p>
        )}
        {result.stats && result.stats.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {result.stats.map((stat, i) => (
              <div
                key={i}
                className={`rounded-md p-2 bg-background/60 border border-border/50 ${i === result.stats!.length - 1 && result.stats!.length % 2 !== 0 ? "col-span-2" : ""}`}
              >
                <p className="text-xs text-muted-foreground leading-tight">{stat.label}</p>
                <p className={`text-sm font-semibold mt-0.5 ${highlightClass(stat.highlight)}`}>{stat.value}</p>
                {stat.subtext && <p className="text-xs text-muted-foreground mt-0.5">{stat.subtext}</p>}
              </div>
            ))}
          </div>
        )}
        {result.table && result.table.rows.length > 0 && (
          <div className="overflow-auto max-h-52 rounded-md border border-border/50">
            <table className="w-full text-xs min-w-max">
              <thead>
                <tr className="bg-muted/40 border-b border-border">
                  {result.table.headers.map((h, i) => (
                    <th key={i} className="text-left py-1.5 px-2 font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.table.rows.map((row, i) => (
                  <tr key={i} className="border-b border-border/40 last:border-0 hover-elevate">
                    {row.map((cell, j) => (
                      <td key={j} className="py-1.5 px-2 whitespace-nowrap">{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {result.table && result.table.rows.length === 0 && !result.noData && !result.summary && (
          <p className="text-sm text-muted-foreground">No records found.</p>
        )}
      </div>
    </div>
  );
}

// ── Provider display helpers ─────────────────────────────────────────
const PROVIDER_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  grok: "Grok",
};

// ── Inline Code Block with copy + live preview ───────────────────────
function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const normalizedLang = lang.toLowerCase().trim();
  const isPreviewable = ["html", "htm", "javascript", "js"].includes(normalizedLang);

  const handleCopy = () => {
    navigator.clipboard.writeText(code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getPreviewSrcdoc = () => {
    if (normalizedLang === "javascript" || normalizedLang === "js") {
      return `<!DOCTYPE html><html><body><script>\n${code}\n<\/script></body></html>`;
    }
    return code;
  };

  return (
    <div className="my-2 rounded-md border border-border overflow-hidden text-left">
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/60 border-b border-border gap-2">
        <span className="text-xs font-mono text-muted-foreground">{normalizedLang || "code"}</span>
        <div className="flex items-center gap-1">
          {isPreviewable && (
            <button
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-0.5 rounded hover:bg-muted"
              onClick={() => setShowPreview(v => !v)}
              type="button"
            >
              {showPreview ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              {showPreview ? "Hide" : "Preview"}
            </button>
          )}
          <button
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-0.5 rounded hover:bg-muted"
            onClick={handleCopy}
            type="button"
          >
            {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>
      <pre className="overflow-x-auto p-3 text-xs font-mono bg-zinc-950 dark:bg-zinc-900 text-zinc-100 leading-relaxed m-0">
        <code>{code}</code>
      </pre>
      {showPreview && isPreviewable && (
        <div className="border-t border-border">
          <div className="px-3 py-1.5 bg-muted/40 text-xs text-muted-foreground flex items-center gap-1.5">
            <Eye className="h-3 w-3" />
            Live Preview
          </div>
          <iframe
            srcDoc={getPreviewSrcdoc()}
            className="w-full bg-white"
            style={{ height: "280px", border: "none" }}
            sandbox="allow-scripts allow-same-origin"
            title="Code preview"
          />
        </div>
      )}
    </div>
  );
}

// ── File diff helpers ─────────────────────────────────────────────────────
type DiffLine = { type: "same" | "add" | "remove"; line: string };

function computeLineDiff(original: string, modified: string): DiffLine[] {
  const oldLines = original.split("\n");
  const newLines = modified.split("\n");
  const MAX = 400;
  if (oldLines.length > MAX || newLines.length > MAX) {
    return newLines.map(line => ({ type: "add" as const, line }));
  }
  const m = oldLines.length, n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const result: DiffLine[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({ type: "same", line: oldLines[i - 1] }); i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: "add", line: newLines[j - 1] }); j--;
    } else {
      result.unshift({ type: "remove", line: oldLines[i - 1] }); i--;
    }
  }
  return result;
}

interface PushResult {
  success: boolean;
  commitHash?: string;
  branch?: string;
  error?: string;
}

interface FileDiffCardProps {
  draft: FilePatchDraft;
  onApply: () => void;
  onCancel: () => void;
  isApplying: boolean;
  appliedFile: string | null;
  onGitPush: (commitMsg: string) => void;
  isPushing: boolean;
  pushResult: PushResult | null;
}

function FileDiffCard({ draft, onApply, onCancel, isApplying, appliedFile, onGitPush, isPushing, pushResult }: FileDiffCardProps) {
  const [commitMsg, setCommitMsg] = useState(draft.description);
  const [showFullDiff, setShowFullDiff] = useState(false);
  const isApplied = appliedFile === draft.filePath;

  const diffLines = computeLineDiff(draft.originalContent, draft.newContent);
  const CONTEXT = 3;
  const visibleSet = new Set<number>();
  diffLines.forEach((dl, idx) => {
    if (dl.type !== "same") {
      for (let k = Math.max(0, idx - CONTEXT); k <= Math.min(diffLines.length - 1, idx + CONTEXT); k++) {
        visibleSet.add(k);
      }
    }
  });

  const added = diffLines.filter(l => l.type === "add").length;
  const removed = diffLines.filter(l => l.type === "remove").length;
  const hasChanges = added > 0 || removed > 0;

  type Segment = { isSkip: true; count: number } | { isSkip: false; item: DiffLine & { idx: number } };
  const segments: Segment[] = [];
  let prevIdx = -1;
  diffLines.forEach((dl, idx) => {
    if (!visibleSet.has(idx)) return;
    if (prevIdx !== -1 && idx > prevIdx + 1) {
      segments.push({ isSkip: true, count: idx - prevIdx - 1 });
    }
    segments.push({ isSkip: false, item: { ...dl, idx } });
    prevIdx = idx;
  });
  if (diffLines.length > 0 && prevIdx < diffLines.length - 1 && visibleSet.size > 0) {
    const trailingSkip = diffLines.length - 1 - prevIdx;
    if (trailingSkip > 0) segments.push({ isSkip: true, count: trailingSkip });
  }

  return (
    <div className="rounded-md border border-border bg-background mt-3 overflow-hidden text-left">
      <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b border-border gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <FileCode className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-xs font-mono text-foreground truncate max-w-[220px]">{draft.filePath}</span>
        </div>
        <div className="flex items-center gap-2 text-xs shrink-0">
          {added > 0 && <span className="text-green-600 dark:text-green-400 flex items-center gap-0.5"><Plus className="h-3 w-3" />{added}</span>}
          {removed > 0 && <span className="text-red-500 dark:text-red-400 flex items-center gap-0.5"><Minus className="h-3 w-3" />{removed}</span>}
        </div>
      </div>

      <div className="px-3 py-2 bg-muted/20 border-b border-border">
        <p className="text-xs text-muted-foreground leading-relaxed">{draft.description}</p>
      </div>

      {hasChanges ? (
        <div className="overflow-hidden">
          <pre className={cn(
            "overflow-x-auto text-xs font-mono leading-5 overflow-y-auto transition-all",
            showFullDiff ? "max-h-[480px]" : "max-h-64",
          )}>
            {segments.length === 0 ? (
              diffLines.map((dl, idx) => (
                <div
                  key={idx}
                  className={cn(
                    "px-3 py-px whitespace-pre",
                    dl.type === "add" && "bg-green-950/40 dark:bg-green-900/30 text-green-300",
                    dl.type === "remove" && "bg-red-950/40 dark:bg-red-900/30 text-red-300",
                    dl.type === "same" && "text-muted-foreground",
                  )}
                >
                  <span className="select-none opacity-50 mr-2 w-3 inline-block">
                    {dl.type === "add" ? "+" : dl.type === "remove" ? "-" : " "}
                  </span>
                  {dl.line}
                </div>
              ))
            ) : (
              segments.map((seg, si) =>
                seg.isSkip ? (
                  <div key={`skip-${si}`} className="px-3 py-0.5 text-muted-foreground/50 bg-muted/20 text-xs select-none">
                    ... {seg.count} unchanged {seg.count === 1 ? "line" : "lines"} ...
                  </div>
                ) : (
                  <div
                    key={seg.item.idx}
                    className={cn(
                      "px-3 py-px whitespace-pre",
                      seg.item.type === "add" && "bg-green-950/40 dark:bg-green-900/30 text-green-300",
                      seg.item.type === "remove" && "bg-red-950/40 dark:bg-red-900/30 text-red-300",
                      seg.item.type === "same" && "text-muted-foreground",
                    )}
                  >
                    <span className="select-none opacity-50 mr-2 w-3 inline-block">
                      {seg.item.type === "add" ? "+" : seg.item.type === "remove" ? "-" : " "}
                    </span>
                    {seg.item.line}
                  </div>
                ),
              )
            )}
          </pre>
          {diffLines.length > 20 && (
            <button
              type="button"
              className="w-full text-xs text-muted-foreground py-1 bg-muted/20 border-t border-border hover:bg-muted/40 transition-colors"
              onClick={() => setShowFullDiff(v => !v)}
            >
              {showFullDiff ? "Collapse diff" : `Show full diff (${diffLines.length} lines)`}
            </button>
          )}
        </div>
      ) : (
        <div className="px-3 py-3 text-xs text-muted-foreground">No changes detected.</div>
      )}

      {pushResult ? (
        <div className="border-t border-border bg-muted/20 px-3 py-3 space-y-1.5">
          {pushResult.success ? (
            <div className="flex items-start gap-2 text-sm text-green-600 dark:text-green-400">
              <Check className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <span className="font-medium">Pushed to GitHub</span>
                {(pushResult.commitHash || pushResult.branch) && (
                  <span className="text-xs text-muted-foreground ml-2 font-mono">
                    {pushResult.branch}{pushResult.commitHash ? ` @ ${pushResult.commitHash}` : ""}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 text-sm text-destructive">
              <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <span className="font-medium">Push failed: </span>
                <span className="text-xs">{pushResult.error}</span>
              </div>
            </div>
          )}
          <Button size="sm" variant="ghost" onClick={onCancel} className="mt-1">
            Dismiss
          </Button>
        </div>
      ) : isApplied ? (
        <div className="border-t border-border bg-muted/20 px-3 py-2 space-y-2">
          <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400">
            <Check className="h-3.5 w-3.5" />
            <span>Applied to <span className="font-mono">{draft.filePath}</span></span>
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <input
              className="flex-1 min-w-0 h-8 rounded-md border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              value={commitMsg}
              onChange={e => setCommitMsg(e.target.value)}
              placeholder="Commit message…"
            />
            <Button size="sm" onClick={() => onGitPush(commitMsg)} disabled={isPushing || !commitMsg.trim()}>
              {isPushing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <GitCommit className="h-3 w-3 mr-1" />}
              Push to GitHub
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancel} disabled={isPushing}>
              Dismiss
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 py-2 border-t border-border bg-muted/20 flex-wrap">
          <Button size="sm" onClick={onApply} disabled={isApplying || !hasChanges}>
            {isApplying ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Check className="h-3 w-3 mr-1" />}
            Apply Change
          </Button>
          <Button size="sm" variant="outline" onClick={onCancel} disabled={isApplying}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Main ChatWidget ──────────────────────────────────────────────────
export function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [message, setMessage] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [feedbackGiven, setFeedbackGiven] = useState<Record<number, "positive" | "negative">>({});
  const [sessionId, setSessionId] = useState(
    () => `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  );
  const [showAlerts, setShowAlerts] = useState(true);
  const [pendingVoucher, setPendingVoucher] = useState<VoucherDraft | null>(null);
  const [voucherSubmitting, setVoucherSubmitting] = useState(false);
  const [pendingStockAdj, setPendingStockAdj] = useState<StockAdjustmentDraft | null>(null);
  const [stockAdjSubmitting, setStockAdjSubmitting] = useState(false);
  const [voucherSearchResults, setVoucherSearchResults] = useState<VoucherSearchResult[] | null>(null);
  const [pendingStockItem, setPendingStockItem] = useState<StockItemDraft | null>(null);
  const [stockItemSubmitting, setStockItemSubmitting] = useState(false);
  const [pendingPriceUpdate, setPendingPriceUpdate] = useState<PriceUpdateDraft | null>(null);
  const [priceUpdateSubmitting, setPriceUpdateSubmitting] = useState(false);
  const [accountQueryResult, setAccountQueryResult] = useState<AccountQueryResult | null>(null);
  const [poDraft, setPoDraft] = useState<POImportDraft | null>(null);
  const [poDraftUploading, setPoDraftUploading] = useState(false);
  const [poDraftSubmitting, setPoDraftSubmitting] = useState(false);
  const [poDraftResult, setPoDraftResult] = useState<POImportResult | null>(null);
  const [poDraftError, setPoDraftError] = useState<string | null>(null);
  const [verifyContainerDraft, setVerifyContainerDraft] = useState<VerifyContainerDraft | null>(null);
  const [dataQueryResult, setDataQueryResult] = useState<DataQueryResult | null>(null);
  const [pendingStockTransfer, setPendingStockTransfer] = useState<StockTransferDraft | null>(null);
  const [stockTransferSubmitting, setStockTransferSubmitting] = useState(false);
  const [lastUsedProvider, setLastUsedProvider] = useState<string | null>(null);
  const [pendingFilePatch, setPendingFilePatch] = useState<FilePatchDraft | null>(null);
  const [patchApplying, setPatchApplying] = useState(false);
  const [appliedPatchFile, setAppliedPatchFile] = useState<string | null>(null);
  const [gitPushing, setGitPushing] = useState(false);
  const [gitPushResult, setGitPushResult] = useState<PushResult | null>(null);
  const [location] = useLocation();

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data: status } = useQuery<ChatStatus>({
    queryKey: ["/api/chatbot/status"],
  });

  const { data: history = [], refetch: refetchHistory } = useQuery<ChatMessage[]>({
    queryKey: [`/api/chatbot/history/${sessionId}`],
    enabled: isOpen && status?.enabled && status?.hasApiKey,
  });

  const sendMutation = useMutation({
    mutationFn: async (msg: string) => {
      const response = await apiRequest("POST", "/api/chatbot/message", {
        message: msg,
        sessionId,
        pageContext: { currentRoute: location },
      }, false, 120000);
      return response.json() as Promise<ChatResponse>;
    },
    onSuccess: (data) => {
      refetchHistory();
      setMessage("");
      if (data.provider) setLastUsedProvider(data.provider);
      if (data.suggestions && data.suggestions.length > 0) {
        setSuggestions(data.suggestions);
      }
      if (data.voucherDraft) {
        setPendingVoucher(data.voucherDraft);
        setPendingStockAdj(null);
        setPendingStockTransfer(null);
      } else if (data.stockAdjustmentDraft) {
        setPendingStockAdj(data.stockAdjustmentDraft);
        setPendingVoucher(null);
        setPendingStockTransfer(null);
      } else if (data.stockTransferDraft) {
        setPendingStockTransfer(data.stockTransferDraft);
        setPendingVoucher(null);
        setPendingStockAdj(null);
      } else {
        setPendingStockTransfer(null);
      }
      if (data.voucherSearchResults && data.voucherSearchResults.length > 0) {
        setVoucherSearchResults(data.voucherSearchResults);
      } else {
        setVoucherSearchResults(null);
      }
      if (data.stockItemDraft) {
        setPendingStockItem(data.stockItemDraft);
      } else {
        setPendingStockItem(null);
      }
      if (data.priceUpdateDraft) {
        setPendingPriceUpdate(data.priceUpdateDraft);
      } else {
        setPendingPriceUpdate(null);
      }
      if (data.accountQueryResult) {
        setAccountQueryResult(data.accountQueryResult);
      } else {
        setAccountQueryResult(null);
      }
      if (data.verifyContainerDraft) {
        setVerifyContainerDraft(data.verifyContainerDraft);
      } else {
        setVerifyContainerDraft(null);
      }
      if (data.dataQueryResult) {
        setDataQueryResult(data.dataQueryResult);
      } else {
        setDataQueryResult(null);
      }
      if (data.filePatchDraft) {
        setPendingFilePatch(data.filePatchDraft);
        setAppliedPatchFile(null);
      } else {
        setPendingFilePatch(null);
      }
    },
  });

  const handleConfirmVoucher = async (edited: VoucherDraft) => {
    setVoucherSubmitting(true);
    try {
      const voucherNumber = `AI-${Date.now()}`;
      const body = {
        voucher: {
          voucherNumber,
          voucherType: edited.type,
          voucherDate: edited.date,
          description: edited.description,
          optional: edited.optional ?? false,
        },
        entries: edited.entries.map(e => ({
          ledgerAccountId: e.accountId,
          debitAmount: String(e.debit || 0),
          creditAmount: String(e.credit || 0),
          narration: edited.description,
        })),
      };
      const res = await apiRequest("POST", "/api/vouchers/with-entries", body);
      const resData = await res.json();
      setPendingVoucher(null);
      // Audit log (fire-and-forget)
      apiRequest("POST", "/api/chatbot/log-action", {
        sessionId, prompt: edited.description, draftJson: edited, actionType: "voucher", createdRecordId: resData?.id || null, status: "confirmed",
      }).catch(() => {});
      sendMutation.mutate(`Voucher created: ${edited.type} of $${Math.max(...edited.entries.map(e => e.debit || e.credit))} on ${edited.date}`);
    } catch (err: any) {
      sendMutation.mutate(`Voucher creation failed: ${err.message}`);
    } finally {
      setVoucherSubmitting(false);
    }
  };

  const handleConfirmStockTransfer = async (resolved: StockTransferDraft) => {
    setStockTransferSubmitting(true);
    try {
      const resp = await fetch("/api/chatbot/confirm-stock-transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: resolved.date,
          sourceLocationId: resolved.sourceLocationId,
          destinationLocationId: resolved.destinationLocationId,
          notes: resolved.notes || "",
          items: resolved.items.map(i => ({ stockItemId: i.stockItemId, quantity: i.quantity })),
          sessionId,
          prompt: `Transfer stock from ${resolved.sourceLocationName} to ${resolved.destinationLocationName}`,
        }),
        credentials: "include",
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.message || "Transfer failed");
      setPendingStockTransfer(null);
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      sendMutation.mutate(`Stock transfer created from "${resolved.sourceLocationName}" to "${resolved.destinationLocationName}" on ${resolved.date}. ${resolved.items.length} item(s) transferred.`);
    } catch (err: any) {
      sendMutation.mutate(`Stock transfer failed: ${err.message}`);
    } finally {
      setStockTransferSubmitting(false);
    }
  };

  const handleConfirmStockAdj = async (resolved: StockAdjustmentDraft) => {
    setStockAdjSubmitting(true);
    try {
      const hasP = resolved.items.some(i => i.type === "PRODUCE");
      const hasC = resolved.items.some(i => i.type === "CONSUME");
      const adjType = hasP && hasC ? "Mixed" : hasP ? "Production" : "Consumption";
      const totalAmount = resolved.items.reduce((sum, i) => sum + i.quantity * i.rate, 0);
      const voucherNumber = `AI-${Date.now()}`;
      const voucherRes = await apiRequest("POST", "/api/vouchers", {
        voucherNumber,
        voucherType: adjType,
        voucherDate: resolved.date,
        description: resolved.notes || `${adjType} voucher`,
        totalAmount: String(totalAmount),
        optional: resolved.optional ?? false,
      });
      const voucherData = await voucherRes.json();
      const voucherId = voucherData.id;
      await apiRequest("POST", "/api/stock-adjustments", {
        voucherId,
        locationId: resolved.locationId,
        adjustmentType: adjType,
        notes: resolved.notes || "",
        items: resolved.items.map(i => ({
          stockItemId: i.stockItemId,
          quantity: i.type === "CONSUME" ? -Math.abs(i.quantity) : Math.abs(i.quantity),
          rate: i.rate,
        })),
      });
      setPendingStockAdj(null);
      sendMutation.mutate(`Stock adjustment created: ${adjType} voucher on ${resolved.date} at ${resolved.locationName}`);
    } catch (err: any) {
      sendMutation.mutate(`Stock adjustment failed: ${err.message}`);
    } finally {
      setStockAdjSubmitting(false);
    }
  };

  const handleConfirmStockItem = async (resolved: StockItemDraft) => {
    if (!resolved.stockGroupId) return;
    setStockItemSubmitting(true);
    try {
      await apiRequest("POST", "/api/stock-items", {
        name: resolved.name,
        code: resolved.code,
        uom: resolved.uom,
        stockGroupId: resolved.stockGroupId,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-items"] });
      setPendingStockItem(null);
      sendMutation.mutate(`Stock item "${resolved.name}" (${resolved.code}) created successfully in group "${resolved.stockGroupName}".`);
    } catch (err: any) {
      sendMutation.mutate(`Failed to create stock item: ${err.message}`);
    } finally {
      setStockItemSubmitting(false);
    }
  };

  const handleConfirmPriceUpdate = async (resolved: PriceUpdateDraft) => {
    if (!resolved.locationId) return;
    setPriceUpdateSubmitting(true);
    try {
      await apiRequest("POST", `/api/stock-items/${resolved.stockItemId}/location-prices`, {
        locationId: resolved.locationId,
        sellingPrice: String(resolved.newPrice),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/pos/price-list-by-masters"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pos/price-list"] });
      setPendingPriceUpdate(null);
      const cascadeNote = resolved.followerCount > 0 ? ` (cascaded to ${resolved.followerCount} follower location${resolved.followerCount !== 1 ? "s" : ""})` : "";
      sendMutation.mutate(`Price updated: "${resolved.stockItemName}" set to ${resolved.newPrice} for "${resolved.locationName}"${cascadeNote}.`);
    } catch (err: any) {
      sendMutation.mutate(`Failed to update price: ${err.message}`);
    } finally {
      setPriceUpdateSubmitting(false);
    }
  };

  const handleApplyPatch = async () => {
    if (!pendingFilePatch) return;
    setPatchApplying(true);
    try {
      const res = await apiRequest("POST", "/api/chatbot/apply-patch", {
        filePath: pendingFilePatch.filePath,
        originalContent: pendingFilePatch.originalContent,
        newContent: pendingFilePatch.newContent,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Apply failed" }));
        sendMutation.mutate(`Failed to apply patch: ${err.message}`);
        setPendingFilePatch(null);
        return;
      }
      setAppliedPatchFile(pendingFilePatch.filePath);
    } catch (err: any) {
      sendMutation.mutate(`Failed to apply patch: ${err.message}`);
      setPendingFilePatch(null);
    } finally {
      setPatchApplying(false);
    }
  };

  const handleGitPush = async (commitMsg: string) => {
    if (!appliedPatchFile) return;
    setGitPushing(true);
    setGitPushResult(null);
    try {
      const res = await apiRequest("POST", "/api/chatbot/git-push", {
        files: [appliedPatchFile],
        message: commitMsg,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setGitPushResult({ success: false, error: data.error ?? data.message ?? "Unknown error" });
        return;
      }
      setGitPushResult({ success: true, commitHash: data.commitHash, branch: data.branch });
    } catch (err: any) {
      setGitPushResult({ success: false, error: err.message });
    } finally {
      setGitPushing(false);
    }
  };

  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector(
        "[data-radix-scroll-area-viewport]"
      );
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [history, sendMutation.isPending]);

  useEffect(() => {
    if (isOpen && inputRef.current && !isMinimized) {
      inputRef.current.focus();
    }
  }, [isOpen, isMinimized]);

  const handleSend = (msg?: string) => {
    const textToSend = msg || message.trim();
    if (!textToSend || sendMutation.isPending) return;
    sendMutation.mutate(textToSend);
    if (!msg) setMessage("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    handleSend(suggestion);
  };

  const handleFeedback = async (messageId: number, type: "positive" | "negative") => {
    setFeedbackGiven(prev => ({ ...prev, [messageId]: type }));
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setPoDraftUploading(true);
    setPoDraft(null);
    setPoDraftResult(null);
    setPoDraftError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const resp = await fetch("/api/chatbot/parse-po-file", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.message || "Failed to parse file");
      setPoDraft(data as POImportDraft);
    } catch (err: any) {
      alert(`Could not parse file: ${err.message}`);
    } finally {
      setPoDraftUploading(false);
    }
  };

  const handleConfirmPOImport = async (resolved: any) => {
    setPoDraftSubmitting(true);
    setPoDraftError(null);
    try {
      const resp = await fetch("/api/chatbot/confirm-po-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(resolved),
        credentials: "include",
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.message || "Import failed");
      setPoDraftResult(data as POImportResult);
    } catch (err: any) {
      setPoDraftError(err.message);
    } finally {
      setPoDraftSubmitting(false);
    }
  };

  const handleNewChat = () => {
    const newSessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    setSessionId(newSessionId);
    setSuggestions([]);
    setFeedbackGiven({});
    setPendingVoucher(null);
    setPendingStockAdj(null);
    setPendingStockTransfer(null);
    setVoucherSearchResults(null);
    setPendingStockItem(null);
    setPendingPriceUpdate(null);
    setAccountQueryResult(null);
    setPoDraft(null);
    setPoDraftResult(null);
    setPoDraftError(null);
    setVerifyContainerDraft(null);
    setDataQueryResult(null);
    setPendingFilePatch(null);
    setAppliedPatchFile(null);
    setGitPushResult(null);
    setShowAlerts(true);
    queryClient.removeQueries({ queryKey: [`/api/chatbot/history/${sessionId}`] });
  };

  // Listen for "openAIChat" custom event (fired by CommandPalette "Ask AI..." item)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setIsOpen(true);
      setIsMinimized(false);
      if (detail?.prefill) {
        setMessage(detail.prefill);
        // Auto-focus input after a tiny delay
        setTimeout(() => inputRef.current?.focus(), 80);
      }
    };
    window.addEventListener("openAIChat", handler);
    return () => window.removeEventListener("openAIChat", handler);
  }, []);

  if (!status || !status.enabled || !status.hasApiKey) {
    return null;
  }

  const defaultSuggestions = [
    "Give me a business summary",
    "What items are low on stock?",
    "Show my top selling products",
    "What are my outstanding payments?",
  ];

  const formatMsgTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  };

  const pageContext = (() => {
    const p = location;
    if (p.startsWith("/factory")) return "Factory";
    if (p.startsWith("/pos")) return "POS";
    if (p.startsWith("/properties")) return "Properties";
    if (p.startsWith("/inventory")) return "Inventory";
    if (p.startsWith("/accounts")) return "Accounts";
    if (p.startsWith("/reports")) return "Reports";
    if (p.startsWith("/customers")) return "Customers";
    if (p.startsWith("/suppliers")) return "Suppliers";
    if (p.startsWith("/vouchers")) return "Vouchers";
    return "Dashboard";
  })();

  const displaySuggestions = suggestions.length > 0 ? suggestions : defaultSuggestions;

  return (
    <div className="fixed bottom-4 right-4 z-50" data-testid="chat-widget-container">
      {!isOpen ? (
        <button
          onClick={() => setIsOpen(true)}
          data-testid="button-open-chat"
          className="group flex items-center gap-2 rounded-full bg-primary text-primary-foreground shadow-md
            px-3 py-2 opacity-30 hover:opacity-100
            transition-all duration-300 ease-in-out
            overflow-hidden max-w-[2.25rem] hover:max-w-[160px]"
        >
          <MessageCircle className="h-4 w-4 flex-shrink-0" />
          <span className="text-sm font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-200 delay-100">
            AI Assistant
          </span>
        </button>
      ) : (
        <Card
          className={cn(
            "w-[360px] sm:w-[420px] shadow-[0_8px_30px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.4)] rounded-3xl transition-all duration-200 flex flex-col overflow-hidden",
            isMinimized ? "h-auto" : "h-[600px]"
          )}
        >
          <CardHeader className="flex flex-row items-center justify-between gap-2 py-4 px-5 border-b">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-blue-50 dark:bg-blue-900/40 flex items-center justify-center">
                <Sparkles className="h-4 w-4 text-blue-500 dark:text-blue-400" />
              </div>
              <div>
                <CardTitle className="text-sm font-medium">ERP Assistant</CardTitle>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Circle className="h-1.5 w-1.5 fill-green-500 text-green-500" />
                  <p className="text-xs text-muted-foreground">Online</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full"
                onClick={handleNewChat}
                title="New conversation"
                data-testid="button-new-chat"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full"
                onClick={() => setIsMinimized(!isMinimized)}
                data-testid="button-minimize-chat"
              >
                {isMinimized ? (
                  <Maximize2 className="h-4 w-4" />
                ) : (
                  <MinimizeIcon className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full"
                onClick={() => setIsOpen(false)}
                data-testid="button-close-chat"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>

          {/* Context pill */}
          {!isMinimized && (
            <div className="px-5 pt-2.5 pb-1 bg-background">
              <Badge
                variant="secondary"
                className="bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border border-blue-100 dark:border-blue-800 font-medium px-2 py-0.5 flex items-center gap-1.5 w-fit text-[11px]"
              >
                <Package className="h-3 w-3" />
                Context: {pageContext}
              </Badge>
            </div>
          )}

          {!isMinimized && (
            <CardContent className="p-0 flex flex-col flex-1 overflow-hidden">
              {/* ── 5a: Alerts Digest ── */}
              {showAlerts && (
                <AlertsDigest
                  onClose={() => setShowAlerts(false)}
                  onPrefill={(text) => {
                    setMessage(text);
                    inputRef.current?.focus();
                  }}
                />
              )}

              <ScrollArea ref={scrollAreaRef} className="flex-1 px-4 py-3">
                {history.length === 0 && !sendMutation.isPending && (
                  <div className="flex flex-col items-center justify-center h-full text-center py-6">
                    <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                      <Bot className="h-8 w-8 text-primary" />
                    </div>
                    <h3 className="font-semibold text-lg mb-1">Hello! I'm your AI Assistant</h3>
                    <p className="text-sm text-muted-foreground mb-4 max-w-[280px]">
                      Ask me anything — ERP data, code, general questions, or have me build you a mini app.
                    </p>

                    <div className="w-full space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Try asking:</p>
                      <div className="flex flex-wrap gap-2 justify-center">
                        {displaySuggestions.map((suggestion, index) => (
                          <Badge
                            key={index}
                            variant="outline"
                            className="cursor-pointer hover-elevate text-xs py-1.5 px-3"
                            onClick={() => handleSuggestionClick(suggestion)}
                            data-testid={`suggestion-chip-${index}`}
                          >
                            {suggestion}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                <div className="space-y-5">
                  {history.map((msg) => (
                    <div
                      key={msg.id}
                      className={cn(
                        "flex gap-2.5",
                        msg.role === "user" ? "justify-end" : "justify-start"
                      )}
                      data-testid={`chat-message-${msg.id}`}
                    >
                      {msg.role === "assistant" && (
                        <div className="flex-shrink-0 h-7 w-7 rounded-full bg-blue-500 dark:bg-blue-600 flex items-center justify-center mt-1">
                          <Sparkles className="h-3.5 w-3.5 text-white" />
                        </div>
                      )}
                      <div className="flex flex-col max-w-[83%]">
                        <div className={cn("flex items-center gap-1.5 mb-1 px-0.5", msg.role === "user" ? "justify-end" : "")}>
                          <span className="text-[11px] text-muted-foreground">
                            {msg.role === "assistant" ? "Assistant" : "You"}{msg.createdAt ? ` · ${formatMsgTime(msg.createdAt)}` : ""}
                          </span>
                        </div>
                        <div
                          className={cn(
                            "px-4 py-2.5 text-sm leading-relaxed",
                            msg.role === "user"
                              ? "bg-blue-50 text-blue-900 dark:bg-blue-900/50 dark:text-blue-100 rounded-2xl rounded-tr-sm"
                              : "bg-gray-50 dark:bg-zinc-800/80 rounded-2xl rounded-tl-sm"
                          )}
                        >
                          {msg.role === "assistant" ? (
                            <div className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={{
                                  table: ({ children }) => (
                                    <div className="overflow-x-auto my-2">
                                      <table className="min-w-full text-xs border-collapse">
                                        {children}
                                      </table>
                                    </div>
                                  ),
                                  th: ({ children }) => (
                                    <th className="border border-border px-2 py-1 bg-muted font-medium text-left">
                                      {children}
                                    </th>
                                  ),
                                  td: ({ children }) => (
                                    <td className="border border-border px-2 py-1">{children}</td>
                                  ),
                                  p: ({ children }) => (
                                    <p className="mb-2 last:mb-0">{children}</p>
                                  ),
                                  ul: ({ children }) => (
                                    <ul className="list-disc pl-4 mb-2 space-y-1">{children}</ul>
                                  ),
                                  ol: ({ children }) => (
                                    <ol className="list-decimal pl-4 mb-2 space-y-1">{children}</ol>
                                  ),
                                  li: ({ children }) => (
                                    <li className="text-sm">{children}</li>
                                  ),
                                  code: ({ children, className }) => {
                                    const isInline = !className;
                                    if (isInline) {
                                      return (
                                        <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono">
                                          {children}
                                        </code>
                                      );
                                    }
                                    const lang = (className ?? "").replace("language-", "");
                                    const codeStr = Array.isArray(children)
                                      ? children.join("")
                                      : String(children ?? "");
                                    return <CodeBlock code={codeStr.replace(/\n$/, "")} lang={lang} />;
                                  },
                                  strong: ({ children }) => (
                                    <strong className="font-semibold">{children}</strong>
                                  ),
                                }}
                              >
                                {msg.message}
                              </ReactMarkdown>
                            </div>
                          ) : (
                            <p className="whitespace-pre-wrap break-words">{msg.message}</p>
                          )}
                        </div>

                        {msg.role === "assistant" && (
                          <div className="flex items-center gap-1 mt-1 ml-1 flex-wrap">
                            <Button
                              variant="ghost"
                              size="icon"
                              className={cn(
                                "h-6 w-6",
                                feedbackGiven[msg.id] === "positive" && "text-green-500"
                              )}
                              onClick={() => handleFeedback(msg.id, "positive")}
                              disabled={!!feedbackGiven[msg.id]}
                              data-testid={`feedback-positive-${msg.id}`}
                            >
                              <ThumbsUp className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className={cn(
                                "h-6 w-6",
                                feedbackGiven[msg.id] === "negative" && "text-red-500"
                              )}
                              onClick={() => handleFeedback(msg.id, "negative")}
                              disabled={!!feedbackGiven[msg.id]}
                              data-testid={`feedback-negative-${msg.id}`}
                            >
                              <ThumbsDown className="h-3 w-3" />
                            </Button>
                            {lastUsedProvider && history[history.length - 1]?.id === msg.id && (
                              <span
                                className="flex items-center gap-1 text-[10px] text-muted-foreground/70 ml-1"
                                data-testid={`provider-badge-${msg.id}`}
                              >
                                <Cpu className="h-2.5 w-2.5" />
                                {PROVIDER_LABELS[lastUsedProvider] ?? lastUsedProvider}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      {msg.role === "user" && (
                        <div className="flex-shrink-0 h-7 w-7 rounded-full bg-gray-200 dark:bg-zinc-700 flex items-center justify-center mt-1 text-xs font-semibold text-gray-600 dark:text-zinc-300">
                          U
                        </div>
                      )}
                    </div>
                  ))}

                  {sendMutation.isPending && (
                    <div className="flex gap-2.5 justify-start">
                      <div className="flex-shrink-0 h-7 w-7 rounded-full bg-blue-500 dark:bg-blue-600 flex items-center justify-center">
                        <Sparkles className="h-3.5 w-3.5 text-white" />
                      </div>
                      <div className="bg-gray-50 dark:bg-zinc-800/80 rounded-2xl rounded-tl-sm px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span className="text-sm text-muted-foreground">Thinking...</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── 5b: Voucher Confirmation Card ── */}
                  {pendingVoucher && !sendMutation.isPending && (
                    <VoucherConfirmCard
                      draft={pendingVoucher}
                      onConfirm={handleConfirmVoucher}
                      onDismiss={() => setPendingVoucher(null)}
                      isSubmitting={voucherSubmitting}
                    />
                  )}

                  {/* ── 5b2: Stock Transfer Confirmation Card ── */}
                  {pendingStockTransfer && !sendMutation.isPending && (
                    <StockTransferConfirmCard
                      draft={pendingStockTransfer}
                      onConfirm={handleConfirmStockTransfer}
                      onDismiss={() => setPendingStockTransfer(null)}
                      isSubmitting={stockTransferSubmitting}
                    />
                  )}

                  {/* ── 5c: Stock Adjustment Confirmation Card ── */}
                  {pendingStockAdj && !sendMutation.isPending && (
                    <StockAdjustmentConfirmCard
                      draft={pendingStockAdj}
                      onConfirm={handleConfirmStockAdj}
                      onDismiss={() => setPendingStockAdj(null)}
                      isSubmitting={stockAdjSubmitting}
                    />
                  )}

                  {/* ── 5d: Voucher Search Results ── */}
                  {voucherSearchResults && voucherSearchResults.length > 0 && !sendMutation.isPending && (
                    <VoucherSearchResultsCard
                      results={voucherSearchResults}
                      onDismiss={() => setVoucherSearchResults(null)}
                    />
                  )}

                  {/* ── 5e: Stock Item Confirmation Card ── */}
                  {pendingStockItem && !sendMutation.isPending && (
                    <StockItemConfirmCard
                      draft={pendingStockItem}
                      onConfirm={handleConfirmStockItem}
                      onDismiss={() => setPendingStockItem(null)}
                      isSubmitting={stockItemSubmitting}
                    />
                  )}

                  {/* ── 5f: Price Update Confirmation Card ── */}
                  {pendingPriceUpdate && !sendMutation.isPending && (
                    <PriceUpdateConfirmCard
                      draft={pendingPriceUpdate}
                      onConfirm={handleConfirmPriceUpdate}
                      onDismiss={() => setPendingPriceUpdate(null)}
                      isSubmitting={priceUpdateSubmitting}
                    />
                  )}

                  {/* ── 5g: Account Query Result ── */}
                  {accountQueryResult && !sendMutation.isPending && (
                    <AccountQueryResultCard
                      result={accountQueryResult}
                      onDismiss={() => setAccountQueryResult(null)}
                    />
                  )}

                  {/* ── 5h: PO Import Draft ── */}
                  {poDraft && (
                    <POImportDraftCard
                      draft={poDraft}
                      onConfirm={handleConfirmPOImport}
                      onDismiss={() => { setPoDraft(null); setPoDraftResult(null); setPoDraftError(null); setVerifyContainerDraft(null); }}
                      isSubmitting={poDraftSubmitting}
                      result={poDraftResult}
                      importError={poDraftError}
                    />
                  )}

                  {/* ── 5i: Verify Container Download Card ── */}
                  {verifyContainerDraft && !sendMutation.isPending && (
                    <VerifyContainerCard
                      draft={verifyContainerDraft}
                      onDismiss={() => setVerifyContainerDraft(null)}
                    />
                  )}

                  {/* ── Phase 1: Data Query Result Card ── */}
                  {dataQueryResult && !sendMutation.isPending && (
                    <DataQueryResultCard
                      result={dataQueryResult}
                      onDismiss={() => setDataQueryResult(null)}
                    />
                  )}

                  {/* ── Phase 2: File Patch Diff Card ── */}
                  {pendingFilePatch && !sendMutation.isPending && (
                    <FileDiffCard
                      draft={pendingFilePatch}
                      onApply={handleApplyPatch}
                      onCancel={() => { setPendingFilePatch(null); setAppliedPatchFile(null); setGitPushResult(null); }}
                      isApplying={patchApplying}
                      appliedFile={appliedPatchFile}
                      onGitPush={handleGitPush}
                      isPushing={gitPushing}
                      pushResult={gitPushResult}
                    />
                  )}
                </div>

                {history.length > 0 && suggestions.length > 0 && !sendMutation.isPending && (
                  <div className="mt-4 pt-3 border-t">
                    <p className="text-xs font-medium text-muted-foreground mb-2">
                      Suggested questions:
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {suggestions.slice(0, 3).map((suggestion, index) => (
                        <Badge
                          key={index}
                          variant="outline"
                          className="cursor-pointer hover-elevate text-xs py-1 px-2"
                          onClick={() => handleSuggestionClick(suggestion)}
                          data-testid={`follow-up-suggestion-${index}`}
                        >
                          {suggestion}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </ScrollArea>

              <div className="p-4 border-t bg-background">
                <div className="flex items-center gap-1 bg-muted/50 dark:bg-zinc-800/50 rounded-2xl border border-border/60 px-1 pr-1.5 focus-within:border-blue-300 dark:focus-within:border-blue-700 focus-within:ring-2 focus-within:ring-blue-100 dark:focus-within:ring-blue-900/40 transition-all">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.xlsx,.xls,.csv"
                    className="hidden"
                    onChange={handleFileSelect}
                    data-testid="input-po-file"
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-9 w-9 rounded-xl shrink-0 text-muted-foreground"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={poDraftUploading || sendMutation.isPending}
                    title="Import PO from file"
                    data-testid="button-upload-po-file"
                  >
                    {poDraftUploading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Paperclip className="h-4 w-4" />
                    )}
                  </Button>
                  <Input
                    ref={inputRef}
                    placeholder="Ask anything..."
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={sendMutation.isPending}
                    className="flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0 px-1 h-10 text-sm placeholder:text-muted-foreground/60"
                    data-testid="input-chat-message"
                  />
                  <Button
                    size="icon"
                    className="h-9 w-9 rounded-xl shrink-0 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-black dark:hover:bg-white"
                    onClick={() => handleSend()}
                    disabled={!message.trim() || sendMutation.isPending}
                    data-testid="button-send-message"
                  >
                    {sendMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4 ml-0.5" />
                    )}
                  </Button>
                </div>
                {sendMutation.isError && (
                  <p
                    className="text-xs text-destructive mt-2"
                    data-testid="text-chat-error"
                  >
                    Failed to send message. Please try again.
                  </p>
                )}
                <p className="text-center mt-2 text-[10px] text-muted-foreground/50 font-medium tracking-wide uppercase">
                  AI responses may be inaccurate
                </p>
              </div>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}
