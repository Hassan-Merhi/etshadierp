import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ChevronLeft, ChevronRight, CalendarDays, Printer } from "lucide-react";
import { cn } from "@/lib/utils";

/* ── Types ─────────────────────────────────────────────────────────────────── */
interface WorkerReportRow {
  id: number;
  employeeCode: string;
  fullName: string;
  attendance: Record<number, string>;
  presentCount: number;
  absentCount: number;
  recordedCount: number;
  attendancePct: number | null;
}
interface DailySummary {
  present: number;
  absent: number;
}
interface AttendanceReportData {
  year: number;
  month: number;
  daysInMonth: number;
  workers: WorkerReportRow[];
  dailySummary: Record<number, DailySummary>;
  totals: {
    workers: number;
    presentDays: number;
    absentDays: number;
    totalPossibleDays: number;
  };
}

type AttendanceFilter = "all" | "absent" | "present";

/* ── Constants ──────────────────────────────────────────────────────────────── */
const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const DAY_ABBR = ["Su","Mo","Tu","We","Th","Fr","Sa"];

/* ── Status cell ────────────────────────────────────────────────────────────── */
function StatusCell({ status, absentsOnly = false }: { status?: string; absentsOnly?: boolean }) {
  if (!status || (absentsOnly && status !== "Absent")) return (
    <span className="text-muted-foreground/30 text-xs select-none">—</span>
  );
  if (status === "Present") return (
    <span className="inline-flex items-center justify-center w-5 h-5 rounded-sm bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold select-none">P</span>
  );
  if (status === "Absent") return (
    <span className="inline-flex items-center justify-center w-5 h-5 rounded-sm bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 text-[10px] font-bold select-none">A</span>
  );
  return (
    <span className="inline-flex items-center justify-center w-5 h-5 rounded-sm bg-muted text-muted-foreground text-[10px] font-bold select-none">
      {status.charAt(0)}
    </span>
  );
}

