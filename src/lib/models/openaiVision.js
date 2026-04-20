/**
 * OpenAI Vision 封装
 * 通过后端 /api/llm/vision 代理调用
 */
import { apiVision } from '../apiClient.js';

export const analyzeScreenshotWithOpenAI = async ({ dataUrl, filename = "screenshot.png" }) => {
  return apiVision({ dataUrl, filename });
};
