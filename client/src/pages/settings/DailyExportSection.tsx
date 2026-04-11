import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Download,
  Mail,
  Plus,
  Trash2,
  Building2,
  Calendar,
  ChevronDown,
  Clock,
  Eye,
  EyeOff,
  Loader2,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";

interface Recipient { id: number; email: string; active: boolean; created_at: string; }
interface ExportSettings { gmailUser: string; scheduleEnabled: boolean; lastRunAt: string | null; }
interface Company { id: number; name: string; code: string; }

export function DailyExportSection() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [newEmail, setNewEmail] = useState("");
  const [gmailUser, setGmailUser] = useState("");
  const [gmailPassword, setGmailPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);

  const { data: recipients = [] } = useQuery<Recipient[]>({
    queryKey: ["/api/export/recipients"],
  });

  const { data: settings } = useQuery<ExportSettings>({
    queryKey: ["/api/export/settings"],
  });

  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ["/api/export/companies"],
  });

  const addRecipient = useMutation({
    mutationFn: (email: string) => apiRequest("POST", "/api/export/recipients", { email }),
    onSuccess: () => {
      setNewEmail("");
      qc.invalidateQueries({ queryKey: ["/api/export/recipients"] });
      toast({ title: "Recipient added" });
    },
    onError: (e: any) => toast({ variant: "destructive", title: "Error", description: e.message }),
  });

  const removeRecipient = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/export/recipients/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/export/recipients"] });
      toast({ title: "Recipient removed" });
    },
  });

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      const body: any = {
        scheduleEnabled: settings?.scheduleEnabled ?? false,
      };
      if (gmailUser) body.gmailUser = gmailUser;
      if (gmailPassword) body.gmailAppPassword = gmailPassword;
      await apiRequest("PUT", "/api/export/settings", body);
      qc.invalidateQueries({ queryKey: ["/api/export/settings"] });
      setGmailUser("");
      setGmailPassword("");
      toast({ title: "Settings saved" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    } finally {
      setSavingSettings(false);
    }
  };

  const toggleSchedule = async (enabled: boolean) => {
    try {
      await apiRequest("PUT", "/api/export/settings", {
        scheduleEnabled: enabled,
        gmailUser: settings?.gmailUser,
      });
      qc.invalidateQueries({ queryKey: ["/api/export/settings"] });
      toast({ title: enabled ? "Schedule enabled — runs daily at 6:00 PM EST" : "Schedule disabled" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    }
  };

  const runExport = async (mode: "download" | "email") => {
    setExporting(true);
    setExportProgress(mode === "download" ? "Generating Excel files and zip..." : "Sending email...");

    try {
      if (mode === "download") {
        const params: any = { mode };
        if (fromDate) params.fromDate = fromDate;
        if (toDate) params.toDate = toDate;

        const res = await fetch("/api/export/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
          credentials: "include",
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ message: "Export failed" }));
          throw new Error(err.message);
        }

        const blob = await res.blob();
        const dateLabel = new Date().toISOString().substring(0, 10);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `DailyExport_${dateLabel}.zip`;
        a.click();
        URL.revokeObjectURL(url);
        setExportProgress("");
        toast({ title: "Download started", description: "Your zip file is downloading." });
      } else {
        const params: any = { mode: "email" };
        if (fromDate) params.fromDate = fromDate;
        if (toDate) params.toDate = toDate;

        const result = await apiRequest("POST", "/api/export/run", params) as any;
        setExportProgress("");
        if (result.success) {
          toast({ title: "Email sent", description: `Export emailed to ${recipients.length} recipient(s).` });
        } else {
          toast({ variant: "destructive", title: "Email failed", description: result.error });
        }
      }
    } catch (e: any) {
      setExportProgress("");
      toast({ variant: "destructive", title: "Export failed", description: e.message });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="section-daily-export">
      <div>
        <h3 className="text-lg font-semibold">Daily Full Company Export</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Export all data — accounts, transactions, inventory, payroll, containers, production, and more — for every company. One Excel file per company, bundled in a zip.
        </p>
      </div>

      {/* Companies overview */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Companies ({companies.length})
          </CardTitle>
          <CardDescription>All companies will be included in the export.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {companies.map(c => (
              <Badge key={c.id} variant="secondary" data-testid={`badge-company-${c.id}`}>
                {c.name}
              </Badge>
            ))}
            {companies.length === 0 && (
              <p className="text-sm text-muted-foreground">No companies found.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Export Now */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Download className="h-4 w-4" />
            Export Now
          </CardTitle>
          <CardDescription>
            Leave dates blank to export full history. Set a range to scope the export.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs flex items-center gap-1"><Calendar className="h-3 w-3" />From Date</Label>
              <Input
                type="date"
                value={fromDate}
                onChange={e => setFromDate(e.target.value)}
                className="w-40"
                data-testid="input-export-from-date"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs flex items-center gap-1"><Calendar className="h-3 w-3" />To Date</Label>
              <Input
                type="date"
                value={toDate}
                onChange={e => setToDate(e.target.value)}
                className="w-40"
                data-testid="input-export-to-date"
              />
            </div>
            {(fromDate || toDate) && (
              <Button variant="ghost" size="sm" onClick={() => { setFromDate(""); setToDate(""); }}>
                Clear (full history)
              </Button>
            )}
          </div>

          {exportProgress && (
            <Alert>
              <Loader2 className="h-4 w-4 animate-spin" />
              <AlertDescription>{exportProgress}</AlertDescription>
            </Alert>
          )}

          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button disabled={exporting || companies.length === 0} data-testid="button-export-now">
                  {exporting ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Exporting...</>
                  ) : (
                    <>Export Now <ChevronDown className="h-4 w-4 ml-2" /></>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={() => runExport("download")} data-testid="menu-export-download">
                  <Download className="h-4 w-4 mr-2" />
                  Download ZIP
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => runExport("email")}
                  disabled={recipients.length === 0 || !settings?.gmailUser}
                  data-testid="menu-export-email"
                >
                  <Mail className="h-4 w-4 mr-2" />
                  Send by Email
                  {recipients.length === 0 && <span className="ml-2 text-xs text-muted-foreground">(no recipients)</span>}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <p className="text-xs text-muted-foreground">
              {fromDate || toDate
                ? `Filtered: ${fromDate || "—"} → ${toDate || "—"}`
                : "Full history (all dates)"}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Scheduled Daily Export */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Scheduled Daily Export
          </CardTitle>
          <CardDescription>Automatically runs every day at 6:00 PM EST and emails the export to all recipients.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Enable daily schedule</p>
              <p className="text-xs text-muted-foreground">Runs at 6:00 PM Eastern Time, Monday–Sunday</p>
            </div>
            <Switch
              checked={settings?.scheduleEnabled ?? false}
              onCheckedChange={toggleSchedule}
              data-testid="switch-schedule-enabled"
            />
          </div>
          {settings?.lastRunAt && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <CheckCircle2 className="h-3 w-3 text-green-600" />
              Last run: {new Date(settings.lastRunAt).toLocaleString()}
            </div>
          )}
          {settings?.scheduleEnabled && !settings?.gmailUser && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>Schedule is enabled but Gmail credentials are not configured. The export will not be sent.</AlertDescription>
            </Alert>
          )}
          {settings?.scheduleEnabled && recipients.length === 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>Schedule is enabled but no recipients are configured. Add at least one email address.</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Gmail Credentials */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Gmail Sender Credentials
          </CardTitle>
          <CardDescription>
            Configure the Gmail account used to send the daily export emails. Use a dedicated Gmail account and generate an App Password from Google Account → Security → 2-Step Verification → App Passwords.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {settings?.gmailUser && (
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span>Currently configured: <span className="font-medium">{settings.gmailUser}</span></span>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Gmail Address</Label>
              <Input
                type="email"
                placeholder={settings?.gmailUser || "sender@gmail.com"}
                value={gmailUser}
                onChange={e => setGmailUser(e.target.value)}
                data-testid="input-gmail-user"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">App Password</Label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="xxxx xxxx xxxx xxxx"
                  value={gmailPassword}
                  onChange={e => setGmailPassword(e.target.value)}
                  className="pr-10"
                  data-testid="input-gmail-password"
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="absolute right-0 top-0 h-full"
                  onClick={() => setShowPassword(p => !p)}
                  type="button"
                  data-testid="button-toggle-password"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </div>
          <Button
            onClick={saveSettings}
            disabled={savingSettings || (!gmailUser && !gmailPassword)}
            data-testid="button-save-email-settings"
          >
            {savingSettings ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</> : "Save Credentials"}
          </Button>
        </CardContent>
      </Card>

      {/* Recipients */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Email Recipients ({recipients.length})
          </CardTitle>
          <CardDescription>These addresses receive the daily export email.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              type="email"
              placeholder="Add email address..."
              value={newEmail}
              onChange={e => setNewEmail(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && newEmail) addRecipient.mutate(newEmail); }}
              data-testid="input-new-recipient"
            />
            <Button
              onClick={() => newEmail && addRecipient.mutate(newEmail)}
              disabled={!newEmail || addRecipient.isPending}
              data-testid="button-add-recipient"
            >
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          </div>
          {recipients.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email Address</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recipients.map(r => (
                  <TableRow key={r.id} data-testid={`row-recipient-${r.id}`}>
                    <TableCell className="font-mono text-sm">{r.email}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(r.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => removeRecipient.mutate(r.id)}
                        data-testid={`button-remove-recipient-${r.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">No recipients yet. Add an email address above.</p>
          )}
        </CardContent>
      </Card>

      <Separator />

      {/* Data coverage info */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">What's included in each export</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-xs text-muted-foreground">
          {[
            "Summary overview",
            "Locations",
            "Ledger accounts",
            "Bank accounts",
            "Fixed assets",
            "All vouchers",
            "All voucher entries",
            "Suppliers + transactions",
            "Customers + transactions",
            "Employees + payrolls",
            "Salary advances",
            "Factory workers",
            "Factory payrolls",
            "Factory attendance",
            "Factory daybook",
            "Stock groups + items",
            "Inventory by location",
            "Stock transfers + revisions",
            "Stock adjustments",
            "Purchase orders + line items",
            "Containers + charges",
            "Container offloads",
            "Bales (sorting)",
            "Factory bales + products",
            "Factory containers",
            "Exchange rates",
            "POS shifts",
            "Sales items",
            "Full audit log",
          ].map(item => (
            <div key={item} className="flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-green-600 shrink-0" />
              {item}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
