/**
 * OpenAI Embedding Service (后端)
 * 迁移自前端 src/lib/models/openaiEmbedding.js
 */
import { config } from '../config/env.js';

const DEFAULT_DIMENSIONS = 256;

export const createEmbeddings = async (input, options = {}) => {
  const { apiKey, embeddingUrl, embeddingModel } = config.openai;
  if (!apiKey) throw Object.assign(new Error('未配置 OPENAI_API_KEY'), { statusCode: 500 });

  const model = options.model || embeddingModel;
  const dimensions = options.dimensions || DEFAULT_DIMENSIONS;
  const texts = Array.isArray(input) ? input : [input];
  if (texts.length === 0) return [];

  const cleanTexts = texts.map((t) => String(t || '').trim()).filter(Boolean);
  if (cleanTexts.length === 0) return [];

  const resp = await fetch(embeddingUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: cleanTexts,
      dimensions,
      encoding_format: 'float',
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw Object.assign(
      new Error(`Embedding 请求失败 (${resp.status}): ${text.slice(0, 500)}`),
      { statusCode: resp.status, code: 'EMBEDDING_ERROR' }
    );
  }

  const body = await resp.json();
  if (body?.error) {
    throw Object.assign(
      new Error(`Embedding API 错误: ${body.error.message || 'unknown'}`),
      { statusCode: 400, code: 'EMBEDDING_ERROR' }
    );
  }

  const sorted = (body.data || []).sort((a, b) => a.index - b.index);
  return sorted.map((item) => item.embedding);
};
