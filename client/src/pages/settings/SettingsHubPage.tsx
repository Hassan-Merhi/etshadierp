import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Users, Building2, Settings2, Wrench, ShoppingCart, Download,
  MessageCircle, Database, Shield, Factory, ChevronRight, Search,
  TrendingUp, AlertTriangle, Lock,
} from "lucide-react";

interface HubCategory {
  key: string;
  title: string;
  description: string;
  icon: React.ElementType;
  colorClass: string;
  iconColorClass: string;
  keywords: string[];
  firstSection: string;
  adminOnly?: boolean;
  devOnly?: boolean;
  dangerous?: boolean;
  factoryOnly?: boolean;
  nonFactory?: boolean;
  badge?: string;
}

const HUB_CATEGORIES: HubCategory[] = [
  {
    key: "users-permissions",
    title: "Users & Permissions",
    description: "Manage users, roles, module access, and page visibility controls",
    icon: Users,
    colorClass: "bg-blue-500/10",
    iconColorClass: "text-blue-500",
    adminOnly: true,
    keywords: ["users", "roles", "permissions", "access", "visibility", "password", "login", "factory access", "page"],
    firstSection: "users-permissions",
  },
  {
    key: "company",
    title: "Company & Modules",
    description: "Manage companies, preferences, fiscal periods, and currencies",
    icon: Building2,
    colorClass: "bg-indigo-500/10",
    iconColorClass: "text-indigo-500",
    keywords: ["company", "companies", "currency", "fiscal", "period", "preferences", "date format", "exchange rate"],
    firstSection: "companies",
  },
  {
    key: "accounting",
    title: "Accounting Settings",
    description: "Exchange rates, fiscal periods, and account configuration",
    icon: TrendingUp,
    colorClass: "bg-green-500/10",
    iconColorClass: "text-green-500",
    keywords: ["accounting", "exchange", "rates", "currency", "fiscal", "period", "accounts"],
    firstSection: "exchange-rates",
  },
  {
    key: "reports",
    title: "Reports & Exports",
    description: "Daily exports, stock reports, net position, and export center",
    icon: Download,
    colorClass: "bg-orange-500/10",
    iconColorClass: "text-orange-500",
    keywords: ["reports", "exports", "daily", "stock", "net", "position", "export", "accounts"],
    firstSection: "export-center",
  },
  {
    key: "notifications",
    title: "WhatsApp & Notifications",
    description: "WhatsApp exports, group settings, and automated report delivery",
    icon: MessageCircle,
    colorClass: "bg-emerald-500/10",
    iconColorClass: "text-emerald-500",
    keywords: ["whatsapp", "notifications", "groups", "alerts", "auto send", "messaging"],
    firstSection: "whatsapp-export",
  },
  {
    key: "pos",
    title: "POS Settings",
    description: "Point of sale configuration, price groups, and receipt settings",
    icon: ShoppingCart,
    colorClass: "bg-yellow-500/10",
    iconColorClass: "text-yellow-600",
    nonFactory: true,
    keywords: ["pos", "point of sale", "price", "groups", "receipt", "intercompany", "transfer"],
    firstSection: "price-groups",
  },
  {
    key: "data-tools",
    title: "Data Tools",
    description: "File storage, bulk rename, offline sync, and data management",
    icon: Database,
    colorClass: "bg-purple-500/10",
    iconColorClass: "text-purple-500",
    keywords: ["data", "files", "storage", "bulk", "rename", "offline", "sync", "backup"],
    firstSection: "files",
  },
  {
    key: "security",
    title: "Security & Audit",
    description: "Edit log, login history, and change tracking across the system",
    icon: Shield,
    colorClass: "bg-red-500/10",
    iconColorClass: "text-red-500",
    keywords: ["security", "audit", "log", "history", "login", "sessions", "changes", "edit log"],
    firstSection: "edit-log",
  },
  {
    key: "system",
    title: "System Tools",
    description: "Maintenance, repair tools, diagnostics, and advanced operations",
    icon: Wrench,
    colorClass: "bg-slate-500/10",
    iconColorClass: "text-slate-500",
    adminOnly: true,
    dangerous: true,
    keywords: ["system", "tools", "repair", "diagnostics", "maintenance", "developer", "reset", "orphaned", "fix"],
    firstSection: "system",
    badge: "Admin",
  },
];

interface SettingsHubPageProps {
  onNavigate: (section: string) => void;
  currentUser?: { role?: string };
  appMode?: string;
}

export function SettingsHubPage({ onNavigate, currentUser, appMode }: SettingsHubPageProps) {
  const [search, setSearch] = useState("");

  const role = currentUser?.role;
  const isFactory = appMode === "factory";
  const isAdmin = role === "Admin" || role === "Developer" || role === "Owner";
  const isDev = role === "Developer";

  const visibleCategories = useMemo(() => {
    return HUB_CATEGORIES.filter((cat) => {
      if (cat.devOnly && !isDev) return false;
      if (cat.nonFactory && isFactory) return false;
      if (cat.factoryOnly && !isFactory) return false;
      return true;
    });
  }, [isFactory, isDev]);

  const filteredCategories = useMemo(() => {
    if (!search.trim()) return visibleCategories;
    const q = search.toLowerCase();
    return visibleCategories.filter(
      (cat) =>
        cat.title.toLowerCase().includes(q) ||
        cat.description.toLowerCase().includes(q) ||
        cat.keywords.some((kw) => kw.toLowerCase().includes(q))
    );
  }, [search, visibleCategories]);

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold flex items-center gap-2">
            <Settings2 className="h-7 w-7" />
            Settings
          </h1>
          <p className="text-muted-foreground">
            Manage your system configuration, users, permissions, and tools.
          </p>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search settings... (users, permissions, exports, POS, factory, audit)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-settings-search"
          />
        </div>

        {filteredCategories.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Search className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No settings found</p>
            <p className="text-sm mt-1">Try a different search term</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredCategories.map((cat) => {
              const Icon = cat.icon;
              return (
                <Card
                  key={cat.key}
                  className="p-5 hover-elevate cursor-pointer transition-colors group"
                  onClick={() => onNavigate(cat.firstSection)}
                  data-testid={`card-settings-${cat.key}`}
                >
                  <div className="flex items-start gap-4">
                    <div className={`p-2.5 rounded-lg shrink-0 ${cat.colorClass}`}>
                      <Icon className={`h-5 w-5 ${cat.iconColorClass}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-sm leading-tight">{cat.title}</h3>
                        {cat.dangerous && (
                          <Badge variant="outline" className="text-xs text-destructive border-destructive/40 py-0">
                            Dangerous
                          </Badge>
                        )}
                        {cat.badge && !cat.dangerous && (
                          <Badge variant="outline" className="text-xs py-0">
                            {cat.badge}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                        {cat.description}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
