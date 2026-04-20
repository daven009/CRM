/**
 * OpenAI Embedding API 封装
 * 通过后端 /api/llm/embedding 代理调用
 */
import { apiEmbedding } from '../apiClient.js';

/**
 * 调用后端 Embedding API
 * @param {string|string[]} input - 单条文本或文本数组
 * @param {Object} [options]
 * @returns {Promise<number[][]>} 向量数组
 */
export const createEmbeddings = async (input, options = {}) => {
  const texts = Array.isArray(input) ? input : [input];
  if (texts.length === 0) return [];
  const cleanTexts = texts.map(t => String(t || '').trim()).filter(Boolean);
  if (cleanTexts.length === 0) return [];

  return apiEmbedding(cleanTexts, options);
};

/**
 * 为单条文本生成 embedding
 */
export const embedText = async (text) => {
  const results = await createEmbeddings([text]);
  return results[0] || [];
};

/**
 * 计算两个向量的余弦相似度
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
