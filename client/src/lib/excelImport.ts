import type ExcelJS from "exceljs";
import type { Sheet as FortuneSheet } from "@fortune-sheet/core";

type ArgbColor = { argb?: string };
type ExcelConditionalStyle = {
  fill?: { fgColor?: ArgbColor };
  font?: { color?: ArgbColor; bold?: boolean; italic?: boolean };
};
type ExcelConditionalRule = {
  type?: string;
  priority?: number;
  operator?: string;
  formulae?: readonly (string | number)[];
  style?: ExcelConditionalStyle;
  cfvo?: readonly object[];
  color?: ArgbColor | readonly ArgbColor[];
  top?: boolean;
  percent?: boolean;
  rank?: number;
};
type ExcelConditionalFormatting = { ref?: string; rules?: ExcelConditionalRule[] };
type WorksheetWithConditionalFormatting = ExcelJS.Worksheet & {
  conditionalFormattings?: ExcelConditionalFormatting[];
};

type FortuneConditionalStyle = { bg?: string; fc?: string; bl?: 1; it?: 1 };
type FortuneCondition = {
  ref?: string;
  type?: string;
  priority: number;
  operator?: string;
  formulae?: readonly (string | number)[];
  format?: FortuneConditionalStyle;
  cfvo?: readonly object[];
  color?: string | string[];
  top?: boolean;
  percent?: boolean;
  rank?: number;
};
type AutoFilterSelection = { row: [number, number]; column: [number, number] };
type ExcelAutoFilter =
  | string
  | {
      from?: { row?: number; col?: number };
      to?: { row?: number; col?: number };
      ref?: string;
    };

type FortuneCellFormat = { fa: string; t: string };
type FortuneBorderSegment = { style: number; color: string };
type FortuneCellValue = {
  f?: string;
  v?: ExcelJS.CellValue | null;
  m?: string;
  ct?: FortuneCellFormat;
  bl?: 1;
  it?: 1;
  un?: 1;
  cl?: 1;
  fs?: number;
  fc?: string;
  ff?: string;
  bg?: string;
  ht?: number;
  vt?: number;
  tb?: number;
  b?: Record<string, FortuneBorderSegment>;
};
type FortuneCellData = { r: number; c: number; v: FortuneCellValue };
type FortuneMerge = { r: number; c: number; rs: number; cs: number };
type FortuneConfig = {
  merge?: Record<string, FortuneMerge>;
  columnlen?: Record<string, number>;
  colhidden?: Record<string, number>;
  rowlen?: Record<string, number>;
  rowhidden?: Record<string, number>;
};
type FortuneSheetDraft = {
  id: string;
  name: string;
  status: number;
  order: number;
  celldata: FortuneCellData[];
  row: number;
  column: number;
  config: FortuneConfig;
  filter_select?: AutoFilterSelection;
  conditions?: FortuneCondition[];
};
type ExcelBorderSide = { style?: string; color?: ArgbColor };
type ExcelBorder = Partial<Record<"left" | "right" | "top" | "bottom", ExcelBorderSide>>;

// ─── Helpers ────────────────────────────────────────────────────────────────

function argbToHex(argb?: string): string | undefined {
  if (!argb || argb.length < 6) return undefined;
  // ExcelJS ARGB: 'FF0000FF' (AA RR GG BB) → '#0000FF'
  const hex = argb.length >= 8 ? argb.slice(2) : argb;
  return `#${hex.toUpperCase()}`;
}

// ExcelJS border style string → Fortune Sheet border style number
const BORDER_STYLE_MAP: Record<string, number> = {
  thin: 1,
  hair: 2,
  dotted: 3,
  dashed: 4,
  dashDot: 5,
  dashDotDot: 6,
  double: 7,
  medium: 8,
  mediumDashed: 9,
  mediumDashDot: 10,
  mediumDashDotDot: 11,
  slantDashDot: 12,
  thick: 13,
};

// ExcelJS horizontal → Fortune Sheet ht
const H_ALIGN: Record<string, number> = {
  left: 1,
  center: 0,
  right: 2,
  justify: 2,
  fill: 1,
  centerContinuous: 0,
};

// ExcelJS vertical → Fortune Sheet vt
const V_ALIGN: Record<string, number> = {
  top: 1,
  middle: 0,
  bottom: 2,
  distributed: 0,
};

// ─── Fortune Sheet conditional format helpers ────────────────────────────────

function cfStyleToFortune(style?: ExcelConditionalStyle): FortuneConditionalStyle {
  if (!style) return {};
  const result: FortuneConditionalStyle = {};
  if (style.fill?.fgColor?.argb) result.bg = argbToHex(style.fill.fgColor.argb);
  if (style.font?.color?.argb) result.fc = argbToHex(style.font.color.argb);
  if (style.font?.bold) result.bl = 1;
  if (style.font?.italic) result.it = 1;
  return result;
}

