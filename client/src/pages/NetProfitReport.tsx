import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
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
    const day = now.getDay(); // 0=Sun
    const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Mon
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
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
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

function KpiCard({ title, value, icon: Icon, color }: { title: string; value: number; icon: any; color: string }) {
  const isNeg = value < 0;
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-4">
        <div className={`p-3 rounded-md ${color}`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">{title}</p>
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
  const isPositive = type === "income" ? total >= 0 : total <= 0;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="w-full" data-testid={`toggle-section-${title.toLowerCase().replace(/\s+/g, "-")}`}>
        <div className="flex items-center justify-between p-3 rounded-md hover-elevate cursor-pointer">
          <div className="flex items-center gap-2">
            {open ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
            <Badge className={badgeColor}>{title}</Badge>
            <span className="text-xs text-muted-foreground">{accounts.length} account{accounts.length !== 1 ? "s" : ""}</span>
          </div>
          <span className={`font-semibold text-sm ${type === "income" ? (total >= 0 ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400") : (total > 0 ? "text-red-600 dark:text-red-400" : "text-green-700 dark:text-green-400")}`}>
            {formatAmount(Math.abs(total))}
          </span>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-6 mt-1 mb-2 border rounded-md overflow-hidden">
          {accounts.length === 0 ? (
            <p className="text-xs text-muted-foreground italic p-3">No accounts in this category.</p>
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
                {accounts.map((acc: any, i: number) => (
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
  const { user } = useAuth();
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
  const grossProfit = lp?.grossProfit ?? 0;
  const netProfit = lp?.netProfit ?? 0;
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
          <div className="flex items-center border rounded-md overflow-hidden">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                data-testid={`button-period-${p.value}`}
                onClick={() => setPeriod(p.value)}
                className={`px-3 py-1.5 text-sm transition-colors ${period === p.value ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}
              >
                {p.label}
              </button>
            ))}
          </div>
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
              <KpiCard title="Net Profit" value={netProfit} icon={netProfit >= 0 ? TrendingUp : TrendingDown} color={netProfit >= 0 ? "bg-green-600" : "bg-red-600"} />
              <KpiCard title="Closing Stock" value={closingStock} icon={DollarSign} color="bg-purple-600" />
            </div>

            {/* Summary Card */}
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
                      { label: "Closing Stock Value", value: closingStock },
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
                      { label: "Opening Stock", value: openingStock },
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

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex justify-between font-semibold text-sm">
                    <span>Gross Profit</span>
                    <AmountCell value={grossProfit} />
                  </div>
                  <div className={`flex justify-between font-bold text-sm rounded-md px-2 py-1 ${netProfit >= 0 ? "bg-green-50 dark:bg-green-950/30" : "bg-red-50 dark:bg-red-950/30"}`}>
                    <span>Net Profit / (Loss)</span>
                    <AmountCell value={netProfit} />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Detailed Breakdown */}
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
