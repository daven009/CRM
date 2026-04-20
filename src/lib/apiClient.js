/**
 * 后端 API 客户端
 * 
 * 前端所有 LLM 调用通过此模块转发到后端 /api/llm/*
 * 不再直接调用第三方 API，API Key 不再暴露
 */

/** 后端 API 基础 URL（开发时 Vite proxy 会代理到 localhost:3001） */
const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

/** API Key（可选，用于后端鉴权） */
const API_KEY = import.meta.env.VITE_API_SECRET_KEY || '';

/**
 * 构建通用请求头（自动携带 API Key）
 */
const buildHeaders = (extra = {}) => {
  const headers = { ...extra };
  if (API_KEY) {
    headers['X-API-Key'] = API_KEY;
  }
  return headers;
};

/**
 * 通用请求封装
 */
const apiFetch = async (path, options = {}) => {
  const url = `${API_BASE}${path}`;
  const resp = await fetch(url, {
    headers: buildHeaders({ 'Content-Type': 'application/json', ...options.headers }),
    ...options,
  });

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || `API 请求失败 (${resp.status})`);
  }

  return resp.json();
};

/**
 * 通用 Chat 请求（支持 OpenAI / Claude / MiniMax）
 * @param {Array} messages - OpenAI 格式消息数组
 * @param {Object} [options]
 * @param {string} [options.provider] - 'openai' | 'claude' | 'minimax'
 * @param {number} [options.temperature]
 * @returns {Promise<Object>} OpenAI 兼容格式的返回
 */
export const apiChat = (messages, { provider = 'openai', temperature } = {}) =>
  apiFetch('/llm/chat', {
    method: 'POST',
    body: JSON.stringify({ messages, provider, temperature }),
  });

/**
 * 语音转文字 (STT)
 * @param {Blob} audioBlob - 录音 Blob
 * @param {Object} [options] - { prompt, language }
 * @returns {Promise<{ text: string, language?: string, duration?: number }>}
 */
export const apiTranscribe = async (audioBlob, options = {}) => {
  const formData = new FormData();
  // 确定文件扩展名
  const mimeType = audioBlob.type || 'audio/webm';
  let ext = 'webm';
  if (mimeType.includes('mp4')) ext = 'mp4';
  else if (mimeType.includes('wav')) ext = 'wav';

  formData.append('file', new File([audioBlob], `recording.${ext}`, { type: mimeType }));
  if (options.prompt) formData.append('prompt', options.prompt);
  if (options.language) formData.append('language', options.language);

  const url = `${API_BASE}/llm/transcribe`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(),
    body: formData,
    // 注意：不设置 Content-Type，让浏览器自动添加 multipart boundary
  });

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || `STT 请求失败 (${resp.status})`);
  }

  return resp.json();
};

/**
 * 文本向量化 (Embedding)
 * @param {string|string[]} input - 文本或文本数组
 * @param {Object} [options] - { model, dimensions }
 * @returns {Promise<number[][]>} 向量数组
 */
export const apiEmbedding = async (input, options = {}) => {
  const data = await apiFetch('/llm/embedding', {
    method: 'POST',
    body: JSON.stringify({ input, ...options }),
  });
  return data.embeddings;
};

/**
 * 图片分析 (Vision)
 * @param {Object} params - { dataUrl, filename }
 * @returns {Promise<Object>}
 */
export const apiVision = (params) =>
  apiFetch('/llm/vision', {
    method: 'POST',
    body: JSON.stringify(params),
  });

/**
 * 对话摘要
 * @param {Object} params - { history, clientName }
 * @returns {Promise<string>}
 */
export const apiSummary = async (params) => {
  const data = await apiFetch('/llm/summary', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return data.summary;
};

/**
 * 对话压缩
 * @param {Object} params - { existingSummary, messagesToCompress, focusClientName }
 * @returns {Promise<string>}
 */
export const apiCompress = async (params) => {
  const data = await apiFetch('/llm/compress', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return data.compressed;
};

/**
 * 资料解析
 * @param {Object} params - { filename, kind, extractedText, parsedPreview }
 * @returns {Promise<Object>}
 */
export const apiAnalyzeMaterial = (params) =>
  apiFetch('/llm/analyze-material', {
    method: 'POST',
    body: JSON.stringify(params),
  });

/**
 * 健康检查
 */
export const apiHealthCheck = () => apiFetch('/health', { method: 'GET' });

/* ─── Pipeline API（核心 AI 编排）───────────────────── */

/**
 * 运行后端 Pipeline
 * @param {Object} params
 * @param {string} params.message - 用户输入
 * @param {Object} params.context - 会话上下文
 * @param {Array} params.clients - 客户列表
 * @param {string} [params.provider='minimax'] - LLM provider
 * @param {Object} [params.options={}] - 额外选项 { lockedClient, userIntelligence }
 * @returns {Promise<{ reply, actions, intents, ctx, debug, ... }>}
 */
export const apiPipelineRun = (params) =>
  apiFetch('/pipeline/run', {
    method: 'POST',
    body: JSON.stringify(params),
  });

/* ─── 数据层 API（Supabase → 后端代理）──────────────── */

/**
 * 加载所有客户
 * @returns {Promise<Array>} 客户数组
 */
export const apiLoadClients = async () => {
  const data = await apiFetch('/data/clients', { method: 'GET' });
  return data.clients || [];
};

/**
 * 批量 upsert 客户
 * @param {Array} clients - 客户数组
 */
export const apiUpsertClients = (clients) =>
  apiFetch('/data/clients', {
    method: 'POST',
    body: JSON.stringify({ clients }),
  });

/**
 * 删除客户
 * @param {number} clientId
 */
export const apiDeleteClient = (clientId) =>
  apiFetch(`/data/clients/${clientId}`, { method: 'DELETE' });

/**
 * 加载设置
 * @returns {Promise<Object|null>}
 */
export const apiLoadSettings = async () => {
  const data = await apiFetch('/data/settings', { method: 'GET' });
  return data.settings;
};

/**
 * 保存设置
 * @param {Object} settings
 */
export const apiUpsertSettings = (settings) =>
  apiFetch('/data/settings', {
    method: 'POST',
    body: JSON.stringify({ settings }),
  });

/**
 * 上传联系人文件到 Storage
 * @param {{ clientId: number, file: File }}
 * @returns {Promise<{ bucket: string, path: string, publicUrl: string }>}
 */
export const apiUploadContactFile = async ({ clientId, file }) => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('clientId', String(clientId));

  const url = `${API_BASE}/data/storage/upload`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(),
    body: formData,
  });

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || `文件上传失败 (${resp.status})`);
  }

  return resp.json();
};

/**
 * 删除 Storage 中的文件
 * @param {{ bucket?: string, path: string }}
 */
export const apiDeleteContactFile = ({ bucket, path }) =>
  apiFetch('/data/storage/delete', {
    method: 'POST',
    body: JSON.stringify({ bucket, path }),
  });
