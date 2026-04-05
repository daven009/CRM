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
