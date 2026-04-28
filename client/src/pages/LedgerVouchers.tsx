import { useState, useEffect } from "react";
import { useLocation, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAppMode } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { format, parseISO, startOfMonth, endOfMonth } from "date-fns";
import {
  ArrowLeft,
  ChevronRight,
  Loader2,
  FileText,
} from "lucide-react";
import { PeriodFilter, PeriodFilterValue, getDefaultPeriodValue } from "@/components/ui/period-filter";
import { useDateJump } from "@/hooks/use-date-jump";
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
import { Badge } from "@/components/ui/badge";
import { useCurrencyContext } from "@/contexts/CurrencyContext";

interface VoucherEntry {
  id: number;
  voucherId: number;
  date: string;
  particulars: string;
  voucherType: string;
  voucherNumber: string;
  debit: number;
  credit: number;
}

interface LedgerVouchersData {
  account: {
    id: number;
    code: string;
    name: string;
  };
  month: number;
  monthName: string;
  year: number;
  openingBalance: number;
  vouchers: VoucherEntry[];
  totals: {
    debit: number;
    credit: number;
  };
  closingBalance: number;
}

const voucherTypeColors: Record<string, string> = {
  Payment: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  Receipt: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  Journal: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  "Stock Transfer": "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  Production: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  Consumption: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  "Purchase Import": "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400",
};

function getInitialPeriodValue(year: number | null, month: number | null): PeriodFilterValue {
  if (year && month) {
    const monthDate = new Date(year, month - 1, 1);
    return {
      fromDate: format(startOfMonth(monthDate), "yyyy-MM-dd"),
      toDate: format(endOfMonth(monthDate), "yyyy-MM-dd"),
      preset: "custom",
    };
  }
  return getDefaultPeriodValue("today");
}

