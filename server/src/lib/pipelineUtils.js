/**
 * Pipeline 工具函数（从前端 crmPipeline.js 提取）
 * 
 * 提供 Pipeline 编排所需的常量、校验、解析等纯函数
 * 无浏览器依赖（不使用 localStorage）
 */

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

const DEFAULT_MATERIAL_LIMIT = 5;
const MATERIAL_EXCERPT_LIMIT = 24000;

export const clipText = (value, max = 220) => {
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

/* ─── 资料 & 待办 上下文构建 ───────────────────────── */

const normalizeMaterialEntry = (value) => {
  if (typeof value === "string") {
    return {
      name: value, kind: "file", summary: value, details: [],
      tags: [], promptContext: value, extractedText: ""
    };
  }
  return {
    id: value?.id || "",
    name: value?.name || "Untitled",
    kind: value?.kind || "file",
    summary: String(value?.summary || "").trim(),
    details: Array.isArray(value?.details) ? value.details.map(i => String(i || "").trim()).filter(Boolean) : [],
    tags: Array.isArray(value?.tags) ? value.tags.map(i => String(i || "").trim()).filter(Boolean) : [],
    promptContext: String(value?.promptContext || "").trim(),
    extractedText: clipText(value?.extractedText || "", MATERIAL_EXCERPT_LIMIT),
    parsedPreview: value?.parsedPreview || null,
    uploadedAt: value?.uploadedAt || ""
  };
};

export const buildMaterialContext = (files = [], maxItems = DEFAULT_MATERIAL_LIMIT) =>
  (Array.isArray(files) ? files : [])
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

export const buildTodoContext = (todos = [], maxItems = 12) =>
  (Array.isArray(todos) ? todos : [])
    .filter(todo => !todo?.done)
    .sort((a, b) => Number(a?.d || 0) - Number(b?.d || 0))
    .slice(0, maxItems)
    .map(todo => ({
      text: String(todo?.t || "").trim(),
      days: Number.isFinite(Number(todo?.d)) ? Number(todo.d) : 0,
      source: String(todo?.s || "").trim(),
      done: Boolean(todo?.done)
    }))
    .filter(todo => todo.text);

export const buildClientBrief = (clients = []) =>
  (clients || []).slice(0, 30).map(c => ({
    id: c.id,
    name: c.n,
    company: c.co,
    role: c.role,
    hp: c.hp,
    todoOpenCount: (c.todos || []).filter(t => !t.done).length,
    openTodos: buildTodoContext(c.todos, 6),
    materials: buildMaterialContext(c.files, 3).map(item => item.promptContext || item.summary || item.name).filter(Boolean)
  }));

/* ─── JSON 解析 ───────────────────────────────────── */

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
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") { if (depth === 0) start = i; depth += 1; continue; }
    if (ch === "}") {
      if (depth > 0) depth -= 1;
      if (depth === 0 && start >= 0) { results.push(source.slice(start, i + 1)); start = -1; }
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
  fenceMatches.forEach(m => { if (m?.[1]) candidates.push(String(m[1]).trim()); });
  extractBalancedJsonObjects(text).forEach(snippet => candidates.push(snippet));

  let best = null;
  let bestScore = -1;

  for (const c of candidates) {
    for (const attempt of [c, c.replace(/\r?\n/g, "\\n")]) {
      try {
        const parsed = JSON.parse(attempt);
        const score = scorePayloadShape(parsed);
        if (score > bestScore) { best = parsed; bestScore = score; }
      } catch { /* noop */ }
    }
  }
  return best;
};

/* ─── Action 校验 ─────────────────────────────────── */

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
    if (!isPlainObject(action)) { errors.push(`actions[${i}] 不是 object`); return; }
    const type = String(action.type || "");
    if (!ACTION_WHITELIST.includes(type)) { errors.push(`actions[${i}].type 非白名单: ${type || "<empty>"}`); return; }
    const required = ACTION_SCHEMA[type] || [];
    required.forEach(field => {
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

/* ─── Repair Messages 构建 ─────────────────────────── */

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
