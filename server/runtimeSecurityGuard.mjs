import { Server } from "node:http";
import { securityRuntimeConfig } from "./securityRuntimeConfig.mjs";

const FLAG = Symbol.for("erp.runtime-security-guard");

function reject(res, statusCode, code, message) {
  if (res.headersSent || res.writableEnded) return;
  res.statusCode = statusCode;
  for (const [name, value] of Object.entries(securityRuntimeConfig.responseHeaders)) {
    res.setHeader(name, value);
  }
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify({ message, code }));
}

if (!globalThis[FLAG]) {
  globalThis[FLAG] = true;
  const originalEmit = Server.prototype.emit;

  Server.prototype.emit = function securityAwareEmit(event, ...args) {
    if (event !== "request") return originalEmit.call(this, event, ...args);

    const [req, res] = args;
    for (const [name, value] of Object.entries(securityRuntimeConfig.responseHeaders)) {
      if (!res.hasHeader(name)) res.setHeader(name, value);
    }

    const method = String(req.method || "GET").toUpperCase();
    if (!securityRuntimeConfig.allowedMethods.includes(method)) {
      reject(res, 405, "METHOD_NOT_ALLOWED", "HTTP method is not allowed.");
      return true;
    }

    const requestTargetBytes = Buffer.byteLength(String(req.url || "/"), "utf8");
    if (requestTargetBytes > securityRuntimeConfig.maxRequestTargetBytes) {
      reject(res, 414, "REQUEST_TARGET_TOO_LONG", "Request target is too long.");
      return true;
    }

    const headerCount = Array.isArray(req.rawHeaders) ? Math.floor(req.rawHeaders.length / 2) : 0;
    if (headerCount > securityRuntimeConfig.maxHeaderCount) {
      reject(res, 431, "TOO_MANY_HEADERS", "Request contains too many headers.");
      return true;
    }

    return originalEmit.call(this, event, ...args);
  };

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "INFO",
    module: "runtime-security",
    action: "startup",
    maxRequestTargetBytes: securityRuntimeConfig.maxRequestTargetBytes,
    maxHeaderCount: securityRuntimeConfig.maxHeaderCount,
  }));
}
