# CRM Conversation Engine PRD

## 1. Product Summary

本产品是一个面向销售团队的对话式 CRM App。

用户通过单个对话框，以纯聊天方式完成 CRM 的核心交互，包括：

- 查找联系人
- 记录沟通信息
- 创建、修改、完成待办
- 创建提醒
- 查询销售进展
- 生成跟进内容
- 更新联系人画像与长期记忆

系统目标不是把用户的话分类成一个固定标签，而是：

1. 理解用户自然语言中的真实意图
2. 在联系人、时间、目标动作不明确时主动追问
3. 结合历史对话、联系人资料、任务状态和长期记忆进行综合判断
4. 在用户确认后执行对应操作

一句话定义：

> 一个通过多轮对话理解销售意图，并完成 CRM 查询、记录、提醒和执行动作的智能工作台。

## 2. Target User

首要目标用户：

- 在新加坡工作的销售、商务拓展、客户经理

典型工作特点：

- 联系人多，称呼模糊，如“张总”“王老板”
- 经常通过 WhatsApp、电话、线下会面沟通
- 中英夹杂表达普遍存在
- 输入内容往往不完整、口语化、包含多个动作
- 需要快速记录、快速查询、快速生成跟进内容

## 3. Product Goals

### 3.1 Primary Goals

- 让用户只通过一个对话框完成 CRM 的主要交互
- 让系统能处理模糊表达，而不是要求用户填写结构化表单
- 让系统能通过多轮对话澄清联系人、时间、目标动作
- 让系统逐步沉淀联系人画像、长期记忆和销售上下文

### 3.2 Non-Goals For Near-Term MVP

- 不做复杂 BI 报表
- 不做完整企业权限体系
- 不做自动外发消息闭环
- 不做复杂多 agent 编排
- 不做过重的 workflow framework 依赖

## 4. Core Product Principles

### 4.1 Chat-First

所有核心交互都应可通过聊天完成，而不是依赖多页面表单。

### 4.2 LLM-First Understanding

尽量减少业务理解规则，让大模型负责：

- 意图理解
- 多动作拆解
- 追问生成
- 关系和上下文理解
- 内容生成

规则主要用于：

- 联系人候选召回
- 结构校验
- 安全边界
- 执行前确认

### 4.3 Clarify Before Execute

如果联系人、目标动作、时间、参数不够明确，必须优先追问，而不是猜测执行。

### 4.4 Structured Truth + Raw Context

系统既要保留原始对话，也要把长期有效的信息结构化存储。

### 4.5 Human-Confirmable

对可能造成真实业务影响的操作，系统应支持确认：

- 创建任务
- 修改任务
- 创建提醒
- 更新联系人画像
- 写入长期记忆

## 5. Main User Intent Categories

### 5.1 Contact Query

用户意图：

- 查找联系人
- 确认是哪个联系人
- 查询联系人资料和联系方式

示例：

- “帮我找一下新海的张总”
- “上次那个物流行业的王总是谁”
- “张伟的手机号是多少”

### 5.2 Conversation Logging

用户意图：

- 记录这次沟通里发生了什么
- 沉淀客户关注点、风险、偏好

示例：

- “今天和张总聊了10分钟，他对报价很感兴趣”
- “王总最近更关注交期，不是价格”

### 5.3 Task Management

用户意图：

- 创建待办
- 修改待办
- 完成待办
- 取消待办

示例：

- “下周三提醒我给张总发 demo”
- “把报价改到周五”
- “张总已经付款了，把催款关掉”

### 5.4 Reminder Management

用户意图：

- 创建时间提醒
- 记录生日、到期日、回访时间

示例：

- “下个月24号提醒我给他女儿送祝福”
- “合同到期前一周提醒我”

### 5.5 Pipeline Query

用户意图：

- 查询接下来该做什么
- 查询客户当前进展
- 查询遗漏风险

示例：

