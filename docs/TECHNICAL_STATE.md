# CRM Query Engine Technical State

这份文档是当前仓库的技术状态快照，目标是让后续 agent 或开发者在上下文清零后，能够快速理解：

- 当前项目已经实现了什么
- 核心协议和状态机是什么
- 代码主要分布在哪里
- 数据库里有哪些表和 mock 数据
- 哪些能力是规则实现，哪些能力已经接了大模型
- 目前还没做什么，下一步应该往哪里走

## 1. 项目定位

当前仓库已经从“单次待办解析器”演进为“支持联系人确认的对话式 query engine 基础协议”。

当前 Step 1 已完成范围：

- 核心 types / schema 已统一
- `mode` 与状态机语义已收敛
- `pending_question` 已结构化
- playground、README、TECHNICAL_STATE、测试已和当前 `/engine/respond` 协议对齐

当前 Step 2A 已完成范围：

- `/engine/respond` 最前面已新增统一 understanding layer
- understanding 为 LLM 优先、规则兜底
- understanding 已能稳定表达 interaction type、contact requirement、clarification focus

当前 Step 2B 已完成范围：

- 联系人线索抽取已升级为 LLM-first clue extraction
- 最终联系人绑定仍保持 rule-based resolution

当前 Step 2C 已完成范围：

- engine 已支持最小 query answering
- `query` 不再只是候选动作占位

当前 Step 2D 已完成范围：

- engine-playground 已和 Step 2 的 query / action 分流对齐
- 测试已覆盖 understanding、联系人线索抽取增强、最小 query answering、Step 1 状态机回归
- README、TECHNICAL_STATE、change_log 已和当前实现同步

当前 Step 3A 已完成范围：

- `proposed_actions` 已接入最小执行层
- 已支持 `add_note` / `create_task` / `create_reminder` 的真实数据库写入
- `/engine/respond` 在动作执行结果返回时仍保持 `mode = answer`，但会追加 `execution_result`
- 测试已覆盖执行成功、部分成功、未确认不执行、数据库真实变化

当前 Step 3B 已完成范围：

- engine 已能区分“回答上一轮问题”和“发起新请求”
- 新请求会保留已确认联系人，但不会错误继承旧 request 本体
- `raw_user_input`、旧 draft actions、旧 pending question 不会再被无条件沿用

当前 Step 3C 已完成范围：

- 已移除 `action_confirmation` 中间层
- 用户在 `action_selection` 选中动作后会直接执行最小 action 子集
- 新请求支持最近已确认联系人的短期继承
- 继承联系人，但不继承旧 request 本体

当前 Step 3D 已完成范围：

- understanding 前新增 `world knowledge grounding` 层
- grounding 会输出结构化 `grounded_concepts`
- grounding 只服务于 intent / facets / clarification 判断，不直接替代 action planning 或 query answering
- 当前 fallback 只覆盖极少量高价值本地概念锚点，不是大规模词典系统
- grounding prompt 现已明确要求做“现实世界概念归一化”，包括俗称、别称、缩写与标准概念名的映射，例如 `小六会考 -> PSLE`

当前 Step 3E 已完成范围：

- grounded concepts 已开始参与 action planning 的 payload 归一化
- family milestone / holiday 这类 grounded 输入现在可以稳定生成可执行的 `add_note`，必要时再补 `create_reminder`
- planner 或 fallback 即使漏掉 `payload.note` / `remind_at`，也会在进入 executor 前先做最小归一化或降级为 `needs_input`

主方向：

- 用户直接在对话框输入自然语言
- 系统先抽取联系人线索
- 再跨联系人相关表做召回和排序
- 命中后先返回联系人确认
- 用户确认联系人后，再继续生成候选动作 `proposed_actions`

旧能力仍保留，但不是主方向：

- `POST /agent/parse-task-intent`
- `POST /customers/:customerId/parse-task-intent`

新主方向接口：

- `POST /engine/respond`

## 2. 技术栈

- Node.js
- TypeScript
- Express
- Zod
- SQLite (`better-sqlite3`)
- Vitest + Supertest
- 可选 OpenAI provider

