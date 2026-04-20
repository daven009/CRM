/**
 * Claude (Anthropic) Chat Service (后端)
 * 迁移自前端 src/lib/models/claude.js
 */
import { config } from '../config/env.js';

/**
 * 将 OpenAI 格式的 messages 转换为 Claude 格式
 */
const convertMessagesForClaude = (messages) => {
  const systemParts = [];
  const chatMessages = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemParts.push(msg.content);
    } else {
      chatMessages.push({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content,
      });
    }
  }

  // Claude 要求 messages 以 user 开头，且 user/assistant 交替
  const merged = [];
  for (const msg of chatMessages) {
    if (merged.length > 0 && merged[merged.length - 1].role === msg.role) {
      merged[merged.length - 1].content += '\n\n' + msg.content;
    } else {
      merged.push({ ...msg });
    }
  }

  return { system: systemParts.join('\n\n'), messages: merged };
};

/**
 * 将 Claude 原生返回转换为 OpenAI 兼容格式
 */
const normalizeClaudeResponse = (claudeResponse) => {
  const textParts = (claudeResponse.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text);

  return {
    choices: [{ message: { role: 'assistant', content: textParts.join('\n').trim() } }],
    usage: claudeResponse.usage
      ? {
          prompt_tokens: claudeResponse.usage.input_tokens,
          completion_tokens: claudeResponse.usage.output_tokens,
          total_tokens:
            (claudeResponse.usage.input_tokens || 0) + (claudeResponse.usage.output_tokens || 0),
        }
      : null,
  };
};

export const callClaude = async (messages, { temperature = 0.2, maxTokens = 4096 } = {}) => {
  const { apiKey, model, apiUrl, anthropicVersion } = config.claude;
  if (!apiKey) throw Object.assign(new Error('未配置 CLAUDE_API_KEY'), { statusCode: 500 });

  const { system, messages: claudeMessages } = convertMessagesForClaude(messages);

  const requestBody = {
    model,
    max_tokens: maxTokens,
    messages: claudeMessages,
    temperature,
  };
  if (system) requestBody.system = system;

  const resp = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': anthropicVersion,
    },
    body: JSON.stringify(requestBody),
  });

  if (!resp.ok) {
    const text = await resp.text();
    let errorDetail = text.slice(0, 500);
    try {
      const errJson = JSON.parse(text);
      errorDetail = errJson?.error?.message || errorDetail;
    } catch { /* noop */ }
    throw Object.assign(
      new Error(`Claude 请求失败 (${resp.status}): ${errorDetail}`),
      { statusCode: resp.status, code: 'CLAUDE_ERROR' }
    );
  }

  const body = await resp.json();
  if (body.type === 'error') {
    throw Object.assign(
      new Error(`Claude API 错误: ${body.error?.message || 'unknown'}`),
      { statusCode: 400, code: 'CLAUDE_ERROR' }
    );
  }

  return normalizeClaudeResponse(body);
};
