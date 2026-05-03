import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { useBackToParent } from "@/hooks/use-back-to-parent";
import { hasAnyOpenDialog } from "@/hooks/use-escape-back";
import { useEscapeToParent } from "@/hooks/use-escape-to-parent";
import { ArrowLeft, MapPin, Globe, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { PeriodFilter, getDefaultPeriodValue, PeriodFilterValue } from "@/components/ui/period-filter";
import { useDateJump } from "@/hooks/use-date-jump";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useEffect, useRef, useMemo } from "react";
import { useCursorNav } from "@/contexts/CursorNavContext";
import { PageHeader } from "@/components/PageHeader";

interface MonthlyData {
  month: number;
  monthName: string;
  openingQty: number;
  openingValue: number;
  openingRate: number;
  inwardQty: number;
  inwardValue: number;
  inwardRate: number;
  outwardQty: number;
  outwardValue: number;
  outwardRate: number;
  closingQty: number;
  closingValue: number;
  closingRate: number;
}

interface LocationMonthlySummaryData {
  stockItem: {
    id: number;
    code: string;
    name: string;
    uom: string;
  };
  location?: {
    id: number;
    code: string;
    name: string;
  };
  year: number;
  monthlyData: MonthlyData[];
  grandTotal: {
    openingQty: number;
    openingValue: number;
    openingRate: number;
    inwardQty: number;
    inwardValue: number;
    inwardRate: number;
    outwardQty: number;
    outwardValue: number;
    outwardRate: number;
    closingQty: number;
    closingValue: number;
    closingRate: number;
  };
}

