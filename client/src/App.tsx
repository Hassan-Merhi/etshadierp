import { useEffect, useCallback, useState, useRef, lazy, Suspense } from "react";
import { useButtonClickFeedback } from "@/hooks/use-button-click-feedback";
import { Switch, Route, useLocation, Redirect } from "wouter";
import { hasActiveEscapeHandler } from "@/hooks/use-escape-back";
import { getParentRoute } from "@/lib/parent-routes";
import { queryClient, getQueryFn, setAppTimezone } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ChatWidget } from "@/components/ChatWidget";
import { SidebarProvider, SidebarTrigger, Sidebar, SidebarContent, SidebarHeader, SidebarFooter, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarGroup, SidebarGroupContent } from "@/components/ui/sidebar";
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
import { LogOut, ShoppingCart, MapPin, BookOpen, Package, Users, Upload, Factory, MessageSquare, Cog, Search, Tag, Building2, ClipboardList, KeyRound } from "lucide-react";
import { FactorySidebar } from "@/components/FactorySidebar";
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
const ContainerDashboard = lazy(() => import("@/pages/ContainerDashboard"));
const POS = lazy(() => import("@/pages/pos/POS"));
const StockItems = lazy(() => import("@/pages/StockItems"));
const Containers = lazy(() => import("@/pages/Containers"));
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
const POSImport = lazy(() => import("@/pages/pos/POSImport"));
const ContainerDetail = lazy(() => import("@/pages/ContainerDetail"));
const LocationInventory = lazy(() => import("@/pages/LocationInventory"));
const FactoryLocationInventory = lazy(() => import("@/pages/factory/FactoryLocationInventory"));
const Settings = lazy(() => import("@/pages/Settings"));
const VoucherEdit = lazy(() => import("@/pages/VoucherEdit"));
const Payroll = lazy(() => import("@/pages/Payroll"));
const ImportStockItems = lazy(() => import("@/pages/ImportStockItems"));
const StockQuery = lazy(() => import("@/pages/StockQuery"));
const OffloadItemSearch = lazy(() => import("@/pages/OffloadItemSearch"));
const StockItemDetail = lazy(() => import("@/pages/StockItemDetail"));
const FactoryStockItemDetail = lazy(() => import("@/pages/factory/FactoryStockItemDetail"));
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
const ContainerVerification = lazy(() => import("@/pages/ContainerVerification"));
const StockOTW = lazy(() => import("@/pages/StockOTW"));
const FactoryStockOTW = lazy(() => import("@/pages/factory/FactoryStockOTW"));
const Customers = lazy(() => import("@/pages/Customers"));
const SoldContainers = lazy(() => import("@/pages/SoldContainers"));
const Bales = lazy(() => import("@/pages/Bales"));
const ProductionBales = lazy(() => import("@/pages/ProductionBales"));
const BaleProducts = lazy(() => import("@/pages/BaleProducts"));
const OrphanedRecords = lazy(() => import("@/pages/OrphanedRecords"));
const DeletedItems = lazy(() => import("@/pages/DeletedItems"));
const ChatbotSettings = lazy(() => import("@/pages/ChatbotSettings"));
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
const FactoryBaleProductMonthDetail = lazy(() => import("@/pages/factory/FactoryBaleProductHistory").then(m => ({ default: m.FactoryBaleProductMonthDetail })));
const FactoryBaleProductAllMonths = lazy(() => import("@/pages/factory/FactoryBaleProductHistory").then(m => ({ default: m.FactoryBaleProductAllMonths })));
const BarcodeLookup = lazy(() => import("@/pages/BarcodeLookup"));
const FactoryBalesHub = lazy(() => import("@/pages/factory/FactoryBalesHub"));
const FactoryReprintLabels = lazy(() => import("@/pages/factory/FactoryReprintLabels"));
const FactoryRawMaterialsHub = lazy(() => import("@/pages/factory/FactoryRawMaterialsHub"));
const FactoryLoadingsHub = lazy(() => import("@/pages/factory/FactoryLoadingsHub"));
const ProductionSummary = lazy(() => import("@/pages/factory/ProductionSummary"));
const FactorySuppliers = lazy(() => import("@/pages/factory/FactorySuppliers"));
const FactoryContainers = lazy(() => import("@/pages/factory/FactoryContainers"));
const FactoryContainerCreate = lazy(() => import("@/pages/factory/FactoryContainerCreate"));
const BarcodeManager = lazy(() => import("@/pages/BarcodeManager"));
const TestDataImport = lazy(() => import("@/pages/TestDataImport"));
const ImportCycleDiagnostics = lazy(() => import("@/pages/ImportCycleDiagnostics"));
const InventoryRepair = lazy(() => import("@/pages/InventoryRepair"));
const NetProfitDetails = lazy(() => import("@/pages/NetProfitDetails"));
const NetProfitReport = lazy(() => import("@/pages/NetProfitReport"));
const FactoryNetProfitAnalytics = lazy(() => import("@/pages/factory/FactoryNetProfitAnalytics"));
const FactoryNetPosition = lazy(() => import("@/pages/factory/FactoryNetPosition"));
const FactoryNetPositionDetails = lazy(() => import("@/pages/factory/FactoryNetPositionDetails"));
const FactoryFinancialSnapshot = lazy(() => import("@/pages/factory/FactoryFinancialSnapshot"));
const DailyProductionReport = lazy(() => import("@/pages/factory/DailyProductionReport"));
const CompanyDataReset = lazy(() => import("@/pages/CompanyDataReset"));
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
const WipersReEntry = lazy(() => import("@/pages/factory/WipersReEntry"));
const FactoryUsers = lazy(() => import("@/pages/factory/FactoryUsers"));
const FactoryWorkersHub = lazy(() => import("@/pages/factory/FactoryWorkersHub"));
const FactoryWorkerDetail = lazy(() => import("@/pages/factory/FactoryWorkerDetail"));
const FactoryEmployeesHub = lazy(() => import("@/pages/factory/FactoryEmployeesHub"));
const FactoryEmployeeDetail = lazy(() => import("@/pages/factory/FactoryEmployeeDetail"));
const FactoryPayrollHub = lazy(() => import("@/pages/factory/FactoryPayrollHub"));
const FactoryFinanceHub = lazy(() => import("@/pages/factory/FactoryFinanceHub"));
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
const WasteDispatchPage = lazy(() => import("@/pages/factory/WasteDispatch"));
const FactoryPOS = lazy(() => import("@/pages/factory/FactoryPOS"));
const FactoryIntelSettings = lazy(() => import("@/pages/factory/FactorySettings"));
const ConflictCenter = lazy(() => import("@/pages/ConflictCenter"));
const Chat = lazy(() => import("@/pages/Chat"));
const SpreadsheetEditor = lazy(() => import("@/pages/SpreadsheetEditor"));
const FactorySheets = lazy(() => import("@/pages/factory/FactorySheets"));
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
import { CommandPalette } from "@/components/CommandPalette";
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
  const isPOS = user?.role?.startsWith("POS");
  const [_location, navigate] = useLocation();
  
  // POS users only see POS and Location Inventory
  if (isPOS) {
    // Redirect legacy /pos URL to /
    useEffect(() => {
      if (window.location.pathname === "/pos") {
        navigate("/");
      }
    }, [navigate]);
    
    return (
      <Switch>
        <Route path="/">{() => <POS posUser={user} />}</Route>
        <Route path="/pos/edit/:id">{(params) => <POS posUser={user} editVoucherId={params.id} />}</Route>
        <Route path="/location-inventory">{() => <LocationInventory posUser={user} />}</Route>
        <Route path="/locations/:locationId/stock-items/:stockItemId/history">{() => <LocationMonthlySummary posUser={user} />}</Route>
        <Route path="/locations/:locationId/stock-items/:stockItemId/vouchers/:year/:month">{() => <LocationVouchers posUser={user} />}</Route>
        <Route path="/pos-daybook" component={POSDaybook} />
        <Route path="/pos-dashboard">{() => <POSDashboard posUser={user} />}</Route>
        <Route path="/pos-customers">{() => <POSCustomers />}</Route>
        <Route path="/pos-import">{() => posImportEnabled ? <POSImport /> : <Redirect to="/" />}</Route>
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

  // All other users see full interface
  return (
    <Switch>
      <Route path="/" component={ContainerDashboard} />
      <Route path="/financial-overview" component={Dashboard} />
      <Route path="/pos">{() => <POS />}</Route>
      <Route path="/pos/edit/:id">{(params) => <POS editVoucherId={params.id} />}</Route>
      <Route path="/inventory" component={InventoryHub} />
      <Route path="/stock" component={StockHub} />
      <Route path="/location-inventory"><Redirect to="/inventory?tab=by-location" /></Route>
      <Route path="/stock-items"><Redirect to="/stock?tab=items" /></Route>
      <Route path="/stock-otw"><Redirect to="/inventory?tab=on-the-way" /></Route>
      <Route path="/containers"><Redirect to="/inventory?tab=containers" /></Route>
      <Route path="/containers/:id" component={ContainerDetail} />
      <Route path="/offloads/:id" component={OffloadDetail} />
      <Route path="/po-import" component={POImport} />
      <Route path="/pos-import" component={POSImport} />
      <Route path="/analytics" component={Analytics} />
      <Route path="/accounts" component={Accounts} />
      <Route path="/agents" component={Agents} />
      <Route path="/parties" component={PartiesHub} />
      <Route path="/suppliers"><Redirect to="/parties?tab=suppliers" /></Route>
      <Route path="/customers"><Redirect to="/parties?tab=customers" /></Route>
      <Route path="/vouchers">{() => <Vouchers />}</Route>
      <Route path="/vouchers/:id/edit" component={VoucherEdit} />
      <Route path="/purchase-orders/:id/edit" component={PurchaseOrderEdit} />
      <Route path="/daybook">{() => <Daybook user={user} />}</Route>
      <Route path="/transaction-journal" component={TransactionJournal} />
      <Route path="/payroll" component={Payroll} />
      <Route path="/create" component={AccountingCreate} />
      <Route path="/import-stock-items" component={ImportStockItems} />
      <Route path="/stock-query/:id" component={StockItemDetail} />
      <Route path="/stock-query"><Redirect to="/stock?tab=query" /></Route>
      <Route path="/offload-item-search"><Redirect to="/stock?tab=offload" /></Route>
      <Route path="/location-summary"><Redirect to="/stock-query?tab=summary" /></Route>
      <Route path="/stock-transfer-order" component={StockTransferOrder} />
      <Route path="/sales-tools" component={SalesToolsHub} />
      <Route path="/stock-transfers"><Redirect to="/sales-tools?tab=transfers" /></Route>
      <Route path="/optional-vouchers" component={OptionalVouchers} />
      <Route path="/stock-items/:id/history" component={StockItemHistory} />
      <Route path="/stock-items/:id/history/:year/:month" component={StockItemVouchers} />
      <Route path="/stock-items/:stockItemId/monthly-summary">{() => <LocationMonthlySummary />}</Route>
      <Route path="/locations/:locationId/stock-items/:stockItemId/history">{() => <LocationMonthlySummary />}</Route>
      <Route path="/locations/:locationId/stock-items/:stockItemId/vouchers/:year/:month">{() => <LocationVouchers />}</Route>
      <Route path="/sales-report" component={SalesReport} />
      <Route path="/sales-report/detail" component={SalesReportDetail} />
      <Route path="/sales-report/comparison" component={SalesReportComparison} />
      {user?.role === "Developer" && <Route path="/company-transfer" component={CompanyTransfer} />}
      {user?.role === "Developer" && <Route path="/net-profit-report" component={NetProfitReport} />}
      <Route path="/combined-inventory"><Redirect to="/stock-otw?tab=combined" /></Route>
      <Route path="/bale-ledger" component={BaleLedger} />
      <Route path="/pos-daybook"><Redirect to="/sales-tools?tab=daybook" /></Route>
      <Route path="/pos-price-list"><Redirect to="/sales-tools?tab=pricelist" /></Route>
      <Route path="/price-list"><Redirect to="/sales-tools?tab=pricelist" /></Route>
      <Route path="/suppliers/:supplierId/proformas" component={SupplierProformas} />
      <Route path="/containers/:containerId/verification" component={ContainerVerification} />
      <Route path="/suppliers/:id/edit" component={EditSupplier} />
      <Route path="/opening-stock" component={OpeningStockSummary} />
      <Route path="/opening-stock/:groupId" component={OpeningStockDetail} />
      <Route path="/closing-stock-summary" component={ClosingStockSummary} />
      <Route path="/closing-stock/:groupId" component={ClosingStockDetail} />
      <Route path="/ledger-monthly/:accountId" component={LedgerMonthlySummary} />
      <Route path="/ledger-vouchers/:accountId/:year/:month" component={LedgerVouchers} />
      <Route path="/voucher-detail/:voucherId" component={VoucherDetail} />
      <Route path="/factory-production"><Redirect to="/factory/raw-stock" /></Route>
      <Route path="/barcode-manager" component={BarcodeManager} />
      {user?.role === "Developer" && <Route path="/spreadsheet" component={SpreadsheetEditor} />}
      {user?.role === "Developer" && <Route path="/live-sheets" component={LiveSheets} />}
      <Route path="/chat" component={Chat} />
      <Route path="/bales"><Redirect to="/factory/raw-stock" /></Route>
      <Route path="/production-bales"><Redirect to="/factory/stock-entry" /></Route>
      <Route path="/bale-products"><Redirect to="/factory/bale-products" /></Route>
      <Route path="/sold-containers"><Redirect to="/containers" /></Route>
      <Route path="/erp/rental/warehouses" component={ErpRentalWarehouses} />
      <Route path="/erp/rental/shops" component={ErpRentalShops} />
      <Route path="/erp/rental/payments" component={ErpRentalPayments} />
      <Route path="/conflicts" component={ConflictCenter} />
      {(user?.role === "Admin" || user?.role === "Developer") && <Route path="/settings" component={Settings} />}
      {(user?.role === "Admin" || user?.role === "Developer") && <Route path="/orphaned-records" component={OrphanedRecords} />}
      {(user?.role === "Admin" || user?.role === "Developer") && <Route path="/deleted-items" component={DeletedItems} />}
      {(user?.role === "Admin" || user?.role === "Developer") && <Route path="/chatbot-settings" component={ChatbotSettings} />}
      {(user?.role === "Admin" || user?.role === "Developer") && <Route path="/account-groups" component={AccountGroups} />}
      {(user?.role === "Admin" || user?.role === "Developer") && <Route path="/test-data-import" component={TestDataImport} />}
      {(user?.role === "Admin" || user?.role === "Developer") && <Route path="/import-cycle-diagnostics" component={ImportCycleDiagnostics} />}
      {(user?.role === "Admin" || user?.role === "Developer") && <Route path="/inventory-repair" component={InventoryRepair} />}
      {(user?.role === "Admin" || user?.role === "Developer") && <Route path="/net-position-details" component={NetProfitDetails} />}
      {(user?.role === "Admin" || user?.role === "Developer") && <Route path="/company-data-reset" component={CompanyDataReset} />}
      <Route path="/my-settings" component={MySettings} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AuthenticatedApp() {
  const { selectedCompany } = useCompany();
  usePresence();    // Track user presence
  useScreenFeed();  // Silently capture screen frames for admin Watch feature
  useWsInvalidation(); // Real-time cache invalidation via WebSocket
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
  
  const { data: user, isLoading, error } = useQuery<any>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
    staleTime: 30 * 60 * 1000,
    refetchOnMount: "always",
  });

  const navigateToParent = useCallback(() => {
    const parent = getParentRoute(window.location.pathname);
    if (parent) setLocation(parent);
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
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable;

      // Arrow key / page scrolling
      const scrollKeys = ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"];
      if (scrollKeys.includes(e.key) && !isInput) {
        const main = document.querySelector("main");
        if (main) {
          e.preventDefault();
          const amount = e.key === "ArrowDown" ? 80
            : e.key === "ArrowUp" ? -80
            : e.key === "PageDown" ? window.innerHeight * 0.85
            : e.key === "PageUp" ? -window.innerHeight * 0.85
            : e.key === "End" ? 99999
            : -99999;
          main.scrollBy({ top: amount, behavior: "smooth" });
        }
        return;
      }

      if (e.key !== "Escape") return;

      // If a page registered its own Esc handler (useEscapeBack), defer to it
      // entirely — including its own input/overlay guards — so we don't
      // accidentally blur an input or navigate before the page hook runs.
      if (hasActiveEscapeHandler()) return;

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

  const isPOS = user?.role?.startsWith("POS") ?? false;
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

  const { data: myAccess } = useQuery<{ fullAccess: boolean; pageKeys: string[]; hasErpAccess: boolean; hasFactoryAccess: boolean; companyId?: number; companyName?: string }>({
    queryKey: ["/api/factory/my-access"],
    enabled: !!user && !isPOS,
    staleTime: 30000,
  });

  const hasErpAccess = !myAccess || myAccess.hasErpAccess;
  const hasFactoryAccess = !myAccess || myAccess.hasFactoryAccess;
  const isAdminOwner = user?.role === "Admin" || user?.role === "Owner" || user?.role === "Developer";
  const hasDashboardAccess = isAdminOwner || (myAccess && !myAccess.fullAccess && myAccess.pageKeys.includes("factory/dashboard"));

  const handleLogout = async () => {
    try {
      await apiRequest("POST", "/api/auth/logout", {});
      queryClient.clear();
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
      <div className="flex items-center justify-center h-screen">
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
    const isOnMySettings = currentLocation === "/my-settings";

    const posNavItems = [
      { label: "Point of Sale", icon: ShoppingCart, active: isOnPOS, testId: "button-pos-tab", onClick: () => setLocation("/") },
      { label: "Daybook", icon: BookOpen, active: isOnDaybook, testId: "button-daybook-tab", onClick: () => setLocation("/pos-daybook") },
      { label: "Inventory", icon: MapPin, active: isOnInventory, testId: "button-inventory-tab", onClick: () => setLocation("/location-inventory") },
      { label: "Price List", icon: Tag, active: isOnPriceList, testId: "button-price-list-tab", onClick: () => setLocation("/pos-price-list") },
      { label: "Transfer", icon: Package, active: isOnTransfer, testId: "button-stock-transfer-tab", onClick: () => setLocation("/vouchers?tab=transfer") },
      { label: "Orders", icon: ClipboardList, active: isOnTransferOrders, testId: "button-transfer-orders-tab", onClick: () => setLocation("/pos-transfer-orders") },
      ...(user.canAccessCustomers ? [{ label: "Customers", icon: Users, active: isOnCustomers, testId: "button-customers-tab", onClick: () => setLocation("/pos-customers") }] : []),
      ...(posImportEnabled ? [{ label: "Import", icon: Upload, active: isOnImport, testId: "button-pos-import-tab", onClick: () => setLocation("/pos-import") }] : []),
      { label: "Chat", icon: MessageSquare, active: isOnChat, testId: "button-chat-tab", onClick: () => setLocation("/pos-chat"), badge: chatUnread?.count || 0 },
      { label: "Settings", icon: Cog, active: isOnSettings, testId: "button-settings-tab", onClick: () => setLocation("/pos-settings") },
      { label: "My Settings", icon: KeyRound, active: isOnMySettings, testId: "button-my-settings-tab", onClick: () => setLocation("/my-settings") },
    ];

    const posStyle = { "--sidebar-width": "11rem", "--sidebar-width-icon": "3rem" };

    return (
      <>
        <SidebarProvider style={posStyle as React.CSSProperties}>
          <div className="flex h-screen w-full">
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
                          <SidebarMenuButton
                            isActive={item.active}
                            onClick={item.onClick}
                            data-testid={item.testId}
                          >
                            <item.icon className="h-4 w-4" />
                            <span className="flex-1">{item.label}</span>
                            {"badge" in item && (item as any).badge > 0 && (
                              <Badge variant="default" className="text-xs min-w-5 justify-center" data-testid="badge-chat-unread-pos">
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
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex items-center gap-1.5 text-muted-foreground"
                    onClick={() => setPaletteOpen(true)}
                    data-testid="button-open-palette"
                  >
                    <Search className="h-4 w-4" />
                    <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 text-[10px] font-mono">
                      Ctrl /
                    </kbd>
                  </Button>
                </div>
              </header>
              <OfflineBanner />
              <main className="flex-1 overflow-y-auto p-3 sm:p-6">
                <div className="w-full">
                  <ErrorBoundary resetKey={currentLocation}>
                    <Suspense fallback={<div className="flex items-center justify-center h-48 text-muted-foreground text-sm">Loading...</div>}>
                      <Router user={user} posImportEnabled={posImportEnabled} />
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
          isPOS={true}
          user={user}
        />
        {leaveConfirmDialog}
      </>
    );
  }

  const isPropertiesCompany = selectedCompany?.companyType === "properties";
  const isPropertiesRoute = currentLocation.startsWith("/properties/");

  if (isPropertiesCompany && !isPropertiesRoute && currentLocation !== "/my-settings") {
    return <Redirect to="/properties/daybook" />;
  }

  if (isPropertiesRoute && isPropertiesCompany) {
    return (
      <AppModeProvider mode="properties">
        <SidebarProvider style={style as React.CSSProperties}>
          <div className="flex h-screen w-full">
            <PropertiesSidebar user={user} />
            <div className="flex flex-col flex-1 overflow-hidden">
              <header className="flex items-center justify-between p-2 sm:p-4 border-b min-h-14 sm:h-16 gap-2 sm:gap-4 no-print">
                <div className="flex items-center gap-2">
                  <SidebarTrigger data-testid="button-sidebar-toggle" />
                  <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-indigo-600/10 border border-indigo-600/20">
                    <Building2 className="h-4 w-4 text-indigo-600" />
                    <span className="text-xs font-semibold text-indigo-600 uppercase tracking-wider">Properties</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 sm:gap-2 ml-auto flex-wrap justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex items-center gap-1.5 text-muted-foreground"
                    onClick={() => setPaletteOpen(true)}
                    data-testid="button-open-palette"
                  >
                    <Search className="h-4 w-4" />
                    <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 text-[10px] font-mono">
                      Ctrl /
                    </kbd>
                  </Button>
                  <span className="hidden md:inline text-sm text-muted-foreground">{user.username} ({user.role})</span>
                  <Button variant="ghost" size="icon" onClick={handleLogout} data-testid="button-logout">
                    <LogOut className="h-4 w-4" />
                  </Button>
                  <CurrencyToggle />
                  <CompanySelector />
                  <ThemeToggle />
                </div>
              </header>
              <OfflineBanner />
              <main className="flex-1 overflow-y-auto p-3 sm:p-6">
                <div className="w-full">
                  <ErrorBoundary resetKey={currentLocation}>
                    <Suspense fallback={<div className="flex items-center justify-center h-48 text-muted-foreground text-sm">Loading...</div>}>
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
                        {user?.role === "Developer" && <Route path="/properties/transfer" component={CompanyTransfer} />}
                        <Route path="/properties/ledger-monthly/:accountId" component={PropertiesLedgerMonthly} />
                        <Route path="/properties/ledger-vouchers/:accountId/:year/:month" component={PropertiesLedgerVouchers} />
                        {(user?.role === "Admin" || user?.role === "Developer") && <Route path="/properties/settings" component={PropertiesSettings} />}
                        <Route path="/my-settings" component={MySettings} />
                        <Route><Redirect to="/properties/daybook" /></Route>
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

  const factoryDefaultPage = hasDashboardAccess ? "/factory/dashboard" : "/factory/stock-entry";

  if (isFactoryCompany && !isFactoryRoute && currentLocation !== "/my-settings") {
    return <Redirect to={factoryDefaultPage} />;
  }

  if (isFactoryRoute && !hasFactoryAccess) {
    return <Redirect to="/" />;
  }

  if (!isFactoryCompany && !hasErpAccess && hasFactoryAccess && !isFactoryRoute && currentLocation !== "/my-settings") {
    return <Redirect to={factoryDefaultPage} />;
  }

  if (isFactoryRoute || isFactoryCompany) {
    return (
      <AppModeProvider mode="factory">
        <SidebarProvider style={style as React.CSSProperties}>
          <div ref={factoryContainerRef} className="flex h-screen w-full">
            {selectedCompany?.id && <DailyRateModal companyId={selectedCompany.id} />}
            <FactorySidebar user={user} />
            <div className="flex flex-col flex-1 overflow-hidden">
              <header className="flex items-center justify-between p-2 sm:p-4 border-b min-h-14 sm:h-16 gap-2 sm:gap-4 no-print">
                <div className="flex items-center gap-2">
                  <SidebarTrigger data-testid="button-sidebar-toggle" />
                  <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-orange-600/10 border border-orange-600/20">
                    <Factory className="h-4 w-4 text-orange-600" />
                    <span className="text-xs font-semibold text-orange-600 uppercase tracking-wider">Factory Mode</span>
                    {myAccess?.companyName && (
                      <span className="hidden sm:inline text-xs text-orange-600/70 font-normal normal-case tracking-normal border-l border-orange-600/20 pl-2">{myAccess.companyName}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 sm:gap-2 ml-auto flex-wrap justify-end">
                  {!isFactoryCompany && hasErpAccess && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setLocation("/")}
                      data-testid="button-switch-erp"
                    >
                      <Package className="h-4 w-4 mr-1" />
                      Switch to ERP
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex items-center gap-1.5 text-muted-foreground"
                    onClick={() => setPaletteOpen(true)}
                    data-testid="button-open-palette"
                  >
                    <Search className="h-4 w-4" />
                    <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 text-[10px] font-mono">
                      Ctrl /
                    </kbd>
                  </Button>
                  <PendingSyncIndicator />
                  <span className="hidden md:inline text-sm text-muted-foreground">{user.username} ({user.role})</span>
                  <Button variant="ghost" size="icon" onClick={handleLogout} data-testid="button-logout">
                    <LogOut className="h-4 w-4" />
                  </Button>
                  <CurrencyToggle />
                  <CompanySelector />
                  <ThemeToggle />
                </div>
              </header>
              <OfflineBanner />
              <main className="flex-1 overflow-y-auto p-3 sm:p-6">
                <div className="w-full">
                  <ErrorBoundary resetKey={currentLocation}>
                  <Suspense fallback={<div className="flex items-center justify-center h-48 text-muted-foreground text-sm">Loading...</div>}>
                  <Switch>
                    {hasDashboardAccess && <Route path="/factory/dashboard" component={FactoryDashboardIntel} />}
                    <Route path="/factory/daybook" component={FactoryDaybook} />
                    <Route path="/factory/transporters" component={FactoryTransporters} />
                    <Route path="/factory/finance" component={FactoryFinanceHub} />
                    <Route path="/factory/suppliers"><Redirect to="/factory/finance?tab=suppliers" /></Route>
                    <Route path="/factory/containers/new" component={FactoryContainerCreate} />
                    <Route path="/factory/containers" component={FactoryContainers} />
                    <Route path="/factory/bale-products" component={BaleProducts} />
                    <Route path="/factory/raw-stock/opening-balance/:id/edit" component={FactoryOpeningBalanceEdit} />
                    <Route path="/factory/raw-stock" component={ProductionRawStock} />
                    <Route path="/factory/raw-materials" component={FactoryRawMaterialsHub} />
                    <Route path="/factory/pressing"><Redirect to="/factory/stock-entry" /></Route>
                    <Route path="/factory/finalize"><Redirect to="/factory/stock-entry" /></Route>
                    <Route path="/factory/stock-entry" component={BaleStockEntry} />
                    <Route path="/factory/bales-history" component={BalesHistory} />
                    <Route path="/factory/bales-hub" component={FactoryBalesHub} />
                    <Route path="/factory/reprint-labels" component={FactoryReprintLabels} />
                    <Route path="/factory/location-inventory" component={FactoryLocationInventory} />
                    <Route path="/factory/bale-product-history/:productId/:locationId/:year/all" component={FactoryBaleProductAllMonths} />
                    <Route path="/factory/bale-product-history/:productId/:locationId/:year/:month" component={FactoryBaleProductMonthDetail} />
                    <Route path="/factory/bale-product-history/:productId/:locationId" component={FactoryBaleProductHistory} />
                    <Route path="/factory/stock-otw" component={FactoryStockOTW} />
                    <Route path="/factory/stock-query/:id" component={FactoryStockItemDetail} />
                    <Route path="/factory/stock-query" component={StockQuery} />
                    <Route path="/factory/accounts"><Redirect to="/factory/finance?tab=accounts" /></Route>
                    <Route path="/factory/agents" component={Agents} />
                    <Route path="/factory/vouchers"><Redirect to="/factory/finance?tab=vouchers" /></Route>
                    <Route path="/factory/vouchers/:id/edit" component={VoucherEdit} />
                    <Route path="/factory/voucher-detail/:voucherId" component={VoucherDetail} />
                    <Route path="/factory/create" component={AccountingCreate} />
                    <Route path="/factory/payroll" component={Payroll} />
                    <Route path="/factory/analytics" component={Analytics} />
                    <Route path="/factory/production-summary" component={ProductionSummary} />
                    <Route path="/factory/sales/new" component={FactoryInvoiceCreate} />
                    <Route path="/factory/sales/loading/pending" component={FactoryPendingLoadings} />
                    <Route path="/factory/sales/loading/new" component={FactoryContainerLoadingScan} />
                    <Route path="/factory/sales/loadings" component={FactoryLoadingsHub} />
                    <Route path="/factory/sales/pending-invoices/:id/verify" component={FactoryPendingInvoiceVerify} />
                    <Route path="/factory/invoices/:id/loading-scan" component={FactoryInvoiceLoadingScan} />
                    <Route path="/factory/sales/invoices/:id" component={FactoryInvoiceDetail} />
                    <Route path="/factory/price-list" component={FactoryPriceList} />
                    <Route path="/factory/sales/proformas/:proformaId/add-line" component={ProformaAddLine} />
                    <Route path="/factory/invoicing" component={FactoryInvoicing} />
                    <Route path="/factory/stock-allocation" component={FactoryStockAllocation} />
                    <Route path="/factory/stock-allocation-v3" component={FactoryStockAllocationV3} />
                    <Route path="/factory/stock-allocation-v5" component={FactoryStockAllocationV5} />
                    <Route path="/factory/customers/:id" component={FactoryCustomerStatement} />
                    <Route path="/factory/customers" component={FactoryCustomers} />
                    <Route path="/factory/payroll-hub"><Redirect to="/factory/finance?tab=workers" /></Route>
                    <Route path="/factory/employees/:id" component={FactoryEmployeeDetail} />
                    <Route path="/factory/employees"><Redirect to="/factory/finance?tab=employees" /></Route>
                    <Route path="/factory/workers/:id" component={FactoryWorkerDetail} />
                    <Route path="/factory/workers"><Redirect to="/factory/finance?tab=workers" /></Route>
                    <Route path="/factory/worker-payroll"><Redirect to="/factory/workers?tab=payroll" /></Route>
                    <Route path="/factory/supplier-report" component={FactorySupplierReport} />
                    <Route path="/factory/supplier-statement" component={FactorySupplierStatement} />
                    <Route path="/factory/broker-visual-statement" component={FactoryBrokerVisualStatement} />
                    <Route path="/factory/barcode-lookup" component={BarcodeLookup} />
                    <Route path="/factory/import" component={FactoryImport} />
                    <Route path="/factory/bale-relabeling" component={FactoryBaleRelabeling} />
                    <Route path="/factory/merge-bale-products" component={MergeBaleProducts} />
                    <Route path="/factory/bale-product-images" component={BaleProductImages} />
                    <Route path="/factory/customer-logos" component={CustomerLogosSettings} />
                    <Route path="/factory/bale-relabeling/wipers-re-entry" component={WipersReEntry} />
                    <Route path="/factory/users"><Redirect to="/factory/settings" /></Route>
                    <Route path="/factory/ledger-monthly/:accountId" component={LedgerMonthlySummary} />
                    <Route path="/factory/ledger-vouchers/:accountId/:year/:month" component={LedgerVouchers} />
                    <Route path="/factory/intelligence/dashboard" component={FactoryDashboardIntel} />
                    <Route path="/factory/intelligence/kpis" component={FactoryKpis} />
                    <Route path="/factory/intelligence/profitability" component={FactoryProfitability} />
                    <Route path="/factory/intelligence/alerts" component={FactoryAlerts} />
                    <Route path="/factory/intelligence/supplier-scores" component={FactorySupplierScoreboard} />
                    <Route path="/factory/intelligence/mix-optimizer" component={FactoryMixOptimizer} />
                    <Route path="/factory/intelligence/cashflow" component={FactoryCashflow} />
                    <Route path="/factory/intelligence/waste" component={FactoryWaste} />
                    <Route path="/factory/waste-dispatch" component={WasteDispatchPage} />
                    <Route path="/factory/pos" component={FactoryPOS} />
                    <Route path="/factory/bale-ledger">{() => <Redirect to="/factory/production-report" />}</Route>
                    <Route path="/factory/intelligence/settings" component={FactoryIntelSettings} />
                    {user?.role === "Developer" && <Route path="/factory/spreadsheet" component={SpreadsheetEditor} />}
                    <Route path="/factory/chat" component={Chat} />
                    <Route path="/factory/conflicts" component={ConflictCenter} />
                    {(user?.role === "Admin" || user?.role === "Developer") && <Route path="/factory/settings" component={Settings} />}
                    <Route path="/my-settings" component={MySettings} />
                    {(user?.role === "Admin" || user?.role === "Developer") && <Route path="/factory/deleted-items" component={DeletedItems} />}
                    {(user?.role === "Admin" || user?.role === "Developer") && <Route path="/factory/orphaned-records" component={OrphanedRecords} />}
                    {(user?.role === "Admin" || user?.role === "Developer") && <Route path="/factory/chatbot-settings" component={ChatbotSettings} />}
                    {(user?.role === "Admin" || user?.role === "Developer") && <Route path="/factory/import-cycle-diagnostics" component={ImportCycleDiagnostics} />}
                    {(user?.role === "Admin" || user?.role === "Developer") && <Route path="/factory/inventory-repair" component={InventoryRepair} />}
                    {(user?.role === "Admin" || user?.role === "Developer") && <Route path="/factory/company-data-reset" component={CompanyDataReset} />}
                    <Route path="/factory/net-position-details" component={FactoryNetPositionDetails} />
                    <Route path="/factory/net-profit-analytics" component={FactoryNetProfitAnalytics} />
                    <Route path="/factory/net-position" component={FactoryNetPosition} />
                    <Route path="/factory/financial-snapshot" component={FactoryFinancialSnapshot} />
                    <Route path="/factory/sheets" component={FactorySheets} />
                    <Route path="/factory/production-report" component={DailyProductionReport} />
                    <Route path="/factory/rental/warehouses" component={FactoryRentalWarehouses} />
                    <Route path="/factory/rental/shops" component={FactoryRentalShops} />
                    <Route path="/factory/rental/payments" component={FactoryRentalPayments} />
                    <Route><Redirect to={factoryDefaultPage} /></Route>
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
          hasDashboardAccess={hasDashboardAccess}
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
        <div className="flex h-screen w-full">
          {selectedCompany?.id && <DailyRateModal companyId={selectedCompany.id} />}
          <AppSidebar user={user} />
          <div className="flex flex-col flex-1 overflow-hidden">
            <header className="flex items-center justify-between p-2 sm:p-4 border-b min-h-14 sm:h-16 gap-2 sm:gap-4 no-print">
              <SidebarTrigger data-testid="button-sidebar-toggle" />
              <div className="flex items-center gap-1 sm:gap-2 ml-auto flex-wrap justify-end">
                <PendingSyncIndicator />
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex items-center gap-1.5 text-muted-foreground"
                  onClick={() => setPaletteOpen(true)}
                  data-testid="button-open-palette"
                >
                  <Search className="h-4 w-4" />
                  <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 text-[10px] font-mono">
                    Ctrl /
                  </kbd>
                </Button>
                <span className="hidden md:inline text-sm text-muted-foreground">{user.username} ({user.role})</span>
                <Button variant="ghost" size="icon" onClick={handleLogout} data-testid="button-logout">
                  <LogOut className="h-4 w-4" />
                </Button>
                <CurrencyToggle />
                <CompanySelector />
                <ThemeToggle />
              </div>
            </header>
            <OfflineBanner />
            <main className="flex-1 overflow-y-auto p-3 sm:p-6">
              <div className="w-full">
                <ErrorBoundary resetKey={currentLocation}>
                  <Suspense fallback={<div className="flex items-center justify-center h-48 text-muted-foreground text-sm">Loading...</div>}>
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
        hasDashboardAccess={hasDashboardAccess}
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
                  } catch { /* ignore */ }
                  window.location.reload();
                }}
              >
                Refresh
              </Button>
            ) as any,
          });
        }
      } catch { /* network error — ignore, will retry next interval */ }
    }

    checkVersion(); // initial check
    const id = setInterval(checkVersion, 5 * 60 * 1000); // every 5 minutes
    return () => clearInterval(id);
  }, [toast]);

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
