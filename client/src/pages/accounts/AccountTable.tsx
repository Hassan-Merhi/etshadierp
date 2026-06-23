import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AccountTableProps } from "./accountTypes";

const TYPE_LABELS: Record<string, string> = {
  ledger: "Ledger",
  supplier: "Supplier",
  customer: "Customer",
  bank: "Bank",
  employee: "Employee",
  fixedAsset: "Asset",
  factoryWorker: "Worker",
};

const TYPE_VARIANTS: Record<string, string> = {
  ledger: "secondary",
  supplier: "outline",
  customer: "outline",
  bank: "outline",
  employee: "outline",
  fixedAsset: "outline",
  factoryWorker: "outline",
};

export function AccountTable({
  filteredAccounts,
  handleAccountChange,
  hideBalances,
  formatAmount,
}: AccountTableProps) {
  return (
    <div className="rounded-xl border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead>Account</TableHead>
            <TableHead className="w-[110px]">Type</TableHead>
            {!hideBalances && <TableHead className="text-right w-[160px]">Balance</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredAccounts.map((account) => (
            <TableRow
              key={account.id}
              className="cursor-pointer hover:bg-muted/30"
              onClick={() => handleAccountChange(account.id)}
              data-testid={`row-account-${account.id}`}
            >
              <TableCell className="font-medium py-2.5">
                <span className="flex items-center gap-2 min-w-0">
                  <span className="truncate max-w-[400px]">{account.name}</span>
                  {account.accountId && (
                    <span className="ml-0.5 text-[11px] text-muted-foreground font-mono font-normal shrink-0">
                      #{account.accountId}
                    </span>
                  )}
                </span>
              </TableCell>
              <TableCell className="py-2.5">
                <Badge variant={(TYPE_VARIANTS[account.type] ?? "outline") as any} className="text-[10px]">
                  {TYPE_LABELS[account.type] ?? account.type}
                </Badge>
              </TableCell>
              {!hideBalances && (
                <TableCell className="text-right font-mono tabular-nums text-sm py-2.5">
                  {formatAmount(Math.abs(account.balance))}
                  <span className="ml-1 text-[10px] opacity-70">
                    {account.balanceSide || (account.balance >= 0 ? "Dr" : "Cr")}
                  </span>
                </TableCell>
              )}
            </TableRow>
          ))}
          {filteredAccounts.length === 0 && (
            <TableRow>
              <TableCell colSpan={hideBalances ? 2 : 3} className="text-center py-8 text-muted-foreground text-sm">
                No accounts found matching your search.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
