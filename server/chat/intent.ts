/**
 * Intent detection & deterministic request parsing for the chat assistant.
 *
 * Pure, dependency-free classification: the chat-intent union, provider-
 * routing and ERP-action regexes, and the LLM-free multi-source stock-
 * transfer parser. Extracted from chatService.ts; behaviour is unchanged.
 */

// ── Intent types ──────────────────────────────────────────────────────────────
type ChatIntent =
  | "create_voucher"
  | "create_stock_adjustment"
  | "create_stock_transfer"
  | "create_stock_item"
  | "price_update"
  | "search_voucher"
  | "account_query"
  | "inventory_query"
  | "supplier_query"
  | "customer_query"
  | "sales_query"
  | "excel_import"
  | "business_summary"
  | "general_knowledge"
  | "code_read"
  | "code_edit"
  | "general";

// ── Smart provider routing regexes ────────────────────────────────────────────
const RE_CODE_GEN =
  /\b(write (a |an |some )?(code|function|class|script|app|program|website|webpage|component|html page)|build (me )?(a |an )?(app|website|script|tool)|create (a |an )?(app|website|html|component|tool)|generate (a |an )?(html|css|script|app)|make (me )?(a |an )?(app|website|tool)|(html|css|javascript|typescript|python|react|nodejs?)\s+(code|snippet|example|template|app)|code (to|that|which)|how (to|do I) (code|program|write code|build))\b/i;
const RE_NEWS_QUERY =
  /\b(latest news|current events|what.{0,25}happening (in|today|now|right now)|news (today|about|on)|recent (developments|events|news)|trending (now|today)|breaking news|what.{0,20}new (in|with|about)|today.{0,15}(news|events|headlines))\b/i;

// ── Code agent intent regexes ─────────────────────────────────────────────────
// Matches a reference to a project file (path or bare filename with extension)
const RE_PROJECT_FILE =
  /\b((?:server|client|shared|scripts)\/[\w./+-]+\.(?:ts|tsx|js|jsx|css|json|md)|[\w-]+\.(?:ts|tsx|js|jsx|json|css|md))\b/i;
// Read-only intent verbs combined with a project file ref OR explicit search/grep request
const RE_CODE_READ =
  /\b(?:show me|read|open|explain|what does|how does|how is|describe|view)\b.*\b[\w-]+\.(?:ts|tsx|js|jsx|json|css)|\b(?:find where|search for|where is|grep for|look for|where does)\b/i;
// Write/edit intent verbs combined with a project file ref OR explicit edit phrasing
const RE_CODE_EDIT =
  /\b(?:add|create|edit|fix|update|modify|refactor|implement|write)\b.{0,120}\b[\w-]+\.(?:ts|tsx|js|jsx|json|css)|\b(?:create (?:a )?(?:new )?file|add (?:a )?(?:function|route|endpoint|component|field|column|type|interface|class|method|hook|handler)|fix (?:the )?bug|implement (?:the )?)\b.{0,80}\b(?:server|client|shared)\//i;
// Pathless code-edit intent: covers "add a discount field to the voucher form" style requests
// that reference UI/code constructs but no explicit file path.
// "create" is included (create a new component/page/hook) but "voucher/payment/entry" are
// deliberately excluded from the target-noun list to avoid misclassifying ERP requests.
const RE_CODE_EDIT_PATHLESS =
  /\b(?:add|create|edit|fix|update|modify|refactor|implement|rename|remove|delete)\b.{0,140}\b(?:field|button|component|form|page|tab|modal|dialog|dropdown|select|input|textarea|checkbox|radio|label|column|table|card|sidebar|header|footer|nav|menu|link|icon|badge|tooltip|alert|toast|state|hook|function|method|route|endpoint|schema|migration|type|interface|class|handler|prop|event|style|stylesheet|variable|constant|import|export|render|widget|layout|section|panel|filter|feature|validation|permission)\b/i;
