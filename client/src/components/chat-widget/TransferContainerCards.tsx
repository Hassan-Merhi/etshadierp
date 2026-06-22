import { useState } from "react";
import { ArrowLeftRight, XCircle, Loader2, FileCheck, X, Download, Plus, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  StockTransferDraft,
  VerifyContainerDraft,
  DataQueryResult,
} from "./chatWidgetTypes";
import { cn } from "@/lib/utils";

// ── Stock Transfer Confirmation Card ───────────────────────────────
export function StockTransferConfirmCard({
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
export function VerifyContainerCard({
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
export function DataQueryResultCard({ result, onDismiss }: { result: DataQueryResult; onDismiss: () => void }) {
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
