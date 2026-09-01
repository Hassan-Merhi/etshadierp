import type { NextFunction, Request, Response } from "express";
import {
  UnsafeInputError,
  validateUnsafeOperationInput,
  type UnsafeOperationSchema,
} from "./unsafeOperationValidation";

export interface UnsafeInputRouteOptions {
  operation: string;
  schema: UnsafeOperationSchema;
}

/**
 * Express adapter for the Program 3 fail-closed mutation validation boundary.
 * The validated, frozen payload replaces req.body so downstream middleware and
 * route handlers cannot accidentally consume fields that were not approved by
 * the route schema.
 */
export function requireValidatedUnsafeInput(options: UnsafeInputRouteOptions) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = validateUnsafeOperationInput({
        payload: req.body,
        schema: options.schema,
        operation: options.operation,
      });
      return next();
    } catch (error) {
      if (error instanceof UnsafeInputError) {
        return res.status(400).json({ message: "Invalid request" });
      }
      return next(error);
    }
  };
}

export const inventoryRebuildInputSchema: UnsafeOperationSchema = Object.freeze({
  fields: Object.freeze({
    dryRun: Object.freeze({ kind: "boolean" as const }),
    reason: Object.freeze({ kind: "string" as const, minLength: 3, maxLength: 500 }),
    confirmationToken: Object.freeze({ kind: "string" as const, minLength: 3, maxLength: 200 }),
    idempotencyKey: Object.freeze({ kind: "string" as const, minLength: 8, maxLength: 200 }),
    sourceId: Object.freeze({ kind: "string" as const, minLength: 1, maxLength: 200 }),
  }),
  allowUnknownFields: false,
  maxDepth: 2,
  maxArrayLength: 0,
  maxStringLength: 500,
});
