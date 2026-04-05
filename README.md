# CRM MVP

一个最小可运行的 CRM 对话式 query engine 原型。

## 当前定位

- 新的主方向是对话式 query engine，当前已经完成 Step 2 的最小闭环：统一 understanding、联系人确认增强、query answering、最小 action execution。
- `/engine/respond` 现在会先经过统一 understanding layer，再进入联系人确认、query answering 或动作规划。
- `/engine/respond` 现在也支持最小 query answering，`query` 不再只是候选动作占位。
- 当前版本内置 SQLite 持久化，用于存储客户、联系人、联系方式、联系人基础资料、联系人画像、待办和沟通备注。
- 默认时区使用 `Asia/Singapore`。
- 支持可选 OpenAI 抽取层；当前 engine 已是 `LLM-first world knowledge grounding + LLM-first understanding + LLM-first clue extraction + rule-based contact resolution + minimal query executor`，未配置 API Key 时回退到轻量 fallback。
- 在待办 intent 之外，额外输出开放式 `conversation_insight`，用于承接偏好、价格敏感、关系信息等沟通语义。
- 当前只实现最小执行层：`add_note`、`create_task`、`create_reminder` 会在动作选择后即时写库。
- 当前仍未实现完整 action system、对话结束统一回顾后批量执行、session 持久化、KB、语音和多 agent。

## 安装

```bash
npm install
cp .env.example .env
```

如果你要启用 OpenAI，把 `.env` 里的 `OPENAI_API_KEY` 填上。
如果你不填写 `DATABASE_URL`，默认会使用本地 SQLite 文件 `data/crm.sqlite`。

如果你准备把仓库 push 到 GitHub 后让别人直接 pull 下来本地部署，完整步骤见：

- [docs/local_deployment.md](/Users/shufangsong/Documents/crm/docs/local_deployment.md)

## 运行

开发模式：

```bash
npm run dev
```

编译：

```bash
npm run build
```

生产运行：

```bash
npm start
```

测试：

```bash
npm test
```

## 接口总览

新协议主接口：

`POST /engine/respond`

旧接口仍保留：

`POST /agent/parse-task-intent`

数据库上下文旧接口：

- `GET /customers/:customerId/context`
- `POST /customers/:customerId/parse-task-intent`

调试页：

`GET /playground`

新的 engine 测试页：

`GET /engine-playground`

## 新旧接口差异

- `/engine/respond`
  用于对话式入口。先识别联系人，再返回候选动作、追问和 assistant reply，适合作为后续 CRM engine 的主方向。
- `/agent/parse-task-intent`
  用于旧的“当前客户已确定”场景，输入里直接带 customer 和 open_tasks，输出单次待办解析结果。

## /engine/respond

当前 Step 2 已完成的是“理解层 + 联系人确认 + query answering + 演示与测试”闭环。

当前主流程：

1. 先做统一 understanding
2. 判断当前输入是新请求还是在回答上一轮问题
3. 再进入联系人线索抽取和联系人确认
4. 如果原始请求是 query，联系人确认后直接回答
5. 如果原始请求是 note/task/reminder/mixed，再生成 `proposed_actions`
6. 如果动作参数不完整，进入澄清
7. 如果动作完整，进入动作选择
8. query 型请求会直接回答；动作型请求在选择动作后会即时执行最小子集并写入 SQLite

### 最小 Query Answering

当前已支持已确认联系人的基础查询：

- 联系方式
- 公司
- 职位
- 已有 profile 字段
- conversation notes 中的关系信息
- open tasks / notes 的简要摘要

例如：

- “张总女儿生日是什么时候”
- “张总手机号是多少”
- “他现在是什么职位”
- “最近和他聊了什么”

### Understanding Layer

当前 understanding 前新增了一层轻量 `world knowledge grounding`。

grounding 只负责：

- 识别现实世界概念
- 做归一化
- 提供 CRM semantic hint

例如：

- `PSLE` -> `education_exam` + `family_milestone_event`
- `Hari Raya` -> `cultural_holiday` + `relationship_maintenance_holiday`

它不会直接产出动作，也不会变成百科解释器。

当前 understanding 为 LLM 优先、规则兜底。

稳定输出至少包括：

- `primary_interaction_type`
- `semantic_facets`
- `confidence`
- `requires_contact_resolution`
- `contact_hints`
- `query_intent`
- `action_intent`
- `needs_clarification`
- `clarification_focus`
- `summary`
- `source`
- `arbitration_notes`
- `grounded_concepts`

