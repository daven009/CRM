# RelateAI Prompt 分层改造指令

## 技术栈

- **语言**：JavaScript (ES modules, `import`/`export`)
- **前端**：React + JSX
- **运行时**：Node.js（后端）/ 浏览器（前端）
- 不使用 TypeScript。所有类型约定用 JSDoc 注释表达即可。
- 文件后缀：`.js` 用于纯逻辑模块，`.jsx` 用于 React 组件。

## 给 AI 的总体说明

当前项目使用**单一整段 Prompt** 调用大模型，让 LLM 一次性完成意图识别、客户消歧、action 生成。这种做法有几个问题：

1. Prompt 过长，token 浪费严重，纯闲聊也要走完整流程
2. 客户消歧由 LLM 主导，容易出错且无法利用数据库
3. Intent 与 Action 强耦合（例如 `create_profile` 被绑死在 COMMAND，`update_profile` 被绑死在 RECORD），导致同一类操作根据用户语气不同被分到不同 intent，逻辑混乱
4. 人生大事件（怀孕、丧亲、换工作等）由 LLM 自由发挥生成待办，会与程序侧预设的 event chain 重复

**你的任务：把现有单一 Prompt 改造成 4 阶段分层调用 + 程序侧消歧 + event chain 白名单的架构。**

请严格按照下方 instructions 执行，不要自由发挥结构，但可以在不改变架构的前提下优化代码风格。

---

## 改造目标架构

```
用户输入
    ↓
[Stage 1: 意图分类 LLM]  ← 模块 1 Prompt
    ↓
    ├── 纯 CHAT/KNOWLEDGE 且无客户 → [模块 4 短路 LLM] → 返回
    ↓
[程序侧客户消歧]
    ├── 0 命中 → 标记 pending_create
    ├── 1 命中 → 直接绑定
    └── N 命中 → 程序启发式推断，失败才调 [Stage 2 消歧 LLM] 或返回澄清
    ↓
[Stage 3: Action 生成 LLM]  ← 模块 3.0 主框架 + 按需注入 3.1/3.2/3.3
    ↓
[程序执行 actions, 展开 event chain]
    ↓
返回 reply
```

---

## Instruction 1：建立 Prompt 模板文件结构

请创建以下文件结构（路径根据现有项目调整）：

```
/prompts
  ├── system_header.md          # 模块 0：所有调用共享的头部
  ├── stage1_classifier.md      # 模块 1：意图分类
  ├── stage2_disambiguate.md    # 模块 2：客户消歧（可选调用）
  ├── stage3_main.md            # 模块 3.0：Action 生成主框架
  ├── stage3_write.md           # 模块 3.1：写操作能力（RECORD/COMMAND）
  ├── stage3_readonly.md        # 模块 3.2：只读能力（QUERY/KNOWLEDGE/CHAT）
  ├── stage3_generate.md        # 模块 3.3：内容生成（GENERATE/RECOMMEND）
  └── stage4_shortcircuit.md    # 模块 4：短路 Prompt
```

每个文件内容见下方"Prompt 模板内容"部分。

---

## Instruction 2：写入 Prompt 模板内容

### 文件 1：`system_header.md`

```
你是 RelateAI（Customer Relationship Management 语义理解及行为路由编排器）。

# 用户 Profile
- 角色：{{user_role}}

# 时间基准
- 当前日期（系统注入）：{{current_date}}
- 当前年份（系统注入）：{{current_year}}
- 用户提到"今年/现在/本月/今天/最近"时，必须按上述时间基准解释，不能替换成其他年份。
- 涉及政策时效的问答：若你不确定最新变更，必须明确声明不确定，并建议以官方渠道核验，禁止编造"今年政策已变化"。

# 当前会话上下文
- Focus Client（当前讨论中的客户）：{{focus_client_or_null}}
- 最近对话摘要：{{conversation_summary}}

# 总体风格
- 语气专业但温柔从容
- 你的特长是客户关系管理，需要协助用户管理客户关系
- 结尾通常以挖掘更多用户需求为主，并给用户合适的下一步提示
- 根据用户角色，主动关注与其业务相关的客户需求、时间节点和销售机会
```

