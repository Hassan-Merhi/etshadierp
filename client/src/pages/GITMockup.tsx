/**
 * GIT — MOCKUP PAGE (planning phase only)
 * Workbook / spreadsheet-style replacement for the daily GIT Excel sheet.
 * All data is hard-coded. No DB reads or writes.
 *
 * Tabs:
 *   1. GIT Summary  — workbook-style totals, needs-attention breakdown
 *   2. GIT Detail   — Workbook View (default) + Flat Table toggle
 *   3. At Port / Sea — grouped by status: Sea/OTW | At Port | Left Dar
 *   4. WhatsApp Preview — formatted text message
 */

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Ship, Truck, Package, AlertTriangle, FileX, Clock, DollarSign,
  Search, ExternalLink, CheckCircle2, XCircle, MessageSquare,
  FileSpreadsheet, LayoutGrid, List,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type Status =
  | "OTW" | "Sea" | "At Port" | "Left Dar"
  | "At Border" | "In Transit" | "Arrived" | "Offloaded";

type GroupId =
  | "hadi1-lsh" | "hadi2-lsh" | "gc-lsh"
  | "hadi-kolwezi" | "kinshasa" | "mali" | "port-dar";

interface GITRow {
  sr: number;
  group: GroupId;
  containerNumber: string;
  amount: number;
  company: string;
  eta: string | null;
  numberPlate: string | null;
  location: string | null;
  borderDate: string | null;
  docsReceived: boolean;
  docsSentToTruck: boolean;
  transporter: string | null;
  transportFee: number | null;
  agent: string | null;
  dutyFee: number | null;
  freightStatus: "Yes" | "No" | "Pending" | null;
  status: Status;
  trackingLink: string | null;
  notes: string | null;
}

interface GITGroupDef {
  id: GroupId;
  title: string;
  subtitle: string;
  headerBg: string;
  headerText: string;
}

// ─── Group Definitions ────────────────────────────────────────────────────────

const GROUP_DEFS: GITGroupDef[] = [
  { id: "hadi1-lsh",    title: "HADI #1",        subtitle: "CONTAINERS OTW — LUBUMBASHI",  headerBg: "bg-yellow-400",   headerText: "text-yellow-950" },
  { id: "hadi2-lsh",    title: "HADI #2",         subtitle: "CONTAINERS OTW — LUBUMBASHI",  headerBg: "bg-orange-400",   headerText: "text-orange-950" },
  { id: "gc-lsh",       title: "GOLDEN COAST",    subtitle: "CONTAINERS OTW — LUBUMBASHI",  headerBg: "bg-teal-600",     headerText: "text-white" },
  { id: "hadi-kolwezi", title: "HADI",            subtitle: "CONTAINERS OTW — KOLWEZI",     headerBg: "bg-green-600",    headerText: "text-white" },
  { id: "kinshasa",     title: "OTW",             subtitle: "KINSHASA #2",                  headerBg: "bg-purple-600",   headerText: "text-white" },
  { id: "mali",         title: "OTW",             subtitle: "MALI",                         headerBg: "bg-cyan-600",     headerText: "text-white" },
  { id: "port-dar",     title: "CONTAINERS AT PORT", subtitle: "DAR ES SALAAM",             headerBg: "bg-red-600",      headerText: "text-white" },
];

// ─── Mock Data ────────────────────────────────────────────────────────────────

