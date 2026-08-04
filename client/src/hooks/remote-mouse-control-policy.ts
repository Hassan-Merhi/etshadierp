import {
  clearRemoteEditableFocus,
  focusRemoteEditableElement,
} from "./remote-keyboard-control-policy";

export type RemoteMouseCommandType = "pointer-move" | "click" | "scroll";
export type RemoteMouseExecutionStatus = "executed" | "blocked" | "ignored";

export interface RemoteMouseCommandView {
  id: string;
  sessionId: string;
  type: RemoteMouseCommandType;
  sequence: number;
  x: number;
  y: number;
  deltaX?: number;
  deltaY?: number;
  createdAt?: string;
}

export interface RemoteMouseExecutionResult {
  status: RemoteMouseExecutionStatus;
  reason: string | null;
  clientX: number;
  clientY: number;
}

export interface RemoteMouseExecutionOptions {
  keyboardEnabled?: boolean;
}

const BLOCKED_SELECTOR = [
  "input",
  "textarea",
  "select",
  "option",
  "form",
  "[contenteditable]:not([contenteditable='false'])",
  "[data-remote-control-blocked='true']",
  "[data-sensitive-action]",
  "[data-destructive]",
  "[data-screenfeed-ignore='true']",
  "[disabled]",
  "[aria-disabled='true']",
].join(",");

const CLICKABLE_SELECTOR = [
  "button",
  "a[href]",
  "summary",
  "[role='button']",
  "[role='link']",
  "[role='menuitem']",
  "[role='tab']",
  "[data-remote-control-safe='true']",
].join(",");

const DANGEROUS_TEXT = new RegExp(
  [
    "\\b(save|submit|create|add|delete|remove|archive|restore|approve|reject|post|reverse|offload|cancel|pay|payment|receipt|transfer|send|print|whatsapp|logout|confirm|finalize|complete|import|upload|export|adjust|edit|password|permission)\\b",
    "sign[\\s_-]*out",
    "close[\\s_-]*period",
    "(?:^|[/\\s_-])new(?:[/\\s_-]|$)",
    "\\b(supprimer|enregistrer|confirmer|annuler|envoyer|payer|valider|modifier|ajouter|créer)\\b",
    "تأكيد",
    "حفظ",
    "حذف",
    "إضافة",
    "إرسال",
    "دفع",
    "تعديل",
    "إلغاء",
  ].join("|"),
  "i"
);

const SAFE_ACTION_TEXT = new RegExp(
  [
    "view",
    "open",
    "close",
    "back",
    "next",
    "previous",
    "details",
    "history",
    "show",
    "hide",
    "expand",
    "collapse",
    "search",
    "filter",
    "refresh",
    "clear filter",
    "fit",
    "full screen",
    "home",
    "dashboard",
    "menu",
    "navigation",
    "voir",
    "ouvrir",
    "fermer",
    "retour",
    "suivant",
    "précédent",
    "détails",
    "historique",
    "afficher",
    "masquer",
    "rechercher",
    "filtrer",
    "actualiser",
    "tableau de bord",
    "عرض",
    "فتح",
    "إغلاق",
    "رجوع",
    "التالي",
    "السابق",
    "تفاصيل",
    "السجل",
    "إظهار",
    "إخفاء",
    "بحث",
    "تصفية",
    "تحديث",
    "لوحة التحكم",
  ].join("|"),
  "i"
);

function finiteCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function elementDescriptor(element: Element): string {
  const htmlElement = element as HTMLElement;
  const href = element instanceof HTMLAnchorElement ? (element.getAttribute("href") ?? "") : "";
  return [
    htmlElement.innerText,
    htmlElement.textContent,
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
    element.getAttribute("data-testid"),
    element.getAttribute("name"),
    href,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function isSameOriginNavigation(anchor: HTMLAnchorElement, location: Location): boolean {
  const href = anchor.getAttribute("href")?.trim() ?? "";
  if (!href || href.startsWith("#") || href.toLowerCase().startsWith("javascript:")) return false;
  if (anchor.hasAttribute("download") || anchor.target === "_blank") return false;

  try {
    const target = new URL(href, location.href);
    return target.origin === location.origin;
  } catch {
    return false;
  }
}

export function normalizeRemoteMousePoint(
  clientX: number,
  clientY: number,
  rect: Pick<DOMRect, "left" | "top" | "width" | "height">
): { x: number; y: number } | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}

export function isRemoteMouseBlockedElement(element: Element | null): boolean {
  if (!element) return true;
  const blocked = element.closest(BLOCKED_SELECTOR);
  if (blocked) return true;

  const clickable = element.closest(CLICKABLE_SELECTOR);
  return !!clickable && DANGEROUS_TEXT.test(elementDescriptor(clickable));
}

export function isAllowedRemoteClickElement(
  element: Element | null,
  location: Location = window.location
): element is HTMLElement {
  if (!element || isRemoteMouseBlockedElement(element)) return false;
  const clickable = element.closest(CLICKABLE_SELECTOR);
  if (!(clickable instanceof HTMLElement)) return false;

  if (clickable.getAttribute("data-remote-control-safe") === "true") return true;
  if (clickable.getAttribute("role") === "tab" || clickable.tagName === "SUMMARY") return true;
  if (clickable instanceof HTMLAnchorElement) {
    return isSameOriginNavigation(clickable, location) && !DANGEROUS_TEXT.test(elementDescriptor(clickable));
  }

  const descriptor = elementDescriptor(clickable);
  return !!descriptor && SAFE_ACTION_TEXT.test(descriptor) && !DANGEROUS_TEXT.test(descriptor);
}

function nearestScrollableElement(element: Element | null, view: Window): HTMLElement | null {
  let current = element instanceof HTMLElement ? element : null;
  while (current && current !== view.document.body) {
    const style = view.getComputedStyle(current);
    const scrollableX = /(auto|scroll)/.test(style.overflowX) && current.scrollWidth > current.clientWidth;
    const scrollableY = /(auto|scroll)/.test(style.overflowY) && current.scrollHeight > current.clientHeight;
    if (scrollableX || scrollableY) return current;
    current = current.parentElement;
  }
  return null;
}

export function applyRemoteMouseCommand(
  command: RemoteMouseCommandView,
  documentRef: Document = document,
  view: Window = window,
  options: RemoteMouseExecutionOptions = {}
): RemoteMouseExecutionResult {
  if (!finiteCoordinate(command.x) || !finiteCoordinate(command.y)) {
    return { status: "ignored", reason: "invalid-coordinates", clientX: 0, clientY: 0 };
  }

  const clientX = Math.max(0, Math.min(view.innerWidth - 1, command.x * view.innerWidth));
  const clientY = Math.max(0, Math.min(view.innerHeight - 1, command.y * view.innerHeight));
  const target = documentRef.elementFromPoint(clientX, clientY);

  if (command.type === "pointer-move") {
    return { status: "executed", reason: null, clientX, clientY };
  }

  if (!target) {
    return { status: "ignored", reason: "no-target", clientX, clientY };
  }

  if (command.type === "scroll") {
    const deltaX = typeof command.deltaX === "number" && Number.isFinite(command.deltaX) ? command.deltaX : 0;
    const deltaY = typeof command.deltaY === "number" && Number.isFinite(command.deltaY) ? command.deltaY : 0;
    if (deltaX === 0 && deltaY === 0) {
      return { status: "ignored", reason: "empty-scroll", clientX, clientY };
    }

    const scrollTarget = nearestScrollableElement(target, view);
    if (scrollTarget) {
      scrollTarget.scrollBy({ left: deltaX, top: deltaY, behavior: "auto" });
    } else {
      view.scrollBy({ left: deltaX, top: deltaY, behavior: "auto" });
    }
    return { status: "executed", reason: null, clientX, clientY };
  }

  if (options.keyboardEnabled && focusRemoteEditableElement(target)) {
    return { status: "executed", reason: null, clientX, clientY };
  }
  clearRemoteEditableFocus();

  if (isRemoteMouseBlockedElement(target)) {
    return { status: "blocked", reason: "protected-element", clientX, clientY };
  }

  if (!isAllowedRemoteClickElement(target, view.location)) {
    return { status: "blocked", reason: "action-not-allowlisted", clientX, clientY };
  }

  const clickable = target.closest(CLICKABLE_SELECTOR);
  if (!(clickable instanceof HTMLElement)) {
    return { status: "ignored", reason: "no-clickable-target", clientX, clientY };
  }

  try {
    clickable.focus({ preventScroll: true });
    clickable.click();
    return { status: "executed", reason: null, clientX, clientY };
  } catch {
    return { status: "ignored", reason: "click-failed", clientX, clientY };
  }
}