## 3. 运行方式

安装：

```bash
npm install
cp .env.example .env
```

开发：

```bash
npm run dev
```

测试：

```bash
npm test
```

构建：

```bash
npm run build
```

默认数据库文件：

- [data/crm.sqlite](/Users/shufangsong/Documents/crm/data/crm.sqlite)

环境变量：

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `PORT`
- `DATABASE_URL`

## 4. 当前目录结构

### 服务入口

- [src/server.ts](/Users/shufangsong/Documents/crm/src/server.ts)
- [src/app.ts](/Users/shufangsong/Documents/crm/src/app.ts)

### 新 engine 主线

- [src/routes/engine.ts](/Users/shufangsong/Documents/crm/src/routes/engine.ts)
- [src/services/engine-understanding.ts](/Users/shufangsong/Documents/crm/src/services/engine-understanding.ts)
- [src/services/concept-grounder.ts](/Users/shufangsong/Documents/crm/src/services/concept-grounder.ts)
- [src/services/contact-clue-extractor.ts](/Users/shufangsong/Documents/crm/src/services/contact-clue-extractor.ts)
- [src/services/query-engine.ts](/Users/shufangsong/Documents/crm/src/services/query-engine.ts)
- [src/services/contact-resolver.ts](/Users/shufangsong/Documents/crm/src/services/contact-resolver.ts)
- [src/services/contact-intro-generator.ts](/Users/shufangsong/Documents/crm/src/services/contact-intro-generator.ts)
- [src/services/engine-action-planner.ts](/Users/shufangsong/Documents/crm/src/services/engine-action-planner.ts)
- [src/services/action-executor.ts](/Users/shufangsong/Documents/crm/src/services/action-executor.ts)
- [src/types/engine.ts](/Users/shufangsong/Documents/crm/src/types/engine.ts)
- [src/lib/engine-schema.ts](/Users/shufangsong/Documents/crm/src/lib/engine-schema.ts)

### 旧 parser 主线

- [src/routes/agent.ts](/Users/shufangsong/Documents/crm/src/routes/agent.ts)
- [src/services/intent-parser.ts](/Users/shufangsong/Documents/crm/src/services/intent-parser.ts)
- [src/services/task-resolver.ts](/Users/shufangsong/Documents/crm/src/services/task-resolver.ts)
- [src/services/time-parser.ts](/Users/shufangsong/Documents/crm/src/services/time-parser.ts)
- [src/types/agent.ts](/Users/shufangsong/Documents/crm/src/types/agent.ts)
- [src/lib/schema.ts](/Users/shufangsong/Documents/crm/src/lib/schema.ts)

### 数据库和仓储

- [src/db/client.ts](/Users/shufangsong/Documents/crm/src/db/client.ts)
- [src/db/init.ts](/Users/shufangsong/Documents/crm/src/db/init.ts)
- [src/repositories/customer-repository.ts](/Users/shufangsong/Documents/crm/src/repositories/customer-repository.ts)
- [src/services/customer-context-service.ts](/Users/shufangsong/Documents/crm/src/services/customer-context-service.ts)

### 前端测试页

- [src/routes/playground.ts](/Users/shufangsong/Documents/crm/src/routes/playground.ts)
- [src/routes/engine-playground.ts](/Users/shufangsong/Documents/crm/src/routes/engine-playground.ts)

### LLM provider

- [src/providers/llm.ts](/Users/shufangsong/Documents/crm/src/providers/llm.ts)

### 测试

- [tests/agent.test.ts](/Users/shufangsong/Documents/crm/tests/agent.test.ts)

## 5. HTTP 接口现状

### 5.1 主接口

#### `POST /engine/respond`

用途：

- 对话式入口
- 统一 understanding
- 联系人抽取和确认
- 最小 query answering
- 候选动作规划
- 多轮继续依赖 `session_state`

输入大致结构：

```json
{
  "session_id": "optional",
  "now": "2026-04-01T10:00:00+08:00",
  "input_text": "今天和新海的张总聊了10分钟...",
  "session_state": {},
  "selected_contact_id": "optional"
}
```

