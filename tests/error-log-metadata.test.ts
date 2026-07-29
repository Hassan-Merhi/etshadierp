import { describe, expect, it } from "vitest";
import { serialiseErrorForLog } from "../server/lib/errorLogMetadata";

describe("serialiseErrorForLog", () => {
  it("preserves safe PostgreSQL cause metadata without leaking SQL or parameters", () => {
    const cause = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
      severity: "ERROR",
      detail: "Key (id)=(42) already exists.",
      constraint: "factory_containers_pkey",
      schema: "public",
      table: "factory_containers",
      routine: "_bt_check_unique",
      query: 'insert into "factory_containers" ...',
      params: [12, "CMAU9621472"],
    });
    const outer = Object.assign(new Error("Failed query: insert into factory_containers"), {
      cause,
    });

    const result = serialiseErrorForLog(outer, false);

    expect(result).toEqual({
      message: "Failed query: insert into factory_containers",
      cause: {
        message: "duplicate key value violates unique constraint",
        code: "23505",
        severity: "ERROR",
        detail: "Key (id)=(42) already exists.",
        constraint: "factory_containers_pkey",
        schema: "public",
        table: "factory_containers",
        routine: "_bt_check_unique",
      },
    });
    expect(JSON.stringify(result)).not.toContain('insert into "factory_containers"');
    expect(JSON.stringify(result)).not.toContain("CMAU9621472");
  });

  it("handles circular causes safely", () => {
    const error = new Error("outer") as Error & { cause?: unknown };
    error.cause = error;

    expect(serialiseErrorForLog(error, false)).toEqual({
      message: "outer",
      cause: { message: "[Circular error cause]" },
    });
  });
});
