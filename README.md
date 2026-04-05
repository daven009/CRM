# CRM_PG 部署文档

这是一个基于 **React + Vite** 的 CRM 前端项目，支持：
- 本地开发与构建部署
- 可选 Supabase 数据持久化
- 可选 MiniMax API 能力

---

## 1. 环境要求

- Node.js：建议 **20.x 或以上**
- npm：建议 **10.x 或以上**

检查版本：

```bash
node -v
npm -v
```

---

## 2. 获取代码并安装依赖

```bash
git clone <你的仓库地址>
cd CRM_PG
npm install
```

如果你朋友拿的是 Git 镜像，直接在项目根目录执行：

```bash
npm install
```

---

## 3. 配置环境变量

在项目根目录创建 `.env.local`（不要提交到仓库）：

```bash
cp .env.example .env.local
```

如果没有 `.env.example`，可手动新建 `.env.local`，内容参考：

```env
# ===== Supabase（可选，但建议配置） =====
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=

# ===== MiniMax（可选，使用 Playground AI 功能时需要） =====
VITE_MINIMAX_API_KEY=
VITE_MINIMAX_MODEL=MiniMax-M2.5
VITE_MINIMAX_API_URL=https://api.minimax.io/v1/text/chatcompletion_v2
VITE_MINIMAX_GROUP_ID=
```

### 变量说明
- `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`：用于开启云端数据同步。
- `VITE_MINIMAX_API_KEY`：未配置时，AI 能力会报错（Playground 中会提示）。

---

## 4. 初始化 Supabase（可选）

如果要启用数据同步，请在 Supabase SQL Editor 执行以下 SQL：

```sql
create table if not exists public.crm_clients (
  id bigint primary key,
  n text default '',
  co text default '',
  role text default '',
  tel text default '',
  hp integer default 50,
  bd text default '',
  ps text default '待了解',
  traits jsonb default '[]'::jsonb,
  todos jsonb default '[]'::jsonb,
  log jsonb default '[]'::jsonb,
  social jsonb default '[]'::jsonb,
  files jsonb default '[]'::jsonb,
  source text default 'CRM',
  refs jsonb default '[]'::jsonb,
  gifts jsonb default '[]'::jsonb,
  updated_at timestamptz default now()
);

alter table public.crm_clients enable row level security;

-- 示例策略（按需调整）
create policy "allow read" on public.crm_clients
for select using (true);

create policy "allow write" on public.crm_clients
for insert with check (true);

create policy "allow update" on public.crm_clients
for update using (true);

create policy "allow delete" on public.crm_clients
for delete using (true);
```

> 说明：上面是便于快速联调的开放策略，生产环境请改成严格的鉴权策略。

---

## 5. 本地开发

```bash
npm run dev
```

默认访问：`http://localhost:5173`

---

## 6. 构建生产包

```bash
npm run build
```

构建产物目录：`dist/`

可本地预览：

```bash
npm run preview
```

---

## 7. 部署到 Nginx（推荐）

### 7.1 上传文件
将 `dist/` 目录全部内容上传到服务器目录（示例）：
- `/var/www/crm_pg/dist`

### 7.2 Nginx 配置示例

```nginx
server {
    listen 80;
    server_name your-domain.com;

    root /var/www/crm_pg/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
}
```

### 7.3 重载 Nginx

```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## 8. 常见问题

- 构建失败：先确认 Node 版本符合要求，并删除 `node_modules` 后重装。
- 页面空白/刷新 404：检查 Nginx 是否配置了 `try_files ... /index.html`。
- Supabase 不生效：确认 `.env.local` 的 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY` 正确。
- AI 功能报错：确认 `VITE_MINIMAX_API_KEY` 已配置且可用。

---

## 9. 常用命令汇总

```bash
npm install      # 安装依赖
npm run dev      # 本地开发
npm run build    # 生产构建
npm run preview  # 预览构建产物
npm run lint     # 代码检查
```
