/**
 * 资料解析
 * 通过后端 /api/llm/analyze-material 代理调用
 */
import { apiAnalyzeMaterial } from '../apiClient.js';

export const analyzeMaterialWithOpenAI = async ({ filename, kind, extractedText = "", parsedPreview = null }) => {
  return apiAnalyzeMaterial({ filename, kind, extractedText, parsedPreview });
};
