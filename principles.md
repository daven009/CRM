# RelateAI — 智能体系统架构文档

> AI赋能的关系管理CRM · 手机端 · 语音优先
> 版本 1.0 · 2026.03

---

## 一、产品设计哲学

### 第一性原则

用户的根本需求不是管理数据，而是"不要忘记任何一个重要的人和重要的事"。

设计原则：

- AI主动，用户被动 — 用户打开app，AI告诉他该做什么，而不是用户去找信息
- 语音是第一交互方式 — 用户在外面跑，没时间打字
- 零数据录入 — 用户说话就是录入，AI负责理解、提取、存储
- 操作路径不超过3步 — 打开 → 看到建议 → 说一句话 → 搞定

### 产品结构

整个app只有两个主页面 + 辅助页面：

**主页（Voice）** — AI语音对话页面。屏幕中央是语音按钮，上方是AI的当前建议（一句话），对话时字幕式展示（用户靠右，AI靠左）。这是用户80%时间所在的页面。

**卡片页（Cards）** — 客户列表 + 客户详情。列表极简（名字 + 公司 + AI状态行 + 健康度圆点），点击进入详情页。详情页顶部是AI状态卡片，然后是身份、标签云、待办、时间线。详情页内有毛玻璃对话浮层，对话结束自动更新客户信息。

**辅助页面** — 对话日志（log）、设置（settings）。

---

## 二、核心流水线

所有交互最终都走同一条流水线。流水线不是简单的线性管道——它内含**条件分支（if）**和**循环拆解（loop）**，能处理一句话里的多个意图、意图间的依赖、用户修正引发的回溯。

### 主流程（带控制流）

```
用户输入（语音/文字）
       ↓
  ① 语义理解（拆解为意图数组 intents[]）
       ↓
  ┌─ LOOP: for each intent in intents[] ──────────────────┐
  │                                                        │
  │  ② 依赖检查（IF）                                       │
  │     IF intent依赖前置intent的产出（如create_Profile）     │
  │       → 等待前置intent执行完毕，拿到产出（如新客户ID）     │
  │     ELSE                                               │
  │       → 直接进入下一步                                   │
  │                                                        │
  │  ③ 对焦                                                │
  │     IF intent提及了新客户名                              │
  │       → 加载该客户KB，注入prompt                         │
  │     ELIF 上文有焦点且本条未切换                           │
  │       → 延续上文焦点                                    │
  │     ELIF 无法识别客户                                    │
  │       → 标记需追问，暂挂本intent                         │
  │                                                        │
  │  ④ 路由分发（IF）                                       │
  │     IF intent.type ∈ {QUERY, KNOWLEDGE, GENERATE,      │
  │                       RECOMMEND, CHAT}                  │
  │       → 需要回复，不改数据 → 走即时反馈路径               │
  │     ELIF intent.type ∈ {RECORD, COMMAND}                │
  │       → 需要回复 + 需要改数据 → 走即时执行路径            │
  │                                                        │
  │  ⑤ 处理                                                │
  │     大模型处理（回复 + 识别数据变更）                      │
  │     IF 需要外部检索（时效性/知识库无法覆盖）               │
  │       → 触发 web search / RAG 检索                      │
  │       → 将检索结果注入上下文，再生成回复                   │
  │     IF 有action输出                                     │
  │       → 即刻执行变更                                    │
  │       → IF action == trigger_event_chain                │
  │           → 调用事件链展开器（LOOP展开N个节点）           │
  │           → 每个节点生成 add_todo + add_notification     │
  │     回复用户                                            │
  │                                                        │
  └────────────────────────────────────────────────────────┘
       ↓
  ⑥ 等待下一句...（带着更新后的KB和焦点继续）
       ↓
  ┌─ IF 用户修正 ─────────────────────────────────────────┐
  │  检测到修正语义（"不对""改成""其实是"）                    │
  │  → 定位被修正的字段                                     │
  │  → 生成覆盖action（update/delete + 新值）               │
  │  → 即刻执行（幂等覆盖，最终状态正确即可）                 │
  └────────────────────────────────────────────────────────┘
       ↓
  ⑦ 对话结束
       ↓
  ┌─ LOOP: for each client in involved_clients[] ─────────┐
  │  ⑧ AI总结整段对话 → 为该客户写入一条timeline记录         │
  └────────────────────────────────────────────────────────┘
       ↓
  ⑨ UI刷新
```

### 控制流详解

#### IF — 条件分支

流水线中有5类条件分支：

```
分支点             条件                          走向
─────────────────────────────────────────────────────────
依赖检查         intent是否依赖前置产出          等待 vs 直接执行
对焦             是否能识别客户                  加载KB / 延续 / 追问
路由             intent类型                      即时反馈 vs 即时执行
外部检索         知识库能否覆盖                  直接回答 vs web search / RAG
事件链           action是否触发event_chain       展开 vs 跳过
用户修正         是否检测到修正语义              覆盖执行 vs 正常流转
```

##### 外部检索分支

处理阶段的大模型会先判断自身知识库能否回答。判断依据：

```
IF 问题属于客户个人信息（"张伟电话多少"）
  → 客户KB能覆盖 → 直接回答
ELIF 问题属于静态行业知识（"终身寿险和定期寿险的区别"）
  → 行业知识库能覆盖 → 直接回答
ELIF 问题涉及时效性/外部信息（"最新的医疗政策""今天利率多少"）
  → 知识库无法保证时效 → 标记 [需要搜索]
  → 触发 web search（关键词由大模型生成）
  → 检索结果注入上下文 → 基于检索结果生成回复
  → 回复中标注信息来源和时间
ELIF 问题完全超出范围（"帮我订机票"）
  → 坦诚告知无法处理 + 建议替代途径
```

