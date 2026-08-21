import { db } from "../db";
import * as schema from "@shared/schema";
import { and, eq, isNull } from "drizzle-orm";
import {
  deterministicParseMultiSourceTransfer,
  RE_MULTI_SOURCE_LOCATIONS,
  RE_STOCK_GROUP_FILTER_HINT,
  RE_STOCK_TRANSFER,
  RE_STOCK_TRANSFER_ANALYSIS_STRICT,
  RE_TARGET_QTY_HINT,
} from "./intent";
import { buildStockTransferByTargetQuantityContext, matchLocationByName } from "../services/stockTransferAnalysis";

// ── Early hard-return route: deterministic multi-source, target-quantity
// stock transfer (e.g. "410 bales to Kolwezi from Hadi 1, Hadi 2, Hadi 3, and
// Hadi 4"). This runs BEFORE voucher extraction, account query, Phase1 data
// query, and the generic AI call, so none of those can hijack this request
// with generic text ("I understand... I will create it...") or a bogus
// "Source and destination locations are required" error. It is intentionally
// LLM-free: it only fires when `deterministicParseMultiSourceTransfer` can
// confidently resolve destination + source(s) + target quantity against the
// REAL `locations` table. When the deterministic parser can't confidently
// resolve the request, this returns null and the legacy (LLM-assisted)
// extraction further down in `chat()` gets a chance instead — this function
// never itself falls back to an LLM call.
export async function tryBuildEarlyMultiSourceTargetTransfer(
  companyId: number,
  userMessage: string,
  suggestions: string[],
  usedProvider: string
): Promise<{
  response: string;
  suggestions: string[];
  provider?: string;
  stockTransferDraft?: unknown;
  stockTransferDrafts?: unknown[];
} | null> {
  const hasMultiSourceQtySignal =
    RE_MULTI_SOURCE_LOCATIONS.test(userMessage) ||
    (RE_TARGET_QTY_HINT.test(userMessage) && RE_STOCK_GROUP_FILTER_HINT.test(userMessage));
  const isMultiSourceTargetQtyRequest =
    (RE_STOCK_TRANSFER.test(userMessage) || hasMultiSourceQtySignal) &&
    !RE_STOCK_TRANSFER_ANALYSIS_STRICT.test(userMessage) &&
    hasMultiSourceQtySignal;

  if (!isMultiSourceTargetQtyRequest) return null;

  const locRows = await db
    .select({ id: schema.locations.id, name: schema.locations.name, code: schema.locations.code })
    .from(schema.locations)
    .where(and(eq(schema.locations.companyId, companyId), isNull(schema.locations.deletedAt)))
    .limit(80);

  const deterministic = deterministicParseMultiSourceTransfer(userMessage, locRows);
  if (!deterministic) {
    // Not confident enough for the LLM-free path — let the legacy LLM-assisted
    // extraction block further down attempt it instead.
    return null;
  }

  const { destinationName, sourceNames, targetQty, optional } = deterministic;
  // Default true — matches the legacy multi-source block's behavior (both its
  // deterministic and LLM-assisted sub-paths default to true unless the
  // request explicitly signals otherwise). The regex hint only ever
  // reinforces true; it must never be the sole source of "true" or a request
  // without explicit stock-group wording would wrongly skip destination
  // stock-group filtering here while the legacy path would have applied it.
  const onlyDestinationStockGroups = true;
  const dateStr = new Date().toISOString().slice(0, 10);

  // Destination must match STRICTLY — never silently substitute "Kolwezi 2" for "Kolwezi".
  const destMatch = await matchLocationByName(companyId, destinationName, { strict: true });

  if (!destinationName) {
    return {
      response: "I need a destination location to build this transfer — which location should receive the stock?",
      suggestions,
      provider: usedProvider,
    };
  }
  if (!destMatch.matched && destMatch.candidates.length > 0) {
    return {
      response: `"${destinationName}" matches more than one location. Please tell me exactly which one you mean before I build the transfer.`,
      suggestions,
      provider: usedProvider,
      stockTransferDraft: {
        date: dateStr,
        sourceLocationId: 0,
        sourceLocationName: sourceNames.join(", "),
        destinationLocationId: 0,
        destinationLocationName: destinationName,
        items: [],
        locationCandidates: destMatch.candidates.map((c) => ({ id: c.id, name: `${c.name} (${c.code})` })),
        optional,
      },
    };
  }
  if (!destMatch.matched) {
    return {
      response: `I couldn't find a location matching "${destinationName}". Please give the exact destination location name.`,
      suggestions,
      provider: usedProvider,
    };
  }
  if (sourceNames.length === 0) {
    return {
      response: `Which source location(s) should I pull stock from for the transfer to ${destMatch.matched.name}?`,
      suggestions,
      provider: usedProvider,
    };
  }
  if (!targetQty) {
    return {
      response: `How many bales/items in total would you like transferred to ${destMatch.matched.name}?`,
      suggestions,
      provider: usedProvider,
    };
  }

  const sourceMatches = await Promise.all(sourceNames.map((n) => matchLocationByName(companyId, n)));
  const matchedSources: { id: number; name: string }[] = [];
  const unresolvedSources: string[] = [];
  sourceMatches.forEach((m, idx) => {
    if (m.matched) matchedSources.push(m.matched);
    else unresolvedSources.push(sourceNames[idx]);
  });

  const usableSources = matchedSources.filter((s) => s.id !== destMatch.matched!.id);
  const sameAsDestination = matchedSources.filter((s) => s.id === destMatch.matched!.id);

  if (matchedSources.length === 0) {
    return {
      response: `I couldn't find any of the source locations you mentioned (${sourceNames.join(", ")}). Please give the exact source location name(s).`,
      suggestions,
      provider: usedProvider,
    };
  }
  if (usableSources.length === 0) {
    return {
      response: `The source location(s) you gave (${sameAsDestination.map((s) => s.name).join(", ")}) are the same as the destination (${destMatch.matched.name}) — please give different source location(s) to transfer from.`,
      suggestions,
      provider: usedProvider,
    };
  }

  const ctx = await buildStockTransferByTargetQuantityContext(
    companyId,
    usableSources.map((s) => s.id),
    destMatch.matched.id,
    targetQty,
    { onlyDestinationStockGroups }
  );

  const missingNote = unresolvedSources.length > 0 ? ` (couldn't find: ${unresolvedSources.join(", ")})` : "";

  if (ctx.noEligibleStock) {
    return {
      response: onlyDestinationStockGroups
        ? `I found ${destMatch.matched.name} and ${usableSources.map((s) => s.name).join("/")}, but no eligible stock exists in those source locations whose stock group is already carried at ${destMatch.matched.name}${missingNote}. No draft was created.`
        : `I didn't find any stock available at ${usableSources.map((s) => s.name).join(", ")}${missingNote}, so I did not create a transfer draft.`,
      suggestions,
      provider: usedProvider,
    };
  }

  const draftsPayload = ctx.drafts.map((d) => ({
    date: dateStr,
    sourceLocationId: d.sourceLocationId,
    sourceLocationName: d.sourceLocationName,
    destinationLocationId: d.destinationLocationId,
    destinationLocationName: d.destinationLocationName,
    notes: onlyDestinationStockGroups
      ? `Auto-selected using stock groups already carried at ${destMatch.matched!.name}.`
      : undefined,
    optional,
    analysisSummary: ctx.shortfall
      ? `Only ${ctx.achievedQty} eligible bale(s)/item(s) found out of requested ${targetQty}${missingNote}.`
      : missingNote
        ? `Note:${missingNote}.`
        : undefined,
    items: d.items.map((i) => ({
      stockItemId: i.stockItemId,
      stockItemName: i.stockItemName,
      stockItemCode: i.stockItemCode,
      quantity: i.quantity,
      currentStock: i.currentStock,
      destinationQty: i.destinationQty,
      reason: i.reason,
    })),
  }));

  const sourcesLabel = usableSources.map((s) => s.name).join("/");
  const draftWord = draftsPayload.length > 1 ? "drafts" : "draft";
  const responseText = ctx.shortfall
    ? `Only ${ctx.achievedQty} eligible bale(s)/item(s) found out of requested ${targetQty}${missingNote}. I prepared ${optional ? "optional " : ""}stock transfer ${draftWord} for ${destMatch.matched.name} using the available eligible stock from ${sourcesLabel}. Review below.`
    : `I prepared ${optional ? "an optional " : ""}stock transfer ${draftWord} for ${ctx.achievedQty} bale(s)/item(s) from ${sourcesLabel} to ${destMatch.matched.name}${missingNote}. Review below.`;

  if (draftsPayload.length === 1) {
    return { response: responseText, suggestions, provider: usedProvider, stockTransferDraft: draftsPayload[0] };
  }
  return { response: responseText, suggestions, provider: usedProvider, stockTransferDrafts: draftsPayload };
}
