export function normalizeLoadingArticleCode(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

export function shouldEnforceProformaOverload(options: {
  ignoreProforma: boolean;
  allowBypassOverload: boolean;
}): boolean {
  return !options.ignoreProforma && !options.allowBypassOverload;
}

export function shouldRequireProformaMembership(options: {
  ignoreProforma: boolean;
  hasProformaLine: boolean;
}): boolean {
  return !options.ignoreProforma && !options.hasProformaLine;
}
