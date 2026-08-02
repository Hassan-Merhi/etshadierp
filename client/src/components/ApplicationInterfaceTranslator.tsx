import { useEffect } from "react";
import type { ApplicationLanguage } from "@shared/applicationLanguageContract";
import { translateSharedInterfaceText } from "@/i18n/sharedInterfaceTranslations";

const EXCLUDED_SELECTOR = [
  "input",
  "textarea",
  "select",
  "option",
  "code",
  "pre",
  "[contenteditable=true]",
  "[data-no-translate]",
  "[data-business-value]",
  "[data-stock-name]",
  "[data-article-code]",
].join(",");

function translateTextNode(node: Text, language: ApplicationLanguage) {
  const parent = node.parentElement;
  if (!parent || parent.closest(EXCLUDED_SELECTOR)) return;
  const translated = translateSharedInterfaceText(node.nodeValue ?? "", language);
  if (translated !== null && translated !== node.nodeValue) node.nodeValue = translated;
}

function translateTree(root: Node, language: ApplicationLanguage) {
  if (root.nodeType === Node.TEXT_NODE) {
    translateTextNode(root as Text, language);
    return;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current: Node | null = walker.nextNode();
  while (current) {
    translateTextNode(current as Text, language);
    current = walker.nextNode();
  }
}

/**
 * Phase 8 compatibility bridge for shared navigation and reusable controls.
 * It translates only exact, approved interface labels. Inputs, user content,
 * stock names, article codes and explicitly protected business values are never touched.
 */
export function ApplicationInterfaceTranslator({ language }: { language: ApplicationLanguage }) {
  useEffect(() => {
    translateTree(document.body, language);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) translateTree(node, language);
        if (record.type === "characterData") translateTree(record.target, language);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [language]);

  return null;
}
