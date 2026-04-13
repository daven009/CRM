import { extractTextFromModelResponse, normalizeApiKey } from "./shared.js";

const buildOpenAIUrl = (baseUrl) => String(baseUrl || "").trim();

/* ─── 共享常量 ─────────────────────────────────── */

/** 发给 LLM 的 transcript 最大字符数（约 2000 tokens，足够做摘要/压缩） */
const MAX_TRANSCRIPT_CHARS = 3000;

/* ─── 内部工具函数 ─────────────────────────────── */

/**
 * 将 history 数组转为 transcript 文本
 * @param {Array} history - [{ r: "user"|"ai", t: "..." }]
 * @returns {string}
 */
const buildTranscript = (history) =>
  (Array.isArray(history) ? history : [])
    .map((item) => `${item?.r === "ai" ? "Agent" : "User"}: ${String(item?.t || "").trim()}`)
    .filter((line) => !line.endsWith(":"))
    .join("\n");

/**
 * 智能截断 transcript：保留头部 30% + 尾部 70%，中间用省略标记
 * 确保关键信息（开头背景 + 最新进展）不丢失
 * @param {string} text
 * @param {number} [maxChars=MAX_TRANSCRIPT_CHARS]
 * @returns {string}
 */
const truncateTranscript = (text, maxChars = MAX_TRANSCRIPT_CHARS) => {
  if (!text || text.length <= maxChars) return text;
  const headBudget = Math.floor(maxChars * 0.3);
  const tailBudget = maxChars - headBudget - 40; // 40 chars for separator
  const head = text.slice(0, headBudget);
  const tail = text.slice(-tailBudget);
  return `${head}\n\n…（中间 ${text.length - headBudget - tailBudget} 字已省略）…\n\n${tail}`;
};

/**
 * 共享的 LLM 调用封装
 * @param {Array} messages - OpenAI messages
 * @param {Object} opts - { apiKey, model, requestUrl, temperature }
 * @returns {Promise<string|null>}
 */
