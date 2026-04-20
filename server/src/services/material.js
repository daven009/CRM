/**
 * OpenAI Material Analysis Service (后端)
 * 迁移自前端 src/lib/models/openaiMaterial.js
 */
import { config } from '../config/env.js';
import { extractTextFromModelResponse } from './shared.js';

const MATERIAL_ANALYSIS_TEXT_LIMIT = 40000;

const toPrettyJson = (value) => {
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
};

const extractBalancedJsonObjects = (text) => {
  const source = String(text || '');
  const results = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') { if (depth === 0) start = i; depth += 1; continue; }
    if (ch === '}') {
      if (depth > 0) depth -= 1;
      if (depth === 0 && start >= 0) { results.push(source.slice(start, i + 1)); start = -1; }
    }
  }
  return results;
};

const parseJson = (raw) => {
  const text = String(raw || '').trim();
  if (!text) return null;
  const candidates = [text];
  const fenceMatches = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  fenceMatches.forEach((match) => { if (match?.[1]) candidates.push(String(match[1]).trim()); });
  extractBalancedJsonObjects(text).forEach((snippet) => candidates.push(snippet));
  for (const candidate of candidates) {
    try { return JSON.parse(candidate); } catch { /* noop */ }
  }
  return null;
};

export const analyzeMaterial = async ({ filename, kind, extractedText = '', parsedPreview = null }) => {
  const { apiKey, model, apiUrl } = config.openai;
  if (!apiKey) throw Object.assign(new Error('未配置 OPENAI_API_KEY'), { statusCode: 500 });

  const previewBlock = parsedPreview ? `\n结构化预览：\n${toPrettyJson(parsedPreview)}` : '';
  const messages = [
    {
      role: 'system',
      content: '你是 CRM 资料整理助手。你的任务是阅读联系人相关资料，提炼对 CRM 有价值的信息，并只输出 JSON。',
    },
    {
      role: 'user',
      content: `请分析这份联系人相关资料（文件名：${filename}，类型：${kind}），提炼成可落库的自然语言资料摘要。只输出 JSON，格式如下：
{
  "summary": "一句话摘要",
  "details": ["要点1", "要点2"],
  "tags": ["标签1", "标签2"],
  "suggestedActions": ["后续动作1", "后续动作2"],
  "promptContext": "适合放入后续对话 prompt 的高信息密度上下文",
  "searchKeywords": ["检索关键词1", "检索关键词2"]
}
要求：
1. summary 简洁可读；
2. details 最多 6 条，保留数字、日期、需求等细节；
3. tags 最多 6 个；
4. suggestedActions 最多 4 条；
5. promptContext 写成高密度中文摘要；
6. searchKeywords 10-20 个，覆盖主题/实体/场景/同义词；
7. 如果资料信息不足，明确写"资料信息有限"。

原始内容摘录：
${String(extractedText || '').slice(0, MATERIAL_ANALYSIS_TEXT_LIMIT)}${previewBlock}`,
    },
  ];

  const resp = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, temperature: 0.1, stream: false }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw Object.assign(
      new Error(`资料解析失败 (${resp.status}): ${text.slice(0, 500)}`),
      { statusCode: resp.status, code: 'MATERIAL_ERROR' }
    );
  }

  const body = await resp.json();
  if (body?.error) throw Object.assign(new Error(body.error.message || '资料解析失败'), { statusCode: 400 });

  const rawText = extractTextFromModelResponse(body);
  const parsed = parseJson(rawText);
  if (!parsed) throw Object.assign(new Error('资料解析结果不是有效 JSON'), { statusCode: 502 });

  return {
    summary: String(parsed.summary || '资料已录入').trim(),
    details: Array.isArray(parsed.details) ? parsed.details.map((v) => String(v || '').trim()).filter(Boolean) : [],
    tags: Array.isArray(parsed.tags) ? parsed.tags.map((v) => String(v || '').trim()).filter(Boolean) : [],
    suggestedActions: Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions.map((v) => String(v || '').trim()).filter(Boolean) : [],
    promptContext: String(parsed.promptContext || parsed.summary || '资料信息有限').trim(),
    searchKeywords: Array.isArray(parsed.searchKeywords) ? parsed.searchKeywords.map((v) => String(v || '').trim()).filter(Boolean) : [],
  };
};
