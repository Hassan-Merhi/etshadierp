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
import { LocationProvider } from "@/contexts/LocationContext";
import { CompanyProvider } from "@/contexts/CompanyContext";
import { DateFormatProvider } from "@/contexts/DateFormatContext";
import { CurrencyProvider } from "@/contexts/CurrencyContext";
import { Button } from "@/components/ui/button";
import { LogOut, ShoppingCart, MapPin, BookOpen, Package, Users } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import BarcodeManager from "@/pages/BarcodeManager";
import TestDataImport from "@/pages/TestDataImport";
import ImportCycleDiagnostics from "@/pages/ImportCycleDiagnostics";
import NetProfitDetails from "@/pages/NetProfitDetails";
import CompanyDataReset from "@/pages/CompanyDataReset";
import StockTransferOrder from "@/pages/StockTransferOrder";
import { useEffect } from "react";

function Router({ user }: { user: any }) {
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
        <Route path="/pos-daybook" component={POSDaybook} />
        <Route path="/pos-dashboard">{() => <POSDashboard posUser={user} />}</Route>
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
      <Route path="/stock-items/:id/history" component={StockItemHistory} />
      <Route path="/stock-items/:id/history/:year/:month" component={StockItemVouchers} />
      <Route path="/stock-items/:stockItemId/monthly-summary" component={LocationMonthlySummary} />
      <Route path="/locations/:locationId/stock-items/:stockItemId/history" component={LocationMonthlySummary} />
      <Route path="/locations/:locationId/stock-items/:stockItemId/vouchers/:year/:month" component={LocationVouchers} />
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
      <Route path="/factory-production" component={FactoryProduction} />
      <Route path="/barcode-manager" component={BarcodeManager} />
      <Route path="/bales"><Redirect to="/factory-production" /></Route>
      <Route path="/mix-batches"><Redirect to="/factory-production" /></Route>
      <Route path="/production-bales"><Redirect to="/factory-production" /></Route>
      <Route path="/bale-products"><Redirect to="/factory-production" /></Route>
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
  usePresence(); // Track user presence
  const [location, setLocation] = useLocation();
  const [currentLocation] = useLocation();
  
  const { data: user, isLoading, error } = useQuery<any>({
    queryKey: ["/api/auth/me"],
    retry: false,
  });

  useEffect(() => {
    if (!isLoading && (error || !user)) {
      setLocation("/login");
    }
  }, [isLoading, error, user, setLocation]);

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

  const isPOS = user.role.startsWith("POS");
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  // Customer balances query for POS users with permission
  interface CustomerBalanceItem {
    id: number;
    name: string;
    code: string;
    balance: number;
    balanceSide: "Dr" | "Cr";
  }
  const { data: customerBalances = [] } = useQuery<CustomerBalanceItem[]>({
    queryKey: ["/api/pos/customer-balances"],
    enabled: isPOS && !!user?.canViewCustomerBalances,
  });

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
  };

  // POS users get a simplified interface without sidebar
  if (isPOS) {
    const isOnPOS = currentLocation === "/";
    const isOnInventory = currentLocation === "/location-inventory";
    const isOnDaybook = currentLocation === "/pos-daybook";
    
    return (
      <div className="flex flex-col h-screen w-full">
        <header className="flex flex-col border-b">
          <div className="flex items-center justify-between p-2 sm:p-4 min-h-14 sm:h-16 gap-2 sm:gap-4">
            <div className="flex items-center gap-2">
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
          <div className="flex flex-wrap items-center gap-1 sm:gap-2 px-2 sm:px-4 pb-2 overflow-x-auto">
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
            {user?.canViewCustomerBalances && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid="button-customers-tab"
                    className="shrink-0"
                  >
                    <Users className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">Customers</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 max-h-96 overflow-y-auto" align="end">
                  <div className="space-y-2">
                    <h4 className="font-semibold text-sm">Customer Balances</h4>
                    {customerBalances.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No customers with balances</p>
                    ) : (
                      <div className="space-y-1">
                        {customerBalances.filter(c => c.balance > 0).map((customer) => (
                          <div
                            key={customer.id}
                            className="flex items-center justify-between px-2 py-1.5 rounded-md bg-muted/30"
                            data-testid={`customer-balance-${customer.id}`}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">{customer.name}</div>
                              <div className="text-xs text-muted-foreground font-mono">{customer.code}</div>
                            </div>
                            <div className={`text-sm font-mono font-medium ${
                              customer.balanceSide === "Dr" 
                                ? "text-destructive" 
                                : "text-green-600 dark:text-green-400"
                            }`}>
                              {customer.balanceSide === "Dr" ? "" : "-"}${formatNumber(customer.balance)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-3 sm:p-6">
          <div className="max-w-7xl mx-auto">
            <Router user={user} />
          </div>
        </main>
      </div>
    );
  }

  // Full interface for Admin, Owner, Manager
  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
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
            <div className="max-w-7xl mx-auto">
              <Router user={user} />
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
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