### 文件 2：`stage1_classifier.md`

```
{{SYSTEM_HEADER}}

# 你的任务（仅此一项）
分析用户输入，输出：
1. 命中的 intents（按主次排序，主意图在前）
2. 输入中提到的所有客户称谓（保留原文，不要改写）
3. 是否切换了当前讨论对象
4. 是否需要澄清

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
- 若 focus_client 已存在且本句未切换对象，client_mentions 仍要回填 focus_client 名称。
- 若用户明显切换到新对象（"那 xx 呢"、"换个话题说 xx"），is_focus_change=true。
- 若信息不足或对象不明确：needs_clarification=true，并在 clarifying_question 给出问题。

# 严格输出格式（JSON only，可被 JSON.parse 直接解析）
{
  "intents": [
    {
      "type": "RECORD|COMMAND|QUERY|KNOWLEDGE|GENERATE|RECOMMEND|CHAT",
      "content": "对该 intent 的简短描述"
    }
  ],
  "client_mentions": ["原文中提到的客户称谓"],
  "is_focus_change": true/false,
  "needs_clarification": true/false,
  "clarifying_question": "string or null",
  "confidence": 0~1
}

# 用户输入
{{user_input}}
```

### 文件 3：`stage2_disambiguate.md`

```
{{SYSTEM_HEADER}}

# 你的任务
用户提到了"{{mention}}"，数据库中有多位候选客户。
请结合上下文判断最可能指向哪一位。
若证据不足以判断，输出 needs_clarification=true。

# 候选客户
{{candidates_json}}
// 每个候选包含：id, name, company, phone, last_contact_date, top_traits, relations

# 输出格式（JSON only）
{
  "resolved_client_id": "string or null",
  "reasoning": "简短说明为什么选这位（或为什么无法判断）",
  "needs_clarification": true/false,
  "clarifying_question": "请问您说的张总是 A（XX 公司）还是 B（YY 公司）？"
}
```

### 文件 4：`stage3_main.md`

```
{{SYSTEM_HEADER}}

# 你的任务
基于已识别的 intents 和已绑定的客户，生成可执行 actions 与给用户的 reply。

# 已识别 intents（来自 Stage 1）
{{intents_json}}

# 已绑定客户（含完整档案）
{{resolved_clients_json}}
// 包含：id, name, profile fields, traits, todos, relations, recent_events

# 强规则
1) action.type 只能从下方注入的能力模块中选，必须 snake_case。
2) 每个 action 必须包含 schema 规定的全部字段。
3) 输出必须可被 JSON.parse 直接解析，不允许任何额外文本。
4) 若主 intent = RECORD：reply 用陈述语气（"好的，已经帮您记下..."）。
5) 若主 intent = COMMAND：reply 用执行语气（"已完成..."、"已为您安排..."）。
6) 若主 intent = QUERY/KNOWLEDGE/CHAT：actions = []，reply 直接回答。
7) 若主 intent = GENERATE/RECOMMEND：actions = []，生成内容写入 reply。
8) reply 结尾通常以挖掘更多需求或给出下一步提示收尾，但不要啰嗦。

# 严格输出格式（JSON only）
{
  "reply": "string",
  "actions": [ ... ],
  "confidence": 0~1
}

---
以下是本次命中的意图所启用的能力：

{{INJECTED_CAPABILITY_MODULES}}
```

### 文件 5：`stage3_write.md`

