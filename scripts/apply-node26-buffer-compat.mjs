import fs from "node:fs";

const helperPath = "server/lib/bufferCompatibility.ts";
fs.writeFileSync(
  helperPath,
  `/**
 * Copy Node or library-owned binary data into a standalone ArrayBuffer.
 *
 * TypeScript 6 and Node 26 distinguish ArrayBuffer-backed views from views
 * backed by the wider ArrayBufferLike type. ExcelJS 3 and the Fetch BodyInit
 * declarations require an owned ArrayBuffer at these integration boundaries.
 */
export function toArrayBuffer(bytes: Uint8Array<ArrayBufferLike>): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
`,
);

const changes = [
  {
    path: "server/excelHelper.ts",
    importLine: `import { toArrayBuffer } from "./lib/bufferCompatibility";`,
    replacements: [["await workbook.xlsx.load(buffer);", "await workbook.xlsx.load(toArrayBuffer(buffer));"]],
  },
  {
    path: "server/routes/accountStatementRoutes.ts",
    importLine: `import { toArrayBuffer } from "../lib/bufferCompatibility";`,
    replacements: [["buffer: logoBuf as Buffer", "buffer: toArrayBuffer(logoBuf)"]],
  },
  {
    path: "server/routes/factory-payroll/exports.ts",
    importLine: `import { toArrayBuffer } from "../../lib/bufferCompatibility";`,
    replacements: [["buffer: buf as Buffer", "buffer: toArrayBuffer(buf)"]],
  },
  {
    path: "server/routes/factory-reports/_helpers.ts",
    importLine: `import { toArrayBuffer } from "../../lib/bufferCompatibility";`,
    replacements: [
      ["buffer: fs.readFileSync(hmdLogo) as Buffer", "buffer: toArrayBuffer(fs.readFileSync(hmdLogo))"],
    ],
  },
  {
    path: "server/routes/factory/customer-orders/orderHelpers.ts",
    importLine: `import { toArrayBuffer } from "../../../lib/bufferCompatibility";`,
    replacements: [["buffer: logoBuf as Buffer", "buffer: toArrayBuffer(logoBuf)"]],
  },
  {
    path: "server/routes/factory/customer-orders/pdf-export/loading-status.ts",
    importLine: `import { toArrayBuffer } from "../../../../lib/bufferCompatibility";`,
    replacements: [["buffer: fs.readFileSync(lp) as Buffer", "buffer: toArrayBuffer(fs.readFileSync(lp))"]],
  },
  {
    path: "server/routes/factory/customer-orders/pdf-export/pending.ts",
    importLine: `import { toArrayBuffer } from "../../../../lib/bufferCompatibility";`,
    replacements: [
      ["buffer: fs.readFileSync(ldLogoPath) as Buffer", "buffer: toArrayBuffer(fs.readFileSync(ldLogoPath))"],
    ],
  },
  {
    path: "server/routes/factory/customer-proformas/exports.ts",
    importLine: `import { toArrayBuffer } from "../../../lib/bufferCompatibility";`,
    replacements: [["buffer: pxBuf as Buffer", "buffer: toArrayBuffer(pxBuf)"]],
  },
  {
    path: "server/routes/factory/customers-core/statement-excel.ts",
    importLine: `import { toArrayBuffer } from "../../../lib/bufferCompatibility";`,
    replacements: [["buffer: slBuf as Buffer", "buffer: toArrayBuffer(slBuf)"]],
  },
  {
    path: "server/routes/payroll/core/preview.ts",
    importLine: `import { toArrayBuffer } from "../../../lib/bufferCompatibility";`,
    replacements: [["buffer: buf as Buffer", "buffer: toArrayBuffer(buf)"]],
  },
  {
    path: "server/services/export-excel/workbook.ts",
    importLine: `import { toArrayBuffer } from "../../lib/bufferCompatibility";`,
    replacements: [
      [
        "return wb.xlsx.writeBuffer() as Promise<Buffer>;",
        "const workbookBuffer = await wb.xlsx.writeBuffer();\n  return Buffer.from(new Uint8Array(toArrayBuffer(new Uint8Array(workbookBuffer))));",
      ],
    ],
  },
  {
    path: "server/services/sp-sales-form/generate.ts",
    importLine: `import { toArrayBuffer } from "../../lib/bufferCompatibility";`,
    replacements: [
      ["const buf = Buffer.isBuffer(rawBuf) ? rawBuf : Buffer.from(rawBuf);", "const buf = Buffer.from(new Uint8Array(rawBuf));"],
      ["await wbCheck.xlsx.load(buf);", "await wbCheck.xlsx.load(toArrayBuffer(buf));"],
    ],
  },
  {
    path: "server/services/whatsappService.ts",
    importLine: `import { toArrayBuffer } from "../lib/bufferCompatibility";`,
    replacements: [["body: multipartBody,", "body: toArrayBuffer(multipartBody),"]],
  },
];

for (const change of changes) {
  let source = fs.readFileSync(change.path, "utf8");
  if (!source.includes(change.importLine)) source = `${change.importLine}\n${source}`;

  for (const [before, after] of change.replacements) {
    if (!source.includes(before)) {
      throw new Error(`Expected source fragment not found in ${change.path}: ${before}`);
    }
    source = source.replaceAll(before, after);
  }

  fs.writeFileSync(change.path, source);
}
