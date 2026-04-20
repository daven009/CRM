/**
 * 环境变量管理
 * 后端统一从 process.env 读取，不再暴露给前端
 */
import 'dotenv/config';

const env = process.env;

export const config = {
  port: parseInt(env.PORT || '3001', 10),

  // 安全配置
  apiSecretKey: (env.API_SECRET_KEY || '').trim(),
  corsOrigins: (env.CORS_ORIGINS || 'http://localhost:5173').split(',').map(s => s.trim()).filter(Boolean),

  // OpenAI
  openai: {
    apiKey: (env.OPENAI_API_KEY || '').trim(),
    model: (env.OPENAI_MODEL || 'gpt-4o-mini').trim(),
    apiUrl: (env.OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions').trim(),
    get embeddingUrl() {
      return this.apiUrl.replace(/\/chat\/completions\/?$/, '/embeddings');
    },
    get transcribeUrl() {
      return 'https://api.openai.com/v1/audio/transcriptions';
    },
    embeddingModel: (env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small').trim(),
    visionModel: (env.OPENAI_VISION_MODEL || env.OPENAI_MODEL || 'gpt-4o-mini').trim(),
  },

  // MiniMax
  minimax: {
    apiKey: (env.MINIMAX_API_KEY || '').trim(),
    model: (env.MINIMAX_MODEL || 'MiniMax-M2.5').trim(),
    apiUrl: (env.MINIMAX_API_URL || 'https://api.minimax.io/v1/text/chatcompletion_v2').trim(),
    groupId: (env.MINIMAX_GROUP_ID || '').trim(),
    get requestUrl() {
      const url = new URL(this.apiUrl);
      if (this.groupId) url.searchParams.set('GroupId', this.groupId);
      return url.toString();
    }
  },

  // Claude
  claude: {
    apiKey: (env.CLAUDE_API_KEY || '').trim(),
    model: (env.CLAUDE_MODEL || 'claude-sonnet-4-20250514').trim(),
    apiUrl: (env.CLAUDE_API_URL || 'https://api.anthropic.com/v1/messages').trim(),
    anthropicVersion: '2023-06-01',
  },

  // Supabase
  supabase: {
    url: (env.SUPABASE_URL || '').trim(),
    anonKey: (env.SUPABASE_ANON_KEY || '').trim(),
  },
};

/**
 * 清理 API Key（去空格、去 Bearer 前缀、去引号）
 */
export const normalizeApiKey = (raw) =>
  String(raw || '').trim().replace(/^Bearer\s+/i, '').replace(/^['"]|['"]$/g, '');