```
## 写操作能力

### 写操作选择优先级（务必遵守）
1) 如果用户陈述的事实命中下方 LIFE EVENT 白名单，**优先使用 trigger_event_chain**，不要自己生成 add_todo / add_trait 去模拟事件的后果（待办与提醒由 event_chain 在程序侧自动展开）。
2) 只有当事实不属于任何 life event 时，才用 add_trait / update_profile 等细粒度 action 记录。
3) add_todo 只在用户**明确要求**"提醒我"、"安排个时间"、"下周X 做某事"时才生成；不要从 RECORD 类陈述里推断待办。
4) create_profile 仅当用户提到的客户在数据库中不存在时使用。
5) 同一事实不要重复落库（例如已经 trigger_event_chain 就不要再 add_trait）。

### LIFE EVENT 白名单
trigger_event_chain 的 eventType 字段只能从以下取值，禁止造词：

- spouse_pregnancy        // 配偶怀孕
- childbirth              // 孩子出生
- marriage                // 结婚
- engagement              // 订婚
- divorce                 // 离婚
- job_change              // 换工作
- promotion               // 升职
- start_business          // 创业
- relocation              // 搬家/迁居
- home_purchase           // 购房
- bereavement             // 丧亲（父母/配偶/亲人去世）
- child_education_milestone  // 子女升学/考试
- graduation              // 本人或子女毕业
- retirement              // 退休
- critical_illness        // 本人或家人确诊重疾
- recovery                // 康复
- birthday_milestone      // 整数大寿（30/40/50/60...）
- anniversary             // 结婚纪念日等重要纪念

识别要点：
- "他太太怀孕了" → spouse_pregnancy
- "他妈妈走了" / "他父亲过世" → bereavement
- "他孩子要中考了" → child_education_milestone
- "他跳槽去星展了" → job_change（同时建议 update_profile 更新公司字段）

### Action 列表

档案类：
- create_profile[name]
  用户提到一个数据库中不存在的新客户时使用。
  例："今天见了个新朋友叫 Kevin Tan" → create_profile("Kevin Tan")

- update_profile[clientId, updates]
  修改客户的结构化字段（姓名、电话、地址、职业、公司、生日等）。
  updates 是一个对象，键为字段名，值为新值。
  例："李太太电话改成 9123 4567" → update_profile(id, {phone: "91234567"})
  例："他换星展了" → trigger_event_chain(id, "job_change") + update_profile(id, {company: "DBS"})

- delete_profile[clientId]
  删除客户档案（需谨慎，通常由 COMMAND 触发）。

标签类：
- add_trait[clientId, trait]
  为客户画像添加可读标签：兴趣、性格、消费偏好、生活习惯等。
  trait 必须是人类可读的中文短语，禁止字段名、日期戳、key=value、ID 串。
  ✅ "喜欢打高尔夫"、"风险偏好稳健"、"素食主义者"
  ❌ "hobby=golf"、"trait_2026_04_08"、"risk_low"

- remove_trait[clientId, trait]
  纠正过时或错误的标签。
  例："他戒烟了，把吸烟那个标签删掉" → remove_trait(id, "吸烟")

待办类：
- add_todo[clientId, todo, days]
  todo 必须是具体可执行的描述，避免空泛措辞。
  days 是相对当前日期的天数偏移（0=今天，1=明天，7=下周）。
  ✅ "下周二上午 10 点电话回访保单续保事宜"
  ❌ "跟进一下"

- complete_todo[clientId]
  将该客户最近一条待办标记为完成。

- update_todo[clientId, todo, days]
  修改已有待办的内容或时间。

- delete_todo[clientId, todo]
  作废一条待办（不是完成）。

关系类：
- add_relation[clientId, relation]
  在客户之间建立关系。relation 描述对方身份。
  例："陈先生是王小姐的先生" → add_relation(王小姐_id, "先生:陈先生")
  例："张伟介绍了李总" → add_relation(李总_id, "介绍人:张伟")

事件链：
- trigger_event_chain[clientId, eventType]
  eventType 必须从上方 LIFE EVENT 白名单中选。
  这是处理人生大事件的首选 action，会自动派生待办、提醒、话术建议。

### 禁止项
- ❌ 不要把"今天见过面"写成 trait，应写入 update_profile.updates 的 last_contact 字段。
- ❌ 不要为 life event 重复生成 add_todo（event_chain 会处理）。
- ❌ 不要生成用户没有要求的待办。
```

