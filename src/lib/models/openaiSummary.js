/**
 * 对话摘要和压缩
 * 通过后端 /api/llm/summary 和 /api/llm/compress 代理调用
 */
import { apiSummary, apiCompress } from '../apiClient.js';

/**
 * 对话归档时生成 timeline 短摘要（8-24 字）
 */
export const summarizeConversationWithOpenAI = async ({ history, clientName = "" }) => {
  try {
    return await apiSummary({ history, clientName });
  } catch {
    // 降级：使用本地逻辑
    return fallbackConversationSummary(history, clientName);
  }
};

/**
 * 渐进式对话压缩（LLM 语义压缩）
 */
export const compressConversation = async ({ existingSummary = "", messagesToCompress = [], focusClientName = "" }) => {
  if (messagesToCompress.length === 0 && !existingSummary) return "";

  try {
    return await apiCompress({ existingSummary, messagesToCompress, focusClientName });
  } catch {
    // 降级
    return fallbackCompress(existingSummary, messagesToCompress);
  }
};

/* ─── 降级方案（后端不可用时） ─── */

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
