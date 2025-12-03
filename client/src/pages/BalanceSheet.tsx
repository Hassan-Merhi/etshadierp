import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { DollarSign } from "lucide-react";

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

export default function BalanceSheet() {
  const { data: accounts = [], isLoading } = useQuery<Account[]>({
    queryKey: ["/api/accounts/all"],
  });

  // Filter accounts by type
  // Include Fixed Asset type and Ledger accounts with accountType=Asset
  const assetAccounts = accounts.filter(
    (acc) => 
      acc.type === "Fixed Asset" || 
      (acc.type === "Ledger" && acc.accountType === "Asset") ||
      (acc.type === "Bank") // Banks are also assets
  );
  
  // Include Supplier type and Ledger accounts with accountType=Liability
  const liabilityAccounts = accounts.filter(
    (acc) => 
      acc.type === "Supplier" ||
      (acc.type === "Ledger" && acc.accountType === "Liability")
  );
  
  // Ledger accounts with accountType=Equity
  const equityAccounts = accounts.filter(
    (acc) => acc.type === "Ledger" && acc.accountType === "Equity"
  );

  // Calculate totals
  const calculateTotal = (accountList: Account[]) => {
    return accountList.reduce((sum, acc) => {
      const amount = acc.balanceSide === "Cr" ? -acc.balance : acc.balance;
      return sum + amount;
    }, 0);
  };

  const totalAssets = calculateTotal(assetAccounts);
  const totalLiabilities = calculateTotal(liabilityAccounts);
  const totalEquity = calculateTotal(equityAccounts);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    }).format(Math.abs(value));
  };

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
      <div className="rounded-md border">
        <Table>
          <TableHeader>
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
                  {formatCurrency(account.balance)} {account.balanceSide || ""}
                </TableCell>
              </TableRow>
            ))}
            {showTotal && (
              <TableRow className="font-semibold bg-muted/50">
                <TableCell>Total</TableCell>
                <TableCell className="text-right font-mono" data-testid="text-total">
                  {formatCurrency(total)}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Balance Sheet</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Financial position showing assets, liabilities, and equity
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Assets</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-assets">
              {isLoading ? "Loading..." : formatCurrency(totalAssets)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Liabilities</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-liabilities">
              {isLoading ? "Loading..." : formatCurrency(totalLiabilities)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Equity</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-equity">
              {isLoading ? "Loading..." : formatCurrency(totalEquity)}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-6">
          <Tabs defaultValue="assets" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="assets" data-testid="tab-assets">
                Assets
              </TabsTrigger>
              <TabsTrigger value="liabilities" data-testid="tab-liabilities">
                Liabilities
              </TabsTrigger>
              <TabsTrigger value="equity" data-testid="tab-equity">
                Equity
              </TabsTrigger>
            </TabsList>
            <TabsContent value="assets" className="mt-6">
              {renderAccountTable(assetAccounts)}
            </TabsContent>
            <TabsContent value="liabilities" className="mt-6">
              {renderAccountTable(liabilityAccounts)}
            </TabsContent>
            <TabsContent value="equity" className="mt-6">
              {renderAccountTable(equityAccounts)}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
