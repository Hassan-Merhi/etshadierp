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

interface ChatResponse {
  response: string;
  suggestions: string[];
  voucherDraft?: VoucherDraft | null;
  stockAdjustmentDraft?: StockAdjustmentDraft | null;
  voucherSearchResults?: VoucherSearchResult[] | null;
  stockItemDraft?: StockItemDraft | null;
  priceUpdateDraft?: PriceUpdateDraft | null;
  accountQueryResult?: AccountQueryResult | null;
  verifyContainerDraft?: VerifyContainerDraft | null;
  dataQueryResult?: DataQueryResult | null;
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
  }[];
}

interface AlertDigest {
  lowStock: { id: number; name: string; code: string; qty: number; reorderLevel: number }[];
  openPOs: { id: number; poNumber: string }[];
  overdueCustomers: { customerId: number; name: string; balance: number }[];
  pendingPayrolls: { id: number; periodStart: string; periodEnd: string; status: string }[];
}

// ── Alerts Digest Card ────────────────────────────────────────────────
function AlertsDigest({ onClose }: { onClose: () => void }) {
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
                {alerts.lowStock.slice(0, 5).map(item => (
                  <li key={item.id} className="text-xs text-muted-foreground flex justify-between gap-2">
                    <span className="truncate">{item.name}</span>
                    <span className="shrink-0 text-amber-600 dark:text-amber-400">{item.qty} / {item.reorderLevel}</span>
                  </li>
                ))}
                {alerts.lowStock.length > 5 && (
                  <li className="text-xs text-muted-foreground italic">+{alerts.lowStock.length - 5} more</li>
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
                  <li key={po.id} className="text-xs text-muted-foreground">{po.poNumber}</li>
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
                  <li key={c.customerId} className="text-xs text-muted-foreground flex justify-between gap-2">
                    <span className="truncate">{c.name}</span>
                    <span className="shrink-0 text-amber-600 dark:text-amber-400">${c.balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
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
                  <li key={p.id} className="text-xs text-muted-foreground">
                    {p.periodStart} – {p.periodEnd}
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
          <div className="grid grid-cols-[1fr_50px_36px_48px] gap-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
            <span>Item</span><span className="text-center">Type</span><span className="text-right">Qty</span><span className="text-right">Rate</span>
          </div>
          {draft.items.map((item, i) => {
            const candidates = item.candidates ?? [];
            const hasChoice = candidates.length > 1;
            return (
              <div key={i} className="grid grid-cols-[1fr_50px_36px_48px] gap-1 items-center">
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
              </div>
            );
          })}
        </div>
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
}: {
  draft: POImportDraft;
  onConfirm: (resolved: any) => void;
  onDismiss: () => void;
  isSubmitting: boolean;
  result: POImportResult | null;
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
  onConfirm: () => void;
  onDismiss: () => void;
  isSubmitting: boolean;
}) {
  const totalDebit = draft.entries.reduce((s, e) => s + (e.debit || 0), 0);
  const totalCredit = draft.entries.reduce((s, e) => s + (e.credit || 0), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01;

  return (
    <div className="mt-2 rounded-md border border-primary/30 bg-primary/5 overflow-hidden" data-testid="voucher-confirm-card">
      <div className="px-3 py-2 bg-primary/10 flex items-center gap-2">
        <FileText className="h-4 w-4 text-primary shrink-0" />
        <span className="text-sm font-semibold text-primary">
          Create {draft.type} Voucher?
        </span>
      </div>
      <div className="px-3 py-2 space-y-1.5 text-xs">
        <div className="flex justify-between gap-2 text-muted-foreground">
          <span>Date</span><span className="font-medium text-foreground">{draft.date}</span>
        </div>
        <div className="flex justify-between gap-2 text-muted-foreground">
          <span>Description</span><span className="font-medium text-foreground truncate max-w-[180px]">{draft.description}</span>
        </div>
        <div className="border-t pt-1.5 mt-1.5 space-y-1">
          <div className="grid grid-cols-3 gap-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
            <span>Account</span><span className="text-right">Debit</span><span className="text-right">Credit</span>
          </div>
          {draft.entries.map((e, i) => (
            <div key={i} className="grid grid-cols-3 gap-1">
              <span className="truncate text-foreground">{e.accountName}</span>
              <span className="text-right text-foreground">{e.debit > 0 ? `$${e.debit.toLocaleString()}` : ""}</span>
              <span className="text-right text-foreground">{e.credit > 0 ? `$${e.credit.toLocaleString()}` : ""}</span>
            </div>
          ))}
          <div className="grid grid-cols-3 gap-1 border-t pt-1 font-semibold text-xs">
            <span>Total</span>
            <span className="text-right">${totalDebit.toLocaleString()}</span>
            <span className="text-right">${totalCredit.toLocaleString()}</span>
          </div>
          {!balanced && (
            <p className="text-destructive text-[10px]">Warning: debits and credits don't balance.</p>
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
          onClick={onConfirm}
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
  const [verifyContainerDraft, setVerifyContainerDraft] = useState<VerifyContainerDraft | null>(null);
  const [dataQueryResult, setDataQueryResult] = useState<DataQueryResult | null>(null);

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
      });
      return response.json() as Promise<ChatResponse>;
    },
    onSuccess: (data) => {
      refetchHistory();
      setMessage("");
      if (data.suggestions && data.suggestions.length > 0) {
        setSuggestions(data.suggestions);
      }
      if (data.voucherDraft) {
        setPendingVoucher(data.voucherDraft);
        setPendingStockAdj(null);
      } else if (data.stockAdjustmentDraft) {
        setPendingStockAdj(data.stockAdjustmentDraft);
        setPendingVoucher(null);
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
    },
  });

  const handleConfirmVoucher = async () => {
    if (!pendingVoucher) return;
    setVoucherSubmitting(true);
    try {
      const voucherNumber = `AI-${Date.now()}`;
      const body = {
        voucher: {
          voucherNumber,
          voucherType: pendingVoucher.type,
          voucherDate: pendingVoucher.date,
          description: pendingVoucher.description,
          optional: pendingVoucher.optional ?? false,
        },
        entries: pendingVoucher.entries.map(e => ({
          ledgerAccountId: e.accountId,
          debitAmount: String(e.debit || 0),
          creditAmount: String(e.credit || 0),
          narration: pendingVoucher.description,
        })),
      };
      await apiRequest("POST", "/api/vouchers/with-entries", body);
      setPendingVoucher(null);
      // Confirm by sending a message
      sendMutation.mutate(`Voucher created successfully: ${pendingVoucher.type} of $${Math.max(...pendingVoucher.entries.map(e => e.debit || e.credit))} on ${pendingVoucher.date}`);
    } catch (err: any) {
      sendMutation.mutate(`Voucher creation failed: ${err.message}`);
    } finally {
      setVoucherSubmitting(false);
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
      alert(`Import failed: ${err.message}`);
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
    setVoucherSearchResults(null);
    setPendingStockItem(null);
    setPendingPriceUpdate(null);
    setAccountQueryResult(null);
    setPoDraft(null);
    setPoDraftResult(null);
    setVerifyContainerDraft(null);
    setShowAlerts(true);
    queryClient.removeQueries({ queryKey: [`/api/chatbot/history/${sessionId}`] });
  };

  if (!status || !status.enabled || !status.hasApiKey) {
    return null;
  }

  const defaultSuggestions = [
    "Give me a business summary",
    "What items are low on stock?",
    "Show my top selling products",
    "What are my outstanding payments?",
  ];

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
            "w-[360px] sm:w-[420px] shadow-2xl transition-all duration-200 flex flex-col",
            isMinimized ? "h-auto" : "h-[600px]"
          )}
        >
          <CardHeader className="flex flex-row items-center justify-between gap-2 py-3 px-4 border-b bg-primary/5">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center">
                <Sparkles className="h-4 w-4 text-primary-foreground" />
              </div>
              <div>
                <CardTitle className="text-sm font-semibold">ERP Assistant</CardTitle>
                <p className="text-xs text-muted-foreground">Powered by AI</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleNewChat}
                title="New conversation"
                data-testid="button-new-chat"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
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
                className="h-8 w-8"
                onClick={() => setIsOpen(false)}
                data-testid="button-close-chat"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>

          {!isMinimized && (
            <CardContent className="p-0 flex flex-col flex-1 overflow-hidden">
              {/* ── 5a: Alerts Digest ── */}
              {showAlerts && (
                <AlertsDigest onClose={() => setShowAlerts(false)} />
              )}

              <ScrollArea ref={scrollAreaRef} className="flex-1 px-4 py-3">
                {history.length === 0 && !sendMutation.isPending && (
                  <div className="flex flex-col items-center justify-center h-full text-center py-6">
                    <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                      <Bot className="h-8 w-8 text-primary" />
                    </div>
                    <h3 className="font-semibold text-lg mb-1">Hello! I'm your ERP Assistant</h3>
                    <p className="text-sm text-muted-foreground mb-4 max-w-[280px]">
                      I can help you with inventory, sales, finances, and business insights.
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

                <div className="space-y-4">
                  {history.map((msg) => (
                    <div
                      key={msg.id}
                      className={cn(
                        "flex gap-2",
                        msg.role === "user" ? "justify-end" : "justify-start"
                      )}
                      data-testid={`chat-message-${msg.id}`}
                    >
                      {msg.role === "assistant" && (
                        <div className="flex-shrink-0 h-7 w-7 rounded-full bg-primary flex items-center justify-center mt-1">
                          <Bot className="h-4 w-4 text-primary-foreground" />
                        </div>
                      )}
                      <div className="flex flex-col max-w-[85%]">
                        <div
                          className={cn(
                            "rounded-lg px-3 py-2 text-sm",
                            msg.role === "user"
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted"
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
                                    return isInline ? (
                                      <code className="bg-background/50 px-1 py-0.5 rounded text-xs font-mono">
                                        {children}
                                      </code>
                                    ) : (
                                      <code className="block bg-background/50 p-2 rounded text-xs font-mono overflow-x-auto">
                                        {children}
                                      </code>
                                    );
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
                          <div className="flex items-center gap-1 mt-1 ml-1">
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
                          </div>
                        )}
                      </div>
                      {msg.role === "user" && (
                        <div className="flex-shrink-0 h-7 w-7 rounded-full bg-muted flex items-center justify-center mt-1">
                          <User className="h-4 w-4" />
                        </div>
                      )}
                    </div>
                  ))}

                  {sendMutation.isPending && (
                    <div className="flex gap-2 justify-start">
                      <div className="flex-shrink-0 h-7 w-7 rounded-full bg-primary flex items-center justify-center">
                        <Bot className="h-4 w-4 text-primary-foreground" />
                      </div>
                      <div className="bg-muted rounded-lg px-4 py-3">
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
                      onDismiss={() => { setPoDraft(null); setPoDraftResult(null); setVerifyContainerDraft(null); }}
                      isSubmitting={poDraftSubmitting}
                      result={poDraftResult}
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

              <div className="p-3 border-t bg-background">
                <div className="flex gap-2">
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
                    placeholder="Ask about your business data..."
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={sendMutation.isPending}
                    className="flex-1"
                    data-testid="input-chat-message"
                  />
                  <Button
                    size="icon"
                    onClick={() => handleSend()}
                    disabled={!message.trim() || sendMutation.isPending}
                    data-testid="button-send-message"
                  >
                    {sendMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
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
              </div>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}
