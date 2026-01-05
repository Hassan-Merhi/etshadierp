import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { 
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Minus
} from "lucide-react";
import { Link } from "wouter";
import { formatNumber } from "@/lib/formatNumber";

interface ImportCycleData {
  netImportCycleBalance: number;
  components: {
    supplierBalance: number;
    stockOtwValue: number;
    dutyAgentBalance: number;
    transporterAgentBalance: number;
    loansBalance: number;
    cashBalance: number;
    bankBalance: number;
    assetBalance: number;
    directExpenseBalance: number;
    indirectExpenseBalance: number;
    generalExpenseBalance: number;
    governmentTaxesBalance: number;
    incomeBalance: number;
    liabilityBalance: number;
    profitBalance: number;
    stockOnFloorValue: number;
    cogsBalance: number;
    consumptionBalance: number;
    productionBalance: number;
    payrollExpenseBalance: number;
    salaryAdvancesBalance: number;
    payrollLiabilitiesBalance: number;
    openingBalanceEquity: number;
    openingStockValue: number;
  };
}

interface ComponentInfo {
  key: string;
  label: string;
  category: "asset" | "expense" | "liability";
  inFormula: boolean;
  sign: "+" | "-";
}

const componentConfig: ComponentInfo[] = [
  // Assets (+ in formula)
  { key: "stockOtwValue", label: "Stock OTW (Containers in Transit)", category: "asset", inFormula: true, sign: "+" },
  { key: "cashBalance", label: "Cash", category: "asset", inFormula: true, sign: "+" },
  { key: "bankBalance", label: "Bank", category: "asset", inFormula: true, sign: "+" },
  { key: "stockOnFloorValue", label: "Stock on Floor (Inventory)", category: "asset", inFormula: true, sign: "+" },
  { key: "assetBalance", label: "Other Assets", category: "asset", inFormula: true, sign: "+" },
  { key: "salaryAdvancesBalance", label: "Salary Advances", category: "asset", inFormula: true, sign: "+" },
  // Expenses (+ in formula)
  { key: "indirectExpenseBalance", label: "Indirect Expenses", category: "expense", inFormula: true, sign: "+" },
  { key: "payrollExpenseBalance", label: "Payroll Expenses", category: "expense", inFormula: true, sign: "+" },
  { key: "governmentTaxesBalance", label: "Government Taxes", category: "expense", inFormula: true, sign: "+" },
  { key: "cogsBalance", label: "Cost of Goods Sold", category: "expense", inFormula: true, sign: "+" },
  // Liabilities (- in formula)
  { key: "supplierBalance", label: "Supplier Payables", category: "liability", inFormula: true, sign: "-" },
  { key: "dutyAgentBalance", label: "Duty Agent", category: "liability", inFormula: true, sign: "-" },
  { key: "transporterAgentBalance", label: "Transporter Agent", category: "liability", inFormula: true, sign: "-" },
  { key: "loansBalance", label: "Loans", category: "liability", inFormula: true, sign: "-" },
  { key: "liabilityBalance", label: "Other Liabilities", category: "liability", inFormula: true, sign: "-" },
  { key: "profitBalance", label: "Profit/Retained Earnings", category: "liability", inFormula: true, sign: "-" },
  { key: "incomeBalance", label: "Income", category: "liability", inFormula: true, sign: "-" },
  { key: "payrollLiabilitiesBalance", label: "Payroll Liabilities", category: "liability", inFormula: true, sign: "-" },
  { key: "openingBalanceEquity", label: "Opening Balance Equity", category: "liability", inFormula: true, sign: "+" },
  // Not in formula (for reference only)
  { key: "directExpenseBalance", label: "Import Charges (capitalized)", category: "expense", inFormula: false, sign: "+" },
  { key: "generalExpenseBalance", label: "General Expenses (Purchases)", category: "expense", inFormula: false, sign: "+" },
  { key: "consumptionBalance", label: "Consumption (in inventory)", category: "expense", inFormula: false, sign: "+" },
  { key: "productionBalance", label: "Production (in inventory)", category: "expense", inFormula: false, sign: "+" },
  { key: "openingStockValue", label: "Opening Stock Value", category: "asset", inFormula: false, sign: "+" },
];

