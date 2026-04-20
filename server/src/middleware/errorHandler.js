/**
 * 统一错误处理中间件
 */
export const errorHandler = (err, req, res, _next) => {
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path} →`, err.message);

  // 上游 API 错误（透传状态码）
  if (err.statusCode) {
    return res.status(err.statusCode).json({
      error: err.message,
      code: err.code || 'UPSTREAM_ERROR',
    });
  }

  // 通用服务器错误
  res.status(500).json({
    error: err.message || 'Internal Server Error',
    code: 'INTERNAL_ERROR',
  });
};

/**
 * 请求日志中间件
 */
export const requestLogger = (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
  });
  next();
};
