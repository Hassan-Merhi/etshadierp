import type { ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import { Switch, Route, Redirect } from "wouter";
import NotFound from "@/pages/not-found";
import {
  AICommandCenter,
  AccountGroups,
  AccountMigration,
  AccountTransfer,
  AccountingCreate,
  Accounts,
  Agents,
  AiValidationPage,
  Analytics,
  BalanceRepair,
  BaleLedger,
  BarcodeManager,
  Chat,
  ChatbotSettings,
  ClosingStockDetail,
  ClosingStockSummary,
  CompanyDataReset,
  CompanyTransfer,
  ConflictCenter,
  ContainerDetailPage,
  ContainerVerification,
  ContainersOTW,
  ContainersPage,
  Dashboard,
  Daybook,
  DeletedItems,
  EditSupplier,
  ErpRentalPayments,
  ErpRentalShops,
  ErpRentalWarehouses,
  GITMockup,
  GcLshiMigration,
  ImportCycleDiagnostics,
  ImportStockItems,
  IntercompanyLinks,
  IntercompanyRequests,
  InventoryHub,
  InventoryRepair,
  LedgerMonthlySummary,
  LedgerVouchers,
  LiveSheets,
  LocationMonthlySummary,
  LocationVouchers,
  MySettings,
  NetProfitDetails,
  NetProfitReport,
  NotificationSettings,
  OffloadDetail,
  OpeningStockDetail,
  OpeningStockSummary,
  OptionalVouchers,
  OrphanedRecords,
  POImport,
  POS,
  POSImport,
  POSPage,
  PartiesHub,
  Payroll,
  PurchaseOrderEdit,
  SalesReport,
  SalesReportComparison,
  SalesReportDetail,
  SalesToolsHub,
  Settings,
  SpAliases,
  SpOpeningStock,
  SpReports,
  SpSetup,
  SpreadsheetEditor,
  StockHub,
  StockItemDetail,
  StockItemHistory,
  StockItemVouchers,
  StockTransferOrder,
  SupplierProfitCheck,
  SupplierProformas,
  TestDataImport,
  TrackingHub,
  TransactionJournal,
  VoucherDetail,
  VoucherEdit,
  Vouchers,
} from "@/lazyPages";

interface ErpRoutesProps {
  user: any;
}

/**
 * Route tree for ERP (non-POS) users.
 * Rendered by AppRoutes when user.role !== "POS".
 * Owns the /api/my-erp-pages query so it can enforce per-page access.
 */
export function ErpRoutes({ user }: ErpRoutesProps) {
  // ERP page-level access — mirrors the sidebar visibility system.
  // The cache is warmed by AppSidebar so this is effectively free.
  // Optimistic while loading (allow) to avoid flicker on first render.
  const { data: erpAccess } = useQuery<{ fullAccess: boolean; pageKeys: string[] }>({
    queryKey: ["/api/my-erp-pages"],
    enabled: !!user,
    staleTime: 30000,
  });

  const isAdminOrDev = user?.role === "Admin" || user?.role === "Developer";

  // Returns true when the user has access to the given ERP feature key.
  // Optimistic (true) while the access data is still loading so pages don't
  // flicker on first render. fullAccess:true means no restrictions (Admin/Dev/
  // Owner with no explicit restrictions set).
  const canAccess = (key: string) => !erpAccess || erpAccess.fullAccess || erpAccess.pageKeys.includes(key);

  // Helper: renders a guarded Route that redirects to /tracking when blocked.
  const G = (path: string, key: string, Comp: ComponentType<any>) =>
    canAccess(key) ? (
      <Route path={path} component={Comp} />
    ) : (
      <Route path={path}>
        <Redirect to="/tracking" />
      </Route>
    );

  // All other users see full interface
  return (
    <Switch>
      {/* Home — ContainersOTW for Admin/Dev; others land on Tracking */}
      <Route path="/">{() => (isAdminOrDev ? <ContainersOTW /> : <Redirect to="/tracking" />)}</Route>

      {/* Tracking / Dashboard — always accessible (safe fallback for restricted users) */}
      <Route path="/tracking" component={TrackingHub} />
      <Route path="/financial-overview" component={Dashboard} />

      {/* POS (ERP-mode) */}
      {canAccess("pos") ? (
        <Route path="/pos">{() => <POSPage />}</Route>
      ) : (
        <Route path="/pos">
          <Redirect to="/tracking" />
        </Route>
      )}
      {canAccess("pos") && <Route path="/pos/edit/:id">{(params) => <POS editVoucherId={params.id} />}</Route>}

      {/* Inventory & Stock */}
      {G("/inventory", "stock_items", InventoryHub)}
      {G("/stock", "stock_items", StockHub)}
      {canAccess("location_inventory") ? (
        <Route path="/location-inventory">
          <Redirect to="/inventory?tab=by-location" />
        </Route>
      ) : (
        <Route path="/location-inventory">
          <Redirect to="/tracking" />
        </Route>
      )}
      {canAccess("stock_items") ? (
        <Route path="/stock-items">
          <Redirect to="/stock?tab=items" />
        </Route>
      ) : (
        <Route path="/stock-items">
          <Redirect to="/tracking" />
        </Route>
      )}
      {canAccess("stock_otw") ? (
        <Route path="/stock-otw">
          <Redirect to="/inventory?tab=on-the-way" />
        </Route>
      ) : (
        <Route path="/stock-otw">
          <Redirect to="/tracking" />
        </Route>
      )}

      {/* Containers OTW — Admin/Dev only */}
      {isAdminOrDev && <Route path="/mock-containers-otw" component={ContainersOTW} />}
      {isAdminOrDev && <Route path="/containers-otw" component={ContainersOTW} />}

      {/* GIT mockup — Admin/Dev only */}
      <Route path="/mock-git" component={GITMockup} />
      <Route path="/git" component={GITMockup} />

      {/* Containers */}
      {G("/containers/:containerId/verification", "containers", ContainerVerification)}
      {G("/containers/:id", "containers", ContainerDetailPage)}
      {G("/containers", "containers", ContainersPage)}
      {canAccess("containers") ? (
        <Route path="/sold-containers">
          <Redirect to="/containers" />
        </Route>
      ) : (
        <Route path="/sold-containers">
          <Redirect to="/tracking" />
        </Route>
      )}
      <Route path="/offloads/:id" component={OffloadDetail} />

      {/* Admin / internal tools (no feature key — role-gated above) */}
      <Route path="/po-import" component={POImport} />
      <Route path="/ai-validation" component={AiValidationPage} />
      <Route path="/ai-command-center" component={AICommandCenter} />
      <Route path="/pos-import" component={POSImport} />
      <Route path="/agents" component={Agents} />

      {/* Analytics */}
      {G("/analytics", "analytics", Analytics)}

      {/* Accounts & Ledger */}
      {G("/accounts", "accounts", Accounts)}
      {canAccess("accounts") ? (
        <Route path="/ledger-monthly/:accountId" component={LedgerMonthlySummary} />
      ) : (
        <Route path="/ledger-monthly/:accountId">
          <Redirect to="/tracking" />
        </Route>
      )}
      {canAccess("accounts") ? (
        <Route path="/ledger-vouchers/:accountId/:year/:month" component={LedgerVouchers} />
      ) : (
        <Route path="/ledger-vouchers/:accountId/:year/:month">
          <Redirect to="/tracking" />
        </Route>
      )}

      {/* Parties (Suppliers / Customers) */}
      {canAccess("suppliers") || canAccess("customers") ? (
        <Route path="/parties" component={PartiesHub} />
      ) : (
        <Route path="/parties">
          <Redirect to="/tracking" />
        </Route>
      )}
      {canAccess("suppliers") ? (
        <Route path="/suppliers">
          <Redirect to="/parties?tab=suppliers" />
        </Route>
      ) : (
        <Route path="/suppliers">
          <Redirect to="/tracking" />
        </Route>
      )}
      {canAccess("customers") ? (
        <Route path="/customers">
          <Redirect to="/parties?tab=customers" />
        </Route>
      ) : (
        <Route path="/customers">
          <Redirect to="/tracking" />
        </Route>
      )}
      {canAccess("suppliers") && <Route path="/suppliers/:supplierId/proformas" component={SupplierProformas} />}
      {canAccess("suppliers") && <Route path="/suppliers/:id/edit" component={EditSupplier} />}
      {canAccess("suppliers") && <Route path="/supplier-profit-check" component={SupplierProfitCheck} />}

      {/* Vouchers */}
      {canAccess("vouchers") ? (
        <Route path="/vouchers">{() => <Vouchers />}</Route>
      ) : (
        <Route path="/vouchers">
          <Redirect to="/tracking" />
        </Route>
      )}
      {canAccess("vouchers") && <Route path="/vouchers/:id/edit" component={VoucherEdit} />}
      {canAccess("vouchers") && <Route path="/purchase-orders/:id/edit" component={PurchaseOrderEdit} />}
      {canAccess("vouchers") ? (
        <Route path="/voucher-detail/:voucherId" component={VoucherDetail} />
      ) : (
        <Route path="/voucher-detail/:voucherId">
          <Redirect to="/tracking" />
        </Route>
      )}

      {/* Daybook */}
      {canAccess("daybook") ? (
        <Route path="/daybook">{() => <Daybook user={user} />}</Route>
      ) : (
        <Route path="/daybook">
          <Redirect to="/tracking" />
        </Route>
      )}
      <Route path="/transaction-journal" component={TransactionJournal} />

      {/* Payroll */}
      {G("/payroll", "payroll", Payroll)}

      {/* Create Voucher */}
      {G("/create", "create", AccountingCreate)}

      {/* Stock Items & Query */}
      <Route path="/import-stock-items" component={ImportStockItems} />
      {canAccess("stock_query") ? (
        <Route path="/stock-query/:id" component={StockItemDetail} />
      ) : (
        <Route path="/stock-query/:id">
          <Redirect to="/tracking" />
        </Route>
      )}
      {canAccess("stock_query") ? (
        <Route path="/stock-query">
          <Redirect to="/stock?tab=query" />
        </Route>
      ) : (
        <Route path="/stock-query">
          <Redirect to="/tracking" />
        </Route>
      )}
      {canAccess("stock_items") ? (
        <Route path="/offload-item-search">
          <Redirect to="/stock?tab=offload" />
        </Route>
      ) : (
        <Route path="/offload-item-search">
          <Redirect to="/tracking" />
        </Route>
      )}
      {canAccess("stock_query") ? (
        <Route path="/location-summary">
          <Redirect to="/stock-query?tab=summary" />
        </Route>
      ) : (
        <Route path="/location-summary">
          <Redirect to="/tracking" />
        </Route>
      )}
      <Route path="/stock-transfer-order" component={StockTransferOrder} />

      {/* Sales Tools Hub */}
      <Route path="/sales-tools" component={SalesToolsHub} />
      <Route path="/stock-transfers">
        <Redirect to="/sales-tools?tab=transfers" />
      </Route>

      {/* Optional Vouchers */}
      {G("/optional-vouchers", "optional_vouchers", OptionalVouchers)}

      {/* Stock item detail sub-pages — inherit stock_items access */}
      {canAccess("stock_items") && <Route path="/stock-items/:id/history" component={StockItemHistory} />}
      {canAccess("stock_items") && <Route path="/stock-items/:id/history/:year/:month" component={StockItemVouchers} />}
      {canAccess("stock_items") && (
        <Route path="/stock-items/:stockItemId/monthly-summary">{() => <LocationMonthlySummary />}</Route>
      )}
      {canAccess("location_inventory") && (
        <Route path="/locations/:locationId/stock-items/:stockItemId/history">{() => <LocationMonthlySummary />}</Route>
      )}
      {canAccess("location_inventory") && (
        <Route path="/locations/:locationId/stock-items/:stockItemId/vouchers/:year/:month">
          {() => <LocationVouchers />}
        </Route>
      )}

      {/* Sales Report */}
      {G("/sales-report", "sales_report", SalesReport)}
      {canAccess("sales_report") && <Route path="/sales-report/detail" component={SalesReportDetail} />}
      {canAccess("sales_report") && <Route path="/sales-report/comparison" component={SalesReportComparison} />}

      {/* Developer-only */}
      {user?.role === "Developer" && <Route path="/company-transfer" component={CompanyTransfer} />}
      {user?.role === "Developer" && <Route path="/net-profit-report" component={NetProfitReport} />}
      {user?.role === "Developer" && <Route path="/spreadsheet" component={SpreadsheetEditor} />}
      {user?.role === "Developer" && <Route path="/live-sheets" component={LiveSheets} />}

      {/* Inventory combined redirect */}
      {canAccess("stock_items") ? (
        <Route path="/combined-inventory">
          <Redirect to="/inventory?tab=combined" />
        </Route>
      ) : (
        <Route path="/combined-inventory">
          <Redirect to="/tracking" />
        </Route>
      )}

      {/* Other stock/accounting utilities */}
      <Route path="/bale-ledger" component={BaleLedger} />
      {canAccess("pos_daybook") ? (
        <Route path="/pos-daybook">
          <Redirect to="/sales-tools?tab=daybook" />
        </Route>
      ) : (
        <Route path="/pos-daybook">
          <Redirect to="/tracking" />
        </Route>
      )}
      <Route path="/pos-price-list">
        <Redirect to="/sales-tools?tab=pricelist" />
      </Route>
      <Route path="/price-list">
        <Redirect to="/sales-tools?tab=pricelist" />
      </Route>
      <Route path="/opening-stock" component={OpeningStockSummary} />
      <Route path="/opening-stock/:groupId" component={OpeningStockDetail} />
      <Route path="/closing-stock-summary" component={ClosingStockSummary} />
      <Route path="/closing-stock/:groupId" component={ClosingStockDetail} />
      <Route path="/barcode-manager" component={BarcodeManager} />

      {/* Chat — available to all non-POS ERP users */}
      <Route path="/chat" component={Chat} />

      {/* Factory redirects */}
      <Route path="/factory-production">
        <Redirect to="/factory/raw-stock" />
      </Route>
      <Route path="/bales">
        <Redirect to="/factory/raw-stock" />
      </Route>
      <Route path="/production-bales">
        <Redirect to="/factory/stock-entry" />
      </Route>
      <Route path="/bale-products">
        <Redirect to="/factory/bale-products" />
      </Route>

      {/* Rental */}
      <Route path="/erp/rental/warehouses" component={ErpRentalWarehouses} />
      <Route path="/erp/rental/shops" component={ErpRentalShops} />
      <Route path="/erp/rental/payments" component={ErpRentalPayments} />

      {/* Conflict center */}
      <Route path="/conflicts" component={ConflictCenter} />

      {/* Admin/Developer-only system pages */}
      {(user?.role === "Admin" || user?.role === "Developer") && <Route path="/settings" component={Settings} />}
      {(user?.role === "Admin" || user?.role === "Developer") && (
        <Route path="/intercompany-links" component={IntercompanyLinks} />
      )}
      <Route path="/intercompany-requests" component={IntercompanyRequests} />
      {(user?.role === "Admin" || user?.role === "Developer") && (
        <Route path="/orphaned-records" component={OrphanedRecords} />
      )}
      {(user?.role === "Admin" || user?.role === "Developer") && (
        <Route path="/deleted-items" component={DeletedItems} />
      )}
      {(user?.role === "Admin" || user?.role === "Developer") && (
        <Route path="/chatbot-settings" component={ChatbotSettings} />
      )}
      {(user?.role === "Admin" || user?.role === "Developer") && (
        <Route path="/notification-settings" component={NotificationSettings} />
      )}
      {(user?.role === "Admin" || user?.role === "Developer") && (
        <Route path="/account-groups" component={AccountGroups} />
      )}
      {(user?.role === "Admin" || user?.role === "Developer") && (
        <Route path="/test-data-import" component={TestDataImport} />
      )}
      {(user?.role === "Admin" || user?.role === "Developer") && (
        <Route path="/import-cycle-diagnostics" component={ImportCycleDiagnostics} />
      )}
      {(user?.role === "Admin" || user?.role === "Developer") && (
        <Route path="/inventory-repair" component={InventoryRepair} />
      )}
      {(user?.role === "Admin" || user?.role === "Developer") && (
        <Route path="/balance-repair" component={BalanceRepair} />
      )}
      {(user?.role === "Admin" || user?.role === "Developer") && (
        <Route path="/net-position-details" component={NetProfitDetails} />
      )}
      {(user?.role === "Admin" || user?.role === "Developer") && (
        <Route path="/company-data-reset" component={CompanyDataReset} />
      )}
      {(user?.role === "Admin" || user?.role === "Developer") && (
        <Route path="/account-migration" component={AccountMigration} />
      )}
      {(user?.role === "Admin" || user?.role === "Developer") && (
        <Route path="/account-transfer" component={AccountTransfer} />
      )}

      {/* Personal settings — always accessible */}
      <Route path="/my-settings" component={MySettings} />

      {/* Supplier Partner pages */}
      <Route path="/sp/opening-stock" component={SpOpeningStock} />
      <Route path="/sp/reports" component={SpReports} />
      <Route path="/sp/aliases" component={SpAliases} />
      {/* Legacy path: redirect to the safe staged migration UI instead of the retired all-in-one page */}
      <Route path="/sp/migration" component={GcLshiMigration} />
      <Route path="/sp/gc-migration" component={GcLshiMigration} />
      <Route path="/sp/setup" component={SpSetup} />

      <Route component={NotFound} />
    </Switch>
  );
}
