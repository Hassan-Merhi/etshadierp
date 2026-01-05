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
  AlertTriangle,
  Info,
  TrendingUp,
  TrendingDown,
  Minus,
  Wrench,
  Database,
  Package
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

interface DiagnosticIssue {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  impact: number;
  howToFix: string;
  category: string;
}

interface BucketVariance {
  bucket: string;
  computed: number;
  fromAccounts: number;
  variance: number;
  accountsInBucket: number;
}

interface UncategorizedAccount {
  accountId: number;
  accountName: string;
  accountCode: string;
  parentType: string;
  bucket: string;
  balance: number;
}

interface ComponentAudit {
  key: string;
  label: string;
  value: number;
  source: "ledger" | "inventory" | "containers" | "sales" | "employees" | "calculated";
  ledgerVerified: boolean;
  ledgerSum?: number;
  variance?: number;
}

interface Reconciliation {
  buckets: BucketVariance[];
  uncategorizedAccounts: UncategorizedAccount[];
  totalUncategorized: number;
  significantVarianceCount: number;
  componentAudit?: ComponentAudit[];
}

interface ContainerAuditEntry {
  containerId: number;
  containerNumber: string;
  status: string;
  supplierName: string;
  itemsTotal: number;
  chargesTotal: number;
  grandTotal: number;
  voucherDebits: number;
  voucherCredits: number;
  difference: number;
  voucherCount: number;
  hasDiscrepancy: boolean;
}

interface DiagnosticsData {
  issues: DiagnosticIssue[];
  summary: {
    totalIssues: number;
    criticalCount: number;
    warningCount: number;
    totalImpact: number;
  };
  reconciliation?: Reconciliation;
  containerAudit?: ContainerAuditEntry[];
}

interface ComponentInfo {
  key: string;
  label: string;
  category: "asset" | "expense" | "liability";
  inFormula: boolean;
  sign: "+" | "-";
}

const componentConfig: ComponentInfo[] = [
  { key: "stockOtwValue", label: "Stock OTW (Containers in Transit)", category: "asset", inFormula: true, sign: "+" },
  { key: "cashBalance", label: "Cash", category: "asset", inFormula: true, sign: "+" },
  { key: "bankBalance", label: "Bank", category: "asset", inFormula: true, sign: "+" },
  { key: "stockOnFloorValue", label: "Stock on Floor (Inventory)", category: "asset", inFormula: true, sign: "+" },
  { key: "assetBalance", label: "Other Assets", category: "asset", inFormula: true, sign: "+" },
  { key: "salaryAdvancesBalance", label: "Salary Advances", category: "asset", inFormula: true, sign: "+" },
  { key: "indirectExpenseBalance", label: "Indirect Expenses", category: "expense", inFormula: true, sign: "+" },
  { key: "payrollExpenseBalance", label: "Payroll Expenses", category: "expense", inFormula: true, sign: "+" },
  { key: "governmentTaxesBalance", label: "Government Taxes", category: "expense", inFormula: true, sign: "+" },
  { key: "cogsBalance", label: "Cost of Goods Sold", category: "expense", inFormula: true, sign: "+" },
  { key: "supplierBalance", label: "Supplier Payables", category: "liability", inFormula: true, sign: "-" },
  { key: "dutyAgentBalance", label: "Duty Agent", category: "liability", inFormula: true, sign: "-" },
  { key: "transporterAgentBalance", label: "Transporter Agent", category: "liability", inFormula: true, sign: "-" },
  { key: "loansBalance", label: "Loans", category: "liability", inFormula: true, sign: "-" },
  { key: "liabilityBalance", label: "Other Liabilities", category: "liability", inFormula: true, sign: "-" },
  { key: "profitBalance", label: "Profit/Retained Earnings", category: "liability", inFormula: true, sign: "-" },
  { key: "incomeBalance", label: "Income", category: "liability", inFormula: true, sign: "-" },
  { key: "payrollLiabilitiesBalance", label: "Payroll Liabilities", category: "liability", inFormula: true, sign: "-" },
  { key: "openingBalanceEquity", label: "Opening Balance Equity", category: "liability", inFormula: true, sign: "+" },
  { key: "directExpenseBalance", label: "Import Charges (capitalized)", category: "expense", inFormula: false, sign: "+" },
  { key: "generalExpenseBalance", label: "General Expenses (Purchases)", category: "expense", inFormula: false, sign: "+" },
  { key: "consumptionBalance", label: "Consumption (in inventory)", category: "expense", inFormula: false, sign: "+" },
  { key: "productionBalance", label: "Production (in inventory)", category: "expense", inFormula: false, sign: "+" },
  { key: "openingStockValue", label: "Opening Stock Value", category: "asset", inFormula: false, sign: "+" },
];

