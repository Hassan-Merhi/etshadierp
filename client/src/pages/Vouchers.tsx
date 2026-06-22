import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { useLocation } from "wouter";
import { useCompany } from "@/contexts/CompanyContext";
import { VoucherEditDialog } from "@/components/VoucherEditDialog";
import { useVoucherEntries } from "@/hooks/useVoucherEntries";
import { PaymentVoucherTab } from "@/components/vouchers/PaymentVoucherTab";
import { ReceiptVoucherTab } from "@/components/vouchers/ReceiptVoucherTab";
import { CreditNoteTab } from "@/components/vouchers/CreditNoteTab";
import { CreateAccountModal } from "@/components/vouchers/CreateAccountModal";
import { PageHeader } from "@/components/PageHeader";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { useAppMode, useModePrefix } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";
import { VoucherSidebarPanel } from "./vouchers/VoucherSidebarPanel";
import { JournalForm } from "./vouchers/JournalForm";
import { StockTransferForm } from "./vouchers/StockTransferForm";
import { StockAdjustmentForm } from "./vouchers/StockAdjustmentForm";
import { ApproveRevisionDialog } from "./vouchers/ApproveRevisionDialog";
import { SaveRevisionDialog } from "./vouchers/SaveRevisionDialog";
import { StockTransferImportDialog } from "./vouchers/StockTransferImportDialog";
import { VoucherListPanel } from "./vouchers/VoucherListPanel";
import StockTransferOrder from "@/pages/StockTransferOrder";
import { formatNumber } from "@/lib/formatNumber";

import {
  BankAccount,
  LedgerAccount,
  Supplier,
  Customer,
  Employee,
  FixedAsset,
  FactorySupplierBasic,
  StockItem,
  Location,
  JournalFormData,
  StockTransferFormData,
  StockAdjustmentFormData,
  journalFormSchema,
  stockTransferFormSchema,
  stockAdjustmentFormSchema,
} from "./vouchers/voucherTypes";

interface VouchersProps {
  posUser?: {
    id: number;
    username: string;
    assignedLocationId?: number;
  };
}

