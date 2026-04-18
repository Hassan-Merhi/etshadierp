import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useCompany } from "@/contexts/CompanyContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, Edit, DollarSign, FileEdit, Send, XCircle, Building2, Store, ChevronRight, RefreshCw } from "lucide-react";
import { format } from "date-fns";

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
};
type Contract = {
  id: number;
  unitId: number;
  tenantName: string;
  guaranteePeriod: string | null;
  guaranteeAmount: string;
  rentalAmount: string;
  startDate: string;
  status: string;
  notes: string | null;
  guaranteePostedToStatement: boolean;
};
type CashAccount = { id: number; name: string; code: string; accountType: string };
type LedgerRow = { id: number; year: number; month: number; expectedAmount: string; paidAmount: string };
type Payment = { id: number; amount: string; paymentDate: string; forYear: number; forMonth: number; cashAccountId: number | null; notes: string | null };

const MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtMoney = (v: string | number | null | undefined) => {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};

interface Props {
  unitType: "WAREHOUSE" | "SHOP";
  pageTitle: string;
  pageIcon: React.ReactNode;
  testIdPrefix: string;
}

export default function PropertyRentalPage({ unitType, pageTitle, pageIcon, testIdPrefix }: Props) {
  const { selectedCompany } = useCompany();
  const { toast } = useToast();
  const [openUnitId, setOpenUnitId] = useState<number | null>(null);
  const [createUnitOpen, setCreateUnitOpen] = useState(false);

  const { data: units = [], isLoading } = useQuery<Unit[]>({
    queryKey: ["/api/properties/rental/units", { unitType, companyId: selectedCompany?.id }],
    queryFn: async () => {
      const res = await fetch(`/api/properties/rental/units?unitType=${unitType}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load units");
      return res.json();
    },
    enabled: !!selectedCompany,
  });

  const { data: cashAccounts = [] } = useQuery<CashAccount[]>({
    queryKey: ["/api/properties/rental/cash-accounts", selectedCompany?.id],
    enabled: !!selectedCompany,
  });

  // Group units by location
  const grouped = useMemo(() => {
    const groups = new Map<string, Unit[]>();
    units.forEach(u => {
      if (!groups.has(u.locationGroup)) groups.set(u.locationGroup, []);
      groups.get(u.locationGroup)!.push(u);
    });
    return Array.from(groups.entries());
  }, [units]);

  // Totals
  const totals = useMemo(() => {
    let totalGuarantee = 0;
    let totalOutstanding = 0;
    units.forEach(u => {
      if (u.contract) {
        totalGuarantee += Number(u.contract.guaranteeAmount || 0);
        totalOutstanding += u.outstanding ?? 0;
      }
    });
    return { totalGuarantee, totalOutstanding };
  }, [units]);

  const runMonthly = useMutation({
    mutationFn: () => apiRequest("/api/properties/rental/run-monthly", { method: "POST" }),
    onSuccess: () => {
      toast({ title: "Monthly ledger updated", description: "All active contracts now have current month rows." });
      queryClient.invalidateQueries({ queryKey: ["/api/properties/rental/units"] });
    },
  });

  const openUnit = units.find(u => u.id === openUnitId) ?? null;

  return (
    <div className="p-4 space-y-4" data-testid={`page-${testIdPrefix}`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          {pageIcon}
          <div>
            <h1 className="text-xl font-bold">{pageTitle}</h1>
            <p className="text-xs text-muted-foreground">Click any unit to manage payments, modify rent, post guarantee, or end the contract.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => runMonthly.mutate()}
            disabled={runMonthly.isPending}
            data-testid={`button-${testIdPrefix}-run-monthly`}
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${runMonthly.isPending ? "animate-spin" : ""}`} />
            Run Monthly Update
          </Button>
          <Button
            onClick={() => setCreateUnitOpen(true)}
            size="sm"
            data-testid={`button-${testIdPrefix}-add-unit`}
          >
            <Plus className="h-4 w-4 mr-1" />
            Add {unitType === "WAREHOUSE" ? "Warehouse" : "Shop"}
          </Button>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground font-normal">TOTAL UNITS</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold" data-testid={`stat-${testIdPrefix}-total-units`}>{units.length}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground font-normal">TOTAL GUARANTEE</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold" data-testid={`stat-${testIdPrefix}-total-guarantee`}>${fmtMoney(totals.totalGuarantee)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground font-normal">TOTAL OUTSTANDING</CardTitle></CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${totals.totalOutstanding > 0 ? "text-red-600 dark:text-red-400" : totals.totalOutstanding < 0 ? "text-green-600 dark:text-green-400" : ""}`} data-testid={`stat-${testIdPrefix}-total-outstanding`}>
              ${fmtMoney(totals.totalOutstanding)}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">positive = owed · negative = credit</p>
          </CardContent>
        </Card>
      </div>

      {/* Main table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b">
                <tr className="text-xs uppercase text-muted-foreground">
                  <th className="text-left px-3 py-2 font-semibold">Unit #</th>
                  <th className="text-left px-3 py-2 font-semibold">Size</th>
                  <th className="text-left px-3 py-2 font-semibold">Dim. (L × W)</th>
                  <th className="text-left px-3 py-2 font-semibold">Current Tenant</th>
                  <th className="text-left px-3 py-2 font-semibold">Guarantee Period</th>
                  <th className="text-right px-3 py-2 font-semibold">Guarantee $</th>
                  <th className="text-right px-3 py-2 font-semibold">Rental $</th>
                  <th className="text-right px-3 py-2 font-semibold">Outstanding</th>
                  <th className="text-left px-3 py-2 font-semibold">Notes</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={10} className="text-center py-12 text-muted-foreground">Loading…</td></tr>
                )}
                {!isLoading && units.length === 0 && (
                  <tr><td colSpan={10} className="text-center py-12 text-muted-foreground">
                    No units yet. Click "Add {unitType === "WAREHOUSE" ? "Warehouse" : "Shop"}" to begin.
                  </td></tr>
                )}
                {grouped.map(([loc, list]) => (
                  <>
                    <tr key={`grp-${loc}`} className="bg-primary/5 border-y">
                      <td colSpan={10} className="px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-primary" data-testid={`row-group-${loc}`}>
                        ▸ {loc}
                      </td>
                    </tr>
                    {list.map(u => {
                      const c = u.contract;
                      const out = u.outstanding;
                      return (
                        <tr
                          key={u.id}
                          className="border-b hover:bg-muted/40 cursor-pointer"
                          onClick={() => setOpenUnitId(u.id)}
                          data-testid={`row-unit-${u.id}`}
                        >
                          <td className="px-3 py-2 font-medium" data-testid={`text-unit-number-${u.id}`}>{u.unitNumber}</td>
                          <td className="px-3 py-2 text-muted-foreground">{u.size || "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground">{u.dimensions || "—"}</td>
                          <td className="px-3 py-2">
                            {c ? <span data-testid={`text-tenant-${u.id}`}>{c.tenantName}</span> : <span className="italic text-muted-foreground">— Vacant —</span>}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{c?.guaranteePeriod || "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{c ? fmtMoney(c.guaranteeAmount) : "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{c ? fmtMoney(c.rentalAmount) : "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {out === null ? "—" : (
                              <span className={`font-semibold ${out > 0 ? "text-red-600 dark:text-red-400" : out < 0 ? "text-green-600 dark:text-green-400" : ""}`} data-testid={`text-outstanding-${u.id}`}>
                                {fmtMoney(out)}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs italic text-muted-foreground max-w-[200px] truncate">{u.notes || c?.notes || ""}</td>
                          <td className="px-2 py-2 text-right"><ChevronRight className="h-4 w-4 text-muted-foreground inline" /></td>
                        </tr>
                      );
                    })}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Action panel dialog */}
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
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// CREATE UNIT DIALOG
// ──────────────────────────────────────────────────────────
function CreateUnitDialog({ unitType, onClose, testIdPrefix }: { unitType: "WAREHOUSE" | "SHOP"; onClose: () => void; testIdPrefix: string }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    unitNumber: "",
    locationGroup: "",
    size: "",
    dimensions: "",
    notes: "",
  });

  const create = useMutation({
    mutationFn: () => apiRequest("/api/properties/rental/units", {
      method: "POST",
      body: JSON.stringify({ ...form, unitType }),
      headers: { "Content-Type": "application/json" },
    }),
    onSuccess: () => {
      toast({ title: "Unit created" });
      queryClient.invalidateQueries({ queryKey: ["/api/properties/rental/units"] });
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
  unit: Unit;
  cashAccounts: CashAccount[];
  onClose: () => void;
  unitType: "WAREHOUSE" | "SHOP";
  testIdPrefix: string;
}) {
  const { data: detail, isLoading } = useQuery<{ unit: Unit; contract: Contract | null; ledger: LedgerRow[]; payments: Payment[] }>({
    queryKey: ["/api/properties/rental/units", unit.id, "detail"],
    queryFn: async () => {
      const res = await fetch(`/api/properties/rental/units/${unit.id}/detail`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load unit detail");
      return res.json();
    },
  });

  const contract = detail?.contract ?? unit.contract;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" data-testid={`dialog-${testIdPrefix}-actions`}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Badge variant="outline">{unit.unitNumber}</Badge>
            {contract && <span className="text-base font-normal text-muted-foreground">— {contract.tenantName}</span>}
            {!contract && <Badge variant="secondary">Vacant</Badge>}
          </DialogTitle>
        </DialogHeader>

        {!contract ? (
          <StartContractForm unitId={unit.id} testIdPrefix={testIdPrefix} onClose={onClose} />
        ) : (
          <Tabs defaultValue="payment" className="w-full">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="payment" data-testid={`tab-${testIdPrefix}-payment`}><DollarSign className="h-4 w-4 mr-1" />Payment</TabsTrigger>
              <TabsTrigger value="ledger" data-testid={`tab-${testIdPrefix}-ledger`}>Ledger</TabsTrigger>
              <TabsTrigger value="modify" data-testid={`tab-${testIdPrefix}-modify`}><FileEdit className="h-4 w-4 mr-1" />Modify Rent</TabsTrigger>
              <TabsTrigger value="guarantee" data-testid={`tab-${testIdPrefix}-guarantee`}><Send className="h-4 w-4 mr-1" />Guarantee</TabsTrigger>
              <TabsTrigger value="end" data-testid={`tab-${testIdPrefix}-end`}><XCircle className="h-4 w-4 mr-1" />End Contract</TabsTrigger>
            </TabsList>

            <TabsContent value="payment">
              <PaymentForm contract={contract} cashAccounts={cashAccounts} testIdPrefix={testIdPrefix} unitId={unit.id} />
            </TabsContent>
            <TabsContent value="ledger">
              <LedgerView ledger={detail?.ledger ?? []} payments={detail?.payments ?? []} contract={contract} />
            </TabsContent>
            <TabsContent value="modify">
              <ModifyRentForm contract={contract} testIdPrefix={testIdPrefix} unitId={unit.id} />
            </TabsContent>
            <TabsContent value="guarantee">
              <GuaranteeForm contract={contract} testIdPrefix={testIdPrefix} unitId={unit.id} />
            </TabsContent>
            <TabsContent value="end">
              <EndContractForm contract={contract} testIdPrefix={testIdPrefix} onClose={onClose} unitId={unit.id} />
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────
// START CONTRACT (when unit is vacant)
// ──────────────────────────────────────────────────────────
function StartContractForm({ unitId, testIdPrefix, onClose }: { unitId: number; testIdPrefix: string; onClose: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    tenantName: "",
    rentalAmount: "",
    guaranteeAmount: "",
    guaranteePeriod: "",
    startDate: new Date().toISOString().slice(0, 10),
    notes: "",
  });

  const start = useMutation({
    mutationFn: () => apiRequest("/api/properties/rental/contracts", {
      method: "POST",
      body: JSON.stringify({ ...form, unitId }),
      headers: { "Content-Type": "application/json" },
    }),
    onSuccess: () => {
      toast({ title: "Contract started" });
      queryClient.invalidateQueries({ queryKey: ["/api/properties/rental/units"] });
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
// TAB 1: PAYMENT
// ──────────────────────────────────────────────────────────
function PaymentForm({ contract, cashAccounts, testIdPrefix, unitId }: { contract: Contract; cashAccounts: CashAccount[]; testIdPrefix: string; unitId: number }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    cashAccountId: "" as string,
    amount: "",
    paymentDate: new Date().toISOString().slice(0, 10),
    forMonth: "current" as "current" | "next",
    notes: "",
  });

  const pay = useMutation({
    mutationFn: () => apiRequest("/api/properties/rental/payments", {
      method: "POST",
      body: JSON.stringify({
        contractId: contract.id,
        cashAccountId: form.cashAccountId ? parseInt(form.cashAccountId) : null,
        amount: form.amount,
        paymentDate: form.paymentDate,
        forMonth: form.forMonth,
        notes: form.notes,
      }),
      headers: { "Content-Type": "application/json" },
    }),
    onSuccess: () => {
      toast({ title: "Payment recorded" });
      queryClient.invalidateQueries({ queryKey: ["/api/properties/rental/units"] });
      queryClient.invalidateQueries({ queryKey: ["/api/properties/rental/units", unitId, "detail"] });
      setForm(f => ({ ...f, amount: "", notes: "" }));
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-3 pt-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Cash Box</Label>
          <Select value={form.cashAccountId} onValueChange={v => setForm(f => ({ ...f, cashAccountId: v }))}>
            <SelectTrigger data-testid={`select-${testIdPrefix}-cash-box`}><SelectValue placeholder="Choose cash box…" /></SelectTrigger>
            <SelectContent>
              {cashAccounts.map(a => (
                <SelectItem key={a.id} value={String(a.id)}>{a.name} <span className="text-xs text-muted-foreground">({a.accountType})</span></SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Payment Date</Label>
          <Input type="date" value={form.paymentDate} onChange={e => setForm(f => ({ ...f, paymentDate: e.target.value }))} data-testid={`input-${testIdPrefix}-payment-date`} />
        </div>
        <div>
          <Label>Amount Received ($)</Label>
          <Input type="number" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} data-testid={`input-${testIdPrefix}-payment-amount`} />
        </div>
        <div>
          <Label>For Month</Label>
          <RadioGroup value={form.forMonth} onValueChange={v => setForm(f => ({ ...f, forMonth: v as any }))} className="flex gap-4 pt-2">
            <div className="flex items-center gap-1.5"><RadioGroupItem value="current" id="cur" data-testid={`radio-${testIdPrefix}-current-month`} /><Label htmlFor="cur" className="font-normal cursor-pointer">Current Month</Label></div>
            <div className="flex items-center gap-1.5"><RadioGroupItem value="next" id="nxt" data-testid={`radio-${testIdPrefix}-next-month`} /><Label htmlFor="nxt" className="font-normal cursor-pointer">Next Month</Label></div>
          </RadioGroup>
        </div>
        <div className="col-span-2">
          <Label>Notes</Label>
          <Textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} data-testid={`input-${testIdPrefix}-payment-notes`} />
        </div>
      </div>
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
  const { toast } = useToast();
  const [newAmount, setNewAmount] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState<"current" | "next">("next");

  const modify = useMutation({
    mutationFn: () => apiRequest(`/api/properties/rental/contracts/${contract.id}/rent`, {
      method: "PATCH",
      body: JSON.stringify({ newAmount, effectiveFrom }),
      headers: { "Content-Type": "application/json" },
    }),
    onSuccess: () => {
      toast({ title: "Rental amount updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/properties/rental/units"] });
      queryClient.invalidateQueries({ queryKey: ["/api/properties/rental/units", unitId, "detail"] });
      setNewAmount("");
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-3 pt-3">
      <div className="bg-muted/40 rounded-md p-3 text-sm">
        <span className="text-muted-foreground">Current Rental Amount: </span>
        <span className="font-bold">${fmtMoney(contract.rentalAmount)}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>New Rental Amount ($) *</Label>
          <Input type="number" step="0.01" value={newAmount} onChange={e => setNewAmount(e.target.value)} data-testid={`input-${testIdPrefix}-new-rent`} />
        </div>
        <div>
          <Label>Effective From</Label>
          <RadioGroup value={effectiveFrom} onValueChange={v => setEffectiveFrom(v as any)} className="flex gap-4 pt-2">
            <div className="flex items-center gap-1.5"><RadioGroupItem value="current" id="mc" /><Label htmlFor="mc" className="font-normal cursor-pointer">Current Month</Label></div>
            <div className="flex items-center gap-1.5"><RadioGroupItem value="next" id="mn" /><Label htmlFor="mn" className="font-normal cursor-pointer">Next Month</Label></div>
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
function GuaranteeForm({ contract, testIdPrefix, unitId }: { contract: Contract; testIdPrefix: string; unitId: number }) {
  const { toast } = useToast();
  const [amount, setAmount] = useState(contract.guaranteeAmount);
  const [notes, setNotes] = useState("");

  const post = useMutation({
    mutationFn: () => apiRequest(`/api/properties/rental/contracts/${contract.id}/guarantee-to-statement`, {
      method: "POST",
      body: JSON.stringify({ amount, notes }),
      headers: { "Content-Type": "application/json" },
    }),
    onSuccess: () => {
      toast({ title: "Guarantee posted to statement" });
      queryClient.invalidateQueries({ queryKey: ["/api/properties/rental/units"] });
      queryClient.invalidateQueries({ queryKey: ["/api/properties/rental/units", unitId, "detail"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-3 pt-3">
      <div className="bg-muted/40 rounded-md p-3 text-sm">
        <span className="text-muted-foreground">Guarantee on file: </span>
        <span className="font-bold">${fmtMoney(contract.guaranteeAmount)}</span>
        {contract.guaranteePostedToStatement && <Badge variant="secondary" className="ml-2">Already posted</Badge>}
      </div>
      <div>
        <Label>Amount to Post to Statement ($) *</Label>
        <Input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} data-testid={`input-${testIdPrefix}-guarantee-post`} />
      </div>
      <div>
        <Label>Notes</Label>
        <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} data-testid={`input-${testIdPrefix}-guarantee-notes`} />
      </div>
      <DialogFooter>
        <Button onClick={() => post.mutate()} disabled={!amount || post.isPending} data-testid={`button-${testIdPrefix}-post-guarantee`}>
          {post.isPending ? "Posting…" : "Post to Statement"}
        </Button>
      </DialogFooter>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// TAB 4: END CONTRACT
// ──────────────────────────────────────────────────────────
function EndContractForm({ contract, testIdPrefix, onClose, unitId }: { contract: Contract; testIdPrefix: string; onClose: () => void; unitId: number }) {
  const { toast } = useToast();
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [confirm, setConfirm] = useState(false);

  const end = useMutation({
    mutationFn: () => apiRequest(`/api/properties/rental/contracts/${contract.id}/end`, {
      method: "POST",
      body: JSON.stringify({ endDate, notes }),
      headers: { "Content-Type": "application/json" },
    }),
    onSuccess: () => {
      toast({ title: "Contract ended", description: "Unit is now vacant." });
      queryClient.invalidateQueries({ queryKey: ["/api/properties/rental/units"] });
      queryClient.invalidateQueries({ queryKey: ["/api/properties/rental/units", unitId, "detail"] });
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-3 pt-3">
      <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-md p-3 text-sm">
        <p className="font-semibold text-red-700 dark:text-red-400">⚠ Ending the contract will:</p>
        <ul className="list-disc pl-5 mt-1 text-red-600 dark:text-red-400 text-xs">
          <li>Mark the unit as vacant</li>
          <li>Stop monthly auto-generation</li>
          <li>Remove future unpaid ledger rows beyond the end date</li>
        </ul>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>End Date *</Label>
          <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} data-testid={`input-${testIdPrefix}-end-date`} />
        </div>
      </div>
      <div>
        <Label>Notes</Label>
        <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} data-testid={`input-${testIdPrefix}-end-notes`} />
      </div>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="conf" checked={confirm} onChange={e => setConfirm(e.target.checked)} data-testid={`check-${testIdPrefix}-confirm-end`} />
        <Label htmlFor="conf" className="cursor-pointer">I confirm I want to end this contract</Label>
      </div>
      <DialogFooter>
        <Button variant="destructive" onClick={() => end.mutate()} disabled={!confirm || end.isPending} data-testid={`button-${testIdPrefix}-end-contract`}>
          {end.isPending ? "Ending…" : "End Contract & Vacate Unit"}
        </Button>
      </DialogFooter>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// LEDGER VIEW (per-unit monthly history like the KOLWEZI A1 sheet)
// ──────────────────────────────────────────────────────────
function LedgerView({ ledger, payments, contract }: { ledger: LedgerRow[]; payments: Payment[]; contract: Contract }) {
  const totalExpected = ledger.reduce((s, r) => s + Number(r.expectedAmount), 0);
  const totalPaid = ledger.reduce((s, r) => s + Number(r.paidAmount), 0);
  const balance = totalExpected - totalPaid;

  return (
    <div className="space-y-3 pt-3">
      <div className="grid grid-cols-3 gap-3 text-sm">
        <div className="bg-muted/40 rounded p-2"><div className="text-xs text-muted-foreground">Tenant</div><div className="font-semibold">{contract.tenantName}</div></div>
        <div className="bg-muted/40 rounded p-2"><div className="text-xs text-muted-foreground">Monthly Rent</div><div className="font-semibold">${fmtMoney(contract.rentalAmount)}</div></div>
        <div className="bg-muted/40 rounded p-2">
          <div className="text-xs text-muted-foreground">Balance</div>
          <div className={`font-bold ${balance > 0 ? "text-red-600 dark:text-red-400" : balance < 0 ? "text-green-600 dark:text-green-400" : ""}`}>
            ${fmtMoney(balance)}
          </div>
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
              const out = Number(r.expectedAmount) - Number(r.paidAmount);
              return (
                <tr key={r.id} className="border-t" data-testid={`row-ledger-${r.year}-${r.month}`}>
                  <td className="px-3 py-1.5">{MONTH_NAMES[r.month]} {r.year}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">${fmtMoney(r.expectedAmount)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">${fmtMoney(r.paidAmount)}</td>
                  <td className={`px-3 py-1.5 text-right tabular-nums font-semibold ${out > 0 ? "text-red-600 dark:text-red-400" : out < 0 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>${fmtMoney(out)}</td>
                  <td className="px-3 py-1.5 text-xs text-muted-foreground">{r.notes || ""}</td>
                </tr>
              );
            })}
            <tr className="border-t-2 bg-muted/30 font-semibold">
              <td className="px-3 py-2">TOTALS</td>
              <td className="px-3 py-2 text-right tabular-nums">${fmtMoney(totalExpected)}</td>
              <td className="px-3 py-2 text-right tabular-nums">${fmtMoney(totalPaid)}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${balance > 0 ? "text-red-600 dark:text-red-400" : balance < 0 ? "text-green-600 dark:text-green-400" : ""}`}>${fmtMoney(balance)}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>

      {payments.length > 0 && (
        <details className="bg-muted/30 rounded-md p-2">
          <summary className="text-sm font-semibold cursor-pointer">Payment History ({payments.length})</summary>
          <table className="w-full text-xs mt-2">
            <thead><tr className="text-muted-foreground"><th className="text-left px-2 py-1">Date</th><th className="text-left px-2 py-1">For</th><th className="text-right px-2 py-1">Amount</th><th className="text-left px-2 py-1">Notes</th></tr></thead>
            <tbody>
              {payments.map(p => (
                <tr key={p.id} className="border-t">
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
    </div>
  );
}
