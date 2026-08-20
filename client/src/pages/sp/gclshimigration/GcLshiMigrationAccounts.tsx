import { CheckCircle2, DollarSign, Plus, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { useGcLshiMigrationModel } from "./useGcLshiMigrationModel";

type MigrationModel = ReturnType<typeof useGcLshiMigrationModel>;

export function GcLshiMigrationAccountPlan({ model }: { model: MigrationModel }) {
  if (!model.targetCompanyId) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <DollarSign className="h-4 w-4" />
          Step 3 — Chart of Accounts
        </CardTitle>
        <CardDescription>
          Review the accounts that will be created in {model.targetComp?.name ?? "the target company"}. Rename any
          code/name before creating — names cannot be changed here after creation.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {model.accountPlanLoading && (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <RefreshCw className="h-4 w-4 animate-spin" /> Loading account plan…
          </div>
        )}
        {model.accountPlan && (
          <>
            <div className="border rounded-md overflow-auto max-h-80">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {model.accountPlan.accounts.map((account) => {
                    const edit = model.accountEdits[account.subType] ?? {
                      code: account.currentCode,
                      name: account.currentName,
                    };
                    return (
                      <TableRow key={account.subType}>
                        <TableCell>
                          {account.exists ? (
                            <Badge variant="secondary" className="gap-1">
                              <CheckCircle2 className="h-3 w-3 text-green-600 dark:text-green-400" /> Exists
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="gap-1">
                              <Plus className="h-3 w-3" /> New
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Input
                            className="h-8 w-28 font-mono text-xs"
                            value={edit.code}
                            disabled={account.exists}
                            onChange={(event) =>
                              model.setAccountEdits((previous) => ({
                                ...previous,
                                [account.subType]: { ...edit, code: event.target.value },
                              }))
                            }
                            data-testid={`input-account-code-${account.subType}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            className="h-8 w-56 text-sm"
                            value={edit.name}
                            disabled={account.exists}
                            onChange={(event) =>
                              model.setAccountEdits((previous) => ({
                                ...previous,
                                [account.subType]: { ...edit, name: event.target.value },
                              }))
                            }
                            data-testid={`input-account-name-${account.subType}`}
                          />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{account.accountType}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <Button
              variant="outline"
              onClick={() => {
                const accounts =
                  model.accountPlan?.accounts
                    .filter((account) => !account.exists)
                    .map((account) => {
                      const edit = model.accountEdits[account.subType];
                      return {
                        subType: account.subType,
                        code: edit?.code ?? account.currentCode,
                        name: edit?.name ?? account.currentName,
                      };
                    }) ?? [];
                if (!accounts.length) {
                  model.toast({ title: "Nothing to create", description: "All accounts already exist." });
                  return;
                }
                model.createAccountsMutation.mutate({ targetCompanyId: model.targetCompanyId, accounts });
              }}
              disabled={model.createAccountsMutation.isPending}
              data-testid="button-create-accounts"
            >
              {model.createAccountsMutation.isPending ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              Create Missing Accounts
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function GcLshiMigrationOpeningBalance({ model }: { model: MigrationModel }) {
  if (!model.targetCompanyId) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <DollarSign className="h-4 w-4" />
          Opening Cash Balance (optional)
        </CardTitle>
        <CardDescription>Creates a Journal voucher: Dr Cash → Cr Opening Balance Clearing.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
          <div className="space-y-1">
            <Label>Cash / Bank Account</Label>
            {(model.cashAccountsData?.accounts ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No Cash or Bank accounts found in target company. Run the migration first to create SP accounts, or add
                a Cash account manually.
              </p>
            ) : (
              <select
                className="w-full border rounded-md h-9 px-3 text-sm bg-background"
                value={model.obCashAccountId ?? ""}
                onChange={(event) => model.setObCashAccountId(event.target.value ? Number(event.target.value) : null)}
                data-testid="select-ob-cash-account"
              >
                <option value="">— select cash/bank account —</option>
                {(model.cashAccountsData?.accounts ?? []).map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} ({account.account_type})
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="ob-amount">Amount (USD)</Label>
            <Input
              id="ob-amount"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={model.obAmount}
              onChange={(event) => model.setObAmount(event.target.value)}
              data-testid="input-ob-amount"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ob-date">Date</Label>
            <Input
              id="ob-date"
              type="date"
              value={model.obDate}
              onChange={(event) => model.setObDate(event.target.value)}
              data-testid="input-ob-date"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ob-narration">Narration</Label>
            <Input
              id="ob-narration"
              value={model.obNarration}
              onChange={(event) => model.setObNarration(event.target.value)}
              data-testid="input-ob-narration"
            />
          </div>
        </div>
        <Button
          className="mt-3"
          onClick={() =>
            model.openingBalanceMutation.mutate({
              targetCompanyId: model.targetCompanyId,
              cashAccountId: model.obCashAccountId,
              amount: model.obAmount,
              date: model.obDate,
              narration: model.obNarration,
            })
          }
          disabled={
            !model.obCashAccountId || !model.obAmount || !model.obDate || model.openingBalanceMutation.isPending
          }
          data-testid="button-submit-opening-balance"
        >
          {model.openingBalanceMutation.isPending ? (
            <>
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              Saving…
            </>
          ) : (
            <>
              <DollarSign className="h-4 w-4 mr-2" />
              Post Opening Balance
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