输出核心字段：

- `mode`
- `session_state`
- `contact_resolution`
- `understanding`
- `proposed_actions`
- `pending_question`
- `execution_result`
- `assistant_reply`

其中：

- `understanding.primary_interaction_type`
  表示仲裁后的主展示类型：query / note / task / reminder / craft / mixed / answer_to_pending
- `understanding.semantic_facets`
  表示本轮输入里并存的语义面：query / note / task / reminder / craft / pending answer
- `understanding.grounded_concepts`
  表示输入中的现实世界概念归一化结果及 CRM semantic hints
- `understanding.source`
  表示 understanding 来自 `llm`、`fallback_rules` 或 `hybrid`
- `understanding.planning_source`
  表示本轮候选动作规划来自 `llm` 还是 `fallback_rules`
- `session_state.draft_plan.selected_action_ids`
  表示当前用户已选中的动作
- `session_state.draft_plan.actions_confirmed`
  表示动作已经确认
- `execution_result`
  表示这一轮动作是否执行，以及逐条成功/失败结果

当前真实约束：

- understanding 前会先做轻量 world knowledge grounding
- 查询型输入在联系人确认后可以直接回答
- 动作型输入在联系人确认和动作选择后，会即时执行最小子集并写库
- 当前只支持 `add_note`、`create_task`、`create_reminder`
- 对于 `session_state` 回传中的未知 action kind，route 层会放行到 executor，再由 executor 记为 `failed_actions`
- 对于新 request turn，系统当前会保留最近已确认联系人，但不保留旧 request 本体和旧 draft actions
- grounding 不是 KB、不是百科问答，也不会直接替代动作规划；它只为 planner 提供更稳定的 CRM 语义锚点
- 不返回真实 `execute`
- 仍未实现完整 action system、session 持久化、对话结束统一回顾后批量执行

### 5.2 旧接口

#### `POST /agent/parse-task-intent`

用途：

- 当前客户已知时的旧版单次待办解析

#### `GET /customers/:customerId/context`

用途：

- 查看某个客户的上下文
- 返回 customer、contacts、open_tasks、notes

#### `POST /customers/:customerId/parse-task-intent`

用途：

- 基于数据库里已有客户上下文调用旧 parser

## 6. Engine 协议

定义位置：

- [src/types/engine.ts](/Users/shufangsong/Documents/crm/src/types/engine.ts)
- [src/lib/engine-schema.ts](/Users/shufangsong/Documents/crm/src/lib/engine-schema.ts)

### 6.1 Engine Mode

当前定义：

- `resolve_contact`
- `clarify`
- `confirm`
- `answer`
- `execute`

当前真实用到：

- `resolve_contact`
- `clarify`
- `confirm`
- `answer`

当前约束：

- `resolve_contact`
  只用于联系人还没解决：未识别、未找到、候选歧义
- `confirm`
  只用于需要用户确认：确认唯一联系人、选择动作、确认动作
- `clarify`
  只用于联系人已确认，但动作参数还不完整，需要补充
- `answer`
  只用于当前轮返回解释、总结、或“已确认但未执行”
- `execute`
  当前仅保留枚举，原型阶段不返回这个 mode

### 6.2 Session State

当前字段：

- `session_id`
- `raw_user_input`
- `contact_resolution`
- `draft_plan`
- `pending_question`

其中 `pending_question` 现在是结构化对象，而不是纯字符串，至少包含：

- `type`
- `question`
- `field`
- `action_id`
- `options`

说明：

- `raw_user_input` 保存第一轮原始输入
- 后续确认联系人时，会继续使用第一轮的 `raw_user_input` 生成动作
- `draft_plan.selected_action_ids` 会记录当前动作选择状态
- `draft_plan.actions_confirmed` 会记录当前轮是否已经完成动作执行
- 目前没有真正把 session state 持久化到数据库，只是请求间回传

### 6.3 Contact Resolution

当前字段：

- `status`
- `query_name`
- `candidates`
- `selected_contact_id`
- `confirmed_contact_id`
- `confirmation_required`

当前语义：

- `selected_contact_id`
  表示当前系统选中的候选联系人
