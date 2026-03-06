import { Switch, Route, useLocation, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
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
import { LogOut, ShoppingCart, MapPin, BookOpen, Package, Users, Upload, Factory, MessageSquare, Cog, Search } from "lucide-react";
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
import FactoryLocationInventory from "@/pages/FactoryLocationInventory";
import Settings from "@/pages/Settings";
import VoucherEdit from "@/pages/VoucherEdit";
import Payroll from "@/pages/Payroll";
import ImportStockItems from "@/pages/ImportStockItems";
import StockQuery from "@/pages/StockQuery";
import StockItemDetail from "@/pages/StockItemDetail";
import FactoryStockItemDetail from "@/pages/FactoryStockItemDetail";
import SalesReport from "@/pages/SalesReport";
import POSDaybook from "@/pages/POSDaybook";
import POSDashboard from "@/pages/POSDashboard";
import POSCustomers from "@/pages/POSCustomers";
import POSSettings from "@/pages/POSSettings";
import EditSupplier from "@/pages/EditSupplier";
import SupplierProformas from "@/pages/SupplierProformas";
import ContainerVerification from "@/pages/ContainerVerification";
import StockOTW from "@/pages/StockOTW";
import Customers from "@/pages/Customers";
import SoldContainers from "@/pages/SoldContainers";
import Bales from "@/pages/Bales";
import MixBatches from "@/pages/MixBatches";
import ProductionBales from "@/pages/ProductionBales";
import BaleProducts from "@/pages/BaleProducts";
import OrphanedRecords from "@/pages/OrphanedRecords";
import DeletedItems from "@/pages/DeletedItems";
import ChatbotSettings from "@/pages/ChatbotSettings";
import PurchaseOrderEdit from "@/pages/PurchaseOrderEdit";
import OffloadDetail from "@/pages/OffloadDetail";
import StockItemHistory from "@/pages/StockItemHistory";
import StockItemVouchers from "@/pages/StockItemVouchers";
import LocationMonthlySummary from "@/pages/LocationMonthlySummary";
import LocationVouchers from "@/pages/LocationVouchers";
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
import FactoryBaleProductHistory, { FactoryBaleProductMonthDetail } from "@/pages/FactoryBaleProductHistory";
import BarcodeLookup from "@/pages/BarcodeLookup";
import FactoryBalesHub from "@/pages/FactoryBalesHub";
import FactoryRawMaterialsHub from "@/pages/FactoryRawMaterialsHub";
import FactoryLoadingsHub from "@/pages/FactoryLoadingsHub";
import ProductionSummary from "@/pages/ProductionSummary";
import FactorySuppliers from "@/pages/FactorySuppliers";
import FactoryContainers from "@/pages/FactoryContainers";
import BarcodeManager from "@/pages/BarcodeManager";
import TestDataImport from "@/pages/TestDataImport";
import ImportCycleDiagnostics from "@/pages/ImportCycleDiagnostics";
import InventoryRepair from "@/pages/InventoryRepair";
import NetProfitDetails from "@/pages/NetProfitDetails";
import CompanyDataReset from "@/pages/CompanyDataReset";
import StockTransferOrder from "@/pages/StockTransferOrder";
import OptionalVouchers from "@/pages/OptionalVouchers";
import SalesReportDetail from "@/pages/SalesReportDetail";
import FactoryImport from "@/pages/FactoryImport";
import FactoryUsers from "@/pages/FactoryUsers";
import FactoryWorkersHub from "@/pages/FactoryWorkersHub";
import FactoryWorkerDetail from "@/pages/FactoryWorkerDetail";
import FactorySupplierReport from "@/pages/FactorySupplierReport";
import FactoryCustomers from "@/pages/FactoryCustomers";
import FactoryInvoices from "@/pages/FactoryInvoices";
import FactoryInvoiceCreate from "@/pages/FactoryInvoiceCreate";
import FactoryInvoiceDetail from "@/pages/FactoryInvoiceDetail";
import FactoryProformas from "@/pages/FactoryProformas";
import FactoryPendingInvoices from "@/pages/FactoryPendingInvoices";
import FactoryPendingInvoiceVerify from "@/pages/FactoryPendingInvoiceVerify";
import FactoryPendingLoadings from "@/pages/FactoryPendingLoadings";
import FactoryContainerLoadingScan from "@/pages/FactoryContainerLoadingScan";
import FactoryDashboardIntel from "@/pages/FactoryDashboard";
import FactoryKpis from "@/pages/FactoryKpis";
import FactoryProfitability from "@/pages/FactoryProfitability";
import FactoryAlerts from "@/pages/FactoryAlerts";
import FactorySupplierScoreboard from "@/pages/FactorySupplierScoreboard";
import FactoryMixOptimizer from "@/pages/FactoryMixOptimizer";
import FactoryCashflow from "@/pages/FactoryCashflow";
import FactoryWaste from "@/pages/FactoryWaste";
import FactoryIntelSettings from "@/pages/FactorySettings";
import Chat from "@/pages/Chat";
import { CommandPalette } from "@/components/CommandPalette";
import { useEffect, useCallback, useState, useRef } from "react";
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
      <Route path="/offloads/:id" component={OffloadDetail} />
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
      <Route path="/location-summary"><Redirect to="/stock-query?tab=summary" /></Route>
      <Route path="/stock-transfer-order" component={StockTransferOrder} />
      <Route path="/optional-vouchers" component={OptionalVouchers} />
      <Route path="/stock-items/:id/history" component={StockItemHistory} />
      <Route path="/stock-items/:id/history/:year/:month" component={StockItemVouchers} />
      <Route path="/stock-items/:stockItemId/monthly-summary">{() => <LocationMonthlySummary />}</Route>
      <Route path="/locations/:locationId/stock-items/:stockItemId/history">{() => <LocationMonthlySummary />}</Route>
      <Route path="/locations/:locationId/stock-items/:stockItemId/vouchers/:year/:month">{() => <LocationVouchers />}</Route>
      <Route path="/sales-report" component={SalesReport} />
      <Route path="/sales-report/detail" component={SalesReportDetail} />
      <Route path="/combined-inventory"><Redirect to="/stock-otw?tab=combined" /></Route>
      <Route path="/pos-daybook" component={POSDaybook} />
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
      <Route path="/chat" component={Chat} />
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
      {user?.role === "Admin" && <Route path="/inventory-repair" component={InventoryRepair} />}
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
  const [paletteOpen, setPaletteOpen] = useState(false);
  
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

  useEffect(() => {
    if (!isLoading && (error || !user)) {
      setLocation("/login");
    }
  }, [isLoading, error, user, setLocation]);

  const isPOS = user?.role?.startsWith("POS") ?? false;
  const { toast } = useToast();
  const prevUnreadRef = useRef<number>(-1);

  const { data: chatUnread } = useQuery<{ count: number }>({
    queryKey: ["/api/chat/unread-count"],
    refetchInterval: 10000,
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
    enabled: isPOS,
  });
  const posImportEnabled = posCompanySettings?.posExcelImportEnabled === true;

  const { data: myAccess } = useQuery<{ fullAccess: boolean; pageKeys: string[]; hasErpAccess: boolean; hasFactoryAccess: boolean }>({
    queryKey: ["/api/factory/my-access"],
    enabled: !!user && !isPOS,
    staleTime: 30000,
  });

  const hasErpAccess = !myAccess || myAccess.hasErpAccess;
  const hasFactoryAccess = !myAccess || myAccess.hasFactoryAccess;
  const isAdminOwner = user?.role === "Admin" || user?.role === "Owner";
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
    const isOnCustomers = currentLocation === "/pos-customers";
    const isOnTransfer = currentLocation.startsWith("/vouchers");
    const isOnChat = currentLocation === "/pos-chat";
    const isOnSettings = currentLocation === "/pos-settings";

    const posNavItems = [
      { label: "Point of Sale", icon: ShoppingCart, active: isOnPOS, testId: "button-pos-tab", onClick: () => setLocation("/") },
      { label: "Daybook", icon: BookOpen, active: isOnDaybook, testId: "button-daybook-tab", onClick: () => setLocation("/pos-daybook") },
      { label: "Inventory", icon: MapPin, active: isOnInventory, testId: "button-inventory-tab", onClick: () => setLocation("/location-inventory") },
      { label: "Transfer", icon: Package, active: isOnTransfer, testId: "button-stock-transfer-tab", onClick: () => setLocation("/vouchers?tab=transfer") },
      ...(user.canAccessCustomers ? [{ label: "Customers", icon: Users, active: isOnCustomers, testId: "button-customers-tab", onClick: () => setLocation("/pos-customers") }] : []),
      ...(posImportEnabled ? [{ label: "Import", icon: Upload, active: isOnImport, testId: "button-pos-import-tab", onClick: () => setLocation("/pos-import") }] : []),
      { label: "Chat", icon: MessageSquare, active: isOnChat, testId: "button-chat-tab", onClick: () => setLocation("/pos-chat"), badge: chatUnread?.count || 0 },
      { label: "Settings", icon: Cog, active: isOnSettings, testId: "button-settings-tab", onClick: () => setLocation("/pos-settings") },
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
              <header className="flex items-center justify-between gap-2 p-2 border-b h-12">
                <SidebarTrigger data-testid="button-sidebar-toggle" />
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex items-center gap-1.5 text-muted-foreground"
                  onClick={() => setPaletteOpen(true)}
                  data-testid="button-open-palette"
                >
                  <Search className="h-4 w-4" />
                  <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 text-[10px] font-mono">
                    Ctrl K
                  </kbd>
                </Button>
              </header>
              <main className="flex-1 overflow-y-auto p-3 sm:p-6">
                <div className="w-full">
                  <Router user={user} posImportEnabled={posImportEnabled} />
                </div>
              </main>
            </div>
          </div>
        </SidebarProvider>
        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          isPOS={true}
        />
        {leaveConfirmDialog}
      </>
    );
  }

  const isFactoryCompany = selectedCompany?.companyType === "factory";
  const isFactoryRoute = currentLocation.startsWith("/factory/");

  const factoryDefaultPage = hasDashboardAccess ? "/factory/dashboard" : "/factory/stock-entry";

  if (isFactoryCompany && !isFactoryRoute) {
    return <Redirect to={factoryDefaultPage} />;
  }

  if (isFactoryRoute && !hasFactoryAccess) {
    return <Redirect to="/" />;
  }

  if (!isFactoryCompany && !hasErpAccess && hasFactoryAccess && !isFactoryRoute) {
    return <Redirect to={factoryDefaultPage} />;
  }

  if (isFactoryRoute || isFactoryCompany) {
    return (
      <AppModeProvider mode="factory">
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
                      Ctrl K
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
              <main className="flex-1 overflow-y-auto p-3 sm:p-6">
                <div className="w-full">
                  <Switch>
                    {hasDashboardAccess && <Route path="/factory/dashboard" component={FactoryDashboardIntel} />}
                    <Route path="/factory/daybook" component={FactoryDaybook} />
                    <Route path="/factory/suppliers" component={FactorySuppliers} />
                    <Route path="/factory/containers" component={FactoryContainers} />
                    <Route path="/factory/bale-products" component={BaleProducts} />
                    <Route path="/factory/raw-stock" component={ProductionRawStock} />
                    <Route path="/factory/mix-batches" component={MixBatches} />
                    <Route path="/factory/raw-materials" component={FactoryRawMaterialsHub} />
                    <Route path="/factory/pressing"><Redirect to="/factory/stock-entry" /></Route>
                    <Route path="/factory/finalize"><Redirect to="/factory/stock-entry" /></Route>
                    <Route path="/factory/stock-entry" component={BaleStockEntry} />
                    <Route path="/factory/bales-history" component={BalesHistory} />
                    <Route path="/factory/bales-hub" component={FactoryBalesHub} />
                    <Route path="/factory/location-inventory" component={FactoryLocationInventory} />
                    <Route path="/factory/bale-product-history/:productId/:locationId/:year/:month" component={FactoryBaleProductMonthDetail} />
                    <Route path="/factory/bale-product-history/:productId/:locationId" component={FactoryBaleProductHistory} />
                    <Route path="/factory/stock-otw" component={StockOTW} />
                    <Route path="/factory/stock-query/:id" component={FactoryStockItemDetail} />
                    <Route path="/factory/stock-query" component={StockQuery} />
                    <Route path="/factory/accounts" component={Accounts} />
                    <Route path="/factory/vouchers">{() => <Vouchers />}</Route>
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
                    <Route path="/factory/sales/pending-invoices" component={FactoryPendingInvoices} />
                    <Route path="/factory/sales/invoices/:id" component={FactoryInvoiceDetail} />
                    <Route path="/factory/sales/invoices" component={FactoryInvoices} />
                    <Route path="/factory/sales/proformas" component={FactoryProformas} />
                    <Route path="/factory/customers" component={FactoryCustomers} />
                    <Route path="/factory/workers/:id" component={FactoryWorkerDetail} />
                    <Route path="/factory/workers" component={FactoryWorkersHub} />
                    <Route path="/factory/worker-payroll"><Redirect to="/factory/workers?tab=payroll" /></Route>
                    <Route path="/factory/supplier-report" component={FactorySupplierReport} />
                    <Route path="/factory/barcode-lookup" component={BarcodeLookup} />
                    <Route path="/factory/import" component={FactoryImport} />
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
                    <Route path="/factory/intelligence/settings" component={FactoryIntelSettings} />
                    <Route path="/factory/chat" component={Chat} />
                    {user?.role === "Admin" && <Route path="/factory/settings" component={Settings} />}
                    {user?.role === "Admin" && <Route path="/factory/deleted-items" component={DeletedItems} />}
                    {user?.role === "Admin" && <Route path="/factory/orphaned-records" component={OrphanedRecords} />}
                    {user?.role === "Admin" && <Route path="/factory/chatbot-settings" component={ChatbotSettings} />}
                    {user?.role === "Admin" && <Route path="/factory/import-cycle-diagnostics" component={ImportCycleDiagnostics} />}
                    {user?.role === "Admin" && <Route path="/factory/inventory-repair" component={InventoryRepair} />}
                    {user?.role === "Admin" && <Route path="/factory/company-data-reset" component={CompanyDataReset} />}
                    <Route path="/factory/net-profit-details" component={NetProfitDetails} />
                    <Route><Redirect to={factoryDefaultPage} /></Route>
                  </Switch>
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
          isAdminOwner={isAdminOwner}
          hasDashboardAccess={hasDashboardAccess}
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
            <header className="flex items-center justify-between p-2 sm:p-4 border-b min-h-14 sm:h-16 gap-2 sm:gap-4">
              <SidebarTrigger data-testid="button-sidebar-toggle" />
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
                    Ctrl K
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
            <main className="flex-1 overflow-y-auto p-3 sm:p-6">
              <div className="w-full">
                <Router user={user} />
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
        isAdminOwner={isAdminOwner}
        hasDashboardAccess={hasDashboardAccess}
      />
      {leaveConfirmDialog}
    </AppModeProvider>
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
                  <CursorNavProvider>
                    <Switch>
                      <Route path="/login" component={Login} />
                      <Route>
                        <AuthenticatedApp />
                      </Route>
                    </Switch>
                    <Toaster />
                    <ChatWidget />
                  </CursorNavProvider>
                </CurrencyProvider>
              </DateFormatProvider>
            </LocationProvider>
          </CompanyProvider>
        </ThemeProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
