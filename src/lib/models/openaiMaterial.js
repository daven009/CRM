import { extractTextFromModelResponse, normalizeApiKey } from "./shared.js";

const buildOpenAIUrl = (baseUrl) => String(baseUrl || "").trim();
const MATERIAL_ANALYSIS_TEXT_LIMIT = 40000;

const toPrettyJson = (value) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const extractBalancedJsonObjects = (text) => {
  const source = String(text || "");
  const results = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === "\"") inString = false;
      continue;
    }

    if (ch === "\"") {
      inString = true;
      continue;
    }

    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }

    if (ch === "}") {
      if (depth > 0) depth -= 1;
      if (depth === 0 && start >= 0) {
        results.push(source.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return results;
};

const parseJson = (raw) => {
  const text = String(raw || "").trim();
  if (!text) return null;

  const candidates = [text];
  const fenceMatches = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  fenceMatches.forEach((match) => {
    if (match?.[1]) candidates.push(String(match[1]).trim());
  });
  extractBalancedJsonObjects(text).forEach((snippet) => candidates.push(snippet));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // noop
    }
  }

  return null;
};

export const analyzeMaterialWithOpenAI = async ({ filename, kind, extractedText = "", parsedPreview = null }) => {
  const rawApiKey = import.meta.env.VITE_OPENAI_API_KEY || "";
  const apiKey = normalizeApiKey(rawApiKey);
  const model = (import.meta.env.VITE_OPENAI_MODEL || "gpt-4o-mini").trim();
  const requestUrl = buildOpenAIUrl(import.meta.env.VITE_OPENAI_API_URL || "https://api.openai.com/v1/chat/completions");

  if (!apiKey) {
    throw new Error("未配置 VITE_OPENAI_API_KEY，无法解析资料文件。");
  }

  const previewBlock = parsedPreview ? `\n结构化预览：\n${toPrettyJson(parsedPreview)}` : "";
  const messages = [
    {
      role: "system",
      content: "你是 CRM 资料整理助手。你的任务是阅读联系人相关资料，提炼对 CRM 有价值的信息，并只输出 JSON。"
    },
    {
      role: "user",
      content: `请分析这份联系人相关资料（文件名：${filename}，类型：${kind}），提炼成可落库的自然语言资料摘要。只输出 JSON，格式如下：
{
  "summary": "一句话摘要",
  "details": ["要点1", "要点2"],
  "tags": ["标签1", "标签2"],
  "suggestedActions": ["后续动作1", "后续动作2"],
  "promptContext": "适合放入后续对话 prompt 的高信息密度上下文",
  "searchKeywords": ["检索关键词1", "检索关键词2", ...]
}
要求：
1. summary 必须简洁可读，适合展示在 timeline 或资料卡片里；
2. details 最多 6 条，尽量保留数字、对象、金额、日期、需求、承诺等细节；
3. tags 最多 6 个，必须是自然语言短语；
4. suggestedActions 最多 4 条，必须具体可执行；
5. promptContext 要写成一小段高密度中文摘要，便于后续每轮对话引用；
6. searchKeywords 是为"向量检索"准备的关键词列表（10-20 个），要求覆盖：
   a) 文档主题/领域（如"重疾险"、"年金"、"教育金"）
   b) 文档中的核心实体（人名、公司名、产品名、方案名）
   c) 文档涉及的场景（如"保单对比"、"理赔流程"、"税务规划"）
   d) 中文和英文关键词都要有（如有英文内容）
   e) 同义词/近义词也要覆盖（如"重疾"和"大病"）
   f) 关键词粒度要细，避免太宽泛的词（如"保险"太宽泛，"重疾险保障范围"更好）
7. 如果资料信息不足，明确写"资料信息有限"，不要编造。

原始内容摘录：
${String(extractedText || "").slice(0, MATERIAL_ANALYSIS_TEXT_LIMIT)}${previewBlock}`
    }
  ];

  const resp = await fetch(requestUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({ model, messages, temperature: 0.1, stream: false })
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`资料解析失败 (${resp.status}): ${text.slice(0, 500)}`);
  }

  const body = await resp.json();
  if (body?.error) throw new Error(body.error.message || "资料解析失败");

  const rawText = extractTextFromModelResponse(body);
  const parsed = parseJson(rawText);
  if (!parsed) throw new Error("资料解析结果不是有效 JSON。");

  return {
    summary: String(parsed.summary || "资料已录入").trim(),
    details: Array.isArray(parsed.details) ? parsed.details.map((v) => String(v || "").trim()).filter(Boolean) : [],
    tags: Array.isArray(parsed.tags) ? parsed.tags.map((v) => String(v || "").trim()).filter(Boolean) : [],
    suggestedActions: Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions.map((v) => String(v || "").trim()).filter(Boolean) : [],
    promptContext: String(parsed.promptContext || parsed.summary || "资料信息有限").trim(),
    searchKeywords: Array.isArray(parsed.searchKeywords) ? parsed.searchKeywords.map((v) => String(v || "").trim()).filter(Boolean) : []
  };
};