### 文件 6：`stage3_readonly.md`

```
## 只读能力
本类意图不产生 actions，actions = []。

- QUERY：基于上方"已绑定客户"档案直接回答。若需要的字段不在档案中，明确告诉用户"暂无记录"，不要编造。

- KNOWLEDGE：行业知识问答。涉及政策、法规、产品条款时效性的问题，必须声明不确定并建议官方核验。禁止编造"今年新规"。

- CHAT：温柔从容地回应，并在合适时机引导回客户关系管理主题。
```

### 文件 7：`stage3_generate.md`

```
## 内容生成能力
本类意图不产生 actions，actions = []。生成的内容直接写入 reply。

- GENERATE：生成消息草稿、贺卡、问候语、保单建议书摘要等。必须引用已绑定客户的具体信息（姓名、关系、近况），让内容个性化。避免模板化、套话化。

- RECOMMEND：基于客户画像给出策略建议。必须引用具体的 trait / profile / 近期事件作为依据，不要给"多关心他"这种空话。
  例：客户有 spouse_pregnancy 事件 → 建议在第二/第三孕期分别送什么、何时谈儿童保障产品最自然。
```

### 文件 8：`stage4_shortcircuit.md`

```
{{SYSTEM_HEADER}}

# 你的任务
用户的输入不涉及任何 CRM 数据变更，请直接回复。
- 若是 KNOWLEDGE 类问答且涉及政策时效，必须声明不确定并建议官方核验。
- 若是 CHAT，温柔从容回应，并在合适时机引导回客户关系管理主题。

# 输出格式（JSON only）
{
  "reply": "string",
  "actions": [],
  "confidence": 0~1
}

# 用户输入
{{user_input}}
```

---

## Instruction 3：实现 Prompt 拼装函数

项目使用 **JavaScript (ES modules)**。请创建 `src/router/promptBuilder.js`：

```js
import fs from 'fs'
import path from 'path'

const PROMPT_DIR = path.resolve(process.cwd(), 'prompts')

// 加载模板文件
function loadTemplate(name) {
  return fs.readFileSync(path.join(PROMPT_DIR, name), 'utf-8')
}

// 简单的 {{var}} 占位符替换
export function renderTemplate(templateName, vars) {
  let tpl = loadTemplate(templateName)
  for (const [key, val] of Object.entries(vars)) {
    tpl = tpl.replaceAll(`{{${key}}}`, val ?? '')
  }
  return tpl
}

// 拼装 system header
export function buildSystemHeader(ctx) {
  return renderTemplate('system_header.md', {
    user_role: ctx.user_role,
    current_date: ctx.current_date,
    current_year: String(ctx.current_year),
    focus_client_or_null: ctx.focus_client
      ? `${ctx.focus_client.name} (id: ${ctx.focus_client.id})`
      : 'null',
    conversation_summary: ctx.conversation_summary || '(无)'
  })
}

// 根据 intents 决定要注入哪些 stage3 能力模块
export function selectCapabilityModules(intents) {
  const modules = []
  const types = new Set(intents.map(i => i.type))

  if (types.has('RECORD') || types.has('COMMAND')) {
    modules.push('stage3_write.md')
  }
  if (types.has('QUERY') || types.has('KNOWLEDGE') || types.has('CHAT')) {
    modules.push('stage3_readonly.md')
  }
  if (types.has('GENERATE') || types.has('RECOMMEND')) {
    modules.push('stage3_generate.md')
  }
  return modules
}

// 拼装最终 stage3 prompt
export function buildStage3Prompt(intents, resolvedClients, ctx) {
  const header = buildSystemHeader(ctx)

  const moduleContents = selectCapabilityModules(intents)
    .map(name => loadTemplate(name))
    .join('\n\n---\n\n')

  return renderTemplate('stage3_main.md', {
    SYSTEM_HEADER: header,
    intents_json: JSON.stringify(intents, null, 2),
    resolved_clients_json: JSON.stringify(resolvedClients, null, 2),
    INJECTED_CAPABILITY_MODULES: moduleContents
  })
}
```