export default function LedgerVouchers() {
  const [, navigate] = useLocation();
  const [, params] = useRoute("/ledger-vouchers/:accountId/:year/:month");
  const { formatAmount } = useCurrencyContext();
  const { formatShortDate } = useDateFormat();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);
  
  const accountId = params?.accountId ? parseInt(params.accountId) : null;
  const year = params?.year ? parseInt(params.year) : null;
  const month = params?.month ? parseInt(params.month) : null;

  const [periodFilter, setPeriodFilter] = useState<PeriodFilterValue>(() => 
    getInitialPeriodValue(year, month)
  );
  useDateJump((date) => setPeriodFilter({ fromDate: date, toDate: date, preset: "custom" }));

  useEffect(() => {
    if (year && month) {
      const monthDate = new Date(year, month - 1, 1);
      setPeriodFilter({
        fromDate: format(startOfMonth(monthDate), "yyyy-MM-dd"),
        toDate: format(endOfMonth(monthDate), "yyyy-MM-dd"),
        preset: "custom",
      });
    }
  }, [year, month]);

  const { data, isLoading } = useQuery<LedgerVouchersData>({
    queryKey: ["/api/reports/ledger-vouchers", accountId, year, month, periodFilter.fromDate, periodFilter.toDate],
    queryFn: async () => {
      const searchParams = new URLSearchParams({
        startDate: periodFilter.fromDate,
        endDate: periodFilter.toDate,
      });
      const response = await fetch(
        `/api/reports/ledger-vouchers/${accountId}/${year}/${month}?${searchParams}`,
        { credentials: "include" }
      );
      if (!response.ok) throw new Error("Failed to fetch ledger vouchers");
      return response.json();
    },
    enabled: !!accountId && !!year && !!month,
  });

  const handleVoucherClick = (voucherId: number) => {
    window.open(`/voucher-detail/${voucherId}`, "_blank");
  };

  if (!accountId || !year || !month) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Invalid parameters</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-primary text-primary-foreground p-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate(`/ledger-monthly/${accountId}`)}
              className="text-primary-foreground hover:bg-primary/80"
              data-testid="button-back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <p className="text-sm opacity-80">Ledger Vouchers</p>
              <h1 className="text-lg sm:text-xl font-bold" data-testid="text-account-name">
                {data?.account?.name || "Loading..."}
              </h1>
            </div>
          </div>
          <div className="text-right">
            <PeriodFilter
              value={periodFilter}
              onChange={setPeriodFilter}
              data-testid="ledger-vouchers-period-filter"
            />
          </div>
        </div>
      </div>

      <div className="p-3 sm:p-4 space-y-6">
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-[400px] w-full" />
          </div>
        ) : data ? (
          <>
            {/* Vouchers Table */}
            <Card>
              <CardHeader className="pb-0">
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <FileText className="h-5 w-5" />
                      Ledger: {data.account.name}
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      1/{data.monthName.substring(0, 3)}/{data.year} to{" "}
                      {new Date(data.year, data.month, 0).getDate()}/{data.monthName.substring(0, 3)}/{data.year}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">
                      {Array.isArray(data.vouchers) ? data.vouchers.length : 0} voucher(s)
                    </p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                {(() => {
                  let runningBal = data.openingBalance;
                  const vouchersWithBal = (Array.isArray(data.vouchers) ? data.vouchers : []).map((v) => {
                    runningBal = runningBal + v.credit - v.debit;
                    return { ...v, runningBalance: runningBal };
                  });
                  const formatBal = (bal: number) =>
                    bal === 0
                      ? "—"
                      : `${formatAmount(Math.abs(bal))} ${bal >= 0 ? "Cr" : "Dr"}`;
                  return (
                    <div className="border rounded-lg overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/50">
                            <TableHead className="w-28">Date</TableHead>
                            <TableHead className="w-28 hidden sm:table-cell">Type</TableHead>
                            <TableHead>Particulars</TableHead>
                            <TableHead className="text-right w-32">Debit</TableHead>
                            <TableHead className="text-right w-32">Credit</TableHead>
                            <TableHead className="text-right w-36">Balance</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {/* Opening Balance Row */}
                          <TableRow className="bg-muted/20 font-semibold">
                            <TableCell className="text-sm text-muted-foreground" colSpan={3}>Opening Balance</TableCell>
                            <TableCell className="text-right font-mono text-sm text-muted-foreground">—</TableCell>
                            <TableCell className="text-right font-mono text-sm text-muted-foreground">—</TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              {formatBal(data.openingBalance)}
                            </TableCell>
                          </TableRow>
                          {data.vouchers.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={6} className="text-center py-8">
                                <p className="text-muted-foreground">No vouchers found for this period</p>
                              </TableCell>
                            </TableRow>
                          ) : (
                            vouchersWithBal.map((voucher) => (
                              <TableRow
                                key={voucher.id}
                                className="cursor-pointer hover-elevate"
                                onClick={() => handleVoucherClick(voucher.voucherId)}
                                data-testid={`row-voucher-${voucher.voucherId}`}
                              >
                                <TableCell className="font-mono text-sm whitespace-nowrap">
                                  {formatShortDate(voucher.date)}
                                </TableCell>
                                <TableCell className="hidden sm:table-cell">
                                  <Badge
                                    variant="secondary"
                                    className={`text-xs ${voucherTypeColors[voucher.voucherType] || ""}`}
                                  >
                                    {voucher.voucherType}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-sm">
                                  {voucher.particulars}
                                </TableCell>
                                <TableCell className="text-right font-mono text-sm">
                                  {voucher.debit > 0 ? formatAmount(voucher.debit) : <span className="text-muted-foreground">—</span>}
                                </TableCell>
                                <TableCell className="text-right font-mono text-sm">
                                  {voucher.credit > 0 ? formatAmount(voucher.credit) : <span className="text-muted-foreground">—</span>}
                                </TableCell>
                                <TableCell className="text-right font-mono text-sm">
                                  {formatBal(voucher.runningBalance)}
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                        <tfoot>
                          <TableRow className="border-t bg-muted/20 text-sm">
                            <TableCell colSpan={3} className="text-right text-muted-foreground font-medium">Opening Balance:</TableCell>
                            <TableCell className="text-right font-mono text-muted-foreground">—</TableCell>
                            <TableCell className="text-right font-mono text-muted-foreground">—</TableCell>
                            <TableCell className="text-right font-mono">{formatBal(data.openingBalance)}</TableCell>
                          </TableRow>
                          <TableRow className="bg-muted/10 text-sm">
                            <TableCell colSpan={3} className="text-right text-muted-foreground font-medium">Current Total:</TableCell>
                            <TableCell className="text-right font-mono font-semibold">{data.totals.debit > 0 ? formatAmount(data.totals.debit) : "—"}</TableCell>
                            <TableCell className="text-right font-mono font-semibold">{data.totals.credit > 0 ? formatAmount(data.totals.credit) : "—"}</TableCell>
                            <TableCell className="text-right font-mono text-muted-foreground">—</TableCell>
                          </TableRow>
                          <TableRow className="bg-muted/30 font-bold text-sm">
                            <TableCell colSpan={3} className="text-right text-muted-foreground font-semibold">Current Balance:</TableCell>
                            <TableCell className="text-right font-mono text-muted-foreground">—</TableCell>
                            <TableCell className="text-right font-mono text-muted-foreground">—</TableCell>
                            <TableCell className={`text-right font-mono ${data.closingBalance >= 0 ? "" : "text-destructive"}`}>
                              {formatBal(data.closingBalance)}
                            </TableCell>
                          </TableRow>
                        </tfoot>
                      </Table>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          </>
        ) : (
          <Card>
            <CardContent className="p-8 text-center">
              <p className="text-muted-foreground">No data available</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
