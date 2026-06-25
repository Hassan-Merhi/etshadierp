import { useEffect, useCallback, useState, useRef, lazy, Suspense } from "react";
import { useButtonClickFeedback } from "@/hooks/use-button-click-feedback";
import { useServerRestart } from "@/hooks/use-server-restart";
import { useDialogScrollFix } from "@/hooks/use-dialog-scroll-fix";
import { Switch, Route, useLocation, Redirect } from "wouter";
import { hasActiveEscapeHandler } from "@/hooks/use-escape-back";
import { getParentRoute } from "@/lib/parent-routes";
import { queryClient, getQueryFn, setAppTimezone } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ChatWidget } from "@/components/ChatWidget";
import {
  SidebarProvider,
  SidebarTrigger,
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarGroup,
  SidebarGroupContent,
} from "@/components/ui/sidebar";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ThemeToggle } from "@/components/ThemeToggle";
import { CurrencyToggle } from "@/components/CurrencyToggle";
import { CompanySelector } from "@/components/CompanySelector";
import { AppSidebar } from "@/components/AppSidebar";
import { DailyRateModal } from "@/components/DailyRateModal";
import { LocationProvider } from "@/contexts/LocationContext";
import { CompanyProvider, useCompany } from "@/contexts/CompanyContext";
import { DateFormatProvider } from "@/contexts/DateFormatContext";
import { CurrencyProvider } from "@/contexts/CurrencyContext";
import { AppModeProvider } from "@/contexts/AppModeContext";
import { CursorNavProvider } from "@/contexts/CursorNavContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  LogOut,
  ShoppingCart,
  MapPin,
  BookOpen,
  Package,
  Users,
  Upload,
  Factory,
  MessageSquare,
  Cog,
  Search,
  Tag,
  Building2,
  ClipboardList,
} from "lucide-react";
import { FactorySidebar, FACTORY_NAV_SECTIONS, FACTORY_NAV_PAGES } from "@/components/FactorySidebar";
import { PropertiesSidebar } from "@/components/PropertiesSidebar";
import { OfflineBanner } from "@/components/OfflineBanner";
import { DateJumpDialog } from "@/components/DateJumpDialog";
import { PendingSyncIndicator } from "@/components/PendingSyncIndicator";
import { ConnectivityProvider } from "@/contexts/ConnectivityContext";
import { usePresence } from "@/hooks/use-presence";
import { useScreenFeed } from "@/hooks/use-screen-feed";
import { useWsInvalidation } from "@/hooks/use-ws-invalidation";
import { apiRequest } from "@/lib/queryClient";
import NotFound from "@/pages/not-found";
import Login from "@/pages/Login";
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const ContainersOTW = lazy(() => import("@/pages/GITContainers"));
const GITMockup = lazy(() => import("@/pages/GITMockup"));
const TrackingHub = lazy(() => import("@/pages/TrackingHub"));
const POS = lazy(() => import("@/pages/pos/POS"));
const POSPage = lazy(() => import("@/pages/pos/POSPage"));
const StockItems = lazy(() => import("@/pages/StockItems"));
const Containers = lazy(() => import("@/pages/Containers"));
const ContainersPage = lazy(() => import("@/pages/ContainersPage"));
const InventoryHub = lazy(() => import("@/pages/InventoryHub"));
const StockHub = lazy(() => import("@/pages/StockHub"));
const Accounts = lazy(() => import("@/pages/Accounts"));
const Agents = lazy(() => import("@/pages/Agents"));
const FactoryAccounts = lazy(() => import("@/pages/factory/FactoryAccounts"));
const FactoryVouchers = lazy(() => import("@/pages/factory/FactoryVouchers"));
const Suppliers = lazy(() => import("@/pages/Suppliers"));
const Vouchers = lazy(() => import("@/pages/Vouchers"));
const Daybook = lazy(() => import("@/pages/Daybook"));
const TransactionJournal = lazy(() => import("@/pages/TransactionJournal"));
const FactoryDaybook = lazy(() => import("@/pages/factory/FactoryDaybook"));
const Analytics = lazy(() => import("@/pages/Analytics"));
const AccountingCreate = lazy(() => import("@/pages/AccountingCreate"));
const POImport = lazy(() => import("@/pages/POImport"));
const AiValidationPage = lazy(() => import("@/pages/AiValidationPage"));
const AICommandCenter = lazy(() => import("@/pages/AICommandCenter"));
const POSImport = lazy(() => import("@/pages/pos/POSImport"));
const ContainerDetail = lazy(() => import("@/pages/ContainerDetail"));
const ContainerDetailPage = lazy(() => import("@/pages/ContainerDetailPage"));
const LocationInventory = lazy(() => import("@/pages/LocationInventory"));
const FactoryLocationInventory = lazy(() => import("@/pages/factory/FactoryLocationInventory"));
const FactoryLocationInventoryMockup = lazy(() => import("@/pages/factory/FactoryLocationInventoryMockup"));
const Settings = lazy(() => import("@/pages/Settings"));
const VoucherEdit = lazy(() => import("@/pages/VoucherEdit"));
const Payroll = lazy(() => import("@/pages/Payroll"));
const ImportStockItems = lazy(() => import("@/pages/ImportStockItems"));
const StockQuery = lazy(() => import("@/pages/StockQuery"));
const OffloadItemSearch = lazy(() => import("@/pages/OffloadItemSearch"));
const StockItemDetail = lazy(() => import("@/pages/StockItemDetail"));
const FactoryStockItemDetail = lazy(() => import("@/pages/factory/FactoryStockItemDetail"));
const FactoryStockBaleList = lazy(() => import("@/pages/factory/FactoryStockBaleList"));
const SalesReport = lazy(() => import("@/pages/SalesReport"));
const CompanyTransfer = lazy(() => import("@/pages/CompanyTransfer"));
const POSDaybook = lazy(() => import("@/pages/pos/POSDaybook"));
const SalesToolsHub = lazy(() => import("@/pages/SalesToolsHub"));
const PartiesHub = lazy(() => import("@/pages/PartiesHub"));
const POSDashboard = lazy(() => import("@/pages/pos/POSDashboard"));
const POSCustomers = lazy(() => import("@/pages/pos/POSCustomers"));
const POSSettings = lazy(() => import("@/pages/pos/POSSettings"));
const POSPriceList = lazy(() => import("@/pages/pos/POSPriceList"));
const PosTransferOrders = lazy(() => import("@/pages/pos/PosTransferOrders"));
const EditSupplier = lazy(() => import("@/pages/EditSupplier"));
const SupplierProformas = lazy(() => import("@/pages/SupplierProformas"));
const SupplierProfitCheck = lazy(() => import("@/pages/SupplierProfitCheck"));
const ContainerVerification = lazy(() => import("@/pages/ContainerVerification"));
const StockOTW = lazy(() => import("@/pages/StockOTW"));
const Customers = lazy(() => import("@/pages/Customers"));
const SoldContainers = lazy(() => import("@/pages/SoldContainers"));
const Bales = lazy(() => import("@/pages/Bales"));
const ProductionBales = lazy(() => import("@/pages/ProductionBales"));
const BaleProducts = lazy(() => import("@/pages/BaleProducts"));
const OrphanedRecords = lazy(() => import("@/pages/OrphanedRecords"));
const DeletedItems = lazy(() => import("@/pages/DeletedItems"));
const ChatbotSettings = lazy(() => import("@/pages/ChatbotSettings"));
const NotificationSettings = lazy(() => import("@/pages/NotificationSettings"));
const AccountGroups = lazy(() => import("@/pages/AccountGroups"));
const PurchaseOrderEdit = lazy(() => import("@/pages/PurchaseOrderEdit"));
const OffloadDetail = lazy(() => import("@/pages/OffloadDetail"));
const StockItemHistory = lazy(() => import("@/pages/StockItemHistory"));
const StockItemVouchers = lazy(() => import("@/pages/StockItemVouchers"));
const LocationMonthlySummary = lazy(() => import("@/pages/LocationMonthlySummary"));
const LocationVouchers = lazy(() => import("@/pages/LocationVouchers"));
const OpeningStockSummary = lazy(() => import("@/pages/OpeningStockSummary"));
const OpeningStockDetail = lazy(() => import("@/pages/OpeningStockDetail"));
const ClosingStockSummary = lazy(() => import("@/pages/ClosingStockSummary"));
const ClosingStockDetail = lazy(() => import("@/pages/ClosingStockDetail"));
const LedgerMonthlySummary = lazy(() => import("@/pages/LedgerMonthlySummary"));
const LedgerVouchers = lazy(() => import("@/pages/LedgerVouchers"));
const VoucherDetail = lazy(() => import("@/pages/VoucherDetail"));
const FactoryProduction = lazy(() => import("@/pages/factory/FactoryProduction"));
const ProductionRawStock = lazy(() => import("@/pages/factory/ProductionRawStock"));
const FactoryOpeningBalanceEdit = lazy(() => import("@/pages/factory/FactoryOpeningBalanceEdit"));
const PressingBales = lazy(() => import("@/pages/PressingBales"));
const BaleStockEntry = lazy(() => import("@/pages/factory/BaleStockEntry"));
const BalesHistory = lazy(() => import("@/pages/factory/BalesHistory"));
const FactoryBaleProductHistory = lazy(() => import("@/pages/factory/FactoryBaleProductHistory"));
const FactoryBaleProductMonthDetail = lazy(() =>
  import("@/pages/factory/FactoryBaleProductHistory").then((m) => ({ default: m.FactoryBaleProductMonthDetail }))
);
const FactoryBaleProductAllMonths = lazy(() =>
  import("@/pages/factory/FactoryBaleProductHistory").then((m) => ({ default: m.FactoryBaleProductAllMonths }))
);
const BarcodeLookup = lazy(() => import("@/pages/BarcodeLookup"));
const FactoryBalesHub = lazy(() => import("@/pages/factory/FactoryBalesHub"));
const FactoryReprintLabels = lazy(() => import("@/pages/factory/FactoryReprintLabels"));
const FactoryRawMaterialsHub = lazy(() => import("@/pages/factory/FactoryRawMaterialsHub"));
const FactoryLoadingsHub = lazy(() => import("@/pages/factory/FactoryLoadingsHub"));
const ProductionSummary = lazy(() => import("@/pages/factory/ProductionSummary"));
const FactorySuppliers = lazy(() => import("@/pages/factory/FactorySuppliers"));
const FactoryPartiesHub = lazy(() => import("@/pages/factory/FactoryPartiesHub"));
const FactoryContainers = lazy(() => import("@/pages/factory/FactoryContainers"));
const FactoryContainerCreate = lazy(() => import("@/pages/factory/FactoryContainerCreate"));
const FactoryContainersHub = lazy(() => import("@/pages/factory/FactoryContainersHub"));
const BarcodeManager = lazy(() => import("@/pages/BarcodeManager"));
const TestDataImport = lazy(() => import("@/pages/TestDataImport"));
const ImportCycleDiagnostics = lazy(() => import("@/pages/ImportCycleDiagnostics"));
const InventoryRepair = lazy(() => import("@/pages/InventoryRepair"));
const BalanceRepair = lazy(() => import("@/pages/BalanceRepair"));
const NetProfitDetails = lazy(() => import("@/pages/NetProfitDetails"));
const NetProfitReport = lazy(() => import("@/pages/NetProfitReport"));
const FactoryNetProfitAnalytics = lazy(() => import("@/pages/factory/FactoryNetProfitAnalytics"));
const FactoryNetPosition = lazy(() => import("@/pages/factory/FactoryNetPosition"));
const FactoryNetPositionDetails = lazy(() => import("@/pages/factory/FactoryNetPositionDetails"));
const FactoryFinancialSnapshot = lazy(() => import("@/pages/factory/FactoryFinancialSnapshot"));
const DailyProductionReport = lazy(() => import("@/pages/factory/DailyProductionReport"));
const CompanyDataReset = lazy(() => import("@/pages/CompanyDataReset"));
const AccountMigration = lazy(() => import("@/pages/AccountMigration"));
const AccountTransfer = lazy(() => import("@/pages/AccountTransfer"));
const StockTransferOrder = lazy(() => import("@/pages/StockTransferOrder"));
const StockTransfers = lazy(() => import("@/pages/StockTransfers"));
const OptionalVouchers = lazy(() => import("@/pages/OptionalVouchers"));
const BaleLedger = lazy(() => import("@/pages/BaleLedger"));
const SalesReportDetail = lazy(() => import("@/pages/SalesReportDetail"));
const SalesReportComparison = lazy(() => import("@/pages/SalesReportComparison"));
const FactoryImport = lazy(() => import("@/pages/factory/FactoryImport"));
const FactoryBaleRelabeling = lazy(() => import("@/pages/factory/FactoryBaleRelabeling"));
const MergeBaleProducts = lazy(() => import("@/pages/factory/MergeBaleProducts"));
const BaleProductImages = lazy(() => import("@/pages/factory/BaleProductImages"));
const CustomerLogosSettings = lazy(() => import("@/pages/factory/CustomerLogosSettings"));
const LabelBannersSettings = lazy(() => import("@/pages/factory/LabelBannersSettings"));
const WipersReEntry = lazy(() => import("@/pages/factory/WipersReEntry"));
const FactoryUsers = lazy(() => import("@/pages/factory/FactoryUsers"));
const FactoryWorkersHub = lazy(() => import("@/pages/factory/FactoryWorkersHub"));
const FactoryWorkerDetail = lazy(() => import("@/pages/factory/FactoryWorkerDetail"));
const FactoryEmployeesHub = lazy(() => import("@/pages/factory/FactoryEmployeesHub"));
const FactoryEmployeeDetail = lazy(() => import("@/pages/factory/FactoryEmployeeDetail"));
const FactoryPayrollHub = lazy(() => import("@/pages/factory/FactoryPayrollHub"));
const FactorySupplierReport = lazy(() => import("@/pages/factory/FactorySupplierReport"));
const FactorySupplierStatement = lazy(() => import("@/pages/factory/FactorySupplierStatement"));
const FactoryBrokerVisualStatement = lazy(() => import("@/pages/factory/FactoryBrokerVisualStatement"));
const FactoryCustomers = lazy(() => import("@/pages/factory/FactoryCustomers"));
const FactoryCustomerStatement = lazy(() => import("@/pages/factory/FactoryCustomerStatement"));
const FactoryInvoicing = lazy(() => import("@/pages/factory/FactoryInvoicing"));
const FactoryInvoices = lazy(() => import("@/pages/factory/FactoryInvoices"));
const FactoryInvoiceCreate = lazy(() => import("@/pages/factory/FactoryInvoiceCreate"));
const FactoryInvoiceDetail = lazy(() => import("@/pages/factory/FactoryInvoiceDetail"));
const FactoryProformas = lazy(() => import("@/pages/factory/FactoryProformas"));
const FactoryDispatchBatches = lazy(() => import("@/pages/factory/FactoryDispatchBatches"));
const FactoryDispatchBatchDetail = lazy(() => import("@/pages/factory/FactoryDispatchBatchDetail"));
const FactoryDispatchBatchScan = lazy(() => import("@/pages/factory/FactoryDispatchBatchScan"));
const FactoryBaleTracking = lazy(() => import("@/pages/factory/FactoryBaleTracking"));
const FactoryStockAllocation = lazy(() => import("@/pages/factory/FactoryStockAllocationV2"));
const FactoryStockAllocationV3 = lazy(() => import("@/pages/factory/FactoryStockAllocationV3"));
const FactoryStockAllocationV5 = lazy(() => import("@/pages/factory/FactoryStockAllocationV5"));
const ProformaAddLine = lazy(() => import("@/pages/factory/ProformaAddLine"));
const FactoryPriceList = lazy(() => import("@/pages/factory/FactoryPriceList"));
const FactoryPendingInvoiceVerify = lazy(() => import("@/pages/factory/FactoryPendingInvoiceVerify"));
const FactoryPendingLoadings = lazy(() => import("@/pages/factory/FactoryPendingLoadings"));
const FactoryContainerLoadingScan = lazy(() => import("@/pages/factory/FactoryContainerLoadingScan"));
const FactoryInvoiceLoadingScan = lazy(() => import("@/pages/factory/FactoryInvoiceLoadingScan"));
const FactoryTransporters = lazy(() => import("@/pages/factory/FactoryTransporters"));
const FactoryDashboardIntel = lazy(() => import("@/pages/factory/FactoryDashboard"));
const FactoryKpis = lazy(() => import("@/pages/factory/FactoryKpis"));
const FactoryProfitability = lazy(() => import("@/pages/factory/FactoryProfitability"));
const FactoryAlerts = lazy(() => import("@/pages/factory/FactoryAlerts"));
const FactorySupplierScoreboard = lazy(() => import("@/pages/factory/FactorySupplierScoreboard"));
const FactoryMixOptimizer = lazy(() => import("@/pages/factory/FactoryMixOptimizer"));
const FactoryCashflow = lazy(() => import("@/pages/factory/FactoryCashflow"));
const FactoryWaste = lazy(() => import("@/pages/factory/FactoryWaste"));
const FactorySupplierHub = lazy(() => import("@/pages/factory/FactorySupplierHub"));
const FactoryFinancialHub = lazy(() => import("@/pages/factory/FactoryFinancialHub"));
const FactoryProductionIntelHub = lazy(() => import("@/pages/factory/FactoryProductionIntelHub"));
const WasteDispatchPage = lazy(() => import("@/pages/factory/WasteDispatch"));
const FactoryPOS = lazy(() => import("@/pages/factory/FactoryPOS"));
const FactoryIntelSettings = lazy(() => import("@/pages/factory/FactorySettings"));
const ConflictCenter = lazy(() => import("@/pages/ConflictCenter"));
const Chat = lazy(() => import("@/pages/Chat"));
const SpreadsheetEditor = lazy(() => import("@/pages/SpreadsheetEditor"));
const LiveSheets = lazy(() => import("@/pages/LiveSheets"));
const PropertiesDashboard = lazy(() => import("@/pages/properties/PropertiesDashboard"));
const PropertiesAccounts = lazy(() => import("@/pages/properties/PropertiesAccounts"));
const PropertiesVouchers = lazy(() => import("@/pages/properties/PropertiesVouchers"));
const PropertiesVoucherEdit = lazy(() => import("@/pages/properties/PropertiesVoucherEdit"));
const PropertiesVoucherDetail = lazy(() => import("@/pages/properties/PropertiesVoucherDetail"));
const PropertiesCreate = lazy(() => import("@/pages/properties/PropertiesCreate"));
const PropertiesAnalytics = lazy(() => import("@/pages/properties/PropertiesAnalytics"));
const PropertiesDaybook = lazy(() => import("@/pages/properties/PropertiesDaybook"));
const PropertiesLedgerMonthly = lazy(() => import("@/pages/properties/PropertiesLedgerMonthly"));
const PropertiesLedgerVouchers = lazy(() => import("@/pages/properties/PropertiesLedgerVouchers"));
const PropertiesSettings = lazy(() => import("@/pages/properties/PropertiesSettings"));
const PropertiesRentalWarehouses = lazy(() => import("@/pages/properties/PropertiesRentalWarehouses"));
const PropertiesRentalShops = lazy(() => import("@/pages/properties/PropertiesRentalShops"));
const ErpRentalWarehouses = lazy(() => import("@/pages/erp/ErpRentalWarehouses"));
const ErpRentalShops = lazy(() => import("@/pages/erp/ErpRentalShops"));
const ErpRentalPayments = lazy(() => import("@/pages/erp/ErpRentalPayments"));
const FactoryRentalWarehouses = lazy(() => import("@/pages/factory/FactoryRentalWarehouses"));
const FactoryRentalShops = lazy(() => import("@/pages/factory/FactoryRentalShops"));
const FactoryRentalPayments = lazy(() => import("@/pages/factory/FactoryRentalPayments"));
const PropertiesRentalPayments = lazy(() => import("@/pages/properties/PropertiesRentalPayments"));
const MySettings = lazy(() => import("@/pages/MySettings"));

