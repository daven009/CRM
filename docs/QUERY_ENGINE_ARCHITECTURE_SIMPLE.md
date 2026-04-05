# Query Engine Architecture (Simple)

这份文档是给“快速理解当前 CRM query engine 怎么判断”的简明版。

如果只记一句话：

> 用户每输入一句话，engine 会先理解这句话，再确认联系人是谁，最后决定是回答问题还是推进动作。

---

## 1. 当前 engine 在做什么

当前 `/engine/respond` 还不是一个“真实执行 CRM side effect”的系统。

它现在主要做三件事：

1. 理解用户这句话在表达什么
2. 确认用户说的是哪个联系人
3. 在联系人确认后，决定：
   - 直接回答查询
   - 或进入动作规划 / 补参数 / 动作确认流程

你可以把它理解成一个“会多轮确认的智能前台”：

- 先听懂你在说什么
- 再确认你在说谁
- 然后决定是“回答你”，还是“帮你准备一个动作”

---

## 2. 核心分层

当前主流程都由 [query-engine.ts](/Users/shufangsong/Documents/crm/src/services/query-engine.ts) 总调度。

它下面主要挂了 5 块能力：

### 2.1 Understanding Layer

文件：
[engine-understanding.ts](/Users/shufangsong/Documents/crm/src/services/engine-understanding.ts)

职责：

- 理解这句话的语义
- 判断是不是在回答上一轮问题
- 判断这句话有没有：
  - query 语义
  - note 语义
  - task 语义
  - reminder 语义
  - craft 语义

它不是只给一个死标签，而是输出：

- `primary_interaction_type`
- `semantic_facets`
- `confidence`
- `source`
- `arbitration_notes`

所以现在系统能表达“这句话既像 note，又像 task，又带 reminder”。

---

### 2.2 Contact Resolution

文件：
- [contact-resolver.ts](/Users/shufangsong/Documents/crm/src/services/contact-resolver.ts)
- [contact-clue-extractor.ts](/Users/shufangsong/Documents/crm/src/services/contact-clue-extractor.ts)

职责：

- 从开放输入里抽联系人线索
  - 姓名
  - 公司
  - 手机号
  - 邮箱
  - 微信
  - title hint
- 召回联系人候选
- 排序
- 决定联系人状态

这里的关键设计是：

- LLM 可以帮忙抽 clues
- 但不能直接决定最终联系人
- 最终联系人仍然由代码裁决

所以联系人结果仍然是可解释、可测试的。

联系人状态只有四种：

- `unresolved`
- `not_found`
- `ambiguous`
- `resolved`

---

### 2.3 Query Executor

文件：
[query-executor.ts](/Users/shufangsong/Documents/crm/src/services/query-executor.ts)

职责：

当用户是查询型输入，并且联系人已经确认后，直接回答。

目前支持的查询比较基础，主要包括：

- 手机号 / 联系方式
- 公司
- 职位
- profile 字段
- conversation notes 里的关系信息
- open tasks / notes 的简要摘要

例子：

- “张总手机号是多少”
- “他现在是什么职位”
- “张总女儿生日是什么时候”
- “最近和他聊了什么”

---

### 2.4 Action Planner

文件：
[engine-action-planner.ts](/Users/shufangsong/Documents/crm/src/services/engine-action-planner.ts)

职责：

当用户不是单纯 query，而是要记录、跟进、提醒、创建任务时：

- 生成候选动作 `proposed_actions`
- 判断哪些动作缺参数
- 生成 `pending_question`

当前动作流的目标不是“立即执行”，而是“先把动作准备清楚”。

---

### 2.5 Reply Composer

文件：
[engine-reply-composer.ts](/Users/shufangsong/Documents/crm/src/services/engine-reply-composer.ts)

职责：

- 状态机和结构化字段仍然由代码决定
- 但最终回复给用户的中文文案，尽量由 LLM 组织
- 如果 LLM 不可用，再回退模板

这层只负责“怎么说”，不负责“怎么判”。

---

## 3. 整个请求是怎么走的

用户每发一句话，`/engine/respond` 现在大致走下面这条链：

1. 先做 understanding
2. 再做 contact resolution
3. 联系人确认后：
   - 如果是 query，走 query executor
   - 否则走 action planner
4. 最后根据当前状态机，返回：
   - `mode`
   - `pending_question`
   - `proposed_actions`
   - `assistant_reply`

---

## 4. 通俗版判断逻辑

你可以把系统内部判断理解成下面这几个问题。

### 第一个问题：你现在在说什么？

系统先判断：

- 这是查询吗？
- 这是记录备注吗？
- 这是跟进任务吗？
- 这是提醒吗？
- 这是内容生成吗？
- 还是你其实在回答我上一轮的问题？

这一步的结果主要放在：

- `understanding.primary_interaction_type`
- `understanding.semantic_facets`

注意：

现在系统不再把一句话压成单一标签。

例如：

“今天和新海张总聊了10分钟，他对报价感兴趣，下周发 demo，还聊到生日”

这类输入不是简单 `note`，而是会被表达成：

- `has_note = true`
- `has_task = true`
- `has_reminder = true`
- `primary_interaction_type = mixed`

---

### 第二个问题：你说的是谁？

如果句子里提到了联系人，系统会继续判断：

- 是哪位联系人
- 找不到
- 还是有多个候选

例如：

- “张总” 可能会歧义
- “新海张总” 会更容易命中张建国
- “13800000004 这个联系人” 可以直接按手机号查

如果联系人还没确认，系统就不会继续往下做 query 或动作。

---

