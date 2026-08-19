/**
 * Pure helpers and lookup tables for the FactorySettings page.
 *
 * Extracted from FactorySettings.tsx during the Phase 4 god-file split.
 */

import type {FactorySettingsData} from "./types";

export const defaultSettings: FactorySettingsData = {
  dashboardEnabled: true,
  kpisEnabled: true,
  profitabilityEnabled: true,
  alertsEnabled: true,
  supplierScoringEnabled: true,
  mixOptimizerEnabled: true,
  traceabilityEnabled: true,
  balePhotosEnabled: true,
  wasteTrackingEnabled: true,
  cashflowEnabled: true,
  rolesEnabled: true,
  netProfitEnabled: true,
  productionSummaryEnabled: true,
  supplierReportEnabled: true,
  supplierStatementEnabled: true,
  daybookEnabled: true,
  analyticsEnabled: true,
  financialSnapshotEnabled: true,
  workersTabPayrollEnabled: true,
  workersTabAttendanceEnabled: true,
  workersTabReportEnabled: true,
  workersTabAdvancesEnabled: true,
  workersTabBonusesEnabled: true,
  balesTabBarcodeEnabled: true,
  balesTabRemoveEnabled: true,
  loadingsTabPendingEnabled: true,
  stockEntryTabEntryEnabled: true,
  stockEntryTabHistoryEnabled: true,
  advancesTabRepaymentsEnabled: true,
  kpisTabWorkerPerformanceEnabled: true,
  kpisTabMixEfficiencyEnabled: true,
  payrollTabWorkerMasterEnabled: true,
  profitabilityTabContainersEnabled: true,
  workersTabCategoriesEnabled: true,
  workerDetailTabStatementEnabled: true,
  workerDetailTabAdvancesEnabled: true,
  workerDetailTabBalesEnabled: true,
  workerDetailTabDocumentsEnabled: true,
  laborCostPerKg: 0,
  overheadPerKg: 0,
  hideSellingPrice: false,
  hideAvgCost: false,
};
