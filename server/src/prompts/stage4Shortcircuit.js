/**
 * 模块 4：短路 Prompt（纯 CHAT/KNOWLEDGE 且无客户时走此路径）
 */
export const STAGE4_SHORTCIRCUIT_TEMPLATE = `{{SYSTEM_HEADER}}

# 你的任务
用户的输入不涉及任何 CRM 数据变更，请直接回复。
- 若是 KNOWLEDGE 类问答且涉及政策时效，必须声明不确定并建议官方核验。
- 若是 CHAT，温柔从容回应，并在合适时机引导回客户关系管理主题。

# 输出格式（JSON only）
不要输出任何解释、Markdown 代码块或 <think> 标签，只输出纯 JSON。
{
  "reply": "string",
  "actions": [],
  "confidence": 0.9
}

# 用户输入
{{user_input}}`;
