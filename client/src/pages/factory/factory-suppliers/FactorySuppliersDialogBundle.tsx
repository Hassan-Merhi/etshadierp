import { DeleteConfirmDialog } from "@/components/ConfirmationDialog";
import { SupplierDialogs } from "./SupplierDialogs";
import { FactorySuppliersMoveContainerDialog } from "./FactorySuppliersMoveContainerDialog";
import type { useFactorySuppliersModel } from "./useFactorySuppliersModel";

type SuppliersModel = ReturnType<typeof useFactorySuppliersModel>;

export function FactorySuppliersDialogBundle({ model, includeDeleteConfirm = false }: { model: SuppliersModel; includeDeleteConfirm?: boolean }) {
  return (
    <>
      <SupplierDialogs
        createOpen={model.createOpen}
        setCreateOpen={model.setCreateOpen}
        editingSupplier={model.editingSupplier}
        setEditingSupplier={model.setEditingSupplier}
        formData={model.formData}
        setFormData={model.setFormData}
        formRole={model.formRole}
        setFormRole={model.setFormRole}
        allSuppliers={model.allSuppliers}
        createSubAccountParentId={model.createSubAccountParentId}
        setCreateSubAccountParentId={model.setCreateSubAccountParentId}
        createMutation={model.createMutation}
        updateMutation={model.updateMutation}
        resetForm={model.resetForm}
        paymentDialogSupplier={model.paymentDialogSupplier}
        setPaymentDialogSupplier={model.setPaymentDialogSupplier}
        paymentForm={model.paymentForm}
        setPaymentForm={model.setPaymentForm}
        ledgerAccounts={model.ledgerAccounts}
        paymentMutation={model.paymentMutation}
        paymentAmtUsd={0}
        paymentBalanceUsd={0}
        isOverpayment={false}
        overpaymentUsd={0}
        fxConversionOpen={model.fxConversionOpen}
        setFxConversionOpen={model.setFxConversionOpen}
        fxConversionForm={model.fxConversionForm}
        setFxConversionForm={model.setFxConversionForm}
        fxSourceType={model.fxSourceType}
        setFxSourceType={model.setFxSourceType}
        fxConversionMutation={model.fxConversionMutation}
        wrapAdminAction={model.wrapAdminAction}
        bulkFxOpen={model.bulkFxOpen}
        setBulkFxOpen={model.setBulkFxOpen}
        bulkFxBrokerId={model.bulkFxBrokerId}
        bulkFxBrokerName={model.bulkFxBrokerName}
        bulkFxForm={model.bulkFxForm}
        setBulkFxForm={model.setBulkFxForm}
        bulkFxPreview={model.bulkFxPreview}
        setBulkFxPreview={model.setBulkFxPreview}
        bulkFxPreviewMutation={model.bulkFxPreviewMutation}
        bulkFxMutation={model.bulkFxMutation}
        obEditSupplier={model.obEditSupplier}
        setObEditSupplier={model.setObEditSupplier}
        obEditValue={model.obEditValue}
        setObEditValue={model.setObEditValue}
        obEditMutation={model.obEditMutation}
        dueDialogSupplier={model.dueDialogSupplier}
        setDueDialogSupplier={model.setDueDialogSupplier}
        formatDate={model.formatDate}
        formatNum={model.formatNum}
        editObComm={model.editObComm}
        setEditObComm={model.setEditObComm}
        updateObCommissionMutation={model.updateObCommissionMutation}
      />
      <FactorySuppliersMoveContainerDialog model={model} />
      {includeDeleteConfirm && (
        <DeleteConfirmDialog
          open={!!model.pendingDelete}
          onOpenChange={(open) => { if (!open) model.setPendingDelete(null); }}
          onConfirm={() => { model.pendingDelete?.(); model.setPendingDelete(null); }}
        />
      )}
      {model.AdminDialog}
    </>
  );
}
