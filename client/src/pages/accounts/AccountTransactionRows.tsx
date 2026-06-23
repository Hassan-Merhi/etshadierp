import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatAmount } from "@/lib/formatNumber";

export interface AccountTransactionRowsProps {
  vouchersWithBalance: any[];
  selectedVoucherIds: Set<number>;
  toggleSelectAll: () => void;
  toggleVoucherSelection: (id: number) => void;
  handleOpenVoucher: (v: any) => void;
  formatAmount: (amt: number) => string;
  hideBalances: boolean;
  appMode: string;
  openingBalance: number;
  selectedAccount: any;
  formatDisplayDate: (date: Date | string) => string;
}

export function AccountTransactionRows({
  vouchersWithBalance,
  selectedVoucherIds,
  toggleSelectAll,
  toggleVoucherSelection,
  handleOpenVoucher,
  formatAmount: formatAmountProp,
  hideBalances,
  appMode,
  openingBalance,
  selectedAccount,
  formatDisplayDate,
}: AccountTransactionRowsProps) {
  return (
    <div className="rounded-xl border overflow-hidden table-responsive print:border-0 hidden md:block print:!block">
      <Table>
        <TableHeader className="sticky top-0 z-30 bg-background">
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead className="w-[40px] py-2 print:hidden">
              <Checkbox
                checked={vouchersWithBalance.length > 0 && selectedVoucherIds.size === vouchersWithBalance.length}
                onCheckedChange={toggleSelectAll}
                data-testid="checkbox-select-all"
              />
            </TableHead>
            <TableHead className="col-date w-[100px] py-2 sticky left-0 bg-muted z-10">Date</TableHead>
            <TableHead className="col-type w-[100px] py-2">Type</TableHead>
            <TableHead className="col-particulars py-2">Particulars</TableHead>
            {appMode === "factory" && <TableHead className="py-2">Notes</TableHead>}
            {!hideBalances && <TableHead className="col-amount text-right w-[120px] py-2">Debit</TableHead>}
            {!hideBalances && <TableHead className="col-amount text-right w-[120px] py-2">Credit</TableHead>}
            {!hideBalances && <TableHead className="col-balance text-right w-[130px] py-2">Balance</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {/* Opening Balance Row */}
          <TableRow className="bg-accent/30 border-b-2" data-testid="row-opening-balance">
            <TableCell className="py-2 print:hidden"></TableCell>
            <TableCell className="font-mono text-sm py-2" colSpan={appMode === "factory" ? 4 : 3}>
              <span className="font-semibold">Opening Balance</span>
            </TableCell>
            <TableCell className="text-right font-mono py-2">
              {!hideBalances &&
                (selectedAccount?.type === "supplier"
                  ? openingBalance < 0
                    ? formatAmountProp(Math.abs(openingBalance))
                    : "-"
                  : openingBalance > 0
                    ? formatAmountProp(openingBalance)
                    : "-")}
            </TableCell>
            <TableCell className="text-right font-mono py-2">
              {!hideBalances &&
                (selectedAccount?.type === "supplier"
                  ? openingBalance > 0
                    ? formatAmountProp(openingBalance)
                    : "-"
                  : openingBalance < 0
                    ? formatAmountProp(Math.abs(openingBalance))
                    : "-")}
            </TableCell>
            <TableCell className="text-right font-mono font-semibold py-2">
              {!hideBalances && (
                <>
                  {formatAmountProp(Math.abs(openingBalance))}
                  <span className="ml-1 text-[10px] opacity-70">
                    {selectedAccount?.type === "supplier"
                      ? openingBalance > 0
                        ? "Cr"
                        : "Dr"
                      : openingBalance >= 0
                        ? "Dr"
                        : "Cr"}
                  </span>
                </>
              )}
            </TableCell>
          </TableRow>

          {vouchersWithBalance.map((v) => (
            <TableRow
              key={v.voucherId}
              className="group hover:bg-muted/30 cursor-pointer"
              onClick={() => handleOpenVoucher(v)}
              data-testid={`row-voucher-${v.voucherId}`}
            >
              <TableCell className="py-2 print:hidden" onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  checked={selectedVoucherIds.has(v.voucherId)}
                  onCheckedChange={() => toggleVoucherSelection(v.voucherId)}
                />
              </TableCell>
              <TableCell className="py-2 font-mono text-[11px] tabular-nums sticky left-0 bg-background group-hover:bg-muted/30">
                {formatDisplayDate(v.voucherDate)}
              </TableCell>
              <TableCell className="py-2">
                <Badge variant="secondary" className="text-[10px] py-0 px-1 font-semibold">
                  {v.voucherType}
                </Badge>
              </TableCell>
              <TableCell className="py-2 text-[11px] max-w-[420px] truncate">
                <div className="font-semibold text-foreground">{v.voucherNumber}</div>
                <div className="text-muted-foreground truncate">{v.voucherDescription || v.narration}</div>
              </TableCell>
              {appMode === "factory" && (
                <TableCell className="py-2 text-[10px] text-muted-foreground max-w-[280px] truncate">
                  {v.narration}
                </TableCell>
              )}
              {!hideBalances && (
                <TableCell className="py-2 text-right font-mono text-[11px] tabular-nums">
                  {v.totalDebit > 0 ? formatAmountProp(v.totalDebit) : "—"}
                </TableCell>
              )}
              {!hideBalances && (
                <TableCell className="py-2 text-right font-mono text-[11px] tabular-nums">
                  {v.totalCredit > 0 ? formatAmountProp(v.totalCredit) : "—"}
                </TableCell>
              )}
              {!hideBalances && (
                <TableCell className="py-2 text-right font-mono text-[11px] tabular-nums font-semibold">
                  {v.runningBalance != null ? (
                    <>
                      {formatAmountProp(Math.abs(v.runningBalance))}
                      <span className="ml-1 text-[10px] opacity-70">{v.runningBalance >= 0 ? "Dr" : "Cr"}</span>
                    </>
                  ) : (
                    "—"
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
