import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { useEscapeBack } from "@/hooks/use-escape-back";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, FileText, User, Download, FileSpreadsheet } from "lucide-react";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { drCrClass } from "@/lib/formatNumber";
import { useState, useEffect } from "react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface CustomerInfo {
  id: number;
  code: string;
  legalName: string;
  phone: string | null;
  openingBalance: string | null;
  openingBalanceSide: string | null;
  active: boolean;
  statementNote: string | null;
}

interface Invoice {
  id: number;
  invoiceNumber: string;
  orderDate: string;
  grandTotal: string;
  subtotalBales: string;
  freightAmount: string;
  otherChargesTotal: string;
  totalQtyBales: number;
  containerNumber: string | null;
  status: string;
  createdAt: string;
}

interface BalanceEntry {
  id: number;
  transactionDate: string;
  transactionType: string;
  description: string | null;
  referenceType: string | null;
  referenceId: number | null;
  debitAmount: string;
  creditAmount: string;
  balance: string;
  currency: string;
  containerNumber: string | null;
  runningBalance: number;
  runningBalanceSide: string;
  rowNote: string | null;
}

interface StatementData {
  customer: CustomerInfo;
  invoices: Invoice[];
  balanceHistory: BalanceEntry[];
  currentBalance: number;
  currentBalanceSide: string;
  openingBalance: number;
  openingBalanceSide: string;
}

