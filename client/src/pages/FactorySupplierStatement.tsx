import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DollarSign, FileText, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatNumber } from "@/lib/formatNumber";

const CURRENCIES = ["USD", "EUR", "GBP", "AUD", "LBP", "XOF", "XAF"];

export default function FactorySupplierStatement() {
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [supplierId, setSupplierId] = useState<string>("");
  const [estimatedRates, setEstimatedRates] = useState<Record<string, string>>({});

  const { data: companies = [] } = useQuery<any[]>({
    queryKey: ["/api/user/companies"],
  });

  const { data: me } = useQuery<any>({
    queryKey: ["/api/auth/me"],
  });
  const isAdmin = me?.role === "Admin" || me?.role === "Owner";

  const { data: suppliers = [], isLoading: suppliersLoading } = useQuery<any[]>({
    queryKey: ["/api/factory/suppliers", companyId],
    queryFn: async () => {
      const res = await fetch(`/api/factory/suppliers?companyId=${companyId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch suppliers");
      return res.json();
    },
    enabled: !!companyId,
  });

  const { data: statement, isLoading: statementLoading } = useQuery<any>({
    queryKey: ["/api/factory/suppliers", supplierId, "statement"],
    queryFn: async () => {
      const res = await fetch(`/api/factory/suppliers/${supplierId}/statement`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch statement");
      return res.json();
    },
    enabled: !!supplierId,
  });

  const getRate = (cc: string) => parseFloat(estimatedRates[cc] || (cc === "USD" ? "1" : "0")) || 0;

  const estimatedUsdTotal = statement?.currencyGroups
    ? statement.currencyGroups.reduce((sum: number, g: any) => {
        const rate = getRate(g.currencyCode);
        return sum + parseFloat(g.netPayable) * rate;
      }, 0)
    : 0;

  const currenciesInStatement: string[] = statement?.currencyGroups
    ? [...new Set(statement.currencyGroups.map((g: any) => g.currencyCode as string))].filter((c) => c !== "USD")
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight" data-testid="text-title">Supplier Statement</h1>
        <p className="text-muted-foreground mt-1">Multi-currency supplier account statement</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-4 flex-wrap">
            {companies.length > 1 && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Company</Label>
                <Select
                  value={companyId ? String(companyId) : ""}
                  onValueChange={(val) => { setCompanyId(Number(val)); setSupplierId(""); }}
                >
                  <SelectTrigger className="w-48" data-testid="select-company">
                    <SelectValue placeholder="Select company" />
                  </SelectTrigger>
                  <SelectContent>
                    {companies.map((c: any) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Supplier</Label>
              <Select
                value={supplierId || ""}
                onValueChange={(val) => setSupplierId(val)}
                disabled={!companyId || suppliersLoading}
              >
                <SelectTrigger className="w-56" data-testid="select-supplier">
                  <SelectValue placeholder="Select supplier..." />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((s: any) => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {statementLoading && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-sm">Loading statement...</p>
          </CardContent>
        </Card>
      )}

      {statement && !statementLoading && (
        <>
          {statement.currencyGroups?.map((group: any) => (
            <Card key={group.currencyCode}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Badge variant="secondary" data-testid={`badge-currency-${group.currencyCode}`}>
                    {group.currencyCode}
                  </Badge>
                  Containers
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Container</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Origin</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Kg</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                        <TableHead className="text-right">Value ({group.currencyCode})</TableHead>
                        <TableHead className="text-right">Commission</TableHead>
                        <TableHead className="text-right">Net Payable</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.containers.map((c: any) => (
                        <TableRow key={c.id} data-testid={`row-container-${c.id}`}>
                          <TableCell className="font-mono font-medium">{c.containerNumber}</TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {c.date ? new Date(c.date).toLocaleDateString() : "—"}
                          </TableCell>
                          <TableCell>{c.origin || "—"}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{c.status}</Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatNumber(parseFloat(c.actualReceivedKg || c.totalKg || "0"))}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatNumber(parseFloat(c.ratePerKg || "0"))}
                          </TableCell>
                          <TableCell className="text-right font-mono font-medium">
                            {formatNumber(parseFloat(c.value))}
                          </TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground">
                            {parseFloat(c.totalCommission) > 0
                              ? `${formatNumber(parseFloat(c.totalCommission))}`
                              : "—"}
                            {parseFloat(c.commissionAmount || "0") > 0 && (
                              <span className="ml-1 text-xs">
                                ({formatNumber(parseFloat(c.commissionAmount))} {c.commissionCurrencyCode})
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono font-medium">
                            {formatNumber(parseFloat(c.value) - parseFloat(c.totalCommission))}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="mt-4 flex justify-end">
                  <div className="space-y-1 text-sm text-right min-w-48">
                    <div className="flex justify-between gap-8">
                      <span className="text-muted-foreground">Total Kg</span>
                      <span className="font-mono font-medium">{formatNumber(parseFloat(group.totalKg))}</span>
                    </div>
                    <div className="flex justify-between gap-8">
                      <span className="text-muted-foreground">Total Value</span>
                      <span className="font-mono font-medium">{formatNumber(parseFloat(group.totalValue))} {group.currencyCode}</span>
                    </div>
                    <div className="flex justify-between gap-8">
                      <span className="text-muted-foreground">Commission</span>
                      <span className="font-mono text-muted-foreground">−{formatNumber(parseFloat(group.totalCommission))}</span>
                    </div>
                    <div className="flex justify-between gap-8 border-t pt-1">
                      <span className="font-medium">Net Payable</span>
                      <span className="font-mono font-bold">{formatNumber(parseFloat(group.netPayable))} {group.currencyCode}</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          {isAdmin && statement.currencyGroups?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Estimated USD Total
                  <Badge variant="outline" className="ml-1">Admin Only</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  This is a helper estimate only. It does not affect accounting balances or posted values.
                  Set exchange rates below to compute an approximate USD equivalent.
                </p>

                {currenciesInStatement.length > 0 && (
                  <div className="grid grid-cols-2 gap-3 mb-4 max-w-sm">
                    {currenciesInStatement.map((cc) => (
                      <div key={cc} className="space-y-1">
                        <Label className="text-xs text-muted-foreground">1 {cc} = USD</Label>
                        <Input
                          type="number"
                          placeholder="0.00"
                          value={estimatedRates[cc] || ""}
                          onChange={(e) => setEstimatedRates((prev) => ({ ...prev, [cc]: e.target.value }))}
                          data-testid={`input-est-rate-${cc}`}
                        />
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-2 text-sm">
                  {statement.currencyGroups.map((g: any) => {
                    const rate = getRate(g.currencyCode);
                    const usdEq = parseFloat(g.netPayable) * rate;
                    return (
                      <div key={g.currencyCode} className="flex justify-between gap-8 max-w-sm text-muted-foreground">
                        <span>{formatNumber(parseFloat(g.netPayable))} {g.currencyCode} × {rate || "?"}</span>
                        <span className="font-mono">{rate ? `≈ ${formatNumber(usdEq)} USD` : "—"}</span>
                      </div>
                    );
                  })}
                  <div className="flex justify-between gap-8 max-w-sm border-t pt-2">
                    <span className="font-medium flex items-center gap-1">
                      <DollarSign className="h-4 w-4" />
                      Estimated Grand Total
                    </span>
                    <span className="font-mono font-bold" data-testid="text-estimated-usd-total">
                      {formatNumber(estimatedUsdTotal)} USD
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {(!statement.currencyGroups || statement.currencyGroups.length === 0) && (
            <Card>
              <CardContent className="pt-6">
                <div className="text-center py-8">
                  <FileText className="mx-auto h-10 w-10 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground mt-3">No containers found for this supplier.</p>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {!statement && !statementLoading && supplierId && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Failed to load statement.</p>
          </CardContent>
        </Card>
      )}

      {!supplierId && (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <FileText className="mx-auto h-10 w-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground mt-3">Select a supplier to view their statement.</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
