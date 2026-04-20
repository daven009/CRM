/**
 * Prompt 拼装函数
 * 负责把模板 + 变量拼装成完整的 system prompt 字符串
 */
import {
  SYSTEM_HEADER_TEMPLATE,
  STAGE1_CLASSIFIER_TEMPLATE,
  STAGE2_DISAMBIGUATE_TEMPLATE,
  STAGE3_MAIN_TEMPLATE,
  STAGE3_WRITE_TEMPLATE,
  STAGE3_READONLY_TEMPLATE,
  STAGE3_GENERATE_TEMPLATE,
  STAGE4_SHORTCIRCUIT_TEMPLATE
} from '../prompts/index.js';

/**
 * 简单的 {{var}} 占位符替换
 * @param {string} template
 * @param {Record<string, string>} vars
 * @returns {string}
 */
export function renderTemplate(template, vars = {}) {
  let result = template;
  for (const [key, val] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, val ?? '');
  }
  return result;
}

/**
 * 拼装 system header
 * @param {import('./context.js').ConversationContext} ctx
 * @returns {string}
 */
export function buildSystemHeader(ctx) {
  return renderTemplate(SYSTEM_HEADER_TEMPLATE, {
    user_role: ctx.user_role || '保险中介',
    current_date: ctx.current_date,
    current_year: String(ctx.current_year),
    focus_client_or_null: ctx.focus_client
      ? `${ctx.focus_client.name} (id: ${ctx.focus_client.id})`
      : 'null',
    conversation_summary: ctx.conversation_summary || '(无)'
  });
}

/**
 * 拼装 Stage 1 意图分类 prompt
 * @param {string} userInput
 * @param {import('./context.js').ConversationContext} ctx
 * @returns {string}
 */
export function buildStage1Prompt(userInput, ctx) {
  return renderTemplate(STAGE1_CLASSIFIER_TEMPLATE, {
    SYSTEM_HEADER: buildSystemHeader(ctx),
    user_input: userInput
  });
}

/**
 * 拼装 Stage 2 消歧 prompt
 * @param {string} mention
 * @param {Array} candidates
 * @param {import('./context.js').ConversationContext} ctx
 * @returns {string}
 */
export function buildStage2Prompt(mention, candidates, ctx) {
  return renderTemplate(STAGE2_DISAMBIGUATE_TEMPLATE, {
    SYSTEM_HEADER: buildSystemHeader(ctx),
    mention,
    candidates_json: JSON.stringify(candidates, null, 2)
  });
}

/**
 * 根据 intents 决定要注入哪些 stage3 能力模块
 * @param {Array<{type: string}>} intents
 * @returns {string[]} 模块内容数组
 */
export function selectCapabilityModules(intents) {
  const modules = [];
  const types = new Set(intents.map(i => i.type));

  if (types.has('RECORD') || types.has('COMMAND')) {
    modules.push(STAGE3_WRITE_TEMPLATE);
  }
  if (types.has('QUERY') || types.has('KNOWLEDGE') || types.has('CHAT')) {
    modules.push(STAGE3_READONLY_TEMPLATE);
  }
  if (types.has('GENERATE') || types.has('RECOMMEND')) {
    modules.push(STAGE3_GENERATE_TEMPLATE);
  }
  return modules;
}

/**
 * 拼装 Stage 3 Action 生成 prompt
 * @param {Array} intents
 * @param {Array} resolvedClients
 * @param {import('./context.js').ConversationContext} ctx
 * @returns {string}
 */
export function buildStage3Prompt(intents, resolvedClients, ctx) {
  const header = buildSystemHeader(ctx);
  const moduleContents = selectCapabilityModules(intents).join('\n\n---\n\n');

  return renderTemplate(STAGE3_MAIN_TEMPLATE, {
    SYSTEM_HEADER: header,
    intents_json: JSON.stringify(intents, null, 2),
    resolved_clients_json: JSON.stringify(resolvedClients, null, 2),
    INJECTED_CAPABILITY_MODULES: moduleContents
  });
}

/**
 * 拼装 Stage 4 短路 prompt
 * @param {string} userInput
 * @param {import('./context.js').ConversationContext} ctx
 * @returns {string}
 */
export function buildStage4Prompt(userInput, ctx) {
  return renderTemplate(STAGE4_SHORTCIRCUIT_TEMPLATE, {
    SYSTEM_HEADER: buildSystemHeader(ctx),
    user_input: userInput
  });
}
