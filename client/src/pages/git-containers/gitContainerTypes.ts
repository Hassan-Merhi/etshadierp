import { Ship, Truck, Package, CheckCircle2, XCircle } from "lucide-react";
import React from "react";

export interface EnrichedContainerRow {
  id: number;
  containerNumber: string;
  companyId: number;
  companyName: string;
  shopName: string | null;
  supplierName: string | null;
  supplierCode: string | null;
  status: string;
  eta: string | null;
  grandTotal: string | null;
  numberPlate: string | null;
  trackingLocation: string | null;
  borderDate: string | null;
  transporter: string | null;
  transportFee: string | null;
  agent: string | null;
  dutyFee: string | null;
  docReceived: boolean | null;
  trackingDescription: string | null;
  blDocs: string | null;
  docsSentDate: string | null;
  freightStatus: string | null;
  trackingLink: string | null;
  poFreight: string | null;
  // ParcelsApp auto-tracking
  trackingProvider: string | null;
  trackingEnabled: boolean;
  trackingAutoUpdate: boolean;
  trackingCarrierHint: string | null;
  trackingLastCheckedAt: string | null;
  trackingLastStatus: string | null;
  trackingLastLocation: string | null;
  trackingLastEventDate: string | null;
  trackingLastDescription: string | null;
  trackingError: string | null;
  trackingChangedAt: string | null;
  trackingDetectedCarrier: string | null;
  trackingFallbackUsed: boolean | null;
  trackingFallbackReason: string | null;
  trackingNextCheckAt: string | null;
  trackingLastSkipReason: string | null;
  maxOffloadDate: string | null;
  daysDelayed: number | null;
  docsReadyNotSent: boolean;
  isOverdue: boolean;
}

export interface GitContainersResponse {
  containers: EnrichedContainerRow[];
  mode: "single" | "all";
  companyId?: number;
  companyName?: string;
  total: number;
}

export interface AuthUser {
  id: number;
  username: string;
  role?: string;
  currentRole?: string | null;
  companyId?: number;
}

export const OTW_COLS = [
  { id: "supplier", label: "Supplier" },
  { id: "company", label: "Company" },
  { id: "shopName", label: "Shop Name" },
  { id: "eta", label: "ETA" },
  { id: "cost", label: "Cost" },
  { id: "freight", label: "Freight" },
  { id: "truckNo", label: "Truck #" },
  { id: "location", label: "Location" },
  { id: "borderDate", label: "Border Date" },
  { id: "maxOffload", label: "Max Offload" },
  { id: "delayed", label: "Delayed" },
  { id: "docs", label: "Docs" },
  { id: "docsSent", label: "Docs Sent" },
  { id: "transporter", label: "Transporter" },
  { id: "transportFee", label: "Transport Fee" },
  { id: "agent", label: "Agent" },
  { id: "dutyFee", label: "Duty Fee" },
  { id: "notes", label: "Notes" },
  { id: "blDocs", label: "BL Docs" },
] as const;

export type OtwColId = (typeof OTW_COLS)[number]["id"];

export const DEFAULT_OTW_COL_VIS: Record<OtwColId, boolean> = Object.fromEntries(
  OTW_COLS.map((c) => [c.id, true])
) as Record<OtwColId, boolean>;

export const ACTIVE_STATUSES = ["OTW", "Sea", "At Port", "Left Dar", "At Border", "In Transit", "Arrived"] as const;

export type ActiveStatus = (typeof ACTIVE_STATUSES)[number];

export const ALL_STATUSES = [...ACTIVE_STATUSES, "Offloaded", "Closed", "Completed"] as const;

export const STATUS_META: Record<string, { color: string; icon: React.ReactNode }> = {
  OTW: {
    color: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300",
    icon: React.createElement(Ship, { className: "h-3 w-3" }),
  },
  Sea: {
    color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    icon: React.createElement(Ship, { className: "h-3 w-3" }),
  },
  "At Port": {
    color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
    icon: React.createElement(Package, { className: "h-3 w-3" }),
  },
  "Left Dar": {
    color: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
    icon: React.createElement(Truck, { className: "h-3 w-3" }),
  },
  "At Border": {
    color: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
    icon: React.createElement(Truck, { className: "h-3 w-3" }),
  },
  "In Transit": {
    color: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
    icon: React.createElement(Truck, { className: "h-3 w-3" }),
  },
  Arrived: {
    color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    icon: React.createElement(CheckCircle2, { className: "h-3 w-3" }),
  },
  Offloaded: {
    color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    icon: React.createElement(Package, { className: "h-3 w-3" }),
  },
  Closed: {
    color: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500",
    icon: React.createElement(XCircle, { className: "h-3 w-3" }),
  },
  Completed: {
    color: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500",
    icon: React.createElement(XCircle, { className: "h-3 w-3" }),
  },
};

