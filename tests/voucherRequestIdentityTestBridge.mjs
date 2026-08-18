import superagent from "superagent";

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

const requestPrototype = superagent.Request.prototype;
const originalEnd = requestPrototype.end;

requestPrototype.end = function endWithVoucherRequestIdentity(callback) {
  const method = String(this.method || "").toUpperCase();
  const isWrite = method === "POST" || method === "PATCH";
  const existingHeader = this.get?.("X-Idempotency-Key");

  if (isWrite && !existingHeader && !hasClientRequestId(this._data)) {
    requestSequence += 1;
    this.set("X-Idempotency-Key", `vitest-${process.pid}-${requestSequence}`);
  }

  return originalEnd.call(this, callback);
};
