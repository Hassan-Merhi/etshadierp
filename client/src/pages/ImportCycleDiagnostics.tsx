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
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { 
  AlertTriangle, 
  AlertCircle, 
  Info, 
  CheckCircle2, 
  ArrowLeft,
  Package,
  Wallet,
  TrendingDown,
  Scale
} from "lucide-react";
import { Link } from "wouter";
import { formatNumber } from "@/lib/formatNumber";

interface DiagnosticIssue {
  id: string;
  type: string;
  severity: "critical" | "warning" | "info";
  description: string;
  impact: number;
  details: any;
  fixGuidance?: string;
}

interface DiagnosticsData {
  totals: {
    assets: number;
    expenses: number;
    liabilities: number;
    netBalance: number;
  };
  components: Record<string, number>;
  issues: DiagnosticIssue[];
  summary: {
    totalIssues: number;
    criticalIssues: number;
    warningIssues: number;
    totalIssueImpact: number;
  };
}

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
      return <Badge variant="destructive" data-testid="badge-severity-critical">Critical</Badge>;
    case "warning":
      return <Badge className="bg-yellow-500 hover:bg-yellow-600" data-testid="badge-severity-warning">Warning</Badge>;
    default:
      return <Badge variant="secondary" data-testid="badge-severity-info">Info</Badge>;
  }
};

const IssueTypeLabel = ({ type }: { type: string }) => {
  const labels: Record<string, string> = {
    negative_inventory: "Negative Inventory",
    orphaned_inventory: "Orphaned Inventory",
    unbalanced_voucher: "Unbalanced Voucher",
    stale_otw_container: "Stale Container",
    duplicate_inventory: "Duplicate Records",
  };
  return <span>{labels[type] || type}</span>;
};

export default function ImportCycleDiagnostics() {
  const { data, isLoading, error, refetch } = useQuery<DiagnosticsData>({
    queryKey: ["/api/debug/import-cycle"],
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <Skeleton className="h-8 w-64" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
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
              <span>Failed to load diagnostics: {(error as Error).message}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isBalanced = Math.abs(data?.totals.netBalance || 0) < 0.01;

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
            <h1 className="text-2xl font-bold" data-testid="text-page-title">Import Cycle Diagnostics</h1>
            <p className="text-muted-foreground">Identify and fix issues causing import cycle imbalance</p>
          </div>
        </div>
        <Button onClick={() => refetch()} variant="outline" data-testid="button-refresh">
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card data-testid="card-assets">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Package className="h-4 w-4" />
              Assets
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              ${formatNumber(data?.totals.assets || 0)}
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-expenses">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingDown className="h-4 w-4" />
              Expenses
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">
              ${formatNumber(data?.totals.expenses || 0)}
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-liabilities">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Wallet className="h-4 w-4" />
              Liabilities
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              ${formatNumber(data?.totals.liabilities || 0)}
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-net-balance">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Scale className="h-4 w-4" />
              Net Balance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${isBalanced ? 'text-green-600' : 'text-destructive'}`}>
              ${formatNumber(data?.totals.netBalance || 0)}
            </div>
            {isBalanced ? (
              <div className="flex items-center gap-1 text-green-600 text-sm mt-1">
                <CheckCircle2 className="h-4 w-4" />
                Balanced
              </div>
            ) : (
              <div className="flex items-center gap-1 text-destructive text-sm mt-1">
                <AlertCircle className="h-4 w-4" />
                Imbalanced
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-summary">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Issues Summary
            {data?.summary.totalIssues === 0 ? (
              <Badge variant="secondary" className="bg-green-100 text-green-800">No Issues</Badge>
            ) : (
              <Badge variant="destructive">{data?.summary.totalIssues} Issues</Badge>
            )}
          </CardTitle>
          <CardDescription>
            {data?.summary.criticalIssues || 0} critical, {data?.summary.warningIssues || 0} warnings
            {data?.summary.totalIssueImpact !== 0 && (
              <> | Total Impact: <strong>${formatNumber(data?.summary.totalIssueImpact || 0)}</strong></>
            )}
          </CardDescription>
        </CardHeader>
      </Card>

      {data?.issues && data.issues.length > 0 && (
        <Card data-testid="card-issues-list">
          <CardHeader>
            <CardTitle>Detected Issues</CardTitle>
            <CardDescription>Click on an issue to see details and fix guidance</CardDescription>
          </CardHeader>
          <CardContent>
            <Accordion type="single" collapsible className="w-full">
              {data.issues.map((issue) => (
                <AccordionItem key={issue.id} value={issue.id} data-testid={`issue-item-${issue.id}`}>
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center gap-3 text-left flex-1">
                      <SeverityIcon severity={issue.severity} />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <SeverityBadge severity={issue.severity} />
                          <IssueTypeLabel type={issue.type} />
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">{issue.description}</p>
                      </div>
                      {issue.impact !== 0 && (
                        <Badge variant="outline" className="ml-auto mr-4">
                          Impact: ${formatNumber(issue.impact)}
                        </Badge>
                      )}
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="pl-8 space-y-4">
                      <div className="bg-muted p-4 rounded-lg">
                        <h4 className="font-medium mb-2">Details</h4>
                        <Table>
                          <TableBody>
                            {Object.entries(issue.details).map(([key, value]) => (
                              <TableRow key={key}>
                                <TableCell className="font-medium capitalize">
                                  {key.replace(/([A-Z])/g, ' $1').trim()}
                                </TableCell>
                                <TableCell>
                                  {typeof value === 'number' 
                                    ? formatNumber(value) 
                                    : String(value ?? '-')}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                      {issue.fixGuidance && (
                        <div className="bg-blue-50 dark:bg-blue-950 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
                          <h4 className="font-medium mb-1 flex items-center gap-2 text-blue-800 dark:text-blue-200">
                            <Info className="h-4 w-4" />
                            How to Fix
                          </h4>
                          <p className="text-sm text-blue-700 dark:text-blue-300">{issue.fixGuidance}</p>
                        </div>
                      )}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </CardContent>
        </Card>
      )}

      <Card data-testid="card-components">
        <CardHeader>
          <CardTitle>Balance Components</CardTitle>
          <CardDescription>Detailed breakdown of all balance components</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Component</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead>Category</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.components && Object.entries(data.components).map(([key, value]) => {
                const isAsset = ['stockOtwValue', 'cashBalance', 'bankBalance', 'stockOnFloorValue', 'assetBalance'].includes(key);
                const isExpense = ['indirectExpenseBalance', 'governmentTaxesBalance', 'cogsBalance'].includes(key);
                const category = isAsset ? 'Asset' : isExpense ? 'Expense' : 'Liability';
                const colorClass = isAsset ? 'text-green-600' : isExpense ? 'text-orange-600' : 'text-red-600';
                
                return (
                  <TableRow key={key} data-testid={`component-row-${key}`}>
                    <TableCell className="font-medium">
                      {key.replace(/([A-Z])/g, ' $1').replace(/Balance$/, '').trim()}
                    </TableCell>
                    <TableCell className={`text-right ${colorClass}`}>
                      ${formatNumber(value)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{category}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
