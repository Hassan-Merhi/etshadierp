import type { Express } from "express";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import { factorySheets } from "@shared/schema";
import { eq, and, asc } from "drizzle-orm";
import multer from "multer";
import { read as readExcel, utils as xlsxUtils, write as writeExcel, WorkBook } from "xlsx";

const upload = multer({ storage: multer.memoryStorage() });

export function registerFactorySheetsRoutes(app: Express) {

  // ── List all sheets for current company ───────────────────────────────────
  app.get("/api/factory/sheets", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId!;
      const sheets = await db
        .select()
        .from(factorySheets)
        .where(eq(factorySheets.companyId, companyId))
        .orderBy(asc(factorySheets.orderIndex), asc(factorySheets.id));
      res.json(sheets);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Create a new blank sheet ───────────────────────────────────────────────
  app.post("/api/factory/sheets", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId!;
      const { name } = req.body;
      if (!name?.trim()) return res.status(400).json({ message: "Sheet name is required" });

      const existing = await db
        .select({ orderIndex: factorySheets.orderIndex })
        .from(factorySheets)
        .where(eq(factorySheets.companyId, companyId))
        .orderBy(asc(factorySheets.orderIndex));

      const maxOrder = existing.length > 0
        ? Math.max(...existing.map(r => r.orderIndex))
        : -1;

      const [created] = await db
        .insert(factorySheets)
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

  // ── Update a sheet (rename or save grid) ──────────────────────────────────
  app.put("/api/factory/sheets/:id", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId!;
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

      const { name, columns, rows } = req.body;

      const updateData: Partial<typeof factorySheets.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (name !== undefined) updateData.name = name;
      if (columns !== undefined) updateData.columns = columns;
      if (rows !== undefined) updateData.rows = rows;

      const [updated] = await db
        .update(factorySheets)
        .set(updateData)
        .where(and(eq(factorySheets.id, id), eq(factorySheets.companyId, companyId)))
        .returning();

      if (!updated) return res.status(404).json({ message: "Sheet not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Delete a sheet ─────────────────────────────────────────────────────────
  app.delete("/api/factory/sheets/:id", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId!;
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

      const [deleted] = await db
        .delete(factorySheets)
        .where(and(eq(factorySheets.id, id), eq(factorySheets.companyId, companyId)))
        .returning();

      if (!deleted) return res.status(404).json({ message: "Sheet not found" });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Import Excel — creates/replaces sheets from uploaded .xlsx ─────────────
  app.post("/api/factory/sheets/import", requireAuth, upload.single("file"), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId!;
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const wb: WorkBook = readExcel(req.file.buffer, { type: "buffer", cellDates: true });

      // Delete all existing sheets for this company, then re-create
      await db.delete(factorySheets).where(eq(factorySheets.companyId, companyId));

      const created = [];
      for (let sheetIdx = 0; sheetIdx < wb.SheetNames.length; sheetIdx++) {
        const sheetName = wb.SheetNames[sheetIdx];
        const ws = wb.Sheets[sheetName];
        const rawData: any[][] = xlsxUtils.sheet_to_json(ws, { header: 1, defval: null });

        if (!rawData || rawData.length === 0) {
          // Empty sheet — just create blank
          const [s] = await db.insert(factorySheets).values({
            companyId,
            name: sheetName,
            orderIndex: sheetIdx,
            columns: [],
            rows: [],
          }).returning();
          created.push(s);
          continue;
        }

        // First row = column headers (skip empty leading cells in first col)
        const headerRow = rawData[0] ?? [];
        // Col 0 is the row-label column; cols 1..N are data columns
        const columns: string[] = headerRow.slice(1).map((h: any) =>
          h == null ? "" : String(h)
        );

        const rows: { label: string; cells: (number | null)[] }[] = [];
        for (let r = 1; r < rawData.length; r++) {
          const rawRow = rawData[r] ?? [];
          const label = rawRow[0] == null ? "" : String(rawRow[0]);
          const cells: (number | null)[] = rawRow.slice(1).map((v: any) => {
            if (v === null || v === undefined || v === "") return null;
            const n = Number(v);
            return isNaN(n) ? null : n;
          });
          // Pad or trim cells to match column count
          while (cells.length < columns.length) cells.push(null);
          rows.push({ label, cells: cells.slice(0, columns.length) });
        }

        const [s] = await db.insert(factorySheets).values({
          companyId,
          name: sheetName,
          orderIndex: sheetIdx,
          columns,
          rows,
        }).returning();
        created.push(s);
      }

      res.json(created);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Export all sheets as styled .xlsx ─────────────────────────────────────
  app.get("/api/factory/sheets/export", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId!;
      const sheets = await db
        .select()
        .from(factorySheets)
        .where(eq(factorySheets.companyId, companyId))
        .orderBy(asc(factorySheets.orderIndex), asc(factorySheets.id));

      const wb = xlsxUtils.book_new();

      for (const sheet of sheets) {
        const columns = (sheet.columns as string[]) ?? [];
        const rows = (sheet.rows as { label: string; cells: (number | null)[] }[]) ?? [];

        // Build the 2D array: header row + data rows + difference row
        const headerRow = ["", ...columns];
        const dataRows = rows.map(r => [r.label, ...r.cells.map(c => c ?? "")]);

        // Difference row = sum of all cells per column
        const diffCells = columns.map((_, colIdx) => {
          const sum = rows.reduce((acc, r) => {
            const v = r.cells[colIdx];
            return acc + (typeof v === "number" ? v : 0);
          }, 0);
          return sum;
        });
        const diffRow = ["DIFFERENCE", ...diffCells];

        const aoa = [headerRow, ...dataRows, diffRow];
        const ws = xlsxUtils.aoa_to_sheet(aoa);

        // Column widths
        ws["!cols"] = [{ wch: 25 }, ...columns.map(() => ({ wch: 16 }))];

        xlsxUtils.book_append_sheet(wb, ws, sheet.name.slice(0, 31));
      }

      const buf: Buffer = writeExcel(wb, { type: "buffer", bookType: "xlsx" });

      res.setHeader("Content-Disposition", 'attachment; filename="factory-sheets.xlsx"');
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.send(buf);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
