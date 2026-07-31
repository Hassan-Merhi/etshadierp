import {useState, useMemo, useCallback, useEffect} from "react";
import {useSearch} from "wouter";
import FactoryFinancialSnapshot from "@/pages/factory/FactoryFinancialSnapshot";
import FactoryShippingContainers from "@/pages/factory/FactoryShippingContainers";
import FactoryStatusBuilder from "@/pages/factory/FactoryStatusBuilder";
import FactoryContainerTracking from "@/pages/factory/FactoryContainerTracking";
import FactoryOtwTrackingTab from "@/pages/factory/FactoryOtwTrackingTab";
import ProductionComparison from "@/pages/factory/ProductionComparison";
import {addDays, format} from "date-fns";
import {useQuery} from "@tanstack/react-query";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {Skeleton} from "@/components/ui/skeleton";
import {PageHeader} from "@/components/PageHeader";
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from "@/components/ui/table";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {Tabs, TabsContent, TabsList, TabsTrigger} from "@/components/ui/tabs";
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from "@/components/ui/collapsible";
import {ChevronDown, ChevronRight, ChevronLeft, FlaskConical, PackageCheck, Scale, TrendingUp, TrendingDown, Minus, Tag, Trash2, Package, ShoppingCart, AlertTriangle, Truck, RefreshCw, Ship} from "lucide-react";
import {type WeightEditBale} from "@/components/BaleWeightEditDialog";

