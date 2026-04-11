import { useEffect, useRef, useState } from "react";
import { createContext, updateFocusClient, appendMessage } from "../lib/router/context.js";
import {
  buildStage1Prompt,
  buildStage3Prompt,
  buildStage4Prompt,
  buildSystemHeader
} from "../lib/router/promptBuilder.js";
import { fuzzySearchClients, heuristicMatch, buildClarifyQuestion, toResolvedClientProfile } from "../lib/router/clientResolver.js";
import { expandEventChain, EVENT_CHAINS } from "../lib/router/eventChains.js";
import { createLLMCaller, getAvailableModels, extractTextFromModelResponse } from "../lib/models/index.js";
import ReactMarkdown from "react-markdown";
import { resolveModelProviderPreference } from "../lib/modelSettings.js";

/*
 * =========================================================
 * SECTION 0 · Static Contracts (Only structural constraints)
 * =========================================================
 * 说明：这里仅定义"数据结构契约"，不做任何业务语义硬编码。
 */

const ACTION_WHITELIST = [
  "add_trait", "remove_trait",
  "add_todo", "complete_todo", "update_todo", "delete_todo",
  "update_profile", "add_relation", "create_profile", 
  "trigger_event_chain"
];

const ACTION_SCHEMA = {
  add_trait: ["clientId", "trait"],
  remove_trait: ["clientId", "trait"],
  add_todo: ["clientId", "todo", "days"],
  complete_todo: ["clientId"],
  update_todo: ["clientId", "todo", "days"],
  delete_todo: ["clientId", "todo"],
  update_profile: ["clientId", "updates"],
  add_relation: ["clientId", "relation"],
  create_profile: ["name"],
  delete_profile: ["clientId"],
  add_notification: ["clientId", "text"],
  update_health: ["clientId", "delta"],
  trigger_event_chain: ["clientId", "eventType"],
  archive_conversation: ["summary", "messages"]
};

const INTENT_TYPES = ["RECORD", "COMMAND", "QUERY", "KNOWLEDGE", "GENERATE", "RECOMMEND", "CHAT"];

const LIMITS = {
  MAX_HISTORY_TURNS: 10,
  MAX_ACTIONS: 30,
  MAX_INTENTS: 12,
  MAX_REPAIR_ROUNDS: 2,
  MAX_TOTAL_LLM_CALLS: 4
};

/*
 * =========================================================
 * SECTION 1 · Shared Utilities
 * =========================================================
 */

