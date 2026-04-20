/**
 * Pipeline API 路由
 * 
 * POST /api/pipeline/run  — 运行分层 CRM Pipeline
 * 
 * 前端只需发送 { message, context, clients, provider, options }
 * 后端完成 Stage 1~4 编排后返回 { reply, actions, intents, ctx, debug }
 */
import { Router } from 'express';
import { runPipeline } from '../lib/pipeline.js';

const router = Router();

/* ─── POST /api/pipeline/run ──────────────────────── */
router.post('/run', async (req, res, next) => {
  try {
    const {
      message,
      context,
      clients = [],
      provider = 'minimax',
      options = {}
    } = req.body;

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'message 不能为空' });
    }

    const result = await runPipeline(
      message.trim(),
      clients,
      context || {},
      provider,
      options
    );

    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
