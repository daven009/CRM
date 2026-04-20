/**
 * 数据 API 路由
 * 
 * GET    /api/data/clients              - 加载所有客户
 * POST   /api/data/clients              - 批量 upsert 客户
 * DELETE /api/data/clients/:id          - 删除客户
 * GET    /api/data/settings             - 加载设置
 * POST   /api/data/settings             - 保存设置
 * POST   /api/data/storage/upload       - 上传联系人文件
 * POST   /api/data/storage/delete       - 删除 Storage 文件
 */
import { Router } from 'express';
import multer from 'multer';
import {
  isSupabaseConfigured,
  loadClients,
  upsertClients,
  deleteClient,
  loadSettings,
  upsertSettings,
  uploadContactFile,
  deleteContactFile,
} from '../services/supabase.js';

const router = Router();

/* ─── 文件上传 MIME 类型白名单 ──────────────────── */
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',    // xlsx
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'application/vnd.ms-excel',      // xls
  'application/msword',            // doc
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'text/plain', 'text/csv',
  'audio/webm', 'audio/mp4', 'audio/wav', 'audio/mpeg',
];

/**
 * multer 文件过滤器：只允许白名单 MIME 类型
 */
const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`不支持的文件类型: ${file.mimetype}`), false);
  }
};

// multer：处理文件上传（内存存储，限 50MB，MIME 白名单）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter,
});

/* ─── 中间件：检查 Supabase 是否已配置 ─────────────── */
router.use((req, res, next) => {
  if (!isSupabaseConfigured()) {
    return res.status(503).json({
      error: 'Supabase 未配置',
      detail: '请在 server/.env 中配置 SUPABASE_URL 和 SUPABASE_ANON_KEY',
    });
  }
  next();
});

/* ─── 1. 客户：加载 ───────────────────────────────── */
router.get('/clients', async (req, res, next) => {
  try {
    const clients = await loadClients();
    res.json({ clients });
  } catch (err) {
    next(err);
  }
});

/* ─── 2. 客户：批量 upsert ────────────────────────── */
router.post('/clients', async (req, res, next) => {
  try {
    const { clients } = req.body;
    if (!Array.isArray(clients) || clients.length === 0) {
      return res.status(400).json({ error: 'clients 必须是非空数组' });
    }
    await upsertClients(clients);
    res.json({ ok: true, count: clients.length });
  } catch (err) {
    next(err);
  }
});

/* ─── 3. 客户：删除 ───────────────────────────────── */
router.delete('/clients/:id', async (req, res, next) => {
  try {
    const clientId = Number(req.params.id);
    if (!Number.isFinite(clientId)) {
      return res.status(400).json({ error: '无效的客户 ID' });
    }
    await deleteClient(clientId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ─── 4. 设置：加载 ───────────────────────────────── */
router.get('/settings', async (req, res, next) => {
  try {
    const settings = await loadSettings();
    res.json({ settings });
  } catch (err) {
    next(err);
  }
});

/* ─── 5. 设置：保存 ───────────────────────────────── */
router.post('/settings', async (req, res, next) => {
  try {
    const { settings } = req.body;
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: 'settings 不能为空' });
    }
    await upsertSettings(settings);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ─── 6. Storage：上传文件 ────────────────────────── */
router.post('/storage/upload', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请上传文件 (field: file)' });
    }

    const clientId = Number(req.body.clientId);
    if (!Number.isFinite(clientId)) {
      return res.status(400).json({ error: '无效的 clientId' });
    }

    const result = await uploadContactFile({
      clientId,
      buffer: req.file.buffer,
      filename: req.file.originalname || 'upload',
      mimeType: req.file.mimetype || 'application/octet-stream',
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/* ─── 7. Storage：删除文件 ────────────────────────── */
router.post('/storage/delete', async (req, res, next) => {
  try {
    const { bucket, path } = req.body;
    if (!path) {
      return res.status(400).json({ error: 'path 不能为空' });
    }

    // 路径遍历防护：只允许合法的 Storage 路径格式 (如 "123/1234567890-filename.pdf")
    if (/\.\./.test(path) || path.startsWith('/')) {
      return res.status(400).json({ error: '无效的文件路径', code: 'INVALID_PATH' });
    }

    await deleteContactFile({ bucket, path });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
