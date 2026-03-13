import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  CalendarDays,
  CheckCircle,
  XCircle,
  RotateCcw,
  Save,
  Printer,
  FileDown,
  Users,
  UserCheck,
  UserX,
  Clock,
  User,
} from "lucide-react";

type AttendanceStatus = "Present" | "Absent" | "Late" | "Half Day" | "Leave";
type ViewMode = "daily" | "perWorker";

interface WorkerRow {
  id: number;
  fullName: string;
  employeeCode: string | null;
  department: string | null;
  position: string | null;
  shiftType: string | null;
}

interface AttendanceRecord {
  id: number;
  workerId: number;
  attendanceDate: string;
  shift: string | null;
  status: string;
  notes: string | null;
}

const STATUS_OPTIONS: AttendanceStatus[] = ["Present", "Absent", "Late", "Half Day", "Leave"];

const STATUS_COLORS: Record<string, string> = {
  Present: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  Absent: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  Late: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  "Half Day": "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  Leave: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function currentMonthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function currentMonthEnd() {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return last.toISOString().slice(0, 10);
}

function generateDateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const cur = new Date(start + "T00:00:00");
  const endDate = new Date(end + "T00:00:00");
  while (cur <= endDate) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

export default function FactoryAttendance() {
  const { toast } = useToast();
  const [mode, setMode] = useState<ViewMode>("daily");

  // ── Daily view state ──────────────────────────────────────────
  const [selectedDate, setSelectedDate] = useState<string>(todayStr());
  const [shift, setShift] = useState<string>("");
  const [attendanceMap, setAttendanceMap] = useState<Record<number, AttendanceStatus>>({});
  const [notesMap, setNotesMap] = useState<Record<number, string>>({});

  const { data, isLoading } = useQuery<{ workers: WorkerRow[]; attendance: AttendanceRecord[] }>({
    queryKey: [`/api/factory/attendance?date=${selectedDate}`],
  });

  useEffect(() => {
    if (!data) return;
    const newMap: Record<number, AttendanceStatus> = {};
    const newNotes: Record<number, string> = {};
    for (const w of data.workers) {
      newMap[w.id] = "Present";
    }
    for (const a of data.attendance) {
      newMap[a.workerId] = a.status as AttendanceStatus;
      newNotes[a.workerId] = a.notes || "";
    }
    setAttendanceMap(newMap);
    setNotesMap(newNotes);
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: (records: any[]) =>
      apiRequest("POST", "/api/factory/attendance/bulk", { records }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/factory/attendance?date=${selectedDate}`] });
      toast({ title: "Attendance saved", description: `Saved for ${selectedDate}` });
    },
    onError: (err: any) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const handleSave = useCallback(() => {
    if (!data?.workers.length) return;
    const records = data.workers.map((w) => ({
      workerId: w.id,
      attendanceDate: selectedDate,
      shift: shift || undefined,
      status: attendanceMap[w.id] ?? "Present",
      notes: notesMap[w.id] || undefined,
    }));
    saveMutation.mutate(records);
  }, [data, selectedDate, shift, attendanceMap, notesMap, saveMutation]);

  const markAll = (status: AttendanceStatus) => {
    if (!data?.workers) return;
    const next: Record<number, AttendanceStatus> = {};
    for (const w of data.workers) next[w.id] = status;
    setAttendanceMap(next);
  };

  const reset = () => {
    if (!data?.workers) return;
    const next: Record<number, AttendanceStatus> = {};
    for (const w of data.workers) next[w.id] = "Present";
    setAttendanceMap(next);
    setNotesMap({});
  };

  const setStatus = (workerId: number, status: AttendanceStatus) => {
    setAttendanceMap((prev) => ({ ...prev, [workerId]: status }));
  };

  const setNotes = (workerId: number, notes: string) => {
    setNotesMap((prev) => ({ ...prev, [workerId]: notes }));
  };

  const openPrintWindow = (html: string) => {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
  };

  const handlePrintBlank = () => {
    const html = generateBlankSheetHtml(data?.workers ?? [], selectedDate, shift);
    openPrintWindow(html);
  };

  const handleExportResults = () => {
    const html = generateResultsSheetHtml(
      data?.workers ?? [],
      attendanceMap,
      notesMap,
      selectedDate,
      shift
    );
    openPrintWindow(html);
  };

  const workers = data?.workers ?? [];

  const counts = {
    total: workers.length,
    present: workers.filter((w) => (attendanceMap[w.id] ?? "Present") === "Present").length,
    absent: workers.filter((w) => attendanceMap[w.id] === "Absent").length,
    other: workers.filter((w) => {
      const s = attendanceMap[w.id] ?? "Present";
      return s !== "Present" && s !== "Absent";
    }).length,
  };

  return (
    <div className="space-y-4 p-1">
      {/* Mode toggle */}
      <div className="flex gap-2">
        <Button
          variant={mode === "daily" ? "default" : "outline"}
          size="default"
          data-testid="button-mode-daily"
          onClick={() => setMode("daily")}
        >
          <CalendarDays className="h-4 w-4 mr-2" />
          Daily View
        </Button>
        <Button
          variant={mode === "perWorker" ? "default" : "outline"}
          size="default"
          data-testid="button-mode-per-worker"
          onClick={() => setMode("perWorker")}
        >
          <User className="h-4 w-4 mr-2" />
          Per Worker
        </Button>
      </div>

      {mode === "perWorker" ? (
        <PerWorkerView />
      ) : (
        <>
          {/* Filters + Actions */}
          <Card>
            <CardContent className="pt-4">
              <div className="flex flex-wrap gap-3 items-end">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="attendance-date" className="text-xs text-muted-foreground">
                    Attendance Date
                  </Label>
                  <Input
                    id="attendance-date"
                    data-testid="input-attendance-date"
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="w-44"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="shift-input" className="text-xs text-muted-foreground">
                    Shift (optional)
                  </Label>
                  <Input
                    id="shift-input"
                    data-testid="input-shift"
                    placeholder="e.g. Morning"
                    value={shift}
                    onChange={(e) => setShift(e.target.value)}
                    className="w-36"
                    dir="auto"
                  />
                </div>

                <div className="flex flex-wrap gap-2 ml-auto items-center">
                  <Button
                    variant="outline"
                    size="default"
                    data-testid="button-mark-all-present"
                    onClick={() => markAll("Present")}
                    disabled={!workers.length}
                  >
                    <UserCheck className="h-4 w-4 mr-1" />
                    Mark All Present
                  </Button>
                  <Button
                    variant="outline"
                    size="default"
                    data-testid="button-mark-all-absent"
                    onClick={() => markAll("Absent")}
                    disabled={!workers.length}
                  >
                    <UserX className="h-4 w-4 mr-1" />
                    Mark All Absent
                  </Button>
                  <Button
                    variant="ghost"
                    size="default"
                    data-testid="button-reset"
                    onClick={reset}
                    disabled={!workers.length}
                  >
                    <RotateCcw className="h-4 w-4 mr-1" />
                    Reset
                  </Button>
                  <Button
                    variant="outline"
                    size="default"
                    data-testid="button-print-blank"
                    onClick={handlePrintBlank}
                    disabled={!workers.length}
                  >
                    <Printer className="h-4 w-4 mr-1" />
                    Print Blank Sheet
                  </Button>
                  <Button
                    variant="outline"
                    size="default"
                    data-testid="button-export-pdf"
                    onClick={handleExportResults}
                    disabled={!workers.length}
                  >
                    <FileDown className="h-4 w-4 mr-1" />
                    Export PDF
                  </Button>
                  <Button
                    size="default"
                    data-testid="button-save-attendance"
                    onClick={handleSave}
                    disabled={!workers.length || saveMutation.isPending}
                  >
                    <Save className="h-4 w-4 mr-1" />
                    {saveMutation.isPending ? "Saving…" : "Save Attendance"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Summary Cards */}
          {workers.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <SummaryCard icon={<Users className="h-4 w-4" />} label="Total" value={counts.total} color="text-foreground" testId="stat-total" />
              <SummaryCard icon={<CheckCircle className="h-4 w-4" />} label="Present" value={counts.present} color="text-green-600 dark:text-green-400" testId="stat-present" />
              <SummaryCard icon={<XCircle className="h-4 w-4" />} label="Absent" value={counts.absent} color="text-red-600 dark:text-red-400" testId="stat-absent" />
              <SummaryCard icon={<Clock className="h-4 w-4" />} label="Other" value={counts.other} color="text-amber-600 dark:text-amber-400" testId="stat-other" />
            </div>
          )}

          {/* Attendance Table */}
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-base flex items-center gap-2">
                <CalendarDays className="h-4 w-4" />
                Workers — {formatDate(selectedDate)}
                {shift && <Badge variant="secondary">{shift}</Badge>}
              </CardTitle>
              {workers.length > 0 && (
                <span className="text-sm text-muted-foreground">{workers.length} worker{workers.length !== 1 ? "s" : ""}</span>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-4 space-y-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full rounded-md" />
                  ))}
                </div>
              ) : workers.length === 0 ? (
                <div className="text-center text-muted-foreground py-12 text-sm">
                  No active workers found for this company.
                </div>
              ) : (
                <>
                  {/* Desktop table */}
                  <div className="hidden sm:block overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/40">
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground w-8">#</th>
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground">Worker Name</th>
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground w-44">Status</th>
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground">Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {workers.map((worker, idx) => {
                          const status = attendanceMap[worker.id] ?? "Present";
                          return (
                            <tr
                              key={worker.id}
                              data-testid={`row-worker-${worker.id}`}
                              className="border-b last:border-0 hover-elevate"
                            >
                              <td className="px-4 py-2 text-muted-foreground">{idx + 1}</td>
                              <td
                                className="px-4 py-2 font-medium"
                                dir="auto"
                                data-testid={`text-worker-name-${worker.id}`}
                              >
                                {worker.fullName}
                              </td>
                              <td className="px-4 py-2">
                                <Select
                                  value={status}
                                  onValueChange={(v) => setStatus(worker.id, v as AttendanceStatus)}
                                >
                                  <SelectTrigger
                                    data-testid={`select-status-${worker.id}`}
                                    className={`h-8 text-xs font-medium ${STATUS_COLORS[status] ?? ""}`}
                                  >
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {STATUS_OPTIONS.map((s) => (
                                      <SelectItem key={s} value={s}>
                                        {s}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </td>
                              <td className="px-4 py-2">
                                <Input
                                  data-testid={`input-notes-${worker.id}`}
                                  placeholder="Optional notes"
                                  value={notesMap[worker.id] ?? ""}
                                  onChange={(e) => setNotes(worker.id, e.target.value)}
                                  className="h-8 text-xs"
                                  dir="auto"
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile cards */}
                  <div className="sm:hidden space-y-2 p-3">
                    {workers.map((worker, idx) => {
                      const status = attendanceMap[worker.id] ?? "Present";
                      return (
                        <div
                          key={worker.id}
                          data-testid={`card-worker-${worker.id}`}
                          className="border rounded-md p-3 space-y-2"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p
                              className="font-medium text-sm"
                              dir="auto"
                              data-testid={`text-worker-name-mobile-${worker.id}`}
                            >
                              {worker.fullName}
                            </p>
                            <span className="text-xs text-muted-foreground shrink-0">{idx + 1}</span>
                          </div>
                          <Select
                            value={status}
                            onValueChange={(v) => setStatus(worker.id, v as AttendanceStatus)}
                          >
                            <SelectTrigger
                              data-testid={`select-status-mobile-${worker.id}`}
                              className={`h-9 text-sm font-medium ${STATUS_COLORS[status] ?? ""}`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {STATUS_OPTIONS.map((s) => (
                                <SelectItem key={s} value={s}>
                                  {s}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Input
                            data-testid={`input-notes-mobile-${worker.id}`}
                            placeholder="Notes (optional)"
                            value={notesMap[worker.id] ?? ""}
                            onChange={(e) => setNotes(worker.id, e.target.value)}
                            className="h-8 text-xs"
                            dir="auto"
                          />
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ── Per Worker View ────────────────────────────────────────────────────────────

function PerWorkerView() {
  const { toast } = useToast();
  const [selectedWorkerId, setSelectedWorkerId] = useState<string>("");
  const [startDate, setStartDate] = useState<string>(currentMonthStart());
  const [endDate, setEndDate] = useState<string>(currentMonthEnd());
  const [checkedDates, setCheckedDates] = useState<Record<string, boolean>>({});

  const { data: workersList, isLoading: loadingWorkers } = useQuery<WorkerRow[]>({
    queryKey: ["/api/factory/workers?active=true"],
  });

  const workerIdNum = selectedWorkerId ? parseInt(selectedWorkerId) : null;

  const { data: attendanceRecords, isLoading: loadingAttendance } = useQuery<AttendanceRecord[]>({
    queryKey: ["/api/factory/attendance/worker", workerIdNum, startDate, endDate],
    queryFn: async () => {
      if (!workerIdNum) return [];
      const res = await fetch(
        `/api/factory/attendance/worker/${workerIdNum}?startDate=${startDate}&endDate=${endDate}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to load attendance");
      return res.json();
    },
    enabled: !!workerIdNum && !!startDate && !!endDate,
  });

  // Pre-fill checkboxes from DB whenever records or date range changes.
  useEffect(() => {
    const dates = generateDateRange(startDate, endDate);
    const next: Record<string, boolean> = {};
    for (const d of dates) {
      next[d] = false; // default: absent
    }
    if (attendanceRecords) {
      for (const r of attendanceRecords) {
        next[r.attendanceDate] = r.status === "Present" || r.status === "Late";
      }
    }
    setCheckedDates(next);
  }, [attendanceRecords, startDate, endDate]);

  const dates = generateDateRange(startDate, endDate);
  const presentCount = Object.values(checkedDates).filter(Boolean).length;
  const absentCount = dates.length - presentCount;

  const toggleDate = (date: string) => {
    setCheckedDates((prev) => ({ ...prev, [date]: !prev[date] }));
  };

  const selectAll = () => {
    const next: Record<string, boolean> = {};
    for (const d of dates) next[d] = true;
    setCheckedDates(next);
  };

  const deselectAll = () => {
    const next: Record<string, boolean> = {};
    for (const d of dates) next[d] = false;
    setCheckedDates(next);
  };

  const saveMutation = useMutation({
    mutationFn: (records: any[]) =>
      apiRequest("POST", "/api/factory/attendance/bulk", { records }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/factory/attendance/worker", workerIdNum, startDate, endDate],
      });
      toast({ title: "Attendance saved", description: `${dates.length} days saved for this worker.` });
    },
    onError: (err: any) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const handleSave = () => {
    if (!workerIdNum) return;
    const records = dates.map((d) => ({
      workerId: workerIdNum,
      attendanceDate: d,
      status: checkedDates[d] ? "Present" : "Absent",
    }));
    saveMutation.mutate(records);
  };

  const selectedWorker = (workersList ?? []).find((w) => w.id === workerIdNum);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1 min-w-[200px]">
              <Label className="text-xs text-muted-foreground">Worker</Label>
              <Select
                value={selectedWorkerId}
                onValueChange={setSelectedWorkerId}
              >
                <SelectTrigger data-testid="select-worker" className="w-56">
                  <SelectValue placeholder={loadingWorkers ? "Loading…" : "Select worker"} />
                </SelectTrigger>
                <SelectContent>
                  {(workersList ?? []).map((w) => (
                    <SelectItem key={w.id} value={String(w.id)}>
                      {w.fullName}
                      {w.employeeCode ? ` (${w.employeeCode})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">From</Label>
              <Input
                type="date"
                data-testid="input-start-date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-40"
              />
            </div>

            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">To</Label>
              <Input
                type="date"
                data-testid="input-end-date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-40"
              />
            </div>

            <div className="flex gap-2 ml-auto items-center flex-wrap">
              <Button
                variant="outline"
                size="default"
                data-testid="button-select-all"
                onClick={selectAll}
                disabled={!workerIdNum || dates.length === 0}
              >
                <UserCheck className="h-4 w-4 mr-1" />
                Select All
              </Button>
              <Button
                variant="outline"
                size="default"
                data-testid="button-deselect-all"
                onClick={deselectAll}
                disabled={!workerIdNum || dates.length === 0}
              >
                <UserX className="h-4 w-4 mr-1" />
                Deselect All
              </Button>
              <Button
                size="default"
                data-testid="button-save-per-worker"
                onClick={handleSave}
                disabled={!workerIdNum || dates.length === 0 || saveMutation.isPending}
              >
                <Save className="h-4 w-4 mr-1" />
                {saveMutation.isPending ? "Saving…" : "Save Attendance"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      {workerIdNum && dates.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <SummaryCard icon={<CalendarDays className="h-4 w-4" />} label="Days in Range" value={dates.length} color="text-foreground" testId="stat-pw-total" />
          <SummaryCard icon={<CheckCircle className="h-4 w-4" />} label="Present" value={presentCount} color="text-green-600 dark:text-green-400" testId="stat-pw-present" />
          <SummaryCard icon={<XCircle className="h-4 w-4" />} label="Absent" value={absentCount} color="text-red-600 dark:text-red-400" testId="stat-pw-absent" />
        </div>
      )}

      {/* Date checkbox table */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <User className="h-4 w-4" />
            {selectedWorker ? selectedWorker.fullName : "Select a worker"}
            {selectedWorker?.employeeCode && (
              <Badge variant="secondary">{selectedWorker.employeeCode}</Badge>
            )}
          </CardTitle>
          {workerIdNum && dates.length > 0 && (
            <span className="text-sm text-muted-foreground">
              {startDate} to {endDate}
            </span>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {!workerIdNum ? (
            <div className="text-center text-muted-foreground py-12 text-sm">
              Select a worker above to mark their attendance.
            </div>
          ) : loadingAttendance ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded-md" />
              ))}
            </div>
          ) : dates.length === 0 ? (
            <div className="text-center text-muted-foreground py-12 text-sm">
              No dates in the selected range.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground w-8">#</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Date</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground w-24">Day</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground w-28">Present</th>
                  </tr>
                </thead>
                <tbody>
                  {dates.map((date, idx) => {
                    const dayName = new Date(date + "T00:00:00").toLocaleDateString(undefined, { weekday: "long" });
                    const isChecked = checkedDates[date] ?? false;
                    const isFriday = new Date(date + "T00:00:00").getDay() === 5;
                    const isSaturday = new Date(date + "T00:00:00").getDay() === 6;
                    return (
                      <tr
                        key={date}
                        data-testid={`row-date-${date}`}
                        className={`border-b last:border-0 cursor-pointer hover-elevate ${(isFriday || isSaturday) ? "bg-muted/20" : ""}`}
                        onClick={() => toggleDate(date)}
                      >
                        <td className="px-4 py-3 text-muted-foreground">{idx + 1}</td>
                        <td className="px-4 py-3 font-medium">
                          {new Date(date + "T00:00:00").toLocaleDateString(undefined, {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })}
                        </td>
                        <td className={`px-4 py-3 text-sm ${(isFriday || isSaturday) ? "text-muted-foreground italic" : "text-muted-foreground"}`}>
                          {dayName}
                        </td>
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-2">
                            <Checkbox
                              data-testid={`checkbox-date-${date}`}
                              checked={isChecked}
                              onCheckedChange={() => toggleDate(date)}
                            />
                            <span className={`text-xs font-medium ${isChecked ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>
                              {isChecked ? "Present" : "Absent"}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Summary card ──────────────────────────────────────────────────────────────

function SummaryCard({
  icon,
  label,
  value,
  color,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
  testId: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4 flex items-center gap-3">
        <div className={`shrink-0 ${color}`}>{icon}</div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className={`text-2xl font-bold ${color}`} data-testid={testId}>
            {value}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(dateStr: string) {
  try {
    return new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

const ARABIC_FONT_CSS = `
  font-family: 'Segoe UI', Tahoma, Arial, 'Noto Sans Arabic', sans-serif;
`;

const PRINT_BASE_CSS = `
  @page { size: A4 portrait; margin: 18mm 15mm; }
  * { box-sizing: border-box; }
  body { ${ARABIC_FONT_CSS} font-size: 10pt; color: #111; margin: 0; }
  h1 { font-size: 16pt; text-align: center; margin: 0 0 4px; }
  .subtitle { text-align: center; font-size: 10pt; color: #555; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { background: #f0f0f0; border: 1px solid #bbb; padding: 5px 6px; font-size: 9pt; text-align: left; }
  td { border: 1px solid #ccc; padding: 5px 6px; font-size: 9pt; vertical-align: middle; }
  td.num { width: 28px; text-align: center; color: #888; }
  td.name { width: 55%; unicode-bidi: plaintext; }
  tr:nth-child(even) td { background: #fafafa; }
  .legend { margin-top: 14px; font-size: 8.5pt; color: #555; }
  .legend span { margin-right: 16px; }
  .footer { margin-top: 20px; display: flex; justify-content: space-between; font-size: 9pt; }
  .footer div { border-top: 1px solid #333; padding-top: 4px; width: 140px; text-align: center; }
  @media print { button { display: none; } }
`;

function generateBlankSheetHtml(workers: WorkerRow[], date: string, shift: string) {
  const formattedDate = formatDate(date);
  const rows = workers
    .map(
      (w, i) => `
      <tr>
        <td class="num">${i + 1}</td>
        <td class="name" dir="auto">${escHtml(w.fullName)}</td>
        <td style="width:12%;text-align:center"></td>
        <td style="width:12%;text-align:center"></td>
        <td style="width:21%"></td>
      </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="ar" dir="ltr">
<head>
  <meta charset="utf-8" />
  <title>Attendance Sheet — ${escHtml(date)}</title>
  <style>${PRINT_BASE_CSS}</style>
</head>
<body>
  <h1>Attendance Sheet</h1>
  <div class="subtitle">
    Date: <strong>${escHtml(formattedDate)}</strong>
    ${shift ? `&nbsp;&nbsp;|&nbsp;&nbsp; Shift: <strong>${escHtml(shift)}</strong>` : ""}
    &nbsp;&nbsp;|&nbsp;&nbsp; Total Workers: <strong>${workers.length}</strong>
  </div>
  <table>
    <thead>
      <tr>
        <th style="width:28px">#</th>
        <th>Worker Name</th>
        <th style="width:12%;text-align:center">P</th>
        <th style="width:12%;text-align:center">A</th>
        <th style="width:21%">Notes / Signature</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="legend">
    <span><strong>P</strong> = Present</span>
    <span><strong>A</strong> = Absent</span>
    <span>Mark with ✓ in the appropriate column</span>
  </div>
  <div class="footer">
    <div>Prepared By</div>
    <div>Supervisor</div>
    <div>Approved By</div>
  </div>
</body>
</html>`;
}

const STATUS_PRINT_COLORS: Record<string, string> = {
  Present: "#15803d",
  Absent: "#b91c1c",
  Late: "#b45309",
  "Half Day": "#1d4ed8",
  Leave: "#7e22ce",
};

function generateResultsSheetHtml(
  workers: WorkerRow[],
  attendanceMap: Record<number, AttendanceStatus>,
  notesMap: Record<number, string>,
  date: string,
  shift: string
) {
  const formattedDate = formatDate(date);

  const present = workers.filter((w) => (attendanceMap[w.id] ?? "Present") === "Present").length;
  const absent = workers.filter((w) => attendanceMap[w.id] === "Absent").length;
  const other = workers.filter((w) => {
    const s = attendanceMap[w.id] ?? "Present";
    return s !== "Present" && s !== "Absent";
  }).length;

  const rows = workers
    .map((w, i) => {
      const status = attendanceMap[w.id] ?? "Present";
      const color = STATUS_PRINT_COLORS[status] ?? "#374151";
      const notes = escHtml(notesMap[w.id] ?? "");
      return `
      <tr>
        <td class="num">${i + 1}</td>
        <td class="name" dir="auto">${escHtml(w.fullName)}</td>
        <td style="width:18%;font-weight:600;color:${color}">${escHtml(status)}</td>
        <td style="width:22%;color:#555">${notes}</td>
      </tr>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="ar" dir="ltr">
<head>
  <meta charset="utf-8" />
  <title>Attendance Report — ${escHtml(date)}</title>
  <style>
    ${PRINT_BASE_CSS}
    .summary { display:flex; gap:32px; margin-bottom:10px; font-size:10pt; }
    .summary span { font-weight:600; }
  </style>
</head>
<body>
  <h1>Attendance Report</h1>
  <div class="subtitle">
    Date: <strong>${escHtml(formattedDate)}</strong>
    ${shift ? `&nbsp;&nbsp;|&nbsp;&nbsp; Shift: <strong>${escHtml(shift)}</strong>` : ""}
  </div>
  <div class="summary">
    <div>Total Workers: <span>${workers.length}</span></div>
    <div>Present: <span style="color:#15803d">${present}</span></div>
    <div>Absent: <span style="color:#b91c1c">${absent}</span></div>
    <div>Other: <span style="color:#b45309">${other}</span></div>
  </div>
  <table>
    <thead>
      <tr>
        <th style="width:28px">#</th>
        <th>Worker Name</th>
        <th style="width:18%">Status</th>
        <th style="width:22%">Notes</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="footer">
    <div>Prepared By</div>
    <div>Supervisor</div>
    <div>Approved By</div>
  </div>
</body>
</html>`;
}

function escHtml(str: string) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