// Financial-transaction markers — presence means the request is almost certainly ERP, not code
const RE_FINANCIAL_TX =
  /(?:\$\s?\d|\d[\d,]*\s*(?:USD|PKR|AED|EUR|GBP|SAR|OMR|KWD|usd|pkr|aed|eur))\b|\b(?:paid|pay\b|received|collect\b|deposit\b|withdraw|remit|invoice\s+\S+\s+\d|receipt\s+\S+\s+\d)\b/i;
const RE_GENERAL_KNOWLEDGE =
  /^(hi|hello|hey|yo|sup|hiya|howdy)\b|\b(explain|what (is|are|was|were|does|did)|who (is|are|was|were)|how does|how do|how (can|should) (i|we)|why (is|are|does|do|was|were)|tell me about|write (a |an )?(story|poem|essay|email|letter|blog|article|report)|help me (understand|with|write|create)|translate|summarize|what does .{0,30} mean|give me (a |an )?(example|list|summary|idea)|best (way|practice|approach) to|pros and cons|difference between)\b/i;

// Detect best provider for a given message — returns override or null (use admin setting)
function detectSmartProvider(message: string, available: string[]): "gemini" | "chatgpt" | "grok" | null {
  const has = (p: string) => available.includes(p);
  if (RE_CODE_GEN.test(message) && has("chatgpt")) return "chatgpt";
  if (RE_NEWS_QUERY.test(message) && has("grok")) return "grok";
  if (
    /\b(analyz|statistic|math|calculat|formula|equation|data science|machine learning|science|chemistry|biology|physics|research)\b/i.test(
      message
    ) &&
    has("gemini")
  )
    return "gemini";
  return null;
}

// ── Module-level intent regexes (shared between classifyChatIntent + chat) ────
const RE_VOUCHER =
  /\b(create|make|record|add|post|enter|book)\b.{0,80}\b(payment|receipt|journal|voucher|entry|invoice|transaction)\b|\b(pay|paid|receive[d]?|collect[ed]?|transfer[red]?|deposit[ed]?)\b.{0,60}\$?\d|\b(journal|receipt|payment)\b.{0,40}\$?\d/i;
const RE_STOCK_ADJ =
  /\b(produce|producing|production|consume|consuming|consumption|stock\s+adjust|adjust\s+stock|record\s+production|record\s+consumption|produced|consumed)\b/i;
const RE_STOCK_TRANSFER =
  /\b(transfer|move|shift)\b.{0,80}\b(stock|item|inventory)\b|\b(stock|item|inventory)\b.{0,60}\b(transfer|move|shift)\b|\btransfer\b.{0,40}\bfrom\b.{0,40}\bto\b/i;
// Explicit stock-transfer signal — the message names stock/item/inventory
// directly next to transfer/move/shift, so it can NEVER be a financial
// ledger transfer even if it also happens to match RE_VOUCHER's generic
// "transfer ... <digit>" heuristic (e.g. "stock transfer draft for 410
// bales..." incidentally matches "transfer[red]?\b.{0,60}\$?\d"). Used to
// give stock-transfer classification priority over that voucher heuristic.
// Excludes "stock/inventory/item ACCOUNT" phrasing (e.g. "transfer $500 from
// the inventory account to cash") — that is unambiguously a ledger/journal
// transfer between accounts, not a physical stock movement, even though it
// mentions "inventory" near "transfer".
const RE_STOCK_ACCOUNT_CONTEXT = /\b(stock|inventory|item)\s+account\b|\baccount\b.{0,20}\b(stock|inventory|item)\b/i;
const RE_STOCK_TRANSFER_EXPLICIT_RAW =
  /\b(transfer|move|shift)\b.{0,80}\b(stock|item|inventory)\b|\b(stock|item|inventory)\b.{0,60}\b(transfer|move|shift)\b/i;
