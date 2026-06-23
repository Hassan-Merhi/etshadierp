import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Zap,
  Download,
  TrendingUp,
  MessageCircle,
  Building2,
  Calendar,
  MessageSquare,
  Mail,
  Settings2,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

import {
  Recipient,
  ExportSettings,
  Company,
  BackupStatus,
  WaSettings,
  WaRecipient,
  NpSettings,
} from "./ExportCenterTypes";
import { currentYearDateRange, scheduleLabel } from "./ExportCenterHelpers";
import { ExportProgressDialog } from "./ExportProgressDialog";
import { DailyExportTab } from "./DailyExportTab";
import { NetPositionTab } from "./NetPositionTab";
import { RecipientsTab } from "./RecipientsTab";
import { StockReportSection } from "./StockReportSection";
import { PosWhatsAppSection } from "./PosWhatsAppSection";
import { ContainersWhatsAppSection } from "./ContainersWhatsAppSection";
import { TransferWhatsAppSection } from "./TransferWhatsAppSection";
import { AgentDutyWhatsAppSection } from "./AgentDutyWhatsAppSection";

export function ExportCenter() {
  const { toast } = useToast();
  const qc = useQueryClient();

  // Shared UI state
  const [progressOpen, setProgressOpen] = useState(false);
  const [activeJobId, setActiveJobId] = useState("");
  const [activeMode, setActiveMode] = useState<"download" | "email">("download");

  // Daily Export local state
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [showCompanies, setShowCompanies] = useState(false);
  const [showHistory, setShowHistory] = useState(true);
  const [historyFilter, setHistoryFilter] = useState("all");

  // Net Position local state
  const { start: npDefaultStart, end: npDefaultEnd } = currentYearDateRange();
  const [npRecipientId, setNpRecipientId] = useState<number | null | undefined>(undefined);
  const [npFrequency, setNpFrequency] = useState<string | null>(null);
  const [npSendHour, setNpSendHour] = useState<number | null>(null);
  const [npSendDayOfWeek, setNpSendDayOfWeek] = useState<number | null>(null);

  // Gmail local state
  const [gmailUser, setGmailUser] = useState("");
  const [gmailPassword, setGmailPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [savingGmail, setSavingGmail] = useState(false);

  // Queries
  const { data: emailRecipients = [] } = useQuery<Recipient[]>({ queryKey: ["/api/export/recipients"] });
  const { data: exportSettings } = useQuery<ExportSettings>({ queryKey: ["/api/export/settings"] });
  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/export/companies"] });
  const {
    data: backupStatus,
    isFetching: backupFetching,
    refetch: refetchBackup,
  } = useQuery<BackupStatus>({
    queryKey: ["/api/export/backup-status"],
    refetchInterval: 15000,
  });
  const { data: waSettings } = useQuery<WaSettings>({ queryKey: ["/api/whatsapp/settings"] });
  const { data: waRecipients = [] } = useQuery<WaRecipient[]>({ queryKey: ["/api/whatsapp/recipients"] });
  const { data: npSettings } = useQuery<NpSettings>({ queryKey: ["/api/whatsapp/np-settings"] });

  // Computed
  const waGroups = waRecipients.filter((r) => r.isGroup && r.active);
  const npWaGroupName = npSettings?.recipientName ?? null;
  const waReady = !!(waSettings?.enabled && waSettings?.dailyRecipientId);
  const dailyWaGroup = waRecipients.find((r) => r.id === waSettings?.dailyRecipientId);
  const npWaGroup = waRecipients.find(
    (r) => r.id === (npRecipientId !== undefined ? npRecipientId : npSettings?.recipientId)
  );

  const npEff = {
    recipientId: npRecipientId !== undefined ? npRecipientId : (npSettings?.recipientId ?? null),
    frequency: npFrequency ?? npSettings?.frequency ?? "daily",
    sendHour: npSendHour ?? npSettings?.sendHour ?? 18,
    sendDayOfWeek: npSendDayOfWeek ?? npSettings?.sendDayOfWeek ?? 1,
  };

  const npScheduleText = scheduleLabel(npSettings);
  const filteredRuns = (backupStatus?.recentRuns ?? []).filter((r) => {
    if (historyFilter === "all") return true;
    if (historyFilter === "success") return r.status === "success";
    if (historyFilter === "failed") return r.status === "failed" || r.status === "partial_failed";
    if (historyFilter === "running") return r.status === "running";
    return true;
  });

  // Handlers
  const startExport = async (mode: "download" | "email") => {
    try {
      const body: any = { mode };
      if (fromDate) body.fromDate = fromDate;
      if (toDate) body.toDate = toDate;
      const result = (await (await apiRequest("POST", "/api/export/start", body)).json()) as any;
      setActiveJobId(result.jobId);
      setActiveMode(mode);
      setProgressOpen(true);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Could not start export", description: e.message });
    }
  };

  const sendViaWaMutation = useMutation({
    mutationFn: async () => {
      const body: any = {};
      if (fromDate) body.fromDate = fromDate;
      if (toDate) body.toDate = toDate;
      return (await apiRequest("POST", "/api/daily-export/trigger-whatsapp", body)).json();
    },
    onSuccess: (data: any) => {
      toast({ title: "WhatsApp export started", description: data.message });
      [5, 20, 45, 75, 120].forEach((s) => setTimeout(() => refetchBackup(), s * 1000));
    },
    onError: (e: any) => {
      toast({ variant: "destructive", title: "WhatsApp send failed", description: e.message });
    },
  });

  const sendViaWhatsApp = () => sendViaWaMutation.mutate();

  const downloadNpExcel = () => {
    const url = `/api/reports/net-position-monthly-excel?startDate=${npDefaultStart}&endDate=${npDefaultEnd}`;
    window.open(url, "_blank");
  };

  const saveGmailSettings = async () => {
    setSavingGmail(true);
    try {
      const body: any = { scheduleEnabled: exportSettings?.scheduleEnabled ?? false };
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
      setSavingGmail(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-6xl mx-auto pb-20">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Zap className="h-6 w-6 text-blue-500" /> Export Center
        </h2>
        <p className="text-muted-foreground">Manage automatic backups, scheduled reports, and WhatsApp delivery.</p>
      </div>

      <Tabs defaultValue="daily" className="w-full">
        <TabsList className="w-full flex h-auto p-1 bg-muted/50 rounded-lg overflow-x-auto no-scrollbar justify-start sm:justify-center gap-1">
          <TabsTrigger
            value="daily"
            className="flex items-center gap-2 py-2.5 px-4 rounded-md data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all whitespace-nowrap"
          >
            <Download className="h-4 w-4" /> Daily Export
          </TabsTrigger>
          <TabsTrigger
            value="np"
            className="flex items-center gap-2 py-2.5 px-4 rounded-md data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all whitespace-nowrap"
          >
            <TrendingUp className="h-4 w-4" /> Net Position
          </TabsTrigger>
          <TabsTrigger
            value="stock"
            className="flex items-center gap-2 py-2.5 px-4 rounded-md data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all whitespace-nowrap"
          >
            <Building2 className="h-4 w-4" /> Stock Report
          </TabsTrigger>
          <TabsTrigger
            value="wa-groups"
            className="flex items-center gap-2 py-2.5 px-4 rounded-md data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all whitespace-nowrap"
          >
            <MessageCircle className="h-4 w-4" /> POS / WA
          </TabsTrigger>
          <TabsTrigger
            value="containers-wa"
            className="flex items-center gap-2 py-2.5 px-4 rounded-md data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all whitespace-nowrap"
          >
            <Calendar className="h-4 w-4" /> Containers
          </TabsTrigger>
          <TabsTrigger
            value="transfer-wa"
            className="flex items-center gap-2 py-2.5 px-4 rounded-md data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all whitespace-nowrap"
          >
            <MessageSquare className="h-4 w-4" /> Transfers
          </TabsTrigger>
          <TabsTrigger
            value="agent-duty-wa"
            className="flex items-center gap-2 py-2.5 px-4 rounded-md data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all whitespace-nowrap"
          >
            <Mail className="h-4 w-4" /> Agent / Duty
          </TabsTrigger>
          <TabsTrigger
            value="recipients"
            className="flex items-center gap-2 py-2.5 px-4 rounded-md data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all whitespace-nowrap"
          >
            <Settings2 className="h-4 w-4" /> Recipients
          </TabsTrigger>
        </TabsList>

        <TabsContent value="daily">
          <DailyExportTab
            backupStatus={backupStatus}
            backupFetching={backupFetching}
            refetchBackup={refetchBackup}
            companies={companies}
            fromDate={fromDate}
            setFromDate={setFromDate}
            toDate={toDate}
            setToDate={setToDate}
            startExport={startExport}
            recipients={emailRecipients}
            settings={exportSettings}
            waReady={waReady}
            sendingWa={sendViaWaMutation.isPending}
            sendViaWhatsApp={sendViaWhatsApp}
            showCompanies={showCompanies}
            setShowCompanies={setShowCompanies}
            showHistory={showHistory}
            setShowHistory={setShowHistory}
            historyFilter={historyFilter}
            setHistoryFilter={setHistoryFilter}
            filteredRuns={filteredRuns}
          />
        </TabsContent>

        <TabsContent value="np">
          <NetPositionTab
            npSettings={npSettings}
            waGroups={waGroups}
            npEff={npEff}
            setNpRecipientId={setNpRecipientId}
            setNpFrequency={setNpFrequency}
            setNpSendHour={setNpSendHour}
            setNpSendDayOfWeek={setNpSendDayOfWeek}
            npWaGroupName={npWaGroupName}
            npScheduleText={npScheduleText}
            npDefaultEnd={npDefaultEnd}
            npDefaultStart={npDefaultStart}
            downloadNpExcel={downloadNpExcel}
          />
        </TabsContent>

        <TabsContent value="stock">
          <StockReportSection />
        </TabsContent>

        <TabsContent value="wa-groups">
          <PosWhatsAppSection />
        </TabsContent>

        <TabsContent value="containers-wa">
          <ContainersWhatsAppSection />
        </TabsContent>

        <TabsContent value="transfer-wa">
          <TransferWhatsAppSection />
        </TabsContent>

        <TabsContent value="agent-duty-wa">
          <AgentDutyWhatsAppSection />
        </TabsContent>

        <TabsContent value="recipients">
          <RecipientsTab
            emailRecipients={emailRecipients}
            waGroups={waGroups}
            waRecipients={waRecipients}
            dailyWaGroup={dailyWaGroup}
            npWaGroup={npWaGroup}
            exportSettings={exportSettings}
            gmailUser={gmailUser}
            setGmailUser={setGmailUser}
            gmailPassword={gmailPassword}
            setGmailPassword={setGmailPassword}
            showPassword={showPassword}
            setShowPassword={setShowPassword}
            savingGmail={savingGmail}
            saveGmailSettings={saveGmailSettings}
          />
        </TabsContent>
      </Tabs>

      {activeJobId && (
        <ExportProgressDialog
          jobId={activeJobId}
          mode={activeMode}
          open={progressOpen}
          onClose={() => {
            setProgressOpen(false);
            setActiveJobId("");
            refetchBackup();
          }}
        />
      )}
    </div>
  );
}
