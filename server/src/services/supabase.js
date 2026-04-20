/**
 * Supabase 数据服务层
 * 
 * 封装所有 Supabase 数据库（crm_clients, crm_settings）和 Storage（crm-contact-files）操作。
 * 前端不再直连 Supabase，统一通过后端 API 代理。
 */
import { createClient } from '@supabase/supabase-js';
import { config } from '../config/env.js';

const SETTINGS_ROW_ID = 1;
const CONTACT_FILES_BUCKET = 'crm-contact-files';

/* ─── Supabase 客户端单例 ──────────────────────────── */
let clientSingleton = null;

export const isSupabaseConfigured = () =>
  Boolean(config.supabase.url && config.supabase.anonKey);

const getClient = () => {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase 未配置（缺少 SUPABASE_URL 或 SUPABASE_ANON_KEY）');
  }
  if (!clientSingleton) {
    clientSingleton = createClient(config.supabase.url, config.supabase.anonKey);
  }
  return clientSingleton;
};

/* ─── 工具函数 ─────────────────────────────────────── */
const normalizeArray = (value) => (Array.isArray(value) ? value : []);

const sanitizeFilename = (name) =>
  String(name || 'file')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

/* ─── 客户数据 ↔ 数据库行 转换 ─────────────────────── */
export const fromDbClient = (row) => ({
  id: Number(row.id),
  n: row.n || '',
  co: row.co || '',
  role: row.role || '',
  tel: row.tel || '',
  hp: Number.isFinite(Number(row.hp)) ? Number(row.hp) : 50,
  bd: row.bd || '',
  ps: row.ps || '待了解',
  traits: normalizeArray(row.traits),
  todos: normalizeArray(row.todos),
  log: normalizeArray(row.log),
  social: normalizeArray(row.social),
  files: normalizeArray(row.files),
  from: row.source || 'Supabase',
  refs: normalizeArray(row.refs),
  gifts: normalizeArray(row.gifts),
});

export const toDbClient = (client) => ({
  id: Number(client.id),
  n: client.n || '',
  co: client.co || '',
  role: client.role || '',
  tel: client.tel || '',
  hp: Number.isFinite(Number(client.hp)) ? Number(client.hp) : 50,
  bd: client.bd || '',
  ps: client.ps || '待了解',
  traits: normalizeArray(client.traits),
  todos: normalizeArray(client.todos),
  log: normalizeArray(client.log),
  social: normalizeArray(client.social),
  files: normalizeArray(client.files),
  source: client.from || 'CRM',
  refs: normalizeArray(client.refs),
  gifts: normalizeArray(client.gifts),
  updated_at: new Date().toISOString(),
});

/* ─── Clients CRUD ─────────────────────────────────── */

/**
 * 加载所有客户
 * @returns {Promise<Array>}
 */
export const loadClients = async () => {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('crm_clients')
    .select('*')
    .order('id', { ascending: true });

  if (error) throw error;
  return (data || []).map(fromDbClient);
};

/**
 * 批量 upsert 客户
 * @param {Array} clients - 前端格式的客户数组
 */
export const upsertClients = async (clients) => {
  const supabase = getClient();

  const payload = (clients || [])
    .filter((c) => c && c.id != null)
    .map(toDbClient);

  if (payload.length === 0) return;

  const { error } = await supabase
    .from('crm_clients')
    .upsert(payload, { onConflict: 'id' });

  if (error) throw error;
};

/**
 * 删除客户
 * @param {number} clientId
 */
export const deleteClient = async (clientId) => {
  const supabase = getClient();
  if (clientId == null) return;

  const { error } = await supabase
    .from('crm_clients')
    .delete()
    .eq('id', Number(clientId));

  if (error) throw error;
};

/* ─── Settings CRUD ────────────────────────────────── */

/**
 * 加载设置
 * @returns {Promise<Object|null>}
 */
export const loadSettings = async () => {
  const supabase = getClient();

  const { data, error } = await supabase
    .from('crm_settings')
    .select('*')
    .eq('id', SETTINGS_ROW_ID)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    domain: String(data.domain || '').trim(),
    keywords: normalizeArray(data.keywords).map((v) => String(v || '').trim()).filter(Boolean),
    knowledgeFiles: normalizeArray(data.knowledge_files),
    modelProvider: String(data.model_provider || '').trim(),
  };
};

/**
 * 保存设置
 * @param {Object} settings
 */
export const upsertSettings = async (settings = {}) => {
  const supabase = getClient();

  const payload = {
    id: SETTINGS_ROW_ID,
    domain: String(settings.domain || '').trim(),
    keywords: normalizeArray(settings.keywords).map((v) => String(v || '').trim()).filter(Boolean),
    knowledge_files: normalizeArray(settings.knowledgeFiles),
    model_provider: String(settings.modelProvider || '').trim(),
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('crm_settings')
    .upsert(payload, { onConflict: 'id' });

  if (error) throw error;
};

/* ─── Storage (文件上传/删除) ──────────────────────── */

/**
 * 上传联系人文件到 Storage
 * @param {{ clientId: number, buffer: Buffer, filename: string, mimeType: string }}
 * @returns {Promise<{ bucket: string, path: string, publicUrl: string }>}
 */
export const uploadContactFile = async ({ clientId, buffer, filename, mimeType }) => {
  const supabase = getClient();

  const timestamp = Date.now();
  const safeName = sanitizeFilename(filename || 'upload');
  const path = `${Number(clientId)}/${timestamp}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from(CONTACT_FILES_BUCKET)
    .upload(path, buffer, {
      cacheControl: '3600',
      upsert: false,
      contentType: mimeType || 'application/octet-stream',
    });

  if (uploadError) throw uploadError;

  const { data } = supabase.storage
    .from(CONTACT_FILES_BUCKET)
    .getPublicUrl(path);

  return {
    bucket: CONTACT_FILES_BUCKET,
    path,
    publicUrl: data?.publicUrl || '',
  };
};

/**
 * 删除 Storage 中的文件
 * @param {{ bucket?: string, path: string }}
 */
export const deleteContactFile = async ({ bucket, path }) => {
  if (!path) return;
  const supabase = getClient();

  const { error } = await supabase.storage
    .from(bucket || CONTACT_FILES_BUCKET)
    .remove([path]);

  if (error) throw error;
};
