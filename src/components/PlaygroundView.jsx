import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { createLLMCaller, getAvailableModels, extractTextFromModelResponse } from "../lib/models/index.js";

/*
 * =========================================================
 * SECTION 0 · Static Contracts (Only structural constraints)
 * =========================================================
 * 说明：这里仅定义“数据结构契约”，不做任何业务语义硬编码。
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
  const text = String(raw || "").trim();
  if (!text) return null;

  const candidates = [text];

  const fenceMatches = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  fenceMatches.forEach((m) => {
    if (m?.[1]) candidates.push(String(m[1]).trim());
  });

  extractBalancedJsonObjects(text).forEach((snippet) => candidates.push(snippet));

  let best = null;
  let bestScore = -1;

  for (const c of candidates) {
    for (const attempt of [c, c.replace(/\r?\n/g, "\\n")]) {
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
 * SECTION 2 · Prompt Design (Rule-driven)
 * =========================================================
 */

const buildSystemPrompt = ({ currentDate, currentYear }) => `你是 RelateAI（Customer Relationship Management 语义理解及行为路由编排器）。

# 用户Profile
- 用户的角色是：保险中介

# 时间基准
- 当前日期（系统注入）: ${currentDate}
- 当前年份（系统注入）: ${currentYear}
- 用户提到“今年/现在/本月/今天”时，必须按上述时间基准解释，不能替换成其他年份（如 2024）。
- 涉及政策时效的 KNOWLEDGE 问答：若你不确定最新变更，必须明确不确定并建议以官方渠道核验，不能编造“今年政策已变化”。

# 目标
- 你必须把用户输入拆成 intents，并输出可执行 actions。
- 前端不会做业务语义推断，只会按你输出执行；因此你的结构必须严格正确。
- 你的特长是客户关系管理，你需要协助用户管理客户关系，语气专业但不失温柔从容，结尾通常以挖掘更多用户需求为主，以及给用户合适的提示
- 根据用户角色挖掘客户关系，重大角色业务相关的客户的需求，时间及销售建议


# 严格输出格式（只允许 JSON 对象，不允许任何解释文本）
{
  "reply": "string",
  "confidence": 0~1 number,
  "needs_clarification": true/false,
  "clarifying_question": "string",
  "focus_change": ["客户名"],
  "intents": [
    {
      "type": "RECORD|COMMAND|QUERY|KNOWLEDGE|GENERATE|RECOMMEND|CHAT",
      "client": "客户名或null",
      "content": "string"
    }
  ],
  "actions": [
    {
      "type": "${ACTION_WHITELIST.join("|")}",
      "...": "按 action schema 填写"
    }
  ]
}

# Action Schema（必须满足）
${toPrettyJson(ACTION_SCHEMA)}

# Intent 定义与示例（必须严格遵守）
- QUERY：查询客户或任务信息。
  示例："张伟最近怎样"、"谁要跟进"。
- KNOWLEDGE：行业知识问答，不直接改动 CRM 数据。
  示例："终身寿险怎么运作"、"MAS 新政策"、"公司新产品是什么"。
- GENERATE：生成文本/内容草稿。
  示例："帮我写条消息"、"生成贺卡"。
- RECOMMEND：请求建议或策略。
  示例："送什么好"、"怎么跟进"。
- RECORD：记录客户事实、偏好、动态。
  示例："他喜欢跑步"、"他喜欢威士忌"。
- COMMAND：明确执行指令，通常需要动作落库。
  示例："标记完成"、"删掉那条待办"、"提醒我下周二"。
- CHAT：闲聊、寒暄、或意图不明确。

# Intent 选择边界
- 同一句可有多个 intent，但必须按主次排序，主意图放前面。
- 只要涉及明确数据变更诉求，必须包含 COMMAND 或 RECORD，并给出可执行 actions。
- 纯知识问答/泛讨论优先 KNOWLEDGE 或 CHAT，actions 应为空。
- 若信息不足或对象不明确，needs_clarification=true，actions=[]。

# Action 定义
- add_trait：为客户画像添加标签、特征或偏好。用于记录客户的兴趣爱好、性格特点、生活习惯、消费偏好等可归类为"标签"的信息。
  示例："他喜欢打高尔夫”、”他是素食主义者”、”客户对风险比较保守"
- remove_trait：从客户画像中移除已有的标签或特征。用于纠正错误信息或更新过时的偏好。
  示例："他已经戒烟了，把吸烟那个标签删掉”、”张伟不再是素食者了"
- add_todo：创建一条新的待办任务。
  示例："下周二给李总打电话”、”周五前发送保单建议书给陈小姐"
- complete_todo：将已存在的待办标记为已完成。
  示例："把给xx那条标记完成”、”我已经跟进过了xx"
- update_todo：修改已有待办的内容、时间、优先级等字段。
  示例："把明天那个会议改到周四下午三点”、“明天和他的会面推迟到下周四”
- delete_todo：删除一条待办任务（不是完成，而是作废）。
  示例：”取消周五和xx的会面”
- update_profile：更新客户的基础档案字段（姓名、电话、地址、职业、生日等结构化信息）。
  示例："张伟换工作了，现在在星展银行”、”更新李太太的电话为 9123 4567"
- add_relation：在客户之间建立关系链接（家庭、同事、转介绍等）。
  示例："陈先生是王小姐的先生”、”张伟介绍了李总”
- create_profile：新建一个客户档案。
  示例："新增客户：林美玲，38岁，老师”、”帮我建一个新客户叫 Kevin Tan”、”我今天见了一个新客户/新朋友“
- trigger_event_chain：触发一个预设的事件链或自动化流程，适用于人生大事件（例如"新客户欢迎流程”、）。
  示例：”xx怀孕了”、”xx换新工作了“、”xx的母亲去世了“、”xx的小孩要升学考试了“


# 强规则
1) action.type 只能从白名单中选，必须小写 snake_case。
2) 每个 action 必须包含 schema 规定字段。
3) 无法确定客户、客户重名，或同一称谓命中多人（如“张总”对应多位）时：
   - needs_clarification = true
   - actions = []
   - clarifying_question 必须给出候选客户（至少含姓名+公司或 id）供用户选择
4) 如果有 add_todo，todo 必须具体可执行，避免空泛措辞。
5) add_trait.trait 必须是人类可读的关系标签（如“近期见面”“偏好稳健理财”）。
6) add_trait.trait 禁止机器字段/键名/编码样式（如下划线字段名、日期戳、key=value、ID 串）。
7) “今天见面/联系日期”这类事实优先写入 add_todo.text 或 update_profile.updates，不要伪装成 trait。
8) 输出必须可被 JSON.parse 直接解析。`;

