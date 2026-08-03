import { useState, useRef, Suspense } from "react";
import { useLocation } from "wouter";
import { useMainContentFocus } from "@/hooks/use-main-content-focus";
import { useWorkspaceWheelScroll } from "@/hooks/use-workspace-wheel-scroll";
import { useCompany } from "@/contexts/CompanyContext";
import { useApplicationLanguage } from "@/contexts/ApplicationLanguageContext";
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
  SidebarGroupLabel,
} from "@/components/ui/sidebar";
import { CurrencyToggle } from "@/components/CurrencyToggle";
import { CompanySelector } from "@/components/CompanySelector";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UserMenu } from "@/components/UserMenu";
import { DailyRateModal } from "@/components/DailyRateModal";
import { OfflineBanner } from "@/components/OfflineBanner";
import { PendingSyncIndicator } from "@/components/PendingSyncIndicator";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { CommandPalette } from "@/components/CommandPalette";
import { ModuleIdentity } from "@/components/navigation/module-identity";
import { Router } from "@/routes/AppRoutes";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LoadingState } from "@/components/ui/page-state";
import { SkipLink } from "@/components/ui/responsive-accessibility";
import { ArrowLeft, LogOut, Search, ShoppingCart } from "lucide-react";
import { usePosNavigationItems } from "./usePosNavigationItems";
import { canUseAdminSearch, type ShellUser } from "./shellUser";

interface PosShellProps {
  user: ShellUser;
  posImportEnabled: boolean;
  chatUnread: { count: number } | undefined;
  handleGoBack: () => void;
  handleLogout: () => void;
  leaveConfirmDialog: React.ReactNode;
}

const posWorkspaceClasses = [
  "[&_button]:touch-manipulation",
  "[&_input]:min-h-10",
  "[&_select]:min-h-10",
  "[&_textarea]:min-h-20",
  "[&_table]:min-w-max",
  "[&_th]:whitespace-nowrap",
  "[&_td]:align-middle",
  "[&_[role=dialog]]:max-w-[calc(100vw-1rem)]",
  "[&_[role=listbox]]:max-h-[min(24rem,70dvh)]",
  "[&_.tabular-nums]:font-variant-numeric-tabular-nums",
].join(" ");

