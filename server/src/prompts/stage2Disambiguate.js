/**
 * 模块 2：客户消歧（Stage 2，可选调用）
 */
export const STAGE2_DISAMBIGUATE_TEMPLATE = `{{SYSTEM_HEADER}}

# 你的任务
用户提到了"{{mention}}"，数据库中有多位候选客户。
请结合上下文判断最可能指向哪一位。
若证据不足以判断，输出 needs_clarification=true。

# 候选客户
{{candidates_json}}
// 每个候选包含：id, name, company, phone, last_contact_date, top_traits, relations

# 输出格式（JSON only）
不要输出任何解释、Markdown 代码块或 <think> 标签，只输出纯 JSON。
{
  "resolved_client_id": "string or null",
  "reasoning": "简短说明为什么选这位（或为什么无法判断）",
  "needs_clarification": false,
  "clarifying_question": null
}`;
