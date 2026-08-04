import { describe, expect, it } from "vitest";
import { translateVoucherKpiText } from "../client/src/i18n/voucherKpiTranslations";

describe("voucher Journal navigation label", () => {
  it("keeps the Journal tab named Journal in English", () => {
    expect(translateVoucherKpiText("Journal", "en")).toBe("Journal");
  });

  it("translates the Journal tab without confusing it with Daybook", () => {
    expect(translateVoucherKpiText("Journal", "ar")).toBe("اليومية");
    expect(translateVoucherKpiText("Journal", "fr")).toBe("Journal");
    expect(translateVoucherKpiText("Journal", "en")).not.toBe("Daybook");
  });
});
