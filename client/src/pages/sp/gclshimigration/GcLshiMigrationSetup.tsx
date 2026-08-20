import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  Layers,
  Lock,
  Package,
  Plus,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { useGcLshiMigrationModel } from "./useGcLshiMigrationModel";

type MigrationModel = ReturnType<typeof useGcLshiMigrationModel>;

export function GcLshiMigrationAccess({ model }: { model: MigrationModel }) {
  if (model.roleLoading) {
    return (
      <div className="p-6 flex items-center gap-2 text-muted-foreground text-sm">
        <RefreshCw className="h-4 w-4 animate-spin" /> Checking access…
      </div>
    );
  }
  if (model.sessionRole?.role === "Developer") return null;
  return (
    <div className="p-6 max-w-md mx-auto mt-16 text-center space-y-4">
      <div className="flex justify-center">
        <div className="rounded-full bg-muted p-4">
          <Lock className="h-8 w-8 text-muted-foreground" />
        </div>
      </div>
      <h2 className="text-xl font-semibold">Developer access required</h2>
      <p className="text-muted-foreground text-sm">
        The GC Migration tool is restricted to the Developer role. Your current role is{" "}
        <span className="font-medium">{model.sessionRole?.role ?? "unknown"}</span>.
      </p>
    </div>
  );
}

export function GcLshiMigrationHeader() {
  return (
    <div>
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <Layers className="h-6 w-6 text-muted-foreground" />
        GC-LSHI → SP Migration
      </h1>
      <p className="text-muted-foreground mt-1">
        Migrate an ERP company's stock, accounts, and historical sale vouchers into a new Supplier Partner company.
      </p>
      <Badge variant="outline" className="mt-2 text-xs gap-1">
        <Lock className="h-3 w-3" /> Developer only
      </Badge>
    </div>
  );
}