const buildPromptContext = (inputText, clients, conversationHistory = []) => {
  const clientBrief = buildClientBrief(clients);
  const now = new Date();
  const currentDate = now.toISOString().slice(0, 10);
  const currentYear = now.getFullYear();
  const systemPrompt = buildSystemPrompt({ currentDate, currentYear });

  const normalizedHistory = (conversationHistory || [])
    .filter((turn) => turn?.userText)
    .slice(-LIMITS.MAX_HISTORY_TURNS);

  const historyMessages = normalizedHistory.flatMap((turn, idx) => {
    const userText = clipText(turn.userText, 800);
    const assistantReply = clipText(turn.reply || "", 800);

    const compactSummary = {
      turn: idx + 1,
      intents: Array.isArray(turn.intents) ? turn.intents.slice(0, 4) : [],
      actions: Array.isArray(turn.actions) ? turn.actions.slice(0, 4) : []
    };

    return [
      { role: "user", name: "user", content: userText },
      {
        role: "assistant",
        name: "RelateAI",
        content: `${assistantReply || "已处理"}\n[context] ${toPrettyJson(compactSummary)}`
      }
    ];
  });

  const userPayload = {
    input: inputText,
    clients: clientBrief,
    time_anchor: {
      currentDate,
      currentYear
    },
    note: "请严格按照 system prompt 的 JSON 协议输出，并严格使用 time_anchor 解释‘今年/现在’。"
  };

  const messages = [
    { role: "system", name: "RelateAI", content: systemPrompt },
    ...historyMessages,
    { role: "user", name: "user", content: JSON.stringify(userPayload) }
  ];

  return {
    systemPrompt,
    userPayload,
    messages,
    usedHistoryTurns: normalizedHistory.length,
    historyPreview: historyMessages.slice(-6).map((m) => ({ role: m.role, content: clipText(m.content, 120) }))
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

const validateTopLevelPayload = (payload) => {
  const errors = [];

  if (!isPlainObject(payload)) {
    return { ok: false, errors: ["输出不是 JSON object"] };
  }

  if (typeof payload.reply !== "string") {
    errors.push("reply 必须是 string");
  } else if (!String(payload.reply).trim()) {
    errors.push("reply 不能为空");
  }
  if (!Array.isArray(payload.focus_change)) errors.push("focus_change 必须是 array");
  if (!Array.isArray(payload.intents)) errors.push("intents 必须是 array");
  if (!Array.isArray(payload.actions)) errors.push("actions 必须是 array");

  if (payload.confidence != null && Number.isNaN(Number(payload.confidence))) {
    errors.push("confidence 必须是 number 或 null");
  }

  if (payload.needs_clarification != null && typeof payload.needs_clarification !== "boolean") {
    errors.push("needs_clarification 必须是 boolean");
  }

  if (payload.needs_clarification === true && !String(payload.clarifying_question || "").trim()) {
    errors.push("needs_clarification=true 时 clarifying_question 不能为空");
  }

  payload.intents?.forEach((intent, i) => {
    if (!isPlainObject(intent)) {
      errors.push(`intents[${i}] 必须是 object`);
      return;
    }
    if (!INTENT_TYPES.includes(String(intent.type || ""))) {
      errors.push(`intents[${i}].type 不合法`);
    }
  });

  return { ok: errors.length === 0, errors };
};

const looksLikeMachineField = (text) => {
  const t = String(text || "").trim();
  if (!t) return false;

  if (/^[a-z]+(?:_[a-z0-9]+){1,}$/.test(t)) return true;
  if (/\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(t)) return true;
  if (/^[a-z0-9_-]{16,}$/i.test(t)) return true;
  if (/\w+=\w+/.test(t)) return true;
  return false;
};

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
  });

  return { ok: errors.length === 0, errors };
};

