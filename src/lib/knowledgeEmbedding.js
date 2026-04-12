/**
 * 知识源 Embedding + 语义检索模块
 * 
 * 职责：
 * 1. 为知识源生成 embedding 向量（上传时调用）
 * 2. 根据对话上下文语义检索最相关的知识源（每轮对话时调用）
 * 3. 提供关键词回退匹配（当 embedding 不可用时）
 */
import { embedText, createEmbeddings, searchSimilar, cosineSimilarity } from './models/openaiEmbedding.js';
import { buildKnowledgeContext, normalizeKnowledgeSource } from './knowledgeSources.js';

/* ─── 常量 ────────────────────────────────────────────── */
const EMBEDDING_TEXT_LIMIT = 2000;    // embedding 输入文本长度上限
const DEFAULT_TOP_K = 8;             // 默认返回的知识源数量
const DEFAULT_MIN_SCORE = 0.25;      // 最低语义相似度阈值
const KEYWORD_BOOST = 0.15;          // 关键词命中时的额外分数加成
const EXPLICIT_MENTION_SCORE = 1.0;  // 用户明确提到知识源名称时的强制分数

/* ─── 辅助函数 ────────────────────────────────────────── */

/**
 * 从知识源构建用于 embedding 的可搜索文本
 * 优先级：searchKeywords > name + tags + summary + promptContext + extractedText前段
 */
const buildEmbeddableText = (source) => {
  const parts = [];
  
  // 检索关键词最重要
  if (Array.isArray(source.searchKeywords) && source.searchKeywords.length > 0) {
    parts.push(source.searchKeywords.join(' '));
  }
  
  // 名称
  if (source.name) parts.push(source.name);
  
  // 标签
  if (Array.isArray(source.tags) && source.tags.length > 0) {
    parts.push(source.tags.join(' '));
  }
  
  // 摘要
  if (source.summary && source.summary.length > 5) parts.push(source.summary);
  
  // prompt 上下文
  if (source.promptContext && source.promptContext.length > 10) {
    parts.push(source.promptContext.slice(0, 500));
  }
  
  // 原始文本前段
  if (source.extractedText && source.extractedText.length > 20) {
    parts.push(source.extractedText.slice(0, 800));
  }
  
  const combined = parts.join('\n').trim();
  return combined.slice(0, EMBEDDING_TEXT_LIMIT);
};

/**
 * 从对话上下文构建检索查询文本
 */
const buildQueryText = (ctx) => {
  const parts = [];
  
  // 用户最新消息（最重要）
  if (ctx.user_message) {
    parts.push(ctx.user_message);
  }
  
  // 被提到的客户信息
  if (Array.isArray(ctx.mentioned_clients)) {
    ctx.mentioned_clients.forEach(c => {
      if (c.name) parts.push(c.name);
      if (c.company) parts.push(c.company);
    });
  }
  
  // 被识别的事件类型
  if (Array.isArray(ctx.detected_events)) {
    ctx.detected_events.forEach(e => parts.push(e));
  }

  // 识别的意图
  if (Array.isArray(ctx.intents)) {
    ctx.intents.forEach(i => {
      if (i.content) parts.push(i.content);
    });
  }
  
  // 对话摘要（低权重补充）
  if (ctx.conversation_summary && parts.length < 3) {
    parts.push(String(ctx.conversation_summary).slice(0, 200));
  }
  
  return parts.join('\n').trim();
};

/**
 * 关键词回退匹配评分（当 embedding 不可用时）
 */
