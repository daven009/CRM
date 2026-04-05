# Test Case Log

这份文档用于持续记录：

- 真实测试中发现的问题
- 复现路径
- 当前实际行为
- 预期行为
- 根因判断
- 修复方案
- 对应开发改动

目标不是替代测试代码，而是沉淀“产品级异常案例”和“为什么要改”。

---

## Case 001: Query 回答后错误沿用旧请求

### 场景

用户先发起一个查询请求，系统返回 query answer。  
随后用户输入一条新的 mixed 沟通记录，但系统错误沿用了上一轮 query 的 `raw_user_input` 和旧的 draft context。

### 复现步骤

1. 用户输入：
   `张建国有什么待办`
2. 系统返回：
   当前没有和张建国关联的 open tasks
3. 用户继续输入：
   `今天和张总聊了10分钟，他对我们的报价很感兴趣，下周要把产品demo发给他。还聊到他女儿下个月24号过生日。`
4. 系统却返回与上一轮 query 相关的动作确认，例如：
   `请选择要继续的动作：查询张建国的所有待办任务`

### 当前实际行为

- 新输入被系统错误视为上一轮 request 的继续
- `raw_user_input` 没有切换到本轮新输入
- 旧的 query 语义和 draft context 被错误继承

### 预期行为

第二条输入应被识别为一个新的 mixed 请求，而不是上一轮 query 的继续。

系统应当：

- 保留已确认联系人上下文（如果合理）
- 但清空旧请求本体
- 用新的 `input_text` 作为新的 `raw_user_input`
- 重新做 understanding、联系人确认（如有必要）和动作规划

### 根因判断

当前 `query-engine` 中对 `raw_user_input` 和 `draft_plan` 的沿用策略过于激进：

- 只要前端回传 `session_state`
- 就倾向继续沿用上一轮 `raw_user_input`
- 没有可靠地区分：
  - 当前输入是在回答上一轮 `pending_question`
  - 还是用户已经发起了一个新的请求

### 修复方向

增加“新请求 vs 回答上一轮问题”的判断逻辑：

- 如果当前输入像是在回答上一轮 `pending_question`
  - 沿用旧的 `raw_user_input`
  - 允许继续沿用旧 draft plan
- 如果当前输入像是一个新的请求
  - 使用当前 `input_text` 作为新的 `raw_user_input`
  - 清空旧的 `draft_plan.proposed_actions`
  - 清空 `selected_action_ids`
  - 清空 `actions_confirmed`
  - 清空旧的 `pending_question`

一句话：

- 保留人
- 清空事

### 需要验证的测试点

1. query answer 后输入新的 mixed 请求，应进入新的 request context
2. query answer 后输入新的 query，应进入新的 request context
3. action selection 阶段的回答仍应继续沿用旧请求
4. slot filling 阶段的回答仍应继续沿用旧请求
5. 联系人确认阶段的回答仍应继续沿用旧请求
6. 动作确认完成后再输入新请求，应清空旧动作状态

### 对应开发改动

待开发：

- 在 `src/services/query-engine.ts` 中加入新请求识别逻辑
- 收紧 `raw_user_input` 来源规则
- 收紧 `draft_plan` carry-forward 边界
- 必要时同步 playground 状态行为

### 状态

- `identified`

---

## 使用约定

后续每新增一个真实测试问题，请按以下模板追加：

```md
## Case XXX: 标题

### 场景

### 复现步骤

### 当前实际行为

### 预期行为

### 根因判断

### 修复方向

### 需要验证的测试点

### 对应开发改动

### 状态
```

---

## Case 002: 本地缩写语义未被正确理解（PSLE）

### 场景

用户输入一条新加坡本地语境中很自然的关系事件表达：

`今天和王总聊了10分钟，他女儿下周 psle`

系统虽然完成了联系人确认，但后续没有正确理解 `PSLE` 是一个具体考试事件，而是把它当成模糊安排继续追问。

### 复现步骤

1. 用户输入：
   `今天和王总聊了10分钟，他女儿下周 psle`
2. 系统完成联系人确认
3. 系统返回：
   `请告诉我王总女儿下周的具体安排，以便我帮您创建相应的提醒。`

### 当前实际行为

- 系统没有把 `PSLE` 识别为明确的考试事件
- 后续追问过于泛化，像是在问用户“下周有什么安排”
- 没有生成更贴近语义的 note/reminder 候选

### 预期行为

系统应先理解：

- `PSLE` 是具体事件
- 这条输入更接近“家庭重要事件/考试事件”

更合理的行为包括：

- 记录一条关系事件备注
- 生成一个考试相关提醒候选
- 如果缺精确日期，只追问最小必要字段，例如：
  - `要我按下周一先设提醒，还是你告诉我具体日期？`

而不应泛泛地问“具体安排是什么”。

### 根因判断

问题不在联系人确认，而在领域语义理解层：

- 当前系统虽然有 LLM understanding
- 但 `PSLE` 没有被稳定归一化为“考试事件”
- 后续 action planner / reminder planner 只看到了：
  - 家人
  - 下周
  - 可能需要提醒
- 却没有明确看到：
  - 这是一个本地教育考试缩写

### 修复方向

不是简单补一个 `psle` 的硬编码规则，而是增强“领域短语归一化”能力：

- 将高频本地缩写先归一化为明确事件语义
- 例如：
  - `PSLE` -> `family_exam_event`
  - `O level` -> `school_exam_event`
  - `A level` -> `school_exam_event`
  - `NS` -> `military_service_event`

然后再进入后续：

- understanding
- action planning
- reminder planning

### 需要验证的测试点

1. `PSLE` 能被识别为考试事件，而不是普通模糊安排
2. 系统能为“家人考试”生成更合理的 note/reminder 候选
3. 如果缺精确日期，追问应最小化、事件语义明确
4. 不应影响已有普通 reminder / birthday 逻辑

### 对应开发改动

待开发：

- 在 understanding 或前置 normalization 层加入领域短语语义归一化
- 让 planner 能识别 `exam_event / family_event` 语义
- 优化这类事件的追问文案

### 状态

- `identified`
