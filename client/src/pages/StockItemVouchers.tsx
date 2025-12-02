import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { useDateFormat } from "@/contexts/DateFormatContext";

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

interface VouchersData {
  stockItem: {
    id: number;
    code: string;
    name: string;
    uom: string;
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

export default function StockItemVouchers() {
  const { formatDisplayDate } = useDateFormat();
  const params = useParams();
  const stockItemId = parseInt(params.id || "0");
  const year = parseInt(params.year || "0");
  const month = parseInt(params.month || "0");
  const [_location, navigate] = useLocation();
  
  const { data, isLoading } = useQuery<VouchersData>({
    queryKey: [`/api/stock-items/${stockItemId}/vouchers/${year}/${month}`],
    enabled: stockItemId > 0 && year > 0 && month > 0,
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
  
  const getTransactionEditUrl = (txn: Transaction): string | null => {
    if (txn.isOpeningBalance) return null;
    
    const vchType = txn.vchType.toLowerCase();
    
    // Purchase Import - navigate to PO edit page
    if (vchType === 'purchase import') {
      return txn.poId ? `/purchase-orders/${txn.poId}/edit` : null;
    }
    
    // Production/Consumption - navigate to voucher edit page
    if (vchType === 'production' || vchType === 'consumption') {
      return txn.voucherId ? `/vouchers/${txn.voucherId}/edit` : null;
    }
    
    // POS sales - navigate to POS edit page
    if (vchType.startsWith('pos') || vchType.includes('pos')) {
      return txn.voucherId ? `/pos/edit/${txn.voucherId}` : null;
    }
    
    // Stock Transfer - navigate to voucher edit page
    if (vchType.startsWith('stock transfer')) {
      return txn.voucherId ? `/vouchers/${txn.voucherId}/edit` : null;
    }
    
    // Generic Sales - navigate to voucher edit page
    if (vchType === 'sales') {
      return txn.voucherId ? `/vouchers/${txn.voucherId}/edit` : null;
    }
    
    return null;
  };
  
  const handleParticularsClick = (txn: Transaction) => {
    const url = getTransactionEditUrl(txn);
    if (url) {
      navigate(url);
    }
  };
  
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
      <div className="flex items-center gap-4">
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={() => navigate(`/stock-items/${stockItemId}/history`)} 
          data-testid="button-back"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">
            Stock Item Vouchers
          </h1>
          {data?.stockItem && (
            <p className="text-muted-foreground" data-testid="text-item-name">
              {data.stockItem.name} ({data.stockItem.code}) - {data.monthName} {data.year}
            </p>
          )}
        </div>
      </div>
      
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">
            Transactions for {data?.monthName} {data?.year}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table className="text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead rowSpan={2} className="align-bottom border-r w-[80px]">Date</TableHead>
                  <TableHead rowSpan={2} className="align-bottom border-r">Particulars</TableHead>
                  <TableHead rowSpan={2} className="align-bottom border-r">Vch Type</TableHead>
                  <TableHead colSpan={3} className="text-center border-r">Inwards</TableHead>
                  <TableHead colSpan={3} className="text-center border-r">Outwards</TableHead>
                  <TableHead colSpan={3} className="text-center">Closing</TableHead>
                </TableRow>
                <TableRow>
                  <TableHead className="text-right w-[60px]">Qty</TableHead>
                  <TableHead className="text-right w-[60px]">Rate</TableHead>
                  <TableHead className="text-right border-r w-[80px]">Value</TableHead>
                  <TableHead className="text-right w-[60px]">Qty</TableHead>
                  <TableHead className="text-right w-[60px]">Rate</TableHead>
                  <TableHead className="text-right border-r w-[80px]">Value</TableHead>
                  <TableHead className="text-right w-[60px]">Qty</TableHead>
                  <TableHead className="text-right w-[60px]">Rate</TableHead>
                  <TableHead className="text-right w-[80px]">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.transactions.map((txn, idx) => (
                  <TableRow 
                    key={idx} 
                    data-testid={`row-txn-${idx}`}
                    className={txn.isOpeningBalance ? "bg-muted/30 font-medium" : ""}
                  >
                    <TableCell className="border-r tabular-nums">
                      {txn.isOpeningBalance ? "" : formatDate(txn.date)}
                    </TableCell>
                    <TableCell className={`border-r ${txn.isOpeningBalance ? "font-semibold" : ""}`}>
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
                    </TableCell>
                    <TableCell className="border-r text-xs">{txn.vchType}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(txn.inwardQty, 0)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(txn.inwardRate)}</TableCell>
                    <TableCell className="text-right tabular-nums border-r">{formatNumber(txn.inwardValue)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(txn.outwardQty, 0)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(txn.isPOS && txn.posSellingRate ? txn.posSellingRate : txn.outwardRate)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums border-r">
                      {formatNumber(txn.isPOS && txn.posSellingValue ? txn.posSellingValue : txn.outwardValue)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{formatNumber(txn.closingQty, 0)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(txn.closingRate)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{formatNumber(txn.closingValue)}</TableCell>
                  </TableRow>
                ))}
                
                {data?.transactions.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={12} className="text-center text-muted-foreground py-8">
                      No transactions found for this month
                    </TableCell>
                  </TableRow>
                )}
                
                {data && data.transactions.length > 0 && (
                  <TableRow className="bg-muted/50 font-bold">
                    <TableCell colSpan={3} className="border-r">Totals</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(data.totals.inwardQty, 0)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(data.totals.inwardRate)}</TableCell>
                    <TableCell className="text-right tabular-nums border-r">{formatNumber(data.totals.inwardValue)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(data.totals.outwardQty, 0)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(data.totals.outwardRate)}</TableCell>
                    <TableCell className="text-right tabular-nums border-r">{formatNumber(data.totals.outwardValue)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(data.totals.closingQty, 0)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(data.totals.closingRate)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(data.totals.closingValue)}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