说明：

- understanding layer 只负责“理解与分类”
- 本地 detector 只补 facets，不直接替代 LLM 主判断
- arbitration layer 只做轻量仲裁，不把 understanding 重新做成规则分类器
- 不负责最终联系人绑定
- 当前最小 action executor 只支持 `add_note`、`create_task`、`create_reminder`
- 联系人线索抽取为 LLM 优先、规则兜底
- 联系人绑定仍由 contact resolver 完成
- query answering 由 minimal query executor 完成
- 动作规划仍由 action planner 完成
- `assistant_reply` 现在也支持 LLM 优先组织文案，失败时回退到模板

联系人召回仍基于：

- `contacts`
- `contact_basics`
- `contact_methods`

### Mode 语义

- `resolve_contact`
  联系人还没解决：未识别、未找到、候选歧义
- `confirm`
  需要用户确认：确认唯一联系人、选择动作、确认动作
- `clarify`
  联系人已确认，但动作参数还不完整
- `answer`
  返回总结性结果，当前用于“query 已回答”或“动作已确认并已执行最小子集”
- `execute`
  目前只保留枚举，当前这一步仍不返回

### pending_question

`pending_question` 现在是结构化对象：

```json
{
  "type": "action_selection",
  "question": "请选择要继续的动作，可多选，也可以直接选全部。",
  "field": null,
  "action_id": null,
  "options": [
    { "label": "记录客户对报价感兴趣", "value": "add_note_1" }
  ]
}
```

### execution_result

动作确认并执行后，response 会额外返回：

```json
{
  "execution_result": {
    "status": "success",
    "executed_actions": [
      {
        "action_id": "create_task_1",
        "kind": "create_task",
        "success": true,
        "record_id": "t_...",
        "message": "task_created"
      }
    ],
    "failed_actions": []
  }
}
```

其中：

- `status`: `not_run | partial_success | success | failed`
- `executed_actions`: 成功写库的动作结果
- `failed_actions`: 单条失败但不影响其他动作继续执行的结果

兼容性说明：

- planner 生成的新动作仍以系统已知 kind 为主
- 但对于客户端回传的 `session_state.draft_plan.proposed_actions`，协议会允许未知 kind 进入 executor
- 未知 kind 不会导致 `/engine/respond` 400，而会在 `execution_result.failed_actions` 中返回

字段说明：

- `type`
- `question`
- `field`
- `action_id`
- `options`

当前 `type` 与 `mode` 的约束关系：

- `resolve_contact` -> `contact_resolution`
- `clarify` -> `slot_filling | generic_clarification`
- `confirm` -> `contact_resolution | action_selection`
- `answer` -> 通常 `pending_question = null`

请求示例：

```json
{
  "now": "2026-04-01T10:00:00+08:00",
  "input_text": "今天和张总聊了10分钟，他对我们的报价很感兴趣，下周要把产品demo发给他。还聊到他女儿下个月24号过生日。"
}
```

如果联系人有多个候选，返回会进入 `resolve_contact`：

```json
{
  "mode": "resolve_contact",
  "contact_resolution": {
    "status": "ambiguous",
    "query_name": "张总",
    "candidates": [
      {
        "id": "ct_001",
        "name": "张伟",
        "display_name": "张总",
        "company": "ABC贸易",
        "phone": "13800000001",
        "customer_id": "c_001"
      },
      {
        "id": "ct_002",
        "name": "张建国",
        "display_name": "张总",
        "company": "新海科技",
        "phone": "13800000002",
        "customer_id": "c_002"
      }
    ],
    "selected_contact_id": null
  },
  "pending_question": {
    "type": "contact_resolution",
    "question": "我找到了多个候选联系人，请先确认是哪一位。",
    "field": "contact",
    "action_id": null,
    "options": [
      { "label": "张总 / 张伟 / ABC贸易", "value": "ct_001" },
      { "label": "张总 / 张建国 / 新海科技", "value": "ct_002" }
    ]
  },
  "assistant_reply": "请先确认是哪个联系人"
}
```

如果联系人唯一命中，第一轮会先要求用户确认联系人：