export default function Vouchers({ posUser }: VouchersProps = {}) {
  const { toast } = useToast();
  const { selectedCompany } = useCompany();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);
  const isFactoryCompany = selectedCompany?.companyType === "factory";
  const { formatAmount, selectedCurrency, convertToUSD } = useCurrencyContext();
  const [location, setLocation] = useLocation();
  const isPOS = !!posUser;
  const posLocationId = posUser?.assignedLocationId;

  const searchParams = new URLSearchParams(window.location.search);
  const editParam = searchParams.get('edit');
  const tabParam = searchParams.get('tab');
  const voucherIdToEdit = editParam ? parseInt(editParam) : null;
  
  const [activeTab, setActiveTab] = useState<any>((tabParam as any) || "payment");
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [accountPickersNeeded, setAccountPickersNeeded] = useState(() => !!voucherIdToEdit);

  const isFactoryMode = appMode === "factory";
  const modePrefix = useModePrefix();

  useEffect(() => {
    if (tabParam) setActiveTab(tabParam as any);
  }, [tabParam]);

  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [selectedAccountType, setSelectedAccountType] = useState<string | null>(null);
  const [activeRowIndex, setActiveRowIndex] = useState<number | null>(null);

  const { data: bankAccounts = [] } = useQuery<BankAccount[]>({ queryKey: ["/api/bank-accounts", selectedCompany?.id] });
  const { data: ledgerAccounts = [] } = useQuery<LedgerAccount[]>({ queryKey: ["/api/ledger-accounts", selectedCompany?.id] });
  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers", selectedCompany?.id],
    enabled: accountPickersNeeded && !!selectedCompany,
  });
  const { data: factorySuppliersList = [] } = useQuery<FactorySupplierBasic[]>({
    queryKey: ["/api/factory/suppliers", selectedCompany?.id],
    enabled: isFactoryCompany,
  });
  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers", selectedCompany?.id],
    enabled: accountPickersNeeded && !!selectedCompany,
  });

  const needsStockData = isPOS || activeTab === "transfer" || activeTab === "transferorder" || activeTab === "adjustment";
  const { data: stockItems = [] } = useQuery<StockItem[]>({
    queryKey: ["/api/stock-items", selectedCompany?.id],
    enabled: needsStockData,
  });
  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations", selectedCompany?.id],
    enabled: needsStockData,
  });

  const { data: myLocations = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/my-locations"],
    enabled: isPOS,
  });

  const { data: employees = [] } = useQuery<Employee[]>({ queryKey: ["/api/employees", selectedCompany?.id] });
  const { data: fixedAssets = [] } = useQuery<FixedAsset[]>({ queryKey: ["/api/fixed-assets", selectedCompany?.id] });

  const { data: sidebarAccounts = [] } = useQuery<any[]>({ queryKey: ["/api/accounts/voucher-sidebar", selectedCompany?.id] });
  const { data: voucherToEdit } = useQuery({
    queryKey: ["/api/vouchers", voucherIdToEdit],
    enabled: !!voucherIdToEdit,
  });

  const { data: stockTransferToEdit } = useQuery({
    queryKey: ["/api/stock-transfers", voucherIdToEdit],
    enabled: !!voucherIdToEdit && (tabParam === "transfer" || activeTab === "transfer"),
  });

  const { data: transferRevisions = [] } = useQuery<any[]>({
    queryKey: ["/api/stock-transfers", stockTransferToEdit?.id, "revisions"],
    enabled: !!stockTransferToEdit?.id,
  });

  const { data: stockAdjustmentToEdit } = useQuery({
    queryKey: ["/api/stock-adjustments", voucherIdToEdit],
    enabled: !!voucherIdToEdit && (tabParam === "adjustment" || activeTab === "adjustment"),
  });


  const {
    form,
    fieldArray,
    entries,
    total,
    onSubmit,
    accountBalance,
    paymentAccountId,
    paymentAccountType,
    paymentAccountName,
    hasPaymentDraft,
    paymentDraftAge,
    discardPaymentDraft,
    accountCurrencyBalances,
  } = useVoucherEntries({
    activeTab: activeTab as any,
    voucherIdToEdit,
    voucherToEdit,
    modeApiRequest,
    onSuccess: (data) => {
      if (voucherIdToEdit) setLocation(`${modePrefix}/daybook`);
    }
  });

  const journalForm = useForm<JournalFormData>({
    resolver: zodResolver(journalFormSchema),
    defaultValues: { voucherDate: new Date(), entries: [{ type: "DR", accountType: "ledger", accountId: 0, accountName: "", amount: "" }], notes: "", optional: false },
  });

  const { append: appendJournal, remove: removeJournal } = useFieldArray({ control: journalForm.control, name: "entries" });
  const journalEntries = journalForm.watch("entries");
  const totalDebit = journalEntries.filter(e => e.type === "DR").reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
  const totalCredit = journalEntries.filter(e => e.type === "CR").reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);

  const [activeJournalRow, setActiveJournalRow] = useState<number | null>(null);
  const [journalAccountSearchTerm, setJournalAccountSearchTerm] = useState("");
  const [showAccountSidebar, setShowAccountSidebar] = useState(false);

  const getAccountBalance = (type: string, id: number) => {
    const acc = sidebarAccounts.find(a => a.id === id && a.type === type);
    return acc?.balance || 0;
  };

  const filteredJournalAccounts = useMemo(() => {
    if (!journalAccountSearchTerm.trim()) return allAccounts;
    const term = journalAccountSearchTerm.toLowerCase();
    return allAccounts.filter(a => a.name.toLowerCase().includes(term) || (a.code && a.code.toLowerCase().includes(term)));
  }, [allAccounts, journalAccountSearchTerm]);

  const handleJournalAccountSelect = (account: any) => {
    if (activeJournalRow !== null) {
      journalForm.setValue(`entries.${activeJournalRow}.accountType`, account.type);
      journalForm.setValue(`entries.${activeJournalRow}.accountId`, account.id);
      journalForm.setValue(`entries.${activeJournalRow}.accountName`, account.name);
      setActiveJournalRow(null);
      setJournalAccountSearchTerm("");
    }
  };

  const handleJournalTypeChange = (index: number, type: "DR" | "CR") => journalForm.setValue(`entries.${index}.type`, type);

  const onJournalSubmit = async (data: JournalFormData) => {
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      toast({ title: "Validation Error", description: "Debits must equal Credits", variant: "destructive" });
      return;
    }
    const res = await modeApiRequest("POST", "/api/vouchers/journal", data);
    if (res.ok) {
      toast({ title: "Journal created" });
      journalForm.reset();
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
    }
  };

  const stockTransferForm = useForm<StockTransferFormData>({
    resolver: zodResolver(stockTransferFormSchema),
    defaultValues: { voucherDate: new Date(), destinationLocationId: 0, entries: [{ sourceLocationId: 0, sourceLocationName: "", stockItemId: 0, stockItemCode: "", stockItemName: "", quantity: "", rate: "" }], notes: "", optional: false },
  });

  const { fields: transferFields, remove: removeTransfer } = useFieldArray({ control: stockTransferForm.control, name: "entries" });
  const transferEntries = stockTransferForm.watch("entries");
  const [activeTransferRow, setActiveTransferRow] = useState<number | null>(null);
  const [transferInventorySource, setTransferInventorySource] = useState<number | null>(isPOS && posLocationId ? posLocationId : null);
  const [transferSearchTerm, setTransferSearchTerm] = useState("");
  const [transferSourceSearchTerm, setTransferSourceSearchTerm] = useState("");
  const [showSourceSidebar, setShowSourceSidebar] = useState(false);
  const [activeFieldType, setActiveFieldType] = useState<'source' | 'item' | null>(null);
  const [posSelectedSourceId, setPosSelectedSourceId] = useState<number | null>(posLocationId ?? null);

  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [transferRevisionDialogOpen, setTransferRevisionDialogOpen] = useState(false);
  const [approveRevisionTarget, setApproveRevisionTarget] = useState<any | null>(null);

  const stockTransferMutation = useMutation({
    mutationFn: async (data: any) => await modeApiRequest("POST", "/api/stock-transfers", data),
    onSuccess: () => { toast({ title: "Transfer saved" }); queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] }); }
  });

  const onStockTransferSubmit = (data: StockTransferFormData) => stockTransferMutation.mutate(data);

  const stockAdjustmentForm = useForm<StockAdjustmentFormData>({
    resolver: zodResolver(stockAdjustmentFormSchema),
    defaultValues: { voucherDate: new Date(), locationId: 0, entries: [{ type: "CONSUME", stockItemId: 0, stockItemCode: "", stockItemName: "", quantity: "", rate: "" }], notes: "", optional: false },
  });

  const [activeAdjustmentRow, setActiveAdjustmentRow] = useState<number | null>(null);
  const [adjustmentSearchTerm, setAdjustmentSearchTerm] = useState("");
  const [showAdjustmentSidebar, setShowAdjustmentSidebar] = useState(false);
  const adjustmentEntries = stockAdjustmentForm.watch("entries");
  const consumptionTotal = adjustmentEntries.filter(e => e.type === "CONSUME").reduce((sum, e) => sum + (parseFloat(e.quantity || "0") * parseFloat(e.rate || "0")), 0);
  const productionTotal = adjustmentEntries.filter(e => e.type === "PRODUCE").reduce((sum, e) => sum + (parseFloat(e.quantity || "0") * parseFloat(e.rate || "0")), 0);
  const currentAdjustmentType = adjustmentEntries.some(e => e.type === "CONSUME") && adjustmentEntries.some(e => e.type === "PRODUCE") ? "Mixed" : adjustmentEntries.some(e => e.type === "PRODUCE") ? "Production" : "Consumption";
  const displayAdjustmentTotal = Math.abs(productionTotal - consumptionTotal);

  const stockAdjustmentMutation = useMutation({
    mutationFn: async (data: any) => await modeApiRequest("POST", "/api/stock-adjustments", data),
    onSuccess: () => { toast({ title: "Adjustment saved" }); queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] }); }
  });

  const onStockAdjustmentSubmit = (data: StockAdjustmentFormData) => stockAdjustmentMutation.mutate(data);

  return (
    <div className="flex flex-col lg:flex-row gap-6 p-4 sm:p-6 min-h-screen bg-background/50">
      <VoucherSidebarPanel
        sidebarAccounts={sidebarAccounts}
        activeTab={activeTab}
        onTabChange={(tab) => { setActiveTab(tab); setLocation(`${modePrefix}/vouchers?tab=${tab}`); }}
        isFactoryMode={isFactoryMode}
        onAccountSelect={(account) => {
          if (activeRowIndex !== null) {
            form.setValue(`entries.${activeRowIndex}.accountType`, account.type);
            form.setValue(`entries.${activeRowIndex}.accountId`, account.id);
            form.setValue(`entries.${activeRowIndex}.accountName`, account.name);
          } else fieldArray.append({ accountType: account.type, accountId: account.id, accountName: account.name, amount: "" });
        }}
        getAccountBalance={getAccountBalance}
        formatAmount={formatAmount}
        activeRowIndex={activeRowIndex}
        selectedAccountId={selectedAccountId}
        selectedAccountType={selectedAccountType}
      />
      
      <div className="flex-1 min-w-0 space-y-6">
        <PageHeader title="Vouchers" />

        {activeTab === "payment" && (
          <PaymentVoucherTab
            form={form}
            fieldArray={fieldArray}
            entries={entries}
            total={total}
            paymentAccountId={paymentAccountId}
            paymentAccountType={paymentAccountType}
            paymentAccountName={paymentAccountName}
            accountBalance={accountBalance}
            accountCurrencyBalances={accountCurrencyBalances}
            allAccounts={allAccounts}
            sidebarAccounts={sidebarAccounts}
            isEditMode={!!voucherIdToEdit}
            onSubmit={onSubmit}
            activeTab="payment"
            activeRowIndex={activeRowIndex}
            setActiveRowIndex={setActiveRowIndex}
            isPending={form.formState.isSubmitting}
            onAccountPickerOpen={() => setAccountPickersNeeded(true)}
            onAccountSearchChange={() => {}}
          />
        )}

        {activeTab === "receipt" && (
          <ReceiptVoucherTab
            form={form}
            fieldArray={fieldArray}
            entries={entries}
            total={total}
            paymentAccountId={paymentAccountId}
            paymentAccountType={paymentAccountType}
            paymentAccountName={paymentAccountName}
            accountBalance={accountBalance}
            accountCurrencyBalances={accountCurrencyBalances}
            allAccounts={allAccounts}
            sidebarAccounts={sidebarAccounts}
            isEditMode={!!voucherIdToEdit}
            onSubmit={onSubmit}
            activeTab="receipt"
            activeRowIndex={activeRowIndex}
            setActiveRowIndex={setActiveRowIndex}
            isPending={form.formState.isSubmitting}
            onAccountPickerOpen={() => setAccountPickersNeeded(true)}
            onAccountSearchChange={() => {}}
          />
        )}

        {activeTab === "journal" && (
          <JournalForm
            journalForm={journalForm}
            onSubmit={onJournalSubmit}
            totalDebit={totalDebit}
            totalCredit={totalCredit}
            hasJournalDraft={false}
            journalDraftAge=""
            onRestoreDraft={() => {}}
            onDiscardDraft={() => {}}
            activeJournalRow={activeJournalRow}
            setActiveJournalRow={setActiveJournalRow}
            journalAccountSearchTerm={journalAccountSearchTerm}
            setJournalAccountSearchTerm={setJournalAccountSearchTerm}
            setJournalAccountHighlightedIndex={() => {}}
            filteredJournalAccounts={filteredJournalAccounts}
            handleJournalAccountSelect={handleJournalAccountSelect}
            handleJournalTypeChange={handleJournalTypeChange}
            removeJournal={removeJournal}
            appendJournal={appendJournal}
            setShowAccountSidebar={setShowAccountSidebar}
            setAccountPickersNeeded={setAccountPickersNeeded}
            journalEntries={journalEntries}
            getAccountBalance={getAccountBalance}
            formatAmount={formatAmount}
            convertToUSD={convertToUSD}
            selectedCurrency={selectedCurrency}
          />
        )}

        {(isPOS || activeTab === "transfer") && (
          <StockTransferForm
            stockTransferForm={stockTransferForm}
            onStockTransferSubmit={onStockTransferSubmit}
            isPOS={isPOS}
            locations={locations}
            voucherIdToEdit={voucherIdToEdit}
            stockTransferToEdit={stockTransferToEdit}
            handleExportStockTransfer={() => {}}
            handleOpenImport={() => setImportDialogOpen(true)}
            handleTransferSaveAsRevision={() => setTransferRevisionDialogOpen(true)}
            isTransferSavingRevision={false}
            stockTransferMutation={stockTransferMutation}
            activeTransferRow={activeTransferRow}
            setActiveTransferRow={setActiveTransferRow}
            transferSearchTerm={transferSearchTerm}
            setTransferSearchTerm={setTransferSearchTerm}
            transferInventory={[]}
            transferInventorySource={transferInventorySource}
            setTransferInventorySource={setTransferInventorySource}
            setShowSourceSidebar={setShowSourceSidebar}
            activeFieldType={activeFieldType}
            setActiveFieldType={setActiveFieldType}
            transferSourceSearchTerm={transferSourceSearchTerm}
            setTransferSourceSearchTerm={setTransferSourceSearchTerm}
            setTransferSourceHighlightedIndex={() => {}}
            posLocationName=""
            posSelectedSourceId={posSelectedSourceId}
            setPosSelectedSourceId={setPosSelectedSourceId}
            myLocations={myLocations}
            posSelectedSourceName=""
            transferFocusIdRef={{ current: 0 }}
            removeTransfer={removeTransfer}
            transferFields={transferFields}
            transferEntries={transferEntries}
            toast={toast}
            setLocation={setLocation}
          />
        )}

        {activeTab === "adjustment" && (
          <StockAdjustmentForm
            stockAdjustmentForm={stockAdjustmentForm}
            onSubmit={onStockAdjustmentSubmit}
            locations={locations}
            stockItems={stockItems}
            consumptionTotal={consumptionTotal}
            productionTotal={productionTotal}
            currentAdjustmentType={currentAdjustmentType}
            displayAdjustmentTotal={displayAdjustmentTotal}
            voucherIdToEdit={voucherIdToEdit}
            stockAdjustmentToEdit={stockAdjustmentToEdit}
            handleExportVoucher={() => {}}
            stockAdjustmentMutation={stockAdjustmentMutation}
            activeAdjustmentRow={activeAdjustmentRow}
            setActiveAdjustmentRow={setActiveAdjustmentRow}
            adjustmentSearchTerm={adjustmentSearchTerm}
            setAdjustmentSearchTerm={setAdjustmentSearchTerm}
            setAdjustmentHighlightedIndex={() => {}}
            filteredAdjustmentItems={[]}
            adjustmentItemsWithInventory={[]}
            setShowAdjustmentSidebar={setShowAdjustmentSidebar}
            formatAmount={formatAmount}
            formatNumber={formatNumber}
          />
        )}

        {activeTab === "creditnote" && <CreditNoteTab allAccounts={allAccounts} editVoucherId={voucherIdToEdit} />}
        {activeTab === "transferorder" && <StockTransferOrder />}
        
        <VoucherListPanel onEdit={(id) => setLocation(`${modePrefix}/vouchers?edit=${id}`)} formatAmount={formatAmount} />
      </div>

      <VoucherEditDialog
        voucherId={voucherIdToEdit}
        open={editDialogOpen}
        onOpenChange={(open) => { setEditDialogOpen(open); if (!open) setLocation(`${modePrefix}/vouchers`); }}
      />
      
      <SaveRevisionDialog
        open={transferRevisionDialogOpen}
        onOpenChange={setTransferRevisionDialogOpen}
        transferRevisionsCount={transferRevisions.length}
        revisionItems={[]}
        revisionNote=""
        setRevisionNote={() => {}}
        isSaving={false}
        onConfirm={() => {}}
        formatNumber={formatNumber}
      />

      <StockTransferImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        locations={locations}
        importFile={importFile}
        handleImportFileChange={(e) => setImportFile(e.target.files?.[0] || null)}
        downloadImportTemplate={() => {}}
        importDestLocation=""
        setImportDestLocation={() => {}}
        importDate=""
        setImportDate={() => {}}
        importNotes=""
        setImportNotes={() => {}}
        handleImportParse={() => {}}
        importParsePending={false}
        handleImportValidate={() => {}}
        importValidatePending={false}
        importIsValidated={false}
        importHasErrors={false}
        handleImportSubmit={() => {}}
        importMutationPending={false}
        importValidItemsCount={0}
        importPreview={null}
        importValidationResult={null}
        formatNumber={formatNumber}
      />

      <ApproveRevisionDialog
        approveRevisionTarget={approveRevisionTarget}
        setApproveRevisionTarget={setApproveRevisionTarget}
        approveRevisionMutation={{ isPending: false }}
        formatNumber={formatNumber}
      />
    </div>
  );
}
