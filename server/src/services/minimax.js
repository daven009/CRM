/**
 * MiniMax Chat Service (后端)
 * 迁移自前端 src/lib/models/minimax.js
 */
import { config } from '../config/env.js';

export const callMinimax = async (messages, { temperature = 0.2 } = {}) => {
  const { apiKey, model, requestUrl } = config.minimax;
  if (!apiKey) throw Object.assign(new Error('未配置 MINIMAX_API_KEY'), { statusCode: 500 });

  const resp = await fetch(requestUrl, {
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
      new Error(`MiniMax 请求失败 (${resp.status}): ${text.slice(0, 500)}`),
      { statusCode: resp.status, code: 'MINIMAX_ERROR' }
    );
  }

  const body = await resp.json();
  const bizCode = body?.base_resp?.status_code;
  if (bizCode && bizCode !== 0) {
    const bizMsg = body?.base_resp?.status_msg || 'unknown';
    throw Object.assign(
      new Error(`MiniMax 业务错误 (${bizCode}): ${bizMsg}`),
      { statusCode: 400, code: `MINIMAX_${bizCode}` }
    );
  }

  return body;
};
