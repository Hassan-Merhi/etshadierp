import { db } from "./db";
import { logger } from "./lib/logger";
import * as schema from "@shared/schema";
import {
  readProjectFile,
  grepProjectFiles,
  listProjectDir,
  extractFilePathsFromMessage,
  extractSearchPattern,
  readProjectFileRaw,
  resolveFilePath,
} from "./lib/codeAgentTools";
import { eq, and, desc, sql, isNull, asc, ilike, or, inArray } from "drizzle-orm";
import {
  buildStockTransferSuggestionContext,
  buildStockTransferByTargetQuantityContext,
  matchLocationByName,
} from "./services/stockTransferAnalysis";

import {
  type AIProvider,
  getSelectedAIProvider,
  getAvailableProviders,
  callAIWithFallback,
} from "./chat/aiProviders";

import { runDataQuery } from "./chat/reports";

import {
  detectSmartProvider,
  RE_VOUCHER,
  RE_STOCK_ADJ,
  RE_STOCK_TRANSFER,
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
} from "./chat/intent";

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
async function tryBuildEarlyMultiSourceTargetTransfer(
  companyId: number,
  userMessage: string,
  suggestions: string[],
  usedProvider: string
): Promise<{
  response: string;
  suggestions: string[];
  provider?: string;
  stockTransferDraft?: any;
  stockTransferDrafts?: any[];
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

import {
  getCachedERPContext,
  type ERPContext,
  type UserPreferences,
} from "./chat/erpContext";
export { getERPContext, clearERPContextCache } from "./chat/erpContext";

import {
  buildSystemPrompt,
  generateQuickSuggestions,
  classifyChatIntent,
  buildGeneralSystemPrompt,
  buildActionSystemPrompt,
  loadToolData,
  buildToolSystemPrompt,
  ACTION_INTENTS,
  TOOL_INTENTS,
} from "./chat/prompts";

export async function chat(
  userMessage: string,
  companyId: number,
  conversationHistory: { role: string; content: string }[] = [],
  userPreferences?: UserPreferences,
  pageContext?: { currentRoute?: string; entityType?: string; entityId?: number; entityName?: string },
  sessionReadFiles?: string[]
): Promise<{
  response: string;
  suggestions: string[];
  provider?: string;
  voucherDraft?: any;
  stockAdjustmentDraft?: any;
  stockTransferDraft?: any;
  stockTransferDrafts?: any[];
  voucherSearchResults?: any[];
  stockItemDraft?: any;
  priceUpdateDraft?: any;
  accountQueryResult?: any;
  verifyContainerDraft?: any;
  dataQueryResult?: any;
  filePatchDrafts?: any[];
  readFiles?: string[];
}> {
  const available = getAvailableProviders();

  if (available.length === 0) {
    return {
      response:
        "AI chatbot is not configured. Please ask an administrator to add at least one AI API key (GEMINI_API_KEY, OPENAI_API_KEY, or XAI_API_KEY).",
      suggestions: [],
    };
  }

  try {
    const chatStart = Date.now();

    // ── Step 1: Classify intent (pure regex, no AI call) ─────────────────
    const intent = classifyChatIntent(userMessage, pageContext);
    const isActionIntent = ACTION_INTENTS.has(intent);
    logger.info(`[ChatService] Intent: ${intent} (action=${isActionIntent})`);

    // ── Step 2: Load ERP context only when needed ─────────────────────────
    let context: ERPContext | null = null;
    let systemPrompt: string;
    let suggestions: string[];

    // Variables populated inside code_read / code_edit branches; used later in
    // the parsing block and return value.
    const codeReadFiles: string[] = []; // files read this request (all code intents)
    const codeEditOriginalMap: Record<string, string> = {}; // file → full original content

    if (intent === "general_knowledge") {
      // General knowledge: skip ERP context entirely, use open-ended ChatGPT-style prompt
      systemPrompt = buildGeneralSystemPrompt();
      suggestions = [
        "Write me a simple HTML calculator app",
        "Explain how machine learning works",
        "What's the latest in AI?",
        "Write a Python script to sort a list",
        "Help me write a professional email",
        "What are the pros and cons of React vs Vue?",
      ];
      logger.info("[ChatService] general_knowledge intent — skipping ERP context");
    } else if (intent === "code_read") {
      // ── Code Read: read project files or grep, inject into system prompt ──────
      const filePaths = extractFilePathsFromMessage(userMessage);
      let codeContext = "";

      if (filePaths.length > 0) {
        for (const raw of filePaths.slice(0, 3)) {
          // Resolve bare filenames (e.g. "chatService.ts") to full workspace-relative paths
          const fp = resolveFilePath(raw) ?? raw;
          try {
            const { content, totalLines, truncated } = await readProjectFile(fp);
            codeContext += `\n\n**File: ${fp}** (${totalLines} lines${truncated ? `, first 300 shown` : ""})\n\`\`\`typescript\n${content}\n\`\`\``;
            if (!codeReadFiles.includes(fp)) codeReadFiles.push(fp);
          } catch (err: any) {
            // Still not found — fall back to grep by base name
            const basename = fp.replace(/.*\//, "").replace(/\.\w+$/, "");
            const grepResult = await grepProjectFiles(basename, ".").catch(() => "(not found)");
            codeContext += `\n\n**File ${fp} not found. Grep results for \`${basename}\`:**\n\`\`\`\n${grepResult}\n\`\`\``;
          }
        }
      } else {
        // No file paths — try grep for keywords
        const pattern = extractSearchPattern(userMessage);
        if (pattern) {
          try {
            const grepResult = await grepProjectFiles(pattern, ".");
            codeContext = `\n\n**Search results for \`${pattern}\`:**\n\`\`\`\n${grepResult}\n\`\`\``;
          } catch (err: any) {
            codeContext = `\n\n**Search error:** ${(err as Error).message}`;
          }
        } else if (/\b(?:list files|ls\b|what files|directory)\b/i.test(userMessage)) {
          const dirMatch = userMessage.match(/\b(server|client|shared|scripts)\/[\w./+-]*/);
          const dir = dirMatch ? dirMatch[0] : ".";
          try {
            const entries = await listProjectDir(dir);
            codeContext = `\n\n**Directory listing for \`${dir}\`:**\n${entries.join("\n")}`;
          } catch (err: any) {
            codeContext = `\n\n**Listing error:** ${(err as Error).message}`;
          }
        }
      }

      systemPrompt = `You are a coding assistant with access to this TypeScript ERP/POS project (React + Express + PostgreSQL). Answer the user's question clearly and concisely about the code.${codeContext}\n\nIf you reference specific parts of the code, use code blocks with the language specified.`;
      suggestions = ["Explain how this works", "Find related files", "Show me all usages"];
      logger.info("[ChatService] code_read intent — loaded file/grep context");
    } else if (intent === "code_edit") {
      // ── Code Edit: load files and build structured output prompt ──────────────
      // Support up to 3 explicitly-named files; fall back to keyword grep for pathless edits.
      const rawPaths = extractFilePathsFromMessage(userMessage);
      const resolvedPaths = rawPaths
        .slice(0, 3)
        .map((p) => resolveFilePath(p) ?? p)
        .filter(Boolean);

      const contentBlocks: string[] = [];

      // Read each explicitly-named file
      for (const fp of resolvedPaths) {
        const alreadyInSession = sessionReadFiles?.includes(fp);
        try {
          const { content, totalLines, truncated } = await readProjectFile(fp);
          const raw = await readProjectFileRaw(fp).catch(() => "");
          codeEditOriginalMap[fp] = raw;
          if (!codeReadFiles.includes(fp)) codeReadFiles.push(fp);
          const note = alreadyInSession ? " *(also seen earlier this session)*" : "";
          contentBlocks.push(
            `Current content of \`${fp}\`${note} (${totalLines} lines${truncated ? ", first 300 shown" : ""}):\n\`\`\`typescript\n${content}\n\`\`\``
          );
          logger.info(`[ChatService] code_edit — read ${fp} (${totalLines} lines${truncated ? ", truncated" : ""})`);
        } catch {
          contentBlocks.push(`File \`${fp}\` does not exist yet — you will be creating it.`);
          if (!codeReadFiles.includes(fp)) codeReadFiles.push(fp);
        }
      }

      // Pathless edit: infer candidate file by grepping message keywords
      if (resolvedPaths.length === 0) {
        const keywords = [
          ...new Set(
            (
              (userMessage.match(
                /\b[A-Z][a-zA-Z]{3,}\b|\b[a-z]{4,}(?:Form|Page|Component|Hook|Route|Schema|Type|Service|Helper|Utils?)\b/g
              ) ?? []) as string[]
            ).concat(
              (userMessage.match(
                /\b(?:voucher|invoice|payment|receipt|stock|pos|purchase|sale|customer|supplier|company|user|auth|chat)\b/gi
              ) ?? []) as string[]
            )
          ),
        ].slice(0, 4);

        let grepResults = "";
        for (const kw of keywords) {
          const result = await grepProjectFiles(kw, "client/src").catch(() => "");
          if (result && result !== "(no matches found)") {
            grepResults += result + "\n";
            break;
          }
        }
        const candidatePaths = [
          ...new Set((grepResults.match(/^([\w/.-]+\.(?:tsx?|jsx?)):/gm) ?? []).map((l) => l.replace(/:$/, ""))),
        ].slice(0, 1);

        for (const fp of candidatePaths) {
          const alreadyInSession = sessionReadFiles?.includes(fp);
          try {
            const { content, totalLines, truncated } = await readProjectFile(fp);
            const raw = await readProjectFileRaw(fp).catch(() => "");
            codeEditOriginalMap[fp] = raw;
            if (!codeReadFiles.includes(fp)) codeReadFiles.push(fp);
            const note = alreadyInSession ? " *(also seen earlier this session)*" : "";
            contentBlocks.push(
              `Current content of \`${fp}\`${note} (${totalLines} lines${truncated ? ", first 300 shown" : ""}):\n\`\`\`typescript\n${content}\n\`\`\``
            );
            logger.info(
              `[ChatService] code_edit (pathless) — inferred ${fp} (${totalLines} lines${truncated ? ", truncated" : ""})`
            );
          } catch {
            /* File might not exist */
          }
        }

        if (candidatePaths.length === 0) {
          contentBlocks.push(
            `No specific file was found. Infer the best file to create or edit and set filePath accordingly.`
          );
        }
      }

      const primaryFilePath = resolvedPaths[0] ?? codeReadFiles[0] ?? "path/to/file.ts";
      const contentSection = contentBlocks.length > 0 ? "\n\n" + contentBlocks.join("\n\n") : "";

      systemPrompt = `You are a senior TypeScript engineer on this ERP/POS project (React 18 + Express + Drizzle ORM + shadcn/ui). You MUST respond with ONLY a valid JSON object — no markdown, no explanation, ONLY raw JSON.

User request: "${userMessage}"${contentSection}

Respond with ONLY JSON in ONE of these two formats:

Single file change:
{"filePath":"...","description":"one-sentence summary","originalContent":"(the exact current file content shown above, or empty string for new files)","newContent":"the complete new file content"}

Multiple file changes (only when edits span more than one file):
{"description":"one-sentence summary of all changes","patches":[{"filePath":"...","description":"...","originalContent":"...","newContent":"..."},...]}

Rules:
- "newContent" must be the COMPLETE file — every line, not just the changed parts
- Preserve all existing imports, exports, and functionality unless explicitly asked to remove something
- Match the existing coding style, indentation (2 spaces), and TypeScript patterns exactly
- If creating a new file, "originalContent" must be ""
- Never truncate newContent — output the entire file even if it is long
- "originalContent" in each patch MUST exactly match what was shown above (required for stale-guard validation)
- Use the multi-file format ONLY when the change genuinely requires editing more than one file`;

      suggestions = ["Apply this change", "Show me the diff", "Explain what changed"];
      logger.info(`[ChatService] code_edit intent — targets: ${codeReadFiles.join(", ") || "(inferred)"}`);
    } else if (isActionIntent) {
      // Action intents: skip the expensive full-context load, use a light prompt
      systemPrompt = buildActionSystemPrompt(intent, pageContext);
      suggestions = [];
      logger.info("[ChatService] Skipping getERPContext for action intent");
    } else if (TOOL_INTENTS.has(intent)) {
      // Tool intents: targeted DB queries, no full ERP context
      const toolStart = Date.now();
      const toolData = await loadToolData(intent, companyId, userMessage);
      logger.info(`[ChatService] Tool data loaded in ${Date.now() - toolStart}ms for intent "${intent}"`);
      systemPrompt = buildToolSystemPrompt(intent, toolData, pageContext);
      suggestions = [];
    } else {
      // General / unclassified: load full cached ERP context
      const ctxStart = Date.now();
      context = await getCachedERPContext(companyId);
      logger.info(`[ChatService] Context ready in ${Date.now() - ctxStart}ms (company ${companyId})`);
      systemPrompt = buildSystemPrompt(context, userPreferences);
      suggestions = generateQuickSuggestions(context);

      // Inject page context into full-context prompt
      if (pageContext?.currentRoute) {
        const pageLines: string[] = [`\n## CURRENT PAGE CONTEXT:`];
        pageLines.push(`- User is currently on route: ${pageContext.currentRoute}`);
        if (pageContext.entityType) pageLines.push(`- Viewing entity type: ${pageContext.entityType}`);
        if (pageContext.entityName) pageLines.push(`- Entity name: ${pageContext.entityName}`);
        if (pageContext.entityId) pageLines.push(`- Entity ID: ${pageContext.entityId}`);
        pageLines.push(
          `Use this context to give more relevant and specific answers (e.g. if they are on the vouchers page, answers about vouchers should be especially specific).`
        );
        systemPrompt = systemPrompt + pageLines.join("\n");
      }
    }

    // Get selected provider; smart-route if the question type has a best-fit AI
    const adminProvider = await getSelectedAIProvider();
    const smartOverride = detectSmartProvider(userMessage, available);
    const selectedProvider = smartOverride ?? adminProvider;
    logger.info(
      `[ChatService] Provider: ${selectedProvider} (smart=${smartOverride ?? "none"}, admin=${adminProvider}), Available: ${available.join(", ")}`
    );

    // ── Early hard-return: deterministic multi-source, target-quantity stock
    // transfer route. Must run BEFORE the generic AI call (and therefore
    // before voucher extraction, account query, and Phase1 data query, which
    // all run after it in the normal flow) — otherwise generic AI text or a
    // stray extraction pass can hijack a fully deterministic stock-transfer
    // request. Returns null (falls through to normal flow) when the message
    // isn't this kind of request, or when it is but the deterministic parser
    // can't confidently resolve it (legacy LLM-assisted extraction handles
    // that case further down).
    const earlyMultiSourceTransfer = await tryBuildEarlyMultiSourceTargetTransfer(
      companyId,
      userMessage,
      suggestions,
      selectedProvider
    );
    if (earlyMultiSourceTransfer) {
      logger.info(`[ChatService] Early deterministic multi-source stock-transfer route handled request; hard-returning.`);
      return earlyMultiSourceTransfer;
    }

    const aiStart = Date.now();
    const { response, usedProvider } = await callAIWithFallback(
      selectedProvider,
      systemPrompt,
      conversationHistory,
      userMessage
    );
    logger.info(`[ChatService] AI call (${usedProvider}) took ${Date.now() - aiStart}ms`);

    // ── Code Edit: parse filePatchDrafts (single or multi-file) from AI JSON ──
    let filePatchDrafts: any[] | undefined = undefined;
    let finalResponse = response;

    if (intent === "code_edit") {
      try {
        const raw = response
          .trim()
          .replace(/^```(?:json)?\n?/, "")
          .replace(/\n?```$/, "")
          .trim();
        if (raw.startsWith("{")) {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.patches) && parsed.patches.length > 0) {
            // Multi-file patches
            filePatchDrafts = parsed.patches
              .filter((p: any) => p.filePath && "newContent" in p)
              .map((p: any) => ({
                filePath: p.filePath,
                description: p.description || parsed.description || "Apply code changes",
                originalContent: p.originalContent ?? codeEditOriginalMap[p.filePath] ?? "",
                newContent: p.newContent ?? "",
              }));
            if (filePatchDrafts && filePatchDrafts.length > 0) {
              const fileList = filePatchDrafts.map((p: any) => `- \`${p.filePath}\``).join("\n");
              finalResponse = `I've prepared changes for **${filePatchDrafts.length} file${filePatchDrafts.length > 1 ? "s" : ""}**.\n\n${parsed.description || "Review the diffs below."}\n\n${fileList}\n\nClick **Apply** on each diff, or **Apply All** to write all changes at once.`;
            }
          } else if (parsed && parsed.filePath && "newContent" in parsed) {
            // Single file patch
            filePatchDrafts = [
              {
                filePath: parsed.filePath,
                description: parsed.description || "Apply code changes",
                originalContent: parsed.originalContent ?? codeEditOriginalMap[parsed.filePath] ?? "",
                newContent: parsed.newContent ?? "",
              },
            ];
            finalResponse = `I've prepared the changes for **\`${parsed.filePath}\`**.\n\n${parsed.description || "Review the diff below and click Apply when you're ready."}\n\nClick **Apply** to write the changes to disk, or **Cancel** to discard.`;
          }
        }
      } catch {
        // AI responded with explanation text — leave finalResponse as-is
      }
    }

    // ── Phase 5b: detect voucher creation intent ──────────────────────────
    // Ask the AI to extract a voucher draft if the message contains creation intent.
    // We do a lightweight structured extraction call only when keywords are found.
    let voucherDraft: any = undefined;

    // Gate on the classified intent, not the raw regex — RE_VOUCHER's generic
    // "transfer ... <digit>" heuristic can match stock-transfer requests too
    // (e.g. "optional stock transfer draft for 410 bales..."). classifyChatIntent
    // already gives stock-transfer signals priority over this voucher heuristic
    // (see RE_STOCK_TRANSFER_EXPLICIT / RE_STOCK_TRANSFER checks), so only run
    // the voucher-extraction LLM call when the message was actually classified
    // as create_voucher. Running it unconditionally let a stray voucher
    // extraction call hijack stock-transfer requests before the deterministic
    // multi-source stock-transfer hard-route further down ever got a chance.
    if (intent === "create_voucher" && RE_VOUCHER.test(userMessage)) {
      try {
        const accts = await db
          .select({
            id: schema.ledgerAccounts.id,
            name: schema.ledgerAccounts.name,
            accountType: schema.ledgerAccounts.accountType,
          })
          .from(schema.ledgerAccounts)
          .where(and(eq(schema.ledgerAccounts.companyId, companyId), isNull(schema.ledgerAccounts.deletedAt)))
          .limit(120);

        const today = new Date().toISOString().slice(0, 10);
        const extractionPrompt = `You are a voucher extraction assistant for an accounting system.
User message: "${userMessage}"
Today's date: ${today}
Available ledger accounts (id:name:type): ${accts.map((a) => `${a.id}:${a.name}:${a.accountType}`).join(" | ")}

RULES:
1. If the user clearly intends to CREATE a payment, receipt, or journal entry, extract the details and respond with ONLY valid JSON (no markdown, no explanation).
2. Match account names FUZZILY — if the user types a partial name (e.g. "cash", "rent", "salary"), find the best matching account from the list above. Always resolve to a real accountId from the list.
3. Use the EXACT description/narration the user provided (any phrase after "for", "re:", "being", or at the end of the message). If none, write a short descriptive one.
4. Voucher type rules and FROM/TO direction:
   - "Payment" = money going OUT. The word "FROM" tells you the SOURCE account (→ CREDIT it, money leaves). The word "TO" tells you the DESTINATION/beneficiary (→ DEBIT it, expense/payable being settled). Example: "pay FROM cash TO Shamas" → Debit Shamas, Credit Cash.
   - "Receipt" = money coming IN. "FROM" = who paid you (→ CREDIT their account, reduces their balance). "TO" = where it lands (→ DEBIT it, e.g. cash/bank). Example: "received FROM customer TO bank" → Debit Bank, Credit Customer.
   - "Journal" = any other adjustment — determine debit/credit from context.
   - NEVER swap these directions. "FROM" is always the credit side for payments, debit side for receipts.
5. Both sides MUST balance: sum of all debits must equal sum of all credits.
6. Date resolution — always output a real YYYY-MM-DD date. Today is ${today} (${new Date().toLocaleDateString("en-US", { weekday: "long" })}). Resolve ALL relative references: "Monday" → the most recent or upcoming Monday, "yesterday" → ${new Date(Date.now() - 86400000).toISOString().slice(0, 10)}, "last week" → approx 7 days ago, "next Friday" → the coming Friday, specific dates like "May 10" → current year. Never leave the date field as a word or relative expression.
7. CALCULATE percentages automatically. If the user says "$20,000 with 2.5% transfer charges", compute: main amount = 20000, charges = 20000 * 0.025 = 500. Create separate entries for each — e.g. one line for the 20000 payment and one line for the 500 charges — each going to the account the user specifies. The credit side (source, e.g. bank) should equal the total (20500). Do the math yourself, never ask the user to calculate.
8. If the user says "optional", "mark as optional", "put as optional", or similar, set "optional": true in the JSON. Otherwise omit it or set false.

Respond with ONLY this JSON shape:
{"type":"Payment"|"Receipt"|"Journal","date":"YYYY-MM-DD","description":"<user's own wording or short description>","optional":false,"entries":[{"accountId":NUMBER,"accountName":"EXACT name from list","debit":NUMBER,"credit":NUMBER}]}

If the intent is unclear or amounts/accounts are too ambiguous to resolve, respond with exactly: null`;

        const extractionResult = await callAIWithFallback(
          selectedProvider,
          extractionPrompt,
          [],
          "Extract voucher or return null"
        );
        const raw = extractionResult.response
          .trim()
          .replace(/```json\n?|```/g, "")
          .trim();
        if (raw !== "null" && raw.startsWith("{")) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.type && parsed.entries && parsed.entries.length >= 2) {
            // Enrich entries with balanceBefore by fetching current account balances
            try {
              for (const entry of parsed.entries) {
                if (entry.accountId) {
                  const balResult = await db.execute(sql`
                    SELECT
                      COALESCE(SUM(CAST(ve.debit_amount AS numeric)), 0) -
                      COALESCE(SUM(CAST(ve.credit_amount AS numeric)), 0) AS net
                    FROM voucher_entries ve
                    JOIN vouchers v ON v.id = ve.voucher_id
                      AND v.deleted_at IS NULL AND v.optional = false
                      AND v.company_id = ${companyId}
                    WHERE ve.ledger_account_id = ${entry.accountId}
                  `);
                  entry.balanceBefore = parseFloat((balResult.rows[0] as any)?.net || "0");
                }
              }
            } catch (_) {}
            voucherDraft = parsed;
          }
        }
      } catch (_) {
        // Extraction failed silently — no voucherDraft
      }
    }

    // ── Stock adjustment detection ─────────────────────────────────────
    let stockAdjustmentDraft: any = undefined;

    if (RE_STOCK_ADJ.test(userMessage)) {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const [items, locs] = await Promise.all([
          db
            .select({ id: schema.stockItems.id, name: schema.stockItems.name, code: schema.stockItems.code })
            .from(schema.stockItems)
            .where(and(eq(schema.stockItems.companyId, companyId), eq(schema.stockItems.active, true)))
            .limit(120),
          db
            .select({ id: schema.locations.id, name: schema.locations.name })
            .from(schema.locations)
            .where(eq(schema.locations.companyId, companyId))
            .limit(30),
        ]);

        const adjPrompt = `You are a stock adjustment extraction assistant.
User message: "${userMessage}"
Today: ${today}
Stock items (id:name:code): ${items.map((i) => `${i.id}:${i.name}:${i.code}`).join(" | ")}
Locations (id:name): ${locs.map((l) => `${l.id}:${l.name}`).join(" | ")}

RULES:
1. Extract a stock adjustment only if the user clearly intends to produce or consume items.
2. Match item names and location names FUZZILY — partial names, abbreviations, and codes all work.
3. The user may mention ANY number of items (one or many). Extract ALL of them into the items array.
4. Each entry has type "PRODUCE" (adding stock) or "CONSUME" (removing stock).
5. Do NOT worry about rate — always set rate: 0. Rates are auto-filled from inventory.
6. Use the user's description/notes if provided.
7. If the user says "optional", set optional: true.
8. Date defaults to today (${today}) if not specified.
9. For each item, pick the best match as stockItemId/stockItemName. ALSO include a "candidates" array of up to 3 plausible matches (best first). Each candidate: {"id":NUMBER,"name":"...","code":"..."}.
10. For location, return up to 3 location candidates: {"id":NUMBER,"name":"..."}.

Respond with ONLY valid JSON (no markdown):
{"date":"YYYY-MM-DD","locationId":NUMBER,"locationName":"...","locationCandidates":[{"id":NUMBER,"name":"..."}],"notes":"...","optional":false,"items":[{"type":"PRODUCE"|"CONSUME","stockItemId":NUMBER,"stockItemName":"...","quantity":NUMBER,"rate":0,"candidates":[{"id":NUMBER,"name":"...","code":"..."}]}]}

If intent is unclear, respond with exactly: null`;

        const adjResult = await callAIWithFallback(
          selectedProvider,
          adjPrompt,
          [],
          "Extract stock adjustment or return null"
        );
        const rawAdj = adjResult.response
          .trim()
          .replace(/```json\n?|```/g, "")
          .trim();
        if (rawAdj !== "null" && rawAdj.startsWith("{")) {
          const parsedAdj = JSON.parse(rawAdj);
          if (parsedAdj && parsedAdj.locationId && parsedAdj.items && parsedAdj.items.length > 0) {
            // Auto-fill rates from inventory averageRate
            const itemIds = parsedAdj.items.map((i: any) => i.stockItemId).filter(Boolean);
            if (itemIds.length > 0) {
              const invRows = await db
                .select({ stockItemId: schema.inventory.stockItemId, averageRate: schema.inventory.averageRate })
                .from(schema.inventory)
                .where(
                  and(eq(schema.inventory.locationId, parsedAdj.locationId), eq(schema.inventory.companyId, companyId))
                );
              const rateMap = new Map(invRows.map((r) => [r.stockItemId, parseFloat(r.averageRate ?? "0")]));
              parsedAdj.items = parsedAdj.items.map((item: any) => ({
                ...item,
                rate: rateMap.get(item.stockItemId) ?? 0,
              }));
            }
            // Enrich items with currentStock and projectedStock
            try {
              if (parsedAdj.locationId) {
                for (const item of parsedAdj.items) {
                  if (item.stockItemId) {
                    const invResult = await db.execute(sql`
                      SELECT COALESCE(SUM(CAST(quantity AS numeric)), 0) AS qty
                      FROM inventory
                      WHERE stock_item_id = ${item.stockItemId}
                        AND location_id = ${parsedAdj.locationId}
                        AND company_id = ${companyId}
                    `);
                    const currentStock = parseFloat((invResult.rows[0] as any)?.qty || "0");
                    item.currentStock = parseFloat(currentStock.toFixed(3));
                    const delta = item.type === "PRODUCE" ? item.quantity : -item.quantity;
                    item.projectedStock = parseFloat((currentStock + delta).toFixed(3));
                  }
                }
              }
            } catch (_) {}
            stockAdjustmentDraft = parsedAdj;
          }
        }
      } catch (_) {
        // Extraction failed silently
      }
    }

    // ── Voucher search by description ─────────────────────────────────
    let voucherSearchResults: any[] | undefined = undefined;

    if (RE_VOUCHER_SEARCH.test(userMessage)) {
      try {
        const termPrompt = `Extract the description search term the user wants to search for in their voucher records.
User message: "${userMessage}"
Return ONLY the search term as plain text (e.g. "rent", "electricity bill", "client ABC"). If no clear term, return null.`;
        const termResult = await callAIWithFallback(selectedProvider, termPrompt, [], "Extract voucher search term");
        const searchTerm = termResult.response
          .trim()
          .replace(/^["']|["']$/g, "")
          .toLowerCase();
        if (searchTerm && searchTerm !== "null" && searchTerm.length > 0) {
          const results = await db
            .select({
              id: schema.vouchers.id,
              voucherNumber: schema.vouchers.voucherNumber,
              voucherType: schema.vouchers.voucherType,
              voucherDate: schema.vouchers.voucherDate,
              description: schema.vouchers.description,
              totalAmount: schema.vouchers.totalAmount,
              optional: schema.vouchers.optional,
            })
            .from(schema.vouchers)
            .where(
              and(
                eq(schema.vouchers.companyId, companyId),
                isNull(schema.vouchers.deletedAt),
                or(
                  ilike(schema.vouchers.description, `%${searchTerm}%`),
                  ilike(schema.vouchers.voucherNumber, `%${searchTerm}%`)
                )
              )
            )
            .orderBy(desc(schema.vouchers.voucherDate))
            .limit(10);
          if (results.length > 0) {
            voucherSearchResults = results;
          }
        }
      } catch (_) {
        // Search failed silently
      }
    }

    // ── New stock item creation ────────────────────────────────────────
    let stockItemDraft: any = undefined;

    if (RE_STOCK_ITEM_CREATE.test(userMessage)) {
      try {
        const groups = await db
          .select({ id: schema.stockGroups.id, name: schema.stockGroups.name })
          .from(schema.stockGroups)
          .where(and(eq(schema.stockGroups.companyId, companyId), eq(schema.stockGroups.active, true)))
          .orderBy(schema.stockGroups.name)
          .limit(60);

        const itemPrompt = `You are a stock item creation assistant.
User message: "${userMessage}"
Available stock groups (id:name): ${groups.map((g) => `${g.id}:${g.name}`).join(" | ")}

Extract the following fields from the user's message:
- name: full item name
- code: item code (short identifier, usually letters/numbers)
- uom: unit of measure (e.g. KG, PCS, MTR, LTR, BOX)
- stockGroupId: best matching group id from the list above (fuzzy match)
- stockGroupName: matching group name

RULES:
1. Match stock group name FUZZILY — abbreviations and partial names are fine.
2. If no group matches, set stockGroupId: null and stockGroupName: "".
3. If code is not mentioned, generate a sensible short code from the name (uppercase, max 8 chars).
4. UOM should be normalized to common abbreviations (KG, PCS, MTR, LTR, BOX, etc.).

Respond with ONLY valid JSON (no markdown):
{"name":"...","code":"...","uom":"...","stockGroupId":NUMBER_OR_NULL,"stockGroupName":"..."}

If the user is not clearly trying to create a stock item, respond with exactly: null`;

        const itemResult = await callAIWithFallback(
          selectedProvider,
          itemPrompt,
          [],
          "Extract stock item creation details"
        );
        const rawItem = itemResult.response
          .trim()
          .replace(/```json\n?|```/g, "")
          .trim();
        if (rawItem !== "null" && rawItem.startsWith("{")) {
          const parsedItem = JSON.parse(rawItem);
          if (parsedItem && parsedItem.name && parsedItem.code && parsedItem.uom) {
            stockItemDraft = {
              name: parsedItem.name,
              code: parsedItem.code.toUpperCase(),
              uom: parsedItem.uom.toUpperCase(),
              stockGroupId: parsedItem.stockGroupId ?? null,
              stockGroupName: parsedItem.stockGroupName ?? "",
              groupCandidates: groups.slice(0, 20).map((g) => ({ id: g.id, name: g.name })),
            };
          }
        }
      } catch (_) {
        // Extraction failed silently
      }
    }

    // ── Price list update ──────────────────────────────────────────────
    let priceUpdateDraft: any = undefined;

    if (RE_PRICE_UPDATE.test(userMessage)) {
      try {
        const [items, masterRows] = await Promise.all([
          db
            .select({ id: schema.stockItems.id, name: schema.stockItems.name, code: schema.stockItems.code })
            .from(schema.stockItems)
            .where(
              and(
                eq(schema.stockItems.companyId, companyId),
                eq(schema.stockItems.active, true),
                isNull(schema.stockItems.deletedAt)
              )
            )
            .limit(120),
          db
            .select({ masterLocationId: schema.locationPriceGroups.masterLocationId })
            .from(schema.locationPriceGroups)
            .where(eq(schema.locationPriceGroups.companyId, companyId)),
        ]);

        const masterIds = [...new Set(masterRows.map((r) => r.masterLocationId))];
        const masterLocations =
          masterIds.length > 0
            ? await db
                .select({ id: schema.locations.id, name: schema.locations.name })
                .from(schema.locations)
                .where(and(eq(schema.locations.companyId, companyId), inArray(schema.locations.id, masterIds)))
            : await db
                .select({ id: schema.locations.id, name: schema.locations.name })
                .from(schema.locations)
                .where(eq(schema.locations.companyId, companyId))
                .limit(20);

        // Fetch follower counts per master for display
        const followerCounts = new Map<number, number>();
        if (masterIds.length > 0) {
          const fRows = await db
            .select({
              masterLocationId: schema.locationPriceGroups.masterLocationId,
              followerLocationId: schema.locationPriceGroups.followerLocationId,
            })
            .from(schema.locationPriceGroups)
            .where(eq(schema.locationPriceGroups.companyId, companyId));
          for (const r of fRows) {
            followerCounts.set(r.masterLocationId, (followerCounts.get(r.masterLocationId) ?? 0) + 1);
          }
        }

        const pricePrompt = `You are a price update extraction assistant.
User message: "${userMessage}"
Stock items (id:name:code): ${items.map((i) => `${i.id}:${i.name}:${i.code}`).join(" | ")}
Price group / master locations (id:name): ${masterLocations.map((l) => `${l.id}:${l.name}`).join(" | ")}

Extract:
- stockItemId: best matching stock item id (fuzzy match on name or code)
- stockItemName: matching item name
- stockItemCode: matching item code
- locationId: best matching master location id (fuzzy match)
- locationName: matching location name
- newPrice: the new selling price as a number

RULES:
1. Match item name/code and location name FUZZILY.
2. newPrice must be a positive number.
3. If the user says "all locations" or doesn't specify a location, pick locationId: null and locationName: "".
4. Also include candidates arrays for disambiguation:
   - itemCandidates: up to 3 item matches [{"id":N,"name":"...","code":"..."}]
   - locationCandidates: up to 3 location matches [{"id":N,"name":"..."}]

Respond with ONLY valid JSON (no markdown):
{"stockItemId":NUMBER,"stockItemName":"...","stockItemCode":"...","locationId":NUMBER_OR_NULL,"locationName":"...","newPrice":NUMBER,"itemCandidates":[...],"locationCandidates":[...]}

If intent is not a price update, respond with exactly: null`;

        const priceResult = await callAIWithFallback(selectedProvider, pricePrompt, [], "Extract price update details");
        const rawPrice = priceResult.response
          .trim()
          .replace(/```json\n?|```/g, "")
          .trim();
        if (rawPrice !== "null" && rawPrice.startsWith("{")) {
          const parsedPrice = JSON.parse(rawPrice);
          if (parsedPrice && parsedPrice.stockItemId && parsedPrice.newPrice > 0) {
            priceUpdateDraft = {
              ...parsedPrice,
              followerCount: parsedPrice.locationId ? (followerCounts.get(parsedPrice.locationId) ?? 0) : 0,
              allLocations: masterLocations.map((l) => ({ id: l.id, name: l.name })),
            };
          }
        }
      } catch (_) {
        // Extraction failed silently
      }
    }

    // ── Account queries: balance / transaction search / balance history ──
    let accountQueryResult: any = undefined;

    if (RE_ACCOUNT_QUERY.test(userMessage)) {
      try {
        const accounts = await db
          .select({
            id: schema.ledgerAccounts.id,
            name: schema.ledgerAccounts.name,
            code: schema.ledgerAccounts.code,
            accountType: schema.ledgerAccounts.accountType,
            openingBalance: schema.ledgerAccounts.openingBalance,
            openingBalanceSide: schema.ledgerAccounts.openingBalanceSide,
          })
          .from(schema.ledgerAccounts)
          .where(
            and(
              eq(schema.ledgerAccounts.companyId, companyId),
              eq(schema.ledgerAccounts.active, true),
              isNull(schema.ledgerAccounts.deletedAt)
            )
          )
          .orderBy(schema.ledgerAccounts.name)
          .limit(150);

        const acctPrompt = `You are an accounts query extraction assistant.
User message: "${userMessage}"
Ledger accounts (id:name:code:type): ${accounts.map((a) => `${a.id}:${a.name}:${a.code}:${a.accountType}`).join(" | ")}

Determine the query type and extract fields:
- queryType: "balance" | "transactions" | "balance_history"
  - "balance": user wants current balance of an account
  - "transactions": user wants to find payments/transactions by description or amount for an account
  - "balance_history": user wants to know when an account had a specific balance amount
- accountId: best matching account id (fuzzy match on name or code)
- accountName: matching account name
- searchTerm: description keyword to search (for transactions queryType, if any)
- searchAmount: specific amount to find (number, for transactions or balance_history queryType, if any)
- targetBalance: the balance amount they are asking about (for balance_history queryType)

RULES:
1. Fuzzy match account names — partial names and abbreviations work.
2. searchTerm, searchAmount, targetBalance are optional — only include if clearly in the message.
3. For "balance" queries: just accountId and accountName are needed.
4. For "transactions": accountId + at least one of searchTerm or searchAmount.
5. For "balance_history": accountId + targetBalance.

Respond with ONLY valid JSON (no markdown):
{"queryType":"balance"|"transactions"|"balance_history","accountId":NUMBER,"accountName":"...","searchTerm":"...","searchAmount":NUMBER_OR_NULL,"targetBalance":NUMBER_OR_NULL}

If intent is not about an account query, respond with exactly: null`;

        const acctResult = await callAIWithFallback(selectedProvider, acctPrompt, [], "Extract account query");
        const rawAcct = acctResult.response
          .trim()
          .replace(/```json\n?|```/g, "")
          .trim();

        if (rawAcct !== "null" && rawAcct.startsWith("{")) {
          const parsed = JSON.parse(rawAcct);
          if (parsed && parsed.accountId && parsed.queryType) {
            const acct = accounts.find((a) => a.id === parsed.accountId);
            if (!acct) throw new Error("Account not found");

            if (parsed.queryType === "balance") {
              // Compute current balance from voucher entries
              const rows = await db
                .select({
                  totalDebit: sql<string>`COALESCE(SUM(CAST(${schema.voucherEntries.debitAmount} AS numeric)), 0)`,
                  totalCredit: sql<string>`COALESCE(SUM(CAST(${schema.voucherEntries.creditAmount} AS numeric)), 0)`,
                })
                .from(schema.voucherEntries)
                .innerJoin(
                  schema.vouchers,
                  and(
                    eq(schema.voucherEntries.voucherId, schema.vouchers.id),
                    eq(schema.vouchers.optional, false),
                    isNull(schema.vouchers.deletedAt)
                  )
                )
                .where(eq(schema.voucherEntries.ledgerAccountId, parsed.accountId));

              const dr = parseFloat(rows[0]?.totalDebit || "0");
              const cr = parseFloat(rows[0]?.totalCredit || "0");
              const ob = parseFloat(acct.openingBalance || "0");
              const obSide = acct.openingBalanceSide || "Dr";
              const balance = (obSide === "Cr" ? -ob : ob) + dr - cr;
              accountQueryResult = {
                queryType: "balance",
                accountId: parsed.accountId,
                accountName: acct.name,
                balance: parseFloat(balance.toFixed(2)),
              };
            } else if (parsed.queryType === "transactions") {
              // Search transactions by description and/or amount
              const conditions: any[] = [
                eq(schema.voucherEntries.ledgerAccountId, parsed.accountId),
                eq(schema.vouchers.optional, false),
                isNull(schema.vouchers.deletedAt),
              ];
              if (parsed.searchTerm) {
                conditions.push(
                  or(
                    ilike(schema.vouchers.description, `%${parsed.searchTerm}%`),
                    ilike(schema.voucherEntries.narration, `%${parsed.searchTerm}%`),
                    ilike(schema.vouchers.voucherNumber, `%${parsed.searchTerm}%`)
                  )
                );
              }
              if (parsed.searchAmount) {
                const amt = String(parseFloat(parsed.searchAmount).toFixed(2));
                conditions.push(
                  or(
                    sql`CAST(${schema.voucherEntries.debitAmount} AS numeric) = ${parseFloat(amt)}`,
                    sql`CAST(${schema.voucherEntries.creditAmount} AS numeric) = ${parseFloat(amt)}`,
                    sql`CAST(${schema.vouchers.totalAmount} AS numeric) = ${parseFloat(amt)}`
                  )
                );
              }
              const txRows = await db
                .select({
                  voucherId: schema.voucherEntries.voucherId,
                  voucherNumber: schema.vouchers.voucherNumber,
                  voucherType: schema.vouchers.voucherType,
                  voucherDate: schema.vouchers.voucherDate,
                  description: schema.vouchers.description,
                  narration: schema.voucherEntries.narration,
                  debitAmount: schema.voucherEntries.debitAmount,
                  creditAmount: schema.voucherEntries.creditAmount,
                  totalAmount: schema.vouchers.totalAmount,
                })
                .from(schema.voucherEntries)
                .innerJoin(schema.vouchers, and(eq(schema.voucherEntries.voucherId, schema.vouchers.id)))
                .where(and(...conditions))
                .orderBy(desc(schema.vouchers.voucherDate))
                .limit(10);

              accountQueryResult = {
                queryType: "transactions",
                accountId: parsed.accountId,
                accountName: acct.name,
                searchTerm: parsed.searchTerm,
                searchAmount: parsed.searchAmount,
                transactions: txRows,
              };
            } else if (parsed.queryType === "balance_history") {
              // Get all transactions sorted by date, compute running balance, find when it crossed target
              const allRows = await db
                .select({
                  voucherId: schema.voucherEntries.voucherId,
                  voucherNumber: schema.vouchers.voucherNumber,
                  voucherType: schema.vouchers.voucherType,
                  voucherDate: schema.vouchers.voucherDate,
                  description: schema.vouchers.description,
                  debitAmount: schema.voucherEntries.debitAmount,
                  creditAmount: schema.voucherEntries.creditAmount,
                })
                .from(schema.voucherEntries)
                .innerJoin(
                  schema.vouchers,
                  and(
                    eq(schema.voucherEntries.voucherId, schema.vouchers.id),
                    eq(schema.vouchers.optional, false),
                    isNull(schema.vouchers.deletedAt)
                  )
                )
                .where(eq(schema.voucherEntries.ledgerAccountId, parsed.accountId))
                .orderBy(asc(schema.vouchers.voucherDate));

              const ob = parseFloat(acct.openingBalance || "0");
              const obSide = acct.openingBalanceSide || "Dr";
              let running = obSide === "Cr" ? -ob : ob;
              const target = parseFloat(parsed.targetBalance);
              const tolerance = Math.max(Math.abs(target) * 0.01, 1); // 1% or ±1

              const matches: any[] = [];
              for (const row of allRows) {
                running += parseFloat(row.debitAmount || "0") - parseFloat(row.creditAmount || "0");
                if (Math.abs(running - target) <= tolerance) {
                  matches.push({ ...row, balanceAfter: parseFloat(running.toFixed(2)) });
                  if (matches.length >= 5) break;
                }
              }
              accountQueryResult = {
                queryType: "balance_history",
                accountId: parsed.accountId,
                accountName: acct.name,
                targetBalance: target,
                matches,
              };
            }
          }
        }
      } catch (_) {
        // Account query failed silently
      }
    }

    // ── Stock transfer detection ───────────────────────────────────────
    let stockTransferDraft: any = undefined;
    let stockTransferDrafts: any[] | undefined = undefined;
    // When set, this is used verbatim as the assistant's text response for the
    // stock-transfer flow, bypassing the generic "prepared a draft" acknowledgement
    // prompt — guarantees we never claim a draft exists when it doesn't.
    let stockTransferResponseOverride: string | undefined = undefined;
    // Deterministic multi-source/target-quantity signal: an explicit
    // "Hadi 1, Hadi 2, ..." source list, or an explicit quantity ("410 bales")
    // combined with "same stock group" filtering language. This is specific
    // enough on its own to imply transfer intent even when the message never
    // uses the literal words "stock"/"item"/"inventory" (e.g. "optional
    // transfer draft for 410 bales to Kolwezi from Hadi 1, Hadi 2, ...").
    const hasMultiSourceQtySignal =
      RE_MULTI_SOURCE_LOCATIONS.test(userMessage) ||
      (RE_TARGET_QTY_HINT.test(userMessage) && RE_STOCK_GROUP_FILTER_HINT.test(userMessage));
    const isMultiSourceTargetQtyRequest =
      (RE_STOCK_TRANSFER.test(userMessage) || hasMultiSourceQtySignal) &&
      !RE_STOCK_TRANSFER_ANALYSIS_STRICT.test(userMessage) &&
      hasMultiSourceQtySignal;

    if (
      (RE_STOCK_TRANSFER.test(userMessage) ||
        RE_STOCK_TRANSFER_ANALYSIS.test(userMessage) ||
        isMultiSourceTargetQtyRequest) &&
      !voucherDraft &&
      !stockAdjustmentDraft
    ) {
      try {
        // The deterministic multi-source/target-quantity builder takes priority
        // over the looser analysis match — a request can say "optional stock
        // transfer" (matching RE_STOCK_TRANSFER_ANALYSIS) while also giving an
        // explicit quantity and named sources, which must go through the
        // deterministic path, not the AI-suggestion analysis path.
        if (RE_STOCK_TRANSFER_ANALYSIS.test(userMessage) && !isMultiSourceTargetQtyRequest) {
          // ── AI-suggested OPTIONAL stock transfer (data-driven analysis) ──
          // The LLM only classifies intent + picks locations/date range/aggressiveness.
          // All quantities/numbers come from buildStockTransferSuggestionContext (real SQL).
          const locRows = await db
            .select({ id: schema.locations.id, name: schema.locations.name, code: schema.locations.code })
            .from(schema.locations)
            .where(and(eq(schema.locations.companyId, companyId), isNull(schema.locations.deletedAt)))
            .limit(50);

          const today = new Date().toISOString().slice(0, 10);
          const analysisPrompt = `You are a stock-transfer analysis request parser.
User message: "${userMessage}"
Today: ${today}
Locations (id:name:code): ${locRows.map((l) => `${l.id}:${l.name}:${l.code}`).join(" | ")}

RULES:
1. Extract the source location name and destination location name exactly as the user referred to them (fuzzy match to the list above by NAME, do not invent an id yourself).
2. Extract a lookback window in days if mentioned ("last 7 days" -> 7, "last 30 days" -> 30, "this month" -> use days from the 1st of this month to today). Default to 30 if not mentioned.
3. Extract aggressiveness if mentioned: "aggressive"/"fast"/"more" -> "aggressive", "conservative"/"safe"/"careful" -> "conservative", otherwise "normal".
4. If the user did not name two distinct locations, respond with exactly: null

Respond with ONLY valid JSON (no markdown):
{"sourceLocationName":"...","destinationLocationName":"...","days":NUMBER,"aggressiveness":"conservative"|"normal"|"aggressive"}

If this is not a two-location stock-transfer analysis request, respond with exactly: null`;

          const analysisResult = await callAIWithFallback(
            selectedProvider,
            analysisPrompt,
            [],
            "Extract stock transfer analysis parameters or return null"
          );
          const rawAnalysis = analysisResult.response
            .trim()
            .replace(/```json\n?|```/g, "")
            .trim();

          if (rawAnalysis !== "null" && rawAnalysis.startsWith("{")) {
            const parsedAnalysis = JSON.parse(rawAnalysis);
            const sourceMatch = await matchLocationByName(companyId, parsedAnalysis.sourceLocationName || "");
            const destMatch = await matchLocationByName(companyId, parsedAnalysis.destinationLocationName || "");

            if (sourceMatch.candidates.length > 1 || destMatch.candidates.length > 1) {
              // Ambiguous location name(s) — never guess silently.
              const ambiguous = sourceMatch.candidates.length > 1 ? sourceMatch.candidates : destMatch.candidates;
              stockTransferDraft = {
                date: today,
                sourceLocationId: sourceMatch.matched?.id || 0,
                sourceLocationName: sourceMatch.matched?.name || parsedAnalysis.sourceLocationName || "",
                destinationLocationId: destMatch.matched?.id || 0,
                destinationLocationName: destMatch.matched?.name || parsedAnalysis.destinationLocationName || "",
                items: [],
                locationCandidates: ambiguous.map((c) => ({ id: c.id, name: `${c.name} (${c.code})` })),
                optional: true,
                analysisSummary:
                  "Multiple locations matched that name. Please pick the correct one before I can analyze.",
              };
            } else if (sourceMatch.matched && destMatch.matched) {
              const days = Math.min(365, Math.max(1, Number(parsedAnalysis.days) || 30));
              const dateTo = today;
              const dateFromObj = new Date();
              dateFromObj.setDate(dateFromObj.getDate() - (days - 1));
              const dateFrom = dateFromObj.toISOString().slice(0, 10);
              const aggressiveness: "conservative" | "normal" | "aggressive" = [
                "conservative",
                "normal",
                "aggressive",
              ].includes(parsedAnalysis.aggressiveness)
                ? parsedAnalysis.aggressiveness
                : "normal";

              const ctx = await buildStockTransferSuggestionContext(
                companyId,
                sourceMatch.matched.id,
                destMatch.matched.id,
                dateFrom,
                dateTo,
                { aggressiveness }
              );

              stockTransferDraft = {
                date: today,
                sourceLocationId: ctx.sourceLocationId,
                sourceLocationName: ctx.sourceLocationName,
                destinationLocationId: ctx.destinationLocationId,
                destinationLocationName: ctx.destinationLocationName,
                notes: `AI-suggested optional transfer based on sales/stock analysis (${ctx.dateFrom} to ${ctx.dateTo}).`,
                optional: true,
                analysisSummary: ctx.analysisSummary,
                analysisDateRange: { from: ctx.dateFrom, to: ctx.dateTo },
                aggressiveness: ctx.aggressiveness,
                comparedLocations: `${ctx.sourceLocationName} → ${ctx.destinationLocationName}`,
                oldTransferSummary: ctx.oldTransferSummary,
                items: ctx.items.map((i) => ({
                  stockItemId: i.stockItemId,
                  stockItemName: i.stockItemName,
                  stockItemCode: i.stockItemCode,
                  quantity: i.suggestedQty,
                  currentStock: i.sourceQty,
                  sourceQty: i.sourceQty,
                  destinationQty: i.destinationQty,
                  sourceSalesQty: i.sourceSalesQty,
                  destinationSalesQty: i.destinationSalesQty,
                  sourceSalesRate: i.sourceSalesRate,
                  destinationSalesRate: i.destinationSalesRate,
                  otwQty: i.otwQty,
                  otwDetails: i.otwDetails,
                  otwSummary: i.otwSummary,
                  suggestedQty: i.suggestedQty,
                  reason: i.reason,
                  confidence: i.confidence,
                  oldTransferSummary: i.oldTransferSummary,
                  previousTransferQty: i.previousTransferQty,
                  previousTransferCount: i.previousTransferCount,
                  lastTransferDate: i.lastTransferDate || undefined,
                })),
              };
            }
          }
        } else if (isMultiSourceTargetQtyRequest) {
          // ── Multi-source, target-quantity transfer (e.g. "410 bales to Kolwezi
          // from Hadi 1,2,3,4, only stock groups Kolwezi already has") ──
          // The LLM only extracts location names/quantity/flags as TEXT; every
          // item/quantity in the resulting draft(s) comes from
          // buildStockTransferByTargetQuantityContext (real SQL) — never invented.
          const locRows = await db
            .select({ id: schema.locations.id, name: schema.locations.name, code: schema.locations.code })
            .from(schema.locations)
            .where(and(eq(schema.locations.companyId, companyId), isNull(schema.locations.deletedAt)))
            .limit(80);

          const today = new Date().toISOString().slice(0, 10);

          // ── Deterministic pass first — grounded in the real location list. ──
          const deterministic = deterministicParseMultiSourceTransfer(userMessage, locRows);

          let destinationName: string | undefined;
          let sourceNames: string[] = [];
          let targetQty: number | undefined;
          let optional = false;
          let onlyDestinationStockGroups = true;
          let dateStr = today;
          let haveParsedParams = false;

          if (deterministic) {
            destinationName = deterministic.destinationName;
            sourceNames = deterministic.sourceNames;
            targetQty = deterministic.targetQty;
            optional = deterministic.optional;
            onlyDestinationStockGroups = RE_STOCK_GROUP_FILTER_HINT.test(userMessage) || onlyDestinationStockGroups;
            haveParsedParams = true;
          } else {
            const multiPrompt = `You are a stock-transfer request parser for a request that targets a TOTAL QUANTITY across possibly MULTIPLE source locations (not a fixed item list).
User message: "${userMessage}"
Today: ${today}
Locations (id:name:code): ${locRows.map((l) => `${l.id}:${l.name}:${l.code}`).join(" | ")}

RULES:
1. Extract destinationLocationName exactly as the user referred to it (e.g. "Kolwezi"). Do not guess between similarly-named locations (e.g. "Kolwezi" vs "Kolwezi 2") — just report the name the user typed.
2. Extract ALL source location names, expanding any shorthand into a full array. "Hadi 1,2,3,4" -> ["Hadi 1","Hadi 2","Hadi 3","Hadi 4"]. "Hadi 1-4" -> ["Hadi 1","Hadi 2","Hadi 3","Hadi 4"]. Match against the locations list by NAME text only, do not invent ids.
3. Extract targetQty: a whole number of bales/items/units the user wants transferred in TOTAL. If no number is mentioned, use null.
4. Extract optional: true if the user says "optional", otherwise false.
5. Extract date: default to today (${today}) if not specified.
6. Extract onlyDestinationStockGroups: true if the user says things like "only use the same stock groups it already has" / "don't mix X with Y" / similar filtering language. Default true if unclear.

Respond with ONLY valid JSON (no markdown):
{"destinationLocationName":"...","sourceLocationNames":["..."],"targetQty":NUMBER_OR_NULL,"optional":BOOLEAN,"date":"YYYY-MM-DD","onlyDestinationStockGroups":BOOLEAN}

If this is not this kind of quantity-target multi-source transfer request, respond with exactly: null`;

            const multiResult = await callAIWithFallback(
              selectedProvider,
              multiPrompt,
              [],
              "Extract multi-source target-quantity stock transfer parameters or return null"
            );
            const rawMulti = multiResult.response
              .trim()
              .replace(/```json\n?|```/g, "")
              .trim();

            if (rawMulti !== "null" && rawMulti.startsWith("{")) {
              const parsedMulti = JSON.parse(rawMulti);
              destinationName = parsedMulti.destinationLocationName || "";
              sourceNames = Array.isArray(parsedMulti.sourceLocationNames)
                ? parsedMulti.sourceLocationNames.filter((n: any) => typeof n === "string" && n.trim())
                : [];
              targetQty =
                Number.isFinite(Number(parsedMulti.targetQty)) && Number(parsedMulti.targetQty) > 0
                  ? Math.floor(Number(parsedMulti.targetQty))
                  : undefined;
              optional = parsedMulti.optional === true;
              onlyDestinationStockGroups = parsedMulti.onlyDestinationStockGroups !== false;
              dateStr = parsedMulti.date || today;
              haveParsedParams = true;
            }
          }

          if (haveParsedParams) {
            destinationName = destinationName || "";

            // Destination must match STRICTLY — never silently pick "Kolwezi 2" for "Kolwezi".
            const destMatch = await matchLocationByName(companyId, destinationName, { strict: true });

            if (!destinationName) {
              stockTransferResponseOverride =
                "I need a destination location to build this transfer — which location should receive the stock?";
            } else if (!destMatch.matched && destMatch.candidates.length > 0) {
              stockTransferDraft = {
                date: dateStr,
                sourceLocationId: 0,
                sourceLocationName: sourceNames.join(", "),
                destinationLocationId: 0,
                destinationLocationName: destinationName,
                items: [],
                locationCandidates: destMatch.candidates.map((c) => ({ id: c.id, name: `${c.name} (${c.code})` })),
                optional,
              };
              stockTransferResponseOverride = `"${destinationName}" matches more than one location. Please tell me exactly which one you mean before I build the transfer.`;
            } else if (!destMatch.matched) {
              stockTransferResponseOverride = `I couldn't find a location matching "${destinationName}". Please give the exact destination location name.`;
            } else if (sourceNames.length === 0) {
              stockTransferResponseOverride = `Which source location(s) should I pull stock from for the transfer to ${destMatch.matched.name}?`;
            } else if (!targetQty) {
              stockTransferResponseOverride = `How many bales/items in total would you like transferred to ${destMatch.matched.name}?`;
            } else {
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
                stockTransferResponseOverride = `I couldn't find any of the source locations you mentioned (${sourceNames.join(", ")}). Please give the exact source location name(s).`;
              } else if (usableSources.length === 0) {
                stockTransferResponseOverride = `The source location(s) you gave (${sameAsDestination.map((s) => s.name).join(", ")}) are the same as the destination (${destMatch.matched.name}) — please give different source location(s) to transfer from.`;
              } else {
                const ctx = await buildStockTransferByTargetQuantityContext(
                  companyId,
                  usableSources.map((s) => s.id),
                  destMatch.matched.id,
                  targetQty,
                  { onlyDestinationStockGroups }
                );

                const missingNote =
                  unresolvedSources.length > 0
                    ? ` (couldn't find: ${unresolvedSources.join(", ")})`
                    : "";

                if (ctx.noEligibleStock) {
                  stockTransferResponseOverride = onlyDestinationStockGroups
                    ? `I didn't find any eligible stock at ${usableSources.map((s) => s.name).join(", ")}${missingNote} in stock groups already carried at ${destMatch.matched.name}, so I did not create a transfer draft.`
                    : `I didn't find any stock available at ${usableSources.map((s) => s.name).join(", ")}${missingNote}, so I did not create a transfer draft.`;
                } else {
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

                  if (draftsPayload.length === 1) {
                    stockTransferDraft = draftsPayload[0];
                  } else {
                    stockTransferDrafts = draftsPayload;
                  }

                  const sourcesLabel = usableSources.map((s) => s.name).join("/");
                  const draftWord = draftsPayload.length > 1 ? "drafts" : "draft";
                  stockTransferResponseOverride = ctx.shortfall
                    ? `Only ${ctx.achievedQty} eligible bale(s)/item(s) found out of requested ${targetQty}${missingNote}. I prepared ${optional ? "optional " : ""}stock transfer ${draftWord} for ${destMatch.matched.name} using the available eligible stock from ${sourcesLabel}. Review below.`
                    : `I prepared ${optional ? "an optional " : ""}stock transfer ${draftWord} for ${ctx.achievedQty} bale(s)/item(s) from ${sourcesLabel} to ${destMatch.matched.name}${missingNote}. Review below.`;
                }
              }
            }
          } else {
            stockTransferResponseOverride =
              "I couldn't tell which destination, source location(s), and total quantity you want for this transfer. Could you restate it, e.g. \"transfer 410 bales to Kolwezi from Hadi 1,2,3,4\"?";
          }
        } else {
          const [items, locs] = await Promise.all([
          db
            .select({ id: schema.stockItems.id, name: schema.stockItems.name, code: schema.stockItems.code })
            .from(schema.stockItems)
            .where(and(eq(schema.stockItems.companyId, companyId), eq(schema.stockItems.active, true)))
            .limit(120),
          db
            .select({ id: schema.locations.id, name: schema.locations.name })
            .from(schema.locations)
            .where(eq(schema.locations.companyId, companyId))
            .limit(30),
        ]);

        const today = new Date().toISOString().slice(0, 10);
        const transferPrompt = `You are a stock transfer extraction assistant.
User message: "${userMessage}"
Today: ${today}
Stock items (id:name:code): ${items.map((i) => `${i.id}:${i.name}:${i.code}`).join(" | ")}
Locations (id:name): ${locs.map((l) => `${l.id}:${l.name}`).join(" | ")}

RULES:
1. Extract a stock transfer only if the user clearly wants to move/transfer stock between locations.
2. Match item names and location names FUZZILY.
3. Extract one source location, one destination location, and a list of items with quantities.
4. Date defaults to today (${today}) if not specified.
5. Also include candidates arrays for disambiguation.

Respond with ONLY valid JSON (no markdown):
{"date":"YYYY-MM-DD","sourceLocationId":NUMBER,"sourceLocationName":"...","destinationLocationId":NUMBER,"destinationLocationName":"...","notes":"...","items":[{"stockItemId":NUMBER,"stockItemName":"...","quantity":NUMBER,"candidates":[{"id":NUMBER,"name":"...","code":"..."}]}],"locationCandidates":[{"id":NUMBER,"name":"..."}]}

If intent is unclear or this is not a stock transfer request, respond with exactly: null`;

        const tfResult = await callAIWithFallback(
          selectedProvider,
          transferPrompt,
          [],
          "Extract stock transfer or return null"
        );
        const rawTf = tfResult.response
          .trim()
          .replace(/```json\n?|```/g, "")
          .trim();
        if (rawTf !== "null" && rawTf.startsWith("{")) {
          const parsedTf = JSON.parse(rawTf);
          if (parsedTf && parsedTf.sourceLocationId && parsedTf.destinationLocationId && parsedTf.items?.length > 0) {
            // Enrich with currentStock
            for (const item of parsedTf.items) {
              if (item.stockItemId && parsedTf.sourceLocationId) {
                const invResult = await db.execute(sql`
                  SELECT COALESCE(SUM(CAST(quantity AS numeric)), 0) AS qty
                  FROM inventory
                  WHERE stock_item_id = ${item.stockItemId}
                    AND location_id = ${parsedTf.sourceLocationId}
                    AND company_id = ${companyId}
                `);
                item.currentStock = parseFloat((invResult.rows[0] as any)?.qty || "0");
              }
            }
            stockTransferDraft = parsedTf;
          }
        }
        }

        // ── Anti-hallucination guard: never let the assistant claim a draft
        // was prepared unless one was actually built above. ────────────────
        if (!stockTransferResponseOverride) {
          if (
            stockTransferDraft &&
            Array.isArray(stockTransferDraft.locationCandidates) &&
            stockTransferDraft.locationCandidates.length > 0 &&
            (!stockTransferDraft.items || stockTransferDraft.items.length === 0)
          ) {
            stockTransferResponseOverride =
              stockTransferDraft.analysisSummary ||
              "That location name matches more than one location. Please tell me exactly which one you mean.";
          } else if (
            !stockTransferDraft &&
            (!stockTransferDrafts || stockTransferDrafts.length === 0)
          ) {
            stockTransferResponseOverride =
              "I wasn't able to build a stock transfer draft from that — please tell me the exact source location, destination location, and which item(s)/quantities (or a total target quantity) to move.";
          }
        }
      } catch (_) {
        // Extraction failed silently
        if (!stockTransferResponseOverride && !stockTransferDraft && (!stockTransferDrafts || stockTransferDrafts.length === 0)) {
          stockTransferResponseOverride =
            "I wasn't able to build a stock transfer draft from that — please tell me the exact source location, destination location, and which item(s)/quantities (or a total target quantity) to move.";
        }
      }
    }

    // `stockTransferResponseOverride` is only ever assigned inside the
    // stock-transfer extraction block above, so applying it here is safe
    // regardless of `classifyChatIntent`'s result — this guards against the
    // LLM's free-text response claiming a draft was prepared when the
    // deterministic/backend logic actually found none (or a different
    // outcome), which previously only applied when intent happened to equal
    // "create_stock_transfer".
    if (stockTransferResponseOverride) {
      finalResponse = stockTransferResponseOverride;
    }

    // ── Verify Container Excel detection ──────────────────────────────
    const VERIFY_CONTAINER_KEYWORDS =
      /\b(verif(y|ication)|container\s+verif|verif.*container|verification\s+excel|excel.*verif|download.*verif|container.*excel)\b/i;
    let verifyContainerDraft: any = undefined;

    if (VERIFY_CONTAINER_KEYWORDS.test(userMessage)) {
      try {
        // Try to extract a container number from the message
        const containerNumMatch =
          userMessage.match(/container\s+(?:no\.?\s*|number\s+|#\s*)?["']?([A-Z0-9][A-Z0-9\-\/]{3,25})["']?/i) ||
          userMessage.match(/\b([A-Z]{4}\d{6,7})\b/) ||
          userMessage.match(/\bfor\s+["']?([A-Z0-9][A-Z0-9\-]{4,20})["']?\s*(?:$|\s)/i);

        const containerNumber = containerNumMatch ? containerNumMatch[1].toUpperCase() : null;

        if (containerNumber) {
          const [container] = await db
            .select({
              id: schema.containers.id,
              containerNumber: schema.containers.containerNumber,
              supplierId: schema.containers.supplierId,
            })
            .from(schema.containers)
            .where(
              and(eq(schema.containers.companyId, companyId), ilike(schema.containers.containerNumber, containerNumber))
            )
            .limit(1);

          if (container) {
            const [proformas, supplierRow] = await Promise.all([
              db
                .select({ id: schema.supplierProformas.id, reference: schema.supplierProformas.reference })
                .from(schema.supplierProformas)
                .where(
                  and(
                    eq(schema.supplierProformas.companyId, companyId),
                    eq(schema.supplierProformas.supplierId, container.supplierId)
                  )
                )
                .orderBy(desc(schema.supplierProformas.createdAt)),
              db
                .select({ name: schema.suppliers.legalName })
                .from(schema.suppliers)
                .where(eq(schema.suppliers.id, container.supplierId))
                .limit(1),
            ]);

            verifyContainerDraft = {
              containerNumber: container.containerNumber,
              containerId: container.id,
              supplierId: container.supplierId,
              supplierName: supplierRow[0]?.name || "",
              proformas,
            };
          }
        }
      } catch (_) {
        // Failed silently
      }
    }

    // ── Phase 1: Data Query Handler ───────────────────────────────────────────
    // Handles read-only ERP data queries: P&L, cash position, statements, etc.
    const PHASE1_KEYWORDS =
      /profit.{0,15}loss|p&l\b|pl\b.{0,10}report|balance.{0,8}sheet|cash.{0,12}(balance|position|account)|who.{0,20}owe[ds]?|overdue|outstanding.{0,15}(balance|amount|supplier)|customer.{0,15}statement|supplier.{0,15}statement|top.{0,10}(customer|buyer)s?|worker.{0,12}attend|how many.{0,20}(absent|present|worker)|bale.{0,12}(produc|today|week|this|last)|produc.{0,12}bale|how many bale|container.{0,12}status|where.{0,12}(is.{0,5})?container|pending.{0,10}offload|not.{0,10}offload|how much.{0,20}(stock|do we have|in stock)|stock.{0,10}(level|balance|position)|inventory.{0,10}(level|check|status)|low.{0,10}stock|below.{0,10}reorder|reorder.{0,10}level|stock.{0,10}movement|stock.{0,10}histor|movement.{0,10}(for|of).{0,20}\w|open.{0,10}(purchase order|po\b|p\.o\.)|pending.{0,10}(po\b|purchase)|aging|age.{0,10}(report|analysis)|receivable|payable.{0,10}(aging|due)|container.{0,10}list|all container|month.{0,10}(comparison|vs|versus|compare)|last month vs|rental.{0,10}(summary|report|occupan)|occupan|tenant|rent.{0,10}(due|overdue|collect)|payroll.{0,10}(summary|total|report)|total.{0,10}payroll|salary.{0,10}(total|summary)|sales.{0,10}(analys|by item|report|revenue)|how much.{0,15}(did we sell|sold)|top.{0,10}(sell|item|product)|best.{0,10}(sell|item)|container.{0,10}profit|profit.{0,10}per container|how much.{0,15}profit.{0,15}container|stock.{0,10}valuat|inventory.{0,10}value|total.{0,10}inventory.{0,10}(value|worth)|expense.{0,10}(break|categ|by type)|top.{0,10}expense|where.{0,20}money.{0,10}(going|spent)|customer.{0,10}order.{0,10}status|order.{0,10}(pending|draft|verified|finalized|loading)|credit.{0,10}note|recent.{0,10}credit|bank.{0,10}(transaction|movement|histor)|cash.{0,10}(transaction|movement|histor)|recent.{0,10}(payment|receipt|bank)|fixed.{0,10}asset|asset.{0,10}(list|register|summar)|kpi|factory.{0,10}(kpi|performance|daily)|daily.{0,10}(production|output)|efficiency|pos.{0,10}(sale|revenue|summary)|point.{0,10}of.{0,10}sale|shop.{0,10}sale|intercompany|inter.{0,10}company.{0,10}transfer|money.{0,10}(moved|transferred).{0,15}between|offload.{0,10}detail|what.{0,15}(was|were).{0,10}offload|what.{0,10}(arrive|came).{0,15}(in|container)|worker.{0,10}(product|rank|top|best)|top.{0,10}worker|best.{0,10}worker|supplier.{0,10}(spend|history|bought|purchase.{0,10}from)|how much.{0,15}(bought|spend).{0,10}(from|supplier)|upcoming.{0,10}(arrival|container|shipment)|container.{0,10}(arriving|due|expected)|waste.{0,10}(analys|report|trend|summary)|factory.{0,10}waste|customer.{0,10}(payment.{0,10}histor|paid|receipt)|when.{0,10}did.{0,15}pay|voucher.{0,10}(summary|count|by type|breakdown)|how many.{0,10}voucher|stock.{0,10}by.{0,10}location|per.{0,10}location.{0,10}stock|location.{0,10}stock|trial.{0,5}balance|all.{0,10}account.{0,10}balance|balance.{0,10}(of all|per account)|po.{0,10}(detail|line|item)|purchase.{0,10}order.{0,10}(detail|items|break)|what.{0,10}(is|was).{0,10}in.{0,10}(the.{0,5})?po|container.{0,10}(cost|charge|break)|cost.{0,10}break.{0,10}(of|for).{0,10}container|document.{0,10}expir|visa.{0,10}expir|permit.{0,10}expir|worker.{0,10}(doc|expir)|stock.{0,10}transfer|transfer.{0,10}(between|from.{0,10}to).{0,10}(location|warehouse)|move.{0,10}stock|cash.{0,10}flow|money.{0,10}(in|out).{0,10}(this|last|for)|inflow.{0,10}outflow|account.{0,10}(movement|ledger|balance.{0,10}for)|ledger.{0,10}(balance|statement|for)|transaction.{0,10}(of|for).{0,10}account|day.{0,10}(summary|report|sales)|today.{0,10}(sales|voucher)|sale.{0,10}today|profit.{0,10}(by|per).{0,10}location|location.{0,10}profit|which.{0,10}location.{0,10}(most|best)|debit.{0,10}note|supplier.{0,10}debit|customer.{0,10}list|list.{0,10}(of.{0,5})?customer|all.{0,10}customer|supplier.{0,10}list|list.{0,10}(of.{0,5})?supplier|all.{0,10}supplier|stock.{0,10}item.{0,10}(detail|info|profile)|item.{0,10}(detail|info|profile).{0,10}(for|of)|what.{0,10}(is|are).{0,5}(the.{0,5})?details.{0,10}(of|for).{0,10}item|mix.{0,10}batch|batch.{0,10}(list|status|summary)|material.{0,10}batch|customer.{0,10}proforma|price.{0,10}list.{0,10}(for.{0,5})?customer|proforma.{0,10}(for|customer)|supplier.{0,10}proforma|price.{0,10}(list|sheet).{0,10}(from|supplier)|weekly.{0,10}(sale|revenue|breakdown)|sale.{0,10}(by week|per week|week.{0,5}by.{0,5}week)|container.{0,10}(items|content|loaded|what.{0,10}inside)|what.{0,10}(is|are|was).{0,10}(in|inside|loaded).{0,5}container|employee.{0,10}(list|roster|staff)|all.{0,10}(employee|staff)|staff.{0,10}list|journal.{0,10}(entry|entries|voucher)|recent.{0,10}journal|journal.{0,10}posting|audit.{0,10}(log|trail|history)|who.{0,10}(created|deleted|changed|modified|updated)|recent.{0,10}change|bank.{0,10}account.{0,10}(list|balance|all)|all.{0,10}bank|list.{0,10}(of.{0,5})?bank|stock.{0,10}adjust|production.{0,10}(stock|entry|voucher)|consumption.{0,10}(stock|entry)|tracking.{0,10}(event|update|histor)|container.{0,10}tracking|where.{0,10}(is|was).{0,15}container|shipment.{0,10}update|pending.{0,10}(container.{0,10}sale|payment.{0,10}container)|unpaid.{0,10}container|outstanding.{0,10}container|container.{0,10}(unpaid|pending.{0,10}payment)|supplier.{0,10}container|containers.{0,10}(from|by).{0,10}supplier|how many.{0,10}container.{0,10}(from|supplier)|income.{0,10}(break|categ|by type)|revenue.{0,10}(break|by account)|top.{0,10}income.{0,10}account|worker.{0,10}(profile|detail|info)|info.{0,10}(about|for|on).{0,15}worker|who.{0,10}is.{0,10}worker|location.{0,10}(list|all)|all.{0,10}(location|warehouse)|list.{0,10}(of.{0,5})?location|quarterly|quarter.{0,10}(comparison|breakdown|vs)|q[1-4].{0,10}(vs|comparison|revenue)/i;
    let dataQueryResult: any = undefined;

    if (
      PHASE1_KEYWORDS.test(userMessage) &&
      !voucherDraft &&
      !stockAdjustmentDraft &&
      !stockTransferDraft &&
      !stockTransferDrafts &&
      !stockTransferResponseOverride
    ) {
      try {
        const todayDate = new Date();
        const todayStr = todayDate.toISOString().slice(0, 10);
        const yesterdayStr = new Date(todayDate.getTime() - 86400000).toISOString().slice(0, 10);
        const thisMonthStart = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1).toISOString().slice(0, 10);
        const lastMonthStart = new Date(todayDate.getFullYear(), todayDate.getMonth() - 1, 1)
          .toISOString()
          .slice(0, 10);
        const lastMonthEnd = new Date(todayDate.getFullYear(), todayDate.getMonth(), 0).toISOString().slice(0, 10);
        const last30Days = new Date(todayDate.getTime() - 30 * 86400000).toISOString().slice(0, 10);
        const dayOfWeek = todayDate.getDay();
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        const thisWeekStart = new Date(todayDate.getTime() + mondayOffset * 86400000).toISOString().slice(0, 10);
        const lastWeekStart = new Date(todayDate.getTime() + (mondayOffset - 7) * 86400000).toISOString().slice(0, 10);
        const lastWeekEnd = new Date(todayDate.getTime() + (mondayOffset - 1) * 86400000).toISOString().slice(0, 10);

        const phase1Prompt = `ERP data query classifier. Classify the user's intent and extract parameters. Output ONLY valid JSON, no markdown.
User message: "${userMessage}"
Today: ${todayStr} | Yesterday: ${yesterdayStr}
This week: ${thisWeekStart} to ${todayStr} | Last week: ${lastWeekStart} to ${lastWeekEnd}
This month: ${thisMonthStart} to ${todayStr} | Last month: ${lastMonthStart} to ${lastMonthEnd}
Last 30 days: ${last30Days} to ${todayStr}

Query types:
pl_summary = P&L / profit & loss / income statement for a period
cash_position = current cash and bank account balances
overdue_payments = customers/accounts that owe money (outstanding receivables)
customer_statement = recent transactions for a specific named customer
supplier_statement = recent transactions for a specific named supplier
top_customers = top customers by revenue/receipts for a period
outstanding_suppliers = suppliers with the largest balances owed to them
worker_attendance = worker attendance summary (present/absent) for a date range
bale_production = factory bale production stats for a date range
container_status = status of a specific container by its number
containers_pending_offload = containers that have arrived but not been offloaded yet
inventory_check = stock quantity/levels for a specific item name (or all items if none named)
low_stock_items = items whose current stock is below their reorder level
stock_movement = recent stock adjustments or transfers for a named item
open_purchase_orders = open/pending purchase orders, optionally filtered by supplier name
customer_aging = receivables aging analysis (buckets: 0-30, 31-60, 61-90, 90+ days)
supplier_aging = payables aging analysis (buckets: 0-30, 31-60, 61-90, 90+ days)
container_list = list containers filtered by status (e.g. "In Transit", "Arrived", "Offloaded") or date range
monthly_comparison = compare this month vs last month for revenue / expenses / net profit
rental_summary = rental occupancy, rent due and overdue amounts across all units
payroll_summary = factory payroll totals for a date range
sales_analysis = sales revenue and profit by stock item for a period
top_selling_items = top items ranked by sales quantity or revenue
container_profitability = profit analysis per container (cost vs sale price)
stock_valuation = total inventory value grouped by stock group/category
expense_breakdown = top expense accounts ranked by total spend for a period
customer_order_status = customer orders filtered by status (DRAFT/LOADING/VERIFIED/FINALIZED/CANCELLED)
credit_notes_summary = recent credit notes issued (returns/reversals)
bank_transactions = recent transactions on a specific bank or cash account
fixed_assets_summary = list of fixed assets with purchase amounts and categories
factory_kpi = factory daily KPI snapshots (kg input, kg pressed, bales produced, waste)
pos_sales_summary = POS register sales totals by product or overall for a period
intercompany_transfers = inter-company money transfer history between entities
container_offload_details = detailed breakdown of stock items offloaded from a specific container
worker_productivity = factory worker productivity ranking by bales produced or kg pressed
supplier_spend = total purchase spend per supplier ranked by amount
upcoming_arrivals = containers currently in transit with ETA in the next N days
factory_waste_analysis = factory waste entries analysis by type/date range
customer_payment_history = recent receipts and payments received from customers (named or all)
voucher_type_summary = count and total amounts grouped by voucher type for a period
location_stock_summary = inventory stock totals (items, qty, value) grouped per warehouse location
trial_balance = all ledger accounts with net debit/credit balances for a period
purchase_order_detail = line items and charges for a specific PO number (requires containerNumber or entityName as PO number)
container_cost_breakdown = full cost breakdown (items, freight, surcharge, charges) for a named container
worker_document_expiry = factory workers whose visa, work permit, or residential permit expires within 60 days
stock_transfers = recent stock transfer vouchers showing items moved between locations
cash_flow_summary = total cash/bank inflows vs outflows for a period
ledger_account_balance = all debit/credit transactions for a specific named ledger account
daily_report = all vouchers (every type) posted on a specific date — use dateFrom as the target date
profit_by_location = sales profit grouped by warehouse/location for a period
debit_note_summary = recent debit notes issued (supplier charge-backs or purchase corrections)
customer_list = all customers with their current outstanding balance and contact info
supplier_list = all suppliers with total PO amounts and contact info
stock_item_detail = detailed profile of a named stock item including qty per location
factory_mix_batches = list of factory material mix batches with status and usage
customer_proformas = customer price lists/proformas with item prices and quantities
supplier_proformas = supplier proformas/price sheets with item barcodes and prices
weekly_sales = sales revenue and profit broken down by calendar week for a period
container_items_list = stock items loaded in a specific container (from PO line items)
employee_list = ERP employee roster with salary, balance and department info
journal_entries = recent journal vouchers posted with their account debit/credit entries
audit_trail = recent audit log showing who created, updated, or deleted records
bank_account_list = all registered bank and cash accounts with current balances
stock_adjustments = recent production or consumption stock adjustment vouchers
container_tracking = tracking events and location history for a specific container
pending_container_sales = container sales that are unpaid or partially paid
supplier_container_history = all containers received from a specific named supplier
income_breakdown = top income/revenue accounts ranked by net amount earned
factory_worker_profile = full profile details for a specific named factory worker
location_list = all registered warehouse/location details with stock item counts
quarterly_comparison = revenue, cost, and profit broken down by quarter for the year

Output this JSON shape:
{"queryType":"<one of the above>","entityName":<string or null>,"containerNumber":<string or null>,"locationName":<string or null>,"containerStatus":<string or null>,"dateFrom":<YYYY-MM-DD or null>,"dateTo":"${todayStr}","limit":10}

Field notes:
- entityName: customer/supplier/item/worker name mentioned in the query
- locationName: warehouse or location name mentioned
- containerStatus: one of "In Transit" | "Arrived" | "Offloaded" | null
Date rules: use provided ranges above. Default to last 30 days for financial, today for attendance/production if no date given.
If the intent does not match any type, output: null`;

        const phase1Res = await callAIWithFallback(selectedProvider, phase1Prompt, [], "Classify Phase1 query");
        const rawP1 = phase1Res.response
          .trim()
          .replace(/```json\n?|```/g, "")
          .trim();

        if (rawP1 !== "null" && rawP1.startsWith("{")) {
          const params = JSON.parse(rawP1);
          if (params && params.queryType) {
            const dateFrom: string = params.dateFrom || last30Days;
            const dateTo: string = params.dateTo || todayStr;
            const rowLimit: number = Math.min(params.limit || 10, 50);
            const fmt = (n: number) =>
              n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
            const fmtDec = (n: number) =>
              n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });

            dataQueryResult = await runDataQuery({
              companyId,
              params,
              dateFrom,
              dateTo,
              todayStr,
              todayDate,
              thisMonthStart,
              lastMonthStart,
              lastMonthEnd,
              rowLimit,
              userMessage,
              fmt,
              fmtDec,
            });
          }
        }
      } catch (_p1err) {
        // Phase 1 query failed silently — chat text response still returned
      }
    }

    logger.info(`[ChatService] Total chat time: ${Date.now() - chatStart}ms`);
    return {
      response: finalResponse,
      suggestions,
      provider: usedProvider,
      voucherDraft,
      stockAdjustmentDraft,
      stockTransferDraft,
      stockTransferDrafts: stockTransferDrafts && stockTransferDrafts.length > 0 ? stockTransferDrafts : undefined,
      voucherSearchResults,
      stockItemDraft,
      priceUpdateDraft,
      accountQueryResult,
      verifyContainerDraft,
      dataQueryResult,
      filePatchDrafts: filePatchDrafts && filePatchDrafts.length > 0 ? filePatchDrafts : undefined,
      readFiles: codeReadFiles.length > 0 ? codeReadFiles : undefined,
    };
  } catch (error: any) {
    logger.error("[ChatService] ERROR:", { error: error.message });
    logger.error("[ChatService] Stack:", { error: error.stack });
    if (
      error.message?.includes("API_KEY") ||
      error.message?.includes("API key") ||
      error.message?.includes("not configured")
    ) {
      return {
        response: "Invalid or missing API key. Please check your AI provider configuration in Settings.",
        suggestions: [],
      };
    }
    if (error.message?.includes("quota") || error.message?.includes("rate limit") || error.message?.includes("429")) {
      const available = getAvailableProviders();
      return {
        response: `API quota exceeded. ${available.length > 1 ? "Trying fallback providers also failed. " : ""}Please try again later or add additional AI provider keys in your environment.`,
        suggestions: [],
      };
    }
    // Catch-all: return a friendly inline error so the route always returns 200
    return {
      response: `Sorry, something went wrong while processing your request. (${error.message || "Unknown error"})`,
      suggestions: [],
    };
  }
}