const RE_STOCK_TRANSFER_EXPLICIT = {
  test: (msg: string) => RE_STOCK_TRANSFER_EXPLICIT_RAW.test(msg) && !RE_STOCK_ACCOUNT_CONTEXT.test(msg),
};
// Analysis-style stock transfer requests (no explicit item/quantity given —
// the AI must run a server-side data analysis instead of extracting numbers).
const RE_STOCK_TRANSFER_ANALYSIS =
  /\b(analy[sz]e|suggest|recommend|compare)\b.{0,100}\b(transfer|move|stock|sales|sell)\b|\bwhat\s+(should|to)\s+(i|we)\s+(move|transfer)\b|\bsells?\s+better\b|\boptional\s+(stock\s+)?transfer\b|\bbased\s+on\s+(sales|stock|old\s+transfers?)\b.{0,60}\btransfer\b|\btransfer\b.{0,60}\bbased\s+on\b/i;
// Same as RE_STOCK_TRANSFER_ANALYSIS but WITHOUT the generic "\boptional\s+(stock\s+)?transfer\b"
// clause. That clause alone is too broad — a fully deterministic request like
// "Create an optional stock transfer draft for 410 bales to Kolwezi from Hadi
// 1, Hadi 2, Hadi 3, and Hadi 4..." also says "optional stock transfer" but has
// explicit sources/quantity and must NOT be misrouted into the data-driven
// analysis/suggestion branch. Only genuine analysis language (analyze/suggest/
// recommend/compare, "what should I move", "sells better", "based on sales")
// should count as an analysis-style request for routing-priority purposes.
const RE_STOCK_TRANSFER_ANALYSIS_STRICT =
  /\b(analy[sz]e|suggest|recommend|compare)\b.{0,100}\b(transfer|move|stock|sales|sell)\b|\bwhat\s+(should|to)\s+(i|we)\s+(move|transfer)\b|\bsells?\s+better\b|\bbased\s+on\s+(sales|stock|old\s+transfers?)\b.{0,60}\btransfer\b|\btransfer\b.{0,60}\bbased\s+on\b/i;
// Multi-source, target-quantity transfer requests — e.g. "410 bales to Kolwezi
// from Hadi 1,2,3,4, only stock groups Kolwezi already has". No explicit item
// list is given, so this must go through the deterministic quantity-target
// builder instead of the naive single-item extraction prompt.
const RE_MULTI_SOURCE_LOCATIONS =
  /\b[a-z][a-z\s]*\d+\s*(?:,\s*\d+)+\b|\b[a-z][a-z\s]*\d+\s*-\s*\d+\b/i;
const RE_TARGET_QTY_HINT = /\b\d+\s*(bales?|items?|units?|pcs?|pieces?|cartons?|bags?)\b/i;
// Only treat a bare quantity hint (without an explicit multi-source location
// pattern) as this new flow when the message also signals the "auto-select by
// stock group" filtering behavior — otherwise a normal single-item transfer
// like "transfer 50 bales of EG45044 from Hadi 1 to Kolwezi" must keep going
// through the legacy single-item extraction path unchanged.
const RE_STOCK_GROUP_FILTER_HINT =
  /\bstock\s+group|\bsame\s+group|\balready\s+has|\balready\s+carr(?:y|ies)|\bdon'?t\s+mix|\bdo\s+not\s+mix\b/i;
const RE_STOCK_ITEM_CREATE =
  /\b(create\s+(a\s+)?stock\s+item|add\s+(a\s+)?stock\s+item|new\s+stock\s+item|create\s+(a\s+)?new\s+item|add\s+(a\s+)?new\s+item|new\s+item)\b/i;
const RE_PRICE_UPDATE =
  /\b(update.*price|change.*price|set.*price|price.*to|price.*for|update.*selling|change.*selling|new price|price list)\b/i;
const RE_VOUCHER_SEARCH =
  /\b(when did (i|we) pay|find (the )?(payment|receipt|voucher|transaction)|search (for )?(voucher|payment|receipt)|show (me )?(the )?(voucher|payment|receipt)|paid for|receipt for|voucher for|payment (for|of)|what voucher|which voucher|show.*payment.*for|show.*receipt.*for)\b/i;
