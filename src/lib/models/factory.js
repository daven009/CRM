/**
 * LLM 模型工厂
 * 根据 provider 名称创建对应的 caller 实例
 * 
 * 所有 API Key 已迁移到后端，前端不再检测 Key 可用性
 * 可用性通过 /api/health 端点查询
 */
import { createMinimaxCaller } from './minimax.js';
import { createClaudeCaller } from './claude.js';
import { createOpenAICaller } from './openai.js';

/**
 * 支持的模型 Provider 定义
 */
export const MODEL_PROVIDERS = {
  minimax: {
    id: "minimax",
    label: "MiniMax M2.5",
    factory: createMinimaxCaller,
    description: "MiniMax 大模型，国内访问快"
  },
  claude: {
    id: "claude",
    label: "Claude (Anthropic)",
    factory: createClaudeCaller,
    description: "Anthropic Claude，推理能力强"
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    factory: createOpenAICaller,
    description: "OpenAI Chat Completions，适合快速调试"
  }
};

/**
 * 获取所有可用模型列表
 * 后端模式下所有 provider 都标记为 configured（实际可用性由后端决定）
 */
export const getAvailableModels = () => {
  return Object.values(MODEL_PROVIDERS).map(provider => ({
    id: provider.id,
    label: provider.label,
    description: provider.description,
    configured: true  // 后端管理 Key，前端不再检测
  }));
};

/**
 * 根据 provider ID 创建 LLM Caller
 */
export const createLLMCaller = (providerId = 'minimax') => {
  const provider = MODEL_PROVIDERS[providerId];
  if (!provider) {
    throw new Error(`未知的模型 provider: ${providerId}，可选: ${Object.keys(MODEL_PROVIDERS).join(', ')}`);
  }
  return provider.factory();
};
