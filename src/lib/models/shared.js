/**
 * LLM 模型共享工具函数
 */

/**
 * 从模型 API 返回的 JSON 中提取文本内容
 * 兼容 OpenAI / MiniMax / Claude 等不同格式
 * @param {Object} data - 模型返回的原始 JSON
 * @returns {string}
 */
export const extractTextFromModelResponse = (data) => {
  // OpenAI / MiniMax 格式: choices[0].message.content
  const msg = data?.choices?.[0]?.message;

  if (typeof msg?.content === "string") return msg.content;

  if (Array.isArray(msg?.content)) {
    return msg.content
      .map((part) => (typeof part === "string" ? part : part?.text || part?.content || ""))
      .join("\n")
      .trim();
  }

  // Tool call 格式
  const toolArgs = msg?.tool_calls?.[0]?.function?.arguments;
  if (typeof toolArgs === "string") return toolArgs;

  // Legacy 格式
  if (typeof data?.choices?.[0]?.text === "string") return data.choices[0].text;
  if (typeof data?.output_text === "string") return data.output_text;
  if (typeof data?.reply === "string") return data.reply;

  // Claude 原生格式: content[0].text
  if (Array.isArray(data?.content)) {
    const textParts = data.content
      .filter(block => block.type === "text")
      .map(block => block.text);
    if (textParts.length > 0) return textParts.join("\n").trim();
  }

  return "";
};

/**
 * 清理 API Key（去空格、去 Bearer 前缀、去引号）
 * @param {string} raw
 * @returns {string}
 */
export const normalizeApiKey = (raw) => String(raw || "")
  .trim()
  .replace(/^Bearer\s+/i, "")
  .replace(/^['"]|['"]$/g, "");
