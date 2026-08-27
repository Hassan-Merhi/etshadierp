import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Package } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { companyQueryKey } from "@/lib/companyQueryScope";
import { useCompany } from "@/contexts/CompanyContext";
import type { Supplier } from "@shared/schema";
import { useContainerDetailModel } from "./containerdetail/useContainerDetailModel";
import { ContainerDetailSpView } from "./containerdetail/components/ContainerDetailSpView";
import { ContainerDetailErpView } from "./containerdetail/components/ContainerDetailErpView";

export default function ContainerDetail({ id: idProp, forceErp }: { id?: string; forceErp?: boolean }) {
  const model = useContainerDetailModel({ id: idProp, forceErp });
  const { selectedCompany } = useCompany();
  const { data: containerSuppliers = [] } = useQuery<Supplier[]>({
    queryKey: companyQueryKey("/api/suppliers", selectedCompany?.id, "allow-parent-fallback"),
    queryFn: async () => {
      const res = await fetch("/api/suppliers?allowParentFallback=true", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load suppliers");
      return res.json();
    },
    enabled: Boolean(selectedCompany?.id) && !model.isSupplierPartner,
  });
  const {
    formatDisplayDate: _formatDisplayDate,
    containerId: _containerId,
    showOffloadDialog: _showOffloadDialog,
    setShowOffloadDialog: _setShowOffloadDialog,
    showSellDialog: _showSellDialog,
    setShowSellDialog: _setShowSellDialog,
    pendingDelete: _pendingDelete,
    setPendingDelete: _setPendingDelete,
    setLocation: _setLocation,
    formatAmount: _formatAmount,
    isSupplierPartner,
    isDeveloper: _isDeveloper,
    containerData,
    isLoading,
    spContainerData: _spContainerData,
    spDetailLoading: _spDetailLoading,
    showSpOffloadDialog: _showSpOffloadDialog,
    setShowSpOffloadDialog: _setShowSpOffloadDialog,
    suppliers: _suppliers,
    customers: _customers,
    incomeAccounts: _incomeAccounts,
    containerSale: _containerSale,
    docsData: _docsData,
    showUploadDialog: _showUploadDialog,
    setShowUploadDialog: _setShowUploadDialog,
    showFreightDialog: _showFreightDialog,
    setShowFreightDialog: _setShowFreightDialog,
    showPaymentDialog: _showPaymentDialog,
    setShowPaymentDialog: _setShowPaymentDialog,
    uploadDocTypeId: _uploadDocTypeId,
    setUploadDocTypeId: _setUploadDocTypeId,
    uploadFile: _uploadFile,
    setUploadFile: _setUploadFile,
    fileInputRef: _fileInputRef,
    showPriceImportDialog: _showPriceImportDialog,
    setShowPriceImportDialog: _setShowPriceImportDialog,
    priceImportPreview: _priceImportPreview,
    setPriceImportPreview: _setPriceImportPreview,
    priceImportParsing: _priceImportParsing,
    priceImportError: _priceImportError,
    setPriceImportError: _setPriceImportError,
    priceImportFileRef: _priceImportFileRef,
    pricePreviewMutation: _pricePreviewMutation,
    priceApplyMutation: _priceApplyMutation,
    handlePriceImportFile: _handlePriceImportFile,
    uploadDocMutation: _uploadDocMutation,
    freightForm: _freightForm,
    addFreightMutation: _addFreightMutation,
    paymentForm: _paymentForm,
    addPaymentMutation: _addPaymentMutation,
    handleExportContainer: _handleExportContainer,
    handleExportContainerNoCost: _handleExportContainerNoCost,
    backUrl,
    form: _form,
    deletePOMutation: _deletePOMutation,
    deleteContainerMutation: _deleteContainerMutation,
    syncVoucherMutation: _syncVoucherMutation,
    reverseOffloadMutation: _reverseOffloadMutation,
    sellContainerMutation: _sellContainerMutation,
    handleDeletePO: _handleDeletePO,
    handleDeleteContainer: _handleDeleteContainer,
    handleSellSubmit: _handleSellSubmit,
    handlePrint: _handlePrint,
    saleCustomer: _saleCustomer,
  } = model;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!containerData && !isSupplierPartner) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <Package className="w-16 h-16 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">Container not found</h2>
        <Link href={backUrl}>
          <Button variant="outline">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Containers
          </Button>
        </Link>
      </div>
    );
  }

  // ── SP early return — all hooks already called above ─────────────────────
  if (isSupplierPartner) {
    return <ContainerDetailSpView model={model} />;
  }

  const erpModel = {
    ...model,
    suppliers: containerSuppliers.length > 0 ? containerSuppliers : model.suppliers,
  };
  return <ContainerDetailErpView model={erpModel} />;
}
