import { useEffect } from "react";
import type { ApplicationLanguage } from "@shared/applicationLanguageContract";
import { translateSharedInterfaceText } from "@/i18n/sharedInterfaceTranslations";
import { translateAccountingDocumentText } from "@/i18n/accountingDocumentTranslations";

const EXCLUDED_SELECTOR = [
  "code",
  "pre",
  "option",
  "td:not([data-i18n-ui])",
  "[role=cell]:not([data-i18n-ui])",
  "[role=gridcell]:not([data-i18n-ui])",
  "[contenteditable=true]",
  "[data-no-translate]",
  "[data-business-value]",
  "[data-business-row]",
  "[data-stock-name]",
  "[data-stock-group]",
  "[data-account-name]",
  "[data-article-code]",
  "[data-account-code]",
  "[data-container-number]",
  "[data-voucher-number]",
].join(",");

const TRANSLATABLE_ATTRIBUTES = ["aria-label", "title", "placeholder"] as const;
const PORTAL_SELECTOR = "[data-radix-portal], [data-i18n-portal]";

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
 * The main observer is scoped to the React application root, while a lightweight
 * body observer only discovers portal roots. Mutation work is batched into one
 * animation frame. Data cells and explicit business-value surfaces are excluded
 * unless a cell is intentionally marked data-i18n-ui.
 */
export function ApplicationInterfaceTranslator({ language }: { language: ApplicationLanguage }) {
  useEffect(() => {
    const root = document.getElementById("root");
    if (!root) return;

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

    translateInterfaceTree(root, language);
    document.querySelectorAll(PORTAL_SELECTOR).forEach((portal) => translateInterfaceTree(portal, language));

    const rootObserver = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) schedule(node);
        if (record.type === "characterData" || record.type === "attributes") schedule(record.target);
      }
    });
    rootObserver.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...TRANSLATABLE_ATTRIBUTES],
    });

    const portalObserver = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          const element = node as Element;
          if (element.matches(PORTAL_SELECTOR)) schedule(element);
          element.querySelectorAll(PORTAL_SELECTOR).forEach(schedule);
        }
      }
    });
    portalObserver.observe(document.body, { childList: true, subtree: true });

    return () => {
      rootObserver.disconnect();
      portalObserver.disconnect();
      pending.clear();
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [language]);

  return null;
}
