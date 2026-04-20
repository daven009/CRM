/**
 * LLM Caller 工厂（后端版本）
 * 
 * 复用现有 services (openai/claude/minimax)，
 * 提供与前端 createLLMCaller 一致的 call/getCallCount/callLog 接口，
 * 供 Pipeline 编排使用。
 */
import { callOpenAI } from './openai.js';
import { callClaude } from './claude.js';
import { callMinimax } from './minimax.js';
import { extractTextFromModelResponse } from './shared.js';
import { config } from '../config/env.js';

const PROVIDERS = {
  openai: {
    callFn: callOpenAI,
    getModel: () => config.openai.model,
    getUrl: () => config.openai.apiUrl,
  },
  claude: {
    callFn: callClaude,
    getModel: () => config.claude.model,
    getUrl: () => config.claude.apiUrl,
  },
  minimax: {
    callFn: callMinimax,
    getModel: () => config.minimax.model,
    getUrl: () => config.minimax.requestUrl,
  },
};

/**
 * 创建一个有状态的 LLM Caller 实例
 * 与前端 createLLMCaller 接口一致
 * 
 * @param {string} providerId - 'openai' | 'claude' | 'minimax'
 * @returns {{ call, getCallCount, callLog, model, requestUrl }}
 */
export function createLLMCaller(providerId = 'minimax') {
  const provider = PROVIDERS[providerId];
  if (!provider) {
    throw new Error(`未知的模型 provider: ${providerId}，可选: ${Object.keys(PROVIDERS).join(', ')}`);
  }

  let callCount = 0;
  const log = [];

  const call = async (messages, label = '') => {
    callCount += 1;
    const startedAt = Date.now();
    try {
      const result = await provider.callFn(messages, { temperature: 0.2 });
      const elapsed = Date.now() - startedAt;
      log.push({ label, elapsed, ok: true });
      return result;
    } catch (err) {
      const elapsed = Date.now() - startedAt;
      log.push({ label, elapsed, ok: false, error: err.message });
      throw err;
    }
  };

  return {
    call,
    getCallCount: () => callCount,
    get callLog() { return log; },
    get model() { return provider.getModel(); },
    get requestUrl() { return provider.getUrl(); },
  };
}

export { extractTextFromModelResponse };
