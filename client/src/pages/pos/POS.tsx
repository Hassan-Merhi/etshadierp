import { useEffect, useMemo, useRef } from "react";
import { useLocation as useLocationContext } from "@/contexts/LocationContext";
import { useCompany } from "@/contexts/CompanyContext";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useCurrencyContext, type Currency } from "@/contexts/CurrencyContext";
import { useToast } from "@/hooks/use-toast";

import { SaleGrid } from "./pos-components/SaleGrid";
import { InventoryPicker } from "./pos-components/InventoryPicker";
import { InvoiceTemplate } from "./pos-components/InvoiceTemplate";
import { POSDialogs } from "./pos-components/POSDialogs";
import { POSHeader } from "./pos-components/POSHeader";
import { PosCheckoutStrip } from "./pos-components/PosCheckoutStrip";
import { PosMobileLayout } from "./pos-components/PosMobileLayout";

import { usePosState } from "./hooks/usePosState";
import { usePosQueries } from "./hooks/usePosQueries";
import { usePosWhatsApp } from "./hooks/usePosWhatsApp";
import { usePosMutations } from "./hooks/usePosMutations";
import { usePosAutosave } from "./hooks/usePosAutosave";
import { usePosHandlers } from "./hooks/usePosHandlers";

import { POS_COLUMNS, formatDisplayAmount } from "./utils/posCalculations";