const normalizePayload = (payload) => ({
  reply: String(payload?.reply || ""),
  confidence: payload?.confidence == null ? null : Number(payload.confidence),
  needs_clarification: Boolean(payload?.needs_clarification),
  clarifying_question: String(payload?.clarifying_question || ""),
  focus_change: Array.isArray(payload?.focus_change) ? payload.focus_change : [],
  intents: Array.isArray(payload?.intents) ? payload.intents.slice(0, LIMITS.MAX_INTENTS) : [],
  actions: Array.isArray(payload?.actions) ? payload.actions.slice(0, LIMITS.MAX_ACTIONS) : []
});

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

const resolveClientNameById = (clients = [], clientId) => {
  const id = Number(clientId);
  if (!Number.isFinite(id)) return null;
  const target = (clients || []).find((c) => Number(c?.id) === id);
  return target?.n || null;
};

const toClientDisplay = (client) => `${client?.n || "未知客户"}（${client?.co || "公司待补充"}，id:${client?.id ?? "?"}）`;

const detectClientAmbiguity = (inputText, clients = []) => {
  const text = String(inputText || "");
  const items = [];
  const byName = new Map();

  (clients || []).forEach((c) => {
    const name = String(c?.n || "").trim();
    if (!name) return;
    const arr = byName.get(name) || [];
    arr.push(c);
    byName.set(name, arr);
  });

  byName.forEach((matched, name) => {
    if (matched.length > 1 && text.includes(name)) {
      items.push({
        mention: name,
        reason: "重名",
        candidates: matched.map(toClientDisplay)
      });
    }
  });

  const surnameMentions = [...text.matchAll(/([\u4e00-\u9fa5])\s*总/g)].map((m) => m?.[1]).filter(Boolean);
  const uniqueSurnameMentions = [...new Set(surnameMentions)];

  uniqueSurnameMentions.forEach((surname) => {
    const matched = (clients || []).filter((c) => String(c?.n || "").startsWith(surname));
    if (matched.length > 1) {
      items.push({
        mention: `${surname}总`,
        reason: "称谓命中多人",
        candidates: matched.map(toClientDisplay)
      });
    }
  });

  return {
    ambiguous: items.length > 0,
    items
  };
};

const buildAmbiguityQuestion = (ambiguity) => {
  const first = ambiguity?.items?.[0];
  if (!first) return "我需要先确认你具体指的是哪位客户？";
  const opts = (first.candidates || []).slice(0, 5).join("；");
  return `我识别到“${first.mention}”存在${first.reason}，请确认具体客户：${opts}。`;
};

