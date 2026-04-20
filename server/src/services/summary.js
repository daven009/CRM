/**
 * OpenAI Summary & Compression Service (后端)
 * 迁移自前端 src/lib/models/openaiSummary.js
 */
import { config } from '../config/env.js';
import { extractTextFromModelResponse } from './shared.js';

const MAX_TRANSCRIPT_CHARS = 3000;

const truncateTranscript = (text, maxChars = MAX_TRANSCRIPT_CHARS) => {
  if (!text || text.length <= maxChars) return text;
  const headBudget = Math.floor(maxChars * 0.3);
  const tailBudget = maxChars - headBudget - 40;
  const head = text.slice(0, headBudget);
  const tail = text.slice(-tailBudget);
  return `${head}\n\n…（中间 ${text.length - headBudget - tailBudget} 字已省略）…\n\n${tail}`;
};

const callLLM = async (messages, { temperature = 0.1 }) => {
  const { apiKey, model, apiUrl } = config.openai;
  if (!apiKey) return null;

  const resp = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, temperature, stream: false }),
  });
  if (!resp.ok) return null;
  const body = await resp.json();
  return extractTextFromModelResponse(body).replace(/^["'"]+|["'"]+$/g, '').trim() || null;
};

const buildTranscript = (history) =>
  (Array.isArray(history) ? history : [])
    .map((item) => `${item?.r === 'ai' ? 'Agent' : 'User'}: ${String(item?.t || '').trim()}`)
    .filter((line) => !line.endsWith(':'))
    .join('\n');

const fallbackConversationSummary = (history = [], clientName = '') => {
  const userTurns = (Array.isArray(history) ? history : [])
    .filter((item) => item?.r === 'user')
    .map((item) => String(item?.t || '').trim())
    .filter(Boolean);
  if (userTurns.length > 0) {
    const firstTurn = userTurns[0].replace(/\s+/g, ' ').trim();
    return firstTurn.length > 24 ? `${firstTurn.slice(0, 24)}…` : firstTurn;
  }
  return clientName ? `与${clientName}沟通记录` : '沟通记录';
};

export const summarizeConversation = async ({ history, clientName = '' }) => {
  const rawTranscript = buildTranscript(history);
  if (!rawTranscript.trim()) return fallbackConversationSummary(history, clientName);

  const transcript = truncateTranscript(rawTranscript);

  const messages = [
    {
      role: 'system',
      content: '你是 CRM 时间线摘要助手。请根据一次对话记录生成一句非常短的中文摘要，只输出摘要本身，不要引号，不要解释。',
    },
    {
      role: 'user',
      content: `联系人：${clientName || '未命名联系人'}\n请基于下面这次对话，生成一句适合展示在 timeline 里的短摘要。\n要求：\n1. 只输出一句中文短摘要；\n2. 长度控制在 8 到 24 个汉字左右；\n3. 要保留关键信息，如需求、进展、承诺、下一步动作；\n4. 不要写"进行了一次沟通""完成了一次对话"这种空话。\n\n对话记录：\n${transcript}`,
    },
  ];

  try {
    const summary = await callLLM(messages, { temperature: 0.1 });
    return summary || fallbackConversationSummary(history, clientName);
  } catch {
    return fallbackConversationSummary(history, clientName);
  }
};

export const compressConversation = async ({
  existingSummary = '',
  messagesToCompress = [],
  focusClientName = '',
}) => {
  if (messagesToCompress.length === 0 && !existingSummary) return '';

  const newTranscript = messagesToCompress
    .map((m, i) => `[轮${i + 1}] 用户: ${(m.user || '').slice(0, 200)} → AI: ${(m.ai || '').slice(0, 300)}`)
    .join('\n');

  const combinedLength = (existingSummary || '').length + newTranscript.length;
  if (combinedLength <= 300) {
    return [existingSummary, newTranscript].filter(Boolean).join('\n').slice(0, 300);
  }

  const messages = [
    {
      role: 'system',
      content: `你是 CRM 对话记忆压缩助手。你的任务是将历史对话压缩为一段结构化的信息摘要。

规则：
1. 输出纯中文文本，不超过 300 字
2. 必须保留：客户姓名、关键需求、已达成的共识/承诺、待跟进事项、重要偏好和数字
3. 去除：寒暄、重复确认、语气词、冗余解释
4. 格式：用简洁的短句，按主题分组
5. 如果已有历史摘要，将新对话信息合并进去
6. 只输出摘要本身，不要引号，不要解释`,
    },
    {
      role: 'user',
      content: `${focusClientName ? `当前客户：${focusClientName}\n` : ''}${existingSummary ? `【已有历史摘要】\n${existingSummary}\n\n` : ''}【新增对话记录】\n${truncateTranscript(newTranscript, 2000)}\n\n请将以上内容压缩为不超过 300 字的信息摘要。`,
    },
  ];

  try {
    const compressed = await callLLM(messages, { temperature: 0.05 });
    if (compressed) return compressed.slice(0, 350);
  } catch { /* noop */ }

  // 降级
  const parts = [];
  if (existingSummary) parts.push(existingSummary.slice(0, 150));
  messagesToCompress.forEach((m) => {
    const user = (m.user || '').slice(0, 40);
    const ai = (m.ai || '').slice(0, 60);
    if (user) parts.push(`用户:${user}→${ai}`);
  });
  return parts.join(' | ').slice(0, 300);
};
