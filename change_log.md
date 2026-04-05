# Change Log

## 2026-04-05 Grounded Action Payload Fix

### 问题

`world knowledge grounding` 已能识别 `PSLE / O Level / NS / Hari Raya` 这类现实世界概念，但在动作阶段，planner 某些 `add_note` 只生成了展示文案，没有稳定补全可执行的 `payload.note`。结果是：

- understanding 看起来是对的
- action card 也看起来是对的
- 但 executor 在真实写库时会因为 `missing_note` 失败

### 修复

- `src/services/engine-action-planner.ts`
  - grounding 结果现在会进入 planner prompt
  - 对 `add_note / create_task / create_reminder` 增加 payload 归一化
  - `add_note` 缺 `payload.note` 时会自动补全可写库文本
  - `create_task / create_reminder` 缺关键时间字段时会自动降级为 `needs_input`
- `src/services/query-engine.ts`
  - fallback action planning 现在会消费 `grounded_concepts`
  - family milestone / family life stage / relationship holiday 会稳定生成可执行 note
  - 有明确提醒信号时再补 reminder；没有完整时间时不会盲执行
- `tests/agent.test.ts`
  - 新增 `PSLE` mixed 输入的真实写库回归测试
  - 验证动作卡片里已有完整 `payload.note`
  - 验证全选后两条 `add_note` 都会真实写入数据库

### 当前结果

- grounding 不再只停在 understanding 层
- `PSLE` 这类输入现在能更稳定地落成可执行 CRM 动作
- executor 仍保持最小严格校验，不会盲写半成品 payload

## 2026-04-05 Grounding Alias Normalization

### 问题

当前 `world knowledge grounding` 虽然能识别 `PSLE`，但面对 `小六会考 / 小六汇考` 这类中文俗称时，没有稳定归一到同一个现实世界概念，导致后续 intent 和 action planning 表现不一致。

### 修复

- 强化 [src/services/concept-grounder.ts](/Users/shufangsong/Documents/crm/src/services/concept-grounder.ts) prompt：
  - 明确 grounding 是“现实世界概念归一化任务”，不是简单关键词抽取
  - 明确要求模型把俗称、别称、中文说法、英文全称、缩写统一映射到标准 `normalized`
  - 增加少量 few-shot：
    - `小六会考 -> PSLE`
    - `当兵 -> NS`
    - `过年 -> CNY`
- 增加极小的 fallback alias 保底：
  - `小六汇考 / 小六会考 / 小学离校考试 -> PSLE`
  - `兵役 / 当兵 / 国民服役 -> NS`
  - `过年 / 农历新年 -> CNY`
- 新增测试验证：
  - `他女儿下周小六汇考` 能归一到 `PSLE`

### 当前结果

- grounding 不再只依赖标准缩写字面匹配
- 同义现实概念归一更稳定
- fallback 仍保持极小范围，没有扩成大规模本地词典

## 2026-04-03 Step 1A: 固化 CRM Query Engine 核心协议

### 本次目标

只做协议层收敛，统一 query engine 的核心 TypeScript types 和 Zod schema，让 `/engine/respond` 后续有稳定 contract 可依赖。

明确不做：

- 不扩展新功能
- 不做执行器
- 不做 session 持久化
- 不做 embedding
- 不重写 query-engine 主流程
- 不大改 playground

### 改动文件

核心协议：

- `src/types/engine.ts`
- `src/lib/engine-schema.ts`

最小兼容调整：

- `src/services/query-engine.ts`
- `src/services/engine-action-planner.ts`
- `src/routes/engine-playground.ts`
- `tests/agent.test.ts`

文档同步：

- `docs/TECHNICAL_STATE.md`
- `README.md`

### 协议层改动

#### 1. 统一 EngineMode

固定为：

- `resolve_contact`
- `clarify`
- `confirm`
- `answer`
- `execute`

#### 2. 统一 ContactResolutionStatus

固定为：

- `unresolved`
- `not_found`
- `ambiguous`
- `resolved`

#### 3. 统一 ContactCandidate

现在至少稳定包含：

- `id`
- `name`
- `display_name`
- `company`
- `phone`
- `customer_id`
- `score`
- `matched_fields`
- `profile_summary`

其中这三个字段已从“可选”收敛为稳定字段：

- `score: number | null`
- `matched_fields: string[]`
- `profile_summary: string | null`

目的：

- 避免上层消费方再去区分“字段不存在”和“字段存在但当前没有值”
- 让 schema 与 response contract 更稳定

#### 4. 统一 ContactResolution

现在稳定包含：

- `status`
- `query_name`
- `candidates`
- `selected_contact_id`
- `confirmed_contact_id`
- `confirmation_required`

#### 5. 统一 ProposedAction

现在稳定包含：

- `id`
- `kind`
- `status`
- `confidence`
- `payload`
- `display_text`

#### 6. 新增结构化 PendingQuestion

原来：

- `pending_question: string | null`

现在：

```ts
interface PendingQuestion {
  type:
    | "contact_resolution"
    | "slot_filling"
    | "action_selection"
    | "action_confirmation"
    | "generic_clarification";
  question: string;
  field: string | null;
  action_id: string | null;
  options: Array<{
    label: string;
    value: string;
  }>;
}
```

当前语义：

- `contact_resolution`
  用于联系人缺失、未命中、歧义、单候选确认
- `slot_filling`
  用于动作缺参数，例如 `due_at`、`remind_at`
- `action_selection`
  用于让用户从 `proposed_actions` 里选动作
- `action_confirmation`
  用于二次确认已选动作
- `generic_clarification`
  用于兼容 LLM 仍返回旧字符串形式的澄清问题

#### 7. 统一 SessionState

现在至少包含：

- `session_id`
- `raw_user_input`
- `contact_resolution`
- `draft_plan`
- `pending_question`

其中 `pending_question` 已切换为结构化对象。

#### 8. 统一 EngineResponse

现在至少包含：

- `mode`
- `session_state`
- `contact_resolution`
- `understanding`
- `proposed_actions`
- `pending_question`
- `assistant_reply`

### Schema 层改动

在 `src/lib/engine-schema.ts` 中完成：

- 新增 `pendingQuestionOptionSchema`
- 新增 `pendingQuestionSchema`
- `sessionStateSchema.pending_question` 改为结构化对象
- `engineResponseSchema.pending_question` 改为结构化对象
- `contactCandidateSchema` 与 TypeScript 定义完全对齐

当前关键 response 校验仍然保留在 route 层：

- 请求：`engineRespondRequestSchema.parse(req.body)`
- 响应：`engineResponseSchema.parse(result)`

### 最小兼容调整

#### query-engine

没有重写主流程，只做了最小必要改动：

- 将内部所有 `pendingQuestion: string | null` 改成 `PendingQuestion | null`
- 联系人确认阶段返回结构化 `pending_question`
- 联系人歧义、未命中、未识别时返回结构化 `pending_question`
- 动作选择和动作确认阶段返回结构化 `pending_question`
- slot filling 阶段为问题补充 `field` 和 `action_id`
- 补齐 `ContactCandidate` 必填字段，避免编译期不一致