export default function POS({ posUser, editVoucherId }: { posUser?: any; editVoucherId?: string } = {}) {
  const { selectedLocation, setSelectedLocation } = useLocationContext();
  const { selectedCompany } = useCompany();
  const [_location, navigate] = useLocation();
  const { toast } = useToast();
  const { selectedCurrency, exchangeRate: dailyExchangeRate, displayCurrency } = useCurrencyContext();

  // ── All state & refs ───────────────────────────────────────────────────────
  const {
    posSelectedLocation, setPosSelectedLocation,
    rows, setRows,
    selectedCell, setSelectedCell,
    paymentAccountType, setPaymentAccountType,
    paymentAccountId, setPaymentAccountId,
    isCreditSale, setIsCreditSale,
    selectedCustomerId, setSelectedCustomerId,
    notes, setNotes,
    saleDate, setSaleDate,
    searchTerm, setSearchTerm,
    activeRow, setActiveRow,
    highlightedIndex, setHighlightedIndex,
    zeroStockAlert, setZeroStockAlert,
    zeroStockItem, setZeroStockItem,
    savedSale, setSavedSale,
    showPrintDialog, setShowPrintDialog,
    showDraftDialog, setShowDraftDialog,
    currentDraftId, setCurrentDraftId,
    customerComboOpen, setCustomerComboOpen,
    mobileCustomerComboOpen, setMobileCustomerComboOpen,
    setSaleJustCompleted,
    showStockPrompt, setShowStockPrompt,
    invoiceWaStatus, setInvoiceWaStatus,
    stockWaStatus, setStockWaStatus,
    setSendingInvoiceWhatsApp,
    sendingInvoiceWhatsApp,
    setSendingWhatsApp,
    sendingWhatsApp,
    lastAutosaved, setLastAutosaved,
    pendingAutoSend, setPendingAutoSend,
    pendingStockSend, setPendingStockSend,
    setMobileTab,
    inputRefs,
    itemListRef,
    printRef,
    stockPrintRef,
    clearActiveRowTimerRef,
    clientSaleIdRef,
    lastSavedFingerprintRef,
    autoSaveInProgressRef,
    mobileSearchInputRef,
    autoSaveStateRef,
  } = usePosState();

  const activeLocation = posUser ? posSelectedLocation : selectedLocation;
  const activeCurrency: Currency = displayCurrency ? selectedCurrency : "USD";
  const exchangeRate = dailyExchangeRate;
  // Supplier Partner companies share this exact POS UI but sell from SP stock
  // (sp_stock_movements) and post through the SP-specific accounting endpoint.
  const isSpCompany = selectedCompany?.companyType === "supplier_partner";

  // ── Queries ────────────────────────────────────────────────────────────────
  const {
    posAssignedLocations,
    posLocationsLoading,
    allLocations,
    companySettings,
    apiInventory,
    inventory,
    bankAccounts,
    allLedgerAccounts,
    cashLedgerAccounts,
    customerAccounts,
    drafts,
    refetchDrafts,
    currentShift,
    authUser,
    lastSoldPrices,
    posCustomers,
    editVoucher,
    editVoucherLoading,
    editVoucherViewEntries,
    stockInventory,
    stockInventoryLoading,
  } = usePosQueries({
    posUser,
    activeLocation,
    isCreditSale,
    editVoucherId,
    showPrintDialog,
    showStockPrompt,
    isSpCompany,
  });

  // Supplier Partner sales support cash or bank settlement, same as normal
  // ERP POS — but never credit: /api/sp/sales has no credit-sale support.
  // Enforce only the credit restriction in state (not just hidden UI) so a
  // lingering credit toggle from a prior company can never leak through.
  useEffect(() => {
    if (!isSpCompany) return;
    setIsCreditSale(false);
  }, [isSpCompany]);

  // Keep autoSaveStateRef in sync
  autoSaveStateRef.current.activeLocation = activeLocation;
  autoSaveStateRef.current.rows = rows;
  autoSaveStateRef.current.notes = notes;
  autoSaveStateRef.current.isCreditSale = isCreditSale;
  autoSaveStateRef.current.paymentAccountType = paymentAccountType;
  autoSaveStateRef.current.paymentAccountId = paymentAccountId;
  autoSaveStateRef.current.selectedCustomerId = selectedCustomerId;
  autoSaveStateRef.current.currentDraftId = currentDraftId;

  // ── Effects ────────────────────────────────────────────────────────────────

  // Auto-select first POS location
  useEffect(() => {
    if (posUser && posAssignedLocations.length > 0 && !posSelectedLocation) {
      setPosSelectedLocation(posAssignedLocations[0]);
    }
  }, [posUser, posAssignedLocations, posSelectedLocation]);

  // Set default cash account for POS users from location mapping — applies to
  // Supplier Partner companies too, same as normal ERP POS.
  useEffect(() => {
    if (editVoucherId) return;
    const locCashId = (posSelectedLocation as any)?.cashAccountId;
    if (posUser && locCashId) {
      setPaymentAccountType("cash");
      setPaymentAccountId(String(locCashId));
    }
  }, [posUser, posSelectedLocation, editVoucherId]);

  // Auto-attach to today's draft
  useEffect(() => {
    if (currentDraftId !== null) return;
    if (!Array.isArray(drafts) || drafts.length === 0) return;
    const todayUTC = new Date().toISOString().slice(0, 10);
    const todayDraft = drafts.find((d: any) => {
      const rawDate = d.updatedAt || d.createdAt;
      if (!rawDate) return false;
      const dateObj = new Date(rawDate);
      if (isNaN(dateObj.getTime())) return false;
      return dateObj.toISOString().slice(0, 10) === todayUTC;
    });
    if (todayDraft) setCurrentDraftId(todayDraft.id);
  }, [drafts]);

  // Set location from edit voucher
  useEffect(() => {
    if (editVoucher && editVoucher.locationId && !selectedLocation && allLocations.length > 0) {
      const voucherLocation = allLocations.find((loc) => loc.id === editVoucher.locationId);
      if (voucherLocation) setSelectedLocation(voucherLocation);
    }
  }, [editVoucher, allLocations, selectedLocation, setSelectedLocation]);

  // Guard: rows + notes + date are only populated ONCE per edit session.
  // Without this, any dependency change (e.g. allLedgerAccounts re-fetching on
  // window focus) would call setRows() again and wipe the user's in-progress edits.
  const editRowsInitRef = useRef(false);

  // Effect 1: Populate rows / notes / date from the voucher — runs once.
  useEffect(() => {
    if (!editVoucherId) { editRowsInitRef.current = false; return; }
    if (editRowsInitRef.current) return; // already populated; never reset user edits

    // Primary source: salesItems attached to the voucher object.
    // Fallback: view-entries endpoint (populated when salesItems is missing from the voucher).
    const resolvedItems: any[] = Array.isArray(editVoucher?.salesItems) && editVoucher.salesItems.length > 0
      ? editVoucher.salesItems
      : (editVoucherViewEntries ?? [])
          .filter((e: any) => e.isStockItem || e.stockItemId)
          .map((e: any) => ({
            id: e.id,
            stockItemId: e.stockItemId,
            stockItemName: e.stockItemName || e.accountName || "",
            stockItemCode: e.stockItemCode || e.accountCode || "",
            quantity: e.quantity,
            sellingPrice: e.rate ?? e.sellingPrice ?? "0",
            totalSales: e.totalAmount ?? e.totalSales ?? e.creditAmount ?? "0",
            costPrice: e.costPrice,
            configuredPrice: e.configuredPrice,
          }));

    if (!editVoucher || resolvedItems.length === 0) return;

    const newRows = resolvedItems.map((item: any, index: number) => ({
      id: String(index + 1),
      itemName: item.stockItemName || "",
      stockItemCode: item.stockItemCode || "",
      // Ensure stockItemId is always a number (guard against 0/null from old data)
      stockItemId: item.stockItemId ? Number(item.stockItemId) : undefined,
      salesItemId: item.id,
      quantity: parseFloat(item.quantity),
      rate: parseFloat(item.sellingPrice),
      rateUSD: parseFloat(item.sellingPrice),
      amount: parseFloat(item.totalSales),
      configuredPrice: parseFloat(item.configuredPrice || "0") || undefined,
    }));
    newRows.push({
      id: String(newRows.length + 1),
      itemName: "",
      stockItemCode: "",
      stockItemId: undefined,
      salesItemId: undefined,
      quantity: 0,
      rate: 0,
      rateUSD: 0,
      amount: 0,
      configuredPrice: undefined,
    });
    setRows(newRows);
    editRowsInitRef.current = true;

    if (editVoucher.description) setNotes(editVoucher.description);
    if (editVoucher.voucherDate) setSaleDate(editVoucher.voucherDate);
  }, [editVoucherId, editVoucher, editVoucherViewEntries]);

  // Effect 2: Detect payment account type once ledger accounts are available.
  // This is separate from Effect 1 so that ledger-account re-fetches never
  // reset the rows the user is actively editing.
  useEffect(() => {
    if (!editVoucher || !editVoucher.entries || editVoucher.entries.length === 0) return;

    const debitEntry = editVoucher.entries.find((e: any) => parseFloat(e.debitAmount || "0") > 0);
    if (!debitEntry) return;

    if (debitEntry.bankAccountId) {
      setPaymentAccountType("bank");
      setPaymentAccountId(String(debitEntry.bankAccountId));
      setIsCreditSale(false);
    } else if (debitEntry.ledgerAccountId) {
      const ledgerAccount = allLedgerAccounts.find((acc: any) => acc.id === debitEntry.ledgerAccountId);
      if (ledgerAccount) {
        if (ledgerAccount.accountType === "Cash") {
          setPaymentAccountType("cash");
          setPaymentAccountId(String(debitEntry.ledgerAccountId));
          setIsCreditSale(false);
        } else {
          setPaymentAccountType("credit");
          setPaymentAccountId(String(debitEntry.ledgerAccountId));
          setIsCreditSale(true);
          setSelectedCustomerId(String(debitEntry.ledgerAccountId));
        }
      } else {
        const isCreditSaleEntry = debitEntry.narration?.includes("Credit Sale");
        if (isCreditSaleEntry) {
          setPaymentAccountType("credit");
          setIsCreditSale(true);
          setSelectedCustomerId(String(debitEntry.ledgerAccountId));
        } else {
          setPaymentAccountType("cash");
          setIsCreditSale(false);
        }
        setPaymentAccountId(String(debitEntry.ledgerAccountId));
      }
    }
  }, [editVoucher, allLedgerAccounts]);

  // ── WhatsApp / mutations / autosave ───────────────────────────────────────
  const { handleSendInvoiceWhatsApp, handleSendWhatsAppReport } = usePosWhatsApp({
    pendingAutoSend,
    setPendingAutoSend,
    pendingStockSend,
    setPendingStockSend,
    activeLocation,
    savedSale,
    setInvoiceWaStatus,
    setStockWaStatus,
    setSendingInvoiceWhatsApp,
    setSendingWhatsApp,
    toast,
  });

  const hasValidItems = useMemo(() => rows.some((row) => row.stockItemId && row.quantity > 0), [rows]);

  const { saveMutation, deleteDraftMutation, saveDraftMutation } = usePosMutations({
    activeLocation,
    editVoucherId,
    editVoucher,
    isSpCompany,
    clientSaleIdRef,
    rows,
    isCreditSale,
    paymentAccountType,
    paymentAccountId,
    selectedCustomerId,
    currentDraftId,
    notes,
    lastSavedFingerprintRef,
    setSavedSale,
    setSaleJustCompleted,
    setShowPrintDialog,
    setCurrentDraftId,
    setLastAutosaved,
    setPendingAutoSend,
    setPendingStockSend,
    setStockWaStatus,
    toast,
    refetchDrafts,
  });

  // Keep saveDraftIsPending in sync
  autoSaveStateRef.current.saveDraftIsPending = saveDraftMutation.isPending;

  usePosAutosave({
    autoSaveStateRef,
    autoSaveInProgressRef,
    lastSavedFingerprintRef,
    setCurrentDraftId,
    setLastAutosaved,
    refetchDrafts,
  });

  // ── Handlers ──────────────────────────────────────────────────────────────
  const {
    focusCell,
    handlePrint,
    handleStockPrint,
    handleSaveSale,
    handleNewSale,
    selectItem,
    updateRow,
    handleLoadDraft,
    handleExportInventory,
    handleSummaryExport,
    handleDetailedExport,
    makeHandleKeyDown,
  } = usePosHandlers({
    rows, isCreditSale, paymentAccountType, paymentAccountId,
    selectedCustomerId, currentDraftId, notes, saleDate,
    activeRow, highlightedIndex,
    setRows, setSelectedCell, setNotes,
    setPaymentAccountType, setPaymentAccountId,
    setIsCreditSale, setSelectedCustomerId,
    setCurrentDraftId, setShowDraftDialog, setShowPrintDialog,
    setSavedSale, setSaleJustCompleted, setLastAutosaved, setMobileTab,
    setPendingStockSend, setStockWaStatus, setInvoiceWaStatus,
    setZeroStockItem, setZeroStockAlert, setSearchTerm, setHighlightedIndex,
    lastSavedFingerprintRef, inputRefs, printRef, stockPrintRef, clientSaleIdRef,
    activeCurrency, exchangeRate, dailyExchangeRate,
    activeLocation, editVoucherId, editVoucher,
    inventory, apiInventory, lastSoldPrices,
    currentShift, authUser, posUser,
    saveMutation, toast,
  });

  const handleKeyDown = makeHandleKeyDown(searchTerm);
  const fmtAmount = (v: number) => formatDisplayAmount(activeCurrency, v);

  // ── Early returns ─────────────────────────────────────────────────────────
  if (posUser && posLocationsLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 gap-4">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        <p className="text-muted-foreground text-sm">Loading location...</p>
      </div>
    );
  }

  if (posUser && !posLocationsLoading && posAssignedLocations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 gap-2">
        <p className="font-semibold">No location assigned</p>
        <p className="text-muted-foreground text-sm">Contact your administrator to be assigned to a location.</p>
      </div>
    );
  }

  if (!activeLocation && !posUser && !editVoucherId) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 gap-6">
        <h1 className="text-3xl font-bold">Point of Sale</h1>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full max-w-4xl">
          {allLocations.map((loc) => (
            <Card key={loc.id} className="p-6 cursor-pointer hover-elevate" onClick={() => setSelectedLocation(loc)}>
              <h3 className="text-lg font-bold">{loc.name}</h3>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-background overflow-hidden relative">
      <POSHeader
        posUser={posUser}
        editVoucherId={editVoucherId}
        activeLocation={activeLocation}
        showPosImport={!posUser || companySettings?.posExcelImportEnabled}
        onExportInventory={handleExportInventory}
        onImportClick={() => navigate("/pos-import")}
        onShowStockReport={() => setShowStockPrompt(true)}
        navigate={navigate}
        saveMutation={saveMutation}
        hasValidItems={hasValidItems}
        handleSaveSale={handleSaveSale}
        lastAutosaved={lastAutosaved}
        drafts={drafts}
        onOpenDraftDialog={() => setShowDraftDialog(true)}
        onUpdateDraft={() => saveDraftMutation.mutate(undefined)}
        onSummaryExport={handleSummaryExport}
        onDetailedExport={handleDetailedExport}
      />

      <PosCheckoutStrip
        posUser={posUser}
        activeLocation={activeLocation}
        allLocations={allLocations}
        posAssignedLocations={posAssignedLocations}
        posSelectedLocation={posSelectedLocation}
        setPosSelectedLocation={setPosSelectedLocation}
        setSelectedLocation={setSelectedLocation}
        saleDate={saleDate}
        setSaleDate={setSaleDate}
        paymentAccountType={paymentAccountType}
        setPaymentAccountType={setPaymentAccountType}
        paymentAccountId={paymentAccountId}
        setPaymentAccountId={setPaymentAccountId}
        isCreditSale={isCreditSale}
        setIsCreditSale={setIsCreditSale}
        customerComboOpen={customerComboOpen}
        setCustomerComboOpen={setCustomerComboOpen}
        selectedCustomerId={selectedCustomerId}
        setSelectedCustomerId={setSelectedCustomerId}
        customerAccounts={customerAccounts}
        bankAccounts={bankAccounts}
        cashLedgerAccounts={cashLedgerAccounts}
        isSpCompany={isSpCompany}
      />

      {/* ── Desktop layout ── */}
      <div className="hidden lg:flex flex-1 overflow-hidden p-4">
        <div className="flex flex-row gap-4 h-full w-full">
          <div className="flex-1 flex flex-col overflow-y-auto min-w-0">
            <div>
              <SaleGrid
                rows={rows}
                columns={POS_COLUMNS}
                selectedCell={selectedCell}
                setSelectedCell={setSelectedCell}
                updateRow={updateRow}
                handleDeleteRow={(i) => setRows(rows.filter((_, idx) => idx !== i))}
                handleKeyDown={handleKeyDown}
                setActiveRow={setActiveRow}
                setSearchTerm={setSearchTerm}
                setHighlightedIndex={setHighlightedIndex}
                getStockWarning={() => null}
                formatDisplayAmount={fmtAmount}
                activeCurrency={activeCurrency}
                exchangeRate={exchangeRate}
                inputRefs={inputRefs}
                clearActiveRowTimerRef={clearActiveRowTimerRef}
                focusCell={focusCell}
                toast={toast}
                isEditMode={!!editVoucherId}
              />
            </div>
            <div className="mt-2 px-1 pb-2">
              <Textarea
                placeholder="Notes (optional)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="resize-none h-12 min-h-[48px] text-sm"
                data-testid="input-notes"
              />
            </div>
          </div>
          <InventoryPicker
            inventory={inventory}
            selectItem={selectItem}
            itemListRef={itemListRef}
            highlightedIndex={highlightedIndex}
            syncTerm={searchTerm}
          />
        </div>
      </div>

      {/* ── Mobile layout ── */}
      <PosMobileLayout
        posUser={posUser}
        activeLocation={activeLocation}
        allLocations={allLocations}
        posAssignedLocations={posAssignedLocations}
        posSelectedLocation={posSelectedLocation}
        setPosSelectedLocation={setPosSelectedLocation}
        setSelectedLocation={setSelectedLocation}
        saleDate={saleDate}
        setSaleDate={setSaleDate}
        paymentAccountType={paymentAccountType}
        setPaymentAccountType={setPaymentAccountType}
        paymentAccountId={paymentAccountId}
        setPaymentAccountId={setPaymentAccountId}
        bankAccounts={bankAccounts}
        cashLedgerAccounts={cashLedgerAccounts}
        isCreditSale={isCreditSale}
        setIsCreditSale={setIsCreditSale}
        mobileCustomerComboOpen={mobileCustomerComboOpen}
        setMobileCustomerComboOpen={setMobileCustomerComboOpen}
        selectedCustomerId={selectedCustomerId}
        setSelectedCustomerId={setSelectedCustomerId}
        customerAccounts={customerAccounts}
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        mobileSearchInputRef={mobileSearchInputRef}
        inventory={inventory}
        selectItem={selectItem}
        rows={rows}
        setRows={setRows}
        updateRow={updateRow}
        notes={notes}
        setNotes={setNotes}
        saveMutation={saveMutation}
        hasValidItems={hasValidItems}
        handleSaveSale={handleSaveSale}
        formatDisplayAmount={fmtAmount}
        isSpCompany={isSpCompany}
      />

      <POSDialogs
        zeroStockAlert={zeroStockAlert}
        setZeroStockAlert={setZeroStockAlert}
        zeroStockItem={zeroStockItem}
        showDraftDialog={showDraftDialog}
        setShowDraftDialog={setShowDraftDialog}
        drafts={drafts}
        handleLoadDraft={handleLoadDraft}
        deleteDraftMutation={deleteDraftMutation}
        showPrintDialog={showPrintDialog}
        setShowPrintDialog={setShowPrintDialog}
        editVoucherId={editVoucherId}
        handleNewSale={handleNewSale}
        navigate={navigate}
        activeLocation={activeLocation}
        invoiceWaStatus={invoiceWaStatus}
        handleSendInvoiceWhatsApp={handleSendInvoiceWhatsApp}
        sendingInvoiceWhatsApp={sendingInvoiceWhatsApp}
        stockWaStatus={stockWaStatus}
        handleSendStockWhatsApp={handleSendWhatsAppReport}
        sendingWhatsApp={sendingWhatsApp}
        handlePrint={handlePrint}
        isCreditSale={isCreditSale}
        showStockPrompt={showStockPrompt}
        setShowStockPrompt={setShowStockPrompt}
        stockInventoryLoading={stockInventoryLoading}
        handleStockPrint={handleStockPrint}
        handleSendWhatsAppReport={handleSendWhatsAppReport}
        stockInventory={(stockInventory as any[]).map((item: any) => ({
          stockItemName: item.stockItemName,
          stockItemCode: item.stockItemCode,
          stock: parseFloat(item.quantity),
        }))}
        stockPrintRef={stockPrintRef}
      />

      <InvoiceTemplate
        printRef={printRef}
        savedSale={savedSale}
        printUserName={posUser?.fullName || authUser?.fullName || "User"}
        selectedCompany={selectedCompany}
        exchangeRate={exchangeRate}
        fmtPrint={(v) => String(v)}
        fmtPrintCurrency={(v) => String(v)}
      />
    </div>
  );
}