走查示例——"最新的医疗政策是什么"：

```
用户输入："最新的医疗政策是什么"

① 语义理解
  intents[] = [{type:KNOWLEDGE, client:null, content:"最新医疗政策"}]

LOOP i=0:
  ② 依赖检查 → 无前置依赖 → 继续
  ③ 对焦
    → 无客户名，不需要客户KB
    → focus = null，挂行业知识库
  ④ 路由
    → KNOWLEDGE → 需要回复 ✓ 需要改数据 ✗ → 即时反馈
  ⑤ 处理
    → 大模型判断："最新"是时效性关键词，行业知识库可能过时
    → IF 需要外部检索 → ✓
    → 生成搜索关键词："2026 新加坡 医疗保险政策 MAS"
    → web search 返回结果
    → 注入上下文，生成带来源的回复
    → actions = []（无数据变更）
    → 回复用户

无客户涉及 → 对话结束时不写timeline
（除非用户后续围绕这个话题讨论了某个客户的保障方案）
```

##### 依赖检查示例

用户说："帮我加个新客户叫Sarah，然后给她加个3天后的跟进"

```
intents:
  intent[0]: create_profile(name=Sarah)
  intent[1]: add_todo(client=Sarah, text=跟进, days=3)

执行流：
  intent[0] 无依赖 → 直接执行 → 产出 sarah_id=42
  intent[1] 依赖 intent[0] 的 client_id
    → IF intent[0] 已完成 → 注入 client_id=42 → 执行
    → IF intent[0] 失败 → 标记 intent[1] 跳过，回复用户说明原因
```

##### 对焦分支示例

```
IF 消息中明确提到"张伟"
  → focus = 张伟, 加载张伟KB
ELIF 当前在张伟详情页 且 消息未提新名字
  → focus = 张伟（自动锁定）
ELIF 上一轮焦点是张伟 且 本条说"他"
  → focus = 张伟（延续）
ELIF 无法判断
  → focus = null, reply中追问"你说的是哪位客户？"
  → 暂挂该intent，等用户澄清后回填并恢复执行
```

#### LOOP — 循环拆解

流水线中有3类循环：

```
循环点                    迭代对象              说明
────────────────────────────────────────────────────────
意图循环                  intents[]            一句话N个意图，逐个处理
事件链展开                event_nodes[]        一个模板展开为M个节点
对话结束-timeline写入     involved_clients[]   每个涉及客户写一条记录
```

##### 意图循环示例

用户说："我刚和李梅喝了下午茶，她朋友Sarah在Google想买保险，帮我给张伟写条教育基金跟进"

```
intents[] = [
  {type:RECORD,  client:李梅, content:下午茶面谈},
  {type:RECORD,  client:李梅, content:朋友Sarah·Google·保险需求},
  {type:COMMAND, action:create_profile, data:{Sarah, Google, 李梅介绍}},
  {type:GENERATE,client:张伟, content:教育基金跟进话术}
]

LOOP iteration:
  i=0: RECORD李梅   → 对焦李梅 → 即刻写入 → ✓
  i=1: RECORD李梅   → 延续焦点 → 即刻写入 → ✓
  i=2: COMMAND      → 无需对焦 → 创建Sarah → 产出sarah_id → ✓
  i=3: GENERATE张伟 → 切换焦点到张伟 → 生成话术 → 回复用户 → ✓
```

##### 事件链展开循环

```
trigger_event_chain(client=张伟, template=pregnancy, anchor=2026-09)

LOOP展开pregnancy模板：
  node[0]: now        → add_todo(张伟, review当前保障, due=today)
  node[1]: anchor-6m  → add_notification(张伟, 加保方案, 2026-03)
  node[2]: anchor-3m  → add_notification(张伟, 跟进加保, 2026-06)
  node[3]: anchor-1m  → add_todo(张伟, 准备新生儿礼物, 2026-08)
  node[4]: anchor+0   → add_notification(张伟, 祝福+送礼, 2026-09)
  node[5]: anchor+1m  → add_notification(张伟, 新生儿保障, 2026-10)
  node[6]: anchor+6m  → add_notification(张伟, 家庭review, 2027-03)

每个node独立验证、独立执行。一个失败不影响其余。
```

### 核心设计决策

**对话中即刻执行所有数据变更，对话结束后只做一件事——写入timeline。**

原因：timeline应该是一段完整互动的记录，不是逐句碎片。其他变更（标签、待办、关系）都是事实性信息，立刻写入没有副作用，用户修正了就立刻覆盖（幂等）。

### 错误处理策略

```
每个intent/action独立处理，互不阻塞：

  IF intent解析失败     → 跳过该intent，继续下一个
  IF 对焦失败（追问中） → 暂挂，不阻塞其他intent
  IF action验证失败     → 丢弃该action，记录日志
  IF action执行失败     → 回滚该action，不影响已成功的
  IF 依赖的前置失败     → 跳过依赖链下游的intent
  IF 事件链某节点失败   → 跳过该节点，继续展开后续

原则：宁可少做，不可错做。丢弃的action记入异常日志用于优化prompt。
```

