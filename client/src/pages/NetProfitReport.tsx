import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  TrendingUp,
  TrendingDown,
  Download,
  ChevronDown,
  ChevronRight,
  DollarSign,
  ShoppingCart,
  Receipt,
  BarChart3,
  Building2,
  Loader2,
  Scale,
} from "lucide-react";

type Period = "today" | "this_week" | "this_month" | "this_year" | "all_time";

const PERIODS: { value: Period; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "this_week", label: "This Week" },
  { value: "this_month", label: "This Month" },
  { value: "this_year", label: "This Year" },
  { value: "all_time", label: "All Time" },
];

function getDateRange(period: Period): { startDate: string | null; endDate: string | null } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = fmt(now);

  if (period === "today") return { startDate: today, endDate: today };

  if (period === "this_week") {
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(now);
    monday.setDate(diff);
    return { startDate: fmt(monday), endDate: today };
  }

  if (period === "this_month") {
    return { startDate: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`, endDate: today };
  }

  if (period === "this_year") {
    return { startDate: `${now.getFullYear()}-01-01`, endDate: today };
  }

  return { startDate: null, endDate: null };
}

function formatAmount(n: number) {
  return "$" + new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.abs(Math.round(n)));
}

function AmountCell({ value }: { value: number }) {
  const isNeg = value < 0;
  return (
    <span className={isNeg ? "text-red-600 dark:text-red-400" : "text-green-700 dark:text-green-400"}>
      {isNeg ? "-" : ""}
      {formatAmount(Math.abs(value))}
    </span>
  );
}

function KpiCard({ title, subtitle, value, icon: Icon, color }: { title: string; subtitle?: string; value: number; icon: any; color: string }) {
  const isNeg = value < 0;
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-4">
        <div className={`p-3 rounded-md shrink-0 ${color}`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">{title}</p>
          {subtitle && <p className="text-xs text-muted-foreground/70 italic">{subtitle}</p>}
          <p className={`text-lg font-bold ${isNeg ? "text-red-600 dark:text-red-400" : ""}`}>
            {isNeg ? "-" : ""}
            {formatAmount(Math.abs(value))}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function AccountSection({
  title,
  accounts,
  total,
  type,
  badgeColor,
}: {
  title: string;
  accounts: any[];
  total: number;
  type: "income" | "expense";
  badgeColor: string;
}) {
  const [open, setOpen] = useState(false);
  const filteredAccounts = accounts.filter((a: any) => a.debit !== 0 || a.credit !== 0);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="w-full" data-testid={`toggle-section-${title.toLowerCase().replace(/\s+/g, "-")}`}>
        <div className="flex items-center justify-between p-3 rounded-md hover-elevate cursor-pointer">
          <div className="flex items-center gap-2">
            {open ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
            <Badge className={badgeColor}>{title}</Badge>
            <span className="text-xs text-muted-foreground">{filteredAccounts.length} account{filteredAccounts.length !== 1 ? "s" : ""}</span>
          </div>
          <span className={`font-semibold text-sm ${type === "income" ? (total >= 0 ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400") : (total > 0 ? "text-red-600 dark:text-red-400" : "text-green-700 dark:text-green-400")}`}>
            {formatAmount(Math.abs(total))}
          </span>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-6 mt-1 mb-2 border rounded-md overflow-hidden">
          {filteredAccounts.length === 0 ? (
            <p className="text-xs text-muted-foreground italic p-3">No accounts with transactions in this category.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50">
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Account</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">Debit</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">Credit</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">Net</th>
                </tr>
              </thead>
              <tbody>
                {filteredAccounts.map((acc: any, i: number) => (
                  <tr key={i} className="border-t">
                    <td className="px-3 py-2 text-foreground">{acc.name}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{formatAmount(acc.debit)}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{formatAmount(acc.credit)}</td>
                    <td className="px-3 py-2 text-right font-medium">
                      <AmountCell value={acc.balance} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}


export default function NetProfitReport() {
  const { data: user } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const isAdminOrDev = user?.role === "Admin" || user?.role === "Developer";

  const [period, setPeriod] = useState<Period>("this_month");
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("current");

  const { startDate, endDate } = useMemo(() => getDateRange(period), [period]);
  const periodLabel = PERIODS.find((p) => p.value === period)?.label || "This Month";

  const { data: companies = [] } = useQuery<any[]>({
    queryKey: ["/api/companies"],
    enabled: isAdminOrDev,
  });

  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    if (startDate) p.set("startDate", startDate);
    if (endDate) p.set("endDate", endDate);
    if (isAdminOrDev && selectedCompanyId !== "current" && selectedCompanyId !== "") {
      p.set("companyId", selectedCompanyId);
    }
    return p.toString();
  }, [startDate, endDate, selectedCompanyId, isAdminOrDev]);

  const { data, isLoading, error } = useQuery<any>({
    queryKey: ["/api/reports/net-profit-statement", queryParams],
    queryFn: async () => {
      const url = `/api/reports/net-profit-statement${queryParams ? `?${queryParams}` : ""}`;
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const { data: dashboardData } = useQuery<any>({
    queryKey: ["/api/stats/net-profit"],
  });

  const handleExport = () => {
    const p = new URLSearchParams();
    if (startDate) p.set("startDate", startDate);
    if (endDate) p.set("endDate", endDate);
    p.set("periodLabel", periodLabel);
    if (isAdminOrDev && selectedCompanyId !== "current" && selectedCompanyId !== "") {
      p.set("companyId", selectedCompanyId);
    }
    window.open(`/api/reports/net-profit-excel?${p.toString()}`, "_blank");
  };

  const lp = data?.leftPane;
  const rp = data?.rightPane;

  const salesTotal = rp?.salesAccounts?.total ?? 0;
  const closingStock = rp?.closingStock?.value ?? 0;
  const openingStock = lp?.openingStock?.value ?? 0;
  const purchasesTotal = lp?.purchaseAccounts?.total ?? 0;
  const directExpTotal = lp?.directExpenses?.total ?? 0;
  const directIncTotal = rp?.directIncomes?.total ?? 0;
  const indirectExpTotal = lp?.indirectExpenses?.total ?? 0;
  const indirectIncTotal = rp?.indirectIncomes?.total ?? 0;
  // Compute gross profit on the frontend from period-accurate values only
  // (excludes Opening/Closing Stock which are never period-filtered)
  const grossProfit = salesTotal + directIncTotal - purchasesTotal - directExpTotal;
  const periodNetProfit = grossProfit + indirectIncTotal - indirectExpTotal;
  const balanceSheetPosition = dashboardData?.netPosition ?? data?.netPosition ?? 0;
  const totalExpenses = purchasesTotal + directExpTotal + indirectExpTotal;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between gap-4 px-6 py-4 border-b flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-primary" />
            Net Profit Report
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Income, expenses, and profitability breakdown</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isAdminOrDev && companies.length > 0 && (
            <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
              <SelectTrigger className="w-44" data-testid="select-company">
                <Building2 className="w-4 h-4 mr-2 text-muted-foreground" />
                <SelectValue placeholder="Company" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="current">Current Company</SelectItem>
                {companies.map((c: any) => (
                  <SelectItem key={c.id} value={String(c.id)} data-testid={`option-company-${c.id}`}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
            <SelectTrigger className="w-36" data-testid="select-period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIODS.map((p) => (
                <SelectItem key={p.value} value={p.value} data-testid={`option-period-${p.value}`}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={handleExport} data-testid="button-export-excel" disabled={isLoading}>
            <Download className="w-4 h-4 mr-2" />
            Export Excel
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <Card>
            <CardContent className="p-6 text-center text-red-600 dark:text-red-400">
              Failed to load report. Please try again.
            </CardContent>
          </Card>
        )}

        {!isLoading && !error && data && (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <KpiCard title="Total Sales" value={salesTotal} icon={ShoppingCart} color="bg-blue-600" />
              <KpiCard title="Total Expenses" value={totalExpenses} icon={Receipt} color="bg-red-600" />
              <KpiCard title="Gross Profit" value={grossProfit} icon={BarChart3} color="bg-amber-600" />
              <KpiCard
                title="Net Position"
                subtitle="Balance Sheet"
                value={balanceSheetPosition}
                icon={Scale}
                color={balanceSheetPosition >= 0 ? "bg-teal-600" : "bg-orange-600"}
              />
              <KpiCard title="Closing Stock" value={closingStock} icon={DollarSign} color="bg-purple-600" />
            </div>

            {/* Profit Summary Card */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Profit Summary — {periodLabel}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Income side */}
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Income</p>
                    {[
                      { label: "Sales (Revenue)", value: salesTotal },
                      { label: "Direct Incomes", value: directIncTotal },
                      { label: "Indirect Incomes", value: indirectIncTotal },
                    ].map(({ label, value }) => (
                      <div key={label} className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{label}</span>
                        <AmountCell value={value} />
                      </div>
                    ))}
                  </div>

                  {/* Expense side */}
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Expenses</p>
                    {[
                      { label: "Purchases", value: purchasesTotal },
                      { label: "Direct Expenses", value: directExpTotal },
                      { label: "Indirect Expenses", value: indirectExpTotal },
                    ].map(({ label, value }) => (
                      <div key={label} className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="text-red-600 dark:text-red-400">{formatAmount(value)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <Separator className="my-3" />

                <div className="flex justify-between font-bold text-sm">
                  <span>Gross Profit</span>
                  <AmountCell value={grossProfit} />
                </div>

                <Separator className="my-3" />

                <div className={`flex justify-between items-center font-bold text-sm rounded-md px-3 py-2 ${balanceSheetPosition >= 0 ? "bg-teal-50 dark:bg-teal-950/30" : "bg-orange-50 dark:bg-orange-950/30"}`}>
                  <div>
                    <span>Net Position</span>
                    <span className="text-xs font-normal text-muted-foreground ml-2">(Assets − Liabilities, cumulative)</span>
                  </div>
                  <span className={balanceSheetPosition >= 0 ? "text-teal-700 dark:text-teal-400" : "text-orange-600 dark:text-orange-400"}>
                    {balanceSheetPosition < 0 ? "-" : ""}{formatAmount(Math.abs(balanceSheetPosition))}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Account Breakdown */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Account Breakdown</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <AccountSection
                  title="Purchases"
                  accounts={lp?.purchaseAccounts?.accounts || []}
                  total={purchasesTotal}
                  type="expense"
                  badgeColor="bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
                />
                <AccountSection
                  title="Direct Incomes"
                  accounts={rp?.directIncomes?.accounts || []}
                  total={directIncTotal}
                  type="income"
                  badgeColor="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
                />
                <AccountSection
                  title="Direct Expenses"
                  accounts={lp?.directExpenses?.accounts || []}
                  total={directExpTotal}
                  type="expense"
                  badgeColor="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                />
                <AccountSection
                  title="Indirect Incomes"
                  accounts={rp?.indirectIncomes?.accounts || []}
                  total={indirectIncTotal}
                  type="income"
                  badgeColor="bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300"
                />
                <AccountSection
                  title="Indirect Expenses"
                  accounts={lp?.indirectExpenses?.accounts || []}
                  total={indirectExpTotal}
                  type="expense"
                  badgeColor="bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300"
                />
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
