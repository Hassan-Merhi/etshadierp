import { useLocation, Link } from "wouter";
import {
  Sidebar, SidebarContent, SidebarHeader, SidebarFooter,
  SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
} from "@/components/ui/sidebar";
import { Package, Truck, ShoppingBag, BarChart3, Settings2, LogOut, Handshake } from "lucide-react";
import { Button } from "@/components/ui/button";

const NAV_ITEMS = [
  { href: "/sp/containers",  label: "Containers",  icon: Package,     testId: "link-sp-containers" },
  { href: "/sp/sales",       label: "Sales",        icon: ShoppingBag, testId: "link-sp-sales" },
  { href: "/sp/reports",     label: "Reports",      icon: BarChart3,   testId: "link-sp-reports" },
  { href: "/sp/setup",       label: "Setup",        icon: Settings2,   testId: "link-sp-setup" },
];

export function SpSidebar({ user, onLogout }: { user?: any; onLogout?: () => void }) {
  const [currentLocation] = useLocation();

  return (
    <Sidebar>
      <SidebarHeader className="px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-md bg-purple-600/10">
            <Handshake className="h-4 w-4 text-purple-600" />
          </div>
          <div>
            <p className="text-sm font-semibold leading-none">Supplier Partner</p>
            <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-32">{user?.username || ""}</p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2 py-2">
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs text-muted-foreground/70 px-2 mb-1">Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={currentLocation.startsWith(item.href)}>
                    <Link href={item.href} data-testid={item.testId}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="px-2 py-2 border-t">
        {onLogout && (
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={onLogout} data-testid="button-sp-logout">
            <LogOut className="h-4 w-4 mr-2" />
            Logout
          </Button>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