- “我今天该跟进谁”
- “谁对报价有兴趣但我还没跟”

### 5.6 Content Crafting

用户意图：

- 生成 WhatsApp、邮件、会议纪要、跟进话术

示例：

- “帮我写个 WhatsApp 跟进”
- “写一封英文报价跟进邮件”

### 5.7 Profile / Memory Update

用户意图：

- 更新联系人画像
- 写入长期关系信息

示例：

- “他比较看重交期”
- “他女儿下个月24号生日”

## 6. Core Experience Flow

### 6.1 High-Level Flow

```text
用户输入
-> 联系人线索提取
-> 联系人候选召回与排序
-> 联系人确认
-> 上下文构建
-> LLM 理解与动作规划
-> 如有缺失则追问
-> 用户确认
-> 执行工具
-> 落库与审计
-> 返回结果
```

### 6.2 Contact Resolution Flow

系统先识别输入中是否提及联系人。

可能结果：

- `unresolved`
  没有足够联系人线索，请用户补充
- `not_found`
  有线索，但数据库查不到候选
- `ambiguous`
  候选不止一个，需要用户确认
- `resolved`
  有最高置信度联系人，但仍可能要求用户确认

示例：

用户输入：

> 今天和新海的张总聊了10分钟

系统行为：

1. 抽取线索：`person_name=张总`, `company=新海`
2. 召回多个张姓候选
3. 优先命中新海科技对应联系人
4. 若分值领先明显，可进入“请确认是否是这位联系人”

用户输入：

> 今天和张总聊了10分钟

系统行为：

1. 抽取线索：`person_name=张总`
2. 召回所有“张总”候选
3. 进入歧义确认，让用户选人

## 7. Contact Matching Strategy

### 7.1 Why Not Start With Embeddings

联系人确认的核心问题是“实体消歧”，不是开放语义搜索。

第一阶段优先采用：

- 结构化线索抽取
- 联系人候选召回
- 加权排序
- 阈值判断

原因：

- 更可控
- 更可解释
- 更适合高信任 CRM 场景
- 更适合早期数据量较小阶段

### 7.2 Matching Inputs

从用户输入中抽取：

- `person_name_hint`
- `display_name_hint`
- `company_hint`
- `title_hint`
- `phone_hint`
- `email_hint`
- `wechat_hint`

### 7.3 Candidate Retrieval

从以下数据源召回候选：

- `contacts`
- `contact_basics`
- `contact_methods`
- 后续可扩展：`contact_aliases`

### 7.4 Scoring Dimensions

候选排序优先依据：

- 称呼精确匹配
- 姓名精确/模糊匹配
- 公司精确/部分匹配
- 手机、邮箱、微信命中
- 职位提示命中
- 最近互动加分
- 当前会话上下文加分

### 7.5 Escalation Path

后续增强顺序：

1. 别名归一化
2. 公司简称归一化
3. 近期互动上下文加权
4. embedding 辅助召回
5. LLM rerank 作为辅助打分

## 8. Conversation Engine Responsibilities

### 8.1 LLM Responsibilities

- 理解用户表达
- 拆解多意图
- 生成 `proposed_actions`
- 识别缺失槽位
- 生成追问
- 基于上下文回答问题
- 生成对外内容

### 8.2 Deterministic System Responsibilities

- 联系人候选召回
- 会话状态管理
- 数据库存储
- 工具调用
- 权限与审计
- 执行结果写回
- Schema 校验

## 9. Data Storage Strategy

系统需要同时支持：

- 当前会话多轮澄清
- 长期 CRM 事实存储
- 长期关系记忆沉淀
- 基于历史上下文的综合回答

因此需要分层存储。

### 9.1 Layer A: Raw Conversation

保存每一轮对话原文。

用途：

- 多轮追问
- 审计
- 回放
- 提供原始证据

建议表：

- `conversations`
- `conversation_messages`

### 9.2 Layer B: Session State

