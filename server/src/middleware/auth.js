/**
 * API Key 鉴权中间件
 * 
 * 单用户 CRM 使用静态 API Key 方案：
 * - 前端请求头携带 X-API-Key
 * - 中间件校验是否匹配 server/.env 中的 API_SECRET_KEY
 * - 健康检查端点 /api/health 不需要鉴权
 */
import { config } from '../config/env.js';

/**
 * 验证 API Key 中间件
 * 仅在配置了 API_SECRET_KEY 时启用鉴权
 */
export const apiAuth = (req, res, next) => {
  // 如果未配置 API Key，跳过鉴权（开发模式兼容）
  if (!config.apiSecretKey) {
    return next();
  }

  const key = req.headers['x-api-key'];

  if (!key) {
    return res.status(401).json({
      error: 'Unauthorized',
      detail: '缺少 X-API-Key 请求头',
      code: 'MISSING_API_KEY',
    });
  }

  // 常量时间比较，防止时序攻击
  if (!timingSafeEqual(key, config.apiSecretKey)) {
    return res.status(401).json({
      error: 'Unauthorized',
      detail: 'API Key 无效',
      code: 'INVALID_API_KEY',
    });
  }

  next();
};

/**
 * 简易的常量时间字符串比较
 * 防止时序攻击（timing attack）
 */
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;

  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
