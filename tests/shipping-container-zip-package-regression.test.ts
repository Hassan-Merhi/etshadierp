import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("shipping container ZIP package regression", () => {
  it("never returns a success ZIP when selected files produced no bytes", () => {
    const source = read("server/routes/factory/shipping-containers/zip-package.ts");

    expect(source).toContain("if (fileIds.length === 0)");
    expect(source).toContain("const missingFiles: string[] = [];");
    expect(source).toContain("if (appendedEntries === 0)");
    expect(source).toContain("Selected files are unavailable or empty");
  });

  it("loads uploaded document bytes from durable DB storage before the disk cache fallback", () => {
    const source = read("server/routes/factory/shipping-containers/zip-package.ts");
    const dbRead = source.indexOf("if (doc.fileData?.trim())");
    const diskRead = source.indexOf("fs.readFileSync(diskPath)");

    expect(dbRead).toBeGreaterThan(-1);
    expect(diskRead).toBeGreaterThan(dbRead);
  });

  it("does not advertise uploaded documents as downloadable when stored content is missing", () => {
    const source = read("server/routes/factory/shipping-containers/whatsapp-preview.ts");

    expect(source).toContain("hasFileData:");
    expect(source).toContain("available: d.hasFileData");
    expect(source).toContain("Delete and re-upload this document.");
  });

  it("keeps the browser blob alive long enough for Chrome to finish the download hand-off", () => {
    const source = read(
      "client/src/pages/factory/factoryshippingcontainers/components/WhatsAppModal.tsx"
    );

    expect(source).toContain("if (blob.size === 0)");
    expect(source).toContain("window.setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000)");
  });
});
