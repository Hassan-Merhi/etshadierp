import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Save, Loader2, CheckCircle, Plus, Trash2, Container } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const DRAFT_KEY = "create-proforma-v5-draft";

interface ArticleRow {
  articleCode: string;
  productName: string;
  stockAvailable: number;
  totalLoaded: number;
  expectedToLoad: number;
  freeToPromise: number;
}

interface FactoryCustomer { id: number; legalName: string; }
interface BaleProduct {
  id: number; code: string; articleCode: string | null;
  weightPerBaleKg: string | null; sellingPrice: string | null; productionPrice: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  articleRows: ArticleRow[];
  onSuccess: () => void;
}

interface Draft {
  customerId: string;
  proformaName: string;
  isActive: boolean;
  quantities: Record<string, string>;
  sellingPrices: Record<string, string>;
  sendToLoading: boolean;
  containerCount: string;
  containerNames: string[];
  savedAt: number;
}

function loadDraft(): Draft | null {
  try { const raw = localStorage.getItem(DRAFT_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function saveDraft(d: Draft) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...d, savedAt: Date.now() })); } catch {}
}
function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch {}
}

function generateContainerNames(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `Container ${i + 1}`);
}

export default function CreateProformaV5Drawer({ open, onClose, articleRows, onSuccess }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const draft = loadDraft();
  const [customerId, setCustomerId]         = useState(draft?.customerId ?? "");
  const [proformaName, setProformaName]     = useState(draft?.proformaName ?? "");
  const [isActive, setIsActive]             = useState(draft?.isActive ?? true);
  const [quantities, setQuantities]         = useState<Record<string, string>>(draft?.quantities ?? {});
  const [sellingPrices, setSellingPrices]   = useState<Record<string, string>>(draft?.sellingPrices ?? {});
  const [sendToLoading, setSendToLoading]   = useState(draft?.sendToLoading ?? false);
  const [containerCount, setContainerCount] = useState(draft?.containerCount ?? "1");
  const [containerNames, setContainerNames] = useState<string[]>(draft?.containerNames ?? ["Container 1"]);
  const [draftStatus, setDraftStatus]       = useState<"idle" | "saved">("idle");
  const [errors, setErrors]                 = useState<Record<string, string>>({});
  const [showZeroItems, setShowZeroItems]   = useState(false);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qtyRefs    = useRef<(HTMLInputElement | null)[]>([]);

  // When container count changes, regenerate default names (preserving user edits)
  useEffect(() => {
    const n = Math.max(1, Math.min(100, parseInt(containerCount) || 1));
    setContainerNames(prev => {
      const next = [...prev];
      while (next.length < n) next.push(`Container ${next.length + 1}`);
      return next.slice(0, n);
    });
  }, [containerCount]);

  const customersQuery = useQuery<FactoryCustomer[]>({
    queryKey: ["/api/factory/customers"],
    queryFn: async () => {
      const res = await fetch("/api/factory/customers", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load customers");
      return res.json();
    },
    enabled: open,
  });

  const productsQuery = useQuery<BaleProduct[]>({
    queryKey: ["/api/factory/bale-products"],
    queryFn: async () => {
      const res = await fetch("/api/factory/bale-products", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load products");
      return res.json();
    },
    enabled: open,
  });

  const productMap = useCallback((): Map<string, BaleProduct> => {
    const m = new Map<string, BaleProduct>();
    for (const p of productsQuery.data || []) {
      m.set(p.code, p);
      if (p.articleCode) m.set(p.articleCode, p);
    }
    return m;
  }, [productsQuery.data]);

  useEffect(() => {
    if (!productsQuery.data) return;
    const map = productMap();
    setSellingPrices(prev => {
      const next = { ...prev };
      for (const row of articleRows) {
        if (!next[row.articleCode]) {
          const p = map.get(row.articleCode);
          if (p?.sellingPrice && parseFloat(p.sellingPrice) > 0) next[row.articleCode] = p.sellingPrice;
        }
      }
      return next;
    });
  }, [productsQuery.data, articleRows, productMap]);

  const createMutation = useMutation({
    mutationFn: async (payload: object) =>
      apiRequest("POST", "/api/factory/v5/proforma-with-loading", payload),
    onSuccess: () => {
      clearDraft();
      qc.invalidateQueries({ queryKey: ["/api/factory/v5/stock-allocation"] });
      toast({ title: "Proforma created", description: sendToLoading ? `Proforma + ${containerNames.length} loading container(s) created.` : "Stock allocation has been refreshed." });
      onClose();
      onSuccess();
    },
    onError: (e: any) => {
      toast({ title: "Failed to create proforma", description: e.message, variant: "destructive" });
    },
  });

  const triggerAutosave = useCallback((data: Draft) => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      saveDraft(data);
      setDraftStatus("saved");
      setTimeout(() => setDraftStatus("idle"), 2000);
    }, 800);
  }, []);

  useEffect(() => {
    triggerAutosave({ customerId, proformaName, isActive, quantities, sellingPrices, sendToLoading, containerCount, containerNames, savedAt: Date.now() });
  }, [customerId, proformaName, isActive, quantities, sellingPrices, sendToLoading, containerCount, containerNames, triggerAutosave]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); handleSubmit(); }
    };
    if (open) window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  function handleQtyChange(code: string, val: string) {
    setQuantities(prev => ({ ...prev, [code]: val }));
    setErrors(prev => { const n = { ...n, ...prev }; delete n[`qty_${code}`]; return n; });
  }

  function handleQtyKeyDown(e: React.KeyboardEvent<HTMLInputElement>, rowIdx: number) {
    if (e.key === "ArrowDown" || e.key === "Enter") {
      e.preventDefault(); const next = qtyRefs.current[rowIdx + 1]; if (next) { next.focus(); next.select(); }
    } else if (e.key === "ArrowUp") {
      e.preventDefault(); const prev = qtyRefs.current[rowIdx - 1]; if (prev) { prev.focus(); prev.select(); }
    } else if (e.key === "Escape") { e.currentTarget.blur(); }
  }

  function updateContainerName(idx: number, val: string) {
    setContainerNames(prev => { const next = [...prev]; next[idx] = val; return next; });
  }

  function addContainer() {
    setContainerNames(prev => [...prev, `Container ${prev.length + 1}`]);
    setContainerCount(prev => String(parseInt(prev || "1") + 1));
  }
  function removeContainer(idx: number) {
    setContainerNames(prev => prev.filter((_, i) => i !== idx));
    setContainerCount(prev => String(Math.max(1, parseInt(prev || "1") - 1)));
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!customerId) errs.customerId = "Customer is required";
    if (!proformaName.trim()) errs.proformaName = "Proforma name is required";
    const hasQty = articleRows.some(r => { const v = quantities[r.articleCode]; return v && parseInt(v) > 0; });
    if (!hasQty) errs.lines = "Enter at least one quantity";
    articleRows.forEach(r => {
      const v = quantities[r.articleCode];
      if (!v || v === "") return;
      const n = parseInt(v);
      if (isNaN(n)) errs[`qty_${r.articleCode}`] = "Must be a number";
      else if (n < 0) errs[`qty_${r.articleCode}`] = "Cannot be negative";
    });
    if (sendToLoading && containerNames.length === 0) errs.containers = "Add at least one container";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleSubmit() {
    if (!validate()) return;
    const lines = articleRows
      .filter(r => { const v = quantities[r.articleCode]; return v && parseInt(v) > 0; })
      .map(r => ({
        articleCode: r.articleCode,
        productName: r.productName,
        quantity: parseInt(quantities[r.articleCode]),
        pricePerBale: sellingPrices[r.articleCode] || "0",
        productionPricePerBale: "0",
      }));

    const n = containerNames.length;
    // Warning: check shortages
    const shortages = lines.filter(l => {
      const row = articleRows.find(r => r.articleCode === l.articleCode);
      if (!row) return false;
      const expected = l.quantity * n;
      return expected > row.stockAvailable + row.totalLoaded;
    });
    if (shortages.length > 0 && sendToLoading) {
      const msgs = shortages.map(l => {
        const row = articleRows.find(r => r.articleCode === l.articleCode)!;
        const shortBy = l.quantity * n - (row.stockAvailable + row.totalLoaded);
        return `${l.productName} short by ${shortBy}`;
      });
      toast({
        title: "Stock shortage warning",
        description: `${msgs.join("; ")}. You can continue but more bales must be created before loading completes.`,
        variant: "destructive",
      });
    }

    createMutation.mutate({
      customerId: parseInt(customerId),
      name: proformaName.trim(),
      isActive,
      lines,
      sendToLoading,
      containerNames: sendToLoading ? containerNames : [],
    });
  }

  const map = productMap();
  const n = sendToLoading ? containerNames.length : 0;

  const totalQty = articleRows.reduce((s, r) => {
    const v = parseInt(quantities[r.articleCode] || "0");
    return s + (isNaN(v) || v < 0 ? 0 : v);
  }, 0);
  const totalExpected = sendToLoading && n > 0 ? totalQty * n : totalQty;

  const filledLines = articleRows.filter(r => { const v = quantities[r.articleCode]; return v && parseInt(v) > 0; }).length;

  const warningCount = articleRows.filter(r => {
    const qty = parseInt(quantities[r.articleCode] || "0");
    if (isNaN(qty) || qty <= 0) return false;
    const expected = sendToLoading && n > 0 ? qty * n : qty;
    return expected > r.stockAvailable + r.totalLoaded;
  }).length;

  const zeroItemCount = articleRows.filter(r => r.stockAvailable === 0).length;
  const visibleRows = showZeroItems ? articleRows : articleRows.filter(r => r.stockAvailable > 0 || r.expectedToLoad > 0);

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent
        className="max-w-[98vw] w-[98vw] h-[96vh] flex flex-col p-0 gap-0"
        data-testid="dialog-create-proforma-v5"
      >
        <DialogHeader className="px-5 py-4 border-b shrink-0">
          <DialogTitle className="text-base flex items-center gap-2">
            Create Proforma
            <Badge variant="secondary" className="text-[10px] font-semibold tracking-wide">v5</Badge>
          </DialogTitle>
        </DialogHeader>

        {/* Top fields */}
        <div className="px-5 py-3 border-b shrink-0 flex flex-wrap gap-4 items-end">
          <div className="flex flex-col gap-1.5 min-w-[200px] flex-1">
            <Label htmlFor="v5-proforma-customer" className="text-xs font-medium">
              Customer <span className="text-destructive">*</span>
            </Label>
            <Select value={customerId} onValueChange={v => { setCustomerId(v); setErrors(p => { const n = { ...p }; delete n.customerId; return n; }); }}>
              <SelectTrigger id="v5-proforma-customer" data-testid="select-v5-proforma-customer" className={cn(errors.customerId && "border-destructive")}>
                <SelectValue placeholder="Select customer…" />
              </SelectTrigger>
              <SelectContent>
                {customersQuery.isLoading && <SelectItem value="__loading" disabled>Loading…</SelectItem>}
                {(customersQuery.data || []).map(c => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.legalName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.customerId && <p className="text-xs text-destructive">{errors.customerId}</p>}
          </div>

          <div className="flex flex-col gap-1.5 min-w-[200px] flex-1">
            <Label htmlFor="v5-proforma-name" className="text-xs font-medium">
              Proforma Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="v5-proforma-name"
              data-testid="input-v5-proforma-name"
              value={proformaName}
              onChange={e => { setProformaName(e.target.value); setErrors(p => { const n = { ...p }; delete n.proformaName; return n; }); }}
              placeholder="e.g. Proforma #001"
              className={cn(errors.proformaName && "border-destructive")}
            />
            {errors.proformaName && <p className="text-xs text-destructive">{errors.proformaName}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-medium">Status</Label>
            <div className="flex items-center gap-2 h-9">
              <Switch checked={isActive} onCheckedChange={setIsActive} data-testid="switch-v5-proforma-active" />
              <span className="text-sm text-muted-foreground">{isActive ? "Active" : "Inactive"}</span>
            </div>
          </div>

          {/* Send to Loading toggle */}
          <div className="flex flex-col gap-1.5 border-l pl-4">
            <Label className="text-xs font-medium flex items-center gap-1">
              <Container className="h-3 w-3" />
              Send to Loading
            </Label>
            <div className="flex items-center gap-2 h-9">
              <Switch
                checked={sendToLoading}
                onCheckedChange={setSendToLoading}
                data-testid="switch-v5-send-to-loading"
              />
              <span className="text-sm text-muted-foreground">{sendToLoading ? "Yes" : "No"}</span>
            </div>
          </div>

          {sendToLoading && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-medium">No. of Containers</Label>
              <Input
                type="number"
                min={1}
                max={100}
                value={containerCount}
                onChange={e => setContainerCount(e.target.value)}
                className="h-9 w-24 text-center"
                data-testid="input-v5-container-count"
              />
            </div>
          )}

          {zeroItemCount > 0 && (
            <div className="border-l pl-4">
              <Button size="default" variant={showZeroItems ? "secondary" : "outline"} onClick={() => setShowZeroItems(v => !v)} data-testid="button-v5-toggle-zero">
                {showZeroItems ? `Hide 0-stock (${zeroItemCount})` : `Show 0-stock (${zeroItemCount})`}
              </Button>
            </div>
          )}

          <div className="flex items-center gap-1.5 text-xs text-muted-foreground h-9 ml-auto">
            {draftStatus === "saved" && <><CheckCircle className="h-3 w-3 text-green-500" />Draft autosaved</>}
          </div>
        </div>

        {/* Container names panel */}
        {sendToLoading && (
          <div className="px-5 py-3 border-b shrink-0 bg-muted/20">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-muted-foreground">Container names — click to rename</p>
              <Button size="sm" variant="outline" onClick={addContainer} data-testid="button-v5-add-container">
                <Plus className="h-3.5 w-3.5 mr-1" />Add
              </Button>
            </div>
            {errors.containers && <p className="text-xs text-destructive mb-1">{errors.containers}</p>}
            <div className="flex flex-wrap gap-2 max-h-32 overflow-auto">
              {containerNames.map((name, idx) => (
                <div key={idx} className="flex items-center gap-1 bg-background border rounded-md px-2 py-1">
                  <Container className="h-3 w-3 text-muted-foreground shrink-0" />
                  <Input
                    value={name}
                    onChange={e => updateContainerName(idx, e.target.value)}
                    className="h-6 text-xs border-0 p-0 w-28 bg-transparent focus-visible:ring-0"
                    data-testid={`input-v5-container-name-${idx}`}
                  />
                  {containerNames.length > 1 && (
                    <button
                      onClick={() => removeContainer(idx)}
                      className="text-muted-foreground/60 hover-elevate rounded"
                      data-testid={`button-v5-remove-container-${idx}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {errors.lines && (
          <div className="px-5 py-2 bg-destructive/10 border-b shrink-0">
            <p className="text-xs text-destructive">{errors.lines}</p>
          </div>
        )}

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm border-collapse min-w-max">
            <thead>
              <tr className="bg-muted sticky top-0 z-10">
                <th className="text-left px-3 py-2 font-medium border-b border-r whitespace-nowrap min-w-[200px] sticky left-0 bg-muted z-20">Product</th>
                <th className="text-right px-3 py-2 font-medium border-b border-r whitespace-nowrap min-w-[100px]">Stock Available</th>
                <th className="text-right px-3 py-2 font-medium border-b border-r whitespace-nowrap min-w-[90px] text-blue-600 dark:text-blue-400">In Loading</th>
                <th className="text-center px-3 py-2 font-medium border-b border-r whitespace-nowrap min-w-[110px]">Qty / Container</th>
                {sendToLoading && n > 0 && (
                  <th className="text-right px-3 py-2 font-medium border-b border-r whitespace-nowrap min-w-[110px] text-amber-600 dark:text-amber-400">
                    Expected Total ({n}×)
                  </th>
                )}
                <th className="text-center px-3 py-2 font-medium border-b whitespace-nowrap min-w-[130px]">Price</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, idx) => {
                const rawVal  = quantities[row.articleCode] ?? "";
                const parsed  = parseInt(rawVal);
                const qty     = isNaN(parsed) ? 0 : parsed;
                const expected = sendToLoading && n > 0 ? qty * n : qty;
                const onHand  = row.stockAvailable + row.totalLoaded;
                const shortage = expected > 0 && expected > onHand;
                const shortBy  = expected - onHand;
                const hasError = !!errors[`qty_${row.articleCode}`];

                return (
                  <tr
                    key={row.articleCode}
                    className={cn(
                      "border-b transition-colors",
                      idx % 2 === 0 ? "bg-background" : "bg-muted/20",
                      qty > 0 && "bg-blue-50/30 dark:bg-blue-950/20",
                    )}
                    data-testid={`row-v5-create-${row.articleCode}`}
                  >
                    <td className="px-3 py-1.5 border-r sticky left-0 bg-inherit z-10">
                      <div className="font-medium truncate max-w-[220px] text-xs leading-tight" title={row.productName}>{row.productName}</div>
                      {row.productName !== row.articleCode && (
                        <div className="text-[10px] text-muted-foreground font-mono">{row.articleCode}</div>
                      )}
                    </td>

                    <td className="px-3 py-1.5 border-r text-right font-mono tabular-nums text-xs">{row.stockAvailable}</td>

                    <td className={cn("px-3 py-1.5 border-r text-right font-mono tabular-nums text-xs", row.totalLoaded > 0 && "text-blue-600 dark:text-blue-400")}>
                      {row.totalLoaded > 0 ? row.totalLoaded : <span className="text-muted-foreground/40">—</span>}
                    </td>

                    <td className="px-2 py-1 border-r">
                      <div className="flex flex-col gap-0.5 items-center">
                        <Input
                          ref={el => { qtyRefs.current[idx] = el; }}
                          type="number" min={0}
                          value={rawVal}
                          onChange={e => handleQtyChange(row.articleCode, e.target.value)}
                          onKeyDown={e => handleQtyKeyDown(e, idx)}
                          onFocus={e => e.target.select()}
                          placeholder="0"
                          className={cn(
                            "h-7 text-center text-xs font-mono w-20 px-1 tabular-nums",
                            hasError && "border-destructive",
                            shortage && !hasError && "border-amber-400 dark:border-amber-500",
                            qty > 0 && !shortage && !hasError && "border-blue-400 dark:border-blue-500",
                          )}
                          data-testid={`input-v5-qty-${row.articleCode}`}
                        />
                        {hasError && <span className="text-[10px] text-destructive">{errors[`qty_${row.articleCode}`]}</span>}
                        {shortage && !hasError && (
                          <span className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-0.5 whitespace-nowrap">
                            <AlertTriangle className="h-2.5 w-2.5" />short {shortBy}
                          </span>
                        )}
                      </div>
                    </td>

                    {sendToLoading && n > 0 && (
                      <td className={cn(
                        "px-3 py-1.5 border-r text-right font-mono tabular-nums text-xs font-semibold",
                        shortage ? "text-destructive" : expected > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground/40",
                      )}>
                        {expected > 0 ? (
                          <span className="flex items-center justify-end gap-1">
                            {shortage && <AlertTriangle className="h-3 w-3" />}
                            {expected}
                          </span>
                        ) : "—"}
                      </td>
                    )}

                    <td className="px-2 py-1">
                      <Input
                        type="number" min={0} step="0.01"
                        value={sellingPrices[row.articleCode] ?? ""}
                        onChange={e => setSellingPrices(prev => ({ ...prev, [row.articleCode]: e.target.value }))}
                        onFocus={e => e.target.select()}
                        placeholder="0.00"
                        className="h-7 text-right text-xs font-mono w-24 px-2 tabular-nums"
                        data-testid={`input-v5-price-${row.articleCode}`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t bg-muted/30 shrink-0 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
            <span><span className="font-semibold text-foreground">{filledLines}</span> line{filledLines !== 1 ? "s" : ""}</span>
            <span><span className="font-semibold text-foreground">{totalQty}</span> bales/container</span>
            {sendToLoading && n > 0 && (
              <span className="text-amber-600 dark:text-amber-400">
                <span className="font-semibold">{totalExpected}</span> total expected ({n} container{n !== 1 ? "s" : ""})
              </span>
            )}
            {warningCount > 0 && (
              <span className="flex items-center gap-1 text-destructive">
                <AlertTriangle className="h-3 w-3" />
                {warningCount} product{warningCount !== 1 ? "s" : ""} with shortage
              </span>
            )}
            <span className="text-[10px] text-muted-foreground/60">Ctrl+S to save</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="default" onClick={onClose} data-testid="button-v5-cancel-proforma">Cancel</Button>
            <Button
              size="default"
              onClick={handleSubmit}
              disabled={createMutation.isPending}
              data-testid="button-v5-create-proforma-submit"
            >
              {createMutation.isPending
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Creating…</>
                : <><Save className="h-4 w-4 mr-2" />{sendToLoading ? `Create + ${n} Container${n !== 1 ? "s" : ""}` : "Create Proforma"}</>}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
