export function cleanTxnDesc(desc: string): string {
  if (!desc) return "-";
  return (
    desc
      .replace(/^(SAL-DEP|SAL-WD|SAL-BON)-[\w-]+\s*/i, "")
      .replace(/\s*-\s*(SAL-DEP|SAL-WD|SAL-BON)-[\w-]+$/i, "")
      .trim() || desc
  );
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
