import { useState, useRef, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { drCrClass } from "@/lib/formatNumber";
import { useCompany } from "@/contexts/CompanyContext";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Search,
  Plus,
  Trash2,
  TrendingUp,
  TrendingDown,
  X,
  FileDown,
  Printer,
  Users,
  ArrowRightLeft,
  BookOpen,
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

const VOUCHER_TYPE_COLORS: Record<string, string> = {
  Payment: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  Receipt: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  Journal: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  Invoice: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  Purchase: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
};

function voucherBadgeClass(type: string) {
  return VOUCHER_TYPE_COLORS[type] ?? "bg-muted text-muted-foreground";
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

  // /api/accounts/all returns { accounts: [...], asOfDate } — extract the array.
  const { data: allAccounts = [], isLoading: accountsLoading } = useQuery<Account[]>({
    queryKey: ["/api/accounts/all", selectedCompany?.id],
    queryFn: async () => {
      const response = await fetch("/api/accounts/all");
      if (!response.ok) throw new Error("Failed to fetch accounts");
      const data = await response.json();
      return Array.isArray(data) ? data : (data.accounts ?? []);
    },
    enabled: !!selectedCompany,
  });

  const { data: agentAccountRows = [], isLoading: agentsLoading } = useQuery<AgentAccount[]>({
    queryKey: ["/api/agent-accounts"],
    enabled: !!selectedCompany,
  });

  const agentIds = useMemo(() => new Set(agentAccountRows.map((a) => a.accountId)), [agentAccountRows]);

  const agentAccounts = useMemo(() => {
    const searchLower = agentSearch.trim().toLowerCase();
    return allAccounts.filter((a) => {
      if (!agentIds.has(a.id)) return false;
      if (searchLower && !a.name.toLowerCase().includes(searchLower) && !a.code.toLowerCase().includes(searchLower))
        return false;
      return true;
    });
  }, [allAccounts, agentIds, agentSearch]);

  const availableAccounts = useMemo(() => {
    const searchLower = addSearch.trim().toLowerCase();
    return allAccounts.filter((a) => {
      if (agentIds.has(a.id)) return false;
      if (
        searchLower &&
        !a.name.toLowerCase().includes(searchLower) &&
        !a.code.toLowerCase().includes(searchLower) &&
        !a.type.toLowerCase().includes(searchLower)
      )
        return false;
      return true;
    });
  }, [allAccounts, agentIds, addSearch]);

  const accountTypeUrl = selectedAccount ? (selectedAccount.type || "").toLowerCase().replace(" ", "-") : null;
  const { data: transactions = [], isLoading: transactionsLoading } = useQuery<Transaction[]>({
    queryKey: selectedAccount
      ? [
          `/api/accounts/${accountTypeUrl}/${selectedAccount.accountId}/transactions`,
          { startDate: periodFilter.fromDate, endDate: periodFilter.toDate },
        ]
      : [],
    queryFn: async () => {
      if (!selectedAccount) return [];
      const params = new URLSearchParams();
      if (periodFilter.fromDate) params.append("startDate", periodFilter.fromDate);
      if (periodFilter.toDate) params.append("endDate", periodFilter.toDate);
      const url = `/api/accounts/${accountTypeUrl}/${selectedAccount.accountId}/transactions${params.toString() ? `?${params.toString()}` : ""}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch transactions");
      const data = await res.json();
      return Array.isArray(data) ? data : (data.transactions ?? []);
    },
    enabled: !!selectedAccount,
  });

  const { data: prePeriodData } = useQuery<{ balance: number }>({
    queryKey:
      selectedAccount && periodFilter.fromDate
        ? [
            `/api/accounts/${accountTypeUrl}/${selectedAccount.accountId}/pre-period-balance`,
            { endDate: periodFilter.fromDate },
          ]
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
      toast({ title: "Account added to Agent Ledger" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

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
      toast({ title: "Account removed from Agent Ledger" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

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

  const closingBalance =
    vouchersWithBalance.length > 0
      ? (vouchersWithBalance[vouchersWithBalance.length - 1].runningBalance ?? openingBalance)
      : openingBalance;

  const periodDebit = vouchersWithBalance.reduce((s, v) => s + v.totalDebit, 0);
  const periodCredit = vouchersWithBalance.reduce((s, v) => s + v.totalCredit, 0);

  const periodLabel = useMemo(() => {
    const hasStart = !!periodFilter.fromDate;
    const hasEnd = !!periodFilter.toDate;
    if (hasStart && hasEnd)
      return `${formatDisplayDate(periodFilter.fromDate)} → ${formatDisplayDate(periodFilter.toDate)}`;
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
      const note = v.voucherDescription?.trim() || v.narration?.trim() || "";
      rows.push([
        selectedAccount.name,
        v.voucherType,
        v.totalDebit > 0 ? formatAmount(v.totalDebit) : "",
        v.totalCredit > 0 ? formatAmount(v.totalCredit) : "",
        formatAmount(v.runningBalance ?? 0),
        dateFmt,
        note,
      ]);
    }
    const wb = utils.book_new();
    utils.book_append_sheet(
      wb,
      {
        ...utils.aoa_to_sheet(rows),
        "!cols": [{ wch: 25 }, { wch: 14 }, { wch: 15 }, { wch: 15 }, { wch: 18 }, { wch: 14 }, { wch: 30 }],
      },
      selectedAccount.name.substring(0, 31).replace(/[\\/*?[\]:]/g, "_")
    );
    await writeFile(wb, `Agent_Statement_${selectedAccount.name.replace(/[\\/*?[\]:]/g, "_").substring(0, 40)}.xlsx`);
    toast({ title: "Exported successfully" });
  };

  const handlePeriodChange = useCallback((v: PeriodFilterValue) => setPeriodFilter(v), []);

  return (
    <div className="flex h-full">
      {/* Left panel — agent list */}
      <div className="w-64 shrink-0 border-r flex flex-col h-full overflow-hidden">
        {/* Panel header */}
        <div className="px-4 py-3 border-b space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">Agent Ledger</span>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => {
                setAddSearch("");
                setAddDialogOpen(true);
              }}
              data-testid="button-add-agent"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search agents..."
              value={agentSearch}
              onChange={(e) => setAgentSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
              data-testid="input-agent-search"
            />
          </div>
        </div>

        {/* Agent list */}
        <div className="flex-1 overflow-y-auto">
          {agentsLoading || accountsLoading ? (
            <div className="p-3 space-y-1.5">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-12 w-full rounded-lg" />
              ))}
            </div>
          ) : agentAccounts.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 px-4 text-center">
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                <Users className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">{agentIds.size === 0 ? "No agents yet" : "No results"}</p>
              <p className="text-xs text-muted-foreground">
                {agentIds.size === 0 ? "Click + to pin an account as an agent" : "Try a different search"}
              </p>
            </div>
          ) : (
            <div className="p-2 space-y-0.5">
              {agentAccounts.map((account) => {
                const isSelected = selectedAccount?.id === account.id;
                return (
                  <div
                    key={account.id}
                    className={`flex items-center rounded-lg group ${isSelected ? "bg-accent/50" : ""}`}
                    data-testid={`agent-row-${account.id}`}
                  >
                    <button
                      className={`flex-1 px-3 py-2.5 text-left rounded-lg hover-elevate min-w-0`}
                      onClick={() => setSelectedAccount(account)}
                      data-testid={`button-select-agent-${account.id}`}
                    >
                      <p className="text-sm font-medium truncate leading-tight">{account.name}</p>
                      {account.balance !== 0 && (
                        <p className="text-xs tabular-nums text-muted-foreground mt-0.5">
                          {formatAmount(Math.abs(account.balance))}{" "}
                          <span className={drCrClass(account.balanceSide)}>{account.balanceSide ?? ""}</span>
                        </p>
                      )}
                    </button>
                    <button
                      className="p-2 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => removeMutation.mutate(account.id)}
                      data-testid={`button-remove-agent-${account.id}`}
                      title="Remove from Agent Ledger"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right panel — statement */}
      <div className="flex-1 overflow-y-auto">
        {!selectedAccount ? (
          <div className="h-full flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                <BookOpen className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">No agent selected</p>
              <p className="text-xs text-muted-foreground">
                Pick an agent from the list to view their ledger statement
              </p>
            </div>
          </div>
        ) : (
          <div className="p-6 space-y-5">
            {/* Header row */}
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg font-semibold" data-testid="text-agent-account-name">
                    {selectedAccount.name}
                  </h2>
                  <Badge
                    variant="secondary"
                    className="text-xs no-default-active-elevate bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 capitalize"
                  >
                    {selectedAccount.type}
                  </Badge>
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  {selectedAccount.balanceSide?.toLowerCase() === "cr" ? (
                    <TrendingDown className="w-3.5 h-3.5 text-red-500" />
                  ) : (
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
                  )}
                  <span className="text-sm font-mono font-semibold" data-testid="text-agent-balance">
                    {formatAmount(Math.abs(selectedAccount.balance))}
                  </span>
                  <span className={`text-xs ${drCrClass(selectedAccount.balanceSide)}`}>
                    {selectedAccount.balanceSide ?? ""}
                  </span>
                  <span className="text-xs text-muted-foreground">current balance</span>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportExcel}
                  disabled={transactionsLoading || vouchersWithBalance.length === 0}
                  data-testid="button-export-excel"
                >
                  <FileDown className="h-3.5 w-3.5 mr-1.5" />
                  Excel
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePrint()}
                  disabled={transactionsLoading}
                  data-testid="button-print"
                >
                  <Printer className="h-3.5 w-3.5 mr-1.5" />
                  Print
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setSelectedAccount(null)}
                  data-testid="button-clear-account"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Period filter */}
            <div>
              <PeriodFilter value={periodFilter} onChange={handlePeriodChange} />
            </div>

            {/* Stats pills */}
            <div className="flex flex-wrap gap-3">
              <div className="flex items-center gap-3 rounded-lg border bg-muted/40 px-4 py-2">
                <ArrowRightLeft className="h-4 w-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground leading-none mb-1">Opening Balance</p>
                  <p className="text-sm font-semibold font-mono leading-none">
                    {formatAmount(Math.abs(openingBalance))}{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      {openingBalance >= 0
                        ? selectedAccount.type === "supplier"
                          ? "Cr"
                          : "Dr"
                        : selectedAccount.type === "supplier"
                          ? "Dr"
                          : "Cr"}
                    </span>
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-lg border bg-muted/40 px-4 py-2">
                <TrendingDown className="h-4 w-4 text-red-500 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground leading-none mb-1">Period Debit</p>
                  <p className="text-sm font-semibold font-mono leading-none">{formatAmount(periodDebit)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-lg border bg-muted/40 px-4 py-2">
                <TrendingUp className="h-4 w-4 text-emerald-600 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground leading-none mb-1">Period Credit</p>
                  <p className="text-sm font-semibold font-mono leading-none">{formatAmount(periodCredit)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-lg border bg-muted/40 px-4 py-2">
                <ArrowRightLeft className="h-4 w-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground leading-none mb-1">Closing Balance</p>
                  <p
                    className={`text-sm font-semibold font-mono leading-none ${closingBalance >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
                  >
                    {formatAmount(Math.abs(closingBalance))}{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      {closingBalance >= 0
                        ? selectedAccount.type === "supplier"
                          ? "Cr"
                          : "Dr"
                        : selectedAccount.type === "supplier"
                          ? "Dr"
                          : "Cr"}
                    </span>
                  </p>
                </div>
              </div>
            </div>

            {/* Ledger table */}
            <div ref={printRef} className="print-container">
              {/* Print-only header */}
              <div className="hidden print:block mb-4">
                <div className="text-center">
                  <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{selectedCompany?.name}</h1>
                  <h2 style={{ fontSize: 14, fontWeight: 600, margin: "4px 0 0" }}>
                    Agent Ledger: {selectedAccount.name}
                  </h2>
                </div>
                <div
                  style={{
                    borderTop: "1px solid #ccc",
                    borderBottom: "1px solid #ccc",
                    padding: "6px 0",
                    fontSize: 11,
                    marginTop: 8,
                  }}
                >
                  <div>Period: {periodLabel}</div>
                  <div>Generated: {formatDisplayDate(new Date())}</div>
                </div>
              </div>

              <div className="border rounded-xl overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="text-xs h-9 font-semibold w-[120px]">Date</TableHead>
                      <TableHead className="text-xs h-9 font-semibold w-[110px]">Type</TableHead>
                      <TableHead className="text-xs h-9 font-semibold">Particulars</TableHead>
                      <TableHead className="text-xs h-9 font-semibold text-right w-[130px]">Debit</TableHead>
                      <TableHead className="text-xs h-9 font-semibold text-right w-[130px]">Credit</TableHead>
                      <TableHead className="text-xs h-9 font-semibold text-right w-[140px]">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transactionsLoading ? (
                      [...Array(5)].map((_, i) => (
                        <TableRow key={i}>
                          <TableCell>
                            <Skeleton className="h-4 w-24" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-4 w-16" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-4 w-40" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-4 w-20 ml-auto" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-4 w-20 ml-auto" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-4 w-24 ml-auto" />
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <>
                        {/* Opening Balance row */}
                        <TableRow
                          className="bg-muted/40 hover:bg-muted/40 font-semibold"
                          data-testid="row-opening-balance"
                        >
                          <TableCell
                            className="py-2.5 text-xs text-muted-foreground uppercase tracking-wide"
                            colSpan={3}
                          >
                            Opening Balance
                          </TableCell>
                          <TableCell className="py-2.5 text-right font-mono text-sm">
                            {selectedAccount.type === "supplier"
                              ? openingBalance < 0
                                ? formatAmount(Math.abs(openingBalance))
                                : "-"
                              : openingBalance > 0
                                ? formatAmount(openingBalance)
                                : "-"}
                          </TableCell>
                          <TableCell className="py-2.5 text-right font-mono text-sm">
                            {selectedAccount.type === "supplier"
                              ? openingBalance > 0
                                ? formatAmount(openingBalance)
                                : "-"
                              : openingBalance < 0
                                ? formatAmount(Math.abs(openingBalance))
                                : "-"}
                          </TableCell>
                          <TableCell className="py-2.5 text-right font-mono text-sm">
                            {formatAmount(Math.abs(openingBalance))}{" "}
                            <span className="text-xs text-muted-foreground font-normal">
                              {openingBalance >= 0
                                ? selectedAccount.type === "supplier"
                                  ? "Cr"
                                  : "Dr"
                                : selectedAccount.type === "supplier"
                                  ? "Dr"
                                  : "Cr"}
                            </span>
                          </TableCell>
                        </TableRow>

                        {vouchersWithBalance.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={6}>
                              <div className="flex flex-col items-center gap-2 py-10 text-center">
                                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                                  <ArrowRightLeft className="h-5 w-5 text-muted-foreground" />
                                </div>
                                <p className="text-sm font-medium">No transactions</p>
                                <p className="text-xs text-muted-foreground">No activity in this period</p>
                              </div>
                            </TableCell>
                          </TableRow>
                        ) : (
                          vouchersWithBalance.map((v) => {
                            const bal = v.runningBalance ?? 0;
                            const dateKey = v.voucherDate.split("T")[0];
                            const dateFmt = format(new Date(dateKey + "T00:00:00"), "dd MMM yyyy");
                            const note = v.narration?.trim() || v.voucherDescription?.trim() || "";
                            return (
                              <TableRow
                                key={v.voucherId}
                                className="hover:bg-muted/30"
                                data-testid={`row-voucher-${v.voucherId}`}
                              >
                                <TableCell className="py-2.5 font-mono text-sm whitespace-nowrap">{dateFmt}</TableCell>
                                <TableCell className="py-2.5">
                                  <Badge
                                    variant="secondary"
                                    className={`text-xs no-default-active-elevate ${voucherBadgeClass(v.voucherType)}`}
                                  >
                                    {v.voucherType}
                                  </Badge>
                                </TableCell>
                                <TableCell className="py-2.5">
                                  <p className="text-xs text-muted-foreground font-mono">{v.voucherNumber}</p>
                                  {note && (
                                    <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-xs">{note}</p>
                                  )}
                                </TableCell>
                                <TableCell className="py-2.5 text-right font-mono text-sm">
                                  {v.totalDebit > 0 ? (
                                    formatAmount(v.totalDebit)
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </TableCell>
                                <TableCell className="py-2.5 text-right font-mono text-sm">
                                  {v.totalCredit > 0 ? (
                                    formatAmount(v.totalCredit)
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </TableCell>
                                <TableCell className="py-2.5 text-right font-mono text-sm font-medium">
                                  {formatAmount(Math.abs(bal))}{" "}
                                  <span
                                    className={`text-xs font-normal ${bal >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}
                                  >
                                    {bal >= 0
                                      ? selectedAccount.type === "supplier"
                                        ? "Cr"
                                        : "Dr"
                                      : selectedAccount.type === "supplier"
                                        ? "Dr"
                                        : "Cr"}
                                  </span>
                                </TableCell>
                              </TableRow>
                            );
                          })
                        )}

                        {/* Closing Balance row */}
                        {vouchersWithBalance.length > 0 && (
                          <TableRow
                            className="bg-muted/40 hover:bg-muted/40 font-semibold"
                            data-testid="row-closing-balance"
                          >
                            <TableCell
                              colSpan={3}
                              className="py-2.5 text-xs text-muted-foreground uppercase tracking-wide"
                            >
                              Closing Balance
                            </TableCell>
                            <TableCell className="py-2.5 text-right font-mono text-sm">
                              {formatAmount(periodDebit)}
                            </TableCell>
                            <TableCell className="py-2.5 text-right font-mono text-sm">
                              {formatAmount(periodCredit)}
                            </TableCell>
                            <TableCell className="py-2.5 text-right font-mono text-sm">
                              {formatAmount(Math.abs(closingBalance))}{" "}
                              <span className="text-xs text-muted-foreground font-normal">
                                {closingBalance >= 0
                                  ? selectedAccount.type === "supplier"
                                    ? "Cr"
                                    : "Dr"
                                  : selectedAccount.type === "supplier"
                                    ? "Dr"
                                    : "Cr"}
                              </span>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Add account dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Account to Agent Ledger</DialogTitle>
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
            <div className="max-h-80 overflow-y-auto border rounded-xl divide-y">
              {accountsLoading ? (
                <div className="p-4 space-y-2">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-8 w-full" />
                  ))}
                </div>
              ) : availableAccounts.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">No accounts found</div>
              ) : (
                availableAccounts.slice(0, 100).map((account) => (
                  <button
                    key={account.id}
                    className="w-full px-4 py-3 text-left hover-elevate flex items-center gap-2"
                    onClick={() => {
                      addMutation.mutate(account);
                      setAddDialogOpen(false);
                    }}
                    data-testid={`button-add-account-${account.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{account.name}</p>
                      <p className="text-xs text-muted-foreground capitalize">{account.type}</p>
                    </div>
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