---

## 三、第①步：语义理解

### 职责

将用户的一句自然语言拆解为N个结构化意图。一句话可能同时包含多个意图。

### 示例

用户说："我刚和李梅喝了下午茶，她朋友Sarah在Google想买保险，帮我给张伟写条教育基金跟进"

拆解为4个意图：

```
意图1: type=RECORD,   client=李梅, content=下午茶·面谈
意图2: type=RECORD,   client=李梅, content=朋友Sarah·Google·保险需求
意图3: type=COMMAND,  action=create_profile, data={name:Sarah, source:李梅}
意图4: type=GENERATE, client=张伟, content=教育基金跟进话术
```

### 意图分类

```
QUERY     — 查询信息（"张伟最近怎样" "谁要跟进"）
KNOWLEDGE — 行业知识问答（"终身寿险怎么运作" "MAS新政策"）
GENERATE  — 生成内容（"帮我写条消息" "生成贺卡"）
RECOMMEND — 要建议（"送什么好" "怎么跟进"）
RECORD    — 记录信息（"他说太太怀孕了" "他喜欢跑步"）
COMMAND   — 操作指令（"标记完成" "删掉那条待办" "提醒我下周二"）
CHAT      — 闲聊/不明确
```

### 客户识别规则

```
优先级从高到低：
1. 消息中明确提到名字 → 锁定该客户
2. 当前在客户详情页对话 → 自动锁定该客户
3. 上文已提及某客户且本条未切换 → 延续上文
4. 无法识别 → 追问"你说的是哪位客户？"
```

---

## 四、第②步：路由分发

### 规则

每个意图判定两个维度：**需要回复用户吗？需要改数据吗？**

```
QUERY     → 需要回复 ✓   需要改数据 ✗ → 立刻反馈
KNOWLEDGE → 需要回复 ✓   需要改数据 ✗ → 立刻反馈
GENERATE  → 需要回复 ✓   需要改数据 ✗ → 立刻反馈
RECOMMEND → 需要回复 ✓   需要改数据 ✗ → 立刻反馈
RECORD    → 需要回复 ✓   需要改数据 ✓ → 立刻确认 + 记入清单
COMMAND   → 需要回复 ✓   需要改数据 ✓ → 立刻确认 + 记入清单
CHAT      → 需要回复 ✓   需要改数据 ✗ → 立刻反馈
```

一句话包含多个意图时，每个意图独立路由，分别处理。

---

## 五、第③步：即时反馈（非操作行为）

对话进行中，所有需要回复用户的意图立刻处理并回复。

### 查询类回复

```
输入：查询类型 + 客户数据 / 知识库
输出：自然语言回复

子类型：
  单客户状态 — "张伟最近怎样" → 健康度 + 最近互动 + 待办
  客户列表   — "谁要跟进" → 按紧急度排序的列表
  客户详情   — "他太太叫什么" → 精确字段检索
  行业知识   — "ILP怎么运作" → 知识库检索，必要时web search
  用户统计   — "我这个月联系了几个人" → 聚合统计
  对话历史   — "上次聊张伟说了什么" → 检索日志

回复规则：先给结论，再给细节。数字具体。不超过5行。
```

### 生成类回复

```
话术生成 — 参考客户性格、标签、最近互动、语气设定
贺卡生成 — 融入客户爱好和近况，附视觉卡片
礼物推荐 — 3个选项（安全/惊喜/实用），带品名价格链接
跟进策略 — 关系诊断 + 分步建议 + 风险提示
会面准备 — 关系现状 + 上次要点 + 建议话题 + 避免话题
方案说明 — 结合客户性格的产品解释
```

---

## 六、第④步：即刻执行

对话进行中，所有识别到的数据变更立刻执行，不等对话结束。

### 即刻执行的action type

```
add_profile          新建客户档案
update_profile       更新基础信息（电话/邮箱/职位/公司）
add_trait            添加特征标签
remove_trait         移除特征标签
add_todo             创建待办
complete_todo        标记待办完成
update_todo          修改待办（内容/日期）
delete_todo          删除待办
add_relation         添加关系人（家人/朋友/同事）
add_notification     设置提醒通知
trigger_event_chain  触发生命事件链模板
```

### 用户修正怎么办

用户说"预产期8月"，下一句说"不对是9月"。程序直接再执行一次update，覆盖之前写入的值。这些操作都是幂等的——最终状态正确就行。

---

## 七、第⑤⑥步：对话结束与Timeline写入

### 触发条件

```
voice页面 → 用户点"new"
客户详情毛玻璃层 → 用户点"done"
超过5分钟无活动 → 自动结束
```

### 对话结束时只做两件事

**1. AI总结整段对话，为每个涉及的客户写入一条timeline记录**

不是每句话一条碎片，而是一条完整的互动摘要。包含事实记录（做了什么）和AI注解（意味着什么）。

**2. 归档对话到日志**

生成一句话摘要（≤60字），连同完整对话记录存入对话日志，可在log页面查看。

---

## 八、第⑧步：标准化指令清单

### 设计原则

AI输出必须是程序能读的结构化JSON。每个action有明确的type（来自白名单）和execute布尔值。程序不做任何语义判断，只负责执行。

### Action Type 完整清单

