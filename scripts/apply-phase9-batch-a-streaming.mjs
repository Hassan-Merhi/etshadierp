import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

const targets = [
  {
    file: "server/routes/factory/customer-orders/orderExcelExportRoutes.ts",
    importAnchor: 'import { buildExportFilename, buildOrderExcelBuffer } from "./orderHelpers";\n',
    importLine: 'import { writeWorkbookToResponse } from "../../../excelHelper";\n',
    replacements: [
      {
        from: '      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");\n      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);\n            res.end(await workbook.xlsx.writeBuffer());',
        to: '      await writeWorkbookToResponse(workbook, res, fileName);',
        expected: 2,
      },
    ],
  },
  {
    file: "server/routes/factoryPayrollRoutes.ts",
    importAnchor: 'import type { Express } from "express";\n',
    importLine: 'import { writeWorkbookToResponse } from "../excelHelper";\n',
    replacements: [
      {
        from: 'res.end(await workbook.xlsx.writeBuffer())',
        to: 'await writeWorkbookToResponse(workbook, res, fileName)',
        expected: 1,
      },
    ],
  },
];

function countOccurrences(text, needle) {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while ((index = text.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
}

for (const target of targets) {
  const absolute = path.join(root, target.file);
  let source = await fs.readFile(absolute, "utf8");

  if (!source.includes(target.importLine)) {
    if (!source.includes(target.importAnchor)) {
      throw new Error(`${target.file}: import anchor not found`);
    }
    source = source.replace(target.importAnchor, `${target.importAnchor}${target.importLine}`);
  }

  for (const replacement of target.replacements) {
    const found = countOccurrences(source, replacement.from);
    if (found !== replacement.expected) {
      throw new Error(
        `${target.file}: expected ${replacement.expected} occurrence(s), found ${found}. Refusing broad or partial rewrite.`
      );
    }
    source = source.split(replacement.from).join(replacement.to);
  }

  if (source.includes("workbook.xlsx.writeBuffer()") && target.file.includes("orderExcelExportRoutes")) {
    throw new Error(`${target.file}: direct workbook writeBuffer remains after conversion`);
  }

  await fs.writeFile(absolute, source, "utf8");
  console.log(`Updated ${target.file}`);
}

console.log("Phase 9 Batch A streaming replacements applied safely.");
