import supertest from "supertest";
import { afterEach } from "vitest";
import { pool } from "../server/db";

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

let requestSequence = 0;
let stateChangingRequestSeen = false;

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

  if (stateChanging) {
    stateChangingRequestSeen = true;
  }

  if (stateChanging && !existingHeader && !hasClientRequestId(this._data)) {
    requestSequence += 1;
    this.set("X-Idempotency-Key", `vitest-${process.pid}-${requestSequence}`);
  }

  return originalEnd.call(this, callback);
};

afterEach(async () => {
  if (!stateChangingRequestSeen) return;

  stateChangingRequestSeen = false;
  await pool.query("DELETE FROM accounting_posting_requests");
});
