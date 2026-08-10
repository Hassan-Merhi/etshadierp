import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingDown, DollarSign, FileText } from "lucide-react";

import { calculateTotal, formatSmartCurrency } from "../accountMath";
import type { AnalyticsLegacyState } from "../useAnalyticsLegacy";

export function ExpenseSectionsPanel({ analytics }: { analytics: AnalyticsLegacyState }) {
  const {
    activeSection,
    directExpenseAccounts,
    expenseAccounts,
    indirectExpenseAccounts,
    loadingNetProfit,
    netProfitData,
    renderHierarchicalAccounts,
    renderNetProfitAccountsList,
  } = analytics;
  return (
    <>
      {activeSection === "expenses" && (
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
                  ? formatSmartCurrency(
                      (netProfitData.leftPane.directExpenses.total ?? 0) +
                        (netProfitData.leftPane.indirectExpenses.total ?? 0)
                    )
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
                    <TableCell className="text-right font-bold font-mono">
                      {formatSmartCurrency(
                        (netProfitData.leftPane.directExpenses.total ?? 0) +
                          (netProfitData.leftPane.indirectExpenses.total ?? 0)
                      )}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          ) : expenseAccounts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No expense accounts found</p>
          ) : (
            <div className="table-responsive">
              <Table>
                <TableHeader className="sticky top-0 z-30 bg-background">
                  <TableRow>
                    <TableHead>Account Name</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>{renderHierarchicalAccounts(expenseAccounts)}</TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-semibold">Total</TableCell>
                    <TableCell className="text-right font-bold font-mono">
                      {formatSmartCurrency(calculateTotal(expenseAccounts))}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          )}
        </Card>
      )}

      {activeSection === "direct-expenses" && (
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
                <TableBody>{renderNetProfitAccountsList(netProfitData.leftPane.directExpenses.accounts)}</TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-semibold">Total</TableCell>
                    <TableCell className="text-right font-bold font-mono">
                      {formatSmartCurrency(netProfitData.leftPane.directExpenses.total ?? 0)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          ) : directExpenseAccounts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No direct expense accounts found</p>
          ) : (
            <div className="table-responsive">
              <Table>
                <TableHeader className="sticky top-0 z-30 bg-background">
                  <TableRow>
                    <TableHead>Account Name</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>{renderHierarchicalAccounts(directExpenseAccounts)}</TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-semibold">Total</TableCell>
                    <TableCell className="text-right font-bold font-mono">
                      {formatSmartCurrency(calculateTotal(directExpenseAccounts))}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          )}
        </Card>
      )}

      {activeSection === "indirect-expenses" && (
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
                <TableBody>{renderNetProfitAccountsList(netProfitData.leftPane.indirectExpenses.accounts)}</TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-semibold">Total</TableCell>
                    <TableCell className="text-right font-bold font-mono">
                      {formatSmartCurrency(netProfitData.leftPane.indirectExpenses.total ?? 0)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          ) : indirectExpenseAccounts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No indirect expense accounts found</p>
          ) : (
            <div className="table-responsive">
              <Table>
                <TableHeader className="sticky top-0 z-30 bg-background">
                  <TableRow>
                    <TableHead>Account Name</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>{renderHierarchicalAccounts(indirectExpenseAccounts)}</TableBody>
              </Table>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
