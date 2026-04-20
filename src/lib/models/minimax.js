/**
 * MiniMax 模型 Provider
 * 通过后端 API 代理调用，不再直连 MiniMax
 */
import { apiChat } from '../apiClient.js';

export const createMinimaxCaller = () => {
  let callCount = 0;
  const callLog = [];

  const call = async (messages, label = "") => {
    callCount += 1;
    const callId = callCount;

    const body = await apiChat(messages, { provider: "minimax", temperature: 0.2 });

    callLog.push({ callId, label, usage: body?.usage || null });
    return body;
  };

  return {
    model: "minimax-via-backend",
    provider: "minimax",
    requestUrl: "/api/llm/chat",
    call,
    callLog,
    getCallCount: () => callCount
  };
};
