/**
 * Supabase 数据层 — 通过后端 API 代理
 * 
 * Phase 2 迁移：前端不再直连 Supabase，所有数据操作通过后端 /api/data/* 路由。
 * 接口签名保持不变，上层业务代码（App.jsx、SettingsView.jsx）无感切换。
 */
import { normalizeKnowledgeSource } from "./knowledgeSources";
import {
  apiLoadClients,
  apiUpsertClients,
  apiDeleteClient,
  apiLoadSettings,
  apiUpsertSettings,
  apiUploadContactFile,
  apiDeleteContactFile,
} from "./apiClient";

/**
 * 后端模式下始终视为 "已启用"
 * （实际可用性由后端检测，不可用时后端返回 503）
 */
export const isSupabaseEnabled = () => true;

/**
 * 兼容旧代码 — 后端模式下不再暴露 Supabase Client
 * @returns {null}
 */
export const getSupabaseClient = () => null;

/* ─── 行数据 ↔ 前端模型 转换（保留供脚本和测试使用）── */
const normalizeArray = (value) => (Array.isArray(value) ? value : []);

export const fromDbClient = (row) => ({
  id: Number(row.id),
  n: row.n || "",
  co: row.co || "",
  role: row.role || "",
  tel: row.tel || "",
  hp: Number.isFinite(Number(row.hp)) ? Number(row.hp) : 50,
  bd: row.bd || "",
  ps: row.ps || "待了解",
  traits: normalizeArray(row.traits),
  todos: normalizeArray(row.todos),
  log: normalizeArray(row.log),
  social: normalizeArray(row.social),
  files: normalizeArray(row.files),
  from: row.source || "Supabase",
  refs: normalizeArray(row.refs),
  gifts: normalizeArray(row.gifts)
});

export const toDbClient = (client) => ({
  id: Number(client.id),
  n: client.n || "",
  co: client.co || "",
  role: client.role || "",
  tel: client.tel || "",
  hp: Number.isFinite(Number(client.hp)) ? Number(client.hp) : 50,
  bd: client.bd || "",
  ps: client.ps || "待了解",
  traits: normalizeArray(client.traits),
  todos: normalizeArray(client.todos),
  log: normalizeArray(client.log),
  social: normalizeArray(client.social),
  files: normalizeArray(client.files),
  source: client.from || "CRM",
  refs: normalizeArray(client.refs),
  gifts: normalizeArray(client.gifts),
  updated_at: new Date().toISOString()
});

/* ─── Clients CRUD — 代理到后端 ────────────────────── */

/**
 * 加载所有客户
 * 后端已完成 DB → 前端格式转换，直接返回
 */
export const loadClientsFromSupabase = () => apiLoadClients();

/**
 * 批量 upsert 客户
 */
export const upsertClientsToSupabase = (clients) => {
  if (!Array.isArray(clients) || clients.length === 0) return Promise.resolve();
  return apiUpsertClients(clients);
};

/**
 * 删除客户
 */
export const deleteClientFromSupabase = (clientId) => {
  if (clientId == null) return Promise.resolve();
  return apiDeleteClient(clientId);
};

/* ─── Settings CRUD — 代理到后端 ───────────────────── */

/**
 * 加载设置
 */
export const loadSettingsFromSupabase = async () => {
  const settings = await apiLoadSettings();
  if (!settings) return null;
  return {
    domain: String(settings.domain || "").trim(),
    keywords: normalizeArray(settings.keywords).map((v) => String(v || "").trim()).filter(Boolean),
    knowledgeFiles: normalizeArray(settings.knowledgeFiles).map((item) => normalizeKnowledgeSource(item)).filter(Boolean),
    modelProvider: String(settings.modelProvider || "").trim()
  };
};

/**
 * 保存设置
 */
export const upsertSettingsToSupabase = (settings = {}) => apiUpsertSettings(settings);

/* ─── Storage — 代理到后端 ─────────────────────────── */

/**
 * 上传联系人文件
 * @param {{ clientId: number, file: File }}
 * @returns {Promise<{ bucket: string, path: string, publicUrl: string }>}
 */
export const uploadContactFileToStorage = ({ clientId, file }) => {
  if (!file) throw new Error("未选择文件。");
  return apiUploadContactFile({ clientId, file });
};

/**
 * 删除 Storage 文件
 * @param {{ bucket?: string, path: string }}
 */
export const deleteContactFileFromStorage = ({ bucket, path }) => {
  if (!path) return Promise.resolve();
  return apiDeleteContactFile({ bucket, path });
};
