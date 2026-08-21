from pathlib import Path
import json
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"Missing replacement target: {label}")
    return text.replace(old, new, 1)


def replace_block(text: str, start_marker: str, end_marker: str, replacement: str, label: str) -> str:
    start = text.find(start_marker)
    end = text.find(end_marker, start)
    if start < 0 or end < 0 or end <= start:
        raise RuntimeError(f"Missing block: {label}")
    return text[:start] + replacement + text[end + len(end_marker):]


def write(path: str, text: str) -> None:
    Path(path).write_text(text if text.endswith("\n") else text + "\n")


def line_count(path: str) -> int:
    return len(Path(path).read_text().splitlines())


# WasteDispatch
p = Path("client/src/pages/factory/WasteDispatch.tsx")
s = p.read_text()
s = replace_once(s, 'import { useState, useRef, useMemo } from "react";', 'import { useState, useMemo } from "react";', "waste react import")
s = replace_once(s, 'import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";\n', '', "waste dialog imports")
s = s.replace("  Printer,\n", "", 1).replace("  Package,\n", "", 1)
s = replace_once(
    s,
    'import { fmt, fmtKg, today } from "./wastedispatch/utils";',
    'import { fmt, fmtKg, today } from "./wastedispatch/utils";\nimport { WasteDispatchDialogs } from "./wastedispatch/components/WasteDispatchDialogs";',
    "waste component import",
)
s = s.replace("  const printRef = useRef<HTMLDivElement>(null);\n", "", 1)
s = replace_block(s, "  const handlePrint = () => {", "  return (\n", "  return (\n", "waste handlePrint")
waste_usage = '''      <WasteDispatchDialogs
        confirming={confirming}
        setConfirming={setConfirming}
        selectedCount={selected.size}
        totalWeight={totalWeight}
        totalCost={totalCost}
        dispatchDate={dispatchDate}
        notes={notes}
        submitPending={submitMutation.isPending}
        onSubmit={() => submitMutation.mutate()}
        deleteDispatchId={deleteDispatchId}
        setDeleteDispatchId={setDeleteDispatchId}
        deletePending={deleteDispatchMutation.isPending}
        onDelete={(id) => deleteDispatchMutation.mutate(id)}
        printData={printData}
        setPrintData={setPrintData}
      />
    </div>
  );
}'''
s = replace_block(s, "      {/* ── CONFIRM DISPATCH DIALOG", "    </div>\n  );\n}", waste_usage, "waste dialogs")
write(str(p), s)

# SalesReportLegacy
p = Path("client/src/pages/SalesReportLegacy.tsx")
s = p.read_text()
s = s.replace('import { useState, useMemo, useEffect } from "react";', 'import { useState, useMemo } from "react";', 1)
s = s.replace('import { writeFile, ExcelJS } from "@/lib/excelHelper";\n', '', 1)
s = s.replace(
    'import { format, parseISO, startOfDay, startOfMonth, startOfYear, addDays } from "date-fns";',
    'import { format, parseISO, startOfDay, startOfMonth, startOfYear } from "date-fns";',
    1,
)
s = replace_once(
    s,
    'import type { DailySummary, GroupingType, ProfitFilter, SalesReportItem } from "./salesreportlegacy/types";',
    'import type { DailySummary, GroupingType, ProfitFilter, SalesReportItem } from "./salesreportlegacy/types";\n'
    'import { useSalesReportDateKeyboard } from "./salesreportlegacy/useSalesReportDateKeyboard";\n'
    'import { exportSalesReportExcel } from "./salesreportlegacy/exportExcel";',
    "sales helper imports",
)
s = replace_block(
    s,
    '  // Keyboard date navigation: "-" = back 1 day, "+" or "=" = forward 1 day\n  useEffect(() => {',
    '  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);',
    '  useSalesReportDateKeyboard(setPeriodFilter);\n\n  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);',
    "sales keyboard hook",
)
s = replace_block(
    s,
    "  const handleExportExcel = async () => {",
    "  const handleExportPDF = () => {",
    "  const handleExportExcel = () => exportSalesReportExcel(salesData);\n\n  const handleExportPDF = () => {",
    "sales excel exporter",
)
write(str(p), s)

# FactoryOtwTrackingTab
p = Path("client/src/pages/factory/FactoryOtwTrackingTab.tsx")
s = p.read_text()
s = replace_once(
    s,
    'import { TrackNowProgressLog } from "./factoryotwtrackingtab/components/TrackNowProgressLog";',
    'import { TrackNowProgressLog } from "./factoryotwtrackingtab/components/TrackNowProgressLog";\n'
    'import { useOtwCsvTools } from "./factoryotwtrackingtab/hooks/useOtwCsvTools";',
    "otw csv hook import",
)
s = replace_block(
    s,
    "  const [importing, setImporting] = useState(false);\n  // ── Dev-only: Export filtered containers as CSV",
    "  async function trackAll() {",
    "  const { importing, exportCsv, handleImportFile } = useOtwCsvTools(filtered, otwContainers);\n\n"
    "  async function trackAll() {",
    "otw csv tools",
)
write(str(p), s)

