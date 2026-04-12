/**
 * OpenAI 模型 Provider
 * 支持 Chat Completions 接口
 */
import { normalizeApiKey } from './shared.js';
import { getRuntimeEnv } from './env.js';

const buildOpenAIUrl = (baseUrl) => String(baseUrl || "").trim();

export const createOpenAICaller = () => {
  const env = getRuntimeEnv();
  const rawApiKey = env.VITE_OPENAI_API_KEY || "";
  const apiKey = normalizeApiKey(rawApiKey);
  const model = (env.VITE_OPENAI_MODEL || "gpt-4o-mini").trim();
  const requestUrl = buildOpenAIUrl(
    env.VITE_OPENAI_API_URL || "https://api.openai.com/v1/chat/completions"
  );

  if (!apiKey) {
    throw new Error("未配置 VITE_OPENAI_API_KEY，请先在 .env.local 中配置。");
  }

  let callCount = 0;
  const callLog = [];

  const call = async (messages, label = "") => {
    callCount += 1;
    const callId = callCount;

    const resp = await fetch(requestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({ model, messages, temperature: 0.2, stream: false })
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`OpenAI 请求失败 (${resp.status}): ${text.slice(0, 500)}`);
    }

    const body = await resp.json();
    const apiError = body?.error;
    if (apiError) {
      const code = apiError?.code || apiError?.type || "unknown";
      const msg = apiError?.message || "unknown";
      if (code === "invalid_api_key") {
        throw new Error(`OpenAI 鉴权失败：${msg}`);
      }
      throw new Error(`OpenAI 业务错误 (${code})：${msg}`);
    }

    callLog.push({ callId, label, usage: body?.usage || null });
    return body;
  };

  return {
    model,
    provider: "openai",
    requestUrl,
    call,
    callLog,
    getCallCount: () => callCount
  };
};
