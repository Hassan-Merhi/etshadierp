import { describe, expect, it } from "vitest";
import {
  mergeStockTransferConvergenceEvidence,
  type StockTransferDocumentSnapshot,
  type StockTransferMovementEvidence,
} from "../server/services/inventory/databaseStockTransferConvergenceAdapter";

const document: StockTransferDocumentSnapshot = {
  sourceType: "stock-transfer",
  sourceId: "501",
  transferId: 501,
  voucherId: 701,
  companyId: 7,
  documentQuantity: "3.000001",
  documentValue: "18.000006",
};

const evidence: StockTransferMovementEvidence = {
  sourceType: "stock-transfer",
  sourceId: "501",
  companyId: 7,
  movementQuantity: "3.000000",
  movementValue: "18.000000",
};

describe("mergeStockTransferConvergenceEvidence", () => {
  it("preserves authoritative six-decimal document and movement evidence without Number coercion", () => {
    expect(
      mergeStockTransferConvergenceEvidence({
        companyId: 7,
        documents: [document],
        evidence: [evidence],
      })
    ).toEqual([
      {
        sourceType: "stock-transfer",
        sourceId: "501",
        companyId: 7,
        documentQuantity: "3.000001",
        movementQuantity: "3.000000",
        documentValue: "18.000006",
        movementValue: "18.000000",
      },
    ]);
  });

  it("fails closed when canonical movement evidence is missing", () => {
    expect(() =>
      mergeStockTransferConvergenceEvidence({
        companyId: 7,
        documents: [document],
        evidence: [],
      })
    ).toThrowError(expect.objectContaining({ code: "CONVERGENCE_STOCK_EVIDENCE_MISSING" }));
  });

  it("rejects duplicate authoritative documents and duplicate canonical evidence", () => {
    expect(() =>
      mergeStockTransferConvergenceEvidence({
        companyId: 7,
        documents: [document, { ...document }],
        evidence: [evidence],
      })
    ).toThrowError(expect.objectContaining({ code: "CONVERGENCE_DUPLICATE_SNAPSHOT" }));

    expect(() =>
      mergeStockTransferConvergenceEvidence({
        companyId: 7,
        documents: [document],
        evidence: [evidence, { ...evidence }],
      })
    ).toThrowError(expect.objectContaining({ code: "CONVERGENCE_DUPLICATE_SNAPSHOT" }));
  });

  it("rejects cross-company and unexpected movement evidence", () => {
    expect(() =>
      mergeStockTransferConvergenceEvidence({
        companyId: 7,
        documents: [document],
        evidence: [{ ...evidence, companyId: 8 }],
      })
    ).toThrowError(expect.objectContaining({ code: "CONVERGENCE_COMPANY_MISMATCH" }));

    expect(() =>
      mergeStockTransferConvergenceEvidence({
        companyId: 7,
        documents: [document],
        evidence: [{ ...evidence, sourceId: "999" }],
      })
    ).toThrowError(expect.objectContaining({ code: "CONVERGENCE_UNEXPECTED_STOCK_EVIDENCE" }));
  });

  it("rejects malformed stock identities instead of certifying ambiguous evidence", () => {
    expect(() =>
      mergeStockTransferConvergenceEvidence({
        companyId: 7,
        documents: [{ ...document, sourceId: "" }],
        evidence: [evidence],
      })
    ).toThrowError(expect.objectContaining({ code: "CONVERGENCE_IDENTITY_INVALID" }));
  });
});
