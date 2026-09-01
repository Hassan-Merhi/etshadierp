import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DollarSign } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/page-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCompany } from "@/contexts/CompanyContext";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { drCrClass } from "@/lib/formatNumber";
import { BalanceSheetSectionNav } from "./balance-sheet/BalanceSheetSectionNav";
import {
  calculateBalanceSheetTotal,
  groupBalanceSheetAccounts,
  type BalanceSheetAccount,
  type BalanceSheetSectionKey,
} from "./balance-sheet/balanceSheetModel";

export default function BalanceSheet() {
  const { selectedCompany } = useCompany();
  const { formatAmount, formatAmountRaw } = useCurrencyContext();
  const [activeSection, setActiveSection] = useState<BalanceSheetSectionKey>("assets");

  const { data: accounts = [], isLoading } = useQuery<BalanceSheetAccount[]>({
    queryKey: ["/api/accounts/all", selectedCompany?.id],
    enabled: !!selectedCompany,
  });

  const groups = useMemo(() => groupBalanceSheetAccounts(accounts), [accounts]);
  const totals = useMemo(
    () => ({
      assets: calculateBalanceSheetTotal(groups.assets, "Dr"),
      liabilities: calculateBalanceSheetTotal(groups.liabilities, "Cr"),
      equity: calculateBalanceSheetTotal(groups.equity, "Cr"),
    }),
    [groups],
  );
  const activeAccounts = groups[activeSection];

  const renderAccountTable = () => {
    if (isLoading) {
      return (
        <div className="space-y-2" aria-label="Loading balance sheet accounts">
          {[1, 2, 3].map((item) => <Skeleton key={item} className="h-12 w-full" />)}
        </div>
      );
    }

    if (activeAccounts.length === 0) {
      return <EmptyState title="No accounts in this category" description="Accounts will appear here when they are available." />;
    }

    const total = calculateBalanceSheetTotal(activeAccounts);
    return (
      <div className="table-responsive rounded-md border">
        <Table>
          <TableHeader className="sticky top-0 z-30 bg-background">
            <TableRow><TableHead>Account Name</TableHead><TableHead className="text-right">Balance</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {activeAccounts.map((account) => (
              <TableRow key={account.id} data-testid={`row-account-${account.id}`}>
                <TableCell>{account.name}</TableCell>
                <TableCell className="text-right font-mono">
                  {account.type === "bank" ? formatAmount(account.balance) : formatAmountRaw(account.balance)}
                  {account.balanceSide ? <span className={`ml-1 ${drCrClass(account.balanceSide)}`}>{account.balanceSide}</span> : null}
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-muted/50 font-semibold">
              <TableCell>Total</TableCell>
              <TableCell className="text-right font-mono" data-testid="text-total">{formatAmountRaw(total)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Balance Sheet" subtitle="Financial position showing assets, liabilities, and equity" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {([
          ["Total Assets", totals.assets, "text-total-assets"],
          ["Total Liabilities", totals.liabilities, "text-total-liabilities"],
          ["Total Equity", totals.equity, "text-total-equity"],
        ] as const).map(([title, value, testId]) => (
          <Card key={title}>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{title}</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </CardHeader>
            <CardContent><div className="text-2xl font-bold" data-testid={testId}>{isLoading ? "Loading..." : formatAmountRaw(value)}</div></CardContent>
          </Card>
        ))}
      </div>
      <div className="flex flex-col gap-4 sm:flex-row sm:gap-6">
        <BalanceSheetSectionNav activeSection={activeSection} onSectionChange={setActiveSection} />
        <div className="min-w-0 flex-1"><Card><CardContent className="p-4 sm:p-6">{renderAccountTable()}</CardContent></Card></div>
      </div>
    </div>
  );
}