- `confirmed_contact_id`
  表示用户已确认的联系人
- `confirmation_required = true`
  表示即便只有一个高概率命中，也必须先让用户确认

### 6.4 Candidate

候选联系人字段：

- `id`
- `name`
- `display_name`
- `company`
- `phone`
- `customer_id`
- `score`
- `matched_fields`
- `profile_summary`

### 6.5 Proposed Action

当前支持：

- `add_note`
- `create_task`
- `update_task`
- `complete_task`
- `create_reminder`
- `query`

每个动作还包含：

- `display_text`

### 6.6 Pending Question

当前支持类型：

- `contact_resolution`
- `slot_filling`
- `action_selection`
- `generic_clarification`

当前与 mode 的对应关系：

- `resolve_contact`
  - `pending_question.type = contact_resolution`
- `clarify`
  - `pending_question.type = slot_filling | generic_clarification`
- `confirm`
  - `pending_question.type = contact_resolution | action_selection`
- `answer`
  - 通常 `pending_question = null`

说明：

- `kind` 是内部动作枚举
- `display_text` 是展示给用户看的动作文案
- 前端动作按钮、动作卡片和 assistant reply 现在都应该优先展示 `display_text`

### 6.7 Understanding

当前 `understanding` 至少包含：

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
- `planning_source`

当前边界：

- understanding layer 负责统一理解与分类
- 本地 facet detector 只补充显式语义信号
- arbitration layer 会在 LLM 结果过窄时，基于 facets 轻量提升为 `mixed`
- contact resolver 仍负责最终联系人绑定
- query executor 负责已确认联系人的最小查询回答
- action planner 仍负责候选动作规划
- reply composer 负责把已确定的状态机结果组织成更自然的用户回复
- 当前没有真实 action executor

### 6.8 动作规划来源

当前实现已经切到：

- 候选动作规划：LLM 优先
- 本地规则：仅兜底 fallback

### 6.9 最小 Query Executor

实现位置：

- [src/services/query-executor.ts](/Users/shufangsong/Documents/crm/src/services/query-executor.ts)

当前支持的查询范围：

- 手机号 / 联系方式
- 公司
- 职位
- 部分 profile 字段
- conversation notes 中已有的关系信息
- open tasks / notes 的简要摘要

当前约束：

- 只有联系人已确认后才会真正回答
- 如果联系人未确认，仍先进入联系人确认
- 如果数据不存在，也返回 `mode = answer`，明确说明未找到
- 不做 query DSL
- 不做 embedding 检索

具体是：

1. 联系人确认完成后，[src/services/query-engine.ts](/Users/shufangsong/Documents/crm/src/services/query-engine.ts) 会优先看 `semantic_facets + query_intent + action_intent`
2. 如果属于纯 query path，优先调用 [src/services/query-executor.ts](/Users/shufangsong/Documents/crm/src/services/query-executor.ts)
3. 如果带有 task / note / reminder / craft 等动作语义，再进入 [src/services/engine-action-planner.ts](/Users/shufangsong/Documents/crm/src/services/engine-action-planner.ts)
4. 如果配置了 `OPENAI_API_KEY`，planner 会请求 OpenAI，让模型直接输出结构化 `proposed_actions + pending_question + summary`
5. 返回结果会经过本地 Zod 校验
6. 如果没配 key、模型无返回或 JSON 不合法，就回退到规则 planner

也就是说，当前：

- understanding：LLM 优先，规则兜底
- 联系人线索抽取：LLM 优先，规则兜底
- 联系人匹配：规则 + 数据库召回 + 排序
- query answering：最小 query executor
- 联系人确认简介：LLM 优先，模板兜底
- 候选动作规划：LLM 优先，规则兜底

当前状态：

- `proposed`
- `needs_input`
- `ready`

注意：

- 目前只规划，不执行
- 没有执行器

## 7. 当前状态机

状态逻辑集中在：

- [src/services/query-engine.ts](/Users/shufangsong/Documents/crm/src/services/query-engine.ts)

### 7.1 第一轮输入

输入一句自然语言后：

