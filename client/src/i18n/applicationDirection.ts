import {
  isRtlApplicationLanguage,
  parseApplicationLanguage,
  type ApplicationLanguage,
} from "@shared/applicationLanguageContract";

export type ApplicationDirection = "ltr" | "rtl";

export function getApplicationDirection(language: ApplicationLanguage): ApplicationDirection {
  return isRtlApplicationLanguage(language) ? "rtl" : "ltr";
}

export function applyApplicationLanguageToDocument(
  language: ApplicationLanguage,
  targetDocument: Document | undefined = typeof document === "undefined" ? undefined : document
): ApplicationDirection {
  const normalized = parseApplicationLanguage(language);
  const direction = getApplicationDirection(normalized);

  if (!targetDocument) return direction;

  const root = targetDocument.documentElement;
  root.lang = normalized;
  root.dir = direction;
  root.dataset.applicationLanguage = normalized;
  root.dataset.applicationDirection = direction;

  if (targetDocument.body) {
    targetDocument.body.dir = direction;
    targetDocument.body.dataset.applicationLanguage = normalized;
    targetDocument.body.dataset.applicationDirection = direction;
  }

  return direction;
}