保存当前 query engine 的临时状态。

用途：

- 当前确认到哪个联系人
- 当前有哪些候选动作
- 当前 pending_question 是什么
- 用户下一句是否是在回答上一个问题

建议表：

- `engine_sessions`

### 9.3 Layer C: Structured CRM Data

保存长期业务真相。

建议表：

- `customers`
- `contacts`
- `contact_methods`
- `contact_profiles`
- `tasks`
- `reminders`
- `deals`
- `crm_notes`

### 9.4 Layer D: Contact Memories

保存长期关系信息、偏好、风险、重要日期等。

建议表：

- `contact_memories`

每条 memory 应至少包含：

- `memory_type`
- `summary`
- `structured_slots_json`
- `confidence`
- `source_message_id`
- `is_confirmed`

### 9.5 Layer E: Semantic Retrieval

保存可检索的历史语义内容。

后续可增加：

- `knowledge_chunks`
- `knowledge_embeddings`

用于支持：

- 历史沟通摘要检索
- 长期上下文召回
- contact memory 语义检索

## 10. Response Context Strategy

系统回复不应把所有数据都直接送给模型，而应由 `context builder` 动态构建上下文。

### 10.1 Context Sources

- 当前会话最近消息
- 当前 `session_state`
- 当前已确认联系人
- 联系人 profile
- 最近 tasks
- 最近 reminders
- 最近 notes
- 最近 memories
- 相关历史摘要

### 10.2 Context Builder Goals

- 控制 token 成本
- 提高回复相关性
- 避免模型被无关历史污染
- 支持多轮澄清与持续理解

## 11. Functional Scope

### 11.1 Phase 1 Scope

目标：

- 让 query engine 成为主入口
- 能确认联系人
- 能规划动作
- 能通过多轮对话做澄清
- 不执行真实 side effect

范围：

- 联系人确认
- `proposed_actions`
- `pending_question`
- 动作选择和确认

### 11.2 Phase 2 Scope

目标：

- 将动作从“规划”升级为“真实执行”

范围：

- `add_note` 落库
- `create_task` 落库
- `create_reminder` 落库
- 审计日志

### 11.3 Phase 3 Scope

目标：

- 做完整会话持久化和上下文回放

范围：

- `engine_sessions`
- `conversations`
- `conversation_messages`
- 服务端状态恢复

### 11.4 Phase 4 Scope

目标：

- 增强上下文理解和召回质量

范围：

- `contact_memories`
- context builder
- 历史摘要
- 向量检索

### 11.5 Phase 5 Scope

目标：

- 完善产品化体验

范围：

- 真实聊天式前端
- 联系人卡片
- 动作确认卡片
- 执行结果反馈
- 内容生成体验

## 12. Success Criteria

### 12.1 Product Metrics

- 用户能在一个对话框里完成主要 CRM 操作
- 联系人确认成功率持续提升
- 多轮追问后可完成任务执行
- 用户减少手工录入表单次数

### 12.2 Experience Metrics

- 模糊联系人输入可被稳定澄清
- 系统追问尽量少但足够有效
- 多动作输入能被正确拆解
- 回复风格自然、清晰、可执行

## 13. Risks

- 联系人消歧错误导致错误执行
- 模型过度推断导致错误写入 profile 或 memory
- 没有服务端会话持久化时，多轮交互易丢状态
- 数据模型过轻会限制后续智能能力
- 数据模型过重又会拖慢早期开发

## 14. Product Decisions Made So Far

- 产品入口采用单对话框交互
- 联系人确认是所有后续动作理解的前置步骤
- 联系人召回优先用规则 + 排序，不先依赖 embedding
- 大模型优先负责动作理解、动作规划和追问
- 规则优先负责边界、存储、校验和执行安全
- 必须同时保存原始对话和结构化业务数据

## 15. Step-by-Step Task Breakdown

### Step 1: Solidify Engine Contract

目标：