const buildSemanticDetail = (normalized, ambiguity) => {
  const intents = Array.isArray(normalized?.intents) ? normalized.intents : [];
  const intentTypes = [...new Set(intents.map((it) => String(it?.type || "")).filter(Boolean))];
  return {
    intentCount: intents.length,
    intentTypes,
    intents: intents.slice(0, 6),
    ambiguityCount: ambiguity?.items?.length || 0,
    ambiguityMentions: (ambiguity?.items || []).map((x) => x.mention)
  };
};

const buildDependencyDetail = ({ normalized, actions, shouldClarify, ambiguity }) => {
  const modelAskedClarify = Boolean(normalized?.needs_clarification);
  const checks = [
    { item: "Top-level payload", ok: true, note: "基础字段结构合法" },
    { item: "Action schema", ok: true, note: "所有 action 已通过 schema 校验" },
    {
      item: "Disambiguation gate",
      ok: !ambiguity?.ambiguous || shouldClarify,
      note: ambiguity?.ambiguous
        ? `检测到指代冲突：${(ambiguity.items || []).map((x) => x.mention).join("、")}`
        : "未发现同名/称谓冲突"
    },
    {
      item: "Clarification gate",
      ok: !shouldClarify || actions.length === 0,
      note: shouldClarify
        ? (modelAskedClarify ? "模型判定需澄清，动作已被网关拦截" : "系统判定需澄清，动作已被网关拦截")
        : "无需澄清，动作可继续分发"
    }
  ];

  return {
    passed: checks.every((c) => c.ok),
    checks
  };
};

const buildFocusDetail = (normalized, actions, clients = []) => {
  const fromFocus = Array.isArray(normalized?.focus_change) ? normalized.focus_change : [];
  const fromIntents = (normalized?.intents || []).map((it) => String(it?.client || "").trim()).filter(Boolean);
  const fromActions = actions
    .map((a) => resolveClientNameById(clients, a?.clientId) || (a?.clientId == null ? "" : `#${a.clientId}`))
    .filter(Boolean);

  const focusTargets = [...new Set([...fromFocus, ...fromIntents, ...fromActions])];

  return {
    focusTargets,
    source: {
      focus_change: fromFocus,
      intents_client: fromIntents,
      actions_client: fromActions
    }
  };
};

const buildRoutingDetail = (actions = []) => {
  const buckets = actions.reduce((acc, action) => {
    const type = String(action?.type || "unknown");
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});

  return {
    totalActions: actions.length,
    routes: Object.entries(buckets).map(([type, count]) => ({
      type,
      count,
      handler: "applyPlaygroundActions"
    }))
  };
};

/*
 * =========================================================
 * SECTION 5 · Pipeline Orchestration (LLM-first)
 * =========================================================
 */

