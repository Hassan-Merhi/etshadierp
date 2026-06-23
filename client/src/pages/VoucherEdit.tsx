import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useBackToParent } from "@/hooks/use-back-to-parent";
import { useEscapeBack } from "@/hooks/use-escape-back";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { parseISO } from "date-fns";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { useCompany } from "@/contexts/CompanyContext";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, keyStartsWith } from "@/lib/queryClient";
import { useAppMode, useModePrefix } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";
import { ArrowLeft } from "lucide-react";
import { useCurrencyContext } from "@/contexts/CurrencyContext";

// Sub-components
import {
  VoucherData,
  BankAccount,
  LedgerAccount,
  Supplier,
  StockItem,
  Location,
  focusByTestId,
} from "./voucher-edit/VoucherEditHelpers";
import { PaymentReceiptEditForm } from "./voucher-edit/PaymentReceiptEditForm";
import { JournalEditForm } from "./voucher-edit/JournalEditForm";
import { PurchaseEditForm } from "./voucher-edit/PurchaseEditForm";
import { AdjustmentEditForm } from "./voucher-edit/AdjustmentEditForm";
import { TransferEditForm } from "./voucher-edit/TransferEditForm";
import { SalesEditForm } from "./voucher-edit/SalesEditForm";
import {
  voucherFormSchema,
  journalFormSchema,
  salesFormSchema,
  purchaseFormSchema,
  adjustmentFormSchema,
  transferFormSchema,
  VoucherFormData,
  JournalFormData,
  SalesFormData,
  PurchaseFormData,
  AdjustmentFormData,
  TransferFormData,
} from "./voucher-edit/VoucherEditSchemas";

import {
  preparePaymentReceiptData,
  prepareJournalData,
  prepareSalesData,
  preparePurchaseData,
  prepareAdjustmentData,
  prepareTransferData,
} from "./voucher-edit/VoucherSubmitHelpers";

import { useAccountsWithBalances, AccountWithBalance } from "./voucher-edit/VoucherAccountHelpers";
import { useBalanceAdjustments } from "./voucher-edit/useBalanceAdjustments";
import { useFormInitialization } from "./voucher-edit/useFormInitialization";

