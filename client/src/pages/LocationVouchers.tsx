import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { ArrowLeft, MapPin } from "lucide-react";
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
  const params = useParams();
  const locationId = parseInt(params.locationId || "0");
  const stockItemId = parseInt(params.stockItemId || "0");
  const year = parseInt(params.year || "0");
  const month = parseInt(params.month || "0");
  const [_location, navigate] = useLocation();
  
  const { data, isLoading } = useQuery<LocationVouchersData>({
    queryKey: [`/api/locations/${locationId}/stock-items/${stockItemId}/vouchers/${year}/${month}`],
    enabled: locationId > 0 && stockItemId > 0 && year > 0 && month > 0,
  });
  
  const formatNumber = (num: number, decimals = 2) => {
    if (num === 0) return "";
    return num.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  };
  
  const formatDate = (dateStr: string) => {
    try {
      return format(new Date(dateStr), "d/MMM/yy");
    } catch {
      return dateStr;
    }
  };
  
  const getTransactionEditUrl = (txn: Transaction): string | null => {
    if (txn.isOpeningBalance) return null;
    
    const vchType = txn.vchType.toLowerCase();
    
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
      
      <Card className="overflow-hidden flex flex-col" style={{ maxHeight: 'calc(100vh - 250px)' }}>
        <CardHeader className="pb-2 flex-shrink-0">
          <CardTitle className="text-lg">
            Transactions - {data?.monthName} {data?.year}
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-auto flex-1 p-0">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow className="bg-muted">
                <TableHead rowSpan={2} className="align-bottom border-r w-[100px] bg-muted">Date</TableHead>
                <TableHead rowSpan={2} className="align-bottom border-r bg-muted">Particulars</TableHead>
                <TableHead rowSpan={2} className="align-bottom border-r w-[120px] bg-muted">Vch Type</TableHead>
                <TableHead colSpan={3} className="text-center border-r bg-muted">Inwards</TableHead>
                <TableHead colSpan={3} className="text-center border-r bg-muted">Outwards</TableHead>
                <TableHead colSpan={3} className="text-center bg-muted">Closing</TableHead>
              </TableRow>
              <TableRow className="bg-muted/80">
                <TableHead className="text-right w-[60px] bg-muted/80">Qty</TableHead>
                <TableHead className="text-right w-[60px] bg-muted/80">Rate</TableHead>
                <TableHead className="text-right border-r w-[80px] bg-muted/80">Value</TableHead>
                <TableHead className="text-right w-[60px] bg-muted/80">Qty</TableHead>
                <TableHead className="text-right w-[60px] bg-muted/80">Rate</TableHead>
                <TableHead className="text-right border-r w-[80px] bg-muted/80">Value</TableHead>
                <TableHead className="text-right w-[60px] bg-muted/80">Qty</TableHead>
                <TableHead className="text-right w-[60px] bg-muted/80">Rate</TableHead>
                <TableHead className="text-right w-[80px] bg-muted/80">Value</TableHead>
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
        </CardContent>
      </Card>
    </div>
  );
}
