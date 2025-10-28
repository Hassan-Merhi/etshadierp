import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ThemeToggle } from "@/components/ThemeToggle";
import { CompanySelector } from "@/components/CompanySelector";
import { AppSidebar } from "@/components/AppSidebar";
import { LocationProvider } from "@/contexts/LocationContext";
import NotFound from "@/pages/not-found";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import POS from "@/pages/POS";
import Inventory from "@/pages/Inventory";
import Containers from "@/pages/Containers";
import Financial from "@/pages/Financial";
import Accounts from "@/pages/Accounts";
import Suppliers from "@/pages/Suppliers";
import Reports from "@/pages/Reports";
import AccountingCreate from "@/pages/AccountingCreate";
import POImport from "@/pages/POImport";
import ContainerDetail from "@/pages/ContainerDetail";
import LocationInventory from "@/pages/LocationInventory";

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/" component={Dashboard} />
      <Route path="/pos" component={POS} />
      <Route path="/inventory" component={Inventory} />
      <Route path="/location-inventory" component={LocationInventory} />
      <Route path="/containers" component={Containers} />
      <Route path="/containers/:id" component={ContainerDetail} />
      <Route path="/po-import" component={POImport} />
      <Route path="/financial" component={Financial} />
      <Route path="/accounts" component={Accounts} />
      <Route path="/suppliers" component={Suppliers} />
      <Route path="/reports" component={Reports} />
      <Route path="/accounting/create" component={AccountingCreate} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ThemeProvider>
          <LocationProvider>
            <SidebarProvider style={style as React.CSSProperties}>
              <div className="flex h-screen w-full">
                <AppSidebar />
                <div className="flex flex-col flex-1 overflow-hidden">
                  <header className="flex items-center justify-between p-4 border-b h-16 gap-4">
                    <SidebarTrigger data-testid="button-sidebar-toggle" />
                    <div className="flex items-center gap-2 ml-auto">
                      <CompanySelector />
                      <ThemeToggle />
                    </div>
                  </header>
                  <main className="flex-1 overflow-y-auto p-6">
                    <div className="max-w-7xl mx-auto">
                      <Router />
                    </div>
                  </main>
                </div>
              </div>
            </SidebarProvider>
            <Toaster />
          </LocationProvider>
        </ThemeProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
