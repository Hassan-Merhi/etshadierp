import { useEffect } from "react";
import type { ApplicationLanguage } from "@shared/applicationLanguageContract";
import { translateSharedInterfaceText } from "@/i18n/sharedInterfaceTranslations";
import { translateAccountingDocumentText } from "@/i18n/accountingDocumentTranslations";

const EXCLUDED_SELECTOR = [
  "code",
  "pre",
  "[contenteditable=true]",
  "[data-no-translate]",
  "[data-business-value]",
  "[data-stock-name]",
  "[data-stock-group]",
  "[data-account-name]",
  "[data-article-code]",
  "[data-account-code]",
  "[data-container-number]",
  "[data-voucher-number]",
].join(",");

const TRANSLATABLE_ATTRIBUTES = ["aria-label", "title", "placeholder"] as const;

function isProtected(element: Element): boolean {
  return Boolean(element.closest(EXCLUDED_SELECTOR));
}

function translateApprovedText(value: string, language: ApplicationLanguage): string | null {
  return translateSharedInterfaceText(value, language) ?? translateAccountingDocumentText(value, language);
}

function translateTextNode(node: Text, language: ApplicationLanguage) {
  const parent = node.parentElement;
  if (!parent || isProtected(parent)) return;
  const translated = translateApprovedText(node.nodeValue ?? "", language);
  if (translated !== null && translated !== node.nodeValue) node.nodeValue = translated;
}

function translateAttributes(element: Element, language: ApplicationLanguage) {
  if (isProtected(element)) return;
  for (const attribute of TRANSLATABLE_ATTRIBUTES) {
    const value = element.getAttribute(attribute);
    if (!value) continue;
    const translated = translateApprovedText(value, language);
    if (translated !== null && translated !== value) element.setAttribute(attribute, translated.trim());
  }
}

function translateTree(root: Node, language: ApplicationLanguage) {
  if (root.nodeType === Node.TEXT_NODE) {
    translateTextNode(root as Text, language);
    return;
  }
  if (root.nodeType === Node.ELEMENT_NODE) translateAttributes(root as Element, language);

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let current: Node | null = walker.nextNode();
  while (current) {
    if (current.nodeType === Node.TEXT_NODE) translateTextNode(current as Text, language);
    else translateAttributes(current as Element, language);
    current = walker.nextNode();
  }
}

/**
 * Compatibility bridge used by application-surface translation phases.
 *
 * Only exact labels from reviewed dictionaries are translated. It never changes
 * input values, stored names, account/catalog data, codes, references, voucher
 * numbers, container numbers or any element explicitly marked as business data.
 */
export function ApplicationInterfaceTranslator({ language }: { language: ApplicationLanguage }) {
  useEffect(() => {
    translateTree(document.body, language);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) translateTree(node, language);
        if (record.type === "characterData") translateTree(record.target, language);
        if (record.type === "attributes") translateTree(record.target, language);
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...TRANSLATABLE_ATTRIBUTES],
    });
    return () => observer.disconnect();
  }, [language]);

  return null;
}
