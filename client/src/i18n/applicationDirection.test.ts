import { beforeEach, describe, expect, it } from "vitest";
import { applyApplicationLanguageToDocument, getApplicationDirection } from "./applicationDirection";

describe("application direction contract", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("lang");
    document.documentElement.removeAttribute("dir");
    document.documentElement.removeAttribute("data-application-language");
    document.documentElement.removeAttribute("data-application-direction");
    document.body.removeAttribute("dir");
    document.body.removeAttribute("data-application-language");
    document.body.removeAttribute("data-application-direction");
  });

  it("uses RTL only for Arabic", () => {
    expect(getApplicationDirection("en")).toBe("ltr");
    expect(getApplicationDirection("fr")).toBe("ltr");
    expect(getApplicationDirection("ar")).toBe("rtl");
  });

  it("synchronizes Arabic across the document and portal host", () => {
    expect(applyApplicationLanguageToDocument("ar", document)).toBe("rtl");
    expect(document.documentElement).toHaveAttribute("lang", "ar");
    expect(document.documentElement).toHaveAttribute("dir", "rtl");
    expect(document.documentElement.dataset.applicationLanguage).toBe("ar");
    expect(document.documentElement.dataset.applicationDirection).toBe("rtl");
    expect(document.body).toHaveAttribute("dir", "rtl");
    expect(document.body.dataset.applicationLanguage).toBe("ar");
    expect(document.body.dataset.applicationDirection).toBe("rtl");
  });

  it("returns English and French to LTR without reloading", () => {
    applyApplicationLanguageToDocument("ar", document);
    applyApplicationLanguageToDocument("fr", document);
    expect(document.documentElement).toHaveAttribute("lang", "fr");
    expect(document.documentElement).toHaveAttribute("dir", "ltr");
    expect(document.body).toHaveAttribute("dir", "ltr");

    applyApplicationLanguageToDocument("en", document);
    expect(document.documentElement.dataset.applicationLanguage).toBe("en");
    expect(document.documentElement.dataset.applicationDirection).toBe("ltr");
  });
});
