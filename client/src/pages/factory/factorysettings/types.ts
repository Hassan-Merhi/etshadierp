/**
 * Types for the FactorySettings page.
 *
 * Extracted from FactorySettings.tsx during the Phase 4 god-file split.
 */

export interface Location {
  id: number;
  name: string;
}

export interface FactorySettingsData {
  dashboardEnabled: boolean;
  kpisEnabled: boolean;
  profitabilityEnabled: boolean;
  alertsEnabled: boolean;
  supplierScoringEnabled: boolean;
  mixOptimizerEnabled: boolean;
  traceabilityEnabled: boolean;
  balePhotosEnabled: boolean;
  wasteTrackingEnabled: boolean;
  cashflowEnabled: boolean;
  rolesEnabled: boolean;
  netProfitEnabled: boolean;
  productionSummaryEnabled: boolean;
  supplierReportEnabled: boolean;
  supplierStatementEnabled: boolean;
  daybookEnabled: boolean;
  analyticsEnabled: boolean;
  financialSnapshotEnabled: boolean;
  workersTabPayrollEnabled: boolean;
  workersTabAttendanceEnabled: boolean;
  workersTabReportEnabled: boolean;
  workersTabAdvancesEnabled: boolean;
  workersTabBonusesEnabled: boolean;
  balesTabBarcodeEnabled: boolean;
  balesTabRemoveEnabled: boolean;
  loadingsTabPendingEnabled: boolean;
  stockEntryTabEntryEnabled: boolean;
  stockEntryTabHistoryEnabled: boolean;
  advancesTabRepaymentsEnabled: boolean;
  kpisTabWorkerPerformanceEnabled: boolean;
  kpisTabMixEfficiencyEnabled: boolean;
  payrollTabWorkerMasterEnabled: boolean;
  profitabilityTabContainersEnabled: boolean;
  workersTabCategoriesEnabled: boolean;
  workerDetailTabStatementEnabled: boolean;
  workerDetailTabAdvancesEnabled: boolean;
  workerDetailTabBalesEnabled: boolean;
  workerDetailTabDocumentsEnabled: boolean;
  laborCostPerKg: number;
  overheadPerKg: number;
  hideSellingPrice: boolean;
  hideAvgCost: boolean;
}

export interface RenamePreviewItem {
  id: number;
  code: string;
  currentName: string;
  newName: string;
}

export interface WaChat {
  id: string;
  name: string;
  type: string;
}