const callLLM = async (messages, { apiKey, model, requestUrl, temperature = 0.1 }) => {
  const resp = await fetch(requestUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({ model, messages, temperature, stream: false })
  });
  if (!resp.ok) return null;
  const body = await resp.json();
  return extractTextFromModelResponse(body).replace(/^["'""]+|["'""]+$/g, "").trim() || null;
};

/**
 * 获取 LLM 配置（apiKey / model / requestUrl）
 * @returns {{ apiKey: string, model: string, requestUrl: string } | null} null 表示未配置
 */
const getLLMConfig = () => {
  const apiKey = normalizeApiKey(import.meta.env.VITE_OPENAI_API_KEY || "");
  if (!apiKey) return null;
  return {
    apiKey,
    model: (import.meta.env.VITE_OPENAI_MODEL || "gpt-4o-mini").trim(),
    requestUrl: buildOpenAIUrl(import.meta.env.VITE_OPENAI_API_URL || "https://api.openai.com/v1/chat/completions")
  };
};

const fallbackConversationSummary = (history = [], clientName = "") => {
  const userTurns = (Array.isArray(history) ? history : [])
    .filter((item) => item?.r === "user")
    .map((item) => String(item?.t || "").trim())
    .filter(Boolean);

  if (userTurns.length > 0) {
    const firstTurn = userTurns[0].replace(/\s+/g, " ").trim();
    return firstTurn.length > 24 ? `${firstTurn.slice(0, 24)}…` : firstTurn;
  }

  return clientName ? `与${clientName}沟通记录` : "沟通记录";
};

/* ─── 导出函数 ─────────────────────────────────── */

/**
 * 对话归档时生成 timeline 短摘要（8-24 字）
 * 修复：对长对话做智能截断，避免 token 溢出
 */
export const summarizeConversationWithOpenAI = async ({ history, clientName = "" }) => {
  const config = getLLMConfig();
  if (!config) return fallbackConversationSummary(history, clientName);

  const rawTranscript = buildTranscript(history);
  if (!rawTranscript.trim()) return fallbackConversationSummary(history, clientName);

  // 关键修复：智能截断，避免长对话 token 溢出
  const transcript = truncateTranscript(rawTranscript);

  const messages = [
    {
      role: "system",
      content: "你是 CRM 时间线摘要助手。请根据一次对话记录生成一句非常短的中文摘要，只输出摘要本身，不要引号，不要解释。"
    },
    {
      role: "user",
      content: `联系人：${clientName || "未命名联系人"}\n请基于下面这次对话，生成一句适合展示在 timeline 里的短摘要。\n要求：\n1. 只输出一句中文短摘要；\n2. 长度控制在 8 到 24 个汉字左右；\n3. 要保留关键信息，如需求、进展、承诺、下一步动作；\n4. 不要写"进行了一次沟通""完成了一次对话"这种空话。\n\n对话记录：\n${transcript}`
    }
  ];

  try {
    const summary = await callLLM(messages, { ...config, temperature: 0.1 });
    return summary || fallbackConversationSummary(history, clientName);
  } catch {
    return fallbackConversationSummary(history, clientName);
  }
};

/**
 * 渐进式对话压缩（LLM 语义压缩）
 *
 * 将旧对话轮次 + 已有压缩摘要合并为新的结构化压缩摘要。
 * 输出为纯文本，≤300 字，保留所有关键信息。
 *
 * @param {Object} params
 * @param {string} params.existingSummary - 已有的压缩摘要（可为空字符串）
 * @param {Array} params.messagesToCompress - 需要压缩的对话轮次 [{ user, ai }]
 * @param {string} [params.focusClientName] - 当前焦点客户名称
 * @returns {Promise<string>} 压缩后的摘要文本，≤300 字
 */
export const compressConversation = async ({ existingSummary = "", messagesToCompress = [], focusClientName = "" }) => {
  // 没有内容需要压缩
  if (messagesToCompress.length === 0 && !existingSummary) return "";

  // 构建待压缩的对话文本
  const newTranscript = messagesToCompress
    .map((m, i) => `[轮${i + 1}] 用户: ${(m.user || "").slice(0, 200)} → AI: ${(m.ai || "").slice(0, 300)}`)
    .join("\n");

  // 如果只有很短的内容，无需调用 LLM，直接拼接
  const combinedLength = (existingSummary || "").length + newTranscript.length;
  if (combinedLength <= 300) {
    return [existingSummary, newTranscript].filter(Boolean).join("\n").slice(0, 300);
  }

  const config = getLLMConfig();
  if (!config) {
    // 无 API Key：降级为简单拼接截断
    return fallbackCompress(existingSummary, messagesToCompress);
  }

  const messages = [
    {
      role: "system",
      content: `你是 CRM 对话记忆压缩助手。你的任务是将历史对话压缩为一段结构化的信息摘要。

规则：
1. 输出纯中文文本，不超过 300 字
2. 必须保留：客户姓名、关键需求、已达成的共识/承诺、待跟进事项、重要偏好和数字（如预算、日期、人数）
3. 去除：寒暄、重复确认、语气词、冗余解释
4. 格式：用简洁的短句，按主题分组，不需要标题或序号
5. 如果已有历史摘要，将新对话信息合并进去，去除重复信息
6. 只输出摘要本身，不要引号，不要解释`
    },
    {
      role: "user",
      content: `${focusClientName ? `当前客户：${focusClientName}\n` : ""}${existingSummary ? `【已有历史摘要】\n${existingSummary}\n\n` : ""}【新增对话记录】\n${truncateTranscript(newTranscript, 2000)}\n\n请将以上内容压缩为不超过 300 字的信息摘要。`
    }
  ];

  try {
    const compressed = await callLLM(messages, { ...config, temperature: 0.05 });
    if (compressed) return compressed.slice(0, 350); // 容错裁剪
    return fallbackCompress(existingSummary, messagesToCompress);
  } catch {
    return fallbackCompress(existingSummary, messagesToCompress);
  }
};

/**
 * 降级压缩：无 LLM 时的本地截断方案
 */
const fallbackCompress = (existingSummary, messages) => {
  const parts = [];
  if (existingSummary) parts.push(existingSummary.slice(0, 150));
  messages.forEach((m) => {
    const user = (m.user || "").slice(0, 40);
    const ai = (m.ai || "").slice(0, 60);
    if (user) parts.push(`用户:${user}→${ai}`);
  });
  return parts.join(" | ").slice(0, 300);
};
