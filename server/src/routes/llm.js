/**
 * LLM API 路由
 * 
 * POST /api/llm/chat          - 统一 Chat 代理 (OpenAI / Claude / MiniMax)
 * POST /api/llm/transcribe    - 语音转文字 (STT)
 * POST /api/llm/embedding     - 文本向量化
 * POST /api/llm/vision        - 图片分析
 * POST /api/llm/summary       - 对话摘要
 * POST /api/llm/compress      - 对话压缩
 * POST /api/llm/analyze-material - 资料解析
 */
import { Router } from 'express';
import multer from 'multer';
import { callOpenAI } from '../services/openai.js';
import { callClaude } from '../services/claude.js';
import { callMinimax } from '../services/minimax.js';
import { transcribeAudio } from '../services/transcribe.js';
import { createEmbeddings } from '../services/embedding.js';
import { analyzeScreenshot } from '../services/vision.js';
import { summarizeConversation, compressConversation } from '../services/summary.js';
import { analyzeMaterial } from '../services/material.js';

const router = Router();

// multer：处理音频文件上传（内存存储，限 25MB）
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

/* ─── 1. 统一 Chat 代理 ──────────────────────────── */
router.post('/chat', async (req, res, next) => {
  try {
    const { messages, provider = 'openai', temperature } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages 必须是数组' });
    }

    const opts = {};
    if (temperature !== undefined) opts.temperature = temperature;

    let result;
    switch (provider) {
      case 'claude':
        result = await callClaude(messages, opts);
        break;
      case 'minimax':
        result = await callMinimax(messages, opts);
        break;
      case 'openai':
      default:
        result = await callOpenAI(messages, opts);
        break;
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/* ─── 2. 语音转文字 (STT) ────────────────────────── */
router.post('/transcribe', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请上传音频文件 (field: file)' });
    }

    const { prompt, language } = req.body || {};
    const result = await transcribeAudio(
      req.file.buffer,
      req.file.mimetype,
      { prompt, language }
    );

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/* ─── 3. 文本向量化 ──────────────────────────────── */
router.post('/embedding', async (req, res, next) => {
  try {
    const { input, model, dimensions } = req.body;
    if (!input) {
      return res.status(400).json({ error: 'input 不能为空' });
    }

    const embeddings = await createEmbeddings(input, { model, dimensions });
    res.json({ embeddings });
  } catch (err) {
    next(err);
  }
});

/* ─── 4. 图片分析 (Vision) ───────────────────────── */
router.post('/vision', async (req, res, next) => {
  try {
    const { dataUrl, filename } = req.body;
    if (!dataUrl) {
      return res.status(400).json({ error: 'dataUrl 不能为空' });
    }

    const result = await analyzeScreenshot({ dataUrl, filename });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/* ─── 5. 对话摘要 ────────────────────────────────── */
router.post('/summary', async (req, res, next) => {
  try {
    const { history, clientName } = req.body;
    const summary = await summarizeConversation({ history, clientName });
    res.json({ summary });
  } catch (err) {
    next(err);
  }
});

/* ─── 6. 对话压缩 ────────────────────────────────── */
router.post('/compress', async (req, res, next) => {
  try {
    const { existingSummary, messagesToCompress, focusClientName } = req.body;
    const compressed = await compressConversation({
      existingSummary,
      messagesToCompress,
      focusClientName,
    });
    res.json({ compressed });
  } catch (err) {
    next(err);
  }
});

/* ─── 7. 资料解析 ────────────────────────────────── */
router.post('/analyze-material', async (req, res, next) => {
  try {
    const { filename, kind, extractedText, parsedPreview } = req.body;
    if (!filename) {
      return res.status(400).json({ error: 'filename 不能为空' });
    }

    const result = await analyzeMaterial({ filename, kind, extractedText, parsedPreview });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
