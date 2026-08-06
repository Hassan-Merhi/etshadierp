from pathlib import Path

# Daybook query contract
path = Path("client/src/pages/Daybook.tsx")
text = path.read_text()
old = '''  const { data: voucherRevisions = [], isLoading: revisionsLoading } = useQuery<any[]>({
    queryKey:
      selectedVoucher && isStockTransferVoucher && viewDialogOpen
        ? companyDataKey(
            `/api/stock-transfers/by-voucher/${selectedVoucher.id}/revisions`,
            selectedCompany?.id,
            "daybook-transfer-revisions",
          )
        : [],
    enabled: !!selectedVoucher && isStockTransferVoucher && viewDialogOpen,
  });'''
new = '''  const {
    data: voucherRevisions = [],
    isLoading: revisionsLoading,
    isError: revisionsError,
    error: revisionsErrorDetail,
    refetch: retryVoucherRevisions,
  } = useQuery<any[]>({
    queryKey:
      selectedVoucher && isStockTransferVoucher && viewDialogOpen
        ? companyDataKey(
            `/api/stock-transfers/by-voucher/${selectedVoucher.id}/revisions`,
            selectedCompany?.id,
            "daybook-transfer-revisions",
          )
        : [],
    queryFn: async () => {
      const response = await apiRequest(
        "GET",
        `/api/stock-transfers/by-voucher/${selectedVoucher!.id}/revisions`,
      );
      if (!response.ok) throw new Error("Could not load revision history");
      const data = await response.json();
      return Array.isArray(data) ? data : data?.revisions ?? [];
    },
    enabled: !!selectedVoucher && isStockTransferVoucher && viewDialogOpen,
    retry: 1,
  });'''
if old not in text:
    raise SystemExit("Daybook revision query block not found")
text = text.replace(old, new, 1)
old_props = '''        voucherRevisions={voucherRevisions}
        revisionsLoading={revisionsLoading}'''
new_props = '''        voucherRevisions={voucherRevisions}
        revisionsLoading={revisionsLoading}
        revisionsError={revisionsError}
        revisionsErrorMessage={revisionsErrorDetail instanceof Error ? revisionsErrorDetail.message : undefined}
        retryVoucherRevisions={() => void retryVoucherRevisions()}'''
if old_props not in text:
    raise SystemExit("VoucherDetailsDialog revision props not found")
text = text.replace(old_props, new_props, 1)
path.write_text(text)

# Props
path = Path("client/src/pages/daybook/voucherdetailsdialog/types.ts")
text = path.read_text()
old = '''  voucherRevisions: any[];
  revisionsLoading: boolean;'''
new = '''  voucherRevisions: any[];
  revisionsLoading: boolean;
  revisionsError: boolean;
  revisionsErrorMessage?: string;
  retryVoucherRevisions: () => void;'''
if old not in text:
    raise SystemExit("Revision props type block not found")
path.write_text(text.replace(old, new, 1))

# Dialog rendering
path = Path("client/src/pages/daybook/VoucherDetailsDialog.tsx")
text = path.read_text()
old = '''  voucherRevisions,
  revisionsLoading,
  formatAmount,'''
new = '''  voucherRevisions,
  revisionsLoading,
  revisionsError,
  revisionsErrorMessage,
  retryVoucherRevisions,
  formatAmount,'''
if old not in text:
    raise SystemExit("Dialog destructuring block not found")
text = text.replace(old, new, 1)
start_marker = '''            {isStockTransferVoucher && (revisionsLoading || voucherRevisions.length > 0) && ('''
start = text.find(start_marker)
if start < 0:
    raise SystemExit("Revision history render block start not found")
end_marker = '''            )}
          </div>
        </div>'''
end = text.find(end_marker, start)
if end < 0:
    raise SystemExit("Revision history render block end not found")
replacement = '''            {isStockTransferVoucher && (
              <div className="space-y-4" data-testid="stock-transfer-revision-history">
                <h3 className="font-semibold text-lg">Revision History</h3>
                {revisionsLoading ? (
                  <div className="space-y-2" role="status" aria-live="polite">
                    <p className="text-sm text-muted-foreground">Loading revision history…</p>
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                  </div>
                ) : revisionsError ? (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 space-y-3">
                    <p className="text-sm font-medium">Could not load revision history</p>
                    {revisionsErrorMessage && (
                      <p className="text-xs text-muted-foreground">{revisionsErrorMessage}</p>
                    )}
                    <Button type="button" variant="outline" size="sm" onClick={retryVoucherRevisions}>
                      Retry
                    </Button>
                  </div>
                ) : voucherRevisions.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-6 text-center">
                    <p className="text-sm text-muted-foreground">No revisions recorded for this transfer</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {voucherRevisions.map((rev) => (
                      <div key={rev.id} className="border rounded-md p-3 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">Rev #{rev.revisionNumber}</span>
                            {rev.optional && (
                              <Badge variant="outline" className="text-xs">
                                POS Adjustment{rev._mergedCount > 1 ? ` (${rev._mergedCount} submissions)` : ""}
                              </Badge>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {rev.createdAt ? new Date(rev.createdAt).toLocaleString() : ""}
                          </span>
                        </div>
                        {rev.note && <p className="text-sm text-muted-foreground">{rev.note}</p>}
                        {rev.items && rev.items.length > 0 && (
                          <div className="border rounded-md overflow-hidden">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="text-xs py-2">Item</TableHead>
                                  <TableHead className="text-right text-xs py-2">Was</TableHead>
                                  <TableHead className="text-right text-xs py-2">Now</TableHead>
                                  <TableHead className="text-right text-xs py-2">Change</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {rev.items
                                  .filter((item: any) => parseFloat(item.delta ?? "0") !== 0)
                                  .map((item: any, idx: number) => {
                                    const delta = parseFloat(item.delta ?? "0");
                                    return (
                                      <TableRow key={idx}>
                                        <TableCell className="py-1.5 text-sm">{item.stockItemName}</TableCell>
                                        <TableCell className="py-1.5 text-right font-mono text-sm text-muted-foreground">
                                          {parseFloat(item.originalQuantity)}
                                        </TableCell>
                                        <TableCell className="py-1.5 text-right font-mono text-sm font-semibold">
                                          {parseFloat(item.newQuantity)}
                                        </TableCell>
                                        <TableCell
                                          className={`py-1.5 text-right font-mono text-sm font-semibold ${delta > 0 ? "text-green-600 dark:text-green-400" : delta < 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}
                                        >
                                          {delta > 0 ? "+" : ""}
                                          {delta}
                                        </TableCell>
                                      </TableRow>
                                    );
                                  })}
                              </TableBody>
                            </Table>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
'''
text = text[:start] + replacement + text[end + len('            )}\n'):]
path.write_text(text)