#### engine-action-planner

为了兼容当前 planner 可能仍输出旧格式：

- planner 输出允许 `pending_question` 为字符串或结构化对象
- 如果是字符串，会在本地归一化为：
  - `type = "generic_clarification"`
  - `field = null`
  - `action_id = null`
  - `options = []`

这一步是兼容措施，不是 planner 协议升级本身。

#### engine-playground / tests

因为 `pending_question` 已不再是字符串，所以做了最小读取调整：

- playground 改为显示 `pending_question.question`
- 测试断言改为校验 `pending_question.question`

### 文档同步

做了最小范围同步，没有展开重写：

- `docs/TECHNICAL_STATE.md`
  - 标注 `pending_question` 已升级为结构化对象
  - 补充 pending question 类型
  - 更新状态说明中的文案引用方式
- `README.md`
  - 更新示例响应
  - 增加结构化 `pending_question` 示例
  - 补充新 contract 摘要

### 构建结果

已运行：

```bash
npm run build
```

结果：

- 构建通过

### 这一步刻意没有做什么

- 没有统一或重构 mode 状态机
- 没有设计 execute 阶段协议细节
- 没有引入执行器
- 没有做写库 side effects
- 没有做 session 持久化
- 没有升级 embedding / 检索方案
- 没有重写 planner prompt
- 没有大改前端 playground

### 给 Plan Agent 的结论

Step 1A 已完成的核心结果是：

1. `src/types/engine.ts` 和 `src/lib/engine-schema.ts` 现在已经形成统一 contract。
2. `pending_question` 已正式从字符串升级为结构化对象。
3. `/engine/respond` 的响应 contract 已稳定，可作为下一步统一 mode 逻辑的基础。
4. 现有 query-engine 主流程还基本保持原状，所以下一步可以专注做状态机和 mode 语义收敛，而不需要先回头修协议漂移问题。

## 2026-04-03 Step 2D: 完成 Step 2 收尾对齐

### 本次目标

不扩展新能力，只把 Step 2 的实现、playground、测试、README、TECHNICAL_STATE 和 change_log 完全对齐。

### 改动文件

- `src/routes/engine-playground.ts`
- `tests/agent.test.ts`
- `README.md`
- `docs/TECHNICAL_STATE.md`
- `change_log.md`

### 对齐内容

#### 1. engine-playground 对齐 query / action 分流

- 主气泡和右侧状态面板现在都会显示：
  - `mode`
  - `understanding.interaction_type`
  - `understanding.source`
  - `understanding.query_intent`
  - `understanding.action_intent`
  - `pending_question`
- `answer` 阶段不再统一显示“已确认但未执行”。
- 现在会区分：
  - query answer：联系人已确认，直接返回查询结果
  - action answer：动作已确认，但当前不会真实执行
- 当 `interaction_type = query` 且没有 `proposed_actions` 时，右侧面板会明确说明这是 query answer 路径，而不是动作规划缺失。
- quick prompt 增加了 query 示例，便于直接验证手机号和最近沟通查询。

#### 2. 测试补齐 Step 2 关键断言

在 `tests/agent.test.ts` 中补了这些关键断言：

- 开放输入会先经过 understanding：
  - 例如“下周发一下报价”会稳定返回 `understanding.interaction_type = task`
  - 当前测试环境下 `understanding.source = fallback_rules`
- “新海张总手机号是多少”“张总女儿生日是什么时候”这类 query 输入会断言：
  - `interaction_type = query`
  - 对应 `query_intent` 正确
- 联系人确认后的 query 回答会断言：
  - `mode = answer`
  - `pending_question = null`
  - `understanding.interaction_type = query`
- 额外补了 action path 不回归测试：
  - `mixed` 类型输入在联系人确认后仍继续进入 `action_selection`
  - 不会被 query executor 抢走

#### 3. 文档同步

README 和 TECHNICAL_STATE 现在统一成同一套表述：

- engine 当前架构是：
  - `LLM-first understanding`
  - `LLM-first clue extraction`
  - `rule-based contact resolution`
  - `minimal query executor`
- query 路径和 action 路径会在联系人确认后分流
- playground 现在会明确展示 query answer 与 action answer 的区别
- 当前仍未实现真实动作执行

### 验证

已运行：

```bash
npm test
npm run build
```

结果：

- 测试通过
- 构建通过

### 这一步刻意没有做什么

- 没有扩展新的 query 能力
- 没有新增 action kind
- 没有做真实动作执行器
- 没有做 embedding
- 没有做 session 持久化
- 没有改联系人 ranking 主体逻辑
- 没有重做 playground 视觉设计

## 2026-04-03 Debug Patch: 暴露 understanding fallback reason

### 本次目标

解决 playground 里只能看到 `understanding source: fallback_rules`，但看不出为什么降级的问题。

### 改动文件

- `src/types/engine.ts`
- `src/lib/engine-schema.ts`
- `src/services/engine-understanding.ts`
- `src/services/query-engine.ts`
- `src/routes/engine-playground.ts`
- `change_log.md`

### 具体改动

- 给 `/engine/respond` 增加了可选 `debug` 字段：
  - `debug.understanding_provider`
  - `debug.understanding_fallback_reason`
- `understanding_fallback_reason` 当前会明确区分：
  - `missing_api_key`
  - `empty_output`
  - `invalid_json`
  - `invalid_schema`
  - `llm_error`
- [src/services/engine-understanding.ts](/Users/shufangsong/Documents/crm/src/services/engine-understanding.ts) 现在不再只返回 `Understanding`，而是返回：
  - `understanding`
  - `debug`
- [src/services/query-engine.ts](/Users/shufangsong/Documents/crm/src/services/query-engine.ts) 会把这份 debug 原样带到 response 里。
- [src/routes/engine-playground.ts](/Users/shufangsong/Documents/crm/src/routes/engine-playground.ts) 现在会直接显示：
  - understanding provider
  - understanding fallback reason

### 验证

已运行：

```bash
npm test
npm run build
```

结果：

- 测试通过
- 构建通过

## 2026-04-03 Debug Patch 2: 收紧 understanding 输出格式

### 本次目标

降低 understanding 调用因为“字段缺失但语义其实可用”而触发 `invalid_schema` 的概率。

### 改动文件

- `src/services/engine-understanding.ts`
- `change_log.md`

### 具体改动

- 更新 understanding prompt，明确要求模型：
  - 必须返回完整 JSON 对象
  - 不允许省略字段
  - `contact_hints` 必须始终包含 6 个字段
  - 没值时返回 `null`
  - `needs_clarification` 没值时返回 `false`
  - `summary` 必须始终给字符串
- 新增 LLM 输出归一化：
  - 缺失的 `contact_hints.*` 自动补 `null`
  - 缺失的布尔值自动补 `false`
  - 缺失的 `query_intent/action_intent/clarification_focus` 自动补 `null`
  - 缺失的 `summary` 自动补默认说明文案
