import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Package, FileText, Wallet, Landmark, TrendingDown, DollarSign } from "lucide-react";
import { Account, NetProfitStatementData } from "./analyticsTypes";

interface AccountsPanelProps {
  activeSection: string;
  accountsLoading: boolean;
  assetAccounts: Account[];
  liabilityAccounts: Account[];
  cashAccounts: Account[];
  loansBanksAccounts: Account[];
  expenseAccounts: Account[];
  directExpenseAccounts: Account[];
  indirectExpenseAccounts: Account[];
  netProfitData?: NetProfitStatementData;
  loadingNetProfit: boolean;
  renderHierarchicalAccounts: (accounts: Account[]) => React.ReactNode;
  renderNetProfitAccountsList: (accounts: any[]) => React.ReactNode;
  calculateTotal: (accounts: Account[]) => number;
  formatSmartCurrency: (amount: number) => string;
}

export function AccountsPanel({
  activeSection,
  accountsLoading,
  assetAccounts,
  liabilityAccounts,
  cashAccounts,
  loansBanksAccounts,
  expenseAccounts,
  directExpenseAccounts,
  indirectExpenseAccounts,
  netProfitData,
  loadingNetProfit,
  renderHierarchicalAccounts,
  renderNetProfitAccountsList,
  calculateTotal,
  formatSmartCurrency
}: AccountsPanelProps) {
  if (activeSection === "assets") {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between -mx-6 px-6 pb-4 mb-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Package className="h-4 w-4" />
              </div>
              <h4 className="font-semibold text-base">Asset Accounts</h4>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Total</p>
              <p className="text-2xl font-bold font-mono tabular-nums">
                {formatSmartCurrency(calculateTotal(assetAccounts))}
              </p>
            </div>
          </div>
          {accountsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : assetAccounts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No asset accounts found
            </p>
          ) : (
            <div className="table-responsive">
              <Table>
                <TableHeader className="sticky top-0 z-30 bg-background">
                  <TableRow>
                    <TableHead>Account Name</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {renderHierarchicalAccounts(assetAccounts)}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-semibold">Total</TableCell>
                    <TableCell className="text-right font-bold font-mono">{formatSmartCurrency(calculateTotal(assetAccounts))}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  if (activeSection === "liabilities") {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between -mx-6 px-6 pb-4 mb-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-destructive/10 text-destructive">
                <FileText className="h-4 w-4" />
              </div>
              <h4 className="font-semibold text-base">Liability Accounts</h4>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Total</p>
              <p className="text-2xl font-bold font-mono tabular-nums">
                {formatSmartCurrency(calculateTotal(liabilityAccounts))}
              </p>
            </div>
          </div>
          {accountsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : liabilityAccounts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No liability accounts found
            </p>
          ) : (
            <div className="table-responsive">
              <Table>
                <TableHeader className="sticky top-0 z-30 bg-background">
                  <TableRow>
                    <TableHead>Account Name</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {renderHierarchicalAccounts(liabilityAccounts)}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-semibold">Total</TableCell>
                    <TableCell className="text-right font-bold font-mono">{formatSmartCurrency(calculateTotal(liabilityAccounts))}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  if (activeSection === "cash") {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between -mx-6 px-6 pb-4 mb-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-green-500/10 text-green-600 dark:text-green-400">
                <Wallet className="h-4 w-4" />
              </div>
              <h4 className="font-semibold text-base">Cash Accounts</h4>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Total Cash</p>
              <p className="text-2xl font-bold font-mono tabular-nums">
                {formatSmartCurrency(calculateTotal(cashAccounts))}
              </p>
            </div>
          </div>
          {accountsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : cashAccounts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No cash accounts found
            </p>
          ) : (
            <div className="table-responsive">
              <Table>
                <TableHeader className="sticky top-0 z-30 bg-background">
                  <TableRow>
                    <TableHead>Account Name</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {renderHierarchicalAccounts(cashAccounts)}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-semibold">Total Cash</TableCell>
                    <TableCell className="text-right font-bold font-mono">{formatSmartCurrency(calculateTotal(cashAccounts))}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  if (activeSection === "loans-banks") {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between -mx-6 px-6 pb-4 mb-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400">
                <Landmark className="h-4 w-4" />
              </div>
              <h4 className="font-semibold text-base">Loans &amp; Bank Accounts</h4>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Total Balance</p>
              <p className="text-2xl font-bold font-mono tabular-nums">
                {formatSmartCurrency(calculateTotal(loansBanksAccounts))}
              </p>
            </div>
          </div>
          {accountsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : loansBanksAccounts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No loan or bank accounts found
            </p>
          ) : (
            <div className="table-responsive">
              <Table>
                <TableHeader className="sticky top-0 z-30 bg-background">
                  <TableRow>
                    <TableHead>Account Name</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {renderHierarchicalAccounts(loansBanksAccounts)}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-semibold">Total Balance</TableCell>
                    <TableCell className="text-right font-bold font-mono">{formatSmartCurrency(calculateTotal(loansBanksAccounts))}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  if (activeSection === "expenses") {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-between -mx-6 px-6 pb-4 mb-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-destructive/10 text-destructive">
              <TrendingDown className="h-4 w-4" />
            </div>
            <h3 className="font-semibold text-base">All Expense Accounts</h3>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Total</p>
            <p className="text-2xl font-bold font-mono tabular-nums">
              {netProfitData
                ? formatSmartCurrency((netProfitData.leftPane.directExpenses.total ?? 0) + (netProfitData.leftPane.indirectExpenses.total ?? 0))
                : formatSmartCurrency(calculateTotal(expenseAccounts))}
            </p>
          </div>
        </div>
        {loadingNetProfit ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : netProfitData ? (
          <div className="table-responsive">
            <Table>
              <TableHeader className="sticky top-0 z-30 bg-background">
                <TableRow>
                  <TableHead>Account Name</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {renderNetProfitAccountsList([
                  ...netProfitData.leftPane.directExpenses.accounts,
                  ...netProfitData.leftPane.indirectExpenses.accounts,
                ])}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-semibold">Total</TableCell>
                  <TableCell className="text-right font-bold font-mono">{formatSmartCurrency((netProfitData.leftPane.directExpenses.total ?? 0) + (netProfitData.leftPane.indirectExpenses.total ?? 0))}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        ) : expenseAccounts.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No expense accounts found
          </p>
        ) : (
          <div className="table-responsive">
            <Table>
              <TableHeader className="sticky top-0 z-30 bg-background">
                <TableRow>
                  <TableHead>Account Name</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {renderHierarchicalAccounts(expenseAccounts)}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-semibold">Total</TableCell>
                  <TableCell className="text-right font-bold font-mono">{formatSmartCurrency(calculateTotal(expenseAccounts))}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
      </Card>
    );
  }

  if (activeSection === "direct-expenses") {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-between -mx-6 px-6 pb-4 mb-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-red-500/10 text-red-600 dark:text-red-400">
              <DollarSign className="h-4 w-4" />
            </div>
            <h3 className="font-semibold text-base">Direct Expense Accounts</h3>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Total</p>
            <p className="text-2xl font-bold font-mono tabular-nums">
              {netProfitData
                ? formatSmartCurrency(netProfitData.leftPane.directExpenses.total ?? 0)
                : formatSmartCurrency(calculateTotal(directExpenseAccounts))}
            </p>
          </div>
        </div>
        {loadingNetProfit ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : netProfitData ? (
          <div className="table-responsive">
            <Table>
              <TableHeader className="sticky top-0 z-30 bg-background">
                <TableRow>
                  <TableHead>Account Name</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {renderNetProfitAccountsList(netProfitData.leftPane.directExpenses.accounts)}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-semibold">Total</TableCell>
                  <TableCell className="text-right font-bold font-mono">{formatSmartCurrency(netProfitData.leftPane.directExpenses.total ?? 0)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        ) : directExpenseAccounts.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No direct expense accounts found
          </p>
        ) : (
          <div className="table-responsive">
            <Table>
              <TableHeader className="sticky top-0 z-30 bg-background">
                <TableRow>
                  <TableHead>Account Name</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {renderHierarchicalAccounts(directExpenseAccounts)}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-semibold">Total</TableCell>
                  <TableCell className="text-right font-bold font-mono">{formatSmartCurrency(calculateTotal(directExpenseAccounts))}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
      </Card>
    );
  }

  if (activeSection === "indirect-expenses") {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-between -mx-6 px-6 pb-4 mb-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-orange-500/10 text-orange-600 dark:text-orange-400">
              <FileText className="h-4 w-4" />
            </div>
            <h3 className="font-semibold text-base">Indirect Expense Accounts</h3>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Total</p>
            <p className="text-2xl font-bold font-mono tabular-nums">
              {netProfitData
                ? formatSmartCurrency(netProfitData.leftPane.indirectExpenses.total ?? 0)
                : formatSmartCurrency(calculateTotal(indirectExpenseAccounts))}
            </p>
          </div>
        </div>
        {loadingNetProfit ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : netProfitData ? (
          <div className="table-responsive">
            <Table>
              <TableHeader className="sticky top-0 z-30 bg-background">
                <TableRow>
                  <TableHead>Account Name</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {renderNetProfitAccountsList(netProfitData.leftPane.indirectExpenses.accounts)}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-semibold">Total</TableCell>
                  <TableCell className="text-right font-bold font-mono">{formatSmartCurrency(netProfitData.leftPane.indirectExpenses.total ?? 0)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        ) : indirectExpenseAccounts.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No indirect expense accounts found
          </p>
        ) : (
          <div className="table-responsive">
            <Table>
              <TableHeader className="sticky top-0 z-30 bg-background">
                <TableRow>
                  <TableHead>Account Name</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {renderHierarchicalAccounts(indirectExpenseAccounts)}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-semibold">Total</TableCell>
                  <TableCell className="text-right font-bold font-mono">{formatSmartCurrency(calculateTotal(indirectExpenseAccounts))}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
      </Card>
    );
  }

  return null;
}