- 稳定定义 query engine 的输入输出协议

任务：

- 定义 `session_state` schema
- 定义 `contact_resolution` schema
- 定义 `proposed_actions` schema
- 定义 `pending_question` schema
- 定义 `engine response` schema
- 统一 `mode` 语义

交付物：

- 类型定义
- Zod schema
- 示例请求与响应

### Step 2: Complete Contact Resolution Foundation

目标：

- 把联系人确认做稳

任务：

- 强化联系人线索抽取
- 完善候选召回与排序
- 加入公司简称与称呼别名支持
- 完善联系人确认文案
- 增加更多联系人匹配测试

交付物：

- 稳定的联系人确认流程
- 多种联系人输入测试集

### Step 3: Upgrade To True Clarification Loop

目标：

- 把单轮解析升级成多轮澄清引擎

任务：

- 区分“新请求”和“回答上一轮问题”
- 让 `pending_question` 能驱动下一轮输入解析
- 支持参数补全类追问
- 支持动作选择类追问
- 支持联系人确认后的继续规划

交付物：

- 稳定多轮状态流
- 对话式 playground 验证

### Step 4: Add Action Execution Layer

目标：

- 从协议层进入真实 CRM 操作

任务：

- 执行 `add_note`
- 执行 `create_task`
- 执行 `create_reminder`
- 写入审计日志
- 返回执行结果

交付物：

- 基本执行器
- 执行结果 schema

### Step 5: Add Session Persistence

目标：

- 服务端接管会话状态

任务：

- 新增 `engine_sessions`
- 新增 `conversations`
- 新增 `conversation_messages`
- 支持服务端读取和恢复上下文
- 减少前端完整回传状态的需求

交付物：

- 服务端 session store
- 可恢复的多轮会话

### Step 6: Build Contact Memory Layer

目标：

- 让系统真正“记得住”

任务：

- 新增 `contact_memories`
- 区分事实、偏好、风险、推断
- 支持来源消息和置信度
- 支持用户确认 memory 写入

交付物：

- 长期关系记忆层
- memory 写入与查询能力

### Step 7: Build Context Builder

目标：

- 让模型在回答时能看到最相关的历史上下文

任务：

- 拉取当前联系人 profile
- 拉取近期 tasks/reminders/notes/memories
- 拉取最近对话消息
- 生成 LLM 输入上下文包
- 控制上下文长度和优先级

交付物：

- `context-builder` 服务
- 更准确的动作理解与问答质量

### Step 8: Expand Query And Craft Capabilities

目标：

- 让产品从“记录工具”升级到“销售助理”

任务：

- 支持问“今天该跟进谁”
- 支持问“这个客户最近什么状态”
- 支持生成 WhatsApp 跟进文案
- 支持生成英文邮件
- 支持会议纪要总结

交付物：

- `query_tool`
- `craft_tool`

### Step 9: Add Semantic Retrieval

目标：

- 支持更复杂的历史上下文召回

任务：

- 增加摘要策略
- 增加 chunk 存储
- 增加 embedding 检索
- 将 semantic retrieval 接入 context builder

交付物：

- 语义检索能力
- 更强的跨历史理解能力

### Step 10: Productize The Chat App

目标：

- 把 playground 升级成正式产品界面

任务：

- 重构聊天 UI
- 优化联系人卡片
- 优化动作确认卡片
- 增加执行结果回显
- 增加输入建议和快捷操作

交付物：

- 正式聊天式 CRM 应用

## 16. Immediate Next Step

当前最应该做的是：

### Step 1: Solidify Engine Contract

原因：

- 这是所有后续开发的基础
- 没有稳定协议，就无法稳定做执行器、前端、持久化和记忆层
- 它能明确系统到底如何表达联系人确认、动作规划、追问和确认

当前阶段完成标准：

- 所有核心 schema 清晰稳定
- `/engine/respond` 返回结构统一
- 文档、测试、playground 三者一致

