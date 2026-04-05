# 本地部署说明

这份文档面向从 GitHub 拉取仓库后，在本地机器直接启动这个 CRM 原型。

适用范围：

- 本地开发
- 本地演示
- 本地测试
- 不依赖 Docker

## 1. 环境要求

建议环境：

- Node.js 20 或更高版本
- npm 10 或更高版本
- macOS / Linux

这个项目使用：

- TypeScript
- Express
- SQLite
- `better-sqlite3`

说明：

- 数据库默认是本地 SQLite 文件，不需要额外安装 MySQL / Postgres
- 如果你不配置 OpenAI Key，系统仍可运行，只是会走 fallback 逻辑

## 2. 拉取代码

```bash
git clone <your-github-repo-url>
cd crm
```

如果仓库目录名不是 `crm`，进入你实际 clone 下来的目录即可。

## 3. 安装依赖

```bash
npm install
```

## 4. 配置环境变量

先复制环境变量模板：

```bash
cp .env.example .env
```

当前支持的环境变量：

```env
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
PORT=3000
DATABASE_URL=
```

说明：

- `OPENAI_API_KEY`
  可选。不填也能运行，但 grounding / understanding / planner / reply composer 会更多走 fallback。
- `OPENAI_MODEL`
  可选。默认是 `gpt-4.1-mini`。
- `PORT`
  可选。默认 `3000`。
- `DATABASE_URL`
  可选。不填时默认使用本地 SQLite 文件：
  [data/crm.sqlite](/Users/shufangsong/Documents/crm/data/crm.sqlite)

如果你想显式指定数据库文件，可以写成：

```env
DATABASE_URL=./data/crm.sqlite
```

## 5. 启动方式

### 开发模式

```bash
npm run dev
```

开发模式会直接运行：

- [src/server.ts](/Users/shufangsong/Documents/crm/src/server.ts)

### 构建

```bash
npm run build
```

### 生产模式启动

```bash
npm start
```

`npm start` 运行的是编译后的：

- `dist/src/server.js`

## 6. 数据库初始化

不需要手动建表。

应用启动时会自动调用：

- [src/app.ts](/Users/shufangsong/Documents/crm/src/app.ts)
- [src/db/init.ts](/Users/shufangsong/Documents/crm/src/db/init.ts)

当前行为：

- 自动创建所需 SQLite 表
- 初始化 mock / seed 数据
- 初始化逻辑保持幂等

默认数据库文件不存在时，会自动创建目录和数据库文件。

## 7. 启动后如何验证

### 健康检查

启动后访问：

- [http://localhost:3000/health](http://localhost:3000/health)

如果你改了 `PORT`，请换成对应端口。

正常返回：

```json
{ "ok": true }
```

### Playground

可直接打开：

- [http://localhost:3000/playground](http://localhost:3000/playground)
- [http://localhost:3000/engine-playground](http://localhost:3000/engine-playground)

其中主测试页是：

- `/engine-playground`

### 主接口

主接口是：

- `POST /engine/respond`

最小示例：

```bash
curl -X POST http://localhost:3000/engine/respond \
  -H "Content-Type: application/json" \
  -d '{
    "now": "2026-04-05T10:00:00+08:00",
    "input_text": "今天和王总聊了10分钟，他对我们的报价很感兴趣，下周要把产品demo发给他。"
  }'
```

## 8. 运行测试

```bash
npm test
```

当前测试包含：

- `/engine/respond`
- grounding
- 联系人确认
- query answering
- action planning
- action execution
- SQLite 真实写库验证

## 9. 常见问题

### 9.1 启动时报数据库路径错误

先确认：

- `DATABASE_URL` 是否为空或指向合法路径
- 当前目录是否有写权限

默认情况下，项目会自动创建 `data/` 目录。

### 9.2 不配置 OpenAI Key 能不能跑

可以。

只是以下能力会更多依赖 fallback：

- grounding
- understanding
- clue extraction
- action planning
- assistant reply

系统仍然可以本地跑通最小闭环。

### 9.3 为什么接口能跑，但效果不如预期

因为当前仓库还是 MVP / prototype。

当前已实现：

- 联系人确认
- 最小 query answering
- 最小 action execution
- grounding + understanding

当前还没实现：

- 完整 action system
- session 持久化
- KB / embedding
- 长期 memory
- 语音
- 多 agent

### 9.4 本地数据库如何重置

如果你使用默认 SQLite 文件，可以停止服务后删除：

- [data/crm.sqlite](/Users/shufangsong/Documents/crm/data/crm.sqlite)

下次启动时会自动重新初始化。

## 10. 推荐本地启动流程

如果你只是想把仓库 pull 下来快速跑起来，按下面顺序即可：

```bash
git clone <your-github-repo-url>
cd crm
npm install
cp .env.example .env
npm run dev
```

然后打开：

- [http://localhost:3000/engine-playground](http://localhost:3000/engine-playground)

## 11. 相关文档

- [README.md](/Users/shufangsong/Documents/crm/README.md)
- [docs/TECHNICAL_STATE.md](/Users/shufangsong/Documents/crm/docs/TECHNICAL_STATE.md)
- [docs/product_decisions.md](/Users/shufangsong/Documents/crm/docs/product_decisions.md)
- [docs/unified_prd.md](/Users/shufangsong/Documents/crm/docs/unified_prd.md)
