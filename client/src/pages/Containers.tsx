import { useState } from "react";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { useLocation } from "wouter";
import { Package, Truck, Check, MapPin } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { useCompany } from "@/contexts/CompanyContext";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { AddContainerDialog } from "../components/AddContainerDialog";
// Split-out hooks
import { useContainerQueries } from "./containers/useContainerQueries";
import { useContainerSyncAll } from "./containers/useContainerSyncAll";
import { useContainerTracking } from "./containers/useContainerTracking";
import { useContainerNumberEdit } from "./containers/useContainerNumberEdit";
import { useContainerImportExport } from "./containers/useContainerImportExport";
// Split-out components
import { useContainerFilters } from "./containers/useContainerFilters";
import { ContainerFilters } from "./containers/ContainerFilters";
import { ActiveContainersTable } from "./containers/ActiveContainersTable";
import { OtwContainersTable } from "./containers/OtwContainersTable";
import { SoldContainersTable } from "./containers/SoldContainersTable";
import { ContainerToolbar } from "./containers/ContainerToolbar";
import { ContainerConfirmDialogs } from "./containers/ContainerConfirmDialogs";
import { ContainerLoadingState } from "./containers/ContainerLoadingState";
import { ContainerSpView } from "./containers/ContainerSpView";

export default function Containers() {
  const { formatDisplayDate } = useDateFormat();
  const [activeTab, setActiveTab] = useState("active");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const { selectedCompany } = useCompany();
  const { formatAmount } = useCurrencyContext();
  const [, setLocation] = useLocation();

  const isSupplierPartner = selectedCompany?.companyType === "supplier_partner";
  const isFactory =
    selectedCompany?.companyType === "factory" || selectedCompany?.companyType === "factory_v2";

  const {
    allContainers,
    soldContainers,
    spContainersList,
    suppliers,
    freightStatusMap,
    isLoading,
    isSoldLoading,
    spContainersLoading,
    hideContainerCosts,
    isDeveloper,
  } = useContainerQueries(selectedCompany, isSupplierPartner, isFactory);

  const {
    searchTerm, setSearchTerm,
    soldSearchTerm, setSoldSearchTerm,
    otwSearchTerm, setOtwSearchTerm,
    statusFilter, setStatusFilter,
    supplierFilter, setSupplierFilter,
    otwLocationFilter, setOtwLocationFilter,
    otwSupplierFilter, setOtwSupplierFilter,
    otwAgentFilter, setOtwAgentFilter,
    otwTransporterFilter, setOtwTransporterFilter,
    otwTruckFilter, setOtwTruckFilter,
    otwDocReceivedFilter, setOtwDocReceivedFilter,
    otwFreightStatusFilter, setOtwFreightStatusFilter,
    otwNotesFilter, setOtwNotesFilter,
    uniqueOtwLocations, uniqueOtwAgents, uniqueOtwTransporters, uniqueOtwSuppliers, uniqueOtwTrucks,
    otwContainers, filteredOtwContainers, filteredSoldContainers,
    containers, clearFilters,
  } = useContainerFilters(allContainers, soldContainers);

  const getSupplierName = (supplierId: number) => {
    const supplier = suppliers.find((s) => s.id === supplierId);
    return supplier ? supplier.legalName : "Unknown";
  };

  const syncAll = useContainerSyncAll();
  const tracking = useContainerTracking(filteredOtwContainers);
  const numberEdit = useContainerNumberEdit();
  const importExport = useContainerImportExport({
    containers,
    filteredOtwContainers,
    getSupplierName,
    formatDisplayDate,
  });

  if (isLoading && !isSupplierPartner) {
    return <ContainerLoadingState />;
  }

  if (isSupplierPartner) {
    return (
      <ContainerSpView
        spContainersList={spContainersList}
        allContainers={allContainers}
        suppliers={suppliers}
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        isSpLoading={spContainersLoading || isLoading}
        addDialogOpen={addDialogOpen}
        setAddDialogOpen={setAddDialogOpen}
        setLocation={setLocation}
        formatDisplayDate={formatDisplayDate}
      />
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader title="Container Tracking" subtitle="Track containers and manage offloading">
        <ContainerToolbar
          isDeveloper={isDeveloper}
          syncAllIsPending={syncAll.syncAllMutation.isPending}
          onSyncAllClick={() => syncAll.setSyncAllConfirmOpen(true)}
          onExportExcel={importExport.exportToExcel}
          onExportAllFull={importExport.exportAllContainersFull}
          isSupplierPartner={isSupplierPartner}
          onAddDialogOpen={() => setAddDialogOpen(true)}
        />
      </PageHeader>

      {/* Stats bar */}
      {!isLoading && allContainers.length > 0 && (
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2 bg-muted/60 rounded-lg px-3 py-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold" data-testid="text-total-containers">
              {allContainers.length.toLocaleString()}
            </span>
            <span className="text-xs text-muted-foreground">Containers</span>
          </div>
          {(() => {
            const otwCount = allContainers.filter((c) => c.status === "OTW").length;
            const arrivedCount = allContainers.filter((c) => c.status === "ARRIVED").length;
            const offloadedCount = allContainers.filter((c) => c.status === "OFFLOADED").length;
            return (
              <>
                {otwCount > 0 && (
                  <div className="flex items-center gap-2 bg-blue-500/10 rounded-lg px-3 py-2">
                    <Truck className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    <span className="text-sm font-semibold text-blue-700 dark:text-blue-300">{otwCount}</span>
                    <span className="text-xs text-muted-foreground">OTW</span>
                  </div>
                )}
                {arrivedCount > 0 && (
                  <div className="flex items-center gap-2 bg-amber-500/10 rounded-lg px-3 py-2">
                    <MapPin className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">{arrivedCount}</span>
                    <span className="text-xs text-muted-foreground">Arrived</span>
                  </div>
                )}
                {offloadedCount > 0 && (
                  <div className="flex items-center gap-2 bg-green-500/10 rounded-lg px-3 py-2">
                    <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                    <span className="text-sm font-semibold text-green-700 dark:text-green-300">{offloadedCount}</span>
                    <span className="text-xs text-muted-foreground">Offloaded</span>
                  </div>
                )}
              </>
            );
          })()}
          {!hideContainerCosts && (
            <div className="flex items-center gap-2 bg-primary/10 rounded-lg px-3 py-2">
              <span className="text-sm font-semibold font-mono text-primary" data-testid="text-total-amount">
                {formatAmount(
                  containers.reduce((sum, c) => {
                    const gTotal = parseFloat(c.grandTotal ?? "0");
                    return sum + (gTotal || parseFloat(c.itemsTotal ?? "0") || 0);
                  }, 0)
                )}
              </span>
              <span className="text-xs text-muted-foreground">total value</span>
            </div>
          )}
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 border-b pb-0">
        {(["active", "otw", "sold"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={[
              "px-4 py-2 text-sm font-medium rounded-t-md border border-b-0 -mb-px transition-colors",
              activeTab === tab
                ? "bg-background border-border text-foreground"
                : "bg-muted/40 border-transparent text-muted-foreground hover:text-foreground",
            ].join(" ")}
            data-testid={`tab-${tab}`}
          >
            {tab === "active" ? "Active" : tab === "otw" ? "OTW" : "Sold"}
          </button>
        ))}
      </div>

      {activeTab === "active" && (
        <>
          <ContainerFilters
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            statusFilter={statusFilter}
            onStatusChange={setStatusFilter}
            supplierFilter={supplierFilter}
            onSupplierFilterChange={setSupplierFilter}
            suppliers={suppliers}
            getSupplierName={getSupplierName}
            onClearFilters={clearFilters}
          />

          <ActiveContainersTable
            containers={containers}
            allContainers={allContainers}
            isLoading={isLoading}
            hideContainerCosts={hideContainerCosts}
            formatDisplayDate={formatDisplayDate}
            formatAmount={formatAmount}
            editingNumberId={numberEdit.editingNumberId}
            editingNumberValue={numberEdit.editingNumberValue}
            onEditNumberStart={(id, number) => {
              numberEdit.setEditingNumberId(id);
              numberEdit.setEditingNumberValue(number);
            }}
            onEditNumberChange={numberEdit.setEditingNumberValue}
            onEditNumberSave={(id, containerNumber) =>
              numberEdit.editContainerNumberMutation.mutate({ id, containerNumber })
            }
            onEditNumberCancel={() => {
              numberEdit.setEditingNumberId(null);
              numberEdit.setEditingNumberValue("");
            }}
            isEditNumberPending={numberEdit.editContainerNumberMutation.isPending}
            getSupplierName={getSupplierName}
          />
        </>
      )}

      {activeTab === "otw" && (
        <OtwContainersTable
          filteredOtwContainers={filteredOtwContainers}
          otwContainers={otwContainers}
          otwSearchTerm={otwSearchTerm}
          setOtwSearchTerm={setOtwSearchTerm}
          otwSupplierFilter={otwSupplierFilter}
          setOtwSupplierFilter={setOtwSupplierFilter}
          otwLocationFilter={otwLocationFilter}
          setOtwLocationFilter={setOtwLocationFilter}
          otwTruckFilter={otwTruckFilter}
          setOtwTruckFilter={setOtwTruckFilter}
          otwAgentFilter={otwAgentFilter}
          setOtwAgentFilter={setOtwAgentFilter}
          otwTransporterFilter={otwTransporterFilter}
          setOtwTransporterFilter={setOtwTransporterFilter}
          otwDocReceivedFilter={otwDocReceivedFilter}
          setOtwDocReceivedFilter={setOtwDocReceivedFilter}
          otwFreightStatusFilter={otwFreightStatusFilter}
          setOtwFreightStatusFilter={setOtwFreightStatusFilter}
          otwNotesFilter={otwNotesFilter}
          setOtwNotesFilter={setOtwNotesFilter}
          uniqueOtwLocations={uniqueOtwLocations}
          uniqueOtwSuppliers={uniqueOtwSuppliers}
          uniqueOtwAgents={uniqueOtwAgents}
          uniqueOtwTransporters={uniqueOtwTransporters}
          uniqueOtwTrucks={uniqueOtwTrucks}
          getSupplierName={getSupplierName}
          formatAmount={formatAmount}
          freightStatusMap={freightStatusMap}
          getEditValue={tracking.getEditValue}
          setEditValue={tracking.setEditValue}
          hasChanges={tracking.hasChanges}
          saveTracking={tracking.saveTracking}
          savingIds={tracking.savingIds}
          handleKeyDown={tracking.handleKeyDown}
          autoSizeStyle={tracking.autoSizeStyle}
        />
      )}

      {activeTab === "sold" && (
        <SoldContainersTable
          isSoldLoading={isSoldLoading}
          soldContainers={soldContainers}
          filteredSoldContainers={filteredSoldContainers}
          soldSearchTerm={soldSearchTerm}
          setSoldSearchTerm={setSoldSearchTerm}
          formatDisplayDate={formatDisplayDate}
          formatAmount={formatAmount}
        />
      )}

      <AddContainerDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} />

      <ContainerConfirmDialogs
        syncAllConfirmOpen={syncAll.syncAllConfirmOpen}
        onSyncAllConfirmOpenChange={syncAll.setSyncAllConfirmOpen}
        onSyncAllConfirm={() => syncAll.syncAllMutation.mutate()}
      />

      {/* Hidden file input for tracking import */}
      <input
        ref={importExport.fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={importExport.handleFileImport}
      />
    </div>
  );
}