import type {LedgerData, Preset, ReportData} from "./dailyproductionreport/types";
import {GRADE_COLORS, GRADE_ORDER, classifyByGrade, computeWorkerExpectedSalary, fmtKg, fmtL, fmtML, fmtMoney, fmtNL, fmtRate, fmtSalary, lastMonthRange, monthEnd, monthStart, todayStr, weekEnd, weekStart, yearStart, yesterdayStr} from "./dailyproductionreport/utils";
import {StatRow} from "./dailyproductionreport/components/StatRow";
import {SkeletonBox} from "./dailyproductionreport/components/SkeletonBox";
import {ExpandableCard} from "./dailyproductionreport/components/ExpandableCard";
import {CategoryProductBreakdown} from "./dailyproductionreport/components/CategoryProductBreakdown";
import {CategoryPieChart} from "./dailyproductionreport/components/CategoryPieChart";
import {MiniPieChart} from "./dailyproductionreport/components/MiniPieChart";
import {LedgerSection} from "./dailyproductionreport/components/LedgerSection";
export default function DailyProductionReport() {
  const search = useSearch();
  const initialTab = new URLSearchParams(search).get("tab") || "production";
  const [activeTab, setActiveTab] = useState(initialTab);

  // Keep in sync if the query param changes after mount (e.g. navigating here
  // again from a redirect like /factory/bale-ledger?tab=ledger while already
  // on this page).
  useEffect(() => {
    const tab = new URLSearchParams(search).get("tab");
    setActiveTab(tab || "production");
  }, [search]);
  const [preset, setPreset] = useState<Preset>("today");
  const [customFrom, setCustomFrom] = useState(todayStr());
  const [customTo, setCustomTo] = useState(todayStr());
  const [workerPayrollOpen, setWorkerPayrollOpen] = useState(false);
  const [empPayrollOpen, setEmpPayrollOpen] = useState(false);

  const { from, to } = useMemo(() => {
    if (preset === "today") return { from: todayStr(), to: todayStr() };
    if (preset === "yesterday") return { from: yesterdayStr(), to: yesterdayStr() };
    if (preset === "week") return { from: weekStart(), to: weekEnd() };
    if (preset === "month") return { from: monthStart(), to: monthEnd() };
    if (preset === "lastmonth") {
      const [f, t] = lastMonthRange();
      return { from: f, to: t };
    }
    if (preset === "year") return { from: yearStart(), to: todayStr() };
    if (preset === "alltime") return { from: "", to: "" };
    return { from: customFrom, to: customTo };
  }, [preset, customFrom, customTo]);

  const stepDates = useCallback(
    (n: number) => {
      const fmt = "yyyy-MM-dd";
      const baseFrom = from || todayStr();
      const baseTo = to || todayStr();
      setCustomFrom(format(addDays(new Date(baseFrom + "T00:00:00"), n), fmt));
      setCustomTo(format(addDays(new Date(baseTo + "T00:00:00"), n), fmt));
      setPreset("custom");
    },
    [from, to]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      const isBack = e.key === "-" || e.code === "Minus";
      const isForward = (e.key === "+" && e.shiftKey) || (e.code === "Equal" && e.shiftKey) || e.key === "=";
      if (isBack) {
        e.preventDefault();
        stepDates(-1);
      } else if (isForward) {
        e.preventDefault();
        stepDates(1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [stepDates]);

  const { data, isLoading } = useQuery<ReportData>({
    queryKey: ["/api/factory/production-value-report", from, to],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const qs = params.toString() ? `?${params.toString()}` : "";
      const res = await fetch(`/api/factory/production-value-report${qs}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: preset === "alltime" || (!!from && !!to),
  });

  const {
    data: ledger,
    isLoading: ledgerLoading,
    refetch: ledgerRefetch,
    isFetching: ledgerFetching,
  } = useQuery<LedgerData>({
    queryKey: ["/api/factory/bale-ledger"],
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  const { data: attendanceData } = useQuery<{
    dates: { date: string; isWeekend: boolean }[];
    workers: {
      id: number;
      employeeCode: string;
      fullName: string;
      baseSalary: string;
      salaryType: string;
      transportAllowance: string;
      attendance: Record<string, string>;
      paidSalary: string;
    }[];
  }>({
    queryKey: ["/api/factory/workers/attendance-report", from, to],
    queryFn: async () => {
      const res = await fetch(`/api/factory/workers/attendance-report?startDate=${from}&endDate=${to}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load attendance");
      return res.json();
    },
    enabled: !!from && !!to,
  });

  const payrollDateParam = to || todayStr();
  const payrollStartParam = from || "";
  const { data: monthlySalarySummary } = useQuery<{
    currentDay: number;
    daysInMonth: number;
    totalWorkerBaseSalary: number;
    totalWorkerTransport: number;
    totalWorkerPaid: number;
    totalEmployeeMonthlySalary: number;
    totalEmployeeBalance: number;
    workerBreakdown: {
      id: number;
      name: string;
      baseSalary: number;
      transport: number;
      expected: number;
      transportProrated: number;
      total: number;
    }[];
    employeeBreakdown: { id: number; name: string; monthlySalary: number; expected: number; balance: number }[];
  }>({
    queryKey: ["/api/factory/monthly-salary-summary", payrollDateParam, payrollStartParam],
    queryFn: async () => {
      const params = new URLSearchParams({ date: payrollDateParam, includeBreakdown: "true" });
      if (payrollStartParam) params.set("startDate", payrollStartParam);
      const res = await fetch(`/api/factory/monthly-salary-summary?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    staleTime: 60_000,
  });

  const salaryKpi = useMemo(() => {
    if (!attendanceData || !attendanceData.dates.length) return null;
    let totalExpected = 0;
    let totalPaid = 0;
    const perWorker: { code: string; name: string; attendanceSalary: number; transport: number; baseSalary: number }[] =
      [];
    for (const w of attendanceData.workers) {
      const transport = parseFloat(w.transportAllowance || "0");
      const fullExpected = computeWorkerExpectedSalary(w, attendanceData.dates);
      const attendanceSalary = fullExpected - transport;
      totalExpected += fullExpected;
      totalPaid += parseFloat(w.paidSalary || "0");
      perWorker.push({
        code: w.employeeCode || String(w.id),
        name: w.fullName || w.employeeCode || String(w.id),
        attendanceSalary,
        transport,
        baseSalary: parseFloat(w.baseSalary || "0"),
      });
    }
    return { totalExpected, totalPaid, totalRemaining: totalExpected - totalPaid, perWorker };
  }, [attendanceData]);

  const presets: { key: Preset; label: string }[] = [
    { key: "today", label: "Today" },
    { key: "yesterday", label: "Yesterday" },
    { key: "week", label: "This Week" },
    { key: "month", label: "This Month" },
    { key: "lastmonth", label: "Last Month" },
    { key: "year", label: "This Year" },
    { key: "alltime", label: "All Time" },
    { key: "custom", label: "Custom" },
  ];

  const statusValue = data?.summary.statusValue ?? 0;
  const statusPositive = statusValue >= 0;
  const grand = ledger?.totals.grand;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b flex-shrink-0">
        <PageHeader title="Overview" subtitle="Manufacturing overview — output metrics &amp; bale lifecycle" />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 overflow-hidden">
        <TabsList className="mx-4 mt-3 mb-0 flex-shrink-0 w-fit" data-testid="tabs-production-analytics">
          <TabsTrigger value="otw-tracking" data-testid="tab-otw-tracking">
            OTW Tracking
          </TabsTrigger>
          <TabsTrigger value="production" data-testid="tab-production">
            Production
          </TabsTrigger>
          <TabsTrigger value="comparison" data-testid="tab-comparison">
            Comparison
          </TabsTrigger>
          <TabsTrigger value="snapshot" data-testid="tab-snapshot" className="hidden">
            Financial Snapshot
          </TabsTrigger>
          <TabsTrigger value="ledger" data-testid="tab-ledger">
            Bale Ledger
          </TabsTrigger>
          <TabsTrigger value="shipping" data-testid="tab-shipping">
            Shipping Containers
          </TabsTrigger>
          <TabsTrigger value="sheets" data-testid="tab-sheets">
            Factory Sheets
          </TabsTrigger>
          <TabsTrigger value="container-tracking" data-testid="tab-container-tracking" className="hidden">
            <Ship className="h-3.5 w-3.5" />
            Container Tracking
          </TabsTrigger>
        </TabsList>

        {/* ── OTW Tracking tab ── */}
        <TabsContent value="otw-tracking" className="flex-1 overflow-y-auto p-4 mt-0 data-[state=inactive]:hidden">
          <FactoryOtwTrackingTab />
        </TabsContent>

        {/* ── Production tab ── */}
        <TabsContent
          value="production"
          className="flex-1 overflow-y-auto p-4 gap-4 flex flex-col mt-0 data-[state=inactive]:hidden"
        >
          {/* Date filter + Pie chart row */}
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="icon"
                variant="outline"
                onClick={() => stepDates(-1)}
                data-testid="button-date-prev"
                title="Previous day"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>

              <Select value={preset} onValueChange={(v) => setPreset(v as Preset)}>
                <SelectTrigger className="w-40" data-testid="select-preset">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {presets.map((p) => (
                    <SelectItem key={p.key} value={p.key} data-testid={`option-preset-${p.key}`}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {preset === "custom" && (
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="border rounded-md px-2 py-1 text-sm bg-background text-foreground"
                    data-testid="input-custom-from"
                  />
                  <span className="text-muted-foreground text-sm">to</span>
                  <input
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className="border rounded-md px-2 py-1 text-sm bg-background text-foreground"
                    data-testid="input-custom-to"
                  />
                </div>
              )}

              <Button
                size="icon"
                variant="outline"
                onClick={() => stepDates(1)}
                data-testid="button-date-next"
                title="Next day"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            {/* Compact pie charts — same row as date picker */}
            {!isLoading &&
              data &&
              (() => {
                // For the Grade chart, use production.byCategory rows + ONE synthetic
                // "__WIPERS_GARBAGE__" row whose weight equals wipersGarbage.totalWeightKg.
                // This guarantees both charts show the identical Wipers & Garbage total,
                // regardless of the actual category names inside wipersGarbage.rows.
                const gradeRows: { categoryName: string; totalWeightKg: number }[] = [
                  ...data.production.byCategory.map((c) => ({
                    categoryName: c.categoryName,
                    totalWeightKg: c.totalWeightKg,
                  })),
                  ...(data.wipersGarbage.totalWeightKg > 0
                    ? [{ categoryName: "__WIPERS_GARBAGE__", totalWeightKg: data.wipersGarbage.totalWeightKg }]
                    : []),
                ];
                const hasData = gradeRows.some((r) => r.totalWeightKg > 0);
                if (!hasData) return null;
                return (
                  <div className="flex flex-wrap gap-6">
                    <CategoryPieChart
                      byCategory={data.production.byCategory}
                      wipersGarbageKg={data.wipersGarbage.totalWeightKg}
                    />
                    <MiniPieChart
                      title="By Grade"
                      allRows={gradeRows}
                      classifyFn={classifyByGrade}
                      order={GRADE_ORDER}
                      colors={GRADE_COLORS}
                      testId="card-grade-pie"
                    />
                  </div>
                );
              })()}
          </div>

          {/* ── Top Summary Bar ── */}
          <Card data-testid="card-summary-bar">
            <CardContent className="py-3 px-4">
              {isLoading ? (
                <div className="flex gap-6 flex-wrap">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-5 w-40" />
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {/* Row 1 — money summary */}
                  <div className="flex flex-wrap items-center gap-6">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Production Value
                      </span>
                      <span
                        className="text-base font-bold text-blue-600 dark:text-blue-400"
                        data-testid="text-production-value"
                      >
                        {fmtMoney(data?.summary.productionValue ?? 0)}
                      </span>
                    </div>
                    <div className="w-px h-5 bg-border" />
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Batch Cost
                      </span>
                      <span className="text-base font-bold" data-testid="text-batch-cost">
                        {fmtMoney(data?.summary.batchCost ?? 0)}
                      </span>
                    </div>
                    <div className="w-px h-5 bg-border" />
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Status
                      </span>
                      <span
                        className={`text-base font-bold px-3 py-0.5 rounded-md ${
                          statusPositive
                            ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                            : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                        }`}
                        data-testid="text-status-value"
                      >
                        {statusPositive ? "+" : ""}
                        {fmtMoney(statusValue)}
                      </span>
                      {statusPositive ? (
                        <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" />
                      ) : statusValue === 0 ? (
                        <Minus className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <TrendingDown className="h-4 w-4 text-red-600 dark:text-red-400" />
                      )}
                    </div>
                  </div>

                  {/* Row 2 — weight breakdown */}
                  {(() => {
                    const origKg = data?.rawMaterial.totalWeightKg ?? 0;
                    const productionsKg =
                      (data?.production.totalWeightKg ?? 0) + (data?.wipersGarbage.totalWeightKg ?? 0);
                    // Total = Productions − Original Batches (material consumed → finished goods + waste)
                    const totalKg = productionsKg - origKg;
                    const isPositive = totalKg >= 0;
                    return (
                      <div className="flex flex-wrap items-center gap-5 pt-2 border-t border-border">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-muted-foreground">Productions</span>
                          <span className="text-base font-bold" data-testid="text-weight-productions">
                            {fmtKg(productionsKg)}
                          </span>
                        </div>
                        <span className="text-muted-foreground text-base font-semibold">&#8722;</span>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-muted-foreground">Original Batches</span>
                          <span className="text-base font-bold" data-testid="text-weight-batches">
                            {fmtKg(origKg)}
                          </span>
                        </div>
                        <span className="text-muted-foreground text-base font-semibold">=</span>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-muted-foreground">Total</span>
                          <span
                            className={`text-base font-bold ${isPositive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                            data-testid="text-weight-total"
                          >
                            {fmtKg(totalKg)}
                          </span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Salary Overview ── */}
          {(() => {
            const ms = monthlySalarySummary;
            const workerTotal = salaryKpi ? salaryKpi.totalExpected : null;
            const workerRemaining = ms && workerTotal !== null ? workerTotal - ms.totalWorkerPaid : null;
            const attSalaryTotal = salaryKpi ? salaryKpi.totalExpected - (ms?.totalWorkerTransport ?? 0) : null;
            const attTransportTotal = ms ? ms.totalWorkerTransport : null;
            // Employee expected: total prorated salary for the period
            const empExpected = ms ? ms.employeeBreakdown.reduce((sum, e) => sum + e.expected, 0) : null;
            const empBalance = ms ? ms.totalEmployeeBalance : null;
            const presetLabel =
              presets.find((p) => p.key === preset)?.label ??
              (from && to && from !== to ? `${from} → ${to}` : from || "");
            const dayRange = ms ? `Day ${ms.currentDay} / ${ms.daysInMonth}` : "";

            return (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60 px-0.5">
                  Payroll Overview — {presetLabel}
                  {dayRange ? ` (${dayRange})` : ""}
                </p>

                {/* Row 1 — Workers (combined + collapsible) */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* Combined: Worker Expected + Transport */}
                  <Collapsible open={workerPayrollOpen} onOpenChange={setWorkerPayrollOpen}>
                    <Card data-testid="card-worker-expected-salary">
                      <CollapsibleTrigger asChild>
                        <div className="py-3 px-4 cursor-pointer select-none" data-testid="trigger-worker-payroll">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              Workers + Transport
                            </p>
                            <ChevronDown
                              className={`h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform duration-150 ${workerPayrollOpen ? "rotate-180" : ""}`}
                            />
                          </div>
                          <div className="flex items-baseline gap-3 mt-1 flex-wrap">
                            {workerTotal !== null ? (
                              <p
                                className="text-xl font-bold tabular-nums text-foreground"
                                data-testid="text-worker-expected-salary"
                              >
                                {fmtSalary(workerTotal)}
                              </p>
                            ) : (
                              <p className="text-xl font-bold tabular-nums text-muted-foreground">—</p>
                            )}
                            {workerTotal !== null && ms && ms.currentDay > 0 && (
                              <p className="text-sm font-semibold tabular-nums text-muted-foreground">
                                {fmtSalary(workerTotal / ms.currentDay)}
                                <span className="text-xs font-normal opacity-60 ml-1">/day</span>
                              </p>
                            )}
                          </div>
                          <div className="flex gap-3 mt-0.5 flex-wrap">
                            {attSalaryTotal !== null && (
                              <p className="text-xs text-muted-foreground">
                                {fmtSalary(attSalaryTotal)} <span className="opacity-60">salary</span>
                              </p>
                            )}
                            {attTransportTotal !== null && (
                              <p className="text-xs text-muted-foreground">
                                {fmtSalary(attTransportTotal)} <span className="opacity-60">transport</span>
                              </p>
                            )}
                          </div>
                        </div>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="border-t px-4 pb-3 pt-2 space-y-1">
                          {salaryKpi && salaryKpi.perWorker.length > 0 ? (
                            <>
                              <div className="grid grid-cols-4 gap-1 text-xs font-medium text-muted-foreground mb-1.5 px-0.5">
                                <span>Worker</span>
                                <span className="text-right">Salary</span>
                                <span className="text-right">Transport/d</span>
                                <span className="text-right">Daily</span>
                              </div>
                              {salaryKpi.perWorker.map((w) => {
                                const dailyTransport = ms && ms.daysInMonth > 0 ? w.transport / ms.daysInMonth : 0;
                                const daily =
                                  ms && ms.daysInMonth > 0 ? (w.baseSalary + w.transport) / ms.daysInMonth : 0;
                                return (
                                  <div key={w.code} className="grid grid-cols-4 gap-1 text-xs py-0.5">
                                    <span className="truncate text-foreground/90">{w.name}</span>
                                    <span className="text-right tabular-nums text-foreground">
                                      {fmtSalary(w.attendanceSalary)}
                                    </span>
                                    <span className="text-right tabular-nums text-muted-foreground">
                                      {w.transport > 0 ? (
                                        fmtSalary(dailyTransport)
                                      ) : (
                                        <span className="opacity-40">—</span>
                                      )}
                                    </span>
                                    <span className="text-right tabular-nums text-sky-600 dark:text-sky-400">
                                      {fmtSalary(daily)}
                                    </span>
                                  </div>
                                );
                              })}
                              <div className="grid grid-cols-4 gap-1 text-xs pt-1.5 border-t mt-1">
                                <span className="font-medium text-muted-foreground">Total</span>
                                <span className="text-right tabular-nums font-semibold text-foreground">
                                  {fmtSalary(attSalaryTotal ?? 0)}
                                </span>
                                <span className="text-right tabular-nums font-semibold text-foreground">
                                  {ms && ms.daysInMonth > 0
                                    ? fmtSalary((attTransportTotal ?? 0) / ms.daysInMonth)
                                    : "—"}
                                </span>
                                <span className="text-right tabular-nums font-semibold text-sky-600 dark:text-sky-400">
                                  {ms && ms.daysInMonth > 0
                                    ? fmtSalary((ms.totalWorkerBaseSalary + ms.totalWorkerTransport) / ms.daysInMonth)
                                    : "—"}
                                </span>
                              </div>
                            </>
                          ) : (
                            <p className="text-xs text-muted-foreground">No monthly workers found.</p>
                          )}
                        </div>
                      </CollapsibleContent>
                    </Card>
                  </Collapsible>

                  {/* Worker Remaining */}
                  <Card className="border-amber-300 dark:border-amber-700" data-testid="card-worker-remaining">
                    <CardContent className="py-3 px-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                        Worker Remaining
                      </p>
                      {workerRemaining !== null ? (
                        <p
                          className={
                            workerRemaining < 0
                              ? "text-xl font-bold tabular-nums text-blue-600 dark:text-blue-400"
                              : workerRemaining === 0
                                ? "text-xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400"
                                : "text-xl font-bold tabular-nums text-amber-600 dark:text-amber-400"
                          }
                          data-testid="text-worker-remaining"
                        >
                          {workerRemaining < 0
                            ? `Overpaid ${fmtSalary(Math.abs(workerRemaining))}`
                            : fmtSalary(workerRemaining)}
                        </p>
                      ) : (
                        <p className="text-xl font-bold tabular-nums text-muted-foreground">—</p>
                      )}
                      {ms && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {fmtSalary(ms.totalWorkerPaid)} <span className="opacity-60">paid this month</span>
                        </p>
                      )}
                    </CardContent>
                  </Card>

                  {/* Total Payroll */}
                  <Card data-testid="card-total-payroll">
                    <CardContent className="py-3 px-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                        Total Payroll
                      </p>
                      {workerTotal !== null && empExpected !== null ? (
                        <>
                          <div className="flex items-baseline gap-3 flex-wrap">
                            <p
                              className="text-xl font-bold tabular-nums text-foreground"
                              data-testid="text-combined-total"
                            >
                              {fmtSalary(workerTotal + empExpected)}
                            </p>
                            {ms && ms.currentDay > 0 && ms.daysInMonth > 0 && (
                              <p className="text-sm font-semibold tabular-nums text-muted-foreground">
                                {fmtSalary(
                                  workerTotal / ms.currentDay + ms.totalEmployeeMonthlySalary / ms.daysInMonth
                                )}
                                <span className="text-xs font-normal opacity-60 ml-1">/day</span>
                              </p>
                            )}
                          </div>
                          {ms && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {fmtSalary(ms.totalEmployeeMonthlySalary)}{" "}
                              <span className="opacity-60">employee monthly</span>
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="text-xl font-bold tabular-nums text-muted-foreground">—</p>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {/* Row 2 — Employees */}
                <div className="grid grid-cols-1 gap-3">
                  {/* Employee Expected — collapsible */}
                  <Collapsible open={empPayrollOpen} onOpenChange={setEmpPayrollOpen}>
                    <Card data-testid="card-employee-expected-salary">
                      <CollapsibleTrigger asChild>
                        <div className="py-3 px-4 cursor-pointer select-none" data-testid="trigger-employee-payroll">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              Employee Expected
                            </p>
                            <ChevronDown
                              className={`h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform duration-150 ${empPayrollOpen ? "rotate-180" : ""}`}
                            />
                          </div>
                          <div className="flex items-baseline gap-3 mt-1 flex-wrap">
                            {empExpected !== null ? (
                              <p
                                className="text-xl font-bold tabular-nums text-foreground"
                                data-testid="text-employee-expected-salary"
                              >
                                {fmtSalary(empExpected)}
                              </p>
                            ) : (
                              <p className="text-xl font-bold tabular-nums text-muted-foreground">—</p>
                            )}
                            {ms && ms.daysInMonth > 0 && (
                              <p className="text-sm font-semibold tabular-nums text-muted-foreground">
                                {fmtSalary(ms.totalEmployeeMonthlySalary / ms.daysInMonth)}
                                <span className="text-xs font-normal opacity-60 ml-1">/day</span>
                              </p>
                            )}
                          </div>
                          {ms && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {fmtSalary(ms.totalEmployeeMonthlySalary)}{" "}
                              <span className="opacity-60">monthly total</span>
                            </p>
                          )}
                        </div>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="border-t px-4 pb-3 pt-2 space-y-1">
                          {ms?.employeeBreakdown && ms.employeeBreakdown.length > 0 ? (
                            <>
                              <div className="grid grid-cols-3 gap-1 text-xs font-medium text-muted-foreground mb-1.5 px-0.5">
                                <span>Employee</span>
                                <span className="text-right">Expected</span>
                                <span className="text-right">Daily</span>
                              </div>
                              {ms.employeeBreakdown.map((e) => {
                                const daily = ms.daysInMonth > 0 ? e.monthlySalary / ms.daysInMonth : 0;
                                return (
                                  <div key={e.id} className="grid grid-cols-3 gap-1 text-xs py-0.5">
                                    <span className="truncate text-foreground/90">{e.name}</span>
                                    <span className="text-right tabular-nums text-foreground">
                                      {fmtSalary(e.expected)}
                                    </span>
                                    <span className="text-right tabular-nums text-sky-600 dark:text-sky-400">
                                      {fmtSalary(daily)}
                                    </span>
                                  </div>
                                );
                              })}
                              <div className="grid grid-cols-3 gap-1 text-xs pt-1.5 border-t mt-1">
                                <span className="font-medium text-muted-foreground">Total</span>
                                <span className="text-right tabular-nums font-semibold text-foreground">
                                  {fmtSalary(ms.employeeBreakdown.reduce((sum, e) => sum + e.expected, 0))}
                                </span>
                                <span className="text-right tabular-nums font-semibold text-sky-600 dark:text-sky-400">
                                  {ms.daysInMonth > 0 ? fmtSalary(ms.totalEmployeeMonthlySalary / ms.daysInMonth) : "—"}
                                </span>
                              </div>
                            </>
                          ) : (
                            <p className="text-xs text-muted-foreground">No employees found.</p>
                          )}
                        </div>
                      </CollapsibleContent>
                    </Card>
                  </Collapsible>
                </div>
              </div>
            );
          })()}

          {/* ── Four colored boxes ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {/* 1 — Original Batches */}
            <Card
              className="border-amber-200 dark:border-amber-800/50 bg-amber-50/60 dark:bg-amber-950/20"
              data-testid="card-original-batches"
            >
              <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
                <CardTitle className="text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                  <FlaskConical className="h-3.5 w-3.5" />
                  Original Batches
                </CardTitle>
                {!isLoading && data && (
                  <Badge
                    variant="secondary"
                    className="text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 no-default-active-elevate"
                  >
                    {data.rawMaterial.totalBatches} {data.rawMaterial.totalBatches === 1 ? "batch" : "batches"}
                  </Badge>
                )}
              </CardHeader>
              <CardContent className="pt-0 space-y-0.5">
                {isLoading ? (
                  <SkeletonBox />
                ) : (
                  <>
                    <StatRow label="Weight" value={fmtKg(data?.rawMaterial.totalWeightKg ?? 0)} />
                    <StatRow label="Batch Rate" value={fmtRate(data?.rawMaterial.blendedCostPerKg ?? 0)} sub="per kg" />
                    <StatRow label="Value" value={fmtMoney(data?.rawMaterial.totalCost ?? 0)} />
                  </>
                )}
              </CardContent>
            </Card>

            {/* 2 — Bales Produced */}
            <Card
              className="border-blue-200 dark:border-blue-800/50 bg-blue-50/60 dark:bg-blue-950/20"
              data-testid="card-bales-produced"
            >
              <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
                <CardTitle className="text-xs font-bold uppercase tracking-wide text-blue-700 dark:text-blue-400 flex items-center gap-1.5">
                  <PackageCheck className="h-3.5 w-3.5" />
                  Bales Produced
                </CardTitle>
                {!isLoading && data && (
                  <Badge
                    variant="secondary"
                    className="text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 no-default-active-elevate"
                  >
                    QTY
                  </Badge>
                )}
              </CardHeader>
              <CardContent className="pt-0 space-y-0.5">
                {isLoading ? (
                  <SkeletonBox />
                ) : (
                  <>
                    <div className="flex items-center justify-between py-1">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        # Bales
                      </span>
                      <span className="text-sm font-bold">{data?.production.totalBales ?? 0}</span>
                    </div>
                    <StatRow label="Weight" value={fmtKg(data?.production.totalWeightKg ?? 0)} />
                    <StatRow label="Value" value={fmtMoney(data?.production.totalValue ?? 0)} />
                    {/* Big rate display */}
                    {(() => {
                      const kg = data?.production.totalWeightKg ?? 0;
                      const val = data?.production.totalValue ?? 0;
                      const rate = kg > 0 ? val / kg : 0;
                      return (
                        <div className="flex flex-col items-center justify-center py-3 mt-1 border-t border-blue-200 dark:border-blue-800/40">
                          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">
                            Rate / kg
                          </span>
                          <span className="text-3xl font-extrabold text-blue-600 dark:text-blue-400 tabular-nums">
                            {fmtRate(rate)}
                          </span>
                        </div>
                      );
                    })()}
                  </>
                )}
              </CardContent>
            </Card>

            {/* 3 — Wipers & Garbage */}
            <Card
              className="border-red-200 dark:border-red-800/50 bg-red-50/60 dark:bg-red-950/20"
              data-testid="card-wipers-garbage"
            >
              <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
                <CardTitle className="text-xs font-bold uppercase tracking-wide text-red-700 dark:text-red-400 flex items-center gap-1.5">
                  <Trash2 className="h-3.5 w-3.5" />
                  Wipers &amp; Garbage
                </CardTitle>
                {!isLoading && data && (
                  <Badge
                    variant="secondary"
                    className="text-xs bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 no-default-active-elevate"
                  >
                    QTY
                  </Badge>
                )}
              </CardHeader>
              <CardContent className="pt-0 space-y-0.5">
                {isLoading ? (
                  <SkeletonBox />
                ) : (
                  <>
                    <div className="flex items-center justify-between py-1">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Wipers
                      </span>
                      <span className="text-sm font-bold">
                        <span className="font-bold">{data?.wipersGarbage.totalWipersQty ?? 0}</span>
                        <span className="text-xs font-normal text-muted-foreground ml-3">
                          {fmtKg(data?.wipersGarbage.totalWipersKg ?? 0)}
                        </span>
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-1">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Garbage
                      </span>
                      <span className="text-sm font-bold flex items-center gap-2">
                        <span className="font-bold">{data?.wipersGarbage.totalGarbageQty ?? 0}</span>
                        <span className="text-xs font-normal text-muted-foreground">
                          {fmtKg(data?.wipersGarbage.totalGarbageKg ?? 0)}
                        </span>
                      </span>
                    </div>
                    <StatRow label="Value" value={fmtMoney(data?.wipersGarbage.totalValue ?? 0)} />
                    <div className="mt-2 pt-2 border-t border-red-200 dark:border-red-800/40 flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wide text-red-700 dark:text-red-400">
                        Total Wiper + Garbage
                      </span>
                      <span className="text-sm font-extrabold tabular-nums">
                        {(data?.wipersGarbage.totalWipersQty ?? 0) + (data?.wipersGarbage.totalGarbageQty ?? 0)}
                        <span className="text-xs font-normal text-muted-foreground ml-3">
                          {fmtKg(data?.wipersGarbage.totalWeightKg ?? 0)}
                        </span>
                      </span>
                    </div>
                    {(() => {
                      const wgKg = data?.wipersGarbage.totalWeightKg ?? 0;
                      const rawKg = data?.rawMaterial.totalWeightKg ?? 0;
                      const pct = rawKg > 0 ? (wgKg / rawKg) * 100 : 0;
                      const color =
                        pct > 10
                          ? "text-red-600 dark:text-red-400"
                          : pct > 5
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-green-600 dark:text-green-400";
                      return (
                        <div className="flex flex-col items-center justify-center py-3 mt-1 border-t border-red-200 dark:border-red-800/40">
                          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">
                            % of Input
                          </span>
                          <span className={`text-3xl font-extrabold tabular-nums ${color}`} data-testid="text-wg-pct">
                            {pct.toFixed(1)}%
                          </span>
                        </div>
                      );
                    })()}
                  </>
                )}
              </CardContent>
            </Card>

            {/* 4 — Balance on Table */}
            <Card
              className="border-violet-200 dark:border-violet-800/50 bg-violet-50/60 dark:bg-violet-950/20"
              data-testid="card-balance-on-table"
            >
              <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
                <CardTitle className="text-xs font-bold uppercase tracking-wide text-violet-700 dark:text-violet-400 flex items-center gap-1.5">
                  <Scale className="h-3.5 w-3.5" />
                  Balance on Table
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-0.5">
                {isLoading ? (
                  <SkeletonBox />
                ) : (
                  <>
                    <StatRow label="Weight" value={fmtKg(data?.balanceOnTable.weightKg ?? 0)} />
                    <StatRow label="Batch Rate" value={fmtRate(data?.balanceOnTable.costPerKg ?? 0)} sub="per kg" />
                    <StatRow label="Value" value={fmtMoney(data?.balanceOnTable.value ?? 0)} />
                    {/* Production Profit = bales produced value − (bales produced kg × balance batch rate) */}
                    {(() => {
                      const producedKg = data?.production.totalWeightKg ?? 0;
                      const batchRate = data?.balanceOnTable.costPerKg ?? 0;
                      const producedVal = data?.production.totalValue ?? 0;
                      const profit = producedVal - producedKg * batchRate;
                      const isPos = profit > 0;
                      const isNeg = profit < 0;
                      return (
                        <div className="mt-2 pt-2 border-t border-violet-200 dark:border-violet-800/40 flex items-center justify-between">
                          <span className="text-xs font-bold uppercase tracking-wide text-violet-700 dark:text-violet-400">
                            Production Profit
                          </span>
                          <span
                            className={`text-sm font-extrabold tabular-nums ${
                              isPos
                                ? "text-emerald-600 dark:text-emerald-400"
                                : isNeg
                                  ? "text-red-500 dark:text-red-400"
                                  : "text-muted-foreground"
                            }`}
                          >
                            {isPos ? "+" : ""}
                            {fmtMoney(profit)}
                          </span>
                        </div>
                      );
                    })()}
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ── Expandable detail rows ── */}

          {/* Production by Category (each category expands to show its products) */}
          {(() => {
            const wgCats: { categoryName: string; qty: number; totalWeightKg: number; totalValue: number }[] = [];
            const wgProds: {
              articleCode: string;
              productName: string;
              categoryName: string;
              qty: number;
              totalWeightKg: number;
              costPricePerBale: number;
              totalValue: number;
            }[] = [];
            if (data) {
              const wipersRows = data.wipersGarbage.rows.filter((r: any) => r.subType === "wiper");
              const garbageRows = data.wipersGarbage.rows.filter((r: any) => r.subType !== "wiper");
              if (wipersRows.length > 0) {
                wgCats.push({
                  categoryName: "Wipers",
                  qty: wipersRows.reduce((s: number, r: any) => s + r.qty, 0),
                  totalWeightKg: wipersRows.reduce((s: number, r: any) => s + r.totalWeightKg, 0),
                  totalValue: wipersRows.reduce((s: number, r: any) => s + r.totalValue, 0),
                });
                wgProds.push(
                  ...wipersRows.map((r: any) => ({
                    articleCode: r.categoryName.replace(/\s+/g, "-").toUpperCase(),
                    productName: r.categoryName,
                    categoryName: "Wipers",
                    qty: r.qty,
                    totalWeightKg: r.totalWeightKg,
                    costPricePerBale: 0,
                    totalValue: r.totalValue,
                  }))
                );
              }
              if (garbageRows.length > 0) {
                wgCats.push({
                  categoryName: "Garbage",
                  qty: garbageRows.reduce((s: number, r: any) => s + r.qty, 0),
                  totalWeightKg: garbageRows.reduce((s: number, r: any) => s + r.totalWeightKg, 0),
                  totalValue: garbageRows.reduce((s: number, r: any) => s + r.totalValue, 0),
                });
                wgProds.push(
                  ...garbageRows.map((r: any) => ({
                    articleCode: r.categoryName.replace(/\s+/g, "-").toUpperCase(),
                    productName: r.categoryName,
                    categoryName: "Garbage",
                    qty: r.qty,
                    totalWeightKg: r.totalWeightKg,
                    costPricePerBale: 0,
                    totalValue: r.totalValue,
                  }))
                );
              }
            }
            const mergedCategories = [...(data?.production.byCategory ?? []), ...wgCats];
            const mergedProducts = [...((data?.production.byProduct ?? []) as any[]), ...wgProds];
            const mergedTotalBales = (data?.production.totalBales ?? 0) + wgCats.reduce((s, c) => s + c.qty, 0);
            const mergedTotalWeightKg =
              (data?.production.totalWeightKg ?? 0) + wgCats.reduce((s, c) => s + c.totalWeightKg, 0);
            const mergedTotalValue = (data?.production.totalValue ?? 0) + wgCats.reduce((s, c) => s + c.totalValue, 0);
            return (
              <ExpandableCard
                title="Production by Category"
                badge={
                  isLoading ? undefined : `${mergedCategories.length} categories · ${mergedProducts.length} products`
                }
                icon={Tag}
                testId="card-category-breakdown"
              >
                {isLoading ? (
                  <div className="space-y-2">
                    {[...Array(4)].map((_, i) => (
                      <Skeleton key={i} className="h-10 w-full" />
                    ))}
                  </div>
                ) : !data || mergedCategories.length === 0 ? (
                  <p className="text-center text-muted-foreground py-6 text-sm">No bales produced in this period</p>
                ) : (
                  <CategoryProductBreakdown
                    categories={mergedCategories}
                    products={mergedProducts}
                    totalBales={mergedTotalBales}
                    totalWeightKg={mergedTotalWeightKg}
                    totalValue={mergedTotalValue}
                  />
                )}
              </ExpandableCard>
            );
          })()}

          {/* Mix Batches */}
          <ExpandableCard
            title="Mix Batches"
            badge={
              isLoading
                ? undefined
                : `${data?.rawMaterial.totalBatches ?? 0} ${(data?.rawMaterial.totalBatches ?? 0) === 1 ? "batch" : "batches"}`
            }
            icon={FlaskConical}
            testId="card-mix-breakdown"
          >
            {isLoading ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : !data || data.rawMaterial.batches.length === 0 ? (
              <p className="text-center text-muted-foreground py-6 text-sm">No mix batches in this period</p>
            ) : (
              <div className="table-responsive">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Batch Code</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Weight (kg)</TableHead>
                      <TableHead className="text-right">Cost / kg</TableHead>
                      <TableHead className="text-right">Total Cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rawMaterial.batches.map((b) => (
                      <TableRow key={b.id} data-testid={`row-batch-${b.id}`}>
                        <TableCell className="font-mono text-sm">{b.batchCode}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{b.name || "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {b.batchDate || b.createdAt?.slice(0, 10) || "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {fmtKg(parseFloat(b.totalWeightKg))}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {`${Number(b.costPerKg || 0).toFixed(4)}`}
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold">
                          {fmtMoney(parseFloat(b.totalCost))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <tfoot>
                    <tr className="border-t-2">
                      <td colSpan={3} className="px-4 py-2 text-sm font-semibold text-muted-foreground">
                        Totals
                      </td>
                      <td className="px-4 py-2 text-right font-mono font-bold">
                        {fmtKg(data?.rawMaterial.totalWeightKg ?? 0)}
                      </td>
                      <td />
                      <td className="px-4 py-2 text-right font-mono font-bold">
                        {fmtMoney(data?.rawMaterial.totalCost ?? 0)}
                      </td>
                    </tr>
                  </tfoot>
                </Table>
              </div>
            )}
          </ExpandableCard>
        </TabsContent>

        {/* ── Financial Snapshot tab ── (hidden) */}
        <TabsContent value="snapshot" className="hidden">
          <FactoryFinancialSnapshot />
        </TabsContent>

        {/* ── Bale Ledger tab ── */}
        <TabsContent
          value="ledger"
          className="flex-1 overflow-y-auto p-4 gap-3 flex flex-col mt-0 data-[state=inactive]:hidden"
        >
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm text-muted-foreground">
                Complete lifecycle view — stock in hand, wipers/garbages, sold, and waste
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => ledgerRefetch()}
              disabled={ledgerFetching}
              data-testid="button-refresh-ledger"
              className="gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${ledgerFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>

          {ledgerLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <Card key={i}>
                  <CardHeader className="py-3 px-4">
                    <Skeleton className="h-5 w-64" />
                    <Skeleton className="h-3 w-48 mt-1" />
                  </CardHeader>
                </Card>
              ))}
            </div>
          ) : (
            <>
              <LedgerSection
                title="Current Stock — In Hand"
                subtitle="Bales in stock (IN_STOCK / FINALIZED), excluding wipers and garbages"
                icon={<Package className="w-4 h-4 text-green-600" />}
                badgeColor="text-green-700 border-green-200"
                rows={ledger?.currentStock || []}
                total={ledger?.totals.currentStock || { baleCount: 0, totalWeightKg: 0, totalCost: 0 }}
              />
              <LedgerSection
                title="Wipers & Garbages — In Hand"
                subtitle="Waste-category bales currently in stock (IN_STOCK / FINALIZED)"
                icon={<AlertTriangle className="w-4 h-4 text-amber-500" />}
                badgeColor="text-amber-700 border-amber-200"
                rows={ledger?.wasteStock || []}
                total={ledger?.totals.wasteStock || { baleCount: 0, totalWeightKg: 0, totalCost: 0 }}
              />
              <LedgerSection
                title="Stock Sold"
                subtitle="Bales that have been dispatched and sold to customers"
                icon={<ShoppingCart className="w-4 h-4 text-blue-600" />}
                badgeColor="text-blue-700 border-blue-200"
                rows={ledger?.sold || []}
                total={ledger?.totals.sold || { baleCount: 0, totalWeightKg: 0, totalCost: 0 }}
                showSoldPrice={true}
              />
              <LedgerSection
                title="Pending Loading / Verified"
                subtitle="Bales reserved for orders currently in Loading, Pending Verification, or Verified status"
                icon={<Truck className="w-4 h-4 text-purple-500" />}
                badgeColor="text-purple-700 border-purple-200"
                rows={ledger?.pendingLoading || []}
                total={ledger?.totals.pendingLoading || { baleCount: 0, totalWeightKg: 0, totalCost: 0 }}
              />
              <LedgerSection
                title="Waste Dispatched"
                subtitle="Bales removed from stock via waste disposal (Waste Dispatch records)"
                icon={<Trash2 className="w-4 h-4 text-destructive" />}
                badgeColor="text-destructive border-destructive/30"
                rows={ledger?.wasteDispatched || []}
                total={ledger?.totals.wasteDispatched || { baleCount: 0, totalWeightKg: 0, totalCost: 0 }}
              />

              {grand && (
                <Card className="border-primary/20 bg-primary/5">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <div>
                        <p className="font-bold text-sm">Total Production (All Time)</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Sum of all sections — complete production output
                        </p>
                      </div>
                      <div className="flex items-center gap-6 flex-wrap">
                        <div className="text-center">
                          <p className="text-xl font-bold" data-testid="grand-total-bales">
                            {fmtNL(grand.baleCount)}
                          </p>
                          <p className="text-xs text-muted-foreground">total bales</p>
                        </div>
                        <div className="text-center">
                          <p className="text-xl font-bold" data-testid="grand-total-weight">
                            {fmtL(grand.totalWeightKg)}
                          </p>
                          <p className="text-xs text-muted-foreground">kg produced</p>
                        </div>
                        <div className="text-center">
                          <p className="text-xl font-bold" data-testid="grand-total-cost">
                            {fmtML(grand.totalCost)}
                          </p>
                          <p className="text-xs text-muted-foreground">total sell value</p>
                        </div>
                        {grand.baleCount > 0 && grand.totalCost > 0 && (
                          <div className="text-center">
                            <p className="text-xl font-bold">{fmtML(grand.totalCost / grand.baleCount)}</p>
                            <p className="text-xs text-muted-foreground">avg/bale</p>
                          </div>
                        )}
                      </div>
                    </div>
                    {ledger && (
                      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 border-t pt-4 sm:grid-cols-5">
                        {[
                          {
                            label: "In Hand (Regular)",
                            bales: ledger.totals.currentStock.baleCount,
                            kg: ledger.totals.currentStock.totalWeightKg,
                            cost: ledger.totals.currentStock.totalCost,
                            color: "text-green-600",
                          },
                          {
                            label: "In Hand (Waste Cat.)",
                            bales: ledger.totals.wasteStock.baleCount,
                            kg: ledger.totals.wasteStock.totalWeightKg,
                            cost: ledger.totals.wasteStock.totalCost,
                            color: "text-amber-600",
                          },
                          {
                            label: "Pending Loading / Verified",
                            bales: ledger.totals.pendingLoading.baleCount,
                            kg: ledger.totals.pendingLoading.totalWeightKg,
                            cost: ledger.totals.pendingLoading.totalCost,
                            color: "text-purple-600",
                          },
                          {
                            label: "Sold",
                            bales: ledger.totals.sold.baleCount,
                            kg: ledger.totals.sold.totalWeightKg,
                            cost: ledger.totals.sold.totalCost,
                            color: "text-blue-600",
                          },
                          {
                            label: "Waste Dispatched",
                            bales: ledger.totals.wasteDispatched.baleCount,
                            kg: ledger.totals.wasteDispatched.totalWeightKg,
                            cost: ledger.totals.wasteDispatched.totalCost,
                            color: "text-destructive",
                          },
                        ].map((s) => (
                          <div key={s.label} className="text-xs">
                            <p className={`font-semibold ${s.color}`}>{s.label}</p>
                            <p className="text-muted-foreground">
                              {fmtNL(s.bales)} bales · {fmtL(s.kg)} kg
                            </p>
                            {s.cost > 0 && <p className="font-medium">{fmtML(s.cost)}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        {/* ── Production Comparison tab ── */}
        <TabsContent value="comparison" className="flex-1 overflow-y-auto p-4 mt-0 data-[state=inactive]:hidden">
          <ProductionComparison />
        </TabsContent>

        {/* ── Shipping Containers tab ── */}
        <TabsContent value="shipping" className="flex-1 overflow-hidden p-4 mt-0 data-[state=inactive]:hidden">
          <FactoryShippingContainers />
        </TabsContent>

        {/* ── Factory Sheets tab ── */}
        <TabsContent value="sheets" className="flex-1 overflow-hidden flex flex-col mt-0 data-[state=inactive]:hidden">
          <FactoryStatusBuilder />
        </TabsContent>

        {/* ── Container Tracking tab (hidden — data surfaced inside Shipping Containers) ── */}
        <TabsContent
          value="container-tracking"
          className="hidden flex-1 overflow-y-auto p-4 mt-0 data-[state=inactive]:hidden"
        >
          <FactoryContainerTracking />
        </TabsContent>
      </Tabs>
    </div>
  );
}
