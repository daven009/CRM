/**
 * 会话上下文管理
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
 * @property {string} conversation_summary    - 滚动摘要，建议 ≤ 200 字
 * @property {Array} recent_messages          - 最近 N 轮原始消息
 */

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
    recent_messages: []
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
 * 追加对话到 recent_messages 并更新 summary
 * @param {ConversationContext} ctx
 * @param {string} userInput
 * @param {string} aiReply
 * @param {number} [maxMessages=10]
 * @returns {ConversationContext}
 */
export function appendMessage(ctx, userInput, aiReply, maxMessages = 10) {
  const msgs = [...(ctx.recent_messages || []), { user: userInput, ai: aiReply }];
  const trimmed = msgs.slice(-maxMessages);

  // 滚动摘要：保留最近几轮的用户+AI关键信息
  // 必须包含 AI 回复摘要，否则后续轮次 LLM 无法理解用户回复的上下文
  const summary = trimmed
    .slice(-3)
    .map((m, i) => {
      const userPart = `用户: ${(m.user || '').slice(0, 50)}`;
      const aiPart = m.ai ? `AI: ${(m.ai || '').slice(0, 80)}` : '';
      return `[${i + 1}] ${userPart}${aiPart ? ' → ' + aiPart : ''}`;
    })
    .join(' | ');

  return {
    ...ctx,
    recent_messages: trimmed,
    conversation_summary: summary.slice(0, 200)
  };
}