function buildConditions(ws: ExcelJS.Worksheet): FortuneCondition[] {
  const conditions: FortuneCondition[] = [];
  try {
    const cfs = (ws as WorksheetWithConditionalFormatting).conditionalFormattings ?? [];
    for (const cf of cfs) {
      for (const rule of cf.rules ?? []) {
        try {
          const base = {
            ref: cf.ref,
            type: rule.type,
            priority: rule.priority ?? 1,
          };
          if (rule.type === "cellIs") {
            conditions.push({
              ...base,
              operator: rule.operator,
              formulae: rule.formulae,
              format: cfStyleToFortune(rule.style),
            });
          } else if (rule.type === "colorScale") {
            const colors = Array.isArray(rule.color) ? rule.color : [];
            conditions.push({
              ...base,
              cfvo: rule.cfvo,
              color: colors.map((color) => argbToHex(color?.argb) ?? "#ffffff"),
            });
          } else if (rule.type === "dataBar") {
            const color = !Array.isArray(rule.color) ? (rule.color as ArgbColor | undefined) : undefined;
            conditions.push({
              ...base,
              cfvo: rule.cfvo,
              color: argbToHex(color?.argb),
            });
          } else if (rule.type === "formula") {
            conditions.push({
              ...base,
              formulae: rule.formulae,
              format: cfStyleToFortune(rule.style),
            });
          } else if (rule.type === "top10") {
            conditions.push({
              ...base,
              top: rule.top,
              percent: rule.percent,
              rank: rule.rank,
              format: cfStyleToFortune(rule.style),
            });
          }
          // Skip unknown types silently
        } catch {
          // skip malformed rule
        }
      }
    }
  } catch {
    // never fail import because of condFmt parse error
  }
  return conditions;
}

// ─── AutoFilter decoder ──────────────────────────────────────────────────────

function decodeAutoFilter(af: ExcelAutoFilter): AutoFilterSelection | null {
  try {
    let refStr: string | undefined;
    if (typeof af === "string") {
      refStr = af;
    } else if (af && typeof af === "object") {
      // {from: {row, col}, to: {row, col}}  (ExcelJS internal after reload)
      if (af.from && af.to) {
        const c1 = af.from.col !== undefined ? af.from.col - 1 : 0;
        const r1 = af.from.row !== undefined ? af.from.row - 1 : 0;
        const c2 = af.to.col !== undefined ? af.to.col - 1 : 0;
        const r2 = af.to.row !== undefined ? af.to.row - 1 : 0;
        return { row: [r1, r2], column: [c1, c2] };
      }
      // might have a ref string
      if (af.ref) refStr = af.ref;
    }
    if (!refStr) return null;
    const m = refStr.match(/\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)/i);
    if (!m) return null;
    const colLetterToIdx = (s: string) => {
      let n = 0;
      for (const ch of s.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
      return n - 1;
    };
    return {
      row: [parseInt(m[2]) - 1, parseInt(m[4]) - 1],
      column: [colLetterToIdx(m[1]), colLetterToIdx(m[3])],
    };
  } catch {
    return null;
  }
}

// ─── Main export ─────────────────────────────────────────────────────────────

