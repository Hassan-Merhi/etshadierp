import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { DollarSign, Landmark, CreditCard, PiggyBank, type LucideIcon } from "lucide-react";
import { useCompany } from "@/contexts/CompanyContext";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { drCrClass } from "@/lib/formatNumber";
import { PageHeader } from "@/components/PageHeader";

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

type SectionKey = "assets" | "liabilities" | "equity";

interface SidebarItem {
  key: SectionKey;
  label: string;
  icon: LucideIcon;
}

interface SidebarGroup {
  label: string;
  items: SidebarItem[];
}

export default function BalanceSheet() {
  const { selectedCompany } = useCompany();
  const { formatAmount } = useCurrencyContext();
  const [activeSection, setActiveSection] = useState<SectionKey>("assets");

  const { data: accounts = [], isLoading } = useQuery<Account[]>({
    queryKey: ["/api/accounts/all", selectedCompany?.id],
    enabled: !!selectedCompany,
  });

  const assetAccounts = accounts.filter(
    (acc) => acc.type === "fixedAsset" || (acc.type === "ledger" && acc.accountType === "Asset") || acc.type === "bank"
  );

  const liabilityAccounts = accounts.filter(
    (acc) => acc.type === "supplier" || (acc.type === "ledger" && acc.accountType === "Liability")
  );

  const equityAccounts = accounts.filter((acc) => acc.type === "ledger" && acc.accountType === "Equity");

  const calculateTotal = (accountList: Account[], naturalSide: "Dr" | "Cr" = "Dr") => {
    return accountList.reduce((sum, acc) => {
      const amount = acc.balanceSide === naturalSide ? acc.balance : -acc.balance;
      return sum + amount;
    }, 0);
  };

  const totalAssets = calculateTotal(assetAccounts, "Dr");
  const totalLiabilities = calculateTotal(liabilityAccounts, "Cr");
  const totalEquity = calculateTotal(equityAccounts, "Cr");

  const sidebarGroups: SidebarGroup[] = [
    {
      label: "Balance Sheet",
      items: [
        { key: "assets", label: "Assets", icon: Landmark },
        { key: "liabilities", label: "Liabilities", icon: CreditCard },
        { key: "equity", label: "Equity", icon: PiggyBank },
      ],
    },
  ];

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
      <div className="rounded-md border table-responsive">
        <Table>
          <TableHeader className="sticky top-0 z-30 bg-background">
            <TableRow>
              <TableHead>Account Name</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accountList.map((account) => (
              <TableRow key={account.id} data-testid={`row-account-${account.id}`}>
                <TableCell>{account.name}</TableCell>
                <TableCell className="text-right font-mono">
                  {formatAmount(account.balance)}
                  {account.balanceSide ? (
                    <span className={`ml-1 ${drCrClass(account.balanceSide)}`}>{account.balanceSide}</span>
                  ) : (
                    ""
                  )}
                </TableCell>
              </TableRow>
            ))}
            {showTotal && (
              <TableRow className="font-semibold bg-muted/50">
                <TableCell>Total</TableCell>
                <TableCell className="text-right font-mono" data-testid="text-total">
                  {formatAmount(total)}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    );
  };

  const getActiveAccounts = () => {
    switch (activeSection) {
      case "assets":
        return assetAccounts;
      case "liabilities":
        return liabilityAccounts;
      case "equity":
        return equityAccounts;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <PageHeader title="Balance Sheet" subtitle="Financial position showing assets, liabilities, and equity" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Assets</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-assets">
              {isLoading ? "Loading..." : formatAmount(totalAssets)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Liabilities</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-liabilities">
              {isLoading ? "Loading..." : formatAmount(totalLiabilities)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Equity</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-equity">
              {isLoading ? "Loading..." : formatAmount(totalEquity)}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-6">
        <nav className="w-56 shrink-0 space-y-4">
          {sidebarGroups.map((group) => (
            <div key={group.label}>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-3">
                {group.label}
              </h3>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeSection === item.key;
                  return (
                    <button
                      key={item.key}
                      onClick={() => setActiveSection(item.key)}
                      data-testid={`tab-${item.key}`}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors ${
                        isActive
                          ? "bg-background shadow-sm font-medium"
                          : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="flex-1 min-w-0">
          <Card>
            <CardContent className="p-6">{renderAccountTable(getActiveAccounts())}</CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
