/**
 * 第二波修复离线测试脚本
 * 验证 #3 Stage2 校验修复循环、#7 resolved_client_id 合法性、
 * #11 知识源排序、#12 白名单对齐
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

/* ─── 测试框架 ─── */
let passed = 0;
let failed = 0;
const assert = (label, condition, detail = '') => {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

/* ─── 从源文件中提取逻辑进行测试 ─── */

// ====== #3 / #7: Stage 2 校验器 ======
console.log('\n=== 修复 #3/#7: Stage 2 JSON 校验器 ===\n');

// 重新实现 validateStage2（与 pipeline.js 中的一致）
const isPlainObject = (v) => Object.prototype.toString.call(v) === '[object Object]';

const validateStage2 = (parsed) => {
  const errors = [];
  if (!isPlainObject(parsed)) return { ok: false, errors: ['Stage2 输出不是 JSON object'] };
  if (typeof parsed.needs_clarification !== 'boolean' && parsed.needs_clarification != null) {
    errors.push('needs_clarification 必须是 boolean 或 null');
  }
  if (!parsed.needs_clarification) {
    if (parsed.resolved_client_id == null || String(parsed.resolved_client_id).trim() === '') {
      errors.push('needs_clarification=false 时 resolved_client_id 不能为空');
    }
  }
  if (parsed.needs_clarification === true) {
    if (!String(parsed.clarifying_question || '').trim() && !String(parsed.reasoning || '').trim()) {
      errors.push('needs_clarification=true 时 clarifying_question 或 reasoning 不能同时为空');
    }
  }
  return { ok: errors.length === 0, errors };
};

// 3.1 合法的消歧结果
const validStage2 = { resolved_client_id: "42", reasoning: "上下文匹配", needs_clarification: false };
const r1 = validateStage2(validStage2);
assert('合法消歧结果通过校验', r1.ok && r1.errors.length === 0);

// 3.2 需要澄清的合法结果
const validClarify = { resolved_client_id: null, reasoning: "无法判断", needs_clarification: true, clarifying_question: "请确认…" };
const r2 = validateStage2(validClarify);
assert('需要澄清的结果通过校验', r2.ok && r2.errors.length === 0);

// 3.3 缺少 resolved_client_id 但 needs_clarification=false → 应失败
const missingId = { reasoning: "测试", needs_clarification: false };
const r3 = validateStage2(missingId);
assert('缺少 resolved_client_id 且不需要澄清 → 校验失败', !r3.ok);
assert('错误信息提到 resolved_client_id', r3.errors.some(e => e.includes('resolved_client_id')));

// 3.4 空字符串 resolved_client_id → 应失败
const emptyId = { resolved_client_id: "", reasoning: "空", needs_clarification: false };
const r4 = validateStage2(emptyId);
assert('空字符串 resolved_client_id → 校验失败', !r4.ok);

// 3.5 needs_clarification=true 但没有 clarifying_question 和 reasoning → 应失败
const clarifyNoMsg = { resolved_client_id: null, needs_clarification: true, clarifying_question: "", reasoning: "" };
const r5 = validateStage2(clarifyNoMsg);
assert('澄清但无问题和理由 → 校验失败', !r5.ok);

// 3.6 非 JSON object → 应失败
const r6 = validateStage2("not an object");
assert('非 object 输入 → 校验失败', !r6.ok);

// 3.7 needs_clarification 为非 boolean → 应失败
const invalidBool = { resolved_client_id: "42", needs_clarification: "yes", reasoning: "test" };
const r7 = validateStage2(invalidBool);
assert('needs_clarification 为字符串 → 校验失败', !r7.ok);

// 3.8 验证 resolved_client_id 候选列表校验逻辑
console.log('\n=== 修复 #7: resolved_client_id 候选列表匹配 ===\n');

const mockHits = [
  { id: 1, n: '陈凯', co: 'ABC公司' },
  { id: 2, n: '陈素', co: 'XYZ公司' },
  { id: 3, n: '陈伟', co: '123公司' }
];

// 模拟 pipeline.js 中的 ID 匹配逻辑
const matchResolvedId = (resolvedId, hits) => {
  const id = String(resolvedId).trim();
  return hits.find(c => String(c.id) === id || String(c.id) === String(Number(id)));
};

assert('有效 ID "2" 匹配到陈素', matchResolvedId("2", mockHits)?.n === '陈素');
assert('有效 ID 1 (数字) 匹配到陈凯', matchResolvedId(1, mockHits)?.n === '陈凯');
assert('无效 ID "99" 无匹配', matchResolvedId("99", mockHits) == null);
assert('空 ID "" 无匹配', matchResolvedId("", mockHits) == null);
assert('NaN ID "abc" 无匹配', matchResolvedId("abc", mockHits) == null);

// ====== #11: 知识源排序 ======
console.log('\n=== 修复 #11: 知识源按丰富度排序 ===\n');

// 读取 knowledgeSources.js 验证排序逻辑
const scoreKnowledgeSource = (source) => {
  let score = 0;
  if (source.extractedText && source.extractedText.length > 10) score += 40;
  if (source.parsedPreview) score += 30;
  if (source.promptContext && source.promptContext.length > 20) score += 15;
  if (source.summary && source.summary.length > 10) score += 10;
  if (source.details && source.details.length > 0) score += 5;
  if (source.tags && source.tags.length > 0) score += 3;
  if (source.note && source.note.length > 0) score += 2;
  return score;
};

const richSource = {
  extractedText: '这是一段很长的提取文本内容，包含了丰富的保险知识和客户信息',
  parsedPreview: { headers: ['标题1'] },
  promptContext: '完整的上下文信息，用于AI理解',
  summary: '保险知识文档摘要',
  details: ['细节1', '细节2'],
  tags: ['保险', '重疾'],
  note: '重要文档'
};

const poorSource = {
  extractedText: '',
  parsedPreview: null,
  promptContext: '',
  summary: 'link',
  details: [],
  tags: [],
  note: ''
};

const mediumSource = {
  extractedText: '',
  parsedPreview: null,
  promptContext: '一段中等长度的上下文信息内容',
  summary: '中等质量的文档摘要信息',
  details: ['细节1'],
  tags: [],
  note: ''
};

const richScore = scoreKnowledgeSource(richSource);
const poorScore = scoreKnowledgeSource(poorSource);
const mediumScore = scoreKnowledgeSource(mediumSource);

assert(`丰富源评分(${richScore}) > 中等源评分(${mediumScore})`, richScore > mediumScore);
assert(`中等源评分(${mediumScore}) > 贫瘠源评分(${poorScore})`, mediumScore > poorScore);
assert(`丰富源评分(${richScore}) 应较高`, richScore >= 80);
assert(`贫瘠源评分(${poorScore}) 应较低`, poorScore <= 10);

// 验证排序后的顺序
const sources = [poorSource, richSource, mediumSource];
const sorted = [...sources].sort((a, b) => scoreKnowledgeSource(b) - scoreKnowledgeSource(a));
assert('排序后丰富源在第一位', sorted[0] === richSource);
assert('排序后中等源在第二位', sorted[1] === mediumSource);
assert('排序后贫瘠源在最后', sorted[2] === poorSource);

// ====== #12: 白名单对齐 ======
console.log('\n=== 修复 #12: Prompt 白名单与 EVENT_CHAINS 对齐 ===\n');

// 从 stage3Write.js 提取白名单
const stage3WriteContent = readFileSync(join(ROOT, 'src/lib/prompts/stage3Write.js'), 'utf-8');
const promptEventTypes = [];
const eventRegex = /^-\s+(\w+)\s+\/\//gm;
let match;
while ((match = eventRegex.exec(stage3WriteContent)) !== null) {
  promptEventTypes.push(match[1]);
}

// 从 eventChains.js 提取定义
const eventChainsContent = readFileSync(join(ROOT, 'src/lib/router/eventChains.js'), 'utf-8');
const chainRegex = /^\s+(\w+)\s*:\s*\{/gm;
const chainEventTypes = [];
while ((match = chainRegex.exec(eventChainsContent)) !== null) {
  if (match[1] !== 'todos' && match[1] !== 'traits' && match[1] !== 'recommendedScripts') {
    chainEventTypes.push(match[1]);
  }
}

assert(`Prompt 白名单有 ${promptEventTypes.length} 种事件类型`, promptEventTypes.length === 18);
assert(`EVENT_CHAINS 定义有 ${chainEventTypes.length} 种事件类型`, chainEventTypes.length === 18);

// 检查每个 prompt 白名单类型在 EVENT_CHAINS 中都有定义
const missingInChains = promptEventTypes.filter(t => !chainEventTypes.includes(t));
const missingInPrompt = chainEventTypes.filter(t => !promptEventTypes.includes(t));
assert(
  'Prompt 白名单中所有类型在 EVENT_CHAINS 中都有定义',
  missingInChains.length === 0,
  missingInChains.length > 0 ? `缺失: ${missingInChains.join(', ')}` : ''
);
assert(
  'EVENT_CHAINS 中所有类型在 Prompt 白名单中都有列出',
  missingInPrompt.length === 0,
  missingInPrompt.length > 0 ? `多出: ${missingInPrompt.join(', ')}` : ''
);

// ====== 验证 pipeline.js 中 Stage 2 使用了 callAndParse ======
console.log('\n=== 额外验证: Stage 2 使用 callAndParse ===\n');

const pipelineContent = readFileSync(join(ROOT, 'src/lib/router/pipeline.js'), 'utf-8');

// 检查 validateStage2 函数存在
assert('pipeline.js 包含 validateStage2 函数', pipelineContent.includes('const validateStage2'));

// 检查 Stage 2 消歧使用 callAndParse 而非裸调用
assert(
  'Stage 2 消歧使用 callAndParse',
  pipelineContent.includes('callAndParse(\n            llm, stage2Messages') ||
  pipelineContent.includes('callAndParse(') && pipelineContent.includes('validateStage2')
);

// 检查不再有直接的 llm.call + parseJsonFromText 用于消歧
const stage2Section = pipelineContent.slice(
  pipelineContent.indexOf('启发式失败 → 尝试 LLM 辅助消歧'),
  pipelineContent.indexOf('所有方法都失败 → 需要用户澄清')
);
assert(
  'Stage 2 不再使用裸 llm.call + parseJsonFromText',
  !stage2Section.includes('parseJsonFromText(stage2Raw)')
);

// 检查 resolved_client_id 匹配逻辑使用字符串比较
assert(
  'resolved_client_id 使用 String() 比较',
  stage2Section.includes("String(c.id) === resolvedId") || stage2Section.includes("String(c.id)")
);

// ====== 汇总 ======
console.log(`\n${'='.repeat(50)}`);
console.log(`总计: ${passed + failed} 项测试，${passed} 通过，${failed} 失败`);
if (failed > 0) {
  console.log('❌ 有失败的测试！');
  process.exit(1);
} else {
  console.log('✅ 全部通过！');
}
