import type { NextFunction, Request, Response } from "express";

const REQUEST_HEADER = "x-erp-compact-response";
const RESPONSE_HEADER = "X-ERP-Compact-Response";
const WIRE_VERSION = "v1";
const DICT_TOKEN = /^~([0-9a-z]+)$/;

type JsonRecord = Record<string, unknown>;

type CompactArrayRows = {
  "~a": [string[], unknown[][]];
};

type CompactEnvelope = {
  __erpWire: 1;
  d: string[];
  v: unknown;
};

function isPlainRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function shouldCompactPath(path: string): boolean {
  if (
    path === "/api/factory/customer-proformas" ||
    path === "/api/factory/daily-bale-scans" ||
    path === "/api/factory/daily-bale-scans/produced" ||
    path === "/api/factory/waste-dispatch/bales" ||
    path === "/api/factory/waste-dispatch/history" ||
    path === "/api/factory/production-value-report"
  ) {
    return true;
  }

  if (/^\/api\/factory\/location-inventory\/\d+$/.test(path)) return true;
  if (/^\/api\/factory\/customer-orders\/\d+$/.test(path)) return true;
  if (/^\/api\/factory\/customer-orders\/\d+\/verification-summary$/.test(path)) return true;
  return false;
}

function collectStrings(value: unknown, counts: Map<string, number>): void {
  if (typeof value === "string") {
    if (value.length >= 4) counts.set(value, (counts.get(value) ?? 0) + 1);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, counts);
    return;
  }
  if (!isPlainRecord(value)) return;
  for (const item of Object.values(value)) collectStrings(item, counts);
}

function buildDictionary(payload: unknown): { dictionary: string[]; indexes: Map<string, number> } {
  const counts = new Map<string, number>();
  collectStrings(payload, counts);

  const candidates = [...counts.entries()]
    .filter(([value, count]) => {
      if (count < 3) return false;
      // Approximate the wire win after paying once for the dictionary entry and
      // replacing each repeated JSON string with a short ~base36 token.
      const tokenChars = count * 5;
      const repeatedChars = count * (value.length + 2);
      const dictionaryChars = value.length + 3;
      return repeatedChars - tokenChars - dictionaryChars >= 24;
    })
    .sort((a, b) => b[1] * b[0].length - a[1] * a[0].length);

  const dictionary = candidates.map(([value]) => value);
  return { dictionary, indexes: new Map(dictionary.map((value, index) => [value, index])) };
}

function sameObjectKeys(rows: JsonRecord[]): string[] | null {
  if (rows.length < 2) return null;
  const keys = Object.keys(rows[0]);
  for (let i = 1; i < rows.length; i += 1) {
    const other = Object.keys(rows[i]);
    if (other.length !== keys.length) return null;
    for (let k = 0; k < keys.length; k += 1) {
      if (other[k] !== keys[k]) return null;
    }
  }
  return keys;
}

function encodeValue(value: unknown, indexes: Map<string, number>): unknown {
  if (typeof value === "string") {
    const dictionaryIndex = indexes.get(value);
    if (dictionaryIndex !== undefined) return `~${dictionaryIndex.toString(36)}`;
    // Reserve a leading tilde for dictionary references without changing any
    // application strings that already begin with one.
    return value.startsWith("~") ? `~${value}` : value;
  }

  if (Array.isArray(value)) {
    if (value.length >= 2 && value.every(isPlainRecord)) {
      const records = value as JsonRecord[];
      const keys = sameObjectKeys(records);
      if (keys) {
        const compact: CompactArrayRows = {
          "~a": [
            keys,
            records.map((row) => keys.map((key) => encodeValue(row[key], indexes))),
          ],
        };
        return compact;
      }
    }
    return value.map((item) => encodeValue(item, indexes));
  }

  if (isPlainRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeValue(item, indexes)]));
  }

  return value;
}

function compactPayload(payload: unknown): CompactEnvelope {
  const { dictionary, indexes } = buildDictionary(payload);
  return {
    __erpWire: 1,
    d: dictionary,
    v: encodeValue(payload, indexes),
  };
}

export function operationalBandwidthCompactResponse(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== "GET" || req.header(REQUEST_HEADER) !== WIRE_VERSION || !shouldCompactPath(req.path)) {
    next();
    return;
  }

  const originalJson = res.json.bind(res);
  res.json = ((payload: unknown) => {
    if (res.statusCode < 200 || res.statusCode >= 300 || payload == null) return originalJson(payload);
    res.setHeader(RESPONSE_HEADER, WIRE_VERSION);
    res.setHeader("Vary", [res.getHeader("Vary"), REQUEST_HEADER].filter(Boolean).join(", "));
    return originalJson(compactPayload(payload));
  }) as typeof res.json;

  next();
}

// Exported only for source-level regression coverage and future codec parity.
export const operationalBandwidthWireInternals = {
  DICT_TOKEN,
  shouldCompactPath,
};
