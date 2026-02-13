import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Filter, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/formatNumber";

interface DaybookEntry {
  id: number;
  companyId: number;
  txDate: string;
  txType: string;
  referenceId: number | null;
  description: string;
  currencyCode: string;
  amountCurrency: string;
  fxRateToUsd: string;
  amountUsd: string;
  createdAt: string;
  createdBy: number | null;
}

const TX_TYPE_LABELS: Record<string, string> = {
  CONTAINER_IMPORT: "Container Import",
  OFFLOAD_RAW_STOCK: "Offload Raw Stock",
  COMMISSION: "Commission",
  BALE_PRESSING: "Bale Pressing",
  BALE_FINALIZE: "Bale Finalize",
  INVOICE: "Invoice",
  PAYMENT: "Payment",
};

const TX_TYPE_COLORS: Record<string, string> = {
  CONTAINER_IMPORT: "default",
  OFFLOAD_RAW_STOCK: "secondary",
  COMMISSION: "outline",
  BALE_PRESSING: "secondary",
  BALE_FINALIZE: "default",
  INVOICE: "default",
  PAYMENT: "secondary",
};

export default function FactoryDaybook() {
  const today = new Date().toISOString().split("T")[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const [startDate, setStartDate] = useState(thirtyDaysAgo);
  const [endDate, setEndDate] = useState(today);
  const [txTypeFilter, setTxTypeFilter] = useState("ALL");
  const [currencyFilter, setCurrencyFilter] = useState("ALL");

  const queryParams = new URLSearchParams();
  if (startDate) queryParams.set("startDate", startDate);
  if (endDate) queryParams.set("endDate", endDate);
  if (txTypeFilter !== "ALL") queryParams.set("txType", txTypeFilter);
  if (currencyFilter !== "ALL") queryParams.set("currencyCode", currencyFilter);

  const { data: entries = [], isLoading } = useQuery<DaybookEntry[]>({
    queryKey: ["/api/factory/daybook", startDate, endDate, txTypeFilter, currencyFilter],
    queryFn: async () => {
      const res = await fetch(`/api/factory/daybook?${queryParams.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch daybook");
      return res.json();
    },
  });

  const totalUsd = useMemo(
    () => entries.reduce((sum, e) => sum + parseFloat(e.amountUsd || "0"), 0),
    [entries]
  );

  const uniqueCurrencies = useMemo(
    () => Array.from(new Set(entries.map((e) => e.currencyCode))).sort(),
    [entries]
  );

  const txTypeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    entries.forEach((e) => {
      counts[e.txType] = (counts[e.txType] || 0) + 1;
    });
    return counts;
  }, [entries]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-title">Factory Daybook</h1>
          <p className="text-muted-foreground mt-1">All factory transactions in one view</p>
        </div>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="flex items-end gap-4 flex-wrap">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">From</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-40"
                data-testid="input-start-date"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">To</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-40"
                data-testid="input-end-date"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Type</Label>
              <Select value={txTypeFilter} onValueChange={setTxTypeFilter}>
                <SelectTrigger className="w-48" data-testid="select-tx-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Types</SelectItem>
                  <SelectItem value="CONTAINER_IMPORT">Container Import</SelectItem>
                  <SelectItem value="OFFLOAD_RAW_STOCK">Offload Raw Stock</SelectItem>
                  <SelectItem value="COMMISSION">Commission</SelectItem>
                  <SelectItem value="BALE_PRESSING">Bale Pressing</SelectItem>
                  <SelectItem value="BALE_FINALIZE">Bale Finalize</SelectItem>
                  <SelectItem value="INVOICE">Invoice</SelectItem>
                  <SelectItem value="PAYMENT">Payment</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Currency</Label>
              <Select value={currencyFilter} onValueChange={setCurrencyFilter}>
                <SelectTrigger className="w-32" data-testid="select-currency-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                  <SelectItem value="AUD">AUD</SelectItem>
                  <SelectItem value="LBP">LBP</SelectItem>
                  <SelectItem value="GBP">GBP</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Total Entries</p>
            <p className="text-2xl font-bold font-mono" data-testid="text-total-entries">{entries.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Total (USD)</p>
            <p className="text-2xl font-bold font-mono" data-testid="text-total-usd">${formatNumber(totalUsd)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Currencies</p>
            <div className="flex gap-1 mt-1 flex-wrap">
              {uniqueCurrencies.length > 0 ? uniqueCurrencies.map((c) => (
                <Badge key={c} variant="secondary">{c}</Badge>
              )) : <span className="text-muted-foreground text-sm">-</span>}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Types</p>
            <div className="flex gap-1 mt-1 flex-wrap">
              {Object.entries(txTypeCounts).map(([type, count]) => (
                <Badge key={type} variant="outline" className="text-xs">
                  {TX_TYPE_LABELS[type] || type}: {count}
                </Badge>
              ))}
              {Object.keys(txTypeCounts).length === 0 && (
                <span className="text-muted-foreground text-sm">-</span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Transactions
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : entries.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Currency</TableHead>
                    <TableHead className="text-right">Amount (Currency)</TableHead>
                    <TableHead className="text-right">FX Rate</TableHead>
                    <TableHead className="text-right">Amount (USD)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => (
                    <TableRow key={entry.id} data-testid={`row-daybook-${entry.id}`}>
                      <TableCell className="font-mono text-sm whitespace-nowrap">
                        {new Date(entry.txDate + "T00:00:00").toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <Badge variant={(TX_TYPE_COLORS[entry.txType] as any) || "outline"}>
                          {TX_TYPE_LABELS[entry.txType] || entry.txType}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-xs truncate" title={entry.description}>
                        {entry.description}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{entry.currencyCode}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatNumber(parseFloat(entry.amountCurrency || "0"))}
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">
                        {entry.currencyCode === "USD" ? "-" : parseFloat(entry.fxRateToUsd).toFixed(4)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        ${formatNumber(parseFloat(entry.amountUsd || "0"))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-12">
              <BookOpen className="mx-auto h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold">No transactions found</h3>
              <p className="text-muted-foreground mt-2">
                Factory transactions will appear here as you perform operations
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