# PendingInvoiceVerify
p = Path("client/src/pages/PendingInvoiceVerify.tsx")
s = p.read_text()
s = s.replace('import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";\n', '', 1)
s = re.sub(
    r'import \{\n\s*AlertDialog,\n\s*AlertDialogAction,\n\s*AlertDialogCancel,\n\s*AlertDialogContent,\n\s*AlertDialogDescription,\n\s*AlertDialogFooter,\n\s*AlertDialogHeader,\n\s*AlertDialogTitle,\n\} from "@/components/ui/alert-dialog";\n',
    '',
    s,
    count=1,
)
s = replace_once(
    s,
    'import type { ComparisonItem, FinalizePreview, OrderDetail, VerificationSummary } from "./pendinginvoiceverify/types";',
    'import type { ComparisonItem, FinalizePreview, OrderDetail, VerificationSummary } from "./pendinginvoiceverify/types";\n'
    'import { PendingInvoiceDialogs } from "./pendinginvoiceverify/PendingInvoiceDialogs";',
    "pending dialog import",
)
pending_usage = '''      <PendingInvoiceDialogs
        showApproveDialog={showApproveDialog}
        setShowApproveDialog={setShowApproveDialog}
        approveNotes={approveNotes}
        setApproveNotes={setApproveNotes}
        verifyPending={verifyMutation.isPending}
        onVerify={(notes) => verifyMutation.mutate({ approved: true, notes: notes || undefined })}
        showReturnDialog={showReturnDialog}
        setShowReturnDialog={setShowReturnDialog}
        returnPending={returnToLoadingMutation.isPending}
        onReturn={() => returnToLoadingMutation.mutate()}
        showFinalizePreview={showFinalizePreview}
        setShowFinalizePreview={setShowFinalizePreview}
        finalizePreview={finalizePreview}
        finalizePending={finalizeMutation.isPending}
        onFinalize={() => finalizeMutation.mutate()}
        showFixBalesDialog={showFixBalesDialog}
        setShowFixBalesDialog={setShowFixBalesDialog}
        onFixBales={() => forceSyncMutation.mutate()}
      />
    </div>
  );
}'''
s = replace_block(
    s,
    '      <Dialog open={showApproveDialog} onOpenChange={setShowApproveDialog}>',
    "    </div>\n  );\n}",
    pending_usage,
    "pending dialogs",
)
write(str(p), s)

# Ratchet and docs
config_path = "config/god-file-boundaries.json"
config = json.loads(Path(config_path).read_text())
retired = [
    "client/src/pages/factory/WasteDispatch.tsx",
    "client/src/pages/SalesReportLegacy.tsx",
    "client/src/pages/factory/FactoryOtwTrackingTab.tsx",
    "client/src/pages/PendingInvoiceVerify.tsx",
]
config["version"] = 28
config["description"] = (
    "Version 28 completes cumulative God Files Wave 3 by retiring four small frontend pages through dialog, "
    "export, keyboard and CSV-tool extractions. " + config["description"]
)
for path in retired:
    config["repositoryScan"]["grandfathered"].pop(path, None)
write(config_path, json.dumps(config, indent=2))

remaining = list(config["repositoryScan"]["grandfathered"].keys())
if len(remaining) != 12:
    raise RuntimeError(f"Expected 12 remaining God Files, got {len(remaining)}")
soft_max = config["repositoryScan"]["softMaxLines"]
excess = 0
for path in remaining:
    count = line_count(path)
    if count <= soft_max:
        raise RuntimeError(f"{path} is stale grandfathering at {count} lines")
    excess += count - soft_max
print(f"WAVE3_BACKLOG files={len(remaining)} excess={excess}")

boundary_path = "tests/god-file-boundaries.test.ts"
boundary = Path(boundary_path).read_text()
boundary = boundary.replace("expect(report.version).toBe(27);", "expect(report.version).toBe(28);", 1)
boundary = re.sub(
    r"expect\(report\.summary\.grandfatheredFiles\)\.toBeLessThanOrEqual\(\d+\);",
    f"expect(report.summary.grandfatheredFiles).toBeLessThanOrEqual({len(remaining)});",
    boundary,
    count=1,
)
boundary = re.sub(
    r"expect\(report\.summary\.grandfatheredExcessLines\)\.toBeLessThanOrEqual\(\d+\);",
    f"expect(report.summary.grandfatheredExcessLines).toBeLessThanOrEqual({excess});",
    boundary,
    count=1,
)
write(boundary_path, boundary)

doc_path = "docs/god-file-split-program.md"
doc = Path(doc_path).read_text()
doc = re.sub(
    r"\*\*Backlog: [\d,]+ files, [\d,]+ lines over the limit\*\*",
    f"**Backlog: {len(remaining):,} files, {excess:,} lines over the limit**",
    doc,
    count=1,
)
write(doc_path, doc)

quality_path = "docs/system-quality-program.md"
quality = Path(quality_path).read_text()
quality = re.sub(
    r"God-file backlog \| [\d,]+ files, [\d,]+ excess lines",
    f"God-file backlog | {len(remaining):,} files, {excess:,} excess lines",
    quality,
    count=1,
)
write(quality_path, quality)
