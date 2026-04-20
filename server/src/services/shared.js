/**
 * 共享工具函数（从前端 shared.js 迁移）
 */

/**
 * 从模型 API 返回的 JSON 中提取文本内容
 * 兼容 OpenAI / MiniMax / Claude 等不同格式
 */
export const extractTextFromModelResponse = (data) => {
  // OpenAI / MiniMax 格式: choices[0].message.content
  const msg = data?.choices?.[0]?.message;

  if (typeof msg?.content === 'string') return msg.content;

  if (Array.isArray(msg?.content)) {
    return msg.content
      .map((part) => (typeof part === 'string' ? part : part?.text || part?.content || ''))
      .join('\n')
      .trim();
  }

  // Tool call 格式
  const toolArgs = msg?.tool_calls?.[0]?.function?.arguments;
  if (typeof toolArgs === 'string') return toolArgs;

  // Legacy 格式
  if (typeof data?.choices?.[0]?.text === 'string') return data.choices[0].text;
  if (typeof data?.output_text === 'string') return data.output_text;
  if (typeof data?.reply === 'string') return data.reply;

  // Claude 原生格式: content[0].text
  if (Array.isArray(data?.content)) {
    const textParts = data.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text);
    if (textParts.length > 0) return textParts.join('\n').trim();
  }

  return '';
};
