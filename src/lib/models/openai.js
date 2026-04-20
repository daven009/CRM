/**
 * OpenAI 模型 Provider
 * 通过后端 API 代理调用，不再直连 OpenAI
 */
import { apiChat } from '../apiClient.js';

export const createOpenAICaller = () => {
  let callCount = 0;
  const callLog = [];

  const call = async (messages, label = "") => {
    callCount += 1;
    const callId = callCount;

    const body = await apiChat(messages, { provider: "openai", temperature: 0.2 });

    callLog.push({ callId, label, usage: body?.usage || null });
    return body;
  };

  return {
    model: "openai-via-backend",
    provider: "openai",
    requestUrl: "/api/llm/chat",
    call,
    callLog,
    getCallCount: () => callCount
  };
};
