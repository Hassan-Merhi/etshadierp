/**
 * Generic signed, expiring confirmation-token helper for admin repair flows
 * (raw-material FX resolution, raw-stock recalculation, and any future
 * "preview now / apply later" financial repair endpoint).
 *
 * A token is NOT just an opaque hash of a few fields — it's a base64url JSON
 * payload plus an HMAC signature (keyed by SESSION_SECRET, the same signing
 * key already used elsewhere in this codebase for session/security tokens).
 * This lets the payload carry an arbitrary, explicit set of bound fields
 * (companyId, source, row id, new value, old stored value, old confirmed
 * state, a version/timestamp column, the requesting user/session, and an
 * expiry) and lets the verifier recover those fields WITHOUT needing a
 * separate server-side store — the token itself is self-describing and
 * tamper-evident.
 *
 * Verification only proves the token was issued by this server for exactly
 * this payload and has not expired. It is the CALLER's job to also re-derive
 * the current state fresh from the database and compare it against the
 * embedded old-value/version fields — that's what catches a "stale" token
 * (issued against a row that has since changed).
 */
import crypto from "node:crypto";

const SIGNING_KEY = process.env.SESSION_SECRET || "dev-fallback-repair-token-key-not-for-production";

function hmac(payload: string): string {
  return crypto.createHmac("sha256", SIGNING_KEY).update(payload).digest("hex");
}

export class InvalidRepairTokenError extends Error {
  constructor(reason: string) {
    super(`Invalid confirmation token: ${reason}`);
    this.name = "InvalidRepairTokenError";
  }
}

export class ExpiredRepairTokenError extends Error {
  constructor() {
    super("Confirmation token has expired — re-run the dry-run preview to get a fresh one.");
    this.name = "ExpiredRepairTokenError";
  }
}

/** Signs an arbitrary JSON-serializable payload. Caller must include an
 * `expiresAt` (epoch ms) field in `payload` for expiry to be enforced. */
export function signRepairToken(payload: Record<string, any>): string {
  const json = JSON.stringify(payload);
  const encoded = Buffer.from(json, "utf8").toString("base64url");
  const signature = hmac(encoded);
  return `${encoded}.${signature}`;
}

/** Verifies signature + expiry and returns the embedded payload. Throws
 * InvalidRepairTokenError (malformed/tampered) or ExpiredRepairTokenError. */
export function verifyRepairToken<T = Record<string, any>>(token: string): T {
  if (typeof token !== "string" || !token.includes(".")) {
    throw new InvalidRepairTokenError("malformed token");
  }
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) throw new InvalidRepairTokenError("malformed token");

  const expectedSignature = hmac(encoded);
  const sigBuf = Buffer.from(signature, "utf8");
  const expectedBuf = Buffer.from(expectedSignature, "utf8");
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    throw new InvalidRepairTokenError("signature mismatch");
  }

  let payload: T & { expiresAt?: number };
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new InvalidRepairTokenError("malformed payload");
  }

  if (typeof payload.expiresAt === "number" && Date.now() > payload.expiresAt) {
    throw new ExpiredRepairTokenError();
  }

  return payload;
}

/** Standard TTL for repair confirmation tokens: long enough for an admin to
 * review a dry-run preview, short enough that a leaked/stale token is not a
 * standing risk. */
export const REPAIR_TOKEN_TTL_MS = 15 * 60 * 1000;