const RE_ACCOUNT_QUERY =
  /\b(balance of|account.*balance|how much.*account|account.*how much|what.*balance|balance.*account|when did.*account|account.*transactions|transactions.*account|paid.*from account|received.*account|when.*balance.*was|balance.*was.*when|ledger.*balance|account.*paid|account.*received)\b/i;

// ── Deterministic multi-source/target-quantity transfer pre-parser ─────────
// The LLM-based `multiPrompt` extraction below is the primary parser, but it
// can misparse or hallucinate (wrong destination, dropped sources, etc). This
// deterministic regex/name-matching parser runs first and, when it can
// confidently resolve destination + source(s) + target quantity against the
// company's REAL location list, its result is used directly — never invented,
// always grounded in the actual `locations` rows. It only returns a non-null
// result when it is fully confident; otherwise the LLM parser is used as
// before. This guarantees requests like "410 bales to Kolwezi today from
// Hadi 1, Hadi 2, Hadi 3, and Hadi 4" resolve correctly even if the LLM
// mis-extracts the repeated-full-name source list.
function escapeRegexLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findKnownLocationMentions(
  msg: string,
  locations: { id: number; name: string; code: string | null }[]
): { name: string; id: number; index: number; length: number }[] {
  const raw: { name: string; id: number; index: number; length: number }[] = [];
  for (const loc of locations) {
    const name = (loc.name || "").trim();
    if (!name || name.length < 2) continue;
    const re = new RegExp(`\\b${escapeRegexLiteral(name)}\\b`, "i");
    const m = msg.match(re);
    if (m && m.index !== undefined) raw.push({ name, id: loc.id, index: m.index, length: name.length });
  }
  // When multiple location names match at/around the same position (e.g. plain
  // "Kolwezi" is itself a valid \b-bounded match inside "Kolwezi 2"), keep only
  // the longest/most specific match so "Kolwezi 2" is never silently collapsed
  // into "Kolwezi".
  raw.sort((a, b) => a.index - b.index || b.length - a.length);
  const kept: typeof raw = [];
  for (const m of raw) {
    const overlapsKept = kept.some((k) => m.index >= k.index && m.index < k.index + k.length);
    if (!overlapsKept) kept.push(m);
  }
  return kept.sort((a, b) => a.index - b.index);
}

function extractExcludedLocationIds(
  msg: string,
  locations: { id: number; name: string; code: string | null }[]
): Set<number> {
  const excluded = new Set<number>();
  const re = /\b(?:do not use|don'?t use|exclude|excluding|never use)\s+([a-z0-9][\w\s]*?)(?=\s*(?:\.|,|$|\bfrom\b|\bto\b))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(msg))) {
    const phrase = m[1].trim().toLowerCase();
    for (const loc of locations) {
      if ((loc.name || "").trim().toLowerCase() === phrase) excluded.add(loc.id);
    }
  }
  return excluded;
}