function fmtMoney(value: number): string {
  const abs = Math.abs(value);
  if (abs % 1 === 0) {
    return `$${Math.round(abs).toLocaleString()}`;
  }
  return `$${abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function FactoryCustomerStatement() {
  const { formatDisplayDate } = useDateFormat();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  useEscapeBack(() => navigate("/factory/customers"));
  const params = useParams<{ id: string }>();
  const customerId = params.id;
  const [activeTab, setActiveTab] = useState<"invoices" | "statement">("invoices");
  const [draftNote, setDraftNote] = useState<string | null>(null); // null = not yet loaded
  const [rowNotes, setRowNotes] = useState<Record<number, string>>({}); // per-entry draft notes
  const [savingRowNote, setSavingRowNote] = useState<number | null>(null);

  const { data: statement, isLoading } = useQuery<StatementData>({
    queryKey: [`/api/factory/customers/${customerId}/statement`],
    enabled: !!customerId,
  });

  // Initialise draft note and row notes once data loads
  useEffect(() => {
    if (statement?.customer && draftNote === null) {
      setDraftNote(statement.customer.statementNote ?? "");
    }
    if (statement?.balanceHistory) {
      setRowNotes((prev) => {
        const next = { ...prev };
        for (const entry of statement.balanceHistory) {
          if (!(entry.id in next)) {
            next[entry.id] = entry.rowNote ?? "";
          }
        }
        return next;
      });
    }
  }, [statement]);

  const saveNoteMutation = useMutation({
    mutationFn: async (note: string) => {
      await apiRequest("PATCH", `/api/factory/customers/${customerId}/statement-note`, { statementNote: note });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/factory/customers/${customerId}/statement`] });
      toast({ title: "Note saved" });
    },
    onError: () => {
      toast({ title: "Failed to save note", variant: "destructive" });
    },
  });

  const saveRowNote = async (entryId: number, note: string) => {
    const original = statement?.balanceHistory.find((e) => e.id === entryId)?.rowNote ?? "";
    if (note === original) return;
    setSavingRowNote(entryId);
    try {
      await apiRequest("PATCH", `/api/factory/customers/${customerId}/balance/${entryId}/note`, { rowNote: note });
      queryClient.invalidateQueries({ queryKey: [`/api/factory/customers/${customerId}/statement`] });
    } catch {
      toast({ title: "Failed to save row note", variant: "destructive" });
    } finally {
      setSavingRowNote(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col h-full p-6 space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!statement) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6">
        <p className="text-muted-foreground" data-testid="text-not-found">Customer not found</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/factory/customers")} data-testid="button-back">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Customers
        </Button>
      </div>
    );
  }

  const { customer, invoices, balanceHistory, currentBalance, currentBalanceSide, openingBalance, openingBalanceSide } = statement;
  const hasOpeningBalance = Number(openingBalance || 0) !== 0;

  return (
    <div className="flex flex-col h-full p-6 overflow-y-auto">
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/factory/customers")}
          data-testid="button-back"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-bold" data-testid="text-customer-name">
              {customer.legalName}
            </h1>
            <Badge variant={customer.active ? "default" : "secondary"} data-testid="badge-customer-status">
              {customer.active ? "Active" : "Inactive"}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm mt-1" data-testid="text-customer-code">
            {customer.code}{customer.phone ? ` · ${customer.phone}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (!navigator.onLine) { window.print(); return; }
              window.open(`/api/factory/customers/${customerId}/statement/export-pdf`, "_blank");
            }}
            data-testid="button-export-pdf"
          >
            <Download className="mr-2 h-4 w-4" />
            Export PDF
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open(`/api/factory/customers/${customerId}/statement/export-excel`, "_blank")}
            data-testid="button-export-excel"
          >
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            Export Excel
          </Button>
        </div>
      </div>

      <div className={`grid grid-cols-1 gap-4 mb-6 ${hasOpeningBalance ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground mb-1">Current Balance</p>
            <p className="text-2xl font-bold font-mono" data-testid="text-current-balance">
              {fmtMoney(currentBalance)}
            </p>
            <Badge variant="outline" className="mt-1 text-xs" data-testid="badge-balance-side">{currentBalanceSide}</Badge>
          </CardContent>
        </Card>
        {hasOpeningBalance && (
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground mb-1">Opening Balance</p>
              <p className="text-xl font-semibold font-mono" data-testid="text-opening-balance">
                {fmtMoney(Number(openingBalance || 0))}
              </p>
              <Badge variant="outline" className="mt-1 text-xs">{openingBalanceSide}</Badge>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground mb-1">Total Invoices</p>
            <p className="text-2xl font-bold" data-testid="text-total-invoices">{invoices.length}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <Button
          variant={activeTab === "invoices" ? "default" : "outline"}
          size="sm"
          onClick={() => setActiveTab("invoices")}
          data-testid="button-tab-invoices"
        >
          <FileText className="mr-2 h-4 w-4" />
          Invoices ({invoices.length})
        </Button>
        <Button
          variant={activeTab === "statement" ? "default" : "outline"}
          size="sm"
          onClick={() => setActiveTab("statement")}
          data-testid="button-tab-statement"
        >
          <User className="mr-2 h-4 w-4" />
          Statement ({balanceHistory.length})
        </Button>
      </div>

      {activeTab === "invoices" && (
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Container</TableHead>
                <TableHead className="text-right">Bales</TableHead>
                <TableHead className="text-right">Subtotal</TableHead>
                <TableHead className="text-right">Charges</TableHead>
                <TableHead className="text-right">Grand Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8" data-testid="text-no-invoices">
                    No finalized invoices yet
                  </TableCell>
                </TableRow>
              ) : (
                invoices.map((inv) => (
                  <TableRow
                    key={inv.id}
                    className="cursor-pointer hover-elevate"
                    onClick={() => navigate(`/factory/sales/invoices/${inv.id}`)}
                    data-testid={`row-invoice-${inv.id}`}
                  >
                    <TableCell className="font-mono font-semibold" data-testid={`text-invoice-number-${inv.id}`}>
                      {inv.invoiceNumber || `#${inv.id}`}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground" data-testid={`text-invoice-date-${inv.id}`}>
                      {inv.orderDate ? formatDisplayDate(inv.orderDate) : "-"}
                    </TableCell>
                    <TableCell className="text-sm font-mono text-muted-foreground" data-testid={`text-invoice-container-${inv.id}`}>
                      {inv.containerNumber || "-"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm" data-testid={`text-invoice-bales-${inv.id}`}>
                      {inv.totalQtyBales ?? "-"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm" data-testid={`text-invoice-subtotal-${inv.id}`}>
                      {fmtMoney(Number(inv.subtotalBales || 0))}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm" data-testid={`text-invoice-charges-${inv.id}`}>
                      {fmtMoney(Number(inv.freightAmount || 0) + Number(inv.otherChargesTotal || 0))}
                    </TableCell>
                    <TableCell className="text-right font-mono font-bold" data-testid={`text-invoice-total-${inv.id}`}>
                      {fmtMoney(Number(inv.grandTotal || 0))}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      )}

      {activeTab === "statement" && (
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Container</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Credit</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead>Side</TableHead>
                <TableHead className="min-w-[160px]">Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {balanceHistory.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8" data-testid="text-no-transactions">
                    No transactions yet
                  </TableCell>
                </TableRow>
              ) : (
                balanceHistory.map((entry) => (
                  <TableRow key={entry.id} data-testid={`row-balance-${entry.id}`}>
                    <TableCell className="text-sm font-mono" data-testid={`text-balance-date-${entry.id}`}>
                      {entry.transactionDate ? formatDisplayDate(entry.transactionDate) : "-"}
                    </TableCell>
                    <TableCell data-testid={`text-balance-type-${entry.id}`}>
                      <Badge variant="outline" className="text-xs">{entry.transactionType}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground" dir="ltr" data-testid={`text-balance-desc-${entry.id}`}>
                      {entry.description || "-"}
                    </TableCell>
                    <TableCell className="text-sm font-mono text-muted-foreground" data-testid={`text-balance-container-${entry.id}`}>
                      {entry.containerNumber || "-"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm" data-testid={`text-balance-debit-${entry.id}`}>
                      {Number(entry.debitAmount || 0) > 0
                        ? fmtMoney(Number(entry.debitAmount))
                        : "-"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm" data-testid={`text-balance-credit-${entry.id}`}>
                      {Number(entry.creditAmount || 0) > 0
                        ? fmtMoney(Number(entry.creditAmount))
                        : "-"}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold" data-testid={`text-balance-running-${entry.id}`}>
                      {fmtMoney(Math.abs(entry.runningBalance))}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs font-semibold ${drCrClass(entry.runningBalanceSide)}`}>{entry.runningBalanceSide}</Badge>
                    </TableCell>
                    <TableCell className="min-w-[160px]">
                      <input
                        type="text"
                        value={rowNotes[entry.id] ?? ""}
                        onChange={(e) => setRowNotes((prev) => ({ ...prev, [entry.id]: e.target.value }))}
                        onBlur={() => saveRowNote(entry.id, rowNotes[entry.id] ?? "")}
                        placeholder="Add note…"
                        disabled={savingRowNote === entry.id}
                        className="w-full text-xs bg-transparent border border-border rounded px-2 py-1 placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                        data-testid={`input-row-note-${entry.id}`}
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Statement Note */}
      <Card className="mt-4">
        <CardContent className="p-4 space-y-2">
          <p className="text-sm font-semibold">Statement Note</p>
          <p className="text-xs text-muted-foreground">This note appears on exported PDF and Excel statements.</p>
          <Textarea
            value={draftNote ?? ""}
            onChange={(e) => setDraftNote(e.target.value)}
            placeholder="Add a note for this customer's statement..."
            rows={3}
            data-testid="textarea-statement-note"
          />
          <Button
            size="sm"
            onClick={() => saveNoteMutation.mutate(draftNote ?? "")}
            disabled={saveNoteMutation.isPending}
            data-testid="button-save-statement-note"
          >
            {saveNoteMutation.isPending ? "Saving…" : "Save Note"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