export const FREIGHT_META: Record<string, { color: string }> = {
  Yes: { color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" },
  No: { color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" },
  Pending: { color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
};

export function parseNum(v: string | null | undefined): number {
  if (!v) return 0;
  const n = parseFloat(String(v).replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}

export function fmt(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  const parts = d.split("-");
  if (parts.length !== 3) return d;
  const [y, m, day] = parts;
  return `${day}/${m}/${y.slice(2)}`;
}

export type BulkProgress = {
  running: boolean;
  total: number;
  processed: number;
  current: string | null;
  startedAt: number | null;
  completedAt: number | null;
};

export interface UIPriority {
  tier: PriorityTier;
  label: string;
  reason: string;
  intervalHours: number;
}

export function getContainerPriority(c: EnrichedContainerRow): UIPriority {
  const statusLower = c.status.toLowerCase();
  const now = new Date();
  const etaDate = c.eta ? new Date(c.eta) : null;
  const daysUntilEta = etaDate !== null ? Math.ceil((etaDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null;
  const etaPassed = daysUntilEta !== null && daysUntilEta < 0;
  const hasTruck = !!(c.numberPlate && c.numberPlate.trim());

  if (etaPassed && !hasTruck)
    return { tier: "high", label: "High", reason: "ETA passed — no truck assigned", intervalHours: 24 };
  if (c.isOverdue) return { tier: "high", label: "High", reason: "Container is overdue", intervalHours: 24 };
  if (c.docsReadyNotSent)
    return { tier: "high", label: "High", reason: "Docs ready — not yet sent", intervalHours: 24 };
  if (statusLower === "at port")
    return { tier: "high", label: "High", reason: "At Port — arrival imminent", intervalHours: 24 };
  if (statusLower === "left dar")
    return { tier: "high", label: "High", reason: "Left Dar — final delivery leg", intervalHours: 24 };
  if (statusLower === "at border")
    return { tier: "high", label: "High", reason: "At Border — clearing customs", intervalHours: 24 };
  if (statusLower === "in transit")
    return { tier: "high", label: "High", reason: "In Transit — active movement", intervalHours: 24 };
  if (daysUntilEta !== null && daysUntilEta >= 0 && daysUntilEta <= 3)
    return {
      tier: "high",
      label: "High",
      reason: `ETA in \${daysUntilEta} day\${daysUntilEta !== 1 ? "s" : ""}`,
      intervalHours: 24,
    };
  if (daysUntilEta !== null && daysUntilEta >= 0 && daysUntilEta <= 7)
    return { tier: "medium", label: "Medium", reason: `ETA in \${daysUntilEta} days`, intervalHours: 48 };
  if (statusLower === "arrived")
    return { tier: "medium", label: "Medium", reason: "Arrived — awaiting offload", intervalHours: 48 };
  if (daysUntilEta !== null && daysUntilEta >= 0 && daysUntilEta <= 14)
    return { tier: "medium", label: "Medium", reason: `ETA in \${daysUntilEta} days`, intervalHours: 48 };
  if (daysUntilEta !== null && daysUntilEta > 14) {
    const intervalHours = daysUntilEta > 21 ? 120 : 96;
    return { tier: "low", label: "Low", reason: `ETA in \${daysUntilEta} days`, intervalHours };
  }
  return { tier: "low", label: "Low", reason: "No ETA set", intervalHours: 120 };
}

export function fmtSkipReason(raw: string | null): string | null {
  if (!raw) return null;
  if (raw === "skipped_recent") return "Checked recently — waiting for next interval";
  if (raw === "skipped_priority_budget") return "Lower priority — skipped this run to save quota";
  if (raw === "skipped_disabled") return "Auto-update is turned off";
  if (raw === "skipped_quota") return "All quota exhausted — scraper, 17track, and ParcelsApp API all unavailable";
  if (raw === "invalid_container_number") return "Container number is not a valid format";
  if (raw === "scraper_blocked") return "Web scraper blocked by reCaptcha — fell back to 17track or ParcelsApp API";
  return raw;
}

export interface DrawerForm {
  eta: string;
  status: string;
  transporter: string;
  transportFee: string;
  numberPlate: string;
  trackingLocation: string;
  borderDate: string;
  agent: string;
  dutyFee: string;
  docReceived: boolean;
  docsSentDate: string;
  trackingLink: string;
  trackingDescription: string;
  blDocs: string;
  shopName: string;
}

export function seedForm(c: EnrichedContainerRow): DrawerForm {
  return {
    eta: c.eta ?? "",
    status: c.status,
    transporter: c.transporter ?? "",
    transportFee: c.transportFee ?? "",
    numberPlate: c.numberPlate ?? "",
    trackingLocation: c.trackingLocation ?? "",
    borderDate: c.borderDate ?? "",
    agent: c.agent ?? "",
    dutyFee: c.dutyFee ?? "",
    docReceived: c.docReceived === true,
    docsSentDate: c.docsSentDate ?? "",
    trackingLink: c.trackingLink ?? "",
    trackingDescription: c.trackingDescription ?? "",
    blDocs: c.blDocs ?? "",
    shopName: c.shopName ?? "",
  };
}

export const TRANSPORTER_OPTIONS = ["FARHAT", "CONTINENTAL", "KDOUH", "TRH"];