const ROWS: GITRow[] = [
  // ── HADI #1 — OTW LUBUMBASHI ───────────────────────────────────────────────
  { sr:1,  group:"hadi1-lsh", containerNumber:"CAAU6065353", amount:41568.05, company:"EG",  eta:"2026-02-26", numberPlate:"T303 AAD", location:"MPIKA",      borderDate:"2026-03-02", docsReceived:true,  docsSentToTruck:true,  transporter:"CONTINENTAL", transportFee:9800,  agent:"NAHLI", dutyFee:8500, freightStatus:"Yes",     status:"Arrived",    trackingLink:null, notes:null },
  { sr:2,  group:"hadi1-lsh", containerNumber:"MRSU3216638", amount:39503.00, company:"EG",  eta:"2026-03-18", numberPlate:"T609 DHR", location:"TUNDUMA",    borderDate:"2026-03-22", docsReceived:true,  docsSentToTruck:true,  transporter:"CONTINENTAL", transportFee:9800,  agent:"NAHLI", dutyFee:8500, freightStatus:"Yes",     status:"In Transit", trackingLink:null, notes:null },
  { sr:3,  group:"hadi1-lsh", containerNumber:"MRSU5491459", amount:38459.05, company:"EG",  eta:"2026-05-23", numberPlate:null,        location:null,         borderDate:null,         docsReceived:false, docsSentToTruck:false, transporter:null,          transportFee:null,  agent:"NAHLI", dutyFee:8500, freightStatus:"No",      status:"OTW",        trackingLink:null, notes:null },
  { sr:4,  group:"hadi1-lsh", containerNumber:"SEKU4470393", amount:39890.95, company:"EG",  eta:"2026-05-23", numberPlate:null,        location:null,         borderDate:null,         docsReceived:false, docsSentToTruck:false, transporter:null,          transportFee:null,  agent:"NAHLI", dutyFee:8500, freightStatus:"No",      status:"OTW",        trackingLink:null, notes:null },
  { sr:5,  group:"hadi1-lsh", containerNumber:"MSCU1786517", amount:39224.05, company:"EG",  eta:"2026-05-23", numberPlate:null,        location:null,         borderDate:null,         docsReceived:false, docsSentToTruck:false, transporter:null,          transportFee:null,  agent:"NAHLI", dutyFee:8500, freightStatus:"No",      status:"OTW",        trackingLink:null, notes:null },
  { sr:6,  group:"hadi1-lsh", containerNumber:"HASU5110162", amount:38494.60, company:"EG",  eta:"2026-05-23", numberPlate:null,        location:null,         borderDate:null,         docsReceived:false, docsSentToTruck:false, transporter:null,          transportFee:null,  agent:"NAHLI", dutyFee:8500, freightStatus:"No",      status:"OTW",        trackingLink:null, notes:null },
  { sr:7,  group:"hadi1-lsh", containerNumber:"DCKU5891839", amount:38810.35, company:"3AP", eta:"2026-05-23", numberPlate:null,        location:null,         borderDate:null,         docsReceived:false, docsSentToTruck:false, transporter:null,          transportFee:null,  agent:"NAHLI", dutyFee:8500, freightStatus:"No",      status:"OTW",        trackingLink:null, notes:null },
  { sr:8,  group:"hadi1-lsh", containerNumber:"SUDU7034993", amount:37037.40, company:"3AP", eta:"2026-06-08", numberPlate:null,        location:null,         borderDate:null,         docsReceived:false, docsSentToTruck:false, transporter:null,          transportFee:null,  agent:"NAHLI", dutyFee:8500, freightStatus:"No",      status:"Sea",        trackingLink:null, notes:null },
  { sr:9,  group:"hadi1-lsh", containerNumber:"SUDU8959140", amount:42188.50, company:"3AP", eta:"2026-02-26", numberPlate:"T791 CDG", location:"MBALA",      borderDate:"2026-03-01", docsReceived:true,  docsSentToTruck:true,  transporter:"CONTINENTAL", transportFee:9800,  agent:"NCA",   dutyFee:8500, freightStatus:"Yes",     status:"Arrived",    trackingLink:null, notes:null },
  { sr:10, group:"hadi1-lsh", containerNumber:"MSKU1457569", amount:39306.00, company:"3AP", eta:"2026-03-18", numberPlate:null,        location:null,         borderDate:"2026-03-24", docsReceived:true,  docsSentToTruck:false, transporter:"CONTINENTAL", transportFee:9800,  agent:"NCA",   dutyFee:8500, freightStatus:"Pending", status:"At Port",    trackingLink:null, notes:"Docs ready, awaiting truck" },
  { sr:11, group:"hadi1-lsh", containerNumber:"MRKU5513611", amount:38766.70, company:"3AP", eta:"2026-05-23", numberPlate:null,        location:null,         borderDate:null,         docsReceived:false, docsSentToTruck:false, transporter:null,          transportFee:null,  agent:"NCA",   dutyFee:8500, freightStatus:"No",      status:"OTW",        trackingLink:null, notes:null },
  { sr:12, group:"hadi1-lsh", containerNumber:"MRSU4304962", amount:39317.20, company:"3AP", eta:"2026-05-23", numberPlate:null,        location:null,         borderDate:null,         docsReceived:false, docsSentToTruck:false, transporter:null,          transportFee:null,  agent:"NAHLI", dutyFee:8500, freightStatus:"No",      status:"OTW",        trackingLink:null, notes:null },
  { sr:13, group:"hadi1-lsh", containerNumber:"MRSU7943419", amount:38446.00, company:"3AP", eta:"2026-04-24", numberPlate:null,        location:null,         borderDate:null,         docsReceived:true,  docsSentToTruck:false, transporter:null,          transportFee:9800,  agent:"NAHLI", dutyFee:8500, freightStatus:"Pending", status:"At Port",    trackingLink:null, notes:null },
  { sr:14, group:"hadi1-lsh", containerNumber:"MRKU3181091", amount:39935.25, company:"3AP", eta:"2026-05-23", numberPlate:null,        location:null,         borderDate:null,         docsReceived:false, docsSentToTruck:false, transporter:null,          transportFee:null,  agent:"NAHLI", dutyFee:8500, freightStatus:"No",      status:"OTW",        trackingLink:null, notes:null },

  // ── HADI #2 — OTW LUBUMBASHI ───────────────────────────────────────────────
  { sr:1,  group:"hadi2-lsh", containerNumber:"MRKU4157373", amount:42504.25, company:"MJS", eta:"2026-02-03", numberPlate:"T767 EEV", location:"KASUMBALESA", borderDate:"2026-04-05", docsReceived:true,  docsSentToTruck:true,  transporter:"TRH",         transportFee:9000,  agent:"NAHLI", dutyFee:8500, freightStatus:"Yes",     status:"In Transit", trackingLink:"https://track.example.com/MRKU4157373", notes:null },
  { sr:2,  group:"hadi2-lsh", containerNumber:"MSNU9482779", amount:40224.50, company:"MJS", eta:"2026-03-18", numberPlate:"T280 DEB", location:"ISOKA",       borderDate:"2026-03-22", docsReceived:true,  docsSentToTruck:true,  transporter:"FARHAT",      transportFee:11410, agent:"NAHLI", dutyFee:8500, freightStatus:"Yes",     status:"In Transit", trackingLink:null, notes:null },
  { sr:3,  group:"hadi2-lsh", containerNumber:"TCKU6871283", amount:47451.00, company:"MJS", eta:"2026-05-23", numberPlate:null,        location:null,          borderDate:null,         docsReceived:false, docsSentToTruck:false, transporter:null,          transportFee:null,  agent:"NAHLI", dutyFee:8500, freightStatus:"No",      status:"OTW",        trackingLink:null, notes:null },
  { sr:4,  group:"hadi2-lsh", containerNumber:"MSKU1758728", amount:48693.50, company:"MJS", eta:"2026-05-23", numberPlate:null,        location:null,          borderDate:null,         docsReceived:false, docsSentToTruck:false, transporter:null,          transportFee:null,  agent:"NAHLI", dutyFee:8500, freightStatus:"No",      status:"OTW",        trackingLink:null, notes:null },
  { sr:5,  group:"hadi2-lsh", containerNumber:"TCNU4693444", amount:49754.25, company:"MJS", eta:"2026-05-28", numberPlate:null,        location:null,          borderDate:null,         docsReceived:true,  docsSentToTruck:false, transporter:null,          transportFee:11200, agent:"NAHLI", dutyFee:8500, freightStatus:"Pending", status:"OTW",        trackingLink:null, notes:null },
  { sr:6,  group:"hadi2-lsh", containerNumber:"SUDU6817960", amount:46083.50, company:"MJS", eta:"2026-04-25", numberPlate:null,        location:null,          borderDate:null,         docsReceived:true,  docsSentToTruck:false, transporter:"CONTINENTAL", transportFee:9800,  agent:"NAHLI", dutyFee:8500, freightStatus:"Pending", status:"At Port",    trackingLink:null, notes:null },
  { sr:7,  group:"hadi2-lsh", containerNumber:"CAAU8996519", amount:47475.25, company:"MJS", eta:"2026-05-02", numberPlate:null,        location:null,          borderDate:null,         docsReceived:true,  docsSentToTruck:false, transporter:"CONTINENTAL", transportFee:9800,  agent:"NAHLI", dutyFee:8500, freightStatus:"Pending", status:"At Port",    trackingLink:null, notes:"Awaiting truck assignment" },
  { sr:8,  group:"hadi2-lsh", containerNumber:"MRSU9212305", amount:47042.75, company:"MJS", eta:"2026-05-30", numberPlate:null,        location:null,          borderDate:null,         docsReceived:false, docsSentToTruck:false, transporter:null,          transportFee:null,  agent:"NAHLI", dutyFee:8500, freightStatus:"No",      status:"Sea",        trackingLink:null, notes:null },
  { sr:9,  group:"hadi2-lsh", containerNumber:"MSKU3237946", amount:47458.50, company:"MJS", eta:"2026-06-01", numberPlate:null,        location:null,          borderDate:null,         docsReceived:false, docsSentToTruck:false, transporter:null,          transportFee:null,  agent:"NAHLI", dutyFee:8500, freightStatus:"No",      status:"Sea",        trackingLink:null, notes:null },
  { sr:10, group:"hadi2-lsh", containerNumber:"CAAU6658493", amount:36322.90, company:"GS",  eta:"2026-03-18", numberPlate:"T218 DEQ", location:"MPEMBA",      borderDate:"2026-03-24", docsReceived:true,  docsSentToTruck:true,  transporter:"CONTINENTAL", transportFee:9800,  agent:"NAHLI", dutyFee:8500, freightStatus:"Yes",     status:"In Transit", trackingLink:null, notes:null },
  { sr:11, group:"hadi2-lsh", containerNumber:"MSFU5640434", amount:34968.22, company:"GS",  eta:"2026-05-02", numberPlate:null,        location:null,          borderDate:null,         docsReceived:true,  docsSentToTruck:false, transporter:"FARHAT",      transportFee:11200, agent:"NAHLI", dutyFee:8500, freightStatus:"Pending", status:"At Port",    trackingLink:null, notes:null },
  { sr:12, group:"hadi2-lsh", containerNumber:"TCNU3945946", amount:35461.29, company:"GS",  eta:"2026-05-02", numberPlate:null,        location:null,          borderDate:null,         docsReceived:true,  docsSentToTruck:false, transporter:"FARHAT",      transportFee:11200, agent:"NAHLI", dutyFee:8500, freightStatus:"Pending", status:"At Port",    trackingLink:null, notes:null },
  { sr:13, group:"hadi2-lsh", containerNumber:"MRSU6080329", amount:35098.09, company:"GS",  eta:"2026-06-08", numberPlate:null,        location:null,          borderDate:null,         docsReceived:false, docsSentToTruck:false, transporter:null,          transportFee:null,  agent:"NAHLI", dutyFee:8500, freightStatus:"No",      status:"Sea",        trackingLink:null, notes:null },
  { sr:14, group:"hadi2-lsh", containerNumber:"MSCU0920792", amount:35396.09, company:"GS",  eta:"2026-06-08", numberPlate:null,        location:null,          borderDate:null,         docsReceived:false, docsSentToTruck:false, transporter:null,          transportFee:null,  agent:"NAHLI", dutyFee:8500, freightStatus:"No",      status:"Sea",        trackingLink:null, notes:null },

  // ── GOLDEN COAST — OTW LUBUMBASHI (currently empty) ───────────────────────
  // (no rows — demonstrates an empty group block)

  // ── HADI — OTW KOLWEZI ─────────────────────────────────────────────────────
  { sr:1,  group:"hadi-kolwezi", containerNumber:"HLCU3312984", amount:55000.00, company:"MJS", eta:"2026-05-12", numberPlate:"T456 DEF", location:"KASUMBALESA", borderDate:"2026-05-18", docsReceived:true,  docsSentToTruck:true,  transporter:"TRH",    transportFee:3500,  agent:"BELTRANS", dutyFee:6300, freightStatus:"Yes",     status:"In Transit", trackingLink:null, notes:null },
  { sr:2,  group:"hadi-kolwezi", containerNumber:"CMAU7765431", amount:41200.00, company:"MJS", eta:"2026-04-28", numberPlate:null,        location:"Dar Port",    borderDate:null,         docsReceived:true,  docsSentToTruck:true,  transporter:"FARHAT", transportFee:3000,  agent:"BELTRANS", dutyFee:4900, freightStatus:"Yes",     status:"At Port",    trackingLink:null, notes:"Delayed — truck not assigned" },
  { sr:3,  group:"hadi-kolwezi", containerNumber:"GESU4421098", amount:38700.00, company:"MJS", eta:"2026-05-22", numberPlate:null,        location:null,          borderDate:null,         docsReceived:false, docsSentToTruck:false, transporter:"TRH",    transportFee:2600,  agent:null,       dutyFee:null, freightStatus:"No",      status:"OTW",        trackingLink:"https://track.example.com/GESU4421098", notes:"ETA DAS confirmed" },
  { sr:4,  group:"hadi-kolwezi", containerNumber:"EITU1198823", amount:29800.00, company:"MJS", eta:"2026-06-15", numberPlate:null,        location:null,          borderDate:null,         docsReceived:false, docsSentToTruck:false, transporter:null,     transportFee:null,  agent:null,       dutyFee:null, freightStatus:"Pending", status:"Sea",        trackingLink:null, notes:"New shipment" },
  { sr:5,  group:"hadi-kolwezi", containerNumber:"TRHU9182736", amount:44600.00, company:"EG",  eta:"2026-04-25", numberPlate:"T654 MNO", location:"Lubumbashi",  borderDate:"2026-04-30", docsReceived:true,  docsSentToTruck:true,  transporter:"TRH",    transportFee:3100,  agent:"BELTRANS", dutyFee:5500, freightStatus:"Yes",     status:"Arrived",    trackingLink:null, notes:null },

  // ── OTW KINSHASA ───────────────────────────────────────────────────────────
  { sr:1,  group:"kinshasa", containerNumber:"GAOU7275696", amount:47957.50, company:"AJ", eta:"2026-05-15", numberPlate:null, location:null, borderDate:null, docsReceived:true,  docsSentToTruck:false, transporter:null, transportFee:402.50, agent:"HUSSAIN SAAD", dutyFee:null, freightStatus:"Pending", status:"OTW",  trackingLink:"https://track.example.com/GAOU7275696", notes:"Arriving" },
  { sr:2,  group:"kinshasa", containerNumber:"SEKU6901777", amount:51718.75, company:"AJ", eta:"2026-08-01", numberPlate:null, location:null, borderDate:null, docsReceived:false, docsSentToTruck:false, transporter:null, transportFee:402.50, agent:"HUSSAIN SAAD", dutyFee:null, freightStatus:"No",      status:"Sea",  trackingLink:null, notes:"Through Oman" },
  { sr:3,  group:"kinshasa", containerNumber:"CMAU6837494", amount:59210.00, company:"AJ", eta:"2026-06-06", numberPlate:null, location:null, borderDate:null, docsReceived:false, docsSentToTruck:false, transporter:null, transportFee:400.00, agent:"RIDA SALEH",   dutyFee:null, freightStatus:"No",      status:"Sea",  trackingLink:null, notes:"Through Oman" },
  { sr:4,  group:"kinshasa", containerNumber:"MRKU3072559", amount:39306.90, company:"GS", eta:"2026-07-07", numberPlate:null, location:null, borderDate:null, docsReceived:false, docsSentToTruck:false, transporter:null, transportFee:407.50, agent:"HUSSAIN SAAD", dutyFee:null, freightStatus:"No",      status:"Sea",  trackingLink:null, notes:"Through Oman" },
  { sr:5,  group:"kinshasa", containerNumber:"CAIU6678432", amount:53200.00, company:"AJ", eta:"2026-05-28", numberPlate:null, location:null, borderDate:null, docsReceived:false, docsSentToTruck:false, transporter:null, transportFee:402.50, agent:"HUSSAIN SAAD", dutyFee:null, freightStatus:"No",      status:"OTW",  trackingLink:null, notes:null },
  { sr:6,  group:"kinshasa", containerNumber:"OOLU5541230", amount:35000.00, company:"HMD", eta:"2026-06-10", numberPlate:null, location:null, borderDate:null, docsReceived:false, docsSentToTruck:false, transporter:null, transportFee:402.50, agent:"HUSSAIN SAAD", dutyFee:null, freightStatus:"No",     status:"Sea",  trackingLink:"https://track.example.com/OOLU5541230", notes:null },

  // ── OTW MALI ───────────────────────────────────────────────────────────────
  { sr:1,  group:"mali", containerNumber:"MRSU4144595", amount:33153.00, company:"SH",  eta:"2026-05-26", numberPlate:null, location:null, borderDate:null, docsReceived:false, docsSentToTruck:false, transporter:null, transportFee:null, agent:null, dutyFee:null, freightStatus:"No",  status:"OTW", trackingLink:"https://track.example.com/MRSU4144595", notes:null },
  { sr:2,  group:"mali", containerNumber:"TXGU8434249", amount:39606.00, company:"HMD", eta:"2026-05-17", numberPlate:null, location:null, borderDate:null, docsReceived:false, docsSentToTruck:false, transporter:null, transportFee:null, agent:null, dutyFee:null, freightStatus:"No",  status:"OTW", trackingLink:null, notes:"No link" },

  // ── CONTAINERS AT PORT — DAR ────────────────────────────────────────────────
  { sr:1,  group:"port-dar", containerNumber:"MSCU1234567", amount:48500.00, company:"HADI", eta:"2026-05-05", numberPlate:"T123 ABC", location:"Dar Port", borderDate:"2026-05-08", docsReceived:true,  docsSentToTruck:true,  transporter:"FARHAT",      transportFee:11200, agent:"ATLAS",   dutyFee:8500, freightStatus:"Yes",     status:"Left Dar",   trackingLink:"https://track.example.com/MSCU1234567", notes:null },
  { sr:2,  group:"port-dar", containerNumber:"TCKU8876543", amount:62000.00, company:"MJS",  eta:"2026-05-08", numberPlate:null,        location:"Dar Port", borderDate:null,         docsReceived:false, docsSentToTruck:false, transporter:"CONTINENTAL", transportFee:9800,  agent:"BELTRANS", dutyFee:7200, freightStatus:"Pending", status:"At Port",    trackingLink:null, notes:"Awaiting customs release" },
  { sr:3,  group:"port-dar", containerNumber:"CAIU9988001", amount:71500.00, company:"HADI", eta:"2026-05-04", numberPlate:"T789 GHI", location:"Dar Port", borderDate:null,         docsReceived:true,  docsSentToTruck:false, transporter:"FARHAT",      transportFee:11200, agent:"ATLAS",   dutyFee:8100, freightStatus:"Pending", status:"At Port",    trackingLink:null, notes:"Docs ready, truck pending" },
  { sr:4,  group:"port-dar", containerNumber:"OOLU4421112", amount:38700.00, company:"GS",   eta:"2026-05-12", numberPlate:null,        location:"Dar Port", borderDate:null,         docsReceived:false, docsSentToTruck:false, transporter:"TRH",         transportFee:3500,  agent:"BELTRANS", dutyFee:null, freightStatus:"No",      status:"At Port",    trackingLink:null, notes:null },
  { sr:5,  group:"port-dar", containerNumber:"SUDU3312000", amount:44200.00, company:"EG",   eta:"2026-05-15", numberPlate:null,        location:"Dar Port", borderDate:null,         docsReceived:false, docsSentToTruck:false, transporter:null,          transportFee:null,  agent:"NAHLI",   dutyFee:8500, freightStatus:"No",      status:"At Port",    trackingLink:null, notes:"License plate not assigned" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ACTIVE_STATUSES: Status[] = ["OTW", "Sea", "At Port", "Left Dar", "At Border", "In Transit", "Arrived"];

function maxOffload(borderDate: string | null, transporter: string | null): string | null {
  if (!borderDate) return null;
  const t = (transporter ?? "").toUpperCase();
  const days = t.includes("FARHAT") || t.includes("CONTINENTAL") ? 11 : 14;
  const d = new Date(borderDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function daysDelayed(borderDate: string | null, transporter: string | null): number | null {
  const mo = maxOffload(borderDate, transporter);
  if (!mo) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.floor((today.getTime() - new Date(mo).getTime()) / 86400000);
  return diff > 0 ? diff : null;
}

function fmt(n: number, decimals = 0) {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtD(d: string | null) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y.slice(2)}`;
}

function isUpcoming(eta: string | null) {
  if (!eta) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const e = new Date(eta);
  const diff = Math.floor((e.getTime() - today.getTime()) / 86400000);
  return diff >= 0 && diff <= 45;
}

function getRowBg(r: GITRow) {
  if (!r.docsReceived && (r.status === "OTW" || r.status === "Sea") && isUpcoming(r.eta)) {
    return "bg-yellow-100/80 dark:bg-yellow-950/30"; // yellow: upcoming but docs missing
  }
  if (!r.docsReceived && r.status === "At Port") {
    return "bg-rose-100/80 dark:bg-rose-950/30"; // pink: at port, docs missing
  }
  if (r.docsReceived && !r.docsSentToTruck && (r.status === "At Port" || r.status === "Left Dar")) {
    return "bg-amber-50/80 dark:bg-amber-950/20"; // amber: docs ready not sent
  }
  if (daysDelayed(r.borderDate, r.transporter) !== null) {
    return "bg-red-100/80 dark:bg-red-950/30"; // red: overdue
  }
  return "";
}

const STATUS_BADGE: Record<Status, string> = {
  OTW:         "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  Sea:         "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  "At Port":   "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  "Left Dar":  "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  "At Border": "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  "In Transit":"bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300",
  Arrived:     "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  Offloaded:   "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

// ─── Workbook Block ───────────────────────────────────────────────────────────

function WorkbookBlock({ groupDef, rows }: { groupDef: GITGroupDef; rows: GITRow[] }) {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const totalFee = rows.reduce((s, r) => s + (r.transportFee ?? 0), 0);
  const totalDuty = rows.reduce((s, r) => s + (r.dutyFee ?? 0), 0);

  return (
    <div className="rounded-md border overflow-hidden">
      {/* Colored header bar */}
      <div className={cn("flex items-center justify-between px-3 py-1.5 gap-3", groupDef.headerBg, groupDef.headerText)}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-bold text-sm uppercase tracking-wide shrink-0">{groupDef.title}</span>
          <span className="text-xs opacity-80 font-medium truncate">{groupDef.subtitle}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0 text-xs font-semibold">
          <span className="opacity-90">{rows.length} CTR</span>
          {total > 0 && <span className="opacity-90">${fmt(total, 2)}</span>}
        </div>
      </div>

      {/* Mini table */}
      {rows.length === 0 ? (
        <div className="py-4 text-center text-xs text-muted-foreground italic bg-muted/20">
          No containers — empty group
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs whitespace-nowrap border-collapse">
            <thead>
              <tr className="bg-muted/60 border-b text-muted-foreground">
                <th className="py-1 px-2 text-center font-semibold w-8">SR</th>
                <th className="py-1 px-2 font-semibold text-left">CONTAINER #</th>
                <th className="py-1 px-2 font-semibold text-right">AMOUNT</th>
                <th className="py-1 px-2 font-semibold text-left">CO.</th>
                <th className="py-1 px-2 font-semibold text-left">ETA DAS</th>
                <th className="py-1 px-2 font-semibold text-left">TRUCK #</th>
                <th className="py-1 px-2 font-semibold text-left">LOCATION</th>
                <th className="py-1 px-2 font-semibold text-left">BORDER DT.</th>
                <th className="py-1 px-2 font-semibold text-left">MAX OFFLOAD</th>
                <th className="py-1 px-2 font-semibold text-center">DOCS RCVD</th>
                <th className="py-1 px-2 font-semibold text-center">DOCS→TRUCK</th>
                <th className="py-1 px-2 font-semibold text-left">TRANSPORTER</th>
                <th className="py-1 px-2 font-semibold text-right">FEE</th>
                <th className="py-1 px-2 font-semibold text-left">AGENT</th>
                <th className="py-1 px-2 font-semibold text-right">DUTY</th>
                <th className="py-1 px-2 font-semibold text-left">STATUS</th>
                <th className="py-1 px-2 font-semibold text-center">LINK</th>
                <th className="py-1 px-2 font-semibold text-left">NOTES</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const mo = maxOffload(r.borderDate, r.transporter);
                const del = daysDelayed(r.borderDate, r.transporter);
                const overdue = mo ? new Date(mo) < new Date() : false;
                return (
                  <tr key={r.sr} className={cn("border-b last:border-b-0 hover:brightness-95", getRowBg(r))}>
                    <td className="py-0.5 px-2 text-center text-muted-foreground font-medium">{r.sr}</td>
                    <td className="py-0.5 px-2 font-mono font-bold tracking-tight">{r.containerNumber}</td>
                    <td className="py-0.5 px-2 text-right font-semibold">${fmt(r.amount, 2)}</td>
                    <td className="py-0.5 px-2 font-medium">{r.company}</td>
                    <td className={cn("py-0.5 px-2", isUpcoming(r.eta) && !r.borderDate ? "font-semibold text-amber-700 dark:text-amber-400" : "")}>{fmtD(r.eta)}</td>
                    <td className="py-0.5 px-2 font-mono">{r.numberPlate ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="py-0.5 px-2">{r.location ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="py-0.5 px-2">{fmtD(r.borderDate)}</td>
                    <td className={cn("py-0.5 px-2", overdue ? "text-red-600 font-bold" : del ? "text-red-500 font-semibold" : "")}>
                      {fmtD(mo)}
                      {del && <span className="ml-1 text-red-600 text-[10px]">+{del}d</span>}
                    </td>
                    <td className="py-0.5 px-2 text-center">
                      {r.docsReceived
                        ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600 mx-auto" />
                        : <XCircle className="h-3.5 w-3.5 text-red-500 mx-auto" />}
                    </td>
                    <td className="py-0.5 px-2 text-center">
                      {r.docsSentToTruck
                        ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600 mx-auto" />
                        : r.docsReceived
                          ? <span className="px-1 py-0.5 rounded text-[10px] font-medium bg-amber-200 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">READY</span>
                          : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="py-0.5 px-2">{r.transporter ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="py-0.5 px-2 text-right">{r.transportFee ? `$${fmt(r.transportFee, 0)}` : "—"}</td>
                    <td className="py-0.5 px-2 font-medium">{r.agent ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="py-0.5 px-2 text-right">{r.dutyFee ? `$${fmt(r.dutyFee, 0)}` : "—"}</td>
                    <td className="py-0.5 px-2">
                      <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium", STATUS_BADGE[r.status])}>{r.status}</span>
                    </td>
                    <td className="py-0.5 px-2 text-center">
                      {r.trackingLink
                        ? <a href={r.trackingLink} target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/70">
                            <ExternalLink className="h-3 w-3 mx-auto" />
                          </a>
                        : <span className="text-muted-foreground text-[10px]">—</span>}
                    </td>
                    <td className="py-0.5 px-2 max-w-40 truncate text-muted-foreground italic">{r.notes ?? "—"}</td>
                  </tr>
                );
              })}
              {/* Total row */}
              <tr className="border-t-2 bg-muted/50 font-bold text-xs">
                <td className="py-1 px-2 text-center text-muted-foreground">{rows.length}</td>
                <td className="py-1 px-2">TOTAL</td>
                <td className="py-1 px-2 text-right">${fmt(total, 2)}</td>
                <td colSpan={9} />
                <td className="py-1 px-2 text-right">{totalFee > 0 ? `$${fmt(totalFee, 0)}` : "—"}</td>
                <td />
                <td className="py-1 px-2 text-right">{totalDuty > 0 ? `$${fmt(totalDuty, 0)}` : "—"}</td>
                <td colSpan={3} />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Legend strip ─────────────────────────────────────────────────────────────

function WorkbookLegend() {
  return (
    <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground px-1">
      <span className="font-medium">Row colour:</span>
      <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-yellow-200 border border-yellow-400" /> Upcoming ETA, docs pending</span>
      <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-rose-200 border border-rose-400" /> At port, docs missing</span>
      <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-amber-100 border border-amber-300" /> Docs ready, not sent to truck</span>
      <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-red-200 border border-red-400" /> Offload overdue</span>
    </div>
  );
}

// ─── Tab 2: GIT Detail ────────────────────────────────────────────────────────

function TabDetail({ rows }: { rows: GITRow[] }) {
  const [view, setView] = useState<"workbook" | "flat">("workbook");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) =>
      r.containerNumber.toLowerCase().includes(q) ||
      r.company.toLowerCase().includes(q) ||
      (r.transporter ?? "").toLowerCase().includes(q) ||
      (r.agent ?? "").toLowerCase().includes(q) ||
      (r.numberPlate ?? "").toLowerCase().includes(q) ||
      (r.location ?? "").toLowerCase().includes(q) ||
      r.group.toLowerCase().includes(q)
    );
  }, [rows, search]);

  const totals = {
    amount: filtered.reduce((s, r) => s + r.amount, 0),
    fee: filtered.reduce((s, r) => s + (r.transportFee ?? 0), 0),
    duty: filtered.reduce((s, r) => s + (r.dutyFee ?? 0), 0),
  };

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search container, company, truck, agent…"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-git-detail-search"
          />
        </div>
        <span className="text-xs text-muted-foreground">{filtered.length} rows</span>
        <div className="flex items-center gap-1 ml-auto">
          <Button
            size="sm"
            variant={view === "workbook" ? "default" : "outline"}
            className="gap-1.5"
            onClick={() => setView("workbook")}
            data-testid="button-view-workbook"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Workbook
          </Button>
          <Button
            size="sm"
            variant={view === "flat" ? "default" : "outline"}
            className="gap-1.5"
            onClick={() => setView("flat")}
            data-testid="button-view-flat"
          >
            <List className="h-3.5 w-3.5" />
            Flat Table
          </Button>
        </div>
      </div>

      {view === "workbook" ? (
        <div className="space-y-4">
          <WorkbookLegend />
          {GROUP_DEFS.map((gd) => {
            const groupRows = filtered.filter((r) => r.group === gd.id);
            if (search && groupRows.length === 0) return null;
            return <WorkbookBlock key={gd.id} groupDef={gd} rows={groupRows} />;
          })}
          {/* Grand total bar */}
          {filtered.length > 0 && (
            <div className="flex items-center justify-between px-3 py-1.5 rounded-md bg-zinc-800 dark:bg-zinc-700 text-white text-xs font-bold">
              <span>TOTAL OTW — ALL GROUPS ({filtered.length} containers)</span>
              <div className="flex gap-4">
                <span>CTR COST: ${fmt(totals.amount, 2)}</span>
                <span>TRANSPORT: ${fmt(totals.fee, 0)}</span>
                <span>DUTY: ${fmt(totals.duty, 0)}</span>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ── Flat table view ── */
        <div className="rounded-md border overflow-x-auto">
          <Table className="text-xs whitespace-nowrap">
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="w-8 text-center">SR</TableHead>
                <TableHead>Container #</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Group</TableHead>
                <TableHead>ETA DAS</TableHead>
                <TableHead>Truck #</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Border Date</TableHead>
                <TableHead>Max Offload</TableHead>
                <TableHead className="text-center">Docs Rcvd</TableHead>
                <TableHead className="text-center">Docs→Truck</TableHead>
                <TableHead>Transporter</TableHead>
                <TableHead className="text-right">Fee</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead className="text-right">Duty</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-center">Link</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r, idx) => {
                const mo = maxOffload(r.borderDate, r.transporter);
                const del = daysDelayed(r.borderDate, r.transporter);
                const overdue = mo ? new Date(mo) < new Date() : false;
                return (
                  <TableRow key={idx} className={getRowBg(r)} data-testid={`row-git-${r.containerNumber}`}>
                    <TableCell className="text-center text-muted-foreground">{r.sr}</TableCell>
                    <TableCell className="font-mono font-semibold">{r.containerNumber}</TableCell>
                    <TableCell className="text-right font-medium">${fmt(r.amount, 2)}</TableCell>
                    <TableCell>{r.company}</TableCell>
                    <TableCell className="text-muted-foreground">{GROUP_DEFS.find(g => g.id === r.group)?.subtitle ?? r.group}</TableCell>
                    <TableCell>{fmtD(r.eta)}</TableCell>
                    <TableCell className="font-mono">{r.numberPlate ?? "—"}</TableCell>
                    <TableCell>{r.location ?? "—"}</TableCell>
                    <TableCell>{fmtD(r.borderDate)}</TableCell>
                    <TableCell className={cn(overdue ? "text-red-600 font-bold" : "")}>
                      {fmtD(mo)}
                      {del && <span className="ml-1 text-red-600 text-[10px]">+{del}d</span>}
                    </TableCell>
                    <TableCell className="text-center">
                      {r.docsReceived ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600 mx-auto" /> : <XCircle className="h-3.5 w-3.5 text-red-500 mx-auto" />}
                    </TableCell>
                    <TableCell className="text-center">
                      {r.docsSentToTruck
                        ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600 mx-auto" />
                        : r.docsReceived
                          ? <span className="text-amber-700 text-[10px] font-medium">READY</span>
                          : "—"}
                    </TableCell>
                    <TableCell>{r.transporter ?? "—"}</TableCell>
                    <TableCell className="text-right">{r.transportFee ? `$${fmt(r.transportFee, 0)}` : "—"}</TableCell>
                    <TableCell>{r.agent ?? "—"}</TableCell>
                    <TableCell className="text-right">{r.dutyFee ? `$${fmt(r.dutyFee, 0)}` : "—"}</TableCell>
                    <TableCell>
                      <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium", STATUS_BADGE[r.status])}>{r.status}</span>
                    </TableCell>
                    <TableCell className="text-center">
                      {r.trackingLink ? <a href={r.trackingLink} target="_blank" rel="noopener noreferrer" className="text-primary"><ExternalLink className="h-3.5 w-3.5 mx-auto" /></a> : "—"}
                    </TableCell>
                    <TableCell className="max-w-32 truncate text-muted-foreground">{r.notes ?? "—"}</TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="border-t-2 font-semibold bg-muted/40">
                <TableCell colSpan={2} className="text-center">Totals ({filtered.length})</TableCell>
                <TableCell className="text-right">${fmt(totals.amount, 2)}</TableCell>
                <TableCell colSpan={10} />
                <TableCell className="text-right">${fmt(totals.fee, 0)}</TableCell>
                <TableCell />
                <TableCell className="text-right">${fmt(totals.duty, 0)}</TableCell>
                <TableCell colSpan={3} />
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ─── Tab 1: GIT Summary ───────────────────────────────────────────────────────

function StatCard({ label, value, sub, icon, accent, alert }: {
  label: string; value: string | number; sub?: string;
  icon: React.ReactNode; accent?: string; alert?: boolean;
}) {
  return (
    <Card className={cn("min-w-0", alert && "border-red-300 dark:border-red-800")}>
      <CardContent className="p-3 flex items-start gap-2.5">
        <div className={cn("p-1.5 rounded-md shrink-0", accent ?? "bg-muted")}>{icon}</div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground leading-tight truncate">{label}</p>
          <p className={cn("text-lg font-bold leading-tight", alert && "text-red-600")}>{value}</p>
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryGroupTable({ title, rows }: {
  title: string;
  rows: { label: string; count: number; cost: number; fee: number; duty: number }[];
}) {
  const total = {
    count: rows.reduce((s, r) => s + r.count, 0),
    cost: rows.reduce((s, r) => s + r.cost, 0),
    fee: rows.reduce((s, r) => s + r.fee, 0),
    duty: rows.reduce((s, r) => s + r.duty, 0),
  };
  return (
    <Card>
      <CardHeader className="pb-2 pt-3 px-3">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0 pb-1">
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              <TableHead>{title.split(" by ")[1] ?? "Group"}</TableHead>
              <TableHead className="text-right">CTR</TableHead>
              <TableHead className="text-right">CTR Cost</TableHead>
              <TableHead className="text-right">Transport</TableHead>
              <TableHead className="text-right">Duty</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.label}>
                <TableCell className="font-medium">{r.label || "—"}</TableCell>
                <TableCell className="text-right">{r.count}</TableCell>
                <TableCell className="text-right">${fmt(r.cost, 0)}</TableCell>
                <TableCell className="text-right">{r.fee > 0 ? `$${fmt(r.fee, 0)}` : "—"}</TableCell>
                <TableCell className="text-right">{r.duty > 0 ? `$${fmt(r.duty, 0)}` : "—"}</TableCell>
              </TableRow>
            ))}
            <TableRow className="border-t-2 font-semibold bg-muted/30">
              <TableCell>Total</TableCell>
              <TableCell className="text-right">{total.count}</TableCell>
              <TableCell className="text-right">${fmt(total.cost, 0)}</TableCell>
              <TableCell className="text-right">{total.fee > 0 ? `$${fmt(total.fee, 0)}` : "—"}</TableCell>
              <TableCell className="text-right">{total.duty > 0 ? `$${fmt(total.duty, 0)}` : "—"}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function TabSummary({ active }: { active: GITRow[] }) {
  const totalActive    = active.length;
  const atSea          = active.filter(r => r.status === "OTW" || r.status === "Sea").length;
  const atPort         = active.filter(r => r.status === "At Port").length;
  const leftDar        = active.filter(r => r.status === "Left Dar").length;
  const inTransit      = active.filter(r => ["At Border", "In Transit"].includes(r.status)).length;
  const arrived        = active.filter(r => r.status === "Arrived").length;
  const delayed        = active.filter(r => daysDelayed(r.borderDate, r.transporter) !== null).length;
  const docsMissing    = active.filter(r => !r.docsReceived).length;
  const docsReadyNS    = active.filter(r => r.docsReceived && !r.docsSentToTruck && (r.status === "At Port" || r.status === "Left Dar")).length;
  const offloadOverdue = active.filter(r => { const mo = maxOffload(r.borderDate, r.transporter); return mo ? new Date(mo) < new Date() : false; }).length;
  const totalCost      = active.reduce((s, r) => s + r.amount, 0);
  const totalFee       = active.reduce((s, r) => s + (r.transportFee ?? 0), 0);
  const totalDuty      = active.reduce((s, r) => s + (r.dutyFee ?? 0), 0);

  // Group totals by company, destination/group, transporter, agent
  const makeGroup = (key: keyof GITRow) => {
    const keys = [...new Set(active.map(r => (r[key] ?? "—") as string))];
    return keys.map(k => {
      const sub = active.filter(r => (r[key] ?? "—") === k);
      return { label: k, count: sub.length, cost: sub.reduce((s, r) => s + r.amount, 0), fee: sub.reduce((s, r) => s + (r.transportFee ?? 0), 0), duty: sub.reduce((s, r) => s + (r.dutyFee ?? 0), 0) };
    });
  };

  const byGroup = GROUP_DEFS.map(gd => {
    const sub = active.filter(r => r.group === gd.id);
    return { label: `${gd.title} ${gd.subtitle}`, count: sub.length, cost: sub.reduce((s, r) => s + r.amount, 0), fee: sub.reduce((s, r) => s + (r.transportFee ?? 0), 0), duty: sub.reduce((s, r) => s + (r.dutyFee ?? 0), 0) };
  }).filter(g => g.count > 0);

  const byCompany    = makeGroup("company");
  const byTransport  = makeGroup("transporter");
  const byAgent      = makeGroup("agent");

  const attentionRows = [
    ...active.filter(r => daysDelayed(r.borderDate, r.transporter) !== null).map(r => ({ label: r.containerNumber, issue: `Overdue +${daysDelayed(r.borderDate, r.transporter)}d`, color: "text-red-600" })),
    ...active.filter(r => !r.docsReceived && r.status === "At Port").map(r => ({ label: r.containerNumber, issue: "At port — docs missing", color: "text-rose-600" })),
    ...active.filter(r => r.docsReceived && !r.docsSentToTruck && r.status === "At Port").map(r => ({ label: r.containerNumber, issue: "Docs ready — not sent to truck", color: "text-amber-600" })),
    ...active.filter(r => !r.docsReceived && (r.status === "OTW" || r.status === "Sea") && isUpcoming(r.eta)).map(r => ({ label: r.containerNumber, issue: `ETA ${fmtD(r.eta)} — docs pending`, color: "text-yellow-700" })),
  ];

  return (
    <div className="space-y-4">
      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-11 gap-2">
        <StatCard label="Active GIT"            value={totalActive}   icon={<Package className="h-4 w-4 text-primary" />}          accent="bg-primary/10" />
        <StatCard label="At Sea / OTW"           value={atSea}          icon={<Ship className="h-4 w-4 text-blue-600" />}             accent="bg-blue-100 dark:bg-blue-900/30" />
        <StatCard label="At Port"                value={atPort}         icon={<Package className="h-4 w-4 text-amber-600" />}         accent="bg-amber-100 dark:bg-amber-900/30" />
        <StatCard label="Left Dar"               value={leftDar}        icon={<Truck className="h-4 w-4 text-violet-600" />}          accent="bg-violet-100 dark:bg-violet-900/30" />
        <StatCard label="In Transit"             value={inTransit}      icon={<Truck className="h-4 w-4 text-indigo-600" />}          accent="bg-indigo-100 dark:bg-indigo-900/30" />
        <StatCard label="Arrived"                value={arrived}        icon={<CheckCircle2 className="h-4 w-4 text-green-600" />}    accent="bg-green-100 dark:bg-green-900/30" />
        <StatCard label="Delayed"                value={delayed}        alert={delayed > 0}  icon={<Clock className="h-4 w-4 text-red-600" />}              accent="bg-red-100 dark:bg-red-900/30" />
        <StatCard label="Docs Missing"           value={docsMissing}    alert={docsMissing > 0} icon={<FileX className="h-4 w-4 text-orange-600" />}         accent="bg-orange-100 dark:bg-orange-900/30" />
        <StatCard label="Docs Ready, Not Sent"   value={docsReadyNS}    alert={docsReadyNS > 0} icon={<FileX className="h-4 w-4 text-amber-600" />}          accent="bg-amber-100 dark:bg-amber-900/30" />
        <StatCard label="Container Cost"         value={`$${fmt(totalCost, 0)}`} icon={<DollarSign className="h-4 w-4 text-green-600" />} accent="bg-green-100 dark:bg-green-900/30" />
        <StatCard label="Total Fees"             value={`$${fmt(totalFee + totalDuty, 0)}`} sub={`T:$${fmt(totalFee,0)} D:$${fmt(totalDuty,0)}`} icon={<DollarSign className="h-4 w-4 text-muted-foreground" />} />
      </div>

      {/* OTW Summary bar — like the Excel summary block */}
      <div className="rounded-md border overflow-hidden">
        <div className="bg-zinc-800 dark:bg-zinc-700 text-white px-3 py-1.5 text-xs font-bold tracking-wide">
          OTW SUMMARY
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <tbody>
              {GROUP_DEFS.map(gd => {
                const sub = active.filter(r => r.group === gd.id);
                if (sub.length === 0 && gd.id !== "gc-lsh") return null;
                const cost = sub.reduce((s, r) => s + r.amount, 0);
                return (
                  <tr key={gd.id} className="border-b last:border-b-0 hover:bg-muted/30">
                    <td className={cn("py-1 px-3 font-bold w-4", gd.headerBg, gd.headerText)} />
                    <td className="py-1 px-3 font-semibold">{gd.title}</td>
                    <td className="py-1 px-3 text-muted-foreground">{gd.subtitle}</td>
                    <td className="py-1 px-3 text-right font-bold text-base">{sub.length}</td>
                    <td className="py-1 px-3 text-right font-semibold">${fmt(cost, 2)}</td>
                  </tr>
                );
              })}
              <tr className="border-t-2 bg-muted/40 font-bold">
                <td />
                <td className="py-1 px-3" colSpan={2}>TOTAL OTW</td>
                <td className="py-1 px-3 text-right text-base">{totalActive}</td>
                <td className="py-1 px-3 text-right">${fmt(totalCost, 2)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Attention section */}
      {attentionRows.length > 0 && (
        <Card className="border-red-200 dark:border-red-900 bg-red-50/40 dark:bg-red-950/20">
          <CardHeader className="pb-2 pt-3 px-3">
            <CardTitle className="text-sm text-red-700 dark:text-red-400 flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4" /> Needs Attention ({attentionRows.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
              {attentionRows.map((a, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="font-mono font-semibold text-foreground">{a.label}</span>
                  <span className={cn("truncate", a.color)}>{a.issue}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Grouped breakdown tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SummaryGroupTable title="Totals by Destination / Group" rows={byGroup} />
        <SummaryGroupTable title="Totals by Company"             rows={byCompany} />
        <SummaryGroupTable title="Totals by Transporter"         rows={byTransport} />
        <SummaryGroupTable title="Totals by Agent / Declarant"   rows={byAgent} />
      </div>
    </div>
  );
}

// ─── Tab 3: At Port / Sea / Left Dar ─────────────────────────────────────────

function TabPortReport({ active }: { active: GITRow[] }) {
  const seaOtw  = active.filter(r => r.status === "OTW" || r.status === "Sea");
  const atPort  = active.filter(r => r.status === "At Port");
  const leftDar = active.filter(r => r.status === "Left Dar");

  type SubGroup = { title: string; rows: GITRow[]; headerBg: string; headerText: string };
  const sections: SubGroup[] = [
    { title: "OTW / AT SEA",  rows: seaOtw,  headerBg: "bg-blue-600",   headerText: "text-white" },
    { title: "AT PORT",       rows: atPort,  headerBg: "bg-amber-500",  headerText: "text-white" },
    { title: "LEFT DAR",      rows: leftDar, headerBg: "bg-violet-600", headerText: "text-white" },
  ];

  const totalCost = [...seaOtw, ...atPort, ...leftDar].reduce((s, r) => s + r.amount, 0);

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="flex gap-4 flex-wrap p-3 rounded-md border bg-muted/30 text-sm">
        {[
          { label: "OTW / At Sea", value: seaOtw.length,  color: "text-blue-600 font-bold" },
          { label: "At Port",      value: atPort.length,  color: "text-amber-600 font-bold" },
          { label: "Left Dar",     value: leftDar.length, color: "text-violet-600 font-bold" },
          { label: "Total",        value: seaOtw.length + atPort.length + leftDar.length, color: "font-bold" },
          { label: "Total Cost",   value: `$${fmt(totalCost, 0)}`, color: "text-green-600 font-bold" },
        ].map(s => (
          <div key={s.label} className="flex items-center gap-1.5">
            <span className="text-muted-foreground text-xs">{s.label}:</span>
            <span className={cn("text-sm", s.color)}>{s.value}</span>
          </div>
        ))}
      </div>

      {sections.map(sec => {
        if (sec.rows.length === 0) return (
          <div key={sec.title} className="rounded-md border overflow-hidden">
            <div className={cn("px-3 py-1.5 text-xs font-bold", sec.headerBg, sec.headerText)}>
              {sec.title} — 0 containers
            </div>
            <div className="py-4 text-center text-xs text-muted-foreground italic bg-muted/10">No containers</div>
          </div>
        );

        // Sub-group by company within each section
        const companies = [...new Set(sec.rows.map(r => r.company))];

        return (
          <div key={sec.title} className="rounded-md border overflow-hidden">
            <div className={cn("flex items-center justify-between px-3 py-1.5", sec.headerBg, sec.headerText)}>
              <span className="text-sm font-bold">{sec.title}</span>
              <span className="text-xs font-semibold opacity-90">{sec.rows.length} containers — ${fmt(sec.rows.reduce((s, r) => s + r.amount, 0), 0)}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs whitespace-nowrap border-collapse">
                <thead>
                  <tr className="bg-muted/60 border-b text-muted-foreground">
                    <th className="py-1 px-2 font-semibold text-left">CONTAINER #</th>
                    <th className="py-1 px-2 font-semibold text-left">CO.</th>
                    <th className="py-1 px-2 font-semibold text-right">AMOUNT</th>
                    <th className="py-1 px-2 font-semibold text-left">ETA DAS</th>
                    <th className="py-1 px-2 font-semibold text-left">TRANSPORTER</th>
                    <th className="py-1 px-2 font-semibold text-left">TRUCK #</th>
                    <th className="py-1 px-2 font-semibold text-left">LOCATION</th>
                    <th className="py-1 px-2 font-semibold text-left">BORDER DT.</th>
                    <th className="py-1 px-2 font-semibold text-left">MAX OFFLOAD</th>
                    <th className="py-1 px-2 font-semibold text-center">DOCS RCVD</th>
                    <th className="py-1 px-2 font-semibold text-center">DOCS→TRUCK</th>
                    <th className="py-1 px-2 font-semibold text-left">AGENT</th>
                    <th className="py-1 px-2 font-semibold text-left">NOTES</th>
                  </tr>
                </thead>
                <tbody>
                  {companies.map(company => {
                    const compRows = sec.rows.filter(r => r.company === company);
                    return compRows.map((r, idx) => {
                      const mo = maxOffload(r.borderDate, r.transporter);
                      const del = daysDelayed(r.borderDate, r.transporter);
                      const isFirstInCompany = idx === 0;
                      return (
                        <tr key={r.containerNumber} className={cn("border-b last:border-b-0 hover:brightness-95", getRowBg(r), isFirstInCompany && idx !== 0 ? "border-t-2 border-muted" : "")}>
                          <td className="py-0.5 px-2 font-mono font-bold">{r.containerNumber}</td>
                          <td className="py-0.5 px-2 font-medium">{r.company}</td>
                          <td className="py-0.5 px-2 text-right font-semibold">${fmt(r.amount, 0)}</td>
                          <td className="py-0.5 px-2">{fmtD(r.eta)}</td>
                          <td className="py-0.5 px-2">{r.transporter ?? "—"}</td>
                          <td className="py-0.5 px-2 font-mono">{r.numberPlate ?? "—"}</td>
                          <td className="py-0.5 px-2">{r.location ?? "—"}</td>
                          <td className="py-0.5 px-2">{fmtD(r.borderDate)}</td>
                          <td className={cn("py-0.5 px-2", del ? "text-red-600 font-bold" : "")}>
                            {fmtD(mo)}
                            {del && <span className="ml-1 text-[10px]">+{del}d</span>}
                          </td>
                          <td className="py-0.5 px-2 text-center">
                            {r.docsReceived ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600 mx-auto" /> : <XCircle className="h-3.5 w-3.5 text-red-500 mx-auto" />}
                          </td>
                          <td className="py-0.5 px-2 text-center">
                            {r.docsSentToTruck ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600 mx-auto" /> : r.docsReceived ? <span className="text-amber-700 text-[10px] font-medium">READY</span> : "—"}
                          </td>
                          <td className="py-0.5 px-2">{r.agent ?? "—"}</td>
                          <td className="py-0.5 px-2 max-w-40 truncate text-muted-foreground italic">{r.notes ?? "—"}</td>
                        </tr>
                      );
                    });
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Tab 4: WhatsApp Preview ──────────────────────────────────────────────────

function TabWhatsApp({ active }: { active: GITRow[] }) {
  const seaOtw    = active.filter(r => r.status === "OTW" || r.status === "Sea").length;
  const atPort    = active.filter(r => r.status === "At Port").length;
  const leftDar   = active.filter(r => r.status === "Left Dar").length;
  const inTransit = active.filter(r => ["At Border", "In Transit"].includes(r.status)).length;
  const arrived   = active.filter(r => r.status === "Arrived").length;
  const delayed   = active.filter(r => daysDelayed(r.borderDate, r.transporter) !== null);
  const docsMiss  = active.filter(r => !r.docsReceived);
  const docsReady = active.filter(r => r.docsReceived && !r.docsSentToTruck && r.status === "At Port");
  const overdue   = active.filter(r => { const mo = maxOffload(r.borderDate, r.transporter); return mo ? new Date(mo) < new Date() : false; });
  const totalCost = active.reduce((s, r) => s + r.amount, 0);
  const totalFee  = active.reduce((s, r) => s + (r.transportFee ?? 0), 0);
  const totalDuty = active.reduce((s, r) => s + (r.dutyFee ?? 0), 0);

  const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

  const lines = [
    `*GIT DAILY REPORT — ${today.toUpperCase()}*`,
    ``,
    `*ACTIVE CONTAINERS: ${active.length}*`,
    `• OTW / At Sea:    ${seaOtw}`,
    `• At Port (Dar):   ${atPort}`,
    `• Left Dar:        ${leftDar}`,
    `• In Transit:      ${inTransit}`,
    `• Arrived:         ${arrived}`,
    ``,
    `*CONTAINER COST:  $${fmt(totalCost, 2)}*`,
    `• Transport Fees:  $${fmt(totalFee, 0)}`,
    `• Duty Fees:       $${fmt(totalDuty, 0)}`,
    `• Total Fees:      $${fmt(totalFee + totalDuty, 0)}`,
    ``,
    `*BY GROUP / DESTINATION*`,
    ...GROUP_DEFS.map(gd => {
      const sub = active.filter(r => r.group === gd.id);
      if (sub.length === 0) return `• ${gd.title} ${gd.subtitle}: 0`;
      const cost = sub.reduce((s, r) => s + r.amount, 0);
      return `• ${gd.title} ${gd.subtitle}: ${sub.length} ctr — $${fmt(cost, 0)}`;
    }),
    ``,
    `*BY COMPANY*`,
    ...([...new Set(active.map(r => r.company))]).map(c => {
      const sub = active.filter(r => r.company === c);
      return `• ${c}: ${sub.length} ctr — $${fmt(sub.reduce((s, r) => s + r.amount, 0), 0)}`;
    }),
    ...(delayed.length > 0 ? [
      ``,
      `⚠ *DELAYED — ${delayed.length}*`,
      ...delayed.map(r => `• ${r.containerNumber} +${daysDelayed(r.borderDate, r.transporter)}d [${r.company}] ${r.transporter ?? "no truck"}`),
    ] : []),
    ...(overdue.length > 0 ? [
      ``,
      `! *OFFLOAD OVERDUE — ${overdue.length}*`,
      ...overdue.map(r => `• ${r.containerNumber} [${r.company}]`),
    ] : []),
    ...(docsMiss.length > 0 ? [
      ``,
      `*DOCS MISSING — ${docsMiss.length}*`,
      ...docsMiss.map(r => `• ${r.containerNumber} [${r.company}] ETA ${fmtD(r.eta)}`),
    ] : []),
    ...(docsReady.length > 0 ? [
      ``,
      `*DOCS READY — NOT SENT TO TRUCK (${docsReady.length})*`,
      ...docsReady.map(r => `• ${r.containerNumber} → ${r.transporter ?? "no transporter"}`),
    ] : []),
    ...(active.filter(r => r.trackingLink).length > 0 ? [
      ``,
      `*TRACKING LINKS*`,
      ...active.filter(r => r.trackingLink).map(r => `${r.containerNumber}: ${r.trackingLink}`),
    ] : []),
  ];

  return (
    <div className="space-y-3 max-w-2xl">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-green-600" />
        <p className="text-sm font-medium">Daily WhatsApp GIT Report</p>
        <Badge variant="outline" className="text-xs">Text preview — no PDF/image</Badge>
      </div>
      <div className="rounded-lg border bg-[#e5ddd5] dark:bg-zinc-800 p-3">
        <div className="bg-white dark:bg-zinc-700 rounded-lg p-3 text-xs font-mono whitespace-pre-wrap leading-relaxed max-h-[600px] overflow-y-auto">
          {lines.join("\n")}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        This text summarises the full workbook. Sent manually or via scheduled auto-send to the configured WhatsApp group.
      </p>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function GITMockup() {
  const active = ROWS.filter(r => ACTIVE_STATUSES.includes(r.status));

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="GIT"
        subtitle="Daily goods-in-transit workbook — spreadsheet replacement"
      />

      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* Mockup banner */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            <strong>Mockup mode</strong> — fake data only. No DB reads or writes.{" "}
            <span className="font-medium">Access: Admin / Developer / Owner only.</span>
          </span>
          <Badge variant="outline" className="ml-auto text-xs shrink-0 border-amber-400 text-amber-700 dark:text-amber-400">
            <FileSpreadsheet className="h-3 w-3 mr-1" />
            GIT Workbook
          </Badge>
        </div>

        <Tabs defaultValue="detail">
          <TabsList className="grid grid-cols-4 w-full max-w-xl">
            <TabsTrigger value="summary"  data-testid="tab-git-summary">GIT Summary</TabsTrigger>
            <TabsTrigger value="detail"   data-testid="tab-git-detail">GIT Detail</TabsTrigger>
            <TabsTrigger value="port"     data-testid="tab-git-port">At Port / Sea</TabsTrigger>
            <TabsTrigger value="whatsapp" data-testid="tab-git-wa">WhatsApp</TabsTrigger>
          </TabsList>

          <TabsContent value="summary" className="mt-4">
            <TabSummary active={active} />
          </TabsContent>

          <TabsContent value="detail" className="mt-4">
            <TabDetail rows={active} />
          </TabsContent>

          <TabsContent value="port" className="mt-4">
            <TabPortReport active={active} />
          </TabsContent>

          <TabsContent value="whatsapp" className="mt-4">
            <TabWhatsApp active={active} />
          </TabsContent>
        </Tabs>

      </div>
    </div>
  );
}
