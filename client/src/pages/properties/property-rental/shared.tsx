/**
 * Shared context and hooks for the PropertyRentalPage page.
 *
 * Extracted from PropertyRentalPage.tsx during the Phase 4 god-file split.
 */
import { createContext, useContext } from "react";

export // ── Context (avoids prop-drilling apiBase through every sub-component) ──
const ApiBaseCtx = createContext<string>("/api/properties/rental");

export const useApiBase = () => useContext(ApiBaseCtx);

// ── Inline Note Cell ─────────────────────────────────────
