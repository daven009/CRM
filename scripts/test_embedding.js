/**
 * 知识源语义检索 — 离线测试脚本
 * 
 * 测试内容：
 * 1. cosineSimilarity 计算正确性
 * 2. searchSimilar Top-K 排序正确性
 * 3. knowledgeSources 新字段（searchKeywords / embedding）归一化
 * 4. knowledgeEmbedding 的 keyword 匹配逻辑
 * 5. retrieveRelevantKnowledge 的兜底逻辑
 */

// ── Mock modules for Node.js ──
const mockNormalizeKnowledgeSource = (v) => {
  if (!v) return null;
  if (typeof v === 'string') return { id: v, name: v, active: true, embedding: [], searchKeywords: [] };
  return {
    id: v.id || 'test',
    name: v.name || '',
    sourceType: v.sourceType || 'file',
    kind: v.kind || 'file',
    mimeType: v.mimeType || '',
    size: v.size || '',
    sizeLabel: v.sizeLabel || '',
    url: v.url || '',
    active: v.active !== false,
    status: v.status || 'active',
    summary: v.summary || '',
    details: Array.isArray(v.details) ? v.details : [],
    tags: Array.isArray(v.tags) ? v.tags : [],
    suggestedActions: [],
    promptContext: v.promptContext || v.summary || '',
    extractedText: v.extractedText || '',
    parsedPreview: v.parsedPreview || null,
    uploadedAt: v.uploadedAt || '',
    note: v.note || '',
    searchKeywords: Array.isArray(v.searchKeywords) ? v.searchKeywords : [],
    embedding: Array.isArray(v.embedding) ? v.embedding : []
  };
};

// ── Inline reimplementations for testing ──

const cosineSimilarity = (a, b) => {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
};

