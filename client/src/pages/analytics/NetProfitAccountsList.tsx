import { TableRow, TableCell } from "@/components/ui/table";
import { NetProfitAccount } from "./analyticsTypes";
import { goToStatement, formatSmartCurrency } from "./analyticsHelpers";

interface NetProfitAccountsListProps {
  accts: NetProfitAccount[];
  appMode: string;
}

export function NetProfitAccountsList({ accts, appMode }: NetProfitAccountsListProps) {
  const nonZero = accts.filter((a) => Number(a.debit) !== 0 || Number(a.credit) !== 0);

  if (nonZero.length === 0) {
    return (
      <TableRow>
        <TableCell colSpan={2} className="text-center text-muted-foreground py-8">
          No transactions in this period
        </TableCell>
      </TableRow>
    );
  }

  return nonZero.map((acc) => (
    <TableRow
      key={acc.id}
      className="hover-elevate cursor-pointer"
      onClick={() => goToStatement(acc.id, appMode, undefined, "ledger")}
    >
      <TableCell className="text-sm font-medium hover:underline">{acc.name}</TableCell>
      <TableCell className="text-right font-mono text-sm text-green-600 dark:text-green-400">
        {formatSmartCurrency(Number(acc.balance))}
      </TableCell>
    </TableRow>
  ));
}
