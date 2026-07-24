/**
 * Unit tests for client/src/lib/zplBuilder.ts — builds Zebra ZPL label payloads
 * for stock/article labels. Numeric formatting uses toFixed (locale-independent),
 * so exact-string assertions are safe here.
 */
import {
  buildZplLabel,
  buildZplNameOnlyLabel,
  buildZplBatch,
  type ZplLabelData,
} from "@/lib/zplBuilder";

const sample: ZplLabelData = {
  referenceNumber: "REF-001",
  articleCode: "ART-9",
  pieces: 10,
  approxWeightKg: 2.5,
  productName: "cotton fabric",
};

describe("buildZplLabel", () => {
  const zpl = buildZplLabel(sample);

  it("is wrapped in the ZPL start/end markers", () => {
    expect(zpl.startsWith("^XA")).toBe(true);
    expect(zpl.trimEnd().endsWith("^XZ")).toBe(true);
  });

  it("uppercases the product name", () => {
    expect(zpl).toContain("COTTON FABRIC");
    expect(zpl).not.toContain("cotton fabric");
  });

  it("embeds pieces, article, and weight fields", () => {
    expect(zpl).toContain("PIECES: 10");
    expect(zpl).toContain("ARTICLE: ART-9");
    expect(zpl).toContain("APRX WEIGHT: 2.5 KGS");
  });

  it("formats whole-number weights without a trailing decimal", () => {
    const z = buildZplLabel({ ...sample, approxWeightKg: 3.0 });
    expect(z).toContain("APRX WEIGHT: 3 KGS");
  });

  it("accepts numeric strings for pieces/weight", () => {
    const z = buildZplLabel({ ...sample, pieces: "12", approxWeightKg: "4.25" });
    expect(z).toContain("PIECES: 12");
    expect(z).toContain("APRX WEIGHT: 4.25 KGS");
  });

  it("truncates very long product names to 40 characters", () => {
    const longName = "A".repeat(60);
    const z = buildZplLabel({ ...sample, productName: longName });
    expect(z).toContain("A".repeat(40));
    expect(z).not.toContain("A".repeat(41));
  });
});

describe("buildZplNameOnlyLabel", () => {
  it("uppercases and wraps a name-only label", () => {
    const z = buildZplNameOnlyLabel("silk roll");
    expect(z.startsWith("^XA")).toBe(true);
    expect(z).toContain("SILK ROLL");
  });

  it("tolerates an empty name", () => {
    expect(() => buildZplNameOnlyLabel("")).not.toThrow();
  });
});

describe("buildZplBatch", () => {
  const labels: ZplLabelData[] = [sample, { ...sample, productName: "linen" }];

  it("emits one label block per item when dualLabel is false", () => {
    const batch = buildZplBatch(labels, false);
    expect(batch.match(/\^XA/g)?.length).toBe(2);
  });

  it("emits a name-only label alongside each item when dualLabel is true", () => {
    const batch = buildZplBatch(labels, true);
    expect(batch.match(/\^XA/g)?.length).toBe(4);
    expect(batch).toContain("LINEN");
  });

  it("produces nothing for an empty batch", () => {
    expect(buildZplBatch([], true)).toBe("");
  });
});
