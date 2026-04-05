# RelateAI Unified PRD

## 1. Product Positioning

RelateAI 是一个 AI 驱动的关系管理 CRM。

核心目标不是帮助用户“管理数据”，而是帮助用户：

- 不忘记任何一个重要的人
- 不忘记任何一件重要的事
- 用最少输入完成关系记录、查询、跟进和执行

产品主形态：

- 手机端优先
- 语音优先
- 对话式交互优先

一句话定义：

> 一个通过对话理解销售意图、管理客户关系、组织后续动作，并逐步沉淀长期关系记忆的智能 CRM 助手。

## 2. Design Philosophy

### 2.1 First Principles

- 用户的根本需求不是维护 CRM 字段，而是记住人与事
- 用户不应该频繁手工录入
- 用户在外面跑客户时，应优先用语音和短句完成操作

### 2.2 Core Principles

- AI 主动，用户被动
  用户打开 app，系统应该能告诉他“该看谁、该做什么”
- 语音优先
  输入方式默认面向语音和口语
- 零或低数据录入
  用户说话就是输入，系统负责理解、提取、存储
- Chat-first
  用户优先通过一个对话框完成主要 CRM 操作
- Clarify before execute
  联系人、时间、动作不明确时先追问，不猜
- Structured truth + raw context
  同时保存原始对话和结构化业务数据

## 3. Product Surface

### 3.1 Target Product Form

整个 app 的目标形态：

- 主页（Voice）
  - AI 当前建议
  - 语音按钮
  - 对话字幕流
- 卡片页（Cards）
  - 客户列表
  - 客户详情
  - AI 状态卡片
  - 标签、待办、时间线
  - 可唤起对话浮层
- 辅助页面
  - 对话日志
  - 设置

### 3.2 Current Build Form

当前仓库的实现形态仍是原型：

- 单个对话式入口 `/engine/respond`
- Web playground 验证页
- 联系人确认、最小 query answering、候选动作规划
- 尚未实现完整手机端 UI
- 尚未实现正式语音链路

## 4. User Intents

系统需要处理两层意图：

### 4.1 Product-Level Intent Families

- `QUERY`
  查询客户、历史、状态、统计
- `KNOWLEDGE`
  行业知识、产品知识、竞品、销售方法论
- `GENERATE`
  生成 WhatsApp、邮件、纪要、卡片
- `RECOMMEND`
  礼物推荐、跟进策略、产品建议
- `RECORD`
  记录沟通、关系信息、偏好、事件
- `COMMAND`
  创建/修改/完成任务、提醒、联系人、关系
- `CHAT`
  闲聊或不明确表达

### 4.2 Current Engine Facets

当前工程实现里，understanding 主要通过这些 facet 工作：

- `has_query`
- `has_note`
- `has_task`
- `has_reminder`
- `has_craft`
- `is_answer_to_pending`

以及主展示类型：

- `query`
- `note`
- `task`
- `reminder`
- `craft`
- `mixed`
- `answer_to_pending`

## 5. Unified Interaction Pipeline

目标态流水线：

```text
用户输入（语音/文字）
-> 语义理解
-> 路由分发
-> 即时反馈 / 待执行清单
-> 对话继续
-> 对话结束
-> 全对话回顾
-> 提取最终变更
-> 输出标准化指令
-> 程序验证
-> 批量执行
-> 数据写入与 UI 刷新
```

### 5.1 Current Build State

当前仓库实际做到的是目标流水线的前半段：

```text
用户输入
-> understanding
-> 联系人线索抽取
-> 联系人确认
-> query answering 或 proposed_actions
-> clarify / confirm / answer
```

当前尚未实现：

- 对话结束后统一回顾
- 标准化 action JSON 批量执行
- 真实数据库 side effect
- UI 自动刷新闭环

## 6. Contact Resolution

### 6.1 Product Requirement

客户识别优先级：

1. 消息中明确提到名字
2. 当前在客户详情页
3. 上文已提及客户且未切换
4. 无法识别则追问

### 6.2 Current Build State

当前系统已实现：

- LLM-first contact clue extraction
- rule-based candidate retrieval + ranking
- 歧义联系人确认
- 唯一命中联系人确认

当前支持线索：

- 姓名/称呼
- 公司线索
- 手机
- 邮箱
- 微信
- 职位提示

当前未实现：

- 完整别名体系
- embedding 联系人召回
- 跨多轮更复杂的人物继承逻辑

## 7. Query System

### 7.1 Target Capability

查询需要覆盖：

- 客户状态
- 客户详情
- 对话历史
- 用户统计
- 行业知识
- 产品知识
- 推荐与策略

### 7.2 Current Build State

当前已支持最小 query answering，基于已确认联系人回答：

- 手机号
- 职位
- 公司
- 生日线索
- 最近备注/沟通摘要
- open tasks
- 基础画像字段

当前未支持：

- 跨客户全局筛选
- 用户聚合统计
- 保单/文档/产品字段
- 行业知识库查询
- 推荐型查询
- 混合 KB + 联系人画像查询

## 8. Action System

### 8.1 Target Action Taxonomy

目标 action type：

