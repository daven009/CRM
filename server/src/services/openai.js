/**
 * OpenAI Chat Service (后端)
 * 迁移自前端 src/lib/models/openai.js
 */
import { config } from '../config/env.js';

export const callOpenAI = async (messages, { temperature = 0.2 } = {}) => {
  const { apiKey, model, apiUrl } = config.openai;
  if (!apiKey) throw Object.assign(new Error('未配置 OPENAI_API_KEY'), { statusCode: 500 });

  const resp = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, temperature, stream: false }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw Object.assign(
      new Error(`OpenAI 请求失败 (${resp.status}): ${text.slice(0, 500)}`),
      { statusCode: resp.status, code: 'OPENAI_ERROR' }
    );
  }

  const body = await resp.json();
  if (body?.error) {
    const code = body.error.code || body.error.type || 'unknown';
    throw Object.assign(
      new Error(`OpenAI 业务错误 (${code}): ${body.error.message}`),
      { statusCode: 400, code }
    );
  }

  return body;
};