const keywordMatchScore = (source, signals) => {
  if (!signals || signals.length === 0) return 0;
  
  const searchable = [
    source.name || '',
    source.summary || '',
    (source.tags || []).join(' '),
    (source.details || []).join(' '),
    (source.searchKeywords || []).join(' '),
    source.note || '',
    (source.extractedText || '').slice(0, 500)
  ].join(' ').toLowerCase();
  
  let score = 0;
  let matchCount = 0;
  
  for (const signal of signals) {
    const s = signal.toLowerCase();
    if (searchable.includes(s)) {
      matchCount++;
      // 不同字段命中权重不同
      if ((source.name || '').toLowerCase().includes(s)) score += 10;
      else if ((source.searchKeywords || []).some(k => k.toLowerCase().includes(s))) score += 9;
      else if ((source.tags || []).some(t => t.toLowerCase().includes(s))) score += 7;
      else if ((source.summary || '').toLowerCase().includes(s)) score += 5;
      else score += 2;
    }
  }
  
  // 覆盖率加分
  if (signals.length > 0) {
    score += (matchCount / signals.length) * 10;
  }
  
  return score;
};

/**
 * 提取对话中的关键词信号（用于关键词回退 + 加成）
 */
const extractSignals = (ctx) => {
  const signals = new Set();
  
  const userMsg = ctx.user_message || '';
  // 简单中文分词：按标点/空格切分 + 去停用词
  userMsg.split(/[\s,，。！？、；：""''（）()\[\]【】]+/)
    .filter(w => w.length >= 2)
    .forEach(w => signals.add(w));
  
  // 客户名
  (ctx.mentioned_clients || []).forEach(c => {
    if (c.name) signals.add(c.name);
    if (c.company) signals.add(c.company);
  });
  
  // 事件类型
  (ctx.detected_events || []).forEach(e => signals.add(e));
  
  return [...signals].filter(Boolean);
};

/* ─── 导出 API ────────────────────────────────────────── */

/**
 * 为单个知识源生成 embedding 向量
 * 适合在知识源上传时调用
 * 
 * @param {Object} source - 归一化后的知识源对象
 * @returns {Promise<number[]>} embedding 向量
 */
export const generateKnowledgeEmbedding = async (source) => {
  const text = buildEmbeddableText(source);
  if (!text || text.length < 5) return [];
  
  try {
    return await embedText(text);
  } catch (err) {
    console.warn('[Embedding] 知识源向量生成失败:', err.message);
    return [];
  }
};

/**
 * 批量为知识源生成 embedding
 * @param {Object[]} sources - 归一化后的知识源数组
 * @returns {Promise<Map<string, number[]>>} id → embedding 映射
 */
export const batchGenerateEmbeddings = async (sources) => {
  const texts = [];
  const ids = [];
  
  for (const source of sources) {
    const text = buildEmbeddableText(source);
    if (text && text.length >= 5) {
      texts.push(text);
      ids.push(source.id);
    }
  }
  
  if (texts.length === 0) return new Map();
  
  try {
    const embeddings = await createEmbeddings(texts);
    const result = new Map();
    embeddings.forEach((emb, idx) => {
      if (ids[idx]) result.set(ids[idx], emb);
    });
    return result;
  } catch (err) {
    console.warn('[Embedding] 批量向量生成失败:', err.message);
    return new Map();
  }
};

/**
 * 语义检索最相关的知识源
 * 
 * 策略：
 * 1. 如果知识源有 embedding → 语义搜索（余弦相似度）
 * 2. 如果知识源无 embedding → 关键词回退匹配
 * 3. 用户明确提到知识源名称 → 强制纳入
 * 4. 语义分数 + 关键词加成 = 综合分数
 * 5. 如果所有分数都低于阈值 → 回退到旧的丰富度排序
 * 
 * @param {Object[]} sources - 原始知识源数组
 * @param {Object} ctx - 对话上下文（包含 user_message, mentioned_clients, detected_events, intents 等）
 * @param {Object} [options]
 * @param {number} [options.topK=8]
 * @param {number} [options.minScore=0.25]
 * @param {number} [options.maxTotalChars=80000]
 * @returns {Promise<Object>} 与 buildKnowledgeContext 相同的返回结构
 */