function matchDeterministicSourceSegment(msg: string): RegExpMatchArray | null {
  return msg.match(
    /\bfrom\s+(.+?)(?:\.\s|\.$|,?\s*only\b|,?\s*do not\b|,?\s*don't\b|,?\s*if\b|,?\s*today\b|,?\s*tomorrow\b|$)/i
  );
}

// Expands numeric shorthand ("Hadi 1,2,3,4" / "Hadi 1-4") into full names.
// Only used as a fallback when named-location-mention matching finds 0-1
// sources, since shorthand numbers don't literally appear as full location
// names in the text.
function extractSourceNamesShorthand(msg: string): string[] {
  const fromMatch = matchDeterministicSourceSegment(msg);
  if (!fromMatch) return [];
  const segment = fromMatch[1].replace(/\s+(today|tomorrow)\s*$/i, "").trim();
  if (!segment) return [];
  const shorthand = segment.match(/^([a-z][a-z\s]*?)\s+(\d+(?:\s*,\s*(?:and\s+)?\d+)+)$/i);
  if (shorthand) {
    const base = shorthand[1].trim();
    const nums = shorthand[2].match(/\d+/g) || [];
    return nums.map((n) => `${base} ${n}`);
  }
  const rangeMatch = segment.match(/^([a-z][a-z\s]*?)\s+(\d+)\s*-\s*(\d+)$/i);
  if (rangeMatch) {
    const base = rangeMatch[1].trim();
    const start = parseInt(rangeMatch[2], 10);
    const end = parseInt(rangeMatch[3], 10);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start && end - start < 50) {
      const out: string[] = [];
      for (let n = start; n <= end; n++) out.push(`${base} ${n}`);
      return out;
    }
  }
  return [];
}

interface DeterministicMultiSourceResult {
  destinationName: string;
  sourceNames: string[];
  targetQty: number;
  optional: boolean;
}

function deterministicParseMultiSourceTransfer(
  msg: string,
  locations: { id: number; name: string; code: string | null }[]
): DeterministicMultiSourceResult | null {
  const targetQtyMatch = msg.match(/\b(\d+)\s*(?:bales?|items?|units?|pcs?|pieces?|cartons?|bags?)\b/i);
  const targetQty = targetQtyMatch ? parseInt(targetQtyMatch[1], 10) : undefined;
  const optional = /\boptional\b/i.test(msg);
  const excludedIds = extractExcludedLocationIds(msg, locations);
  const mentions = findKnownLocationMentions(msg, locations).filter((m) => !excludedIds.has(m.id));
  const fromMatchObj = msg.match(/\bfrom\b/i);
  const fromIdx = fromMatchObj ? fromMatchObj.index! : -1;

  let destinationName: string | undefined;
  let sourceNames: string[] = [];

  if (fromIdx >= 0) {
    const before = mentions.filter((m) => m.index < fromIdx);
    const after = mentions.filter((m) => m.index >= fromIdx);
    if (before.length === 1) destinationName = before[0].name;
    if (after.length > 0) sourceNames = after.map((m) => m.name);
  }

  if (sourceNames.length <= 1) {
    const shorthandSources = extractSourceNamesShorthand(msg);
    const resolved = shorthandSources.filter((n) =>
      locations.some((l) => (l.name || "").trim().toLowerCase() === n.trim().toLowerCase())
    );
    if (resolved.length > sourceNames.length) sourceNames = resolved;
  }

  if (!destinationName || sourceNames.length === 0 || !targetQty || !Number.isFinite(targetQty) || targetQty <= 0) {
    return null;
  }
  return { destinationName, sourceNames, targetQty, optional };
}

export {
  type ChatIntent,
  type DeterministicMultiSourceResult,
  RE_CODE_GEN,
  RE_NEWS_QUERY,
  RE_PROJECT_FILE,
  RE_CODE_READ,
  RE_CODE_EDIT,
  RE_CODE_EDIT_PATHLESS,
  RE_FINANCIAL_TX,
  RE_GENERAL_KNOWLEDGE,
  detectSmartProvider,
  RE_VOUCHER,
  RE_STOCK_ADJ,
  RE_STOCK_TRANSFER,
  RE_STOCK_TRANSFER_EXPLICIT,
  RE_STOCK_TRANSFER_ANALYSIS,
  RE_STOCK_TRANSFER_ANALYSIS_STRICT,
  RE_MULTI_SOURCE_LOCATIONS,
  RE_TARGET_QTY_HINT,
  RE_STOCK_GROUP_FILTER_HINT,
  RE_STOCK_ITEM_CREATE,
  RE_PRICE_UPDATE,
  RE_VOUCHER_SEARCH,
  RE_ACCOUNT_QUERY,
  deterministicParseMultiSourceTransfer,
};
