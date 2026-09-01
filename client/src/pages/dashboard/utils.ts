/**
 * Pure helpers and lookup tables for the Dashboard page.
 *
 * Extracted from Dashboard.tsx during the Phase 4 god-file split.
 */

export function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}
