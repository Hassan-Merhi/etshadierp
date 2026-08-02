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

export function translateApprovedInterfaceText(
  value: string,
  language: ApplicationLanguage,
): string | null {
  return translateSharedInterfaceText(value, language) ?? translateAccountingDocumentText(value, language);
}

function translateTextNode(node: Text, language: ApplicationLanguage) {
  const parent = node.parentElement;
  if (!parent || isProtected(parent)) return;
  const translated = translateApprovedInterfaceText(node.nodeValue ?? "", language);
  if (translated !== null && translated !== node.nodeValue) node.nodeValue = translated;
}

function translateAttributes(element: Element, language: ApplicationLanguage) {
  if (isProtected(element)) return;
  for (const attribute of TRANSLATABLE_ATTRIBUTES) {
    const value = element.getAttribute(attribute);
    if (!value) continue;
    const translated = translateApprovedInterfaceText(value, language);
    if (translated !== null && translated !== value) element.setAttribute(attribute, translated.trim());
  }
}

export function translateInterfaceTree(root: Node, language: ApplicationLanguage) {
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
 * Transitional compatibility bridge for legacy screens that have not yet been
 * converted to component-level translation calls.
 *
 * The observer is scoped to the React application root rather than document.body
 * and batches mutation work into one animation frame. Exact reviewed dictionary
 * matches are still required, and explicit business-data guards are authoritative.
 */
export function ApplicationInterfaceTranslator({ language }: { language: ApplicationLanguage }) {
  useEffect(() => {
    const root = document.getElementById("root");
    if (!root) return;

    translateInterfaceTree(root, language);
    const pending = new Set<Node>();
    let frame: number | null = null;

    const flush = () => {
      frame = null;
      for (const node of pending) translateInterfaceTree(node, language);
      pending.clear();
    };

    const schedule = (node: Node) => {
      pending.add(node);
      if (frame === null) frame = window.requestAnimationFrame(flush);
    };

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) schedule(node);
        if (record.type === "characterData" || record.type === "attributes") schedule(record.target);
      }
    });
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...TRANSLATABLE_ATTRIBUTES],
    });

    return () => {
      observer.disconnect();
      pending.clear();
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [language]);

  return null;
}
