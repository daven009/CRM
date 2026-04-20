/**
 * OpenAI Speech-to-Text API 封装
 * 通过后端 /api/llm/transcribe 代理调用
 * 
 * 降级策略：后端不可用时回退到浏览器 Web Speech API
 */

import { apiTranscribe } from '../apiClient.js';

const MAX_PROMPT_LENGTH = 200;

/**
 * 检测浏览器是否支持录音
 */
export const isRecordingSupported = () => {
  return !!(navigator.mediaDevices?.getUserMedia) && !!(window.MediaRecorder);
};

/**
 * 获取浏览器支持的音频 MIME 类型
 * Safari 只支持 mp4，Chrome/Firefox 支持 webm
 */
export const getSupportedMimeType = () => {
  if (typeof MediaRecorder === "undefined") return "";
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
    return "audio/webm;codecs=opus"; // Chrome, Firefox, Edge
  }
  if (MediaRecorder.isTypeSupported("audio/mp4")) {
    return "audio/mp4"; // Safari
  }
  if (MediaRecorder.isTypeSupported("audio/wav")) {
    return "audio/wav"; // Fallback
  }
  return ""; // 使用浏览器默认
};

/**
 * 获取音频文件扩展名
 */
const getFileExtension = (mimeType) => {
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
};

/**
 * 为 STT 构建引导 prompt
 * 包含客户名、行业术语、近期话题等，提高识别准确率
 */
export function buildSTTPrompt(clients = [], conversationCtx = null) {
  const parts = ["RelateAI CRM."];

  const names = clients
    .slice(0, 20)
    .map((c) => c.n)
    .filter(Boolean);
  if (names.length > 0) {
    parts.push(`客户：${names.join(", ")}.`);
  }

  try {
    const raw = localStorage.getItem("crm.settings.v1");
    if (raw) {
      const settings = JSON.parse(raw);
      const keywords = Array.isArray(settings.keywords) ? settings.keywords : [];
      if (keywords.length > 0) {
        parts.push(`术语：${keywords.slice(0, 15).join(", ")}.`);
      }
    }
  } catch {
    // ignore
  }

  const focus = conversationCtx?.focus_client;
  if (focus?.name) {
    parts.push(`当前讨论：${focus.name}.`);
  }

  return parts.join(" ").slice(0, MAX_PROMPT_LENGTH);
}

/**
 * 调用后端 STT API 转写音频
 * 
 * @param {Blob} audioBlob - 录音的 audio Blob
 * @param {Object} [options]
 * @param {string} [options.prompt] - 引导 prompt
 * @param {string} [options.language] - BCP-47 语言代码
 * @returns {Promise<{ text: string, language?: string, duration?: number }>}
 */
export async function transcribeAudio(audioBlob, options = {}) {
  return apiTranscribe(audioBlob, {
    prompt: options.prompt?.slice(0, MAX_PROMPT_LENGTH),
    language: options.language,
  });
}

/**
 * 检查后端 STT 服务是否可用
 * 后端模式下始终返回 true（Key 由后端管理）
 */
export const hasTranscribeApiKey = () => true;
