import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { hasAnyOpenDialog } from "@/hooks/use-escape-back";
import { ArrowLeft, MapPin, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { PeriodFilter, PeriodFilterValue, getDefaultPeriodValue } from "@/components/ui/period-filter";
import { useDateJump } from "@/hooks/use-date-jump";
import { format } from "date-fns";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { useCursorNav } from "@/contexts/CursorNavContext";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { useState, useEffect, useRef, useMemo } from "react";
import { PageHeader } from "@/components/PageHeader";

interface Transaction {
  date: string;
  particulars: string;
  vchType: string;
  voucherId: number;
  poId?: number;
  inwardQty: number;
  inwardRate: number;
  inwardValue: number;
  outwardQty: number;
  outwardRate: number;
  outwardValue: number;
  closingQty: number;
  closingRate: number;
  closingValue: number;
  isOpeningBalance?: boolean;
  isPOS?: boolean;
  posSellingRate?: number;
  posSellingValue?: number;
}

interface LocationVouchersData {
  stockItem: { id: number; code: string; name: string; uom: string; };
  location: { id: number; code: string; name: string; };
  year: number;
  month: number;
  monthName: string;
  transactions: Transaction[];
  totals: {
    inwardQty: number; inwardRate: number; inwardValue: number;
    outwardQty: number; outwardRate: number; outwardValue: number;
    closingQty: number; closingRate: number; closingValue: number;
  };
}

interface RangeVouchersData {
  stockItem: { id: number; code: string; name: string; uom: string; };
  location: { id: number; code: string; name: string; };
  startDate: string;
  endDate: string;
  transactions: Transaction[];
  totals: {
    inwardQty: number; inwardRate: number; inwardValue: number;
    outwardQty: number; outwardRate: number; outwardValue: number;
    closingQty: number; closingRate: number; closingValue: number;
  };
}

export default function LocationVouchers({ posUser }: { posUser?: any } = {}) {
  const { formatDisplayDate } = useDateFormat();
  const { formatAmount } = useCurrencyContext();
  const { registerCursorNav, clearCursorNav } = useCursorNav();
  const params = useParams();
  const locationId = parseInt(params.locationId || "0");
  const stockItemId = parseInt(params.stockItemId || "0");
  const year = parseInt(params.year || "0");
  const month = parseInt(params.month || "0");
  const [_location, navigate] = useLocation();
  const [selectedRowIndex, setSelectedRowIndex] = useState<number>(-1);
  const tableScrollContainer = useRef<HTMLDivElement>(null);
  const [periodFilter, setPeriodFilter] = useState<PeriodFilterValue>(() => getDefaultPeriodValue("this_month"));
  useDateJump((date) => setPeriodFilter({ fromDate: date, toDate: date, preset: "custom" }));
  const [showStockTransfers, setShowStockTransfers] = useState(false);
  const [showAllMonths, setShowAllMonths] = useState(false);

  // Single-month query
  const { data: monthData, isLoading: monthLoading } = useQuery<LocationVouchersData>({
    queryKey: [`/api/locations/${locationId}/stock-items/${stockItemId}/vouchers/${year}/${month}`, periodFilter.fromDate, periodFilter.toDate],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (periodFilter.fromDate) p.set("startDate", periodFilter.fromDate);
      if (periodFilter.toDate) p.set("endDate", periodFilter.toDate);
      const url = `/api/locations/${locationId}/stock-items/${stockItemId}/vouchers/${year}/${month}?${p.toString()}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch vouchers");
      return res.json();
    },
    enabled: locationId > 0 && stockItemId > 0 && year > 0 && month > 0 && !showAllMonths,
  });

  // All-months (date range) query
  const allMonthsStart = `${year}-01-01`;
  const allMonthsEnd = `${year}-12-31`;
  const { data: rangeData, isLoading: rangeLoading } = useQuery<RangeVouchersData>({
    queryKey: [`/api/locations/${locationId}/stock-items/${stockItemId}/transactions`, allMonthsStart, allMonthsEnd],
    queryFn: async () => {
      const url = `/api/locations/${locationId}/stock-items/${stockItemId}/transactions?startDate=${allMonthsStart}&endDate=${allMonthsEnd}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch transactions");
      return res.json();
    },
    enabled: locationId > 0 && stockItemId > 0 && year > 0 && showAllMonths,
  });

  const isLoading = showAllMonths ? rangeLoading : monthLoading;
  const data = showAllMonths ? rangeData : monthData;
  const totals = data?.totals;

  const formatNumber = (num: number | null | undefined, decimals = 2) => {
    if (num == null || isNaN(num) || num === 0) return "";
    return num.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  };

  const formatDate = (dateStr: string) => {
    try { return formatDisplayDate(new Date(dateStr)); } catch { return dateStr; }
  };

  const isStockTransfer = (vchType: string) => {
    const t = (vchType || "").toLowerCase();
    return t === "stock transfer" || t === "stocktransfer" || t === "st";
  };

  const allTransactions: Transaction[] = data?.transactions || [];

  const filteredTransactions = useMemo(() => {
    return allTransactions.filter((txn) => {
      if (txn.isOpeningBalance) return true;
      if (!showStockTransfers && isStockTransfer(txn.vchType)) return false;
      return true;
    });
  }, [allTransactions, showStockTransfers]);

  // When showing all months, build rows with month separator rows injected
  const displayRows = useMemo(() => {
    if (!showAllMonths) return filteredTransactions;
    const monthNames = ['January','February','March','April','May','June',
                        'July','August','September','October','November','December'];
    const rows: (Transaction & { _isSeparator?: boolean; _separatorLabel?: string })[] = [];
    let lastMonth = -1;
    for (const txn of filteredTransactions) {
      if (!txn.isOpeningBalance) {
        const d = new Date(txn.date);
        const m = d.getMonth(); // 0-indexed
        if (m !== lastMonth) {
          lastMonth = m;
          rows.push({ ...txn, _isSeparator: true, _separatorLabel: monthNames[m] + ' ' + year });
        }
      }
      rows.push(txn);
    }
    return rows;
  }, [filteredTransactions, showAllMonths, year]);

  const calculatedTotals = useMemo(() => {
    const nonOpening = filteredTransactions.filter(t => !t.isOpeningBalance);
    const inwardQty = nonOpening.reduce((s, t) => s + (t.inwardQty || 0), 0);
    const inwardValue = nonOpening.reduce((s, t) => s + (t.inwardValue || 0), 0);
    const outwardQty = nonOpening.reduce((s, t) => s + (t.outwardQty || 0), 0);
    const outwardValue = nonOpening.reduce((s, t) => s + (t.outwardValue || 0), 0);
    const originalLastTxn = allTransactions[allTransactions.length - 1];
    return {
      inwardQty, inwardRate: inwardQty > 0 ? inwardValue / inwardQty : 0, inwardValue,
      outwardQty, outwardRate: outwardQty > 0 ? outwardValue / outwardQty : 0, outwardValue,
      closingQty: originalLastTxn?.closingQty || 0,
      closingRate: originalLastTxn?.closingRate || 0,
      closingValue: originalLastTxn?.closingValue || 0,
    };
  }, [filteredTransactions, allTransactions]);

  const getTransactionEditUrl = (txn: Transaction): string | null => {
    if (txn.isOpeningBalance) return null;
    const vchType = (txn.vchType || "").toLowerCase();
    if (vchType === 'production' || vchType === 'consumption') return txn.voucherId ? `/vouchers/${txn.voucherId}/edit` : null;
    if (vchType === 'pos') return txn.voucherId ? `/pos/edit/${txn.voucherId}` : null;
    if (vchType === 'stock transfer') return txn.voucherId ? `/vouchers/${txn.voucherId}/edit` : null;
    if (vchType === 'po offload') return txn.poId ? `/purchase-orders/${txn.poId}` : null;
    return null;
  };

  const handleParticularsClick = (txn: Transaction) => {
    const url = getTransactionEditUrl(txn);
    if (url) navigate(url);
  };

  const navigableRows = useMemo(() => filteredTransactions.filter(t => !t.isOpeningBalance), [filteredTransactions]);

  const handleTableKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      if (hasAnyOpenDialog()) return;
      e.preventDefault();
      navigate(`/locations/${locationId}/stock-items/${stockItemId}/history`);
      return;
    }
    if (hasAnyOpenDialog()) return;
    if (navigableRows.length === 0) return;
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedRowIndex(prev => Math.max(-1, prev - 1));
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (selectedRowIndex === -1) setSelectedRowIndex(0);
      else if (selectedRowIndex < navigableRows.length - 1) setSelectedRowIndex(prev => prev + 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (selectedRowIndex >= 0 && selectedRowIndex < navigableRows.length) {
        const url = getTransactionEditUrl(navigableRows[selectedRowIndex]);
        if (url) navigate(url);
      }
    }
  };

  useEffect(() => {
    window.addEventListener("keydown", handleTableKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleTableKeyDown, { capture: true });
  }, [selectedRowIndex, data]);

  useEffect(() => {
    if (selectedRowIndex < 0 || !tableScrollContainer.current) return;
    const rowElement = tableScrollContainer.current.querySelector(`[data-row-index="${selectedRowIndex}"]`);
    if (rowElement) rowElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedRowIndex]);

  useEffect(() => {
    registerCursorNav({
      canNavigateUp: selectedRowIndex > -1,
      canNavigateDown: navigableRows.length > 0 && (selectedRowIndex === -1 || selectedRowIndex < navigableRows.length - 1),
      onUp: () => setSelectedRowIndex(prev => Math.max(-1, prev - 1)),
      onDown: () => setSelectedRowIndex(prev => {
        if (prev === -1) return 0;
        if (prev < navigableRows.length - 1) return prev + 1;
        return prev;
      }),
    });
    return () => clearCursorNav();
  }, [selectedRowIndex, navigableRows]);

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  const colSpanFull = posUser ? 6 : 12;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost" size="icon"
            onClick={() => navigate(`/locations/${locationId}/stock-items/${stockItemId}/history`)}
            data-testid="button-back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <PageHeader title="Location Vouchers" />
            {data?.stockItem && data?.location && (
              <div className="flex items-center gap-2 text-muted-foreground" data-testid="text-item-location">
                <span>{data.stockItem.name} ({data.stockItem.code})</span>
                <span>•</span>
                <MapPin className="h-4 w-4" />
                <span>{data.location.name}</span>
                <span>•</span>
                <span>{showAllMonths ? String(year) : `${'monthName' in (data as any) ? (data as any).monthName : ''} ${year}`}</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Button
            variant={showAllMonths ? "default" : "outline"}
            size="sm"
            onClick={() => { setShowAllMonths(v => !v); setSelectedRowIndex(-1); }}
            data-testid="button-show-all-months"
          >
            <Eye className="h-4 w-4 mr-1.5" />
            {showAllMonths ? "This month only" : "Show all months"}
          </Button>
          <div className="flex items-center gap-2">
            <Checkbox
              id="show-stock-transfers"
              checked={showStockTransfers}
              onCheckedChange={(checked) => setShowStockTransfers(checked === true)}
              data-testid="checkbox-show-stock-transfers"
            />
            <Label htmlFor="show-stock-transfers" className="text-sm cursor-pointer">Show Stock Transfers</Label>
          </div>
          {!showAllMonths && (
            <PeriodFilter value={periodFilter} onChange={setPeriodFilter} data-testid="period-filter" />
          )}
        </div>
      </div>

      <Card className="overflow-hidden flex flex-col" style={{ maxHeight: 'calc(100vh - 250px)' }}>
        <CardHeader className="pb-2 flex-shrink-0">
          <CardTitle className="text-lg">
            {showAllMonths
              ? `All Transactions — ${year}`
              : `Transactions — ${'monthName' in ((data as any) ?? {}) ? (data as any).monthName : ''} ${year}`}
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-auto flex-1 p-0" ref={tableScrollContainer}>
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-30 bg-muted">
              <tr className="bg-muted border-b">
                <th rowSpan={2} className="text-left align-bottom px-4 py-2 border-r w-[100px] bg-muted font-medium">Date</th>
                <th rowSpan={2} className="text-left align-bottom px-4 py-2 border-r bg-muted font-medium">Particulars</th>
                <th rowSpan={2} className="text-left align-bottom px-4 py-2 border-r w-[120px] bg-muted font-medium">Vch Type</th>
                <th colSpan={posUser ? 1 : 3} className="text-center px-4 py-2 border-r bg-muted font-medium">Inwards</th>
                <th colSpan={posUser ? 1 : 3} className="text-center px-4 py-2 border-r bg-muted font-medium">Outwards</th>
                <th colSpan={posUser ? 1 : 3} className="text-center px-4 py-2 bg-muted font-medium">Closing</th>
              </tr>
              <tr className="bg-muted/80 border-b">
                <th className="text-right px-2 py-2 w-[60px] bg-muted/80 font-medium border-r">Qty</th>
                {!posUser && <th className="text-right px-2 py-2 w-[60px] bg-muted/80 font-medium">Rate</th>}
                {!posUser && <th className="text-right px-2 py-2 border-r w-[80px] bg-muted/80 font-medium">Value</th>}
                <th className="text-right px-2 py-2 w-[60px] bg-muted/80 font-medium border-r">Qty</th>
                {!posUser && <th className="text-right px-2 py-2 w-[60px] bg-muted/80 font-medium">Rate</th>}
                {!posUser && <th className="text-right px-2 py-2 border-r w-[80px] bg-muted/80 font-medium">Value</th>}
                <th className="text-right px-2 py-2 w-[60px] bg-muted/80 font-medium">Qty</th>
                {!posUser && <th className="text-right px-2 py-2 w-[60px] bg-muted/80 font-medium">Rate</th>}
                {!posUser && <th className="text-right px-2 py-2 w-[80px] bg-muted/80 font-medium">Value</th>}
              </tr>
            </thead>
            <tbody>
              {displayRows.map((txn: any, idx: number) => {
                // Month separator row
                if (txn._isSeparator) {
                  return (
                    <tr key={`sep-${idx}`} className="bg-primary/10 border-b border-t">
                      <td colSpan={colSpanFull} className="px-4 py-1.5">
                        <span className="text-xs font-bold uppercase tracking-wider text-primary">
                          {txn._separatorLabel}
                        </span>
                      </td>
                    </tr>
                  );
                }

                const navIndex = txn.isOpeningBalance ? -1 : navigableRows.indexOf(txn);
                const isSelected = navIndex >= 0 && selectedRowIndex === navIndex;

                return (
                  <tr
                    key={idx}
                    data-testid={`row-txn-${idx}`}
                    className={`border-b ${txn.isOpeningBalance ? "bg-muted/30 font-medium" : isSelected ? "ring-2 ring-primary bg-blue-200 dark:bg-blue-900" : ""}`}
                    data-row-index={navIndex >= 0 ? navIndex : undefined}
                  >
                    <td className="px-4 py-3 border-r tabular-nums">
                      {txn.isOpeningBalance ? "" : formatDate(txn.date)}
                    </td>
                    <td className={`px-4 py-3 border-r ${txn.isOpeningBalance ? "font-semibold" : ""}`}>
                      {getTransactionEditUrl(txn) ? (
                        <button
                          onClick={() => handleParticularsClick(txn)}
                          className="text-left text-primary hover:underline cursor-pointer"
                          data-testid={`link-particulars-${idx}`}
                        >
                          {txn.particulars}
                        </button>
                      ) : txn.particulars}
                    </td>
                    <td className="px-4 py-3 border-r text-xs">{txn.vchType}</td>
                    <td className="text-right px-2 py-3 tabular-nums border-r">{formatNumber(txn.inwardQty, 0)}</td>
                    {!posUser && <td className="text-right px-2 py-3 tabular-nums">{formatAmount(txn.inwardRate)}</td>}
                    {!posUser && <td className="text-right px-2 py-3 tabular-nums border-r">{formatAmount(txn.inwardValue)}</td>}
                    <td className="text-right px-2 py-3 tabular-nums border-r">{formatNumber(txn.outwardQty, 0)}</td>
                    {!posUser && (
                      <td className="text-right px-2 py-3 tabular-nums">
                        {formatAmount(txn.isPOS && txn.posSellingRate ? txn.posSellingRate : txn.outwardRate)}
                      </td>
                    )}
                    {!posUser && (
                      <td className="text-right px-2 py-3 tabular-nums border-r">
                        {formatAmount(txn.isPOS && txn.posSellingValue ? txn.posSellingValue : txn.outwardValue)}
                      </td>
                    )}
                    <td className="text-right px-2 py-3 tabular-nums font-medium">{formatNumber(txn.closingQty, 0)}</td>
                    {!posUser && <td className="text-right px-2 py-3 tabular-nums">{formatAmount(txn.closingRate)}</td>}
                    {!posUser && <td className="text-right px-2 py-3 tabular-nums font-medium">{formatAmount(txn.closingValue)}</td>}
                  </tr>
                );
              })}

              {displayRows.filter((r: any) => !r._isSeparator).length === 0 && (
                <tr>
                  <td colSpan={colSpanFull} className="text-center text-muted-foreground py-8">
                    No transactions found
                  </td>
                </tr>
              )}

              {filteredTransactions.length > 0 && (
                <tr className="bg-muted/50 font-bold border-t">
                  <td colSpan={3} className="px-4 py-3 border-r">Totals</td>
                  <td className="text-right px-2 py-3 tabular-nums border-r">{formatNumber(calculatedTotals.inwardQty, 0)}</td>
                  {!posUser && <td className="text-right px-2 py-3 tabular-nums">{formatAmount(calculatedTotals.inwardRate)}</td>}
                  {!posUser && <td className="text-right px-2 py-3 tabular-nums border-r">{formatAmount(calculatedTotals.inwardValue)}</td>}
                  <td className="text-right px-2 py-3 tabular-nums border-r">{formatNumber(calculatedTotals.outwardQty, 0)}</td>
                  {!posUser && <td className="text-right px-2 py-3 tabular-nums">{formatAmount(calculatedTotals.outwardRate)}</td>}
                  {!posUser && <td className="text-right px-2 py-3 tabular-nums border-r">{formatAmount(calculatedTotals.outwardValue)}</td>}
                  <td className="text-right px-2 py-3 tabular-nums">{formatNumber(calculatedTotals.closingQty, 0)}</td>
                  {!posUser && <td className="text-right px-2 py-3 tabular-nums">{formatAmount(calculatedTotals.closingRate)}</td>}
                  {!posUser && <td className="text-right px-2 py-3 tabular-nums">{formatAmount(calculatedTotals.closingValue)}</td>}
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