// ── Supplier Partner pages ────────────────────────────────────────────────────
const SpSetup = lazy(() => import("@/pages/sp/SpSetup"));
const SpReports = lazy(() => import("@/pages/sp/SpReports"));
const SpOpeningStock = lazy(() => import("@/pages/sp/SpOpeningStock"));
const SpAliases = lazy(() => import("@/pages/sp/SpAliases"));
const SpMigrationRehearsal = lazy(() => import("@/pages/sp/SpMigrationRehearsal"));
const GcLshiMigration = lazy(() => import("@/pages/sp/GcLshiMigration"));
const IntercompanyLinks = lazy(() => import("@/pages/IntercompanyLinks"));
const IntercompanyRequests = lazy(() => import("@/pages/IntercompanyRequests"));

import { CommandPalette } from "@/components/CommandPalette";
import { AppTopBar } from "@/components/AppTopBar";
import { UserNotesPanel } from "@/components/UserNotesPanel";
import { KeyboardShortcuts, KeyboardShortcutsButton } from "@/components/KeyboardShortcuts";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ArrowLeft } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

declare global {
  interface Window {
    __escBackGuard?: () => boolean;
    __escBackConfirm?: () => void;
  }
}

function Router({ user, posImportEnabled }: { user: any; posImportEnabled?: boolean }) {
  const isPOS = user?.role === "POS";
  const [_location, navigate] = useLocation();

  // ERP page-level access — mirrors the sidebar visibility system.
  // The cache is warmed by AppSidebar so this is effectively free.
  // Optimistic while loading (allow) to avoid flicker on first render.
  const { data: erpAccess } = useQuery<{ fullAccess: boolean; pageKeys: string[] }>({
    queryKey: ["/api/my-erp-pages"],
    enabled: !!user && !isPOS,
    staleTime: 30000,
  });

  // Redirect legacy /pos URL to / for POS users
  useEffect(() => {
    if (isPOS && window.location.pathname === "/pos") {
      navigate("/");
    }
  }, [isPOS, navigate]);

  // POS users only see POS and Location Inventory
  if (isPOS) {
    return (
      <Switch>
        <Route path="/">{() => <POS posUser={user} />}</Route>
        <Route path="/pos/edit/:id">{(params) => <POS posUser={user} editVoucherId={params.id} />}</Route>
        <Route path="/location-inventory">{() => <LocationInventory posUser={user} />}</Route>
        <Route path="/locations/:locationId/stock-items/:stockItemId/history">
          {() => <LocationMonthlySummary posUser={user} />}
        </Route>
        <Route path="/locations/:locationId/stock-items/:stockItemId/vouchers/:year/:month">
          {() => <LocationVouchers posUser={user} />}
        </Route>
        <Route path="/pos-daybook" component={POSDaybook} />
        <Route path="/pos-dashboard">{() => <POSDashboard posUser={user} />}</Route>
        <Route path="/pos-customers">{() => <POSCustomers />}</Route>
        <Route path="/pos-import">{() => (posImportEnabled ? <POSImport /> : <Redirect to="/" />)}</Route>
        <Route path="/vouchers">{() => <Vouchers posUser={user} />}</Route>
        <Route path="/pos-chat" component={Chat} />
        <Route path="/pos-settings" component={POSSettings} />
        <Route path="/pos-price-list">{() => <POSPriceList posUser={user} />}</Route>
        <Route path="/pos-transfer-orders">{() => <PosTransferOrders posUser={user} />}</Route>
        <Route path="/my-settings" component={MySettings} />
        <Route>{() => <POS posUser={user} />}</Route>
      </Switch>
    );
  }

  const isAdminOrDev = user?.role === "Admin" || user?.role === "Developer";

  // Returns true when the user has access to the given ERP feature key.
  // Optimistic (true) while the access data is still loading so pages don't
  // flicker on first render. fullAccess:true means no restrictions (Admin/Dev/
  // Owner with no explicit restrictions set).
  const canAccess = (key: string) => !erpAccess || erpAccess.fullAccess || erpAccess.pageKeys.includes(key);

  // Helper: renders a guarded Route that redirects to /tracking when blocked.
  const G = (path: string, key: string, Comp: React.ComponentType<any>) =>
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
      <Route path="/sp/migration" component={SpMigrationRehearsal} />
      <Route path="/sp/gc-migration" component={GcLshiMigration} />
      <Route path="/sp/setup" component={SpSetup} />

      <Route component={NotFound} />
    </Switch>
  );
}

