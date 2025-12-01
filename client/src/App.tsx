import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ThemeToggle } from "@/components/ThemeToggle";
import { CompanySelector } from "@/components/CompanySelector";
import { AppSidebar } from "@/components/AppSidebar";
import { LocationProvider } from "@/contexts/LocationContext";
import { CompanyProvider } from "@/contexts/CompanyContext";
import { Button } from "@/components/ui/button";
import { LogOut, ShoppingCart, MapPin, BookOpen, Package } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import NotFound from "@/pages/not-found";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
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
import PurchaseOrderEdit from "@/pages/PurchaseOrderEdit";
import StockItemHistory from "@/pages/StockItemHistory";
import StockItemVouchers from "@/pages/StockItemVouchers";
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
        <Route path="/location-inventory">{() => <LocationInventory posUser={user} />}</Route>
        <Route path="/pos-daybook" component={POSDaybook} />
        <Route path="/vouchers">{() => <Vouchers posUser={user} />}</Route>
        <Route>{() => <POS posUser={user} />}</Route>
      </Switch>
    );
  }

  // All other users see full interface
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/pos">{() => <POS />}</Route>
      <Route path="/pos/edit/:id">{(params) => <POS editVoucherId={params.id} />}</Route>
      <Route path="/stock-items" component={StockItems} />
      <Route path="/location-inventory">{() => <LocationInventory />}</Route>
      <Route path="/containers" component={Containers} />
      <Route path="/containers/:id" component={ContainerDetail} />
      <Route path="/sold-containers" component={SoldContainers} />
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
      <Route path="/stock-items/:id/history" component={StockItemHistory} />
      <Route path="/stock-items/:id/history/:year/:month" component={StockItemVouchers} />
      <Route path="/sales-report" component={SalesReport} />
      <Route path="/pos-daybook" component={POSDaybook} />
      <Route path="/suppliers/:id/edit" component={EditSupplier} />
      <Route path="/bales" component={Bales} />
      <Route path="/mix-batches" component={MixBatches} />
      <Route path="/production-bales" component={ProductionBales} />
      <Route path="/bale-products" component={BaleProducts} />
      {user?.role === "Admin" && <Route path="/settings" component={Settings} />}
      {user?.role === "Admin" && <Route path="/orphaned-records" component={OrphanedRecords} />}
      <Route component={NotFound} />
    </Switch>
  );
}

function AuthenticatedApp() {
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

  // POS users get a simplified interface without sidebar
  if (isPOS) {
    const isOnPOS = currentLocation === "/";
    const isOnInventory = currentLocation === "/location-inventory";
    const isOnDaybook = currentLocation === "/pos-daybook";
    
    return (
      <div className="flex flex-col h-screen w-full">
        <header className="flex flex-col border-b">
          <div className="flex items-center justify-between p-4 h-16 gap-4">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold">POS Station {user.posStation || ""}</h1>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-sm text-muted-foreground">{user.username}</span>
              <Button variant="ghost" size="sm" onClick={handleLogout} data-testid="button-logout">
                <LogOut className="h-4 w-4" />
              </Button>
              <ThemeToggle />
            </div>
          </div>
          <div className="flex items-center gap-2 px-4 pb-2">
            <Button
              variant={isOnPOS ? "default" : "ghost"}
              size="sm"
              onClick={() => setLocation("/")}
              data-testid="button-pos-tab"
            >
              <ShoppingCart className="h-4 w-4 mr-2" />
              Point of Sale
            </Button>
            <Button
              variant={isOnDaybook ? "default" : "ghost"}
              size="sm"
              onClick={() => setLocation("/pos-daybook")}
              data-testid="button-daybook-tab"
            >
              <BookOpen className="h-4 w-4 mr-2" />
              Daybook
            </Button>
            <Button
              variant={isOnInventory ? "default" : "ghost"}
              size="sm"
              onClick={() => setLocation("/location-inventory")}
              data-testid="button-inventory-tab"
            >
              <MapPin className="h-4 w-4 mr-2" />
              Location Inventory
            </Button>
            <Button
              variant={currentLocation.startsWith("/vouchers") ? "default" : "ghost"}
              size="sm"
              onClick={() => setLocation("/vouchers?tab=transfer")}
              data-testid="button-stock-transfer-tab"
            >
              <Package className="h-4 w-4 mr-2" />
              Stock Transfer
            </Button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6">
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
          <header className="flex items-center justify-between p-4 border-b h-16 gap-4">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-sm text-muted-foreground">{user.username} ({user.role})</span>
              <Button variant="ghost" size="sm" onClick={handleLogout} data-testid="button-logout">
                <LogOut className="h-4 w-4" />
              </Button>
              <CompanySelector />
              <ThemeToggle />
            </div>
          </header>
          <main className="flex-1 overflow-y-auto p-6">
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
              <Switch>
                <Route path="/login" component={Login} />
                <Route>
                  <AuthenticatedApp />
                </Route>
              </Switch>
              <Toaster />
            </LocationProvider>
          </CompanyProvider>
        </ThemeProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
