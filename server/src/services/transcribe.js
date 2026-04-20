/**
 * OpenAI Transcription (STT) Service (后端)
 * 迁移自前端 src/lib/models/openaiTranscribe.js
 * 
 * 接收前端上传的音频文件，转发到 OpenAI Transcriptions API
 */
import { config } from '../config/env.js';

const TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe';
const MAX_PROMPT_LENGTH = 200;

/**
 * 转写音频为文本
 * @param {Buffer} audioBuffer - 音频文件 Buffer
 * @param {string} mimeType - MIME 类型
 * @param {Object} options - { prompt, language }
 */
export const transcribeAudio = async (audioBuffer, mimeType, options = {}) => {
  const { apiKey } = config.openai;
  if (!apiKey) throw Object.assign(new Error('未配置 OPENAI_API_KEY'), { statusCode: 500 });

  // 确定文件扩展名
  let ext = 'webm';
  if (mimeType?.includes('mp4')) ext = 'mp4';
  else if (mimeType?.includes('wav')) ext = 'wav';

  // 构建 FormData（Node.js 18+ 原生支持）
  const formData = new FormData();
  const file = new File([audioBuffer], `recording.${ext}`, { type: mimeType || 'audio/webm' });
  formData.append('file', file);
  formData.append('model', TRANSCRIBE_MODEL);
  formData.append('response_format', 'json');

  // 不传 language 让模型自动检测（中英混杂必须）
  if (options.language) {
    formData.append('language', options.language);
  }

  // 注入 prompt 提高专有名词识别率
  if (options.prompt) {
    formData.append('prompt', String(options.prompt).slice(0, MAX_PROMPT_LENGTH));
  }

  const response = await fetch(config.openai.transcribeUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw Object.assign(
      new Error(`STT API 错误 (${response.status}): ${errorBody.slice(0, 120)}`),
      { statusCode: response.status, code: 'STT_ERROR' }
    );
  }

  const data = await response.json();
  return {
    text: String(data.text || '').trim(),
    language: data.language || undefined,
    duration: data.duration || undefined,
  };
};