function AuthenticatedApp() {
  const { selectedCompany } = useCompany();
  usePresence(); // Track user presence
  useScreenFeed(); // Silently capture screen frames for admin Watch feature
  useWsInvalidation(); // Real-time cache invalidation via WebSocket
  useDialogScrollFix(); // Global fix: prevent Radix dialogs from leaving body frozen after close
  const [location, setLocation] = useLocation();
  const [currentLocation] = useLocation();
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const factoryContainerRef = useRef<HTMLDivElement>(null);
  useButtonClickFeedback(factoryContainerRef);

  // Reset scroll position on every route change so the new page always starts at top
  useEffect(() => {
    const main = document.querySelector("main");
    if (main) main.scrollTop = 0;
  }, [currentLocation]);

  const {
    data: user,
    isLoading,
    error,
  } = useQuery<any>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
    staleTime: 30 * 60 * 1000,
  });

  const navigateToParent = useCallback(() => {
    const parent = getParentRoute(window.location.pathname);
    if (parent) {
      setLocation(parent);
    } else if (window.history.length > 1) {
      window.history.back();
    }
  }, [setLocation]);

  const handleGoBack = useCallback(() => {
    if (window.__escBackGuard && window.__escBackGuard()) {
      setShowLeaveConfirm(true);
      return;
    }
    navigateToParent();
  }, [navigateToParent]);

  const handleConfirmLeave = useCallback(() => {
    setShowLeaveConfirm(false);
    if (window.__escBackConfirm) {
      window.__escBackConfirm();
    }
    navigateToParent();
  }, [navigateToParent]);

  useEffect(() => {
    // ─── Scroll-key helpers ────────────────────────────────────────────────────
    // RULE: never call e.preventDefault() on arrow / page keys unless we have
    // confirmed that a scrollable element exists AND can actually move in the
    // requested direction. Doing otherwise blocks cursor movement in inputs,
    // Radix widget keyboard navigation, and native browser behavior.

    // Returns true when the event target is an element that owns arrow-key
    // behavior: text inputs, selects, contentEditable nodes, and ARIA widgets
    // such as listboxes, menus, sliders, and comboboxes.
    function isEditableTarget(el: HTMLElement): boolean {
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (el.isContentEditable) return true;
      const role = el.getAttribute("role");
      if (
        role &&
        [
          "listbox", "option", "combobox", "menu", "menuitem",
          "menuitemcheckbox", "menuitemradio", "slider", "spinbutton",
          "treeitem", "tree", "gridcell", "row", "columnheader",
        ].includes(role)
      )
        return true;
      if (el.hasAttribute("data-radix-scroll-area-viewport")) return true;
      return false;
    }

    // Returns true only when `el` has a scrollable overflow style AND still has
    // room to scroll in the requested direction. Both conditions must be met.
    function canScroll(el: Element, axis: "x" | "y", direction: number): boolean {
      const s = window.getComputedStyle(el);
      if (axis === "y") {
        const ov = s.overflowY;
        if (ov !== "auto" && ov !== "scroll" && ov !== "overlay") return false;
        return direction > 0
          ? el.scrollTop < el.scrollHeight - el.clientHeight - 1
          : el.scrollTop > 0;
      } else {
        const ov = s.overflowX;
        if (ov !== "auto" && ov !== "scroll" && ov !== "overlay") return false;
        return direction > 0
          ? el.scrollLeft < el.scrollWidth - el.clientWidth - 1
          : el.scrollLeft > 0;
      }
    }

    // Walks up the DOM from `start` and returns the first ancestor that can
    // actually scroll in the given axis and direction.
    function getScrollableAncestor(
      start: Element | null,
      axis: "x" | "y",
      direction: number
    ): Element | null {
      let el: Element | null = start;
      while (el && el !== document.body && el !== document.documentElement) {
        if (canScroll(el, axis, direction)) return el;
        el = el.parentElement;
      }
      return null;
    }

    // Full resolution strategy — returns the best scroll target or null.
    // Null means "nothing can scroll; do not preventDefault".
    function getBestScrollTarget(
      eventTarget: HTMLElement,
      axis: "x" | "y",
      direction: number
    ): Element | null {
      // 1. Walk up from the element that received the keydown event
      const fromTarget = getScrollableAncestor(eventTarget, axis, direction);
      if (fromTarget) return fromTarget;

      // 2. Walk up from the currently focused element (may differ from event target)
      const active = document.activeElement;
      if (active && active !== eventTarget) {
        const fromActive = getScrollableAncestor(active, axis, direction);
        if (fromActive) return fromActive;
      }

      // 3. Try <main> directly (standard non-full-height pages)
      const main = document.querySelector("main");
      if (main && canScroll(main, axis, direction)) return main;

      // 4. Scan inside <main> (or body) for Tailwind overflow class elements
      //    and elements with computed overflow:auto/scroll.
      //    Covers full-height pages (e.g. Tracking) where an inner div scrolls.
      const root = main || document.body;
      const classSelector =
        axis === "x"
          ? ".overflow-auto, .overflow-x-auto, .overflow-x-scroll, .overflow-scroll"
          : ".overflow-auto, .overflow-y-auto, .overflow-y-scroll, .overflow-scroll, .custom-scrollbar";

      // Build candidate list from class-based selector first (fast path)
      const seen = new Set<Element>();
      const candidates: HTMLElement[] = [];
      for (const c of root.querySelectorAll<HTMLElement>(classSelector)) {
        seen.add(c);
        candidates.push(c);
      }
      // Supplement with elements that have computed overflow but no matching class
      for (const c of root.querySelectorAll<HTMLElement>("*")) {
        if (seen.has(c)) continue;
        const s = window.getComputedStyle(c);
        const ov = axis === "x" ? s.overflowX : s.overflowY;
        if (ov === "auto" || ov === "scroll" || ov === "overlay") candidates.push(c);
      }

      for (const c of candidates) {
        const rect = c.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue; // hidden element
        if (canScroll(c, axis, direction)) return c;
      }

      // 5. Final fallback: the document scroll root (usually <html>)
      const scrollRoot = document.scrollingElement;
      if (scrollRoot && canScroll(scrollRoot, axis, direction)) return scrollRoot;

      return null; // nothing scrollable found
    }
    // ─────────────────────────────────────────────────────────────────────────

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;

      // ── Arrow / page-scroll handling ──────────────────────────────────────
      // We intercept these only when we find a container that CAN scroll.
      // If nothing can scroll, we return early and let the browser / local
      // handlers handle the key (cursor movement, Radix navigation, etc.).
      const scrollKeys = [
        "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
        "PageUp", "PageDown", "Home", "End",
      ];
      if (scrollKeys.includes(e.key)) {
        // Always let editable elements and ARIA widgets handle their own arrows
        if (isEditableTarget(target)) return;

        const isHorizontal = e.key === "ArrowLeft" || e.key === "ArrowRight";
        const axis: "x" | "y" = isHorizontal ? "x" : "y";
        const direction =
          e.key === "ArrowDown" || e.key === "ArrowRight" ||
          e.key === "PageDown" || e.key === "End"
            ? 1
            : -1;

        const scrollTarget = getBestScrollTarget(target, axis, direction);
        if (!scrollTarget) {
          // No scrollable container found — do NOT preventDefault.
          // This preserves native browser behavior and local page handlers.
          return;
        }

        // Only now do we take ownership of the key.
        e.preventDefault();

        const step = 80;
        const pageFraction = 0.85;

        if (isHorizontal) {
          // Use "auto" (instant) so the page feels responsive to held arrow keys
          scrollTarget.scrollBy({ left: direction * step, behavior: "auto" });
        } else {
          const amount =
            e.key === "ArrowDown"
              ? step
              : e.key === "ArrowUp"
                ? -step
                : e.key === "PageDown"
                  ? window.innerHeight * pageFraction
                  : e.key === "PageUp"
                    ? -(window.innerHeight * pageFraction)
                    : e.key === "End"
                      ? 99999
                      : -99999; // Home
          scrollTarget.scrollBy({ top: amount, behavior: "auto" });
        }
        return;
      }

      // ── Escape handling (preserved exactly) ──────────────────────────────
      if (e.key !== "Escape") return;

      // If a page registered its own Esc handler (useEscapeBack), defer to it
      // entirely — including its own input/overlay guards — so we don't
      // accidentally blur an input or navigate before the page hook runs.
      if (hasActiveEscapeHandler()) return;

      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable;

      if (isInput) {
        (target as HTMLInputElement).blur();
        return;
      }

      const hasOpenOverlay = document.querySelector(
        '[data-state="open"][role="dialog"], [data-state="open"][role="alertdialog"], [data-state="open"][data-radix-popper-content-wrapper], [data-state="open"][role="listbox"], [data-state="open"][role="menu"]'
      );
      if (hasOpenOverlay) return;

      e.preventDefault();
      handleGoBack();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [handleGoBack]);

  // Safety-net: if still loading after 12 seconds, force redirect to login
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
  useEffect(() => {
    if (!isLoading) return;
    const t = setTimeout(() => setLoadingTimedOut(true), 12000);
    return () => clearTimeout(t);
  }, [isLoading]);

  const isPOS = user?.role === "POS";
  const { toast } = useToast();
  const prevUnreadRef = useRef<number>(-1);

  const { data: chatUnread } = useQuery<{ count: number }>({
    queryKey: ["/api/chat/unread-count"],
    refetchInterval: 60000,
    enabled: isPOS && !!user,
  });

  useEffect(() => {
    if (!isPOS) return;
    const count = chatUnread?.count || 0;
    if (prevUnreadRef.current === -1) {
      prevUnreadRef.current = count;
      return;
    }
    if (count > prevUnreadRef.current) {
      toast({ title: "New message", description: `You have ${count} unread message${count > 1 ? "s" : ""}.` });
    }
    prevUnreadRef.current = count;
  }, [chatUnread?.count, isPOS]);

  const { data: posCompanySettings } = useQuery<any>({
    queryKey: ["/api/company-settings"],
    enabled: !!user,
  });
  const posImportEnabled = posCompanySettings?.posExcelImportEnabled === true;

  // Keep the app's date utility in sync with the company's configured timezone.
  useEffect(() => {
    setAppTimezone(posCompanySettings?.timezone);
  }, [posCompanySettings?.timezone]);

  const {
    data: myAccess,
    isLoading: myAccessLoading,
    isError: myAccessError,
  } = useQuery<{
    fullAccess: boolean;
    pageKeys: string[];
    hasErpAccess: boolean;
    hasFactoryAccess: boolean;
    companyId?: number;
    companyName?: string;
    hiddenCostFields?: string[];
  }>({
    queryKey: ["/api/factory/my-access"],
    enabled: !!user && !isPOS,
    staleTime: 30000,
    retry: 2,
  });

  const { data: factorySettings } = useQuery<Record<string, any>>({
    queryKey: ["/api/factory/settings"],
    queryFn: async () => {
      const r = await fetch("/api/factory/settings");
      return r.ok ? r.json() : {};
    },
    enabled: !!user && !isPOS,
    staleTime: 60000,
  });

  const hasErpAccess = !myAccess || myAccess.hasErpAccess;
  const hasFactoryAccess = !myAccess || myAccess.hasFactoryAccess;
  const isAdminOwner = user?.role === "Admin" || user?.role === "Owner" || user?.role === "Developer";

  const handleLogout = async () => {
    try {
      await apiRequest("POST", "/api/auth/logout", {});
      queryClient.clear();
      try {
        const { clearBiometricCredentials } = await import("@/pages/Login");
        await clearBiometricCredentials();
      } catch {}
      window.location.href = "/login";
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  if (loadingTimedOut || (!isLoading && (error || !user))) {
    return <Redirect to="/login" />;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  const leaveConfirmDialog = (
    <AlertDialog open={showLeaveConfirm} onOpenChange={setShowLeaveConfirm}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Leave this page?</AlertDialogTitle>
          <AlertDialogDescription>
            You have an ongoing sale. Leaving now will lose your unsaved changes.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-cancel-leave">Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirmLeave} data-testid="button-confirm-leave">
            Leave
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  // POS users get a simplified interface without sidebar
  if (isPOS) {
    const isOnPOS = currentLocation === "/";
    const isOnInventory = currentLocation === "/location-inventory";
    const isOnDaybook = currentLocation === "/pos-daybook";
    const isOnImport = currentLocation === "/pos-import";
    const isOnCustomers = currentLocation === "/pos-customers";
    const isOnTransfer = currentLocation.startsWith("/vouchers");
    const isOnChat = currentLocation === "/pos-chat";
    const isOnSettings = currentLocation === "/pos-settings";
    const isOnPriceList = currentLocation === "/pos-price-list";
    const isOnTransferOrders = currentLocation === "/pos-transfer-orders";

    const posNavItems = [
      {
        label: "Point of Sale",
        icon: ShoppingCart,
        active: isOnPOS,
        testId: "button-pos-tab",
        onClick: () => setLocation("/"),
      },
      {
        label: "Daybook",
        icon: BookOpen,
        active: isOnDaybook,
        testId: "button-daybook-tab",
        onClick: () => setLocation("/pos-daybook"),
      },
      {
        label: "Inventory",
        icon: MapPin,
        active: isOnInventory,
        testId: "button-inventory-tab",
        onClick: () => setLocation("/location-inventory"),
      },
      {
        label: "Price List",
        icon: Tag,
        active: isOnPriceList,
        testId: "button-price-list-tab",
        onClick: () => setLocation("/pos-price-list"),
      },
      {
        label: "Transfer",
        icon: Package,
        active: isOnTransfer,
        testId: "button-stock-transfer-tab",
        onClick: () => setLocation("/vouchers?tab=transfer"),
      },
      {
        label: "Orders",
        icon: ClipboardList,
        active: isOnTransferOrders,
        testId: "button-transfer-orders-tab",
        onClick: () => setLocation("/pos-transfer-orders"),
      },
      ...(user.canAccessCustomers
        ? [
            {
              label: "Customers",
              icon: Users,
              active: isOnCustomers,
              testId: "button-customers-tab",
              onClick: () => setLocation("/pos-customers"),
            },
          ]
        : []),
      ...(posImportEnabled
        ? [
            {
              label: "Import",
              icon: Upload,
              active: isOnImport,
              testId: "button-pos-import-tab",
              onClick: () => setLocation("/pos-import"),
            },
          ]
        : []),
      ...(user.role === "Developer"
        ? [
            {
              label: "Chat",
              icon: MessageSquare,
              active: isOnChat,
              testId: "button-chat-tab",
              onClick: () => setLocation("/pos-chat"),
              badge: chatUnread?.count || 0,
            },
          ]
        : []),
      {
        label: "Settings",
        icon: Cog,
        active: isOnSettings,
        testId: "button-settings-tab",
        onClick: () => setLocation("/pos-settings"),
      },
    ];

    const posStyle = { "--sidebar-width": "11rem", "--sidebar-width-icon": "3rem" };

    return (
      <>
        <SidebarProvider style={posStyle as React.CSSProperties}>
          <div className="flex h-full w-full">
            {selectedCompany?.id && <DailyRateModal companyId={selectedCompany.id} />}
            <Sidebar>
              <SidebarHeader className="p-3 border-b">
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="icon" onClick={handleGoBack} data-testid="button-pos-back">
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <span className="font-semibold text-sm truncate">POS {user.posStation || ""}</span>
                </div>
              </SidebarHeader>
              <SidebarContent>
                <SidebarGroup>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {posNavItems.map((item) => (
                        <SidebarMenuItem key={item.label}>
                          <SidebarMenuButton isActive={item.active} onClick={item.onClick} data-testid={item.testId}>
                            <item.icon className="h-4 w-4" />
                            <span className="flex-1">{item.label}</span>
                            {"badge" in item && (item as any).badge > 0 && (
                              <Badge
                                variant="default"
                                className="text-xs min-w-5 justify-center"
                                data-testid="badge-chat-unread-pos"
                              >
                                {(item as any).badge}
                              </Badge>
                            )}
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              </SidebarContent>
              <SidebarFooter className="p-2 border-t space-y-1">
                <div className="text-xs text-muted-foreground px-2 truncate">{user.username}</div>
                <div className="flex items-center gap-1 flex-wrap">
                  <CurrencyToggle />
                  <CompanySelector />
                  <ThemeToggle />
                  <Button variant="ghost" size="icon" onClick={handleLogout} data-testid="button-logout">
                    <LogOut className="h-4 w-4" />
                  </Button>
                </div>
              </SidebarFooter>
            </Sidebar>
            <div className="flex flex-col flex-1 min-w-0">
              <header className="flex items-center justify-between gap-2 p-2 border-b h-12 no-print">
                <SidebarTrigger data-testid="button-sidebar-toggle" />
                <div className="flex items-center gap-2 ml-auto">
                  <PendingSyncIndicator />
                  {(user?.role === "Admin" || user?.role === "Owner" || user?.role === "Developer") && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="flex items-center gap-1.5 text-muted-foreground"
                      onClick={() => setPaletteOpen(true)}
                      data-testid="button-open-palette"
                    >
                      <Search className="h-4 w-4" />
                      <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 text-[10px] font-mono">
                        {typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform)
                          ? "⌘ /"
                          : "Ctrl /"}
                      </kbd>
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" onClick={handleLogout} data-testid="button-logout-header">
                    <LogOut className="h-4 w-4" />
                  </Button>
                </div>
              </header>
              <OfflineBanner />
              {(() => {
                const isPosRoute = currentLocation === "/pos" || currentLocation.startsWith("/pos/");
                const isFullHeightRoute = isPosRoute || currentLocation === "/tracking" || currentLocation === "/";
                return (
                  <main className={isFullHeightRoute ? "flex-1 overflow-hidden" : "flex-1 overflow-y-auto p-3 sm:p-6"}>
                    <div className={isFullHeightRoute ? "h-full" : "w-full"}>
                      <ErrorBoundary resetKey={currentLocation}>
                        <Suspense
                          fallback={
                            <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
                              Loading...
                            </div>
                          }
                        >
                          <Router user={user} posImportEnabled={posImportEnabled} />
                        </Suspense>
                      </ErrorBoundary>
                    </div>
                  </main>
                );
              })()}
            </div>
          </div>
        </SidebarProvider>
        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} isPOS={true} user={user} />
        {leaveConfirmDialog}
      </>
    );
  }

  const isPropertiesCompany = selectedCompany?.companyType === "properties";
  const isPropertiesRoute = currentLocation.startsWith("/properties/");

  if (
    isPropertiesCompany &&
    !isPropertiesRoute &&
    currentLocation !== "/my-settings" &&
    currentLocation !== "/balance-repair"
  ) {
    return <Redirect to="/properties/daybook" />;
  }

  if (isPropertiesCompany && (isPropertiesRoute || currentLocation === "/balance-repair")) {
    return (
      <AppModeProvider mode="properties">
        <SidebarProvider style={style as React.CSSProperties}>
          <div className="flex h-full w-full">
            <PropertiesSidebar user={user} />
            <div className="flex flex-col flex-1 overflow-hidden">
              <AppTopBar
                accentColor="#6366f1"
                user={user}
                onLogout={handleLogout}
                onSearchOpen={() => setPaletteOpen(true)}
                showSearch={user?.role === "Admin" || user?.role === "Owner" || user?.role === "Developer"}
                leftContent={
                  <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-indigo-600/10 border border-indigo-600/20">
                    <Building2 className="h-4 w-4 text-indigo-600" />
                    <span className="text-xs font-semibold text-indigo-600 uppercase tracking-wider">Properties</span>
                  </div>
                }
              />
              <OfflineBanner />
              <main className="flex-1 overflow-y-auto p-3 sm:p-6">
                <div className="w-full">
                  <ErrorBoundary resetKey={currentLocation}>
                    <Suspense
                      fallback={
                        <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
                          Loading...
                        </div>
                      }
                    >
                      <Switch>
                        <Route path="/properties/dashboard" component={PropertiesDashboard} />
                        <Route path="/properties/accounts" component={PropertiesAccounts} />
                        <Route path="/properties/vouchers/:id/edit" component={PropertiesVoucherEdit} />
                        <Route path="/properties/voucher-detail/:voucherId" component={PropertiesVoucherDetail} />
                        <Route path="/properties/vouchers">{() => <PropertiesVouchers />}</Route>
                        <Route path="/properties/create" component={PropertiesCreate} />
                        <Route path="/properties/analytics" component={PropertiesAnalytics} />
                        <Route path="/properties/daybook" component={PropertiesDaybook} />
                        <Route path="/properties/rental/warehouses" component={PropertiesRentalWarehouses} />
                        <Route path="/properties/rental/shops" component={PropertiesRentalShops} />
                        <Route path="/properties/rental/payments" component={PropertiesRentalPayments} />
                        {user?.role === "Developer" && (
                          <Route path="/properties/transfer" component={CompanyTransfer} />
                        )}
                        <Route path="/properties/ledger-monthly/:accountId" component={PropertiesLedgerMonthly} />
                        <Route
                          path="/properties/ledger-vouchers/:accountId/:year/:month"
                          component={PropertiesLedgerVouchers}
                        />
                        {(user?.role === "Admin" || user?.role === "Developer") && (
                          <Route path="/properties/settings" component={PropertiesSettings} />
                        )}
                        {(user?.role === "Admin" || user?.role === "Developer") && (
                          <Route path="/properties/net-position-details" component={NetProfitDetails} />
                        )}
                        {(user?.role === "Admin" || user?.role === "Developer") && (
                          <Route path="/properties/deleted-items" component={DeletedItems} />
                        )}
                        {(user?.role === "Admin" || user?.role === "Developer") && (
                          <Route path="/properties/orphaned-records" component={OrphanedRecords} />
                        )}
                        {(user?.role === "Admin" || user?.role === "Developer") && (
                          <Route path="/properties/chatbot-settings" component={ChatbotSettings} />
                        )}
                        {(user?.role === "Admin" || user?.role === "Developer") && (
                          <Route path="/properties/import-cycle-diagnostics" component={ImportCycleDiagnostics} />
                        )}
                        {(user?.role === "Admin" || user?.role === "Developer") && (
                          <Route path="/properties/inventory-repair" component={InventoryRepair} />
                        )}
                        {(user?.role === "Admin" || user?.role === "Developer") && (
                          <Route path="/properties/company-data-reset" component={CompanyDataReset} />
                        )}
                        {(user?.role === "Admin" || user?.role === "Developer") && (
                          <Route path="/properties/account-groups" component={AccountGroups} />
                        )}
                        {(user?.role === "Admin" || user?.role === "Developer") && (
                          <Route path="/balance-repair" component={BalanceRepair} />
                        )}
                        <Route path="/my-settings" component={MySettings} />
                        <Route>
                          <Redirect to="/properties/daybook" />
                        </Route>
                      </Switch>
                    </Suspense>
                  </ErrorBoundary>
                </div>
              </main>
            </div>
          </div>
        </SidebarProvider>
        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          hasErpAccess={false}
          hasFactoryAccess={false}
          hasPropertiesAccess={true}
          isAdminOwner={user?.role === "Admin" || user?.role === "Developer"}
          user={user}
        />
        {leaveConfirmDialog}
      </AppModeProvider>
    );
  }

  const isFactoryCompany = selectedCompany?.companyType === "factory" || selectedCompany?.companyType === "factory_v2";
  const isFactoryRoute = currentLocation.startsWith("/factory/");

  // Sub-page → parent pageKey for detail/action routes that aren't direct nav items.
  // Also used by factoryDefaultPage to accept old pre-merge page keys for hub pages.
  const SUBPAGE_PARENT: [prefix: string, parentKey: string][] = [
    ["/factory/sales/invoices", "factory/invoicing"],
    ["/factory/sales/new", "factory/invoicing"],
    ["/factory/sales/pending-invoices", "factory/invoicing"],
    ["/factory/invoices", "factory/invoicing"],
    ["/factory/sales/loading/", "factory/sales/loadings"],
    ["/factory/bale-product-history", "factory/bales-hub"],
    ["/factory/reprint-labels", "factory/bales-hub"],
    ["/factory/bales-history", "factory/bales-hub"],
    ["/factory/barcode-lookup", "factory/bales-hub"],
    ["/factory/payroll", "factory/payroll-hub"],
    ["/factory/worker-payroll", "factory/payroll-hub"],
    ["/factory/workers", "factory/payroll-hub"],
    ["/factory/employees", "factory/payroll-hub"],
    ["/factory/containers/new", "factory/containers-hub"],
    ["/factory/containers", "factory/containers-hub"],
    ["/factory/stock-otw", "factory/containers-hub"],
    ["/factory/customers", "factory/parties"],
    ["/factory/suppliers", "factory/parties"],
    ["/factory/net-position-details", "factory/intelligence/financial-hub"],
    ["/factory/net-position", "factory/intelligence/financial-hub"],
    ["/factory/net-profit-analytics", "factory/intelligence/financial-hub"],
    ["/factory/supplier-report", "factory/intelligence/supplier-hub"],
    ["/factory/supplier-statement", "factory/intelligence/supplier-hub"],
    ["/factory/production-summary", "factory/intelligence/production-hub"],
    ["/factory/ledger-monthly", "factory/accounts"],
    ["/factory/ledger-vouchers", "factory/accounts"],
    ["/factory/voucher-detail", "factory/vouchers"],
    ["/factory/create", "factory/accounts"],
    ["/factory/financial-snapshot", "factory/analytics"],
  ];

  // Compute the right landing page for this user.
  // For restricted users (fullAccess:false) we walk the sidebar nav in order and
  // return the first page that's in their pageKeys, so they never land on a page
  // they can't access. Also accepts old pre-merge pageKeys (e.g. "factory/workers")
  // for hub pages (e.g. "factory/payroll-hub") via SUBPAGE_PARENT.
  // Falls back to production-report for admins / while loading.
  const factoryDefaultPage = (() => {
    if (!myAccess || myAccess.fullAccess) return "/factory/production-report";
    for (const section of FACTORY_NAV_SECTIONS) {
      for (const item of section.items) {
        const key = item.url.replace(/^\//, "");
        if (myAccess.pageKeys.includes(key)) return item.url;
        // Accept old pre-hub-merge keys that now redirect to this hub
        const legacyKeys = SUBPAGE_PARENT.filter(([, parentKey]) => parentKey === key).map(([prefix]) =>
          prefix.replace(/^\//, "")
        );
        if (legacyKeys.some((lk) => myAccess.pageKeys.includes(lk))) return item.url;
      }
    }
    if (myAccess.pageKeys.includes("factory/daybook")) return "/factory/daybook";
    return "/factory/production-report";
  })();

  if (
    isFactoryCompany &&
    !isFactoryRoute &&
    currentLocation !== "/my-settings" &&
    currentLocation !== "/intercompany-requests"
  ) {
    // Wait for myAccess before redirecting so restricted users land on their real first page.
    // If the query is still in-flight show a spinner; if it hard-failed after retries fall
    // through so the user gets the factory shell rather than a permanent blank screen.
    if (myAccessLoading) {
      return (
        <div className="flex items-center justify-center h-full">
          <p className="text-muted-foreground text-sm">Loading...</p>
        </div>
      );
    }
    if (myAccess === undefined && !myAccessError) return null;
    return <Redirect to={factoryDefaultPage} />;
  }

  if (isFactoryRoute && !hasFactoryAccess) {
    return <Redirect to="/" />;
  }

  if (
    !isFactoryCompany &&
    !hasErpAccess &&
    hasFactoryAccess &&
    !isFactoryRoute &&
    currentLocation !== "/my-settings" &&
    currentLocation !== "/intercompany-requests"
  ) {
    return <Redirect to={factoryDefaultPage} />;
  }

  // ── Route-level access guard ───────────────────────────────────────────────
  // Hides page in sidebar AND blocks direct URL access when a page is turned
  // off for a user in the User Management drawer.
  if (isFactoryRoute && !isAdminOwner && myAccess !== undefined) {
    // fullAccess:false means the admin has restricted this user to specific pages.
    // fullAccess:true means no restrictions are set (or user is admin — already
    // short-circuited above).
    const isRestrictedUser = !myAccess.fullAccess;

    // Sub-page → parent pageKey for detail/action routes that are not direct
    // nav items but should inherit their parent's access requirement.
    // Resolve the pageKey for the current path.
    // Uses FACTORY_NAV_PAGES as the canonical list so that pages only in the
    // manual section (Dashboard, Daybook, Chat) are covered too.
    const resolvePageKey = (path: string): string | null => {
      // 1. Direct match against every known page (exact or sub-path)
      for (const page of FACTORY_NAV_PAGES) {
        const url = "/" + page.key;
        if (path === url || path.startsWith(url + "/")) {
          return page.key;
        }
      }
      // 2. Sub-page map for detail routes that aren't direct nav entries
      for (const [prefix, parentKey] of SUBPAGE_PARENT) {
        if (path === prefix || path.startsWith(prefix + "/") || path.startsWith(prefix)) {
          return parentKey;
        }
      }
      return null;
    };

    const requiredKey = resolvePageKey(currentLocation);

    // 1. Per-user page restriction — redirect if this page isn't in their allow-list.
    // Also accepts legacy pre-hub-merge keys (e.g. "factory/workers" grants access
    // to "factory/payroll-hub") so restricted users aren't locked out of merged hubs.
    if (isRestrictedUser && requiredKey) {
      const hasDirectAccess = myAccess.pageKeys.includes(requiredKey);
      const hasLegacyAccess = SUBPAGE_PARENT.filter(([, parentKey]) => parentKey === requiredKey).some(([prefix]) =>
        myAccess.pageKeys.includes(prefix.replace(/^\//, ""))
      );
      if (!hasDirectAccess && !hasLegacyAccess) {
        return <Redirect to={factoryDefaultPage} />;
      }
    }

    // 2. Feature-flag restriction — redirect if the module is turned off in settings
    if (factorySettings && requiredKey) {
      for (const section of FACTORY_NAV_SECTIONS) {
        for (const item of section.items) {
          const itemKey = item.url.replace(/^\//, "");
          if (itemKey === requiredKey && (item as any).featureFlag) {
            const flag = (item as any).featureFlag as string;
            const defaultOn = !!(item as any).featureFlagDefaultOn;
            const enabled = defaultOn ? factorySettings[flag] !== false : factorySettings[flag] === true;
            if (!enabled) return <Redirect to={factoryDefaultPage} />;
          }
        }
      }
    }

    // 3. hiddenCostFields — per-user tab restrictions that aren't in pageKeys
    if (
      currentLocation === "/factory/production-report" &&
      myAccess.hiddenCostFields?.includes("hide_tab_production_analytics")
    ) {
      return <Redirect to={factoryDefaultPage} />;
    }
  }
  // ── End route-level access guard ───────────────────────────────────────────

  // Auto-redirect: user is on a factory URL but has switched to an ERP company.
  // Wait for access data to load before deciding so we don't bounce mid-flight.
  if (isFactoryRoute && !isFactoryCompany && !myAccessLoading && hasErpAccess) {
    return <Redirect to="/" />;
  }

  if (isFactoryRoute || isFactoryCompany) {
    return (
      <AppModeProvider mode="factory">
        <SidebarProvider style={style as React.CSSProperties}>
          <div ref={factoryContainerRef} className="flex h-full w-full">
            {selectedCompany?.id && <DailyRateModal companyId={selectedCompany.id} />}
            <FactorySidebar user={user} />
            <div className="flex flex-col flex-1 overflow-hidden">
              <AppTopBar
                accentColor="#f97316"
                user={user}
                onLogout={handleLogout}
                onSearchOpen={() => setPaletteOpen(true)}
                showSearch={user?.role === "Admin" || user?.role === "Owner" || user?.role === "Developer"}
                leftContent={
                  <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-orange-600/10 border border-orange-600/20">
                    <Factory className="h-4 w-4 text-orange-600" />
                    <span className="text-xs font-semibold text-orange-600 uppercase tracking-wider">Factory Mode</span>
                    {myAccess?.companyName && (
                      <span className="hidden sm:inline text-xs text-orange-600/70 font-normal normal-case tracking-normal border-l border-orange-600/20 pl-2">
                        {myAccess.companyName}
                      </span>
                    )}
                  </div>
                }
                extraActions={<KeyboardShortcutsButton />}
              />
              <OfflineBanner />
              <main className="flex-1 overflow-y-auto p-3 sm:p-6">
                <div className="w-full">
                  <ErrorBoundary resetKey={currentLocation}>
                    <Suspense
                      fallback={
                        <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
                          Loading...
                        </div>
                      }
                    >
                      <Switch>
                        <Route path="/factory/daybook" component={FactoryDaybook} />
                        <Route path="/factory/transporters" component={FactoryTransporters} />
                        <Route path="/factory/finance">
                          <Redirect to="/factory/workers" />
                        </Route>
                        <Route path="/factory/suppliers">
                          <Redirect to="/factory/parties?section=suppliers" />
                        </Route>
                        <Route path="/factory/containers/new" component={FactoryContainerCreate} />
                        <Route path="/factory/containers">
                          <Redirect to="/factory/containers-hub?section=containers" />
                        </Route>
                        <Route path="/factory/bale-products" component={BaleProducts} />
                        <Route
                          path="/factory/raw-stock/opening-balance/:id/edit"
                          component={FactoryOpeningBalanceEdit}
                        />
                        <Route path="/factory/raw-stock" component={ProductionRawStock} />
                        <Route path="/factory/raw-materials" component={FactoryRawMaterialsHub} />
                        <Route path="/factory/pressing">
                          <Redirect to="/factory/stock-entry" />
                        </Route>
                        <Route path="/factory/finalize">
                          <Redirect to="/factory/stock-entry" />
                        </Route>
                        <Route path="/factory/stock-entry" component={BaleStockEntry} />
                        <Route path="/factory/bales-history" component={BalesHistory} />
                        <Route path="/factory/bales-hub" component={FactoryBalesHub} />
                        <Route path="/factory/reprint-labels" component={FactoryReprintLabels} />
                        <Route path="/factory/location-inventory" component={FactoryLocationInventory} />
                        <Route path="/factory/location-inventory-mockup" component={FactoryLocationInventoryMockup} />
                        <Route
                          path="/factory/bale-product-history/:productId/:locationId/:year/all"
                          component={FactoryBaleProductAllMonths}
                        />
                        <Route
                          path="/factory/bale-product-history/:productId/:locationId/:year/:month"
                          component={FactoryBaleProductMonthDetail}
                        />
                        <Route
                          path="/factory/bale-product-history/:productId/:locationId"
                          component={FactoryBaleProductHistory}
                        />
                        <Route path="/factory/containers-hub" component={FactoryContainersHub} />
                        <Route path="/factory/stock-otw">
                          <Redirect to="/factory/containers-hub" />
                        </Route>
                        <Route path="/factory/stock-bale-list" component={FactoryStockBaleList} />
                        <Route path="/factory/stock-query/:id" component={FactoryStockItemDetail} />
                        <Route path="/factory/stock-query" component={StockQuery} />
                        <Route path="/factory/accounts" component={FactoryAccounts} />
                        <Route path="/factory/agents" component={Agents} />
                        <Route path="/factory/vouchers">{() => <FactoryVouchers />}</Route>
                        <Route path="/factory/vouchers/:id/edit" component={VoucherEdit} />
                        <Route path="/factory/voucher-detail/:voucherId" component={VoucherDetail} />
                        <Route path="/factory/create" component={AccountingCreate} />
                        <Route path="/factory/payroll" component={Payroll} />
                        <Route path="/factory/analytics" component={Analytics} />
                        <Route path="/factory/production-summary">
                          <Redirect to="/factory/intelligence/production-hub?section=production-summary" />
                        </Route>
                        <Route path="/factory/sales/new" component={FactoryInvoiceCreate} />
                        <Route path="/factory/sales/loading/pending" component={FactoryPendingLoadings} />
                        <Route path="/factory/sales/loading/new" component={FactoryContainerLoadingScan} />
                        <Route path="/factory/sales/loadings" component={FactoryLoadingsHub} />
                        <Route
                          path="/factory/sales/pending-invoices/:id/verify"
                          component={FactoryPendingInvoiceVerify}
                        />
                        <Route path="/factory/invoices/:id/loading-scan" component={FactoryInvoiceLoadingScan} />
                        <Route path="/factory/sales/invoices/:id" component={FactoryInvoiceDetail} />
                        <Route path="/factory/price-list" component={FactoryPriceList} />
                        <Route path="/factory/sales/proformas/:proformaId/add-line" component={ProformaAddLine} />
                        <Route path="/factory/bale-tracking" component={FactoryBaleTracking} />
                        <Route
                          path="/factory/dispatch-batches/:batchId/rides/:rideId/scan"
                          component={FactoryDispatchBatchScan}
                        />
                        <Route path="/factory/dispatch-batches/:id" component={FactoryDispatchBatchDetail} />
                        <Route path="/factory/dispatch-batches" component={FactoryDispatchBatches} />
                        <Route path="/factory/invoicing" component={FactoryInvoicing} />
                        <Route path="/factory/stock-allocation" component={FactoryStockAllocation} />
                        <Route path="/factory/stock-allocation-v3" component={FactoryStockAllocationV3} />
                        <Route path="/factory/stock-allocation-v5" component={FactoryStockAllocationV5} />
                        <Route path="/factory/parties" component={FactoryPartiesHub} />
                        <Route path="/factory/customers/:id" component={FactoryCustomerStatement} />
                        <Route path="/factory/customers">
                          <Redirect to="/factory/parties?section=customers" />
                        </Route>
                        <Route path="/factory/payroll-hub" component={FactoryPayrollHub} />
                        <Route path="/factory/employees/:id" component={FactoryEmployeeDetail} />
                        <Route path="/factory/employees">
                          <Redirect to="/factory/payroll-hub?section=employees" />
                        </Route>
                        <Route path="/factory/workers/:id" component={FactoryWorkerDetail} />
                        <Route path="/factory/workers">
                          <Redirect to="/factory/payroll-hub?section=workers" />
                        </Route>
                        <Route path="/factory/worker-payroll">
                          <Redirect to="/factory/workers?tab=payroll" />
                        </Route>
                        <Route path="/factory/supplier-report">
                          <Redirect to="/factory/intelligence/supplier-hub?section=report" />
                        </Route>
                        <Route path="/factory/supplier-statement">
                          <Redirect to="/factory/intelligence/supplier-hub?section=statement" />
                        </Route>
                        <Route path="/factory/broker-visual-statement" component={FactoryBrokerVisualStatement} />
                        <Route path="/factory/barcode-lookup" component={BarcodeLookup} />
                        <Route path="/factory/import" component={FactoryImport} />
                        <Route path="/factory/bale-relabeling" component={FactoryBaleRelabeling} />
                        <Route path="/factory/merge-bale-products" component={MergeBaleProducts} />
                        <Route path="/factory/bale-product-images" component={BaleProductImages} />
                        <Route path="/factory/customer-logos" component={CustomerLogosSettings} />
                        <Route path="/factory/label-banners" component={LabelBannersSettings} />
                        <Route path="/factory/bale-relabeling/wipers-re-entry" component={WipersReEntry} />
                        <Route path="/factory/users">
                          <Redirect to="/factory/settings" />
                        </Route>
                        <Route path="/factory/ledger-monthly/:accountId" component={LedgerMonthlySummary} />
                        <Route path="/factory/ledger-vouchers/:accountId/:year/:month" component={LedgerVouchers} />
                        <Route path="/factory/intelligence/dashboard" component={FactoryDashboardIntel} />
                        <Route path="/factory/intelligence/kpis" component={FactoryKpis} />
                        <Route path="/factory/intelligence/profitability">
                          <Redirect to="/factory/intelligence/financial-hub?section=profitability" />
                        </Route>
                        <Route path="/factory/intelligence/alerts" component={FactoryAlerts} />
                        <Route path="/factory/intelligence/supplier-hub" component={FactorySupplierHub} />
                        <Route path="/factory/intelligence/financial-hub" component={FactoryFinancialHub} />
                        <Route path="/factory/intelligence/production-hub" component={FactoryProductionIntelHub} />
                        <Route path="/factory/intelligence/supplier-scores">
                          <Redirect to="/factory/intelligence/supplier-hub?section=scores" />
                        </Route>
                        <Route path="/factory/intelligence/mix-optimizer">
                          <Redirect to="/factory/intelligence/production-hub?section=mix-optimizer" />
                        </Route>
                        <Route path="/factory/intelligence/cashflow">
                          <Redirect to="/factory/intelligence/financial-hub?section=cashflow" />
                        </Route>
                        <Route path="/factory/intelligence/waste">
                          <Redirect to="/factory/intelligence/production-hub?section=waste" />
                        </Route>
                        <Route path="/factory/waste-dispatch" component={WasteDispatchPage} />
                        <Route path="/factory/pos" component={FactoryPOS} />
                        <Route path="/factory/bale-ledger">{() => <Redirect to="/factory/production-report" />}</Route>
                        <Route path="/factory/intelligence/settings" component={FactoryIntelSettings} />
                        {(user?.role === "Admin" || user?.role === "Developer" || myAccess?.fullAccess) && (
                          <Route path="/factory/spreadsheet" component={SpreadsheetEditor} />
                        )}
                        <Route path="/factory/chat" component={Chat} />
                        <Route path="/factory/conflicts" component={ConflictCenter} />
                        {(user?.role === "Admin" || user?.role === "Developer") && (
                          <Route path="/factory/settings" component={Settings} />
                        )}
                        <Route path="/my-settings" component={MySettings} />
                        <Route path="/intercompany-requests" component={IntercompanyRequests} />
                        <Route path="/intercompany-links" component={IntercompanyLinks} />
                        {(user?.role === "Admin" || user?.role === "Developer") && (
                          <Route path="/factory/deleted-items" component={DeletedItems} />
                        )}
                        {(user?.role === "Admin" || user?.role === "Developer") && (
                          <Route path="/factory/orphaned-records" component={OrphanedRecords} />
                        )}
                        {(user?.role === "Admin" || user?.role === "Developer") && (
                          <Route path="/factory/chatbot-settings" component={ChatbotSettings} />
                        )}
                        {(user?.role === "Admin" || user?.role === "Developer") && (
                          <Route path="/factory/import-cycle-diagnostics" component={ImportCycleDiagnostics} />
                        )}
                        {(user?.role === "Admin" || user?.role === "Developer") && (
                          <Route path="/factory/inventory-repair" component={InventoryRepair} />
                        )}
                        {(user?.role === "Admin" || user?.role === "Developer") && (
                          <Route path="/factory/company-data-reset" component={CompanyDataReset} />
                        )}
                        <Route path="/factory/net-position-details" component={FactoryNetPositionDetails} />
                        <Route path="/factory/net-profit-analytics">
                          <Redirect to="/factory/intelligence/financial-hub?section=net-profit" />
                        </Route>
                        <Route path="/factory/net-position">
                          <Redirect to="/factory/intelligence/financial-hub?section=net-position" />
                        </Route>
                        <Route path="/factory/financial-snapshot" component={FactoryFinancialSnapshot} />
                        <Route path="/factory/production-report">
                          {() =>
                            myAccess?.hiddenCostFields?.includes("hide_tab_production_analytics") ? (
                              <Redirect to={factoryDefaultPage} />
                            ) : (
                              <DailyProductionReport />
                            )
                          }
                        </Route>
                        <Route path="/factory/rental/warehouses" component={FactoryRentalWarehouses} />
                        <Route path="/factory/rental/shops" component={FactoryRentalShops} />
                        <Route path="/factory/rental/payments" component={FactoryRentalPayments} />
                        {(user?.role === "Admin" || user?.role === "Developer") && (
                          <Route path="/balance-repair" component={BalanceRepair} />
                        )}
                        <Route>
                          <Redirect to={factoryDefaultPage} />
                        </Route>
                      </Switch>
                    </Suspense>
                  </ErrorBoundary>
                </div>
              </main>
            </div>
          </div>
        </SidebarProvider>
        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          hasErpAccess={false}
          hasFactoryAccess={hasFactoryAccess}
          isAdminOwner={user?.role === "Admin" || user?.role === "Developer"}
          user={user}
        />
        {leaveConfirmDialog}
      </AppModeProvider>
    );
  }

  // Full ERP interface for Admin, Owner, Manager
  return (
    <AppModeProvider mode="erp">
      <SidebarProvider style={style as React.CSSProperties}>
        <div className="flex h-full w-full">
          {selectedCompany?.id && <DailyRateModal companyId={selectedCompany.id} />}
          <AppSidebar user={user} />
          <div className="flex flex-col flex-1 overflow-hidden">
            <AppTopBar
              accentColor="#3b82f6"
              user={user}
              onLogout={handleLogout}
              onSearchOpen={() => setPaletteOpen(true)}
              showSearch={user?.role === "Admin" || user?.role === "Owner" || user?.role === "Developer"}
              extraActions={<KeyboardShortcutsButton />}
            />
            <OfflineBanner />
            <main className="flex-1 overflow-y-auto p-3 sm:p-6">
              <div className="w-full">
                <ErrorBoundary resetKey={currentLocation}>
                  <Suspense
                    fallback={
                      <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
                        Loading...
                      </div>
                    }
                  >
                    <Router user={user} />
                  </Suspense>
                </ErrorBoundary>
              </div>
            </main>
          </div>
        </div>
      </SidebarProvider>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        hasErpAccess={hasErpAccess}
        hasFactoryAccess={false}
        isAdminOwner={user?.role === "Admin" || user?.role === "Developer"}
        user={user}
      />
      {leaveConfirmDialog}
    </AppModeProvider>
  );
}

// ── Production-only update banner ─────────────────────────────────────────────
// Polls /api/version every 5 minutes. When the build version changes it shows a
// small non-blocking toast with a manual "Refresh" button. It NEVER auto-refreshes.
// In development, Vite HMR handles reconnection — this component does nothing.
function UpdateBanner() {
  const { toast } = useToast();
  const notifiedRef = useRef(false);
  const initialVersionRef = useRef<string | null>(null);

  useEffect(() => {
    // Only run in production — dev restarts are handled by Vite HMR
    if (import.meta.env.DEV) return;

    async function checkVersion() {
      try {
        const res = await fetch("/api/version", { credentials: "same-origin" });
        if (!res.ok) return;
        const data = await res.json();
        const ver: string = data.version ?? "";
        if (!ver || ver === "dev") return;

        if (initialVersionRef.current === null) {
          // Store the version that was live when the app first loaded
          initialVersionRef.current = ver;
          return;
        }

        if (ver !== initialVersionRef.current && !notifiedRef.current) {
          notifiedRef.current = true;
          toast({
            title: "Update available",
            description: "A new version of the app is ready.",
            duration: 0, // stay until dismissed
            action: (
              <Button
                size="sm"
                variant="outline"
                data-testid="button-update-refresh"
                onClick={() => {
                  // Clear chunk-reload guards so the reload is clean
                  try {
                    Object.keys(sessionStorage)
                      .filter((k) => k.startsWith("chunkReload:") || k.startsWith("chunkRetry:"))
                      .forEach((k) => sessionStorage.removeItem(k));
                  } catch {
                    /* ignore */
                  }
                  window.location.reload();
                }}
              >
                Refresh
              </Button>
            ) as any,
          });
        }
      } catch {
        /* network error — ignore, will retry next interval */
      }
    }

    checkVersion(); // initial check
    const id = setInterval(checkVersion, 5 * 60 * 1000); // every 5 minutes
    return () => clearInterval(id);
  }, [toast]);

  return null;
}

function AuthGatedUserNotesPanel() {
  const [location] = useLocation();
  if (location === "/login") return null;
  return <UserNotesPanel />;
}

function ServerRestartWatcher() {
  useServerRestart();
  return null;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ThemeProvider>
          <ConnectivityProvider>
            <CompanyProvider>
              <LocationProvider>
                <DateFormatProvider>
                  <CurrencyProvider>
                    <CursorNavProvider>
                      <ServerRestartWatcher />
                      <Switch>
                        <Route path="/login" component={Login} />
                        <Route>
                          <AuthenticatedApp />
                        </Route>
                      </Switch>
                      <Toaster />
                      <UpdateBanner />
                      <ChatWidget />
                      <DateJumpDialog />
                      <AuthGatedUserNotesPanel />
                      <KeyboardShortcuts />
                    </CursorNavProvider>
                  </CurrencyProvider>
                </DateFormatProvider>
              </LocationProvider>
            </CompanyProvider>
          </ConnectivityProvider>
        </ThemeProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
