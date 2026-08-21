import { Fragment } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronDown, ChevronRight } from "lucide-react";
import { formatNumber } from "@/lib/formatNumber";
import { Skeleton } from "@/components/ui/skeleton";

import { formatNumericValue, profitColor } from "./salesreportdetail/utils";
import { useSalesReportDetailModel } from "./salesreportdetail/useSalesReportDetailModel";
import { SalesReportDetailHeader } from "./salesreportdetail/components/SalesReportDetailHeader";
import { SalesReportSummaryCards } from "./salesreportdetail/components/SalesReportSummaryCards";
import { SalesReportItemMobileView } from "./salesreportdetail/components/SalesReportItemMobileView";
export default function SalesReportDetail() {
  const {
    handleBack,
    formatAmount,
    plFilter,
    setPlFilter,
    plBasis,
    setPlBasis,
    expandedItems,
    setExpandedItems,
    expandedLocations,
    setExpandedLocations,
    viewMode,
    setViewMode,
    expandedVouchers,
    setExpandedVouchers,
    ITEM_COLUMNS,
    hiddenColumns,
    setHiddenColumns,
    col,
    toggleColumn,
    displayDate,
    grouping,
    allCompanies: _allCompanies,
    isCreditSaleParam,
    searchTerm,
    items,
    isLoading,
    filteredItems: _filteredItems,
    itemGroups,
    locationColorMap,
    multipleLocations,
    toggleItem,
    toggleLocation,
    creditCustomerLabel,
    totalQty,
    totalSales,
    totalCost,
    totalConfiguredCost,
    costProfit,
    configuredProfit,
    voucherGroups,
    toggleVoucher,
  } = useSalesReportDetailModel();

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-6 w-full min-w-0">
      <SalesReportDetailHeader
        handleBack={handleBack}
        displayDate={displayDate}
        isCreditSaleParam={isCreditSaleParam}
        creditCustomerLabel={creditCustomerLabel}
        grouping={grouping}
        searchTerm={searchTerm}
        plFilter={plFilter}
        setPlFilter={setPlFilter}
        viewMode={viewMode}
        setViewMode={setViewMode}
        voucherGroups={voucherGroups}
        expandedVouchers={expandedVouchers}
        setExpandedVouchers={setExpandedVouchers}
        itemGroups={itemGroups}
        expandedItems={expandedItems}
        setExpandedItems={setExpandedItems}
        setExpandedLocations={setExpandedLocations}
        hiddenColumns={hiddenColumns}
        setHiddenColumns={setHiddenColumns}
        ITEM_COLUMNS={ITEM_COLUMNS}
        toggleColumn={toggleColumn}
        plBasis={plBasis}
        setPlBasis={setPlBasis}
      />

      {isLoading ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
          <Skeleton className="h-64" />
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No sales data found for this period.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <SalesReportSummaryCards
            totalQty={totalQty}
            totalSales={totalSales}
            totalCost={totalCost}
            costProfit={costProfit}
            totalConfiguredCost={totalConfiguredCost}
            configuredProfit={configuredProfit}
            formatAmount={formatAmount}
          />

          {/* By-Sale table */}
          {viewMode === "bySale" && (
            <Card>
              <CardContent className="p-0">
                <div className="hidden md:block">
                  <Table wrapperClassName="max-h-[calc(100vh-320px)]">
                    <TableHeader className="sticky top-0 z-30 bg-background">
                      <TableRow>
                        <TableHead className="w-6"></TableHead>
                        <TableHead>Location</TableHead>
                        {col("qty") && <TableHead className="text-right">Qty</TableHead>}
                        {col("costPrice") && <TableHead className="text-right">Cost Price</TableHead>}
                        {col("hassanPrice") && <TableHead className="text-right">Hassan's Price</TableHead>}
                        {col("pricePerBale") && <TableHead className="text-right">Price / Bale</TableHead>}
                        <TableHead className="text-right">Total Sales</TableHead>
                        {col("costProfitBale") && <TableHead className="text-right">Cost Profit / Bale</TableHead>}
                        {col("hassanProfitBale") && (
                          <TableHead className="text-right">Hassan's Profit / Bale</TableHead>
                        )}
                        {col("costProfitTotal") && <TableHead className="text-right">Cost Profit</TableHead>}
                        {col("hassanProfitTotal") && <TableHead className="text-right">Hassan's Profit</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {voucherGroups.map((vg) => {
                        const isExpanded = expandedVouchers.has(vg.voucherId);
                        const groupPricePerBale = vg.totalQty > 0 ? vg.totalSales / vg.totalQty : 0;
                        const groupCostProfitBale = vg.totalQty > 0 ? vg.costProfit / vg.totalQty : 0;
                        const groupHassanProfitBale = vg.totalQty > 0 ? vg.configuredProfit / vg.totalQty : 0;
                        return (
                          <Fragment key={vg.voucherId}>
                            <TableRow
                              key={`vr-${vg.voucherId}`}
                              data-testid={`row-voucher-${vg.voucherId}`}
                              className="cursor-pointer bg-muted/30 hover-elevate font-medium"
                              onClick={() => toggleVoucher(vg.voucherId)}
                            >
                              <TableCell className="py-2 pr-0 w-6">
                                {isExpanded ? (
                                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                )}
                              </TableCell>
                              <TableCell className="py-2 text-sm text-muted-foreground">{vg.locationName}</TableCell>
                              {col("qty") && (
                                <TableCell className="text-right font-mono py-2">{formatNumber(vg.totalQty)}</TableCell>
                              )}
                              {col("costPrice") && (
                                <TableCell className="text-right font-mono py-2 text-muted-foreground">—</TableCell>
                              )}
                              {col("hassanPrice") && (
                                <TableCell className="text-right font-mono py-2 text-muted-foreground">—</TableCell>
                              )}
                              {col("pricePerBale") && (
                                <TableCell className="text-right font-mono py-2 text-muted-foreground">
                                  {formatAmount(groupPricePerBale)}
                                </TableCell>
                              )}
                              <TableCell className="text-right font-mono py-2">{formatAmount(vg.totalSales)}</TableCell>
                              {col("costProfitBale") && (
                                <TableCell className={`text-right font-mono py-2 ${profitColor(groupCostProfitBale)}`}>
                                  {formatAmount(Math.abs(groupCostProfitBale))}
                                </TableCell>
                              )}
                              {col("hassanProfitBale") && (
                                <TableCell
                                  className={`text-right font-mono py-2 ${profitColor(groupHassanProfitBale)}`}
                                >
                                  {formatAmount(Math.abs(groupHassanProfitBale))}
                                </TableCell>
                              )}
                              {col("costProfitTotal") && (
                                <TableCell className={`text-right font-mono py-2 ${profitColor(vg.costProfit)}`}>
                                  {formatAmount(Math.abs(vg.costProfit))}
                                </TableCell>
                              )}
                              {col("hassanProfitTotal") && (
                                <TableCell className={`text-right font-mono py-2 ${profitColor(vg.configuredProfit)}`}>
                                  {formatAmount(Math.abs(vg.configuredProfit))}
                                </TableCell>
                              )}
                            </TableRow>
                            {isExpanded &&
                              vg.items.map((item) => {
                                const qty = parseFloat(item.quantity) || 0;
                                const itemSales = parseFloat(String(item.totalSales)) || 0;
                                const pricePerBale = qty > 0 ? itemSales / qty : 0;
                                const itemCostProfit = parseFloat(item.costProfit) || 0;
                                const itemCostProfitBale = qty > 0 ? itemCostProfit / qty : 0;
                                const itemHassanProfitBale = qty > 0 ? item.configuredProfit / qty : 0;
                                return (
                                  <TableRow
                                    key={item.id}
                                    data-testid={`row-vitem-${item.id}`}
                                    className="text-xs bg-muted/10"
                                  >
                                    <TableCell className="py-1 w-6"></TableCell>
                                    <TableCell className="py-1 pl-6 text-muted-foreground">
                                      {item.stockItemName}
                                    </TableCell>
                                    {col("qty") && (
                                      <TableCell className="text-right font-mono py-1">
                                        {formatNumericValue(item.quantity)}
                                      </TableCell>
                                    )}
                                    {col("costPrice") && (
                                      <TableCell className="text-right font-mono py-1">
                                        {formatAmount(item.costPrice)}
                                      </TableCell>
                                    )}
                                    {col("hassanPrice") && (
                                      <TableCell className="text-right font-mono py-1">
                                        {formatAmount(item.configuredSellingPrice)}
                                      </TableCell>
                                    )}
                                    {col("pricePerBale") && (
                                      <TableCell className="text-right font-mono py-1">
                                        {formatAmount(pricePerBale)}
                                      </TableCell>
                                    )}
                                    <TableCell className="text-right font-mono py-1">
                                      {formatAmount(item.totalSales)}
                                    </TableCell>
                                    {col("costProfitBale") && (
                                      <TableCell
                                        className={`text-right font-mono py-1 ${profitColor(itemCostProfitBale)}`}
                                      >
                                        {formatAmount(Math.abs(itemCostProfitBale))}
                                      </TableCell>
                                    )}
                                    {col("hassanProfitBale") && (
                                      <TableCell
                                        className={`text-right font-mono py-1 ${profitColor(itemHassanProfitBale)}`}
                                      >
                                        {formatAmount(Math.abs(itemHassanProfitBale))}
                                      </TableCell>
                                    )}
                                    {col("costProfitTotal") && (
                                      <TableCell className={`text-right font-mono py-1 ${profitColor(itemCostProfit)}`}>
                                        {formatAmount(Math.abs(itemCostProfit))}
                                      </TableCell>
                                    )}
                                    {col("hassanProfitTotal") && (
                                      <TableCell
                                        className={`text-right font-mono py-1 ${profitColor(item.configuredProfit)}`}
                                      >
                                        {formatAmount(Math.abs(item.configuredProfit))}
                                      </TableCell>
                                    )}
                                  </TableRow>
                                );
                              })}
                          </Fragment>
                        );
                      })}
                    </TableBody>
                    <TableFooter className="sticky bottom-0 bg-background border-t">
                      <TableRow className="font-semibold">
                        <TableCell></TableCell>
                        <TableCell>
                          Total ({voucherGroups.length} sale{voucherGroups.length !== 1 ? "s" : ""}
                          {plFilter !== "all" ? `, ${plFilter === "gain" ? "gaining" : "losing"} only` : ""})
                        </TableCell>
                        {col("qty") && (
                          <TableCell className="text-right font-mono">
                            {formatNumber(voucherGroups.reduce((s, v) => s + v.totalQty, 0))}
                          </TableCell>
                        )}
                        {col("costPrice") && <TableCell></TableCell>}
                        {col("hassanPrice") && <TableCell></TableCell>}
                        {col("pricePerBale") && <TableCell></TableCell>}
                        <TableCell className="text-right font-mono">
                          {formatAmount(voucherGroups.reduce((s, v) => s + v.totalSales, 0))}
                        </TableCell>
                        {col("costProfitBale") && <TableCell></TableCell>}
                        {col("hassanProfitBale") && <TableCell></TableCell>}
                        {col("costProfitTotal") && (
                          <TableCell
                            className={`text-right font-mono ${profitColor(voucherGroups.reduce((s, v) => s + v.costProfit, 0))}`}
                          >
                            {formatAmount(Math.abs(voucherGroups.reduce((s, v) => s + v.costProfit, 0)))}
                          </TableCell>
                        )}
                        {col("hassanProfitTotal") && (
                          <TableCell
                            className={`text-right font-mono ${profitColor(voucherGroups.reduce((s, v) => s + v.configuredProfit, 0))}`}
                          >
                            {formatAmount(Math.abs(voucherGroups.reduce((s, v) => s + v.configuredProfit, 0)))}
                          </TableCell>
                        )}
                      </TableRow>
                    </TableFooter>
                  </Table>
                </div>

                {/* Mobile: by-sale cards */}
                <div className="md:hidden space-y-3 p-3">
                  {voucherGroups.map((vg) => {
                    const isExpanded = expandedVouchers.has(vg.voucherId);
                    const groupPpb = vg.totalQty > 0 ? vg.totalSales / vg.totalQty : 0;
                    return (
                      <div key={vg.voucherId}>
                        <Card
                          className={`cursor-pointer ${isExpanded ? "rounded-b-none border-b-0" : ""}`}
                          onClick={() => toggleVoucher(vg.voucherId)}
                          data-testid={`card-voucher-${vg.voucherId}`}
                        >
                          <CardContent className="p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <div className="flex items-center gap-2">
                                {isExpanded ? (
                                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                )}
                                <Badge variant="secondary" className="text-xs font-normal">
                                  {vg.items.length} item{vg.items.length !== 1 ? "s" : ""}
                                </Badge>
                              </div>
                              <span className="text-xs text-muted-foreground">{vg.locationName}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-1 text-xs">
                              <div>
                                <span className="text-muted-foreground">Qty: </span>
                                <span className="font-mono">{formatNumber(vg.totalQty)}</span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Price/Bale: </span>
                                <span className="font-mono">{formatAmount(groupPpb)}</span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Total Sales: </span>
                                <span className="font-mono">{formatAmount(vg.totalSales)}</span>
                              </div>
                            </div>
                            <div className="flex items-center justify-between gap-2 pt-1 border-t text-xs">
                              <span className={`font-mono font-semibold ${profitColor(vg.configuredProfit)}`}>
                                Hassan's P/L: {formatAmount(Math.abs(vg.configuredProfit))}
                              </span>
                              <span className={`font-mono font-semibold ${profitColor(vg.costProfit)}`}>
                                Cost P/L: {formatAmount(Math.abs(vg.costProfit))}
                              </span>
                            </div>
                          </CardContent>
                        </Card>
                        {isExpanded && (
                          <div className="border border-t-0 rounded-b-md p-2 space-y-1 bg-muted/10">
                            {vg.items.map((item) => {
                              const qty = parseFloat(item.quantity) || 0;
                              const sales = parseFloat(String(item.totalSales)) || 0;
                              const ppb = qty > 0 ? sales / qty : 0;
                              return (
                                <div key={item.id} className="text-xs p-1 border-b last:border-b-0">
                                  <div className="font-medium">{item.stockItemName}</div>
                                  <div className="grid grid-cols-2 gap-1 mt-1">
                                    <div>
                                      <span className="text-muted-foreground">Qty: </span>
                                      <span className="font-mono">{formatNumericValue(item.quantity)}</span>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Price/Bale: </span>
                                      <span className="font-mono">{formatAmount(ppb)}</span>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Sales: </span>
                                      <span className="font-mono">{formatAmount(item.totalSales)}</span>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">H. Price: </span>
                                      <span className="font-mono">{formatAmount(item.configuredSellingPrice)}</span>
                                    </div>
                                    <div className={`font-mono ${profitColor(item.configuredProfit)}`}>
                                      Hassan's: {formatAmount(Math.abs(item.configuredProfit))}
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Cost Price: </span>
                                      <span className="font-mono">{formatAmount(item.costPrice)}</span>
                                    </div>
                                    <div className={`font-mono ${profitColor(parseFloat(item.costProfit))}`}>
                                      Cost P/L: {formatAmount(Math.abs(parseFloat(item.costProfit)))}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Item-grouped table */}
          {viewMode === "items" && (
            <Card>
              <CardContent className="p-0">
                <div className="hidden md:block">
                  <Table wrapperClassName="max-h-[calc(100vh-320px)]">
                    <TableHeader className="sticky top-0 z-30 bg-background">
                      <TableRow>
                        <TableHead className="w-6"></TableHead>
                        <TableHead>Item / Location</TableHead>
                        {col("qty") && <TableHead className="text-right">Qty</TableHead>}
                        {col("costPrice") && <TableHead className="text-right">Cost Price</TableHead>}
                        {col("hassanPrice") && <TableHead className="text-right">Hassan's Price</TableHead>}
                        {col("pricePerBale") && <TableHead className="text-right">Price / Bale</TableHead>}
                        {col("costProfitBale") && <TableHead className="text-right">Cost Profit / Bale</TableHead>}
                        {col("hassanProfitBale") && (
                          <TableHead className="text-right">Hassan's Profit / Bale</TableHead>
                        )}
                        {col("costProfitTotal") && <TableHead className="text-right">Cost Profit</TableHead>}
                        {col("hassanProfitTotal") && <TableHead className="text-right">Hassan's Profit</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {itemGroups.map((group) => {
                        const itemKey = String(group.stockItemId);
                        const isExpanded = expandedItems.has(itemKey);
                        return (
                          <Fragment key={itemKey}>
                            {/* Item summary row */}
                            <TableRow
                              key={`item-${itemKey}`}
                              data-testid={`row-item-${itemKey}`}
                              className="cursor-pointer bg-muted/30 hover-elevate font-medium"
                              onClick={() => toggleItem(itemKey)}
                            >
                              <TableCell className="py-2 pr-0 w-6">
                                {isExpanded ? (
                                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                )}
                              </TableCell>
                              <TableCell className="py-2">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span>{group.stockItemName}</span>
                                  {multipleLocations && group.locationBreakdown.length > 1 ? (
                                    <div className="flex items-center gap-1">
                                      {group.locationBreakdown.map((loc) => {
                                        const color = locationColorMap.get(loc.locationKey);
                                        return color ? (
                                          <span
                                            key={loc.locationKey}
                                            title={loc.locationName}
                                            className={`inline-block h-2 w-2 rounded-full ${color.dot}`}
                                          />
                                        ) : null;
                                      })}
                                      <span className="text-xs text-muted-foreground">
                                        {group.locationBreakdown.length} locs
                                      </span>
                                    </div>
                                  ) : (
                                    <Badge variant="secondary" className="text-xs font-normal">
                                      {group.locationBreakdown.length} loc
                                      {group.locationBreakdown.length !== 1 ? "s" : ""}
                                    </Badge>
                                  )}
                                </div>
                              </TableCell>
                              {col("qty") && (
                                <TableCell className="text-right font-mono py-2">
                                  {formatNumber(group.totalQty)}
                                </TableCell>
                              )}
                              {col("costPrice") && (
                                <TableCell className="text-right font-mono py-2 text-muted-foreground">
                                  {group.totalQty > 0 ? formatAmount(group.totalCost / group.totalQty) : "—"}
                                </TableCell>
                              )}
                              {col("hassanPrice") && (
                                <TableCell className="text-right font-mono py-2 text-muted-foreground">
                                  {group.totalQty > 0 ? formatAmount(group.totalConfiguredCost / group.totalQty) : "—"}
                                </TableCell>
                              )}
                              {col("pricePerBale") && (
                                <TableCell className="text-right font-mono py-2">
                                  {group.totalQty > 0 ? formatAmount(group.totalSales / group.totalQty) : "—"}
                                </TableCell>
                              )}
                              {col("costProfitBale") && (
                                <TableCell className={`text-right font-mono py-2 ${profitColor(group.costProfit)}`}>
                                  {group.totalQty > 0 ? formatAmount(Math.abs(group.costProfit) / group.totalQty) : "—"}
                                </TableCell>
                              )}
                              {col("hassanProfitBale") && (
                                <TableCell
                                  className={`text-right font-mono py-2 ${profitColor(group.configuredProfit)}`}
                                >
                                  {group.totalQty > 0
                                    ? formatAmount(Math.abs(group.configuredProfit) / group.totalQty)
                                    : "—"}
                                </TableCell>
                              )}
                              {col("costProfitTotal") && (
                                <TableCell className={`text-right font-mono py-2 ${profitColor(group.costProfit)}`}>
                                  {formatAmount(Math.abs(group.costProfit))}
                                </TableCell>
                              )}
                              {col("hassanProfitTotal") && (
                                <TableCell
                                  className={`text-right font-mono py-2 ${profitColor(group.configuredProfit)}`}
                                >
                                  {formatAmount(Math.abs(group.configuredProfit))}
                                </TableCell>
                              )}
                            </TableRow>

                            {/* Expanded: per-location totals */}
                            {isExpanded &&
                              group.locationBreakdown.map((loc) => {
                                const locRowKey = `${itemKey}-${loc.locationKey}`;
                                const isLocExpanded = expandedLocations.has(locRowKey);
                                return (
                                  <Fragment key={locRowKey}>
                                    {/* Location summary row for this item */}
                                    <TableRow
                                      key={`loc-${locRowKey}`}
                                      data-testid={`row-loc-${locRowKey}`}
                                      className="cursor-pointer hover-elevate text-sm"
                                      onClick={() => toggleLocation(locRowKey)}
                                    >
                                      <TableCell className="py-1.5 pr-0 w-6 pl-8">
                                        {isLocExpanded ? (
                                          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                                        ) : (
                                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                                        )}
                                      </TableCell>
                                      <TableCell className="py-1.5 pl-4">
                                        <div className="flex items-center gap-2">
                                          {multipleLocations &&
                                            (() => {
                                              const color = locationColorMap.get(loc.locationKey);
                                              return color ? (
                                                <span
                                                  className={`inline-block h-2 w-2 rounded-full flex-shrink-0 ${color.dot}`}
                                                />
                                              ) : null;
                                            })()}
                                          <span
                                            className={
                                              multipleLocations
                                                ? (locationColorMap.get(loc.locationKey)?.text ??
                                                  "text-muted-foreground")
                                                : "text-muted-foreground"
                                            }
                                          >
                                            {loc.locationName}
                                          </span>
                                          {multipleLocations ? (
                                            <span
                                              className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-normal ${locationColorMap.get(loc.locationKey)?.badge ?? ""}`}
                                            >
                                              {loc.items.length} sale{loc.items.length !== 1 ? "s" : ""}
                                            </span>
                                          ) : (
                                            <Badge variant="outline" className="text-xs font-normal">
                                              {loc.items.length} sale{loc.items.length !== 1 ? "s" : ""}
                                            </Badge>
                                          )}
                                        </div>
                                      </TableCell>
                                      {col("qty") && (
                                        <TableCell className="text-right font-mono py-1.5">
                                          {formatNumber(loc.totalQty)}
                                        </TableCell>
                                      )}
                                      {col("costPrice") && (
                                        <TableCell className="text-right font-mono py-1.5 text-muted-foreground">
                                          {loc.totalQty > 0 ? formatAmount(loc.totalCost / loc.totalQty) : "—"}
                                        </TableCell>
                                      )}
                                      {col("hassanPrice") && (
                                        <TableCell className="text-right font-mono py-1.5 text-muted-foreground">
                                          {loc.totalQty > 0
                                            ? formatAmount(loc.totalConfiguredCost / loc.totalQty)
                                            : "—"}
                                        </TableCell>
                                      )}
                                      {col("pricePerBale") && (
                                        <TableCell className="text-right font-mono py-1.5">
                                          {loc.totalQty > 0 ? formatAmount(loc.totalSales / loc.totalQty) : "—"}
                                        </TableCell>
                                      )}
                                      {col("costProfitBale") && (
                                        <TableCell
                                          className={`text-right font-mono py-1.5 ${profitColor(loc.costProfit)}`}
                                        >
                                          {loc.totalQty > 0
                                            ? formatAmount(Math.abs(loc.costProfit) / loc.totalQty)
                                            : "—"}
                                        </TableCell>
                                      )}
                                      {col("hassanProfitBale") && (
                                        <TableCell
                                          className={`text-right font-mono py-1.5 ${profitColor(loc.configuredProfit)}`}
                                        >
                                          {loc.totalQty > 0
                                            ? formatAmount(Math.abs(loc.configuredProfit) / loc.totalQty)
                                            : "—"}
                                        </TableCell>
                                      )}
                                      {col("costProfitTotal") && (
                                        <TableCell
                                          className={`text-right font-mono py-1.5 ${profitColor(loc.costProfit)}`}
                                        >
                                          {formatAmount(Math.abs(loc.costProfit))}
                                        </TableCell>
                                      )}
                                      {col("hassanProfitTotal") && (
                                        <TableCell
                                          className={`text-right font-mono py-1.5 ${profitColor(loc.configuredProfit)}`}
                                        >
                                          {formatAmount(Math.abs(loc.configuredProfit))}
                                        </TableCell>
                                      )}
                                    </TableRow>

                                    {/* Individual sale records within this location */}
                                    {isLocExpanded &&
                                      loc.items.map((item) => {
                                        const qty = parseFloat(item.quantity) || 0;
                                        const itemCostProfit = parseFloat(item.costProfit) || 0;
                                        return (
                                          <TableRow
                                            key={item.id}
                                            data-testid={`row-detail-${item.id}`}
                                            className="text-xs bg-muted/10"
                                          >
                                            <TableCell className="py-1 w-6"></TableCell>
                                            <TableCell className="py-1 pl-10 text-muted-foreground">
                                              <div className="flex items-center gap-2">
                                                <span className="font-mono text-foreground/80">
                                                  {item.voucherNumber}
                                                </span>
                                                <span className="text-muted-foreground/60">
                                                  {item.voucherDate?.slice(0, 10)}
                                                </span>
                                              </div>
                                            </TableCell>
                                            {col("qty") && (
                                              <TableCell className="text-right font-mono py-1">
                                                {formatNumericValue(item.quantity)}
                                              </TableCell>
                                            )}
                                            {col("costPrice") && (
                                              <TableCell className="text-right font-mono py-1">
                                                {formatAmount(item.costPrice)}
                                              </TableCell>
                                            )}
                                            {col("hassanPrice") && (
                                              <TableCell className="text-right font-mono py-1">
                                                {formatAmount(item.configuredSellingPrice)}
                                              </TableCell>
                                            )}
                                            {col("pricePerBale") && (
                                              <TableCell className="text-right font-mono py-1">
                                                {formatAmount(item.actualSellingPrice)}
                                              </TableCell>
                                            )}
                                            {col("costProfitBale") && (
                                              <TableCell
                                                className={`text-right font-mono py-1 ${profitColor(itemCostProfit)}`}
                                              >
                                                {qty > 0 ? formatAmount(Math.abs(itemCostProfit) / qty) : "—"}
                                              </TableCell>
                                            )}
                                            {col("hassanProfitBale") && (
                                              <TableCell
                                                className={`text-right font-mono py-1 ${profitColor(item.configuredProfit)}`}
                                              >
                                                {qty > 0 ? formatAmount(Math.abs(item.configuredProfit) / qty) : "—"}
                                              </TableCell>
                                            )}
                                            {col("costProfitTotal") && (
                                              <TableCell
                                                className={`text-right font-mono py-1 ${profitColor(itemCostProfit)}`}
                                              >
                                                {formatAmount(Math.abs(itemCostProfit))}
                                              </TableCell>
                                            )}
                                            {col("hassanProfitTotal") && (
                                              <TableCell
                                                className={`text-right font-mono py-1 ${profitColor(item.configuredProfit)}`}
                                              >
                                                {formatAmount(Math.abs(item.configuredProfit))}
                                              </TableCell>
                                            )}
                                          </TableRow>
                                        );
                                      })}
                                  </Fragment>
                                );
                              })}
                          </Fragment>
                        );
                      })}
                    </TableBody>
                    <TableFooter className="sticky bottom-0 bg-background border-t">
                      <TableRow className="font-semibold">
                        <TableCell></TableCell>
                        <TableCell>
                          Total ({itemGroups.length} item{itemGroups.length !== 1 ? "s" : ""}
                          {plFilter !== "all" ? `, ${plFilter === "gain" ? "gaining" : "losing"} only` : ""})
                        </TableCell>
                        {col("qty") && <TableCell className="text-right font-mono">{formatNumber(totalQty)}</TableCell>}
                        {col("costPrice") && (
                          <TableCell className="text-right font-mono text-muted-foreground">
                            {totalQty > 0 ? formatAmount(totalCost / totalQty) : "—"}
                          </TableCell>
                        )}
                        {col("hassanPrice") && (
                          <TableCell className="text-right font-mono text-muted-foreground">
                            {totalQty > 0 ? formatAmount(totalConfiguredCost / totalQty) : "—"}
                          </TableCell>
                        )}
                        {col("pricePerBale") && (
                          <TableCell className="text-right font-mono">
                            {totalQty > 0 ? formatAmount(totalSales / totalQty) : "—"}
                          </TableCell>
                        )}
                        {col("costProfitBale") && (
                          <TableCell className={`text-right font-mono ${profitColor(costProfit)}`}>
                            {totalQty > 0 ? formatAmount(Math.abs(costProfit) / totalQty) : "—"}
                          </TableCell>
                        )}
                        {col("hassanProfitBale") && (
                          <TableCell className={`text-right font-mono ${profitColor(configuredProfit)}`}>
                            {totalQty > 0 ? formatAmount(Math.abs(configuredProfit) / totalQty) : "—"}
                          </TableCell>
                        )}
                        {col("costProfitTotal") && (
                          <TableCell className={`text-right font-mono ${profitColor(costProfit)}`}>
                            {formatAmount(Math.abs(costProfit))}
                          </TableCell>
                        )}
                        {col("hassanProfitTotal") && (
                          <TableCell className={`text-right font-mono ${profitColor(configuredProfit)}`}>
                            {formatAmount(Math.abs(configuredProfit))}
                          </TableCell>
                        )}
                      </TableRow>
                    </TableFooter>
                  </Table>
                </div>

                <SalesReportItemMobileView
                  itemGroups={itemGroups}
                  expandedItems={expandedItems}
                  toggleItem={toggleItem}
                  multipleLocations={multipleLocations}
                  locationColorMap={locationColorMap}
                  formatAmount={formatAmount}
                  expandedLocations={expandedLocations}
                  toggleLocation={toggleLocation}
                />
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