---

## Instruction 4：实现主调用流程

替换现有的"单次 LLM 调用"逻辑。请创建 `src/router/handleUserInput.js`：

```js
import {
  renderTemplate,
  buildSystemHeader,
  buildStage3Prompt
} from './promptBuilder.js'
import { callLLM } from '../llm/client.js'
import * as db from '../db/index.js'
import { expandEventChain } from './eventChains.js'
import { heuristicMatch, buildClarifyQuestion } from './clientResolver.js'
import { updateSummary } from './summary.js'

export async function handleUserInput(userInput, ctx) {
  // ========== Stage 1: 意图分类 ==========
  const stage1Prompt = renderTemplate('stage1_classifier.md', {
    SYSTEM_HEADER: buildSystemHeader(ctx),
    user_input: userInput
  })
  const stage1 = await callLLM(stage1Prompt, { jsonMode: true })
  // stage1 = { intents, client_mentions, is_focus_change, needs_clarification, ... }

  // ========== 短路：纯 CHAT/KNOWLEDGE 且无客户 ==========
  const allReadOnly = stage1.intents.every(
    i => i.type === 'CHAT' || i.type === 'KNOWLEDGE'
  )
  if (allReadOnly && stage1.client_mentions.length === 0) {
    const shortPrompt = renderTemplate('stage4_shortcircuit.md', {
      SYSTEM_HEADER: buildSystemHeader(ctx),
      user_input: userInput
    })
    return await callLLM(shortPrompt, { jsonMode: true })
  }

  // ========== Stage 2: 客户消歧（程序优先，LLM 兜底）==========
  const resolvedClients = []
  const pendingCreate = []

  for (const mention of stage1.client_mentions) {
    const hits = await db.fuzzySearchClients(mention)

    if (hits.length === 0) {
      pendingCreate.push(mention)
    } else if (hits.length === 1) {
      resolvedClients.push(hits[0])
    } else {
      // 程序侧启发式：focus_client → 最近联系 → 上下文关键词
      const guess = heuristicMatch(mention, hits, ctx)
      if (guess) {
        resolvedClients.push(guess)
      } else {
        // 实在无法判断 → 直接返回澄清，不再调 LLM
        return {
          reply: null,
          needs_clarification: true,
          clarifying_question: buildClarifyQuestion(mention, hits),
          actions: []
        }
        // 可选：调用 stage2_disambiguate.md 让 LLM 尝试判断
      }
    }
  }

  // 把 pendingCreate 的占位客户也加入 resolvedClients，让 stage3 知道要新建
  for (const name of pendingCreate) {
    resolvedClients.push({ id: null, name, _pending_create: true })
  }

  // ========== Stage 3: Action 生成 ==========
  const stage3Prompt = buildStage3Prompt(stage1.intents, resolvedClients, ctx)
  const stage3 = await callLLM(stage3Prompt, { jsonMode: true })
  // stage3 = { reply, actions, confidence }

  // ========== 执行 actions ==========
  for (const action of stage3.actions) {
    if (action.type === 'create_profile') {
      const newClient = await db.createClient(action.name)
      // 回填后续 action 的 clientId
      backfillClientId(stage3.actions, action.name, newClient.id)
    } else if (action.type === 'trigger_event_chain') {
      await expandEventChain(action.clientId, action.eventType)
      // expandEventChain 内部根据 eventType 自动产生预设的待办、提醒
    } else {
      await executeAction(action)
    }
  }

  // ========== 更新会话状态 ==========
  if (stage1.is_focus_change && resolvedClients.length > 0) {
    ctx.focus_client = resolvedClients[0]
  }
  ctx.conversation_summary = await updateSummary(ctx, userInput, stage3.reply)

  return stage3
}

// 把 create_profile 后拿到的新 id 回填给同一批 actions 中引用了 name 的项
function backfillClientId(actions, name, newId) {
  for (const a of actions) {
    if (a.clientId == null && a._refName === name) {
      a.clientId = newId
    }
  }
}

async function executeAction(action) {
  switch (action.type) {
    case 'add_trait':
      return db.addTrait(action.clientId, action.trait)
    case 'remove_trait':
      return db.removeTrait(action.clientId, action.trait)
    case 'add_todo':
      return db.addTodo(action.clientId, action.todo, action.days)
    case 'complete_todo':
      return db.completeTodo(action.clientId)
    case 'update_todo':
      return db.updateTodo(action.clientId, action.todo, action.days)
    case 'delete_todo':
      return db.deleteTodo(action.clientId, action.todo)
    case 'update_profile':
      return db.updateProfile(action.clientId, action.updates)
    case 'add_relation':
      return db.addRelation(action.clientId, action.relation)
    case 'delete_profile':
      return db.deleteProfile(action.clientId)
    default:
      console.warn('Unknown action type:', action.type)
  }
}
```

