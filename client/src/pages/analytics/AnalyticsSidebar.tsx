import { LucideIcon } from "lucide-react";
import { 
  Package, 
  FileText, 
  Wallet, 
  Landmark, 
  TrendingDown, 
  DollarSign, 
  ShoppingCart, 
  Container as ContainerIcon,
  BarChart3
} from "lucide-react";
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";

export interface AnalyticsSidebarItem {
  key: string;
  label: string;
  icon: LucideIcon;
}

export interface AnalyticsSidebarGroup {
  label: string;
  items: AnalyticsSidebarItem[];
}

export const sidebarGroups: AnalyticsSidebarGroup[] = [
  {
    label: "Account Balances",
    items: [
      { key: "assets", label: "Assets", icon: Package },
      { key: "liabilities", label: "Liabilities", icon: FileText },
      { key: "cash", label: "Cash", icon: Wallet },
      { key: "loans-banks", label: "Loans / Banks", icon: Landmark },
    ],
  },
  {
    label: "Expenses",
    items: [
      { key: "expenses", label: "All Expenses", icon: TrendingDown },
      { key: "direct-expenses", label: "Direct Expenses", icon: DollarSign },
      { key: "indirect-expenses", label: "Indirect Expenses", icon: FileText },
    ],
  },
  {
    label: "Sales & Stock",
    items: [
      { key: "sales", label: "Sales Analytics", icon: ShoppingCart },
      { key: "stock", label: "Stock Movement", icon: Package },
      { key: "opening-stock", label: "Opening Stock", icon: FileText },
      { key: "containers", label: "Container Report", icon: ContainerIcon },
    ],
  },
  {
    label: "Financial Statements",
    items: [
      { key: "reports", label: "P&L Statement", icon: BarChart3 },
    ],
  },
];

interface AnalyticsSidebarProps {
  activeSection: string;
  setActiveSection: (section: string) => void;
}

export function AnalyticsSidebar({ activeSection, setActiveSection }: AnalyticsSidebarProps) {
  return (
    <>
      {sidebarGroups.map((group) => (
        <SidebarGroup key={group.label}>
          <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map((item) => (
                <SidebarMenuItem key={item.key}>
                  <SidebarMenuButton
                    onClick={() => setActiveSection(item.key)}
                    isActive={activeSection === item.key}
                    data-testid={`button-nav-${item.key}`}
                  >
                    <item.icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  );
}
