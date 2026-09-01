type FocusOptions = {
  select?: boolean;
  delay?: number;
  anchor?: Element | null;
};

function isVisible(element: HTMLElement): boolean {
  return element.offsetParent !== null || element.getClientRects().length > 0;
}

function candidateRoots(anchor?: Element | null): ParentNode[] {
  if (typeof document === "undefined") return [];

  const source = anchor ?? document.activeElement;
  const roots: ParentNode[] = [];
  if (source && typeof (source as Element).closest === "function") {
    const form = source.closest("form");
    const dialog = source.closest('[role="dialog"]');
    const sheet = source.closest('[data-radix-dialog-content]');
    const main = source.closest("main");
    for (const root of [form, dialog, sheet, main]) {
      if (root && !roots.includes(root)) roots.push(root);
    }
  }
  roots.push(document);
  return roots;
}

export function findScopedTestId(testId: string, anchor?: Element | null): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const escapedTestId =
    globalThis.CSS?.escape?.(testId) ?? testId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const selector = `[data-testid="${escapedTestId}"]`;

  for (const root of candidateRoots(anchor)) {
    const queryRoot = root as ParentNode & {
      querySelector?: (query: string) => Element | null;
    };
    if (typeof queryRoot.querySelectorAll !== "function") {
      const match = queryRoot.querySelector?.(selector) as HTMLElement | null;
      if (match) return match;
      continue;
    }
    const matches = Array.from(queryRoot.querySelectorAll(selector)) as HTMLElement[];
    const visible = matches.find(isVisible);
    if (visible) return visible;
    if (matches[0]) return matches[0];
  }
  return null;
}

export function focusScopedTestId(testId: string, options: FocusOptions = {}): void {
  const { select = false, delay = 0, anchor } = options;
  const run = () => {
    const element = findScopedTestId(testId, anchor);
    if (!element) return;
    element.focus();
    const selectable = element as HTMLElement & { select?: () => void };
    if (select && typeof selectable.select === "function") selectable.select();
  };

  if (delay > 0) setTimeout(run, delay);
  else requestAnimationFrame(run);
}
