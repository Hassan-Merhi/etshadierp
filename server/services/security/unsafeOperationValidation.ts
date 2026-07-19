export type UnsafeFieldKind =
  | "string"
  | "integer"
  | "positive-integer"
  | "finite-number"
  | "decimal"
  | "boolean"
  | "date"
  | "enum"
  | "object"
  | "array";

export interface UnsafeFieldRule {
  kind: UnsafeFieldKind;
  required?: boolean;
  nullable?: boolean;
  minLength?: number;
  maxLength?: number;
  enumValues?: readonly string[];
}

export interface UnsafeOperationSchema {
  fields: Readonly<Record<string, UnsafeFieldRule>>;
  allowUnknownFields?: boolean;
  maxDepth?: number;
  maxArrayLength?: number;
  maxStringLength?: number;
}

export interface UnsafeOperationValidationRequest {
  payload: unknown;
  schema: UnsafeOperationSchema;
  operation: string;
}

export type UnsafeInputCode =
  | "INPUT_OBJECT_REQUIRED"
  | "UNKNOWN_FIELD"
  | "REQUIRED_FIELD_MISSING"
  | "INVALID_FIELD_TYPE"
  | "INVALID_FIELD_VALUE"
  | "INPUT_TOO_DEEP"
  | "ARRAY_TOO_LARGE"
  | "STRING_TOO_LARGE"
  | "UNSAFE_KEY_DENIED";

export interface UnsafeInputIssue {
  code: UnsafeInputCode;
  path: string;
}

export class UnsafeInputError extends Error {
  readonly code = "UNSAFE_INPUT_REJECTED";
  readonly issues: readonly UnsafeInputIssue[];

  constructor(issues: readonly UnsafeInputIssue[]) {
    super("Invalid request");
    this.name = "UnsafeInputError";
    this.issues = issues;
  }
}

const DENIED_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function pathFor(parent: string, key: string | number): string {
  return parent ? `${parent}.${String(key)}` : String(key);
}

function scanStructure(
  value: unknown,
  path: string,
  depth: number,
  schema: UnsafeOperationSchema,
  issues: UnsafeInputIssue[]
): void {
  const maxDepth = schema.maxDepth ?? 8;
  const maxArrayLength = schema.maxArrayLength ?? 500;
  const maxStringLength = schema.maxStringLength ?? 10_000;

  if (depth > maxDepth) {
    issues.push({ code: "INPUT_TOO_DEEP", path });
    return;
  }

  if (typeof value === "string" && value.length > maxStringLength) {
    issues.push({ code: "STRING_TOO_LARGE", path });
    return;
  }

  if (Array.isArray(value)) {
    if (value.length > maxArrayLength) {
      issues.push({ code: "ARRAY_TOO_LARGE", path });
      return;
    }
    value.forEach((item, index) => scanStructure(item, pathFor(path, index), depth + 1, schema, issues));
    return;
  }

  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      const childPath = pathFor(path, key);
      if (DENIED_KEYS.has(key)) {
        issues.push({ code: "UNSAFE_KEY_DENIED", path: childPath });
        continue;
      }
      scanStructure(child, childPath, depth + 1, schema, issues);
    }
  }
}

function validDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateField(value: unknown, rule: UnsafeFieldRule): boolean {
  if (value === null) return rule.nullable === true;

  switch (rule.kind) {
    case "string":
      return (
        typeof value === "string" &&
        (rule.minLength == null || value.trim().length >= rule.minLength) &&
        (rule.maxLength == null || value.length <= rule.maxLength)
      );
    case "integer":
      return typeof value === "number" && Number.isSafeInteger(value);
    case "positive-integer":
      return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
    case "finite-number":
      return typeof value === "number" && Number.isFinite(value);
    case "decimal":
      return typeof value === "string" && DECIMAL_PATTERN.test(value);
    case "boolean":
      return typeof value === "boolean";
    case "date":
      return typeof value === "string" && validDate(value);
    case "enum":
      return typeof value === "string" && !!rule.enumValues?.includes(value);
    case "object":
      return isPlainObject(value);
    case "array":
      return Array.isArray(value);
    default:
      return false;
  }
}

/**
 * Canonical fail-closed validation boundary for security-sensitive mutations.
 * It rejects prototype-pollution keys, excessive structure, unknown fields,
 * invalid identifiers, non-finite numbers, malformed dates, and decimals with
 * more than six fractional digits before route or service logic runs.
 */
export function validateUnsafeOperationInput(
  request: UnsafeOperationValidationRequest
): Readonly<Record<string, unknown>> {
  const issues: UnsafeInputIssue[] = [];
  const { payload, schema } = request;

  if (!isPlainObject(payload)) {
    throw new UnsafeInputError([{ code: "INPUT_OBJECT_REQUIRED", path: "$" }]);
  }

  scanStructure(payload, "$", 0, schema, issues);

  for (const key of Object.keys(payload)) {
    if (!(key in schema.fields) && schema.allowUnknownFields !== true) {
      issues.push({ code: "UNKNOWN_FIELD", path: key });
    }
  }

  for (const [key, rule] of Object.entries(schema.fields)) {
    const value = payload[key];
    if (value === undefined) {
      if (rule.required) issues.push({ code: "REQUIRED_FIELD_MISSING", path: key });
      continue;
    }
    if (!validateField(value, rule)) {
      issues.push({ code: "INVALID_FIELD_VALUE", path: key });
    }
  }

  if (issues.length > 0) throw new UnsafeInputError(issues);
  return Object.freeze({ ...payload });
}

export function requireMutationProvenance(input: {
  reason: unknown;
  idempotencyKey: unknown;
  sourceType: unknown;
  sourceId: unknown;
}): Readonly<{ reason: string; idempotencyKey: string; sourceType: string; sourceId: string }> {
  const normalized = {
    reason: typeof input.reason === "string" ? input.reason.trim() : "",
    idempotencyKey: typeof input.idempotencyKey === "string" ? input.idempotencyKey.trim() : "",
    sourceType: typeof input.sourceType === "string" ? input.sourceType.trim() : "",
    sourceId: typeof input.sourceId === "string" ? input.sourceId.trim() : "",
  };
  const issues: UnsafeInputIssue[] = [];
  for (const [key, value] of Object.entries(normalized)) {
    if (!value) issues.push({ code: "REQUIRED_FIELD_MISSING", path: key });
  }
  if (issues.length > 0) throw new UnsafeInputError(issues);
  return Object.freeze(normalized);
}