- 归一化之后再进入 Zod 校验，减少因为字段缺失造成的 `invalid_schema`

### 验证

已运行：

```bash
npm test
npm run build
```

结果：

- 测试通过
- 构建通过

## 2026-04-03 Step 1B: 统一 /engine/respond 状态机语义

### 本次目标

在不扩展功能的前提下，收紧 `QueryEngineService` 的状态机，让：

- `mode` 进入条件稳定
- `pending_question.type` 与 `mode` 明确对齐
- 动作选择 / 动作确认流程可预测

明确不做：

- 不做执行器
- 不做 session 持久化
- 不大改 playground
- 不扩展新功能
- 不重写联系人召回逻辑

### 改动文件

- `src/services/query-engine.ts`
- `tests/agent.test.ts`
- `docs/TECHNICAL_STATE.md`

### 状态机语义收敛结果

#### 1. `resolve_contact`

现在只用于联系人还没解决的阶段：

- 未识别到联系人
- 联系人未找到
- 联系人候选歧义，等待用户选择

在这个 mode 下，`pending_question.type` 固定为：

- `contact_resolution`

#### 2. `confirm`

现在只用于需要用户确认的阶段：

- 系统命中一个高概率联系人，但还需要确认
- 联系人已确认，系统已给出候选动作，等待用户选择动作
- 用户已选择动作，等待最终确认

在这个 mode 下，`pending_question.type` 只会是：

- `contact_resolution`
- `action_selection`
- `action_confirmation`

#### 3. `clarify`

现在只用于联系人已确认，但动作信息还不完整的阶段。

例如：

- demo 缺明确日期
- reminder 缺明确日期
- planner 返回其他澄清问题

在这个 mode 下，`pending_question.type` 只会是：

- `slot_filling`
- `generic_clarification`

如果 planner 错误地返回其他类型的 pending question，当前会在本地归一化为：

- `generic_clarification`

目的是避免 `mode = clarify` 却配上 `action_selection` / `contact_resolution` 之类的冲突类型。

#### 4. `answer`

现在只用于当前轮返回解释、总结、或“已确认但未执行”的结果。

当前原型里：

- 动作已确认
- 不真正执行写库
- 返回总结性响应

在这个 mode 下：

- `pending_question = null`

#### 5. `execute`

仍保留在枚举中，但当前原型阶段不返回这个 mode。

代码里已加注释说明这是保留值。

### 实现方式

没有继续堆更多分支，而是把状态判断抽成了几个 helper：

- `buildResolveContactQuestion`
- `buildContactConfirmationQuestion`
- `buildActionSelectionQuestion`
- `buildActionConfirmationQuestion`
- `normalizeClarifyQuestion`
- `resolveActionStage`

其中 `resolveActionStage` 现在负责联系人确认后的动作阶段决策：

1. 如果 planner 还需要补信息
   - `mode = clarify`
   - `pending_question.type = slot_filling | generic_clarification`
2. 如果动作已经确认
   - `mode = answer`
   - `pending_question = null`
3. 如果用户已经选了动作但还没确认
   - `mode = confirm`
   - `pending_question.type = action_confirmation`
4. 如果还没选动作
   - `mode = confirm`
   - `pending_question.type = action_selection`

### 动作流程现在的稳定语义

联系人确认后，动作阶段现在固定分三段：

#### 已生成 `proposed_actions`，但用户还没选动作

- `mode = confirm`
- `pending_question.type = action_selection`
- `selected_action_ids = []`
- `actions_confirmed = false`

#### 用户已经选了动作，但还没确认

- `mode = confirm`
- `pending_question.type = action_confirmation`
- `selected_action_ids.length > 0`
- `actions_confirmed = false`

#### 用户已经确认动作

- `mode = answer`
- `pending_question = null`
- `selected_action_ids.length > 0`
- `actions_confirmed = true`

### 测试与文档同步

最小范围补了两类同步：

- 测试增加了对 `pending_question.type` 的断言
- `docs/TECHNICAL_STATE.md` 更新了 mode 语义和 mode/type 对应关系

### 构建结果

已运行：

```bash
npm run build
```

结果：

- 构建通过

### 这一步刻意没有做什么

- 没有引入真实 execute 流程
- 没有做动作执行器
- 没有做 session 持久化
- 没有改 schema contract
- 没有改 route 层协议
- 没有改 engine-playground
- 没有扩展新的动作种类
- 没有重写联系人召回逻辑

### 给 Plan Agent 的结论

Step 1B 完成后，`/engine/respond` 的状态机已经从“分支里临时决定 mode”收敛为“按阶段稳定决策”：

1. 联系人未解决时，一律 `resolve_contact + contact_resolution`
2. 联系人已确认但缺动作参数时，一律 `clarify + slot_filling/generic_clarification`
3. 联系人或动作需要确认时，一律 `confirm + 对应确认类 pending_question`
4. 动作确认完成后，一律 `answer + null pending_question`

这意味着后续 Step 1C/前端联动时，可以主要依赖：

- `mode`
- `pending_question.type`
- `selected_action_ids`
- `actions_confirmed`

来做稳定渲染和状态推进。

## 2026-04-03 Step 1C: 完成 Step 1 收尾

### 本次目标

把当前实现、playground、测试和文档全部对齐到真实的 `/engine/respond` 协议，让 Step 1 可以作为“协议层 + 状态机 + 演示与测试”的闭环阶段结束。

明确不做：

- 不做执行器
- 不做 session 持久化
- 不扩展新功能
- 不改联系人召回逻辑
- 不改 action planner 协议

### 改动文件

- `src/routes/engine-playground.ts`
- `tests/agent.test.ts`
- `README.md`
- `docs/TECHNICAL_STATE.md`
- `change_log.md`

### playground 对齐结果

`src/routes/engine-playground.ts` 现在不再只看“有没有联系人 / 有没有动作”，而是优先依据：

- `mode`
- `pending_question.type`
- `contact_resolution`
- `proposed_actions`

来驱动交互。

当前行为：

- `resolve_contact + contact_resolution`
  - 展示联系人补充或联系人选择语义
  - 如果有 `pending_question.options`，直接渲染可点击联系人选项
- `confirm + contact_resolution`
  - 展示唯一命中联系人的确认按钮
- `clarify + slot_filling | generic_clarification`
  - 明确提示用户继续在输入框补参数
  - 如果未来 planner 给出结构化 options，也能直接点选
- `confirm + action_selection`
  - 根据 `pending_question.options` 展示可点选动作
  - 支持动作多选
  - 支持全选、清空
- `confirm + action_confirmation`
  - 显示确认 / 继续调整选项
  - 同时允许继续点选动作调整选择
- `answer`
  - 明确显示“已确认但未执行”

另外：

- `assistant_reply` 仍然是主气泡文案
- 右侧 Session / Contact / Response JSON 面板已和当前结构化协议对齐
- 状态面板会显示 `mode`、`pending_question.type`、`field`、`action_id`

### 测试补齐结果