1. 先抽联系人实体线索
2. 召回候选联系人
3. 根据召回结果进入不同状态

### 7.2 联系人状态分支

#### `unresolved`

含义：

- 没抽到任何有效联系人线索

行为：

- `mode = resolve_contact`
- 返回“请补充姓名/公司/手机号”

#### `not_found`

含义：

- 抽到了线索，但数据库没有候选

行为：

- `mode = resolve_contact`
- 返回“请补充更完整身份信息”

#### `ambiguous`

含义：

- 候选不止一个，且分值不足以直接选中

行为：

- `mode = resolve_contact`
- 返回候选联系人列表
- 等待用户二次确认

#### `resolved + confirmation_required = true`

含义：

- 系统认为命中一个最高概率联系人
- 但不会直接进入动作规划

行为：

- `mode = confirm`
- 返回联系人确认气泡
- 返回联系人简介
- 等待用户确认

#### `resolved + confirmed_contact_id != null`

含义：

- 用户已经确认联系人

行为：

- 才会进入动作规划
- 如果动作信息不完整：
  - `mode = clarify`
  - `pending_question.type = slot_filling | generic_clarification`
- 如果动作信息完整但还没选动作：
  - `mode = confirm`
  - `pending_question.type = action_selection`
- 如果已经选了动作：
  - `mode = answer`
  - 直接执行并返回 `execution_result`

### 7.3 联系人确认输入

当前支持两种确认方式：

1. 前端直接传 `selected_contact_id`
2. 用户输入自然语言确认，如：
   - `是的`
   - `确认`
   - `新海科技那位`

### 7.4 动作选择后直接执行

当前最小执行层不再增加二次确认。动作选择完成后，系统会直接执行已选动作。

请求新增字段：

- `selected_action_ids?: string[]`

动作阶段流转：

1. 联系人确认完成
2. 返回 `proposed_actions`
3. 如果还没选动作：
   - `mode = confirm`
   - `pending_question.type = action_selection`
   - `pending_question.question = 请选择要执行的动作，可多选，也可以直接选全部。`
4. 如果已经选了动作：
   - `mode = answer`
   - 直接执行并返回 `execution_result`

当前自然语言也支持：

- `全部`
- `全选`
- `都要`
- `第1个和第3个`
- `执行`
- `继续`

## 7.5 Playground 如何驱动多轮交互

实现位置：

- [src/routes/engine-playground.ts](/Users/shufangsong/Documents/crm/src/routes/engine-playground.ts)

当前 playground 的核心规则：

- UI 优先依据 `mode + pending_question.type` 渲染交互
- `assistant_reply` 始终作为主对话气泡文本
- `understanding.primary_interaction_type`、`semantic_facets`、`source` 会显示在状态面板里
- `pending_question.options` 如果非空，会显示为可点击选项
- `confirm + action_selection`
  - 支持多选动作
  - 支持全选
  - 再点一次已选动作即可取消选择
  - 选中后可直接执行
- `clarify`
  - 提示用户直接继续输入补充参数
- `answer`
  - 区分 query answer 与 action answer
  - query answer 明确显示“已确认联系人并直接返回查询结果”
  - action answer 明确显示“已确认动作但未执行”

playground 的职责是演示当前协议，不承担额外业务逻辑：

- 不自己决定执行动作
- 不自己维护独立状态机
- 只基于接口返回结果驱动下一轮请求

## 9. 测试覆盖现状

主要测试文件：

- [tests/agent.test.ts](/Users/shufangsong/Documents/crm/tests/agent.test.ts)

当前已覆盖的核心状态流：

- understanding 已先于联系人确认生效
- “新海张总”“新海科技张总”“新海的张总”“今天和新海张总聊了10分钟” 这类线索抽取变体
- 联系人未识别 / 未找到 / 候选歧义 / 唯一候选确认
- 联系人确认后的 slot filling、action selection、action confirmation
- query 型输入在联系人确认后进入 `answer`
- note / task / reminder / mixed 仍继续走动作规划，不受 query executor 干扰
- query answer 在数据存在和数据不存在两种情况下都可稳定返回 `mode = answer`

