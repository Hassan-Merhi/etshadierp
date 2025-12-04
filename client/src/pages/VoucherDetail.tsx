import { useLocation, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  ArrowLeft,
  FileText,
  Calendar,
  Hash,
  User,
  Building,
  Package,
  DollarSign,
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
import { Separator } from "@/components/ui/separator";

interface VoucherItem {
  id: number;
  stockItemId: number | null;
  stockItemName: string;
  stockItemCode: string;
  quantity: number;
  unit: string;
  rate: number;
  amount: number;
}

interface VoucherEntry {
  id: number;
  ledgerAccountId: number;
  ledgerAccountName: string;
  debitAmount: number;
  creditAmount: number;
  narration: string | null;
}

interface VoucherDetailData {
  id: number;
  voucherNumber: string;
  voucherType: string;
  date: string;
  partyName: string | null;
  purchaseLedger: string | null;
  locationName: string | null;
  narration: string | null;
  supplierInvoiceNo: string | null;
  
  items: VoucherItem[];
  entries: VoucherEntry[];
  
  totals: {
    quantity: number;
    amount: number;
    debit: number;
    credit: number;
  };
}

function formatFullNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

const voucherTypeColors: Record<string, string> = {
  Payment: "bg-red-500",
  Receipt: "bg-green-500",
  Journal: "bg-blue-500",
  "Stock Transfer": "bg-purple-500",
  Production: "bg-orange-500",
  Consumption: "bg-yellow-500",
  "Purchase Import": "bg-indigo-500",
};

export default function VoucherDetail() {
  const [, navigate] = useLocation();
  const [, params] = useRoute("/voucher-detail/:voucherId");
  
  const voucherId = params?.voucherId ? parseInt(params.voucherId) : null;

  const { data, isLoading } = useQuery<VoucherDetailData>({
    queryKey: ["/api/voucher-detail", voucherId],
    queryFn: async () => {
      const response = await fetch(
        `/api/voucher-detail/${voucherId}`,
        { credentials: "include" }
      );
      if (!response.ok) throw new Error("Failed to fetch voucher detail");
      return response.json();
    },
    enabled: !!voucherId,
  });

  if (!voucherId) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Invalid voucher ID</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div
        className={`${
          voucherTypeColors[data?.voucherType || ""] || "bg-primary"
        } text-white p-4`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => window.history.back()}
              className="text-white hover:bg-white/20"
              data-testid="button-back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <p className="text-sm opacity-80">
                Accounting Voucher Alteration (Secondary)
              </p>
              <h1 className="text-xl font-bold flex items-center gap-2">
                <Badge
                  variant="outline"
                  className="bg-white/20 text-white border-white/40"
                >
                  {data?.voucherType || "Voucher"}
                </Badge>
                <span>No. {data?.voucherNumber || ""}</span>
              </h1>
            </div>
          </div>
          <div className="text-right">
            {data?.date && (
              <p className="text-lg font-medium">
                {format(parseISO(data.date), "d/MMM/yy")}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="p-4 space-y-6">
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-[300px] w-full" />
          </div>
        ) : data ? (
          <>
            {/* Voucher Info */}
            <Card>
              <CardContent className="p-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  {data.supplierInvoiceNo && (
                    <div className="flex items-center gap-2">
                      <Hash className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        Supplier Invoice No.:
                      </span>
                      <span className="font-medium">{data.supplierInvoiceNo}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Date:</span>
                    <span className="font-medium">
                      {format(parseISO(data.date), "d/MMM/yy")}
                    </span>
                  </div>
                </div>

                {data.partyName && (
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      Party A/c name:
                    </span>
                    <span className="font-medium text-primary">
                      {data.partyName}
                    </span>
                  </div>
                )}

                {data.purchaseLedger && (
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      Purchase ledger:
                    </span>
                    <span className="font-medium">{data.purchaseLedger}</span>
                  </div>
                )}

                {data.locationName && (
                  <div className="flex items-center gap-2">
                    <Building className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      Repl existing Godown with:
                    </span>
                    <span className="font-medium text-blue-600">
                      {data.locationName}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Items Table (for Purchase/Sales vouchers) */}
            {data.items.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Package className="h-4 w-4" />
                    Name of Item
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead>Name of Item</TableHead>
                          <TableHead className="text-right w-24">
                            Quantity
                          </TableHead>
                          <TableHead className="text-right w-24">Rate</TableHead>
                          <TableHead className="text-center w-16">per</TableHead>
                          <TableHead className="text-right w-28">Amount</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.items.map((item, index) => (
                          <TableRow
                            key={item.id || index}
                            data-testid={`row-item-${index}`}
                          >
                            <TableCell className="font-medium">
                              {item.stockItemName}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {item.quantity.toFixed(2)} {item.unit}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatFullNumber(item.rate)}
                            </TableCell>
                            <TableCell className="text-center text-sm text-muted-foreground">
                              {item.unit}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatFullNumber(item.amount)}
                            </TableCell>
                          </TableRow>
                        ))}

                        {/* Totals */}
                        <TableRow className="bg-primary/10 font-bold border-t-2">
                          <TableCell></TableCell>
                          <TableCell className="text-right font-mono">
                            {data.totals.quantity.toFixed(2)} {data.items[0]?.unit || ""}
                          </TableCell>
                          <TableCell></TableCell>
                          <TableCell></TableCell>
                          <TableCell className="text-right font-mono">
                            {formatFullNumber(data.totals.amount)}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Ledger Entries Table (for Journal/Payment/Receipt vouchers) */}
            {data.entries.length > 0 && data.items.length === 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Ledger Entries
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead>Account Name</TableHead>
                          <TableHead className="text-right w-32">Debit</TableHead>
                          <TableHead className="text-right w-32">Credit</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.entries.map((entry, index) => (
                          <TableRow key={entry.id || index}>
                            <TableCell className="font-medium">
                              {entry.ledgerAccountName}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {entry.debitAmount > 0
                                ? formatFullNumber(entry.debitAmount)
                                : ""}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {entry.creditAmount > 0
                                ? formatFullNumber(entry.creditAmount)
                                : ""}
                            </TableCell>
                          </TableRow>
                        ))}

                        {/* Totals */}
                        <TableRow className="bg-primary/10 font-bold border-t-2">
                          <TableCell>Total</TableCell>
                          <TableCell className="text-right font-mono">
                            {formatFullNumber(data.totals.debit)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatFullNumber(data.totals.credit)}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Narration */}
            {data.narration && (
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground mb-1">Narration:</p>
                  <p className="text-sm">{data.narration}</p>
                </CardContent>
              </Card>
            )}
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