`tests/agent.test.ts` 现在覆盖了 Step 1 关键状态流：

- 未识别联系人
- 联系人未找到
- 歧义联系人
- 唯一联系人待确认
- 联系人确认后进入 `clarify + slot_filling`
- 联系人确认后进入 `confirm + action_selection`
- 用户已选择动作，进入 `confirm + action_confirmation`
- 用户已确认动作，进入 `answer + pending_question = null`

测试断言重点已明确放在：

- `mode`
- `pending_question.type`
- `selected_action_ids`
- `actions_confirmed`

而不是只依赖 `assistant_reply` 文案。

### 文档同步结果

#### README

已同步说明：

- `/engine/respond` 当前主流程
- `mode` 的明确语义
- `pending_question` 的结构与用途
- 动作选择 / 动作确认三段流程
- 当前只做到协议层，不执行真实 side effect
- playground 当前如何跟随协议交互

#### TECHNICAL_STATE

已同步说明：

- 当前 Step 1 的完成状态
- `mode` 与 `pending_question.type` 的对应关系
- playground 如何基于协议驱动多轮交互
- 当前测试覆盖了哪些核心状态流
- 当前刻意未做的事项

### 验证结果

已运行：

```bash
npm test
npm run build
```

结果：

- `npm test` 通过，`25` 个测试通过
- `npm run build` 通过

### Step 1 完成后的边界

Step 1 完成后，当前系统仍刻意没有做：

- 没有真实执行器
- 没有真实 `execute` 流程
- 没有 session 持久化
- 没有新增数据库表
- 没有 embedding
- 没有新 action kind
- 没有多 agent 编排
- 没有真实写库 side effect

### 给 Plan Agent 的结论

Step 1 现在可以视为完成：

1. 核心协议已固定
2. 状态机语义已固定
3. playground 已能按协议演示完整多轮流转
4. 关键状态流已有稳定测试覆盖
5. README / TECHNICAL_STATE / change log 已基本一致

后续步骤可以直接基于这套 contract 往下推进，而不需要再回头修 Step 1 的协议漂移问题。

## 2026-04-03 Step 2A: 增加统一的 LLM-first Understanding Layer

### 本次目标

把 `/engine/respond` 从“先联系人确认，再动作规划”升级为：

1. 先做统一 understanding
2. 再决定后续流转

也就是说，先判断当前输入：

- 是 query / note / task / reminder / craft / mixed
- 还是在回答上一轮 pending question
- 是否需要联系人确认
- 是否更像 query 分支或 action 分支
- 是否需要进一步澄清

明确不做：

- 不做 query executor
- 不做真实 action executor
- 不做 session 持久化
- 不扩展前端功能
- 不重做联系人召回排序

### 改动文件

新增：

- `src/services/engine-understanding.ts`

修改：

- `src/services/query-engine.ts`
- `src/types/engine.ts`
- `src/lib/engine-schema.ts`
- `README.md`
- `docs/TECHNICAL_STATE.md`

### understanding 输出结构

当前 `understanding` 至少稳定包含：

- `interaction_type`
  - `query`
  - `note`
  - `task`
  - `reminder`
  - `craft`
  - `mixed`
  - `answer_to_pending`
- `requires_contact_resolution`
- `contact_hints`
- `query_intent`
- `action_intent`
- `needs_clarification`
- `clarification_focus`
- `summary`
- `source`
  - `llm`
  - `fallback_rules`

为了兼容当前 Step 1 结果，还继续保留：

- `extracted_contact_name`
- `signals`
- `entity_clues`
- `planning_source`

### LLM 优先、规则兜底

新增的 `EngineUnderstandingService` 当前策略：

- 如果配置了 `OPENAI_API_KEY`
  - 优先请求 LLM 做统一理解
  - 返回 JSON 后做本地 Zod 校验
- 如果没有 key、调用失败、返回为空或 JSON 非法
  - 回退到本地 fallback rules

LLM 当前只负责：

- 理解输入类型
- 判断是否像是在回答上一轮问题
- 粗粒度判断是否需要联系人解析
- 提供 query / action intent 标签
- 提供 clarification focus

LLM 当前不负责：

- 最终联系人绑定
- 联系人候选排序
- 候选动作执行
- query 执行

### QueryEngineService 接入方式

`QueryEngineService.respond()` 现在在主流程最前面先调用 understanding layer。

当前顺序变成：

1. `understanding`
2. `contact resolution`
3. `action planning`
4. `mode / pending_question` 决策

当前接入方式是“最小侵入式”：

- 先拿到 `understanding`
- 用 `understanding.contact_hints` 作为当前轮联系人线索上下文
- 如果 `interaction_type = answer_to_pending`
  - 并且上一轮是联系人问题
  - 优先走对上一轮 pending question 的回答分支
- 其他联系人确认、动作规划、动作确认主流程暂时保持原状

这一步的目标不是重写整个 query engine，而是先把统一 understanding 接上，给下一步 query / action 分流留稳定入口。

### 类型与 schema 扩展

已扩展：

- `src/types/engine.ts`
- `src/lib/engine-schema.ts`

当前 `understanding` 已能稳定表达：

- `interaction_type`
- `requires_contact_resolution`
- `query_intent`
- `clarification_focus`
- `source`

### 文档同步

最小同步了：

- `README.md`
  - 说明 `/engine/respond` 现在先经过 understanding layer
  - 说明 understanding 的输出结构和边界
- `docs/TECHNICAL_STATE.md`
  - 标记 Step 2A 已完成范围
  - 增加 understanding layer 在主线中的位置
  - 补充 understanding 字段与职责说明

### 验证结果

已运行：

```bash
npm run build
```

结果：

- 构建通过

### 这一步刻意没有做什么

- 没有实现 query executor
- 没有实现真实动作执行器
- 没有做 session 持久化
- 没有改成多 agent
- 没有重做 playground
- 没有大改联系人召回排序
- 没有扩展新的 action kind
- 没有让 LLM 负责最终联系人绑定

### 给 Plan Agent 的结论

Step 2A 完成后，`/engine/respond` 已经具备统一 understanding 入口：

1. 当前输入先被理解和分类
2. 理解结果再被后续联系人确认和动作规划复用
3. understanding 本身是 LLM 优先、规则兜底
4. 现有联系人确认和动作确认主流程还保留，所以后续可以在此基础上继续做 query / action 分流，而不用先补 understanding 基建

## 2026-04-03 Step 2B: 联系人确认升级为 LLM-first Clue Extraction

### 本次目标

解决“新海张总”“新海科技张总”“新海的张总”这类开放输入无法稳定抽出公司线索的问题。

核心策略：

- LLM 先抽联系人 clues
- 最终联系人仍由本地代码裁决

明确不做：

- 不做 embedding
- 不让 LLM 直接选联系人
- 不重写 ranking
- 不改动作规划
- 不改 playground 交互

### 改动文件

新增：

- `src/services/contact-clue-extractor.ts`

修改：

