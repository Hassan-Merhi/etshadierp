import { ChevronDown, ChevronRight } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AccountTableProps } from "./accountTypes";

export function AccountTable({
  filteredAccounts,
  expandedParents,
  toggleParent,
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
            {!hideBalances && <TableHead className="text-right w-[160px]">Balance</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredAccounts.map((parent) => (
            <AccountRows
              key={parent.id}
              account={parent}
              level={0}
              expandedParents={expandedParents}
              toggleParent={toggleParent}
              handleAccountChange={handleAccountChange}
              hideBalances={hideBalances}
              formatAmount={formatAmount}
            />
          ))}
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

function AccountRows({
  account,
  level,
  expandedParents,
  toggleParent,
  handleAccountChange,
  hideBalances,
  formatAmount,
}: {
  account: any;
  level: number;
  expandedParents: Set<string>;
  toggleParent: (id: string) => void;
  handleAccountChange: (id: string) => void;
  hideBalances: boolean;
  formatAmount: (amt: number) => string;
}) {
  const hasChildren = account.children && account.children.length > 0;
  const isExpanded = expandedParents.has(account.id);

  return (
    <>
      <TableRow
        className={`${level > 0 ? "bg-muted/10" : ""} cursor-pointer hover:bg-muted/30`}
        onClick={() => !hasChildren && handleAccountChange(account.id)}
        data-testid={`row-account-${account.id}`}
      >
        <TableCell className="font-medium py-2.5">
          <div className="flex items-center gap-1" style={{ paddingLeft: `${level * 1.5}rem` }}>
            {hasChildren ? (
              <button
                onClick={(e) => { e.stopPropagation(); toggleParent(account.id); }}
                className="p-1 hover:bg-muted rounded transition-colors flex-shrink-0"
              >
                {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </button>
            ) : (
              <div className="w-6 flex-shrink-0" />
            )}
            <span className="truncate max-w-[400px]">
              {account.name}
              {account.accountId && (
                <span className="ml-1.5 text-[11px] text-muted-foreground font-mono font-normal">
                  #{account.accountId}
                </span>
              )}
            </span>
          </div>
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
      {hasChildren &&
        isExpanded &&
        account.children.map((child: any) => (
          <AccountRows
            key={child.id}
            account={child}
            level={level + 1}
            expandedParents={expandedParents}
            toggleParent={toggleParent}
            handleAccountChange={handleAccountChange}
            hideBalances={hideBalances}
            formatAmount={formatAmount}
          />
        ))}
    </>
  );
}
