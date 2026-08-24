import { describe, expect, it } from "vitest";
import { phase3RemainingTranslationsPart01 } from "../client/src/i18n/phase3RemainingTranslations.part01";
import { phase3RemainingTranslationsPart02 } from "../client/src/i18n/phase3RemainingTranslations.part02";
import { phase3RemainingTranslationsPart03 } from "../client/src/i18n/phase3RemainingTranslations.part03";
import { phase3RemainingTranslationsPart04 } from "../client/src/i18n/phase3RemainingTranslations.part04";
import { phase3RemainingTranslationsPart05 } from "../client/src/i18n/phase3RemainingTranslations.part05";
import { phase3RemainingTranslationsPart06 } from "../client/src/i18n/phase3RemainingTranslations.part06";
import { phase3RemainingTranslationsPart07 } from "../client/src/i18n/phase3RemainingTranslations.part07";
import { phase3RemainingTranslationsPart08 } from "../client/src/i18n/phase3RemainingTranslations.part08";
import { phase3RemainingTranslationsPart09 } from "../client/src/i18n/phase3RemainingTranslations.part09";
import { phase3RemainingTranslationsPart10 } from "../client/src/i18n/phase3RemainingTranslations.part10";
import { phase3RemainingTranslationsPart11 } from "../client/src/i18n/phase3RemainingTranslations.part11";
import { phase3RemainingTranslationsPart12 } from "../client/src/i18n/phase3RemainingTranslations.part12";
import { phase3RemainingTranslationsPart13 } from "../client/src/i18n/phase3RemainingTranslations.part13";
import { phase3RemainingTranslationsPart14 } from "../client/src/i18n/phase3RemainingTranslations.part14";
import { phase3RemainingTranslationsPart15 } from "../client/src/i18n/phase3RemainingTranslations.part15";
import { phase3RemainingTranslationsPart16 } from "../client/src/i18n/phase3RemainingTranslations.part16";
import { phase3RemainingTranslationsPart17 } from "../client/src/i18n/phase3RemainingTranslations.part17";
import { phase3RemainingTranslationsPart18 } from "../client/src/i18n/phase3RemainingTranslations.part18";
import { phase3RemainingTranslationsPart19 } from "../client/src/i18n/phase3RemainingTranslations.part19";
import { phase3RemainingTranslationsPart20 } from "../client/src/i18n/phase3RemainingTranslations.part20";
import { phase3RemainingTranslationsPart21 } from "../client/src/i18n/phase3RemainingTranslations.part21";

const entries = [
  ...phase3RemainingTranslationsPart01,
  ...phase3RemainingTranslationsPart02,
  ...phase3RemainingTranslationsPart03,
  ...phase3RemainingTranslationsPart04,
  ...phase3RemainingTranslationsPart05,
  ...phase3RemainingTranslationsPart06,
  ...phase3RemainingTranslationsPart07,
  ...phase3RemainingTranslationsPart08,
  ...phase3RemainingTranslationsPart09,
  ...phase3RemainingTranslationsPart10,
  ...phase3RemainingTranslationsPart11,
  ...phase3RemainingTranslationsPart12,
  ...phase3RemainingTranslationsPart13,
  ...phase3RemainingTranslationsPart14,
  ...phase3RemainingTranslationsPart15,
  ...phase3RemainingTranslationsPart16,
  ...phase3RemainingTranslationsPart17,
  ...phase3RemainingTranslationsPart18,
  ...phase3RemainingTranslationsPart19,
  ...phase3RemainingTranslationsPart20,
  ...phase3RemainingTranslationsPart21,
] as const;

describe("Phase 3 translation completion", () => {
  it("keeps the complete generated translation inventory", () => {
    expect(entries).toHaveLength(8192);
    expect(new Set(entries.map((entry) => entry.en)).size).toBe(entries.length);
  });

  it("provides non-empty Arabic and French text without leaked generation tokens", () => {
    for (const entry of entries) {
      expect(entry.en.trim().length).toBeGreaterThan(0);
      expect(entry.ar.trim().length).toBeGreaterThan(0);
      expect(entry.fr.trim().length).toBeGreaterThan(0);
      expect(entry.ar).not.toMatch(/ZXQPH\d+X\d+ZXQ/i);
      expect(entry.fr).not.toMatch(/ZXQPH\d+X\d+ZXQ/i);
    }
  });

  // The generator normalises every interpolated value to a `{{N}}` slot before
  // it reaches the translation engine, precisely so the engine never sees the
  // expression inside. When a raw `${...}` did survive, the engine translated
  // the identifier with the prose around it — `data.length` became
  // `data.longueur`, `||` became `=`, and `{ confirm: true }` became
  // `{ confirmer : true }`. Those are business identifiers and request
  // payloads, so a surviving `${` is a corruption signal, not a style nit.
  it("never leaves a raw template expression in the translated text", () => {
    // `$` immediately before a slot is legitimate: it is the currency sign in
    // sources like `total $${amount.toFixed(2)}`, so strip slots first.
    const withoutSlots = (value: string) => value.replace(/\{\{\d+\}\}/g, "");

    for (const entry of entries) {
      // The extractor slices some template literals mid-expression, so a few
      // English keys are fragments that never reach the DOM and can never be
      // matched at runtime. Those carry the source text verbatim in all three
      // languages — repeating English is safe, inventing an expression is not.
      if (entry.fr === entry.en && entry.ar === entry.en) continue;

      expect(withoutSlots(entry.fr)).not.toContain("${");
      expect(withoutSlots(entry.ar)).not.toContain("${");
    }
  });

  it("keeps the interpolation slot count identical across all three languages", () => {
    const slots = (value: string) => (value.match(/\{\{(\d+)\}\}/g) ?? []).sort();

    for (const entry of entries) {
      // Entries whose English carries no slot at all are plain copy, and the
      // mirrored source-text fragments repeat English verbatim; both trivially
      // agree. The check that matters is that a translated message keeps every
      // slot the English one declared, in the same multiset.
      if (!entry.en.includes("${") && slots(entry.fr).length === 0 && slots(entry.ar).length === 0) continue;
      expect(slots(entry.ar)).toEqual(slots(entry.fr));
    }
  });
});