## 8. 联系人解析逻辑

实现位置：

- [src/services/contact-clue-extractor.ts](/Users/shufangsong/Documents/crm/src/services/contact-clue-extractor.ts)
- [src/services/contact-resolver.ts](/Users/shufangsong/Documents/crm/src/services/contact-resolver.ts)

### 8.1 先抽实体线索

当前会抽：

- `person_name`
  例如：
  - `张总`
  - `张老板`
  - `王总`
- `company`
  例如：
  - `新海`
  - `ABC贸易`
- `phone`
- `email`
- `wechat`
- `title_hint`

当前策略：

- 联系人 clue extraction：LLM 优先，规则兜底
- 最终联系人绑定：仍由本地代码做候选召回、打分和状态裁决

也就是说：

- 模型可以帮助把“新海张总”“新海科技张总”“新海的张总”这类开放表达抽成稳定 clues
- 但模型不会直接输出 `contact_id`
- `resolved / ambiguous / not_found / unresolved` 仍由 resolver 决定

### 8.2 再跨表召回

当前召回数据来自：

- `contacts`
- `contact_basics`
- `contact_methods`

### 8.3 打分思路

当前主要分值来源：

- 联系人称呼精确命中
- 联系人姓名精确/部分命中
- 姓氏命中
- 称谓提示命中
- 公司精确/部分命中
- 手机命中
- 邮箱命中
- 微信号命中

### 8.4 当前已覆盖的典型输入

- `今天和张总聊了...`
  会召回多个张姓高管候选

- `今天和新海的张总聊了...`
  会抽出：
  - `person_name = 张总`
  - `company = 新海`
  再优先命中 `新海科技 / 张建国`

- `13800000004 这个联系人今天沟通过...`
  会通过手机号直接命中联系人

## 10. 当前测试覆盖

核心测试位置：

- [tests/agent.test.ts](/Users/shufangsong/Documents/crm/tests/agent.test.ts)

当前已覆盖的 `/engine/respond` 关键状态流包括：

- 未识别联系人
- 联系人未找到
- 歧义联系人
- 唯一联系人待确认
- 联系人确认后进入 slot filling
- 联系人确认后进入 action selection
- 用户已选择动作，进入 action confirmation
- 用户已确认动作，进入 `answer`
- 自然语言选择动作
- 自然语言直接确认动作

测试重点当前放在：

- `mode`
- `pending_question.type`
- `selected_action_ids`
- `actions_confirmed`

而不是仅依赖 `assistant_reply` 文案。

## 11. 当前刻意未做的事

- 没有执行器
- 没有 session 持久化
- 没有 embedding
- 没有新 action kind
- 没有数据库 schema 扩展
- 没有多 agent 编排
- 没有真实写库 side effect

## 9. 联系人确认简介生成

实现位置：

- [src/services/contact-intro-generator.ts](/Users/shufangsong/Documents/crm/src/services/contact-intro-generator.ts)

### 9.1 资料来源

确认简介的数据来自：

- `contact_basics`
- `contact_profiles`
- `contact_methods`

### 9.2 生成策略

当前是“可选 LLM + fallback 模板”：

- 如果有 `OPENAI_API_KEY`
  - 用 OpenAI 基于结构化联系人资料生成一段自然确认简介
- 如果没有 key 或调用失败
  - 回退到本地模板拼接

### 9.3 重要原则

- LLM 只负责“表述层”
- 联系人命中和状态机仍然是规则驱动
- 模型不负责猜联系人，不负责更改匹配结果

## 10. 动作规划逻辑

实现位置：

- [src/services/query-engine.ts](/Users/shufangsong/Documents/crm/src/services/query-engine.ts)
- [src/services/engine-action-planner.ts](/Users/shufangsong/Documents/crm/src/services/engine-action-planner.ts)

当前主路径：

- 候选动作规划已经切到 LLM 优先
- 本地规则只作为 fallback

LLM 输出：

- `summary`
- `signals`
- `pending_question`
- `proposed_actions`

每个 `proposed_action` 至少包含：

- `kind`
- `status`
- `confidence`
- `display_text`
- `payload`

