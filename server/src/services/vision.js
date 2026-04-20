/**
 * OpenAI Vision Service (后端)
 * 迁移自前端 src/lib/models/openaiVision.js
 * 
 * 接收 base64 图片，调用 OpenAI Vision API 分析
 */
import { config } from '../config/env.js';
import { extractTextFromModelResponse } from './shared.js';

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

export const analyzeScreenshot = async ({ dataUrl, filename = 'screenshot.png' }) => {
  const { apiKey, apiUrl, visionModel } = config.openai;
  if (!apiKey) throw Object.assign(new Error('未配置 OPENAI_API_KEY'), { statusCode: 500 });

  const messages = [
    {
      role: 'system',
      content: '你是 CRM 资料整理助手。你的任务是阅读联系人相关截图，提炼对 CRM 有价值的信息，并只输出 JSON。',
    },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `请分析这张联系人相关截图（文件名：${filename}），提炼成可落库的自然语言资料摘要。只输出 JSON，格式如下：
{
  "summary": "一句话摘要",
  "details": ["要点1", "要点2"],
  "tags": ["标签1", "标签2"],
  "suggestedActions": ["后续动作1", "后续动作2"]
}
要求：
1. summary 必须简洁可读；
2. details 最多 4 条；
3. tags 最多 4 个；
4. suggestedActions 最多 3 条；
5. 如果截图信息不足，明确写"截图信息有限"，不要编造。`,
        },
        {
          type: 'image_url',
          image_url: { url: dataUrl, detail: 'auto' },
        },
      ],
    },
  ];

  const resp = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: visionModel, messages, temperature: 0.1, stream: false }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw Object.assign(
      new Error(`截图解析失败 (${resp.status}): ${text.slice(0, 500)}`),
      { statusCode: resp.status, code: 'VISION_ERROR' }
    );
  }

  const body = await resp.json();
  if (body?.error) {
    throw Object.assign(new Error(body.error.message || '截图解析失败'), { statusCode: 400 });
  }

  const rawText = extractTextFromModelResponse(body);
  const parsed = parseJson(rawText);
  if (!parsed) throw Object.assign(new Error('截图解析结果不是有效 JSON'), { statusCode: 502 });

  return {
    summary: String(parsed.summary || '截图资料已录入').trim(),
    details: Array.isArray(parsed.details) ? parsed.details.map((v) => String(v || '').trim()).filter(Boolean) : [],
    tags: Array.isArray(parsed.tags) ? parsed.tags.map((v) => String(v || '').trim()).filter(Boolean) : [],
    suggestedActions: Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions.map((v) => String(v || '').trim()).filter(Boolean) : [],
  };
};
