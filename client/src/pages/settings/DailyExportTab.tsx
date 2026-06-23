import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Calendar, Download, Mail, MessageSquare, ChevronDown, RefreshCw } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Recipient, ExportSettings, Company, BackupStatus } from "./ExportCenterTypes";
import { BackupStatusCard } from "./BackupStatusCard";

interface DailyExportTabProps {
  backupStatus?: BackupStatus;
  backupFetching: boolean;
  refetchBackup: () => void;
  companies: Company[];
  fromDate: string;
  setFromDate: (d: string) => void;
  toDate: string;
  setToDate: (d: string) => void;
  startExport: (mode: "download" | "email") => void;
  recipients: Recipient[];
  settings?: ExportSettings;
  waReady: boolean;
  sendingWa: boolean;
  sendViaWhatsApp: () => void;
  showCompanies: boolean;
  setShowCompanies: (v: boolean | ((v: boolean) => boolean)) => void;
  showHistory: boolean;
  setShowHistory: (v: boolean | ((v: boolean) => boolean)) => void;
  historyFilter: string;
  setHistoryFilter: (f: string) => void;
  filteredRuns: any[];
}

import { Badge } from "@/components/ui/badge";
import { RunRow } from "./BackupRunRow";

export function DailyExportTab({
  backupStatus,
  backupFetching,
  refetchBackup,
  companies,
  fromDate,
  setFromDate,
  toDate,
  setToDate,
  startExport,
  recipients,
  settings,
  waReady,
  sendingWa,
  sendViaWhatsApp,
  showCompanies,
  setShowCompanies,
  showHistory,
  setShowHistory,
  historyFilter,
  setHistoryFilter,
  filteredRuns,
}: DailyExportTabProps) {
  return (
    <div className="space-y-4 mt-4">
      {/* Backup Status */}
      <div className="grid grid-cols-1 gap-4">
        {backupStatus && (
          <BackupStatusCard status={backupStatus} onRefresh={refetchBackup} isRefreshing={backupFetching} />
        )}
      </div>

      {/* Companies summary */}
      <div className="border rounded-md">
        <button
          className="w-full flex items-center justify-between p-4 text-left hover-elevate"
          onClick={() => setShowCompanies((v) => !v)}
          data-testid="button-toggle-companies"
        >
          <span className="font-medium flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Included Companies
            <Badge variant="secondary" className="ml-1">
              {companies.length}
            </Badge>
          </span>
          {showCompanies ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
        {showCompanies && (
          <div className="border-t p-4 flex flex-wrap gap-2 bg-muted/20">
            {companies.map((c) => (
              <Badge key={c.id} variant="outline" className="bg-background">
                {c.name}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Export Actions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Download className="h-4 w-4" /> Manual Export
          </CardTitle>
          <CardDescription>Scope by date or leave blank for full history.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                From
              </Label>
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-40"
                data-testid="input-daily-from"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                To
              </Label>
              <Input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-40"
                data-testid="input-daily-to"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button disabled={companies.length === 0} data-testid="button-export-now">
                  Trigger Export <ChevronDown className="h-4 w-4 ml-2" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={() => startExport("download")} data-testid="menu-export-download">
                  <Download className="h-4 w-4 mr-2" /> Download ZIP
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => startExport("email")}
                  disabled={recipients.length === 0 || !settings?.gmailUser}
                  data-testid="menu-export-email"
                >
                  <Mail className="h-4 w-4 mr-2" /> Send via Email
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={sendViaWhatsApp}
                  disabled={!waReady || sendingWa}
                  data-testid="menu-export-whatsapp"
                >
                  <MessageSquare className="h-4 w-4 mr-2 text-green-600" />{" "}
                  {sendingWa ? "Sending..." : "Send via WhatsApp"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardContent>
      </Card>

      {/* History log */}
      <div className="border rounded-md">
        <button
          className="w-full flex items-center justify-between p-4 text-left hover-elevate"
          onClick={() => setShowHistory((v) => !v)}
          data-testid="button-toggle-history"
        >
          <span className="font-medium flex items-center gap-2">
            <RefreshCw className="h-4 w-4" />
            Recent Runs History
          </span>
          {showHistory ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </button>

        {showHistory && (
          <div className="border-t p-4 space-y-3">
            {/* Filter pills */}
            {(backupStatus?.recentRuns ?? []).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {["all", "success", "failed", "running"].map((f) => (
                  <button
                    key={f}
                    onClick={() => setHistoryFilter(f)}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${historyFilter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover-elevate"}`}
                    data-testid={`filter-history-${f}`}
                  >
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>
            )}

            {filteredRuns.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {(backupStatus?.recentRuns ?? []).length === 0
                  ? "No backup runs recorded yet. Trigger a manual send or wait for the scheduled run."
                  : "No runs match this filter."}
              </p>
            ) : (
              <div className="space-y-2">
                {filteredRuns.map((run) => (
                  <RunRow key={run.id} run={run} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

import { Building2, ChevronRight } from "lucide-react";
