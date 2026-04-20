/**
 * RelateAI CRM Backend Server
 * Express 入口文件
 */
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config/env.js';
import { errorHandler, requestLogger } from './middleware/errorHandler.js';
import { apiAuth } from './middleware/auth.js';
import llmRoutes from './routes/llm.js';
import dataRoutes from './routes/data.js';
import pipelineRoutes from './routes/pipeline.js';
import { isSupabaseConfigured } from './services/supabase.js';

const app = express();

/* ─── 安全中间件 ──────────────────────────────────── */

// Helmet：设置安全 HTTP 响应头
app.use(helmet());

// CORS：收紧为白名单域名
app.use(cors({
  origin: config.corsOrigins,
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'X-API-Key'],
}));

// 全局速率限制：100 次/分钟/IP
app.use(rateLimit({
  windowMs: 60_000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '请求过于频繁，请稍后再试', code: 'RATE_LIMIT' },
}));

/* ─── 基础中间件 ──────────────────────────────────── */
app.use(express.json({ limit: '50mb' }));        // Vision API 需要传 base64 图片
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

/* ─── 健康检查（无需鉴权）────────────────────────── */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

/* ─── API Key 鉴权（保护所有业务路由）────────────── */
app.use('/api/llm', apiAuth);
app.use('/api/data', apiAuth);
app.use('/api/pipeline', apiAuth);

/* ─── LLM 路由（额外加严速率限制）────────────────── */
app.use('/api/llm', rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'LLM API 请求过于频繁，请稍后再试', code: 'LLM_RATE_LIMIT' },
}));
app.use('/api/llm', llmRoutes);

/* ─── 数据路由（写入加严速率限制）────────────────── */
app.use('/api/data', rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '数据 API 请求过于频繁，请稍后再试', code: 'DATA_RATE_LIMIT' },
}));
app.use('/api/data', dataRoutes);

/* ─── Pipeline 路由（核心 AI 编排，加严速率限制）──── */
app.use('/api/pipeline', rateLimit({
  windowMs: 60_000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Pipeline 请求过于频繁，请稍后再试', code: 'PIPELINE_RATE_LIMIT' },
}));
app.use('/api/pipeline', pipelineRoutes);

/* ─── 错误处理 ────────────────────────────────────── */
app.use(errorHandler);

/* ─── 启动 ────────────────────────────────────────── */
app.listen(config.port, () => {
  console.log(`\n🚀 RelateAI Server running on http://localhost:${config.port}`);
  console.log(`   Health check: http://localhost:${config.port}/api/health`);
  console.log(`   LLM API:      http://localhost:${config.port}/api/llm/*`);
  console.log(`   Data API:     http://localhost:${config.port}/api/data/*`);
  console.log(`   Pipeline API: http://localhost:${config.port}/api/pipeline/run`);
  console.log(`\n   Providers configured:`);
  console.log(`     OpenAI:    ${config.openai.apiKey ? '✅' : '❌'}`);
  console.log(`     Claude:    ${config.claude.apiKey ? '✅' : '❌'}`);
  console.log(`     MiniMax:   ${config.minimax.apiKey ? '✅' : '❌'}`);
  console.log(`     Supabase:  ${isSupabaseConfigured() ? '✅' : '❌'}`);
  console.log(`\n   Security:`);
  console.log(`     API Key:   ${config.apiSecretKey ? '✅ 已启用' : '⚠️ 未配置（开放访问）'}`);
  console.log(`     CORS:      ${config.corsOrigins.join(', ')}`);
  console.log(`     Helmet:    ✅`);
  console.log(`     Rate Limit: ✅ (全局 100/min, LLM 20/min, Data 60/min, Pipeline 15/min)`);
  console.log('');
});