const runPipeline = async (inputText, clients, conversationHistory = [], modelProvider = 'minimax') => {
  const startedAt = Date.now();
  const stages = [];

  const context = buildPromptContext(inputText, clients, conversationHistory);
  const llm = createLLMCaller(modelProvider);

  stages.push({
    title: "SECTION 1 · Prompt Assembly",
    status: "ok",
    detail: {
      clientCount: context.userPayload.clients.length,
      historyTurnsUsed: context.usedHistoryTurns,
      messageCount: context.messages.length
    }
  });

  let rawText = "";
  let parsed = null;
  let normalized = null;
  let validationErrors = [];

  // 首次主调用
  const first = await llm.call(context.messages, "主调用");
  rawText = extractTextFromModelResponse(first);

  stages.push({
    title: "SECTION 2 · Model Raw Output",
    status: "ok",
    detail: {
      usage: first?.usage || null,
      rawPreview: clipText(rawText, 800)
    }
  });

  // 结构校验 + 修复轮次
  for (let round = 0; round <= LIMITS.MAX_REPAIR_ROUNDS; round += 1) {
    parsed = parseJsonFromText(rawText);

    if (!parsed) {
      validationErrors = ["模型输出无法解析为 JSON"];
    } else {
      const topLevel = validateTopLevelPayload(parsed);
      normalized = normalizePayload(parsed);
      const actionLevel = validateActions(Array.isArray(parsed.actions) ? parsed.actions : []);
      validationErrors = [...topLevel.errors, ...actionLevel.errors];
    }

    if (validationErrors.length === 0 && normalized) break;

    if (round === LIMITS.MAX_REPAIR_ROUNDS) {
      throw new Error(`模型结构校验失败：${validationErrors.join("；")}`);
    }

    if (llm.getCallCount() >= LIMITS.MAX_TOTAL_LLM_CALLS) {
      throw new Error(`超过最大模型调用次数：${LIMITS.MAX_TOTAL_LLM_CALLS}`);
    }

    stages.push({
      title: `SECTION 3 · Validation Failed (round ${round + 1})`,
      status: "error",
      detail: { errors: validationErrors }
    });

    const repairMessages = buildRepairMessages({
      rawText,
      errors: validationErrors,
      systemPrompt: context.systemPrompt
    });

    const repaired = await llm.call(repairMessages, `结构修复 round ${round + 1}`);
    rawText = extractTextFromModelResponse(repaired);
  }

  const confidence = Number.isFinite(normalized.confidence)
    ? Math.max(0, Math.min(1, normalized.confidence))
    : null;

  const ambiguity = detectClientAmbiguity(inputText, clients);
  const forcedClarify = Boolean(ambiguity.ambiguous);
  const shouldClarify = Boolean(normalized.needs_clarification) || forcedClarify;
  const finalClarifyingQuestion = shouldClarify
    ? (normalized.clarifying_question || buildAmbiguityQuestion(ambiguity))
    : "";
  const actions = shouldClarify ? [] : normalized.actions;

  const semanticDetail = buildSemanticDetail(normalized, ambiguity);
  stages.push({
    title: "SECTION 4 · Semantic Understanding（语义理解）",
    status: "ok",
    detail: {
      confidence,
      needsClarification: shouldClarify,
      ...semanticDetail,
      actionCount: actions.length
    }
  });

  const dependencyDetail = buildDependencyDetail({ normalized, actions, shouldClarify, ambiguity });
  stages.push({
    title: "SECTION 5 · Dependency Check（依赖检查）",
    status: dependencyDetail.passed ? "ok" : "error",
    detail: dependencyDetail
  });

  stages.push({
    title: "SECTION 6 · Focus Resolution（对焦决策）",
    status: "ok",
    detail: buildFocusDetail(normalized, actions, clients)
  });

  stages.push({
    title: "SECTION 7 · Routing Dispatch（路由分发）",
    status: actions.length > 0 ? "ok" : "skipped",
    detail: buildRoutingDetail(actions)
  });

  stages.push({
    title: "SECTION 8 · Call Statistics（调用统计）",
    status: "ok",
    detail: {
      model: llm.model,
      endpoint: llm.requestUrl,
      totalLLMCalls: llm.getCallCount(),
      callLog: llm.callLog,
      elapsedMs: Date.now() - startedAt
    }
  });

  return {
    userText: inputText,
    reply: shouldClarify && finalClarifyingQuestion
      ? finalClarifyingQuestion
      : normalized.reply,
    confidence,
    needsClarification: shouldClarify,
    clarifyingQuestion: finalClarifyingQuestion,
    focusChange: normalized.focus_change,
    intents: normalized.intents,
    actions,
    stages,
    requestMeta: {
      ...context,
      usedMessages: context.messages,
      rawTextPreview: clipText(rawText, 1200)
    }
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

  if (stage.title.includes("Prompt Assembly")) {
    body = (
      <>
        <KV label="客户数" value={d.clientCount} mono />
        <KV label="历史轮次" value={d.historyTurnsUsed} mono />
        <KV label="消息数" value={d.messageCount} mono />
      </>
    );
  } else if (stage.title.includes("Raw Output")) {
    body = (
      <>
        {d.usage && (
          <KV
            label="Token"
            value={`入 ${d.usage.prompt_tokens ?? "?"} / 出 ${d.usage.completion_tokens ?? "?"} / 总 ${d.usage.total_tokens ?? "?"}`}
          />
        )}
        <div className="pg-msg-block">
          <div className="pg-msg-role">Raw Preview</div>
          <div className="pg-msg-content">{d.rawPreview || "—"}</div>
        </div>
      </>
    );
  } else if (stage.title.includes("Validation Failed")) {
    body = (
      <ul className="pg-mutation-list">
        {(d.errors || []).map((e, i) => <li key={i}>{e}</li>)}
      </ul>
    );
  } else if (stage.title.includes("Semantic Understanding")) {
    body = (
      <>
        <KV label="置信度" value={d.confidence == null ? "—" : Number(d.confidence).toFixed(2)} mono />
        <KV label="需澄清" value={d.needsClarification ? "是" : "否"} />
        <KV label="识别意图数" value={d.intentCount || 0} mono />
        <KV label="计划动作数" value={d.actionCount || 0} mono />
        <KV label="意图类型" value={(d.intentTypes || []).join("、") || "—"} />
        <KV label="歧义命中" value={d.ambiguityCount || 0} mono />
        <KV label="歧义指代" value={(d.ambiguityMentions || []).join("、") || "—"} />
      </>
    );
  } else if (stage.title.includes("Dependency Check")) {
    body = (
      <>
        <KV label="检查结果" value={d.passed ? "通过" : "未通过"} />
        <ul className="pg-mutation-list">
          {(d.checks || []).map((c, i) => (
            <li key={i}>{c.ok ? "✅" : "❌"} {c.item}：{c.note}</li>
          ))}
        </ul>
      </>
    );
  } else if (stage.title.includes("Focus Resolution")) {
    body = (
      <>
        <KV label="最终对焦" value={(d.focusTargets || []).join("、") || "—"} />
        <KV label="focus_change" value={(d.source?.focus_change || []).join("、") || "—"} />
        <KV label="intents.client" value={(d.source?.intents_client || []).join("、") || "—"} />
        <KV label="actions.client" value={(d.source?.actions_client || []).join("、") || "—"} />
      </>
    );
  } else if (stage.title.includes("Routing Dispatch")) {
    body = (
      <>
        <KV label="动作总数" value={d.totalActions || 0} mono />
        <ul className="pg-mutation-list">
          {(d.routes || []).map((r, i) => (
            <li key={i}>动作 `{r.type}` 共 {r.count} 条，分发到 `{r.handler}`</li>
          ))}
        </ul>
      </>
    );
  } else if (stage.title.includes("Call Statistics")) {
    body = (
      <>
        <KV label="模型" value={d.model} mono />
        <KV label="接口" value={d.endpoint} mono />
        <KV label="总调用" value={d.totalLLMCalls} mono />
        <KV label="耗时" value={`${d.elapsedMs} ms`} mono />
      </>
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

export default function PlaygroundView({ setView, clients, applyPlaygroundActions, standalone = false }) {
  const [inputText, setInputText] = useState("");
  const [chatHistory, setChatHistory] = useState([]);
  const [selectedTurn, setSelectedTurn] = useState(null);
  const [running, setRunning] = useState(false);
  const [showFullPrompt, setShowFullPrompt] = useState(false);
  const [selectedModel, setSelectedModel] = useState("minimax");
  const availableModels = getAvailableModels();

  const chatEndRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, running]);

  const currentTurn = selectedTurn != null
    ? chatHistory[selectedTurn]
    : (chatHistory.length > 0 ? chatHistory[chatHistory.length - 1] : null);

  const promptPanelData = currentTurn?.requestMeta || buildPromptContext(inputText || "...", clients || []);

  const onSend = async () => {
    const text = inputText.trim();
    if (!text || running) return;

    setInputText("");
    setRunning(true);

    const prevHistory = chatHistory
      .filter((t) => t?.userText)
      .map((t) => ({
        userText: t.userText,
        reply: t.reply,
        intents: t.intents,
        actions: t.actions
      }));

    try {
      const result = await runPipeline(text, clients || [], prevHistory, selectedModel);

      const commitResult = typeof applyPlaygroundActions === "function"
        ? applyPlaygroundActions(result.actions || [])
        : { applied: 0, upserted: 0, deleted: 0 };

      const commitStage = {
        title: "SECTION 9 · Processing & Commit to App/DB",
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
    } catch (err) {
      const failedContext = buildPromptContext(text, clients || [], prevHistory);
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
        <span className="playground-title">PLAYGROUND</span>
        <span className="playground-badge">LLM-First · Rule-Driven</span>
      </div>

      <div className="playground-scroll">
        <div className="playground-grid">
          {/* SECTION B · Left Panel: Conversation + Prompt Context */}
          <div className="playground-panel playground-panel-left">
            <div className="section-label">SECTION B1 · 对话区（仅展示模型输入输出）</div>
            <div className="pg-chat-area">
              {chatHistory.length === 0 && !running && (
                <div className="playground-empty" style={{ marginTop: 40 }}>
                  输入自然语言后，系统会把完整上下文发送给大模型，并按返回 JSON 执行。
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
                <div className="pg-prompt-section"><span className="pg-prompt-label">客户数</span><span className="pg-mono">{(promptPanelData.userPayload?.clients || []).length} 条</span></div>
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
                发送消息后，这里会展示完整执行链路（Prompt → LLM → Validation → Commit）。
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