/* ── Main Component ─────────────────────────────────────────────────────────── */
export default function FactoryWorkerAttendanceReport() {
  const today = new Date();
  const [year, setYear]     = useState(today.getFullYear());
  const [month, setMonth]   = useState(today.getMonth() + 1);
  const [filter, setFilter] = useState<AttendanceFilter>("all");

  const queryKey = ["/api/factory/workers/attendance-report", year, month];

  const { data, isLoading, isError, error, refetch } = useQuery<AttendanceReportData>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(
        `/api/factory/workers/attendance-report?year=${year}&month=${month}`,
        { credentials: "include" },
      );
      if (!res.ok) { const e = await res.json(); throw new Error(e.message || "Failed"); }
      return res.json();
    },
    retry: 1,
  });

  const goToPrev = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  };
  const goToNext = () => {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  };
  const goToToday = () => { setYear(today.getFullYear()); setMonth(today.getMonth() + 1); };
  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth() + 1;

  /* Day-of-week row for headers */
  const dayHeaders = useMemo(() => {
    if (!data) return [];
    return Array.from({ length: data.daysInMonth }, (_, i) => {
      const d = i + 1;
      const dow = new Date(data.year, data.month - 1, d).getDay();
      const isWeekend = dow === 0 || dow === 6;
      return { day: d, dow, isWeekend, abbr: DAY_ABBR[dow] };
    });
  }, [data]);

  /* Filtered worker list */
  const filteredWorkers = useMemo(() => {
    if (!data) return [];
    if (filter === "absent")  return data.workers.filter(w => w.absentCount > 0);
    if (filter === "present") return data.workers.filter(w => w.absentCount === 0);
    return data.workers;
  }, [data, filter]);

  /* Counts for filter badges */
  const absentCount  = data ? data.workers.filter(w => w.absentCount > 0).length  : 0;
  const presentCount = data ? data.workers.filter(w => w.absentCount === 0).length : 0;

  const overallPct = data && data.totals.presentDays + data.totals.absentDays > 0
    ? Math.round((data.totals.presentDays / (data.totals.presentDays + data.totals.absentDays)) * 100)
    : null;

  return (
    <div className="flex flex-col gap-4">
      {/* ── Header bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Attendance Report</h2>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Month navigator */}
          <div className="flex items-center gap-1 rounded-md border bg-background p-0.5">
            <Button
              variant="ghost"
              size="icon"
              onClick={goToPrev}
              data-testid="button-prev-month"
              className="h-8 w-8"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span
              className="text-sm font-semibold px-3 min-w-[140px] text-center select-none"
              data-testid="text-current-month"
            >
              {MONTH_NAMES[month - 1]} {year}
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={goToNext}
              data-testid="button-next-month"
              className="h-8 w-8"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {!isCurrentMonth && (
            <Button variant="outline" size="default" onClick={goToToday} data-testid="button-today">
              Today
            </Button>
          )}

          <Button
            variant="outline"
            size="default"
            onClick={() => window.print()}
            data-testid="button-print-report"
            className="print:hidden"
          >
            <Printer className="h-4 w-4 mr-2" />
            Print
          </Button>
        </div>
      </div>

      {/* ── Attendance filter ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap print:hidden">
        <span className="text-xs text-muted-foreground font-medium">Show:</span>
        <div className="flex items-center gap-1 rounded-md border bg-background p-0.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFilter("all")}
            data-testid="filter-all"
            className={cn(
              "h-7 px-3 text-xs rounded-sm",
              filter === "all" ? "bg-muted font-semibold" : "",
            )}
          >
            All
            {data && (
              <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0 h-4">
                {data.workers.length}
              </Badge>
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFilter("present")}
            data-testid="filter-present"
            className={cn(
              "h-7 px-3 text-xs rounded-sm",
              filter === "present" ? "bg-emerald-50 dark:bg-emerald-950/40 font-semibold text-emerald-700 dark:text-emerald-300" : "",
            )}
          >
            No Absences
            {data && (
              <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0 h-4 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
                {presentCount}
              </Badge>
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFilter("absent")}
            data-testid="filter-absent"
            className={cn(
              "h-7 px-3 text-xs rounded-sm",
              filter === "absent" ? "bg-red-50 dark:bg-red-950/40 font-semibold text-red-600 dark:text-red-400" : "",
            )}
          >
            Has Absences
            {data && (
              <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0 h-4 bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400">
                {absentCount}
              </Badge>
            )}
          </Button>
        </div>
      </div>

      {/* ── Loading / Error ─────────────────────────────────────────────────── */}
      {isLoading && (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
        </div>
      )}

      {isError && (
        <Card>
          <CardContent className="p-6 flex flex-col items-center gap-3">
            <p className="text-muted-foreground text-sm">{(error as Error)?.message || "Failed to load"}</p>
            <Button variant="outline" onClick={() => refetch()}>Try Again</Button>
          </CardContent>
        </Card>
      )}

      {data && !isLoading && (
        <>
          {/* ── Print header (hidden on screen) ─────────────────────────────── */}
          <div className="hidden print:block mb-4">
            <h1 className="text-xl font-bold">Worker Attendance Report</h1>
            <p className="text-sm text-gray-600">{MONTH_NAMES[month - 1]} {year}</p>
          </div>

          {/* ── Summary cards ───────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3 print:grid-cols-2">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground font-medium mb-1">Workers</p>
                <p className="text-2xl font-bold tabular-nums" data-testid="stat-total-workers">{data.totals.workers}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground font-medium mb-1">Attendance Rate</p>
                <p className={cn(
                  "text-2xl font-bold tabular-nums",
                  overallPct === null ? "text-muted-foreground" :
                  overallPct >= 90 ? "text-emerald-600 dark:text-emerald-400" :
                  overallPct >= 75 ? "text-amber-600 dark:text-amber-400" :
                  "text-red-500 dark:text-red-400",
                )} data-testid="stat-attendance-pct">
                  {overallPct !== null ? `${overallPct}%` : "—"}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* ── No workers state ────────────────────────────────────────────── */}
          {data.workers.length === 0 ? (
            <Card>
              <CardContent className="p-10 text-center text-muted-foreground">
                No active workers found. Add workers first from the Workers tab.
              </CardContent>
            </Card>
          ) : filteredWorkers.length === 0 ? (
            <Card>
              <CardContent className="p-10 text-center text-muted-foreground">
                No workers match the selected filter.
              </CardContent>
            </Card>
          ) : (
            /* ── Attendance grid ────────────────────────────────────────────── */
            <div className="overflow-auto rounded-md border print:overflow-visible print:border-0">
              <table className="w-full text-xs border-collapse min-w-max print:text-[9px]">
                <thead>
                  {/* Row 1: Month label + day numbers */}
                  <tr className="bg-muted sticky top-0 z-10 print:bg-gray-100">
                    {/* Code column */}
                    <th className="text-left px-2 py-2 font-medium border-b border-r whitespace-nowrap sticky left-0 bg-muted z-20 min-w-[70px] print:bg-gray-100">
                      Code
                    </th>
                    {/* Worker name column */}
                    <th className="text-left px-3 py-2 font-medium border-b border-r whitespace-nowrap sticky left-[70px] bg-muted z-20 min-w-[160px] print:bg-gray-100">
                      Worker
                    </th>
                    {/* Day columns */}
                    {dayHeaders.map(({ day, abbr, isWeekend }) => (
                      <th
                        key={day}
                        className={cn(
                          "text-center px-0 py-1 font-medium border-b border-r w-8 min-w-[32px]",
                          isWeekend ? "text-amber-600 dark:text-amber-400 bg-amber-50/60 dark:bg-amber-900/10" : "",
                        )}
                      >
                        <div className="flex flex-col items-center gap-0 leading-tight">
                          <span className="text-[9px] text-muted-foreground font-normal">{abbr}</span>
                          <span className="text-[11px] font-semibold">{day}</span>
                        </div>
                      </th>
                    ))}
                    {/* Summary columns */}
                    <th className="text-center px-2 py-2 font-medium border-b whitespace-nowrap min-w-[52px]">%</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredWorkers.map((worker, idx) => (
                    <tr
                      key={worker.id}
                      className={cn(
                        "border-b transition-colors",
                        idx % 2 === 0 ? "bg-background" : "bg-muted/20",
                      )}
                      data-testid={`row-worker-${worker.id}`}
                    >
                      {/* Code cell */}
                      <td className={cn(
                        "px-2 py-1.5 border-r sticky left-0 z-10 font-mono text-muted-foreground",
                        idx % 2 === 0 ? "bg-background" : "bg-muted/20",
                      )}>
                        {worker.employeeCode || "—"}
                      </td>
                      {/* Name cell */}
                      <td className={cn(
                        "px-3 py-1.5 border-r sticky left-[70px] z-10 font-medium whitespace-nowrap",
                        idx % 2 === 0 ? "bg-background" : "bg-muted/20",
                      )}>
                        <span className="truncate block max-w-[180px]" title={worker.fullName}>{worker.fullName}</span>
                      </td>
                      {/* Day cells */}
                      {dayHeaders.map(({ day, isWeekend }) => (
                        <td
                          key={day}
                          className={cn(
                            "text-center px-0 py-1.5 border-r w-8",
                            isWeekend ? "bg-amber-50/40 dark:bg-amber-900/5" : "",
                          )}
                          data-testid={`cell-${worker.id}-day-${day}`}
                        >
                          <div className="flex items-center justify-center">
                            <StatusCell status={worker.attendance[day]} absentsOnly={filter === "absent"} />
                          </div>
                        </td>
                      ))}
                      {/* Attendance % */}
                      <td className={cn(
                        "text-center px-2 py-1.5 font-semibold tabular-nums",
                        worker.attendancePct === null ? "text-muted-foreground" :
                        worker.attendancePct >= 90 ? "text-emerald-700 dark:text-emerald-400" :
                        worker.attendancePct >= 75 ? "text-amber-600 dark:text-amber-400" :
                        "text-red-500 dark:text-red-400",
                      )}>
                        {worker.attendancePct !== null ? `${worker.attendancePct}%` : "—"}
                      </td>
                    </tr>
                  ))}

                  {/* ── Daily summary row ────────────────────────────────────── */}
                  <tr className="border-t-2 bg-muted/60 font-semibold sticky bottom-0 print:bg-gray-100">
                    <td className="px-2 py-2 border-r sticky left-0 bg-muted/60 z-10 text-muted-foreground text-[10px] print:bg-gray-100" />
                    <td className="px-3 py-2 border-r sticky left-[70px] bg-muted/60 z-10 text-muted-foreground text-[10px] whitespace-nowrap print:bg-gray-100">
                      Daily Total
                    </td>
                    {dayHeaders.map(({ day }) => {
                      const ds = data.dailySummary[day] || { present: 0, absent: 0 };
                      return (
                        <td key={day} className="text-center px-0 py-2 border-r w-8 align-top">
                          {ds.present > 0 && (
                            <div className="text-[9px] font-semibold text-emerald-700 dark:text-emerald-400 leading-tight">{ds.present}</div>
                          )}
                          {ds.absent > 0 && (
                            <div className="text-[9px] font-semibold text-red-500 dark:text-red-400 leading-tight">{ds.absent}</div>
                          )}
                          {ds.present === 0 && ds.absent === 0 && (
                            <span className="text-muted-foreground/30 text-[9px]">—</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="text-center px-2 py-2 border-r text-emerald-700 dark:text-emerald-400">{data.totals.presentDays}</td>
                    <td className="text-center px-2 py-2 border-r text-red-500 dark:text-red-400">{data.totals.absentDays}</td>
                    <td className="text-center px-2 py-2 text-muted-foreground">
                      {overallPct !== null ? `${overallPct}%` : "—"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* ── Legend ──────────────────────────────────────────────────────── */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground print:hidden">
            <span className="flex items-center gap-1.5">
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-sm bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-[9px] font-bold">P</span>
              Present
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-sm bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 text-[9px] font-bold">A</span>
              Absent
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-muted-foreground/40">—</span>
              Not recorded
            </span>
            <span className="flex items-center gap-1.5">
              <Badge variant="outline" className="text-[9px] text-amber-600 dark:text-amber-400 border-amber-300 px-1 py-0 h-auto">Sa/Su</Badge>
              Weekend
            </span>
          </div>
        </>
      )}
    </div>
  );
}
