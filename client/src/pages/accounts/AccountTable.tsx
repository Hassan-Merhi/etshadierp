import { ChevronDown, ChevronRight, Eye } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
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
            <TableHead className="w-[300px]">Account</TableHead>
            {!hideBalances && <TableHead className="text-right">Balance</TableHead>}
            <TableHead className="w-[80px] text-right">Action</TableHead>
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
      <TableRow className={level > 0 ? "bg-muted/10" : ""}>
        <TableCell className="font-medium">
          <div className="flex items-center gap-1" style={{ paddingLeft: `${level * 1.5}rem` }}>
            {hasChildren ? (
              <button
                onClick={() => toggleParent(account.id)}
                className="p-1 hover:bg-muted rounded transition-colors"
              >
                {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </button>
            ) : (
              <div className="w-6" />
            )}
            <span className="truncate">{account.name}</span>
          </div>
        </TableCell>
        {!hideBalances && (
          <TableCell className="text-right font-mono tabular-nums">
            {formatAmount(Math.abs(account.balance))}
            <span className="ml-1 text-[10px] opacity-70">
              {account.balanceSide || (account.balance >= 0 ? "Dr" : "Cr")}
            </span>
          </TableCell>
        )}
        <TableCell className="text-right">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => handleAccountChange(account.id)}
            data-testid={`button-view-account-${account.id}`}
          >
            <Eye className="w-4 h-4" />
          </Button>
        </TableCell>
      </TableRow>
      {hasChildren && isExpanded && account.children.map((child: any) => (
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
