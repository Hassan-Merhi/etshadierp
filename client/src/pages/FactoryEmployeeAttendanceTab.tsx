import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import {
  CalendarDays, Save, CheckCircle, XCircle, Clock, User, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

type AttendanceStatus = "Present" | "Absent" | "Late" | "Half Day" | "Leave";

interface EmpRow {
  id: number;
  firstName: string;
  lastName: string;
  code: string | null;
  department: string | null;
}

interface AttRecord {
  id: number;
  employeeId: number;
  attendanceDate: string;
  status: AttendanceStatus;
  notes: string | null;
}

const STATUS_OPTIONS: AttendanceStatus[] = ["Present", "Absent", "Late", "Half Day", "Leave"];

function statusBadge(status: AttendanceStatus) {
  const map: Record<AttendanceStatus, string> = {
    Present: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    Absent: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    Late: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
    "Half Day": "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    Leave: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  };
  return map[status] || "";
}

export default function FactoryEmployeeAttendanceTab() {
  const { toast } = useToast();
  const today = new Date().toISOString().split("T")[0];
  const [date, setDate] = useState(today);
  const [localStatus, setLocalStatus] = useState<Record<number, AttendanceStatus>>({});

  const { data, isLoading, refetch } = useQuery<{ employees: EmpRow[]; attendance: AttRecord[] }>({
    queryKey: ["/api/factory/employee-attendance", date],
    queryFn: async () => {
      const res = await fetch(`/api/factory/employee-attendance?date=${date}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const employees = data?.employees || [];
  const attendance = data?.attendance || [];

  const getStatus = (empId: number): AttendanceStatus => {
    if (localStatus[empId]) return localStatus[empId];
    const rec = attendance.find((a) => a.employeeId === empId);
    return (rec?.status as AttendanceStatus) || "Present";
  };

  const handleMarkAll = (status: AttendanceStatus) => {
    const map: Record<number, AttendanceStatus> = {};
    for (const emp of employees) map[emp.id] = status;
    setLocalStatus(map);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const records = employees.map((emp) => ({
        employeeId: emp.id,
        attendanceDate: date,
        status: getStatus(emp.id),
      }));
      const res = await fetch("/api/factory/employee-attendance/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ records }),
      });
      if (!res.ok) throw new Error("Failed to save");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Attendance saved" });
      setLocalStatus({});
      queryClient.invalidateQueries({ queryKey: ["/api/factory/employee-attendance", date] });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const present = employees.filter((e) => getStatus(e.id) === "Present" || getStatus(e.id) === "Late").length;
  const absent = employees.filter((e) => getStatus(e.id) === "Absent").length;
  const halfDay = employees.filter((e) => getStatus(e.id) === "Half Day").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end justify-between">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Date</Label>
            <Input
              type="date"
              value={date}
              onChange={(e) => { setDate(e.target.value); setLocalStatus({}); }}
              className="w-44"
              data-testid="input-attendance-date"
            />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => handleMarkAll("Present")} data-testid="button-mark-all-present">
              <CheckCircle className="h-3 w-3 mr-1" /> All Present
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleMarkAll("Absent")} data-testid="button-mark-all-absent">
              <XCircle className="h-3 w-3 mr-1" /> All Absent
            </Button>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh-attendance">
            <RefreshCw className="h-3 w-3 mr-1" /> Refresh
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || employees.length === 0}
            data-testid="button-save-attendance"
          >
            <Save className="h-4 w-4 mr-2" />
            {saveMutation.isPending ? "Saving..." : "Save Attendance"}
          </Button>
        </div>
      </div>

      {employees.length > 0 && (
        <div className="flex gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <span data-testid="stat-present">Present: {present}</span>
          </div>
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <XCircle className="h-4 w-4 text-red-500" />
            <span data-testid="stat-absent">Absent: {absent}</span>
          </div>
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Clock className="h-4 w-4 text-blue-500" />
            <span data-testid="stat-halfday">Half Day: {halfDay}</span>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : employees.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <User className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p>No active employees found.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="hidden sm:block rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employees.map((emp) => {
                  const status = getStatus(emp.id);
                  return (
                    <TableRow key={emp.id} data-testid={`row-attendance-${emp.id}`}>
                      <TableCell className="text-xs text-muted-foreground">{emp.code || "—"}</TableCell>
                      <TableCell className="font-medium">{emp.firstName} {emp.lastName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{emp.department || "—"}</TableCell>
                      <TableCell>
                        <Select
                          value={status}
                          onValueChange={(v) => setLocalStatus((prev) => ({ ...prev, [emp.id]: v as AttendanceStatus }))}
                        >
                          <SelectTrigger className="w-32" data-testid={`select-status-${emp.id}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {STATUS_OPTIONS.map((s) => (
                              <SelectItem key={s} value={s}>
                                <span className={`text-xs px-1.5 py-0.5 rounded ${statusBadge(s)}`}>{s}</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="sm:hidden space-y-2">
            {employees.map((emp) => {
              const status = getStatus(emp.id);
              return (
                <Card key={emp.id} data-testid={`card-attendance-${emp.id}`}>
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{emp.firstName} {emp.lastName}</p>
                        <p className="text-xs text-muted-foreground">{emp.code || ""} {emp.department ? `· ${emp.department}` : ""}</p>
                      </div>
                      <Select
                        value={status}
                        onValueChange={(v) => setLocalStatus((prev) => ({ ...prev, [emp.id]: v as AttendanceStatus }))}
                      >
                        <SelectTrigger className="w-28 shrink-0" data-testid={`select-status-mobile-${emp.id}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STATUS_OPTIONS.map((s) => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
