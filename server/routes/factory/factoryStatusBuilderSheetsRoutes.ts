import { parseId, parseOptionalId } from "../../lib/parseId";
import type { Express } from "express";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import { statusBuilderSheets } from "@shared/schema";
import { eq, and, asc } from "drizzle-orm";
import multer from "multer";
import { read as readExcel, utils as xlsxUtils, write as writeExcel, WorkBook } from "xlsx";

const upload = multer({ storage: multer.memoryStorage() });

type CellVal = number | string | null;
type SRow = { id?: string; label: string; cells: any[] };

function getColLabel(col: any): string {
  if (typeof col === "string") return col;
  return col?.label ?? "";
}

function getCellRawValue(cell: any): CellVal {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "number" || typeof cell === "string") return cell;
  if (typeof cell === "object" && "value" in cell) return cell.value ?? null;
  return null;
}

export function registerFactoryStatusBuilderSheetsRoutes(app: Express) {

  // ── List all sheets ────────────────────────────────────────────────────────
  app.get("/api/factory/status-builder/sheets", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId!;
      const sheets = await db
        .select()
        .from(statusBuilderSheets)
        .where(eq(statusBuilderSheets.companyId, companyId))
        .orderBy(asc(statusBuilderSheets.orderIndex), asc(statusBuilderSheets.id));
      res.json(sheets);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Create a new blank sheet ───────────────────────────────────────────────
  app.post("/api/factory/status-builder/sheets", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId!;
      const { name } = req.body;
      if (!name?.trim()) return res.status(400).json({ message: "Sheet name is required" });

      const existing = await db
        .select({ orderIndex: statusBuilderSheets.orderIndex })
        .from(statusBuilderSheets)
        .where(eq(statusBuilderSheets.companyId, companyId))
        .orderBy(asc(statusBuilderSheets.orderIndex));

      const maxOrder = existing.length > 0
        ? Math.max(...existing.map(r => r.orderIndex))
        : -1;

      const [created] = await db
        .insert(statusBuilderSheets)
        .values({
          companyId,
          name: name.trim(),
          orderIndex: maxOrder + 1,
          columns: [],
          rows: [],
        })
        .returning();

      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Update a sheet ─────────────────────────────────────────────────────────
  app.put("/api/factory/status-builder/sheets/:id", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId!;
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

      const { name, columns, rows } = req.body;

      const updateData: Partial<typeof statusBuilderSheets.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (name !== undefined) updateData.name = name;
      if (columns !== undefined) updateData.columns = columns;
      if (rows !== undefined) updateData.rows = rows;

      const [updated] = await db
        .update(statusBuilderSheets)
        .set(updateData)
        .where(and(eq(statusBuilderSheets.id, id), eq(statusBuilderSheets.companyId, companyId)))
        .returning();

      if (!updated) return res.status(404).json({ message: "Sheet not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Delete a sheet ─────────────────────────────────────────────────────────
  app.delete("/api/factory/status-builder/sheets/:id", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId!;
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

      const [deleted] = await db
        .delete(statusBuilderSheets)
        .where(and(eq(statusBuilderSheets.id, id), eq(statusBuilderSheets.companyId, companyId)))
        .returning();

      if (!deleted) return res.status(404).json({ message: "Sheet not found" });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Import Excel ───────────────────────────────────────────────────────────
  app.post("/api/factory/status-builder/sheets/import", requireAuth, upload.single("file"), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId!;
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const wb: WorkBook = readExcel(req.file.buffer, { type: "buffer", cellDates: true });

      await db.delete(statusBuilderSheets).where(eq(statusBuilderSheets.companyId, companyId));

      const created = [];
      for (let sheetIdx = 0; sheetIdx < wb.SheetNames.length; sheetIdx++) {
        const sheetName = wb.SheetNames[sheetIdx];
        const ws = wb.Sheets[sheetName];
        const rawData: any[][] = xlsxUtils.sheet_to_json(ws, { header: 1, defval: null });

        if (!rawData || rawData.length === 0) {
          const [s] = await db.insert(statusBuilderSheets).values({
            companyId,
            name: sheetName,
            orderIndex: sheetIdx,
            columns: [],
            rows: [],
          }).returning();
          created.push(s);
          continue;
        }

        const headerRow = rawData[0] ?? [];
        const columns: string[] = headerRow.slice(1).map((h: any) =>
          h == null ? "" : String(h)
        );

        const rows: { label: string; cells: (number | string | null)[] }[] = [];
        for (let r = 1; r < rawData.length; r++) {
          const rawRow = rawData[r] ?? [];
          const hasData = rawRow.some((v: any) => v !== null && v !== undefined && v !== "");
          if (!hasData) continue;

          const rawLabel = rawRow[0];
          let label: string;
          if (rawLabel == null) {
            label = "";
          } else if (rawLabel instanceof Date) {
            const y = rawLabel.getFullYear();
            const m = String(rawLabel.getMonth() + 1).padStart(2, "0");
            const d = String(rawLabel.getDate()).padStart(2, "0");
            label = `${y}-${m}-${d}`;
          } else {
            label = String(rawLabel).trim();
          }

          const cells: (number | string | null)[] = rawRow.slice(1).map((v: any) => {
            if (v === null || v === undefined || v === "") return null;
            if (v instanceof Date) {
              const y = v.getFullYear();
              const m = String(v.getMonth() + 1).padStart(2, "0");
              const d = String(v.getDate()).padStart(2, "0");
              return `${y}-${m}-${d}`;
            }
            const n = Number(v);
            return isNaN(n) ? String(v).trim() : n;
          });
          while (cells.length < columns.length) cells.push(null);
          rows.push({ label, cells: cells.slice(0, columns.length) });
        }

        const [s] = await db.insert(statusBuilderSheets).values({
          companyId,
          name: sheetName,
          orderIndex: sheetIdx,
          columns,
          rows,
        }).returning();
        created.push(s);
      }

      const finalSheets = await db
        .select()
        .from(statusBuilderSheets)
        .where(eq(statusBuilderSheets.companyId, companyId))
        .orderBy(asc(statusBuilderSheets.orderIndex), asc(statusBuilderSheets.id));

      res.json(finalSheets);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Template download ──────────────────────────────────────────────────────
  app.get("/api/factory/status-builder/sheets/template", requireAuth, async (_req, res) => {
    try {
      const wb = xlsxUtils.book_new();

      const sheet1: any[][] = [
        ["Label", "Week 1", "Week 2", "Week 3", "Week 4"],
        ["Target",  150,  150,  150,  150],
        ["Actual",  120,  135,  140,  155],
        ["Variance", -30, -15, -10,    5],
      ];
      const ws1 = xlsxUtils.aoa_to_sheet(sheet1);
      ws1["!cols"] = [{ wch: 20 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
      xlsxUtils.book_append_sheet(wb, ws1, "Status Overview");

      const buf: Buffer = writeExcel(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Disposition", 'attachment; filename="status-builder-template.xlsx"');
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.send(buf);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Export all sheets as .xlsx ─────────────────────────────────────────────
  app.get("/api/factory/status-builder/sheets/export", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId!;
      const sheets = await db
        .select()
        .from(statusBuilderSheets)
        .where(eq(statusBuilderSheets.companyId, companyId))
        .orderBy(asc(statusBuilderSheets.orderIndex), asc(statusBuilderSheets.id));

      const wb = xlsxUtils.book_new();

      for (const sheet of sheets) {
        const rawColumns = (sheet.columns as any[]) ?? [];
        const rows = (sheet.rows as SRow[]) ?? [];
        const colLabels = rawColumns.map(getColLabel);

        const headerRow = ["", ...colLabels];
        const dataRows = rows.map(r => [r.label, ...r.cells.map((c: any) => getCellRawValue(c) ?? "")]);

        const diffCells = colLabels.map((_, colIdx) => {
          const sum = rows.reduce((acc, r) => {
            const v = getCellRawValue(r.cells[colIdx]);
            return acc + (typeof v === "number" ? v : 0);
          }, 0);
          return sum;
        });
        const diffRow = ["DIFFERENCE", ...diffCells];

        const aoa = [headerRow, ...dataRows, diffRow];
        const ws = xlsxUtils.aoa_to_sheet(aoa);
        ws["!cols"] = [{ wch: 25 }, ...colLabels.map(() => ({ wch: 16 }))];
        xlsxUtils.book_append_sheet(wb, ws, sheet.name.slice(0, 31));
      }

      const buf: Buffer = writeExcel(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Disposition", 'attachment; filename="status-builder.xlsx"');
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.send(buf);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
