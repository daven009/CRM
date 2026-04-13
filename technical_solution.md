# RelateAI — 技术方案文档

> 智能 CRM 系统 · React + Vite · 多 LLM 支持 · 分层 Pipeline 架构  
> 最后更新：2026.04.13

---

## 〇、快速定位指南

| 你想了解… | 跳转到 |
|-----------|--------|
| 项目是什么 | [一、项目概述](#一项目概述) |
| 目录结构 | [二、项目结构](#二项目结构) |
| 核心 AI Pipeline 怎么工作 | [三、分层 Pipeline 架构](#三分层-pipeline-架构) |
| Prompt 怎么组织的 | [四、Prompt 分层体系](#四prompt-分层体系) |
| 数据模型 | [五、数据模型](#五数据模型) |
| 前端怎么接 Pipeline | [六、前端接入方式](#六前端接入方式) |
| LLM 模型层 | [七、LLM 模型层](#七llm-模型层) |
| 知识向量化 & 语义检索 | [七-B、知识向量化 & 语义检索系统](#七-b知识向量化--语义检索系统) |
| 文件上传 & OCR 处理 | [七-C、文件上传 & OCR 处理](#七-c文件上传--ocr-处理) |
| Benchmark 测试系统 | [九-B、Benchmark 测试系统](#九-b-benchmark-测试系统) |
| 对话历史压缩 | [十四、渐进式 LLM 对话压缩](#十四渐进式-llm-对话压缩) |
| 还有什么没做完 | [十、当前进展与待办](#十当前进展与待办) |

---

## 一、项目概述

**RelateAI** 是一个面向保险中介（及关系型销售人员）的智能 CRM 系统。核心设计哲学：

- **AI 主动，用户被动** — 打开 app，AI 告诉用户该做什么
- **语音优先** — 用户在外面跑，没时间打字
- **零数据录入** — 用户说话就是录入，AI 负责理解、提取、存储

### 技术栈

| 层 | 技术 |
|---|------|
| 前端框架 | React 19 + JSX |
| 构建工具 | Vite 8 |
| 语言 | JavaScript (ES Modules)，**不使用 TypeScript** |
| LLM | MiniMax M2.5 / Claude / OpenAI（多 Provider 工厂模式） |
| 数据持久化 | localStorage（本地）+ Supabase（可选云端同步） |
| 部署 | 静态 SPA，Nginx / 任意静态托管 |

### 环境变量

```env
VITE_SUPABASE_URL=           # Supabase URL（可选）
VITE_SUPABASE_ANON_KEY=      # Supabase anon key（可选）
VITE_MINIMAX_API_KEY=        # MiniMax API Key
VITE_MINIMAX_MODEL=MiniMax-M2.5
VITE_MINIMAX_API_URL=https://api.minimax.io/v1/text/chatcompletion_v2
VITE_CLAUDE_API_KEY=         # Claude API Key
VITE_OPENAI_API_KEY=         # OpenAI API Key
VITE_OPENAI_API_URL=         # OpenAI 兼容 API 地址（可选，默认 https://api.openai.com/v1/chat/completions）
VITE_OPENAI_MODEL=           # OpenAI Chat 模型（可选，默认 gpt-4o-mini）
VITE_OPENAI_VISION_MODEL=    # Vision 模型（可选，默认同 VITE_OPENAI_MODEL）
VITE_OPENAI_EMBEDDING_MODEL= # Embedding 模型（可选，默认 text-embedding-3-small）
```

---

## 二、项目结构

```
CRM/
├── index.html                        # Vite 入口 HTML
├── benchmark.html                    # Benchmark 独立入口 HTML（独立 SPA）
├── package.json                      # 依赖管理
├── vite.config.js                    # Vite 配置（react 插件 + benchmark 多入口）
├── principles.md                     # 产品设计哲学 & 完整流水线规范（1336行）
├── prompts.md                        # Prompt 分层改造指令文档（789行）
├── technical_solution.md             # ← 本文件
│
├── scripts/                          # 命令行脚本（Node.js 环境）
│   ├── model_benchmark.js            # 模型基准测试脚本
│   ├── regression.js                 # Pipeline 回归测试运行器
│   ├── regression-scenarios.js       # 回归测试场景定义
│   ├── test_embedding.js             # Embedding API 测试脚本
│   ├── test_wave1_fixes.js           # Wave 1 修复验证脚本
│   ├── test_wave2_fixes.js           # Wave 2 修复验证脚本
│   ├── vectorize_storage.js          # 存量知识源批量向量化脚本
│   └── serve_dist.py                 # 构建产物静态服务器
│
├── src/
│   ├── main.jsx                      # Vite 主入口
│   ├── benchmark.jsx                 # Benchmark 独立入口
│   ├── App.jsx                       # 主应用（状态管理中心，~900行）
│   ├── App.css                       # 全局样式
│   ├── index.css                     # 入口样式
│   │
│   ├── components/                   # 8 个页面组件
│   │   ├── VoiceView.jsx             # 语音对话主页（用户 80% 时间在此）
│   │   ├── CardsView.jsx             # 客户卡片列表页
│   │   ├── DetailView.jsx            # 客户详情页（含毛玻璃对话浮层）
│   │   ├── LogView.jsx               # 对话日志页
│   │   ├── SettingsView.jsx          # 设置页（含 Knowledge Base 管理）
│   │   ├── BenchmarkView.jsx         # ★ Pipeline Benchmark 页（11 场景自动化测试）
│   │   ├── PlaygroundView.jsx        # AI Playground V1（调试用，使用旧 Pipeline）
│   │   └── PlaygroundView2.jsx       # AI Playground V2（调试用）
│   │
│   └── lib/                          # 核心逻辑层
│       ├── crmPipeline.js            # 旧版单段 Pipeline（保留，Playground 使用）
│       ├── clientMutations.js        # Action 执行器（纯函数，应用 CRM 数据变更）
│       ├── knowledgeSources.js       # 知识源标准化 & 上下文构建
│       ├── knowledgeEmbedding.js     # ★ 知识源 Embedding + 语义检索模块
│       ├── benchmarkScenarios.js     # ★ Benchmark 场景定义 & 执行器（11 个场景）
│       ├── materialParsers.js        # 文件/材料解析器（PDF、XLSX、DOCX 等）
│       ├── modelSettings.js          # 模型偏好设置（localStorage）
│       ├── supabaseClient.js         # Supabase 数据层
│       │
│       ├── models/                   # LLM 模型适配层
│       │   ├── index.js              # 统一导出（含 Embedding API）
│       │   ├── factory.js            # 模型工厂 createLLMCaller()
│       │   ├── shared.js             # 共享工具（extractTextFromModelResponse）
│       │   ├── env.js                # ★ 运行时环境变量辅助（Vite / Node / globalThis）
│       │   ├── minimax.js            # MiniMax 适配
│       │   ├── claude.js             # Claude 适配
│       │   ├── openai.js             # OpenAI Chat 适配
│       │   ├── openaiEmbedding.js    # ★ OpenAI Embedding API（text-embedding-3-small）
│       │   ├── openaiMaterial.js     # OpenAI 材料分析（专用）
│       │   ├── openaiSummary.js      # OpenAI 对话总结（专用）
│       │   └── openaiVision.js       # OpenAI 截图分析 / Vision OCR（专用）
│       │
│       ├── prompts/                  # Prompt 模板（JS 常量导出）
│       │   ├── index.js              # 统一导出
│       │   ├── systemHeader.js       # 模块 0：共享 Header
│       │   ├── stage1Classifier.js   # 模块 1：意图分类
│       │   ├── stage2Disambiguate.js # 模块 2：客户消歧（LLM 兜底）
│       │   ├── stage3Main.js         # 模块 3.0：Action 生成主框架
│       │   ├── stage3Write.js        # 模块 3.1：写操作能力
│       │   ├── stage3Readonly.js     # 模块 3.2：只读能力
│       │   ├── stage3Generate.js     # 模块 3.3：内容生成
│       │   └── stage4Shortcircuit.js # 模块 4：短路回复
│       │
│       └── router/                   # ★ 分层 Pipeline 核心（新架构）
│           ├── pipeline.js           # 主调度函数 runStagedPipeline()（~603行）
│           ├── promptBuilder.js      # Prompt 拼装器
│           ├── context.js            # 会话上下文管理（不可变更新）
│           ├── clientResolver.js     # 程序侧客户消歧（fuzzy + 启发式 + LLM）
│           └── eventChains.js        # 生命事件链展开（17 种事件类型）
```

---

## 三、分层 Pipeline 架构

### 3.1 架构总览

项目当前存在**两套 Pipeline**，主力是**新版分层 Pipeline**：

| Pipeline | 入口函数 | 文件 | 状态 | 使用方 |
|----------|---------|------|------|--------|
| **新版（分层）** | `runStagedPipeline()` | `src/lib/router/pipeline.js` | ✅ 主力 | App.jsx（VoiceView + DetailView） |
| 旧版（单段） | `runCrmPipeline()` | `src/lib/crmPipeline.js` | 保留 | PlaygroundView（调试用） |

### 3.2 新版 Pipeline 流程

```
用户输入
    ↓
┌───────────────────────────────────────────────────────────────┐
│  STAGE 1：意图分类（LLM 调用）                                  │
│  输入：用户文本 + 客户简报 + 历史上下文                           │
│  输出：intents[], client_mentions[], is_focus_change           │
└───────────────────────┬───────────────────────────────────────┘
                        ↓
┌───────────────────────────────────────────────────────────────┐
│  语义知识检索（异步，Stage 1 之后）                               │
│  根据 intents + client_mentions 构建查询向量                     │
│  → 有 embedding 的知识源：余弦相似度检索                         │
│  → 无 embedding 的知识源：关键词回退匹配                         │
│  → 用户明确提到的知识源名称：强制纳入                             │
│  输出：排序后的 Top-K 知识源上下文                                │
└───────────────────────┬───────────────────────────────────────┘
                        ↓
               ┌─── 短路判断 ───┐
               │ 纯 CHAT/KNOWLEDGE │
               │ 且无 client_mentions │
               │ 且无 lockedClient │
               └────────┬────────┘
                   ↓ YES              ↓ NO
┌──────────────────────────┐   ┌─────────────────────────────────┐
│ STAGE 4：短路回复（LLM）    │   │ STAGE 2：客户消歧（程序侧优先）    │
│ 轻量 prompt，直接返回       │   │                                   │
│ ~省 60% token              │   │  对每个 client_mention:            │
│ + 语义检索到的知识源        │   │    fuzzySearch → 0 命中：新客户?    │
└────────────┬─────────────┘   │                  1 命中：直接绑定    │
             ↓                 │                  N 命中：             │
           返回结果             │                    ├ 启发式推断       │
                               │                    ├ LLM 辅助消歧     │
                               │                    └ 返回澄清问题     │
                               └──────────────┬──────────────────────┘
                                              ↓
                               ┌──────────────────────────────────────┐
                               │ STAGE 3：Action 生成（LLM 调用）      │
                               │ 按 intent 类型动态注入能力模块：       │
                               │   RECORD/COMMAND → 注入 write 模块    │
                               │   QUERY/KNOWLEDGE/CHAT → 注入 readonly│
                               │   GENERATE/RECOMMEND → 注入 generate  │
                               │ + 注入语义检索到的知识源上下文          │
                               │ 输出：reply + actions[]               │
                               └──────────────┬──────────────────────┘
                                              ↓
                               ┌──────────────────────────────────────┐
                               │ Event Chain 展开（程序侧确定性展开）   │
                               │ trigger_event_chain action →          │
                               │   展开为具体的 add_todo + add_trait    │
                               └──────────────┬──────────────────────┘
                                              ↓
                               ┌──────────────────────────────────────┐
                               │ 更新上下文 → 返回统一结构              │
                               │ { reply, actions, intents, ctx,       │
                               │   stages, requestMeta }               │
                               └──────────────────────────────────────┘
```

### 3.3 关键设计决策

1. **每步只做一件事** — Stage 1 只分类，Stage 2 只消歧，Stage 3 只生成 Action，准确率远高于"一锅炖"
2. **客户消歧由程序主导** — 三层递进：`fuzzySearchClients()` → `heuristicMatch()` → LLM 辅助 → 用户澄清
3. **能力模块按需注入** — Stage 3 的 Prompt 根据 intent 类型动态拼装，QUERY 类不会看到写操作定义
4. **Event Chain 白名单** — 17 种生命事件由 `expandEventChain()` 在程序侧确定性展开，避免 LLM 每次发明不同的待办
5. **JSON 修复循环** — `callAndParse()` 最多 2 轮修复（`MAX_REPAIR_ROUNDS`），总调用不超过 4 次（`MAX_TOTAL_LLM_CALLS`）
6. **语义知识检索** — Stage 1 结果驱动知识检索：有 embedding 走余弦相似度，无 embedding 走关键词回退，≤topK 条时全量注入跳过检索

### 3.4 函数签名

```js
// 主入口
export async function runStagedPipeline(
  inputText,        // string: 用户输入
  clients,          // Array: 客户列表（完整数据）
  ctx,              // ConversationContext: 会话上下文
  modelProvider,    // string: 'minimax' | 'claude' | 'openai'
  options           // { lockedClient?: Object }
) → Promise<{
  reply: string,
  actions: Array,
  intents: Array,
  ctx: ConversationContext,  // 更新后的上下文（调用方需保存）
  stages: Array,             // 每步执行记录（用于调试）
  requestMeta: Object,
  needsClarification: boolean,
  clarifyingQuestion: string,
  confidence: number
}>
```

### 3.5 Stage 判断逻辑细节

| 条件 | 走向 |
|------|------|
| `clientMentions.length === 0` && 无 `lockedClient` && intents 全为 CHAT/KNOWLEDGE | Stage 4 短路 |
| 有 `lockedClient`（详情页对话） | 跳过 Stage 2 消歧，直接绑定 |
| `clientMentions.length > 0` 但 fuzzySearch 全部唯一命中 | Stage 2 自动绑定，不调 LLM |
| fuzzySearch 多命中 + 启发式成功 | Stage 2 程序侧解决，不调 LLM |
| 启发式失败 + LLM 消歧失败 | 返回 `needsClarification: true` |

---

## 四、Prompt 分层体系

### 4.1 模板组织（1 + 1 + 3 + 1）

```
模块 0 · systemHeader.js          → 所有 Stage 共享的头部
  ↓ 被注入到 ↓
模块 1 · stage1Classifier.js      → Stage 1：只做意图分类
模块 2 · stage2Disambiguate.js    → Stage 2：客户消歧 LLM 兜底（可选调用）
模块 3.0 · stage3Main.js          → Stage 3：Action 生成主框架
  ↓ 动态注入以下模块 ↓
  ├── 3.1 · stage3Write.js        → RECORD/COMMAND 时注入（写操作 + Event 白名单）
  ├── 3.2 · stage3Readonly.js     → QUERY/KNOWLEDGE/CHAT 时注入（只读）
  └── 3.3 · stage3Generate.js     → GENERATE/RECOMMEND 时注入（内容生成）
模块 4 · stage4Shortcircuit.js    → Stage 4：短路回复（轻量 prompt）
```

### 4.2 模板变量机制

所有模板使用 `{{variable}}` 占位符，由 `promptBuilder.js` 中的 `renderTemplate()` 函数替换。

共享 Header 的变量：

| 变量 | 来源 | 示例 |
|------|------|------|
| `{{user_role}}` | `ctx.user_role` | "保险中介" |
| `{{current_date}}` | `ctx.current_date` | "2026-04-12" |
| `{{current_year}}` | `ctx.current_year` | "2026" |
| `{{focus_client_or_null}}` | `ctx.focus_client` | "张伟 (id: 42)" 或 "null" |
| `{{conversation_summary}}` | `ctx.conversation_summary` | 最近 3 轮对话摘要 |

Stage 3 的能力注入：

```js
// promptBuilder.js
export function selectCapabilityModules(intents) {
  const modules = [];
  const types = new Set(intents.map(i => i.type));
  if (types.has('RECORD') || types.has('COMMAND'))    modules.push(STAGE3_WRITE_TEMPLATE);
  if (types.has('QUERY') || types.has('KNOWLEDGE') || types.has('CHAT')) modules.push(STAGE3_READONLY_TEMPLATE);
  if (types.has('GENERATE') || types.has('RECOMMEND')) modules.push(STAGE3_GENERATE_TEMPLATE);
  return modules;
}
```

### 4.3 Prompt 输出格式约定

| Stage | 输出 JSON 结构 |
|-------|---------------|
| Stage 1 | `{ intents, client_mentions, is_focus_change, needs_clarification, clarifying_question, confidence }` |
| Stage 2 | `{ resolved_client_id, reasoning, needs_clarification, clarifying_question }` |
| Stage 3 | `{ reply, actions, confidence }` |
| Stage 4 | `{ reply, actions: [], confidence }` |

---

## 五、数据模型

### 5.1 客户对象（Client）

```js
{
  id: number,           // 自增 ID
  n: string,            // 姓名
  co: string,           // 公司
  role: string,         // 职位
  tel: string,          // 电话
  hp: number,           // 健康度 0-100
  bd: string,           // 生日 "YYYY.MM.DD"
  ps: string,           // 性格/备注
  traits: string[],     // 标签数组 ["喜欢跑步", "风险偏好稳健"]
  todos: [{             // 待办数组
    t: string,          // 待办文本
    d: number,          // 天数偏移（负=过期）
    s: string,          // 来源 "ai" | "sys" | "手动"
    done: boolean
  }],
  log: [{               // 时间线
    dt: string,         // 日期 "MM.DD"
    src: string,        // 来源 "对话" | "系统" | "截图"
    tx: string,         // 内容
    ai: string | null   // AI 注解
  }],
  social: [],           // 社交账号
  files: [{             // 附件/资料
    id: string,
    kind: string,       // "screenshot" | "document" | "spreadsheet"
    name: string,
    summary: string,
    extractedText: string,
    embedding: number[], // ★ 向量化后的 embedding（256 维，可选）
    // ... 更多字段
  }],
  refs: string[],       // 关系
  gifts: []             // 礼物记录
}
```

> **注意**：字段使用缩写（`n`=name, `co`=company, `hp`=health_point 等），`clientMutations.js` 中有 `PROFILE_FIELD_ALIASES` 映射表处理字段别名。

### 5.2 会话上下文（ConversationContext）

```js
// src/lib/router/context.js
{
  user_role: "保险中介",
  current_date: "2026-04-14",
  current_year: 2026,
  focus_client: { id: 42, name: "张伟" } | null,
  conversation_summary: "≤200字滚动摘要（最近3轮快照）",
  compressed_summary: "≤300字 LLM 语义压缩摘要（渐进积累）",  // ★ 新增
  recent_messages: [{ user: "...", ai: "..." }],  // 最近 12 轮
  _compressing: false  // 是否正在进行 LLM 压缩（防并发）
}
```

上下文是**不可变**的，每次更新返回新对象：
- `updateFocusClient(ctx, client)` → 新 ctx
- `appendMessage(ctx, userInput, aiReply)` → 新 ctx（自动滚动摘要）
- `maybeCompressHistory(ctx, compressFn)` → 异步 LLM 压缩，返回新 ctx 或 null（★ 新增）
- `getFullConversationContext(ctx)` → 合并 compressed_summary + conversation_summary 供 prompt 注入（★ 新增）

### 5.3 Action 白名单

```js
// 10 种核心 Action（crmPipeline.js 导出）
const ACTION_WHITELIST = [
  "add_trait", "remove_trait",
  "add_todo", "complete_todo", "update_todo", "delete_todo",
  "update_profile", "add_relation", "create_profile",
  "trigger_event_chain"
];
```

每个 Action 有严格的 Schema 校验：

```js
const ACTION_SCHEMA = {
  add_trait:            ["clientId", "trait"],
  remove_trait:         ["clientId", "trait"],
  add_todo:            ["clientId", "todo", "days"],
  complete_todo:       ["clientId"],
  update_todo:         ["clientId", "todo", "days"],
  delete_todo:         ["clientId", "todo"],
  update_profile:      ["clientId", "updates"],
  add_relation:        ["clientId", "relation"],
  create_profile:      ["name"],
  trigger_event_chain: ["clientId", "eventType"],
  // ...
};
```

### 5.4 意图类型（7 种）

| 类型 | 说明 | 是否产生 Action |
|------|------|----------------|
| RECORD | 用户陈述客户事实 | ✅ |
| COMMAND | 用户明确下达指令 | ✅ |
| QUERY | 查询客户/任务信息 | ❌ |
| KNOWLEDGE | 行业知识问答 | ❌ |
| GENERATE | 生成文本/内容 | ❌ |
| RECOMMEND | 请求建议/策略 | ❌ |
| CHAT | 闲聊/寒暄 | ❌ |

> **关键解耦**：RECORD 与 COMMAND 使用相同的 Action 集合。区别仅在语气，不影响执行。

---

## 六、前端接入方式

### 6.1 App.jsx 状态管理

App.jsx 是**状态管理中心**，管理所有全局状态并通过 props 向下传递。

**Pipeline 相关状态**：

```jsx
// 主对话上下文
const [conversationCtx, setConversationCtx] = useState(() => createContext());
// 详情页对话上下文
const [detailCtxState, setDetailCtxState] = useState(() => createContext());
```

### 6.2 主对话调用（VoiceView）

```jsx
const sendMsg = async (text) => {
  const result = await runStagedPipeline(
    trimmed,
    clients || [],
    conversationCtx,          // 传入上下文
    getDefaultModelProvider()
  );
  setConversationCtx(result.ctx);  // 更新上下文
  applyPlaygroundActions(result.actions || []);  // 执行 Actions
};
```

### 6.3 详情页对话（DetailView）

```jsx
const detailSend = async (rawText) => {
  const result = await runStagedPipeline(
    userMsgText,
    [sel],                     // 只传当前客户
    detailCtxState,
    getDefaultModelProvider(),
    { lockedClient: sel }      // 锁定客户，跳过消歧
  );
  setDetailCtxState(result.ctx);
};
```

### 6.4 上下文生命周期

| 事件 | 操作 |
|------|------|
| 新建主对话 (`newConvo`) | `setConversationCtx(createContext())` |
| 开始详情对话 (`startNewDetailSession`) | `setDetailCtxState(createContext())` |
| 关闭详情对话 (`closeDetailChat`) | `setDetailCtxState(createContext())` |
| 每次 Pipeline 返回后 | `setXxxCtx(result.ctx)` |

### 6.5 Action 执行链

```
Pipeline 返回 actions[]
       ↓
App.jsx: applyPlaygroundActions(actions)
       ↓ 逐个 action 调用
clientMutations.js: applyClientAction(clients, action)
       ↓ 纯函数，返回 { nextClients, changedClient, ... }
       ↓
setClients(working)  →  localStorage 持久化
persistUpserts()     →  Supabase 同步（如果启用）
```

---

## 七、LLM 模型层

### 7.1 工厂模式

```js
// models/factory.js
const MODEL_PROVIDERS = {
  minimax: { factory: createMinimaxCaller, envKey: "VITE_MINIMAX_API_KEY" },
  claude:  { factory: createClaudeCaller,  envKey: "VITE_CLAUDE_API_KEY" },
  openai:  { factory: createOpenAICaller,  envKey: "VITE_OPENAI_API_KEY" },
};

// 使用
const llm = createLLMCaller('openai');
const response = await llm.call(messages, 'Stage1 意图分类');
const text = extractTextFromModelResponse(response);
```

### 7.2 Caller 统一接口

每个 caller 都暴露：

| 属性/方法 | 类型 | 说明 |
|-----------|------|------|
| `model` | string | 模型名称 |
| `provider` | string | Provider ID |
| `requestUrl` | string | API 端点 |
| `call(messages, label)` | async function | 发起 LLM 调用 |
| `callLog` | Array | 调用日志 |
| `getCallCount()` | function | 返回调用次数 |

### 7.3 模型选择策略

```js
// modelSettings.js
resolveModelProviderPreference()
// 1. 检查 localStorage 中用户偏好
// 2. 偏好 + 已配置 API Key → 使用
// 3. 否则 fallback 到第一个已配置的 Provider
// 4. 都没有 → 默认 "openai"
```

### 7.4 专用模型调用

| 模块 | 用途 | 使用场景 |
|------|------|----------|
| `openaiVision.js` | 截图 OCR 分析 | DetailView 上传截图 / Settings KB 图片上传 |
| `openaiSummary.js` | 对话总结 + 语义压缩 | 关闭详情对话时生成 timeline；对话中渐进式历史压缩（★ 新增 `compressConversation`） |
| `openaiMaterial.js` | 材料分析 | 上传 PDF/XLSX/DOCX（含 searchKeywords 生成） |
| `openaiEmbedding.js` | 文本向量化 | 知识源上传时生成 embedding、每轮对话语义检索 |

---

## 七-B、知识向量化 & 语义检索系统

### 7B.1 架构概览

项目实现了**完整的 RAG（Retrieval-Augmented Generation）管线**：知识源上传时生成 embedding 向量，每轮对话时根据用户输入语义检索最相关的知识源，注入到 LLM Prompt 中。

```
知识上传流程：
  文件上传 → 解析/OCR → AI 分析 → 提取 searchKeywords
       ↓
  buildEmbeddableText() → 组装可搜索文本
       ↓
  embedText() → OpenAI text-embedding-3-small（256 维）
       ↓
  embedding 存储到知识源对象 / 客户 files 条目

每轮对话检索流程：
  Stage 1 结果（intents + client_mentions + user_message）
       ↓
  buildQueryText() → 组装查询文本
       ↓
  embedText() → 生成查询向量
       ↓
  searchSimilar() → 余弦相似度 Top-K
       ↓
  + keywordMatchScore() → 关键词加成 / 回退
       ↓
  + 用户明确提到的知识源名称 → 强制纳入
       ↓
  ranked & filtered → buildKnowledgeContext()
       ↓
  注入到 Stage 3 / Stage 4 的 prompt
```

### 7B.2 Embedding 模型配置

| 配置项 | 值 |
|--------|-----|
| 模型 | `text-embedding-3-small`（可通过 `VITE_OPENAI_EMBEDDING_MODEL` 覆盖） |
| 维度 | 256（降维，节省存储和计算，精度损失极小） |
| API URL | 从 `VITE_OPENAI_API_URL` 推导（`/chat/completions` → `/embeddings`） |
| 输入文本上限 | 2000 字符 |

### 7B.3 可搜索文本构建优先级

`buildEmbeddableText(source)` 按以下优先级拼装：

1. `searchKeywords[]` — AI 分析时生成的检索关键词（最重要）
2. `name` — 文件/知识源名称
3. `tags[]` — 标签
4. `summary` — 一句话摘要
5. `promptContext` — 高密度上下文（前 500 字符）
6. `extractedText` — 原始提取文本（前 800 字符）

### 7B.4 检索策略

`retrieveRelevantKnowledge(sources, ctx, options)` 实现三路融合：

| 路径 | 条件 | 方法 |
|------|------|------|
| 语义搜索 | 知识源有 embedding | 余弦相似度 + 关键词加成（+0.15） |
| 关键词回退 | 知识源无 embedding | 按名称/关键词/标签/摘要 加权匹配，分数归一化到 0~1 |
| 强制纳入 | 用户消息中包含知识源名称 | 分数设为 1.0 |

**常量配置**：

```js
DEFAULT_TOP_K = 8;            // 默认返回 Top-8
DEFAULT_MIN_SCORE = 0.25;     // 最低相似度阈值
KEYWORD_BOOST = 0.15;         // 关键词命中加成
EXPLICIT_MENTION_SCORE = 1.0; // 用户明确提到时的强制分数
```

**兜底逻辑**：
- 知识源总数 ≤ topK → 跳过检索，全量注入
- 无对话上下文信号 → 回退到旧的丰富度排序
- 语义搜索异常 → 回退到关键词匹配
- 所有分数低于阈值 → 回退到旧的丰富度排序

### 7B.5 Pipeline 中的集成点

在 `pipeline.js` 中，语义检索发生在 **Stage 1 之后、短路判断之前**：

```js
// pipeline.js 关键代码
const retrievalCtx = {
  user_message: inputText,
  mentioned_clients: clientMentions.map(m => ...),
  detected_events: intents.filter(i => i.type === 'RECORD').map(i => i.content),
  intents,
  conversation_summary: ctx.conversation_summary || ''
};

let knowledgeContext;
try {
  knowledgeContext = await retrieveRelevantKnowledge(knowledgeFiles || [], retrievalCtx);
} catch (err) {
  knowledgeContext = buildKnowledgeContext(knowledgeFiles || []); // 兜底
}
```

检索到的知识源被注入到 Stage 3 和 Stage 4 的 user payload 中（`knowledge_sources` 和 `knowledge_sources_meta`）。

### 7B.6 关键函数签名

```js
// knowledgeEmbedding.js
export const generateKnowledgeEmbedding = async (source) → Promise<number[]>
export const batchGenerateEmbeddings = async (sources) → Promise<Map<string, number[]>>
export const retrieveRelevantKnowledge = async (sources, ctx, options?) → Promise<KnowledgeContext>

// openaiEmbedding.js
export const createEmbeddings = async (input, options?) → Promise<number[][]>
export const embedText = async (text) → Promise<number[]>
export const cosineSimilarity = (a, b) → number
export const searchSimilar = (queryEmbedding, candidates, topK?, minScore?) → Array<{id, score}>
```

---

## 七-C、文件上传 & OCR 处理

### 7C.1 联系人 Data Tab 文件上传

App.jsx 中的两个方法负责联系人资料上传，上传后**异步生成 embedding**：

| 方法 | 触发场景 | 处理流程 |
|------|----------|----------|
| `attachDataFileToClient` | 上传 PDF/XLSX/DOCX/CSV | `parseMaterialFile()` → `analyzeMaterialWithOpenAI()` → 存入 `client.files[]` → 异步 `generateKnowledgeEmbedding()` |
| `attachScreenshotToClient` | 上传截图/图片 | `analyzeScreenshotWithOpenAI()` (Vision OCR) → 存入 `client.files[]` → 异步 `generateKnowledgeEmbedding()` |

Embedding 生成完成后，回写到 `client.files[].embedding` 字段并同步到 Supabase。**不阻塞 UI**。

### 7C.2 Settings Knowledge Base 文件上传

SettingsView.jsx 的 `handleKnowledgeFiles` 支持两种路径：

| 文件类型 | 处理流程 |
|----------|----------|
| 文档（PDF/DOCX/XLSX/CSV） | `parseMaterialFile()` → `analyzeMaterialWithOpenAI()` → 存入 knowledgeFiles → 异步 `generateKnowledgeEmbedding()` |
| 图片（PNG/JPG/JPEG/WEBP/GIF） | `readFileAsDataUrl()` → `resizeImageDataUrl(maxWidth=1280)` → `analyzeScreenshotWithOpenAI()` (Vision OCR) → 存入 knowledgeFiles → 异步 `generateKnowledgeEmbedding()` |

### 7C.3 材料分析 AI 输出结构

`analyzeMaterialWithOpenAI` 返回的 JSON 结构已扩展，包含 **searchKeywords**：

```json
{
  "summary": "一句话摘要",
  "details": ["要点1", "要点2"],
  "tags": ["标签1", "标签2"],
  "suggestedActions": ["后续动作1", "后续动作2"],
  "promptContext": "适合放入后续对话 prompt 的高信息密度上下文",
  "searchKeywords": ["检索关键词1", "检索关键词2", "...（10-20个）"]
}
```

`searchKeywords` 要求覆盖：文档主题/领域、核心实体、涉及场景、中英文关键词、同义词/近义词。

### 7C.4 支持的文件格式

| 格式 | 解析库 | 场景 |
|------|--------|------|
| PDF | `pdfjs-dist` | 联系人资料 + Settings KB |
| XLSX/XLS | `xlsx` | 联系人资料 + Settings KB |
| DOCX/DOC | `mammoth` | 联系人资料 + Settings KB |
| CSV | 内置解析 | 联系人资料 + Settings KB |
| PNG/JPG/JPEG/WEBP/GIF | OpenAI Vision API | 联系人截图 + Settings KB |

---

## 八、客户消歧系统

### 8.1 三层递进消歧

```
用户说 "张总"
       ↓
Layer 1: fuzzySearchClients("张总", clients)
  ├── 0 命中 → 可能是新客户
  ├── 1 命中 → 直接绑定 ✓
  └── N 命中 → 进入 Layer 2
       ↓
Layer 2: heuristicMatch("张总", hits, ctx, { isFocusChange })
  ├── 完全匹配姓名且唯一 → 绑定 ✓
  ├── is_focus_change=false + focus_client 在候选中 → 绑定 focus_client ✓
  └── 无法判断 → 进入 Layer 3
       ↓
Layer 3: LLM 辅助消歧（可选，取决于调用额度）
  ├── LLM 返回 resolved_client_id → 绑定 ✓
  └── 失败 → 返回澄清问题给用户
```

### 8.2 模糊搜索规则

```js
// clientResolver.js: fuzzySearchClients()
// 匹配逻辑（任一满足即命中）：
// 1. 完全匹配：name === mention
// 2. 名字包含 mention："张伟明" 包含 "张伟"
// 3. mention 包含名字："张总" 包含 "张"
// 4. 姓氏+称谓：支持 14 种称谓（总/姐/哥/叔/阿姨/老板/经理/董事/主任/太太/先生/女士/老师/弟）
// 5. 英文名忽略大小写
```

### 8.3 启发式优先级

```
1. 完全匹配姓名且唯一 → 选定
2. 未切换焦点 + focus_client 在候选中 → 选 focus_client
3. 其他 → 无法判断，返回 null
```

---

## 九、Event Chain 系统

### 9.1 白名单（17 种生命事件）

```
spouse_pregnancy, childbirth, marriage, engagement, divorce,
job_change, promotion, start_business, relocation, home_purchase,
bereavement, child_education_milestone, graduation, retirement,
critical_illness, recovery, anniversary
```

### 9.2 展开逻辑

LLM 只负责识别 `eventType`，程序侧负责展开：

```js
// eventChains.js
expandEventChain(clientId, eventType) → {
  actions: [
    { type: 'add_todo', clientId, todo: '发送祝贺消息', days: 0 },
    { type: 'add_todo', clientId, todo: '一个月后了解适应情况', days: 30 },
    // ...
  ],
  recommendedScripts: ['job_change_congrats', 'protection_review']
}
```

### 9.3 Pipeline 中的展开时机

在 Stage 3 返回 actions 后、最终返回前：

```js
for (const action of actions) {
  if (action.type === 'trigger_event_chain') {
    const { actions: chainActions } = expandEventChain(action.clientId, action.eventType);
    expandedActions.push(...chainActions);
  } else {
    expandedActions.push(action);
  }
}
```

---

## 九-B、Benchmark 测试系统

### 9B.1 概述

项目内置了一套**Pipeline Benchmark 系统**，用于自动化验证分层 Pipeline 的正确性。支持两种运行方式：

| 方式 | 入口 | 环境 |
|------|------|------|
| **浏览器 UI** | `benchmark.html` → `BenchmarkView.jsx` | Vite dev server / 构建产物 |
| **命令行** | `scripts/regression.js` | Node.js（通过 `getRuntimeEnv()` + `globalThis.__RELATE_AI_ENV__`） |

### 9B.2 场景定义（11 个）

定义在 `src/lib/benchmarkScenarios.js`：

| ID | 类别 | 标题 | 预期路径 | 标签 |
|----|------|------|----------|------|
| `chat_short_circuit` | short-circuit | 纯闲聊短路 | shortCircuit | CHAT, no-action |
| `knowledge_short_circuit` | short-circuit | 纯知识问答短路 | shortCircuit | KNOWLEDGE, no-action |
| `focus_query` | context | 沿用当前 focus_client 查询 | resolved | QUERY, focus_client |
| `locked_client` | context | 详情页锁定客户 | resolvedLocked | QUERY, lockedClient |
| `ambiguity_clarify` | disambiguation | 重名歧义澄清 | clarify | QUERY, ambiguous |
| `switch_contact` | context | 明确切换联系人 | resolvedSwitch | QUERY, focus_change |
| `multi_turn_summary` | context | 多轮对话摘要保留 | generate | GENERATE, memory |
| `pending_create` | write | 新客户建档 | pendingCreate | RECORD, create_profile |
| `life_event_spouse_pregnancy` | write | 人生事件：配偶怀孕 | eventChain | RECORD, event_chain |
| `command_reminder` | write | 命令类回访提醒 | write | COMMAND, add_todo |
| `generate_birthday_wish` | generate | 生成生日祝福 | generate | GENERATE, personalized |

### 9B.3 执行架构

```js
// benchmarkScenarios.js
getScenarioPlan(id)  → { scenario, steps[], evaluate() }
runScenarioPlan(plan, runner) → { scenario, steps[], evaluation: { pass, expected } }
```

- **step** = `{ input, clients, ctx, options }` — 一次 Pipeline 调用的完整入参
- **evaluate** = 纯函数，检查 Pipeline 返回结构是否符合预期（如 `shortCircuit=true`、`actions` 包含指定类型等）
- 支持多轮对话场景（`step.ctx = 'previous'` 表示使用上一步的返回 ctx）

### 9B.4 运行时环境适配

`models/env.js` 提供了统一的 `getRuntimeEnv()` 函数：

```js
// 优先级：import.meta.env（Vite）→ globalThis.__RELATE_AI_ENV__（测试注入）→ process.env（Node）
export function getRuntimeEnv() { ... }
```

命令行脚本通过 `globalThis.__RELATE_AI_ENV__` 注入环境变量，无需 Vite 构建即可运行 Pipeline。

### 9B.5 相关脚本

| 脚本 | 用途 |
|------|------|
| `scripts/regression.js` | 运行全部 11 个场景，输出 pass/fail 报告 |
| `scripts/regression-scenarios.js` | 场景定义的 Node 兼容副本 |
| `scripts/model_benchmark.js` | 模型基准性能测试 |
| `scripts/test_embedding.js` | Embedding API 连通性测试 |
| `scripts/vectorize_storage.js` | 存量知识源批量向量化 |
| `scripts/test_wave1_fixes.js` | Wave 1 修复验证 |
| `scripts/test_wave2_fixes.js` | Wave 2 修复验证 |

---

## 十、当前进展与待办

### 10.1 ✅ 已完成

| 模块 | 状态 | 说明 |
|------|------|------|
| Prompt 模板体系 | ✅ | 8 个模板文件，`{{variable}}` 占位符机制 |
| 分层 Pipeline 主函数 | ✅ | `runStagedPipeline()`，4 Stage 调度 + 语义知识检索 |
| 程序侧客户消歧 | ✅ | fuzzy + 启发式 + LLM 辅助 |
| Event Chain 展开 | ✅ | 17 种事件类型全部定义 |
| 会话上下文管理 | ✅ | 不可变更新，滚动摘要 |
| App.jsx 接入 | ✅ | sendMsg + detailSend 已切换到新 Pipeline |
| JSON 修复循环 | ✅ | `callAndParse()` 最多 2 轮修复 |
| 多 LLM Provider | ✅ | MiniMax / Claude / OpenAI 工厂模式 |
| 旧 Pipeline 保留 | ✅ | PlaygroundView 仍使用，作为对照组 |
| 知识源向量化 | ✅ | `generateKnowledgeEmbedding()` + `batchGenerateEmbeddings()` |
| 语义知识检索 | ✅ | `retrieveRelevantKnowledge()` 三路融合（语义 + 关键词 + 强制纳入） |
| Pipeline 集成语义检索 | ✅ | Stage 1 后自动检索，结果注入 Stage 3/4 |
| 联系人文件上传 + Embedding | ✅ | 文档上传 / 截图 OCR 后异步生成 embedding 写回 `client.files[]` |
| Settings KB 图片上传 | ✅ | 图片 → Vision OCR → 文本提取 → 向量化（支持 PNG/JPG/WEBP/GIF） |
| 材料分析 searchKeywords | ✅ | `analyzeMaterialWithOpenAI` 输出含 10-20 个细粒度检索关键词 |
| Benchmark 测试系统 | ✅ | 11 个场景，浏览器 UI（`BenchmarkView`）+ 命令行（`scripts/regression.js`）双入口 |
| 运行时环境适配 | ✅ | `getRuntimeEnv()` 支持 Vite / Node / globalThis 三种环境 |
| 主对话 Focus Session 归档 | ✅ | focus 切换 / newConvo / idle 超时三种触发 → 自动归档到客户 Timeline |
| P0/P1 稳定性修复 | ✅ | 4 项 P0 + 4 项 P1，含 Supabase 双写、闭包陈旧、mutation 等修复（详见第 13 节） |

### 10.2 🔲 待完成 / 待优化

| 项目 | 优先级 | 说明 |
|------|--------|------|
| 被动触发系统 | 中 | `principles.md` 中定义的"打开 app 建议"、"每日健康度重算"、"周报"尚未实现 |
| 语音输入 | 中 | VoiceView 有录音 UI 但语音转文字尚未接 API |
| PlaygroundView2 迁移 | 低 | 可选择也切换到新 Pipeline |
| 差异化模型选择 | 低 | Stage 1 用小模型、Stage 3 用大模型（架构已支持，尚未配置） |
| 存量数据批量向量化 | 低 | `scripts/vectorize_storage.js` 已写好，需在部署后执行一次 |
| Benchmark 扩展 | 低 | 已覆盖 11 场景，可扩展更多边界用例（如多文件知识检索、长对话等） |

### 10.3 已知问题

1. `toTurnHistory()` 在 App.jsx 中已定义但不再使用（切换到 context.recent_messages 后遗留）
2. `crmPipeline.js` 中 `runCrmPipeline` 的导入在 App.jsx 中已移除，但 PlaygroundView 自己 import 使用
3. `birthday_milestone` 事件在 `eventChains.js` 中未定义（白名单 17 个但实际只有 16 个定义）

---

## 十一、关键文件速查

| 你要改什么 | 看哪个文件 |
|-----------|-----------|
| Pipeline 主流程 | `src/lib/router/pipeline.js` |
| Prompt 内容 | `src/lib/prompts/stage*.js` |
| Prompt 拼装逻辑 | `src/lib/router/promptBuilder.js` |
| 客户消歧规则 | `src/lib/router/clientResolver.js` |
| 事件链定义 | `src/lib/router/eventChains.js` |
| 会话上下文 | `src/lib/router/context.js` |
| **对话历史压缩** | `src/lib/models/openaiSummary.js`（`compressConversation`）+ `src/lib/router/context.js`（`maybeCompressHistory`） |
| Action 执行 | `src/lib/clientMutations.js` |
| Action 校验 | `src/lib/crmPipeline.js`（`validateActions`, `ACTION_SCHEMA`） |
| 前端调用入口 | `src/App.jsx`（`sendMsg`, `detailSend`） |
| 模型工厂 | `src/lib/models/factory.js` |
| 模型偏好 | `src/lib/modelSettings.js` |
| 知识源管理 | `src/lib/knowledgeSources.js` |
| **知识向量化 & 语义检索** | `src/lib/knowledgeEmbedding.js` |
| **Embedding API** | `src/lib/models/openaiEmbedding.js` |
| **Vision OCR** | `src/lib/models/openaiVision.js` |
| **材料分析** | `src/lib/models/openaiMaterial.js` |
| **Benchmark 场景** | `src/lib/benchmarkScenarios.js` |
| **运行时环境** | `src/lib/models/env.js` |
| 产品设计规范 | `principles.md` |
| 改造指令 | `prompts.md` |

---

## 十二、开发指南

### 12.1 启动开发

```bash
npm install
npm run dev     # → http://localhost:5173
```

### 12.2 运行 Benchmark

```bash
# 浏览器 UI
npm run dev     # 然后访问 http://localhost:5173/benchmark.html

# 命令行回归测试
node scripts/regression.js
```

### 12.3 新增 Action 类型

1. `crmPipeline.js` → `ACTION_WHITELIST` 添加新类型
2. `crmPipeline.js` → `ACTION_SCHEMA` 添加必填字段
3. `clientMutations.js` → `applyClientAction()` 添加处理分支
4. `prompts/stage3Write.js` → 在 Action 列表中添加描述

### 12.4 新增 Event Chain 类型

1. `prompts/stage3Write.js` → LIFE EVENT 白名单添加新类型
2. `router/eventChains.js` → `EVENT_CHAINS` 添加展开规则

### 12.5 新增 LLM Provider

1. 创建 `models/newProvider.js`，实现 caller 接口
2. `models/factory.js` → `MODEL_PROVIDERS` 添加配置
3. `.env.local` 添加 `VITE_NEWPROVIDER_API_KEY`

### 12.6 修改 Prompt

Prompt 模板在 `src/lib/prompts/*.js` 中以 JS 字符串常量导出。修改模板后无需重启，Vite HMR 会自动生效。

### 12.7 新增 Benchmark 场景

1. `src/lib/benchmarkScenarios.js` → `SCENARIOS` 数组添加场景定义
2. `getScenarioPlan()` 中添加对应 case，定义 steps 和 evaluate 函数
3. 浏览器 UI 和命令行会自动识别新场景

### 12.8 为新知识源启用向量化

上传文件时会自动调用 `generateKnowledgeEmbedding()` 生成 embedding。如需对存量数据补刷：

```bash
node scripts/vectorize_storage.js
```

---

## 12. 主对话 Focus Session 自动归档

### 12.1 问题背景

原有系统中，主对话（Voice 页面）的对话内容不会写入到任何客户的 Timeline。只有详情页（DetailView）的对话在关闭时才会通过 `closeDetailChat` 归档。这导致：

- 用户在主对话中讨论客户 A，这些沟通记录不会出现在 A 的 Timeline 上
- 用户从客户 A 切换到 B 讨论时，A 的讨论片段完全丢失
- `newConvo()` 时只生成 `"N轮对话，涉及XX"` 这种无信息量的摘要

### 12.2 设计方案

**核心概念：Focus Segment（焦点片段）**

主对话按 `focus_client` 的切换自动分割为多个 **Focus Segment**。每个 Segment 对应一个客户在一段连续对话中的讨论片段。

```
对话流:  [张伟相关 4轮] → [focus切换] → [李梅相关 3轮] → [新对话]
         ─── segment 1 ───              ─── segment 2 ───
         归档到张伟 timeline              归档到李梅 timeline
```

**数据结构：**

```js
focusSegmentRef = useRef({
  clientId: number | null,  // 当前 focus 客户 ID
  clientName: string,        // 客户名称（用于摘要）
  startIdx: number,          // 该 segment 在 convos 数组中的起始索引
  sid: number | null         // session ID（时间戳），用于去重
});
```

### 12.3 触发时机

| 触发场景 | 行为 |
|---------|------|
| `sendMsg` 后 focus_client 从 A→B | 归档 A 的 segment → 开启 B 的 segment |
| `sendMsg` 后首次获得 focus | 初始化 segment（从对话开头开始） |
| `newConvo()` 结束对话 | 归档最后一个 focus 客户的 segment |

### 12.4 归档流程

```
触发归档 → 截取 convos[startIdx:] → 异步调用 summarizeConversationWithOpenAI
  → 生成 timeline 摘要 → 写入 client.log（src="主对话"）→ Supabase 持久化
```

**Timeline 条目结构：**

```js
{
  sid: 1713015600000,           // session ID，去重用
  d: 1713015600000,             // 排序时间戳
  dt: "04.13",                  // 显示日期
  src: "主对话",                 // 来源标记（区别于详情页的"对话"）
  tx: "讨论了张伟的续保方案...",   // LLM 生成的摘要
  ai: "主对话自动归档",           // 副标题
  history: [...]                // 完整对话记录（可回看）
}
```

### 12.5 降级策略

- 如果 LLM 摘要调用失败，回退为第一条用户消息的前 24 字
- 使用 `mainArchiveInFlightRef` 防止并发归档
- `sid` 去重机制确保同一个 segment 不会重复写入

### 12.6 Idle 超时自动结束 Session

**规则**：主对话最后一次交互后 **1 分钟** 无新消息，系统自动调用 `newConvo()` 结束当前 session。

**实现机制：**

```
用户发消息 → AI回复 → 启动/重置 60s 计时器
                        ↓
                  60s 内有新消息 → 取消旧计时器 → 重新计时
                  60s 无新消息   → 自动调用 newConvo()
                                   → 归档 focus segment 到 timeline
                                   → 重置对话状态
```

**数据结构：**

```js
idleTimerRef = useRef(null);      // setTimeout ID
newConvoRef = useRef(null);        // 始终指向最新 newConvo，避免闭包陈旧引用
```

**触发归档的三种场景：**

| 场景 | 触发方式 | 归档行为 |
|------|---------|---------|
| 用户手动点击 "new" 按钮 | 调用 `newConvo()` | 归档最后 focus segment → 清空对话 |
| 1 分钟 idle 超时 | 计时器回调 `newConvoRef.current()` | 同上 |
| focus 切换（A→B） | `sendMsg` 中检测 | 归档 A 的 segment → 开启 B 的新 segment |

**防护措施：**

- `newConvoRef` 使用 ref 模式避免计时器回调中闭包引用过期的 `newConvo`
- `newConvo()` 入口处先 `clearTimeout` 防止重复触发
- 组件卸载时 `useEffect` 清理计时器，防止内存泄漏

### 12.7 涉及文件

| 文件 | 变更 |
|-----|------|
| `src/App.jsx` | 新增 `focusSegmentRef`、`mainArchiveInFlightRef`、`idleTimerRef`、`newConvoRef`；新增 `archiveFocusSegment()`、`resetIdleTimer()`；改造 `sendMsg()` 添加 focus 切换检测 + idle 计时器重置；改造 `newConvo()` 添加最后 segment 归档 + 计时器清理 |

---

## 13. P0/P1 稳定性 & 内存优化修复

> 2026.04.13 — 共修复 4 项 P0（致命）+ 4 项 P1（重要）问题

### 13.1 P0 修复项

#### P0-1：Supabase 双写竞态

| 项目 | 说明 |
|------|------|
| **问题** | `useEffect([clients, dbHydrated])` 每次 clients 变化时做全量 `upsertClientsToSupabase(clients)`，与增量 `persistUpserts()` 产生竞态写入 |
| **影响** | 数据丢失、Supabase 写入冲突 |
| **修复** | 删除该 useEffect，仅保留增量 `persistUpserts()` 作为唯一 Supabase 同步通道 |
| **文件** | `src/App.jsx` |

#### P0-2：closeDetailChat LLM 调用无降级

| 项目 | 说明 |
|------|------|
| **问题** | `closeDetailChat` 中 `summarizeConversationWithOpenAI` 失败会导致整个归档流程中断，timeline 不写入，Supabase 不同步 |
| **影响** | 用户关闭详情对话后数据完全丢失 |
| **修复** | 在 LLM 调用外层添加 try/catch，失败时回退到第一条用户消息前 24 字作为摘要；提前保存 `sel.id`/`sel.n` 防止异步后引用变更；末尾添加 `persistUpserts` 确保 Supabase 同步 |
| **文件** | `src/App.jsx` |

#### P0-3：sendMsg 中 convos 闭包陈旧

| 项目 | 说明 |
|------|------|
| **问题** | `sendMsg` 内部引用的 `convos` 是函数定义时的快照，当 idle timer 或快速连续调用时，`convos.length` 和展开运算可能基于过时状态 |
| **影响** | Focus segment 边界计算错误，对话消息丢失 |
| **修复** | 新增 `convosRef = useRef(convos)` 并同步更新；`sendMsg` 内所有 `convos` 引用替换为 `convosRef.current` |
| **文件** | `src/App.jsx` |

#### P0-4：useEffect([clients, sel]) 潜在无限循环

| 项目 | 说明 |
|------|------|
| **问题** | `useEffect` 依赖 `[clients, sel]`，当 `setSel` 更新 sel 后又触发此 effect，可能形成更新循环 |
| **影响** | 页面卡顿、无限渲染 |
| **修复** | 新增 `selRef = useRef(sel)` 并同步；将 `sel` 从依赖数组中移除，effect 内使用 `selRef.current` |
| **文件** | `src/App.jsx` |

### 13.2 P1 修复项

#### P1-1：Supabase 写入风暴

| 项目 | 说明 |
|------|------|
| **问题** | 每次 `setClients` 后立即调用 `persistUpserts`，高频操作（如批量 action）会在短时间内产生大量 Supabase 请求 |
| **影响** | 触发 rate limit，网络阻塞 |
| **修复** | 重写 `persistUpserts`：使用 `pendingUpsertsRef`（Map）做合并队列 + `upsertTimerRef` 实现 500ms 防抖批量写入 |
| **文件** | `src/App.jsx` |

#### P1-2：React state updater 内副作用

| 项目 | 说明 |
|------|------|
| **问题** | `archiveFocusSegment` 在 `setClients(prev => { ... persistUpserts(updated); return updated; })` 中调用网络请求 |
| **影响** | 违反 React 纯函数约定，Concurrent Mode 下可能重复执行 |
| **修复** | 将 `persistUpserts` 调用移至 `setClients` 回调之外 |
| **文件** | `src/App.jsx` |

#### P1-3：DetailView 直接 mutation

| 项目 | 说明 |
|------|------|
| **问题** | `saveEdit()`、`addSocial()`、`removeSocial()`、todo 完成/删除等操作直接修改 `sel` 对象属性（如 `editingTodo.t = editVal.t`、`sel.social = [...]`） |
| **影响** | React 检测不到变更，UI 不更新或更新不一致 |
| **修复** | 全部改为不可变更新模式：`sel.todos.map(t => t === target ? {...t, ...changes} : t)` + `commitClientUpdate({ ...sel, todos: newTodos })` |
| **文件** | `src/components/DetailView.jsx` |

#### P1-4：newConvo 中 convos 闭包陈旧

| 项目 | 说明 |
|------|------|
| **问题** | idle timer 通过 `newConvoRef.current()` 调用 `newConvo`，但函数内 `convos` 仍是定义时的闭包快照 |
| **影响** | 60s 无操作自动结束时，归档的对话内容可能不完整 |
| **修复** | `newConvo` 内所有 `convos` 引用替换为 `convosRef.current` |
| **文件** | `src/App.jsx` |

### 13.3 新增 Ref 一览

| Ref | 用途 | 同步方式 |
|-----|------|---------|
| `convosRef` | 始终持有最新 `convos` 数组 | `convosRef.current = convos`（每次渲染同步） |
| `selRef` | 始终持有最新 `sel` 对象 | `selRef.current = sel`（每次渲染同步） |
| `pendingUpsertsRef` | Supabase 待写入合并队列（Map） | `persistUpserts` 内部维护 |
| `upsertTimerRef` | 防抖定时器 ID | `persistUpserts` 内部维护 |

---

## 14. 渐进式 LLM 对话压缩

> 2026.04.14 — 替换简单截断，实现基于 LLM 的语义压缩，零信息丢失

### 14.1 问题背景

原有对话历史管理采用三层简单截断：

| 层 | 机制 | 缺陷 |
|----|------|------|
| L1 | `recent_messages` 滑动窗口保留最近 10 轮 | 第 11 轮起旧对话直接丢弃，关键信息（如客户偏好、承诺）可能丢失 |
| L2 | `conversation_summary` 取最近 3 轮各截取 50/80 字 | 仅覆盖最近 3 轮，更早的对话完全不在摘要中 |
| L3 | `buildMessagesWithHistory` 每条截断到 800 字 | 字符级截断，可能截断在句子中间 |

额外问题：`openaiSummary.js` 在 session 归档时将 `history` 数组全量拼接为 transcript，无任何截断，长对话（100+ 轮）会导致 token 溢出（`context_length_exceeded` 400 错误）。

### 14.2 新架构：三级语义管理

```
┌─────────────────────────────────────────────────┐
│  compressed_summary (LLM 语义压缩，≤300字)       │ ← 第 1~N 轮的信息精华
│  "客户张伟：已婚有2子，关注教育金和重疾险，        │    由 compressConversation() 生成
│   预算月5000，已约下周三面谈，需准备方案对比表"     │
├─────────────────────────────────────────────────┤
│  conversation_summary (最近3轮快照，≤200字)       │ ← 快速参考，同步生成
├─────────────────────────────────────────────────┤
│  recent_messages [最近4~12轮原文]                 │ ← 保留完整上下文
│  { user: "...", ai: "..." }                      │
└─────────────────────────────────────────────────┘
```

### 14.3 压缩触发机制

```
对话第 1~7 轮：正常积累在 recent_messages

对话第 8 轮（达到 COMPRESS_THRESHOLD=8）触发压缩：
  ┌──────────────────────────┐
  │ 取前 4 轮 + 现有摘要     │ ──→ LLM 压缩 ──→ compressed_summary (≤300字)
  │ 保留后 4 轮在原文        │     (compressConversation)
  └──────────────────────────┘

对话第 12 轮再次触发：
  ┌──────────────────────────┐
  │ 新增的前 4 轮            │
  │ + 上次 compressed_       │ ──→ LLM 合并压缩 ──→ 新 compressed_summary
  │   summary                │
  └──────────────────────────┘
```

**关键常量：**

```js
COMPRESS_THRESHOLD = 8;     // recent_messages 积累到此数量时触发
KEEP_AFTER_COMPRESS = 4;    // 压缩后保留的最近轮数
MAX_TRANSCRIPT_CHARS = 3000; // transcript 最大字符数（约 2000 tokens）
```

### 14.4 核心函数

#### `compressConversation()` — LLM 语义压缩

```js
// src/lib/models/openaiSummary.js
export const compressConversation = async ({
  existingSummary,        // 已有的压缩摘要（可为空）
  messagesToCompress,     // 需要压缩的对话轮次 [{ user, ai }]
  focusClientName         // 当前客户名称
}) → Promise<string>      // ≤300 字的结构化摘要
```

**LLM Prompt 规则：**
1. 必须保留：客户姓名、关键需求、已达成的共识/承诺、待跟进事项、重要偏好和数字
2. 去除：寒暄、重复确认、语气词、冗余解释
3. 如果已有历史摘要，将新对话信息合并进去，去除重复信息
4. 输出纯中文文本，不超过 300 字

**降级策略：** 无 API Key 时回退到 `fallbackCompress()`（本地截断拼接）

#### `maybeCompressHistory()` — 异步压缩调度

```js
// src/lib/router/context.js
export async function maybeCompressHistory(ctx, compressFn)
  → Promise<ConversationContext | null>
```

- `recent_messages.length >= 8` 且非正在压缩中 → 触发
- 取前 N-4 轮 + `compressed_summary` → 调用 `compressFn`
- 返回新 ctx（压缩后）或 null（无需压缩/失败）

#### `getFullConversationContext()` — 合并摘要供 prompt 注入

```js
// src/lib/router/context.js
export function getFullConversationContext(ctx) → string
// 输出格式：
// [历史摘要] {compressed_summary}
// [近期对话] {conversation_summary}
```

### 14.5 Pipeline 集成

`buildMessagesWithHistory()`（`pipeline.js`）在构建 system prompt 时自动注入：

```js
let enrichedSystemPrompt = systemPrompt;
const fullContext = getFullConversationContext(ctx);
if (fullContext) {
  enrichedSystemPrompt = `${systemPrompt}\n\n## 对话记忆\n${fullContext}`;
}
```

最终发给 LLM 的结构：
```
system: 原始 prompt + "## 对话记忆\n[历史摘要] ...\n[近期对话] ..."
history: 最近 6 轮原文（每条 ≤800 字）
user: 当前用户输入
```

### 14.6 App.jsx 调用方式

在 `sendMsg` 和 `detailSend` 中，Pipeline 返回后异步触发压缩：

```js
const result = await runStagedPipeline(...);
setConversationCtx(result.ctx);

// 异步压缩（不阻塞 UI）
maybeCompressHistory(result.ctx, compressConversation).then((compressedCtx) => {
  if (compressedCtx) {
    setConversationCtx((prev) => {
      // 竞态安全：压缩期间若有新消息，只更新 compressed_summary
      if (prev.recent_messages.length <= result.ctx.recent_messages.length) {
        return compressedCtx;
      }
      return { ...prev, compressed_summary: compressedCtx.compressed_summary };
    });
  }
});
```

### 14.7 同时修复：归档摘要 token 溢出

`summarizeConversationWithOpenAI` 新增智能截断：

```js
const rawTranscript = buildTranscript(history);
const transcript = truncateTranscript(rawTranscript); // ≤3000 字
```

`truncateTranscript` 策略：保留头部 30%（开场背景）+ 尾部 70%（最新进展），中间用省略标记。

### 14.8 设计特点

| 特点 | 说明 |
|------|------|
| **零信息丢失** | 旧对话被 LLM 提炼为结构化摘要，不是简单丢弃 |
| **非阻塞** | 压缩在 Pipeline 返回后异步执行，不影响响应速度 |
| **竞态安全** | 压缩期间用户发新消息 → 只更新 compressed_summary，不覆盖新 recent_messages |
| **优雅降级** | 无 API Key → 本地截断压缩；LLM 调用失败 → 保持原状 |
| **向后兼容** | compressed_summary 是新增字段，旧上下文为空字符串不影响任何现有逻辑 |
| **成本可控** | 压缩用 gpt-4o-mini，每次约 500 token 输入 → 150 token 输出，约 $0.0001/次 |

### 14.9 涉及文件

| 文件 | 变更 |
|------|------|
| `src/lib/models/openaiSummary.js` | 新增 `compressConversation()`、`truncateTranscript()`、`buildTranscript()`、`callLLM()`、`getLLMConfig()`；重构 `summarizeConversationWithOpenAI` 加入智能截断 |
| `src/lib/router/context.js` | 新增 `compressed_summary` / `_compressing` 字段；新增 `maybeCompressHistory()`、`getFullConversationContext()`、`buildQuickSummary()`；`appendMessage` maxMessages 提升到 12 |
| `src/lib/router/pipeline.js` | `buildMessagesWithHistory` 注入 `compressed_summary` 到 system prompt；新增导入 `getFullConversationContext` |
| `src/App.jsx` | 导入 `compressConversation` + `maybeCompressHistory`；`sendMsg` 和 `detailSend` 中异步触发 LLM 压缩 |

---

*文档完。如有疑问，优先阅读 `principles.md`（产品设计哲学）和 `prompts.md`（分层改造指令）。*
