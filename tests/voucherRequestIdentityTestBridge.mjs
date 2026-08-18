import supertest from "supertest";

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
  const existingHeader = this.get?.("X-Idempotency-Key");

  if (STATE_CHANGING_METHODS.has(method) && !existingHeader && !hasClientRequestId(this._data)) {
    requestSequence += 1;
    this.set("X-Idempotency-Key", `vitest-${process.pid}-${requestSequence}`);
  }

  return originalEnd.call(this, callback);
};
