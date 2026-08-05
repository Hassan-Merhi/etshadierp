from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new and new in text:
        return text
    if old not in text:
        raise RuntimeError(f"Could not find {label}")
    return text.replace(old, new, 1)


path = Path("server/services/immutableStockTransferRevisionLifecycle.ts")
text = path.read_text()
text = text.replace('import { createHash } from "node:crypto";\n', '')
anchor = '} from "@shared/schema";\n'
input_import = '''} from "@shared/schema";
import {
  immutableRevisionPayloadHash,
  normalizeImmutableRevisionItems,
  type ImmutableRevisionItemInput,
} from "./immutableStockTransferRevisionInput";

export { normalizeImmutableRevisionItems } from "./immutableStockTransferRevisionInput";
export type { ImmutableRevisionItemInput } from "./immutableStockTransferRevisionInput";
'''
text = replace_once(text, anchor, input_import, "pure input import")
text = replace_once(
    text,
    '''export interface ImmutableRevisionItemInput {
  stockItemId: number;
  stockItemName: string;
  sourceLocationId: number;
  sourceLocationName?: string | null;
  originalQuantity: number;
  newQuantity: number;
}

''',
    '',
    "duplicate input interface",
)
text = replace_once(
    text,
    '''interface NormalizedItem extends ImmutableRevisionItemInput {
  delta: number;
}

''',
    '',
    "duplicate normalized interface",
)
text = replace_once(
    text,
    '''function finiteNonNegative(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative number`);
  return parsed;
}

''',
    '',
    "duplicate finite number helper",
)
normalize_start = text.find('export function normalizeImmutableRevisionItems(')
payload_start = text.find('function payloadHash(', normalize_start)
lock_start = text.find('async function lockTransfer(', payload_start)
if normalize_start < 0 or payload_start < 0 or lock_start < 0:
    if 'immutableRevisionPayloadHash' not in text:
        raise RuntimeError("Could not isolate normalization block")
else:
    text = text[:normalize_start] + text[lock_start:]
text = text.replace('const hash = payloadHash(normalized, note);', 'const hash = immutableRevisionPayloadHash(normalized, note);')
text = text.replace(
    '''    const row = current.find(
      (candidate) =>''',
    '''    const row = current.find(
      (candidate: typeof stockTransferItems.$inferSelect) =>'''
)
path.write_text(text)

path = Path("tests/group-a-phase-3-pos-transfer-revisions.test.ts")
text = path.read_text()
text = text.replace(
    'from "../server/services/immutableStockTransferRevisionLifecycle";',
    'from "../server/services/immutableStockTransferRevisionInput";'
)
path.write_text(text)

print("Group A Phase 3 pure revision input module wired.")
