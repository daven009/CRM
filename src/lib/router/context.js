/**
 * 会话上下文管理（含渐进式 LLM 压缩）
 *
 * 架构：
 *   compressed_summary (LLM 生成，≤300字)  ← 早期对话的语义精华
 *   +
 *   recent_messages (最近 N 轮原文)          ← 保留完整上下文
 *   +
 *   conversation_summary (最近 3 轮的快照)   ← 快速参考
 *
 * @typedef {Object} Client
 * @property {number} id
 * @property {string} name
 * @property {Object} [profile]
 * @property {string[]} [traits]
 * @property {Array} [todos]
 * @property {Array} [relations]
 * @property {Array} [recent_events]
 */

/**
 * @typedef {Object} ConversationContext
 * @property {string} user_role               - 例如 "保险中介"
 * @property {string} current_date            - ISO date, e.g. "2026-04-08"
 * @property {number} current_year
 * @property {Client | null} focus_client     - 当前讨论中的客户
 * @property {string} conversation_summary    - 最近 3 轮的快照摘要，≤ 200 字
 * @property {string} compressed_summary      - LLM 压缩的历史摘要，≤ 300 字（渐进积累）
 * @property {Array} recent_messages          - 最近 N 轮原始消息
 * @property {boolean} _compressing           - 是否正在进行 LLM 压缩（防并发）
 */

/** 压缩触发阈值：recent_messages 积累到此数量时触发 LLM 压缩 */
const COMPRESS_THRESHOLD = 8;

/** 压缩后保留的最近轮数 */
const KEEP_AFTER_COMPRESS = 4;

/**
 * 创建新的会话上下文
 * @param {string} [userRole='保险中介']
 * @returns {ConversationContext}
 */
export function createContext(userRole = '保险中介') {
  const now = new Date();
  return {
    user_role: userRole,
    current_date: now.toISOString().slice(0, 10),
    current_year: now.getFullYear(),
    focus_client: null,
    conversation_summary: '',
    compressed_summary: '',
    recent_messages: [],
    _compressing: false
  };
}

/**
 * 更新 focus_client
 * @param {ConversationContext} ctx
 * @param {Object|null} client - { id, name }
 * @returns {ConversationContext}
 */
export function updateFocusClient(ctx, client) {
  return {
    ...ctx,
    focus_client: client ? { id: client.id, name: client.n || client.name || '' } : null
  };
}

/**
 * 构建最近 3 轮的快照摘要（同步，零延迟）
 * @param {Array} messages - recent_messages
 * @returns {string}
 */
function buildQuickSummary(messages) {
  return (messages || [])
    .slice(-3)
    .map((m, i) => {
      const userPart = `用户: ${(m.user || '').slice(0, 50)}`;
      const aiPart = m.ai ? `AI: ${(m.ai || '').slice(0, 80)}` : '';
      return `[${i + 1}] ${userPart}${aiPart ? ' → ' + aiPart : ''}`;
    })
    .join(' | ')
    .slice(0, 200);
}

/**
 * 追加对话到 recent_messages 并更新 conversation_summary
 *
 * 此函数是同步的，确保 Pipeline 调用不受影响。
 * 压缩由 maybeCompressHistory 异步触发。
 *
 * @param {ConversationContext} ctx
 * @param {string} userInput
 * @param {string} aiReply
 * @param {number} [maxMessages=12] - 最大保留轮数（提高到 12，给压缩留出缓冲）
 * @returns {ConversationContext}
 */
export function appendMessage(ctx, userInput, aiReply, maxMessages = 12) {
  const msgs = [...(ctx.recent_messages || []), { user: userInput, ai: aiReply }];
  const trimmed = msgs.slice(-maxMessages);
  const summary = buildQuickSummary(trimmed);

  return {
    ...ctx,
    recent_messages: trimmed,
    conversation_summary: summary
  };
}

/**
 * 检查是否需要压缩，如果需要则异步执行 LLM 压缩
 *
 * 调用时机：每次 appendMessage 之后，由 App.jsx 调用
 * 非阻塞：返回 Promise<ConversationContext>，但不影响当前轮次的 Pipeline
 *
 * 流程：
 *   1. recent_messages.length >= COMPRESS_THRESHOLD 时触发
 *   2. 取前 N-KEEP 轮 + 现有 compressed_summary → LLM 压缩
 *   3. 更新 compressed_summary，只保留最近 KEEP 轮在 recent_messages
 *
 * @param {ConversationContext} ctx
 * @param {Function} compressFn - 即 compressConversation from openaiSummary.js
 * @returns {Promise<ConversationContext | null>} 如果执行了压缩返回新 ctx，否则返回 null
 */
export async function maybeCompressHistory(ctx, compressFn) {
  const messages = ctx.recent_messages || [];

  // 未达阈值或正在压缩中 → 跳过
  if (messages.length < COMPRESS_THRESHOLD || ctx._compressing) return null;

  // 计算要压缩的轮次和保留的轮次
  const compressCount = messages.length - KEEP_AFTER_COMPRESS;
  if (compressCount <= 0) return null;

  const toCompress = messages.slice(0, compressCount);
  const toKeep = messages.slice(compressCount);

  try {
    const newCompressed = await compressFn({
      existingSummary: ctx.compressed_summary || '',
      messagesToCompress: toCompress,
      focusClientName: ctx.focus_client?.name || ''
    });

    return {
      ...ctx,
      compressed_summary: newCompressed || ctx.compressed_summary || '',
      recent_messages: toKeep,
      conversation_summary: buildQuickSummary(toKeep),
      _compressing: false
    };
  } catch (err) {
    console.warn('[Context Compress] LLM 压缩失败，保持原状:', err.message);
    return null;
  }
}

/**
 * 获取发给 LLM 的完整上下文摘要
 * 将 compressed_summary + conversation_summary 合并为一段供 prompt 注入的文本
 *
 * @param {ConversationContext} ctx
 * @returns {string}
 */
export function getFullConversationContext(ctx) {
  const parts = [];
  if (ctx.compressed_summary) {
    parts.push(`[历史摘要] ${ctx.compressed_summary}`);
  }
  if (ctx.conversation_summary) {
    parts.push(`[近期对话] ${ctx.conversation_summary}`);
  }
  return parts.join('\n') || '';
}
