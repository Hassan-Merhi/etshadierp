import { Fragment } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronDown, ChevronRight } from "lucide-react";
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

export function AccountTable({
  filteredAccounts,
  expandedParents,
  toggleParent,
  handleAccountChange,
  hideBalances,
  formatAmount,
}: AccountTableProps) {
  const accountIds = new Set(filteredAccounts.map((a: any) => a.accountId as number));

  const parents = filteredAccounts.filter(
    (a: any) => !a.parentId || !accountIds.has(a.parentId)
  );
  const childrenList = filteredAccounts.filter(
    (a: any) => a.parentId && accountIds.has(a.parentId)
  );
  const childMap = new Map<number, any[]>();
  childrenList.forEach((c: any) => {
    if (!childMap.has(c.parentId)) childMap.set(c.parentId, []);
    childMap.get(c.parentId)!.push(c);
  });

  return (
    <div className="rounded-xl border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead>Account</TableHead>
            {!hideBalances && <TableHead className="text-right w-[160px]">Balance</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {parents.map((account: any) => {
            const kids = childMap.get(account.accountId) || [];
            const hasKids = kids.length > 0;
            const isExpanded = expandedParents.has(account.id);

            return (
              <Fragment key={account.id}>
                <TableRow
                  className="cursor-pointer hover:bg-muted/30"
                  onClick={() => {
                    if (hasKids) toggleParent(account.id);
                    else handleAccountChange(account.id);
                  }}
                  data-testid={`row-account-${account.id}`}
                >
                  <TableCell className="font-medium py-2.5">
                    <span className="flex items-center gap-2 min-w-0">
                      {hasKids && (
                        <span className="text-muted-foreground shrink-0">
                          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </span>
                      )}
                      <span className="truncate max-w-[380px]">{account.name}</span>
                      {!hasKids && account.accountId && (
                        <span className="ml-0.5 text-[11px] text-muted-foreground font-mono font-normal shrink-0">
                          #{account.accountId}
                        </span>
                      )}
                    </span>
                  </TableCell>
                  {!hideBalances && (
                    <TableCell className="text-right font-mono tabular-nums text-sm py-2.5">
                      {hasKids ? (
                        <span className="text-muted-foreground text-xs">
                          {kids.length} {kids.length === 1 ? "account" : "accounts"}
                        </span>
                      ) : (
                        <>
                          {formatAmount(Math.abs(account.balance))}
                          <span className="ml-1 text-[10px] opacity-70">
                            {account.balanceSide || (account.balance >= 0 ? "Dr" : "Cr")}
                          </span>
                        </>
                      )}
                    </TableCell>
                  )}
                </TableRow>

                {hasKids &&
                  isExpanded &&
                  kids.map((child: any) => (
                    <TableRow
                      key={child.id}
                      className="cursor-pointer hover:bg-muted/20"
                      onClick={() => handleAccountChange(child.id)}
                      data-testid={`row-account-${child.id}`}
                    >
                      <TableCell className="py-2.5 pl-9">
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="truncate max-w-[360px] text-muted-foreground">{child.name}</span>
                          {child.accountId && (
                            <span className="ml-0.5 text-[11px] text-muted-foreground font-mono font-normal shrink-0">
                              #{child.accountId}
                            </span>
                          )}
                        </span>
                      </TableCell>
                      {!hideBalances && (
                        <TableCell className="text-right font-mono tabular-nums text-sm py-2.5 text-muted-foreground">
                          {formatAmount(Math.abs(child.balance))}
                          <span className="ml-1 text-[10px] opacity-70">
                            {child.balanceSide || (child.balance >= 0 ? "Dr" : "Cr")}
                          </span>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
              </Fragment>
            );
          })}
          {filteredAccounts.length === 0 && (
            <TableRow>
              <TableCell colSpan={hideBalances ? 1 : 2} className="text-center py-8 text-muted-foreground text-sm">
                No accounts found matching your search.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
