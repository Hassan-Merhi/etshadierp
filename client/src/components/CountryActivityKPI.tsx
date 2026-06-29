import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  Container,
  ShoppingCart,
  Globe,
  Loader2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface DayEntry {
  date: string;
  offloads: number;
  purchases: number;
}

interface CompanyActivity {
  id: number;
  name: string;
  code: string;
  totalOffloads: number;
  totalPurchases: number;
  days: DayEntry[];
}

interface ActivityResponse {
  companies: CompanyActivity[];
  days: number;
  dateSeries: string[];
}

const DAY_OPTIONS = [
  { label: "Last 7 days", value: "7" },
  { label: "Last 14 days", value: "14" },
  { label: "Last 30 days", value: "30" },
];

function formatDay(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDayShort(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function isToday(dateStr: string) {
  const today = new Date();
  return dateStr === today.toISOString().substring(0, 10);
}

// ── Day grid for one company ─────────────────────────────────────────────────
function CompanyDayGrid({
  days,
  dateRange,
}: {
  days: DayEntry[];
  dateRange: number;
}) {
  const visibleDays = days.slice(0, dateRange);
  const hasSomeActivity = visibleDays.some((d) => d.offloads > 0 || d.purchases > 0);

  if (!hasSomeActivity) {
    return (
      <p className="text-xs text-muted-foreground py-2 pl-1">
        No activity in this period.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs min-w-[360px]">
        <thead>
          <tr className="text-muted-foreground border-b">
            <th className="text-left font-medium py-1.5 pr-4 w-28">Date</th>
            <th className="text-center font-medium py-1.5 px-3">
              <span className="flex items-center justify-center gap-1">
                <Container className="h-3 w-3" /> Offloads
              </span>
            </th>
            <th className="text-center font-medium py-1.5 px-3">
              <span className="flex items-center justify-center gap-1">
                <ShoppingCart className="h-3 w-3" /> Purchases
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {visibleDays
            .filter((d) => d.offloads > 0 || d.purchases > 0)
            .map((d) => (
              <tr
                key={d.date}
                className={cn(
                  "border-b last:border-0",
                  isToday(d.date) && "bg-primary/5"
                )}
                data-testid={`row-activity-day-${d.date}`}
              >
                <td className="py-1.5 pr-4 text-muted-foreground whitespace-nowrap">
                  {formatDayShort(d.date)}
                  {isToday(d.date) && (
                    <span className="ml-1 text-primary font-semibold">·</span>
                  )}
                </td>
                <td className="py-1.5 px-3 text-center">
                  {d.offloads > 0 ? (
                    <span className="font-semibold text-foreground">{d.offloads}</span>
                  ) : (
                    <span className="text-muted-foreground/50">—</span>
                  )}
                </td>
                <td className="py-1.5 px-3 text-center">
                  {d.purchases > 0 ? (
                    <span className="font-semibold text-foreground">{d.purchases}</span>
                  ) : (
                    <span className="text-muted-foreground/50">—</span>
                  )}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Single company row ───────────────────────────────────────────────────────
function CompanyRow({
  company,
  dateRange,
}: {
  company: CompanyActivity;
  dateRange: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasActivity = company.totalOffloads > 0 || company.totalPurchases > 0;

  return (
    <div className="border-b last:border-0">
      <button
        className={cn(
          "w-full flex items-center gap-3 py-2.5 px-3 text-sm text-left transition-colors",
          "hover-elevate rounded-md",
          !hasActivity && "opacity-60"
        )}
        onClick={() => setExpanded((v) => !v)}
        data-testid={`button-country-expand-${company.id}`}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}

        <span className="font-medium flex-1 truncate">{company.name}</span>
        <span className="text-xs text-muted-foreground font-mono shrink-0 mr-2">
          {company.code}
        </span>

        <div className="flex items-center gap-2 shrink-0">
          {company.totalOffloads > 0 && (
            <Badge
              variant="secondary"
              className="gap-1 text-xs font-mono"
              data-testid={`badge-offloads-${company.id}`}
            >
              <Container className="h-2.5 w-2.5" />
              {company.totalOffloads}
            </Badge>
          )}
          {company.totalPurchases > 0 && (
            <Badge
              variant="secondary"
              className="gap-1 text-xs font-mono"
              data-testid={`badge-purchases-${company.id}`}
            >
              <ShoppingCart className="h-2.5 w-2.5" />
              {company.totalPurchases}
            </Badge>
          )}
          {!hasActivity && (
            <span className="text-xs text-muted-foreground">No activity</span>
          )}
        </div>
      </button>

      {expanded && (
        <div className="pl-8 pr-3 pb-3">
          <CompanyDayGrid days={company.days} dateRange={dateRange} />
        </div>
      )}
    </div>
  );
}

// ── Main exported component ──────────────────────────────────────────────────
export function CountryActivityKPI() {
  const [days, setDays] = useState("14");
  const [expanded, setExpanded] = useState(false);

  const { data, isLoading } = useQuery<ActivityResponse>({
    queryKey: ["/api/stats/country-activity", days],
    queryFn: async () => {
      const res = await fetch(`/api/stats/country-activity?days=${days}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 60_000,
  });

  const summary = useMemo(() => {
    if (!data) return { totalOffloads: 0, totalPurchases: 0, activeCompanies: 0 };
    return data.companies.reduce(
      (acc, c) => ({
        totalOffloads: acc.totalOffloads + c.totalOffloads,
        totalPurchases: acc.totalPurchases + c.totalPurchases,
        activeCompanies:
          acc.activeCompanies + (c.totalOffloads > 0 || c.totalPurchases > 0 ? 1 : 0),
      }),
      { totalOffloads: 0, totalPurchases: 0, activeCompanies: 0 }
    );
  }, [data]);

  return (
    <Card className="overflow-hidden">
      {/* Header row — always visible */}
      <button
        className="w-full flex flex-wrap items-center gap-3 p-4 text-left hover-elevate"
        onClick={() => setExpanded((v) => !v)}
        data-testid="button-country-activity-expand"
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="h-7 w-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
            <Globe className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-none">Activity by Country</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Offloaded containers &amp; purchases per day
            </p>
          </div>
        </div>

        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            {summary.totalOffloads > 0 && (
              <Badge variant="secondary" className="gap-1 text-xs" data-testid="badge-total-offloads">
                <Container className="h-3 w-3" />
                {summary.totalOffloads} offloaded
              </Badge>
            )}
            {summary.totalPurchases > 0 && (
              <Badge variant="secondary" className="gap-1 text-xs" data-testid="badge-total-purchases">
                <ShoppingCart className="h-3 w-3" />
                {summary.totalPurchases} purchases
              </Badge>
            )}
            {summary.totalOffloads === 0 && summary.totalPurchases === 0 && !isLoading && (
              <span className="text-xs text-muted-foreground">No activity</span>
            )}
          </div>
        )}

        <div
          className="flex items-center gap-2 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger
              className="h-7 text-xs w-32"
              data-testid="select-activity-days"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DAY_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* Expandable body */}
      {expanded && (
        <div className="border-t">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !data || data.companies.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No ERP companies found.
            </p>
          ) : (
            <div className="px-2 py-1">
              {data.companies.map((c) => (
                <CompanyRow key={c.id} company={c} dateRange={parseInt(days)} />
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
