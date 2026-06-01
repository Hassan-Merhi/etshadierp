import { useState, useMemo, createContext, useContext, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useCompany } from "@/contexts/CompanyContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useToast } from "@/hooks/use-toast";
import { Plus, DollarSign, FileEdit, Send, XCircle, ChevronRight, RefreshCw, Pencil, Check, X, Printer, Download, UserCog, ChevronsUpDown, Trash2, ClipboardList, CreditCard, CalendarDays, Wrench, BookOpen } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { format } from "date-fns";
import { PageHeader } from "@/components/PageHeader";

// ── Types ──────────────────────────────────────────────────
type Unit = {
  id: number;
  unitType: string;
  locationGroup: string;
  unitNumber: string;
  size: string | null;
  dimensions: string | null;
  notes: string | null;
  contract: Contract | null;
  outstanding: number | null;
  isShared?: boolean;
  ownerCompanyName?: string | null;
};
type Contract = {
  id: number;
  unitId: number;
  tenantName: string;
  guaranteePeriod: string | null;
  guaranteeAmount: string;
  guaranteePostedAmount: string | null;
  rentalAmount: string;
  startDate: string;
  status: string;
  notes: string | null;
  statementNote: string | null;
  guaranteePostedToStatement: boolean;
  isInternal: boolean;
  linkedCompanyId?: number | null;
  currency: string;
  guaranteeRemaining?: number | null;
};
type CashAccount = { id: number; name: string; code: string; accountType: string };
type LedgerRow = { id: number; year: number; month: number; expectedAmount: string; paidAmount: string; notes?: string | null; accrualVoucherId?: number | null };
type Payment = { id: number; amount: string; paymentDate: string; forYear: number; forMonth: number; cashAccountId: number | null; notes: string | null };

const MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CURRENCIES = ["USD", "EUR", "CFA"] as const;

function currencySymbol(currency: string): string {
  if (currency === "EUR") return "€";
  if (currency === "CFA" || currency === "XAF" || currency === "XOF") return "FC ";
  return "$";
}

function fmtMoneyCurrency(v: string | number | null | undefined, currency = "USD"): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  const isCFA = currency === "CFA" || currency === "XAF" || currency === "XOF";
  const formatted = n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: isCFA ? 0 : 2,
  });
  return `${currencySymbol(currency)}${formatted}`;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
function billingDayLabel(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    const day = d.getUTCDate();
    return `${ordinal(day)} of each month`;
  } catch { return null; }
}
const fmtMoney = (v: string | number | null | undefined) => {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};

// ── Context (avoids prop-drilling apiBase through every sub-component) ──
const ApiBaseCtx = createContext<string>("/api/properties/rental");
const useApiBase = () => useContext(ApiBaseCtx);