---

## Instruction 5：定义 Event Chain 展开逻辑

请创建 `src/router/eventChains.js`，为 LIFE EVENT 白名单里**每个 eventType** 定义展开规则。LLM 只负责识别 eventType，**不负责生成具体待办**。

```js
import * as db from '../db/index.js'

// daysOffset: 相对当前日期的天数偏移（0=今天，7=一周后）
export const EVENT_CHAINS = {
  spouse_pregnancy: {
    todos: [
      { todo: '发送孕期祝福消息', daysOffset: 0 },
      { todo: '第二孕期电话问候，了解保障需求', daysOffset: 90 },
      { todo: '第三孕期推荐儿童重疾险方案', daysOffset: 180 },
      { todo: '预产期前两周送祝福礼盒', daysOffset: 240 }
    ],
    traits: ['即将为人父母'],
    recommendedScripts: ['pregnancy_congrats', 'child_protection_intro']
  },

  bereavement: {
    todos: [
      { todo: '发送哀悼慰问，注意措辞克制', daysOffset: 0 },
      { todo: '一周后电话问候，仅表达关心，不谈业务', daysOffset: 7 },
      { todo: '一个月后视情况联系，了解后续安排', daysOffset: 30 }
    ],
    recommendedScripts: ['condolence_message']
  },

  job_change: {
    todos: [
      { todo: '发送祝贺消息', daysOffset: 0 },
      { todo: '一个月后了解新工作适应情况，关注收入变化', daysOffset: 30 },
      { todo: '三个月后回访，评估是否需要调整保障方案', daysOffset: 90 }
    ],
    recommendedScripts: ['job_change_congrats', 'protection_review']
  },

  // TODO: 业务方填充以下 14 个事件的具体待办节奏
  childbirth: { todos: [/* TODO */], traits: [], recommendedScripts: [] },
  marriage: { todos: [/* TODO */], traits: [], recommendedScripts: [] },
  engagement: { todos: [/* TODO */], traits: [], recommendedScripts: [] },
  divorce: { todos: [/* TODO */], traits: [], recommendedScripts: [] },
  promotion: { todos: [/* TODO */], traits: [], recommendedScripts: [] },
  start_business: { todos: [/* TODO */], traits: [], recommendedScripts: [] },
  relocation: { todos: [/* TODO */], traits: [], recommendedScripts: [] },
  home_purchase: { todos: [/* TODO */], traits: [], recommendedScripts: [] },
  child_education_milestone: { todos: [/* TODO */], traits: [], recommendedScripts: [] },
  graduation: { todos: [/* TODO */], traits: [], recommendedScripts: [] },
  retirement: { todos: [/* TODO */], traits: [], recommendedScripts: [] },
  critical_illness: { todos: [/* TODO */], traits: [], recommendedScripts: [] },
  recovery: { todos: [/* TODO */], traits: [], recommendedScripts: [] },
  birthday_milestone: { todos: [/* TODO */], traits: [], recommendedScripts: [] },
  anniversary: { todos: [/* TODO */], traits: [], recommendedScripts: [] }
}

export async function expandEventChain(clientId, eventType) {
  const chain = EVENT_CHAINS[eventType]
  if (!chain) {
    throw new Error(`Unknown event type: ${eventType}`)
  }

  for (const t of chain.todos || []) {
    await db.addTodo(clientId, t.todo, t.daysOffset)
  }
  for (const trait of chain.traits || []) {
    await db.addTrait(clientId, trait)
  }
  // recommendedScripts 可以入库或推送到前端，按业务决定
  if (chain.recommendedScripts?.length) {
    await db.attachRecommendedScripts(clientId, chain.recommendedScripts)
  }
}
```