export default function VoucherEdit() {
  const { formatDisplayDate } = useDateFormat();
  const { id } = useParams<{ id: string }>();
  const [_location, navigate] = useLocation();
  const handleBack = useBackToParent();
  const { toast } = useToast();
  const { selectedCompany } = useCompany();
  const { selectedCurrency, formatAmount, exchangeRate } = useCurrencyContext();
  const appMode = useAppMode();
  const modePrefix = useModePrefix();
  const modeApiRequest = getApiRequest(appMode);
  const [formInitialized, setFormInitialized] = useState(false);

  useEscapeBack(() => navigate(`${modePrefix}/vouchers`));

  useEffect(() => {
    setFormInitialized(false);
  }, [id]);

  const {
    data: voucher,
    isLoading: voucherLoading,
    error: voucherError,
  } = useQuery<VoucherData>({
    queryKey: [`/api/vouchers/${id}`],
    enabled: !!id,
  });

  const { data: bankAccounts = [] } = useQuery<BankAccount[]>({
    queryKey: ["/api/bank-accounts"],
  });

  const { data: ledgerAccounts = [] } = useQuery<LedgerAccount[]>({
    queryKey: ["/api/ledger-accounts"],
  });

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
  });

  const { data: stockItems = [] } = useQuery<StockItem[]>({
    queryKey: ["/api/stock-items"],
  });

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  const { data: allAccountsData = [] } = useQuery<AccountWithBalance[]>({
    queryKey: ["/api/accounts/all", selectedCompany?.id],
    enabled: !!selectedCompany?.id,
  });

  const voucherType = voucher?.voucherType;
  const isPaymentOrReceipt = voucherType === "Payment" || voucherType === "Receipt";
  const isJournal = voucherType === "Journal";
  const isPurchase = voucherType === "Purchase";
  const isSales = voucherType === "Sales";
  const isConsumption = voucherType === "Consumption" || voucherType === "Production" || voucherType === "Mixed";
  const isStockTransfer = voucherType === "Stock Transfer";

  useEffect(() => {
    if (isSales && id) {
      navigate(`/pos/edit/${id}`);
    }
  }, [isSales, id, navigate]);

  const paymentForm = useForm<VoucherFormData>({
    resolver: zodResolver(voucherFormSchema),
    defaultValues: {
      paymentAccountType: "bank",
      paymentAccountId: 0,
      paymentAccountName: "",
      voucherDate: new Date(),
      currency: selectedCurrency as "USD" | "CFA",
      entries: [],
      notes: "",
    },
  });

  const [balanceAdjustments, setBalanceAdjustments] = useState<Record<string, number>>({});

  const allAccountsWithBalances = useAccountsWithBalances(
    ledgerAccounts,
    bankAccounts,
    suppliers,
    allAccountsData,
    balanceAdjustments
  );

  useBalanceAdjustments(isPaymentOrReceipt, paymentForm, voucherType, exchangeRate, setBalanceAdjustments);

  const journalForm = useForm<JournalFormData>({
    resolver: zodResolver(journalFormSchema),
    defaultValues: {
      voucherDate: new Date(),
      currency: selectedCurrency as "USD" | "CFA",
      entries: [],
      notes: "",
    },
  });

  const salesForm = useForm<SalesFormData>({
    resolver: zodResolver(salesFormSchema),
    defaultValues: {
      voucherDate: new Date(),
      currency: selectedCurrency as "USD" | "CFA",
      locationId: 0,
      items: [],
      notes: "",
    },
  });

  const purchaseForm = useForm<PurchaseFormData>({
    resolver: zodResolver(purchaseFormSchema),
    defaultValues: {
      voucherDate: new Date(),
      currency: selectedCurrency as "USD" | "CFA",
      items: [],
      notes: "",
    },
  });

  const adjustmentForm = useForm<AdjustmentFormData>({
    resolver: zodResolver(adjustmentFormSchema),
    defaultValues: {
      voucherDate: new Date(),
      currency: selectedCurrency as "USD" | "CFA",
      locationId: 0,
      items: [],
      notes: "",
    },
  });

  const transferForm = useForm<TransferFormData>({
    resolver: zodResolver(transferFormSchema),
    defaultValues: {
      voucherDate: new Date(),
      currency: selectedCurrency as "USD" | "CFA",
      sourceLocationId: 0,
      destinationLocationId: 0,
      items: [],
      notes: "",
    },
  });

  useFormInitialization(
    voucher,
    formInitialized,
    setFormInitialized,
    voucherType,
    ledgerAccounts,
    bankAccounts,
    suppliers,
    allAccountsData,
    selectedCurrency as "USD" | "CFA",
    paymentForm,
    journalForm,
    salesForm,
    purchaseForm,
    adjustmentForm,
    transferForm
  );

  const updateMutation = useMutation({
    mutationFn: async (data: { voucherUpdates: any; entries: any[] }) => {
      return await modeApiRequest("PUT", `/api/vouchers/${id}/with-entries`, {
        voucher: data.voucherUpdates,
        entries: data.entries,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: [`/api/vouchers/${id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/daybook"] });
      queryClient.invalidateQueries({ predicate: keyStartsWith("/api/accounts/") });
      queryClient.invalidateQueries({ predicate: keyStartsWith("/api/factory/customers/") });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/customers"] });
      queryClient.invalidateQueries({ predicate: keyStartsWith("/api/factory/customer-orders") });
      toast({ title: "Success", description: "Voucher updated successfully" });
      handleBack();
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message || "Failed to update voucher", variant: "destructive" });
    },
  });

  const toggleOptionalMutation = useMutation({
    mutationFn: async (optional: boolean) => {
      return await modeApiRequest("PATCH", `/api/vouchers/${id}/optional`, { optional });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: [`/api/vouchers/${id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all"] });
      toast({ title: "Success", description: "Optional status updated successfully" });
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message || "Failed to update optional status",
        variant: "destructive",
      });
    },
  });

  const updateSalesMutation = useMutation({
    mutationFn: async (data: SalesFormData) => {
      const salesData = prepareSalesData(data);
      return await modeApiRequest("PATCH", `/api/vouchers/${id}/sales`, salesData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: [`/api/vouchers/${id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-by-location"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daybook"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/daybook"] });
      toast({ title: "Success", description: "Sales voucher updated successfully" });
      navigate(`${modePrefix}/daybook`);
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message || "Failed to update sales voucher", variant: "destructive" });
    },
  });

  const updatePurchaseMutation = useMutation({
    mutationFn: async (data: PurchaseFormData) => {
      const purchaseData = preparePurchaseData(data);
      return await modeApiRequest("PATCH", `/api/vouchers/${id}/purchase`, purchaseData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: [`/api/vouchers/${id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-by-location"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daybook"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/daybook"] });
      toast({ title: "Success", description: "Purchase voucher updated successfully" });
      navigate(`${modePrefix}/daybook`);
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message || "Failed to update purchase voucher",
        variant: "destructive",
      });
    },
  });

  const updateAdjustmentMutation = useMutation({
    mutationFn: async (data: AdjustmentFormData) => {
      const adjustmentData = prepareAdjustmentData(data);
      return await modeApiRequest("PATCH", `/api/vouchers/${id}/adjustment`, adjustmentData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: [`/api/vouchers/${id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-by-location"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daybook"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/daybook"] });
      toast({ title: "Success", description: "Adjustment voucher updated successfully" });
      navigate(`${modePrefix}/daybook`);
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message || "Failed to update adjustment voucher",
        variant: "destructive",
      });
    },
  });

  const updateTransferMutation = useMutation({
    mutationFn: async (data: TransferFormData) => {
      const transferData = prepareTransferData(data);
      return await modeApiRequest("PATCH", `/api/vouchers/${id}/transfer`, transferData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: [`/api/vouchers/${id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-by-location"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daybook"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/daybook"] });
      toast({ title: "Success", description: "Stock transfer voucher updated successfully" });
      navigate(`${modePrefix}/daybook`);
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message || "Failed to update stock transfer voucher",
        variant: "destructive",
      });
    },
  });

  const onSubmitPaymentReceipt = async (data: VoucherFormData) => {
    const { voucherUpdates, entries } = preparePaymentReceiptData(data, voucherType!, exchangeRate);
    updateMutation.mutate({ voucherUpdates, entries });
  };

  const onSubmitJournal = async (data: JournalFormData) => {
    const { voucherUpdates, entries } = prepareJournalData(data, exchangeRate);
    updateMutation.mutate({ voucherUpdates, entries });
  };

  if (voucherLoading)
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-8 w-8" />
          <Skeleton className="h-8 w-64" />
        </div>
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  if (voucherError || !voucher)
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => handleBack()}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <PageHeader title="Edit Voucher" />
        </div>
        <div className="text-center py-8">Voucher not found</div>
      </div>
    );

  const paymentTotal = isPaymentOrReceipt
    ? paymentForm.watch("entries").reduce((sum, entry) => sum + (parseFloat(entry.amount) || 0), 0)
    : 0;
  const journalDRTotal = isJournal
    ? journalForm
        .watch("entries")
        .filter((e) => e.type === "DR")
        .reduce((sum, entry) => sum + (parseFloat(entry.amount) || 0), 0)
    : 0;
  const journalCRTotal = isJournal
    ? journalForm
        .watch("entries")
        .filter((e) => e.type === "CR")
        .reduce((sum, entry) => sum + (parseFloat(entry.amount) || 0), 0)
    : 0;

  const renderForm = () => {
    if (isPaymentOrReceipt)
      return (
        <PaymentReceiptEditForm
          form={paymentForm}
          voucherType={voucherType!}
          onSubmit={onSubmitPaymentReceipt}
          onCancel={handleBack}
          isPending={updateMutation.isPending}
          allAccountsWithBalances={allAccountsWithBalances}
          formatDisplayDate={formatDisplayDate}
          formatAmount={formatAmount}
          total={paymentTotal}
          focusByTestId={focusByTestId}
        />
      );
    if (isJournal)
      return (
        <JournalEditForm
          form={journalForm}
          onSubmit={onSubmitJournal}
          onCancel={handleBack}
          isPending={updateMutation.isPending}
          allAccountsWithBalances={allAccountsWithBalances}
          formatDisplayDate={formatDisplayDate}
          formatAmount={formatAmount}
          drTotal={journalDRTotal}
          crTotal={journalCRTotal}
          focusByTestId={focusByTestId}
        />
      );
    if (isPurchase)
      return (
        <PurchaseEditForm
          form={purchaseForm}
          voucher={voucher}
          onSubmit={updatePurchaseMutation.mutate}
          onCancel={handleBack}
          onToggleOptional={toggleOptionalMutation.mutate}
          isPending={updatePurchaseMutation.isPending}
          isTogglingOptional={toggleOptionalMutation.isPending}
          stockItems={stockItems}
          formatDisplayDate={formatDisplayDate}
          formatAmount={formatAmount}
          grandTotal={purchaseForm
            .watch("items")
            .reduce((sum, item) => sum + (parseFloat(item.quantity) || 0) * (parseFloat(item.rate) || 0), 0)}
        />
      );
    if (isSales)
      return (
        <SalesEditForm
          form={salesForm}
          voucher={voucher}
          onSubmit={updateSalesMutation.mutate}
          onCancel={handleBack}
          onToggleOptional={toggleOptionalMutation.mutate}
          isPending={updateSalesMutation.isPending}
          isTogglingOptional={toggleOptionalMutation.isPending}
          stockItems={stockItems}
          locations={locations}
          formatDisplayDate={formatDisplayDate}
          formatAmount={formatAmount}
          grandTotal={salesForm
            .watch("items")
            .reduce((sum, item) => sum + (parseFloat(item.quantity) || 0) * (parseFloat(item.sellingPrice) || 0), 0)}
        />
      );
    if (isConsumption)
      return (
        <AdjustmentEditForm
          form={adjustmentForm}
          voucher={voucher}
          onSubmit={updateAdjustmentMutation.mutate}
          onCancel={handleBack}
          onToggleOptional={toggleOptionalMutation.mutate}
          isPending={updateAdjustmentMutation.isPending}
          isTogglingOptional={toggleOptionalMutation.isPending}
          stockItems={stockItems}
          locations={locations}
          formatDisplayDate={formatDisplayDate}
          formatAmount={formatAmount}
          grandTotal={adjustmentForm
            .watch("items")
            .reduce((sum, item) => sum + (parseFloat(item.quantity) || 0) * (parseFloat(item.rate) || 0), 0)}
          voucherType={voucherType!}
        />
      );
    if (isStockTransfer)
      return (
        <TransferEditForm
          form={transferForm}
          voucher={voucher}
          onSubmit={updateTransferMutation.mutate}
          onCancel={handleBack}
          onToggleOptional={toggleOptionalMutation.mutate}
          isPending={updateTransferMutation.isPending}
          isTogglingOptional={toggleOptionalMutation.isPending}
          stockItems={stockItems}
          locations={locations}
          formatDisplayDate={formatDisplayDate}
          formatAmount={formatAmount}
          grandTotal={transferForm
            .watch("items")
            .reduce((sum, item) => sum + (parseFloat(item.quantity) || 0) * (parseFloat(item.rate) || 0), 0)}
        />
      );
    return <div className="text-center py-8">Unsupported Voucher Type: {voucherType}</div>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => handleBack()} data-testid="button-back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl md:text-3xl font-bold" data-testid="text-page-title">
            Edit {voucherType} Voucher
          </h1>
          <p className="text-muted-foreground mt-1">Voucher #{voucher.voucherNumber}</p>
        </div>
      </div>
      {renderForm()}
    </div>
  );
}
