import ExcelJS from "exceljs";
import type { Sheet as FortuneSheet } from "@fortune-sheet/core";

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

function cfStyleToFortune(style: any): any {
  if (!style) return {};
  const result: any = {};
  if (style.fill?.fgColor?.argb) result.bg = argbToHex(style.fill.fgColor.argb);
  if (style.font?.color?.argb) result.fc = argbToHex(style.font.color.argb);
  if (style.font?.bold) result.bl = 1;
  if (style.font?.italic) result.it = 1;
  return result;
}

function buildConditions(ws: any): any[] {
  const conditions: any[] = [];
  try {
    const cfs: any[] = ws.conditionalFormattings || [];
    for (const cf of cfs) {
      for (const rule of cf.rules || []) {
        try {
          const base: any = {
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
            conditions.push({
              ...base,
              cfvo: rule.cfvo,
              color: (rule.color || []).map((c: any) => argbToHex(c?.argb) ?? "#ffffff"),
            });
          } else if (rule.type === "dataBar") {
            conditions.push({
              ...base,
              cfvo: rule.cfvo,
              color: argbToHex(rule.color?.argb),
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

function decodeAutoFilter(af: any): { row: [number, number]; column: [number, number] } | null {
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
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);

  const result: FortuneSheet[] = [];

  wb.eachSheet((ws, sheetId) => {
    const order = sheetId - 1;
    const celldata: any[] = [];
    const config: any = {};

    // ── Cells ────────────────────────────────────────────────────────────
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        // Skip non-primary merged cells
        if ((cell as any).type === ExcelJS.ValueType.Merge) return;

        const r = (cell.row as unknown as number) - 1;
        const c = (cell.col as unknown as number) - 1;

        const v: any = {};

        // Value / formula
        const val = cell.value;
        if (val !== null && val !== undefined) {
          if (typeof val === "object" && "formula" in (val as object)) {
            const fv = val as { formula: string; result?: any };
            v.f = fv.formula;
            v.v = fv.result ?? null;
            v.m = fv.result !== undefined && fv.result !== null ? String(fv.result) : "";
          } else if (typeof val === "object" && "sharedFormula" in (val as object)) {
            const sfv = val as { sharedFormula: string; result?: any };
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
          const fc = argbToHex((font.color as any)?.argb);
          if (fc) v.fc = fc;
          if (font.name) v.ff = font.name;
        }

        // Fill
        const fill = cell.fill as any;
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
        const border = cell.border as any;
        if (border) {
          const b: any = {};
          for (const [side, fsKey] of [
            ["left", "l"],
            ["right", "r"],
            ["top", "t"],
            ["bottom", "b"],
          ] as [string, string][]) {
            const bd = border[side];
            if (bd?.style && bd.style in BORDER_STYLE_MAP) {
              b[fsKey] = {
                style: BORDER_STYLE_MAP[bd.style],
                color: argbToHex((bd.color as any)?.argb) ?? "#000000",
              };
            }
          }
          if (Object.keys(b).length > 0) v.b = b;
        }

        celldata.push({ r, c, v });
      });
    });

    // ── Merged cells ────────────────────────────────────────────────────
    const merges = (ws as any)._merges as
      | Record<string, { model: { top: number; left: number; bottom: number; right: number } }>
      | undefined;
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
      if ((row as any).hidden) rowhidden[ri] = 0;
    });

    if (Object.keys(rowlen).length > 0) config.rowlen = rowlen;
    if (Object.keys(rowhidden).length > 0) config.rowhidden = rowhidden;

    // ── Auto filter ──────────────────────────────────────────────────────
    let filter_select: any = null;
    const af = (ws as any).autoFilter;
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

    const sheet: any = {
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
