import { createClient } from "@supabase/supabase-js";

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || "").trim();
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim();

let clientSingleton = null;

export const isSupabaseEnabled = () => Boolean(supabaseUrl && supabaseAnonKey);

export const getSupabaseClient = () => {
  if (!isSupabaseEnabled()) return null;
  if (!clientSingleton) {
    clientSingleton = createClient(supabaseUrl, supabaseAnonKey);
  }
  return clientSingleton;
};

const normalizeArray = (value) => (Array.isArray(value) ? value : []);
const SETTINGS_ROW_ID = 1;
const CONTACT_FILES_BUCKET = "crm-contact-files";

const sanitizeFilename = (name) => String(name || "file")
  .replace(/[^a-zA-Z0-9._-]+/g, "-")
  .replace(/-+/g, "-")
  .replace(/^-|-$/g, "");

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

export const loadClientsFromSupabase = async () => {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("crm_clients")
    .select("*")
    .order("id", { ascending: true });

  if (error) throw error;
  return (data || []).map(fromDbClient);
};

export const upsertClientsToSupabase = async (clients) => {
  const supabase = getSupabaseClient();
  if (!supabase) return;

  const payload = (clients || [])
    .filter((c) => c && c.id != null)
    .map(toDbClient);

  if (payload.length === 0) return;

  const { error } = await supabase
    .from("crm_clients")
    .upsert(payload, { onConflict: "id" });

  if (error) throw error;
};

export const deleteClientFromSupabase = async (clientId) => {
  const supabase = getSupabaseClient();
  if (!supabase || clientId == null) return;

  const { error } = await supabase
    .from("crm_clients")
    .delete()
    .eq("id", Number(clientId));

  if (error) throw error;
};

export const loadSettingsFromSupabase = async () => {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("crm_settings")
    .select("*")
    .eq("id", SETTINGS_ROW_ID)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    domain: String(data.domain || "").trim(),
    keywords: normalizeArray(data.keywords).map((v) => String(v || "").trim()).filter(Boolean),
    knowledgeFiles: normalizeArray(data.knowledge_files),
    modelProvider: String(data.model_provider || "").trim()
  };
};

export const upsertSettingsToSupabase = async (settings = {}) => {
  const supabase = getSupabaseClient();
  if (!supabase) return;

  const payload = {
    id: SETTINGS_ROW_ID,
    domain: String(settings.domain || "").trim(),
    keywords: normalizeArray(settings.keywords).map((v) => String(v || "").trim()).filter(Boolean),
    knowledge_files: normalizeArray(settings.knowledgeFiles),
    model_provider: String(settings.modelProvider || "").trim(),
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase
    .from("crm_settings")
    .upsert(payload, { onConflict: "id" });

  if (error) throw error;
};

export const uploadContactFileToStorage = async ({ clientId, file }) => {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("未配置 Supabase，无法上传文件。");
  if (!file) throw new Error("未选择文件。");

  const timestamp = Date.now();
  const safeName = sanitizeFilename(file.name || "upload");
  const path = `${Number(clientId)}/${timestamp}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from(CONTACT_FILES_BUCKET)
    .upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || "application/octet-stream"
    });

  if (uploadError) throw uploadError;

  const { data } = supabase.storage
    .from(CONTACT_FILES_BUCKET)
    .getPublicUrl(path);

  return {
    bucket: CONTACT_FILES_BUCKET,
    path,
    publicUrl: data?.publicUrl || ""
  };
};

export const deleteContactFileFromStorage = async ({ bucket = CONTACT_FILES_BUCKET, path }) => {
  const supabase = getSupabaseClient();
  if (!supabase || !path) return;

  const { error } = await supabase.storage
    .from(bucket || CONTACT_FILES_BUCKET)
    .remove([path]);

  if (error) throw error;
};
