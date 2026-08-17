/**
 * Shared state and helpers for the chatbotRoutes routes.
 *
 * Extracted verbatim from the former single-file chatbotRoutes.ts.
 */
import rateLimit from "express-rate-limit";
import CryptoJS from "crypto-js";

// ── GitHub token encryption helpers ────────────────────────────────────────
// Key is derived from SESSION_SECRET so it survives restarts without a new env var.
export const _tokenKey = () => process.env.SESSION_SECRET ?? "erp-github-token-fallback-key";
export function encryptToken(plain: string): string {
  return CryptoJS.AES.encrypt(plain, _tokenKey()).toString();
}
export function decryptToken(cipher: string): string {
  try {
    const bytes = CryptoJS.AES.decrypt(cipher, _tokenKey());
    return bytes.toString(CryptoJS.enc.Utf8) || "";
  } catch {
    return "";
  }
}

export const chatMessageRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: import("express").Request) => `${req.session?.userId ?? "anon"}_${req.session?.currentCompanyId ?? "0"}`,
  handler: (_req: unknown, res: import("express").Response) => {
    res.status(429).json({ message: "Too many messages. Please wait a moment before sending again." });
  },
  skip: (req: import("express").Request) => !req.session?.userId,
});