- `src/services/contact-resolver.ts`
- `src/services/query-engine.ts`
- `src/services/engine-understanding.ts`
- `tests/agent.test.ts`
- `docs/TECHNICAL_STATE.md`

### 接入方式

新增 `ContactClueExtractorService`：

- 有 `OPENAI_API_KEY` 时
  - 先让 LLM 抽 `person_name / company / phone / email / wechat / title_hint`
- 没 key、失败或 JSON 非法时
  - 回退到规则抽取

`QueryEngineService` 现在使用理解层产出的 `contact_hints`，再交给 resolver。

`ContactResolverService` 新增了：

- `resolveFromClues(inputText, clues)`

这样可以直接接住外部抽出的 clues，而候选召回和打分逻辑保持不变。

### 为什么最终联系人仍然由代码裁决

这一步的边界非常明确：

- LLM 只负责 clue extraction
- 本地 resolver 负责最终联系人状态

也就是说：

- 模型不会输出 `contact_id`
- `resolved / ambiguous / not_found / unresolved` 仍由本地代码决定
- 联系人确认仍然是可解释、可测试的 rule-based resolution

### 覆盖的真实表达变体

当前已覆盖：

- `新海张总`
- `新海科技张总`
- `新海的张总`
- `今天和新海张总聊了10分钟`
- `13800000004 这个联系人`
- `赵总 -> not_found`

### 验证结果

已运行：

```bash
npm test
npm run build
```

结果：

- 测试通过
- 构建通过

## 2026-04-03 Step 2C: 增加最小 Query Executor

### 本次目标

让 `/engine/respond` 对查询型输入不再只返回一个 `query` 候选动作，而是在联系人确认后直接给出最小可用答案。

明确不做：

- 不新增 memory 表
- 不做 embedding 检索
- 不实现复杂 query DSL
- 不做 craft
- 不做任务/提醒真实执行器

### 改动文件

新增：

- `src/services/query-executor.ts`

修改：

- `src/services/query-engine.ts`
- `src/services/engine-understanding.ts`
- `src/services/contact-clue-extractor.ts`
- `tests/agent.test.ts`
- `README.md`
- `docs/TECHNICAL_STATE.md`

### query executor 支持范围

当前已支持已确认联系人的基础查询：

- 手机号 / 联系方式
- 公司
- 职位
- 部分 profile 字段
- conversation notes 中已有的关系信息
- open tasks / notes 的简要摘要

第一批典型问法：

- `张总女儿生日是什么时候`
- `张总手机号是多少`
- `他现在是什么职位`
- `最近和他聊了什么`

### engine 中的流转方式

当前流程变成：

1. 先统一 understanding
2. 先做联系人确认
3. 如果原始请求本质是 `query`
   - 联系人确认后优先进入 `query-executor`
   - 直接返回 `mode = answer`
4. 如果原始请求不是 `query`
   - 继续原有 action planner 流程

关键点：

- 如果当前输入只是“是的”这类确认语句，但 `raw_user_input` 原本是 query
  - engine 会重新基于 `raw_user_input` 判断原始请求类型
  - 所以联系人确认后仍会走 query answering，而不是误走动作规划

### 当前能回答与不能回答的边界

能回答：

- 明确联系方式问题
- 明确职位 / 公司问题
- 已有 relationship / birthday 记录
- 最近沟通摘要
- open task 简要摘要

当前仍不能稳定回答：

- 复杂跨联系人比较
- 复杂聚合查询
- 自定义 query DSL
- embedding 召回类开放检索
- 没有明确数据支撑时的高置信推断

如果数据不存在，当前会：

- 仍返回 `mode = answer`
- 明确说明“当前未找到”
- 不把推断当事实

### 新增测试覆盖

新增并通过的关键场景：

- 歧义联系人下查询生日 -> 先 `resolve_contact`
- 确认联系人后查询手机号 -> `answer`
- 查询职位 -> `answer`
- 查询生日但库中没有明确值 -> `answer`，明确未找到
- 查询最近聊了什么 -> `answer`

### 验证结果

已运行：

```bash
npm test
npm run build
```

结果：

- `npm test` 通过，当前 `33` 个测试通过
- `npm run build` 通过

### 这一步刻意没有做什么

- 没有新增 memory 表
- 没有 embedding 检索
- 没有复杂 query DSL
- 没有 craft
- 没有任务/提醒真实执行器
- 没有真实 side effect

### 给 Plan Agent 的结论

Step 2C 完成后，engine 已经具备最小 query answering 能力：

1. `query` 不再只是候选动作占位
2. 查询型输入在联系人确认后可直接回答
3. query 和 action 现在开始真正分流
4. 但 query executor 仍然是最小范围实现，下一步如果继续扩展，应优先扩 query coverage，而不是立刻引入复杂检索体系

## 2026-04-03 Step 2 Understanding Patch: 从单标签分类升级为 facets + arbitration

### 本次目标

解决 understanding 作为“单标签分类器”过弱的问题，让复合输入可以表达成多语义，而不是继续靠硬规则去覆盖 LLM 输出。

### 改动文件

- `src/types/engine.ts`
- `src/lib/engine-schema.ts`
- `src/services/engine-understanding.ts`
- `src/services/query-engine.ts`
- `src/routes/engine-playground.ts`
- `tests/agent.test.ts`
- `README.md`
- `docs/TECHNICAL_STATE.md`
- `change_log.md`

### 协议层变化

`understanding` 现在不再只有单个 `interaction_type`，而是至少包含：

- `primary_interaction_type`
- `semantic_facets`
- `confidence`
- `source`
- `arbitration_notes`
- `summary`
- `contact_hints`
- `query_intent`
- `action_intent`
- `requires_contact_resolution`
- `clarification_focus`

其中 `semantic_facets` 当前包含：

- `has_query`
- `has_note`
- `has_task`
- `has_reminder`
- `has_craft`
- `is_answer_to_pending`

### 核心实现

#### 1. 新增本地 facet detector

本地规则现在只识别显式语义面：

- query
- note
- task
- reminder
- craft
- answer_to_pending

不再直接用本地规则决定最终主标签。

#### 2. 新增 arbitration layer

understanding 现在会合并：

- LLM 输出的主类型、facets、confidence
- 本地 detector 的 facets

仲裁原则：

- 优先保留 LLM 主判断
- 如果本地 facets 明确显示多个强语义，而 LLM 给了过窄单标签
  - 才允许提升为 `mixed`
- 所有仲裁结果都会写入 `arbitration_notes`
- 如果发生 LLM + local 合并，`source = hybrid`

#### 3. QueryEngineService 改为优先参考 facets

主流程不再主要依赖单个 `interaction_type`：

- 对“是否在回答上一轮问题”，优先看 `semantic_facets.is_answer_to_pending`
- 对“是否进入 query 分支”，优先看：
  - `semantic_facets`
  - `query_intent`
  - `action_intent`

`primary_interaction_type` 现在主要用于：

- 展示
- 调试
- 高层路由提示

### 测试覆盖

新增并通过的关键场景：

