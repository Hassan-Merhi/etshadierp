import ExcelJS from "exceljs";
import { EXCEL_ERRORS } from "./constants";

// ── Error scanner ─────────────────────────────────────────────────────────────
export function scanErrors(wb: ExcelJS.Workbook): Array<{ sheet: string; cell: string; value: string }> {
  const found: Array<{ sheet: string; cell: string; value: string }> = [];
  for (const ws of wb.worksheets) {
    if ((ws as any).state === "hidden" || (ws as any).state === "veryHidden") continue;
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        let check = "";
        const v = cell.value;
        if (typeof v === "string") check = v;
        else if (v && typeof v === "object" && "result" in v) check = String((v as any).result ?? "");
        if (EXCEL_ERRORS.some(e => check.includes(e))) {
          found.push({ sheet: ws.name, cell: cell.address, value: check });
        }
      });
    });
  }
  return found;
}