export function GcLshiMigrationCompanySelection({ model }: { model: MigrationModel }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="h-4 w-4" />
          Step 1 — Select Companies
        </CardTitle>
        <CardDescription>Choose the source ERP company and the target SP company.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Source ERP Company</Label>
            <select
              className="w-full border rounded-md h-9 px-3 text-sm bg-background"
              value={model.sourceCompanyId ?? ""}
              onChange={(event) => model.setSourceCompanyId(event.target.value ? Number(event.target.value) : null)}
              data-testid="select-source-company"
            >
              <option value="">— select ERP company —</option>
              {model.erpCompanies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name} ({company.code})
                </option>
              ))}
            </select>
            {model.sourceComp && <p className="text-xs text-muted-foreground">ID: {model.sourceComp.id} · Type: ERP</p>}
          </div>
          <div className="space-y-2">
            <Label>Target SP Company</Label>
            <div className="flex gap-2">
              <select
                className="flex-1 border rounded-md h-9 px-3 text-sm bg-background"
                value={model.targetCompanyId ?? ""}
                onChange={(event) => model.setTargetCompanyId(event.target.value ? Number(event.target.value) : null)}
                data-testid="select-target-company"
              >
                <option value="">— select SP company —</option>
                {model.spCompanies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name} ({company.code})
                  </option>
                ))}
              </select>
              <Button
                variant="outline"
                size="icon"
                onClick={() => model.setShowCreateDialog(true)}
                title="Create new SP company"
                data-testid="button-create-sp-company"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {model.targetComp && (
              <p className="text-xs text-muted-foreground">ID: {model.targetComp.id} · Type: Supplier Partner</p>
            )}
          </div>
        </div>
        {model.sourceCompanyId && model.targetCompanyId && (
          <Button
            variant="outline"
            onClick={() => {
              model.setPreviewOpen(true);
              model.refetchPreview();
            }}
            data-testid="button-load-preview"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Load Preview
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function GcLshiMigrationPreview({ model }: { model: MigrationModel }) {
  if (!model.previewOpen || !model.sourceCompanyId || !model.targetCompanyId) return null;
  const preview = model.preview;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4" />
          Step 2 — Migration Preview
        </CardTitle>
        <CardDescription>Review what will be created in the target SP company.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {model.previewLoading && (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <RefreshCw className="h-4 w-4 animate-spin" /> Loading preview…
          </div>
        )}
        {model.previewError && (
          <div className="flex items-center gap-2 text-destructive text-sm">
            <XCircle className="h-4 w-4" />
            {model.previewError instanceof Error ? model.previewError.message : "Failed to load preview"}
          </div>
        )}
        {preview && !model.previewLoading && (
          <div className="space-y-4">
            {(preview.warnings ?? []).length > 0 && (
              <div className="space-y-1">
                {(preview.warnings ?? []).map((warning, index) => (
                  <div
                    key={index}
                    className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded-md px-3 py-2"
                  >
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    {warning}
                  </div>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Summary
                label="Stock Items"
                value={preview.stockSummary?.itemCount ?? 0}
                note={`${preview.stockSummary?.alreadyMapped ?? 0} already mapped`}
              />
              <Summary
                label="Total Stock Value"
                value={`$${model.fmt(preview.stockSummary?.totalValueUsd ?? 0)}`}
                note={`${model.fmt(preview.stockSummary?.totalQty ?? 0)} units`}
              />
              <Summary
                label="Sale Vouchers"
                value={preview.voucherSummary?.sourceCount ?? 0}
                note={`${preview.voucherSummary?.alreadyMigrated ?? 0} already migrated`}
              />
              <Summary
                label="Voucher Total"
                value={`$${model.fmt(preview.voucherSummary?.totalAmount ?? 0)}`}
                note="historical sales"
              />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">SP Accounts (10 standard)</p>
              <AccountBadges accounts={preview.spAccountsStatus ?? []} />
              <p className="text-sm font-medium mt-2">GC Profit Accounts (2 new)</p>
              <AccountBadges accounts={preview.gcProfitAccountsStatus ?? []} />
            </div>
            <Collapsible open={model.stockTableOpen} onOpenChange={model.setStockTableOpen}>
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1 text-muted-foreground"
                  data-testid="button-toggle-stock-table"
                >
                  {model.stockTableOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  <Package className="h-4 w-4" />
                  Show stock items ({(preview.stockItems ?? []).length})
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-2 border rounded-md overflow-auto max-h-72">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Code</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Avg Cost</TableHead>
                        <TableHead className="text-right">Value</TableHead>
                        <TableHead className="text-center">Alias</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(preview.stockItems ?? []).map((item) => (
                        <TableRow key={item.code}>
                          <TableCell className="font-mono text-xs">{item.code}</TableCell>
                          <TableCell className="text-sm">{item.name}</TableCell>
                          <TableCell className="text-right text-sm">{item.quantity.toLocaleString()}</TableCell>
                          <TableCell className="text-right text-sm">${model.fmt(item.averageCostUsd)}</TableCell>
                          <TableCell className="text-right text-sm">${model.fmt(item.totalValueUsd)}</TableCell>
                          <TableCell className="text-center">
                            {item.aliasExists ? (
                              <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 mx-auto" />
                            ) : (
                              <Plus className="h-4 w-4 text-muted-foreground mx-auto" />
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Summary({ label, value, note }: { label: string; value: string | number; note: string }) {
  return (
    <div className="rounded-md border p-3 space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

function AccountBadges({ accounts }: { accounts: Array<{ subType: string; name: string; exists: boolean }> }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {accounts.map((account) => (
        <Badge key={account.subType} variant={account.exists ? "secondary" : "outline"} className="gap-1">
          {account.exists ? (
            <CheckCircle2 className="h-3 w-3 text-green-600 dark:text-green-400" />
          ) : (
            <Plus className="h-3 w-3" />
          )}
          {account.name}
        </Badge>
      ))}
    </div>
  );
}