export async function excelToFortune(buf: ArrayBuffer): Promise<FortuneSheet[]> {
  const excelJsModule = await import("exceljs");
  const ExcelJSRuntime = excelJsModule.default ?? excelJsModule;
  const wb = new ExcelJSRuntime.Workbook();
  await wb.xlsx.load(buf);

  const result: FortuneSheet[] = [];

  wb.eachSheet((ws, sheetId) => {
    const order = sheetId - 1;
    const celldata: FortuneCellData[] = [];
    const config: FortuneConfig = {};

    // ── Cells ────────────────────────────────────────────────────────────
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        // Skip non-primary merged cells
        if ((cell as { type: ExcelJS.ValueType.Merge }).type === ExcelJSRuntime.ValueType.Merge) return;

        const r = (cell.row as unknown as number) - 1;
        const c = (cell.col as unknown as number) - 1;

        const v: FortuneCellValue = {};

        // Value / formula
        const val = cell.value;
        if (val !== null && val !== undefined) {
          if (typeof val === "object" && "formula" in (val as object)) {
            const fv = val as { formula: string; result?: ExcelJS.CellValue };
            v.f = fv.formula;
            v.v = fv.result ?? null;
            v.m = fv.result !== undefined && fv.result !== null ? String(fv.result) : "";
          } else if (typeof val === "object" && "sharedFormula" in (val as object)) {
            const sfv = val as { sharedFormula: string; result?: ExcelJS.CellValue };
            v.f = sfv.sharedFormula;
            v.v = sfv.result ?? null;
            v.m = sfv.result !== undefined && sfv.result !== null ? String(sfv.result) : "";
          } else if (val instanceof Date) {
            v.v = val.getTime();
            v.m = cell.text ?? val.toLocaleDateString();
            v.ct = { fa: cell.numFmt || "General", t: "d" };
          } else {
            v.v = val;
            v.m = cell.text ?? (val !== undefined && val !== null ? String(val) : "");
          }
        }

        // Number format
        if (!v.ct) {
          const fa = cell.numFmt || "General";
          const t = typeof v.v === "number" ? "n" : typeof v.v === "boolean" ? "b" : "s";
          v.ct = { fa, t };
        }

        // Font
        const font = cell.font;
        if (font) {
          if (font.bold) v.bl = 1;
          if (font.italic) v.it = 1;
          if (font.underline && (font.underline === true || (font.underline as string) !== "none")) v.un = 1;
          if (font.strike) v.cl = 1;
          if (font.size) v.fs = font.size;
          const fc = argbToHex((font.color as { argb: string | undefined })?.argb);
          if (fc) v.fc = fc;
          if (font.name) v.ff = font.name;
        }

        // Fill
        const fill = cell.fill;
        if (fill && fill.type === "pattern" && fill.pattern && fill.pattern !== "none") {
          const bg = argbToHex(fill.fgColor?.argb);
          if (bg && bg !== "#000000" && bg !== "#FFFFFF") v.bg = bg;
          else if (bg) v.bg = bg;
        }

        // Alignment
        const align = cell.alignment;
        if (align) {
          if (align.horizontal && align.horizontal in H_ALIGN) v.ht = H_ALIGN[align.horizontal];
          if (align.vertical && align.vertical in V_ALIGN) v.vt = V_ALIGN[align.vertical];
          if (align.wrapText) v.tb = 2;
        }

        // Borders
        const border = cell.border as ExcelBorder;
        if (border) {
          const b: Record<string, FortuneBorderSegment> = {};
          for (const [side, fsKey] of [
            ["left", "l"],
            ["right", "r"],
            ["top", "t"],
            ["bottom", "b"],
          ] as [keyof ExcelBorder, string][]) {
            const bd = border[side];
            if (bd?.style && bd.style in BORDER_STYLE_MAP) {
              b[fsKey] = {
                style: BORDER_STYLE_MAP[bd.style],
                color: argbToHex(bd.color?.argb) ?? "#000000",
              };
            }
          }
          if (Object.keys(b).length > 0) v.b = b;
        }

        celldata.push({ r, c, v });
      });
    });

    // ── Merged cells ────────────────────────────────────────────────────
    const merges = (
      ws as unknown as ExcelJS.Worksheet & {
        _merges: Record<string, { model: { top: number; left: number; bottom: number; right: number } }> | undefined;
      }
    )._merges as Record<string, { model: { top: number; left: number; bottom: number; right: number } }> | undefined;
    if (merges && Object.keys(merges).length > 0) {
      config.merge = {};
      for (const entry of Object.values(merges)) {
        const m = entry.model;
        const r = m.top - 1;
        const c = m.left - 1;
        const rs = m.bottom - m.top + 1;
        const cs = m.right - m.left + 1;
        config.merge[`${r}_${c}`] = { r, c, rs, cs };
      }
    }

    // ── Column widths / hidden ───────────────────────────────────────────
    const columnlen: Record<string, number> = {};
    const colhidden: Record<string, number> = {};
    let maxColIdx = 0;

    ws.columns.forEach((col, idx) => {
      if (!col) return;
      maxColIdx = Math.max(maxColIdx, idx);
      if (col.width !== undefined && col.width !== null && (col.width as number) > 0) {
        columnlen[idx] = Math.round((col.width as number) * 7);
      }
      if (col.hidden) colhidden[idx] = 0;
    });

    if (Object.keys(columnlen).length > 0) config.columnlen = columnlen;
    if (Object.keys(colhidden).length > 0) config.colhidden = colhidden;

    // ── Row heights / hidden ─────────────────────────────────────────────
    const rowlen: Record<string, number> = {};
    const rowhidden: Record<string, number> = {};

    ws.eachRow({ includeEmpty: true }, (row) => {
      const ri = (row.number as number) - 1;
      if (row.height && (row.height as number) > 0) {
        rowlen[ri] = Math.round((row.height as number) * 1.333);
      }
      if ((row as { hidden: boolean | undefined }).hidden) rowhidden[ri] = 0;
    });

    if (Object.keys(rowlen).length > 0) config.rowlen = rowlen;
    if (Object.keys(rowhidden).length > 0) config.rowhidden = rowhidden;

    // ── Auto filter ──────────────────────────────────────────────────────
    let filter_select: AutoFilterSelection | null = null;
    const af = (ws as { autoFilter: ExcelAutoFilter | undefined }).autoFilter;
    if (af) {
      filter_select = decodeAutoFilter(af);
    }

    // ── Conditional formatting ───────────────────────────────────────────
    const conditions = buildConditions(ws);

    // ── Determine sheet dimensions ───────────────────────────────────────
    let maxR = 49;
    let maxC = 25;
    for (const cell of celldata) {
      if (cell.r > maxR) maxR = cell.r;
      if (cell.c > maxC) maxC = cell.c;
    }
    if (maxColIdx > maxC) maxC = maxColIdx;

    const sheet: FortuneSheetDraft = {
      id: String(order + 1),
      name: ws.name,
      status: order === 0 ? 1 : 0,
      order,
      celldata,
      row: Math.max(50, maxR + 10),
      column: Math.max(26, maxC + 5),
      config,
    };

    if (filter_select) sheet.filter_select = filter_select;
    if (conditions.length > 0) sheet.conditions = conditions;

    result.push(sheet as FortuneSheet);
  });

  return result;
}