const SeverityIcon = ({ severity }: { severity: string }) => {
  switch (severity) {
    case "critical":
      return <AlertCircle className="h-5 w-5 text-destructive" />;
    case "warning":
      return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
    default:
      return <Info className="h-5 w-5 text-blue-500" />;
  }
};

const SeverityBadge = ({ severity }: { severity: string }) => {
  switch (severity) {
    case "critical":
      return <Badge variant="destructive">Critical</Badge>;
    case "warning":
      return <Badge className="bg-yellow-500 hover:bg-yellow-600 text-white">Warning</Badge>;
    default:
      return <Badge variant="secondary">Info</Badge>;
  }
};

export default function ImportCycleDiagnostics() {
  const { data, isLoading, error, refetch } = useQuery<ImportCycleData>({
    queryKey: ["/api/stats/import-cycle-balance"],
  });

  const { data: diagnosticsData, isLoading: diagnosticsLoading } = useQuery<DiagnosticsData>({
    queryKey: ["/api/stats/import-cycle-diagnostics"],
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
  const issues = diagnosticsData?.issues || [];

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

  const activeComponents = componentConfig.filter(c => 
    c.inFormula && (components[c.key as keyof typeof components] || 0) !== 0
  );

  const excludedComponents = componentConfig.filter(c => 
    !c.inFormula && (components[c.key as keyof typeof components] || 0) !== 0
  );

  // Calculate totals for explanation
  const assetTotal = (components.stockOtwValue || 0) + (components.cashBalance || 0) + 
    (components.bankBalance || 0) + (components.stockOnFloorValue || 0) + 
    (components.assetBalance || 0) + (components.salaryAdvancesBalance || 0);
  
  const expenseTotal = (components.indirectExpenseBalance || 0) + 
    (components.payrollExpenseBalance || 0) + (components.governmentTaxesBalance || 0) + 
    (components.cogsBalance || 0);
  
  const liabilityTotal = (components.supplierBalance || 0) + (components.dutyAgentBalance || 0) + 
    (components.transporterAgentBalance || 0) + (components.loansBalance || 0) + 
    (components.liabilityBalance || 0) + (components.profitBalance || 0) + 
    (components.incomeBalance || 0) + (components.payrollLiabilitiesBalance || 0) - 
    (components.openingBalanceEquity || 0);

  // Find largest contributors
  const getLargestContributors = () => {
    const contributors = activeComponents.map(c => ({
      label: c.label,
      value: components[c.key as keyof typeof components] || 0,
      sign: c.sign,
      category: c.category
    })).filter(c => Math.abs(c.value) > 100).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    return contributors.slice(0, 5);
  };

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
            <p className="text-muted-foreground">Understand what's causing your import cycle balance</p>
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
            This is the same balance shown on the dashboard
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

      {/* What's Causing the Imbalance? - Only show if not balanced */}
      {!isBalanced && (
        <Card className="border-2 border-yellow-500" data-testid="card-diagnostics">
          <CardHeader className="bg-yellow-50 dark:bg-yellow-950">
            <CardTitle className="flex items-center gap-2">
              <Wrench className="h-5 w-5 text-yellow-600" />
              What's Causing the Imbalance?
            </CardTitle>
            <CardDescription>
              The system has analyzed your data and found these potential issues
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            {diagnosticsLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-24" />
                <Skeleton className="h-24" />
              </div>
            ) : issues.length === 0 ? (
              <div className="space-y-4">
                <div className="bg-background p-4 rounded-lg border">
                  <h4 className="font-semibold mb-3">Balance Breakdown</h4>
                  <div className="grid grid-cols-3 gap-4 text-center mb-4">
                    <div className="p-3 bg-green-50 dark:bg-green-950 rounded">
                      <div className="text-xs text-muted-foreground">Assets + Expenses</div>
                      <div className="text-lg font-bold text-green-600">${formatNumber(assetTotal + expenseTotal)}</div>
                    </div>
                    <div className="flex items-center justify-center text-2xl font-bold">−</div>
                    <div className="p-3 bg-red-50 dark:bg-red-950 rounded">
                      <div className="text-xs text-muted-foreground">Liabilities</div>
                      <div className="text-lg font-bold text-red-600">${formatNumber(liabilityTotal)}</div>
                    </div>
                  </div>
                  <div className="text-center p-3 bg-muted rounded">
                    <div className="text-xs text-muted-foreground">= Net Balance</div>
                    <div className={`text-xl font-bold ${isBalanced ? 'text-green-600' : 'text-destructive'}`}>
                      ${formatNumber(netBalance)}
                    </div>
                  </div>
                </div>

                <div className="bg-background p-4 rounded-lg border">
                  <h4 className="font-semibold mb-3">Largest Components</h4>
                  <div className="space-y-2">
                    {getLargestContributors().map((c, i) => (
                      <div key={i} className="flex items-center justify-between p-2 bg-muted/50 rounded">
                        <span className="flex items-center gap-2">
                          {c.sign === "+" ? (
                            <TrendingUp className="h-4 w-4 text-green-600" />
                          ) : (
                            <TrendingDown className="h-4 w-4 text-red-600" />
                          )}
                          {c.label}
                        </span>
                        <span className={`font-mono ${c.category === 'liability' ? 'text-red-600' : 'text-green-600'}`}>
                          ${formatNumber(c.value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-blue-50 dark:bg-blue-950 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
                  <div className="flex items-start gap-2">
                    <Info className="h-5 w-5 text-blue-600 mt-0.5" />
                    <div>
                      <h4 className="font-semibold text-blue-800 dark:text-blue-200">What This Means</h4>
                      <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                        {netBalance < 0 
                          ? `Your liabilities ($${formatNumber(liabilityTotal)}) exceed your assets plus expenses ($${formatNumber(assetTotal + expenseTotal)}) by $${formatNumber(Math.abs(netBalance))}. This could indicate unpaid supplier bills without corresponding inventory, or adjustments from a previous system.`
                          : `Your assets plus expenses ($${formatNumber(assetTotal + expenseTotal)}) exceed your liabilities ($${formatNumber(liabilityTotal)}) by $${formatNumber(netBalance)}. This could indicate inventory that wasn't properly accounted for, or missing liability entries.`
                        }
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {issues.map((issue) => (
                  <div 
                    key={issue.id} 
                    className={`p-4 rounded-lg border-l-4 ${
                      issue.severity === "critical" 
                        ? "border-l-destructive bg-destructive/5" 
                        : issue.severity === "warning"
                        ? "border-l-yellow-500 bg-yellow-50 dark:bg-yellow-950"
                        : "border-l-blue-500 bg-blue-50 dark:bg-blue-950"
                    }`}
                    data-testid={`issue-${issue.id}`}
                  >
                    <div className="flex items-start gap-3">
                      <SeverityIcon severity={issue.severity} />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <SeverityBadge severity={issue.severity} />
                          <span className="font-semibold">{issue.title}</span>
                          {issue.impact > 0 && (
                            <Badge variant="outline" className="ml-auto">
                              Impact: ${formatNumber(issue.impact)}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mb-3">
                          {issue.description}
                        </p>
                        <div className="bg-background p-3 rounded border">
                          <div className="flex items-center gap-2 text-sm font-medium mb-1">
                            <Wrench className="h-4 w-4" />
                            How to Fix
                          </div>
                          <p className="text-sm">{issue.howToFix}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

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

      {/* Reconciliation Section */}
      {diagnosticsData?.reconciliation && (
        <Card data-testid="card-reconciliation">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Reconciliation Analysis
              {diagnosticsData.reconciliation.significantVarianceCount > 0 ? (
                <Badge variant="destructive">{diagnosticsData.reconciliation.significantVarianceCount} Variance(s)</Badge>
              ) : (
                <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">All Matched</Badge>
              )}
            </CardTitle>
            <CardDescription>
              Comparing computed totals vs account-level sums to identify discrepancies
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bucket</TableHead>
                  <TableHead className="text-right">Computed</TableHead>
                  <TableHead className="text-right">From Accounts</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead className="text-right">Accounts</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {diagnosticsData.reconciliation.buckets
                  .filter(b => b.computed !== 0 || b.fromAccounts !== 0 || b.variance !== 0)
                  .map((bucket) => (
                  <TableRow 
                    key={bucket.bucket} 
                    className={Math.abs(bucket.variance) > 1 ? 'bg-yellow-50 dark:bg-yellow-950' : ''}
                    data-testid={`recon-row-${bucket.bucket}`}
                  >
                    <TableCell className="font-medium">{bucket.bucket}</TableCell>
                    <TableCell className="text-right font-mono">${formatNumber(bucket.computed)}</TableCell>
                    <TableCell className="text-right font-mono">${formatNumber(bucket.fromAccounts)}</TableCell>
                    <TableCell className={`text-right font-mono ${Math.abs(bucket.variance) > 1 ? 'text-destructive font-bold' : ''}`}>
                      ${formatNumber(bucket.variance)}
                    </TableCell>
                    <TableCell className="text-right">{bucket.accountsInBucket}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {diagnosticsData.reconciliation.uncategorizedAccounts.length > 0 && (
              <div className="mt-4">
                <h4 className="font-semibold mb-2 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-500" />
                  Uncategorized Accounts (potential issue source)
                </h4>
                <div className="space-y-2">
                  {diagnosticsData.reconciliation.uncategorizedAccounts.map((account) => (
                    <div key={account.accountId} className="flex items-center justify-between p-2 bg-muted rounded">
                      <span>
                        <span className="font-mono text-sm">{account.accountCode}</span>
                        <span className="ml-2">{account.accountName}</span>
                        <Badge variant="outline" className="ml-2">{account.parentType}</Badge>
                      </span>
                      <span className={`font-mono ${account.balance < 0 ? 'text-red-600' : 'text-green-600'}`}>
                        ${formatNumber(account.balance)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {diagnosticsData.reconciliation.componentAudit && diagnosticsData.reconciliation.componentAudit.length > 0 && (
              <div className="mt-6">
                <h4 className="font-semibold mb-2 flex items-center gap-2">
                  <Database className="h-4 w-4" />
                  Component Audit (All {diagnosticsData.reconciliation.componentAudit.length} Balance Components)
                </h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Component</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead className="text-right">Ledger Sum</TableHead>
                      <TableHead className="text-right">Variance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {diagnosticsData.reconciliation.componentAudit.map((comp) => (
                      <TableRow 
                        key={comp.key}
                        className={comp.variance && Math.abs(comp.variance) > 0.5 ? 'bg-red-50 dark:bg-red-950' : ''}
                        data-testid={`audit-row-${comp.key}`}
                      >
                        <TableCell className="font-medium">{comp.label}</TableCell>
                        <TableCell className="text-right font-mono">
                          ${formatNumber(comp.value)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={comp.ledgerVerified ? "default" : "outline"}>
                            {comp.source}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {comp.ledgerVerified ? `$${formatNumber(comp.ledgerSum || 0)}` : 'N/A'}
                        </TableCell>
                        <TableCell className={`text-right font-mono ${comp.variance && Math.abs(comp.variance) > 0.5 ? 'text-destructive font-bold' : ''}`}>
                          {comp.ledgerVerified ? `$${formatNumber(comp.variance || 0)}` : '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Container Offload Audit */}
      {diagnosticsData?.containerAudit && diagnosticsData.containerAudit.length > 0 && (
        <Card data-testid="container-audit-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Container Offload Audit
              {diagnosticsData.containerAudit.filter(c => c.hasDiscrepancy).length > 0 ? (
                <Badge variant="destructive">
                  {diagnosticsData.containerAudit.filter(c => c.hasDiscrepancy).length} Discrepancy
                </Badge>
              ) : (
                <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">All Balanced</Badge>
              )}
            </CardTitle>
            <CardDescription>
              Comparing voucher debits vs credits for each offloaded container to find unbalanced entries
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Container</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead className="text-right">Container Total</TableHead>
                  <TableHead className="text-right">Voucher Debits</TableHead>
                  <TableHead className="text-right">Voucher Credits</TableHead>
                  <TableHead className="text-right">Difference</TableHead>
                  <TableHead className="text-right">Entries</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {diagnosticsData.containerAudit.map((container) => (
                  <TableRow 
                    key={container.containerId}
                    className={container.hasDiscrepancy ? 'bg-red-50 dark:bg-red-950' : ''}
                    data-testid={`container-row-${container.containerId}`}
                  >
                    <TableCell className="font-medium">{container.containerNumber}</TableCell>
                    <TableCell>{container.supplierName}</TableCell>
                    <TableCell className="text-right font-mono">${formatNumber(container.grandTotal)}</TableCell>
                    <TableCell className="text-right font-mono">${formatNumber(container.voucherDebits)}</TableCell>
                    <TableCell className="text-right font-mono">${formatNumber(container.voucherCredits)}</TableCell>
                    <TableCell className={`text-right font-mono ${container.hasDiscrepancy ? 'text-destructive font-bold' : ''}`}>
                      ${formatNumber(container.difference)}
                    </TableCell>
                    <TableCell className="text-right">{container.voucherCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Summary row */}
            <div className="mt-4 p-4 bg-muted rounded-lg">
              <div className="flex justify-between items-center">
                <span className="font-semibold">Total Discrepancy:</span>
                <span className={`font-mono text-lg ${diagnosticsData.containerAudit.reduce((sum, c) => sum + c.difference, 0) !== 0 ? 'text-destructive font-bold' : 'text-green-600'}`}>
                  ${formatNumber(diagnosticsData.containerAudit.reduce((sum, c) => sum + c.difference, 0))}
                </span>
              </div>
              {diagnosticsData.containerAudit.filter(c => c.hasDiscrepancy).length > 0 && (
                <p className="text-sm text-muted-foreground mt-2">
                  The containers highlighted in red have unbalanced voucher entries. 
                  A positive difference means debits exceed credits (possible missing liability).
                  A negative difference means credits exceed debits (possible missing expense/asset).
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
