/**
 * Claude (Anthropic) 模型 Provider
 * 支持 Claude Opus 4 等模型
 * 
 * Claude API 与 OpenAI 格式的主要区别：
 * 1. 使用 x-api-key 而非 Bearer token
 * 2. system 消息需要单独放在 system 参数中（不在 messages 数组里）
 * 3. 返回格式：{ content: [{ type: "text", text: "..." }], usage: {...} }
 * 4. 需要 anthropic-version header
 */
import { normalizeApiKey } from './shared.js';
import { getRuntimeEnv } from './env.js';

/**
 * 将 OpenAI 格式的 messages 转换为 Claude 格式
 * Claude 要求 system 消息单独提取，messages 中只保留 user/assistant
 * @param {Array} messages - OpenAI 格式的消息数组
 * @returns {{ system: string, messages: Array }}
 */
const convertMessagesForClaude = (messages) => {
  const systemParts = [];
  const chatMessages = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      systemParts.push(msg.content);
    } else {
      chatMessages.push({
        role: msg.role === "assistant" ? "assistant" : "user",
        content: msg.content
      });
    }
  }

  // Claude 要求 messages 必须以 user 开头，且 user/assistant 交替
  // 如果连续两个相同 role 的消息，合并它们
  const merged = [];
  for (const msg of chatMessages) {
    if (merged.length > 0 && merged[merged.length - 1].role === msg.role) {
      merged[merged.length - 1].content += "\n\n" + msg.content;
    } else {
      merged.push({ ...msg });
    }
  }

  return {
    system: systemParts.join("\n\n"),
    messages: merged
  };
};

/**
 * 将 Claude 原生返回转换为 OpenAI 兼容格式
 * 使得下游代码（extractTextFromModelResponse）可以统一处理
 * @param {Object} claudeResponse - Claude API 原始返回
 * @returns {Object} OpenAI 兼容格式
 */
const normalizeClaudeResponse = (claudeResponse) => {
  const textParts = (claudeResponse.content || [])
    .filter(block => block.type === "text")
    .map(block => block.text);

  const text = textParts.join("\n").trim();

  return {
    choices: [{
      message: {
        role: "assistant",
        content: text
      }
    }],
    usage: claudeResponse.usage ? {
      prompt_tokens: claudeResponse.usage.input_tokens,
      completion_tokens: claudeResponse.usage.output_tokens,
      total_tokens: (claudeResponse.usage.input_tokens || 0) + (claudeResponse.usage.output_tokens || 0)
    } : null,
    _raw: claudeResponse
  };
};

/**
 * 创建 Claude LLM Caller
 * @returns {{ model: string, requestUrl: string, call: Function, callLog: Array, getCallCount: Function }}
 */
export const createClaudeCaller = () => {
  const env = getRuntimeEnv();
  const rawApiKey = env.VITE_CLAUDE_API_KEY || "";
  const apiKey = normalizeApiKey(rawApiKey);
  const model = (env.VITE_CLAUDE_MODEL || "claude-sonnet-4-20250514").trim();
  const baseUrl = (env.VITE_CLAUDE_API_URL || "https://api.anthropic.com/v1/messages").trim();
  const anthropicVersion = "2023-06-01";

  if (!apiKey) {
    throw new Error("未配置 VITE_CLAUDE_API_KEY，请先在 .env.local 中配置。");
  }

  let callCount = 0;
  const callLog = [];

  const call = async (messages, label = "") => {
    callCount += 1;
    const callId = callCount;

    // 转换消息格式
    const { system, messages: claudeMessages } = convertMessagesForClaude(messages);

    const requestBody = {
      model,
      max_tokens: 4096,
      messages: claudeMessages,
      temperature: 0.2
    };

    // Claude 的 system 是顶层参数，不在 messages 里
    if (system) {
      requestBody.system = system;
    }

    const resp = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": anthropicVersion,
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify(requestBody)
    });

    if (!resp.ok) {
      const text = await resp.text();
      let errorDetail = text.slice(0, 500);
      try {
        const errJson = JSON.parse(text);
        errorDetail = errJson?.error?.message || errorDetail;
      } catch { /* noop */ }
      throw new Error(`Claude 请求失败 (${resp.status}): ${errorDetail}`);
    }

    const body = await resp.json();

    // 检查 Claude 特有的错误格式
    if (body.type === "error") {
      throw new Error(`Claude API 错误: ${body.error?.message || "unknown"}`);
    }

    // 转换为 OpenAI 兼容格式
    const normalized = normalizeClaudeResponse(body);

    callLog.push({ callId, label, usage: normalized.usage || null });
    return normalized;
  };

  return {
    model,
    provider: "claude",
    requestUrl: baseUrl,
    call,
    callLog,
    getCallCount: () => callCount
  };
};