- 复合输入：
  - `今天和新海张总聊了10分钟，他对报价感兴趣，下周发 demo，还聊到生日`
  - 断言 `has_note = true`
  - 断言 `has_task = true`
  - 断言 `has_reminder = true`
  - 断言主类型为 `mixed`
- 纯查询输入：
  - `张总女儿生日是什么时候`
  - 断言 `has_query = true`
- 纯任务输入：
  - `下周三给王总发 demo`
  - 断言 `has_task = true`
- 纯内容生成输入：
  - `帮我写个 WhatsApp 跟进张总`
  - 断言 `has_craft = true`
- 回答上一轮问题：
  - `是的`
  - 断言 `is_answer_to_pending = true`

### 验证

已运行：

```bash
npm test
npm run build
```

结果：

- `npm test` 通过，当前 `37` 个测试通过
- `npm run build` 通过

### 这一步刻意没有做什么

- 没有改 query executor
- 没有做真实动作执行器
- 没有改联系人最终绑定逻辑
- 没有引入 embedding
- 没有做多 agent 编排
- 没有大改 playground

## 2026-04-03 Playground Debug Panel Patch: 右侧状态面板按步骤重组

### 本次目标

清理右侧状态面板中过多的 session 原始字段，只保留按步骤拆开的判断结果，方便排错。

### 改动文件

- `src/routes/engine-playground.ts`
- `change_log.md`

### 具体改动

- 右侧面板改成三段：
  - `Step 1 Understanding`
  - `Step 2 Contact Resolution`
  - `Step 3 Route Result`
- 左侧对话框继续保持干净，只显示主对话和必要交互。
- 右侧现在重点显示：
  - understanding 的主类型、facets、confidence、source、arbitration notes
  - contact resolution 的状态、命中的联系人、候选数
  - 当前 route result、pending question、selected actions、actions confirmed、draft summary
- 移除了右侧里不利于排错的噪音字段堆叠方式，不再把所有 session 原始信息混在一起展示。

### 验证

已运行：

```bash
npm run build
```

结果：

- 构建通过

## 2026-04-03 Diagram Patch: 导出当前 engine 主流程图

### 本次目标

把当前 `/engine/respond` 的主流程整理成可放大、可导出的图片，便于排查 understanding、联系人确认、query/action 分流逻辑。

### 改动文件

- `docs/diagrams/engine-flow-step2.svg`
- `change_log.md`

### 具体内容

- 新增了一张 SVG 流程图：
  - Understanding
  - Contact Resolution
  - Query Route
  - Action Route
  - 最终 response 返回点
- 图里明确标了：
  - understanding 的 LLM + local facets + arbitration
  - 联系人状态分支
  - query executor 进入条件
  - action planner 进入条件
  - clarify / confirm / answer 各阶段

## 2026-04-03 Clarify Patch: 回答 slot filling 后推进动作阶段

### 本次目标

修复 `clarify` 阶段回答具体时间后，系统仍重复追问同一个问题的问题。

### 改动文件

- `src/services/query-engine.ts`
- `tests/agent.test.ts`
- `change_log.md`

### 具体改动

- 在 [src/services/query-engine.ts](/Users/shufangsong/Documents/crm/src/services/query-engine.ts) 新增最小 slot-filling apply 逻辑：
  - 如果上一轮 `pending_question.type = slot_filling`
  - 且本轮输入可被解析为时间
  - 则先把回答写回上一轮 `proposed_actions` 对应的 `payload`
  - 将动作状态从 `needs_input` 推进到 `ready`
  - 再继续进入 action stage 判断
- 当前先支持：
  - `due_at`
  - `remind_at`
- 因此在回答“下周二”后，不会再回到同一个 clarify 问题，而会进入 `action_selection`

### 测试覆盖

新增并通过：

- `clarify -> 下周二 -> action_selection`
  - 断言 `create_task.status = ready`
  - 断言 `payload.due_at` 已写入具体日期

### 验证

已运行：

```bash
npm test
npm run build
```

结果：

- `npm test` 通过，当前 `38` 个测试通过
- `npm run build` 通过

## 2026-04-03 Clarify Priority Patch: 有缺参动作时禁止先选动作

### 本次目标

修复当某些动作仍然 `needs_input` 时，系统却直接进入 `action_selection` 的问题。

### 改动文件

- `src/services/query-engine.ts`
- `change_log.md`

### 具体改动

- 在动作阶段状态机里新增兜底：
  - 即使 planner 没返回 `pending_question`
  - 只要 `proposed_actions` 里仍有 `status = needs_input` 的动作
  - 就必须优先进入 `clarify`
- 当前会优先推断：
  - `create_task` 且缺 `due_at` -> `slot_filling(field = due_at)`
  - `create_reminder` 且缺 `remind_at` -> `slot_filling(field = remind_at)`
  - 其他 `needs_input` 动作 -> `generic_clarification`

### 效果

- “还有需要澄清的地方” 时，不会再直接让用户选择动作
- 必须先把缺失参数补齐，再进入 `action_selection`

### 验证

已运行：

```bash
npm test
npm run build
```

结果：

- `npm test` 通过
- `npm run build` 通过

## 2026-04-03 Copy Patch: clarify 完成后改成确认文案

### 本次目标

修复 slot filling 完成后进入 `action_confirmation` 时，assistant reply 仍然误写成“还缺一个关键信息”的问题。

### 改动文件

- `src/services/query-engine.ts`
- `tests/agent.test.ts`
- `change_log.md`

### 具体改动

- 在 [src/services/query-engine.ts](/Users/shufangsong/Documents/crm/src/services/query-engine.ts) 的 `buildAssistantReply` 中新增分支：
  - 如果 `pending_question.type = action_confirmation`
  - 返回“已补齐缺失信息，并保留已选动作，请再确认是否继续这些动作”
- `action_selection` 也改成单独分支，不再落到通用“还缺一个关键信息”文案里

### 效果

- 当用户已经补了“下周二”这类缺失参数后
- 下一步如果是动作确认
- 文案会明确告诉用户：现在是在做最终确认，不是在继续补参数

### 验证

已运行：

```bash
npm test
npm run build
```

结果：

- `npm test` 通过，当前 `39` 个测试通过
- `npm run build` 通过

## 2026-04-03 Reply Composer Patch: assistant_reply 改为 LLM-first

### 本次目标

避免用户直接看到生硬模板文案，例如“这个任务具体要哪一天执行？”，让 `assistant_reply` 优先由大模型组织自然语言。

### 改动文件

- `src/services/engine-reply-composer.ts`
- `src/services/query-engine.ts`
- `README.md`
- `docs/TECHNICAL_STATE.md`
- `change_log.md`

### 具体改动

- 新增 [src/services/engine-reply-composer.ts](/Users/shufangsong/Documents/crm/src/services/engine-reply-composer.ts)
  - 输入为已经确定的：
    - `mode`
    - `contact_resolution`
    - `pending_question`
    - `proposed_actions`
    - `selected_action_ids`
    - `actions_confirmed`
  - 让模型只负责“组织回复文案”
  - 不允许改动状态机含义，不允许编造事实