```
add_timeline          写入互动记录
add_trait             添加特征标签
remove_trait          移除特征标签
add_todo              创建待办
complete_todo         标记待办完成
update_todo           修改待办（内容/日期）
delete_todo           删除待办
update_profile        更新基础信息（电话/邮箱/职位/公司）
add_relation          添加关系人（家人/朋友/同事）
create_profile        创建新客户
add_notification      设置提醒通知
update_health         调整健康度
trigger_event_chain   触发生命事件链模板
archive_conversation  归档对话
```

共14个action type。

### 输出格式

```json
{
  "summary": "讨论了张伟太太怀孕和教育基金跟进",
  "clients_involved": ["张伟"],
  "actions": [
    {
      "type": "add_timeline",
      "client": "张伟",
      "execute": true,
      "data": {
        "date": "2026-03-22",
        "channel": "AI对话",
        "content": "讨论太太怀孕保障和教育基金跟进",
        "ai_note": "新的加保机会"
      }
    },
    {
      "type": "add_trait",
      "client": "张伟",
      "execute": true,
      "data": {
        "text": "太太怀孕·预产期9月",
        "icon": "👶",
        "source": "ai"
      }
    },
    {
      "type": "trigger_event_chain",
      "client": "张伟",
      "execute": true,
      "data": {
        "template": "pregnancy",
        "anchor_date": "2026-09-01"
      }
    },
    {
      "type": "create_profile",
      "execute": false,
      "reason": "对话中未提及新客户"
    }
  ]
}
```

每个action必须有execute字段。execute为false时必须有reason字段。

### Prompt约束

在system prompt中严格定义合法的type和每个type的必须字段：

```
actions数组中每一项，type字段只能是以下14个值之一：

type                  data必须包含的字段
─────────────────────────────────────────────
add_timeline          client, date, channel, content
add_trait             client, text, icon
remove_trait          client, text
add_todo              client, text, due
complete_todo         client, todo_id
update_todo           client, todo_id, fields
delete_todo           client, todo_id
update_profile        client, fields
add_relation          client, name, relation
create_profile        name, company, source
add_notification      client, text, trigger_date
update_health         client, delta, reason
trigger_event_chain   client, template, anchor_date
archive_conversation  summary, clients

不允许使用上表以外的type值。
不允许省略必须字段。
```

### Function Calling强化

使用支持function calling的模型时，将14个action type定义为14个function，在API层面强制约束参数类型和必填项，AI无法发明新的action type。

---

## 九、第⑨步：程序验证与执行

### 三层防护

```
第一层：类型白名单校验
  type不在14个合法值中 → 丢弃，记录异常日志

第二层：字段完整性校验
  缺少必须字段 → 丢弃，记录异常日志

第三层：值域校验
  client必须匹配已有客户ID（create_profile除外）
  date/due/trigger_date必须是合法日期
  template必须在事件链模板清单中
  delta必须是数字
  execute必须是布尔值
  不合法 → 丢弃该条action
```

### 容错机制

每条action独立验证、独立执行。一条失败不影响其余：

```
AI返回5条action：
  action 1: add_timeline   ✓ 通过 → 执行
  action 2: add_triat      ✗ type拼错 → 丢弃
  action 3: add_todo       ✓ 通过 → 执行
  action 4: add_todo       ✗ 缺少due字段 → 丢弃
  action 5: update_health  ✓ 通过 → 执行

结果：3条成功，2条丢弃。用户无感知。后台日志记录异常用于优化prompt。
```

---

## 十、第⑩步：数据写入与闭环

### 执行顺序

```
1. 批量写入数据库（timeline, traits, todos, profiles, relations, contacts, notifications）
2. 健康度重算（一次，基于最新数据）
3. 通知调度（检查是否有新的notification需要注册）
4. UI刷新（客户卡片立即反映变更）
```

### UI闭环

在客户详情页的毛玻璃对话层点"done"时：
- 对话归档
- 数据写入
- 浮层关闭
- 用户立刻看到卡片上的变化：新标签出现了，新待办出现了，时间线更新了

这是一个完整的闭环：用户说话 → AI理解 → 数据更新 → 用户看到结果。

---

## 十一、生命事件链

### 问题

某些信息不只是一条标签，而是会触发一系列有时间依赖关系的动作。比如"太太怀孕·预产期9月"意味着未来12个月内有7个节点需要关注。

### 事件链模板

系统预置一套模板，每个模板定义时间节点和对应动作：

```
pregnancy（怀孕）
  锚点：预产期
  节点：
    now        恭喜 + review当前保障
    -6months   review保单·加保方案
    -3months   跟进加保进展
    -1month    准备新生儿礼物
    0          祝福 + 送礼
    +1month    新生儿保障方案
    +6months   家庭保障review

marriage（结婚）
  锚点：婚礼日期
  节点：
    now        恭喜
    -3months   联合保障方案
    -1week     送礼
    0          祝福
    +1month    蜜月回来跟进
    +6months   买房/生育计划review

new_home（买房）
  锚点：入住日期
  节点：
    now        恭喜
    签约后     房贷保障方案
    -1week     乔迁礼物
    +1month    跟进房贷险
    +6months   家庭保障review

job_change（换工作）
  锚点：入职日期
  节点：
    now        恭喜/关心
    +1month    review保障（失去团险？需要个人保障？）
    +3months   稳定性跟进

retirement（退休）
  锚点：退休日期
  节点：
    -1year     退休理财方案
    -3months   最终方案确认
    0          祝福
    +1month    遗产规划

health_event（健康事件）
  锚点：得知日期
  节点：
    now        关心慰问（不提商业）
    +1week     慰问跟进
    +1month    了解恢复
    +3months   review健康险

bereavement（丧亲）
  锚点：得知日期
  节点：
    now        慰问（极敏感，零商业）
    +1month    轻度关心
    +3months   视关系深度决定

policy_renewal（保单续期）
  锚点：到期日
  节点：
    -3months   提前通知review
    -1month    确认续期意向
    -1week     最终确认

birthday（生日，年度循环）
  锚点：生日日期
  节点：
    -14days    准备礼物
    -1day      准备祝福
    0          发送祝福 + 送礼

anniversary（纪念日，年度循环）
  锚点：纪念日日期
  节点：
    -7days     准备
    0          祝福
```

