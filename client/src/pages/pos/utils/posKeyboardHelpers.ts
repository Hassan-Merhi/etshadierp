// Pure helper for focusing/selecting a POS grid cell input by row/col index.
// Extracted from usePosHandlers.ts (Phase 18 structural split) — logic unchanged.
export function makeFocusCell(inputRefs: React.MutableRefObject<{ [key: string]: HTMLInputElement }>) {
  return (row: number, col: number) => {
    inputRefs.current[`${row}-${col}`]?.focus();
    inputRefs.current[`${row}-${col}`]?.select();
  };
}
