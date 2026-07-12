import type { RequestHandler, Response } from "express";
import type ExcelJS from "exceljs";

const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PDF_CONTENT_TYPE = "application/pdf";

export function isStreamedExportContentType(value: unknown): boolean {
  const contentType = String(value || "").toLowerCase();
  return contentType.includes(XLSX_CONTENT_TYPE) || contentType.includes(PDF_CONTENT_TYPE);
}

export function applyExportStreamingHeaders(res: Pick<Response, "setHeader">): void {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
}

export function createExportResponseHardeningMiddleware(): RequestHandler {
  return (_req, res, next) => {
    const originalSetHeader = res.setHeader.bind(res);

    res.setHeader = ((name: string, value: number | string | readonly string[]) => {
      const result = originalSetHeader(name, value);
      if (name.toLowerCase() === "content-type" && isStreamedExportContentType(value)) {
        originalSetHeader("Cache-Control", "private, no-store, max-age=0");
        originalSetHeader("Pragma", "no-cache");
        originalSetHeader("X-Accel-Buffering", "no");
      }
      return result;
    }) as typeof res.setHeader;

    next();
  };
}

export async function streamExcelWorkbook(
  workbook: Pick<ExcelJS.Workbook, "xlsx">,
  res: Pick<Response, "setHeader" | "end" | "writableEnded">
): Promise<void> {
  res.setHeader("Content-Type", XLSX_CONTENT_TYPE);
  applyExportStreamingHeaders(res as Pick<Response, "setHeader">);
  await workbook.xlsx.write(res as NodeJS.WritableStream);
  if (!res.writableEnded) res.end();
}

export function preparePdfStream(res: Pick<Response, "setHeader">): void {
  res.setHeader("Content-Type", PDF_CONTENT_TYPE);
  applyExportStreamingHeaders(res);
}