共约15个模板。

### 动态适应

事件链是活的，随新信息自动调整：

```
3月：用户说"张伟太太怀孕，预产期9月"
  → 生成完整链条7个节点

6月：被动触发"review保单"，用户处理了，加保成功
  → 标记此节点完成
  → 后续"跟进加保"自动调整为"确认保单生效"

8月：用户说"张伟太太提前生了，男孩叫小明"
  → 检测到"已出生"
  → 取消未到达的产前节点
  → 立即触发"恭喜+送礼"
  → 更新标签（儿子小明）
  → 重算后续节点时间（基于实际出生日期）
```

---

## 十二、知识库架构

### 三层知识

```
第一层：行业知识库（全局共享）
  保险产品知识（险种、条款、对比）
  市场动态（利率、政策、新闻）
  新加坡金融法规
  销售方法论和话术最佳实践
  竞品信息

第二层：客户知识库（每个客户一个独立实例）
  身份信息
  特征标签
  互动时间线
  待办和承诺
  持有产品/保单
  家庭关系图谱
  偏好和禁忌
  所有对话摘要

第三层：用户知识库（个人）
  业绩数据
  客户组合分析
  行为习惯
  对话日志
  上传的文档
```

### 客户知识库实例数据结构

```
ClientKnowledgeBase {
  identity    { name, company, role, phone, email, socials }
  personality   string
  traits        [{ text, icon, source, created_at }]
  birthday      date
  important_dates [{ date, label }]
  family        [{ name, relation, notes }]
  referrals_from  client_id
  referrals_to    [client_id]
  related_contacts [{ name, relation, company }]
  products      [{ name, type, premium, start_date, renewal_date }]
  potential_needs [string]
  timeline      [{ date, channel, content, ai_annotation }]
  conversation_summaries [{ date, summary, action_items }]
  todos         [{ text, due, source, status, created_at }]
  documents     [{ name, type, uploaded_at }]
  health_score    number
  health_reason   string
  last_contact    date
  source        { type, detail }
  event_chains  [{ template, anchor_date, nodes_status }]
}
```

### 跨层查询

用户的问题可能跨越多个知识层：

```
"张伟适合什么保险产品"
  → 客户层：张伟的画像、需求、已有产品
  → 行业层：产品知识、适合他情况的选项
  → 合并回答

"我的高净值客户里谁可能对家族信托感兴趣"
  → 用户层：筛选高净值标签客户
  → 客户层：逐个检查特征和需求
  → 行业层：家族信托产品知识
  → 合并回答
```

---

## 十三、被动触发系统

独立于用户对话，定时运行。

### 每次打开app

```
扫描所有客户数据
按优先级找出最需关注的一件事：
  1. 已过期待办（越久越紧急）
  2. 健康度持续下降的客户
  3. 7天内重要日期
  4. 未处理的转介绍机会
  5. 即将到期的待办
生成一句建议文案 → 展示在voice页面中央
```

### 每天凌晨

```
健康度重算（遍历所有客户）
  评估维度：
    互动频率（30天内次数 + 最近一次距今天数）
    互动深度（面谈>电话>微信，加权）
    待办完成率
    关系趋势（近30天变化方向）
    生命周期事件（即将生日/纪念日加分）
    商业价值（保费/转介绍活跃度）
  输出：新分数 + 变化值 + 一句话原因
  如果跌破阈值 → 生成通知

到期检查
  今天到期的待办 → 推送通知
  明天到期 → 推送通知
  事件链的下一个节点到了 → 推送通知

重要日期
  7天后有生日/纪念日 → 推送"开始准备"
  1天后 → 推送"明天是XX的生日"
  当天 → 推送祝福提醒
```

### 每周日晚

```
周报生成
  汇总过去7天：
    互动统计（总次数，按渠道分）
    健康度变化（谁升了谁降了）
    完成的事项
    下周重点（AI建议的优先事项）
  存入对话日志
  推送通知"AI周报已生成"
```

---

## 十四、端到端完整案例

### 案例：一句复杂输入的完整处理

用户说："我刚和李梅喝了下午茶，她说有个朋友叫Sarah在Google工作，想买保险，对了帮我给张伟写条教育基金跟进消息"

**① 语义理解**

```
意图1: RECORD   client=李梅  content=下午茶面谈
意图2: RECORD   client=李梅  content=朋友Sarah·Google·保险需求
意图3: COMMAND  action=create_profile  data={Sarah, Google, 李梅介绍}
意图4: GENERATE client=张伟  content=教育基金跟进话术
```

**② 路由**

```
意图1: 需要改数据 → 记入清单
意图2: 需要改数据 → 记入清单
意图3: 需要改数据 → 记入清单
意图4: 需要回复   → 立刻生成
```