```json
{
  "mode": "confirm",
  "contact_resolution": {
    "status": "resolved",
    "query_name": "王总",
    "selected_contact_id": "ct_003",
    "confirmed_contact_id": null,
    "confirmation_required": true,
    "candidates": []
  },
  "pending_question": {
    "type": "contact_resolution",
    "question": "请确认联系人是否正确。",
    "field": null,
    "action_id": null,
    "options": [
      { "label": "王总 / 王建明 / 海盛物流", "value": "ct_003" }
    ]
  }
}
```

联系人确认后才继续进入动作理解。如果动作参数还不完整，会进入 `clarify`：

```json
{
  "mode": "clarify",
  "proposed_actions": [
    {
      "id": "add_note_1",
      "kind": "add_note",
      "status": "ready",
      "confidence": 0.85,
      "payload": {
        "contact_id": "ct_003",
        "note": "联系人对报价表现出兴趣"
      }
    },
    {
      "id": "create_task_2",
      "kind": "create_task",
      "status": "needs_input",
      "confidence": 0.88,
      "payload": {
        "contact_id": "ct_003",
        "title": "发送产品demo",
        "due_at": null
      }
    }
  ],
  "pending_question": {
    "type": "slot_filling",
    "question": "王总的 demo 准备下周哪天发？",
    "field": "due_at",
    "action_id": "create_task_2",
    "options": []
  }
}
```

如果动作信息已经完整，但用户还没选动作，会进入动作选择：

```json
{
  "mode": "confirm",
  "pending_question": {
    "type": "action_selection",
    "question": "请选择要执行的动作，可多选，也可以直接选全部。",
    "field": null,
    "action_id": null,
    "options": [
      { "label": "记录客户对报价感兴趣", "value": "add_note_1" },
      { "label": "发送产品demo给王总", "value": "create_task_2" }
    ]
  }
}
```

用户一旦选了动作，系统会直接执行并进入 `answer`：

```json
{
  "mode": "answer",
  "pending_question": null,
  "execution_result": {
    "status": "success",
    "executed_actions": [
      { "action_id": "add_note_1", "kind": "add_note", "success": true, "record_id": "n_...", "message": "note_saved" }
    ],
    "failed_actions": []
  },
  "session_state": {
    "draft_plan": {
      "selected_action_ids": ["add_note_1", "create_task_2"],
      "actions_confirmed": true
    }
  },
  "assistant_reply": "已记录 1 条备注，并创建 1 条待办。"
}
```

## Engine 前端测试页

