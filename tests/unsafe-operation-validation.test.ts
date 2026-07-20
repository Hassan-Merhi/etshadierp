import { describe, expect, it } from "vitest";
import {
  UnsafeInputError,
  requireMutationProvenance,
  validateUnsafeOperationInput,
} from "../server/services/security/unsafeOperationValidation";

const schema = {
  fields: {
    companyId: { kind: "positive-integer", required: true },
    amount: { kind: "decimal", required: true },
    effectiveDate: { kind: "date", required: true },
    mode: { kind: "enum", required: true, enumValues: ["dry-run", "apply"] },
    note: { kind: "string", maxLength: 100 },
    rows: { kind: "array" },
  },
  maxDepth: 4,
  maxArrayLength: 2,
} as const;

function validPayload() {
  return {
    companyId: 10,
    amount: "12.345678",
    effectiveDate: "2026-07-18",
    mode: "dry-run",
  };
}

describe("unsafe operation validation", () => {
  it("accepts a strict valid mutation payload", () => {
    expect(validateUnsafeOperationInput({ payload: validPayload(), schema, operation: "repair.apply" }))
      .toEqual(validPayload());
  });

  it("rejects unknown fields by default", () => {
    expect(() => validateUnsafeOperationInput({
      payload: { ...validPayload(), bypassAuthorization: true },
      schema,
      operation: "repair.apply",
    })).toThrowError(UnsafeInputError);
  });

  it("rejects invalid and unsafe numeric values", () => {
    for (const companyId of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => validateUnsafeOperationInput({
        payload: { ...validPayload(), companyId },
        schema,
        operation: "repair.apply",
      })).toThrowError(UnsafeInputError);
    }
  });

  it("rejects decimals beyond six fractional digits", () => {
    expect(() => validateUnsafeOperationInput({
      payload: { ...validPayload(), amount: "12.3456789" },
      schema,
      operation: "repair.apply",
    })).toThrowError(UnsafeInputError);
  });

  it("rejects impossible calendar dates", () => {
    expect(() => validateUnsafeOperationInput({
      payload: { ...validPayload(), effectiveDate: "2026-02-30" },
      schema,
      operation: "repair.apply",
    })).toThrowError(UnsafeInputError);
  });

  it("rejects oversized arrays", () => {
    expect(() => validateUnsafeOperationInput({
      payload: { ...validPayload(), rows: [1, 2, 3] },
      schema,
      operation: "repair.apply",
    })).toThrowError(UnsafeInputError);
  });

  it("rejects prototype-pollution keys", () => {
    const payload = JSON.parse('{"companyId":10,"amount":"1.000000","effectiveDate":"2026-07-18","mode":"apply","__proto__":{"admin":true}}');
    expect(() => validateUnsafeOperationInput({ payload, schema, operation: "repair.apply" }))
      .toThrowError(UnsafeInputError);
  });

  it("requires mutation provenance", () => {
    expect(requireMutationProvenance({
      reason: "Rebuild projection",
      idempotencyKey: "repair:1:v1",
      sourceType: "reconciliation-report",
      sourceId: "1",
    })).toEqual({
      reason: "Rebuild projection",
      idempotencyKey: "repair:1:v1",
      sourceType: "reconciliation-report",
      sourceId: "1",
    });

    expect(() => requireMutationProvenance({
      reason: "",
      idempotencyKey: "repair:1:v1",
      sourceType: "reconciliation-report",
      sourceId: "1",
    })).toThrowError(UnsafeInputError);
  });
});
