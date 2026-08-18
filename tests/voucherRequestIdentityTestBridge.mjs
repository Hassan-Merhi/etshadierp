import supertest from "supertest";
import { pool } from "../server/db";

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

let requestSequence = 0;

function hasClientRequestId(data) {
  return (
    data &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    typeof data.clientRequestId === "string" &&
    data.clientRequestId.trim().length > 0
  );
}

const requestPrototype = supertest.Test.prototype;
const originalEnd = requestPrototype.end;

requestPrototype.end = function endWithVoucherRequestIdentity(callback) {
  const method = String(this.method || "").toUpperCase();
  const stateChanging = STATE_CHANGING_METHODS.has(method);
  const existingHeader = this.get?.("X-Idempotency-Key");
  let generatedKey = null;

  if (stateChanging && !existingHeader && !hasClientRequestId(this._data)) {
    requestSequence += 1;
    generatedKey = `vitest-${process.pid}-${requestSequence}`;
    this.set("X-Idempotency-Key", generatedKey);
  }

  if (!generatedKey || typeof callback !== "function") {
    return originalEnd.call(this, callback);
  }

  return originalEnd.call(this, (error, response) => {
    void pool
      .query("DELETE FROM accounting_posting_requests WHERE idempotency_key = $1", [generatedKey])
      .then(() => callback(error, response))
      .catch((cleanupError) => callback(error ?? cleanupError, response));
  });
};