**③ 即时反馈**

AI立刻回复（话术生成）：

"已记录。张伟的跟进消息：
「Hi David，教育基金方案我帮你做了对比分析，涵盖收益率、灵活度和税务优化。方便的话这周聊聊？」
要调整吗？"

**④ 待执行清单（此时的状态）**

```
[add_timeline: 李梅, 下午茶面谈]
[add_relation: 李梅→Sarah, Google]
[create_profile: Sarah, Google, 李梅介绍]
[add_todo: 联系Sarah, 3天内]
```

**用户继续说：** "好的发了，语气再轻松一点"

AI重新生成轻松版话术。

**用户说：** "就这个，发了"

隐性动作检测 → 用户确认发送了消息给张伟。

清单更新：

```
[add_timeline: 李梅, 下午茶面谈]
[add_relation: 李梅→Sarah, Google]
[create_profile: Sarah, Google, 李梅介绍]
[add_todo: 联系Sarah, 3天内]
[add_timeline: 张伟, 发送了教育基金跟进消息]  ← 新增（隐性）
[complete_todo: 张伟, 发送教育基金方案]        ← 新增（隐性）
```

**⑤ 对话结束**（用户点"new"）

**⑥ 总结器回顾**

```
摘要："李梅下午茶·新转介绍Sarah·张伟教育基金消息已发"
涉及客户：[李梅, 张伟, Sarah(新)]
```

**⑦ 提取最终变更**

无生命事件。最终清单确认。

**⑧ 输出标准化JSON**

```json
{
  "summary": "李梅下午茶·新转介绍Sarah·张伟教育基金消息已发",
  "clients_involved": ["李梅", "张伟"],
  "actions": [
    { "type": "add_timeline", "client": "李梅", "execute": true,
      "data": { "date": "2026-03-22", "channel": "面谈", "content": "下午茶，提到朋友Sarah(Google)想买保险" }},
    { "type": "add_relation", "client": "李梅", "execute": true,
      "data": { "name": "Sarah", "relation": "朋友·Google" }},
    { "type": "create_profile", "execute": true,
      "data": { "name": "Sarah", "company": "Google", "source": "李梅介绍" }},
    { "type": "add_todo", "client": "Sarah", "execute": true,
      "data": { "text": "联系Sarah了解保险需求", "due": "2026-03-25" }},
    { "type": "add_timeline", "client": "张伟", "execute": true,
      "data": { "date": "2026-03-22", "channel": "微信", "content": "发送了教育基金跟进消息" }},
    { "type": "complete_todo", "client": "张伟", "execute": true,
      "data": { "todo_id": "发送教育基金方案" }},
    { "type": "update_health", "client": "李梅", "execute": true,
      "data": { "delta": "+3", "reason": "活跃互动+新转介绍" }},
    { "type": "update_health", "client": "张伟", "execute": true,
      "data": { "delta": "+2", "reason": "完成跟进" }},
    { "type": "archive_conversation", "execute": true,
      "data": { "summary": "李梅下午茶·新转介绍Sarah·张伟消息已发", "clients": ["李梅","张伟"] }}
  ]
}
```

**⑨ 程序验证**

9条action全部通过白名单 + 字段 + 值域校验。

**⑩ 批量执行**

```
db写入 → 李梅timeline, 李梅relation, Sarah新卡片, Sarah todo, 张伟timeline, 张伟todo完成
健康度重算 → 李梅+3, 张伟+2
通知调度 → 3天后提醒联系Sarah
UI刷新 → 李梅卡片出现新时间线, 张伟待办标记完成, Sarah卡片出现在列表中
```

闭环完成。

---

## 十五、系统全景图

```
┌──────────────────────────────────────────────────────────┐
│                      用户界面                             │
│  Voice页面（语音对话）    Cards页面（客户列表+详情）          │
│  对话日志（log）         设置（settings）                   │
└──────────────────┬───────────────────────────────────────┘
                   ↓ 用户输入
┌──────────────────┴───────────────────────────────────────┐
│                   ① 语义理解层                            │
│              一句话 → 拆解为 intents[] 数组                │
└──────────────────┬───────────────────────────────────────┘
                   ↓
┌──────────────────┴───────────────────────────────────────┐
│            LOOP: for each intent in intents[]            │
│  ┌────────────────────────────────────────────────────┐  │
│  │  IF 依赖前置intent → 等待产出                       │  │
│  │  ELSE → 继续                                       │  │
│  ├────────────────────────────────────────────────────┤  │
│  │  ② 对焦                                            │  │
│  │  IF 提到新客户 → 加载KB                             │  │
│  │  ELIF 延续上文 → 保持焦点                           │  │
│  │  ELIF 无法识别 → 追问，暂挂                         │  │
│  ├────────────────────────────────────────────────────┤  │
│  │  ③ 路由                                            │  │
│  │  IF 只需回复 → 即时反馈                             │  │
│  │  IF 需改数据 → 即时执行                             │  │
│  ├────────────────────────────────────────────────────┤  │
│  │  ④ 大模型处理 → 回复 + actions                      │  │
│  │  IF action == event_chain                           │  │
│  │    → LOOP 展开模板 → N个 todo/notification          │  │
│  │  即刻执行变更                                       │  │
│  └────────────────────────────────────────────────────┘  │
│  回复用户                                                │
└──────────────────┬───────────────────────────────────────┘
                   ↓ 等待下一句（IF 用户修正 → 覆盖执行）
                   ↓ 对话结束
┌──────────────────┴───────────────────────────────────────┐
│  LOOP: for each client in involved_clients[]             │
│    ⑧ AI总结 → 写入该客户 timeline                         │
│  归档对话到日志                                           │
└──────────────────┬───────────────────────────────────────┘
                   ↓
┌──────────────────┴───────────────────────────────────────┐
│   ⑨ 批量执行 + UI刷新                                    │
│   数据写入 → 健康度重算 → 通知调度 → UI刷新               │
└──────────────────────────────────────────────────────────┘

                    独立运行
┌──────────────────────────────────────────────────────────┐
│                  被动触发系统                              │
│  打开app → 生成此刻建议                                    │
│  每天凌晨 → 健康度重算 + 到期检查 + 通知                    │
│  每周日  → 周报生成                                       │
└──────────────────────────────────────────────────────────┘

                    数据层
┌──────────────────────────────────────────────────────────┐
│                    知识库                                 │
│  行业知识库（全局）   客户KB（每人一个实例）   用户KB（个人）  │
└──────────────────────────────────────────────────────────┘
```

