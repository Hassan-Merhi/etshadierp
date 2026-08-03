import { useEffect } from "react";
import type { ApplicationLanguage } from "@shared/applicationLanguageContract";
import { translateApplicationLiteral } from "@/i18n/applicationTranslations";
import { translateSharedInterfaceText } from "@/i18n/sharedInterfaceTranslations";
import { translateAccountingDocumentText } from "@/i18n/accountingDocumentTranslations";
import { isPhase3SharedUiText, translatePhase3SharedUiText } from "@/i18n/sharedUiPhase3Translations";
import {
  isPhase4SupplierPartnerText,
  translatePhase4SupplierPartnerText,
} from "@/i18n/supplierPartnerPhase4Translations";
import {
  isPhase5PropertiesRentalsText,
  translatePhase5PropertiesRentalsText,
} from "@/i18n/propertiesRentalsPhase5Translations";
import { isPhase6ReportsExportsText, translatePhase6ReportsExportsText } from "@/i18n/reportsExportsPhase6Translations";
import {
  isPhase7BackendMessageText,
  translatePhase7BackendMessageText,
} from "@/i18n/backendMessagesPhase7Translations";

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
  "[data-property-name]",
  "[data-unit-name]",
  "[data-tenant-name]",
  "[data-contract-reference]",
].join(",");

const ELIGIBLE_TEXT_SELECTOR = [
  "button",
  "label",
  "legend",
  "th",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "nav a",
  "[role=button]",
  "[role=menuitem]",
  "[role=tab]",
  "[role=columnheader]",
  "[role=heading]",
  "[data-i18n-ui]",
].join(",");

const TRANSLATABLE_ATTRIBUTES = ["aria-label", "title", "placeholder"] as const;
const PORTAL_SELECTOR = "[data-radix-portal], [data-i18n-portal]";

function isProtected(element: Element): boolean {
  return Boolean(element.closest(EXCLUDED_SELECTOR));
}

function isEligibleTextElement(element: Element): boolean {
  return element.matches(ELIGIBLE_TEXT_SELECTOR) || Boolean(element.closest(ELIGIBLE_TEXT_SELECTOR));
}

export function translateApprovedInterfaceText(value: string, language: ApplicationLanguage): string | null {
  return (
    translateApplicationLiteral(value, language) ??
    translatePhase7BackendMessageText(value, language) ??
    translatePhase6ReportsExportsText(value, language) ??
    translatePhase5PropertiesRentalsText(value, language) ??
    translatePhase4SupplierPartnerText(value, language) ??
    translatePhase3SharedUiText(value, language) ??
    translateSharedInterfaceText(value, language) ??
    translateAccountingDocumentText(value, language)
  );
}

function translateTextNode(node: Text, language: ApplicationLanguage) {
  const parent = node.parentElement;
  if (!parent || isProtected(parent)) return;

  const value = node.nodeValue ?? "";
  if (
    !isEligibleTextElement(parent) &&
    !isPhase3SharedUiText(value) &&
    !isPhase4SupplierPartnerText(value) &&
    !isPhase5PropertiesRentalsText(value) &&
    !isPhase6ReportsExportsText(value) &&
    !isPhase7BackendMessageText(value)
  ) {
    return;
  }

  const translated = translateApprovedInterfaceText(value, language);
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
 * animation frame. Plain spans/divs and table data cells remain business content
 * by default. Exact reviewed application labels, Phase 3 shared-interface,
 * Phase 4 Supplier Partner, Phase 5 Properties/Rentals, Phase 6 Reports/Exports,
 * and Phase 7 backend messages may translate outside normal control/heading
 * selectors, while protected business-value markers always take precedence.
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
