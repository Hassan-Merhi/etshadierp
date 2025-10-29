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
import { LogOut, ShoppingCart, MapPin } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import NotFound from "@/pages/not-found";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import POS from "@/pages/POS";
import Inventory from "@/pages/Inventory";
import Containers from "@/pages/Containers";
import Financial from "@/pages/Financial";
import Accounts from "@/pages/Accounts";
import Suppliers from "@/pages/Suppliers";
import Vouchers from "@/pages/Vouchers";
import Daybook from "@/pages/Daybook";
import Reports from "@/pages/Reports";
import AccountingCreate from "@/pages/AccountingCreate";
import POImport from "@/pages/POImport";
import ContainerDetail from "@/pages/ContainerDetail";
import LocationInventory from "@/pages/LocationInventory";
import Settings from "@/pages/Settings";
import BalanceSheet from "@/pages/BalanceSheet";
import ProfitLoss from "@/pages/ProfitLoss";
import { useEffect } from "react";

function Router({ user }: { user: any }) {
  const isPOS = user?.role?.startsWith("POS");
  const [, navigate] = useLocation();
  
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
        <Route>{() => <POS posUser={user} />}</Route>
      </Switch>
    );
  }

  // All other users see full interface
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/pos">{() => <POS />}</Route>
      <Route path="/inventory" component={Inventory} />
      <Route path="/location-inventory">{() => <LocationInventory />}</Route>
      <Route path="/containers" component={Containers} />
      <Route path="/containers/:id" component={ContainerDetail} />
      <Route path="/po-import" component={POImport} />
      <Route path="/financial" component={Financial} />
      <Route path="/accounts" component={Accounts} />
      <Route path="/suppliers" component={Suppliers} />
      <Route path="/vouchers" component={Vouchers} />
      <Route path="/daybook">{() => <Daybook user={user} />}</Route>
      <Route path="/reports" component={Reports} />
      <Route path="/balance-sheet" component={BalanceSheet} />
      <Route path="/profit-loss" component={ProfitLoss} />
      <Route path="/create" component={AccountingCreate} />
      {user?.role === "Admin" && <Route path="/settings" component={Settings} />}
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
              variant={isOnInventory ? "default" : "ghost"}
              size="sm"
              onClick={() => setLocation("/location-inventory")}
              data-testid="button-inventory-tab"
            >
              <MapPin className="h-4 w-4 mr-2" />
              Location Inventory
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
