import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown } from "lucide-react";

interface Account {
  id: string;
  accountId: number;
  type: string;
  code: string;
  name: string;
  accountType?: string;
  subType?: string;
  balance: number;
  balanceSide: string | null;
  active: boolean;
}

export default function ProfitLoss() {
  const { data: accounts = [], isLoading } = useQuery<Account[]>({
    queryKey: ["/api/accounts/all"],
  });

  // Filter ledger accounts by income/expense types using accountType and subType
  const directIncomeAccounts = accounts.filter(
    (acc) =>
      acc.type === "Ledger" &&
      acc.accountType === "Income" &&
      acc.subType === "Direct Income"
  );

  const indirectIncomeAccounts = accounts.filter(
    (acc) =>
      acc.type === "Ledger" &&
      acc.accountType === "Income" &&
      acc.subType === "Indirect Income"
  );

  const directExpenseAccounts = accounts.filter(
    (acc) =>
      acc.type === "Ledger" &&
      acc.accountType === "Expense" &&
      acc.subType === "Direct Expense"
  );

  const indirectExpenseAccounts = accounts.filter(
    (acc) =>
      acc.type === "Ledger" &&
      acc.accountType === "Expense" &&
      acc.subType === "Indirect Expense"
  );

  // Calculate totals
  const calculateTotal = (accountList: Account[]) => {
    return accountList.reduce((sum, acc) => {
      const amount = acc.balanceSide === "Cr" ? acc.balance : -acc.balance;
      return sum + amount;
    }, 0);
  };

  const totalDirectIncome = calculateTotal(directIncomeAccounts);
  const totalIndirectIncome = calculateTotal(indirectIncomeAccounts);
  const totalIncome = totalDirectIncome + totalIndirectIncome;

  const totalDirectExpense = Math.abs(calculateTotal(directExpenseAccounts));
  const totalIndirectExpense = Math.abs(calculateTotal(indirectExpenseAccounts));
  const totalExpenses = totalDirectExpense + totalIndirectExpense;

  const netProfit = totalIncome - totalExpenses;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    }).format(Math.abs(value));
  };

  const renderAccountTable = (accountList: Account[], showTotal: boolean = true) => {
    if (isLoading) {
      return (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      );
    }

    if (accountList.length === 0) {
      return (
        <div className="text-center py-8 text-muted-foreground">
          <p>No accounts in this category</p>
        </div>
      );
    }

    const total = calculateTotal(accountList);

    return (
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Account Name</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accountList.map((account) => (
              <TableRow key={account.id} data-testid={`row-account-${account.id}`}>
                <TableCell className="font-mono text-sm">{account.code}</TableCell>
                <TableCell>{account.name}</TableCell>
                <TableCell className="text-right font-mono">
                  {formatCurrency(account.balance)}
                </TableCell>
              </TableRow>
            ))}
            {showTotal && (
              <TableRow className="font-semibold bg-muted/50">
                <TableCell colSpan={2}>Total</TableCell>
                <TableCell className="text-right font-mono" data-testid="text-total">
                  {formatCurrency(Math.abs(total))}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Profit & Loss Statement</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Income and expenses breakdown showing business performance
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Income</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600" data-testid="text-total-income">
              {isLoading ? "Loading..." : formatCurrency(totalIncome)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Expenses</CardTitle>
            <TrendingDown className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600" data-testid="text-total-expenses">
              {isLoading ? "Loading..." : formatCurrency(totalExpenses)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Net Profit</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${
                netProfit >= 0 ? "text-green-600" : "text-red-600"
              }`}
              data-testid="text-net-profit"
            >
              {isLoading ? "Loading..." : formatCurrency(netProfit)}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-6">
          <Tabs defaultValue="direct-income" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="direct-income" data-testid="tab-direct-income">
                Direct Income
              </TabsTrigger>
              <TabsTrigger value="direct-expenses" data-testid="tab-direct-expenses">
                Direct Expenses
              </TabsTrigger>
              <TabsTrigger value="indirect-income" data-testid="tab-indirect-income">
                Indirect Income
              </TabsTrigger>
              <TabsTrigger value="indirect-expenses" data-testid="tab-indirect-expenses">
                Indirect Expenses
              </TabsTrigger>
            </TabsList>
            <TabsContent value="direct-income" className="mt-6">
              {renderAccountTable(directIncomeAccounts)}
            </TabsContent>
            <TabsContent value="direct-expenses" className="mt-6">
              {renderAccountTable(directExpenseAccounts)}
            </TabsContent>
            <TabsContent value="indirect-income" className="mt-6">
              {renderAccountTable(indirectIncomeAccounts)}
            </TabsContent>
            <TabsContent value="indirect-expenses" className="mt-6">
              {renderAccountTable(indirectExpenseAccounts)}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
