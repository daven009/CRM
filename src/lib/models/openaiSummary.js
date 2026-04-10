import { extractTextFromModelResponse, normalizeApiKey } from "./shared.js";

const buildOpenAIUrl = (baseUrl) => String(baseUrl || "").trim();

const fallbackConversationSummary = (history = [], clientName = "") => {
  const userTurns = (Array.isArray(history) ? history : [])
    .filter((item) => item?.r === "user")
    .map((item) => String(item?.t || "").trim())
    .filter(Boolean);

  if (userTurns.length > 0) {
    const firstTurn = userTurns[0].replace(/\s+/g, " ").trim();
    return firstTurn.length > 24 ? `${firstTurn.slice(0, 24)}…` : firstTurn;
  }

  return clientName ? `与${clientName}沟通记录` : "沟通记录";
};

export const summarizeConversationWithOpenAI = async ({ history, clientName = "" }) => {
  const rawApiKey = import.meta.env.VITE_OPENAI_API_KEY || "";
  const apiKey = normalizeApiKey(rawApiKey);
  const model = (import.meta.env.VITE_OPENAI_MODEL || "gpt-4o-mini").trim();
  const requestUrl = buildOpenAIUrl(import.meta.env.VITE_OPENAI_API_URL || "https://api.openai.com/v1/chat/completions");

  if (!apiKey) {
    return fallbackConversationSummary(history, clientName);
  }

  const transcript = (Array.isArray(history) ? history : [])
    .map((item) => `${item?.r === "ai" ? "Agent" : "User"}: ${String(item?.t || "").trim()}`)
    .filter((line) => !line.endsWith(":"))
    .join("\n");

  if (!transcript.trim()) {
    return fallbackConversationSummary(history, clientName);
  }

  const messages = [
    {
      role: "system",
      content: "你是 CRM 时间线摘要助手。请根据一次对话记录生成一句非常短的中文摘要，只输出摘要本身，不要引号，不要解释。"
    },
    {
      role: "user",
      content: `联系人：${clientName || "未命名联系人"}\n请基于下面这次对话，生成一句适合展示在 timeline 里的短摘要。\n要求：\n1. 只输出一句中文短摘要；\n2. 长度控制在 8 到 24 个汉字左右；\n3. 要保留关键信息，如需求、进展、承诺、下一步动作；\n4. 不要写“进行了一次沟通”“完成了一次对话”这种空话。\n\n对话记录：\n${transcript}`
    }
  ];

  try {
    const resp = await fetch(requestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({ model, messages, temperature: 0.1, stream: false })
    });

    if (!resp.ok) {
      return fallbackConversationSummary(history, clientName);
    }

    const body = await resp.json();
    const summary = extractTextFromModelResponse(body).replace(/^["'“”]+|["'“”]+$/g, "").trim();

    return summary || fallbackConversationSummary(history, clientName);
  } catch {
    return fallbackConversationSummary(history, clientName);
  }
};