export default function LocationMonthlySummary({ posUser }: { posUser?: any } = {}) {
  const { formatAmount } = useCurrencyContext();
  const { registerCursorNav, clearCursorNav } = useCursorNav();
  const params = useParams();
  const locationId = parseInt(params.locationId || "0");
  const stockItemId = parseInt(params.stockItemId || "0");
  const [_location, navigate] = useLocation();
  const handleBack = useBackToParent();

  const isAllLocationsMode = locationId === 0;

  const [periodFilter, setPeriodFilter] = useState<PeriodFilterValue>(() => getDefaultPeriodValue("this_year"));
  useDateJump((date) => setPeriodFilter({ fromDate: date, toDate: date, preset: "custom" }));
  const [selectedRowIndex, setSelectedRowIndex] = useState<number>(-1);
  const [showAllMonths, setShowAllMonths] = useState(true);
  const tableScrollContainer = useRef<HTMLDivElement>(null);

  const apiUrl = isAllLocationsMode
    ? `/api/stock-items/${stockItemId}/monthly-summary?startDate=${periodFilter.fromDate}&endDate=${periodFilter.toDate}`
    : `/api/locations/${locationId}/stock-items/${stockItemId}/monthly-summary?startDate=${periodFilter.fromDate}&endDate=${periodFilter.toDate}`;

  const queryKey = isAllLocationsMode
    ? [`/api/stock-items/${stockItemId}/monthly-summary`, { startDate: periodFilter.fromDate, endDate: periodFilter.toDate }]
    : [`/api/locations/${locationId}/stock-items/${stockItemId}/monthly-summary`, { startDate: periodFilter.fromDate, endDate: periodFilter.toDate }];

  const { data, isLoading } = useQuery<LocationMonthlySummaryData>({
    queryKey,
    queryFn: async () => {
      const response = await fetch(apiUrl, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch');
      return response.json();
    },
    enabled: stockItemId > 0,
  });

  const hasActivity = (m: MonthlyData) =>
    m.inwardQty > 0 || m.outwardQty > 0 || m.openingQty !== 0 || m.closingQty !== 0;

  const visibleRows = useMemo(() => {
    if (!data?.monthlyData) return [];
    return showAllMonths ? data.monthlyData : data.monthlyData.filter(hasActivity);
  }, [data?.monthlyData, showAllMonths]);

  const handleMonthClick = (month: number) => {
    if (!isAllLocationsMode) {
      const year = new Date(periodFilter.fromDate).getFullYear();
      navigate(`/locations/${locationId}/stock-items/${stockItemId}/vouchers/${year}/${month}`);
    }
  };

  const fmtQty = (n: number) => {
    if (n === 0) return "—";
    return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  };

  const fmtRate = (n: number) => {
    if (n === 0) return "—";
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const fmtVal = (n: number) => {
    if (n === 0) return "—";
    return formatAmount(n);
  };

  useEscapeToParent("/location-inventory");

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") return;
      if (hasAnyOpenDialog()) return;
      if (!visibleRows.length) return;

      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedRowIndex(prev => Math.max(-1, prev - 1));
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (selectedRowIndex === -1) setSelectedRowIndex(0);
        else if (selectedRowIndex < visibleRows.length - 1) setSelectedRowIndex(prev => prev + 1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (!isAllLocationsMode && selectedRowIndex >= 0) {
          handleMonthClick(visibleRows[selectedRowIndex].month);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [selectedRowIndex, visibleRows, isAllLocationsMode]);

  useEffect(() => {
    if (selectedRowIndex < 0 || !tableScrollContainer.current) return;
    const rowElement = tableScrollContainer.current.querySelector(`[data-row-index="${selectedRowIndex}"]`);
    if (rowElement) rowElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedRowIndex]);

  useEffect(() => {
    registerCursorNav({
      canNavigateUp: selectedRowIndex > -1,
      canNavigateDown: visibleRows.length > 0 && (selectedRowIndex === -1 || selectedRowIndex < visibleRows.length - 1),
      onUp: () => setSelectedRowIndex(prev => Math.max(-1, prev - 1)),
      onDown: () => setSelectedRowIndex(prev => {
        if (prev === -1) return 0;
        if (prev < visibleRows.length - 1) return prev + 1;
        return prev;
      }),
    });
    return () => clearCursorNav();
  }, [selectedRowIndex, visibleRows]);

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  const uom = data?.stockItem?.uom || "Units";

  return (
    <div className="container mx-auto p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={handleBack} data-testid="button-back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <PageHeader title={isAllLocationsMode ? "Item Monthly Summary" : "Stock Movement"} />
            {data?.stockItem && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="text-item-location">
                <span className="font-medium">{data.stockItem.name}</span>
                <span className="text-muted-foreground/50">({data.stockItem.code})</span>
                <span>•</span>
                {isAllLocationsMode ? (
                  <><Globe className="h-3.5 w-3.5" /><span>All Locations</span></>
                ) : (
                  <><MapPin className="h-3.5 w-3.5" /><span>{data.location?.name || 'Unknown'}</span></>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant={showAllMonths ? "default" : "outline"}
            size="sm"
            onClick={() => setShowAllMonths(v => !v)}
            data-testid="button-show-all-months"
          >
            <Eye className="h-4 w-4 mr-1.5" />
            {showAllMonths ? "Hide empty months" : "Show all months"}
          </Button>
          <PeriodFilter value={periodFilter} onChange={setPeriodFilter} data-testid="period-filter" />
        </div>
      </div>

      {/* Tally-style Stock Movement Table */}
      <Card className="overflow-hidden flex flex-col" style={{ maxHeight: 'calc(100vh - 220px)' }}>
        <CardHeader className="pb-2 flex-shrink-0">
          <CardTitle className="text-base">
            Monthly Stock Movement
            <span className="ml-2 text-sm font-normal text-muted-foreground">({uom})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-auto flex-1 p-0" ref={tableScrollContainer}>
          <table className="w-full text-sm border-collapse" style={{ minWidth: '900px' }}>
            <thead className="sticky top-0 z-30">
              <tr className="bg-muted border-b">
                <th rowSpan={2} className="text-left align-bottom px-3 py-2 border-r font-semibold w-28">Month</th>
                <th colSpan={posUser ? 1 : 3} className="text-center px-2 py-1.5 border-r font-semibold text-muted-foreground">Opening</th>
                <th colSpan={posUser ? 1 : 3} className="text-center px-2 py-1.5 border-r font-semibold text-green-700 dark:text-green-400">Stock In</th>
                <th colSpan={posUser ? 1 : 3} className="text-center px-2 py-1.5 border-r font-semibold text-red-700 dark:text-red-400">Stock Out</th>
                <th colSpan={posUser ? 1 : 3} className="text-center px-2 py-1.5 font-semibold text-primary">Closing</th>
              </tr>
              <tr className="bg-muted/70 border-b text-xs">
                <th className="text-right px-3 py-1.5 font-medium text-muted-foreground border-r">Qty</th>
                {!posUser && <><th className="text-right px-3 py-1.5 font-medium text-muted-foreground border-r">Rate</th><th className="text-right px-3 py-1.5 font-medium text-muted-foreground border-r">Value</th></>}
                <th className="text-right px-3 py-1.5 font-medium border-r text-green-700 dark:text-green-400">Qty</th>
                {!posUser && <><th className="text-right px-3 py-1.5 font-medium border-r text-green-700 dark:text-green-400">Rate</th><th className="text-right px-3 py-1.5 font-medium border-r text-green-700 dark:text-green-400">Value</th></>}
                <th className="text-right px-3 py-1.5 font-medium border-r text-red-700 dark:text-red-400">Qty</th>
                {!posUser && <><th className="text-right px-3 py-1.5 font-medium border-r text-red-700 dark:text-red-400">Rate</th><th className="text-right px-3 py-1.5 font-medium border-r text-red-700 dark:text-red-400">Value</th></>}
                <th className="text-right px-3 py-1.5 font-medium text-primary">Qty</th>
                {!posUser && <><th className="text-right px-3 py-1.5 font-medium text-primary">Rate</th><th className="text-right px-3 py-1.5 font-medium text-primary">Value</th></>}
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 && (
                <tr>
                  <td colSpan={posUser ? 5 : 13} className="text-center py-12 text-muted-foreground">
                    No stock movement for this period
                  </td>
                </tr>
              )}
              {visibleRows.map((month, idx) => {
                const isSelected = selectedRowIndex === idx;
                const isClickable = !isAllLocationsMode;
                const isActive = hasActivity(month);

                return (
                  <tr
                    key={month.month}
                    className={`border-b transition-colors ${isClickable ? 'cursor-pointer' : ''} ${isSelected ? 'bg-primary/10 ring-1 ring-inset ring-primary' : isActive && isClickable ? 'hover:bg-muted/40' : 'text-muted-foreground/60'}`}
                    onClick={() => isClickable && isActive && handleMonthClick(month.month)}
                    data-testid={`row-month-${month.month}`}
                    data-row-index={idx}
                  >
                    <td className="font-medium px-3 py-2.5 border-r">{month.monthName}</td>

                    {/* Opening */}
                    <td className="text-right px-3 py-2.5 tabular-nums border-r text-muted-foreground">{fmtQty(month.openingQty)}</td>
                    {!posUser && <>
                      <td className="text-right px-3 py-2.5 tabular-nums border-r text-muted-foreground">{fmtRate(month.openingRate)}</td>
                      <td className="text-right px-3 py-2.5 tabular-nums border-r text-muted-foreground">{fmtVal(month.openingValue)}</td>
                    </>}

                    {/* Stock In */}
                    <td className="text-right px-3 py-2.5 tabular-nums border-r text-green-700 dark:text-green-400 font-medium">{fmtQty(month.inwardQty)}</td>
                    {!posUser && <>
                      <td className="text-right px-3 py-2.5 tabular-nums border-r text-green-700 dark:text-green-400">{fmtRate(month.inwardRate)}</td>
                      <td className="text-right px-3 py-2.5 tabular-nums border-r text-green-700 dark:text-green-400">{fmtVal(month.inwardValue)}</td>
                    </>}

                    {/* Stock Out */}
                    <td className="text-right px-3 py-2.5 tabular-nums border-r text-red-700 dark:text-red-400 font-medium">{fmtQty(month.outwardQty)}</td>
                    {!posUser && <>
                      <td className="text-right px-3 py-2.5 tabular-nums border-r text-red-700 dark:text-red-400">{fmtRate(month.outwardRate)}</td>
                      <td className="text-right px-3 py-2.5 tabular-nums border-r text-red-700 dark:text-red-400">{fmtVal(month.outwardValue)}</td>
                    </>}

                    {/* Closing */}
                    <td className="text-right px-3 py-2.5 tabular-nums font-semibold text-foreground">{fmtQty(month.closingQty)}</td>
                    {!posUser && <>
                      <td className="text-right px-3 py-2.5 tabular-nums font-medium">{fmtRate(month.closingRate)}</td>
                      <td className="text-right px-3 py-2.5 tabular-nums font-medium">{fmtVal(month.closingValue)}</td>
                    </>}
                  </tr>
                );
              })}
            </tbody>

            {/* Grand Total */}
            {data?.grandTotal && (
              <tfoot className="sticky bottom-0 z-10">
                <tr className="bg-muted font-bold border-t-2">
                  <td className="px-3 py-2.5 border-r">Total</td>

                  {/* Opening total */}
                  <td className="text-right px-3 py-2.5 tabular-nums border-r text-muted-foreground">{fmtQty(data.grandTotal.openingQty)}</td>
                  {!posUser && <>
                    <td className="text-right px-3 py-2.5 tabular-nums border-r text-muted-foreground">{fmtRate(data.grandTotal.openingRate)}</td>
                    <td className="text-right px-3 py-2.5 tabular-nums border-r text-muted-foreground">{fmtVal(data.grandTotal.openingValue)}</td>
                  </>}

                  {/* In total */}
                  <td className="text-right px-3 py-2.5 tabular-nums border-r text-green-700 dark:text-green-400">{fmtQty(data.grandTotal.inwardQty)}</td>
                  {!posUser && <>
                    <td className="text-right px-3 py-2.5 tabular-nums border-r text-green-700 dark:text-green-400">{fmtRate(data.grandTotal.inwardRate)}</td>
                    <td className="text-right px-3 py-2.5 tabular-nums border-r text-green-700 dark:text-green-400">{fmtVal(data.grandTotal.inwardValue)}</td>
                  </>}

                  {/* Out total */}
                  <td className="text-right px-3 py-2.5 tabular-nums border-r text-red-700 dark:text-red-400">{fmtQty(data.grandTotal.outwardQty)}</td>
                  {!posUser && <>
                    <td className="text-right px-3 py-2.5 tabular-nums border-r text-red-700 dark:text-red-400">{fmtRate(data.grandTotal.outwardRate)}</td>
                    <td className="text-right px-3 py-2.5 tabular-nums border-r text-red-700 dark:text-red-400">{fmtVal(data.grandTotal.outwardValue)}</td>
                  </>}

                  {/* Closing total */}
                  <td className="text-right px-3 py-2.5 tabular-nums text-foreground">{fmtQty(data.grandTotal.closingQty)}</td>
                  {!posUser && <>
                    <td className="text-right px-3 py-2.5 tabular-nums">{fmtRate(data.grandTotal.closingRate)}</td>
                    <td className="text-right px-3 py-2.5 tabular-nums">{fmtVal(data.grandTotal.closingValue)}</td>
                  </>}
                </tr>
              </tfoot>
            )}
          </table>
        </CardContent>
      </Card>

      {/* Legend */}
      {!isAllLocationsMode && (
        <p className="text-xs text-muted-foreground text-center">
          Click any month to see detailed transactions
        </p>
      )}
    </div>
  );
}
