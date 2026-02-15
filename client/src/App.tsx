import { Switch, Route, useLocation, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ChatWidget } from "@/components/ChatWidget";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
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
import { Button } from "@/components/ui/button";
import { LogOut, ShoppingCart, MapPin, BookOpen, Package, Users, Upload, Factory } from "lucide-react";
import { FactorySidebar } from "@/components/FactorySidebar";
import { usePresence } from "@/hooks/use-presence";
import { apiRequest } from "@/lib/queryClient";
import NotFound from "@/pages/not-found";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import ContainerDashboard from "@/pages/ContainerDashboard";
import POS from "@/pages/POS";
import StockItems from "@/pages/StockItems";
import Containers from "@/pages/Containers";
import Accounts from "@/pages/Accounts";
import Suppliers from "@/pages/Suppliers";
import Vouchers from "@/pages/Vouchers";
import Daybook from "@/pages/Daybook";
import FactoryDaybook from "@/pages/FactoryDaybook";
import Analytics from "@/pages/Analytics";
import AccountingCreate from "@/pages/AccountingCreate";
import POImport from "@/pages/POImport";
import POSImport from "@/pages/POSImport";
import ContainerDetail from "@/pages/ContainerDetail";
import LocationInventory from "@/pages/LocationInventory";
import Settings from "@/pages/Settings";
import VoucherEdit from "@/pages/VoucherEdit";
import Payroll from "@/pages/Payroll";
import ImportStockItems from "@/pages/ImportStockItems";
import StockQuery from "@/pages/StockQuery";
import StockItemDetail from "@/pages/StockItemDetail";
import SalesReport from "@/pages/SalesReport";
import POSDaybook from "@/pages/POSDaybook";
import POSDashboard from "@/pages/POSDashboard";
import POSCustomers from "@/pages/POSCustomers";
import EditSupplier from "@/pages/EditSupplier";
import StockOTW from "@/pages/StockOTW";
import Customers from "@/pages/Customers";
import SoldContainers from "@/pages/SoldContainers";
import Bales from "@/pages/Bales";
import MixBatches from "@/pages/MixBatches";
import ProductionBales from "@/pages/ProductionBales";
import BaleProducts from "@/pages/BaleProducts";
import BaleTransfer from "@/pages/bale-transfer";
import OrphanedRecords from "@/pages/OrphanedRecords";
import DeletedItems from "@/pages/DeletedItems";
import ChatbotSettings from "@/pages/ChatbotSettings";
import PurchaseOrderEdit from "@/pages/PurchaseOrderEdit";
import StockItemHistory from "@/pages/StockItemHistory";
import StockItemVouchers from "@/pages/StockItemVouchers";
import LocationMonthlySummary from "@/pages/LocationMonthlySummary";
import LocationVouchers from "@/pages/LocationVouchers";
import LocationSummary from "@/pages/LocationSummary";
import OpeningStockSummary from "@/pages/OpeningStockSummary";
import OpeningStockDetail from "@/pages/OpeningStockDetail";
import ClosingStockSummary from "@/pages/ClosingStockSummary";
import ClosingStockDetail from "@/pages/ClosingStockDetail";
import LedgerMonthlySummary from "@/pages/LedgerMonthlySummary";
import LedgerVouchers from "@/pages/LedgerVouchers";
import VoucherDetail from "@/pages/VoucherDetail";
import FactoryProduction from "@/pages/FactoryProduction";
import ProductionRawStock from "@/pages/ProductionRawStock";
import PressingBales from "@/pages/PressingBales";
import BaleStockEntry from "@/pages/BaleStockEntry";
import BalesHistory from "@/pages/BalesHistory";
import BarcodeLookup from "@/pages/BarcodeLookup";
import ProductionSummary from "@/pages/ProductionSummary";
import BaleTransfers from "@/pages/BaleTransfers";
import FactorySuppliers from "@/pages/FactorySuppliers";
import FactoryContainers from "@/pages/FactoryContainers";
import BarcodeManager from "@/pages/BarcodeManager";
import TestDataImport from "@/pages/TestDataImport";
import ImportCycleDiagnostics from "@/pages/ImportCycleDiagnostics";
import NetProfitDetails from "@/pages/NetProfitDetails";
import CompanyDataReset from "@/pages/CompanyDataReset";
import StockTransferOrder from "@/pages/StockTransferOrder";
import OptionalVouchers from "@/pages/OptionalVouchers";
import FactoryImport from "@/pages/FactoryImport";
import FactoryWorkers from "@/pages/FactoryWorkers";
import FactoryWorkerDetail from "@/pages/FactoryWorkerDetail";
import FactoryPayrollPage from "@/pages/FactoryPayroll";
import FactorySupplierReport from "@/pages/FactorySupplierReport";
import CustomerProformas from "@/pages/CustomerProformas";
import CustomerInvoiceCreate from "@/pages/CustomerInvoiceCreate";
import CustomerInvoices from "@/pages/CustomerInvoices";
import CustomerInvoiceDetail from "@/pages/CustomerInvoiceDetail";
import FactoryDashboardIntel from "@/pages/FactoryDashboard";
import FactoryKpis from "@/pages/FactoryKpis";
import FactoryProfitability from "@/pages/FactoryProfitability";
import FactoryAlerts from "@/pages/FactoryAlerts";
import FactorySupplierScoreboard from "@/pages/FactorySupplierScoreboard";
import FactoryMixOptimizer from "@/pages/FactoryMixOptimizer";
import FactoryCashflow from "@/pages/FactoryCashflow";
import FactoryWaste from "@/pages/FactoryWaste";
import FactoryIntelSettings from "@/pages/FactorySettings";
import { useEffect, useCallback, useState } from "react";
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
      <Route path="/stock-items" component={StockItems} />
      <Route path="/location-inventory">{() => <LocationInventory />}</Route>
      <Route path="/containers" component={Containers} />
      <Route path="/containers/:id" component={ContainerDetail} />
      <Route path="/stock-otw" component={StockOTW} />
      <Route path="/po-import" component={POImport} />
      <Route path="/pos-import" component={POSImport} />
      <Route path="/analytics" component={Analytics} />
      <Route path="/accounts" component={Accounts} />
      <Route path="/suppliers" component={Suppliers} />
      <Route path="/customers" component={Customers} />
      <Route path="/vouchers">{() => <Vouchers />}</Route>
      <Route path="/vouchers/:id/edit" component={VoucherEdit} />
      <Route path="/purchase-orders/:id/edit" component={PurchaseOrderEdit} />
      <Route path="/daybook">{() => <Daybook user={user} />}</Route>
      <Route path="/payroll" component={Payroll} />
      <Route path="/create" component={AccountingCreate} />
      <Route path="/import-stock-items" component={ImportStockItems} />
      <Route path="/stock-query/:id" component={StockItemDetail} />
      <Route path="/stock-query" component={StockQuery} />
      <Route path="/location-summary" component={LocationSummary} />
      <Route path="/stock-transfer-order" component={StockTransferOrder} />
      <Route path="/optional-vouchers" component={OptionalVouchers} />
      <Route path="/stock-items/:id/history" component={StockItemHistory} />
      <Route path="/stock-items/:id/history/:year/:month" component={StockItemVouchers} />
      <Route path="/stock-items/:stockItemId/monthly-summary">{() => <LocationMonthlySummary />}</Route>
      <Route path="/locations/:locationId/stock-items/:stockItemId/history">{() => <LocationMonthlySummary />}</Route>
      <Route path="/locations/:locationId/stock-items/:stockItemId/vouchers/:year/:month">{() => <LocationVouchers />}</Route>
      <Route path="/sales-report" component={SalesReport} />
      <Route path="/pos-daybook" component={POSDaybook} />
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
      <Route path="/bales"><Redirect to="/factory/raw-stock" /></Route>
      <Route path="/mix-batches"><Redirect to="/factory/mix-batches" /></Route>
      <Route path="/production-bales"><Redirect to="/factory/stock-entry" /></Route>
      <Route path="/bale-products"><Redirect to="/factory/bale-products" /></Route>
      <Route path="/sold-containers"><Redirect to="/containers" /></Route>
      {user?.role === "Admin" && <Route path="/settings" component={Settings} />}
      {user?.role === "Admin" && <Route path="/orphaned-records" component={OrphanedRecords} />}
      {user?.role === "Admin" && <Route path="/deleted-items" component={DeletedItems} />}
      {user?.role === "Admin" && <Route path="/chatbot-settings" component={ChatbotSettings} />}
      {user?.role === "Admin" && <Route path="/test-data-import" component={TestDataImport} />}
      {user?.role === "Admin" && <Route path="/import-cycle-diagnostics" component={ImportCycleDiagnostics} />}
      {user?.role === "Admin" && <Route path="/net-profit-details" component={NetProfitDetails} />}
      {user?.role === "Admin" && <Route path="/company-data-reset" component={CompanyDataReset} />}
      <Route component={NotFound} />
    </Switch>
  );
}

