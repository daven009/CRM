/**
 * MiniMax 模型 Provider
 * 支持 MiniMax M2.5 等模型
 */
import { normalizeApiKey } from './shared.js';

/**
 * 构建 MiniMax API URL（可能需要 GroupId 参数）
 */
const buildMinimaxUrl = (baseUrl, groupId) => {
  const url = new URL(baseUrl);
  if (groupId) {
    const gid = String(groupId).trim();
    if (gid) url.searchParams.set("GroupId", gid);
  }
  return url.toString();
};

/**
 * 创建 MiniMax LLM Caller
 * @returns {{ model: string, requestUrl: string, call: Function, callLog: Array, getCallCount: Function }}
 */
export const createMinimaxCaller = () => {
  const rawApiKey = import.meta.env.VITE_MINIMAX_API_KEY || "";
  const apiKey = normalizeApiKey(rawApiKey);
  const model = (import.meta.env.VITE_MINIMAX_MODEL || "MiniMax-M2.5").trim();
  const baseUrl = (import.meta.env.VITE_MINIMAX_API_URL || "https://api.minimax.io/v1/text/chatcompletion_v2").trim();
  const groupId = (import.meta.env.VITE_MINIMAX_GROUP_ID || "").trim();
  const requestUrl = buildMinimaxUrl(baseUrl, groupId);

  if (!apiKey) {
    throw new Error("未配置 VITE_MINIMAX_API_KEY，请先在 .env.local 中配置。");
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
      throw new Error(`Minimax 请求失败 (${resp.status}): ${text.slice(0, 500)}`);
    }

    const body = await resp.json();
    const bizCode = body?.base_resp?.status_code;
    if (bizCode && bizCode !== 0) {
      const bizMsg = body?.base_resp?.status_msg || "unknown";
      if (bizCode === 1004) {
        throw new Error(`Minimax 鉴权失败（1004）：${bizMsg}`);
      }
      throw new Error(`Minimax 业务错误 (${bizCode})：${bizMsg}`);
    }

    callLog.push({ callId, label, usage: body?.usage || null });
    return body;
  };

  return {
    model,
    provider: "minimax",
    requestUrl,
    call,
    callLog,
    getCallCount: () => callCount
  };
};