// ── Inline Note Cell ─────────────────────────────────────
function NoteCell({ contractId, note, testId }: { contractId: number; note: string | null; testId: string }) {
  const apiBase = useApiBase();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(note ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) {
      setValue(note ?? "");
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, [editing, note]);

  const save = useMutation({
    mutationFn: () => apiRequest("PATCH", `${apiBase}/contracts/${contractId}/note`, { notes: value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [apiBase + "/units"] });
      setEditing(false);
      toast({ title: "Note saved" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (editing) {
    return (
      <div
        className="flex flex-col gap-1 min-w-[160px]"
        onClick={e => e.stopPropagation()}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          rows={3}
          className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder="Add a note…"
          data-testid={`${testId}-note-input`}
        />
        <div className="flex gap-1">
          <Button
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => save.mutate()}
            disabled={save.isPending}
            data-testid={`${testId}-note-save`}
          >
            <Check className="h-3 w-3 mr-1" />
            {save.isPending ? "Saving…" : "Save"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            onClick={() => setEditing(false)}
            data-testid={`${testId}-note-cancel`}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="group flex items-start gap-1 cursor-pointer min-w-[100px] max-w-[220px]"
      onClick={e => { e.stopPropagation(); setEditing(true); }}
      data-testid={`${testId}-note-display`}
    >
      {note ? (
        <span className="text-xs text-foreground leading-snug line-clamp-2 whitespace-pre-wrap">{note}</span>
      ) : (
        <span className="text-xs text-muted-foreground italic">Add note…</span>
      )}
      <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0 mt-0.5 transition-opacity" />
    </div>
  );
}

// ── Props ──────────────────────────────────────────────────
interface Props {
  unitType: "WAREHOUSE" | "SHOP";
  pageTitle: string;
  pageIcon: React.ReactNode;
  testIdPrefix: string;
  apiBase?: string;
  paymentsLogUrl?: string;
}

export default function PropertyRentalPage({ unitType, pageTitle, pageIcon, testIdPrefix, apiBase = "/api/properties/rental", paymentsLogUrl }: Props) {
  const { selectedCompany } = useCompany();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [openUnitId, setOpenUnitId] = useState<number | null>(null);
  const [createUnitOpen, setCreateUnitOpen] = useState(false);
  const [confirmDeleteUnitId, setConfirmDeleteUnitId] = useState<number | null>(null);

  const { data: units = [], isLoading } = useQuery<Unit[]>({
    queryKey: [apiBase + "/units", { unitType, companyId: selectedCompany?.id }],
    queryFn: async () => {
      const res = await fetch(`${apiBase}/units?unitType=${unitType}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load units");
      return res.json();
    },
    enabled: !!selectedCompany,
  });

  const { data: cashAccounts = [] } = useQuery<CashAccount[]>({
    queryKey: [apiBase + "/cash-accounts", selectedCompany?.id],
    queryFn: async () => {
      const res = await fetch(`${apiBase}/cash-accounts`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load cash accounts");
      return res.json();
    },
    enabled: !!selectedCompany,
  });

  const grouped = useMemo(() => {
    const groups = new Map<string, Unit[]>();
    units.forEach(u => {
      if (!groups.has(u.locationGroup)) groups.set(u.locationGroup, []);
      groups.get(u.locationGroup)!.push(u);
    });
    const naturalCmp = (a: string, b: string) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
    return Array.from(groups.entries())
      .sort(([a], [b]) => naturalCmp(a, b))
      .map(([grp, us]) => [grp, [...us].sort((a, b) => naturalCmp(a.unitNumber, b.unitNumber))] as [string, Unit[]]);
  }, [units]);

  const totals = useMemo(() => {
    let totalGuarantee = 0, totalOutstanding = 0, totalPaid = 0, totalMonthlyRent = 0;
    units.forEach(u => {
      if (u.contract) {
        totalGuarantee += (u as any).guaranteeRemaining ?? Number(u.contract.guaranteeAmount || 0);
        totalOutstanding += u.outstanding ?? 0;
        totalPaid += (u as any).totalPaid ?? 0;
        if (u.contract.status === "ACTIVE" || !(u.contract as any).status) {
          totalMonthlyRent += Number(u.contract.rentalAmount || 0);
        }
      }
    });
    return { totalGuarantee, totalOutstanding, totalPaid, totalMonthlyRent };
  }, [units]);

  const runMonthly = useMutation({
    mutationFn: () => apiRequest("POST", apiBase + "/run-monthly"),
    onSuccess: () => {
      toast({ title: "Monthly ledger updated" });
      queryClient.invalidateQueries({ queryKey: [apiBase + "/units"] });
    },
  });

  const postAccrual = useMutation({
    mutationFn: () => apiRequest("POST", apiBase + "/accrue"),
    onSuccess: (data: any) => {
      const n = data?.accrued ?? 0;
      toast({
        title: n > 0 ? `${n} accrual${n !== 1 ? "s" : ""} posted` : "Nothing to accrue",
        description: n > 0 ? "Journal vouchers created: Dr Rent Expense / Cr Accrued Rent Payable" : "All due months are already accrued or paid.",
      });
      queryClient.invalidateQueries({ queryKey: [apiBase + "/units"] });
    },
    onError: (e: any) => toast({ title: "Accrual failed", description: e.message, variant: "destructive" }),
  });

  const deleteUnit = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `${apiBase}/units/${id}`),
    onSuccess: () => {
      toast({ title: "Unit deleted" });
      queryClient.invalidateQueries({ queryKey: [apiBase + "/units"] });
      setConfirmDeleteUnitId(null);
    },
    onError: (e: any) => {
      toast({ title: "Cannot delete", description: e.message, variant: "destructive" });
      setConfirmDeleteUnitId(null);
    },
  });

  const openUnit = units.find(u => u.id === openUnitId) ?? null;
  const confirmDeleteUnit = confirmDeleteUnitId ? units.find(u => u.id === confirmDeleteUnitId) ?? null : null;

  // ── Bulk payment selection state ──────────────────────────
  const [selectedContractIds, setSelectedContractIds] = useState<Set<number>>(new Set());
  const [bulkPayOpen, setBulkPayOpen] = useState(false);

  const contractedUnits = useMemo(() => units.filter(u => u.contract && !u.isShared), [units]);

  const toggleSelect = (contractId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedContractIds(prev => {
      const next = new Set(prev);
      if (next.has(contractId)) next.delete(contractId); else next.add(contractId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedContractIds.size === contractedUnits.length) {
      setSelectedContractIds(new Set());
    } else {
      setSelectedContractIds(new Set(contractedUnits.map(u => u.contract!.id)));
    }
  };

  const selectedUnits = useMemo(
    () => units.filter(u => u.contract && selectedContractIds.has(u.contract.id)),
    [units, selectedContractIds]
  );

  return (
    <ApiBaseCtx.Provider value={apiBase}>
      <div className="p-4 space-y-4" data-testid={`page-${testIdPrefix}`}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            {pageIcon}
            <div>
              <PageHeader title={pageTitle} subtitle="Click any unit to manage payments, modify rent, post guarantee, or end the contract." />
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {selectedContractIds.size > 0 && (
              <Button size="sm" onClick={() => setBulkPayOpen(true)} data-testid={`button-${testIdPrefix}-bulk-pay`}>
                <CreditCard className="h-4 w-4 mr-1" />
                Pay Selected ({selectedContractIds.size})
              </Button>
            )}
            {paymentsLogUrl && (
              <Button variant="outline" size="sm" onClick={() => navigate(paymentsLogUrl)} data-testid={`button-${testIdPrefix}-payments-log`}>
                <ClipboardList className="h-4 w-4 mr-1" />
                Payments Log
              </Button>
            )}
            {apiBase === "/api/erp/rental" && unitType === "SHOP" && (
              <Button variant="outline" size="sm" onClick={() => postAccrual.mutate()} disabled={postAccrual.isPending} data-testid={`button-${testIdPrefix}-post-accrual`}>
                <BookOpen className={`h-4 w-4 mr-1 ${postAccrual.isPending ? "animate-pulse" : ""}`} />
                {postAccrual.isPending ? "Accruing…" : "Post Accrual"}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => runMonthly.mutate()} disabled={runMonthly.isPending} data-testid={`button-${testIdPrefix}-run-monthly`}>
              <RefreshCw className={`h-4 w-4 mr-1 ${runMonthly.isPending ? "animate-spin" : ""}`} />
              Run Monthly Update
            </Button>
            <Button onClick={() => setCreateUnitOpen(true)} size="sm" data-testid={`button-${testIdPrefix}-add-unit`}>
              <Plus className="h-4 w-4 mr-1" />
              Add {unitType === "WAREHOUSE" ? "Warehouse" : "Shop"}
            </Button>
          </div>
        </div>

        {/* Summary tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground font-normal">TOTAL UNITS</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-bold" data-testid={`stat-${testIdPrefix}-total-units`}>{units.length}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground font-normal">RENT / MONTH</CardTitle></CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400" data-testid={`stat-${testIdPrefix}-monthly-rent`}>
                ${fmtMoney(totals.totalMonthlyRent)}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">expected from active leases</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground font-normal">TOTAL GUARANTEE</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-bold" data-testid={`stat-${testIdPrefix}-total-guarantee`}>${fmtMoney(totals.totalGuarantee)}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground font-normal">TOTAL PAID</CardTitle></CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${totals.totalPaid > 0 ? "text-green-600 dark:text-green-400" : ""}`} data-testid={`stat-${testIdPrefix}-total-paid`}>
                ${fmtMoney(totals.totalPaid)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground font-normal">TOTAL OUTSTANDING</CardTitle></CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${totals.totalOutstanding > 0 ? "text-red-600 dark:text-red-400" : totals.totalOutstanding < 0 ? "text-green-600 dark:text-green-400" : ""}`} data-testid={`stat-${testIdPrefix}-total-outstanding`}>
                ${fmtMoney(Math.abs(totals.totalOutstanding))}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">red = owed · green = credit</p>
            </CardContent>
          </Card>
        </div>

        {/* Main table */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-280px)]">
              {isLoading ? (
                <div className="p-8 text-center text-muted-foreground">Loading units…</div>
              ) : grouped.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">No {unitType === "WAREHOUSE" ? "warehouses" : "shops"} yet. Add your first unit above.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-b sticky top-0 z-30">
                    <tr>
                      <th className="px-3 py-2 w-8" onClick={e => e.stopPropagation()}>
                        <Checkbox
                          checked={contractedUnits.length > 0 && selectedContractIds.size === contractedUnits.length}
                          onCheckedChange={toggleSelectAll}
                          data-testid={`checkbox-${testIdPrefix}-select-all`}
                          aria-label="Select all"
                        />
                      </th>
                      <th className="text-left px-3 py-2 font-semibold">Unit</th>
                      <th className="text-left px-3 py-2 font-semibold">Dimensions</th>
                      <th className="text-left px-3 py-2 font-semibold">Tenant</th>
                      <th className="text-left px-3 py-2 font-semibold">Note</th>
                      <th className="text-right px-3 py-2 font-semibold">Monthly Rent</th>
                      <th className="text-right px-3 py-2 font-semibold">Guarantee</th>
                      <th className="text-right px-3 py-2 font-semibold">Outstanding</th>
                      <th className="text-left px-3 py-2 font-semibold">Start</th>
                      <th className="px-2 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {grouped.map(([group, groupUnits], gIdx) => {
                      const GROUP_PALETTE = [
                        { headerBg: "#1d4ed8", headerText: "#fff", r: 29,  g: 78,  b: 216 },
                        { headerBg: "#047857", headerText: "#fff", r: 4,   g: 120, b: 87  },
                        { headerBg: "#7c3aed", headerText: "#fff", r: 124, g: 58,  b: 237 },
                        { headerBg: "#b45309", headerText: "#fff", r: 180, g: 83,  b: 9   },
                        { headerBg: "#be123c", headerText: "#fff", r: 190, g: 18,  b: 60  },
                        { headerBg: "#0e7490", headerText: "#fff", r: 14,  g: 116, b: 144 },
                        { headerBg: "#c2410c", headerText: "#fff", r: 194, g: 65,  b: 12  },
                        { headerBg: "#4d7c0f", headerText: "#fff", r: 77,  g: 124, b: 15  },
                      ];
                      const p = GROUP_PALETTE[gIdx % GROUP_PALETTE.length];
                      const rowBgEven = `rgba(${p.r},${p.g},${p.b},0.06)`;
                      const rowBgOdd  = `rgba(${p.r},${p.g},${p.b},0.12)`;
                      const unitNumBg = `rgba(${p.r},${p.g},${p.b},0.18)`;
                      const unitNumColor = p.headerBg;
                      return (
                      <>
                        <tr key={`grp-${group}`} className="border-t">
                          <td colSpan={10} className="px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-center" style={{ backgroundColor: p.headerBg, color: p.headerText }}>{group}</td>
                        </tr>
                        {groupUnits.map((u, uIdx) => (
                          <tr
                            key={u.id}
                            className="border-t cursor-pointer transition-colors"
                            style={{ backgroundColor: uIdx % 2 === 0 ? rowBgEven : rowBgOdd }}
                            onMouseEnter={e => (e.currentTarget.style.filter = "brightness(0.93)")}
                            onMouseLeave={e => (e.currentTarget.style.filter = "")}
                            onClick={() => setOpenUnitId(u.id)}
                            data-testid={`row-unit-${u.id}`}
                          >
                            <td className="px-3 py-2 w-8" onClick={e => e.stopPropagation()}>
                              {u.contract && !u.isShared && (
                                <Checkbox
                                  checked={selectedContractIds.has(u.contract.id)}
                                  onCheckedChange={() => toggleSelect(u.contract!.id, { stopPropagation: () => {} } as any)}
                                  onClick={e => e.stopPropagation()}
                                  data-testid={`checkbox-unit-${u.id}`}
                                  aria-label={`Select ${u.unitNumber}`}
                                />
                              )}
                            </td>
                            <td className="px-3 py-2 font-mono text-xs font-bold" style={{ backgroundColor: unitNumBg, color: unitNumColor }}>{u.unitNumber}</td>
                            <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                              {u.dimensions
                                ? <span className="font-medium text-foreground">{u.dimensions}</span>
                                : u.size
                                  ? <span>{u.size}</span>
                                  : <span>—</span>}
                            </td>
                            <td className="px-3 py-2">
                              {u.contract
                                ? <span className="font-medium flex items-center gap-1.5 flex-wrap">
                                    {u.contract.tenantName}
                                    {u.contract.isInternal && <Badge className="text-xs bg-violet-600 text-white">Internal</Badge>}
                                    {u.isShared && (
                                      <Badge className="text-xs bg-sky-600 text-white" title={u.ownerCompanyName ? `From: ${u.ownerCompanyName}` : undefined}>
                                        Shared
                                      </Badge>
                                    )}
                                  </span>
                                : <Badge variant="secondary" className="text-xs">Vacant</Badge>}
                            </td>
                            <td className="px-3 py-2">
                              {u.contract
                                ? <NoteCell contractId={u.contract.id} note={u.contract.notes} testId={`unit-${u.id}`} />
                                : <span className="text-xs text-muted-foreground">—</span>}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {u.contract ? fmtMoneyCurrency(u.contract.rentalAmount, u.contract.currency) : "—"}
                            </td>
                            <td className={`px-3 py-2 text-right tabular-nums font-semibold ${
                              u.contract && Number(u.contract.guaranteeAmount) > 0
                                ? u.contract.guaranteePostedToStatement
                                  ? "text-green-600 dark:text-green-400"
                                  : "text-red-600 dark:text-red-400"
                                : "text-muted-foreground"
                            }`}>
                              {u.contract
                                ? fmtMoneyCurrency(
                                    (u as any).guaranteeRemaining ?? u.contract.guaranteeAmount,
                                    u.contract.currency,
                                  )
                                : "—"}
                            </td>
                            <td className={`px-3 py-2 text-right tabular-nums font-semibold ${(u.outstanding ?? 0) > 0 ? "text-red-600 dark:text-red-400" : (u.outstanding ?? 0) < 0 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
                              {u.outstanding !== null ? fmtMoneyCurrency(Math.abs(u.outstanding), u.contract?.currency) : "—"}
                            </td>
                            <td className="px-3 py-2 text-xs text-muted-foreground">
                              {u.contract ? format(new Date(u.contract.startDate), "dd MMM yyyy") : "—"}
                            </td>
                            <td className="px-2 py-2 text-right" onClick={e => e.stopPropagation()}>
                              <div className="flex items-center justify-end gap-1">
                                {!u.isShared && (
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="text-muted-foreground hover:text-destructive"
                                    onClick={e => { e.stopPropagation(); setConfirmDeleteUnitId(u.id); }}
                                    data-testid={`button-delete-unit-${u.id}`}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                )}
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              </div>
                            </td>
                          </tr>
                        ))}
                      </>
                    );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </CardContent>
        </Card>

        {bulkPayOpen && selectedUnits.length > 0 && (
          <BulkPaymentDialog
            units={selectedUnits}
            cashAccounts={cashAccounts}
            testIdPrefix={testIdPrefix}
            onClose={() => setBulkPayOpen(false)}
            onSuccess={() => setSelectedContractIds(new Set())}
          />
        )}

        {openUnit && (
          <UnitActionDialog
            unit={openUnit}
            cashAccounts={cashAccounts}
            onClose={() => setOpenUnitId(null)}
            unitType={unitType}
            testIdPrefix={testIdPrefix}
          />
        )}

        {createUnitOpen && (
          <CreateUnitDialog
            unitType={unitType}
            onClose={() => setCreateUnitOpen(false)}
            testIdPrefix={testIdPrefix}
          />
        )}

        {/* Confirm delete unit dialog */}
        {confirmDeleteUnit && (
          <Dialog open onOpenChange={(o) => !o && setConfirmDeleteUnitId(null)}>
            <DialogContent data-testid={`dialog-${testIdPrefix}-confirm-delete`}>
              <DialogHeader>
                <DialogTitle>Delete Unit {confirmDeleteUnit.unitNumber}?</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                This will permanently remove unit <span className="font-semibold text-foreground">{confirmDeleteUnit.unitNumber}</span> from the list.
                {confirmDeleteUnit.contract
                  ? <span className="block mt-1 text-destructive font-medium">This unit has an active contract — end it first before deleting.</span>
                  : <span className="block mt-1">The unit is currently vacant and can be safely deleted.</span>}
              </p>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmDeleteUnitId(null)}>Cancel</Button>
                <Button
                  variant="destructive"
                  onClick={() => deleteUnit.mutate(confirmDeleteUnit.id)}
                  disabled={deleteUnit.isPending || !!confirmDeleteUnit.contract}
                  data-testid={`button-${testIdPrefix}-confirm-delete-submit`}
                >
                  {deleteUnit.isPending ? "Deleting…" : "Delete Unit"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </ApiBaseCtx.Provider>
  );
}

// ──────────────────────────────────────────────────────────
// CREATE UNIT DIALOG
// ──────────────────────────────────────────────────────────
function CreateUnitDialog({ unitType, onClose, testIdPrefix }: { unitType: "WAREHOUSE" | "SHOP"; onClose: () => void; testIdPrefix: string }) {
  const apiBase = useApiBase();
  const { toast } = useToast();
  const [form, setForm] = useState({ unitNumber: "", locationGroup: "", size: "", dimensions: "", notes: "" });

  const create = useMutation({
    mutationFn: () => apiRequest("POST", apiBase + "/units", { ...form, unitType }),
    onSuccess: () => {
      toast({ title: "Unit created" });
      queryClient.invalidateQueries({ queryKey: [apiBase + "/units"] });
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid={`dialog-${testIdPrefix}-create`}>
        <DialogHeader><DialogTitle>Add New {unitType === "WAREHOUSE" ? "Warehouse" : "Shop"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Unit # *</Label>
            <Input value={form.unitNumber} onChange={e => setForm(f => ({ ...f, unitNumber: e.target.value }))} placeholder="e.g. KOLWEZI A1" data-testid={`input-${testIdPrefix}-unit-number`} />
          </div>
          <div>
            <Label>Location Group *</Label>
            <Input value={form.locationGroup} onChange={e => setForm(f => ({ ...f, locationGroup: e.target.value.toUpperCase() }))} placeholder="e.g. KOLWEZI / LSHI / KIWELE" data-testid={`input-${testIdPrefix}-location`} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Size</Label>
              <Input value={form.size} onChange={e => setForm(f => ({ ...f, size: e.target.value }))} placeholder="420 m²" data-testid={`input-${testIdPrefix}-size`} />
            </div>
            <div>
              <Label>Dimensions</Label>
              <Input value={form.dimensions} onChange={e => setForm(f => ({ ...f, dimensions: e.target.value }))} placeholder="35 X 12" data-testid={`input-${testIdPrefix}-dim`} />
            </div>
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} data-testid={`input-${testIdPrefix}-notes`} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={!form.unitNumber || !form.locationGroup || create.isPending} data-testid={`button-${testIdPrefix}-create-submit`}>
            {create.isPending ? "Saving…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────
// UNIT ACTION DIALOG (4 tabs + ledger)
// ──────────────────────────────────────────────────────────
function UnitActionDialog({ unit, cashAccounts, onClose, unitType, testIdPrefix }: {
  unit: Unit; cashAccounts: CashAccount[]; onClose: () => void; unitType: "WAREHOUSE" | "SHOP"; testIdPrefix: string;
}) {
  const apiBase = useApiBase();
  const { data: detail, isLoading } = useQuery<{ unit: Unit; contract: Contract | null; ledger: LedgerRow[]; payments: Payment[]; guaranteePayments: Payment[]; pastContracts: Contract[]; isShared?: boolean }>({
    queryKey: [apiBase + "/units", unit.id, "detail"],
    queryFn: async () => {
      const res = await fetch(`${apiBase}/units/${unit.id}/detail`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load unit detail");
      return res.json();
    },
  });

  const contract = detail?.contract ?? unit.contract;
  const isShared = unit.isShared || detail?.isShared;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" data-testid={`dialog-${testIdPrefix}-actions`}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline">{unit.unitNumber}</Badge>
            {contract && <span className="text-base font-normal text-muted-foreground">— {contract.tenantName}</span>}
            {!contract && <Badge variant="secondary">Vacant</Badge>}
            {isShared && (
              <Badge className="bg-sky-600 text-white text-xs">
                Shared from {unit.ownerCompanyName ?? "another company"}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="p-6 text-center text-muted-foreground">Loading…</div>
        ) : !contract ? (
          isShared ? (
            <div className="p-6 text-center text-muted-foreground text-sm">This is a read-only shared unit.</div>
          ) : (
            <Tabs defaultValue="contract" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="info" data-testid={`tab-${testIdPrefix}-unit-info`}><UserCog className="h-4 w-4 mr-1" />Edit Info</TabsTrigger>
                <TabsTrigger value="contract" data-testid={`tab-${testIdPrefix}-new-contract`}><Plus className="h-4 w-4 mr-1" />New Contract</TabsTrigger>
              </TabsList>
              <TabsContent value="info">
                <VacantUnitInfoForm unit={unit} testIdPrefix={testIdPrefix} />
              </TabsContent>
              <TabsContent value="contract">
                <StartContractForm unitId={unit.id} testIdPrefix={testIdPrefix} onClose={onClose} unitType={unitType} />
              </TabsContent>
            </Tabs>
          )
        ) : isShared ? (
          <Tabs defaultValue="ledger" className="w-full">
            <TabsList className="grid w-full grid-cols-1">
              <TabsTrigger value="ledger" data-testid={`tab-${testIdPrefix}-ledger`}>Statement (Read-only)</TabsTrigger>
            </TabsList>
            <TabsContent value="ledger">
              <LedgerView
                ledger={detail?.ledger ?? []}
                payments={detail?.payments ?? []}
                guaranteePayments={detail?.guaranteePayments ?? []}
                contract={contract}
                unitId={unit.id}
                readOnly
              />
            </TabsContent>
          </Tabs>
        ) : (
          <Tabs defaultValue="payment" className="w-full">
            <TabsList className="grid w-full grid-cols-6">
              <TabsTrigger value="payment" data-testid={`tab-${testIdPrefix}-payment`}><DollarSign className="h-4 w-4 mr-1" />Payment</TabsTrigger>
              <TabsTrigger value="ledger" data-testid={`tab-${testIdPrefix}-ledger`}>Statement</TabsTrigger>
              <TabsTrigger value="edit" data-testid={`tab-${testIdPrefix}-edit`}><UserCog className="h-4 w-4 mr-1" />Edit Info</TabsTrigger>
              <TabsTrigger value="modify" data-testid={`tab-${testIdPrefix}-modify`}><FileEdit className="h-4 w-4 mr-1" />Modify Rent</TabsTrigger>
              <TabsTrigger value="guarantee" data-testid={`tab-${testIdPrefix}-guarantee`}><Send className="h-4 w-4 mr-1" />Guarantee</TabsTrigger>
              <TabsTrigger value="end" data-testid={`tab-${testIdPrefix}-end`}><XCircle className="h-4 w-4 mr-1" />End Contract</TabsTrigger>
            </TabsList>
            <TabsContent value="payment">
              <PaymentForm contract={contract} cashAccounts={cashAccounts} testIdPrefix={testIdPrefix} unitId={unit.id} />
            </TabsContent>
            <TabsContent value="ledger">
              <LedgerView
                ledger={detail?.ledger ?? []}
                payments={detail?.payments ?? []}
                guaranteePayments={detail?.guaranteePayments ?? []}
                contract={contract}
                unitId={unit.id}
                onNoteUpdated={() => queryClient.invalidateQueries({ queryKey: [apiBase + "/units", unit.id, "detail"] })}
              />
            </TabsContent>
            <TabsContent value="edit">
              <EditInfoForm contract={contract} testIdPrefix={testIdPrefix} unitId={unit.id} unit={unit} unitType={unitType} />
            </TabsContent>
            <TabsContent value="modify">
              <ModifyRentForm contract={contract} testIdPrefix={testIdPrefix} unitId={unit.id} />
            </TabsContent>
            <TabsContent value="guarantee">
              <GuaranteeForm contract={contract} cashAccounts={cashAccounts} testIdPrefix={testIdPrefix} unitId={unit.id} payments={detail?.payments ?? []} />
            </TabsContent>
            <TabsContent value="end">
              <EndContractForm contract={contract} cashAccounts={cashAccounts} testIdPrefix={testIdPrefix} onClose={onClose} unitId={unit.id} />
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────
// START CONTRACT (vacant unit)
// ──────────────────────────────────────────────────────────
function VacantUnitInfoForm({ unit, testIdPrefix }: { unit: Unit; testIdPrefix: string }) {
  const apiBase = useApiBase();
  const { toast } = useToast();
  const [unitNumber, setUnitNumber] = useState(unit.unitNumber);
  const [dimensions, setDimensions] = useState(unit.dimensions ?? "");

  const saveUnit = useMutation({
    mutationFn: () => apiRequest("PATCH", `${apiBase}/units/${unit.id}`, { unitNumber, dimensions: dimensions || null }),
    onSuccess: () => {
      toast({ title: "Unit info updated" });
      queryClient.invalidateQueries({ queryKey: [apiBase + "/units"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const changed = unitNumber !== unit.unitNumber || dimensions !== (unit.dimensions ?? "");

  return (
    <div className="space-y-4 pt-3">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Unit Name</Label>
          <Input value={unitNumber} onChange={e => setUnitNumber(e.target.value.toUpperCase())} data-testid={`input-${testIdPrefix}-vacant-unit-number`} />
        </div>
        <div>
          <Label>Dimensions</Label>
          <Input value={dimensions} onChange={e => setDimensions(e.target.value)} placeholder="e.g. 35 X 12" data-testid={`input-${testIdPrefix}-vacant-dimensions`} />
        </div>
      </div>
      <div className="flex justify-end">
        <Button onClick={() => saveUnit.mutate()} disabled={!changed || !unitNumber || saveUnit.isPending} data-testid={`button-${testIdPrefix}-save-vacant-unit`}>
          {saveUnit.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

function StartContractForm({ unitId, testIdPrefix, onClose, unitType }: { unitId: number; testIdPrefix: string; onClose: () => void; unitType: "WAREHOUSE" | "SHOP" }) {
  const apiBase = useApiBase();
  const { toast } = useToast();
  const [form, setForm] = useState({
    tenantName: "", rentalAmount: "", guaranteeAmount: "",
    guaranteePeriod: "", startDate: new Date().toISOString().slice(0, 10), notes: "",
    currency: "USD",
  });
  const [isInternal, setIsInternal] = useState(false);

  const start = useMutation({
    mutationFn: () => apiRequest("POST", apiBase + "/contracts", { ...form, unitId, isInternal }),
    onSuccess: () => {
      toast({ title: "Contract started" });
      queryClient.invalidateQueries({ queryKey: [apiBase + "/units"] });
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">This unit is vacant. Start a new lease:</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Tenant Name *</Label>
          <Input value={form.tenantName} onChange={e => setForm(f => ({ ...f, tenantName: e.target.value }))} data-testid={`input-${testIdPrefix}-tenant-name`} />
        </div>
        <div>
          <Label>Start Date *</Label>
          <Input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} data-testid={`input-${testIdPrefix}-start-date`} />
          {form.startDate && (
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <CalendarDays className="h-3 w-3 shrink-0" />
              Charges on the {billingDayLabel(form.startDate)}
            </p>
          )}
        </div>
        <div>
          <Label>Currency</Label>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            value={form.currency}
            onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}
            data-testid={`select-${testIdPrefix}-contract-currency`}
          >
            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <Label>Monthly Rental Amount *</Label>
          <Input type="number" step="0.01" value={form.rentalAmount} onChange={e => setForm(f => ({ ...f, rentalAmount: e.target.value }))} data-testid={`input-${testIdPrefix}-rental-amount`} />
        </div>
        <div>
          <Label>Guarantee Amount</Label>
          <Input type="number" step="0.01" value={form.guaranteeAmount} onChange={e => setForm(f => ({ ...f, guaranteeAmount: e.target.value }))} data-testid={`input-${testIdPrefix}-guarantee-amount`} />
        </div>
        <div>
          <Label>Guarantee Period</Label>
          <Input value={form.guaranteePeriod} onChange={e => setForm(f => ({ ...f, guaranteePeriod: e.target.value }))} placeholder="e.g. 3 MONTHS" data-testid={`input-${testIdPrefix}-guarantee-period`} />
        </div>
        <div className="col-span-2">
          <Label>Notes</Label>
          <Textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} data-testid={`input-${testIdPrefix}-contract-notes`} />
        </div>
        {unitType === "WAREHOUSE" && (
          <div className="col-span-2 flex items-center gap-3 rounded-md border p-3 bg-violet-50 dark:bg-violet-950/20">
            <Switch
              id={`switch-${testIdPrefix}-internal`}
              checked={isInternal}
              onCheckedChange={setIsInternal}
              data-testid={`switch-${testIdPrefix}-internal`}
            />
            <div>
              <Label htmlFor={`switch-${testIdPrefix}-internal`} className="font-semibold cursor-pointer">Internal Lease</Label>
              <p className="text-xs text-muted-foreground mt-0.5">This warehouse is occupied by your own company. It will also appear in Shops Rented for tracking.</p>
            </div>
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => start.mutate()} disabled={!form.tenantName || !form.rentalAmount || start.isPending} data-testid={`button-${testIdPrefix}-start-contract`}>
          {start.isPending ? "Starting…" : "Start Contract"}
        </Button>
      </DialogFooter>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// REUSABLE: ACCOUNT SEARCH SELECT
// ──────────────────────────────────────────────────────────
function AccountSearchSelect({ accounts, value, onChange, placeholder, testId }: {
  accounts: CashAccount[]; value: string; onChange: (v: string) => void; placeholder?: string; testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = accounts.find(a => String(a.id) === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-between font-normal" data-testid={testId}>
          {selected ? (
            <span className="truncate">{selected.name} <span className="text-xs text-muted-foreground">({selected.accountType})</span></span>
          ) : (
            <span className="text-muted-foreground">{placeholder ?? "Select account…"}</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search accounts…" />
          <CommandList>
            <CommandEmpty>No accounts found.</CommandEmpty>
            {accounts.map(a => (
              <CommandItem key={a.id} value={`${a.name} ${a.accountType}`} onSelect={() => { onChange(String(a.id)); setOpen(false); }}>
                <span className="flex-1 truncate">{a.name}</span>
                <span className="text-xs text-muted-foreground ml-2">{a.accountType}</span>
                {String(a.id) === value && <Check className="ml-2 h-4 w-4 shrink-0" />}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ──────────────────────────────────────────────────────────
// BULK PAYMENT DIALOG
// ──────────────────────────────────────────────────────────
function BulkPaymentDialog({
  units,
  cashAccounts,
  testIdPrefix,
  onClose,
  onSuccess,
}: {
  units: Unit[];
  cashAccounts: CashAccount[];
  testIdPrefix: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const apiBase = useApiBase();
  const { toast } = useToast();

  const today = new Date().toISOString().slice(0, 10);
  const [paymentDate, setPaymentDate] = useState(today);
  const [cashAccountId, setCashAccountId] = useState("");
  const [notes, setNotes] = useState("");
  // Per-unit amounts, defaulting to their outstanding (min 0)
  const [amounts, setAmounts] = useState<Record<number, string>>(() => {
    const init: Record<number, string> = {};
    units.forEach(u => {
      const outstanding = u.outstanding ?? 0;
      init[u.contract!.id] = outstanding > 0 ? String(outstanding) : "";
    });
    return init;
  });

  const totalSelected = useMemo(() => {
    return Object.values(amounts).reduce((sum, v) => sum + (parseFloat(v) || 0), 0);
  }, [amounts]);

  const bulkPay = useMutation({
    mutationFn: () => {
      const items = units
        .filter(u => u.contract && parseFloat(amounts[u.contract.id] || "0") > 0)
        .map(u => ({
          contractId: u.contract!.id,
          cashAccountId: cashAccountId ? parseInt(cashAccountId) : null,
          amount: amounts[u.contract!.id],
          paymentDate,
          notes: notes || undefined,
        }));
      if (items.length === 0) throw new Error("No valid amounts entered");
      return apiRequest("POST", apiBase + "/payments/bulk", items);
    },
    onSuccess: () => {
      toast({ title: "Bulk payment recorded", description: `${units.length} tenant(s) paid` });
      queryClient.invalidateQueries({ queryKey: [apiBase + "/units"] });
      onSuccess();
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const canSubmit = Object.values(amounts).some(v => parseFloat(v) > 0) && !bulkPay.isPending;

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col" data-testid={`dialog-${testIdPrefix}-bulk-pay`}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Bulk Payment — {units.length} Unit{units.length !== 1 ? "s" : ""}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 pt-1">
          <div>
            <Label>Account</Label>
            <AccountSearchSelect
              accounts={cashAccounts}
              value={cashAccountId}
              onChange={setCashAccountId}
              placeholder="Choose account…"
              testId={`select-${testIdPrefix}-bulk-cash`}
            />
          </div>
          <div>
            <Label>Payment Date</Label>
            <Input
              type="date"
              value={paymentDate}
              onChange={e => setPaymentDate(e.target.value)}
              data-testid={`input-${testIdPrefix}-bulk-date`}
            />
          </div>
          <div className="col-span-2">
            <Label>Notes (optional)</Label>
            <Input
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. May 2026 bulk rent collection"
              data-testid={`input-${testIdPrefix}-bulk-notes`}
            />
          </div>
        </div>

        <div className="overflow-auto flex-1 mt-3 rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b sticky top-0">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">Unit</th>
                <th className="text-left px-3 py-2 font-semibold">Tenant</th>
                <th className="text-right px-3 py-2 font-semibold">Monthly Rent</th>
                <th className="text-right px-3 py-2 font-semibold">Outstanding</th>
                <th className="text-right px-3 py-2 font-semibold">Amount to Pay</th>
              </tr>
            </thead>
            <tbody>
              {units.map((u, idx) => {
                const cId = u.contract!.id;
                const outstanding = u.outstanding ?? 0;
                return (
                  <tr key={u.id} className={`border-t ${idx % 2 === 0 ? "" : "bg-muted/30"}`}>
                    <td className="px-3 py-2 font-mono text-xs font-bold">{u.unitNumber}</td>
                    <td className="px-3 py-2">{u.contract!.tenantName}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {fmtMoneyCurrency(u.contract!.rentalAmount, u.contract!.currency)}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums font-semibold ${
                      outstanding > 0 ? "text-red-600 dark:text-red-400" :
                      outstanding < 0 ? "text-green-600 dark:text-green-400" :
                      "text-muted-foreground"
                    }`}>
                      {outstanding !== null ? fmtMoneyCurrency(Math.abs(outstanding), u.contract?.currency) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        className="w-28 text-right ml-auto"
                        value={amounts[cId] ?? ""}
                        onChange={e => setAmounts(prev => ({ ...prev, [cId]: e.target.value }))}
                        data-testid={`input-${testIdPrefix}-bulk-amount-${u.id}`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t bg-muted/50 sticky bottom-0">
              <tr>
                <td colSpan={4} className="px-3 py-2 font-semibold text-right">Total Payment</td>
                <td className="px-3 py-2 text-right font-bold text-lg tabular-nums">
                  ${fmtMoney(totalSelected)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <DialogFooter className="pt-3">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => bulkPay.mutate()}
            disabled={!canSubmit}
            data-testid={`button-${testIdPrefix}-bulk-pay-confirm`}
          >
            {bulkPay.isPending ? "Processing…" : `Confirm Bulk Payment`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────
// TAB 1: PAYMENT
// ──────────────────────────────────────────────────────────
function buildPaymentAllocations(
  totalAmount: number,
  rentalAmount: number,
  paymentDate: string,
): Array<{ year: number; month: number; chunk: number }> {
  if (!totalAmount || !rentalAmount || !paymentDate) return [];
  const pd = new Date(paymentDate);
  let ay = pd.getUTCFullYear(), am = pd.getUTCMonth() + 1;
  const allocations: Array<{ year: number; month: number; chunk: number }> = [];
  let remaining = totalAmount;
  while (remaining > 0.005) {
    const chunk = rentalAmount > 0 ? Math.min(remaining, rentalAmount) : remaining;
    allocations.push({ year: ay, month: am, chunk: Math.round(chunk * 100) / 100 });
    remaining = Math.round((remaining - chunk) * 100) / 100;
    am++; if (am > 12) { am = 1; ay++; }
    if (allocations.length >= 120) break;
  }
  return allocations;
}

function PaymentForm({ contract, cashAccounts, testIdPrefix, unitId }: { contract: Contract; cashAccounts: CashAccount[]; testIdPrefix: string; unitId: number }) {
  const apiBase = useApiBase();
  const { toast } = useToast();
  const [form, setForm] = useState({
    cashAccountId: "" as string,
    amount: "",
    paymentDate: new Date().toISOString().slice(0, 10),
    notes: "",
    currency: contract.currency || "USD",
    exchangeRate: "1",
  });

  const pay = useMutation({
    mutationFn: () => apiRequest("POST", apiBase + "/payments", {
      contractId: contract.id,
      cashAccountId: form.cashAccountId ? parseInt(form.cashAccountId) : null,
      amount: form.amount,
      paymentDate: form.paymentDate,
      notes: form.notes,
      currency: form.currency,
      exchangeRate: form.exchangeRate,
    }),
    onSuccess: () => {
      toast({ title: "Payment recorded" });
      queryClient.invalidateQueries({ queryKey: [apiBase + "/units"] });
      queryClient.invalidateQueries({ queryKey: [apiBase + "/units", unitId, "detail"] });
      setForm(f => ({ ...f, amount: "", notes: "" }));
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const allocations = useMemo(() => {
    const total = parseFloat(form.amount);
    const monthly = parseFloat(contract.rentalAmount);
    if (!total || !monthly || total <= 0) return [];
    return buildPaymentAllocations(total, monthly, form.paymentDate);
  }, [form.amount, form.paymentDate, contract.rentalAmount]);

  const isMultiMonth = allocations.length > 1;

  return (
    <div className="space-y-3 pt-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Account</Label>
          <AccountSearchSelect
            accounts={cashAccounts}
            value={form.cashAccountId}
            onChange={v => setForm(f => ({ ...f, cashAccountId: v }))}
            placeholder="Choose account…"
            testId={`select-${testIdPrefix}-cash-box`}
          />
        </div>
        <div>
          <Label>Payment Date</Label>
          <Input type="date" value={form.paymentDate} onChange={e => setForm(f => ({ ...f, paymentDate: e.target.value }))} data-testid={`input-${testIdPrefix}-payment-date`} />
        </div>
        <div>
          <Label>Currency</Label>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            value={form.currency}
            onChange={e => setForm(f => ({ ...f, currency: e.target.value, exchangeRate: e.target.value === "USD" ? "1" : f.exchangeRate }))}
            data-testid={`select-${testIdPrefix}-payment-currency`}
          >
            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <Label>Amount Received ({form.currency})</Label>
          <Input type="number" step={form.currency === "CFA" ? "1" : "0.01"} value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} data-testid={`input-${testIdPrefix}-payment-amount`} />
        </div>
        {form.currency !== "USD" && (
          <div>
            <Label>Exchange Rate (1 USD = ? {form.currency})</Label>
            <Input type="number" step="0.000001" min="0" value={form.exchangeRate} onChange={e => setForm(f => ({ ...f, exchangeRate: e.target.value }))} data-testid={`input-${testIdPrefix}-exchange-rate`} />
          </div>
        )}
        <div className="col-span-2">
          <Label>Notes</Label>
          <Textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} data-testid={`input-${testIdPrefix}-payment-notes`} />
        </div>
      </div>

      {isMultiMonth && (
        <div className="rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 p-3 space-y-1.5">
          <p className="text-xs font-semibold text-blue-700 dark:text-blue-300">
            Payment will be split across {allocations.length} months
          </p>
          <div className="space-y-1">
            {allocations.map((a, i) => (
              <div key={i} className="flex items-center justify-between text-xs text-blue-800 dark:text-blue-200">
                <span>{MONTH_NAMES[a.month]} {a.year}</span>
                <span className="font-medium">{fmtMoneyCurrency(a.chunk, form.currency)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <DialogFooter>
        <Button onClick={() => pay.mutate()} disabled={!form.amount || pay.isPending} data-testid={`button-${testIdPrefix}-confirm-payment`}>
          {pay.isPending ? "Recording…" : "Confirm Payment"}
        </Button>
      </DialogFooter>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// TAB 2: MODIFY RENT
// ──────────────────────────────────────────────────────────
function ModifyRentForm({ contract, testIdPrefix, unitId }: { contract: Contract; testIdPrefix: string; unitId: number }) {
  const apiBase = useApiBase();
  const { toast } = useToast();
  const [newAmount, setNewAmount] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState<"current" | "next">("next");

  const modify = useMutation({
    mutationFn: () => apiRequest("PATCH", `${apiBase}/contracts/${contract.id}/rent`, { newAmount, effectiveFrom }),
    onSuccess: () => {
      toast({ title: "Rental amount updated" });
      queryClient.invalidateQueries({ queryKey: [apiBase + "/units"] });
      queryClient.invalidateQueries({ queryKey: [apiBase + "/units", unitId, "detail"] });
      setNewAmount("");
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-3 pt-3">
      <div className="bg-muted/40 rounded-md p-3 text-sm">
        <span className="text-muted-foreground">Current Rental Amount: </span>
        <span className="font-bold">{fmtMoneyCurrency(contract.rentalAmount, contract.currency)}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>New Rental Amount ({contract.currency || "USD"}) *</Label>
          <Input type="number" step="0.01" value={newAmount} onChange={e => setNewAmount(e.target.value)} data-testid={`input-${testIdPrefix}-new-rent`} />
        </div>
        <div>
          <Label>Effective From</Label>
          <RadioGroup value={effectiveFrom} onValueChange={v => setEffectiveFrom(v as any)} className="flex gap-4 pt-2">
            <div className="flex items-center gap-1.5"><RadioGroupItem value="current" id={`mc-${contract.id}`} /><Label htmlFor={`mc-${contract.id}`} className="font-normal cursor-pointer">Current Month</Label></div>
            <div className="flex items-center gap-1.5"><RadioGroupItem value="next" id={`mn-${contract.id}`} /><Label htmlFor={`mn-${contract.id}`} className="font-normal cursor-pointer">Next Month</Label></div>
          </RadioGroup>
        </div>
      </div>
      <p className="text-xs text-muted-foreground italic">Only updates future months that haven't been paid yet.</p>
      <DialogFooter>
        <Button onClick={() => modify.mutate()} disabled={!newAmount || modify.isPending} data-testid={`button-${testIdPrefix}-save-rent`}>
          {modify.isPending ? "Saving…" : "Save New Amount"}
        </Button>
      </DialogFooter>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// TAB 3: GUARANTEE TO STATEMENT
// ──────────────────────────────────────────────────────────
function GuaranteeForm({ contract, cashAccounts, testIdPrefix, unitId, payments }: { contract: Contract; cashAccounts: CashAccount[]; testIdPrefix: string; unitId: number; payments: Payment[] }) {
  const apiBase = useApiBase();
  const { toast } = useToast();
  const tenantPays = apiBase.includes("/erp/") || apiBase.includes("/factory/");

  // Computed balances
  const totalGuarantee = parseFloat(contract.guaranteeAmount || "0");
  const usedAmount = parseFloat(contract.guaranteePostedAmount || "0");
  // remainingGuarantee: used by "Post to Statement" / "Move to Cash" sections only
  const remainingGuarantee = Math.max(0, totalGuarantee - usedAmount);
  const monthlyRent = parseFloat(contract.rentalAmount || "0");

  // Detect if any guarantee-applied payments exist (shows the undo section)
  const guaranteeAppliedPayments = payments.filter(p => (p.notes ?? "").includes("[Guarantee applied]"));
  const hasGuaranteeApplied = guaranteeAppliedPayments.length > 0;
  const guaranteeAppliedTotal = guaranteeAppliedPayments.reduce((s, p) => s + parseFloat(String(p.amount || "0")), 0);

  // remainingForRent: independent of "Post to Statement" — tracks how much of the
  // guarantee has actually been applied as rent via payment records.
  const remainingForRent = Math.max(0, totalGuarantee - guaranteeAppliedTotal);

  // ── Post to Statement state ──
  const [postAmount, setPostAmount] = useState(contract.guaranteeAmount);
  const [postAccountId, setPostAccountId] = useState<string>("");
  const [postDate, setPostDate] = useState(new Date().toISOString().slice(0, 10));
  const [postNotes, setPostNotes] = useState("");

  // ── Move to Cash state ──
  const [moveAmount, setMoveAmount] = useState(remainingGuarantee.toFixed(2));
  const [moveAccountId, setMoveAccountId] = useState<string>("");
  const [moveDate, setMoveDate] = useState(new Date().toISOString().slice(0, 10));
  const [moveNotes, setMoveNotes] = useState("");

  // ── Apply as Rent state ── default to 1 month's rent (or remaining if less)
  const defaultRentChunk = Math.min(monthlyRent, remainingForRent).toFixed(2);
  const [rentAmount, setRentAmount] = useState(defaultRentChunk);
  const [rentDate, setRentDate] = useState(new Date().toISOString().slice(0, 10));
  const [rentNotes, setRentNotes] = useState("");
  const [undoConfirm, setUndoConfirm] = useState(false);

  const rentAmountNum = parseFloat(rentAmount || "0");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [apiBase + "/units"] });
    queryClient.invalidateQueries({ queryKey: [apiBase + "/units", unitId, "detail"] });
  };

  const resetGuarantee = useMutation({
    mutationFn: () => apiRequest("DELETE", `${apiBase}/contracts/${contract.id}/guarantee-to-statement`, {}),
    onSuccess: () => { toast({ title: "Guarantee status reset" }); invalidate(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const post = useMutation({
    mutationFn: () => apiRequest("POST", `${apiBase}/contracts/${contract.id}/guarantee-to-statement`, {
      amount: postAmount,
      cashAccountId: postAccountId ? parseInt(postAccountId) : null,
      paymentDate: postDate,
      notes: postNotes,
    }),
    onSuccess: () => { toast({ title: "Guarantee posted to statement" }); invalidate(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const moveToCash = useMutation({
    mutationFn: () => apiRequest("POST", `${apiBase}/contracts/${contract.id}/guarantee-to-cash`, {
      amount: moveAmount,
      cashAccountId: parseInt(moveAccountId),
      paymentDate: moveDate,
      notes: moveNotes,
    }),
    onSuccess: () => { toast({ title: "Guarantee moved to cash successfully" }); invalidate(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const applyToRent = useMutation({
    mutationFn: () => apiRequest("POST", `${apiBase}/contracts/${contract.id}/guarantee-to-rent`, {
      amount: rentAmount,
      paymentDate: rentDate,
      notes: rentNotes,
    }),
    onSuccess: () => { toast({ title: "Guarantee applied to rent", description: "Rent ledger updated. No cash moved." }); invalidate(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const undoGuaranteeAsRent = useMutation({
    mutationFn: () => apiRequest("POST", `${apiBase}/contracts/${contract.id}/undo-guarantee-as-rent`, {}),
    onSuccess: (data: any) => {
      setUndoConfirm(false);
      toast({ title: "Guarantee reversed", description: `${data.reversed} payment(s) removed. Rent months restored to unpaid.` });
      invalidate();
    },
    onError: (e: any) => { setUndoConfirm(false); toast({ title: "Error", description: e.message, variant: "destructive" }); },
  });

  return (
    <div className="space-y-4 pt-3">
      {/* Info bar */}
      <div className="bg-muted/40 rounded-md p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <span className="text-muted-foreground">Total guarantee:</span>
          <span className="font-bold">{fmtMoneyCurrency(contract.guaranteeAmount, contract.currency)}</span>
          <Badge variant={contract.guaranteePostedToStatement ? "default" : "destructive"} className="text-xs">
            {contract.guaranteePostedToStatement ? "Active" : "Not Posted"}
          </Badge>
          {contract.guaranteePostedToStatement && (
            <Button
              size="sm"
              variant="outline"
              className="ml-auto text-xs"
              disabled={resetGuarantee.isPending}
              onClick={() => resetGuarantee.mutate()}
              data-testid={`button-${testIdPrefix}-guarantee-reset`}
            >
              {resetGuarantee.isPending ? "Resetting…" : "Reset Status"}
            </Button>
          )}
        </div>
        {usedAmount > 0 && (
          <div className="grid grid-cols-3 gap-2 pt-1 border-t border-border/40 text-xs">
            <div>
              <p className="text-muted-foreground">Total</p>
              <p className="font-semibold tabular-nums">{fmtMoneyCurrency(totalGuarantee, contract.currency)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">{hasGuaranteeApplied ? "Applied as rent" : "Used / Posted"}</p>
              <p className="font-semibold tabular-nums text-orange-600 dark:text-orange-400">{fmtMoneyCurrency(usedAmount, contract.currency)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Remaining</p>
              <p className={`font-semibold tabular-nums ${remainingGuarantee <= 0 ? "text-destructive" : "text-green-600 dark:text-green-400"}`}>
                {fmtMoneyCurrency(remainingGuarantee, contract.currency)}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Section 1: Post to Statement ── */}
      <div className="border rounded-md p-3 space-y-3">
        <p className="text-sm font-semibold">{tenantPays ? "Post Guarantee Paid" : "Post Guarantee to Statement"}</p>
        <p className="text-xs text-muted-foreground">
          {tenantPays
            ? <>Records guarantee paid out: Dr Security Deposits Paid / Cr Cash. <span className="font-medium text-amber-600 dark:text-amber-400">Select an account to create an accounting entry — without an account only the status badge is updated.</span></>
            : <>Records guarantee received: Dr Cash / Cr Tenant Deposits. <span className="font-medium text-amber-600 dark:text-amber-400">Select an account to create an accounting entry — without an account only the status badge is updated.</span></>
          }
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Amount ($)</Label>
            <Input type="number" step="0.01" value={postAmount} onChange={e => setPostAmount(e.target.value)} data-testid={`input-${testIdPrefix}-guarantee-post`} />
          </div>
          <div>
            <Label>Date</Label>
            <Input type="date" value={postDate} onChange={e => setPostDate(e.target.value)} data-testid={`input-${testIdPrefix}-guarantee-date`} />
          </div>
          <div className="col-span-2">
            <Label>{tenantPays ? "Cash account (paid from)" : "Account (where deposit is held)"}</Label>
            <AccountSearchSelect accounts={cashAccounts} value={postAccountId} onChange={setPostAccountId} placeholder="Select account…" testId={`select-${testIdPrefix}-guarantee-cash`} />
          </div>
          <div className="col-span-2">
            <Label>Notes</Label>
            <Textarea rows={2} value={postNotes} onChange={e => setPostNotes(e.target.value)} data-testid={`input-${testIdPrefix}-guarantee-notes`} />
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={() => post.mutate()} disabled={!postAmount || post.isPending} data-testid={`button-${testIdPrefix}-post-guarantee`}>
            {post.isPending ? "Posting…" : "Post to Statement"}
          </Button>
        </div>
      </div>

      {/* ── Section 2: Move to Cash ── */}
      <div className="border rounded-md p-3 space-y-3">
        <p className="text-sm font-semibold">{tenantPays ? "Recover Guarantee" : "Move Guarantee to Cash"}</p>
        <p className="text-xs text-muted-foreground">
          {tenantPays
            ? "Recovers guarantee returned by landlord: Dr Cash / Cr Security Deposits Paid"
            : "Releases guarantee from Tenant Deposits: Dr Tenant Deposits / Cr Cash Account"
          }
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Amount ($)</Label>
            <Input type="number" step="0.01" value={moveAmount} onChange={e => setMoveAmount(e.target.value)} data-testid={`input-${testIdPrefix}-guarantee-move-amount`} />
          </div>
          <div>
            <Label>Date</Label>
            <Input type="date" value={moveDate} onChange={e => setMoveDate(e.target.value)} data-testid={`input-${testIdPrefix}-guarantee-move-date`} />
          </div>
          <div className="col-span-2">
            <Label>{tenantPays ? "Cash account (received into)" : "Target Cash Account"}</Label>
            <AccountSearchSelect accounts={cashAccounts} value={moveAccountId} onChange={setMoveAccountId} placeholder="Select cash account…" testId={`select-${testIdPrefix}-guarantee-move-cash`} />
          </div>
          <div className="col-span-2">
            <Label>Notes</Label>
            <Textarea rows={2} value={moveNotes} onChange={e => setMoveNotes(e.target.value)} data-testid={`input-${testIdPrefix}-guarantee-move-notes`} />
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={() => moveToCash.mutate()} disabled={!moveAmount || !moveAccountId || moveToCash.isPending} data-testid={`button-${testIdPrefix}-guarantee-move-cash`}>
            {moveToCash.isPending ? (tenantPays ? "Recovering…" : "Moving…") : (tenantPays ? "Recover to Cash" : "Move to Cash")}
          </Button>
        </div>
      </div>

      {/* ── Section 3: Apply as Rent ── */}
      <div className="border rounded-md p-3 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-sm font-semibold">Apply Guarantee as Rent</p>
          {remainingForRent > 0 && (
            <span className="text-xs text-muted-foreground">
              Remaining to apply: <span className="font-semibold text-green-600 dark:text-green-400">{fmtMoneyCurrency(remainingForRent, contract.currency)}</span>
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {tenantPays
            ? "Covers rent from the deposit — no cash moves. Dr Rent Expense / Cr Security Deposits Paid. Rent ledger marked paid."
            : "Covers rent from the deposit — no cash moves. Dr Tenant Deposits / Cr Rent Income. Rent ledger marked paid."
          }
        </p>
        {remainingForRent <= 0 && (
          <p className="text-xs font-medium text-destructive">Guarantee fully applied as rent — nothing left to apply.</p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label>Amount</Label>
              {remainingForRent > 0 && (
                <button
                  type="button"
                  className="text-xs text-primary underline"
                  onClick={() => setRentAmount(remainingForRent.toFixed(2))}
                  data-testid={`button-${testIdPrefix}-guarantee-rent-max`}
                >
                  Use all remaining
                </button>
              )}
            </div>
            <Input
              type="number"
              step="0.01"
              min="0.01"
              max={remainingForRent}
              value={rentAmount}
              onChange={e => setRentAmount(e.target.value)}
              data-testid={`input-${testIdPrefix}-guarantee-rent-amount`}
            />
            {rentAmountNum > remainingForRent && remainingForRent > 0 && (
              <p className="text-xs text-destructive mt-1">
                Exceeds remaining balance of {fmtMoneyCurrency(remainingForRent, contract.currency)}
              </p>
            )}
          </div>
          <div>
            <Label>Apply from date</Label>
            <Input
              type="date"
              value={rentDate}
              onChange={e => setRentDate(e.target.value)}
              className="mt-1"
              data-testid={`input-${testIdPrefix}-guarantee-rent-date`}
            />
          </div>
          <div className="col-span-2">
            <Label>Notes (optional)</Label>
            <Textarea
              rows={2}
              value={rentNotes}
              onChange={e => setRentNotes(e.target.value)}
              placeholder="e.g. Applied to cover arrears on departure"
              data-testid={`input-${testIdPrefix}-guarantee-rent-notes`}
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            onClick={() => applyToRent.mutate()}
            disabled={!rentAmount || !rentDate || applyToRent.isPending || remainingForRent <= 0 || rentAmountNum > remainingForRent}
            data-testid={`button-${testIdPrefix}-guarantee-apply-rent`}
          >
            {applyToRent.isPending ? "Applying…" : "Apply as Rent"}
          </Button>
        </div>
      </div>

      {/* ── Section 4: Undo Guarantee Applied as Rent (only if it was done) ── */}
      {hasGuaranteeApplied && (
        <div className="border border-destructive/40 rounded-md p-3 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-destructive">Undo: Guarantee Applied as Rent</p>
            <Badge variant="destructive" className="text-xs">
              {guaranteeAppliedPayments.length} payment{guaranteeAppliedPayments.length !== 1 ? "s" : ""} — ${guaranteeAppliedTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            The guarantee was applied toward rent on {guaranteeAppliedPayments.length} month{guaranteeAppliedPayments.length !== 1 ? "s" : ""}.
            Clicking below will reverse all those payments, restore those months to unpaid, and reverse the accounting voucher entries.
            The guarantee deposit itself remains intact.
          </p>
          {!undoConfirm ? (
            <div className="flex justify-end">
              <Button
                variant="destructive"
                onClick={() => setUndoConfirm(true)}
                data-testid={`button-${testIdPrefix}-undo-guarantee-rent`}
              >
                Undo Guarantee as Rent
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 flex-wrap bg-destructive/10 rounded-md p-2">
              <p className="text-xs font-medium text-destructive">
                This will reverse {guaranteeAppliedPayments.length} payment(s) totalling ${guaranteeAppliedTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}. Are you sure?
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setUndoConfirm(false)} disabled={undoGuaranteeAsRent.isPending}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => undoGuaranteeAsRent.mutate()}
                  disabled={undoGuaranteeAsRent.isPending}
                  data-testid={`button-${testIdPrefix}-undo-guarantee-rent-confirm`}
                >
                  {undoGuaranteeAsRent.isPending ? "Reversing…" : "Yes, Reverse"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// TAB 4: END CONTRACT
// ──────────────────────────────────────────────────────────
function EndContractForm({ contract, cashAccounts, testIdPrefix, onClose, unitId }: { contract: Contract; cashAccounts: CashAccount[]; testIdPrefix: string; onClose: () => void; unitId: number }) {
  const apiBase = useApiBase();
  const { toast } = useToast();
  const tenantPays = apiBase.includes("/erp/") || apiBase.includes("/factory/");

  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [confirm, setConfirm] = useState(false);

  // Guarantee refund
  const totalGuarantee = parseFloat(contract.guaranteeAmount || "0");
  const usedAmount = parseFloat(contract.guaranteePostedAmount || "0");
  const remainingGuarantee = Math.max(0, totalGuarantee - usedAmount);
  const hasRemainingGuarantee = remainingGuarantee > 0.005;

  const [refundGuarantee, setRefundGuarantee] = useState(false);
  const [refundAmount, setRefundAmount] = useState(remainingGuarantee.toFixed(2));
  const [refundAccountId, setRefundAccountId] = useState("");
  const [refundNotes, setRefundNotes] = useState("");

  const end = useMutation({
    mutationFn: () => apiRequest("POST", `${apiBase}/contracts/${contract.id}/end`, {
      endDate,
      notes,
      refundGuarantee: refundGuarantee && hasRemainingGuarantee,
      refundAmount: refundGuarantee ? refundAmount : undefined,
      refundCashAccountId: refundGuarantee && refundAccountId ? parseInt(refundAccountId) : null,
      refundNotes: refundGuarantee ? refundNotes : undefined,
    }),
    onSuccess: () => {
      toast({ title: "Contract ended", description: refundGuarantee ? `Unit vacated. Guarantee refund of ${fmtMoneyCurrency(refundAmount, contract.currency)} posted.` : "Unit is now vacant." });
      queryClient.invalidateQueries({ queryKey: [apiBase + "/units"] });
      queryClient.invalidateQueries({ queryKey: [apiBase + "/units", unitId, "detail"] });
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-3 pt-3">
      <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-md p-3 text-sm">
        <p className="font-semibold text-red-700 dark:text-red-400">Warning — Ending the contract will:</p>
        <ul className="list-disc pl-5 mt-1 text-red-600 dark:text-red-400 text-xs">
          <li>Mark the unit as vacant</li>
          <li>Stop monthly auto-generation</li>
          <li>Remove future unpaid ledger rows beyond the end date</li>
          {refundGuarantee && refundAccountId && <li className="text-orange-600 dark:text-orange-400">Post guarantee refund of {fmtMoneyCurrency(refundAmount, contract.currency)}</li>}
        </ul>
      </div>

      <div>
        <Label>End Date *</Label>
        <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} data-testid={`input-${testIdPrefix}-end-date`} />
      </div>
      <div>
        <Label>Notes</Label>
        <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} data-testid={`input-${testIdPrefix}-end-notes`} />
      </div>

      {/* Guarantee refund section — only shown if there's something to refund */}
      {hasRemainingGuarantee && (
        <div className="border rounded-md p-3 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <p className="text-sm font-semibold">Refund Guarantee on Departure</p>
              <p className="text-xs text-muted-foreground">
                Remaining: <span className="font-semibold text-green-600 dark:text-green-400">{fmtMoneyCurrency(remainingGuarantee, contract.currency)}</span>
                {usedAmount > 0 && <span className="ml-2 text-muted-foreground">({fmtMoneyCurrency(usedAmount, contract.currency)} already applied as rent)</span>}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id={`refund-guar-${contract.id}`}
                checked={refundGuarantee}
                onChange={e => setRefundGuarantee(e.target.checked)}
                data-testid={`check-${testIdPrefix}-refund-guarantee`}
              />
              <Label htmlFor={`refund-guar-${contract.id}`} className="cursor-pointer text-sm">
                Refund {fmtMoneyCurrency(remainingGuarantee, contract.currency)} now
              </Label>
            </div>
          </div>

          {refundGuarantee && (
            <div className="grid grid-cols-2 gap-3 pt-1 border-t border-border/40">
              <div>
                <Label>Refund amount</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={refundAmount}
                  onChange={e => setRefundAmount(e.target.value)}
                  data-testid={`input-${testIdPrefix}-refund-amount`}
                />
              </div>
              <div className="col-span-2">
                <Label>{tenantPays ? "Cash account (received back into)" : "Cash account (paid out from)"}</Label>
                <AccountSearchSelect
                  accounts={cashAccounts}
                  value={refundAccountId}
                  onChange={setRefundAccountId}
                  placeholder="Select account…"
                  testId={`select-${testIdPrefix}-refund-account`}
                />
                {refundGuarantee && !refundAccountId && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">No account selected — refund will be recorded without an accounting entry.</p>
                )}
              </div>
              <div className="col-span-2">
                <Label>Notes (optional)</Label>
                <Textarea
                  rows={2}
                  value={refundNotes}
                  onChange={e => setRefundNotes(e.target.value)}
                  placeholder="e.g. Returned by bank transfer"
                  data-testid={`input-${testIdPrefix}-refund-notes`}
                />
              </div>
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground">
                  {tenantPays
                    ? "Posts: Dr Cash / Cr Security Deposits Paid — clears the asset and brings cash in."
                    : "Posts: Dr Tenant Deposits / Cr Cash — reduces the liability and pays out cash."
                  }
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <input type="checkbox" id={`conf-${contract.id}`} checked={confirm} onChange={e => setConfirm(e.target.checked)} data-testid={`check-${testIdPrefix}-confirm-end`} />
        <Label htmlFor={`conf-${contract.id}`} className="cursor-pointer">I confirm I want to end this contract</Label>
      </div>
      <DialogFooter>
        <Button variant="destructive" onClick={() => end.mutate()} disabled={!confirm || end.isPending} data-testid={`button-${testIdPrefix}-end-contract`}>
          {end.isPending ? "Ending…" : refundGuarantee ? "End Contract & Refund Guarantee" : "End Contract & Vacate Unit"}
        </Button>
      </DialogFooter>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// TAB: EDIT CONTRACT INFO
// ──────────────────────────────────────────────────────────
function EditInfoForm({ contract, testIdPrefix, unitId, unit, unitType }: { contract: Contract; testIdPrefix: string; unitId: number; unit: Unit; unitType: "WAREHOUSE" | "SHOP" }) {
  const apiBase = useApiBase();
  const { toast } = useToast();
  const [tenantName, setTenantName] = useState(contract.tenantName);
  const [startDate, setStartDate] = useState(
    contract.startDate ? new Date(contract.startDate).toISOString().slice(0, 10) : ""
  );
  const [guaranteeAmount, setGuaranteeAmount] = useState(contract.guaranteeAmount ?? "");
  const [guaranteePeriod, setGuaranteePeriod] = useState(contract.guaranteePeriod ?? "");
  const [unitNumber, setUnitNumber] = useState(unit.unitNumber);
  const [dimensions, setDimensions] = useState(unit.dimensions ?? "");
  const [isInternal, setIsInternal] = useState(contract.isInternal ?? false);
  const [linkedCompanyId, setLinkedCompanyId] = useState<number | null>(contract.linkedCompanyId ?? null);

  const { data: allCompanies = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/companies"],
    queryFn: async () => {
      const res = await fetch("/api/companies", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load companies");
      return res.json();
    },
  });

  const saveContract = useMutation({
    mutationFn: () => apiRequest("PATCH", `${apiBase}/contracts/${contract.id}/info`, {
      tenantName, startDate, guaranteeAmount, guaranteePeriod, isInternal, linkedCompanyId,
    }),
    onSuccess: () => {
      toast({ title: "Contract info updated" });
      queryClient.invalidateQueries({ queryKey: [apiBase + "/units"] });
      queryClient.invalidateQueries({ queryKey: [apiBase + "/units", unitId, "detail"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const saveUnit = useMutation({
    mutationFn: () => apiRequest("PATCH", `${apiBase}/units/${unitId}`, { unitNumber, dimensions: dimensions || null }),
    onSuccess: () => {
      toast({ title: "Unit name updated" });
      queryClient.invalidateQueries({ queryKey: [apiBase + "/units"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const contractChanged = tenantName !== contract.tenantName ||
    startDate !== (contract.startDate ? new Date(contract.startDate).toISOString().slice(0, 10) : "") ||
    guaranteeAmount !== (contract.guaranteeAmount ?? "") ||
    guaranteePeriod !== (contract.guaranteePeriod ?? "") ||
    isInternal !== (contract.isInternal ?? false) ||
    linkedCompanyId !== (contract.linkedCompanyId ?? null);
  const unitChanged = unitNumber !== unit.unitNumber || dimensions !== (unit.dimensions ?? "");

  return (
    <div className="space-y-5 pt-3">
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Unit</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Unit Name</Label>
            <Input value={unitNumber} onChange={e => setUnitNumber(e.target.value.toUpperCase())} data-testid={`input-${testIdPrefix}-edit-unit-number`} />
          </div>
          <div>
            <Label>Dimensions</Label>
            <Input value={dimensions} onChange={e => setDimensions(e.target.value)} placeholder="e.g. 35 X 12" data-testid={`input-${testIdPrefix}-edit-dimensions`} />
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={() => saveUnit.mutate()} disabled={!unitChanged || !unitNumber || saveUnit.isPending} data-testid={`button-${testIdPrefix}-save-unit`}>
            {saveUnit.isPending ? "Saving…" : "Save Unit Info"}
          </Button>
        </div>
      </div>

      <div className="border-t pt-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contract</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Tenant Name *</Label>
            <Input value={tenantName} onChange={e => setTenantName(e.target.value)} data-testid={`input-${testIdPrefix}-edit-tenant`} />
          </div>
          <div>
            <Label>Start Date *</Label>
            <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} data-testid={`input-${testIdPrefix}-edit-start-date`} />
            {startDate && (
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                <CalendarDays className="h-3 w-3 shrink-0" />
                Charges on the {billingDayLabel(startDate)}
              </p>
            )}
          </div>
          <div>
            <Label>Guarantee Amount</Label>
            <Input type="number" step="0.01" value={guaranteeAmount} onChange={e => setGuaranteeAmount(e.target.value)} data-testid={`input-${testIdPrefix}-edit-guarantee`} />
          </div>
          <div>
            <Label>Guarantee Period</Label>
            <Input value={guaranteePeriod} onChange={e => setGuaranteePeriod(e.target.value)} placeholder="e.g. 3 MONTHS" data-testid={`input-${testIdPrefix}-edit-guarantee-period`} />
          </div>
        </div>
        {unitType === "WAREHOUSE" && (
          <div className="flex items-center gap-3 rounded-md border p-3 bg-violet-50 dark:bg-violet-950/20 mt-2">
            <Switch
              id={`switch-edit-${testIdPrefix}-internal`}
              checked={isInternal}
              onCheckedChange={setIsInternal}
              data-testid={`switch-edit-${testIdPrefix}-internal`}
            />
            <div>
              <Label htmlFor={`switch-edit-${testIdPrefix}-internal`} className="font-semibold cursor-pointer">Internal Lease</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Toggle on to make this warehouse also appear in Shops Rented as a self-occupied property.</p>
            </div>
          </div>
        )}
        <div className="rounded-md border p-3 bg-sky-50 dark:bg-sky-950/20 space-y-2 mt-2">
          <div>
            <Label className="font-semibold">Share with Company</Label>
            <p className="text-xs text-muted-foreground mt-0.5">The selected company will see this contract as a read-only entry in their rental view.</p>
          </div>
          <Select
            value={linkedCompanyId !== null ? String(linkedCompanyId) : "none"}
            onValueChange={v => setLinkedCompanyId(v === "none" ? null : Number(v))}
            data-testid={`select-${testIdPrefix}-linked-company`}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="No sharing" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No sharing</SelectItem>
              {allCompanies.map(c => (
                <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button
            onClick={() => saveContract.mutate()}
            disabled={!contractChanged || !tenantName || !startDate || saveContract.isPending}
            data-testid={`button-${testIdPrefix}-save-info`}
          >
            {saveContract.isPending ? "Saving…" : "Save Contract Info"}
          </Button>
        </DialogFooter>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// LEDGER VIEW / STATEMENT
// ──────────────────────────────────────────────────────────
function LedgerView({ ledger, payments, guaranteePayments, contract, unitId, onNoteUpdated, readOnly }: { ledger: LedgerRow[]; payments: Payment[]; guaranteePayments: Payment[]; contract: Contract; unitId: number; onNoteUpdated?: () => void; readOnly?: boolean }) {
  const apiBase = useApiBase();
  const { toast } = useToast();
  const [draftNote, setDraftNote] = useState(contract.statementNote ?? "");
  const noteChanged = draftNote !== (contract.statementNote ?? "");

  const { data: me } = useQuery<any>({ queryKey: ["/api/auth/me"], staleTime: 30 * 60 * 1000 });
  const isAdmin = me?.role === "Admin" || me?.role === "Developer";

  const saveNote = useMutation({
    mutationFn: () => apiRequest("PATCH", `${apiBase}/contracts/${contract.id}/statement-note`, { statementNote: draftNote }),
    onSuccess: () => {
      toast({ title: "Note saved" });
      onNoteUpdated?.();
    },
    onError: () => toast({ title: "Failed to save note", variant: "destructive" }),
  });

  const fixAllocation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/properties/repair/reallocate-payments/${contract.id}`, {}),
    onSuccess: (data: any) => {
      toast({ title: "Allocation fixed", description: data?.message ?? `${data?.fixed ?? 0} payment(s) reallocated to the correct months.` });
      queryClient.invalidateQueries({ queryKey: [apiBase + "/units"] });
      onNoteUpdated?.();
    },
    onError: (err: any) => toast({ title: "Fix failed", description: err?.message ?? "Could not reallocate payments.", variant: "destructive" }),
  });

  const now = new Date();
  const nowYear = now.getFullYear();
  const nowMonth = now.getMonth() + 1; // 1-based
  // Only count expected amounts for months up to the current calendar month.
  // All paid amounts are counted so advance payments show as credit (negative balance).
  const totalExpected = ledger.reduce((s, r) => {
    const isFuture = r.year > nowYear || (r.year === nowYear && r.month > nowMonth);
    return s + (isFuture ? 0 : Number(r.expectedAmount));
  }, 0);
  const totalPaid = ledger.reduce((s, r) => s + Number(r.paidAmount), 0);
  const balance = totalExpected - totalPaid;

  const handlePrint = () => {
    const rows = ledger.map(r => {
      const isFutureRow = r.year > nowYear || (r.year === nowYear && r.month > nowMonth);
      const out = isFutureRow ? 0 - Number(r.paidAmount) : Number(r.expectedAmount) - Number(r.paidAmount);
      const outColor = out > 0 ? "#cc0000" : out < 0 ? "#006600" : "#888888";
      const sym = contract.currency === "EUR" ? "€" : contract.currency === "CFA" ? "FC " : "$";
      const fmtPdf = (v: number) => sym + v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: contract.currency === "CFA" ? 0 : 2 });
      const expDisplay = isFutureRow ? "—" : fmtPdf(Number(r.expectedAmount));
      return `<tr>
        <td>${MONTH_NAMES[r.month]} ${r.year}${isFutureRow ? " <em style='color:#888;font-size:9px'>prepaid</em>" : ""}</td>
        <td class="num">${expDisplay}</td>
        <td class="num">${fmtPdf(Number(r.paidAmount))}</td>
        <td class="num" style="color:${outColor};font-weight:600">${fmtPdf(Math.abs(out))}${out < 0 ? " CR" : ""}</td>
        <td class="note">${r.notes || ""}</td>
      </tr>`;
    }).join("");

    const sym2 = contract.currency === "EUR" ? "€" : contract.currency === "CFA" ? "FC " : "$";
    const fmtPdf2 = (v: number) => sym2 + v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: contract.currency === "CFA" ? 0 : 2 });
    const buildPayRows = (rows: Payment[]) => rows.map(p => `<tr>
      <td>${format(new Date(p.paymentDate), "dd MMM yyyy")}</td>
      <td>${MONTH_NAMES[p.forMonth]} ${p.forYear}</td>
      <td class="num">${fmtPdf2(Number(p.amount))}</td>
      <td class="note">${p.notes || ""}</td>
    </tr>`).join("");
    const payRows = buildPayRows(payments);
    const guarRows = buildPayRows(guaranteePayments);

    const balColor = balance > 0 ? "#cc0000" : balance < 0 ? "#006600" : "#000";
    const startStr = contract.startDate ? format(new Date(contract.startDate as any), "dd MMM yyyy") : "—";

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Rental Statement — ${contract.tenantName}</title>
    <style>
      body { font-family: Arial, sans-serif; font-size: 11px; color: #111; margin: 0; padding: 20px; }
      h1 { font-size: 18px; margin: 0 0 2px 0; color: #1a3a6b; }
      .subtitle { font-size: 12px; color: #555; margin-bottom: 16px; }
      .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; margin-bottom: 16px; background: #f4f6fb; border: 1px solid #dde3f0; border-radius: 6px; padding: 12px 16px; }
      .info-grid .lbl { font-weight: 700; color: #555; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; }
      .info-grid .val { font-size: 12px; font-weight: 600; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
      th { background: #1a3a6b; color: #fff; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; text-align: left; padding: 6px 10px; }
      th.num { text-align: right; }
      td { padding: 5px 10px; border-bottom: 1px solid #eee; }
      td.num { text-align: right; font-variant-numeric: tabular-nums; }
      td.note { color: #666; }
      tr.total td { background: #e9ecf5; font-weight: 700; border-top: 2px solid #aaa; }
      h2 { font-size: 13px; margin: 20px 0 6px 0; color: #1a3a6b; }
      @media print { body { padding: 0; } }
    </style></head><body>
    <h1>Rental Statement</h1>
    <div class="subtitle">Generated ${format(new Date(), "dd MMM yyyy")}</div>
    <div class="info-grid">
      <div><div class="lbl">Tenant</div><div class="val">${contract.tenantName}</div></div>
      <div><div class="lbl">Start Date</div><div class="val">${startStr}</div></div>
      <div><div class="lbl">Monthly Rent</div><div class="val">${fmtMoneyCurrency(contract.rentalAmount, contract.currency)}</div></div>
      ${contract.guaranteeAmount && Number(contract.guaranteeAmount) > 0 ? `<div><div class="lbl">Guarantee</div><div class="val">${fmtMoneyCurrency(contract.guaranteeAmount, contract.currency)}</div></div>` : ""}
    </div>
    <table>
      <thead><tr>
        <th>Month</th><th class="num">Expected</th><th class="num">Paid</th><th class="num">Outstanding</th><th>Notes</th>
      </tr></thead>
      <tbody>${rows}<tr class="total">
        <td>TOTALS</td>
        <td class="num">${fmtMoneyCurrency(totalExpected, contract.currency)}</td>
        <td class="num">${fmtMoneyCurrency(totalPaid, contract.currency)}</td>
        <td class="num" style="color:${balColor}">${fmtMoneyCurrency(Math.abs(balance), contract.currency)}${balance < 0 ? " CR" : ""}</td>
        <td></td>
      </tr></tbody>
    </table>
    ${draftNote.trim() ? `<div style="margin:16px 0;padding:10px 14px;background:#f4f6fb;border:1px solid #dde3f0;border-radius:6px;font-size:11px;">
      <div style="font-weight:700;color:#555;font-size:10px;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px;">Note</div>
      <div style="white-space:pre-wrap;color:#111">${draftNote.trim().replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>
    </div>` : ""}
    ${payments.length > 0 ? `<h2>Rent Payment History</h2>
    <table><thead><tr><th>Date</th><th>For</th><th class="num">Amount</th><th>Notes</th></tr></thead>
    <tbody>${payRows}</tbody></table>` : ""}
    ${guaranteePayments.length > 0 ? `<h2 style="color:#6b21a8">Guarantee / Deposit Activity</h2>
    <p style="font-size:10px;color:#888;margin:-2px 0 8px 0">These entries reflect guarantee or deposit movements and do not affect rent balance.</p>
    <table><thead><tr><th>Date</th><th>For</th><th class="num">Amount</th><th>Notes</th></tr></thead>
    <tbody>${guarRows}</tbody></table>` : ""}
    </body></html>`;

    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) { toast({ title: "Pop-up blocked", description: "Allow pop-ups for this site and try again.", variant: "destructive" }); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };

  const handleExcel = () => {
    window.open(`${apiBase}/units/${unitId}/statement/export`, "_blank");
  };

  return (
    <div className="space-y-3 pt-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="grid grid-cols-4 gap-3 text-sm flex-1 min-w-0">
          <div className="bg-muted/40 rounded p-2"><div className="text-xs text-muted-foreground">Tenant</div><div className="font-semibold truncate">{contract.tenantName}</div></div>
          <div className="bg-muted/40 rounded p-2"><div className="text-xs text-muted-foreground">Monthly Rent</div><div className="font-semibold">{fmtMoneyCurrency(contract.rentalAmount, contract.currency)}</div></div>
          <div className="bg-muted/40 rounded p-2">
            <div className="text-xs text-muted-foreground">Billing Day</div>
            <div className="font-semibold flex items-center gap-1">
              <CalendarDays className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              {billingDayLabel(contract.startDate) ?? "—"}
            </div>
          </div>
          <div className="bg-muted/40 rounded p-2">
            <div className="text-xs text-muted-foreground">Balance</div>
            <div className={`font-bold ${balance > 0 ? "text-red-600 dark:text-red-400" : balance < 0 ? "text-green-600 dark:text-green-400" : ""}`}>
              {balance < 0 ? `${fmtMoneyCurrency(Math.abs(balance), contract.currency)} CR` : fmtMoneyCurrency(balance, contract.currency)}
            </div>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          {isAdmin && !readOnly && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => fixAllocation.mutate()}
              disabled={fixAllocation.isPending}
              data-testid="button-fix-allocation"
              title="Re-allocate payments to oldest unpaid months first"
            >
              <Wrench className="h-4 w-4 mr-1" />
              {fixAllocation.isPending ? "Fixing..." : "Fix Allocation"}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handleExcel} data-testid="button-export-excel">
            <Download className="h-4 w-4 mr-1" />Excel
          </Button>
          <Button variant="outline" size="sm" onClick={handlePrint} data-testid="button-print-statement">
            <Printer className="h-4 w-4 mr-1" />Print / PDF
          </Button>
        </div>
      </div>
      <div className="border rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase">
            <tr>
              <th className="text-left px-3 py-2">Month</th>
              <th className="text-right px-3 py-2">Expected</th>
              <th className="text-right px-3 py-2">Paid</th>
              <th className="text-right px-3 py-2">Outstanding</th>
              <th className="text-left px-3 py-2">Notes</th>
            </tr>
          </thead>
          <tbody>
            {ledger.map(r => {
              const isFutureRow = r.year > nowYear || (r.year === nowYear && r.month > nowMonth);
              // For future months: expected counts as 0 (not yet due), paid is a credit
              const out = isFutureRow
                ? 0 - Number(r.paidAmount)   // negative = credit
                : Number(r.expectedAmount) - Number(r.paidAmount);
              return (
                <tr key={r.id} className="border-t" data-testid={`row-ledger-${r.year}-${r.month}`}>
                  <td className="px-3 py-1.5">
                    <span className="flex items-center gap-1.5 flex-wrap">
                      <span>{MONTH_NAMES[r.month]} {r.year}</span>
                      {isFutureRow && <span className="text-[10px] text-muted-foreground italic">prepaid</span>}
                      {r.accrualVoucherId && (
                        <Badge variant="secondary" className="text-[10px]" data-testid={`badge-accrued-${r.year}-${r.month}`}>
                          Accrued
                        </Badge>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                    {isFutureRow ? "—" : fmtMoneyCurrency(r.expectedAmount, contract.currency)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtMoneyCurrency(r.paidAmount, contract.currency)}</td>
                  <td className={`px-3 py-1.5 text-right tabular-nums font-semibold ${out > 0 ? "text-red-600 dark:text-red-400" : out < 0 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
                    {out < 0 ? `${fmtMoneyCurrency(Math.abs(out), contract.currency)} CR` : fmtMoneyCurrency(out, contract.currency)}
                  </td>
                  <td className="px-3 py-1.5 text-xs text-muted-foreground">{r.notes || ""}</td>
                </tr>
              );
            })}
            <tr className="border-t-2 bg-muted/30 font-semibold">
              <td className="px-3 py-2">TOTALS <span className="font-normal text-[10px] text-muted-foreground">(as of today)</span></td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtMoneyCurrency(totalExpected, contract.currency)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtMoneyCurrency(totalPaid, contract.currency)}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${balance > 0 ? "text-red-600 dark:text-red-400" : balance < 0 ? "text-green-600 dark:text-green-400" : ""}`}>
                {balance < 0 ? `${fmtMoneyCurrency(Math.abs(balance), contract.currency)} CR` : fmtMoneyCurrency(balance, contract.currency)}
              </td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
      {payments.length > 0 && (
        <details className="bg-muted/30 rounded-md p-2" open>
          <summary className="text-sm font-semibold cursor-pointer" data-testid="summary-rent-payment-history">
            Rent Payment History ({payments.length})
          </summary>
          <table className="w-full text-xs mt-2">
            <thead><tr className="text-muted-foreground"><th className="text-left px-2 py-1">Date</th><th className="text-left px-2 py-1">For</th><th className="text-right px-2 py-1">Amount</th><th className="text-left px-2 py-1">Notes</th></tr></thead>
            <tbody>
              {payments.map(p => (
                <tr key={p.id} className="border-t" data-testid={`row-rent-payment-${p.id}`}>
                  <td className="px-2 py-1">{format(new Date(p.paymentDate), "dd MMM yyyy")}</td>
                  <td className="px-2 py-1">{MONTH_NAMES[p.forMonth]} {p.forYear}</td>
                  <td className="px-2 py-1 text-right tabular-nums">${fmtMoney(p.amount)}</td>
                  <td className="px-2 py-1 text-muted-foreground">{p.notes || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {guaranteePayments.length > 0 && (
        <details className="rounded-md border border-purple-200 dark:border-purple-900 bg-purple-50/50 dark:bg-purple-950/20 p-2" open>
          <summary className="text-sm font-semibold cursor-pointer text-purple-800 dark:text-purple-300" data-testid="summary-guarantee-activity">
            Guarantee / Deposit Activity ({guaranteePayments.length})
          </summary>
          <p className="text-xs text-muted-foreground mt-1 mb-2">
            These entries reflect guarantee or deposit movements. They do <strong>not</strong> affect rent balance or the Paid column above.
          </p>
          <table className="w-full text-xs">
            <thead><tr className="text-muted-foreground"><th className="text-left px-2 py-1">Date</th><th className="text-left px-2 py-1">For</th><th className="text-right px-2 py-1">Amount</th><th className="text-left px-2 py-1">Notes</th></tr></thead>
            <tbody>
              {guaranteePayments.map(p => (
                <tr key={p.id} className="border-t border-purple-100 dark:border-purple-900" data-testid={`row-guarantee-payment-${p.id}`}>
                  <td className="px-2 py-1">{format(new Date(p.paymentDate), "dd MMM yyyy")}</td>
                  <td className="px-2 py-1">{MONTH_NAMES[p.forMonth]} {p.forYear}</td>
                  <td className="px-2 py-1 text-right tabular-nums font-medium">${fmtMoney(p.amount)}</td>
                  <td className="px-2 py-1 text-muted-foreground">{p.notes || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {/* ── Statement note ── */}
      {!readOnly && (
        <div className="border rounded-md p-3 space-y-2">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Statement Note</div>
          <Textarea
            placeholder="Add a note that will appear on the printed statement and Excel export…"
            value={draftNote}
            onChange={e => setDraftNote(e.target.value)}
            rows={3}
            className="text-sm resize-none"
            data-testid="textarea-statement-note"
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => saveNote.mutate()}
              disabled={!noteChanged || saveNote.isPending}
              data-testid="button-save-statement-note"
            >
              {saveNote.isPending ? "Saving…" : "Save Note"}
            </Button>
          </div>
        </div>
      )}
      {readOnly && draftNote.trim() && (
        <div className="border rounded-md p-3 space-y-1">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Statement Note</div>
          <p className="text-sm whitespace-pre-wrap">{draftNote.trim()}</p>
        </div>
      )}
    </div>
  );
}
