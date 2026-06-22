import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronRight, ChevronDown, DollarSign, BarChart3 } from "lucide-react";
import { NetProfitStatementData } from "./analyticsTypes";

interface NetProfitPanelProps {
  loadingNetProfit: boolean;
  netProfitData?: NetProfitStatementData;
  plStartDate: string | null;
  plEndDate: string | null;
  formatAmount: (amount: number) => string;
  appMode: string;
  navigate: (to: string) => void;
  toggleNetProfitSection: (section: string) => void;
  expandedNetProfitSections: Set<string>;
  setActiveSection: (section: string) => void;
}

export function NetProfitPanel({
  loadingNetProfit,
  netProfitData,
  plStartDate,
  plEndDate,
  formatAmount,
  appMode,
  navigate,
  toggleNetProfitSection,
  expandedNetProfitSections,
  setActiveSection
}: NetProfitPanelProps) {
  return (
    <div className="space-y-4">
      <Card className="p-6">
        <div className="mb-4">
          <h3 className="text-lg font-medium flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Net Profit (P&L Statement)
          </h3>
        </div>

        {loadingNetProfit ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : netProfitData ? (
          <div className="space-y-6">
            {!plStartDate && !plEndDate && netProfitData.openingBalancesNet != null && netProfitData.openingBalancesNet !== 0 && (
              <div className="flex items-center justify-between px-4 py-3 rounded-lg border bg-muted/30" data-testid="row-opening-balances">
                <span className="flex items-center gap-2 font-medium text-sm">
                  <ChevronRight className="h-4 w-4" />
                  Opening Balances (Balance B/F)
                </span>
                <span className="font-mono text-sm">{formatAmount(netProfitData.openingBalancesNet)}</span>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Left Pane */}
              <div className="border rounded-lg overflow-hidden">
                <div className="bg-muted/50 p-3 border-b">
                  <span className="font-semibold">Particulars</span>
                </div>
                <div className="divide-y">
                  <div 
                    className={`flex justify-between items-center p-3 ${appMode !== "factory" ? "cursor-pointer hover-elevate" : ""}`}
                    onClick={() => appMode !== "factory" && navigate("/opening-stock")}
                    data-testid="row-opening-stock"
                  >
                    <span className="flex items-center gap-2">
                      <ChevronRight className="h-4 w-4" />
                      Opening Stock
                    </span>
                    <span className="font-mono">{formatAmount(netProfitData.leftPane.openingStock.value)}</span>
                  </div>

                  <div>
                    <div 
                      className="flex justify-between items-center p-3 cursor-pointer hover-elevate"
                      onClick={() => toggleNetProfitSection("purchaseAccounts")}
                      data-testid="row-purchase-accounts"
                    >
                      <span className="flex items-center gap-2">
                        {expandedNetProfitSections.has("purchaseAccounts") ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        Purchase Accounts
                        {netProfitData.leftPane.purchaseAccounts.count > 0 && (
                          <span className="text-xs text-muted-foreground">({netProfitData.leftPane.purchaseAccounts.count})</span>
                        )}
                      </span>
                      <span className="font-mono">{formatAmount(netProfitData.leftPane.purchaseAccounts.total)}</span>
                    </div>
                    {expandedNetProfitSections.has("purchaseAccounts") && netProfitData.leftPane.purchaseAccounts.accounts.length > 0 && (
                      <div className="bg-muted/30 divide-y">
                        {netProfitData.leftPane.purchaseAccounts.accounts.filter((acc) => Number(acc.debit) !== 0 || Number(acc.credit) !== 0).map((acc) => (
                          <div 
                            key={acc.id} 
                            className="flex justify-between items-center px-6 py-2 text-sm text-muted-foreground cursor-pointer hover-elevate"
                            onClick={() => window.open(`/ledger-monthly/${acc.id}`, "_blank")}
                            data-testid={`row-purchase-account-${acc.id}`}
                          >
                            <span className="flex items-center gap-2"><ChevronRight className="h-3 w-3" />{acc.name}</span>
                            <span className="font-mono">Dr: {formatAmount(acc.debit)} | Cr: {formatAmount(acc.credit)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {(netProfitData.rightPane?.directIncomes?.accounts?.filter((a: any) => Number(a.debit) !== 0 || Number(a.credit) !== 0).length ?? 0) > 0 && (
                    <div>
                      <div 
                        className="flex justify-between items-center p-3 cursor-pointer hover-elevate"
                        onClick={() => toggleNetProfitSection("directIncomes")}
                        data-testid="row-direct-incomes"
                      >
                        <span className="flex items-center gap-2">
                          {expandedNetProfitSections.has("directIncomes") ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          Direct Incomes
                          <span className="text-xs text-muted-foreground">({netProfitData.rightPane!.directIncomes.accounts.filter((a: any) => Number(a.debit) !== 0 || Number(a.credit) !== 0).length})</span>
                        </span>
                        <span className="font-mono">{formatAmount(netProfitData.rightPane!.directIncomes.total)}</span>
                      </div>
                      {expandedNetProfitSections.has("directIncomes") && (
                        <div className="bg-muted/30 divide-y">
                          {netProfitData.rightPane!.directIncomes.accounts.filter((a: any) => Number(a.debit) !== 0 || Number(a.credit) !== 0).map((acc) => (
                            <div key={acc.id} className="flex justify-between items-center px-6 py-2 text-sm text-muted-foreground">
                              <span>{acc.name}</span>
                              <span className="font-mono">Dr: {formatAmount(acc.debit)} | Cr: {formatAmount(acc.credit)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {netProfitData.leftPane.directExpenses.accounts.filter((a) => Number(a.debit) !== 0 || Number(a.credit) !== 0).length > 0 && (
                    <div>
                      <div 
                        className="flex justify-between items-center p-3 cursor-pointer hover-elevate"
                        onClick={() => toggleNetProfitSection("directExpenses")}
                        data-testid="row-direct-expenses"
                      >
                        <span className="flex items-center gap-2">
                          {expandedNetProfitSections.has("directExpenses") ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          Direct Expenses
                          <span className="text-xs text-muted-foreground">({netProfitData.leftPane.directExpenses.accounts.filter((a) => Number(a.debit) !== 0 || Number(a.credit) !== 0).length})</span>
                        </span>
                        <span className="font-mono">{formatAmount(netProfitData.leftPane.directExpenses.total)}</span>
                      </div>
                      {expandedNetProfitSections.has("directExpenses") && (
                        <div className="bg-muted/30 divide-y">
                          {netProfitData.leftPane.directExpenses.accounts.filter((a) => Number(a.debit) !== 0 || Number(a.credit) !== 0).map((acc) => (
                            <div key={acc.id} className="flex justify-between items-center px-6 py-2 text-sm text-muted-foreground">
                              <span>{acc.name}</span>
                              <span className="font-mono">Dr: {formatAmount(acc.debit)} | Cr: {formatAmount(acc.credit)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex justify-between items-center p-3 bg-primary/10 font-semibold border-t-2">
                    <span>Total</span>
                    <span className="font-mono">{formatAmount(netProfitData.leftPane.tradingTotal)}</span>
                  </div>

                  <div className="h-4 bg-muted/30"></div>

                  <div>
                    {(() => {
                      const nonZeroIndirectExp = netProfitData.leftPane.indirectExpenses.accounts.filter((a) => Number(a.debit) !== 0 || Number(a.credit) !== 0);
                      return (
                        <>
                          <div 
                            className="flex justify-between items-center p-3 cursor-pointer hover-elevate"
                            onClick={() => toggleNetProfitSection("indirectExpenses")}
                            data-testid="row-indirect-expenses"
                          >
                            <span className="flex items-center gap-2">
                              {expandedNetProfitSections.has("indirectExpenses") ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              Indirect Expenses
                              {nonZeroIndirectExp.length > 0 && <span className="text-xs text-muted-foreground">({nonZeroIndirectExp.length})</span>}
                            </span>
                            <span className="font-mono">{formatAmount(netProfitData.leftPane.indirectExpenses.total)}</span>
                          </div>
                          {expandedNetProfitSections.has("indirectExpenses") && nonZeroIndirectExp.length > 0 && (
                            <div className="bg-muted/30 divide-y">
                              {nonZeroIndirectExp.map((acc) => (
                                <div key={acc.id} className="flex justify-between items-center px-6 py-2 text-sm text-muted-foreground">
                                  <span>{acc.name}</span>
                                  <span className="font-mono">Dr: {formatAmount(acc.debit)} | Cr: {formatAmount(acc.credit)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>

              {/* Right Pane */}
              <div className="border rounded-lg overflow-hidden">
                <div className="bg-muted/50 p-3 border-b">
                  <span className="font-semibold">Particulars</span>
                </div>
                <div className="divide-y">
                  <div 
                    className="flex justify-between items-center p-3 cursor-pointer hover-elevate"
                    onClick={() => setActiveSection("sales")}
                    data-testid="row-sales-accounts"
                  >
                    <span className="flex items-center gap-2">
                      <ChevronRight className="h-4 w-4" />
                      Sales Accounts
                    </span>
                    <span className="font-mono">{formatAmount(netProfitData.rightPane?.salesAccounts?.total || 0)}</span>
                  </div>

                  <div 
                    className={`flex justify-between items-center p-3 ${appMode !== "factory" ? "cursor-pointer hover-elevate" : ""}`}
                    onClick={() => appMode !== "factory" && navigate("/closing-stock-summary")}
                    data-testid="row-closing-stock"
                  >
                    <span className="flex items-center gap-2">
                      <ChevronRight className="h-4 w-4" />
                      Closing Stock
                    </span>
                    <span className="font-mono">{formatAmount(netProfitData.rightPane?.closingStock?.value || 0)}</span>
                  </div>

                  <div className="h-10 bg-muted/10"></div>
                  <div className="h-10 bg-muted/10"></div>

                  <div className="flex justify-between items-center p-3 bg-primary/10 font-semibold border-t-2">
                    <span>Total</span>
                    <span className="font-mono">{formatAmount(netProfitData.rightPane?.total || 0)}</span>
                  </div>

                  <div className="h-4 bg-muted/30"></div>

                  <div>
                    {(() => {
                      const nonZeroIndirectInc = (netProfitData.rightPane?.indirectIncomes?.accounts || []).filter((a: any) => Number(a.debit) !== 0 || Number(a.credit) !== 0);
                      return (
                        <>
                          <div 
                            className="flex justify-between items-center p-3 cursor-pointer hover-elevate"
                            onClick={() => toggleNetProfitSection("indirectIncomes")}
                            data-testid="row-indirect-incomes"
                          >
                            <span className="flex items-center gap-2">
                              {expandedNetProfitSections.has("indirectIncomes") ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              Indirect Incomes
                              {nonZeroIndirectInc.length > 0 && <span className="text-xs text-muted-foreground">({nonZeroIndirectInc.length})</span>}
                            </span>
                            <span className="font-mono">{formatAmount(netProfitData.rightPane?.indirectIncomes?.total || 0)}</span>
                          </div>
                          {expandedNetProfitSections.has("indirectIncomes") && nonZeroIndirectInc.length > 0 && (
                            <div className="bg-muted/30 divide-y">
                              {nonZeroIndirectInc.map((acc: any) => (
                                <div 
                                  key={acc.id} 
                                  className="flex justify-between items-center px-6 py-2 text-sm text-muted-foreground cursor-pointer hover-elevate"
                                  onClick={() => window.open(`/ledger-monthly/${acc.id}`, "_blank")}
                                  data-testid={`row-indirect-income-${acc.id}`}
                                >
                                  <span className="flex items-center gap-2"><ChevronRight className="h-3 w-3" />{acc.name}</span>
                                  <span className="font-mono">Dr: {formatAmount(acc.debit)} | Cr: {formatAmount(acc.credit)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 py-14 text-muted-foreground">
            <BarChart3 className="h-10 w-10 opacity-25" />
            <p className="text-sm font-medium">No data available</p>
            <p className="text-xs opacity-60">Adjust your filters and try again</p>
          </div>
        )}
      </Card>
    </div>
  );
}
