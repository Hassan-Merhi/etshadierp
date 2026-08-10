from pathlib import Path
import re

sales = Path("server/routes/stats/salesReportBandwidthRoutes.ts")
text = sales.read_text()
text = text.replace("getAccessibleCompanyIds(userId)", "getAccessibleCompanyIds(String(userId))")
text = text.replace("(row: any): SummaryGroup", "(row: Record<string, unknown>): SummaryGroup")
text = text.replace("(row: any) => {", "(row: Record<string, unknown>) => {")
sales.write_text(text)

waste_server = Path("server/routes/factory/employee-pos/wasteDispatchBandwidthRoutes.ts")
text = waste_server.read_text()
text = text.replace('import type { Express } from "express";', 'import type { Express, Request } from "express";')
text = text.replace("function getCompanyId(req: any): number | null", "function getCompanyId(req: Request): number | null")
text = text.replace("function getSearch(req: any): string", "function getSearch(req: Request): string")
text = text.replace("function mapWasteBale(row: any)", "function mapWasteBale(row: Record<string, unknown>)")
text = text.replace("async (req: any, res: any) =>", "async (req, res) =>")
text = text.replace(
    "const rows: any[] = Array.isArray(raw) ? raw : resultRows(raw);",
    "const rows = (Array.isArray(raw) ? raw : resultRows(raw)) as Record<string, unknown>[];",
)
text = text.replace(
    "const dispatchRows: any[] = Array.isArray(dispatchRaw) ? dispatchRaw : resultRows(dispatchRaw);",
    "const dispatchRows = (Array.isArray(dispatchRaw) ? dispatchRaw : resultRows(dispatchRaw)) as Record<string, unknown>[];",
)
if re.search(r"\bany\b|as\s+any\b", text):
    raise SystemExit("Waste Dispatch server still contains an explicit any")
waste_server.write_text(text)

waste_client = Path("client/src/pages/factory/WasteDispatchOptimized.tsx")
text = waste_client.read_text()
text = text.replace(
    'import type { Bale } from "./wastedispatch/types";\nimport { fmt, fmtKg, today } from "./wastedispatch/utils";',
    'import { baleMatchesSearch, fetchGroupBales, fetchHistoryBales, readWasteJson } from "./wastedispatch/optimizedData";\nimport { printDispatchDocument } from "./wastedispatch/optimizedPrint";\nimport type { GroupSummary, HistoryBale, HistoryResponse, PrintDispatch, SummaryResponse, WasteBale } from "./wastedispatch/optimizedTypes";\nimport { fmt, fmtKg, today } from "./wastedispatch/utils";',
)
text, count = re.subn(
    r'type WasteBale = Bale & \{.*?type PrintDispatch = Pick<HistoryItem, "dispatchNumber" \| "dispatchDate" \| "notes">;\n\n',
    "",
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit(f"Waste Dispatch type block split count was {count}")
text, count = re.subn(
    r'async function readJson<T>\(url: string\): Promise<T> \{.*?function baleMatchesSearch\(bale: WasteBale, search: string\): boolean \{.*?\n\}\n\n',
    'function errorMessage(error: unknown): string {\n  return error instanceof Error ? error.message : String(error);\n}\n\nfunction isGloballyHandled(error: unknown): boolean {\n  return Boolean(\n    typeof error === "object" &&\n      error !== null &&\n      "_handledGlobally" in error &&\n      (error as { _handledGlobally?: boolean })._handledGlobally\n  );\n}\n\n',
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit(f"Waste Dispatch data helper split count was {count}")
text, count = re.subn(
    r'function escapeHtml\(value: unknown\): string \{.*?\n\}\n\nfunction printDispatchDocument\(dispatch: PrintDispatch, bales: HistoryBale\[\]\) \{.*?\n\}\n\n(?=export default function WasteDispatchOptimized)',
    "",
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit(f"Waste Dispatch print helper split count was {count}")
text = text.replace("readJson<", "readWasteJson<")
text = text.replace("catch (error: any)", "catch (error: unknown)")
text = text.replace("onError: (error: any)", "onError: (error: unknown)")
text = text.replace("description: error.message", "description: errorMessage(error)")
text = text.replace("if (error?._handledGlobally) return;", "if (isGloballyHandled(error)) return;")
marker = "  const toggleBale = (bale: WasteBale) => {"
if marker not in text:
    raise SystemExit("Waste Dispatch toggleBale insertion point missing")
text = text.replace(marker, "  const clearSelectedBales = () => setSelected(new Map<number, WasteBale>());\n\n" + marker, 1)
text = text.replace("onClick={() => setSelected(new Map<number, WasteBale>())}", "onClick={clearSelectedBales}")
if re.search(r"\bany\b|as\s+any\b", text):
    raise SystemExit("Waste Dispatch client still contains an explicit any")
waste_client.write_text(text)
