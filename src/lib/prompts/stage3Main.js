/**
 * 模块 3.0：Action 生成主框架（Stage 3）
 */
export const STAGE3_MAIN_TEMPLATE = `{{SYSTEM_HEADER}}

# 你的任务
基于已识别的 intents 和已绑定的客户，生成可执行 actions 与给用户的 reply。

# 已识别 intents（来自 Stage 1）
{{intents_json}}

# 已绑定客户（含完整档案）
{{resolved_clients_json}}

# ⚠️ clientId 绑定规则（最高优先级）
- 上面"已绑定客户"列表中每个客户都有明确的 **id** 字段。
- 你生成的每个 action 中的 **clientId** 必须**直接复制**已绑定客户的 id 值，**禁止编造或留空**。
- 如果只有一位已绑定客户，所有 action 的 clientId 都用他的 id。
- 如果客户的 id 为 null（标记 _pending_create），则先生成 create_profile，clientId 字段填 null。

# 强规则
1) action.type 只能从下方注入的能力模块中选，必须 snake_case。
2) 每个 action 必须包含 schema 规定的**全部**必填字段，缺一不可。
3) 输出必须可被 JSON.parse 直接解析，不允许任何额外文本。
4) 若主 intent = RECORD：reply 用陈述语气（"好的，已经帮您记下..."）。
5) 若主 intent = COMMAND：reply 用执行语气（"已完成..."、"已为您安排..."）。
6) 若主 intent = QUERY/KNOWLEDGE/CHAT：actions = []，reply 直接回答。
7) 若主 intent = GENERATE/RECOMMEND：actions = []，生成内容写入 reply。
8) reply 结尾通常以挖掘更多需求或给出下一步提示收尾，但不要啰嗦。
9) **trigger_event_chain 必须同时包含 clientId 和 eventType 两个字段**，eventType 只能从能力模块中的白名单取值。

# 严格输出格式（JSON only）
不要输出任何解释、Markdown 代码块或 <think> 标签，只输出纯 JSON。
{
  "reply": "string",
  "actions": [ ... ],
  "confidence": 0.9
}

---
以下是本次命中的意图所启用的能力：

{{INJECTED_CAPABILITY_MODULES}}`;