export const retrieveRelevantKnowledge = async (sources = [], ctx = {}, options = {}) => {
  const {
    topK = DEFAULT_TOP_K,
    minScore = DEFAULT_MIN_SCORE,
    maxTotalChars = 80000
  } = options;

  const normalized = (Array.isArray(sources) ? sources : [])
    .map(normalizeKnowledgeSource)
    .filter(item => item && item.active !== false);

  // 如果知识源很少，不需要检索，直接全量返回
  if (normalized.length <= topK) {
    return buildKnowledgeContext(sources, maxTotalChars);
  }

  const queryText = buildQueryText(ctx);
  if (!queryText) {
    // 没有对话上下文信号，回退到丰富度排序
    return buildKnowledgeContext(sources, maxTotalChars);
  }

  const signals = extractSignals(ctx);

  // 分离有/无 embedding 的知识源
  const withEmbedding = normalized.filter(s => Array.isArray(s.embedding) && s.embedding.length > 0);
  const withoutEmbedding = normalized.filter(s => !Array.isArray(s.embedding) || s.embedding.length === 0);

  let scoredResults = [];

  // 1. 语义搜索（有 embedding 的知识源）
  if (withEmbedding.length > 0) {
    try {
      const queryEmbedding = await embedText(queryText);
      
      if (queryEmbedding && queryEmbedding.length > 0) {
        const candidates = withEmbedding.map(s => ({
          id: s.id,
          embedding: s.embedding
        }));
        
        const semanticHits = searchSimilar(queryEmbedding, candidates, topK * 2, 0); // 先不过滤，后面统一过滤
        
        scoredResults.push(...semanticHits.map(hit => {
          const source = withEmbedding.find(s => s.id === hit.id);
          // 叠加关键词加成
          const kwBoost = keywordMatchScore(source, signals) > 0 ? KEYWORD_BOOST : 0;
          return {
            source,
            score: hit.score + kwBoost,
            method: 'semantic' + (kwBoost > 0 ? '+keyword' : '')
          };
        }));
      }
    } catch (err) {
      console.warn('[Retrieval] 语义搜索失败，回退到关键词匹配:', err.message);
      // 语义搜索失败，把这些也当作无 embedding 处理
      withoutEmbedding.push(...withEmbedding);
      scoredResults = [];
    }
  }

  // 2. 关键词回退（无 embedding 的知识源）
  for (const source of withoutEmbedding) {
    const kwScore = keywordMatchScore(source, signals);
    if (kwScore > 0) {
      // 将关键词分数归一化到 0~1 范围（除以理论最大值）
      const normalizedScore = Math.min(1, kwScore / 50);
      scoredResults.push({
        source,
        score: normalizedScore,
        method: 'keyword'
      });
    }
  }

  // 3. 用户明确提到知识源名称 → 强制纳入
  const userMsg = (ctx.user_message || '').toLowerCase();
  for (const source of normalized) {
    const nameMatch = source.name && source.name.length > 2 && userMsg.includes(source.name.toLowerCase());
    if (nameMatch && !scoredResults.some(r => r.source.id === source.id)) {
      scoredResults.push({
        source,
        score: EXPLICIT_MENTION_SCORE,
        method: 'explicit_mention'
      });
    }
  }

  // 去重（同一知识源可能出现在多个列表中，取最高分）
  const bestByIdMap = new Map();
  for (const r of scoredResults) {
    const existing = bestByIdMap.get(r.source.id);
    if (!existing || r.score > existing.score) {
      bestByIdMap.set(r.source.id, r);
    }
  }

  // 按分数排序 + 过滤阈值
  const ranked = [...bestByIdMap.values()]
    .filter(r => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  // 如果检索结果为空，兜底回退到旧的丰富度排序
  if (ranked.length === 0) {
    return buildKnowledgeContext(sources, maxTotalChars);
  }

  // 用检索到的知识源构建上下文
  const result = buildKnowledgeContext(
    ranked.map(r => r.source),
    maxTotalChars
  );

  // 附加检索元信息
  result.retrievalMeta = {
    method: ranked.map(r => r.method),
    scores: ranked.map(r => ({ id: r.source.id, name: r.source.name, score: Number(r.score.toFixed(3)), method: r.method })),
    querySignals: signals.slice(0, 10),
    totalCandidates: normalized.length,
    semanticCandidates: withEmbedding.length,
    keywordCandidates: withoutEmbedding.length
  };

  return result;
};
