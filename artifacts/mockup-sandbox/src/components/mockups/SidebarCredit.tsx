import {
  LayoutDashboard,
  Package,
  FileText,
  Settings,
  Users,
  BarChart3,
  ShoppingCart,
  Receipt,
  ArrowLeftRight,
  ChevronRight,
} from "lucide-react";

const navItems = [
  { icon: LayoutDashboard, label: "Dashboard", active: true },
  { icon: Package, label: "Inventory", active: false },
  { icon: ShoppingCart, label: "Purchase Orders", active: false },
  { icon: ArrowLeftRight, label: "Stock Transfers", active: false },
  { icon: Receipt, label: "Vouchers", active: false },
  { icon: Users, label: "Customers", active: false },
  { icon: FileText, label: "Reports", active: false },
  { icon: BarChart3, label: "Analytics", active: false },
  { icon: Settings, label: "Settings", active: false },
];

function Sidebar() {
  return (
    <div className="flex flex-col h-full w-[220px] shrink-0 border-r bg-sidebar text-sidebar-foreground">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-4 border-b">
        <div className="h-7 w-7 rounded-md bg-primary flex items-center justify-center shrink-0">
          <span className="text-[10px] font-bold text-primary-foreground">ERP</span>
        </div>
        <div>
          <p className="text-xs font-semibold leading-tight">HMD International</p>
          <p className="text-[10px] text-muted-foreground leading-tight">Warehouse</p>
        </div>
      </div>

      {/* Nav */}
      <div className="flex-1 overflow-auto py-2 px-2 space-y-0.5">
        {navItems.map((item) => (
          <button
            key={item.label}
            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-xs font-medium transition-colors ${
              item.active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
            }`}
          >
            <item.icon className="h-3.5 w-3.5 shrink-0" />
            <span>{item.label}</span>
            {item.active && <ChevronRight className="h-3 w-3 ml-auto opacity-50" />}
          </button>
        ))}
      </div>

      {/* Footer — the credit */}
      <div className="px-3 py-3 border-t">
        <p className="text-[10px] text-muted-foreground/50 font-medium tracking-wide">
          Made by Hassan Merhi Dakik
        </p>
      </div>
    </div>
  );
}

function MainContent() {
  return (
    <div className="flex-1 flex flex-col bg-background">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-5 py-3 border-b">
        <div className="h-5 w-5 rounded bg-muted" />
        <div className="h-4 w-24 rounded bg-muted" />
        <div className="ml-auto flex gap-2">
          <div className="h-7 w-20 rounded-md bg-muted" />
          <div className="h-7 w-7 rounded-full bg-muted" />
        </div>
      </div>
      {/* Content skeleton */}
      <div className="flex-1 p-5 space-y-4">
        <div className="h-5 w-36 rounded bg-muted" />
        <div className="grid grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-lg border bg-card p-4 space-y-2">
              <div className="h-3 w-16 rounded bg-muted" />
              <div className="h-6 w-24 rounded bg-muted" />
              <div className="h-3 w-12 rounded bg-muted/60" />
            </div>
          ))}
        </div>
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <div className="h-4 w-24 rounded bg-muted" />
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex gap-3 items-center">
              <div className="h-3 w-3/4 rounded bg-muted/60" />
              <div className="h-3 w-1/4 rounded bg-muted/40" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function SidebarCredit() {
  return (
    <div className="flex h-screen w-full overflow-hidden font-sans">
      <Sidebar />
      <MainContent />
    </div>
  );
}