启动服务后访问 [http://localhost:3000/engine-playground](http://localhost:3000/engine-playground)。

这个页面支持：

- 直接输入自然语言
- 根据 `mode + pending_question.type` 驱动交互
- 区分联系人未识别 / 未找到 / 候选歧义 / 唯一联系人确认
- 在 `clarify` 阶段继续补参数
- 在 `confirm + action_selection` 阶段做动作多选
- 在 `answer` 阶段区分 query answer 与 action answer
- 自动带上上一轮 `session_state` 继续请求
- 展示 `assistant_reply`
- 展示 `understanding.primary_interaction_type`
- 展示 `understanding.semantic_facets`
- 展示 `contact_resolution`
- 展示 `proposed_actions`
- 查看完整响应 JSON

## 新协议结构

### Session State

- `session_id`
- `raw_user_input`
- `contact_resolution`
- `draft_plan`
- `pending_question`

### Contact Resolution

- `status`: `unresolved | ambiguous | resolved | not_found`
- `query_name`
- `candidates`
- `selected_contact_id`

候选联系人包含：

- `id`
- `name`
- `display_name`
- `company`
- `phone`
- `customer_id`

### Engine Response

- `mode`: `resolve_contact | clarify | confirm | answer | execute`
- `session_state`
- `contact_resolution`
- `understanding`
- `proposed_actions`
- `pending_question`
- `assistant_reply`

### Pending Question

- `type`: `contact_resolution | slot_filling | action_selection | generic_clarification`
- `question`
- `field`
- `action_id`
- `options`

## 动作选择后直接执行

当前联系人确认后的动作阶段是两段：

1. 已生成 `proposed_actions`，但用户还没选动作
   - `mode = confirm`
   - `pending_question.type = action_selection`
2. 用户已经选了动作
   - `mode = answer`
   - `pending_question = null`
   - 直接执行最小 action 子集，并返回 `execution_result`

### Proposed Action

- `id`
- `kind`: `add_note | create_task | update_task | complete_task | create_reminder | query`
- `status`: `proposed | needs_input | ready`
- `confidence`
- `payload`

## 联系人确认流程

第一轮：

1. 用户输入自然语言
2. 系统先抽取联系人称呼，如 `张总`
3. 联系人库搜索候选
4. 如果 0 个候选，返回 `not_found`
5. 如果 1 个候选，也先返回联系人确认卡片
6. 如果多个候选，返回 `ambiguous`，等待用户确认
7. 联系人确认后，才继续动作理解

联系人确认卡片里的简介文案：

- 配置了 `OPENAI_API_KEY` 时，会优先用大模型基于 `contact_basics + contact_profiles + contact_methods` 生成更自然的确认简介
- 未配置 key 或调用失败时，会回退到本地模板拼接

联系人确认后的候选动作规划：

- 配置了 `OPENAI_API_KEY` 时，会优先用大模型直接生成 `proposed_actions + pending_question + summary`
- 本地规则现在只作为兜底 fallback，不再是主路径
- 响应里的 `understanding.planning_source` 会标记本轮是 `llm` 还是 `fallback_rules`

联系人确认后的 query 分支：

- 如果 understanding 判断为 `query`，联系人确认完成后会优先进入 minimal query executor
- 如果数据存在，直接 `mode = answer`
- 如果数据不存在，也会 `mode = answer`，但明确说明当前未找到
- query 路径当前不会返回 `proposed_actions`

第二轮确认：

前端把上一轮返回的 `session_state` 回传给 `/engine/respond`，同时附上：

- `selected_contact_id`
  或
- 用户补充说明，如“新海科技那位”

系统会基于原始 `raw_user_input` 继续生成 `proposed_actions`。

## 当前没有做什么

Step 2 完成后仍刻意没有做：

- 没有真实执行器
- 没有 session 持久化
- 没有新 action kind
- 没有 embedding 检索
- 没有多 agent 编排
- 没有真实写库 side effect

请求示例：

```json
{
  "now": "2026-03-31T10:00:00+08:00",
  "customer": {
    "id": "c_001",
    "name": "张老板"
  },
  "open_tasks": [
    {
      "id": "t_101",
      "title": "发送报价",
      "task_type": "send_quote",
      "status": "open",
      "due_at": "2026-04-02T18:00:00+08:00",
      "note": null
    },
    {
      "id": "t_102",
      "title": "催收首付款",
      "task_type": "collect_payment",
      "status": "open",
      "due_at": null,
      "note": null
    }
  ],
  "input_text": "张老板已经付款了"
}
```

响应示例：

```json
{
  "intent": "complete",
  "target_task_id": "t_102",
  "target_task_hint": {
    "task_type": "collect_payment",
    "title_keywords": ["付款"]
  },
  "new_task": {
    "title": null,
    "task_type": null,
    "due_at": null,
    "note": null
  },
  "changes": {
    "title": null,
    "due_at": null,
    "status": "done",
    "note": null
  },
  "operations": [
    {
      "op": "complete",
      "target_task_id": "t_102",
      "target_task_hint": {
        "task_type": "collect_payment",
        "title_keywords": ["付款"]
      },
      "new_task": {
        "title": null,
        "task_type": null,
        "due_at": null,
        "note": null
      },
      "changes": {
        "title": null,
        "due_at": null,
        "status": "done",
        "note": null
      }
    }
  ],
  "needs_clarification": false,
  "clarification_question": null,
  "confidence": 0.9,
  "evidence": "张老板已经付款了"
}
```

备注类响应还会额外带出 `conversation_insight`，例如：

```json
{
  "intent": "noop_or_note",
  "conversation_insight": {
    "note_type": "customer_preference",
    "summary": "客户偏好红酒",
    "tags": ["红酒", "个人偏好"],
    "structured_slots": {
      "preference_item": "红酒"
    }
  }
}
```

## 目录结构

- `src/app.ts`: Express 应用装配
- `src/db/*`: SQLite 初始化与连接
- `src/repositories/customer-repository.ts`: 客户、待办、备注的数据库访问
- `src/server.ts`: 启动入口
- `src/routes/agent.ts`: HTTP 路由
- `src/routes/customers.ts`: 基于数据库上下文的客户路由
- `src/routes/engine.ts`: 新的 query engine 接口
- `src/services/contact-resolver.ts`: 联系人召回与确认
- `src/services/query-engine.ts`: query engine 协议层与状态流
- `src/services/intent-parser.ts`: 解析服务，组织抽取层与规则层
- `src/services/customer-context-service.ts`: 基于数据库的客户上下文服务
- `src/services/task-resolver.ts`: 当前待办匹配与歧义处理
- `src/services/time-parser.ts`: 基础时间解析
- `src/providers/llm.ts`: LLM provider 抽象与 fallback provider
- `src/routes/playground.ts`: 手动调试页
- `src/types/agent.ts`: 核心类型
- `src/types/engine.ts`: query engine 核心协议
- `src/lib/schema.ts`: Zod schema
- `src/lib/engine-schema.ts`: query engine 的 Zod schema
- `tests/agent.test.ts`: 核心行为测试

## 当前支持

- 新增待办识别：`记得 / 需要 / 要 / 必须`
- 完成待办识别：`已经付款了 / 已经发了 / 处理完了`
- 修改日期识别：`改到 / 延到 / 推到 / 下周三 / 明天 / 月底`
- 取消待办识别：`不用了 / 先取消 / 不跟了`
- 备注识别：不满足待办操作时归类为 `noop_or_note`
- 歧义处理：像“这条先不用做了”这类表达在无法唯一定位时会返回追问
- 开放式沟通理解：在 `noop_or_note` 等场景下，附带 `conversation_insight`

## Conversation Insight

`intent` 仍然只负责待办动作判断，开放式沟通理解通过 `conversation_insight` 输出，不与待办动作枚举混在一起。

当前基础支持：

- `general_note`
- `customer_preference`
- `price_sensitivity`
- `relationship_info`
- `meeting_summary`
- `risk_signal`
- `decision_signal`

返回结构：

```json
{
  "conversation_insight": {
    "note_type": "customer_preference",
    "summary": "客户偏好红酒",
    "tags": ["红酒", "个人偏好"],
    "structured_slots": {
      "preference_item": "红酒"
    }
  }
}
```

## OpenAI 配置

在项目根目录创建 `.env`：

```bash
cp .env.example .env
```

填写：

```bash
OPENAI_API_KEY=你的key
OPENAI_MODEL=gpt-4.1-mini
PORT=3000
DATABASE_URL=
```

行为说明：

- 配置了 `OPENAI_API_KEY`：服务会优先调用 OpenAI 做抽取，再交给本地规则层做匹配与标准化
- 未配置 `OPENAI_API_KEY`：服务直接使用本地规则解析
- 如果 OpenAI 调用失败：自动回退到本地规则解析

## 前端调试页

启动服务后访问 [http://localhost:3000/playground](http://localhost:3000/playground)。

这个页面可以直接编辑：

- `now`
- 当前客户 JSON
- 当前待办列表 JSON
- 一句模拟用户输入

提交后会在右侧持续追加结构化响应，方便你模拟连续对话。

## 数据库

当前默认使用 SQLite，适合本地 MVP。

默认行为：

- 未设置 `DATABASE_URL` 时，数据库文件位于 [data/crm.sqlite](/Users/shufangsong/Documents/crm/data/crm.sqlite)
- 服务启动时会自动建表
- 首次启动会自动写入示例客户、多个姓张的联系人、联系方式、基础资料、profile 和 open tasks

当前表：

- `customers`
- `contacts`
- `contact_methods`
- `contact_basics`
- `contact_profiles`
- `tasks`
- `conversation_notes`
- `reminders`

示例：获取客户上下文

```bash
curl http://localhost:3000/customers/c_001/context
```

示例：基于数据库里的客户和待办做解析，并持久化备注

```bash
curl -X POST http://localhost:3000/customers/c_001/parse-task-intent \
  -H 'Content-Type: application/json' \
  -d '{
    "now": "2026-03-31T10:00:00+08:00",
    "input_text": "今天和张老板聊天，发现他喜欢红酒",
    "persist_note": true
  }'
```

## 后续扩展建议

- 在 `session_state` 基础上增加真正的多轮会话持久化
- 扩展当前最小执行层到更多 action kind，并补更完整的审批流
- 把联系人解析从规则召回升级到更稳的语义检索
- 增强时间解析，补充“本周五下午三点”等更细粒度表达
- 增加多操作拆分，把一句话中的多个动作写入 `operations`