- [src/services/query-engine.ts](/Users/shufangsong/Documents/crm/src/services/query-engine.ts)
  - 保留原有模板回复作为 `fallbackReply`
  - 最终返回前调用 reply composer
  - 有 key 时优先使用 LLM 组织 `assistant_reply`
  - 无 key 或调用失败时继续使用模板

### 边界

- 状态机仍由代码裁决
- `pending_question`、`mode`、`contact_resolution` 仍由代码决定
- reply composer 只改“怎么说”，不改“系统要做什么”

### 验证

已运行：

```bash
npm test
npm run build
```

结果：

- `npm test` 通过，当前 `39` 个测试通过
- `npm run build` 通过

## 2026-04-03 Playground Log Patch: 右侧只保留单一 State Log

### 本次目标

移除右侧多个状态栏，只保留一个连续追加的 log 面板，把每一轮的判断和结果写进去，方便排错。

### 改动文件

- `src/routes/engine-playground.ts`
- `change_log.md`

### 具体改动

- 右侧不再拆成：
  - Understanding
  - Contact Resolution
  - Route Result
  - Response JSON
- 现在只保留一个 `State Log / Decision Trace`
- 每轮 `/engine/respond` 返回后，都会追加一条日志，包含：
  - Step 1 Understanding
  - Step 2 Contact Resolution
  - Step 3 Route Result
  - Debug
- 每条日志都会记录本轮：
  - 主类型
  - facets
  - query/action intent
  - 联系人状态
  - pending question
  - selected actions
  - proposed actions
  - fallback / provider 信息

### 验证

已运行：

```bash
npm run build
```

结果：

- `npm run build` 通过

## 2026-04-03 Playground Double Submit Patch: 修复发送按钮一次触发两次请求

### 本次目标

修复 `engine-playground` 中点击一次 `发送` 却会追加两条用户消息、发出两次请求的问题。

### 改动文件

- `src/routes/engine-playground.ts`
- `change_log.md`

### 具体改动

- 去掉 `发送` / `清空会话` 按钮上的内联 `onclick`
- 保留统一的 `addEventListener` 绑定
- 给 `handleSend()` 增加发送中防重入：
  - `isSending`
  - 请求期间临时禁用发送按钮
  - 请求完成后恢复

### 问题原因

- 之前为了给“按钮无反应”加兜底，我同时保留了：
  - HTML `onclick`
  - JS `addEventListener`
- 当前端脚本恢复正常后，这两套绑定会同时触发，导致一次点击发两次请求

### 验证

已运行：

```bash
npm run build
```

结果：

- `npm run build` 通过

## 2026-04-03 Action Carry-Forward Patch: 修复补参后选动作又重复追问日期

### 本次目标

修复 `clarify -> 用户补时间 -> action_selection -> 用户选动作` 之后，系统又把同一个任务重新打回 `slot_filling` 的问题。

### 改动文件

- `src/services/query-engine.ts`
- `tests/agent.test.ts`
- `change_log.md`

### 具体改动

- 在动作选择 / 动作确认阶段，优先沿用上一轮 `session_state.draft_plan.proposed_actions`
- 不再在这两个阶段按原始 `raw_user_input` 重新规划动作
- 新增回归测试，覆盖：
  - 先补 `下周二`
  - 再选择动作
  - `create_task.due_at` 仍然保留
  - 不再回退成 “具体要安排在哪一天执行”

### 问题原因

- 之前用户回答 `下周二` 后，`due_at` 的确已经被补进 `draft_plan`
- 但用户下一步选择动作时，engine 又用最初那句原始输入重新跑了一次 action planner
- 原始输入里只有“下周”，没有“下周二”，所以刚补进去的时间被重算丢失
- 最终状态机又认为 `create_task` 缺时间，于是再次追问

### 验证

已运行：

```bash
npm test
npm run build
```

结果：

- `npm test` 通过，40 个测试通过
- `npm run build` 通过

## 2026-04-03 Simple Architecture Doc: 新增通俗版 query engine 架构说明

### 本次目标

补一份不偏实现细节、但能快速读懂当前 query engine 判断逻辑的简明架构文档。

### 改动文件

- `docs/QUERY_ENGINE_ARCHITECTURE_SIMPLE.md`
- `change_log.md`

### 具体内容

- 用通俗语言说明当前 engine 的三段式主流程：
  - 先理解输入
  - 再确认联系人
  - 联系人确认后分流到 query 或 action
- 解释：
  - understanding layer
  - contact resolution
  - query executor
  - action planner
  - reply composer
- 解释当前状态机：
  - `resolve_contact`
  - `clarify`
  - `confirm`
  - `answer`
- 解释为什么要同时看：
  - `mode`
  - `pending_question.type`
- 明确当前系统已做 / 未做边界

### 适用场景

- 给产品、设计或计划 agent 快速理解当前实现
- 不想一上来就读 `query-engine.ts` 和 `TECHNICAL_STATE.md`
- 需要快速建立“用户输入一句话后，系统内部怎么判断”的整体脑图

## 2026-04-03 Playground Init Patch: 发送按钮加兜底绑定和前端错误日志

### 本次目标

修复 playground 出现“按钮点不了、Provider 一直 loading、初始化无反馈”时难以判断是脚本没跑还是点击没绑定的问题。

### 改动文件

- `src/routes/engine-playground.ts`
- `change_log.md`

### 具体改动

- 给 `发送` / `清空会话` 按钮新增了 `onclick` 兜底
- 保留原有 `addEventListener` 绑定
- 初始化阶段增加 `try/catch`
- 新增全局前端错误捕获：
  - `Frontend Error`
  - `Init Error`
- 这些错误会直接写进右侧 `State Log`

### 效果

- 如果初始化失败，右侧能直接看到失败原因
- 如果按钮事件没挂上，`onclick` 仍可兜底
- 不再只能通过“页面没反应”来猜问题

### 验证

已运行：

```bash
npm run build
```

结果：

- `npm run build` 通过

## 2026-04-05 Step 3D: 新增 World Knowledge Grounding

### 本次目标

在 understanding 前增加一层轻量 `world knowledge grounding`，让系统先识别并归一化现实世界概念，再辅助 intent 识别。

### 改动文件

新增：

- `src/services/concept-grounder.ts`

修改：

- `src/services/engine-understanding.ts`
- `src/types/engine.ts`
- `src/lib/engine-schema.ts`
- `tests/agent.test.ts`
- `docs/product_decisions.md`
- `docs/TECHNICAL_STATE.md`
- `README.md`
- `change_log.md`

### 具体改动

- 新增 grounding 输出结构：
  - `raw`
  - `normalized`
  - `concept_type`
  - `crm_semantic_hint`
  - `confidence`
- grounding 先于 understanding 执行
- understanding prompt 现在会拿到 `grounded_concepts` 作为上下文
- response 中的 `understanding` 新增 `grounded_concepts`
- fallback 不做大规模词典，只保留少量高价值本地锚点：
  - `PSLE`
  - `O Level`
  - `A Level`
  - `NS`
  - `Hari Raya`
  - `CNY`
  - `Deepavali`

