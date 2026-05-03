import { useState, useRef, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { drCrClass } from "@/lib/formatNumber";
import { useCompany } from "@/contexts/CompanyContext";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Search,
  Plus,
  Trash2,
  TrendingUp,
  TrendingDown,
  X,
  ChevronLeft,
  FileDown,
  Printer,
} from "lucide-react";
import { PeriodFilter, PeriodFilterValue, getDefaultPeriodValue } from "@/components/ui/period-filter";
import { useDateJump } from "@/hooks/use-date-jump";
import { useReactToPrint } from "react-to-print";
import { format } from "date-fns";
import { utils, writeFile } from "@/lib/excelHelper";
import { useEscapeBack } from "@/hooks/use-escape-back";

interface Account {
  id: string;
  accountId: number;
  type: string;
  code: string;
  name: string;
  balance: number;
  balanceSide: string | null;
  openingBalance?: number;
  openingBalanceSide?: string | null;
  active: boolean;
}

interface Transaction {
  entryId: number;
  voucherId: number;
  debitAmount: string;
  creditAmount: string;
  narration: string;
  voucherNumber: string;
  voucherType: string;
  voucherDate: string;
  voucherDescription: string;
}

interface GroupedVoucher {
  voucherId: number;
  voucherNumber: string;
  voucherType: string;
  voucherDate: string;
  voucherDescription: string;
  narration: string;
  totalDebit: number;
  totalCredit: number;
  runningBalance?: number;
}

interface AgentAccount {
  id: number;
  companyId: number;
  accountId: string;
  accountType: string;
  accountName: string;
}

function parseBalance(value: any): number {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = typeof value === "string" ? parseFloat(value) : value;
  return isNaN(parsed) ? 0 : parsed;
}