**注意**：白名单全部 17 个 key 必须存在，未填充的用 TODO 占位，避免 LLM 触发后报 `Unknown event type`。

---

## Instruction 6：定义 Conversation Context 数据结构

JavaScript 没有 interface，用 JSDoc 标注约定即可。请创建 `src/router/context.js`：

```js
/**
 * @typedef {Object} Client
 * @property {string} id
 * @property {string} name
 * @property {Object} [profile]
 * @property {string[]} [traits]
 * @property {Array} [todos]
 * @property {Array} [relations]
 * @property {Array} [recent_events]
 */

/**
 * @typedef {Object} ConversationContext
 * @property {string} user_role               - 例如 "保险中介"
 * @property {string} current_date            - ISO date, e.g. "2026-04-08"
 * @property {number} current_year
 * @property {Client | null} focus_client     - 当前讨论中的客户
 * @property {string} conversation_summary    - 滚动摘要，建议 ≤ 200 字
 * @property {Array} recent_messages          - 最近 N 轮原始消息
 */

export function createContext(userRole) {
  const now = new Date()
  return {
    user_role: userRole,
    current_date: now.toISOString().slice(0, 10),
    current_year: now.getFullYear(),
    focus_client: null,
    conversation_summary: '',
    recent_messages: []
  }
}
```

**focus_client 更新规则**：
- Stage 1 返回 `is_focus_change=true` 时切换为新解析出的客户
- create_profile 成功后自动设为新客户
- 用户连续 N 轮未提及任何客户时清空（可选）

**conversation_summary 更新规则**：
- 每轮对话后用一个轻量 LLM 调用（或规则）更新
- 控制在 200 字以内，避免 prompt 膨胀

如果项目用 React/JSX，建议在前端用 React Context 或 Zustand 持久化这个对象，每次发请求时整体传给后端（或用 sessionId 在后端 Map 里维护）。

---

## Instruction 7：删除旧的单段 Prompt

在完成上述改造后，**删除项目中原有的整段 Prompt 文件/常量**，并搜索所有引用点确保都改为调用新的 `handleUserInput` 流程。

---

## Instruction 8：测试用例

请为以下场景写测试，确保改造后行为正确：

| # | 用户输入 | 期望路径 | 期望主要 action |
|---|---|---|---|
| 1 | "你好" | 短路（模块4） | actions=[] |
| 2 | "终身寿险怎么算现金价值？" | 短路（模块4） | actions=[] |
| 3 | "张伟最近怎样" | Stage1→消歧→Stage3(readonly) | actions=[] |
| 4 | "他太太怀孕了"（focus=张伟） | Stage1→Stage3(write) | trigger_event_chain(张伟, spouse_pregnancy) |
| 5 | "他妈妈走了"（focus=李总） | Stage1→Stage3(write) | trigger_event_chain(李总, bereavement) |
| 6 | "今天见了个新朋友叫 Kevin Tan" | Stage1→pendingCreate→Stage3(write) | create_profile("Kevin Tan") |
| 7 | "把李太太电话改成 9123 4567" | Stage1→消歧→Stage3(write) | update_profile(id, {phone:"91234567"}) |
| 8 | "张总最近怎样"（DB 有 2 个张总） | Stage1→消歧失败→澄清返回 | needs_clarification=true |
| 9 | "帮我写条生日祝福给陈先生" | Stage1→消歧→Stage3(generate) | actions=[]，reply 含个性化祝福 |
| 10 | "他换星展了"（focus=张伟） | Stage1→Stage3(write) | trigger_event_chain(job_change) + update_profile(company=DBS) |
| 11 | "提醒我下周二给李总打电话" | Stage1→消歧→Stage3(write) | add_todo(李总_id, "...", 7) |