// Export function to get available providers for the settings UI
export function getConfiguredProviders(): { provider: AIProvider; available: boolean }[] {
  return [
    { provider: "gemini", available: !!process.env.GEMINI_API_KEY },
    { provider: "chatgpt", available: !!process.env.OPENAI_API_KEY },
    { provider: "grok", available: !!process.env.XAI_API_KEY },
  ];
}

export {
  saveMessage,
  getConversationHistory,
  getConversationHistoryForAI,
  getAllChatHistory,
  saveFeedback,
} from "./chat/persistence";

// ── AI-powered PO text extraction ────────────────────────────────────
// Used by the PO file import feature to parse any text content (PDF, CSV, Excel raw text)
// into a structured PO object regardless of layout or column names.
export async function extractPOFromText(rawText: string): Promise<{
  poNumber: string;
  containerNumber: string;
  supplierName: string;
  supplierCode: string;
  importDate: string;
  currency: string;
  items: { name: string; code: string; quantity: number; rate: number }[];
  freight: number;
  surcharge: number;
  fumigation: number;
  documentCharges: number;
  discount: number;
  otherCharges: number;
} | null> {
  const available = getAvailableProviders();
  if (!available.length) return null;

  const today = new Date().toISOString().split("T")[0];
  const systemPrompt = `You are a data extraction assistant. Extract purchase order data from the provided text and return ONLY valid JSON with no markdown, no explanation.

Required JSON structure:
{
  "poNumber": "string (PO/invoice number, or empty if not found)",
  "containerNumber": "string (container/shipment number, or empty if not found)",
  "supplierName": "string (supplier/vendor name, or empty)",
  "supplierCode": "string (supplier code, or empty)",
  "importDate": "string (YYYY-MM-DD format, use ${today} if not found)",
  "currency": "string (USD, EUR, etc. Default USD)",
  "items": [
    { "name": "string", "code": "string (barcode/SKU/item code or empty)", "quantity": number, "rate": number }
  ],
  "freight": number,
  "surcharge": number,
  "fumigation": number,
  "documentCharges": number,
  "discount": number,
  "otherCharges": number
}

Rules:
- items array must include every product/item line with quantity > 0 and rate > 0
- All numeric fields default to 0 if not found
- Return ONLY the JSON object, nothing else`;

  const selectedProvider = await getSelectedAIProvider();
  try {
    const { response } = await callAIWithFallback(
      selectedProvider,
      systemPrompt,
      [],
      `Extract PO data from this text:\n\n${rawText.slice(0, 8000)}`
    );
    const cleaned = response
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed.items)) return null;
    return parsed;
  } catch (err) {
    logger.error("[ChatService] extractPOFromText AI error:", { error: err });
    return null;
  }
}
