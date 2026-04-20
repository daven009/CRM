/**
 * Claude (Anthropic) 模型 Provider
 * 通过后端 API 代理调用，不再直连 Claude
 * 
 * 后端已处理：消息格式转换、API Key、anthropic-version header
 * 返回格式已由后端统一为 OpenAI 兼容格式
 */
import { apiChat } from '../apiClient.js';

export const createClaudeCaller = () => {
  let callCount = 0;
  const callLog = [];

  const call = async (messages, label = "") => {
    callCount += 1;
    const callId = callCount;

    // 后端会自动处理 Claude 消息格式转换和响应归一化
    const body = await apiChat(messages, { provider: "claude", temperature: 0.2 });

    callLog.push({ callId, label, usage: body?.usage || null });
    return body;
  };

  return {
    model: "claude-via-backend",
    provider: "claude",
    requestUrl: "/api/llm/chat",
    call,
    callLog,
    getCallCount: () => callCount
  };
};