---

---

## 附录：AI Prompt 设计

### 执行模型：即刻执行 + 对话结束写timeline

所有数据变更在对话中即刻执行，不等对话结束。用户修正了就即刻再改（覆盖）。唯一的例外是timeline——对话结束时AI总结整段对话，一条记录写入涉及客户的时间线。

```
即刻执行（对话中每句话，识别到即执行）：
  add_profile          新建客户档案
  update_profile       更新基础信息
  add_trait            添加特征标签
  remove_trait         移除特征标签
  add_todo             创建待办
  complete_todo        标记完成
  update_todo          修改待办
  delete_todo          删除待办
  add_relation         添加关系人
  add_notification     设置提醒
  trigger_event_chain  触发生命事件链

对话结束时执行（只有这一个）：
  add_timeline         AI总结整段对话，写入涉及客户的时间线
```

原因：timeline应该是一段完整互动的记录。"和张伟聊了太太怀孕、教育基金、约了下周面谈"比三条碎片记录有价值得多。

### 对焦模型

用户和AI对话时，AI默认是广角模式（只有对话上下文）。当用户提到一个客户名，程序从数据库加载该客户的KB——像给镜头装上透镜，AI立刻能看到这个人的所有信息。提到第二个客户，叠加第二片透镜。用"他""她"时保持上一次的焦点。

```
用户说一句话
  ↓
带上：对话历史 + 当前焦点客户的KB（如有）
  ↓
大模型返回：回复 + 焦点变化 + 即刻变更
  ↓
程序处理：
  焦点变化 → 加载新客户KB → 下轮附带
  即刻变更 → 直接写DB → 刷新KB
  回复 → 展示给用户
  ↓
下一句带着更新后的KB继续
  ↓
对话结束 → AI总结 → 写入timeline
```

### Token节省策略

```
策略1: 客户KB按需加载（对焦后才注入）
策略2: KB分级 — Level 0 ~20t/人, Level 1 ~80t/人, Level 2 ~200t/人
策略3: 对话历史滑动窗口，最近5轮，超出压缩为摘要
```

---

### Prompt体系：1 + 1 + 3

```
对话中：     主Prompt       每句话调用
对话结束：   Prompt T       调用一次，写timeline
被动触发：   Prompt C/D/E   事件链/每日建议/健康度
```

---

### 主Prompt：对话引擎

调用时机：对话中每一句。完成理解+对焦+回复+即刻变更输出。

```
SYSTEM:

你是RelateAI，用户的关系管理助理。
用户：{user.role}，{user.company}。语气：{user.tone}。
{user.custom_prompt}
语言：跟随用户当前使用的语言。

# 职责

每收到一条消息，输出JSON：

{
  "reply": "给用户的回复",
  "focus_change": ["新提到的客户名"] 或 [],
  "actions": [即刻执行的变更] 或 []
}

# reply规则

- 先结论后细节，不超过5行
- 数字具体（"3天前"不是"最近"）
- 生成话术时根据客户性格调整
- 推荐礼物给3个选项（品名+价格+理由）
- 需要最新信息时标记[需要搜索]
- 用户确认（"好的发了"）→ 推断隐含action
- 用户修正（"不对是9月"）→ 输出修正的action
- 有action时reply开头简要确认

# focus_change规则

- 提到新客户名 → 输出名字
- "他""她"能推断 → 不输出（保持焦点）
- 无法判断 → reply中追问

# actions规则

合法type（只能用这些）：
  add_profile(name,company,role,source)
  update_profile(client,fields)
  add_trait(client,text,icon)
  remove_trait(client,text)
  add_todo(client,text,due)
  complete_todo(client,todo_id)
  update_todo(client,todo_id,fields)
  delete_todo(client,todo_id)
  add_relation(client,name,relation)
  add_notification(client,text,trigger_date)
  trigger_event_chain(client,template,anchor_date)

生命事件→template：
  怀孕→pregnancy 结婚→marriage 买房→new_home
  换工作→job_change 退休→retirement
  生病→health_event 丧亲→bereavement
  保单到期→policy_renewal

无变更时输出空数组。

# 客户数据
{client_context_block}

---
MESSAGES:
{conversation_history_last_5_turns}
user: {current_message}
```

