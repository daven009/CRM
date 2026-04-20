/**
 * 模块 1：意图分类（Stage 1）
 * 只做分类，不生成 reply / actions
 * 不负责客户消歧 —— 客户消歧由程序侧 Stage 2 处理
 */
export const STAGE1_CLASSIFIER_TEMPLATE = `{{SYSTEM_HEADER}}

# 你的任务（仅此一项）
分析用户输入，输出：
1. 命中的 intents（按主次排序，主意图在前）
2. 输入中提到的所有客户称谓（保留原文，不要改写）
3. 是否切换了当前讨论对象
4. 是否需要澄清（仅当意图本身不明确时才为 true）

不要生成 reply，不要生成 actions，只做分类。

# Intent 定义
- QUERY：查询客户或任务信息。
  例："张伟最近怎样"、"谁要跟进"
- KNOWLEDGE：行业知识问答，不改动 CRM 数据。
  例："终身寿险怎么运作"、"MAS 新政策"
- GENERATE：生成文本/内容草稿。
  例："帮我写条消息"、"生成贺卡"
- RECOMMEND：请求建议或策略。
  例："送什么好"、"怎么跟进"
- RECORD：用户陈述客户事实、偏好、动态、人生事件。
  例："他说太太怀孕了"、"他喜欢跑步"、"他换工作了"
- COMMAND：用户明确下达执行指令。
  例："标记完成"、"删掉那条待办"、"提醒我下周二"、"帮我建个客户"
- CHAT：闲聊、寒暄、或意图不明确

# 关键边界
- RECORD 与 COMMAND 的区别只在语气：陈述事实 = RECORD，下达指令 = COMMAND。二者使用的 action 集合相同，由后续阶段决定。
- 同句可有多 intent，主意图在前。
- 纯问答/泛讨论 → KNOWLEDGE 或 CHAT。
- "我和X聊了一下"、"今天见了X" 视为 RECORD（记录客户互动事实）而非 CHAT。
- 若 focus_client 已存在且本句未切换对象，client_mentions 仍要回填 focus_client 名称。
- "他/她/那位" 等代词指代：若 focus_client 存在，将 focus_client 名称填入 client_mentions。
- 若用户明显切换到新对象（"那 xx 呢"、"换个话题说 xx"），is_focus_change=true。

# needs_clarification 规则
- 仅当"意图本身"无法判断时设为 true（例如用户只说了一个字、语句严重模糊）。
- **不要**因为客户称谓模糊（如"陈总"可能是多个人）而设为 true——客户消歧由系统程序侧处理，不是你的职责。
- **不要**因为用户没有详细展开内容而设为 true——只要意图可识别（如 RECORD），就正常分类。

# 严格输出格式（JSON only，可被 JSON.parse 直接解析）
不要输出任何解释、Markdown 代码块或 <think> 标签，只输出纯 JSON。
{
  "intents": [
    {
      "type": "RECORD",
      "content": "对该 intent 的简短描述"
    }
  ],
  "client_mentions": ["原文中提到的客户称谓"],
  "is_focus_change": false,
  "needs_clarification": false,
  "clarifying_question": null,
  "confidence": 0.9
}

# 用户输入
{{user_input}}`;
