import { Fragment, useState, useMemo } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight } from "lucide-react";
import { AccountTableProps } from "./accountTypes";
import { cn } from "@/lib/utils";

const TYPE_LABELS: Record<string, string> = {
  ledger: "Ledger",
  supplier: "Supplier",
  customer: "Customer",
  bank: "Bank",
  employee: "Employee",
  fixedAsset: "Asset",
  factoryWorker: "Worker",
};

const TYPE_COLORS: Record<string, string> = {
  ledger: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  supplier: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
  customer: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  bank: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  employee: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20",
  fixedAsset: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20",
  factoryWorker: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
};

const TYPE_ORDER = ["ledger", "supplier", "customer", "bank", "employee", "fixedAsset", "factoryWorker"];

export function AccountTable({
  filteredAccounts,
  expandedParents,
  toggleParent,
  handleAccountChange,
  hideBalances,
  formatAmount,
}: AccountTableProps) {
  const [typeFilter, setTypeFilter] = useState("all");

  const presentTypes = useMemo(() => {
    const types = new Set(filteredAccounts.map((a: any) => a.type as string));
    return TYPE_ORDER.filter((t) => types.has(t));
  }, [filteredAccounts]);

  const typeFiltered = useMemo(() => {
    if (typeFilter === "all") return filteredAccounts;
    return filteredAccounts.filter((a: any) => a.type === typeFilter);
  }, [filteredAccounts, typeFilter]);

  const accountIds = new Set(typeFiltered.map((a: any) => a.accountId as number));
  const parents = typeFiltered.filter((a: any) => !a.parentId || !accountIds.has(a.parentId));
  const childrenList = typeFiltered.filter((a: any) => a.parentId && accountIds.has(a.parentId));
  const childMap = new Map<number, any[]>();
  childrenList.forEach((c: any) => {
    if (!childMap.has(c.parentId)) childMap.set(c.parentId, []);
    childMap.get(c.parentId)!.push(c);
  });

  return (
    <div className="space-y-3">
      {presentTypes.length > 1 && (
        <div className="flex gap-1.5 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "h-7 text-xs rounded-full px-3",
              typeFilter === "all" && "bg-primary text-primary-foreground border-primary"
            )}
            onClick={() => setTypeFilter("all")}
            data-testid="filter-type-all"
          >
            All
          </Button>
          {presentTypes.map((t) => (
            <Button
              key={t}
              variant="outline"
              size="sm"
              className={cn(
                "h-7 text-xs rounded-full px-3",
                typeFilter === t && "bg-primary text-primary-foreground border-primary"
              )}
              onClick={() => setTypeFilter(t)}
              data-testid={`filter-type-${t}`}
            >
              {TYPE_LABELS[t] || t}
            </Button>
          ))}
        </div>
      )}

      <div className="rounded-xl border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Account
              </TableHead>
              {!hideBalances && (
                <TableHead className="text-right w-[200px] text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Balance
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {parents.map((account: any) => {
              const kids = childMap.get(account.accountId) || [];
              const hasKids = kids.length > 0;
              const isExpanded = expandedParents.has(account.id);
              const isGroup = account.subType === "Group" || hasKids;
              const typeColor = TYPE_COLORS[account.type] ?? "bg-muted text-muted-foreground border-border";
              const balanceSide = account.balanceSide || (account.balance >= 0 ? "Dr" : "Cr");

              return (
                <Fragment key={account.id}>
                  <TableRow
                    className="cursor-pointer transition-colors hover:bg-muted/30"
                    onClick={() => {
                      if (hasKids) toggleParent(account.id);
                      else handleAccountChange(account.id);
                    }}
                    data-testid={`row-account-${account.id}`}
                  >
                    <TableCell className={cn("py-3", isGroup && "font-medium")}>
                      <div className="flex items-center gap-2.5 min-w-0">
                        {hasKids ? (
                          <span className="text-muted-foreground shrink-0">
                            {isExpanded ? (
                              <ChevronDown className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5" />
                            )}
                          </span>
                        ) : (
                          <span className="w-3.5 shrink-0" />
                        )}
                        <span className="truncate text-sm">{account.name}</span>
                        {account.accountId && !isGroup && (
                          <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                            #{account.accountId}
                          </span>
                        )}
                        {!isGroup && (
                          <Badge
                            variant="outline"
                            className={cn("text-[10px] shrink-0 py-0 px-1.5 h-[18px] font-normal", typeColor)}
                          >
                            {TYPE_LABELS[account.type] || account.type}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    {!hideBalances && (
                      <TableCell className="text-right py-3">
                        {hasKids ? (
                          <span className="text-muted-foreground text-xs">
                            {kids.length} {kids.length === 1 ? "account" : "accounts"}
                          </span>
                        ) : (
                          <span
                            className={cn(
                              "font-mono tabular-nums text-sm font-medium",
                              balanceSide === "Dr"
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-amber-600 dark:text-amber-400"
                            )}
                          >
                            {formatAmount(Math.abs(account.balance))}
                            <span className="ml-1 text-[10px] opacity-60">{balanceSide}</span>
                          </span>
                        )}
                      </TableCell>
                    )}
                  </TableRow>

                  {hasKids &&
                    isExpanded &&
                    kids.map((child: any) => {
                      const childSide = child.balanceSide || (child.balance >= 0 ? "Dr" : "Cr");
                      return (
                        <TableRow
                          key={child.id}
                          className="cursor-pointer hover:bg-muted/20"
                          onClick={() => handleAccountChange(child.id)}
                          data-testid={`row-account-${child.id}`}
                        >
                          <TableCell className="py-2.5 pl-14">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="truncate text-sm text-muted-foreground">{child.name}</span>
                              {child.accountId && (
                                <span className="text-[10px] text-muted-foreground/60 font-mono shrink-0">
                                  #{child.accountId}
                                </span>
                              )}
                            </div>
                          </TableCell>
                          {!hideBalances && (
                            <TableCell className="text-right py-2.5">
                              <span
                                className={cn(
                                  "font-mono tabular-nums text-sm",
                                  childSide === "Dr"
                                    ? "text-emerald-600/80 dark:text-emerald-400/80"
                                    : "text-amber-600/80 dark:text-amber-400/80"
                                )}
                              >
                                {formatAmount(Math.abs(child.balance))}
                                <span className="ml-1 text-[10px] opacity-60">{childSide}</span>
                              </span>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                </Fragment>
              );
            })}

            {parents.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={hideBalances ? 1 : 2}
                  className="text-center py-12 text-muted-foreground text-sm"
                >
                  No accounts found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
