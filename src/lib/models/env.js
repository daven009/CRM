/**
 * Runtime environment helper.
 *
 * Vite replaces import.meta.env in the browser build, but our Node-based
 * regression / benchmark scripts need a safe fallback. We prefer Vite's
 * injected env when available, then fall back to a shared global override,
 * then process.env.
 */
export function getRuntimeEnv() {
  try {
    if (import.meta && import.meta.env) {
      return import.meta.env;
    }
  } catch {
    // Ignore environments that do not expose import.meta.env.
  }
  if (globalThis.__RELATE_AI_ENV__ && typeof globalThis.__RELATE_AI_ENV__ === 'object') {
    return globalThis.__RELATE_AI_ENV__;
  }
  const proc = globalThis.process;
  if (proc?.env) {
    return proc.env;
  }
  return {};
}
