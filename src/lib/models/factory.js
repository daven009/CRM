/**
 * LLM 模型工厂
 * 根据 provider 名称创建对应的 caller 实例
 */
import { createMinimaxCaller } from './minimax.js';
import { createClaudeCaller } from './claude.js';
import { createOpenAICaller } from './openai.js';

/**
 * 支持的模型 Provider 定义
 * label: UI 显示名称
 * factory: 创建 caller 的工厂函数
 * envKey: 检测是否已配置的环境变量 key
 */
export const MODEL_PROVIDERS = {
  minimax: {
    id: "minimax",
    label: "MiniMax M2.5",
    factory: createMinimaxCaller,
    envKey: "VITE_MINIMAX_API_KEY",
    description: "MiniMax 大模型，国内访问快"
  },
  claude: {
    id: "claude",
    label: "Claude (Anthropic)",
    factory: createClaudeCaller,
    envKey: "VITE_CLAUDE_API_KEY",
    description: "Anthropic Claude，推理能力强"
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    factory: createOpenAICaller,
    envKey: "VITE_OPENAI_API_KEY",
    description: "OpenAI Chat Completions，适合快速调试"
  }
};

/**
 * 获取所有可用（已配置 API Key）的模型列表
 * @returns {Array<{ id: string, label: string, configured: boolean, description: string }>}
 */
export const getAvailableModels = () => {
  return Object.values(MODEL_PROVIDERS).map(provider => ({
    id: provider.id,
    label: provider.label,
    description: provider.description,
    configured: Boolean(import.meta.env[provider.envKey])
  }));
};

/**
 * 根据 provider ID 创建 LLM Caller
 * @param {string} [providerId='minimax'] - provider 标识
 * @returns {{ model: string, provider: string, requestUrl: string, call: Function, callLog: Array, getCallCount: Function }}
 */
export const createLLMCaller = (providerId = 'minimax') => {
  const provider = MODEL_PROVIDERS[providerId];
  if (!provider) {
    throw new Error(`未知的模型 provider: ${providerId}，可选: ${Object.keys(MODEL_PROVIDERS).join(', ')}`);
  }
  return provider.factory();
};
