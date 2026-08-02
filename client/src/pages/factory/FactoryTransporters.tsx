import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAdminOverride } from "@/hooks/use-admin-override";
import { useLocation } from "wouter";
import { queryClient } from "@/lib/queryClient";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/PageHeader";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Plus, ArrowLeft, Printer, TruckIcon } from "lucide-react";
import { useReactToPrint } from "react-to-print";
import { DeleteConfirmDialog } from "@/components/ConfirmationDialog";
import { useFactoryText } from "@/i18n/modules/factory";

const API = "/api/factory/transporters";

function fmt(n: number | null | undefined) {
  if (n == null || isNaN(n)) return "0.00";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type LedgerAccount = { id: number; name: string; accountType: string };
type Transporter = {
  id: number;
  name: string;
  phone?: string;
  notes?: string;
  totalCharged: number;
  totalPaid: number;
  outstanding: number;
};
type Transaction = {
  id: number;
  txType: "charge" | "payment";
  amount: string;
  txDate: string;
  description?: string;
  runningBalance: number;
};
type TransporterDetail = Transporter & { transactions: Transaction[] };

// ─────────────────────────────────────────────────────────────
// ACCOUNT COMBOBOX (simple select for now)
// ─────────────────────────────────────────────────────────────
function AccountSelect({
  accounts,
  value,
  onChange,
  placeholder,
  filter,
}: {
  accounts: LedgerAccount[];
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  filter?: (a: LedgerAccount) => boolean;
}) {
  const list = filter ? accounts.filter(filter) : accounts;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {list.map((a) => (
          <SelectItem key={a.id} value={String(a.id)}>
            {a.name} <span className="text-muted-foreground text-xs ml-1">({a.accountType})</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ─────────────────────────────────────────────────────────────
// CHARGE DIALOG
// ─────────────────────────────────────────────────────────────
function ChargeDialog({ transporterId, open, onClose }: { transporterId: number; open: boolean; onClose: () => void }) {
  const tUi = useFactoryText();
  const { wrapAdminAction, AdminDialog } = useAdminOverride();
  const { toast } = useToast();
  const [amount, setAmount] = useState("");
  const [txDate, setTxDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [expenseAccountId, setExpenseAccountId] = useState("");

  const { data: accounts = [] } = useQuery<LedgerAccount[]>({
    queryKey: ["/api/factory/transporter-accounts"],
    enabled: open,
  });

  const charge = useMutation({
    mutationFn: () =>
      apiRequest("POST", `${API}/${transporterId}/charges`, {
        amount,
        txDate,
        description,
        expenseAccountId: parseInt(expenseAccountId),
      }),
    onSuccess: () => {
      toast({ title: "Charge recorded" });
      queryClient.invalidateQueries({ queryKey: [API] });
      queryClient.invalidateQueries({ queryKey: [API, transporterId] });
      setAmount("");
      setDescription("");
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{tUi("record.charge")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">{tUi("dr.expense.account.cr.transporter.account")}</p>
            <div>
              <Label>{tUi("amount.3")}</Label>
              <Input
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                data-testid="input-charge-amount"
              />
            </div>
            <div>
              <Label>{tUi("date.2")}</Label>
              <Input
                type="date"
                value={txDate}
                onChange={(e) => setTxDate(e.target.value)}
                data-testid="input-charge-date"
              />
            </div>
            <div>
              <Label>{tUi("expense.account.2")}</Label>
              <AccountSelect
                accounts={accounts}
                value={expenseAccountId}
                onChange={setExpenseAccountId}
                placeholder={tUi("select.expense.account")}
                filter={(a) => ["Expense", "Direct Expense", "Indirect Expense"].includes(a.accountType)}
              />
            </div>
            <div>
              <Label>{tUi("description")}</Label>
              <Textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Container offload BL#12345"
                data-testid="input-charge-desc"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={() => wrapAdminAction(() => charge.mutate(), "Record Charge")}
              disabled={!amount || !expenseAccountId || charge.isPending}
              data-testid="button-save-charge"
            >
              {charge.isPending ? "Saving…" : "Record Charge"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {AdminDialog}
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// PAYMENT DIALOG
// ─────────────────────────────────────────────────────────────
function PaymentDialog({
  transporterId,
  open,
  onClose,
}: {
  transporterId: number;
  open: boolean;
  onClose: () => void;
}) {
  const tUi = useFactoryText();
  const { wrapAdminAction, AdminDialog } = useAdminOverride();
  const { toast } = useToast();
  const [amount, setAmount] = useState("");
  const [txDate, setTxDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [cashAccountId, setCashAccountId] = useState("");

  const { data: accounts = [] } = useQuery<LedgerAccount[]>({
    queryKey: ["/api/factory/transporter-accounts"],
    enabled: open,
  });

  const pay = useMutation({
    mutationFn: () =>
      apiRequest("POST", `${API}/${transporterId}/payments`, {
        amount,
        txDate,
        description,
        cashAccountId: parseInt(cashAccountId),
      }),
    onSuccess: () => {
      toast({ title: "Payment recorded" });
      queryClient.invalidateQueries({ queryKey: [API] });
      queryClient.invalidateQueries({ queryKey: [API, transporterId] });
      setAmount("");
      setDescription("");
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{tUi("record.payment")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">{tUi("dr.transporter.account.cr.cash")}</p>
            <div>
              <Label>{tUi("amount.3")}</Label>
              <Input
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                data-testid="input-payment-amount"
              />
            </div>
            <div>
              <Label>{tUi("date.2")}</Label>
              <Input
                type="date"
                value={txDate}
                onChange={(e) => setTxDate(e.target.value)}
                data-testid="input-payment-date"
              />
            </div>
            <div>
              <Label>{tUi("cash.bank.account.2")}</Label>
              <AccountSelect
                accounts={accounts}
                value={cashAccountId}
                onChange={setCashAccountId}
                placeholder={tUi("select.cash.account.2")}
                filter={(a) => ["Cash", "Bank"].includes(a.accountType)}
              />
            </div>
            <div>
              <Label>{tUi("description")}</Label>
              <Textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Payment for April services"
                data-testid="input-payment-desc"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={() => wrapAdminAction(() => pay.mutate(), "Record Payment")}
              disabled={!amount || !cashAccountId || pay.isPending}
              data-testid="button-save-payment"
            >
              {pay.isPending ? "Saving…" : "Record Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {AdminDialog}
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// STATEMENT VIEW (detail page)
// ─────────────────────────────────────────────────────────────
function TransporterStatement({ transporterId, onBack }: { transporterId: number; onBack: () => void }) {
  const tUi = useFactoryText();
  const { wrapAdminAction, AdminDialog } = useAdminOverride();
  const { toast } = useToast();
  const [chargeOpen, setChargeOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<(() => void) | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery<TransporterDetail>({
    queryKey: [API, transporterId],
    queryFn: () => fetch(`${API}/${transporterId}`, { credentials: "include" }).then((r) => r.json()),
  });

  const deleteTx = useMutation({
    mutationFn: (txId: number) => apiRequest("DELETE", `${API}/${transporterId}/transactions/${txId}`),
    onSuccess: () => {
      toast({ title: "Entry deleted" });
      queryClient.invalidateQueries({ queryKey: [API] });
      queryClient.invalidateQueries({ queryKey: [API, transporterId] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handlePrint = useReactToPrint({ contentRef: printRef });

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">{tUi("loading.statement.2")}</div>;
  if (!data) return <div className="p-8 text-center text-muted-foreground">{tUi("transporter.not.found")}</div>;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack} data-testid="button-back-transporters">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="text-xl font-bold">{data.name}</h2>
            {data.phone && <p className="text-sm text-muted-foreground">{data.phone}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => handlePrint()} data-testid="button-print-statement">
            <Printer className="h-4 w-4 mr-1" /> Print
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPaymentOpen(true)} data-testid="button-record-payment">
            Record Payment
          </Button>
          <Button size="sm" onClick={() => setChargeOpen(true)} data-testid="button-record-charge">
            <Plus className="h-4 w-4 mr-1" /> Record Charge
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground font-normal">{tUi("total.charged")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${fmt(data.totalCharged)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground font-normal">{tUi("total.paid.3")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${data.totalPaid > 0 ? "text-green-600 dark:text-green-400" : ""}`}>
              ${fmt(data.totalPaid)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground font-normal">{tUi("outstanding.2")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${data.outstanding > 0 ? "text-red-600 dark:text-red-400" : data.outstanding < 0 ? "text-green-600 dark:text-green-400" : ""}`}
            >
              ${fmt(data.outstanding)}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">positive = you owe them</p>
          </CardContent>
        </Card>
      </div>

      {/* Statement table */}
      <Card>
        <div ref={printRef} className="p-4">
          <div className="hidden print:block mb-4">
            <h2 className="text-lg font-bold">Transporter Statement — {data.name}</h2>
            {data.phone && <p className="text-sm">{data.phone}</p>}
          </div>
          <div className="table-responsive">
            {data.transactions.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                No transactions yet. Record a charge to get started.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-30 bg-muted/50">
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-3 py-2 font-medium">{tUi("date")}</th>
                    <th className="px-3 py-2 font-medium">{tUi("type")}</th>
                    <th className="px-3 py-2 font-medium">{tUi("description")}</th>
                    <th className="px-3 py-2 text-right font-medium">{tUi("charge")}</th>
                    <th className="px-3 py-2 text-right font-medium">{tUi("payment")}</th>
                    <th className="px-3 py-2 text-right font-medium">{tUi("balance")}</th>
                    <th className="px-3 py-2 print:hidden"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.transactions.map((tx) => (
                    <tr key={tx.id} className="border-b hover:bg-muted/30">
                      <td className="px-3 py-2 tabular-nums">{tx.txDate}</td>
                      <td className="px-3 py-2">
                        <Badge variant={tx.txType === "charge" ? "destructive" : "secondary"}>
                          {tx.txType === "charge" ? "Charge" : "Payment"}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{tx.description || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {tx.txType === "charge" ? <span>${fmt(Number(tx.amount))}</span> : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {tx.txType === "payment" ? (
                          <span className="text-green-600 dark:text-green-400">${fmt(Number(tx.amount))}</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums font-medium ${tx.runningBalance > 0 ? "text-red-600 dark:text-red-400" : tx.runningBalance < 0 ? "text-green-600 dark:text-green-400" : ""}`}
                      >
                        ${fmt(tx.runningBalance)}
                      </td>
                      <td className="px-3 py-2 print:hidden">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            wrapAdminAction(
                              () => setPendingDelete(() => () => deleteTx.mutate(tx.id)),
                              "Delete Transaction"
                            )
                          }
                          data-testid={`button-delete-tx-${tx.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="sticky bottom-0 z-20 bg-background">
                  <tr className="border-t font-semibold bg-muted/20">
                    <td className="px-3 py-2" colSpan={3}>
                      TOTALS
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">${fmt(data.totalCharged)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-green-600 dark:text-green-400">
                      ${fmt(data.totalPaid)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${data.outstanding > 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}
                    >
                      ${fmt(data.outstanding)}
                    </td>
                    <td className="print:hidden" />
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>
      </Card>

      <ChargeDialog transporterId={transporterId} open={chargeOpen} onClose={() => setChargeOpen(false)} />
      <PaymentDialog transporterId={transporterId} open={paymentOpen} onClose={() => setPaymentOpen(false)} />
      <DeleteConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        onConfirm={() => {
          pendingDelete?.();
          setPendingDelete(null);
        }}
      />
      {AdminDialog}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ADD TRANSPORTER DIALOG
// ─────────────────────────────────────────────────────────────
function AddTransporterDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const tUi = useFactoryText();
  const { wrapAdminAction, AdminDialog } = useAdminOverride();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");

  const create = useMutation({
    mutationFn: () => apiRequest("POST", API, { name, phone, notes }),
    onSuccess: () => {
      toast({ title: "Transporter created" });
      queryClient.invalidateQueries({ queryKey: [API] });
      setName("");
      setPhone("");
      setNotes("");
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{tUi("add.transporter")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{tUi("name.2")}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={tUi("transporter.name")}
                data-testid="input-transporter-name"
              />
            </div>
            <div>
              <Label>{tUi("phone")}</Label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+961 xx xxx xxx"
                data-testid="input-transporter-phone"
              />
            </div>
            <div>
              <Label>{tUi("notes")}</Label>
              <Textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                data-testid="input-transporter-notes"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              A "Transporter Agent" ledger account will be created automatically.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={() => wrapAdminAction(() => create.mutate(), "Create Transporter")}
              disabled={!name || create.isPending}
              data-testid="button-create-transporter"
            >
              {create.isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {AdminDialog}
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// MAIN PAGE — list
// ─────────────────────────────────────────────────────────────
export default function FactoryTransporters() {
  const tUi = useFactoryText();
  const { wrapAdminAction, AdminDialog } = useAdminOverride();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const { data: transporters = [], isLoading } = useQuery<Transporter[]>({
    queryKey: [API],
  });

  if (selectedId !== null) {
    return (
      <div className="p-4 sm:p-6">
        <TransporterStatement transporterId={selectedId} onBack={() => setSelectedId(null)} />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <TruckIcon className="h-6 w-6 text-orange-500" />
          <div>
            <PageHeader title={tUi("transporters")} subtitle={tUi("track.charges.and.payments.per.transporter")} />
          </div>
        </div>
        <Button onClick={() => setAddOpen(true)} size="sm" data-testid="button-add-transporter">
          <Plus className="h-4 w-4 mr-1" /> Add Transporter
        </Button>
      </div>

      {/* Summary cards */}
      {!isLoading && transporters.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-muted-foreground font-normal">{tUi("total.transporters")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{transporters.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-muted-foreground font-normal">{tUi("total.paid.3")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className={`text-2xl font-bold ${transporters.reduce((s, t) => s + t.totalPaid, 0) > 0 ? "text-green-600 dark:text-green-400" : ""}`}
              >
                ${fmt(transporters.reduce((s, t) => s + t.totalPaid, 0))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-muted-foreground font-normal">{tUi("total.outstanding")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className={`text-2xl font-bold ${transporters.reduce((s, t) => s + t.outstanding, 0) > 0 ? "text-red-600 dark:text-red-400" : ""}`}
              >
                ${fmt(transporters.reduce((s, t) => s + t.outstanding, 0))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Transporters list */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : transporters.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <TruckIcon className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium mb-1">{tUi("no.transporters.yet")}</p>
              <p className="text-xs">{tUi("add.your.first.transporter.to.start.tracking.cha")}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-30 bg-muted/50">
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-4 py-3 font-medium">{tUi("transporter")}</th>
                    <th className="px-4 py-3 font-medium">{tUi("phone")}</th>
                    <th className="px-4 py-3 text-right font-medium">{tUi("total.charged.2")}</th>
                    <th className="px-4 py-3 text-right font-medium">{tUi("total.paid")}</th>
                    <th className="px-4 py-3 text-right font-medium">{tUi("outstanding")}</th>
                  </tr>
                </thead>
                <tbody>
                  {transporters.map((t) => (
                    <tr
                      key={t.id}
                      className="border-b hover-elevate cursor-pointer"
                      onClick={() => setSelectedId(t.id)}
                      data-testid={`row-transporter-${t.id}`}
                    >
                      <td className="px-4 py-3 font-medium">{t.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{t.phone || "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums">${fmt(t.totalCharged)}</td>
                      <td
                        className={`px-4 py-3 text-right tabular-nums ${t.totalPaid > 0 ? "text-green-600 dark:text-green-400" : ""}`}
                      >
                        ${fmt(t.totalPaid)}
                      </td>
                      <td
                        className={`px-4 py-3 text-right tabular-nums font-medium ${t.outstanding > 0 ? "text-red-600 dark:text-red-400" : t.outstanding < 0 ? "text-green-600 dark:text-green-400" : ""}`}
                      >
                        ${fmt(t.outstanding)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <AddTransporterDialog open={addOpen} onClose={() => setAddOpen(false)} />
      {AdminDialog}
    </div>
  );
}
