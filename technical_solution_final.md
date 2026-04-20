# RelateAI — 最终技术方案文档

> 智能 CRM 系统 · React + Express 前后端分离 · 多 LLM 支持 · 分层 Pipeline 架构  
> 最后更新：2026.04.20

---

## 〇、快速定位指南

| 你想了解… | 跳转到 |
|-----------|--------|
| 项目是什么、技术栈 | [一、项目概述](#一项目概述) |
| 目录结构 | [二、项目结构](#二项目结构) |
| 前后端整体架构 | [三、整体架构](#三整体架构) |
| 核心 Pipeline 怎么工作 | [四、Pipeline 引擎](#四pipeline-引擎) |
| 后端 API 接口协议 | [五、后端 API 接口协议](#五后端-api-接口协议) |
| 后端模块功能 | [六、后端模块详解](#六后端模块详解) |
| 前端模块功能 | [七、前端模块详解](#七前端模块详解) |
| 数据模型 | [八、数据模型](#八数据模型) |
| LLM 模型层 | [九、LLM-模型层](#九llm-模型层) |
| Prompt 体系 | [十、Prompt 分层体系](#十prompt-分层体系) |
| 安全机制 | [十一、安全机制](#十一安全机制) |
| 知识向量化 & 语义检索 | [十二、知识向量化与语义检索](#十二知识向量化与语义检索) |
| 环境变量配置 | [十三、环境变量配置](#十三环境变量配置) |
| 启动 & 部署 | [十四、启动与部署](#十四启动与部署) |
| 开发指南 | [十五、开发指南](#十五开发指南) |
| 已知问题 & 待办 | [十六、当前进展与待办](#十六当前进展与待办) |

---

## 一、项目概述

**RelateAI** 是一个面向保险中介（及关系型销售人员）的智能 CRM 系统。

### 核心设计哲学

- **AI 主动，用户被动** — 打开 app，AI 告诉用户该做什么
- **语音优先** — 用户在外面跑，没时间打字
- **零数据录入** — 用户说话就是录入，AI 负责理解、提取、存储

### 技术栈

| 层 | 技术 |
|---|------|
| 前端框架 | React 19 + JSX |
| 构建工具 | Vite 8 |
| 后端框架 | Express 5 (Node.js) |
| 语言 | JavaScript (ES Modules)，**不使用 TypeScript** |
| LLM | MiniMax M2.5 / Claude / OpenAI（多 Provider 工厂模式） |
| 数据持久化 | Supabase（PostgreSQL + Storage，后端代理） |
| 安全 | API Key 鉴权 + Helmet + CORS 白名单 + 速率限制 |
| 部署 | 前端静态 SPA + 后端 Node.js 服务 |

### 架构演进

| 阶段 | 架构 | 状态 |
|------|------|------|
| Phase 1-2 | 前端直连 LLM API → 后端代理 LLM API | ✅ 已完成 |
| Phase 3 | API Key 鉴权 + 安全加固 | ✅ 已完成 |
| Phase 4 | Pipeline 整体迁移到后端 | ✅ 已完成 |

---

## 二、项目结构

```
CRM/
├── index.html                        # Vite 入口 HTML
├── benchmark.html                    # Benchmark 独立入口 HTML
├── package.json                      # 前端依赖管理
├── vite.config.js                    # Vite 配置（react 插件 + proxy + 多入口）
├── .env.local                        # 前端环境变量（仅 VITE_API_SECRET_KEY）
├── principles.md                     # 产品设计哲学 & 完整流水线规范
├── prompts.md                        # Prompt 分层改造指令文档
├── technical_solution.md             # 旧版技术文档
├── technical_solution_final.md       # ← 本文件（最新）
│
├── .runtime/                         # 运行时状态（PID 文件等）
│   └── server.pid
│
├── scripts/                          # 命令行脚本（Node.js 环境）
│   ├── regression.js                 # Pipeline 回归测试运行器
│   ├── regression-scenarios.js       # 回归测试场景定义
│   ├── model_benchmark.js            # 模型基准测试
│   ├── test_embedding.js             # Embedding API 测试
│   ├── vectorize_storage.js          # 存量知识源批量向量化
│   └── serve_dist.py                 # 构建产物静态服务器
│
├── server/                           # ★ 后端服务（Express）
│   ├── package.json                  # 后端依赖
│   ├── .env                          # 后端环境变量（API Key、DB 配置等）
│   ├── .env.example                  # 环境变量模板
│   └── src/
│       ├── index.js                  # Express 入口（中间件 + 路由注册）
│       ├── config/
│       │   └── env.js                # 环境变量集中管理
│       ├── middleware/
│       │   ├── auth.js               # API Key 鉴权中间件
│       │   └── errorHandler.js       # 错误处理 + 请求日志
│       ├── routes/
│       │   ├── pipeline.js           # ★ POST /api/pipeline/run
│       │   ├── llm.js                # /api/llm/* (7 个端点)
│       │   └── data.js               # /api/data/* (7 个端点)
│       ├── lib/                      # ★ Pipeline 核心逻辑
│       │   ├── pipeline.js           # ★ Pipeline 引擎 runPipeline()（498行）
│       │   ├── pipelineUtils.js      # 常量、校验、JSON 解析等工具
│       │   ├── promptBuilder.js      # Prompt 拼装工厂
│       │   ├── clientResolver.js     # 客户消歧（fuzzy + 启发式 + LLM）
│       │   ├── eventChains.js        # 17 种事件链展开
│       │   ├── context.js            # 会话上下文管理（不可变更新）
│       │   └── knowledgeSources.js   # 知识源标准化 & 上下文构建
│       ├── prompts/                  # Prompt 模板（JS 常量导出）
│       │   ├── index.js              # 统一导出
│       │   ├── systemHeader.js       # 模块 0：共享 Header
│       │   ├── stage1Classifier.js   # 模块 1：意图分类
│       │   ├── stage2Disambiguate.js # 模块 2：客户消歧 LLM 兜底
│       │   ├── stage3Main.js         # 模块 3.0：Action 生成主框架
│       │   ├── stage3Write.js        # 模块 3.1：写操作能力
│       │   ├── stage3Readonly.js     # 模块 3.2：只读能力
│       │   ├── stage3Generate.js     # 模块 3.3：内容生成
│       │   └── stage4Shortcircuit.js # 模块 4：短路回复
│       └── services/                 # 外部服务封装
│           ├── llmCaller.js          # ★ LLM Caller 工厂（Pipeline 专用）
│           ├── openai.js             # OpenAI Chat API
│           ├── claude.js             # Claude API
│           ├── minimax.js            # MiniMax API
│           ├── shared.js             # 共享工具（extractTextFromModelResponse）
│           ├── supabase.js           # Supabase 数据层（CRUD + Storage）
│           ├── embedding.js          # 文本向量化 API
│           ├── transcribe.js         # 语音转文字 (STT)
│           ├── vision.js             # 图片分析 (Vision OCR)
│           ├── summary.js            # 对话摘要 + 压缩
│           └── material.js           # 资料解析
│
└── src/                              # 前端源码
    ├── main.jsx                      # Vite 主入口
    ├── benchmark.jsx                 # Benchmark 独立入口
    ├── App.jsx                       # ★ 主应用（状态管理中心，~950行）
    ├── App.css / index.css           # 样式
    ├── components/                   # 8 个页面组件
    │   ├── VoiceView.jsx             # 语音对话主页
    │   ├── CardsView.jsx             # 客户卡片列表
    │   ├── DetailView.jsx            # 客户详情页
    │   ├── LogView.jsx               # 对话日志页
    │   ├── SettingsView.jsx          # 设置页
    │   ├── BenchmarkView.jsx         # Pipeline Benchmark
    │   ├── PlaygroundView.jsx        # AI Playground V1（旧 Pipeline）
    │   └── PlaygroundView2.jsx       # AI Playground V2
    ├── hooks/
    │   └── useVoiceRecorder.js       # 语音录制 Hook
    └── lib/                          # 核心逻辑层
        ├── apiClient.js              # ★ 后端 API 客户端（前端唯一出口）
        ├── crmPipeline.js            # 旧版 Pipeline（Playground 使用）
        ├── clientMutations.js        # Action 执行器
        ├── knowledgeSources.js       # 知识源标准化
        ├── knowledgeEmbedding.js     # 知识源 Embedding + 语义检索
        ├── materialParsers.js        # 文件解析（PDF/XLSX/DOCX）
        ├── modelSettings.js          # 模型偏好设置
        ├── benchmarkScenarios.js     # Benchmark 场景定义
        ├── supabaseClient.js         # 前端 Supabase 客户端（仍保留，渐进迁移）
        ├── models/                   # LLM 模型适配层（前端→后端代理）
        │   ├── index.js / factory.js / env.js / shared.js
        │   ├── openai.js / claude.js / minimax.js
        │   ├── openaiEmbedding.js / openaiVision.js
        │   ├── openaiMaterial.js / openaiSummary.js
        │   └── openaiTranscribe.js
        ├── prompts/                  # Prompt 模板（前端副本，Playground 使用）
        │   └── [同 server/src/prompts/]
        └── router/                   # 前端 Pipeline（仅 Playground/Benchmark 使用）
            ├── pipeline.js
            ├── promptBuilder.js / context.js
            ├── clientResolver.js / eventChains.js
```

---

## 三、整体架构

### 3.1 系统架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                         前端 (React SPA)                         │
│                                                                  │
│  App.jsx ──→ apiPipelineRun() ──→ POST /api/pipeline/run        │
│              apiChat()         ──→ POST /api/llm/chat            │
│              apiTranscribe()   ──→ POST /api/llm/transcribe      │
│              apiEmbedding()    ──→ POST /api/llm/embedding       │
│              apiVision()       ──→ POST /api/llm/vision          │
│              apiSummary()      ──→ POST /api/llm/summary         │
│              apiCompress()     ──→ POST /api/llm/compress        │
│              apiAnalyzeMaterial()→ POST /api/llm/analyze-material│
│              apiLoadClients()  ──→ GET  /api/data/clients        │
│              apiUpsertClients()──→ POST /api/data/clients        │
│              ...                                                 │
│                                                                  │
│  所有 HTTP 请求统一通过 src/lib/apiClient.js                      │
│  自动携带 X-API-Key 请求头                                        │
│  开发环境由 Vite proxy 代理到 localhost:3001                       │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTP (JSON / FormData)
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│                    后端 (Express 5, Port 3001)                   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 中间件栈                                                  │   │
│  │ helmet → cors(白名单) → rateLimit(全局100/min) →         │   │
│  │ express.json → requestLogger                              │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  GET /api/health                     ← 无需鉴权，返回 {status}   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ apiAuth 鉴权（X-API-Key 校验）                             │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  /api/pipeline/* ← rateLimit(15/min) ← Pipeline 路由             │
│  /api/llm/*      ← rateLimit(20/min) ← LLM 路由（7 端点）       │
│  /api/data/*     ← rateLimit(60/min) ← 数据路由（7 端点）       │
│                                                                  │
│  ┌──────────────────────┐  ┌──────────────────────────────┐    │
│  │ Pipeline 引擎         │  │ 外部服务                      │    │
│  │ lib/pipeline.js       │──│ services/openai.js           │    │
│  │ Stage 1→2→3→4 编排    │  │ services/claude.js           │    │
│  │ 直接调用 LLM（无 HTTP）│  │ services/minimax.js          │    │
│  └──────────────────────┘  │ services/supabase.js         │    │
│                             │ services/embedding.js        │    │
│                             │ services/vision.js ...       │    │
│                             └──────────┬───────────────────┘    │
└──────────────────────────────────────── │ ───────────────────────┘
                                          ↓
                              ┌──────────────────────┐
                              │  外部 API             │
                              │  OpenAI / Claude /    │
                              │  MiniMax / Supabase   │
                              └──────────────────────┘
```

### 3.2 核心数据流（用户发送消息）

```
用户输入 "张伟太太怀孕了"
    ↓
前端 App.jsx sendMsg()
    ↓
apiPipelineRun({
  message: "张伟太太怀孕了",
  context: conversationCtx,
  clients: [...],
  provider: "minimax",
  options: { userIntelligence: { domain, keywords, knowledgeFiles } }
})
    ↓ HTTP POST /api/pipeline/run
后端 routes/pipeline.js
    ↓
lib/pipeline.js: runPipeline()
    ├─ Stage 1: 意图分类 → RECORD, client_mentions: ["张伟"]
    ├─ Stage 2: 客户消歧 → fuzzy 唯一命中张伟 (id:1)
    ├─ Stage 3: Action 生成 → trigger_event_chain(spouse_pregnancy)
    ├─ Stage 5: Event Chain 展开 → 4条 add_todo + 1条 add_trait
    └─ Stage 8: 调用统计
    ↓
返回 { reply, actions:[5], intents, ctx, debug }
    ↓
前端接收结果
    ├─ setConversationCtx(result.ctx)
    ├─ 显示 AI 回复
    ├─ applyPlaygroundActions(result.actions) → 逐条执行 Action
    │   └─ clientMutations.applyClientAction() → 更新客户数据
    ├─ persistUpserts() → 异步写入 Supabase（500ms 防抖）
    └─ maybeCompressHistory() → 异步压缩对话历史（非阻塞）
```

---

## 四、Pipeline 引擎

> **核心文件**：`server/src/lib/pipeline.js`（498 行）

### 4.1 Pipeline 流程图

```
用户输入
    ↓
┌───────────────────────────────────────────────────────────┐
│  STAGE 1：意图分类（LLM 调用）                               │
│  输入：用户文本 + 客户简报 + 历史上下文                        │
│  输出：intents[], client_mentions[], is_focus_change        │
└───────────────────────┬───────────────────────────────────┘
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
│ + 知识源上下文             │   │    fuzzySearch → 0 命中：新客户?    │
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
                               │   RECORD/COMMAND → write 模块         │
                               │   QUERY/KNOWLEDGE/CHAT → readonly     │
                               │   GENERATE/RECOMMEND → generate       │
                               │ + 知识源上下文                        │
                               │ 输出：reply + actions[]               │
                               └──────────────┬──────────────────────┘
                                              ↓
                               ┌──────────────────────────────────────┐
                               │ STAGE 5：Event Chain 展开（程序侧）    │
                               │ trigger_event_chain → 展开为          │
                               │ add_todo + add_trait                   │
                               └──────────────┬──────────────────────┘
                                              ↓
                               ┌──────────────────────────────────────┐
                               │ STAGE 8：调用统计                      │
                               │ 更新上下文 → 返回统一结构              │
                               └──────────────────────────────────────┘
```

### 4.2 函数签名

```js
// server/src/lib/pipeline.js
export async function runPipeline(
  inputText,        // string: 用户输入
  clients,          // Array: 客户列表（前端传入完整数据）
  ctx,              // Object: 会话上下文
  modelProvider,    // string: 'minimax' | 'claude' | 'openai'
  options           // { lockedClient?: Object, userIntelligence?: Object }
) → Promise<{
  reply: string,           // AI 回复文本
  actions: Array,          // Action 数组（已展开 event chain）
  intents: Array,          // 意图数组
  ctx: Object,             // 更新后的会话上下文
  confidence: number,      // 置信度
  needsClarification: boolean,
  clarifyingQuestion: string,
  focusChange: string[],   // 焦点切换涉及的客户名
  debug: {
    stages: Array,         // 每步执行记录
    resolvedClients: Array,
    pendingCreateMentions: Array,
    shortCircuit?: boolean,
    clarification?: boolean,
  }
}>
```

### 4.3 关键设计决策

1. **每步只做一件事** — Stage 1 只分类，Stage 2 只消歧，Stage 3 只生成 Action
2. **客户消歧由程序主导** — 三层递进：`fuzzySearch` → `heuristic` → LLM → 用户澄清
3. **能力模块按需注入** — Stage 3 的 Prompt 根据 intent 类型动态拼装
4. **Event Chain 白名单** — 17 种生命事件由程序确定性展开
5. **JSON 修复循环** — `callAndParse()` 最多 2 轮修复（`MAX_REPAIR_ROUNDS`），总调用不超过 6 次
6. **后端直接调用 LLM** — Pipeline 内部直接调用 services（不经过 HTTP），减少 3~5 次网络往返

### 4.4 短路判断逻辑

| 条件 | 走向 |
|------|------|
| `clientMentions.length === 0` && 无 `lockedClient` && intents 全为 CHAT/KNOWLEDGE | Stage 4 短路 |
| 有 `lockedClient`（详情页对话） | 跳过 Stage 2 消歧，直接绑定 |
| `clientMentions.length > 0` 但 fuzzySearch 全部唯一命中 | Stage 2 自动绑定，不调 LLM |
| fuzzySearch 多命中 + 启发式成功 | Stage 2 程序侧解决 |
| 启发式失败 + LLM 消歧失败 | 返回 `needsClarification: true` |

---

## 五、后端 API 接口协议

### 5.1 通用约定

- **Base URL**: `http://localhost:3001/api`
- **Content-Type**: `application/json`（文件上传除外）
- **鉴权**: 所有业务端点需要 `X-API-Key` 请求头（`/api/health` 除外）
- **错误响应**: `{ error: string, code?: string, detail?: string }`

### 5.2 健康检查

```
GET /api/health
→ { status: "ok", timestamp: "2026-04-20T12:00:00.000Z" }
```

不需要鉴权。不暴露 provider 配置信息。

### 5.3 Pipeline API

#### `POST /api/pipeline/run`

**核心端点**。前端主对话和详情页对话均通过此端点调用 Pipeline。

**速率限制**: 15 次/分钟/IP

**请求体**:
```json
{
  "message": "张伟太太怀孕了",
  "context": {
    "user_role": "保险中介",
    "current_date": "2026-04-20",
    "current_year": 2026,
    "focus_client": { "id": 42, "name": "张伟" },
    "conversation_summary": "最近3轮快照摘要",
    "compressed_summary": "LLM压缩的历史摘要",
    "recent_messages": [
      { "user": "用户说的话", "ai": "AI的回复" }
    ]
  },
  "clients": [
    {
      "id": 1, "n": "张伟", "co": "Apex Logistics", "role": "运营总监",
      "hp": 72, "todos": [], "traits": ["理性"], "refs": [], "files": []
    }
  ],
  "provider": "minimax",
  "options": {
    "lockedClient": null,
    "userIntelligence": {
      "domain": "保险",
      "keywords": ["重疾险", "教育金"],
      "knowledgeFiles": []
    }
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `message` | string | ✅ | 用户输入文本 |
| `context` | Object | 否 | 会话上下文（首次可为空对象 `{}`） |
| `clients` | Array | 否 | 客户列表（完整数据） |
| `provider` | string | 否 | LLM 提供商，默认 `"minimax"` |
| `options.lockedClient` | Object | 否 | 详情页锁定的客户（跳过消歧） |
| `options.userIntelligence` | Object | 否 | 用户配置（domain/keywords/knowledgeFiles） |

**响应体**:
```json
{
  "reply": "已记录张伟太太怀孕的消息。我已自动生成...",
  "confidence": 0.92,
  "needsClarification": false,
  "clarifyingQuestion": "",
  "focusChange": ["张伟"],
  "intents": [
    { "type": "RECORD", "content": "记录张伟太太怀孕" }
  ],
  "actions": [
    { "type": "add_trait", "clientId": 1, "trait": "即将为人父母" },
    { "type": "add_todo", "clientId": 1, "todo": "发送孕期祝福消息", "days": 0 },
    { "type": "add_todo", "clientId": 1, "todo": "第二孕期电话问候", "days": 90 }
  ],
  "ctx": { "...更新后的会话上下文..." },
  "debug": {
    "stages": [
      { "title": "STAGE 1 · Intent Classification", "status": "ok", "detail": {...} },
      { "title": "STAGE 2 · Client Resolution", "status": "ok", "detail": {...} },
      { "title": "STAGE 3 · Action Generation", "status": "ok", "detail": {...} },
      { "title": "STAGE 5 · Event Chain Expansion", "status": "ok", "detail": {...} },
      { "title": "STAGE 8 · Call Statistics", "status": "ok", "detail": {...} }
    ],
    "resolvedClients": [...],
    "pendingCreateMentions": []
  }
}
```

### 5.4 LLM API (`/api/llm/*`)

**速率限制**: 20 次/分钟/IP

#### `POST /api/llm/chat` — 统一 Chat 代理

```json
// 请求
{ "messages": [{ "role": "system", "content": "..." }, { "role": "user", "content": "..." }],
  "provider": "openai",    // "openai" | "claude" | "minimax"
  "temperature": 0.2 }
// 响应：OpenAI 兼容格式
{ "choices": [{ "message": { "content": "..." } }], "usage": {...} }
```

#### `POST /api/llm/transcribe` — 语音转文字

```
Content-Type: multipart/form-data
字段: file (音频 Blob), prompt? (string), language? (string)
→ { text: "转写文本", language?: "zh", duration?: 5.2 }
```

#### `POST /api/llm/embedding` — 文本向量化

```json
{ "input": "要向量化的文本", "model": "text-embedding-3-small", "dimensions": 256 }
→ { "embeddings": [[0.1, 0.2, ...]] }
```

#### `POST /api/llm/vision` — 图片分析 (Vision OCR)

```json
{ "dataUrl": "data:image/png;base64,...", "filename": "screenshot.png" }
→ { "summary": "...", "details": [...], "tags": [...], "searchKeywords": [...], ... }
```

#### `POST /api/llm/summary` — 对话摘要

```json
{ "history": [{ "user": "...", "ai": "..." }], "clientName": "张伟" }
→ { "summary": "讨论了张伟的续保方案..." }
```

#### `POST /api/llm/compress` — 对话压缩

```json
{ "existingSummary": "已有的压缩摘要",
  "messagesToCompress": [{ "user": "...", "ai": "..." }],
  "focusClientName": "张伟" }
→ { "compressed": "结构化压缩摘要（≤300字）" }
```

#### `POST /api/llm/analyze-material` — 资料解析

```json
{ "filename": "保险方案.pdf", "kind": "document",
  "extractedText": "文档提取的文本...", "parsedPreview": null }
→ { "summary": "...", "details": [...], "tags": [...], 
    "suggestedActions": [...], "promptContext": "...", "searchKeywords": [...] }
```

### 5.5 Data API (`/api/data/*`)

**速率限制**: 60 次/分钟/IP

> **前提**：需要 Supabase 已配置，否则所有端点返回 503。

| 端点 | 方法 | 请求体 | 响应 |
|------|------|--------|------|
| `/data/clients` | GET | - | `{ clients: Array }` |
| `/data/clients` | POST | `{ clients: Array }` | `{ ok: true, count: N }` |
| `/data/clients/:id` | DELETE | - | `{ ok: true }` |
| `/data/settings` | GET | - | `{ settings: Object }` |
| `/data/settings` | POST | `{ settings: Object }` | `{ ok: true }` |
| `/data/storage/upload` | POST | `FormData: file + clientId` | `{ bucket, path, publicUrl }` |
| `/data/storage/delete` | POST | `{ bucket?, path }` | `{ ok: true }` |

**文件上传限制**: 50MB，MIME 白名单：
- 文档: `pdf, xlsx, docx, xls, doc, txt, csv`
- 图片: `png, jpeg, webp, gif`
- 音频: `webm, mp4, wav, mpeg`

**路径遍历防护**: `storage/delete` 拒绝包含 `..` 或以 `/` 开头的路径。

---

## 六、后端模块详解

### 6.1 `server/src/index.js` — Express 入口

**中间件注册顺序**（严格有序）：
1. `helmet()` — 安全 HTTP 响应头（CSP, HSTS, X-Frame-Options 等 11 个安全头）
2. `cors({ origin: 白名单, methods, allowedHeaders })` — CORS 收紧
3. `rateLimit(100/min)` — 全局速率限制
4. `express.json({ limit: '50mb' })` — JSON 解析
5. `requestLogger` — 请求日志
6. `/api/health` — 健康检查（无需鉴权）
7. `apiAuth` — API Key 鉴权（保护 `/api/llm`, `/api/data`, `/api/pipeline`）
8. 路由级速率限制 + 路由挂载
9. `errorHandler` — 统一错误处理

### 6.2 `server/src/middleware/auth.js` — API Key 鉴权

- 校验 `X-API-Key` 请求头
- 使用**常量时间比较**（`timingSafeEqual`）防止时序攻击
- 未配置 `API_SECRET_KEY` 时跳过鉴权（开发模式兼容）

### 6.3 `server/src/services/llmCaller.js` — LLM Caller 工厂

为 Pipeline 引擎提供与前端 `createLLMCaller` 一致的接口：

```js
const llm = createLLMCaller('minimax');
const response = await llm.call(messages, 'Stage1 意图分类');
const text = extractTextFromModelResponse(response);
// llm.getCallCount()  → 当前调用次数
// llm.callLog         → 调用日志 [{ label, elapsed, ok }]
// llm.model           → 当前模型名
```

支持三个 Provider：`openai`, `claude`, `minimax`，自动从 `config/env.js` 读取配置。

### 6.4 `server/src/lib/pipelineUtils.js` — Pipeline 工具函数

| 导出 | 用途 |
|------|------|
| `ACTION_WHITELIST` | 10 种合法 Action 类型 |
| `ACTION_SCHEMA` | 每种 Action 的必填字段定义 |
| `INTENT_TYPES` | 7 种意图类型 |
| `LIMITS` | 调用限制常量 |
| `parseJsonFromText(raw)` | 从模型输出中提取 JSON（支持 fence / 嵌套 / 修复） |
| `validateActions(actions)` | Action 白名单 + Schema 校验 |
| `buildRepairMessages(...)` | 构建 JSON 修复 prompt |
| `buildClientBrief(clients)` | 构建轻量客户简报（传给 Stage 1） |
| `buildMaterialContext(files)` | 构建客户资料上下文 |
| `buildTodoContext(todos)` | 构建待办上下文 |

### 6.5 `server/src/lib/clientResolver.js` — 客户消歧

**三层递进消歧**：

```
Layer 1: fuzzySearchClients(mention, clients)
  ├── 0 命中 → 可能是新客户
  ├── 1 命中 → 直接绑定 ✓
  └── N 命中 → 进入 Layer 2
         ↓
Layer 2: heuristicMatch(mention, hits, ctx, { isFocusChange })
  ├── 完全匹配姓名且唯一 → 绑定 ✓
  ├── 非焦点切换 + focus_client 在候选中 → 绑定 focus_client ✓
  └── 无法判断 → 进入 Layer 3
         ↓
Layer 3: LLM 辅助消歧 → 绑定 / 返回澄清问题
```

**模糊搜索规则**（`fuzzySearchClients`）：
1. 完全匹配
2. 名字包含 mention
3. mention 包含名字
4. 姓氏+称谓（支持 14 种：总/姐/哥/叔/阿姨/老板/经理/董事/主任/太太/先生/女士/老师/弟）
5. 英文名忽略大小写

### 6.6 `server/src/lib/eventChains.js` — 事件链展开

**17 种生命事件白名单**：
```
spouse_pregnancy, childbirth, marriage, engagement, divorce,
job_change, promotion, start_business, relocation, home_purchase,
bereavement, child_education_milestone, graduation, retirement,
critical_illness, recovery, anniversary
```

LLM 只负责识别 `eventType`，程序侧确定性展开为具体的 `add_todo` + `add_trait`：

```js
expandEventChain(clientId, eventType)
→ { actions: [...add_todo, ...add_trait], recommendedScripts: [...] }
```

### 6.7 `server/src/lib/context.js` — 会话上下文管理

**不可变更新**模式，每次返回新对象：

```js
createContext()                         // 创建新上下文
updateFocusClient(ctx, client)          // 更新焦点客户 → 新 ctx
appendMessage(ctx, userInput, aiReply)  // 追加消息 → 新 ctx（自动滚动摘要）
maybeCompressHistory(ctx, compressFn)   // 异步 LLM 压缩 → 新 ctx 或 null
getFullConversationContext(ctx)         // 合并摘要（compressed + conversation）
```

### 6.8 `server/src/services/supabase.js` — Supabase 数据层

| 功能 | 函数 | 数据库表/桶 |
|------|------|------------|
| 加载客户 | `loadClients()` | `crm_clients` |
| 写入客户 | `upsertClients(clients)` | `crm_clients` |
| 删除客户 | `deleteClient(id)` | `crm_clients` |
| 加载设置 | `loadSettings()` | `crm_settings` |
| 保存设置 | `upsertSettings(settings)` | `crm_settings` |
| 上传文件 | `uploadContactFile(...)` | Storage: `crm-contact-files` |
| 删除文件 | `deleteContactFile(...)` | Storage: `crm-contact-files` |

客户数据格式在 `fromDbClient` / `toDbClient` 中转换。

---

## 七、前端模块详解

### 7.1 `src/lib/apiClient.js` — 后端 API 客户端

**前端所有 HTTP 请求的唯一出口**。

核心机制：
- `apiFetch(path, options)` — 通用请求封装（自动携带 API Key + 错误处理）
- `buildHeaders(extra)` — 自动附加 `X-API-Key` 头
- `API_BASE` — 开发环境默认 `/api`（由 Vite proxy 代理到 localhost:3001）

**导出函数**：

| 函数 | 对应端点 |
|------|---------|
| `apiPipelineRun(params)` | `POST /api/pipeline/run` |
| `apiChat(messages, opts)` | `POST /api/llm/chat` |
| `apiTranscribe(audioBlob, opts)` | `POST /api/llm/transcribe` |
| `apiEmbedding(input, opts)` | `POST /api/llm/embedding` |
| `apiVision(params)` | `POST /api/llm/vision` |
| `apiSummary(params)` | `POST /api/llm/summary` |
| `apiCompress(params)` | `POST /api/llm/compress` |
| `apiAnalyzeMaterial(params)` | `POST /api/llm/analyze-material` |
| `apiHealthCheck()` | `GET /api/health` |
| `apiLoadClients()` | `GET /api/data/clients` |
| `apiUpsertClients(clients)` | `POST /api/data/clients` |
| `apiDeleteClient(id)` | `DELETE /api/data/clients/:id` |
| `apiLoadSettings()` | `GET /api/data/settings` |
| `apiUpsertSettings(settings)` | `POST /api/data/settings` |
| `apiUploadContactFile(...)` | `POST /api/data/storage/upload` |
| `apiDeleteContactFile(...)` | `POST /api/data/storage/delete` |

### 7.2 `src/App.jsx` — 主应用状态管理中心

**核心状态**：

```jsx
const [clients, setClients] = useState([]);      // 客户列表
const [sel, setSel] = useState(null);             // 当前选中客户
const [convos, setConvos] = useState([]);         // 主对话消息列表
const [conversationCtx, setConversationCtx] = useState(() => createContext());
const [detailCtxState, setDetailCtxState] = useState(() => createContext());
```

**关键 Ref**（解决闭包问题）：

| Ref | 用途 |
|-----|------|
| `convosRef` | 始终持有最新 `convos` 数组 |
| `selRef` | 始终持有最新 `sel` 对象 |
| `focusSegmentRef` | Focus Session 归档追踪 |
| `idleTimerRef` | 1 分钟 idle 超时计时器 |
| `newConvoRef` | 指向最新 `newConvo` 函数 |
| `mainArchiveInFlightRef` | 防并发归档 |
| `pendingUpsertsRef` | Supabase 写入防抖队列 |

**核心函数**：

| 函数 | 说明 |
|------|------|
| `sendMsg(text)` | 主对话发送消息 → `apiPipelineRun()` → 执行 Actions |
| `detailSend(text)` | 详情页发送消息 → `apiPipelineRun({ lockedClient })` |
| `applyPlaygroundActions(actions)` | 逐条执行 Action |
| `persistUpserts(updated)` | 异步写入 Supabase（500ms 防抖批量） |
| `newConvo()` | 结束当前对话（归档 focus segment + 清空） |
| `archiveFocusSegment()` | 将当前 focus 客户的对话片段归档到 Timeline |

### 7.3 `src/lib/clientMutations.js` — Action 执行器

纯函数，不产生副作用：

```js
applyClientAction(clients, action)
→ { nextClients, changedClient, ... }
```

### 7.4 前端遗留模块（Playground/Benchmark 使用）

| 模块 | 说明 |
|------|------|
| `src/lib/router/pipeline.js` | 前端版 Pipeline（`runStagedPipeline`），仅 Playground/Benchmark 使用 |
| `src/lib/crmPipeline.js` | 旧版单段 Pipeline，仅 PlaygroundView 使用 |
| `src/lib/models/*` | 前端 LLM 适配层（通过 apiClient 代理到后端） |

---

## 八、数据模型

### 8.1 客户对象（Client）

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
  traits: string[],     // 标签 ["喜欢跑步", "风险偏好稳健"]
  todos: [{
    t: string,          // 待办文本
    d: number,          // 天数偏移（负=过期）
    s: string,          // 来源 "ai" | "sys" | "手动"
    done: boolean
  }],
  log: [{               // 时间线
    dt: string,         // 日期 "MM.DD"
    src: string,        // 来源 "对话" | "主对话" | "系统" | "截图"
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
    embedding: number[], // 向量化后的 embedding（256 维，可选）
    searchKeywords: string[],
  }],
  refs: string[],       // 关系
  gifts: []             // 礼物记录
}
```

> 字段使用缩写（`n`=name, `co`=company, `hp`=health_point 等）。

### 8.2 会话上下文（ConversationContext）

```js
{
  user_role: "保险中介",
  current_date: "2026-04-20",
  current_year: 2026,
  focus_client: { id: 42, name: "张伟" } | null,
  conversation_summary: "≤200字滚动摘要",
  compressed_summary: "≤300字 LLM 语义压缩摘要",
  recent_messages: [{ user: "...", ai: "..." }],
  _compressing: false
}
```

### 8.3 Action 白名单（10 种）

```js
ACTION_WHITELIST = [
  "add_trait", "remove_trait",
  "add_todo", "complete_todo", "update_todo", "delete_todo",
  "update_profile", "add_relation", "create_profile",
  "trigger_event_chain"
];
```

### 8.4 意图类型（7 种）

| 类型 | 说明 | 产生 Action |
|------|------|------------|
| RECORD | 用户陈述客户事实 | ✅ |
| COMMAND | 用户明确下达指令 | ✅ |
| QUERY | 查询客户/任务信息 | ❌ |
| KNOWLEDGE | 行业知识问答 | ❌ |
| GENERATE | 生成文本/内容 | ❌ |
| RECOMMEND | 请求建议/策略 | ❌ |
| CHAT | 闲聊/寒暄 | ❌ |

---

## 九、LLM 模型层

### 9.1 后端 LLM 服务

| 服务文件 | Provider | 默认模型 | API URL |
|---------|----------|---------|---------|
| `services/openai.js` | OpenAI | `gpt-4o-mini` | `https://api.openai.com/v1/chat/completions` |
| `services/claude.js` | Claude | `claude-sonnet-4-20250514` | `https://api.anthropic.com/v1/messages` |
| `services/minimax.js` | MiniMax | `MiniMax-M2.5` | `https://api.minimax.io/v1/text/chatcompletion_v2` |

所有服务统一返回 **OpenAI 兼容格式**（Claude 适配器自动转换）。

### 9.2 LLM Caller 工厂

```js
// Pipeline 内部使用
const llm = createLLMCaller('minimax');
const response = await llm.call(messages, label);
const text = extractTextFromModelResponse(response);
```

### 9.3 专用服务

| 服务 | 文件 | 模型 | 用途 |
|------|------|------|------|
| Embedding | `services/embedding.js` | `text-embedding-3-small` (256维) | 知识源/文件向量化 |
| Vision | `services/vision.js` | `gpt-4o-mini` | 截图 OCR、图片分析 |
| Transcribe | `services/transcribe.js` | `whisper-1` | 语音转文字 |
| Summary | `services/summary.js` | `gpt-4o-mini` | 对话摘要、历史压缩 |
| Material | `services/material.js` | `gpt-4o-mini` | 文档资料分析 |

---

## 十、Prompt 分层体系

### 10.1 模板组织（1 + 1 + 3 + 1）

```
模块 0 · systemHeader.js          → 所有 Stage 共享的头部
  ↓ 被注入到 ↓
模块 1 · stage1Classifier.js      → Stage 1：意图分类
模块 2 · stage2Disambiguate.js    → Stage 2：客户消歧 LLM 兜底
模块 3.0 · stage3Main.js          → Stage 3：Action 生成主框架
  ↓ 动态注入以下模块 ↓
  ├── 3.1 · stage3Write.js        → RECORD/COMMAND 时注入
  ├── 3.2 · stage3Readonly.js     → QUERY/KNOWLEDGE/CHAT 时注入
  └── 3.3 · stage3Generate.js     → GENERATE/RECOMMEND 时注入
模块 4 · stage4Shortcircuit.js    → Stage 4：短路回复
```

### 10.2 模板变量

所有模板使用 `{{variable}}` 占位符，由 `promptBuilder.js` 的 `renderTemplate()` 替换。

**共享 Header 变量**：`{{user_role}}`, `{{current_date}}`, `{{current_year}}`, `{{focus_client_or_null}}`, `{{conversation_summary}}`

### 10.3 Prompt 输出 JSON 格式

| Stage | 输出结构 |
|-------|---------|
| Stage 1 | `{ intents, client_mentions, is_focus_change, needs_clarification, confidence }` |
| Stage 2 | `{ resolved_client_id, reasoning, needs_clarification, clarifying_question }` |
| Stage 3 | `{ reply, actions, confidence }` |
| Stage 4 | `{ reply, actions: [], confidence }` |

---

## 十一、安全机制

### 11.1 安全层总览

| 机制 | 实现 | 说明 |
|------|------|------|
| **API Key 鉴权** | `middleware/auth.js` | 静态 Key，常量时间比较防时序攻击 |
| **Helmet** | `helmet()` | 11 个安全响应头（CSP, HSTS, X-Frame-Options 等） |
| **CORS 白名单** | `cors({ origin: config.corsOrigins })` | 默认仅允许 `localhost:5173` |
| **全局速率限制** | `express-rate-limit` | 100 次/分钟/IP |
| **路由级速率限制** | | LLM: 20/min, Data: 60/min, Pipeline: 15/min |
| **文件上传白名单** | `multer + fileFilter` | MIME 类型白名单 |
| **路径遍历防护** | `/storage/delete` | 拒绝 `..` 和 `/` 开头的路径 |
| **错误脱敏** | `errorHandler.js` | 不暴露内部堆栈 |
| **健康检查脱敏** | `/api/health` | 不暴露 provider 配置信息 |

### 11.2 API Key 鉴权流程

```
前端请求 → Headers: { X-API-Key: "xxxxx" }
    ↓
middleware/auth.js
    ├── config.apiSecretKey 为空 → 跳过鉴权（开发模式）
    ├── 无 X-API-Key 头 → 401 MISSING_API_KEY
    ├── Key 不匹配 → 401 INVALID_API_KEY
    └── 匹配 → next()
```

---

## 十二、知识向量化与语义检索

### 12.1 Embedding 配置

| 配置项 | 值 |
|--------|-----|
| 模型 | `text-embedding-3-small` |
| 维度 | 256（降维） |
| API | `services/embedding.js` → OpenAI Embedding API |

### 12.2 检索策略（前端实现）

`retrieveRelevantKnowledge(sources, ctx, options)` 三路融合：

| 路径 | 条件 | 方法 |
|------|------|------|
| 语义搜索 | 有 embedding | 余弦相似度 + 关键词加成（+0.15） |
| 关键词回退 | 无 embedding | 名称/关键词/标签/摘要加权匹配 |
| 强制纳入 | 用户提到名称 | 分数设为 1.0 |

### 12.3 后端 Pipeline 中的知识源

当前后端 Pipeline 使用静态丰富度排序（`buildKnowledgeContext`），不做 embedding 检索。前端仍保留完整的语义检索能力供 Playground/Benchmark 使用。

---

## 十三、环境变量配置

### 13.1 后端 `server/.env`

```env
# === Server ===
PORT=3001

# === Security ===
API_SECRET_KEY=<32字节随机hex>
CORS_ORIGINS=http://localhost:5173

# === OpenAI ===
OPENAI_API_KEY=sk-xxx
OPENAI_MODEL=gpt-4o-mini
OPENAI_API_URL=https://api.openai.com/v1/chat/completions
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_VISION_MODEL=gpt-4o-mini

# === MiniMax ===
MINIMAX_API_KEY=sk-xxx
MINIMAX_MODEL=MiniMax-M2.5
MINIMAX_GROUP_ID=
MINIMAX_API_URL=https://api.minimax.io/v1/text/chatcompletion_v2

# === Claude ===
CLAUDE_API_KEY=sk-ant-xxx
CLAUDE_MODEL=claude-sonnet-4-20250514
CLAUDE_API_URL=https://api.anthropic.com/v1/messages

# === Supabase ===
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=xxx
```

### 13.2 前端 `.env.local`

```env
# 后端 API 地址（开发时由 Vite proxy 代理，无需配置）
# VITE_API_BASE_URL=https://your-server.com/api

# API Key（与 server/.env 中的 API_SECRET_KEY 保持一致）
VITE_API_SECRET_KEY=<同 API_SECRET_KEY>
```

### 13.3 Vite Proxy 配置

```js
// vite.config.js
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:3001',
      changeOrigin: true,
    }
  }
}
```

---

## 十四、启动与部署

### 14.1 开发环境启动

**方式一：一键启动**
```bash
cd CRM
npm run dev:all
# 同时启动后端（:3001）和前端（:5173）
```

**方式二：分开启动**
```bash
# 终端 1 — 后端
cd CRM/server && npm run dev    # node --watch src/index.js

# 终端 2 — 前端
cd CRM && npm run dev           # vite → :5173
```

**验证**：
```bash
curl http://localhost:3001/api/health
# → {"status":"ok","timestamp":"..."}

# 打开浏览器 → http://localhost:5173
```

### 14.2 依赖安装

```bash
cd CRM && npm install           # 前端依赖
cd CRM/server && npm install    # 后端依赖
```

### 14.3 后端依赖清单

```json
{
  "@supabase/supabase-js": "^2.103.3",
  "cors": "^2.8.5",
  "dotenv": "^16.4.7",
  "express": "^5.1.0",
  "express-rate-limit": "^8.3.2",
  "helmet": "^8.1.0",
  "multer": "^1.4.5-lts.2"
}
```

### 14.4 NPM Scripts

| 脚本 | 说明 |
|------|------|
| `npm run dev` | 启动前端 Vite 开发服务器 |
| `npm run dev:server` | 启动后端（带 `--watch` 热重载） |
| `npm run dev:all` | 同时启动前后端 |
| `npm run build` | 构建前端生产产物 |
| `npm run test` | 运行 Pipeline 回归测试 |

---

## 十五、开发指南

### 15.1 新增 Action 类型

1. `server/src/lib/pipelineUtils.js` → `ACTION_WHITELIST` + `ACTION_SCHEMA` 添加
2. `src/lib/crmPipeline.js` → 同步添加（前端副本）
3. `src/lib/clientMutations.js` → `applyClientAction()` 添加处理分支
4. `server/src/prompts/stage3Write.js` → Prompt 中添加 Action 描述

### 15.2 新增 Event Chain 类型

1. `server/src/prompts/stage3Write.js` → LIFE EVENT 白名单添加
2. `server/src/lib/eventChains.js` → `EVENT_CHAINS` 添加展开规则
3. 同步前端副本 `src/lib/router/eventChains.js`

### 15.3 新增 LLM Provider

1. 创建 `server/src/services/newProvider.js`
2. `server/src/services/llmCaller.js` → `PROVIDERS` 添加
3. `server/src/config/env.js` → 添加配置项
4. `server/.env.example` → 添加模板

### 15.4 修改 Prompt

编辑 `server/src/prompts/stage*.js`。模板使用 `{{variable}}` 占位符，由 `promptBuilder.js` 替换。

### 15.5 新增 API 端点

1. 在 `server/src/routes/` 中对应文件添加路由
2. 在 `server/src/index.js` 中注册（含鉴权 + 速率限制）
3. 在 `src/lib/apiClient.js` 中添加前端调用函数

### 15.6 关键文件速查表

| 你要改什么 | 看哪个文件 |
|-----------|-----------|
| Pipeline 主流程 | `server/src/lib/pipeline.js` |
| Pipeline 工具函数/常量 | `server/src/lib/pipelineUtils.js` |
| Prompt 内容 | `server/src/prompts/stage*.js` |
| Prompt 拼装逻辑 | `server/src/lib/promptBuilder.js` |
| 客户消歧规则 | `server/src/lib/clientResolver.js` |
| 事件链定义 | `server/src/lib/eventChains.js` |
| 会话上下文 | `server/src/lib/context.js` |
| LLM Caller 工厂 | `server/src/services/llmCaller.js` |
| 各 LLM 服务 | `server/src/services/openai.js` / `claude.js` / `minimax.js` |
| Supabase 数据层 | `server/src/services/supabase.js` |
| 后端入口/中间件 | `server/src/index.js` |
| 后端配置 | `server/src/config/env.js` |
| API 鉴权 | `server/src/middleware/auth.js` |
| **前端 API 客户端** | `src/lib/apiClient.js` |
| **前端状态管理** | `src/App.jsx` |
| Action 执行 | `src/lib/clientMutations.js` |
| 知识向量化 | `src/lib/knowledgeEmbedding.js` |
| 文件解析 | `src/lib/materialParsers.js` |
| 模型偏好 | `src/lib/modelSettings.js` |
| 产品设计规范 | `principles.md` |

---

## 十六、当前进展与待办

### 16.1 ✅ 已完成

| 模块 | 说明 |
|------|------|
| Phase 1-2: 前后端分离 | 所有 LLM API Key 迁移到后端，前端通过 apiClient 代理 |
| Phase 3: 安全加固 | API Key 鉴权 + Helmet + CORS + Rate Limit + 文件上传加固 |
| Phase 4: Pipeline 后迁 | Pipeline 完整迁移到后端，前端仅 1 次 HTTP 调用 |
| 分层 Pipeline 引擎 | Stage 1~4 编排，含 JSON 修复循环 |
| 客户消歧系统 | 三层递进（fuzzy → heuristic → LLM → 用户澄清） |
| Event Chain 系统 | 17 种生命事件白名单，程序侧确定性展开 |
| 知识向量化 & 语义检索 | embedding + 余弦相似度 + 关键词回退 |
| 渐进式对话历史压缩 | LLM 语义压缩，三级管理（compressed + summary + recent） |
| Focus Session 自动归档 | 主对话按 focus_client 分割归档到 Timeline |
| Supabase 数据层 | 后端统一代理，前端不再直连 |
| Benchmark 系统 | 11 个场景，浏览器 + 命令行双入口 |

### 16.2 🔲 待完成

| 项目 | 优先级 | 说明 |
|------|--------|------|
| 后端 Pipeline 语义检索 | 高 | 当前后端 Pipeline 使用静态丰富度排序，未做 embedding 检索 |
| 被动触发系统 | 中 | "打开 app 建议"、"每日健康度重算"、"周报" |
| 语音输入 | 中 | VoiceView 有录音 UI，后端 STT 已就绪，前端未完全接通 |
| 前端完全迁移到 apiClient | 低 | 部分组件仍通过前端 models 层调用（如 Playground） |
| 差异化模型选择 | 低 | Stage 1 用小模型、Stage 3 用大模型 |

### 16.3 已知问题

1. `toTurnHistory()` 在 App.jsx 中已定义但不再使用
2. 前端 `src/lib/router/pipeline.js` 仍被 Playground/Benchmark 使用（仅此场景需要）
3. `birthday_milestone` 事件在 `eventChains.js` 白名单中但未定义展开规则

---

## 附录 A：Supabase 数据库表结构

### `crm_clients` 表

| 列名 | 类型 | 说明 |
|------|------|------|
| `id` | int8 (PK) | 客户 ID |
| `n` | text | 姓名 |
| `co` | text | 公司 |
| `role` | text | 职位 |
| `tel` | text | 电话 |
| `hp` | int4 | 健康度 |
| `bd` | text | 生日 |
| `ps` | text | 备注 |
| `traits` | jsonb | 标签数组 |
| `todos` | jsonb | 待办数组 |
| `log` | jsonb | 时间线 |
| `social` | jsonb | 社交账号 |
| `files` | jsonb | 附件 |
| `source` | text | 来源 |
| `refs` | jsonb | 关系 |
| `gifts` | jsonb | 礼物 |
| `updated_at` | timestamptz | 更新时间 |

### `crm_settings` 表

| 列名 | 类型 | 说明 |
|------|------|------|
| `id` | int4 (PK) | 固定为 1 |
| `domain` | text | 行业领域 |
| `keywords` | jsonb | 关键词数组 |
| `knowledge_files` | jsonb | 知识库文件数组 |
| `model_provider` | text | 默认模型提供商 |
| `updated_at` | timestamptz | 更新时间 |

### Storage Bucket

- **桶名**: `crm-contact-files`
- **路径格式**: `{clientId}/{timestamp}-{sanitized_filename}`

---

## 附录 B：对话历史压缩机制

### 三级语义管理架构

```
┌─────────────────────────────────────────────────┐
│  compressed_summary (LLM 语义压缩，≤300字)       │ ← 第 1~N 轮的信息精华
├─────────────────────────────────────────────────┤
│  conversation_summary (最近3轮快照，≤200字)       │ ← 快速参考
├─────────────────────────────────────────────────┤
│  recent_messages [最近4~12轮原文]                 │ ← 保留完整上下文
└─────────────────────────────────────────────────┘
```

### 压缩触发

- `COMPRESS_THRESHOLD = 8` — recent_messages 积累到 8 轮时触发
- `KEEP_AFTER_COMPRESS = 4` — 压缩后保留最近 4 轮
- 压缩在 Pipeline 返回后**异步执行**（不阻塞 UI）
- 竞态安全：压缩期间有新消息 → 只更新 `compressed_summary`

### 注入到 LLM Prompt

```
system: 原始 prompt + "## 对话记忆\n[历史摘要] ...\n[近期对话] ..."
history: 最近 6 轮原文（每条 ≤800 字）
user: 当前用户输入
```

---

*文档完。如有疑问，优先阅读 `principles.md`（产品设计哲学）和 `prompts.md`（分层改造指令）。*