- `add_timeline`
- `add_trait`
- `remove_trait`
- `add_todo`
- `complete_todo`
- `update_todo`
- `delete_todo`
- `update_profile`
- `add_relation`
- `create_contact`
- `add_notification`
- `update_health`
- `trigger_event_chain`
- `archive_conversation`

### 8.2 Current Build State

当前系统真实支持的只是“候选动作规划”，不是执行：

- `add_note`
- `create_task`
- `create_reminder`
- `query`
- `update_task`（占位）
- `complete_task`（占位）

当前能力是：

- 生成 `proposed_actions`
- 多轮确认
- 参数补全
- 动作选择与动作确认

当前未实现：

- 真实写库执行
- action 白名单验证器
- 批量执行器
- 执行失败容错

## 9. Knowledge Base

### 9.1 Target Capability

产品目标里应支持：

- 产品知识
- 行业知识
- 竞品对比
- 销售方法论
- 礼物/策略推荐

### 9.2 Current Build State

当前系统尚未接入正式 KB。

现阶段仅支持：

- 联系人资料查询
- CRM 历史记录查询

未来应将 query executor 升级为：

- `contact_query`
- `crm_history_query`
- `knowledge_base_query`
- `hybrid_query`

## 10. Content Generation

### 10.1 Target Capability

应支持：

- 跟进消息
- 邮件
- 纪要
- 贺卡
- 礼物文案
- 跟进策略

### 10.2 Current Build State

当前 understanding 能识别 `craft` 语义，但系统还没有完整的生成内容闭环。

因此：

- 当前产品目标保留
- 当前工程状态视为未完成

## 11. Conversation Write Strategy

### 11.1 Target Product Decision

对话进行中：

- 可以回复
- 可以积累待执行清单
- 不直接写数据库

对话结束后：

- 统一回顾完整上下文
- 提取最终变更
- 检测生命事件
- 输出标准化 action JSON
- 程序验证
- 批量执行

### 11.2 Current Build State

当前系统仍处在“对话中即时结构化规划”阶段：

- 会立即返回联系人确认
- 会立即返回查询回答
- 会立即返回 `proposed_actions`
- 不做真实写库

所以现在更接近：

- “对话中规划”

而不是：

- “对话结束后统一提交”

后续演进方向应是：

- 保留当前多轮确认协议
- 再向“结束后统一执行”迁移

## 12. Data Model

### 12.1 Target Data Layers

系统长期应包含 5 层数据：

1. 原始对话层
2. 会话状态层
3. 结构化 CRM 数据层
4. Contact Memory 层
5. Knowledge Base / Retrieval 层

### 12.2 Current Build State

当前已有：

- `customers`
- `contacts`
- `contact_methods`
- `contact_basics`
- `contact_profiles`
- `tasks`
- `conversation_notes`

当前缺少：

- `engine_sessions`
- `conversations`
- `conversation_messages`
- `contact_memories`
- `knowledge_documents`
- `knowledge_chunks`
- `notifications`
- `relations`
- `health_scores`

## 13. Life Event Chains

### 13.1 Target Capability

某些信息不应只是单条标签，而应触发一组时间相关节点。

示例：

- 怀孕
- 新生儿出生
- 生日
- 换工作
- 子女升学

例如 `pregnancy` 模板可触发：

- 当前保障 review
- 预产前加保
- 新生儿礼物
- 新生儿保障

### 13.2 Current Build State

当前系统尚未支持生命事件链。

目前最多只能：

- 识别关系信息
- 生成 reminder 候选动作
- 记录 note

## 14. Current System Contract

当前主接口：

- `POST /engine/respond`

当前核心 mode：

- `resolve_contact`
- `clarify`
- `confirm`
- `answer`

当前意义：

- `resolve_contact`
  联系人未解决
- `clarify`
  参数待补充
- `confirm`
  联系人或动作待确认
- `answer`
  当前轮返回解释、回答或“已确认但未执行”

## 15. Implementation Roadmap

### Phase A: Current Foundation

已完成：

- understanding
- contact resolution
- 最小 query answering
- 候选动作规划
- Step 1 / Step 2 协议与状态机

### Phase B: Execution Layer

下一阶段应实现：

- action executor
- 程序验证
- 审计日志
- 真实写库

### Phase C: Session And Conversation Persistence

- `engine_sessions`
- `conversations`
- `conversation_messages`

### Phase D: Memory Layer

- `contact_memories`
- 长期关系记忆
- 生命事件提取

### Phase E: Knowledge Base

- KB 文档层
- chunk 层
- KB 检索
- hybrid query

### Phase F: Voice + Mobile Productization

- 正式手机端交互
- 语音优先链路
- 首页主动建议
- Cards 页成型

## 16. Merge Decision

本统一 PRD 的原则是：

- 产品愿景、产品哲学、最终动作系统、生命事件链，以产品 PRD 为准
- 当前系统能力、接口协议、工程状态和开发路线，以仓库 PRD 与 TECHNICAL_STATE 为准

这意味着：

- 统一 PRD 描述“目标态”
- 同时明确“当前态”
- 避免产品和工程各说一套语言

