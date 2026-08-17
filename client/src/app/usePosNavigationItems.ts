import type { ComponentType } from "react";
import { useLocation } from "wouter";
import {
  ShoppingCart,
  Ship,
  MapPin,
  BookOpen,
  Package,
  Users,
  Upload,
  MessageSquare,
  Cog,
  Tag,
  ClipboardList,
} from "lucide-react";

export interface PosNavItem {
  label: string;
  icon: ComponentType<{ className?: string }>;
  active: boolean;
  testId: string;
  onClick: () => void;
  badge?: number;
}

interface PosNavigationUser {
  canAccessCustomers?: boolean;
  role?: string | null;
}

interface UsePosNavigationItemsParams {
  user: PosNavigationUser;
  posImportEnabled: boolean;
  chatUnread: { count: number } | undefined;
}

/**
 * Builds the ordered list of POS sidebar navigation items.
 * Reads the current location internally via useLocation().
 */
export function usePosNavigationItems({
  user,
  posImportEnabled,
  chatUnread,
}: UsePosNavigationItemsParams): PosNavItem[] {
  const [currentLocation, setLocation] = useLocation();

  const isOnContainers = currentLocation === "/" || currentLocation.startsWith("/pos-containers");
  const isOnPOS = currentLocation === "/pos" || currentLocation === "/pos/" || currentLocation.startsWith("/pos/edit/");
  const isOnInventory = currentLocation === "/location-inventory";
  const isOnDaybook = currentLocation === "/pos-daybook";
  const isOnImport = currentLocation === "/pos-import";
  const isOnCustomers = currentLocation === "/pos-customers";
  const isOnTransfer = currentLocation.startsWith("/vouchers");
  const isOnChat = currentLocation === "/pos-chat";
  const isOnSettings = currentLocation === "/pos-settings";
  const isOnPriceList = currentLocation === "/pos-price-list";
  const isOnTransferOrders = currentLocation === "/pos-transfer-orders";

  const items: PosNavItem[] = [
    {
      label: "Containers OTW",
      icon: Ship,
      active: isOnContainers,
      testId: "button-pos-containers-tab",
      onClick: () => setLocation("/pos-containers"),
    },
    {
      label: "Point of Sale",
      icon: ShoppingCart,
      active: isOnPOS,
      testId: "button-pos-tab",
      onClick: () => setLocation("/pos"),
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
    ...(user?.canAccessCustomers
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
    ...(user?.role === "Developer"
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

  return items;
}
