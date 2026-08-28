import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const panel = fs.readFileSync(
  path.join(process.cwd(), "client/src/pages/factory/factorycontainerloadingscan/ScannedBalesPanel.tsx"),
  "utf8"
);

describe("container loading scan audit display contract", () => {
  it("keeps legacy unknown timestamps blank rather than fabricating a date", () => {
    expect(panel).toContain("if (!value) return null");
    expect(panel).toContain("scanAudit && (scanAudit.scannedBy || scannedAtText)");
  });
});