### 第三个问题：联系人定了吗？

如果联系人还没定下来，系统就会停在联系人阶段。

对应状态：

- `mode = resolve_contact`

这时前端主要看：

- `mode`
- `pending_question.type = contact_resolution`

这表示：

> 现在别想执行动作，也别想回答查询，先把“你说的是谁”搞清楚。

---

### 第四个问题：联系人确认后，是回答问题还是推进动作？

一旦联系人确认，系统会分流：

#### 4.1 如果是 query

直接走 query executor。

这时通常返回：

- `mode = answer`
- `pending_question = null`

表示：

> 联系人已经确定，系统现在直接回答。

#### 4.2 如果是 action

就进入动作流。

动作流不是一步完成，而是三段式：

1. 补参数
2. 选动作
3. 确认动作

---

## 5. 动作流为什么会分三段

因为真实输入经常不完整。

例如：

“下周发 demo 给张总”

这里虽然能识别出动作，但缺：

- 具体哪一天发

所以动作流设计成：

### 5.1 Clarify

如果动作缺参数，先追问参数。

返回：

- `mode = clarify`
- `pending_question.type = slot_filling`

这表示：

> 联系人清楚了，动作也大致清楚了，但还缺一个槽位，需要你补齐。

---

### 5.2 Action Selection

如果参数已经补齐，但用户还没选要继续哪个动作：

- `mode = confirm`
- `pending_question.type = action_selection`

这表示：

> 候选动作已经整理好了，现在请你选。

---

### 5.3 Action Confirmation

如果动作已经选好了，但还没做最终确认：

- `mode = confirm`
- `pending_question.type = action_confirmation`

这表示：

> 你已经选好了动作，请最后确认要不要继续。

---

### 5.4 Final Answer

如果动作已经确认：

- `mode = answer`
- `pending_question = null`

当前原型只表示：

> 已经确认，但还不会真实执行写库。

---

## 6. 为什么 `mode` 和 `pending_question` 要一起看

因为 `mode` 只能告诉你“当前大阶段是什么”，但不够细。

例如同样是 `confirm`，可能是：

- 在确认联系人
- 在选动作
- 在确认动作

所以现在真正给前端和调试看的是：

- `mode`
- `pending_question.type`

对应关系大致是：

- `resolve_contact` -> `contact_resolution`
- `clarify` -> `slot_filling` / `generic_clarification`
- `confirm` -> `contact_resolution` / `action_selection` / `action_confirmation`
- `answer` -> 一般没有 `pending_question`

这也是 playground 和状态日志现在主要看的字段。

---

## 7. 当前状态机最重要的几条原则

### 原则 1

联系人没确认，不进入 query answer，也不进入动作确认。

### 原则 2

动作只要还有 `needs_input`，就先 `clarify`，不能直接让用户选动作。

### 原则 3

用户补过的参数必须继续保留，不能后面又被原始输入重算覆盖掉。

例如：

- 你已经补了“下周二”
- 后面选动作时，不能再把任务打回“哪天执行”

### 原则 4

LLM 可以帮助理解和组织回复，但不能直接替代联系人最终裁决，也不能替代状态机本身。

---

## 8. 当前对外返回的核心字段

主要协议定义在：
[engine.ts](/Users/shufangsong/Documents/crm/src/types/engine.ts)

你最该关注的字段是：

### `mode`

表示当前大阶段：

- `resolve_contact`
- `clarify`
- `confirm`
- `answer`

### `understanding`

表示系统对这句话的理解。

关键字段：

- `primary_interaction_type`
- `semantic_facets`
- `query_intent`
- `action_intent`
- `requires_contact_resolution`
- `source`

### `contact_resolution`

表示联系人状态。

关键字段：

- `status`
- `query_name`
- `candidates`
- `selected_contact_id`
- `confirmed_contact_id`
- `confirmation_required`

### `proposed_actions`

表示当前整理出来的候选动作。

### `pending_question`

表示当前系统正在追问什么。

### `assistant_reply`

表示当前展示给用户看的自然语言回复。

---

## 9. 当前系统还没有做什么

这点很重要，不然容易高估它。

当前系统还没有：

- 真实动作执行器
- 真实写库 side effect
- session 持久化
- embedding 检索
- memory 新表
- 复杂 query DSL
- 多 agent 编排

也就是说：

它现在已经能“理解、确认、回答、准备动作”，
但还没到“真正执行 CRM 操作”。

---

## 10. 如果你要最快看懂代码，建议阅读顺序

1. [src/types/engine.ts](/Users/shufangsong/Documents/crm/src/types/engine.ts)
2. [src/services/query-engine.ts](/Users/shufangsong/Documents/crm/src/services/query-engine.ts)
3. [src/services/engine-understanding.ts](/Users/shufangsong/Documents/crm/src/services/engine-understanding.ts)
4. [src/services/contact-resolver.ts](/Users/shufangsong/Documents/crm/src/services/contact-resolver.ts)
5. [src/services/query-executor.ts](/Users/shufangsong/Documents/crm/src/services/query-executor.ts)
6. [src/services/engine-action-planner.ts](/Users/shufangsong/Documents/crm/src/services/engine-action-planner.ts)
7. [src/services/engine-reply-composer.ts](/Users/shufangsong/Documents/crm/src/services/engine-reply-composer.ts)

---

## 11. 最后一版一句话总结

当前 query engine 的核心思路是：

> 先理解语义，再确认联系人；联系人确认后，如果是 query 就直接回答，如果是 action 就按“补参数 -> 选动作 -> 确认动作”的状态机继续推进。