**测试 4/5/10 的关键校验点**：actions 中**只有 trigger_event_chain（+ 必要的 update_profile）**，**不应**出现 LLM 自己想象的 add_todo——那些应由 expandEventChain 在程序侧产生。

---

## Instruction 9：需要保留的历史行为

以下是原 Prompt 中正确的规则，**不要在改造时丢失**：

1. 时间基准注入与防年份漂移
2. add_trait 必须是人类可读标签，禁止 key=value/字段名/日期戳
3. add_todo 必须具体可执行
4. "今天见过面"写 last_contact 而非 trait
5. 输出必须严格 JSON.parse 可解析，无任何额外文本
6. 客户重名时必须 needs_clarification + 候选列表
7. 整体语气：专业但温柔从容，结尾挖掘需求

这些规则已经分布在新的模块里（主要在 `stage3_main.md` 和 `stage3_write.md`），改造时确认它们都还在。

---

## Instruction 10：不要做的事

- ❌ 不要把 4 个阶段合并回单次调用（哪怕看起来"省一次调用"）
- ❌ 不要让 LLM 决定数据库查询语句，DB 查询永远在程序侧
- ❌ 不要让 LLM 在 trigger_event_chain 之外又自己生成 todo 来"模拟"事件后果
- ❌ 不要在 stage3 prompt 里塞入未命中的能力模块（按需注入是核心优化）
- ❌ 不要用 LLM 做简单的字符串模糊匹配（用程序侧的 fuzzy search）
- ❌ 不要把整个对话历史塞进 prompt，用 conversation_summary 替代

---

## 完成标志

改造完成后，应满足以下所有条件：

- [ ] 8 个 prompt 模板文件已创建并可被加载
- [ ] `handleUserInput` 主函数实现了 4 阶段流程
- [ ] 短路逻辑生效（纯闲聊不走 stage3）
- [ ] 客户消歧由程序主导，LLM 仅作为兜底
- [ ] EVENT_CHAINS 字典覆盖白名单全部 17 个 eventType
- [ ] focus_client 与 conversation_summary 在程序侧持久化
- [ ] 旧的单段 Prompt 已删除
- [ ] 11 个测试用例全部通过
- [ ] Intent 与 Action 已解耦：create_profile / update_profile 都可由 RECORD 或 COMMAND 触发，不再被绑死在某个 intent

---

## 备注：架构决策的理由

如果你（vibe coding agent）在执行过程中觉得某些设计可以优化，请先理解下面的理由再决定是否调整：

1. **为什么要分 4 阶段而不是 1 次调用？** 
   省 token、降低幻觉、让客户消歧能利用数据库、让纯闲聊走短路减少延迟。

2. **为什么客户消歧主要由程序做？** 
   LLM 不知道数据库里有谁，让它猜会编造 ID。程序的 fuzzy search 准确且零成本。

3. **为什么 life event 必须用白名单 + 程序侧展开？** 
   避免 LLM 每次对同一事件想象出不一样的待办；保证业务方能控制关怀节奏。

4. **为什么 Intent 和 Action 要解耦？** 
   因为同一个 action（如 create_profile）既可能由 RECORD（"今天见了新朋友 Kevin"）触发，也可能由 COMMAND（"帮我建个客户 Kevin"）触发。绑死会导致分类混乱。

5. **为什么要按需注入能力模块？** 
   stage3 prompt 不需要让模型"知道所有能力"，它只需要知道"本次能用的能力"，prompt 越短越准。