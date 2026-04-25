import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  LayoutDashboard,
  Package,
  MapPin,
  Truck,
  Archive,
  Search,
  BookOpen,
  Building2,
  Users,
  FileText,
  Calendar,
  DollarSign,
  ShoppingCart,
  TrendingUp,
  BarChart2,
  MessageSquare,
  Settings,
  Bot,
  Trash2,
  Link,
  Wrench,
  PieChart,
  AlertTriangle,
  Factory,
  Layers,
  Box,
  Receipt,
  Target,
  Activity,
  BarChart,
  Brain,
  Package2,
} from "lucide-react";

interface CommandPaletteProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  isPOS?: boolean;
  hasErpAccess?: boolean;
  hasFactoryAccess?: boolean;
  isAdminOwner?: boolean;
  hasDashboardAccess?: boolean;
}

interface PageEntry {
  label: string;
  description?: string;
  path: string;
  icon: React.ElementType;
}

const erpPages: PageEntry[] = [
  { label: "Container Dashboard", description: "Track containers and shipments", path: "/", icon: LayoutDashboard },
  { label: "Financial Overview", description: "Dashboard with key financial metrics", path: "/financial-overview", icon: BarChart2 },
  { label: "Containers", description: "Manage all containers", path: "/containers", icon: Package },
  { label: "Location Inventory", description: "Stock levels by location", path: "/location-inventory", icon: MapPin },
  { label: "Stock OTW", description: "On-the-way stock tracking", path: "/stock-otw", icon: Truck },
  { label: "Stock Items", description: "Manage all stock items", path: "/stock-items", icon: Archive },
  { label: "Stock Query", description: "Search and query stock", path: "/stock-query", icon: Search },
  { label: "Accounts", description: "Chart of accounts and ledgers", path: "/accounts", icon: BookOpen },
  { label: "Suppliers", description: "Supplier management", path: "/suppliers", icon: Building2 },
  { label: "Customers", description: "Customer accounts", path: "/customers", icon: Users },
  { label: "Vouchers", description: "Payment, receipt and journal vouchers", path: "/vouchers", icon: FileText },
  { label: "Daybook", description: "Daily transaction log", path: "/daybook", icon: Calendar },
  { label: "Payroll", description: "Employee payroll management", path: "/payroll", icon: DollarSign },
  { label: "POS", description: "Point of sale", path: "/pos", icon: ShoppingCart },
  { label: "POS Daybook", description: "Point of sale daily log", path: "/pos-daybook", icon: Calendar },
  { label: "Sales Report", description: "Sales analytics and reports", path: "/sales-report", icon: TrendingUp },
  { label: "Analytics", description: "Business analytics", path: "/analytics", icon: BarChart2 },
  { label: "Chat", description: "Internal messaging", path: "/chat", icon: MessageSquare },
];

const factoryPages: PageEntry[] = [
  { label: "Factory Dashboard", description: "Intelligence overview", path: "/factory/dashboard", icon: LayoutDashboard },
  { label: "Stock Entry", description: "Enter bale stock", path: "/factory/stock-entry", icon: Package2 },
  { label: "Bales Hub", description: "Manage all bales", path: "/factory/bales-hub", icon: Package },
  { label: "Raw Materials", description: "Raw material inventory", path: "/factory/raw-materials", icon: Layers },
  { label: "Bale Products", description: "Finished bale products", path: "/factory/bale-products", icon: Box },
  { label: "Factory Customers", description: "Customer accounts", path: "/factory/customers", icon: Users },
  { label: "Sales Loadings", description: "Container loading management", path: "/factory/sales/loadings", icon: Truck },
  { label: "Invoicing", description: "Proformas, pending and finalized invoices", path: "/factory/invoicing", icon: FileText },
  { label: "Factory Vouchers", description: "Accounting vouchers", path: "/factory/vouchers", icon: FileText },
  { label: "Factory Accounts", description: "Chart of accounts", path: "/factory/accounts", icon: BookOpen },
  { label: "Factory Daybook", description: "Daily transaction log", path: "/factory/daybook", icon: Calendar },
  { label: "Location Inventory", description: "Stock levels by location", path: "/factory/location-inventory", icon: MapPin },
  { label: "Factory Stock OTW", description: "Factory containers on the way", path: "/factory/stock-otw", icon: Truck },
  { label: "Bale Relabeling", description: "Relabel and reassign bales", path: "/factory/bale-relabeling", icon: Archive },
  { label: "Workers", description: "Worker and payroll management", path: "/factory/workers", icon: Users },
  { label: "Employees", description: "Employee records and details", path: "/factory/employees", icon: Users },
  { label: "Supplier Report", description: "Supplier performance report", path: "/factory/supplier-report", icon: BarChart },
  { label: "Supplier Statement", description: "Supplier account statement", path: "/factory/supplier-statement", icon: FileText },
  { label: "Production Summary", description: "Production output summary", path: "/factory/production-summary", icon: Factory },
  { label: "Factory Analytics", description: "Factory analytics", path: "/factory/analytics", icon: BarChart2 },
  { label: "Intelligence Dashboard", description: "KPIs and insights", path: "/factory/intelligence/dashboard", icon: Brain },
  { label: "KPIs", description: "Key performance indicators", path: "/factory/intelligence/kpis", icon: Target },
  { label: "Profitability", description: "Profitability analysis", path: "/factory/intelligence/profitability", icon: TrendingUp },
  { label: "Waste Analysis", description: "Production waste tracking", path: "/factory/intelligence/waste", icon: Trash2 },
  { label: "Cashflow", description: "Cashflow intelligence", path: "/factory/intelligence/cashflow", icon: Activity },
  { label: "Factory Chat", description: "Internal messaging", path: "/factory/chat", icon: MessageSquare },
];

