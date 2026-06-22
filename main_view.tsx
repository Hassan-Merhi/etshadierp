  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <PageHeader title="Brokers &amp; Suppliers" />
          <p className="text-muted-foreground mt-1">
            {brokerCount > 0 && `${brokerCount} broker${brokerCount !== 1 ? "s" : ""}`}
            {brokerCount > 0 && standaloneCount > 0 && " · "}
            {standaloneCount > 0 && `${standaloneCount} standalone`}
            {inactiveSuppliers.length > 0 && ` · ${inactiveSuppliers.length} inactive`}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {inactiveSuppliers.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowInactive(!showInactive)}
              data-testid="button-toggle-inactive"
            >
              {showInactive ? "Hide Inactive" : "Show Inactive"}
            </Button>
          )}
          <Button
            onClick={() => { resetForm(); setCreateOpen(true); }}
            data-testid="button-add-factory-supplier"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Supplier
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={activeFilter} onValueChange={(v) => setActiveFilter(v as SupplierFilter)}>
          <SelectTrigger className="w-44" data-testid="filter-dropdown">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="brokers">Brokers</SelectItem>
            <SelectItem value="standalone">Standalone</SelectItem>
            <SelectItem value="with-balance">With Balance</SelectItem>
            <SelectItem value="zero-balance">Zero Balance</SelectItem>
            <SelectItem value="has-foreign">Has Foreign Currency</SelectItem>
            <SelectItem value="has-recent">Recent Activity</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 cursor-pointer select-none" data-testid="label-list-include-otw">
          <Switch
            checked={listIncludeOtw}
            onCheckedChange={setListIncludeOtw}
            data-testid="switch-list-include-otw"
          />
          <span className="text-sm text-muted-foreground">Include OTW</span>
        </label>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border p-4">
            <div className="text-xs text-muted-foreground">Brokers</div>
            <div className="text-2xl font-bold mt-1" data-testid="text-broker-count">
              {brokerCount}
            </div>
        </div>
        <div className="rounded-xl border p-4">
            <div className="text-xs text-muted-foreground">Standalone Suppliers</div>
            <div className="text-2xl font-bold mt-1" data-testid="text-total-suppliers">
              {standaloneCount}
            </div>
        </div>
        <div className="rounded-xl border p-4">
            <div className="text-xs text-muted-foreground">Total Containers</div>
            <div className="text-2xl font-bold mt-1" data-testid="text-total-containers">
              {totalContainers}
            </div>
        </div>
        <div className="rounded-xl border p-4">
            <div className="flex items-center justify-between gap-1 flex-wrap">
              <div className="text-xs text-muted-foreground">Total USD</div>
              {listIncludeOtw && (
                <div className="text-xs text-amber-500 font-medium">incl. OTW</div>
              )}
            </div>
            <div className="mt-1 space-y-0.5">
              <div className="flex items-baseline gap-1.5 flex-wrap">
                <span className="text-xs text-muted-foreground w-14 shrink-0">We owe</span>
                <span className="text-lg font-bold tabular-nums text-foreground" data-testid="text-total-usd-owed">
                  ${totalUsdOwed.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex items-baseline gap-1.5 flex-wrap">
                <span className="text-xs text-muted-foreground w-14 shrink-0">Overpaid</span>
                <span className="text-lg font-bold tabular-nums text-green-600 dark:text-green-400" data-testid="text-total-usd-overpaid">
                  ${totalUsdOverpaid.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>
        </div>
      </div>

      <div className="rounded-xl border overflow-hidden">
          {displayedTopLevel.length > 0 ? (
            <div className="divide-y">
              {displayedTopLevel.map((s) => {
                const childAccounts = subAccountsByParent[s.id] || [];
                const hasChildren = childAccounts.length > 0;
                const isExpanded = expandedSupplierIds.has(s.id);

                const SupplierRow = ({ sup, isChild }: { sup: SupplierWithBalance; isChild?: boolean }) => {
                  const isParent = !isChild && hasChildren;
                  const handleOpen = () => {
                    if (isParent) {
                      setParentViewSupplierId(sup.id);
                    } else {
                      setStatementReturnToParent(false);
                      setStatementSupplierId(sup.id);
                    }
                  };
                  return (
                  <div
                    className={`p-4 ${!sup.isActive ? "opacity-60" : ""} ${isChild ? "bg-muted/30 pl-8 border-t" : ""}`}
                    data-testid={`row-factory-supplier-${sup.id}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {isChild && <GitBranch className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />}
                          <button
                            onClick={handleOpen}
                            className="text-base font-semibold hover:underline text-left"
                            data-testid={`link-supplier-statement-${sup.id}`}
                          >
                            {sup.name}
                          </button>
                          {!sup.isActive && <Badge variant="secondary" className="text-xs">Inactive</Badge>}
                          {!isChild && isParent && <Badge variant="secondary" className="text-xs"><Building2 className="h-3 w-3 mr-1" />Broker</Badge>}
                          {isChild && <Badge variant="outline" className="text-xs"><Link2 className="h-3 w-3 mr-1" />Linked Supplier</Badge>}
                          {sup.pendingContainers > 0 && (
                            <Badge variant="outline" className="text-xs">
                              {sup.pendingContainers} pending
                            </Badge>
                          )}
                        </div>

                        <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground flex-wrap">
                          {sup.contactPerson && (
                            <span className="flex items-center gap-1">
                              <Users className="h-3.5 w-3.5" />
                              {sup.contactPerson}
                            </span>
                          )}
                          {sup.phone && (
                            <span className="flex items-center gap-1">
                              <Phone className="h-3.5 w-3.5" />
                              {sup.phone}
                            </span>
                          )}
                          {sup.email && (
                            <span className="flex items-center gap-1">
                              <Mail className="h-3.5 w-3.5" />
                              {sup.email}
                            </span>
                          )}
                          {sup.address && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3.5 w-3.5" />
                              {sup.address}
                            </span>
                          )}
                        </div>

                        {sup.notes && (
                          <p className="text-xs text-muted-foreground mt-1 italic">{sup.notes}</p>
                        )}

                        <div className="flex items-center gap-4 mt-2 text-sm flex-wrap">
                          <span className="flex items-center gap-1" data-testid={`text-supplier-containers-${sup.id}`}>
                            <Package className="h-3.5 w-3.5 text-muted-foreground" />
                            {sup.totalContainers} container{sup.totalContainers !== 1 ? "s" : ""}
                          </span>
                          {sup.pendingContainers > 0 && (
                            <span className="flex items-center gap-1 text-amber-500" data-testid={`text-supplier-otw-${sup.id}`}>
                              <Clock className="h-3.5 w-3.5" />
                              {sup.pendingContainers} OTW
                            </span>
                          )}
                          {(sup as any).dueContainersCount > 0 && (
                            <button
                              className="flex items-center gap-1 text-red-600 dark:text-red-400 font-semibold hover:underline"
                              onClick={(e) => { e.stopPropagation(); setDueDialogSupplier({ name: sup.name, containers: (sup as any).dueContainers || [] }); }}
                              data-testid={`text-supplier-due-${sup.id}`}
                            >
                              <Clock className="h-3.5 w-3.5" />
                              {(sup as any).dueContainersCount} due
                            </button>
                          )}
                          <span className="flex items-center gap-1" data-testid={`text-supplier-kg-${sup.id}`}>
                            <Weight className="h-3.5 w-3.5 text-muted-foreground" />
                            {formatKg(sup.totalKg)}
                          </span>
                          {sup.lastContainerDate && (
                            <span className="flex items-center gap-1 text-muted-foreground">
                              <Calendar className="h-3.5 w-3.5" />
                              Last: {formatDate(sup.lastContainerDate)}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <div className="text-xs text-muted-foreground">{isParent ? "Balance" : "Balance"}</div>
                          {isParent ? (() => {
                            const exposure = ((sup as any).exposureCurrencyBalances as CurrencyBalance[]) || [];
                            const poolUsd = parseFloat(sup.brokerPoolUsd ?? "0");
                            const foreignExp = exposure.filter(e => e.currencyCode !== "USD" && Math.abs(e.balance) > 0.001);
                            const usdExp = exposure.find(e => e.currencyCode === "USD");
                            const totalUsd = parseFloat(sup.totalValue || "0");
                            return (
                              <>
                                <div className="text-lg font-bold tabular-nums" data-testid={`text-supplier-balance-${sup.id}`}>
                                  ${formatNum(totalUsd.toFixed(2))}
                                </div>
                                {(foreignExp.length > 0 || Math.abs(poolUsd) > 0.01) && (
                                  <div className="text-xs text-muted-foreground space-y-0.5 mt-0.5">
                                    {foreignExp.map(e => (
                                      <div key={e.currencyCode} className="tabular-nums">
                                        {e.currencyCode} {formatNum(e.balance.toFixed(2))} × {(e.fxRateToUsd ?? 1).toFixed(4)}
                                      </div>
                                    ))}
                                    {usdExp && usdExp.balance > 0.01 && (
                                      <div className="tabular-nums">${formatNum(usdExp.balance.toFixed(2))} linked</div>
                                    )}
                                    {Math.abs(poolUsd) > 0.01 && (
                                      <div className="tabular-nums">${formatNum(poolUsd.toFixed(2))} pool</div>
                                    )}
                                  </div>
                                )}
                              </>
                            );
                          })() : (() => {
                            const nonUsd = (sup.currencyBalances || []).filter(cb => cb.currencyCode !== "USD" && Math.abs(cb.balance) > 0.001);
                            const usdBal = (sup.currencyBalances || []).find(cb => cb.currencyCode === "USD");
                            const totalUsd = parseFloat(sup.totalValue || "0");
                            return (
                              <>
                                <div className="text-lg font-bold tabular-nums" data-testid={`text-supplier-balance-${sup.id}`}>
                                  ${formatNum(totalUsd.toFixed(2))}
                                </div>
                                {nonUsd.length > 0 && (
                                  <div className="text-xs text-muted-foreground space-y-0.5 mt-0.5">
                                    {nonUsd.map(cb => (
                                      <div key={cb.currencyCode} className="tabular-nums">
                                        {cb.currencyCode} {formatNum(cb.balance.toFixed(2))} × {(cb.fxRateToUsd ?? 1).toFixed(4)}
                                      </div>
                                    ))}
                                    {usdBal && Math.abs(usdBal.balance) > 0.01 && (
                                      <div className="tabular-nums">${formatNum(usdBal.balance.toFixed(2))} USD</div>
                                    )}
                                  </div>
                                )}
                              </>
                            );
                          })()}
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => e.stopPropagation()}
                              data-testid={`button-actions-${sup.id}`}
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                            {sup.isActive && (
                              <DropdownMenuItem
                                onClick={() => openPaymentDialog(sup)}
                                data-testid={`button-pay-supplier-${sup.id}`}
                              >
                                <DollarSign className="h-4 w-4 mr-2 text-green-600 dark:text-green-400" />
                                Record Payment
                              </DropdownMenuItem>
                            )}
                            {sup.isActive && isParent && (
                              <DropdownMenuItem
                                onClick={() => openBulkFxDialog(sup.id, sup.name)}
                                data-testid={`button-bulk-fx-${sup.id}`}
                              >
                                <Layers className="h-4 w-4 mr-2 text-blue-500" />
                                Bulk FX Settlement
                              </DropdownMenuItem>
                            )}
                            {sup.isActive && !isChild && (
                              <DropdownMenuItem
                                onClick={() => openCreateSubAccount(sup)}
                                data-testid={`button-add-subaccount-${sup.id}`}
                              >
                                <Link2 className="h-4 w-4 mr-2" />
                                Add Linked Supplier
                              </DropdownMenuItem>
                            )}
                            {sup.isActive && (
                              <DropdownMenuItem
                                onClick={() => {
                                  setObEditSupplier({ id: sup.id, name: sup.name, currentBalance: (sup as any).openingBalance || "0" });
                                  setObEditValue((sup as any).openingBalance || "0");
                                }}
                                data-testid={`button-ob-edit-supplier-${sup.id}`}
                              >
                                <BookOpen className="h-4 w-4 mr-2" />
                                Edit Opening Balance
                              </DropdownMenuItem>
                            )}
                            {sup.isActive && (
                              <DropdownMenuItem
                                onClick={() => openEdit(sup)}
                                data-testid={`button-edit-supplier-${sup.id}`}
                              >
                                <Pencil className="h-4 w-4 mr-2" />
                                Edit Supplier
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            {sup.isActive ? (
                              <DropdownMenuItem
                                onClick={() => wrapAdminAction(() => deactivateMutation.mutate(sup.id), "Hide Supplier")}
                                data-testid={`button-deactivate-supplier-${sup.id}`}
                              >
                                <EyeOff className="h-4 w-4 mr-2" />
                                Hide Supplier
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                onClick={() => reactivateMutation.mutate(sup.id)}
                                data-testid={`button-reactivate-supplier-${sup.id}`}
                              >
                                <Eye className="h-4 w-4 mr-2" />
                                Restore Supplier
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => { wrapAdminAction(() => setPendingDelete(() => () => permanentDeleteMutation.mutate(sup.id)), "Delete Supplier"); }}
                              data-testid={`button-delete-supplier-${sup.id}`}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={handleOpen}
                          data-testid={`button-view-statement-${sup.id}`}
                        >
                          <ChevronRight className="h-5 w-5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                  );
                };

                return (
                  <div key={s.id}>
                    <div className="relative">
                      <SupplierRow sup={s} />
                      {hasChildren && (
                        <button
                          onClick={() => toggleExpanded(s.id)}
                          className="absolute top-4 left-4 p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
                          data-testid={`button-expand-supplier-${s.id}`}
                        >
                          {isExpanded
                            ? <ChevronDown className="h-3.5 w-3.5" />
                            : <ChevronRight className="h-3.5 w-3.5" />}
                        </button>
                      )}
                    </div>
                    {isExpanded && childAccounts.map((child) => (
                      <SupplierRow key={child.id} sup={child} isChild />
                    ))}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="text-lg font-medium">No factory suppliers yet</p>
              <p className="text-sm mt-1">Add your first factory supplier to get started</p>
            </div>
          )}
      </div>

      {/* Payment Dialog */}
      <Dialog open={!!paymentDialogSupplier} onOpenChange={(open) => { if (!open) setPaymentDialogSupplier(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
            <DialogDescription>
              {paymentDialogSupplier
                ? `Pay to: ${paymentDialogSupplier.name} — Balance: $${formatNum(paymentDialogSupplier.totalValue)}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* Sub-account selector: if this supplier has children, show them as options */}
            {paymentDialogSupplier && (() => {
              const children = (suppliers || []).filter((s: any) => s.parentId === paymentDialogSupplier.id);
              if (children.length === 0) return null;
              return (
                <div>
                  <Label>Pay to (account)</Label>
                  <Select
                    value={String(paymentForm.supplierId)}
                    onValueChange={(v) => setPaymentForm(prev => ({ ...prev, supplierId: parseInt(v) }))}
                  >
                    <SelectTrigger data-testid="select-payment-target">
                      <SelectValue placeholder="Select account" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={String(paymentDialogSupplier.id)}>
                        {paymentDialogSupplier.name} (broker)
                      </SelectItem>
                      {children.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.name} (linked supplier)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })()}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Entry Date</Label>
                <Input
                  type="date"
                  value={paymentForm.date}
                  onChange={(e) => setPaymentForm(prev => ({ ...prev, date: e.target.value }))}
                  data-testid="input-payment-date"
                />
              </div>
              <div>
                <Label>Effective Date <span className="text-muted-foreground">(optional)</span></Label>
                <Input
                  type="date"
                  value={paymentForm.effectiveDate}
                  onChange={(e) => setPaymentForm(prev => ({ ...prev, effectiveDate: e.target.value }))}
                  data-testid="input-payment-effective-date"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Amount</Label>
                <Input
                  type="number"
                  step="any"
                  min="0"
                  placeholder="0.00"
                  value={paymentForm.amount}
                  onChange={(e) => setPaymentForm(prev => ({ ...prev, amount: e.target.value }))}
                  data-testid="input-payment-amount"
                />
              </div>
              <div>
                <Label>Currency</Label>
                <Select
                  value={paymentForm.currencyCode}
                  onValueChange={(v) => setPaymentForm(prev => ({
                    ...prev,
                    currencyCode: v,
                    fxRateToUsd: v === "USD" ? "1" : prev.fxRateToUsd,
                  }))}
                >
                  <SelectTrigger data-testid="select-payment-currency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="LBP">LBP</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                    <SelectItem value="AUD">AUD</SelectItem>
                    <SelectItem value="GBP">GBP</SelectItem>
                    <SelectItem value="TRY">TRY</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {paymentForm.currencyCode !== "USD" && (
              <div>
                <Label>FX Rate (units of {paymentForm.currencyCode} per 1 USD)</Label>
                <Input
                  type="number"
                  step="any"
                  min="0"
                  placeholder="e.g. 89000 for LBP"
                  value={paymentForm.fxRateToUsd}
                  onChange={(e) => setPaymentForm(prev => ({ ...prev, fxRateToUsd: e.target.value }))}
                  data-testid="input-payment-fx-rate"
                />
                {paymentForm.amount && paymentForm.fxRateToUsd && parseFloat(paymentForm.fxRateToUsd) > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    = ${(parseFloat(paymentForm.amount || "0") / parseFloat(paymentForm.fxRateToUsd)).toFixed(2)} USD
                  </p>
                )}
              </div>
            )}

            <div>
              <Label>Paid From Account <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
              <Select
                value={paymentForm.paidFromAccountId || "__none__"}
                onValueChange={(v) => setPaymentForm(prev => ({ ...prev, paidFromAccountId: v === "__none__" ? "" : v }))}
              >
                <SelectTrigger data-testid="select-payment-from-account">
                  <SelectValue placeholder="Skip (no account)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Skip (no account)</SelectItem>
                  {(ledgerAccounts || []).map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.code ? `${a.code} — ` : ""}{a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Notes (optional)</Label>
              <Input
                placeholder="e.g. Bank transfer ref #123"
                value={paymentForm.notes}
                onChange={(e) => setPaymentForm(prev => ({ ...prev, notes: e.target.value }))}
                data-testid="input-payment-notes"
              />
            </div>

            {isOverpayment && (
              <div
                className="rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 space-y-0.5"
                data-testid="alert-overpayment"
              >
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                  Overpayment — ${formatNum(overpaymentUsd.toFixed(2))} USD over current balance
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Outstanding balance: ${formatNum(paymentBalanceUsd.toFixed(2))} USD.
                  The excess will create a credit balance on this supplier.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentDialogSupplier(null)}>Cancel</Button>
            <Button
              onClick={() => wrapAdminAction(() => paymentMutation.mutate(paymentForm), "Record Payment")}
              disabled={!paymentForm.amount || !paymentForm.date || paymentMutation.isPending}
              variant={isOverpayment ? "destructive" : "default"}
              data-testid="button-submit-payment"
            >
              {paymentMutation.isPending ? "Saving..." : isOverpayment ? "Record Overpayment" : "Record Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen || !!editingSupplier} onOpenChange={(open) => {
        if (!open) { setCreateOpen(false); setEditingSupplier(null); resetForm(); }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingSupplier ? "Edit Supplier" : formRole === "linked" ? "Add Linked Supplier" : "Add Broker / Supplier"}
            </DialogTitle>
            <DialogDescription>
              {editingSupplier
                ? "Update supplier details"
                : formRole === "linked"
                  ? `Linked to: ${allSuppliers.find(s => s.id === formData.parentId)?.name || ""}`
                  : "Create a new broker or standalone supplier"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* Role selector — only for new entries that aren't pre-set as linked */}
            {!editingSupplier && !createSubAccountParentId && (
              <div>
                <Label>Role</Label>
                <div className="flex gap-2 mt-1">
                  {(["broker", "standalone"] as const).map(r => {
                    const roleLabel: Record<string, string> = { broker: "Broker", standalone: "Standalone Supplier" };
                    const roleIcon = r === "broker"
                      ? <Building2 className="h-3.5 w-3.5 mr-1" />
                      : <Globe className="h-3.5 w-3.5 mr-1" />;
                    return (
                      <Button
                        key={r}
                        type="button"
                        variant={formRole === r ? "default" : "outline"}
                        size="sm"
                        onClick={() => {
                          setFormRole(r);
                          setFormData(prev => ({ ...prev, parentId: null }));
                        }}
                        data-testid={`role-btn-${r}`}
                      >
                        {roleIcon}
                        {roleLabel[r]}
                      </Button>
                    );
                  })}
                </div>
                {formRole === "broker" && (
                  <p className="text-xs text-muted-foreground mt-1.5">A Broker groups linked suppliers; payments can be made at the broker or supplier level.</p>
                )}
              </div>
            )}
            {/* Broker selector — if role = linked and no parent pre-set */}
            {(formRole === "linked" && !createSubAccountParentId && !editingSupplier) && (
              <div>
                <Label>Parent Broker *</Label>
                <Select
                  value={formData.parentId ? String(formData.parentId) : ""}
                  onValueChange={(v) => setFormData(prev => ({ ...prev, parentId: parseInt(v) }))}
                >
                  <SelectTrigger data-testid="select-parent-broker">
                    <SelectValue placeholder="Select broker..." />
                  </SelectTrigger>
                  <SelectContent>
                    {topLevelSuppliers.filter(s => s.isActive).map(s => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>Name *</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Supplier name"
                data-testid="input-supplier-name"
              />
            </div>
            <div>
              <Label>Contact Person</Label>
              <Input
                value={formData.contactPerson}
                onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })}
                placeholder="Contact person name"
                data-testid="input-supplier-contact"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Phone</Label>
                <Input
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="Phone number"
                  data-testid="input-supplier-phone"
                />
              </div>
              <div>
                <Label>Email</Label>
                <Input
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="Email address"
                  data-testid="input-supplier-email"
                />
              </div>
            </div>
            <div>
              <Label>Address</Label>
              <Input
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                placeholder="Address"
                data-testid="input-supplier-address"
              />
            </div>
            <div>
              <Label>Notes</Label>
              <Input
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Notes"
                data-testid="input-supplier-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setCreateOpen(false); setEditingSupplier(null); resetForm(); }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => wrapAdminAction(handleSubmit, editingSupplier ? "Update Supplier" : "Create Supplier")}
              disabled={!formData.name || createMutation.isPending || updateMutation.isPending}
              data-testid="button-save-supplier"
            >
              {createMutation.isPending || updateMutation.isPending ? "Saving..." : editingSupplier ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* OB Commission Edit Dialog */}
      <Dialog open={!!editObComm} onOpenChange={(open) => { if (!open) setEditObComm(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5" />
              Edit OB Commission
            </DialogTitle>
            <DialogDescription>Update the opening balance commission entry.</DialogDescription>
          </DialogHeader>
          {editObComm && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label>Amount</Label>
                  <Input type="number" step="0.01" value={editObComm.amount} onChange={e => setEditObComm(p => p ? { ...p, amount: e.target.value } : null)} />
                </div>
                <div className="space-y-1">
                  <Label>Currency</Label>
                  <Input value={editObComm.currencyCode} onChange={e => setEditObComm(p => p ? { ...p, currencyCode: e.target.value.toUpperCase() } : null)} maxLength={10} />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Person / Broker</Label>
                <Input value={editObComm.personName} onChange={e => setEditObComm(p => p ? { ...p, personName: e.target.value } : null)} placeholder="Name (optional)" />
              </div>
              <div className="space-y-1">
                <Label>Notes</Label>
                <Input value={editObComm.notes} onChange={e => setEditObComm(p => p ? { ...p, notes: e.target.value } : null)} placeholder="Notes (optional)" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditObComm(null)}>Cancel</Button>
            <Button
              disabled={updateObCommissionMutation.isPending || !editObComm?.amount}
              onClick={() => wrapAdminAction(() => editObComm && updateObCommissionMutation.mutate({
                rawStockId: editObComm.rawStockId,
                commissionAmount: editObComm.amount,
                commissionCurrencyCode: editObComm.currencyCode,
                commissionPersonName: editObComm.personName,
                commissionNotes: editObComm.notes,
              }), "Save Commission")}
            >
              {updateObCommissionMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!obEditSupplier} onOpenChange={(open) => { if (!open) { setObEditSupplier(null); setObEditValue(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5" />
              Edit Opening Balance
            </DialogTitle>
            <DialogDescription>
              Overwrite the opening balance for <span className="font-semibold">{obEditSupplier?.name}</span>.
              Current value: <span className="font-mono">{obEditSupplier?.currentBalance}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Opening Balance (USD)</Label>
              <Input
                type="number"
                step="0.01"
                value={obEditValue}
                onChange={(e) => setObEditValue(e.target.value)}
                data-testid="input-ob-edit-value"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 flex-wrap">
            <Button variant="outline" onClick={() => { setObEditSupplier(null); setObEditValue(""); }} data-testid="button-ob-edit-cancel">
              Cancel
            </Button>
            <Button
              onClick={() => wrapAdminAction(() => obEditSupplier && obEditMutation.mutate({ id: obEditSupplier.id, openingBalance: obEditValue }), "Save Opening Balance")}
              disabled={obEditMutation.isPending || !obEditValue}
              data-testid="button-ob-edit-save"
            >
              {obEditMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Due Containers Dialog ── */}
      <Dialog open={!!dueDialogSupplier} onOpenChange={(open) => { if (!open) setDueDialogSupplier(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
              <Clock className="h-5 w-5" />
              Payment Due — {dueDialogSupplier?.name}
            </DialogTitle>
            <DialogDescription>
              These containers were offloaded more than 30 days ago and still have an outstanding balance.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {dueDialogSupplier?.containers.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No due containers</p>
            ) : (
              <div className="rounded-md border divide-y text-sm">
                {(dueDialogSupplier?.containers || [])
                  .slice()
                  .sort((a: any, b: any) => new Date(a.offloadDate).getTime() - new Date(b.offloadDate).getTime())
                  .map((c: any) => (
                    <div key={c.id} className="flex items-center justify-between px-3 py-2.5 gap-3">
                      <div>
                        <div className="font-medium">{c.containerNumber}</div>
                        <div className="text-xs text-muted-foreground">Offloaded: {formatDate(c.offloadDate)}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="tabular-nums font-medium">{c.currencyCode} {parseFloat(c.value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                        <div className="text-xs text-red-600 dark:text-red-400 font-medium">
                          {c.daysPastDue > 0 ? `${c.daysPastDue}d overdue` : "Due today"}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setDueDialogSupplier(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Bulk FX Settlement Dialog ── */}
      <Dialog open={bulkFxOpen} onOpenChange={(open) => { if (!open) { setBulkFxOpen(false); setBulkFxPreview(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-blue-500" />
              Bulk FX Settlement — {bulkFxBrokerName}
            </DialogTitle>
            <DialogDescription>
              {bulkFxPreview
                ? "Review the breakdown below. Each supplier's account will be debited by the amount shown."
                : "Enter a total amount in a foreign currency. It will be split across all linked suppliers, capped at each supplier's outstanding balance."}
            </DialogDescription>
          </DialogHeader>

          {bulkFxPreview ? (
            /* ── Preview step (before committing) ── */
            <div className="space-y-4">
              <div className="rounded-md border p-3 space-y-2 bg-muted/40">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total to settle</span>
                  <span className="font-semibold tabular-nums">{bulkFxForm.fromCurrencyCode} {parseFloat(bulkFxPreview.totalAllocated).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">≈ USD equivalent</span>
                  <span className="font-semibold tabular-nums text-green-600 dark:text-green-400">${parseFloat(bulkFxPreview.totalUsd || "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Account deductions</p>
                <div className="rounded-md border divide-y text-sm max-h-64 overflow-y-auto">
                  {bulkFxPreview.transfers.map((t) => {
                    const overpaid = parseFloat(t.overpayment || "0") > 0.01;
                    return (
                    <div key={t.supplierId} className="flex justify-between items-center px-3 py-2">
                      <div>
                        <div className="font-medium">{t.supplierName}</div>
                        {overpaid && (
                          <div className="text-xs text-amber-600 dark:text-amber-400">
                            incl. {bulkFxForm.fromCurrencyCode} {parseFloat(t.overpayment).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} overpayment (will show as CR)
                          </div>
                        )}
                      </div>
                      <div className="text-right space-y-0.5">
                        <div className="tabular-nums font-medium">{bulkFxForm.fromCurrencyCode} {parseFloat(t.allocated).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                        <div className="text-xs text-muted-foreground">≈ ${parseFloat(t.toAmountUsd).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</div>
                      </div>
                    </div>
                    );
                  })}
                </div>
              </div>
              <DialogFooter className="gap-2 flex-wrap">
                <Button variant="outline" onClick={() => setBulkFxPreview(null)} disabled={bulkFxMutation.isPending}>
                  Back to Edit
                </Button>
                <Button
                  onClick={() => wrapAdminAction(() => bulkFxMutation.mutate(), "Record Bulk FX Settlement")}
                  disabled={bulkFxMutation.isPending}
                  data-testid="button-bulk-fx-confirm"
                >
                  {bulkFxMutation.isPending ? "Recording..." : "Confirm & Record Settlement"}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            /* ── Form step ── */
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Currency</Label>
                  <Input
                    value={bulkFxForm.fromCurrencyCode}
                    onChange={(e) => setBulkFxForm((f) => ({ ...f, fromCurrencyCode: e.target.value.toUpperCase() }))}
                    maxLength={10}
                    placeholder="EUR"
                    data-testid="input-bulk-fx-currency"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Total Amount</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={bulkFxForm.totalAmount}
                    onChange={(e) => setBulkFxForm((f) => ({ ...f, totalAmount: e.target.value }))}
                    placeholder="e.g. 50000"
                    data-testid="input-bulk-fx-amount"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>1 {bulkFxForm.fromCurrencyCode || "CCY"} = X USD (rate)</Label>
                  <Input
                    type="number"
                    step="0.0001"
                    value={bulkFxForm.fxRateToUsd}
                    onChange={(e) => { setBulkFxForm((f) => ({ ...f, fxRateToUsd: e.target.value })); }}
                    placeholder="e.g. 1.08"
                    data-testid="input-bulk-fx-rate"
                  />
                  {bulkFxForm.totalAmount && bulkFxForm.fxRateToUsd && parseFloat(bulkFxForm.fxRateToUsd) > 0 && parseFloat(bulkFxForm.totalAmount) > 0 && (
                    <p className="text-xs text-muted-foreground">
                      ≈ ${(parseFloat(bulkFxForm.totalAmount) * parseFloat(bulkFxForm.fxRateToUsd)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label>Entry Date</Label>
                  <Input
                    type="date"
                    value={bulkFxForm.date}
                    onChange={(e) => setBulkFxForm((f) => ({ ...f, date: e.target.value }))}
                    data-testid="input-bulk-fx-date"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Container Priority</Label>
                <Select value={bulkFxForm.order} onValueChange={(v: "oldest" | "newest") => setBulkFxForm((f) => ({ ...f, order: v }))}>
                  <SelectTrigger data-testid="select-bulk-fx-order">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="oldest">Oldest containers first</SelectItem>
                    <SelectItem value="newest">Newest containers first</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Notes (optional)</Label>
                <Input
                  value={bulkFxForm.notes}
                  onChange={(e) => setBulkFxForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="e.g. March 2026 batch settlement"
                  data-testid="input-bulk-fx-notes"
                />
              </div>
              <DialogFooter className="gap-2 flex-wrap">
                <Button variant="outline" onClick={() => setBulkFxOpen(false)}>Cancel</Button>
                <Button
                  onClick={() => bulkFxPreviewMutation.mutate()}
                  disabled={
                    bulkFxPreviewMutation.isPending ||
                    !bulkFxForm.fromCurrencyCode ||
                    !bulkFxForm.totalAmount ||
                    parseFloat(bulkFxForm.totalAmount) <= 0 ||
                    !bulkFxForm.fxRateToUsd ||
                    parseFloat(bulkFxForm.fxRateToUsd) <= 0
                  }
                  data-testid="button-bulk-fx-preview"
                >
                  {bulkFxPreviewMutation.isPending ? "Loading preview..." : "Preview Settlement"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <DeleteConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        onConfirm={() => { pendingDelete?.(); setPendingDelete(null); }}
      />
      {AdminDialog}
    </div>
  );
}