export function PosShell({
  user,
  posImportEnabled,
  chatUnread,
  handleGoBack,
  handleLogout,
  leaveConfirmDialog,
}: PosShellProps) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [currentLocation] = useLocation();
  const { selectedCompany } = useCompany();
  const { t } = useApplicationLanguage();
  const posNavItems = usePosNavigationItems({ user, posImportEnabled, chatUnread });

  const posStyle = { "--sidebar-width": "14rem", "--sidebar-width-icon": "3.5rem" };
  const isPosRoute = currentLocation === "/pos" || currentLocation.startsWith("/pos/");
  const isFullHeightRoute = isPosRoute;
  const hasAdminSearch = canUseAdminSearch(user);
  const posContainerRef = useRef<HTMLDivElement>(null);
  useMainContentFocus(currentLocation, isFullHeightRoute);
  useWorkspaceWheelScroll(posContainerRef);

  return (
    <>
      <SkipLink>{t("accessibility.skipToMainContent")}</SkipLink>
      <SidebarProvider style={posStyle as React.CSSProperties}>
        <div ref={posContainerRef} className="flex h-full w-full min-w-0 overflow-hidden bg-background">
          {selectedCompany?.id && <DailyRateModal companyId={selectedCompany.id} />}
          <Sidebar className="border-r border-sidebar-border/70 bg-sidebar/95 backdrop-blur-xl">
            <SidebarHeader className="border-b border-sidebar-border/60 p-3">
              <div className="rounded-2xl border border-sidebar-border/70 bg-gradient-to-br from-primary/12 via-sidebar-accent/60 to-sidebar p-2.5 shadow-sm">
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0 rounded-xl border border-sidebar-border/60 bg-background/60 hover:bg-background"
                    onClick={handleGoBack}
                    aria-label="Go back"
                    data-testid="button-pos-back"
                  >
                    <ArrowLeft data-directional-icon="true" className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <ModuleIdentity
                    compact
                    moduleName={user.posStation ? `POS ${user.posStation}` : "POS"}
                    companyName={selectedCompany?.name}
                    icon={ShoppingCart}
                    tone="pos"
                    className="min-w-0 flex-1 border-0 bg-transparent p-0 shadow-none"
                  />
                </div>
              </div>
            </SidebarHeader>
            <SidebarContent className="px-2 py-3">
              <SidebarGroup className="p-0">
                <SidebarGroupLabel className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-sidebar-foreground/45">
                  Workspace
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu className="gap-1.5" aria-label="Point of sale navigation">
                    {posNavItems.map((item) => (
                      <SidebarMenuItem key={item.label}>
                        <SidebarMenuButton
                          isActive={item.active}
                          onClick={item.onClick}
                          aria-current={item.active ? "page" : undefined}
                          data-testid={item.testId}
                          className="group relative h-10 rounded-xl px-3 font-medium transition-all duration-200 hover:bg-sidebar-accent/80 hover:shadow-sm data-[active=true]:bg-primary data-[active=true]:text-primary-foreground data-[active=true]:shadow-md data-[active=true]:shadow-primary/20"
                        >
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sidebar-accent/70 transition-colors group-data-[active=true]:bg-primary-foreground/15">
                            <item.icon className="h-4 w-4" aria-hidden="true" />
                          </span>
                          <span className="flex-1 truncate">{item.label}</span>
                          {item.badge !== undefined && item.badge > 0 && (
                            <Badge
                              variant={item.active ? "secondary" : "default"}
                              className="min-w-5 justify-center rounded-full px-1.5 text-[10px]"
                              aria-label={`${item.badge} unread`}
                              data-testid="badge-chat-unread-pos"
                            >
                              {item.badge}
                            </Badge>
                          )}
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
            <SidebarFooter className="border-t border-sidebar-border/60 p-3">
              <div className="space-y-2 rounded-2xl border border-sidebar-border/70 bg-sidebar-accent/35 p-2.5 shadow-sm">
                <div className="flex items-center gap-2 px-1">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                    {user.username?.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div data-business-value="true" dir="auto" className="truncate text-sm font-medium text-sidebar-foreground">
                      {user.username}
                    </div>
                    <div className="truncate text-[11px] text-sidebar-foreground/55">POS user</div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1 rounded-xl bg-background/45 p-1">
                  <CurrencyToggle />
                  <CompanySelector />
                  <ThemeToggle />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto h-8 w-8 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    onClick={handleLogout}
                    aria-label="Log out"
                    data-testid="button-logout"
                  >
                    <LogOut className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </SidebarFooter>
          </Sidebar>
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <header className="no-print flex h-12 items-center justify-between gap-2 border-b p-2">
              <SidebarTrigger aria-label="Toggle point of sale navigation" data-testid="button-sidebar-toggle" />
              <div data-slot="pos-top-bar-actions" className="ml-auto flex min-w-0 items-center gap-2">
                <PendingSyncIndicator />
                {hasAdminSearch && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex items-center gap-1.5 text-muted-foreground"
                    onClick={() => setPaletteOpen(true)}
                    aria-label="Open command search"
                    data-testid="button-open-palette"
                  >
                    <Search className="h-4 w-4" aria-hidden="true" />
                    <kbd className="hidden h-5 items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] sm:inline-flex">
                      {typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform)
                        ? "⌘ /"
                        : "Ctrl /"}
                    </kbd>
                  </Button>
                )}
                <UserMenu accentColor="#2563eb" user={user} onLogout={handleLogout} />
              </div>
            </header>
            <OfflineBanner />
            <main
              id="main-content"
              tabIndex={-1}
              aria-label="Point of sale workspace"
              data-pos-workspace="true"
              className={`${posWorkspaceClasses} outline-none ${
                isFullHeightRoute
                  ? "flex-1 min-w-0 overflow-hidden overscroll-contain"
                  : "flex-1 min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain p-3 sm:p-6"
              }`}
            >
              <div className={isFullHeightRoute ? "h-full min-w-0" : "w-full min-w-0"}>
                <ErrorBoundary resetKey={currentLocation}>
                  <Suspense
                    fallback={
                      <LoadingState title="Loading point of sale" description="Preparing the latest sales workspace." />
                    }
                  >
                    <Router user={user} posImportEnabled={posImportEnabled} />
                  </Suspense>
                </ErrorBoundary>
              </div>
            </main>
          </div>
        </div>
      </SidebarProvider>
      {hasAdminSearch && <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} isPOS={true} user={user} />}
      {leaveConfirmDialog}
    </>
  );
}
