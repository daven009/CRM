# Product Decisions

用于记录已经确认的产品交互决策。  
只记结论，不展开技术实现细节。

---

## 2026-04-04

### 1. 动作选择后直接执行

- 当前最小执行层只包含：
  - `add_note`
  - `create_task`
  - `create_reminder`
- 这些动作不属于高风险破坏性操作。
- 因此在当前产品阶段：
  - 用户选中 action 后应直接执行
  - 不再增加一层“确认已选动作”

结论：

- 移除当前 `action_confirmation` 交互层
- `action_selection` 后直接进入执行
- 当前版本应同步更新 playground 文案与测试，避免仍显示“不会真实执行写库”

### 2. 最近已确认联系人应短期继承

- 如果用户刚刚确认过“张总 = 张建国（新海科技）”
- 在相邻对话里再次提到“张总”
- 且没有新的冲突线索
- 系统应优先复用最近已确认联系人，而不是重新要求确认

结论：

- 增加最近联系人短期继承机制
- 新请求允许继承最近已确认联系人
- 只有在出现冲突线索或明确切换对象时，才重新进入联系人确认
- 当前范围只做当前会话或短期相邻请求级别，不做长期 memory

### 3. 会话继承规则：保留人，不保留旧请求

- 新请求不应错误继承旧的 `raw_user_input`
- 新请求不应错误继承旧的 draft actions
- 但可以继承最近已确认联系人

结论：

- 新请求开启新 request context
- 可以保留联系人上下文
- 不保留旧 request 本体

### 4. 引入 world knowledge grounding，但最终仍服务于 intent 识别

- 当前系统的 understanding 最终目标仍然是：
  - 识别 query / note / task / reminder / craft / mixed
  - 为后续联系人确认、query answering、action planning 提供稳定输入
- 但仅靠当前 understanding，难以稳定处理本地缩写、教育事件、节日、人生阶段、行业术语等世界知识概念。
- 因此需要在 understanding 之前增加一层轻量的 `world knowledge grounding`：
  - 先把输入中的现实世界概念归一化
  - 再把这些概念作为辅助上下文提供给 understanding

结论：

- 新增 `world knowledge grounding` 层
- grounding 的输出不是最终动作，也不是百科解释
- grounding 只负责：
  - 识别概念
  - 做归一化
  - 提供 CRM 语义提示
- understanding 的最终输出仍然是 intent / facets / clarification / routing

例如：

- `PSLE` 不应只被当成普通“提醒词”
- 应先归一化为：
  - 教育考试事件
  - CRM 语义提示：家庭重要事件 / family milestone
- 再辅助后续 intent 识别与 reminder / note 规划

---

## 文档使用规则

- 产品交互决策记在这里
- 技术实现现状记在 `docs/TECHNICAL_STATE.md`
- 具体开发改动记在 `change_log.md`
- 长期目标与完整产品定义记在 `docs/unified_prd.md`