function AuthenticatedApp() {
  const { selectedCompany } = useCompany();
  usePresence(); // Track user presence
  const [location, setLocation] = useLocation();
  const [currentLocation] = useLocation();
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  
  const { data: user, isLoading, error } = useQuery<any>({
    queryKey: ["/api/auth/me"],
    retry: false,
  });

  const handleGoBack = useCallback(() => {
    if (window.__escBackGuard && window.__escBackGuard()) {
      setShowLeaveConfirm(true);
      return;
    }
    window.history.back();
  }, []);

  const handleConfirmLeave = useCallback(() => {
    setShowLeaveConfirm(false);
    if (window.__escBackConfirm) {
      window.__escBackConfirm();
    }
    window.history.back();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;

      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") {
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

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleGoBack]);

  useEffect(() => {
    if (!isLoading && (error || !user)) {
      setLocation("/login");
    }
  }, [isLoading, error, user, setLocation]);

  const isPOS = user?.role?.startsWith("POS") ?? false;

  const { data: posCompanySettings } = useQuery<any>({
    queryKey: ["/api/company-settings"],
    enabled: isPOS,
  });
  const posImportEnabled = posCompanySettings?.posExcelImportEnabled === true;

  const handleLogout = async () => {
    try {
      await apiRequest("POST", "/api/auth/logout", {});
      queryClient.clear();
      window.location.href = "/login";
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (error || !user) {
    return null; // Will redirect to login
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
    
    return (
      <>
      <div className="flex flex-col h-screen w-full">
        {selectedCompany?.id && <DailyRateModal companyId={selectedCompany.id} />}
        <header className="flex flex-col border-b">
          <div className="flex items-center justify-between p-2 sm:p-4 min-h-14 sm:h-16 gap-2 sm:gap-4">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={handleGoBack} data-testid="button-pos-back">
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <h1 className="text-base sm:text-lg font-semibold truncate">POS {user.posStation || ""}</h1>
            </div>
            <div className="flex items-center gap-1 sm:gap-2 ml-auto">
              <span className="hidden sm:inline text-sm text-muted-foreground">{user.username}</span>
              <Button variant="ghost" size="icon" onClick={handleLogout} data-testid="button-logout">
                <LogOut className="h-4 w-4" />
              </Button>
              <CompanySelector />
              <CurrencyToggle />
              <ThemeToggle />
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-2 px-2 sm:px-4 pb-2 overflow-x-auto">
            <Button
              variant={isOnPOS ? "default" : "ghost"}
              size="sm"
              onClick={() => setLocation("/")}
              data-testid="button-pos-tab"
              className="shrink-0"
            >
              <ShoppingCart className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Point of Sale</span>
            </Button>
            <Button
              variant={isOnDaybook ? "default" : "ghost"}
              size="sm"
              onClick={() => setLocation("/pos-daybook")}
              data-testid="button-daybook-tab"
              className="shrink-0"
            >
              <BookOpen className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Daybook</span>
            </Button>
            <Button
              variant={isOnInventory ? "default" : "ghost"}
              size="sm"
              onClick={() => setLocation("/location-inventory")}
              data-testid="button-inventory-tab"
              className="shrink-0"
            >
              <MapPin className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Inventory</span>
            </Button>
            <Button
              variant={currentLocation.startsWith("/vouchers") ? "default" : "ghost"}
              size="sm"
              onClick={() => setLocation("/vouchers?tab=transfer")}
              data-testid="button-stock-transfer-tab"
              className="shrink-0"
            >
              <Package className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Transfer</span>
            </Button>
            {user.canAccessCustomers && (
              <Button
                variant={currentLocation === "/pos-customers" ? "default" : "ghost"}
                size="sm"
                onClick={() => setLocation("/pos-customers")}
                data-testid="button-customers-tab"
                className="shrink-0"
              >
                <Users className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Customers</span>
              </Button>
            )}
            {posImportEnabled && (
              <Button
                variant={isOnImport ? "default" : "ghost"}
                size="sm"
                onClick={() => setLocation("/pos-import")}
                data-testid="button-pos-import-tab"
                className="shrink-0"
              >
                <Upload className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Import</span>
              </Button>
            )}
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-3 sm:p-6">
          <div className="w-full">
            <Router user={user} posImportEnabled={posImportEnabled} />
          </div>
        </main>
      </div>
      {leaveConfirmDialog}
      </>
    );
  }

  const isFactoryCompany = selectedCompany?.companyType === "factory";
  const isFactoryRoute = currentLocation.startsWith("/factory/");

  if (isFactoryCompany && !isFactoryRoute) {
    return <Redirect to="/factory/dashboard" />;
  }

  if (isFactoryRoute || isFactoryCompany) {
    return (
      <>
        <SidebarProvider style={style as React.CSSProperties}>
          <div className="flex h-screen w-full">
            {selectedCompany?.id && <DailyRateModal companyId={selectedCompany.id} />}
            <FactorySidebar user={user} />
            <div className="flex flex-col flex-1 overflow-hidden">
              <header className="flex items-center justify-between p-2 sm:p-4 border-b min-h-14 sm:h-16 gap-2 sm:gap-4">
                <div className="flex items-center gap-2">
                  <SidebarTrigger data-testid="button-sidebar-toggle" />
                  <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-orange-600/10 border border-orange-600/20">
                    <Factory className="h-4 w-4 text-orange-600" />
                    <span className="text-xs font-semibold text-orange-600 uppercase tracking-wider">Factory Mode</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 sm:gap-2 ml-auto flex-wrap justify-end">
                  {!isFactoryCompany && (
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
                  <span className="hidden md:inline text-sm text-muted-foreground">{user.username} ({user.role})</span>
                  <Button variant="ghost" size="icon" onClick={handleLogout} data-testid="button-logout">
                    <LogOut className="h-4 w-4" />
                  </Button>
                  <CompanySelector />
                  <CurrencyToggle />
                  <ThemeToggle />
                </div>
              </header>
              <main className="flex-1 overflow-y-auto p-3 sm:p-6">
                <div className="w-full">
                  <Switch>
                    <Route path="/factory/dashboard" component={Dashboard} />
                    <Route path="/factory/daybook" component={FactoryDaybook} />
                    <Route path="/factory/suppliers" component={FactorySuppliers} />
                    <Route path="/factory/containers" component={FactoryContainers} />
                    <Route path="/factory/bale-products" component={BaleProducts} />
                    <Route path="/factory/raw-stock" component={ProductionRawStock} />
                    <Route path="/factory/mix-batches" component={MixBatches} />
                    <Route path="/factory/pressing"><Redirect to="/factory/stock-entry" /></Route>
                    <Route path="/factory/finalize"><Redirect to="/factory/stock-entry" /></Route>
                    <Route path="/factory/stock-entry" component={BaleStockEntry} />
                    <Route path="/factory/bales-history" component={BalesHistory} />
                    <Route path="/factory/bale-transfers" component={BaleTransfers} />
                    <Route path="/factory/location-inventory">{() => <LocationInventory />}</Route>
                    <Route path="/factory/stock-otw" component={StockOTW} />
                    <Route path="/factory/stock-query/:id" component={StockItemDetail} />
                    <Route path="/factory/stock-query" component={StockQuery} />
                    <Route path="/factory/accounts" component={Accounts} />
                    <Route path="/factory/vouchers">{() => <Vouchers />}</Route>
                    <Route path="/factory/vouchers/:id/edit" component={VoucherEdit} />
                    <Route path="/factory/voucher-detail/:voucherId" component={VoucherDetail} />
                    <Route path="/factory/create" component={AccountingCreate} />
                    <Route path="/factory/payroll" component={Payroll} />
                    <Route path="/factory/analytics" component={Analytics} />
                    <Route path="/factory/production-summary" component={ProductionSummary} />
                    <Route path="/factory/sales/new" component={CustomerInvoiceCreate} />
                    <Route path="/factory/sales/invoices/:id" component={CustomerInvoiceDetail} />
                    <Route path="/factory/sales/invoices" component={CustomerInvoices} />
                    <Route path="/factory/sales/proformas" component={CustomerProformas} />
                    <Route path="/factory/workers/:id" component={FactoryWorkerDetail} />
                    <Route path="/factory/workers" component={FactoryWorkers} />
                    <Route path="/factory/worker-payroll" component={FactoryPayrollPage} />
                    <Route path="/factory/supplier-report" component={FactorySupplierReport} />
                    <Route path="/factory/barcode-lookup" component={BarcodeLookup} />
                    <Route path="/factory/import" component={FactoryImport} />
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
                    <Route path="/factory/intelligence/settings" component={FactoryIntelSettings} />
                    {user?.role === "Admin" && <Route path="/factory/settings" component={Settings} />}
                    <Route><Redirect to="/factory/dashboard" /></Route>
                  </Switch>
                </div>
              </main>
            </div>
          </div>
        </SidebarProvider>
        {leaveConfirmDialog}
      </>
    );
  }

  // Full ERP interface for Admin, Owner, Manager
  return (
    <>
      <SidebarProvider style={style as React.CSSProperties}>
        <div className="flex h-screen w-full">
          {selectedCompany?.id && <DailyRateModal companyId={selectedCompany.id} />}
          <AppSidebar user={user} />
          <div className="flex flex-col flex-1 overflow-hidden">
            <header className="flex items-center justify-between p-2 sm:p-4 border-b min-h-14 sm:h-16 gap-2 sm:gap-4">
              <SidebarTrigger data-testid="button-sidebar-toggle" />
              <div className="flex items-center gap-1 sm:gap-2 ml-auto flex-wrap justify-end">
                <span className="hidden md:inline text-sm text-muted-foreground">{user.username} ({user.role})</span>
                <Button variant="ghost" size="icon" onClick={handleLogout} data-testid="button-logout">
                  <LogOut className="h-4 w-4" />
                </Button>
                <CompanySelector />
                <CurrencyToggle />
                <ThemeToggle />
              </div>
            </header>
            <main className="flex-1 overflow-y-auto p-3 sm:p-6">
              <div className="w-full">
                <Router user={user} />
              </div>
            </main>
          </div>
        </div>
      </SidebarProvider>
      {leaveConfirmDialog}
    </>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ThemeProvider>
          <CompanyProvider>
            <LocationProvider>
              <DateFormatProvider>
                <CurrencyProvider>
                  <Switch>
                    <Route path="/login" component={Login} />
                    <Route>
                      <AuthenticatedApp />
                    </Route>
                  </Switch>
                  <Toaster />
                  <ChatWidget />
                </CurrencyProvider>
              </DateFormatProvider>
            </LocationProvider>
          </CompanyProvider>
        </ThemeProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
