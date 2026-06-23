import {
  FileText,
  TrendingUp,
  TrendingDown,
  Scale,
  Trash2,
  Filter,
  History,
  MessageCircle,
  FileDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PeriodFilter } from "@/components/ui/period-filter";
import { AccountStatementViewProps } from "./accountTypes";
import { AccountTransactionRows } from "./AccountTransactionRows";

export function AccountStatementView({
  selectedAccount,
  periodFilter,
  setPeriodFilter,
  vouchersWithBalance,
  closingBalance,
  openingBalance,
  transactionsLoading,
  selectedVoucherIds,
  toggleSelectAll,
  setShowBulkDeleteConfirm,
  filterCurrency,
  setFilterCurrency,
  showDeletedVouchers,
  setShowDeletedVouchers,
  currentUser,
  formatAmount,
  hideBalances,
  printRef,
  appMode,
  formatDisplayDate,
  toggleVoucherSelection,
  handleOpenVoucher,
  waRule,
  openWaRuleDialog,
  sendWaStatementMutation,
  isMultiCurrency,
  ledgerCurrencyBalances,
  isBrokerSupplier,
  brokerStatementData,
  factorySupplierStatement,
  factoryStatementLoading,
  brokerStatementLoading,
  handlePrint,
  exportLang,
  setExportLang,
  exportLabels,
}: AccountStatementViewProps) {
  const isFactorySupplierAccount = selectedAccount?.type === "factorySupplier";

  if (isFactorySupplierAccount) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {isBrokerSupplier ? "Broker Consolidated Statement" : "Factory Supplier"}: {selectedAccount?.name}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {factoryStatementLoading || (isBrokerSupplier && brokerStatementLoading) ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : isBrokerSupplier && brokerStatementData ? (
            <div className="space-y-6">
              {brokerStatementData.currencyLedgers?.map((section: any) => {
                const typeLabel: Record<string, string> = {
                  container: "Container",
                  payment: "Payment",
                  fx_out: "FX Out",
                  fx_in: "FX In",
                  commission: "Commission",
                };
                const typeColor = (t: string) => {
                  if (t === "payment") return "text-green-600 dark:text-green-400";
                  if (t === "fx_out") return "text-amber-600 dark:text-amber-400";
                  if (t === "fx_in") return "text-blue-600 dark:text-blue-400";
                  if (t === "commission") return "text-destructive";
                  return "";
                };
                const fmt = (v: any) =>
                  parseFloat(String(v)).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  });
                const ccPfx = (cc: string) => (cc !== "USD" ? `${cc} ` : "$");
                return (
                  <div key={section.currencyCode} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-sm px-3 py-1 font-bold">
                        {section.currencyCode}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{section.totalContainers} container(s)</span>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead>Date</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead className="text-right">Balance</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {section.rows.map((row: any, idx: number) => (
                          <TableRow key={idx} className="text-xs">
                            <TableCell>{row.date ? formatDisplayDate(new Date(row.date)) : "-"}</TableCell>
                            <TableCell>
                              <Badge variant="outline">{typeLabel[row.type] || row.type}</Badge>
                            </TableCell>
                            <TableCell>{row.description}</TableCell>
                            <TableCell className={`text-right ${typeColor(row.type)}`}>
                              {ccPfx(section.currencyCode)}
                              {fmt(Math.abs(row.amount))}
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              {ccPfx(section.currencyCode)}
                              {fmt(Math.abs(row.runningBalance))}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                );
              })}
            </div>
          ) : factorySupplierStatement ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-md bg-muted/50">
                  <div className="text-xs text-muted-foreground">Containers</div>
                  <div className="text-lg font-bold">{factorySupplierStatement.summary?.totalContainers || 0}</div>
                </div>
                {/* More summary fields... */}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {factorySupplierStatement.ledger?.slice(0, 50).map((e: any, idx: number) => (
                    <TableRow key={idx}>
                      <TableCell>{e.date ? formatDisplayDate(new Date(e.date)) : "-"}</TableCell>
                      <TableCell>{e.type}</TableCell>
                      <TableCell className="text-right tabular-nums">{e.amount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2 flex-wrap">
        <CardTitle className="text-base">Ledger: {selectedAccount?.name}</CardTitle>
        <div className="flex items-center gap-2 flex-wrap">
          <PeriodFilter value={periodFilter} onChange={setPeriodFilter} />
          {selectedVoucherIds.size > 0 && (
            <Button variant="destructive" size="sm" onClick={() => setShowBulkDeleteConfirm(true)}>
              <Trash2 className="h-4 w-4 mr-1" /> Delete Selected ({selectedVoucherIds.size})
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <FileDown className="h-4 w-4 mr-1" /> Print
          </Button>
          {(appMode === "factory" || appMode === "erp") && (
            <Button variant="outline" size="sm" onClick={openWaRuleDialog}>
              <MessageCircle className="h-4 w-4 mr-1" /> WhatsApp
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {transactionsLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            {!hideBalances && vouchersWithBalance.length > 0 && (
              <div className="flex flex-wrap gap-3 mb-4">
                <div className="rounded-lg border bg-muted/40 px-4 py-2 flex items-center gap-3">
                  <TrendingUp className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground leading-none mb-0.5">Closing Balance</p>
                    <p className="text-base font-semibold leading-none tabular-nums">
                      {formatAmount(Math.abs(closingBalance))}
                    </p>
                  </div>
                </div>
              </div>
            )}
            <div ref={printRef}>
              <AccountTransactionRows
                vouchersWithBalance={vouchersWithBalance}
                selectedVoucherIds={selectedVoucherIds}
                toggleSelectAll={toggleSelectAll}
                toggleVoucherSelection={toggleVoucherSelection}
                handleOpenVoucher={handleOpenVoucher}
                formatAmount={formatAmount}
                hideBalances={hideBalances}
                appMode={appMode}
                openingBalance={openingBalance}
                selectedAccount={selectedAccount}
                formatDisplayDate={formatDisplayDate}
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
