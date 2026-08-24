import type { RequestHandler } from "express";
import helmet, { type HelmetOptions } from "helmet";

/**
 * Build the HTTP security-header policy for the ERP shell.
 *
 * Production deliberately keeps JavaScript nonce-free and inline-free: every
 * executable script is served from our own origin. Development keeps the two
 * Vite allowances (`unsafe-inline` and `unsafe-eval`) because the React refresh
 * preamble is injected into transformed HTML and source maps use eval-like
 * constructs. Those allowances never reach NODE_ENV=production.
 *
 * Inline styles remain allowed because the existing React UI uses style
 * attributes extensively. This does not weaken script execution because
 * script-src and script-src-attr remain independently locked down. Blob-backed
 * frames remain allowed for authenticated stored-file/PDF previews.
 */
export function buildSecurityHeaderOptions(nodeEnv = process.env.NODE_ENV): HelmetOptions {
  const isProduction = nodeEnv === "production";

  return {
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
        frameSrc: ["'self'", "blob:"],
        formAction: ["'self'"],
        scriptSrc: isProduction ? ["'self'"] : ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        connectSrc: isProduction ? ["'self'", "https:", "wss:"] : ["'self'", "http:", "https:", "ws:", "wss:"],
        workerSrc: ["'self'", "blob:"],
        manifestSrc: ["'self'"],
        upgradeInsecureRequests: isProduction ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  };
}

export function securityHeadersMiddleware(nodeEnv = process.env.NODE_ENV): RequestHandler {
  return helmet(buildSecurityHeaderOptions(nodeEnv));
}
