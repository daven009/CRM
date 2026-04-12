import { createLLMCaller, extractTextFromModelResponse } from "./models/index.js";
import { buildKnowledgeContext, normalizeKnowledgeSource } from "./knowledgeSources.js";
import { retrieveRelevantKnowledge } from "./knowledgeEmbedding.js";

export const ACTION_WHITELIST = [
  "add_trait", "remove_trait",
  "add_todo", "complete_todo", "update_todo", "delete_todo",
  "update_profile", "add_relation", "create_profile",
  "trigger_event_chain"
];

export const ACTION_SCHEMA = {
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

export const INTENT_TYPES = ["RECORD", "COMMAND", "QUERY", "KNOWLEDGE", "GENERATE", "RECOMMEND", "CHAT"];

export const LIMITS = {
  MAX_ACTIONS: 30,
  MAX_INTENTS: 12,
  MAX_REPAIR_ROUNDS: 2,
  MAX_TOTAL_LLM_CALLS: 6
};

const SETTINGS_KEY = "crm.settings.v1";
const DEFAULT_MATERIAL_LIMIT = 5;
const MATERIAL_EXCERPT_LIMIT = 24000;

export const clipText = (value, max = 220) => {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

const normalizeMaterialEntry = (value) => {
  if (typeof value === "string") {
    return {
      name: value,
      kind: "file",
      summary: value,
      details: [],
      tags: [],
      promptContext: value,
      extractedText: ""
    };
  }

  return {
    id: value?.id || "",
    name: value?.name || "Untitled",
    kind: value?.kind || "file",
    summary: String(value?.summary || "").trim(),
    details: Array.isArray(value?.details) ? value.details.map((item) => String(item || "").trim()).filter(Boolean) : [],
    tags: Array.isArray(value?.tags) ? value.tags.map((item) => String(item || "").trim()).filter(Boolean) : [],
    promptContext: String(value?.promptContext || "").trim(),
    extractedText: clipText(value?.extractedText || "", MATERIAL_EXCERPT_LIMIT),
    parsedPreview: value?.parsedPreview || null,
    uploadedAt: value?.uploadedAt || ""
  };
};

export const buildMaterialContext = (files = [], maxItems = DEFAULT_MATERIAL_LIMIT) => (Array.isArray(files) ? files : [])
  .slice(0, maxItems)
  .map(normalizeMaterialEntry)
  .map((file, index) => ({
    index: index + 1,
    name: file.name,
    kind: file.kind,
    uploadedAt: file.uploadedAt,
    summary: file.summary,
    details: file.details.slice(0, 6),
    tags: file.tags.slice(0, 6),
    promptContext: file.promptContext || file.summary,
    extractedTextExcerpt: file.extractedText,
    parsedPreview: file.parsedPreview
  }));

export const buildTodoContext = (todos = [], maxItems = 12) => (Array.isArray(todos) ? todos : [])
  .filter((todo) => !todo?.done)
  .sort((a, b) => Number(a?.d || 0) - Number(b?.d || 0))
  .slice(0, maxItems)
  .map((todo) => ({
    text: String(todo?.t || "").trim(),
    days: Number.isFinite(Number(todo?.d)) ? Number(todo.d) : 0,
    source: String(todo?.s || "").trim(),
    done: Boolean(todo?.done)
  }))
  .filter((todo) => todo.text);

const isPlainObject = (v) => Object.prototype.toString.call(v) === "[object Object]";

const toPrettyJson = (v) => {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
};

export const loadUserIntelligence = () => {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { domain: "", keywords: [], knowledgeFiles: [] };
    const parsed = JSON.parse(raw);
    return {
      domain: String(parsed?.domain || "").trim(),
      keywords: Array.isArray(parsed?.keywords)
        ? parsed.keywords.map((v) => String(v || "").trim()).filter(Boolean)
        : [],
      knowledgeFiles: Array.isArray(parsed?.knowledgeFiles)
        ? parsed.knowledgeFiles.map((item) => normalizeKnowledgeSource(item)).filter(Boolean)
        : []
    };
  } catch {
    return { domain: "", keywords: [], knowledgeFiles: [] };
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
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
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

export const parseJsonFromText = (raw) => {
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

export const buildClientBrief = (clients = []) => (clients || []).slice(0, 30).map((c) => ({
  id: c.id,
  name: c.n,
  company: c.co,
  role: c.role,
  hp: c.hp,
  todoOpenCount: (c.todos || []).filter((t) => !t.done).length,
  openTodos: buildTodoContext(c.todos, 6),
  materials: buildMaterialContext(c.files, 3).map((item) => item.promptContext || item.summary || item.name).filter(Boolean)
}));

const buildSystemPrompt = ({ currentDate, currentYear, domain, keywords, lockedClient, materialLimit, knowledgeContext }) => `你是 RelateAI（Customer Relationship Management 语义理解及行为路由编排器）。

# 用户Profile
- 用户的角色是：保险中介
- 用户的专业领域是：${domain || "未指定"}
- 用户当前重点关注的机会关键词：${keywords.length > 0 ? keywords.join("、") : "未指定"}
- 当用户请求分析、建议、跟进策略、话术生成时，优先结合上述领域和关键词进行判断。
- 若领域或关键词为空，不要编造额外偏好，按通用 CRM 助手处理。

# 当前会话焦点
${lockedClient
    ? `- 当前联系人已锁定：${lockedClient.n}（${lockedClient.co || "公司待补充"}，id:${lockedClient.id}）。\n- 若用户没有明确提到其他联系人，则默认所有 intents、actions、reply 都围绕该联系人展开。\n- 不要再向用户追问“你指的是谁”，除非用户显式切换到其他联系人。`
    : "- 当前没有锁定联系人。若用户提及联系人不明确，必须触发澄清。"}
- 若当前联系人存在资料文件（Data），你必须将这些资料视为强上下文，在分析需求、生成建议、起草话术、判断下一步动作时优先引用，不要忽略其中的数字、时间、金额、承诺、方案细节。
- 若资料中同时存在 summary / promptContext / extractedTextExcerpt / parsedPreview，信息优先级应为：extractedTextExcerpt 和 parsedPreview > promptContext > details > summary。
- 若摘要内容与原始抽取内容（extractedTextExcerpt / parsedPreview）不一致，必须以原始抽取内容为准，不要被旧摘要误导。
- ${knowledgeContext.items.length > 0
    ? `当前已注入 ${knowledgeContext.includedCount} 份用户知识文档（总量 ${knowledgeContext.totalCount} 份）。`
    : "当前没有用户知识文档。"}
- 若用户上传了知识文档（Knowledge），这些文档是用户自己的知识库。回答知识问答、方案建议、话术生成、产品比较和行动建议时，优先参考 knowledge_sources，而不是泛化猜测。
- 若 knowledge_sources 中同时存在 summary / promptContext / extractedTextExcerpt / parsedPreview，优先级同样是 extractedTextExcerpt 和 parsedPreview > promptContext > details > summary。
- 若 knowledge_sources_meta.truncated = true，你必须始终区分“全集总量”和“当前注入子集”，绝对不能把当前注入数量误说成全集总量。
- 如果用户询问知识库中的数量、要求枚举、要求汇总、要求“全部展示/完整内容/所有项目”，而 knowledge_sources_meta.truncated = true：
  1) 先回答全集总量 totalCount；
  2) 再明确说明当前回答基于一个被截断的子集，当前只注入了前 includedCount 项；
  3) 如用户继续要求完整展开，再基于全集继续响应；
  4) 若你无法访问全集，只能诚实说明当前仅基于已注入子集回答。
- 若用户询问“待办 / tasks / follow-up / 下一步”，你必须只依据显式提供的待办字段回答，例如 todoOpenCount、openTodos、current_focus_client.open_todos。
- 对于待办问题，禁止从资料文件、保单内容、聊天摘要、traits 或其他上下文中推断或臆造待办事项；如果待办字段不足以支撑“列出全部待办”，必须明确说明你只能根据当前提供的待办字段回答。
- 为控制篇幅，某些上下文集合可能只会提供一个子集，并通过对应的 *_meta 字段告诉你：总量 totalCount、当前注入数量 includedCount、是否截断 truncated、默认上限 defaultLimit。
- 通用规则：当任意上下文集合的 meta.truncated = true 时，你必须始终区分“全集总量”和“当前注入子集”，绝对不能把当前注入数量误说成全集总量。
- 如果用户询问数量、要求枚举、要求汇总、要求“全部展示/完整内容/所有项目”，而相关上下文集合存在 meta.truncated = true：
  1) 先回答全集总量 totalCount；
  2) 再明确说明当前回答基于一个被截断的子集，当前只注入了前 includedCount 项；
  3) 如用户继续要求完整展开，再基于全集继续响应；
  4) 若你无法访问全集，只能诚实说明当前仅基于已注入子集回答。

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
- 在不偏离用户原始意图的前提下，优先从用户专业领域和重点关键词相关的机会切入。
- 对于明确的 QUERY / COMMAND / RECORD，默认先直接返回事实结果或执行结果，不要自动扩展成泛化建议、销售分析或下一步引导；只有当用户显式要求“建议 / 策略 / 怎么做 / 继续展开”时，才补充分析。
- 对于明确查询，reply 尽量短，优先回答数值、列表、是否存在、最新状态等结果。
- 对于明确命令，reply 尽量短，优先回答“已更新 / 已记录 / 已删除 / 已完成 / 已创建”等执行结果。

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
- KNOWLEDGE：行业知识问答，不直接改动 CRM 数据。
- GENERATE：生成文本/内容草稿。
- RECOMMEND：请求建议或策略。
- RECORD：记录客户事实、偏好、动态。
- COMMAND：明确执行指令，通常需要动作落库。
- CHAT：闲聊、寒暄、或意图不明确。

# Intent 选择边界
- 同一句可有多个 intent，但必须按主次排序，主意图放前面。
- 只要涉及明确数据变更诉求，必须包含 COMMAND 或 RECORD，并给出可执行 actions。
- 纯知识问答/泛讨论优先 KNOWLEDGE 或 CHAT，actions 应为空。
- 若信息不足或对象不明确，needs_clarification=true，actions=[]。
- 若主意图是 QUERY / COMMAND / RECORD，reply 应优先保持简短，不要把回答扩展成大段顾问式建议。

# Action 定义
- add_trait：为客户画像添加标签、特征或偏好。
- remove_trait：从客户画像中移除已有的标签或特征。
- add_todo：创建一条新的待办任务。
- complete_todo：将已存在的待办标记为已完成。
- update_todo：修改已有待办的内容、时间、优先级等字段。
- delete_todo：删除一条待办任务（不是完成，而是作废）。
- update_profile：更新客户的基础档案字段。updates 对象的 key 必须使用以下缩写：
  - "bd"：生日（格式：YYYY.MM.DD，如 "1993.03.22"）
  - "co"：公司名
  - "role"：职位/职业
  - "tel"：电话号码
  - "ps"：性格/备注
  - "n"：姓名
  示例: { "type": "update_profile", "clientId": 1, "updates": { "bd": "1993.03.22", "tel": "13800138000" } }
- add_relation：在客户之间建立关系链接（家庭、同事、转介绍等）。
- create_profile：新建一个客户档案。
- trigger_event_chain：触发一个预设的事件链或自动化流程。

# 强规则
1) action.type 只能从白名单中选，必须小写 snake_case。
2) 每个 action 必须包含 schema 规定字段。
3) 无法确定客户、客户重名，或同一称谓命中多人（如“张总”对应多位）时：
   - needs_clarification = true
   - actions = []
   - clarifying_question 必须给出候选客户（至少含姓名+公司或 id）供用户选择
4) 如果有 add_todo，todo 必须具体可执行，避免空泛措辞。
5) add_trait.trait 必须是人类可读的关系标签。
6) add_trait.trait 禁止机器字段/键名/编码样式。
7) “今天见面/联系日期”这类事实优先写入 add_todo.text 或 update_profile.updates，不要伪装成 trait。
8) 输出必须可被 JSON.parse 直接解析。`;

export const buildCrmPromptContext = (inputText, clients, conversationHistory = [], options = {}) => {
  const clientBrief = buildClientBrief(clients);
  const now = new Date();
  const currentDate = now.toISOString().slice(0, 10);
  const currentYear = now.getFullYear();
  const { domain, keywords, knowledgeFiles } = loadUserIntelligence();
  const lockedClient = options?.lockedClient || null;
  const materialLimit = Number.isFinite(Number(options?.materialLimit)) ? Number(options.materialLimit) : DEFAULT_MATERIAL_LIMIT;
  // 优先使用预检索的知识上下文（语义检索结果），否则回退到旧的静态构建
  const knowledgeContext = options?._preRetrievedKnowledge || buildKnowledgeContext(knowledgeFiles);
  const systemPrompt = buildSystemPrompt({ currentDate, currentYear, domain, keywords, lockedClient, materialLimit, knowledgeContext });
  const lockedClientMaterials = lockedClient ? buildMaterialContext(lockedClient.files, materialLimit) : [];
  const lockedClientTodos = lockedClient ? buildTodoContext(lockedClient.todos, 20) : [];

  const normalizedHistory = (conversationHistory || [])
    .filter((turn) => turn?.userText);

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
    user_profile: {
      role: "保险中介",
      domain,
      keywords
    },
    current_focus_client: lockedClient
      ? {
        id: lockedClient.id,
        name: lockedClient.n,
        company: lockedClient.co,
        role: lockedClient.role,
        hp: lockedClient.hp,
        todo_open_count: (lockedClient.todos || []).filter((todo) => !todo?.done).length,
        open_todos: lockedClientTodos,
        materials: lockedClientMaterials,
        materials_total_count: Array.isArray(lockedClient.files) ? lockedClient.files.length : 0,
        materials_truncated: Array.isArray(lockedClient.files) ? lockedClient.files.length > materialLimit : false
      }
      : null,
    client_materials: lockedClient
      ? lockedClientMaterials
      : [],
    client_materials_meta: lockedClient
      ? {
        totalCount: Array.isArray(lockedClient.files) ? lockedClient.files.length : 0,
        includedCount: lockedClientMaterials.length,
        truncated: Array.isArray(lockedClient.files) ? lockedClient.files.length > materialLimit : false,
        defaultLimit: materialLimit,
        collectionLabel: "client_materials",
        note: Array.isArray(lockedClient.files) && lockedClient.files.length > materialLimit
          ? `该集合已被截断。回答时必须区分全集(totalCount=${lockedClient.files.length})和当前注入子集(includedCount=${materialLimit})，不能混淆。`
          : "当前已注入全部资料。"
      }
      : null,
    knowledge_sources: knowledgeContext.items,
    knowledge_sources_meta: knowledgeContext.totalCount > 0
      ? {
        totalCount: knowledgeContext.totalCount,
        includedCount: knowledgeContext.includedCount,
        truncated: knowledgeContext.truncated,
        defaultLimit: knowledgeContext.defaultLimit,
        collectionLabel: knowledgeContext.collectionLabel,
        note: knowledgeContext.note
      }
      : null,
    time_anchor: {
      currentDate,
      currentYear
    },
    note: lockedClient
      ? "当前联系人已锁定。请默认围绕 current_focus_client 处理，除非用户明确切换到其他联系人。client_materials 内是该联系人的资料上下文，每轮对话都必须优先参考。若 client_materials_meta.truncated=true，你必须知道当前只看到了前几份资料。"
      : "请严格按照 system prompt 的 JSON 协议输出，并严格使用 time_anchor 解释‘今年/现在’。"
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

export const validateTopLevelPayload = (payload) => {
  const errors = [];
  if (!isPlainObject(payload)) return { ok: false, errors: ["输出不是 JSON object"] };
  if (typeof payload.reply !== "string") errors.push("reply 必须是 string");
  else if (!String(payload.reply).trim()) errors.push("reply 不能为空");
  if (!Array.isArray(payload.focus_change)) errors.push("focus_change 必须是 array");
  if (!Array.isArray(payload.intents)) errors.push("intents 必须是 array");
  if (!Array.isArray(payload.actions)) errors.push("actions 必须是 array");
  if (payload.confidence != null && Number.isNaN(Number(payload.confidence))) errors.push("confidence 必须是 number 或 null");
  if (payload.needs_clarification != null && typeof payload.needs_clarification !== "boolean") errors.push("needs_clarification 必须是 boolean");
  if (payload.needs_clarification === true && !String(payload.clarifying_question || "").trim()) errors.push("needs_clarification=true 时 clarifying_question 不能为空");
  payload.intents?.forEach((intent, i) => {
    if (!isPlainObject(intent)) errors.push(`intents[${i}] 必须是 object`);
    else if (!INTENT_TYPES.includes(String(intent.type || ""))) errors.push(`intents[${i}].type 不合法`);
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

export const validateActions = (actions = []) => {
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
      if (action[field] == null || action[field] === "") errors.push(`actions[${i}] 缺少字段: ${field}`);
    });
    if (type === "add_trait") {
      const trait = String(action.trait || "").trim();
      if (!trait) errors.push(`actions[${i}].trait 不能为空`);
      else if (looksLikeMachineField(trait)) errors.push(`actions[${i}].trait 不可为机器字段，请改为人类可读标签`);
    }
  });
  return { ok: errors.length === 0, errors };
};

export const normalizePayload = (payload) => ({
  reply: String(payload?.reply || ""),
  confidence: payload?.confidence == null ? null : Number(payload.confidence),
  needs_clarification: Boolean(payload?.needs_clarification),
  clarifying_question: String(payload?.clarifying_question || ""),
  focus_change: Array.isArray(payload?.focus_change) ? payload.focus_change : [],
  intents: Array.isArray(payload?.intents) ? payload.intents.slice(0, LIMITS.MAX_INTENTS) : [],
  actions: Array.isArray(payload?.actions) ? payload.actions.slice(0, LIMITS.MAX_ACTIONS) : []
});

export const buildRepairMessages = ({ rawText, errors, systemPrompt }) => [
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

const detectClientAmbiguity = (inputText, clients = [], options = {}) => {
  if (options?.lockedClient) return { ambiguous: false, items: [] };
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
      items.push({ mention: name, reason: "重名", candidates: matched.map(toClientDisplay) });
    }
  });

  const surnameMentions = [...text.matchAll(/([\u4e00-\u9fa5])\s*总/g)].map((m) => m?.[1]).filter(Boolean);
  [...new Set(surnameMentions)].forEach((surname) => {
    const matched = (clients || []).filter((c) => String(c?.n || "").startsWith(surname));
    if (matched.length > 1) {
      items.push({ mention: `${surname}总`, reason: "称谓命中多人", candidates: matched.map(toClientDisplay) });
    }
  });

  return { ambiguous: items.length > 0, items };
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

const buildDependencyDetail = ({ normalized, actions, shouldClarify, ambiguity }) => ({
  passed: true,
  checks: [
    { item: "Top-level payload", ok: true, note: "基础字段结构合法" },
    { item: "Action schema", ok: true, note: "所有 action 已通过 schema 校验" },
    {
      item: "Disambiguation gate",
      ok: !ambiguity?.ambiguous || shouldClarify,
      note: ambiguity?.ambiguous ? `检测到指代冲突：${(ambiguity.items || []).map((x) => x.mention).join("、")}` : "未发现同名/称谓冲突"
    },
    {
      item: "Clarification gate",
      ok: !shouldClarify || actions.length === 0,
      note: shouldClarify ? (normalized?.needs_clarification ? "模型判定需澄清，动作已被网关拦截" : "系统判定需澄清，动作已被网关拦截") : "无需澄清，动作可继续分发"
    }
  ]
});

const buildFocusDetail = (normalized, actions, clients = []) => {
  const fromFocus = Array.isArray(normalized?.focus_change) ? normalized.focus_change : [];
  const fromIntents = (normalized?.intents || []).map((it) => String(it?.client || "").trim()).filter(Boolean);
  const fromActions = actions
    .map((a) => resolveClientNameById(clients, a?.clientId) || (a?.clientId == null ? "" : `#${a.clientId}`))
    .filter(Boolean);

  return {
    focusTargets: [...new Set([...fromFocus, ...fromIntents, ...fromActions])],
    source: { focus_change: fromFocus, intents_client: fromIntents, actions_client: fromActions }
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
    routes: Object.entries(buckets).map(([type, count]) => ({ type, count, handler: "applyPlaygroundActions" }))
  };
};

export const runCrmPipeline = async (inputText, clients, conversationHistory = [], modelProvider = "minimax", options = {}) => {
  const startedAt = Date.now();
  const stages = [];

  // 语义检索知识源（在构建 prompt 之前）
  const { knowledgeFiles: kfRaw } = loadUserIntelligence();
  let preRetrievedKnowledge;
  try {
    preRetrievedKnowledge = await retrieveRelevantKnowledge(kfRaw || [], {
      user_message: inputText,
      mentioned_clients: [],
      detected_events: [],
      intents: [],
      conversation_summary: ''
    });
  } catch {
    preRetrievedKnowledge = null;
  }

  const context = buildCrmPromptContext(inputText, clients, conversationHistory, {
    ...options,
    _preRetrievedKnowledge: preRetrievedKnowledge
  });
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
    if (round === LIMITS.MAX_REPAIR_ROUNDS) throw new Error(`模型结构校验失败：${validationErrors.join("；")}`);
    if (llm.getCallCount() >= LIMITS.MAX_TOTAL_LLM_CALLS) throw new Error(`超过最大模型调用次数：${LIMITS.MAX_TOTAL_LLM_CALLS}`);

    stages.push({
      title: `SECTION 3 · Validation Failed (round ${round + 1})`,
      status: "error",
      detail: { errors: validationErrors }
    });

    const repaired = await llm.call(buildRepairMessages({ rawText, errors: validationErrors, systemPrompt: context.systemPrompt }), `结构修复 round ${round + 1}`);
    rawText = extractTextFromModelResponse(repaired);
  }

  const confidence = Number.isFinite(normalized.confidence) ? Math.max(0, Math.min(1, normalized.confidence)) : null;
  const ambiguity = detectClientAmbiguity(inputText, clients, options);
  const forcedClarify = Boolean(ambiguity.ambiguous);
  const shouldClarify = Boolean(normalized.needs_clarification) || forcedClarify;
  const finalClarifyingQuestion = shouldClarify ? (normalized.clarifying_question || buildAmbiguityQuestion(ambiguity)) : "";
  const actions = shouldClarify ? [] : normalized.actions;

  stages.push({
    title: "SECTION 4 · Semantic Understanding（语义理解）",
    status: "ok",
    detail: {
      confidence,
      needsClarification: shouldClarify,
      ...buildSemanticDetail(normalized, ambiguity),
      actionCount: actions.length
    }
  });
  stages.push({
    title: "SECTION 5 · Dependency Check（依赖检查）",
    status: "ok",
    detail: buildDependencyDetail({ normalized, actions, shouldClarify, ambiguity })
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
    reply: shouldClarify && finalClarifyingQuestion ? finalClarifyingQuestion : normalized.reply,
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