export default function ImportCycleDiagnostics() {
  const { data, isLoading, error, refetch } = useQuery<ImportCycleData>({
    queryKey: ["/api/stats/import-cycle-balance"],
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <Skeleton className="h-8 w-64" />
        </div>
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <span>Failed to load data: {(error as Error).message}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const netBalance = data?.netImportCycleBalance || 0;
  const isBalanced = Math.abs(netBalance) < 0.01;
  const components = data?.components || {} as ImportCycleData['components'];

  const getCategoryColor = (category: string) => {
    switch (category) {
      case "asset": return "text-green-600";
      case "expense": return "text-orange-600";
      case "liability": return "text-red-600";
      default: return "";
    }
  };

  const getCategoryBadge = (category: string) => {
    switch (category) {
      case "asset": return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Asset</Badge>;
      case "expense": return <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200">Expense</Badge>;
      case "liability": return <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">Liability</Badge>;
      default: return <Badge variant="outline">{category}</Badge>;
    }
  };

  // Filter to only show components in formula with non-zero values
  const activeComponents = componentConfig.filter(c => 
    c.inFormula && (components[c.key as keyof typeof components] || 0) !== 0
  );

  const excludedComponents = componentConfig.filter(c => 
    !c.inFormula && (components[c.key as keyof typeof components] || 0) !== 0
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/settings">
            <Button variant="ghost" size="icon" data-testid="button-back-settings">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-page-title">Import Cycle Balance Breakdown</h1>
            <p className="text-muted-foreground">Detailed breakdown of the import cycle balance shown on the dashboard</p>
          </div>
        </div>
        <Button onClick={() => refetch()} variant="outline" data-testid="button-refresh">
          Refresh
        </Button>
      </div>

      {/* Main Balance Card */}
      <Card className={isBalanced ? "border-green-500" : "border-destructive"} data-testid="card-main-balance">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Import Cycle Balance
            {isBalanced ? (
              <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Balanced
              </Badge>
            ) : (
              <Badge variant="destructive">
                <AlertCircle className="h-3 w-3 mr-1" />
                Imbalanced
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            This is the same balance shown on the dashboard. Formula: (Assets + Expenses) - Liabilities = Net Balance
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className={`text-center p-6 rounded-lg ${isBalanced ? 'bg-green-50 dark:bg-green-950' : 'bg-destructive/10'}`}>
            <div className="text-sm text-muted-foreground mb-2">Net Import Cycle Balance</div>
            <div className={`text-3xl font-bold ${isBalanced ? 'text-green-600' : 'text-destructive'}`}>
              ${formatNumber(netBalance)}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Components Breakdown */}
      <Card data-testid="card-components">
        <CardHeader>
          <CardTitle>Balance Components</CardTitle>
          <CardDescription>
            All values included in the import cycle balance calculation
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">+/-</TableHead>
                <TableHead>Component</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeComponents.map((config) => {
                const value = components[config.key as keyof typeof components] || 0;
                return (
                  <TableRow key={config.key} data-testid={`component-row-${config.key}`}>
                    <TableCell>
                      {config.sign === "+" ? (
                        <TrendingUp className="h-4 w-4 text-green-600" />
                      ) : (
                        <TrendingDown className="h-4 w-4 text-red-600" />
                      )}
                    </TableCell>
                    <TableCell className="font-medium">{config.label}</TableCell>
                    <TableCell>{getCategoryBadge(config.category)}</TableCell>
                    <TableCell className={`text-right font-mono ${getCategoryColor(config.category)}`}>
                      ${formatNumber(value)}
                    </TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="border-t-2 bg-muted/50">
                <TableCell colSpan={3} className="font-bold">Net Import Cycle Balance</TableCell>
                <TableCell className={`text-right font-bold font-mono ${isBalanced ? 'text-green-600' : 'text-destructive'}`}>
                  ${formatNumber(netBalance)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Excluded Components (Reference) */}
      {excludedComponents.length > 0 && (
        <Card data-testid="card-excluded">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Reference Values
              <Badge variant="outline">Not in Formula</Badge>
            </CardTitle>
            <CardDescription>
              These values are tracked but excluded from the balance formula to avoid double-counting
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Component</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {excludedComponents.map((config) => {
                  const value = components[config.key as keyof typeof components] || 0;
                  return (
                    <TableRow key={config.key} className="opacity-60" data-testid={`excluded-row-${config.key}`}>
                      <TableCell>
                        <Minus className="h-4 w-4 text-muted-foreground" />
                      </TableCell>
                      <TableCell className="font-medium">{config.label}</TableCell>
                      <TableCell>{getCategoryBadge(config.category)}</TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">
                        ${formatNumber(value)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