const adminPages: PageEntry[] = [
  { label: "Settings", description: "App configuration and system tools", path: "/settings", icon: Settings },
  { label: "Chatbot Settings", description: "AI assistant configuration", path: "/chatbot-settings", icon: Bot },
  { label: "Deleted Items", description: "View and restore deleted records", path: "/deleted-items", icon: Trash2 },
  { label: "Orphaned Records", description: "Records with missing references", path: "/orphaned-records", icon: Link },
  { label: "Inventory Repair", description: "Fix inventory discrepancies", path: "/inventory-repair", icon: Wrench },
  { label: "Net Position Details", description: "Detailed net position breakdown (assets vs liabilities)", path: "/net-position-details", icon: PieChart },
  { label: "Import Cycle Diagnostics", description: "Diagnose import cycle issues", path: "/import-cycle-diagnostics", icon: AlertTriangle },
];

const posPages: PageEntry[] = [
  { label: "Point of Sale", description: "POS interface", path: "/", icon: ShoppingCart },
  { label: "POS Daybook", description: "Daily POS log", path: "/pos-daybook", icon: Calendar },
  { label: "Location Inventory", description: "Stock levels by location", path: "/location-inventory", icon: MapPin },
  { label: "Chat", description: "Internal messaging", path: "/pos-chat", icon: MessageSquare },
];

export function CommandPalette({
  open: externalOpen,
  onOpenChange: externalOnOpenChange,
  isPOS = false,
  hasErpAccess = true,
  hasFactoryAccess = false,
  isAdminOwner = false,
  hasDashboardAccess = false,
}: CommandPaletteProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [, setLocation] = useLocation();

  const isControlled = externalOpen !== undefined;
  const open = isControlled ? externalOpen : internalOpen;
  const setOpen = useCallback(
    (value: boolean) => {
      if (!isControlled) setInternalOpen(value);
      externalOnOpenChange?.(value);
    },
    [isControlled, externalOnOpenChange]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(!open);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, setOpen]);

  const navigate = useCallback(
    (path: string) => {
      setOpen(false);
      setLocation(path);
    },
    [setOpen, setLocation]
  );

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search pages..." data-testid="input-command-palette" />
      <CommandList className="max-h-[420px]">
        <CommandEmpty>No pages found.</CommandEmpty>

        {isPOS && (
          <CommandGroup heading="POS">
            {posPages.map((page) => (
              <CommandItem
                key={page.path}
                value={`${page.label} ${page.description ?? ""}`}
                onSelect={() => navigate(page.path)}
                data-testid={`command-item-${page.path.replace(/\//g, "-").replace(/^-/, "")}`}
              >
                <page.icon className="mr-2 h-4 w-4 text-muted-foreground" />
                <div className="flex flex-col">
                  <span>{page.label}</span>
                  {page.description && (
                    <span className="text-xs text-muted-foreground">{page.description}</span>
                  )}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {!isPOS && hasErpAccess && (
          <CommandGroup heading="ERP">
            {erpPages.map((page) => (
              <CommandItem
                key={page.path}
                value={`${page.label} ${page.description ?? ""}`}
                onSelect={() => navigate(page.path)}
                data-testid={`command-item-${page.path.replace(/\//g, "-").replace(/^-/, "") || "home"}`}
              >
                <page.icon className="mr-2 h-4 w-4 text-muted-foreground" />
                <div className="flex flex-col">
                  <span>{page.label}</span>
                  {page.description && (
                    <span className="text-xs text-muted-foreground">{page.description}</span>
                  )}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {!isPOS && hasErpAccess && hasFactoryAccess && <CommandSeparator />}

        {!isPOS && hasFactoryAccess && (
          <CommandGroup heading="Factory">
            {factoryPages
              .filter((p) => p.path !== "/factory/dashboard" || hasDashboardAccess)
              .map((page) => (
                <CommandItem
                  key={page.path}
                  value={`${page.label} ${page.description ?? ""}`}
                  onSelect={() => navigate(page.path)}
                  data-testid={`command-item-${page.path.replace(/\//g, "-").replace(/^-/, "")}`}
                >
                  <page.icon className="mr-2 h-4 w-4 text-muted-foreground" />
                  <div className="flex flex-col">
                    <span>{page.label}</span>
                    {page.description && (
                      <span className="text-xs text-muted-foreground">{page.description}</span>
                    )}
                  </div>
                </CommandItem>
              ))}
          </CommandGroup>
        )}

        {!isPOS && isAdminOwner && <CommandSeparator />}

        {!isPOS && isAdminOwner && (
          <CommandGroup heading="Admin & Settings">
            {adminPages.map((page) => (
              <CommandItem
                key={page.path}
                value={`${page.label} ${page.description ?? ""}`}
                onSelect={() => navigate(page.path)}
                data-testid={`command-item-${page.path.replace(/\//g, "-").replace(/^-/, "")}`}
              >
                <page.icon className="mr-2 h-4 w-4 text-muted-foreground" />
                <div className="flex flex-col">
                  <span>{page.label}</span>
                  {page.description && (
                    <span className="text-xs text-muted-foreground">{page.description}</span>
                  )}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