const clipText = (value, max = 220) => {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

const isPlainObject = (v) => Object.prototype.toString.call(v) === "[object Object]";

const toPrettyJson = (v) => {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
};

const extractBalancedJsonObjects = (text) => {
  const source = String(text || "");
  const results = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }

    if (ch === "}") {
      if (depth > 0) depth -= 1;
      if (depth === 0 && start >= 0) {
        results.push(source.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return results;
};

const scorePayloadShape = (obj) => {
  if (!isPlainObject(obj)) return -1;
  let score = 0;
  if (typeof obj.reply === "string") score += 3;
  if (Array.isArray(obj.intents)) score += 3;
  if (Array.isArray(obj.actions)) score += 3;
  if (typeof obj.needs_clarification === "boolean") score += 1;
  if ("confidence" in obj) score += 1;
  if (Array.isArray(obj.focus_change)) score += 1;
  return score;
};

const parseJsonFromText = (raw) => {
  // 去除 Minimax 推理模型可能产生的 <think>...</think> 标签
  const cleaned = String(raw || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (!cleaned) return null;

  const candidates = [cleaned];

  const fenceMatches = [...cleaned.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  fenceMatches.forEach((m) => {
    if (m?.[1]) candidates.push(String(m[1]).trim());
  });

  extractBalancedJsonObjects(cleaned).forEach((snippet) => candidates.push(snippet));

  let best = null;
  let bestScore = -1;

  for (const c of candidates) {
    // 尝试直接解析，或修复 JSON 字符串值中的字面 \n 后再解析
    for (const attempt of [c, fixLiteralNewlines(c)]) {
      try {
        const parsed = JSON.parse(attempt);
        const score = scorePayloadShape(parsed);
        if (score > bestScore) {
          best = parsed;
          bestScore = score;
        }
      } catch {
        // noop
      }
    }
  }

  return best;
};

/**
 * 修复 LLM 输出的 JSON 中，字符串值内的字面 \n（未转义的换行）
 * 例如 "reply": "第一行\n第二行" 中 \n 实际是两个字符 \ + n，
 * 需要转成真正的 JSON 转义 \\n 才能被 JSON.parse 正确解析
 */
const fixLiteralNewlines = (jsonStr) => {
  // 在 JSON 字符串值内部，将未转义的真实换行替换为 \n
  return jsonStr.replace(/\r?\n/g, "\\n");
};

/**
 * JSON 解析完全失败时的兜底：用正则从原始文本中提取 "reply" 字段的值
 * 例如输入: { "reply": "内容...", "actions": [] }  → 返回 "内容..."
 * 如果提取不到，返回原始文本去除 JSON 包装后的内容
 */
const extractReplyFallback = (rawText) => {
  if (!rawText) return "";
  // 尝试正则匹配 "reply": "..." 的值
  const m = rawText.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/s);
  if (m?.[1]) {
    // 把 JSON 转义还原（\n → 换行, \" → "）
    return m[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return rawText;
};

const buildClientBrief = (clients = []) => (clients || []).slice(0, 30).map((c) => ({
  id: c.id,
  name: c.n,
  company: c.co,
  role: c.role,
  hp: c.hp,
  todoOpenCount: (c.todos || []).filter((t) => !t.done).length
}));

/*
 * =========================================================
 * SECTION 2 · Prompt Design (4-Stage Pipeline)
 * =========================================================
 * 分层架构：Stage1(意图分类) → 程序侧消歧 → Stage3(Action生成) → 执行
 * 短路：纯 CHAT/KNOWLEDGE 且无客户 → Stage4(短路)
 */

// 用于 UI 展示的 Prompt 上下文快照
const buildPromptContext = (inputText, clients, ctx) => {
  const systemPrompt = buildSystemHeader(ctx);
  const clientBrief = buildClientBrief(clients);

  return {
    systemPrompt,
    userPayload: {
      input: inputText,
      clients: clientBrief,
      time_anchor: {
        currentDate: ctx.current_date,
        currentYear: ctx.current_year
      }
    },
    messages: [
      { role: "system", name: "RelateAI", content: systemPrompt },
      { role: "user", name: "user", content: inputText }
    ],
    usedHistoryTurns: (ctx.recent_messages || []).length
  };
};

/*
 * =========================================================
 * SECTION 3 · LLM Gateway (Call + Repair)
 * =========================================================
 * LLM caller 已抽取至 src/lib/models/，通过 createLLMCaller(providerId) 创建
 */

/*
 * =========================================================
 * SECTION 4 · Output Validation (Structure-only)
 * =========================================================
 */

const looksLikeMachineField = (str) =>
  /^[a-z][a-z0-9]*([_-][a-z0-9]+)+$/i.test(str) || /^(is|has|can|should)[A-Z]/.test(str);

const validateActions = (actions = []) => {
  const errors = [];

  actions.forEach((action, i) => {
    if (!isPlainObject(action)) {
      errors.push(`actions[${i}] 不是 object`);
      return;
    }

    const type = String(action.type || "");
    if (!ACTION_WHITELIST.includes(type)) {
      errors.push(`actions[${i}].type 非白名单: ${type || "<empty>"}`);
      return;
    }

    const required = ACTION_SCHEMA[type] || [];
    required.forEach((field) => {
      if (action[field] == null || action[field] === "") {
        errors.push(`actions[${i}] 缺少字段: ${field}`);
      }
    });

    if (type === "add_trait") {
      const trait = String(action.trait || "").trim();
      if (!trait) {
        errors.push(`actions[${i}].trait 不能为空`);
      } else if (looksLikeMachineField(trait)) {
        errors.push(`actions[${i}].trait 不可为机器字段，请改为人类可读标签`);
      }
    }

    if (type === "trigger_event_chain") {
      const et = String(action.eventType || "").trim();
      if (!et) {
        errors.push(`actions[${i}].eventType 不能为空`);
      } else if (!Object.keys(EVENT_CHAINS).includes(et)) {
        errors.push(`actions[${i}].eventType 非白名单: ${et}`);
      }
    }
  });

  return { ok: errors.length === 0, errors };
};

const buildRepairMessages = ({ rawText, errors, systemPrompt }) => [
  {
    role: "system",
    name: "repairer",
    content: `${systemPrompt}\n\n你现在是 JSON 修复器。仅输出符合上述协议的 JSON。不要解释，不要 <think>，不要 Markdown 代码块，不要占位模板。必须保证 reply 非空；若 needs_clarification=true 则 clarifying_question 非空。`
  },
  {
    role: "user",
    name: "user",
    content: `以下是上一次模型输出，请修复为合法 JSON：\n\n${clipText(rawText, 4000)}\n\n错误列表：\n${errors.map((e, idx) => `${idx + 1}. ${e}`).join("\n")}`
  }
];

/*
 * =========================================================
 * SECTION 5 · Pipeline Orchestration (4-Stage)
 * =========================================================
 * Stage 1: 意图分类 → 短路判断 → 程序侧消歧 → Stage 3: Action 生成
 */

/**
 * 澄清回复后的快捷 Pipeline
 * 跳过 Stage 1（意图已知）和 Stage 2（客户已确定），直接走 Stage 3
 * @param {string} originalInput - 原始用户输入（非澄清回复文本）
 * @param {Array} clients - 全量客户列表
 * @param {Object} ctx - 会话上下文
 * @param {Array} intents - 上一轮 Stage 1 的意图
 * @param {Object} resolvedClient - 用户选择的客户对象
 */
const runPipelineWithResolvedClient = async (originalInput, clients, ctx, intents, resolvedClient, modelProvider = 'minimax') => {
  const startedAt = Date.now();
  const stages = [];
  const llm = createLLMCaller(modelProvider);
  const contextSnapshot = buildPromptContext(originalInput, clients, ctx);

  stages.push({
    title: "STAGE 0 · Context Assembly（上下文组装）",
    status: "ok",
    detail: {
      clientCount: (clients || []).length,
      focusClient: ctx.focus_client ? `${ctx.focus_client.name} (id:${ctx.focus_client.id})` : "null",
      summaryLength: (ctx.conversation_summary || "").length,
      historyTurns: (ctx.recent_messages || []).length
    }
  });

  stages.push({
    title: "STAGE 1 · Intent Classification（意图分类）— 沿用上轮",
    status: "ok",
    detail: {
      intents,
      source: "clarification_reply（用户选择客户后沿用上轮意图）"
    }
  });

  stages.push({
    title: "STAGE 2 · Client Disambiguation（客户消歧）— 用户已选择",
    status: "ok",
    detail: {
      log: [{ mention: resolvedClient.n || resolvedClient.name, result: "user_selected", hitCount: 1, matched: resolvedClient.n || resolvedClient.name }],
      resolvedCount: 1,
      pendingCreateCount: 0,
      resolvedNames: [resolvedClient.n || resolvedClient.name || "?"]
    }
  });

  // ==========================================
  // 直接进入 STAGE 3: Action 生成
  // ==========================================
  const resolvedClientProfiles = [toResolvedClientProfile(resolvedClient)];

  const stage3PromptText = buildStage3Prompt(intents, resolvedClientProfiles, ctx);
  const stage3Messages = [
    { role: "system", name: "RelateAI", content: stage3PromptText },
    { role: "user", name: "user", content: originalInput }
  ];

  const stage3Raw = await llm.call(stage3Messages, "Stage 3 · Action 生成（澄清后）");
  const stage3RawText = extractTextFromModelResponse(stage3Raw);
  let stage3Parsed = parseJsonFromText(stage3RawText);

  if (!stage3Parsed || typeof stage3Parsed.reply !== "string") {
    if (llm.getCallCount() < LIMITS.MAX_TOTAL_LLM_CALLS) {
      const repairMessages = buildRepairMessages({
        rawText: stage3RawText,
        errors: ["reply 必须是 string", "actions 必须是 array"],
        systemPrompt: stage3PromptText
      });
      const repaired = await llm.call(repairMessages, "Stage 3 · 修复（澄清后）");
      const repairedText = extractTextFromModelResponse(repaired);
      stage3Parsed = parseJsonFromText(repairedText);
    }
  }

  if (!stage3Parsed || typeof stage3Parsed.reply !== "string") {
    throw new Error("Stage 3 输出无法解析：Action 生成失败（澄清后）");
  }

  const stage3ActionsRaw = Array.isArray(stage3Parsed.actions) ? stage3Parsed.actions : [];

  // clientId 强制回填（只有一个客户，简化版）
  const theClientId = resolvedClient.id;
  const stage3Actions = stage3ActionsRaw.map(action => {
    const patched = { ...action };
    if (action.type === "create_profile") return patched;
    if (theClientId != null) patched.clientId = theClientId;
    return patched;
  });

  const validEventTypes = Object.keys(EVENT_CHAINS);
  for (const action of stage3Actions) {
    if (action.type === "trigger_event_chain" && (!action.eventType || !validEventTypes.includes(action.eventType))) {
      console.warn(`trigger_event_chain 缺少有效 eventType: ${action.eventType || "(空)"}`);
    }
  }

  const actionValidation = validateActions(stage3Actions);

  stages.push({
    title: "STAGE 3 · Action Generation（Action 生成）",
    status: actionValidation.ok ? "ok" : "warn",
    detail: {
      usage: stage3Raw?.usage || null,
      reply: clipText(stage3Parsed.reply, 200),
      actionCount: stage3Actions.length,
      actionTypes: [...new Set(stage3Actions.map(a => a.type))],
      validationErrors: actionValidation.errors,
      injectedModules: intents.map(i => i.type),
      clientIdPatch: `强制回填 → ${theClientId}`,
      rawPreview: clipText(stage3RawText, 600)
    }
  });

  // 执行 event chain 展开
  const finalActions = [];
  const eventChainExpansions = [];

  for (const action of stage3Actions) {
    if (action.type === "trigger_event_chain") {
      const { actions: expandedActions, recommendedScripts } = expandEventChain(action.clientId, action.eventType);
      eventChainExpansions.push({
        eventType: action.eventType,
        clientId: action.clientId,
        expandedCount: expandedActions.length,
        recommendedScripts
      });
      finalActions.push(...expandedActions);
    } else {
      finalActions.push(action);
    }
  }

  if (eventChainExpansions.length > 0) {
    stages.push({
      title: "STAGE 3.1 · Event Chain Expansion（事件链展开）",
      status: "ok",
      detail: { expansions: eventChainExpansions, totalExpandedActions: finalActions.length }
    });
  }

  const confidence = stage3Parsed.confidence != null
    ? Math.max(0, Math.min(1, Number(stage3Parsed.confidence)))
    : null;

  // 更新 focus client
  const updatedFocusClient = { id: resolvedClient.id, name: resolvedClient.n || resolvedClient.name };

  stages.push({
    title: "STAGE 5 · Focus & Summary Update（对焦更新）",
    status: "ok",
    detail: {
      focusChanged: true,
      newFocus: `${updatedFocusClient.name} (id:${updatedFocusClient.id})`,
      previousFocus: ctx.focus_client ? `${ctx.focus_client.name} (id:${ctx.focus_client.id})` : "null"
    }
  });

  return buildPipelineResult({
    inputText: originalInput, ctx, stages, llm, startedAt, contextSnapshot,
    reply: stage3Parsed.reply,
    needsClarification: false,
    intents,
    actions: finalActions,
    confidence,
    focusChange: [resolvedClient.n || resolvedClient.name],
    updatedFocusClient
  });
};

const runPipeline = async (inputText, clients, ctx, modelProvider = 'minimax') => {
  const startedAt = Date.now();
  const stages = [];
  const llm = createLLMCaller(modelProvider);

  const contextSnapshot = buildPromptContext(inputText, clients, ctx);

  stages.push({
    title: "STAGE 0 · Context Assembly（上下文组装）",
    status: "ok",
    detail: {
      clientCount: (clients || []).length,
      focusClient: ctx.focus_client ? `${ctx.focus_client.name} (id:${ctx.focus_client.id})` : "null",
      summaryLength: (ctx.conversation_summary || "").length,
      historyTurns: (ctx.recent_messages || []).length
    }
  });

  // ==========================================
  // STAGE 1: 意图分类
  // ==========================================
  const stage1PromptText = buildStage1Prompt(inputText, ctx);
  const stage1Messages = [
    { role: "system", name: "RelateAI", content: stage1PromptText },
    { role: "user", name: "user", content: inputText }
  ];

  const stage1Raw = await llm.call(stage1Messages, "Stage 1 · 意图分类");
  const stage1RawText = extractTextFromModelResponse(stage1Raw);
  const stage1Parsed = parseJsonFromText(stage1RawText);

  if (!stage1Parsed || !Array.isArray(stage1Parsed.intents)) {
    throw new Error("Stage 1 输出无法解析：意图分类失败");
  }

  const stage1Result = {
    intents: stage1Parsed.intents || [],
    client_mentions: stage1Parsed.client_mentions || [],
    is_focus_change: Boolean(stage1Parsed.is_focus_change),
    needs_clarification: Boolean(stage1Parsed.needs_clarification),
    clarifying_question: stage1Parsed.clarifying_question || null,
    confidence: stage1Parsed.confidence
  };

  stages.push({
    title: "STAGE 1 · Intent Classification（意图分类）",
    status: "ok",
    detail: {
      usage: stage1Raw?.usage || null,
      intents: stage1Result.intents,
      client_mentions: stage1Result.client_mentions,
      is_focus_change: stage1Result.is_focus_change,
      needs_clarification: stage1Result.needs_clarification,
      confidence: stage1Result.confidence,
      rawPreview: clipText(stage1RawText, 600)
    }
  });

  // Stage 1 返回需澄清
  if (stage1Result.needs_clarification) {
    stages.push({
      title: "STAGE 1.1 · Clarification Needed（需澄清）",
      status: "warn",
      detail: { question: stage1Result.clarifying_question }
    });

    return buildPipelineResult({
      inputText, ctx, stages, llm, startedAt, contextSnapshot,
      reply: stage1Result.clarifying_question || "请您补充更多信息以便我理解您的需求。",
      needsClarification: true,
      intents: stage1Result.intents,
      actions: []
    });
  }

  // ==========================================
  // 短路判断：纯 CHAT/KNOWLEDGE 且无客户
  // ==========================================
  const allReadOnly = stage1Result.intents.every(
    i => i.type === "CHAT" || i.type === "KNOWLEDGE"
  );
  const noClientMentions = stage1Result.client_mentions.length === 0;

  if (allReadOnly && noClientMentions) {
    stages.push({
      title: "STAGE 4 · Short Circuit（短路）",
      status: "ok",
      detail: { reason: "纯 CHAT/KNOWLEDGE 且无客户提及，走短路路径" }
    });

    const stage4PromptText = buildStage4Prompt(inputText, ctx);
    const stage4Messages = [
      { role: "system", name: "RelateAI", content: stage4PromptText },
      { role: "user", name: "user", content: inputText }
    ];

    const stage4Raw = await llm.call(stage4Messages, "Stage 4 · 短路回复");
    const stage4RawText = extractTextFromModelResponse(stage4Raw);
    const stage4Parsed = parseJsonFromText(stage4RawText);

    stages.push({
      title: "STAGE 4.1 · Short Circuit Output",
      status: "ok",
      detail: {
        usage: stage4Raw?.usage || null,
        rawPreview: clipText(stage4RawText, 600)
      }
    });

    return buildPipelineResult({
      inputText, ctx, stages, llm, startedAt, contextSnapshot,
      reply: stage4Parsed?.reply || extractReplyFallback(stage4RawText) || "好的，请问还有什么可以帮您的吗？",
      needsClarification: false,
      intents: stage1Result.intents,
      actions: [],
      confidence: stage4Parsed?.confidence
    });
  }

  // ==========================================
  // STAGE 2: 程序侧客户消歧
  // ==========================================
  const resolvedClients = [];
  const pendingCreate = [];
  const disambiguationLog = [];

  // 2a. 判断是否需要客户绑定（写入型意图 RECORD/COMMAND 需要绑定客户）
  const needsClient = stage1Result.intents.some(
    i => ["RECORD", "COMMAND", "GENERATE", "RECOMMEND", "QUERY"].includes(i.type)
  );

  // 2b. 检测代词引用（他/她/这位/那位 等）
  // 注意：代词可以出现在任意位置，如"给他""跟他""找他""帮他""问她"等
  // 旧正则只匹配句首/标点后面的代词，遗漏了"给他写祝福"等场景
  const pronounPattern = /(?:他|她|这位|那位|那个|这个|该客户|这位客户|那位客户)(?:的|说|们|太太|老婆|先生|夫人|家人|小孩|孩子)?/;
  const hasPronouns = pronounPattern.test(inputText);

  // 2c. 组装实际要解析的 client mentions
  let effectiveMentions = [...stage1Result.client_mentions];

  // 若无显式客户称谓，尝试补充
  if (effectiveMentions.length === 0) {
    if (hasPronouns && ctx.focus_client) {
      // 代词指代 → 自动绑定 focus_client
      const focusObj = clients.find(c => c.id === ctx.focus_client.id);
      if (focusObj) {
        resolvedClients.push(focusObj);
        disambiguationLog.push({
          mention: "(代词引用)",
          result: "pronoun_to_focus",
          hitCount: 1,
          matched: focusObj.n
        });
      }
    } else if (needsClient && ctx.focus_client) {
      // 无称谓也无代词，但有 focus_client 且需要客户 → 沿用 focus
      const focusObj = clients.find(c => c.id === ctx.focus_client.id);
      if (focusObj) {
        resolvedClients.push(focusObj);
        disambiguationLog.push({
          mention: "(沿用 focus_client)",
          result: "inherit_focus",
          hitCount: 1,
          matched: focusObj.n
        });
      }
    } else if (needsClient && !ctx.focus_client) {
      // 需要客户但完全不知道是谁 → 主动澄清
      stages.push({
        title: "STAGE 2 · Client Disambiguation（客户消歧）",
        status: "warn",
        detail: {
          log: disambiguationLog,
          resolution: "no_client_context",
          reason: "需要客户绑定但无法确定对象"
        }
      });

      return buildPipelineResult({
        inputText, ctx, stages, llm, startedAt, contextSnapshot,
        reply: "请问您说的是哪位客户？可以告诉我客户的名字吗？",
        needsClarification: true,
        intents: stage1Result.intents,
        actions: []
      });
    }
  }

  // 2d. 逐一解析显式 mentions
  for (const mention of effectiveMentions) {
    const hits = fuzzySearchClients(mention, clients);

    if (hits.length === 0) {
      pendingCreate.push(mention);
      disambiguationLog.push({ mention, result: "pending_create", hitCount: 0 });
    } else if (hits.length === 1) {
      resolvedClients.push(hits[0]);
      disambiguationLog.push({ mention, result: "direct_match", hitCount: 1, matched: hits[0].n });
    } else {
      // 多命中 → 启发式推断
      const guess = heuristicMatch(mention, hits, ctx, { isFocusChange: !!stage1Result.is_focus_change });
      if (guess) {
        resolvedClients.push(guess);
        disambiguationLog.push({ mention, result: "heuristic_match", hitCount: hits.length, matched: guess.n });
      } else {
        // 无法判断 → 返回澄清，明确列出候选人
        const clarifyQ = buildClarifyQuestion(mention, hits);
        stages.push({
          title: "STAGE 2 · Client Disambiguation（客户消歧）",
          status: "warn",
          detail: {
            log: disambiguationLog,
            ambiguousMention: mention,
            candidates: hits.map(c => `${c.n}（${c.co || "?"}，id:${c.id}）`),
            resolution: "needs_clarification"
          }
        });

        const pipelineResult = buildPipelineResult({
          inputText, ctx, stages, llm, startedAt, contextSnapshot,
          reply: clarifyQ,
          needsClarification: true,
          intents: stage1Result.intents,
          actions: []
        });

        // 附带澄清上下文，供下一轮 resolveClarificationReply 使用
        pipelineResult._clarificationContext = {
          type: "client_disambiguation",
          mention,
          candidates: hits.map(c => ({ id: c.id, n: c.n, co: c.co, role: c.role })),
          intents: stage1Result.intents
        };

        return pipelineResult;
      }
    }
  }

  // 加入 pending create 占位
  for (const name of pendingCreate) {
    resolvedClients.push({ id: null, n: name, _pending_create: true });
  }

  stages.push({
    title: "STAGE 2 · Client Disambiguation（客户消歧）",
    status: "ok",
    detail: {
      log: disambiguationLog,
      resolvedCount: resolvedClients.filter(c => c.id != null).length,
      pendingCreateCount: pendingCreate.length,
      resolvedNames: resolvedClients.map(c => c.n || c.name || "?")
    }
  });

  // ==========================================
  // STAGE 3: Action 生成
  // ==========================================
  const resolvedClientProfiles = resolvedClients.map(c =>
    c._pending_create
      ? { id: null, name: c.n, _pending_create: true }
      : toResolvedClientProfile(c)
  );

  const stage3PromptText = buildStage3Prompt(stage1Result.intents, resolvedClientProfiles, ctx);
  const stage3Messages = [
    { role: "system", name: "RelateAI", content: stage3PromptText },
    { role: "user", name: "user", content: inputText }
  ];

  const stage3Raw = await llm.call(stage3Messages, "Stage 3 · Action 生成");
  const stage3RawText = extractTextFromModelResponse(stage3Raw);
  let stage3Parsed = parseJsonFromText(stage3RawText);

  // Stage 3 输出修复（一次机会）
  if (!stage3Parsed || typeof stage3Parsed.reply !== "string") {
    if (llm.getCallCount() < LIMITS.MAX_TOTAL_LLM_CALLS) {
      const repairMessages = buildRepairMessages({
        rawText: stage3RawText,
        errors: ["reply 必须是 string", "actions 必须是 array"],
        systemPrompt: stage3PromptText
      });
      const repaired = await llm.call(repairMessages, "Stage 3 · 修复");
      const repairedText = extractTextFromModelResponse(repaired);
      stage3Parsed = parseJsonFromText(repairedText);
    }
  }

  if (!stage3Parsed || typeof stage3Parsed.reply !== "string") {
    throw new Error("Stage 3 输出无法解析：Action 生成失败");
  }

  const stage3ActionsRaw = Array.isArray(stage3Parsed.actions) ? stage3Parsed.actions : [];

  // ==========================================
  // 程序侧 clientId 强制回填
  // ==========================================
  // 当 Stage 2 只绑定了 1 个客户时，所有 action 的 clientId 强制设为该客户 id
  // 防止 LLM 漏填或填错 clientId
  const defaultClientId = resolvedClients.length === 1 && resolvedClients[0].id != null
    ? resolvedClients[0].id
    : null;
  const resolvedIdSet = new Set(resolvedClients.filter(c => c.id != null).map(c => c.id));

  const stage3Actions = stage3ActionsRaw.map(action => {
    const patched = { ...action };

    // 跳过不需要 clientId 的 action（如 create_profile）
    if (action.type === "create_profile") return patched;

    // 如果 action 已有 clientId 且在已绑定集合中 → 保留
    if (patched.clientId != null && resolvedIdSet.has(patched.clientId)) {
      return patched;
    }

    // 否则强制回填
    if (defaultClientId != null) {
      patched.clientId = defaultClientId;
    } else if (resolvedClients.length > 0) {
      // 多客户场景，取第一个有 id 的
      const firstValid = resolvedClients.find(c => c.id != null);
      if (firstValid) patched.clientId = firstValid.id;
    }

    return patched;
  });

  // 额外校验：trigger_event_chain 必须有 eventType
  const validEventTypes = Object.keys(EVENT_CHAINS);
  for (const action of stage3Actions) {
    if (action.type === "trigger_event_chain" && (!action.eventType || !validEventTypes.includes(action.eventType))) {
      // 尝试从 intents 中推断 eventType
      // intents 的 content 可能包含线索，但这里只做空值标记，让 validateActions 报错
      console.warn(`trigger_event_chain 缺少有效 eventType: ${action.eventType || "(空)"}`);
    }
  }

  const actionValidation = validateActions(stage3Actions);

  stages.push({
    title: "STAGE 3 · Action Generation（Action 生成）",
    status: actionValidation.ok ? "ok" : "warn",
    detail: {
      usage: stage3Raw?.usage || null,
      reply: clipText(stage3Parsed.reply, 200),
      actionCount: stage3Actions.length,
      actionTypes: [...new Set(stage3Actions.map(a => a.type))],
      validationErrors: actionValidation.errors,
      injectedModules: stage1Result.intents.map(i => i.type),
      clientIdPatch: defaultClientId ? `强制回填 → ${defaultClientId}` : "多客户/无默认",
      rawPreview: clipText(stage3RawText, 600)
    }
  });

  // ==========================================
  // 执行 actions：event chain 在程序侧展开
  // ==========================================
  const finalActions = [];
  const eventChainExpansions = [];

  for (const action of stage3Actions) {
    if (action.type === "trigger_event_chain") {
      // 用程序侧 event chain 展开
      const { actions: expandedActions, recommendedScripts } = expandEventChain(action.clientId, action.eventType);
      eventChainExpansions.push({
        eventType: action.eventType,
        clientId: action.clientId,
        expandedCount: expandedActions.length,
        recommendedScripts
      });
      finalActions.push(...expandedActions);
    } else {
      finalActions.push(action);
    }
  }

  if (eventChainExpansions.length > 0) {
    stages.push({
      title: "STAGE 3.1 · Event Chain Expansion（事件链展开）",
      status: "ok",
      detail: {
        expansions: eventChainExpansions,
        totalExpandedActions: finalActions.length
      }
    });
  }

  // ==========================================
  // 汇总结果
  // ==========================================
  const confidence = stage3Parsed.confidence != null
    ? Math.max(0, Math.min(1, Number(stage3Parsed.confidence)))
    : (stage1Result.confidence != null ? Number(stage1Result.confidence) : null);

  // Focus client 更新
  let updatedFocusClient = ctx.focus_client;
  if (stage1Result.is_focus_change && resolvedClients.length > 0) {
    const firstResolved = resolvedClients.find(c => c.id != null);
    if (firstResolved) {
      updatedFocusClient = { id: firstResolved.id, name: firstResolved.n };
    }
  }

  stages.push({
    title: "STAGE 5 · Focus & Summary Update（对焦更新）",
    status: "ok",
    detail: {
      focusChanged: stage1Result.is_focus_change,
      newFocus: updatedFocusClient ? `${updatedFocusClient.name} (id:${updatedFocusClient.id})` : "null",
      previousFocus: ctx.focus_client ? `${ctx.focus_client.name} (id:${ctx.focus_client.id})` : "null"
    }
  });

  return buildPipelineResult({
    inputText, ctx, stages, llm, startedAt, contextSnapshot,
    reply: stage3Parsed.reply,
    needsClarification: false,
    intents: stage1Result.intents,
    actions: finalActions,
    confidence,
    focusChange: stage1Result.is_focus_change ? resolvedClients.filter(c => c.id).map(c => c.n) : [],
    updatedFocusClient
  });
};

/**
 * 统一构建 pipeline 返回结果
 */
const buildPipelineResult = ({
  inputText, ctx, stages, llm, startedAt, contextSnapshot,
  reply, needsClarification, intents, actions,
  confidence = null, focusChange = [], updatedFocusClient = null
}) => {
  stages.push({
    title: "STAGE 9 · Call Statistics（调用统计）",
    status: "ok",
    detail: {
      provider: llm.provider || "unknown",
      model: llm.model,
      endpoint: llm.requestUrl,
      totalLLMCalls: llm.getCallCount(),
      callLog: llm.callLog,
      elapsedMs: Date.now() - startedAt
    }
  });

  return {
    userText: inputText,
    reply: reply || "",
    confidence,
    needsClarification,
    clarifyingQuestion: needsClarification ? reply : "",
    focusChange,
    intents: intents || [],
    actions: actions || [],
    stages,
    requestMeta: {
      ...contextSnapshot,
      usedMessages: contextSnapshot.messages,
      rawTextPreview: ""
    },
    updatedFocusClient
  };
};

/*
 * =========================================================
 * SECTION 6 · Presentation Helpers
 * =========================================================
 */

const KV = ({ label, value, mono = false }) => (
  <div className="pg-kv">
    <span className="pg-kv-label">{label}</span>
    <span className={`pg-kv-value${mono ? " pg-mono" : ""}`}>{value ?? "—"}</span>
  </div>
);

const StageCard = ({ stage }) => {
  const d = stage.detail || {};

  let body = null;

  if (stage.title.includes("Context Assembly")) {
    body = (
      <>
        <KV label="客户数" value={d.clientCount} mono />
        <KV label="Focus Client" value={d.focusClient || "null"} />
        <KV label="摘要长度" value={d.summaryLength} mono />
        <KV label="历史轮次" value={d.historyTurns} mono />
      </>
    );
  } else if (stage.title.includes("Intent Classification")) {
    body = (
      <>
        {d.usage && (
          <KV
            label="Token"
            value={`入 ${d.usage.prompt_tokens ?? "?"} / 出 ${d.usage.completion_tokens ?? "?"} / 总 ${d.usage.total_tokens ?? "?"}`}
          />
        )}
        <KV label="置信度" value={d.confidence == null ? "—" : Number(d.confidence).toFixed(2)} mono />
        <KV label="客户提及" value={(d.client_mentions || []).join("、") || "—"} />
        <KV label="切换对象" value={d.is_focus_change ? "是" : "否"} />
        <KV label="需澄清" value={d.needs_clarification ? "是" : "否"} />
        <div className="pg-msg-block" style={{ marginTop: 6 }}>
          <div className="pg-msg-role">识别到的意图</div>
          <div className="pg-msg-content">
            {(d.intents || []).map((it, i) => (
              <div key={i} style={{ marginBottom: 2 }}>
                <strong>[{it.type}]</strong> {it.content || "—"}
              </div>
            ))}
          </div>
        </div>
      </>
    );
  } else if (stage.title.includes("Short Circuit")) {
    body = (
      <>
        <KV label="原因" value={d.reason || "—"} />
        {d.usage && (
          <KV
            label="Token"
            value={`入 ${d.usage.prompt_tokens ?? "?"} / 出 ${d.usage.completion_tokens ?? "?"} / 总 ${d.usage.total_tokens ?? "?"}`}
          />
        )}
        {d.rawPreview && (
          <div className="pg-msg-block">
            <div className="pg-msg-role">Raw Preview</div>
            <div className="pg-msg-content">{d.rawPreview}</div>
          </div>
        )}
      </>
    );
  } else if (stage.title.includes("Clarification Needed")) {
    body = (
      <div className="pg-msg-block">
        <div className="pg-msg-role">澄清问题</div>
        <div className="pg-msg-content">{d.question || "—"}</div>
      </div>
    );
  } else if (stage.title.includes("Client Disambiguation")) {
    body = (
      <>
        <KV label="已绑定" value={d.resolvedCount ?? d.log?.length ?? 0} mono />
        <KV label="待创建" value={d.pendingCreateCount ?? 0} mono />
        {d.resolvedNames && <KV label="绑定客户" value={d.resolvedNames.join("、") || "—"} />}
        {d.ambiguousMention && <KV label="歧义客户" value={d.ambiguousMention} />}
        {d.candidates && (
          <ul className="pg-mutation-list">
            {d.candidates.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        )}
        {Array.isArray(d.log) && d.log.length > 0 && (
          <div className="pg-msg-block" style={{ marginTop: 6 }}>
            <div className="pg-msg-role">消歧日志</div>
            <div className="pg-msg-content">
              {d.log.map((entry, i) => (
                <div key={i} style={{ marginBottom: 2 }}>
                  "{entry.mention}" → {entry.result} ({entry.hitCount} 命中{entry.matched ? `, 选中: ${entry.matched}` : ""})
                </div>
              ))}
            </div>
          </div>
        )}
      </>
    );
  } else if (stage.title.includes("Action Generation")) {
    body = (
      <>
        {d.usage && (
          <KV
            label="Token"
            value={`入 ${d.usage.prompt_tokens ?? "?"} / 出 ${d.usage.completion_tokens ?? "?"} / 总 ${d.usage.total_tokens ?? "?"}`}
          />
        )}
        <KV label="动作数" value={d.actionCount || 0} mono />
        <KV label="动作类型" value={(d.actionTypes || []).join("、") || "—"} />
        <KV label="注入模块" value={(d.injectedModules || []).join("、") || "—"} />
        <KV label="回复预览" value={d.reply || "—"} />
        {(d.validationErrors || []).length > 0 && (
          <ul className="pg-mutation-list">
            {d.validationErrors.map((e, i) => <li key={i}>⚠️ {e}</li>)}
          </ul>
        )}
      </>
    );
  } else if (stage.title.includes("Event Chain Expansion")) {
    body = (
      <>
        <KV label="总展开动作" value={d.totalExpandedActions || 0} mono />
        {(d.expansions || []).map((exp, i) => (
          <div key={i} className="pg-msg-block" style={{ marginTop: 4 }}>
            <div className="pg-msg-role">{exp.eventType} (client: {exp.clientId})</div>
            <div className="pg-msg-content">
              展开 {exp.expandedCount} 个待办/标签
              {exp.recommendedScripts?.length > 0 && (
                <div>推荐话术: {exp.recommendedScripts.join("、")}</div>
              )}
            </div>
          </div>
        ))}
      </>
    );
  } else if (stage.title.includes("Focus & Summary")) {
    body = (
      <>
        <KV label="对焦变更" value={d.focusChanged ? "是" : "否"} />
        <KV label="新 Focus" value={d.newFocus || "null"} />
        <KV label="旧 Focus" value={d.previousFocus || "null"} />
      </>
    );
  } else if (stage.title.includes("Call Statistics")) {
    body = (
      <>
        <KV label="Provider" value={d.provider || "minimax"} mono />
        <KV label="模型" value={d.model} mono />
        <KV label="接口" value={d.endpoint} mono />
        <KV label="总调用" value={d.totalLLMCalls} mono />
        <KV label="耗时" value={`${d.elapsedMs} ms`} mono />
        {(d.callLog || []).map((cl, i) => (
          <KV key={i} label={`调用 ${cl.callId}`} value={`${cl.label}${cl.usage ? ` (${cl.usage.total_tokens || "?"}t)` : ""}`} />
        ))}
      </>
    );
  } else if (stage.title.includes("Validation Failed")) {
    body = (
      <ul className="pg-mutation-list">
        {(d.errors || []).map((e, i) => <li key={i}>{e}</li>)}
      </ul>
    );
  } else if (stage.title.includes("Processing & Commit")) {
    body = d.applied > 0 ? (
      <>
        <KV label="已执行" value={d.applied} mono />
        <KV label="已更新" value={d.upserted} mono />
        <KV label="已删除" value={d.deleted} mono />
      </>
    ) : (
      <KV label="状态" value={d.reason || "无可提交动作"} />
    );
  } else if (typeof d === "string") {
    body = <div className="pg-reply-text">{d}</div>;
  } else {
    body = <pre className="playground-json">{toPrettyJson(d)}</pre>;
  }

  return (
    <div className="playground-stage-card">
      <div className="playground-stage-head">
        <span className="playground-stage-title">{stage.title}</span>
        <span className={`playground-stage-tag ${stage.status}`}>{stage.status}</span>
      </div>
      <div className="pg-stage-body">{body}</div>
    </div>
  );
};

/*
 * =========================================================
 * SECTION 7 · Page Component
 * =========================================================
 */

export default function PlaygroundView2({ setView, clients, applyPlaygroundActions, standalone = false }) {
  const [inputText, setInputText] = useState("");
  const [chatHistory, setChatHistory] = useState([]);
  const [selectedTurn, setSelectedTurn] = useState(null);
  const [running, setRunning] = useState(false);
  const [showFullPrompt, setShowFullPrompt] = useState(false);
  const [ctx, setCtx] = useState(() => createContext("保险中介"));

  // 澄清等待状态：记录上一轮返回的澄清上下文
  // 当 pendingClarification 不为 null 时，下一条用户输入被视为"对澄清问题的回答"
  const [pendingClarification, setPendingClarification] = useState(null);

  // 模型选择：支持运行时切换不同 LLM provider
  const [selectedModel, setSelectedModel] = useState(resolveModelProviderPreference());
  const availableModels = getAvailableModels();

  const chatEndRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, running]);

  useEffect(() => {
    const preferred = resolveModelProviderPreference();
    if (availableModels.some((m) => m.id === preferred && m.configured) && preferred !== selectedModel) {
      setSelectedModel(preferred);
    }
  }, [availableModels, selectedModel]);

  const currentTurn = selectedTurn != null
    ? chatHistory[selectedTurn]
    : (chatHistory.length > 0 ? chatHistory[chatHistory.length - 1] : null);

  const promptPanelData = currentTurn?.requestMeta || buildPromptContext(inputText || "...", clients || [], ctx);

  /**
   * 尝试将用户输入解析为对澄清问题的回复（选择客户）
   * 支持：
   *   - 纯数字 → 匹配客户 ID（如 "11"）
   *   - 名字 → 模糊匹配候选列表中的客户名（如 "陈素"）
   * @param {string} reply - 用户输入
   * @param {Object} clarification - pendingClarification 上下文
   * @param {Array} allClients - 全量客户列表
   * @returns {Object|null} 匹配到的客户对象，或 null
   */
  const resolveClarificationReply = (reply, clarification, allClients) => {
    if (!clarification || !clarification.candidates || clarification.candidates.length === 0) {
      return null;
    }

    const input = reply.trim();
    const candidateIds = clarification.candidates.map(c => c.id);

    // 1. 纯数字 → 当作客户 ID
    if (/^\d+$/.test(input)) {
      const id = parseInt(input, 10);
      if (candidateIds.includes(id)) {
        return allClients.find(c => c.id === id) || clarification.candidates.find(c => c.id === id);
      }
    }

    // 2. 按名字匹配候选列表
    const normalized = input.toLowerCase();
    const nameMatch = clarification.candidates.filter(c =>
      String(c.n || c.name || '').toLowerCase().includes(normalized)
      || normalized.includes(String(c.n || c.name || '').toLowerCase())
    );
    if (nameMatch.length === 1) {
      const matched = nameMatch[0];
      return allClients.find(c => c.id === matched.id) || matched;
    }

    // 3. 如果是序号（"第1个"、"1"等短文本可能已被上面 ID 覆盖）
    // 无法确定 → 返回 null
    return null;
  };

  const onSend = async () => {
    const text = inputText.trim();
    if (!text || running) return;

    setInputText("");
    setRunning(true);

    try {
      // ============================================================
      // 澄清回复分支：检测是否在等待用户回答澄清问题
      // ============================================================
      if (pendingClarification) {
        const clarCtx = pendingClarification;
        setPendingClarification(null); // 清除等待状态

        const matchedClient = resolveClarificationReply(text, clarCtx, clients || []);

        if (matchedClient) {
          // 用户成功选择了客户 → 将原始意图 + 绑定客户重新组装，跳过 Stage 1 & 2
          // 直接用上一轮的 intents 和原始输入，组装一个"已消歧"的上下文重跑 pipeline 后半段
          const clarResult = await runPipelineWithResolvedClient(
            clarCtx.originalInput, // 原始用户输入（不是"11"，而是"今天我和陈总聊了一下"）
            clients || [],
            ctx,
            clarCtx.intents,
            matchedClient,
            selectedModel
          );

          const commitResult = typeof applyPlaygroundActions === "function"
            ? applyPlaygroundActions(clarResult.actions || [])
            : { applied: 0, upserted: 0, deleted: 0 };

          const commitStage = {
            title: "STAGE 10 · Processing & Commit to App/DB",
            status: commitResult.applied > 0 ? "ok" : "skipped",
            detail: commitResult.applied > 0
              ? { applied: commitResult.applied, upserted: commitResult.upserted, deleted: commitResult.deleted }
              : { reason: "无可提交动作" }
          };

          const turn = {
            ...clarResult,
            userText: `${text}（选择客户：${matchedClient.n || matchedClient.name}）`,
            stages: [...(clarResult.stages || []), commitStage],
            commitResult
          };

          setChatHistory((prev) => [...prev, turn]);
          setSelectedTurn(null);

          setCtx(prevCtx => {
            let newCtx = appendMessage(prevCtx, text, clarResult.reply);
            if (clarResult.updatedFocusClient) {
              newCtx = updateFocusClient(newCtx, clarResult.updatedFocusClient);
            }
            return newCtx;
          });

          setRunning(false);
          return;
        }

        // 无法匹配 → 作为普通消息继续走完整 pipeline（可能用户输入了其他内容）
        console.warn(`澄清回复无法匹配候选客户: "${text}"`);
      }

      // ============================================================
      // 正常 pipeline 路径
      // ============================================================
      const result = await runPipeline(text, clients || [], ctx, selectedModel);

      // 检查是否需要澄清 → 设置 pendingClarification
      if (result.needsClarification && result._clarificationContext) {
        setPendingClarification({
          ...result._clarificationContext,
          originalInput: text
        });
      }

      const commitResult = typeof applyPlaygroundActions === "function"
        ? applyPlaygroundActions(result.actions || [])
        : { applied: 0, upserted: 0, deleted: 0 };

      const commitStage = {
        title: "STAGE 10 · Processing & Commit to App/DB",
        status: commitResult.applied > 0 ? "ok" : "skipped",
        detail: commitResult.applied > 0
          ? {
            applied: commitResult.applied,
            upserted: commitResult.upserted,
            deleted: commitResult.deleted
          }
          : { reason: "无可提交动作" }
      };

      const turn = {
        ...result,
        stages: [...(result.stages || []), commitStage],
        commitResult
      };

      setChatHistory((prev) => [...prev, turn]);
      setSelectedTurn(null);

      // 更新会话上下文
      setCtx(prevCtx => {
        let newCtx = appendMessage(prevCtx, text, result.reply);
        if (result.updatedFocusClient) {
          newCtx = updateFocusClient(newCtx, result.updatedFocusClient);
        }
        return newCtx;
      });
    } catch (err) {
      setPendingClarification(null); // 出错时清除澄清状态
      const failedContext = buildPromptContext(text, clients || [], ctx);
      setChatHistory((prev) => [...prev, {
        userText: text,
        reply: "",
        error: err instanceof Error ? err.message : "调用失败",
        intents: [],
        actions: [],
        stages: [],
        requestMeta: {
          ...failedContext,
          usedMessages: failedContext.messages
        }
      }]);
      setSelectedTurn(null);
    } finally {
      setRunning(false);
    }
  };

  const onNewChat = () => {
    setChatHistory([]);
    setSelectedTurn(null);
    setInputText("");
    setCtx(createContext("保险中介"));
    setPendingClarification(null);
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  const visibleMessages = Array.isArray(promptPanelData.usedMessages || promptPanelData.messages)
    ? (promptPanelData.usedMessages || promptPanelData.messages).slice(-30)
    : [];

  const viewingTurnIndex = selectedTurn != null
    ? selectedTurn
    : (chatHistory.length > 0 ? chatHistory.length - 1 : null);

  return (
    <div className={`page ${standalone ? "playground-page-standalone" : ""}`} style={{ background: "#faf9f7" }}>
      <div className="top-spacer" />

      {/* SECTION A · Header */}
      <div className="back-container playground-back-row">
        {!standalone ? (
          <button onClick={() => setView("voice")} className="back-btn">← back</button>
        ) : (
          <span className="playground-link-tip">URL: /playground 或 #/playground</span>
        )}
        <span className="playground-title">PLAYGROUND v2</span>
        <span className="playground-badge">4-Stage Pipeline</span>
      </div>

      <div className="playground-scroll">
        <div className="playground-grid">
          {/* SECTION B · Left Panel: Conversation + Prompt Context */}
          <div className="playground-panel playground-panel-left">
            <div className="section-label">SECTION B1 · 对话区（仅展示模型输入输出）</div>
            <div className="pg-chat-area">
              {chatHistory.length === 0 && !running && (
                <div className="playground-empty" style={{ marginTop: 40 }}>
                  输入自然语言后，系统按 4 阶段分层调用：意图分类 → 程序侧消歧 → Action 生成 → 执行。
                </div>
              )}

              {chatHistory.map((turn, i) => (
                <div
                  key={i}
                  className={`pg-turn${viewingTurnIndex === i ? " pg-turn-selected" : ""}`}
                  onClick={() => setSelectedTurn(i)}
                >
                  <div className="pg-bubble pg-bubble-user">{turn.userText}</div>
                  {turn.error ? (
                    <div className="pg-bubble pg-bubble-error">{turn.error}</div>
                  ) : (
                    <div className="pg-bubble pg-bubble-ai">
                      <div className="pg-md-content">
                        <ReactMarkdown>{turn.reply || "（空回复）"}</ReactMarkdown>
                      </div>
                      <div className="pg-bubble-meta">
                        {turn.intents?.length || 0} 意图 · {turn.actions?.length || 0} 动作 · 点击查看链路
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {running && (
                <div className="pg-turn">
                  <div className="pg-bubble pg-bubble-user">{inputText || "..."}</div>
                  <div className="pg-bubble pg-bubble-ai pg-bubble-loading">模型处理中...</div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>

            <div className="section-label" style={{ marginTop: 8 }}>SECTION B2 · 输入区</div>
            <div className="pg-chat-input-bar">
              <button onClick={onNewChat} className="pg-new-chat-btn" disabled={running} title="新建对话">
                + 新建
              </button>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="pg-model-select"
                disabled={running}
                title="切换模型"
              >
                {availableModels.map(m => (
                  <option key={m.id} value={m.id} disabled={!m.configured}>
                    {m.label}{m.configured ? "" : "（未配置）"}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="输入消息，Enter 发送..."
                className="pg-chat-input"
                disabled={running}
              />
              <button onClick={onSend} className="playground-run-btn" disabled={running || !inputText.trim()}>
                {running ? "..." : "发送"}
              </button>
            </div>

            <div className="section-label" style={{ marginTop: 8 }}>SECTION B3 · Prompt Context</div>
            <div className="playground-subcard" style={{ marginTop: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div className="section-label">CONTEXT（本轮附带）</div>
                <button
                  type="button"
                  className="playground-clear-btn"
                  style={{ padding: "4px 8px", fontSize: 10 }}
                  onClick={() => setShowFullPrompt((v) => !v)}
                >
                  {showFullPrompt ? "收起完整Prompt" : "展开完整Prompt"}
                </button>
              </div>

              <div className="pg-prompt-readable">
                <div className="pg-prompt-section"><span className="pg-prompt-label">对话轮数</span><span className="pg-mono">{chatHistory.length} 轮</span></div>
                <div className="pg-prompt-section"><span className="pg-prompt-label">客户数</span><span className="pg-mono">{(clients || []).length} 条</span></div>
                <div className="pg-prompt-section"><span className="pg-prompt-label">Focus Client</span><span className="pg-mono">{ctx.focus_client ? `${ctx.focus_client.name} (id:${ctx.focus_client.id})` : "null"}</span></div>
                {pendingClarification && (
                  <div className="pg-prompt-section" style={{ background: "#fff3cd", borderRadius: 4, padding: "4px 8px" }}>
                    <span className="pg-prompt-label">⏳ 等待澄清</span>
                    <span className="pg-mono">
                      候选: {pendingClarification.candidates?.map(c => `${c.n}(id:${c.id})`).join('、') || '—'}
                    </span>
                  </div>
                )}
                <div className="pg-prompt-section"><span className="pg-prompt-label">会话摘要</span><span className="pg-mono">{ctx.conversation_summary || "(无)"}</span></div>
                <div className="pg-prompt-section">
                  <span className="pg-prompt-label">Messages</span>
                  <span className="pg-mono">{visibleMessages.length} 条（最近窗口）</span>
                </div>
              </div>

              {showFullPrompt && (
                <>
                  <div className="playground-prompt-block" style={{ marginTop: 10 }}>
                    <div className="playground-prompt-title">SYSTEM PROMPT</div>
                    <div className="pg-msg-block" style={{ marginTop: 0 }}>
                      <div className="pg-msg-content">{promptPanelData.systemPrompt || ""}</div>
                    </div>
                  </div>

                  <div className="playground-prompt-block">
                    <div className="playground-prompt-title">USER PAYLOAD</div>
                    <div className="pg-msg-block" style={{ marginTop: 0 }}>
                      <div className="pg-msg-content">{toPrettyJson(promptPanelData.userPayload || {})}</div>
                    </div>
                  </div>

                  <div className="playground-prompt-block">
                    <div className="playground-prompt-title">MESSAGES</div>
                    <div className="pg-msg-block" style={{ marginTop: 0 }}>
                      {visibleMessages.map((msg, idx) => (
                        <div key={idx} className="pg-msg-block" style={{ marginTop: idx === 0 ? 0 : 8, background: "#fff" }}>
                          <div className="pg-msg-role">[{idx}] {msg.role}{msg.name ? ` · ${msg.name}` : ""}</div>
                          <div className="pg-msg-content">{typeof msg.content === "string" ? msg.content : toPrettyJson(msg.content || {})}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* SECTION C · Right Panel: Execution Trace */}
          <div className="playground-panel playground-panel-right">
            <div className="section-label">SECTION C · 执行链路（可观测）</div>

            {currentTurn && !currentTurn.error ? (
              <>
                <div className="pg-chain-header">
                  <span className="pg-chain-turn-label">第 {(viewingTurnIndex ?? 0) + 1} 轮链路</span>
                  <span className="pg-chain-turn-input">"{currentTurn.userText}"</span>
                </div>

                <div className="playground-result-head">
                  <div className="playground-result-item"><span>语义意图</span><strong>{currentTurn.intents?.length || 0}</strong></div>
                  <div className="playground-result-item"><span>待执行动作</span><strong>{currentTurn.actions?.length || 0}</strong></div>
                  <div className="playground-result-item"><span>已提交变更</span><strong>{currentTurn.commitResult?.applied || 0}</strong></div>
                </div>

                <div className="playground-chain-list">
                  {(currentTurn.stages || []).map((stage, i) => <StageCard key={i} stage={stage} />)}
                </div>
              </>
            ) : currentTurn?.error ? (
              <div className="playground-error">{currentTurn.error}</div>
            ) : (
              <div className="playground-empty">
                发送消息后，这里会展示完整 4 阶段执行链路（Stage1 意图分类 → 消歧 → Stage3 Action 生成 → Commit）。
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
