import { useLocation, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  ArrowLeft,
  ChevronRight,
  Loader2,
  FileText,
} from "lucide-react";
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

function formatFullNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
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

export default function LedgerVouchers() {
  const [, navigate] = useLocation();
  const [, params] = useRoute("/ledger-vouchers/:accountId/:year/:month");
  
  const accountId = params?.accountId ? parseInt(params.accountId) : null;
  const year = params?.year ? parseInt(params.year) : null;
  const month = params?.month ? parseInt(params.month) : null;

  const { data, isLoading } = useQuery<LedgerVouchersData>({
    queryKey: ["/api/reports/ledger-vouchers", accountId, year, month],
    queryFn: async () => {
      const response = await fetch(
        `/api/reports/ledger-vouchers/${accountId}/${year}/${month}`,
        { credentials: "include" }
      );
      if (!response.ok) throw new Error("Failed to fetch ledger vouchers");
      return response.json();
    },
    enabled: !!accountId && !!year && !!month,
  });

  const handleVoucherClick = (voucherId: number) => {
    navigate(`/voucher-detail/${voucherId}`);
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
        <div className="flex items-center justify-between">
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
              <h1 className="text-xl font-bold" data-testid="text-account-name">
                {data?.account?.name || "Loading..."}
              </h1>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm opacity-80">
              {data?.monthName} {data?.year}
            </p>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-6">
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
                      {data.vouchers.length} voucher(s)
                    </p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="w-24">Date</TableHead>
                        <TableHead>Particulars</TableHead>
                        <TableHead className="w-32">Vch Type</TableHead>
                        <TableHead className="text-right w-32">Debit</TableHead>
                        <TableHead className="text-right w-32">Credit</TableHead>
                        <TableHead className="w-8"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.vouchers.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-8">
                            <p className="text-muted-foreground">
                              No vouchers found for this period
                            </p>
                          </TableCell>
                        </TableRow>
                      ) : (
                        <>
                          {data.vouchers.map((voucher) => (
                            <TableRow
                              key={voucher.id}
                              className="cursor-pointer hover-elevate"
                              onClick={() => handleVoucherClick(voucher.voucherId)}
                              data-testid={`row-voucher-${voucher.voucherId}`}
                            >
                              <TableCell className="font-mono text-sm">
                                {format(parseISO(voucher.date), "d/MMM/yy")}
                              </TableCell>
                              <TableCell className="font-medium">
                                {voucher.particulars}
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant="secondary"
                                  className={`text-xs ${
                                    voucherTypeColors[voucher.voucherType] || ""
                                  }`}
                                >
                                  {voucher.voucherType}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {voucher.debit > 0
                                  ? formatFullNumber(voucher.debit)
                                  : ""}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {voucher.credit > 0
                                  ? formatFullNumber(voucher.credit)
                                  : ""}
                              </TableCell>
                              <TableCell>
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              </TableCell>
                            </TableRow>
                          ))}

                          {/* Totals Row */}
                          <TableRow className="bg-primary/10 font-bold border-t-2">
                            <TableCell colSpan={3}></TableCell>
                            <TableCell className="text-right font-mono">
                              {formatFullNumber(data.totals.debit)}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatFullNumber(data.totals.credit)}
                            </TableCell>
                            <TableCell></TableCell>
                          </TableRow>
                        </>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* Summary Cards */}
            <div className="grid grid-cols-3 gap-4">
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-sm text-muted-foreground">Opening Balance</p>
                  <p className="text-lg font-bold font-mono">
                    {formatFullNumber(Math.abs(data.openingBalance))}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-sm text-muted-foreground">Current Total</p>
                  <p className="text-lg font-bold font-mono">
                    {formatFullNumber(data.totals.debit - data.totals.credit)}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-sm text-muted-foreground">Closing Balance</p>
                  <p
                    className={`text-lg font-bold font-mono ${
                      data.closingBalance >= 0
                        ? "text-green-600"
                        : "text-red-600"
                    }`}
                  >
                    {formatFullNumber(Math.abs(data.closingBalance))}
                  </p>
                </CardContent>
              </Card>
            </div>
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
