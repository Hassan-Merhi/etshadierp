import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { ArrowLeft, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { PeriodFilter, PeriodFilterValue, getDefaultPeriodValue } from "@/components/ui/period-filter";
import { format } from "date-fns";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { useState, useEffect, useRef, useMemo } from "react";

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
  stockItem: {
    id: number;
    code: string;
    name: string;
    uom: string;
  };
  location: {
    id: number;
    code: string;
    name: string;
  };
  year: number;
  month: number;
  monthName: string;
  transactions: Transaction[];
  totals: {
    inwardQty: number;
    inwardRate: number;
    inwardValue: number;
    outwardQty: number;
    outwardRate: number;
    outwardValue: number;
    closingQty: number;
    closingRate: number;
    closingValue: number;
  };
}

export default function LocationVouchers() {
  const { formatDisplayDate } = useDateFormat();
  const { formatAmount } = useCurrencyContext();
  const params = useParams();
  const locationId = parseInt(params.locationId || "0");
  const stockItemId = parseInt(params.stockItemId || "0");
  const year = parseInt(params.year || "0");
  const month = parseInt(params.month || "0");
  const [_location, navigate] = useLocation();
  const [selectedRowIndex, setSelectedRowIndex] = useState<number>(-1);
  const tableScrollContainer = useRef<HTMLDivElement>(null);
  const [periodFilter, setPeriodFilter] = useState<PeriodFilterValue>(() => getDefaultPeriodValue("this_month"));
  const [showStockTransfers, setShowStockTransfers] = useState(false);
  
  const { data, isLoading } = useQuery<LocationVouchersData>({
    queryKey: [`/api/locations/${locationId}/stock-items/${stockItemId}/vouchers/${year}/${month}`, periodFilter.fromDate, periodFilter.toDate],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (periodFilter.fromDate) params.set("startDate", periodFilter.fromDate);
      if (periodFilter.toDate) params.set("endDate", periodFilter.toDate);
      const url = `/api/locations/${locationId}/stock-items/${stockItemId}/vouchers/${year}/${month}?${params.toString()}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch vouchers");
      return res.json();
    },
    enabled: locationId > 0 && stockItemId > 0 && year > 0 && month > 0,
  });
  
  const formatNumber = (num: number, decimals = 2) => {
    if (num === 0) return "";
    return num.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  };
  
  const formatDate = (dateStr: string) => {
    try {
      return formatDisplayDate(new Date(dateStr));
    } catch {
      return dateStr;
    }
  };

  // Helper to check if a transaction is a stock transfer
  const isStockTransfer = (vchType: string) => {
    const type = (vchType || "").toLowerCase();
    return type === "stock transfer" || type === "stocktransfer" || type === "st";
  };

  // Filter transactions based on showStockTransfers toggle
  const filteredTransactions = useMemo(() => {
    if (!data?.transactions) return [];
    
    return data.transactions.filter((txn) => {
      // Always keep opening balance row
      if (txn.isOpeningBalance) return true;
      // Filter out stock transfers if toggle is off
      if (!showStockTransfers && isStockTransfer(txn.vchType)) return false;
      return true;
    });
  }, [data?.transactions, showStockTransfers]);

  // Recalculate totals based on filtered transactions (excluding opening balance)
  const calculatedTotals = useMemo(() => {
    const nonOpeningTxns = filteredTransactions.filter(t => !t.isOpeningBalance);
    
    const inwardQty = nonOpeningTxns.reduce((sum, t) => sum + (t.inwardQty || 0), 0);
    const inwardValue = nonOpeningTxns.reduce((sum, t) => sum + (t.inwardValue || 0), 0);
    const outwardQty = nonOpeningTxns.reduce((sum, t) => sum + (t.outwardQty || 0), 0);
    const outwardValue = nonOpeningTxns.reduce((sum, t) => sum + (t.outwardValue || 0), 0);
    
    // Use the overall closing values from original data (not filtered) for accuracy
    const originalLastTxn = data?.transactions?.[data.transactions.length - 1];
    const closingQty = originalLastTxn?.closingQty || 0;
    const closingRate = originalLastTxn?.closingRate || 0;
    const closingValue = originalLastTxn?.closingValue || 0;

    return {
      inwardQty,
      inwardRate: inwardQty > 0 ? inwardValue / inwardQty : 0,
      inwardValue,
      outwardQty,
      outwardRate: outwardQty > 0 ? outwardValue / outwardQty : 0,
      outwardValue,
      closingQty,
      closingRate,
      closingValue,
    };
  }, [filteredTransactions, data?.transactions]);
  
  const getTransactionEditUrl = (txn: Transaction): string | null => {
    if (txn.isOpeningBalance) return null;
    
    const vchType = (txn.vchType || "").toLowerCase();
    
    if (vchType === 'production' || vchType === 'consumption') {
      return txn.voucherId ? `/vouchers/${txn.voucherId}/edit` : null;
    }
    
    if (vchType === 'pos') {
      return txn.voucherId ? `/pos/edit/${txn.voucherId}` : null;
    }
    
    if (vchType === 'stock transfer') {
      return txn.voucherId ? `/vouchers/${txn.voucherId}/edit` : null;
    }
    
    if (vchType === 'po offload') {
      return txn.poId ? `/purchase-orders/${txn.poId}` : null;
    }
    
    return null;
  };
  
  const handleParticularsClick = (txn: Transaction) => {
    const url = getTransactionEditUrl(txn);
    if (url) {
      navigate(url);
    }
  };

  // Get navigable rows (excluding opening balance) from filtered transactions
  const navigableRows = useMemo(() => {
    return filteredTransactions.filter(t => !t.isOpeningBalance);
  }, [filteredTransactions]);

  const getNavigableRows = () => {
    return navigableRows;
  };

  const handleTableKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      window.history.back();
      return;
    }
    
    const rows = getNavigableRows();
    if (rows.length === 0) return;
    
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedRowIndex(prev => Math.max(-1, prev - 1));
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (selectedRowIndex === -1) {
        setSelectedRowIndex(0);
      } else if (selectedRowIndex < rows.length - 1) {
        setSelectedRowIndex(prev => prev + 1);
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (selectedRowIndex >= 0 && selectedRowIndex < rows.length) {
        const txn = rows[selectedRowIndex];
        const url = getTransactionEditUrl(txn);
        if (url) {
          navigate(url);
        }
      }
    }
  };

  useEffect(() => {
    window.addEventListener("keydown", handleTableKeyDown);
    return () => window.removeEventListener("keydown", handleTableKeyDown);
  }, [selectedRowIndex, data]);

  useEffect(() => {
    if (selectedRowIndex < 0 || !tableScrollContainer.current) return;
    const rowElement = tableScrollContainer.current.querySelector(`[data-row-index="${selectedRowIndex}"]`);
    if (rowElement) {
      rowElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedRowIndex]);
  
  if (isLoading) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }
  
  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => navigate(`/locations/${locationId}/stock-items/${stockItemId}/history`)} 
            data-testid="button-back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-page-title">
              Location Vouchers
            </h1>
            {data?.stockItem && data?.location && (
              <div className="flex items-center gap-2 text-muted-foreground" data-testid="text-item-location">
                <span>{data.stockItem.name} ({data.stockItem.code})</span>
                <span>•</span>
                <MapPin className="h-4 w-4" />
                <span>{data.location.name}</span>
                <span>•</span>
                <span>{data.monthName} {data.year}</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Checkbox
              id="show-stock-transfers"
              checked={showStockTransfers}
              onCheckedChange={(checked) => setShowStockTransfers(checked === true)}
              data-testid="checkbox-show-stock-transfers"
            />
            <Label htmlFor="show-stock-transfers" className="text-sm cursor-pointer">
              Show Stock Transfers
            </Label>
          </div>
          <PeriodFilter
            value={periodFilter}
            onChange={setPeriodFilter}
            data-testid="period-filter"
          />
        </div>
      </div>
      
      <Card className="overflow-hidden flex flex-col" style={{ maxHeight: 'calc(100vh - 250px)' }}>
        <CardHeader className="pb-2 flex-shrink-0">
          <CardTitle className="text-lg">
            Transactions - {data?.monthName} {data?.year}
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-auto flex-1 p-0" ref={tableScrollContainer}>
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10 bg-muted">
              <tr className="bg-muted border-b">
                <th rowSpan={2} className="text-left align-bottom px-4 py-2 border-r w-[100px] bg-muted font-medium">Date</th>
                <th rowSpan={2} className="text-left align-bottom px-4 py-2 border-r bg-muted font-medium">Particulars</th>
                <th rowSpan={2} className="text-left align-bottom px-4 py-2 border-r w-[120px] bg-muted font-medium">Vch Type</th>
                <th colSpan={3} className="text-center px-4 py-2 border-r bg-muted font-medium">Inwards</th>
                <th colSpan={3} className="text-center px-4 py-2 border-r bg-muted font-medium">Outwards</th>
                <th colSpan={3} className="text-center px-4 py-2 bg-muted font-medium">Closing</th>
              </tr>
              <tr className="bg-muted/80 border-b">
                <th className="text-right px-2 py-2 w-[60px] bg-muted/80 font-medium">Qty</th>
                <th className="text-right px-2 py-2 w-[60px] bg-muted/80 font-medium">Rate</th>
                <th className="text-right px-2 py-2 border-r w-[80px] bg-muted/80 font-medium">Value</th>
                <th className="text-right px-2 py-2 w-[60px] bg-muted/80 font-medium">Qty</th>
                <th className="text-right px-2 py-2 w-[60px] bg-muted/80 font-medium">Rate</th>
                <th className="text-right px-2 py-2 border-r w-[80px] bg-muted/80 font-medium">Value</th>
                <th className="text-right px-2 py-2 w-[60px] bg-muted/80 font-medium">Qty</th>
                <th className="text-right px-2 py-2 w-[60px] bg-muted/80 font-medium">Rate</th>
                <th className="text-right px-2 py-2 w-[80px] bg-muted/80 font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
                {filteredTransactions.map((txn, idx) => {
                  // Find this transaction's index in the navigable rows array
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
                      ) : (
                        txn.particulars
                      )}
                    </td>
                    <td className="px-4 py-3 border-r text-xs">{txn.vchType}</td>
                    <td className="text-right px-2 py-3 tabular-nums">{formatNumber(txn.inwardQty, 0)}</td>
                    <td className="text-right px-2 py-3 tabular-nums">{formatAmount(txn.inwardRate)}</td>
                    <td className="text-right px-2 py-3 tabular-nums border-r">{formatAmount(txn.inwardValue)}</td>
                    <td className="text-right px-2 py-3 tabular-nums">{formatNumber(txn.outwardQty, 0)}</td>
                    <td className="text-right px-2 py-3 tabular-nums">
                      {formatAmount(txn.isPOS && txn.posSellingRate ? txn.posSellingRate : txn.outwardRate)}
                    </td>
                    <td className="text-right px-2 py-3 tabular-nums border-r">
                      {formatAmount(txn.isPOS && txn.posSellingValue ? txn.posSellingValue : txn.outwardValue)}
                    </td>
                    <td className="text-right px-2 py-3 tabular-nums font-medium">{formatNumber(txn.closingQty, 0)}</td>
                    <td className="text-right px-2 py-3 tabular-nums">{formatAmount(txn.closingRate)}</td>
                    <td className="text-right px-2 py-3 tabular-nums font-medium">{formatAmount(txn.closingValue)}</td>
                  </tr>
                  );
                })}
                
                {filteredTransactions.length === 0 && (
                  <tr>
                    <td colSpan={12} className="text-center text-muted-foreground py-8">
                      No transactions found for this month
                    </td>
                  </tr>
                )}
                
                {filteredTransactions.length > 0 && (
                  <tr className="bg-muted/50 font-bold border-t">
                    <td colSpan={3} className="px-4 py-3 border-r">Totals</td>
                    <td className="text-right px-2 py-3 tabular-nums">{formatNumber(calculatedTotals.inwardQty, 0)}</td>
                    <td className="text-right px-2 py-3 tabular-nums">{formatAmount(calculatedTotals.inwardRate)}</td>
                    <td className="text-right px-2 py-3 tabular-nums border-r">{formatAmount(calculatedTotals.inwardValue)}</td>
                    <td className="text-right px-2 py-3 tabular-nums">{formatNumber(calculatedTotals.outwardQty, 0)}</td>
                    <td className="text-right px-2 py-3 tabular-nums">{formatAmount(calculatedTotals.outwardRate)}</td>
                    <td className="text-right px-2 py-3 tabular-nums border-r">{formatAmount(calculatedTotals.outwardValue)}</td>
                    <td className="text-right px-2 py-3 tabular-nums">{formatNumber(calculatedTotals.closingQty, 0)}</td>
                    <td className="text-right px-2 py-3 tabular-nums">{formatAmount(calculatedTotals.closingRate)}</td>
                    <td className="text-right px-2 py-3 tabular-nums">{formatAmount(calculatedTotals.closingValue)}</td>
                  </tr>
                )}
              </tbody>
            </table>
        </CardContent>
      </Card>
    </div>
  );
}
