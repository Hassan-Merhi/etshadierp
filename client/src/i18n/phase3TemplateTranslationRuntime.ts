import type { ApplicationLanguage } from "@shared/applicationLanguageContract";
import type { Phase3SharedUiEntry } from "./sharedUiPhase3TranslationTypes";

type TemplateMatcher = {
  regex: RegExp;
  sourceTemplate: string;
  translations: Phase3SharedUiEntry;
};

function splitTemplate(value: string): string[] {
  const parts: string[] = [];
  let cursor = 0;
  let staticStart = 0;

  while (cursor < value.length) {
    if (!value.startsWith("${", cursor)) {
      cursor += 1;
      continue;
    }

    parts.push(value.slice(staticStart, cursor));
    cursor += 2;
    let depth = 1;
    let quote: string | null = null;
    let escaped = false;

    while (cursor < value.length && depth > 0) {
      const char = value[cursor];
      if (quote !== null) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === quote) quote = null;
      } else if (char === '"' || char === "'" || char === "`") {
        quote = char;
      } else if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
      }
      cursor += 1;
    }

    staticStart = cursor;
  }

  parts.push(value.slice(staticStart));
  return parts;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function placeholderTemplate(parts: readonly string[]): string {
  let result = parts[0] ?? "";
  for (let index = 1; index < parts.length; index += 1) {
    result += `{{${index - 1}}}${parts[index]}`;
  }
  return result;
}

export function createPhase3TemplateTranslator(entries: readonly Phase3SharedUiEntry[]) {
  const matchers: readonly TemplateMatcher[] = entries.flatMap((entry) => {
    if (!entry.en.includes("${")) return [];
    const parts = splitTemplate(entry.en);
    const staticText = parts.join("");

    // A template containing only business values/separators should not become
    // a broad regex that can capture arbitrary table data.
    if (!/[A-Za-z]/.test(staticText)) return [];

    return [
      {
        regex: new RegExp(`^${parts.map(escapeRegex).join("(.*?)")}$`),
        sourceTemplate: placeholderTemplate(parts),
        translations: entry,
      },
    ];
  });

  return {
    matches(value: string): boolean {
      const normalized = value.trim();
      return normalized.length > 0 && matchers.some(({ regex }) => regex.test(normalized));
    },

    translate(
      value: string,
      language: ApplicationLanguage,
      translateCapture: (capture: string) => string,
    ): string | null {
      const leading = value.match(/^\s*/)?.[0] ?? "";
      const trailing = value.match(/\s*$/)?.[0] ?? "";
      const normalized = value.trim();

      for (const matcher of matchers) {
        const match = normalized.match(matcher.regex);
        if (!match) continue;
        const template = language === "en" ? matcher.sourceTemplate : matcher.translations[language];
        const translated = template.replace(/\{\{(\d+)\}\}/g, (_token, rawIndex: string) => {
          const capture = match[Number(rawIndex) + 1] ?? "";
          return translateCapture(capture);
        });
        return `${leading}${translated}${trailing}`;
      }

      return null;
    },
  };
}
