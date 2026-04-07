import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useCompany } from "@/contexts/CompanyContext";
import { useQuery } from "@tanstack/react-query";
import {
  Landmark,
  FileText,
  TrendingUp,
  BookOpen,
  Building2,
  ArrowRight,
} from "lucide-react";

export default function PropertiesDashboard() {
  const [, setLocation] = useLocation();
  const { selectedCompany } = useCompany();

  const { data: voucherStats } = useQuery<any[]>({
    queryKey: ["/api/vouchers"],
    select: (data) => data,
  });

  const { data: accounts } = useQuery<any[]>({
    queryKey: ["/api/ledger-accounts"],
    select: (data) => data,
  });

  const recentVouchers = voucherStats?.slice(0, 5) ?? [];

  const tiles = [
    {
      title: "Accounts",
      description: "Manage your chart of accounts and ledger",
      icon: Landmark,
      href: "/properties/accounts",
      color: "text-indigo-600",
      bg: "bg-indigo-50 dark:bg-indigo-950/30",
      stat: accounts?.length ?? null,
      statLabel: "accounts",
    },
    {
      title: "Vouchers",
      description: "View and create accounting vouchers",
      icon: FileText,
      href: "/properties/vouchers",
      color: "text-violet-600",
      bg: "bg-violet-50 dark:bg-violet-950/30",
      stat: voucherStats?.length ?? null,
      statLabel: "total",
    },
    {
      title: "Daybook",
      description: "Daily transaction journal and summary",
      icon: BookOpen,
      href: "/properties/daybook",
      color: "text-blue-600",
      bg: "bg-blue-50 dark:bg-blue-950/30",
      stat: null,
      statLabel: "",
    },
    {
      title: "Analytics",
      description: "Financial reports and performance insights",
      icon: TrendingUp,
      href: "/properties/analytics",
      color: "text-emerald-600",
      bg: "bg-emerald-50 dark:bg-emerald-950/30",
      stat: null,
      statLabel: "",
    },
  ];

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-indigo-600 text-white">
          <Building2 className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-dashboard-title">
            {selectedCompany?.name ?? "Properties"}
          </h1>
          <p className="text-sm text-muted-foreground">Properties Management Dashboard</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {tiles.map((tile) => (
          <Card
            key={tile.title}
            className="cursor-pointer hover-elevate"
            onClick={() => setLocation(tile.href)}
            data-testid={`card-tile-${tile.title.toLowerCase()}`}
          >
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{tile.title}</CardTitle>
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${tile.bg}`}>
                <tile.icon className={`h-4 w-4 ${tile.color}`} />
              </div>
            </CardHeader>
            <CardContent>
              {tile.stat !== null ? (
                <div className="flex items-baseline gap-1.5 mb-1">
                  <span className="text-2xl font-bold" data-testid={`text-stat-${tile.title.toLowerCase()}`}>{tile.stat}</span>
                  <span className="text-xs text-muted-foreground">{tile.statLabel}</span>
                </div>
              ) : (
                <div className="h-8" />
              )}
              <p className="text-xs text-muted-foreground">{tile.description}</p>
              <div className="flex items-center gap-1 mt-3 text-xs font-medium" style={{ color: "var(--color-indigo-600)" }}>
                <span className={tile.color}>Open</span>
                <ArrowRight className={`h-3 w-3 ${tile.color}`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {recentVouchers.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Recent Vouchers</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {recentVouchers.map((v: any) => (
                <div
                  key={v.id}
                  className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0"
                  data-testid={`row-recent-voucher-${v.id}`}
                >
                  <div>
                    <span className="text-sm font-medium font-mono">{v.voucherNumber}</span>
                    <span className="text-xs text-muted-foreground ml-2">{v.voucherType}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">{v.voucherDate}</div>
                </div>
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 w-full text-xs"
              onClick={() => setLocation("/properties/vouchers")}
              data-testid="button-view-all-vouchers"
            >
              View all vouchers
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
