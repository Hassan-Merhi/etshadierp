import { useEffect, useCallback, useState, useRef, Suspense } from "react";
import { useButtonClickFeedback } from "@/hooks/use-button-click-feedback";
import { useDialogScrollFix } from "@/hooks/use-dialog-scroll-fix";
import { useLocation, Redirect } from "wouter";
import { getParentRoute } from "@/lib/parent-routes";
import { getQueryFn, setAppTimezone, queryClient } from "@/lib/queryClient";
import { useQuery } from "@tanstack/react-query";
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
import { CurrencyToggle } from "@/components/CurrencyToggle";
import { CompanySelector } from "@/components/CompanySelector";
import { ThemeToggle } from "@/components/ThemeToggle";
import { DailyRateModal } from "@/components/DailyRateModal";
import { AppSidebar } from "@/components/AppSidebar";
import { useCompany } from "@/contexts/CompanyContext";
import { AppModeProvider } from "@/contexts/AppModeContext";
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
  ArrowLeft,
} from "lucide-react";
import { FactorySidebar, FACTORY_NAV_SECTIONS, FACTORY_NAV_PAGES } from "@/components/FactorySidebar";
import { PropertiesSidebar } from "@/components/PropertiesSidebar";
import { OfflineBanner } from "@/components/OfflineBanner";
import { PendingSyncIndicator } from "@/components/PendingSyncIndicator";
import { usePresence } from "@/hooks/use-presence";
import { useScreenFeed } from "@/hooks/use-screen-feed";
import { useWsInvalidation } from "@/hooks/use-ws-invalidation";
import { apiRequest } from "@/lib/queryClient";
import { FactoryRoutes } from "@/components/FactoryRoutes";
import { Router } from "@/routes/AppRoutes";
import { CommandPalette } from "@/components/CommandPalette";
import { AppTopBar } from "@/components/AppTopBar";
import { KeyboardShortcutsButton } from "@/components/KeyboardShortcuts";
import { ErrorBoundary } from "@/components/ErrorBoundary";
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
import { useGlobalScrollKeys } from "@/app/useGlobalScrollKeys";
import { PropertiesRoutes } from "@/app/PropertiesRoutes";

declare global {
  interface Window {
    __escBackGuard?: () => boolean;
    __escBackConfirm?: () => void;
  }
}

export function AuthenticatedApp() {
  const { selectedCompany } = useCompany();
  usePresence(); // Track user presence
  useScreenFeed(); // Silently capture screen frames for admin Watch feature
  useWsInvalidation(); // Real-time cache invalidation via WebSocket
  useDialogScrollFix(); // Global fix: prevent Radix dialogs from leaving body frozen after close
  const [, setLocation] = useLocation();
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

  // Global arrow / page-scroll + ESC handling
  useGlobalScrollKeys(handleGoBack);

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
                  <PropertiesRoutes user={user} currentLocation={currentLocation} />
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

  // ── Route-level access guard ─────────────────────────────────────────────
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
    // Pages in VIEWABLE_BY_ALL are always accessible (read-only for non-authorized users).
    const VIEWABLE_BY_ALL = new Set(["factory/sheets-sacks"]);
    if (isRestrictedUser && requiredKey && !VIEWABLE_BY_ALL.has(requiredKey)) {
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
  // ── End route-level access guard ─────────────────────────────────────────

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
                      <FactoryRoutes
                        user={user}
                        myAccess={myAccess}
                        factoryDefaultPage={factoryDefaultPage}
                      />
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
