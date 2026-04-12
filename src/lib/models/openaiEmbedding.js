/**
 * OpenAI Embedding API 封装
 * 
 * 使用 text-embedding-3-small 模型生成文本向量
 * 支持单条和批量 embedding
 */
import { normalizeApiKey } from './shared.js';
import { getRuntimeEnv } from './env.js';

const DEFAULT_MODEL = 'text-embedding-3-small';
const DEFAULT_DIMENSIONS = 256; // 降维到 256 维，节省存储和计算，精度损失极小

/**
 * 调用 OpenAI Embedding API
 * @param {string|string[]} input - 单条文本或文本数组
 * @param {Object} [options]
 * @param {string} [options.model] - embedding 模型名
 * @param {number} [options.dimensions] - 向量维度
 * @returns {Promise<number[][]>} 向量数组
 */
export const createEmbeddings = async (input, options = {}) => {
  const env = getRuntimeEnv();
  const rawApiKey = env.VITE_OPENAI_API_KEY || '';
  const apiKey = normalizeApiKey(rawApiKey);
  const baseUrl = String(env.VITE_OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions').trim();
  // 推导 embedding URL：将 chat/completions 替换为 embeddings
  const embeddingUrl = baseUrl.replace(/\/chat\/completions\/?$/, '/embeddings');
  
  const model = options.model || env.VITE_OPENAI_EMBEDDING_MODEL || DEFAULT_MODEL;
  const dimensions = options.dimensions || DEFAULT_DIMENSIONS;

  if (!apiKey) {
    throw new Error('未配置 VITE_OPENAI_API_KEY，无法生成 embedding。');
  }

  const texts = Array.isArray(input) ? input : [input];
  if (texts.length === 0) return [];

  // 清理空文本
  const cleanTexts = texts.map(t => String(t || '').trim()).filter(Boolean);
  if (cleanTexts.length === 0) return [];

  const resp = await fetch(embeddingUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      input: cleanTexts,
      dimensions,
      encoding_format: 'float'
    })
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Embedding 请求失败 (${resp.status}): ${text.slice(0, 500)}`);
  }

  const body = await resp.json();
  if (body?.error) {
    throw new Error(`Embedding API 错误: ${body.error.message || 'unknown'}`);
  }

  // 按 index 排序确保顺序正确
  const sorted = (body.data || []).sort((a, b) => a.index - b.index);
  return sorted.map(item => item.embedding);
};

/**
 * 为单条文本生成 embedding
 * @param {string} text
 * @returns {Promise<number[]>}
 */
export const embedText = async (text) => {
  const results = await createEmbeddings([text]);
  return results[0] || [];
};

/**
 * 计算两个向量的余弦相似度
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number} 0~1 之间的相似度
 */
export const cosineSimilarity = (a, b) => {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
};

/**
 * 在一组向量中搜索与 query 最相似的 Top-K
 * @param {number[]} queryEmbedding - 查询向量
 * @param {Array<{id: string, embedding: number[]}>} candidates - 候选向量列表
 * @param {number} [topK=8] - 返回前 K 个
 * @param {number} [minScore=0.3] - 最低相似度阈值
 * @returns {Array<{id: string, score: number}>}
 */
export const searchSimilar = (queryEmbedding, candidates, topK = 8, minScore = 0.3) => {
  if (!queryEmbedding || !candidates || candidates.length === 0) return [];

  const scored = candidates
    .filter(c => c.embedding && c.embedding.length > 0)
    .map(c => ({
      id: c.id,
      score: cosineSimilarity(queryEmbedding, c.embedding)
    }))
    .filter(c => c.score >= minScore)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, topK);
};
