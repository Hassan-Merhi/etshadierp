import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Calendar, DollarSign, TrendingUp, TrendingDown } from "lucide-react";
import { format } from "date-fns";

interface Account {
  id: string;
  accountId: number;
  type: string;
  code: string;
  name: string;
  balance: number;
  balanceSide: string | null;
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

export default function Accounts() {
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const { data: accounts = [], isLoading: accountsLoading } = useQuery<Account[]>({
    queryKey: ["/api/accounts/all"],
  });

  const { data: transactions = [], isLoading: transactionsLoading } = useQuery<Transaction[]>({
    queryKey: selectedAccount
      ? [
          `/api/accounts/${selectedAccount.type.toLowerCase().replace(" ", "-")}/${selectedAccount.accountId}/transactions`,
          { startDate, endDate },
        ]
      : [],
    queryFn: async () => {
      if (!selectedAccount) return [];
      
      const params = new URLSearchParams();
      if (startDate) params.append("startDate", startDate);
      if (endDate) params.append("endDate", endDate);
      
      let accountType = selectedAccount.type.toLowerCase();
      if (accountType === "fixed asset") {
        accountType = "fixed-asset";
      }
      
      const url = `/api/accounts/${accountType}/${selectedAccount.accountId}/transactions${
        params.toString() ? `?${params.toString()}` : ""
      }`;
      
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch transactions");
      return await response.json();
    },
    enabled: !!selectedAccount,
  });

  const handleAccountChange = (accountId: string) => {
    const account = accounts.find((a) => a.id === accountId);
    setSelectedAccount(account || null);
    setSearchTerm("");
  };

  const filteredAccounts = accounts.filter((account) => {
    const searchLower = searchTerm.toLowerCase();
    return (
      account.name.toLowerCase().includes(searchLower) ||
      account.code.toLowerCase().includes(searchLower) ||
      account.type.toLowerCase().includes(searchLower)
    );
  });

  const calculateRunningBalance = () => {
    let runningBalance = selectedAccount?.balance || 0;
    return transactions.map((transaction) => {
      const debit = parseFloat(transaction.debitAmount || "0");
      const credit = parseFloat(transaction.creditAmount || "0");
      runningBalance += debit - credit;
      return {
        ...transaction,
        runningBalance,
      };
    });
  };

  const transactionsWithBalance = calculateRunningBalance();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Accounts Overview</h1>
        <p className="text-sm text-muted-foreground mt-1">
          View all accounts, balances, and transaction history
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Select Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="account-search">Search & Select Account</Label>
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="account-search"
                  placeholder="Search by name, code, or type..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                  data-testid="input-account-search"
                />
              </div>
              
              {accountsLoading ? (
                <div className="p-4">
                  <Skeleton className="h-8 w-full" />
                </div>
              ) : (
                <div className="max-h-64 overflow-y-auto border rounded-md">
                  {filteredAccounts.length === 0 ? (
                    <div className="p-4 text-center text-sm text-muted-foreground">
                      No accounts found
                    </div>
                  ) : (
                    filteredAccounts.map((account) => (
                      <button
                        key={account.id}
                        onClick={() => handleAccountChange(account.id)}
                        className={`w-full p-3 text-left hover-elevate border-b last:border-b-0 ${
                          selectedAccount?.id === account.id
                            ? "bg-accent"
                            : ""
                        }`}
                        data-testid={`button-select-account-${account.id}`}
                      >
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">
                            {account.type}
                          </Badge>
                          <span className="font-mono text-xs text-muted-foreground">
                            {account.code}
                          </span>
                          <span className="text-sm">{account.name}</span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          {selectedAccount && (
            <Card className="bg-muted/50">
              <CardContent className="p-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Account Code</p>
                    <p className="font-mono font-medium" data-testid="text-account-code">
                      {selectedAccount.code}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Account Type</p>
                    <Badge variant="outline" data-testid="badge-account-type">
                      {selectedAccount.type}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Balance</p>
                    <div className="flex items-center gap-2">
                      {selectedAccount.balanceSide === "Dr" ? (
                        <TrendingUp className="w-4 h-4 text-green-600" />
                      ) : selectedAccount.balanceSide === "Cr" ? (
                        <TrendingDown className="w-4 h-4 text-red-600" />
                      ) : (
                        <DollarSign className="w-4 h-4 text-muted-foreground" />
                      )}
                      <span className="font-mono font-semibold" data-testid="text-account-balance">
                        ${Math.abs(selectedAccount.balance).toFixed(2)}{" "}
                        {selectedAccount.balanceSide || ""}
                      </span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>

      {selectedAccount && selectedAccount.type === "Ledger" && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                Filter by Date Range
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="start-date">Start Date</Label>
                  <Input
                    id="start-date"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    data-testid="input-start-date"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="end-date">End Date</Label>
                  <Input
                    id="end-date"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    data-testid="input-end-date"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Transaction History</CardTitle>
            </CardHeader>
            <CardContent>
              {transactionsLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : transactionsWithBalance.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Search className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No transactions found for this account</p>
                  {(startDate || endDate) && (
                    <p className="text-sm mt-1">Try adjusting the date range</p>
                  )}
                </div>
              ) : (
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Voucher #</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Debit</TableHead>
                        <TableHead className="text-right">Credit</TableHead>
                        <TableHead className="text-right">Balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {transactionsWithBalance.map((transaction, index) => (
                        <TableRow
                          key={transaction.entryId}
                          data-testid={`row-transaction-${transaction.entryId}`}
                        >
                          <TableCell className="font-mono text-sm">
                            {transaction.voucherDate
                              ? format(new Date(transaction.voucherDate), "MMM dd, yyyy")
                              : "-"}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {transaction.voucherNumber}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{transaction.voucherType}</Badge>
                          </TableCell>
                          <TableCell className="max-w-xs truncate">
                            {transaction.narration || transaction.voucherDescription || "-"}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {parseFloat(transaction.debitAmount || "0") > 0
                              ? `$${parseFloat(transaction.debitAmount).toFixed(2)}`
                              : "-"}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {parseFloat(transaction.creditAmount || "0") > 0
                              ? `$${parseFloat(transaction.creditAmount).toFixed(2)}`
                              : "-"}
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold">
                            ${Math.abs(transaction.runningBalance).toFixed(2)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