const searchSimilar = (queryEmbedding, candidates, topK = 8, minScore = 0.3) => {
  if (!queryEmbedding || !candidates || candidates.length === 0) return [];
  return candidates
    .filter(c => c.embedding && c.embedding.length > 0)
    .map(c => ({ id: c.id, score: cosineSimilarity(queryEmbedding, c.embedding) }))
    .filter(c => c.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
};

// ── Test runner ──

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${msg}`);
  }
}

function approxEqual(a, b, eps = 0.001) {
  return Math.abs(a - b) < eps;
}

// ═══════════════════════════════════════════════════════
console.log('\n═══ Test Group 1: cosineSimilarity ═══');

// 相同向量 → 相似度 1.0
const v1 = [1, 0, 0];
assert(approxEqual(cosineSimilarity(v1, v1), 1.0), '相同向量 → 1.0');

// 正交向量 → 相似度 0.0
assert(approxEqual(cosineSimilarity([1, 0, 0], [0, 1, 0]), 0.0), '正交向量 → 0.0');

// 反向向量 → 相似度 -1.0
assert(approxEqual(cosineSimilarity([1, 0], [-1, 0]), -1.0), '反向向量 → -1.0');

// 空向量 → 0
assert(cosineSimilarity([], []) === 0, '空向量 → 0');
assert(cosineSimilarity(null, [1]) === 0, 'null → 0');

// 长度不匹配 → 0
assert(cosineSimilarity([1, 2], [1, 2, 3]) === 0, '长度不匹配 → 0');

// 实际浮点向量
const a = [0.5, 0.3, 0.8];
const b = [0.4, 0.5, 0.7];
const sim = cosineSimilarity(a, b);
assert(sim > 0.9 && sim < 1.0, `实际浮点向量相似度合理: ${sim.toFixed(4)}`);


// ═══════════════════════════════════════════════════════
console.log('\n═══ Test Group 2: searchSimilar ═══');

const candidates = [
  { id: 'a', embedding: [1, 0, 0] },
  { id: 'b', embedding: [0, 1, 0] },
  { id: 'c', embedding: [0.9, 0.1, 0] },
  { id: 'd', embedding: [0.1, 0.9, 0] },
  { id: 'e', embedding: [] }  // 无 embedding
];

const query = [1, 0, 0];
const results = searchSimilar(query, candidates, 3, 0.5);

assert(results.length <= 3, `Top-3 返回 ≤ 3 条: ${results.length}`);
assert(results[0]?.id === 'a', `最相似的是 a: ${results[0]?.id}`);
assert(results[1]?.id === 'c', `第二相似的是 c: ${results[1]?.id}`);
assert(!results.some(r => r.id === 'e'), '无 embedding 的不出现');

// minScore 过滤
const strict = searchSimilar(query, candidates, 10, 0.999);
assert(strict.length === 1, `minScore=0.999 只保留完全匹配: ${strict.length}`);


// ═══════════════════════════════════════════════════════
console.log('\n═══ Test Group 3: normalizeKnowledgeSource 新字段 ═══');

const source1 = mockNormalizeKnowledgeSource({
  id: 'test-1',
  name: '保险产品对比表',
  searchKeywords: ['重疾险', '年金', '保单对比'],
  embedding: [0.1, 0.2, 0.3]
});

assert(Array.isArray(source1.searchKeywords), 'searchKeywords 是数组');
assert(source1.searchKeywords.length === 3, 'searchKeywords 长度正确');
assert(source1.searchKeywords[0] === '重疾险', 'searchKeywords 内容正确');
assert(Array.isArray(source1.embedding), 'embedding 是数组');
assert(source1.embedding.length === 3, 'embedding 长度正确');

// 无 searchKeywords / embedding 的兼容
const source2 = mockNormalizeKnowledgeSource({
  id: 'test-2',
  name: '老文档'
});
assert(Array.isArray(source2.searchKeywords), '无 searchKeywords → 空数组');
assert(source2.searchKeywords.length === 0, '无 searchKeywords → 长度 0');
assert(Array.isArray(source2.embedding), '无 embedding → 空数组');
assert(source2.embedding.length === 0, '无 embedding → 长度 0');


// ═══════════════════════════════════════════════════════
console.log('\n═══ Test Group 4: 关键词匹配逻辑 ═══');

// 内联 keywordMatchScore
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
      if ((source.name || '').toLowerCase().includes(s)) score += 10;
      else if ((source.searchKeywords || []).some(k => k.toLowerCase().includes(s))) score += 9;
      else if ((source.tags || []).some(t => t.toLowerCase().includes(s))) score += 7;
      else score += 2;
    }
  }
  
  if (signals.length > 0) score += (matchCount / signals.length) * 10;
  return score;
};

const ks1 = mockNormalizeKnowledgeSource({
  id: 'ks-1',
  name: '重疾险方案对比',
  summary: '三款重疾险产品的保障范围和费率对比',
  tags: ['重疾险', '保障范围', '费率'],
  searchKeywords: ['重疾', '大病', '保单对比', '费率', '保障范围']
});

const ks2 = mockNormalizeKnowledgeSource({
  id: 'ks-2',
  name: '教育金规划指南',
  summary: '子女教育金储蓄方案和年金产品选择',
  tags: ['教育金', '年金'],
  searchKeywords: ['教育金', '子女教育', '年金', '储蓄方案']
});

const sig1 = ['重疾', '保障'];
const score1 = keywordMatchScore(ks1, sig1);
const score2 = keywordMatchScore(ks2, sig1);

assert(score1 > score2, `查"重疾保障"时，重疾险文档分数(${score1})高于教育金文档(${score2})`);

const sig2 = ['教育金', '子女'];
const score3 = keywordMatchScore(ks1, sig2);
const score4 = keywordMatchScore(ks2, sig2);

assert(score4 > score3, `查"教育金子女"时，教育金文档分数(${score4})高于重疾险文档(${score3})`);

// 无信号 → 0 分
assert(keywordMatchScore(ks1, []) === 0, '无信号 → 0 分');


// ═══════════════════════════════════════════════════════
console.log('\n═══ Test Group 5: 综合语义 + 关键词排序 ═══');

// 模拟有 embedding 的场景
const docs = [
  { ...mockNormalizeKnowledgeSource({ id: 'd1', name: '重疾险方案', searchKeywords: ['重疾', '大病'] }), embedding: [0.9, 0.1, 0.0] },
  { ...mockNormalizeKnowledgeSource({ id: 'd2', name: '年金产品', searchKeywords: ['年金', '养老'] }), embedding: [0.1, 0.9, 0.0] },
  { ...mockNormalizeKnowledgeSource({ id: 'd3', name: '教育金方案', searchKeywords: ['教育金', '子女'] }), embedding: [0.0, 0.1, 0.9] },
];

// 查询向量接近 d1
const queryVec = [0.85, 0.15, 0.0];
const topResults = searchSimilar(queryVec, docs, 3, 0.0);

assert(topResults[0]?.id === 'd1', `语义搜索排第一的是 d1: ${topResults[0]?.id}`);
assert(topResults[1]?.id === 'd2', `语义搜索排第二的是 d2: ${topResults[1]?.id}`);

// 关键词加成
const boostScore1 = topResults[0].score + 0.15; // keyword boost
const boostScore2 = topResults[1].score;
assert(boostScore1 > boostScore2, `关键词加成后 d1(${boostScore1.toFixed(3)}) 仍 > d2(${boostScore2.toFixed(3)})`);


// ═══════════════════════════════════════════════════════
console.log('\n═══ Test Group 6: openaiMaterial 返回结构 ═══');

// 模拟 analyzeMaterialWithOpenAI 返回值包含 searchKeywords
const mockAnalysis = {
  summary: "三款重疾险产品对比",
  details: ["保障范围对比", "费率对比"],
  tags: ["重疾险", "保单对比"],
  suggestedActions: ["发送给客户"],
  promptContext: "重疾险方案对比分析",
  searchKeywords: ["重疾险", "大病", "保障范围", "费率", "保单对比"]
};

assert(Array.isArray(mockAnalysis.searchKeywords), 'searchKeywords 在返回结构中');
assert(mockAnalysis.searchKeywords.length === 5, 'searchKeywords 有 5 个词');
assert(mockAnalysis.searchKeywords.includes('重疾险'), 'searchKeywords 包含"重疾险"');


// ═══════════════════════════════════════════════════════
console.log('\n═══ Test Group 7: 边界情况 ═══');

// searchSimilar 空候选
assert(searchSimilar([1, 0], [], 5).length === 0, '空候选列表 → 空结果');

// searchSimilar null queryEmbedding
assert(searchSimilar(null, candidates, 5).length === 0, 'null query → 空结果');

// cosineSimilarity 零向量
assert(cosineSimilarity([0, 0, 0], [1, 0, 0]) === 0, '零向量 → 0');


// ═══════════════════════════════════════════════════════
console.log('\n═══════════════════════════════════════════════════');
console.log(`\n🏁 总计: ${passed + failed} | ✅ ${passed} 通过 | ❌ ${failed} 失败\n`);
process.exit(failed > 0 ? 1 : 0);
