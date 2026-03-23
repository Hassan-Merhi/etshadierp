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

function TallyRow({
  label,
  count,
  total,
  accounts,
  sectionKey,
  expandedSections,
  toggleSection,
}: {
  label: string;
  count: number;
  total: number;
  accounts: any[];
  sectionKey: string;
  expandedSections: Set<string>;
  toggleSection: (k: string) => void;
}) {
  const nonZero = accounts.filter((a: any) => Number(a.debit) !== 0 || Number(a.credit) !== 0);
  const isOpen = expandedSections.has(sectionKey);
  return (
    <div>
      <div
        className="flex justify-between items-center px-4 py-3 cursor-pointer hover-elevate"
        onClick={() => toggleSection(sectionKey)}
        data-testid={`row-${sectionKey}`}
      >
        <span className="flex items-center gap-2 text-sm">
          {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          {label}
          {count > 0 && <span className="text-xs text-muted-foreground">({count})</span>}
        </span>
        <span className="font-mono text-sm">{formatAmount(total)}</span>
      </div>
      {isOpen && nonZero.length > 0 && (
        <div className="bg-muted/30 divide-y">
          {nonZero.map((acc: any) => (
            <div key={acc.id} className="flex justify-between items-center px-8 py-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                <ChevronRight className="h-3 w-3" />
                {acc.name}
              </span>
              <span className="font-mono">Dr: {formatAmount(acc.debit)} | Cr: {formatAmount(acc.credit)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function NetProfitReport() {
  const { data: user } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const isAdminOrDev = user?.role === "Admin" || user?.role === "Developer";

  const [period, setPeriod] = useState<Period>("this_month");
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("current");
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const toggleSection = (key: string) =>
    setExpandedSections((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

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
  const grossProfit = lp?.grossProfit ?? 0;
  const periodNetProfit = lp?.netProfit ?? 0;
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
              <KpiCard
                title="Net Position"
                subtitle="Balance Sheet"
                value={balanceSheetPosition}
                icon={Scale}
                color={balanceSheetPosition >= 0 ? "bg-teal-600" : "bg-orange-600"}
              />
              <KpiCard title="Closing Stock" value={closingStock} icon={DollarSign} color="bg-purple-600" />
            </div>

            {/* Tally Two-Pane P&L Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Left Pane — Debit side */}
              <div className="border rounded-md overflow-hidden">
                <div className="bg-muted/50 px-4 py-3 border-b">
                  <span className="font-semibold text-sm">Particulars (Debit)</span>
                </div>
                <div className="divide-y">
                  <div className="flex justify-between items-center px-4 py-3">
                    <span className="flex items-center gap-2 text-sm">
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      Opening Stock
                    </span>
                    <span className="font-mono text-sm">{formatAmount(openingStock)}</span>
                  </div>
                  <TallyRow
                    label="Purchase Accounts"
                    count={lp?.purchaseAccounts?.accounts?.filter((a: any) => a.debit !== 0 || a.credit !== 0).length || 0}
                    total={purchasesTotal}
                    accounts={lp?.purchaseAccounts?.accounts || []}
                    sectionKey="purchaseAccounts"
                    expandedSections={expandedSections}
                    toggleSection={toggleSection}
                  />
                  {directIncTotal > 0 && (
                    <TallyRow
                      label="Direct Incomes"
                      count={rp?.directIncomes?.accounts?.filter((a: any) => a.debit !== 0 || a.credit !== 0).length || 0}
                      total={directIncTotal}
                      accounts={rp?.directIncomes?.accounts || []}
                      sectionKey="directIncomes"
                      expandedSections={expandedSections}
                      toggleSection={toggleSection}
                    />
                  )}
                  {directExpTotal > 0 && (
                    <TallyRow
                      label="Direct Expenses"
                      count={lp?.directExpenses?.accounts?.filter((a: any) => a.debit !== 0 || a.credit !== 0).length || 0}
                      total={directExpTotal}
                      accounts={lp?.directExpenses?.accounts || []}
                      sectionKey="directExpenses"
                      expandedSections={expandedSections}
                      toggleSection={toggleSection}
                    />
                  )}
                  <div className="flex justify-between items-center px-4 py-3 bg-primary/10 font-semibold border-t-2">
                    <span className="text-sm">Total</span>
                    <span className="font-mono text-sm">{formatAmount(lp?.tradingTotal ?? (openingStock + purchasesTotal + directExpTotal))}</span>
                  </div>
                  <div className="h-4 bg-muted/30" />
                  <TallyRow
                    label="Indirect Expenses"
                    count={lp?.indirectExpenses?.accounts?.filter((a: any) => a.debit !== 0 || a.credit !== 0).length || 0}
                    total={indirectExpTotal}
                    accounts={lp?.indirectExpenses?.accounts || []}
                    sectionKey="indirectExpenses"
                    expandedSections={expandedSections}
                    toggleSection={toggleSection}
                  />
                  <div className="flex justify-between items-center px-4 py-3 bg-primary/20 font-bold">
                    <span className="text-sm">Net Position</span>
                    <span className={`font-mono text-sm ${balanceSheetPosition >= 0 ? "text-teal-600 dark:text-teal-400" : "text-orange-600 dark:text-orange-400"}`}>
                      {formatAmount(Math.abs(balanceSheetPosition))}
                      {balanceSheetPosition < 0 && " (Loss)"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Right Pane — Credit side */}
              <div className="border rounded-md overflow-hidden">
                <div className="bg-muted/50 px-4 py-3 border-b">
                  <span className="font-semibold text-sm">Particulars (Credit)</span>
                </div>
                <div className="divide-y">
                  <div className="flex justify-between items-center px-4 py-3">
                    <span className="flex items-center gap-2 text-sm">
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      Sales Accounts
                    </span>
                    <span className="font-mono text-sm">{formatAmount(salesTotal)}</span>
                  </div>
                  <div className="flex justify-between items-center px-4 py-3">
                    <span className="flex items-center gap-2 text-sm">
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      Closing Stock
                    </span>
                    <span className="font-mono text-sm">{formatAmount(closingStock)}</span>
                  </div>
                  {directIncTotal > 0 && <div className="h-[49px] bg-muted/10" />}
                  {directExpTotal > 0 && <div className="h-[49px] bg-muted/10" />}
                  <div className="flex justify-between items-center px-4 py-3 bg-primary/10 font-semibold border-t-2">
                    <span className="text-sm">Total</span>
                    <span className="font-mono text-sm">{formatAmount(rp?.total ?? (salesTotal + closingStock))}</span>
                  </div>
                  <div className="h-4 bg-muted/30" />
                  <TallyRow
                    label="Indirect Incomes"
                    count={rp?.indirectIncomes?.accounts?.filter((a: any) => a.debit !== 0 || a.credit !== 0).length || 0}
                    total={indirectIncTotal}
                    accounts={rp?.indirectIncomes?.accounts || []}
                    sectionKey="indirectIncomes"
                    expandedSections={expandedSections}
                    toggleSection={toggleSection}
                  />
                  <div className="flex justify-between items-center px-4 py-3 bg-primary/20 font-bold">
                    <span className="text-sm">Net Position</span>
                    <span className={`font-mono text-sm ${balanceSheetPosition >= 0 ? "text-teal-600 dark:text-teal-400" : "text-orange-600 dark:text-orange-400"}`}>
                      {formatAmount(Math.abs(balanceSheetPosition))}
                      {balanceSheetPosition < 0 && " (Loss)"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