**client_context_block由程序动态注入：**

```
无焦点：
  当前无锁定客户。

单焦点：
  [焦点：张伟]
  张伟 / David Zhang
  Prudential · Senior Manager · hp:92
  03.15 · 理性务实
  ⛳高尔夫 🍷红酒 👶太太怀孕·预产期9月
  待办：教育基金方案(过期2天) / 约面谈(3天后)
  最近：03.20微信教育基金 / 03.15面谈投资组合
  来源：cold call 2023 · 转介绍了李梅
  WeChat✓ WhatsApp✓

多焦点：
  [焦点：张伟, 李梅]
  --- 张伟 --- (同上)
  --- 李梅 --- (同上)

全员查询（"谁要跟进"）：
  [全员概览]
  张伟 Prudential hp:92 最近:2天前 待办:3(1过期)
  李梅 DBS hp:88 最近:今天 待办:2
  ...
```

Token预算：~900-1100 token/次

---

### Prompt T：Timeline总结器

调用时机：对话结束时一次。

```
SYSTEM:

输入：完整对话记录。输出：JSON。

为每个涉及的客户生成一条timeline记录。

{
  "entries": [
    {
      "client": "张伟",
      "date": "2026-03-22",
      "channel": "AI对话",
      "content": "讨论太太怀孕保障、教育基金跟进、约了下周面谈",
      "ai_note": "新的加保机会"
    }
  ],
  "conversation_summary": "≤60字归档摘要"
}

规则：
- 每个客户一条，不管聊了几次
- content是事实（做了什么），ai_note是判断（意味着什么）

---
CONVERSATION: {full_transcript}
CLIENTS INVOLVED: {names}
TODAY: {date}
```

Token预算：~1020 token，调用1次

---

### Prompt C：事件链展开器

调用时机：主Prompt输出trigger_event_chain时。

```
SYSTEM:

输入：模板名+锚点日期+客户名。输出：actions数组。

模板：
  pregnancy: now→review保障, -6m→加保, -3m→跟进, -1m→礼物, 0→祝福, +1m→新生儿保障, +6m→review
  marriage: now→恭喜, -3m→联合保障, -1w→送礼, 0→祝福, +1m→跟进, +6m→review
  new_home: now→恭喜, 签约→房贷保障, -1w→乔迁礼, +1m→跟进, +6m→review
  job_change: now→恭喜, +1m→review, +3m→跟进
  retirement: -1y→方案, -3m→确认, 0→祝福, +1m→遗产
  health_event: now→关心(零商业), +1w→慰问, +1m→恢复, +3m→review
  bereavement: now→慰问(零商业), +1m→关心, +3m→视情况
  policy_renewal: -3m→review, -1m→确认, -1w→最终
  birthday(循环): -14d→礼物, -1d→提醒, 0→祝福
  anniversary(循环): -7d→准备, 0→祝福

计算具体日期，输出add_todo + add_notification数组。

---
TEMPLATE: {name}, ANCHOR: {date}, CLIENT: {name}, TODAY: {date}
```

Token预算：~430 token，极少调用

---

### Prompt D：每日建议器

调用时机：打开app / 每天一次。

```
SYSTEM:

输入：全员摘要。输出：JSON。

优先级：过期待办 > 健康度<30 > 7天内日期 > 未处理转介绍 > 3天内待办 > 无事

{"suggestion":"≤30字","client":"名","action_hint":"开场白","priority":"urgent|important|normal|calm"}

周报模式追加输出：
{"period":"","interactions":{},"health_changes":[],"completed":[],"next_week":[]}

---
CLIENTS (Level 0): {all}, TODAY: {date}
```

Token预算：~1150 token

---

### Prompt E：健康度计算器

调用时机：每天凌晨。

```
SYSTEM:

评分（每项0-20，满分100）：
  互动频率: 7天=20, 14天=15, 21天=10, 30天=5, >30=0
  互动深度: 面谈=20, 电话=15, 微信=10, 无=0
  待办完成率: 全完成=20, 1项过期=10, 多项=0
  关系趋势: 上升=20, 持平=10, 下降=0
  综合价值: 转介绍+5, 保单+5, 事件+5, VIP+5

输出：{"results":[{"client":"","score":N,"delta":N,"reason":""}]}

---
CLIENTS (Level 1): {data}, TODAY: {date}
```

Token预算：~150-4150 token

---

### 完整调用流程

```
打开app → Prompt D → 建议展示

每句话 → 主Prompt → {reply, focus_change, actions}
  → focus_change → 加载KB
  → actions → 即刻执行 → 刷新UI
  → reply → 展示

点new/done → Prompt T → timeline写入
  → if trigger_event_chain → Prompt C → 展开执行

每天凌晨 → Prompt E → 健康度 → Prompt D → 缓存建议
每周日 → Prompt D周报变体
```

### 日均Token估算

```
50个客户，3轮对话/天，6句/轮

主Prompt:  3×6×1000  = 18,000
Prompt T:  3×1020    =  3,060
Prompt C:  0~1×430   =    430
Prompt D:  1×1150    =  1,150
Prompt E:  1×4150    =  4,150

日均 ~31,500 token → ~$0.15/用户/天 → ~$4.5/用户/月
Pro订阅$29，AI占比15.5%
```

---

*文档完整结束。对话中即刻执行所有变更，对话结束只写timeline。1+1+3个prompt覆盖全部场景。*