如果模型没有给 `display_text`，后端会基于 `kind + payload` 再补一层人话文案。

fallback 规则目前仍覆盖的最小集合：

- 兴趣/报价反馈 -> `add_note`
- demo/演示 -> `create_task`
- 生日/家人生日 -> `create_reminder`
- 查询句 -> `query`

### 时间解析

复用：

- [src/services/time-parser.ts](/Users/shufangsong/Documents/crm/src/services/time-parser.ts)

当前支持：

- 明确日期
- `明天`
- `后天`
- `下周三`
- `月底`
- 生日提醒里的 `下个月24号`

## 11. 数据库状态

数据库初始化位置：

- [src/db/init.ts](/Users/shufangsong/Documents/crm/src/db/init.ts)

### 11.1 当前表

- `customers`
- `contacts`
- `contact_methods`
- `contact_basics`
- `contact_profiles`
- `tasks`
- `conversation_notes`
- `reminders`

### 11.2 初始化机制

注意：

- 初始化现在是幂等的
- 使用 `INSERT OR IGNORE`
- 不会因为旧库已有 `customers` 就跳过后续新表和新 seed

这个问题之前存在 bug，后来已经修掉。

### 11.3 当前 mock 数据

当前至少有这些联系人：

- `ct_001` 张伟 / 张总 / ABC贸易
- `ct_002` 张建国 / 张总 / 新海科技
- `ct_003` 王海峰 / 王总 / 远航实业
- `ct_004` 张明远 / 张老板 / 明远制造
- `ct_005` 张志强 / 张总 / 华星渠道

联系方式样例：

- 手机
- 微信
- 邮箱

基础资料样例：

- 公司
- 行业
- 关系类型
- 认识方式
- 初识时间
- owner

画像样例：

- 职位
- 部门
- 城市
- source
- preferences
- profile_json

## 12. 前端页面

### 12.1 旧页

- [src/routes/playground.ts](/Users/shufangsong/Documents/crm/src/routes/playground.ts)
- 路径：`/playground`

用途：

- 测旧的单次待办解析器

### 12.2 新 engine 页

- [src/routes/engine-playground.ts](/Users/shufangsong/Documents/crm/src/routes/engine-playground.ts)
- 路径：`/engine-playground`

支持：

- 输入自然语言
- 多轮对话
- 联系人歧义确认
- 唯一命中确认
- 自动带 `session_state`
- 展示 `assistant_reply`
- 展示 `contact_resolution`
- 展示 `proposed_actions`
- 展示完整 JSON

当前前端实现细节：

- 候选联系人按钮在气泡内和右侧面板都可点击
- `Response JSON` 已固定高度，超长内部滚动
- 右侧状态面板各区块已固定高度并内部滚动
- 动作展示优先显示 `display_text`，不再直接显示 `kind`
- 动作现在支持三处选择并同步高亮：
  - 聊天气泡里的动作按钮
  - Contact Resolution 区块里的动作按钮
  - Proposed Actions 区块里的动作卡片
- 支持 `全部`
- 支持 `确认执行这些动作`
- 前端本地用 `selectedActionIds` 保存选中态，避免重绘时丢失

## 13. 旧 parser 现状

旧能力仍可用，核心在：

- [src/services/intent-parser.ts](/Users/shufangsong/Documents/crm/src/services/intent-parser.ts)

能力包括：

- `create`
- `complete`
- `update`
- `cancel`
- `noop_or_note`

并额外支持：

- `conversation_insight`

类型大致包括：

- `general_note`
- `customer_preference`
- `price_sensitivity`
- `relationship_info`
- `meeting_summary`
- `risk_signal`
- `decision_signal`

### 旧 parser 的 LLM 状态

旧 parser 支持：

- 有 key 时走 `OpenAiLlmProvider`
- 没 key 时走规则 fallback

但是新 engine 主线并没有复用旧 parser 的 LLM 抽取逻辑。

## 14. 当前哪些地方接了大模型

### 已接 LLM

1. 旧的待办意图解析：
   - [src/providers/llm.ts](/Users/shufangsong/Documents/crm/src/providers/llm.ts)
   - 用于 `intent-parser`