export default function Agents() {
  const { selectedCompany } = useCompany();
  const { formatAmount } = useCurrencyContext();
  const { formatDisplayDate } = useDateFormat();
  const { toast } = useToast();

  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [periodFilter, setPeriodFilter] = useState<PeriodFilterValue>(() => getDefaultPeriodValue("today"));
  useDateJump((date) => setPeriodFilter({ fromDate: date, toDate: date, preset: "custom" }));
  const [agentSearch, setAgentSearch] = useState("");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const printRef = useRef<HTMLDivElement>(null);

  useEscapeBack(selectedAccount ? () => setSelectedAccount(null) : null);

  // All accounts
  const { data: allAccounts = [], isLoading: accountsLoading } = useQuery<Account[]>({
    queryKey: ["/api/accounts/all", selectedCompany?.id],
    enabled: !!selectedCompany,
  });

  // Agent account list
  const { data: agentAccountRows = [], isLoading: agentsLoading } = useQuery<AgentAccount[]>({
    queryKey: ["/api/agent-accounts"],
    enabled: !!selectedCompany,
  });

  const agentIds = useMemo(() => new Set(agentAccountRows.map((a) => a.accountId)), [agentAccountRows]);

  // Filtered agent accounts shown in left panel
  const agentAccounts = useMemo(() => {
    const searchLower = agentSearch.trim().toLowerCase();
    return allAccounts.filter((a) => {
      if (!agentIds.has(a.id)) return false;
      if (searchLower && !a.name.toLowerCase().includes(searchLower) && !a.code.toLowerCase().includes(searchLower)) return false;
      return true;
    });
  }, [allAccounts, agentIds, agentSearch]);

  // Accounts not yet added (for the add dialog)
  const availableAccounts = useMemo(() => {
    const searchLower = addSearch.trim().toLowerCase();
    return allAccounts.filter((a) => {
      if (agentIds.has(a.id)) return false;
      if (searchLower && !a.name.toLowerCase().includes(searchLower) && !a.code.toLowerCase().includes(searchLower) && !a.type.toLowerCase().includes(searchLower)) return false;
      return true;
    });
  }, [allAccounts, agentIds, addSearch]);

  // Transactions for selected account
  const accountTypeUrl = selectedAccount ? (selectedAccount.type || "").toLowerCase().replace(" ", "-") : null;
  const { data: transactions = [], isLoading: transactionsLoading } = useQuery<Transaction[]>({
    queryKey: selectedAccount
      ? [`/api/accounts/${accountTypeUrl}/${selectedAccount.accountId}/transactions`, { startDate: periodFilter.fromDate, endDate: periodFilter.toDate }]
      : [],
    queryFn: async () => {
      if (!selectedAccount) return [];
      const params = new URLSearchParams();
      if (periodFilter.fromDate) params.append("startDate", periodFilter.fromDate);
      if (periodFilter.toDate) params.append("endDate", periodFilter.toDate);
      const url = `/api/accounts/${accountTypeUrl}/${selectedAccount.accountId}/transactions${params.toString() ? `?${params.toString()}` : ""}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch transactions");
      return res.json();
    },
    enabled: !!selectedAccount,
  });

  // Pre-period balance
  const { data: prePeriodData } = useQuery<{ balance: number }>({
    queryKey: selectedAccount && periodFilter.fromDate
      ? [`/api/accounts/${accountTypeUrl}/${selectedAccount.accountId}/pre-period-balance`, { endDate: periodFilter.fromDate }]
      : [],
    queryFn: async () => {
      if (!selectedAccount || !periodFilter.fromDate) return { balance: 0 };
      const res = await fetch(
        `/api/accounts/${accountTypeUrl}/${selectedAccount.accountId}/pre-period-balance?endDate=${encodeURIComponent(periodFilter.fromDate)}`,
        { credentials: "include" }
      );
      if (!res.ok) return { balance: 0 };
      return res.json();
    },
    enabled: !!selectedAccount && !!periodFilter.fromDate,
  });

  // Add agent mutation
  const addMutation = useMutation({
    mutationFn: async (account: Account) => {
      const res = await fetch("/api/agent-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ accountId: account.id, accountType: account.type, accountName: account.name }),
      });
      if (!res.ok) throw new Error("Failed to add agent");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent-accounts"] });
      toast({ title: "Account added to Agents" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // Remove agent mutation
  const removeMutation = useMutation({
    mutationFn: async (accountId: string) => {
      const res = await fetch(`/api/agent-accounts/${encodeURIComponent(accountId)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to remove agent");
      return res.json();
    },
    onSuccess: (_, accountId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent-accounts"] });
      if (selectedAccount?.id === accountId) setSelectedAccount(null);
      toast({ title: "Account removed from Agents" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // Group transactions by voucherId
  const groupTransactions = (): GroupedVoucher[] => {
    const map = new Map<number, GroupedVoucher>();
    transactions.forEach((txn) => {
      const vid = Number(txn.voucherId);
      const debit = parseBalance(txn.debitAmount);
      const credit = parseBalance(txn.creditAmount);
      const existing = map.get(vid);
      if (existing) {
        existing.totalDebit += debit;
        existing.totalCredit += credit;
        if (!existing.narration && txn.narration) existing.narration = txn.narration;
      } else {
        map.set(vid, {
          voucherId: vid,
          voucherNumber: txn.voucherNumber,
          voucherType: txn.voucherType,
          voucherDate: txn.voucherDate,
          voucherDescription: txn.voucherDescription,
          narration: txn.voucherDescription || txn.narration || "",
          totalDebit: debit,
          totalCredit: credit,
        });
      }
    });
    return Array.from(map.values()).sort((a, b) => {
      const dc = new Date(a.voucherDate).getTime() - new Date(b.voucherDate).getTime();
      return dc !== 0 ? dc : a.voucherNumber.localeCompare(b.voucherNumber);
    });
  };

  const groupedVouchers = groupTransactions();

  const openingBalance: number = useMemo(() => {
    if (periodFilter.fromDate && prePeriodData !== undefined) return prePeriodData.balance;
    const raw = parseBalance(selectedAccount?.openingBalance ?? 0);
    if (selectedAccount?.type === "supplier") return raw;
    return selectedAccount?.openingBalanceSide === "Cr" ? -raw : raw;
  }, [periodFilter.fromDate, prePeriodData, selectedAccount]);

  const vouchersWithBalance: GroupedVoucher[] = useMemo(() => {
    let running = openingBalance;
    return groupedVouchers.map((v) => {
      if (selectedAccount?.type === "supplier") {
        running += v.totalCredit - v.totalDebit;
      } else {
        running += v.totalDebit - v.totalCredit;
      }
      return { ...v, runningBalance: running };
    });
  }, [groupedVouchers, openingBalance, selectedAccount]);

  const closingBalance = vouchersWithBalance.length > 0
    ? (vouchersWithBalance[vouchersWithBalance.length - 1].runningBalance ?? openingBalance)
    : openingBalance;

  const periodLabel = useMemo(() => {
    const hasStart = !!periodFilter.fromDate;
    const hasEnd = !!periodFilter.toDate;
    if (hasStart && hasEnd) return `${formatDisplayDate(periodFilter.fromDate)} → ${formatDisplayDate(periodFilter.toDate)}`;
    if (hasStart) return `From ${formatDisplayDate(periodFilter.fromDate)}`;
    if (hasEnd) return `Up to ${formatDisplayDate(periodFilter.toDate)}`;
    return "All dates";
  }, [periodFilter, formatDisplayDate]);

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: selectedAccount ? `Agent Statement - ${selectedAccount.name}` : "Agent Statement",
  });

  const handleExportExcel = async () => {
    if (!selectedAccount || vouchersWithBalance.length === 0) {
      toast({ title: "No data to export", variant: "destructive" });
      return;
    }
    const rows: any[][] = [["Ledger", "Type", "Debit", "Credit", "Running Balance", "Date", "Notes"]];
    const firstDate = vouchersWithBalance[0]?.voucherDate.split("T")[0] ?? "";
    const openingDateFmt = firstDate ? format(new Date(firstDate + "T00:00:00"), "dd MMM yyyy") : "";
    rows.push([selectedAccount.name, "Opening Balance", "", "", formatAmount(openingBalance), openingDateFmt, ""]);
    for (const v of vouchersWithBalance) {
      const dateFmt = format(new Date(v.voucherDate.split("T")[0] + "T00:00:00"), "dd MMM yyyy");
      const note = (v.voucherDescription?.trim()) || (v.narration?.trim()) || "";
      rows.push([selectedAccount.name, v.voucherType, v.totalDebit > 0 ? formatAmount(v.totalDebit) : "", v.totalCredit > 0 ? formatAmount(v.totalCredit) : "", formatAmount(v.runningBalance ?? 0), dateFmt, note]);
    }
    const wb = utils.book_new();
    utils.book_append_sheet(wb, { ...utils.aoa_to_sheet(rows), "!cols": [{ wch: 25 }, { wch: 14 }, { wch: 15 }, { wch: 15 }, { wch: 18 }, { wch: 14 }, { wch: 30 }] }, selectedAccount.name.substring(0, 31).replace(/[\\/*?[\]:]/g, "_"));
    await writeFile(wb, `Agent_Statement_${selectedAccount.name.replace(/[\\/*?[\]:]/g, "_").substring(0, 40)}.xlsx`);
    toast({ title: "Exported successfully" });
  };

  const handlePeriodChange = useCallback((v: PeriodFilterValue) => setPeriodFilter(v), []);

  return (
    <div className="flex h-full">
      {/* Left panel — agent account list */}
      <div className="w-72 shrink-0 border-r flex flex-col h-full overflow-hidden">
        <div className="p-4 border-b space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold text-sm">Agents</h2>
            <Button size="icon" variant="outline" onClick={() => { setAddSearch(""); setAddDialogOpen(true); }} data-testid="button-add-agent">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search agents..."
              value={agentSearch}
              onChange={(e) => setAgentSearch(e.target.value)}
              className="pl-9"
              data-testid="input-agent-search"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {agentsLoading || accountsLoading ? (
            <div className="p-4 space-y-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : agentAccounts.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {agentIds.size === 0 ? "No agents yet. Click + to add accounts." : "No accounts match your search."}
            </div>
          ) : (
            agentAccounts.map((account) => (
              <div
                key={account.id}
                className={`flex items-center border-b last:border-b-0 group ${selectedAccount?.id === account.id ? "bg-accent/40" : ""}`}
                data-testid={`agent-row-${account.id}`}
              >
                <button
                  className="flex-1 p-3 text-left hover-elevate"
                  onClick={() => setSelectedAccount(account)}
                  data-testid={`button-select-agent-${account.id}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm flex-1 truncate">{account.name}</span>
                  </div>
                  {account.balance !== 0 && (
                    <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                      {formatAmount(Math.abs(account.balance))}{" "}
                      <span className={drCrClass(account.balanceSide)}>
                        {account.balanceSide ?? ""}
                      </span>
                    </div>
                  )}
                </button>
                <button
                  className="p-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                  onClick={() => removeMutation.mutate(account.id)}
                  data-testid={`button-remove-agent-${account.id}`}
                  title="Remove from agents"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right panel — statement */}
      <div className="flex-1 overflow-y-auto p-6">
        {!selectedAccount ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center text-muted-foreground space-y-2">
              <ChevronLeft className="h-10 w-10 mx-auto opacity-30" />
              <p className="text-sm">Select an agent account to view its statement</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Account summary card */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Account</p>
                    <p className="font-semibold" data-testid="text-agent-account-name">{selectedAccount.name}</p>
                    <Badge variant="outline" className="text-xs mt-1">{selectedAccount.type}</Badge>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Current Balance</p>
                    <div className="flex items-center gap-2">
                      {selectedAccount.balanceSide?.toLowerCase() === "cr"
                        ? <TrendingDown className="w-4 h-4 text-red-600" />
                        : <TrendingUp className="w-4 h-4 text-green-600" />}
                      <span className="font-mono font-semibold" data-testid="text-agent-balance">
                        {formatAmount(Math.abs(selectedAccount.balance))}{" "}
                        <span className={drCrClass(selectedAccount.balanceSide)}>{selectedAccount.balanceSide ?? ""}</span>
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-auto">
                    <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={transactionsLoading || vouchersWithBalance.length === 0} data-testid="button-export-excel">
                      <FileDown className="h-4 w-4 mr-1" />
                      Excel
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handlePrint()} disabled={transactionsLoading} data-testid="button-print">
                      <Printer className="h-4 w-4 mr-1" />
                      Print
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setSelectedAccount(null)} data-testid="button-clear-account">
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t">
                  <PeriodFilter value={periodFilter} onChange={handlePeriodChange} />
                </div>
              </CardContent>
            </Card>

            {/* Statement table */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Ledger: {selectedAccount.name}</CardTitle>
              </CardHeader>
              <CardContent>
                {transactionsLoading ? (
                  <div className="space-y-2">
                    {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
                  </div>
                ) : (
                  <div ref={printRef} className="print-container">
                    {/* Print header */}
                    <div className="hidden print:block" style={{ marginBottom: 16 }}>
                      <div style={{ textAlign: "center" }}>
                        <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{selectedCompany?.name}</h1>
                        <h2 style={{ fontSize: 14, fontWeight: 600, margin: "4px 0 0" }}>Agent Statement: {selectedAccount.name}</h2>
                      </div>
                      <div style={{ borderTop: "1px solid #ccc", borderBottom: "1px solid #ccc", padding: "6px 0", fontSize: 11, marginTop: 8 }}>
                        <div>Period: {periodLabel}</div>
                        <div>Generated: {formatDisplayDate(new Date())}</div>
                      </div>
                    </div>

                    <div className="rounded-md border overflow-x-auto print:border-0">
                      <Table>
                        <TableHeader className="sticky top-0 z-30 bg-background">
                          <TableRow className="bg-muted/30">
                            <TableHead className="w-[110px] py-2">Date</TableHead>
                            <TableHead className="w-[100px] py-2">Type</TableHead>
                            <TableHead className="py-2">Particulars</TableHead>
                            <TableHead className="text-right w-[120px] py-2">Debit</TableHead>
                            <TableHead className="text-right w-[120px] py-2">Credit</TableHead>
                            <TableHead className="text-right w-[130px] py-2">Balance</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {/* Opening Balance */}
                          <TableRow className="bg-accent/30 border-b-2" data-testid="row-opening-balance">
                            <TableCell className="font-mono text-sm py-2" colSpan={3}>
                              <span className="font-semibold">Opening Balance</span>
                            </TableCell>
                            <TableCell className="text-right font-mono py-2">
                              {selectedAccount.type === "supplier"
                                ? openingBalance < 0 ? formatAmount(Math.abs(openingBalance)) : "-"
                                : openingBalance > 0 ? formatAmount(openingBalance) : "-"}
                            </TableCell>
                            <TableCell className="text-right font-mono py-2">
                              {selectedAccount.type === "supplier"
                                ? openingBalance > 0 ? formatAmount(openingBalance) : "-"
                                : openingBalance < 0 ? formatAmount(Math.abs(openingBalance)) : "-"}
                            </TableCell>
                            <TableCell className="text-right font-mono font-semibold py-2">
                              {formatAmount(Math.abs(openingBalance))}{" "}
                              <span className="text-xs text-muted-foreground">
                                {openingBalance >= 0 ? (selectedAccount.type === "supplier" ? "Cr" : "Dr") : (selectedAccount.type === "supplier" ? "Dr" : "Cr")}
                              </span>
                            </TableCell>
                          </TableRow>

                          {vouchersWithBalance.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                                No transactions found for this period
                              </TableCell>
                            </TableRow>
                          ) : (
                            vouchersWithBalance.map((v) => {
                              const bal = v.runningBalance ?? 0;
                              const dateKey = v.voucherDate.split("T")[0];
                              const dateFmt = format(new Date(dateKey + "T00:00:00"), "dd MMM yyyy");
                              const note = (v.narration?.trim()) || (v.voucherDescription?.trim()) || "";
                              return (
                                <TableRow key={v.voucherId} className="hover:bg-muted/30" data-testid={`row-voucher-${v.voucherId}`}>
                                  <TableCell className="font-mono text-sm py-2 whitespace-nowrap">{dateFmt}</TableCell>
                                  <TableCell className="py-2">
                                    <Badge variant="outline" className="text-xs">{v.voucherType}</Badge>
                                  </TableCell>
                                  <TableCell className="py-2 text-sm">
                                    <div className="font-medium text-xs text-muted-foreground">{v.voucherNumber}</div>
                                    {note && <div className="text-xs text-muted-foreground mt-0.5 truncate max-w-xs">{note}</div>}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-sm py-2">
                                    {v.totalDebit > 0 ? formatAmount(v.totalDebit) : "-"}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-sm py-2">
                                    {v.totalCredit > 0 ? formatAmount(v.totalCredit) : "-"}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-sm py-2 font-medium">
                                    {formatAmount(Math.abs(bal))}{" "}
                                    <span className={`text-xs ${bal >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>
                                      {bal >= 0
                                        ? (selectedAccount.type === "supplier" ? "Cr" : "Dr")
                                        : (selectedAccount.type === "supplier" ? "Dr" : "Cr")}
                                    </span>
                                  </TableCell>
                                </TableRow>
                              );
                            })
                          )}

                          {/* Closing Balance */}
                          {vouchersWithBalance.length > 0 && (
                            <TableRow className="bg-accent/30 border-t-2 font-semibold" data-testid="row-closing-balance">
                              <TableCell colSpan={3} className="py-2 text-sm">Closing Balance</TableCell>
                              <TableCell className="text-right font-mono py-2">
                                {formatAmount(vouchersWithBalance.reduce((s, v) => s + v.totalDebit, 0))}
                              </TableCell>
                              <TableCell className="text-right font-mono py-2">
                                {formatAmount(vouchersWithBalance.reduce((s, v) => s + v.totalCredit, 0))}
                              </TableCell>
                              <TableCell className="text-right font-mono py-2">
                                {formatAmount(Math.abs(closingBalance))}{" "}
                                <span className="text-xs text-muted-foreground">
                                  {closingBalance >= 0
                                    ? (selectedAccount.type === "supplier" ? "Cr" : "Dr")
                                    : (selectedAccount.type === "supplier" ? "Dr" : "Cr")}
                                </span>
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Add account dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Account to Agents</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, code or type..."
                value={addSearch}
                onChange={(e) => setAddSearch(e.target.value)}
                className="pl-9"
                autoFocus
                data-testid="input-add-agent-search"
              />
            </div>
            <div className="max-h-80 overflow-y-auto border rounded-md divide-y">
              {accountsLoading ? (
                <div className="p-4 space-y-2">
                  {[1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full" />)}
                </div>
              ) : availableAccounts.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">No accounts found</div>
              ) : (
                availableAccounts.slice(0, 100).map((account) => (
                  <button
                    key={account.id}
                    className="w-full p-3 text-left hover-elevate flex items-center gap-2"
                    onClick={() => {
                      addMutation.mutate(account);
                      setAddDialogOpen(false);
                    }}
                    data-testid={`button-add-account-${account.id}`}
                  >
                    <span className="text-sm flex-1">{account.name}</span>
                    {account.balance !== 0 && (
                      <span className="text-xs tabular-nums text-muted-foreground shrink-0">
                        {formatAmount(Math.abs(account.balance))}{" "}
                        <span className={drCrClass(account.balanceSide)}>{account.balanceSide ?? ""}</span>
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
