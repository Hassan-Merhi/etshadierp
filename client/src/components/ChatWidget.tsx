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
} from "lucide-react";
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

interface ChatResponse {
  response: string;
  suggestions: string[];
  voucherDraft?: VoucherDraft | null;
  stockAdjustmentDraft?: StockAdjustmentDraft | null;
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
          <div className="grid grid-cols-[1fr_56px_40px] gap-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
            <span>Item</span><span className="text-center">Type</span><span className="text-right">Qty</span>
          </div>
          {draft.items.map((item, i) => {
            const candidates = item.candidates ?? [];
            const hasChoice = candidates.length > 1;
            return (
              <div key={i} className="grid grid-cols-[1fr_56px_40px] gap-1 items-center">
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

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
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

  const handleNewChat = () => {
    const newSessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    setSessionId(newSessionId);
    setSuggestions([]);
    setFeedbackGiven({});
    setPendingVoucher(null);
    setPendingStockAdj(null);
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