2. 新的联系人确认简介生成：
   - [src/services/contact-intro-generator.ts](/Users/shufangsong/Documents/crm/src/services/contact-intro-generator.ts)
   - 只负责把联系人结构化资料表述成自然语言简介

### 还没接 LLM

这些仍然主要是规则实现：

- 联系人实体抽取
- 联系人召回和排序
- 联系人确认状态机
- 动作选择状态机
- 时间缺失追问

## 15. 测试现状

测试文件：

- [tests/agent.test.ts](/Users/shufangsong/Documents/crm/tests/agent.test.ts)

当前覆盖：

- 旧 parser 的 create / complete / update / clarify / note
- 数据库上下文接口
- note 持久化
- engine 的：
  - 多联系人歧义
  - 唯一联系人确认
- 公司线索命中
- 手机号命中
- 联系人不存在
- 联系人确认后继续规划动作
- 动作自然语言选择
- 动作显式确认

当前验证状态：

- `npm test` 通过
- `npm run build` 通过

## 16. 当前已知限制

### 16.1 engine 仍然是协议层，不是执行层

现在只返回：

- `proposed_actions`

没有真正执行：

- 创建任务
- 更新任务
- 创建提醒
- 写备注

### 16.2 会话没有持久化

- `session_state` 需要前端回传
- 服务端没有自己的 session store

### 16.3 联系人实体抽取仍偏规则

虽然已经支持：

- 人名/称呼
- 公司
- 手机
- 邮箱
- 微信

但还没有更强的：

- 称呼别名归一化体系
- 更复杂的语义别名
- embedding 检索

### 16.4 动作规划与动作确认还停留在协议层

虽然动作规划已经是 LLM 优先，但当前仍然没有：

- 真正执行选中的动作
- 根据执行结果回写状态
- 更细的权限和审计
- 结合历史任务结果做动作裁剪

### 16.5 README 部分示例可能比实现滞后

README 主干已经更新，但某些旧示例可能还带有早期语义，需要以后再统一清理。

## 17. 如果要继续开发，优先顺序建议

### 第一优先级

给 `proposed_actions` 增加执行层：

- add_note 落库
- create_task 落库
- create_reminder 落库

### 第二优先级

会话持久化：

- 新增 `engine_sessions`
- 保存 `session_state`
- 前端不再需要完整回传所有状态

### 第三优先级

联系人解析继续增强：

- 称呼别名体系，如 `张总 / 张老板 / 张董 / 张经理`
- 公司简称归一化
- 手机尾号/邮箱/微信昵称更强匹配

### 第四优先级

动作规划引入更多上下文：

- 历史备注
- 历史任务
- 联系人 profile
- 客户阶段

### 第五优先级

前端产品化：

- 联系人确认卡片更像真实 CRM 名片
- 增加“不是这个人”分支
- 增加“模拟执行”按钮

## 18. 如果记忆清零，最短恢复路线

优先打开这些文件：

1. [docs/TECHNICAL_STATE.md](/Users/shufangsong/Documents/crm/docs/TECHNICAL_STATE.md)
2. [src/services/query-engine.ts](/Users/shufangsong/Documents/crm/src/services/query-engine.ts)
3. [src/services/contact-resolver.ts](/Users/shufangsong/Documents/crm/src/services/contact-resolver.ts)
4. [src/repositories/customer-repository.ts](/Users/shufangsong/Documents/crm/src/repositories/customer-repository.ts)
5. [src/db/init.ts](/Users/shufangsong/Documents/crm/src/db/init.ts)
6. [tests/agent.test.ts](/Users/shufangsong/Documents/crm/tests/agent.test.ts)

然后执行：

```bash
npm test
npm run build
```

再打开：

- [http://localhost:3000/engine-playground](http://localhost:3000/engine-playground)

优先验证这几个场景：

1. `今天和张总聊了10分钟...`
2. `今天和新海的张总聊了10分钟...`
3. `13800000004 这个联系人今天沟通过...`
4. 联系人确认后继续追问 demo 时间