### 验证

新增测试覆盖：

- `PSLE` 被归一化为教育考试事件
- `O Level` 被归一化为教育考试事件
- `NS` 被归一化为人生阶段事件
- `Hari Raya` 被归一化为节日维护事件
- 普通 task / query 输入不受 grounding 干扰

已运行：

```bash
npm test
npm run build
```

结果：

- `npm test` 通过
- `npm run build` 通过

## 2026-04-04 Step 3C: 动作选择后直接执行 + 最近联系人短期继承

### 本次目标

落实两项产品决策：

- 移除 `action_confirmation`
- 新请求支持最近已确认联系人的短期继承

### 改动文件

- `src/services/query-engine.ts`
- `src/services/engine-reply-composer.ts`
- `src/routes/engine-playground.ts`
- `tests/agent.test.ts`
- `docs/product_decisions.md`
- `docs/TECHNICAL_STATE.md`
- `README.md`
- `change_log.md`

### 具体改动

- 动作阶段从：
  - `action_selection -> action_confirmation -> answer + execution`
  改为：
  - `action_selection -> answer + execution`
- 用户一旦选中动作，就直接执行当前最小 action 子集
- `全选当前动作` 也会直接执行
- playground 已移除过期文案“当前原型不会真实执行写库”
- 新请求开始时会优先尝试复用最近已确认联系人
- 只有当前输入中的联系人线索与最近联系人兼容时，才直接继承
- 如果出现冲突公司、手机号、邮箱、微信或明显不同的人名线索，则回退到正常联系人解析
- 新请求仍会重置旧 `raw_user_input` 和旧 draft actions

### 验证

已运行：

```bash
npm test
npm run build
```

结果：

- `npm test` 通过
- `npm run build` 通过

## 2026-04-04 Step 3B: 修复新请求误继承旧 request context

### 本次目标

修复 `/engine/respond` 在用户继续回传 `session_state` 时，错误沿用上一轮 `raw_user_input` 和旧 draft context 的问题。

重点修复：

- 区分“回答上一轮 pending question”
- 区分“发起一个新的 request turn”
- 保留已确认联系人
- 清空旧 request 本体和旧 draft actions

### 改动文件

- `src/services/query-engine.ts`
- `tests/agent.test.ts`
- `docs/TECHNICAL_STATE.md`
- `change_log.md`

### 具体改动

- 在 query engine 中新增显式 request-context 识别逻辑
- 只有当前输入明显是在回答上一轮 `contact_resolution / slot_filling / action_selection / action_confirmation / generic_clarification` 时，才继续沿用旧 `raw_user_input`
- 如果当前输入被识别为新 request：
  - 继续保留 `confirmed_contact_id`
  - 重置旧 `raw_user_input`
  - 重置旧 `draft_plan.proposed_actions`
  - 重置旧 `selected_action_ids`
  - 重置旧 `actions_confirmed`
  - 清空旧 `pending_question`
- 收紧 draft plan carry-forward：
  - 只允许在 `action_selection / action_confirmation / slot_filling` 的继续回答场景沿用

### 验证

新增测试覆盖：

- query answer 后输入新的 mixed request，不再沿用旧 query 本体
- query answer 后输入新的 query，不再沿用旧 query 本体
- action_selection 继续回答时仍沿用旧 request
- slot_filling 继续回答时仍沿用旧 request
- contact confirmation 继续回答时仍沿用旧 request
- 动作执行完成后再发新请求，会开启新的 request context

已运行：

```bash
npm test
npm run build
```

结果：

- `npm test` 通过
- `npm run build` 通过

## 2026-04-04 Step 3A: 最小 Action Executor 落地

### 本次目标

让 `/engine/respond` 在联系人确认、动作选择、动作确认之后，不再停留在“只会规划不会执行”，而是把最小可落地的动作真正写入数据库。

本次只做：

- `add_note`
- `create_task`
- `create_reminder`

明确不做：

- 完整 action taxonomy
- `create_contact`
- `update_profile`
- `add_relation`
- session 持久化
- 对话结束统一回顾后批量执行
- KB / embedding / 语音 / 多 agent

### 改动文件

新增：

- `src/services/action-executor.ts`

修改：

- `src/services/query-engine.ts`
- `src/services/engine-reply-composer.ts`
- `src/repositories/customer-repository.ts`
- `src/db/init.ts`
- `src/types/engine.ts`
- `src/lib/engine-schema.ts`
- `tests/agent.test.ts`
- `README.md`
- `docs/TECHNICAL_STATE.md`
- `change_log.md`

### 具体改动

- 新增最小 action executor，逐条执行已确认动作
- 单条 action 失败不会中断其他 action
- repository 层新增：
  - `saveConversationNote(...)`
  - `createTaskForContact(...)`
  - `createReminderForContact(...)`
- SQLite 新增 `reminders` 表
- `/engine/respond` 仍保持 `mode = answer`
- response 新增 `execution_result`
  - `status`
  - `executed_actions`
  - `failed_actions`
- 放宽了回传 `session_state.draft_plan.proposed_actions[].kind` 的协议校验
- 未知 kind 不再在 route 层 400，而会进入 executor 并落到 `failed_actions`
- assistant reply 在动作执行后会反映真实执行结果，而不再只说“已确认”

### 当前执行边界

已支持：

- 联系人确认后即时执行最小动作子集
- 数据真实写入 SQLite
- 后续 query / UI 能看到新增 notes / tasks / reminders

仍未支持：

- 完整 action system
- 对话结束统一回顾后批量执行
- 更复杂审批流

### 验证

已运行：

```bash
npm test
npm run build
```

结果：

- `npm test` 通过
- `npm run build` 通过

## 2026-04-03 Playground Script Syntax Patch: 修复内联脚本换行导致的发送按钮失效

### 本次目标

修复 `engine-playground` 页面中浏览器报出的 `Uncaught SyntaxError: Invalid or unexpected token`，恢复 `发送` 按钮可用性。

### 改动文件

- `src/routes/engine-playground.ts`
- `change_log.md`

### 具体改动

- 定位到内联脚本中的字符串换行写法有误
- 将脚本内的 `"\n"` 改为字面量 `"\\n"`，避免服务端模板字符串展开后把换行直接写进浏览器脚本字符串
- 修复的位置包括：
  - `proposed_actions` 日志拼接
  - turn 日志拼接
  - init 日志拼接

### 问题原因

- `engine-playground` 是服务端拼接的 HTML 字符串
- 在 TypeScript 模板字符串里写 `"\n"`，实际输出到浏览器时会变成真正的换行字符
- 结果浏览器收到的是被硬换行截断的 JS 字符串，直接触发语法错误
- 脚本未完成初始化时，`发送` 按钮自然无法工作

### 验证

已运行：

```bash
npm run build
```

结果：

- `npm run build` 通过
