/**
 * OpenAI Speech-to-Text API 封装
 * 支持 gpt-4o-mini-transcribe 模型，优化中英混杂识别
 * 
 * 降级策略：无 API Key 时回退到浏览器 Web Speech API
 */

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY || "";
const TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe";
const MAX_PROMPT_LENGTH = 200; // Whisper/Transcribe prompt token 限制

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
 * 
 * @param {Array} clients - 客户列表
 * @param {Object} [conversationCtx] - 当前对话上下文
 * @returns {string}
 */
export function buildSTTPrompt(clients = [], conversationCtx = null) {
  const parts = ["RelateAI CRM."];

  // 注入客户名（中英文名）— 最多 20 个
  const names = clients
    .slice(0, 20)
    .map((c) => c.n)
    .filter(Boolean);
  if (names.length > 0) {
    parts.push(`客户：${names.join(", ")}.`);
  }

  // 注入行业术语（从 Settings 读取）
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

  // 注入当前焦点客户名（优先级最高）
  const focus = conversationCtx?.focus_client;
  if (focus?.name) {
    parts.push(`当前讨论：${focus.name}.`);
  }

  return parts.join(" ").slice(0, MAX_PROMPT_LENGTH);
}

/**
 * 调用 OpenAI Transcription API
 * 
 * @param {Blob} audioBlob - 录音的 audio Blob
 * @param {Object} [options]
 * @param {string} [options.prompt] - 引导 prompt（提高专有名词准确率）
 * @param {string} [options.language] - BCP-47 语言代码，不传则自动检测
 * @returns {Promise<{ text: string, language?: string, duration?: number }>}
 */
export async function transcribeAudio(audioBlob, options = {}) {
  if (!OPENAI_API_KEY) {
    throw new Error("NO_API_KEY");
  }

  const mimeType = audioBlob.type || "audio/webm";
  const ext = getFileExtension(mimeType);
  const file = new File([audioBlob], `recording.${ext}`, { type: mimeType });

  const formData = new FormData();
  formData.append("file", file);
  formData.append("model", TRANSCRIBE_MODEL);
  formData.append("response_format", "json");

  // 不传 language，让模型自动检测（中英混杂必须）
  if (options.language) {
    formData.append("language", options.language);
  }

  // 注入 prompt 提高专有名词识别率
  if (options.prompt) {
    formData.append("prompt", options.prompt.slice(0, MAX_PROMPT_LENGTH));
  }

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`STT API 错误 (${response.status}): ${errorBody.slice(0, 120)}`);
  }

  const data = await response.json();

  return {
    text: String(data.text || "").trim(),
    language: data.language || undefined,
    duration: data.duration || undefined,
  };
}

/**
 * 使用浏览器 Web Speech API 作为降级方案
 * 只支持单语言，不支持中英混杂
 * 
 * @param {Object} [options]
 * @param {string} [options.language] - BCP-47 语言代码，默认 "zh-CN"
 * @param {number} [options.timeout] - 超时时间（毫秒），默认 10000
 * @returns {Promise<{ text: string }>}
 */
export function transcribeWithWebSpeech(options = {}) {
  return new Promise((resolve, reject) => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      reject(new Error("浏览器不支持语音识别"));
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = options.language || "zh-CN";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;

    const timeout = options.timeout || 10000;
    const timer = setTimeout(() => {
      recognition.stop();
      reject(new Error("语音识别超时"));
    }, timeout);

    recognition.onresult = (event) => {
      clearTimeout(timer);
      const transcript = event.results[0]?.[0]?.transcript || "";
      resolve({ text: transcript.trim() });
    };

    recognition.onerror = (event) => {
      clearTimeout(timer);
      reject(new Error(`语音识别错误: ${event.error}`));
    };

    recognition.onend = () => {
      clearTimeout(timer);
    };

    recognition.start();
  });
}

/**
 * 检查是否有 OpenAI API Key 可用于 STT
 */
export const hasTranscribeApiKey = () => !!OPENAI_API_KEY;
