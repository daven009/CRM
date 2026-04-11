import { getAvailableModels } from "./models/index.js";

export const SETTINGS_KEY = "crm.settings.v1";
export const DEFAULT_MODEL_PROVIDER = "openai";

export const loadModelProviderPreference = () => {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return "";
    const parsed = JSON.parse(raw);
    return String(parsed?.modelProvider || "").trim();
  } catch {
    return "";
  }
};

export const resolveModelProviderPreference = () => {
  const available = getAvailableModels();
  const preferred = loadModelProviderPreference();
  const preferredConfigured = available.find((model) => model.id === preferred && model.configured);
  if (preferredConfigured) return preferredConfigured.id;
  return available.find((model) => model.configured)?.id || DEFAULT_MODEL_PROVIDER;
};
