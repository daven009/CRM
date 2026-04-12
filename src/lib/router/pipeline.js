/**
 * 分层 CRM Pipeline（Staged Pipeline）
 *
 * 流程：
 *   Stage 1 → 意图分类
 *     ↓ 纯 CHAT/KNOWLEDGE 且无 client_mentions → Stage 4 短路
 *   Stage 2 → 客户消歧（程序侧优先，可选 LLM 辅助）
 *   Stage 3 → Action 生成（按 intent 类型动态注入能力模块）
 *     ↓ trigger_event_chain → 程序侧展开
 *   返回统一结构
 */
import { createLLMCaller, extractTextFromModelResponse } from '../models/index.js';
import { buildKnowledgeContext, normalizeKnowledgeSource } from '../knowledgeSources.js';
import { retrieveRelevantKnowledge } from '../knowledgeEmbedding.js';
import {
  ACTION_WHITELIST,
  ACTION_SCHEMA,
  INTENT_TYPES,
  LIMITS,
  clipText,
  parseJsonFromText,
  validateActions,
  buildRepairMessages,
  buildClientBrief,
  buildMaterialContext,
  buildTodoContext,
  loadUserIntelligence
} from '../crmPipeline.js';
import { buildStage1Prompt, buildStage2Prompt, buildStage3Prompt, buildStage4Prompt, buildSystemHeader } from './promptBuilder.js';
import { fuzzySearchClients, heuristicMatch, buildClarifyQuestion, toResolvedClientProfile } from './clientResolver.js';
import { expandEventChain } from './eventChains.js';
import { updateFocusClient, appendMessage } from './context.js';

/* ─── helpers ──────────────────────────────────────────── */

const isPlainObject = (v) => Object.prototype.toString.call(v) === '[object Object]';

const toPrettyJson = (v) => {
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
};

/**
 * Stage 1 JSON 校验：intents + client_mentions
 */
const validateStage1 = (parsed) => {
  const errors = [];
  if (!isPlainObject(parsed)) return { ok: false, errors: ['Stage1 输出不是 JSON object'] };
  if (!Array.isArray(parsed.intents)) errors.push('intents 必须是 array');
  else {
    parsed.intents.forEach((it, i) => {
      if (!isPlainObject(it)) errors.push(`intents[${i}] 必须是 object`);
      else if (!INTENT_TYPES.includes(String(it.type || ''))) errors.push(`intents[${i}].type 不合法: ${it.type}`);
    });
  }
  if (!Array.isArray(parsed.client_mentions)) errors.push('client_mentions 必须是 array');
  if (typeof parsed.is_focus_change !== 'boolean') errors.push('is_focus_change 必须是 boolean');
  return { ok: errors.length === 0, errors };
};

/**
 * Stage 2 JSON 校验：resolved_client_id + reasoning
 */
const validateStage2 = (parsed) => {
  const errors = [];
  if (!isPlainObject(parsed)) return { ok: false, errors: ['Stage2 输出不是 JSON object'] };
  if (typeof parsed.needs_clarification !== 'boolean' && parsed.needs_clarification != null) {
    errors.push('needs_clarification 必须是 boolean 或 null');
  }
  // 如果不需要澄清，resolved_client_id 必须存在且非空
  if (!parsed.needs_clarification) {
    if (parsed.resolved_client_id == null || String(parsed.resolved_client_id).trim() === '') {
      errors.push('needs_clarification=false 时 resolved_client_id 不能为空');
    }
  }
  // 如果需要澄清，clarifying_question 应该有内容
  if (parsed.needs_clarification === true) {
    if (!String(parsed.clarifying_question || '').trim() && !String(parsed.reasoning || '').trim()) {
      errors.push('needs_clarification=true 时 clarifying_question 或 reasoning 不能同时为空');
    }
  }
  return { ok: errors.length === 0, errors };
};

/**
 * Stage 3 / Stage 4 JSON 校验：reply + actions
 */
const validateStage3 = (parsed) => {
  const errors = [];
  if (!isPlainObject(parsed)) return { ok: false, errors: ['输出不是 JSON object'] };
  if (typeof parsed.reply !== 'string') errors.push('reply 必须是 string');
  else if (!String(parsed.reply).trim()) errors.push('reply 不能为空');
  if (!Array.isArray(parsed.actions)) errors.push('actions 必须是 array');
  const actionErrors = validateActions(Array.isArray(parsed.actions) ? parsed.actions : []);
  return { ok: errors.length === 0 && actionErrors.ok, errors: [...errors, ...actionErrors.errors] };
};

/**
 * 通用 LLM 调用 + JSON 解析 + 校验 + 修复循环
 * @returns {{ parsed: Object, rawText: string }}
 */
const callAndParse = async (llm, messages, label, validator, systemPrompt) => {
  const response = await llm.call(messages, label);
  let rawText = extractTextFromModelResponse(response);
  let parsed = null;
  let validationErrors = [];

  for (let round = 0; round <= LIMITS.MAX_REPAIR_ROUNDS; round += 1) {
    parsed = parseJsonFromText(rawText);

    if (!parsed) {
      validationErrors = ['模型输出无法解析为 JSON'];
    } else {
      const result = validator(parsed);
      validationErrors = result.errors;
    }

    if (validationErrors.length === 0 && parsed) break;
    if (round === LIMITS.MAX_REPAIR_ROUNDS) {
      throw new Error(`[${label}] 结构校验失败：${validationErrors.join('；')}`);
    }
    if (llm.getCallCount() >= LIMITS.MAX_TOTAL_LLM_CALLS) {
      throw new Error(`超过最大模型调用次数：${LIMITS.MAX_TOTAL_LLM_CALLS}`);
    }

    const repairMsgs = buildRepairMessages({ rawText, errors: validationErrors, systemPrompt });
    const repaired = await llm.call(repairMsgs, `${label} 修复 round ${round + 1}`);
    rawText = extractTextFromModelResponse(repaired);
  }

  return { parsed, rawText, usage: response?.usage || null };
};

/* ─── 上下文拼装辅助 ─────────────────────────────────── */

/**
 * 为 Stage 1 和 Stage 3 构建 messages 数组
 * 保留最近 N 轮历史消息作为 few-shot context
 */
const buildMessagesWithHistory = (systemPrompt, ctx, userPayloadJson) => {
  const historyMessages = (ctx.recent_messages || []).slice(-6).flatMap((m, idx) => [
    { role: 'user', name: 'user', content: clipText(m.user || '', 800) },
    { role: 'assistant', name: 'RelateAI', content: clipText(m.ai || '已处理', 800) }
  ]);

  return [
    { role: 'system', name: 'RelateAI', content: systemPrompt },
    ...historyMessages,
    { role: 'user', name: 'user', content: userPayloadJson }
  ];
};

/* ─── 主函数 ─────────────────────────────────────────── */

/**
 * 分层 CRM Pipeline
 *
 * @param {string} inputText - 用户输入
 * @param {Array} clients - 客户列表
 * @param {import('./context.js').ConversationContext} ctx - 会话上下文
 * @param {string} [modelProvider='minimax'] - LLM provider id
 * @param {Object} [options={}]
 * @param {Object} [options.lockedClient] - 详情页锁定的客户
 * @param {Object} [options.llmCaller] - 测试用可注入 caller，提供 call/getCallCount 等接口
 * @param {string|number|Date} [options.now] - 测试用时间锚点，未提供则使用当前时间
 * @returns {Promise<Object>} { reply, actions, intents, ctx, stages, ... }
 */
export async function runStagedPipeline(inputText, clients, ctx, modelProvider = 'minimax', options = {}) {
  const startedAt = Date.now();
  const stages = [];
  const llm = options?.llmCaller || createLLMCaller(modelProvider);
  const lockedClient = options?.lockedClient || null;

  // 更新上下文日期
  const now = options?.now ? new Date(options.now) : new Date();
  ctx = {
    ...ctx,
    current_date: now.toISOString().slice(0, 10),
    current_year: now.getFullYear()
  };

  // 加载用户配置
  const { domain, keywords, knowledgeFiles } = loadUserIntelligence();
  // Stage 1 只需要知道知识源数量（meta），不需要注入全量内容
  const knowledgeMeta = {
    totalCount: (knowledgeFiles || []).filter(f => f && f.active !== false).length
  };

  // 构建客户简报（供 Stage 1 / Stage 3 user payload）
  const clientBrief = buildClientBrief(clients);
  const materialLimit = 5;
  const lockedClientMaterials = lockedClient ? buildMaterialContext(lockedClient.files, materialLimit) : [];
  const lockedClientTodos = lockedClient ? buildTodoContext(lockedClient.todos, 20) : [];

  // 如果详情页锁定了客户，设置 focus_client
  if (lockedClient && (!ctx.focus_client || ctx.focus_client.id !== lockedClient.id)) {
    ctx = updateFocusClient(ctx, lockedClient);
  }

  /* ──────────────────────────────────────────────────────
   * STAGE 1：意图分类
   * ──────────────────────────────────────────────────── */
  const stage1SystemPrompt = buildStage1Prompt(inputText, ctx);
  const stage1UserPayload = JSON.stringify({
    input: inputText,
    clients: clientBrief,
    user_profile: { role: '保险中介', domain, keywords },
    current_focus_client: lockedClient
      ? { id: lockedClient.id, name: lockedClient.n, company: lockedClient.co }
      : (ctx.focus_client || null),
    knowledge_sources_meta: knowledgeMeta.totalCount > 0
      ? { totalCount: knowledgeMeta.totalCount }
      : null
  });

  const stage1Messages = buildMessagesWithHistory(stage1SystemPrompt, ctx, stage1UserPayload);
  const { parsed: stage1Result, rawText: stage1Raw, usage: stage1Usage } = await callAndParse(
    llm, stage1Messages, 'Stage1 意图分类', validateStage1, stage1SystemPrompt
  );

  const intents = (stage1Result.intents || []).slice(0, LIMITS.MAX_INTENTS);
  const clientMentions = stage1Result.client_mentions || [];
  const isFocusChange = Boolean(stage1Result.is_focus_change);
  const stage1Confidence = stage1Result.confidence;

  stages.push({
    title: 'STAGE 1 · Intent Classification（意图分类）',
    status: 'ok',
    detail: {
      intents,
      clientMentions,
      isFocusChange,
      confidence: stage1Confidence,
      usage: stage1Usage
    }
  });

  /* ──────────────────────────────────────────────────────
   * 语义知识检索：根据 Stage 1 结果动态检索相关知识源
   * ──────────────────────────────────────────────────── */
  const retrievalCtx = {
    user_message: inputText,
    mentioned_clients: clientMentions.map(m => {
      const matched = clients.find(c => c.n === m || String(c.id) === String(m));
      return matched ? { name: matched.n, company: matched.co } : { name: m };
    }),
    detected_events: intents.filter(i => i.type === 'RECORD').map(i => i.content).filter(Boolean),
    intents,
    conversation_summary: ctx.conversation_summary || ''
  };

  let knowledgeContext;
  try {
    knowledgeContext = await retrieveRelevantKnowledge(knowledgeFiles || [], retrievalCtx);
  } catch (err) {
    console.warn('[Knowledge Retrieval] 语义检索失败，回退到静态注入:', err.message);
    knowledgeContext = buildKnowledgeContext(knowledgeFiles || []);
  }

  /* ──────────────────────────────────────────────────────
   * 短路判断：纯 CHAT/KNOWLEDGE 且无 client_mentions → Stage 4
   * ──────────────────────────────────────────────────── */
  const intentTypes = new Set(intents.map(i => i.type));
  const isShortCircuit = clientMentions.length === 0
    && !lockedClient
    && [...intentTypes].every(t => ['CHAT', 'KNOWLEDGE'].includes(t));

  if (isShortCircuit) {
    const stage4SystemPrompt = buildStage4Prompt(inputText, ctx);
    const stage4Messages = buildMessagesWithHistory(stage4SystemPrompt, ctx, JSON.stringify({
      input: inputText,
      knowledge_sources: knowledgeContext.items,
      knowledge_sources_meta: knowledgeContext.totalCount > 0
        ? { totalCount: knowledgeContext.totalCount, includedCount: knowledgeContext.includedCount, truncated: knowledgeContext.truncated }
        : null
    }));

    const { parsed: stage4Result, usage: stage4Usage } = await callAndParse(
      llm, stage4Messages, 'Stage4 短路回复', validateStage3, stage4SystemPrompt
    );

    const updatedCtx = appendMessage(ctx, inputText, stage4Result.reply);

    stages.push({
      title: 'STAGE 4 · Short-circuit（短路回复）',
      status: 'ok',
      detail: { usage: stage4Usage }
    });
    stages.push({
      title: 'STAGE 8 · Call Statistics（调用统计）',
      status: 'ok',
      detail: {
        model: llm.model,
        endpoint: llm.requestUrl,
        totalLLMCalls: llm.getCallCount(),
        callLog: llm.callLog,
        elapsedMs: Date.now() - startedAt
      }
    });

    return {
      userText: inputText,
      reply: stage4Result.reply,
      confidence: stage4Result.confidence ?? stage1Confidence,
      needsClarification: false,
      clarifyingQuestion: '',
      focusChange: [],
      intents,
      actions: [],
      stages,
      ctx: updatedCtx,
      requestMeta: { shortCircuit: true }
    };
  }

  /* ──────────────────────────────────────────────────────
   * STAGE 2：客户消歧（程序侧优先）
   * ──────────────────────────────────────────────────── */
  let resolvedClients = [];
  let needsClarification = false;
  let clarifyingQuestion = '';
  const pendingCreateMentions = [];

  if (lockedClient) {
    // 详情页：直接使用锁定客户，跳过消歧
    resolvedClients = [toResolvedClientProfile(lockedClient)];
    stages.push({
      title: 'STAGE 2 · Client Resolution（客户消歧）',
      status: 'skipped',
      detail: { reason: 'lockedClient 已锁定', client: lockedClient.n }
    });
  } else if (clientMentions.length === 0) {
    // 无客户提及但有非 CHAT 意图 → 使用 focus_client（如果有）
    if (ctx.focus_client) {
      const focusFullClient = clients.find(c => c.id === ctx.focus_client.id);
      if (focusFullClient) {
        resolvedClients = [toResolvedClientProfile(focusFullClient)];
      }
    }
    stages.push({
      title: 'STAGE 2 · Client Resolution（客户消歧）',
      status: 'ok',
      detail: { reason: '无客户提及，使用 focus_client', focusClient: ctx.focus_client }
    });
  } else {
    // 有客户提及 → 逐个消歧
    const disambiguationResults = [];

    for (const mention of clientMentions) {
      const hits = fuzzySearchClients(mention, clients);

      if (hits.length === 0) {
        // 无命中 → 可能是新客户或输入有误
        pendingCreateMentions.push(mention);
        disambiguationResults.push({ mention, resolved: null, hits: 0, method: 'no_match' });
        continue;
      }

      if (hits.length === 1) {
        // 唯一命中 → 直接绑定
        resolvedClients.push(toResolvedClientProfile(hits[0]));
        disambiguationResults.push({ mention, resolved: hits[0].n, hits: 1, method: 'unique_match' });
        continue;
      }

      // 多命中 → 启发式缩小
      const heuristic = heuristicMatch(mention, hits, ctx, { isFocusChange });
      if (heuristic) {
        resolvedClients.push(toResolvedClientProfile(heuristic));
        disambiguationResults.push({ mention, resolved: heuristic.n, hits: hits.length, method: 'heuristic' });
        continue;
      }

      // 启发式失败 → 尝试 LLM 辅助消歧（如果还有调用额度）
      if (llm.getCallCount() < LIMITS.MAX_TOTAL_LLM_CALLS - 1) {
        try {
          const candidatesForLLM = hits.map(c => ({
            id: c.id,
            name: c.n,
            company: c.co || '',
            phone: c.tel || '',
            traits: (c.traits || []).slice(0, 5),
            relations: (c.refs || []).slice(0, 3)
          }));

          const stage2SystemPrompt = buildStage2Prompt(mention, candidatesForLLM, ctx);
          const stage2Messages = [
            { role: 'system', name: 'RelateAI', content: stage2SystemPrompt },
            { role: 'user', name: 'user', content: JSON.stringify({ mention, context: ctx.conversation_summary }) }
          ];

          // 使用 callAndParse 带校验修复循环，而非裸调用
          const { parsed: stage2Parsed } = await callAndParse(
            llm, stage2Messages, `Stage2 消歧: ${mention}`, validateStage2, stage2SystemPrompt
          );

          if (stage2Parsed && !stage2Parsed.needs_clarification && stage2Parsed.resolved_client_id != null) {
            const resolvedId = String(stage2Parsed.resolved_client_id).trim();
            // 校验 resolved_client_id 必须指向候选列表中的某个有效 ID
            const matched = hits.find(c => String(c.id) === resolvedId || String(c.id) === String(Number(resolvedId)));
            if (matched) {
              resolvedClients.push(toResolvedClientProfile(matched));
              disambiguationResults.push({ mention, resolved: matched.n, hits: hits.length, method: 'llm_assist', reasoning: stage2Parsed.reasoning });
              continue;
            }
            // LLM 返回了一个不在候选列表中的 ID → 视为失败，进入澄清
            console.warn(`[Stage2 LLM] resolved_client_id=${resolvedId} 不在候选列表中，回退到澄清`);
          }
        } catch (e) {
          console.warn('[Stage2 LLM] 消歧调用失败，回退到澄清:', e.message);
        }
      }

      // 所有方法都失败 → 需要用户澄清
      needsClarification = true;
      clarifyingQuestion = buildClarifyQuestion(mention, hits);
      disambiguationResults.push({ mention, resolved: null, hits: hits.length, method: 'needs_clarification' });
      break; // 一旦有歧义就停止
    }

    if (pendingCreateMentions.length > 0) {
      resolvedClients.push(
        ...pendingCreateMentions.map((name) => ({ id: null, name, _pending_create: true }))
      );
    }

    stages.push({
      title: 'STAGE 2 · Client Resolution（客户消歧）',
      status: needsClarification ? 'clarify' : 'ok',
      detail: { disambiguationResults, pendingCreateMentions }
    });
  }

  // 如果需要澄清 → 直接返回
  if (needsClarification) {
    stages.push({
      title: 'STAGE 8 · Call Statistics（调用统计）',
      status: 'ok',
      detail: {
        model: llm.model,
        endpoint: llm.requestUrl,
        totalLLMCalls: llm.getCallCount(),
        callLog: llm.callLog,
        elapsedMs: Date.now() - startedAt
      }
    });

    return {
      userText: inputText,
      reply: clarifyingQuestion,
      confidence: stage1Confidence,
      needsClarification: true,
      clarifyingQuestion,
      focusChange: [],
      intents,
      actions: [],
      stages,
      ctx,
      requestMeta: { clarification: true }
    };
  }

  /* ──────────────────────────────────────────────────────
   * STAGE 3：Action 生成
   * ──────────────────────────────────────────────────── */
  const stage3SystemPrompt = buildStage3Prompt(intents, resolvedClients, ctx);
  const stage3UserPayload = JSON.stringify({
    input: inputText,
    resolved_clients: resolvedClients,
    user_profile: { role: '保险中介', domain, keywords },
    current_focus_client: lockedClient
      ? {
        id: lockedClient.id,
        name: lockedClient.n,
        company: lockedClient.co,
        role: lockedClient.role,
        hp: lockedClient.hp,
        todo_open_count: (lockedClient.todos || []).filter(t => !t?.done).length,
        open_todos: lockedClientTodos,
        materials: lockedClientMaterials,
        materials_total_count: Array.isArray(lockedClient.files) ? lockedClient.files.length : 0,
        materials_truncated: Array.isArray(lockedClient.files) ? lockedClient.files.length > materialLimit : false
      }
      : null,
    client_materials: lockedClient ? lockedClientMaterials : [],
    client_materials_meta: lockedClient
      ? {
        totalCount: Array.isArray(lockedClient.files) ? lockedClient.files.length : 0,
        includedCount: lockedClientMaterials.length,
        truncated: Array.isArray(lockedClient.files) ? lockedClient.files.length > materialLimit : false,
        defaultLimit: materialLimit,
        note: Array.isArray(lockedClient.files) && lockedClient.files.length > materialLimit
          ? `该集合已被截断。全集${lockedClient.files.length}份，当前注入${materialLimit}份。`
          : '当前已注入全部资料。'
      }
      : null,
    knowledge_sources: knowledgeContext.items,
    knowledge_sources_meta: knowledgeContext.totalCount > 0
      ? { totalCount: knowledgeContext.totalCount, includedCount: knowledgeContext.includedCount, truncated: knowledgeContext.truncated }
      : null,
    time_anchor: { currentDate: ctx.current_date, currentYear: ctx.current_year }
  });

  const stage3Messages = buildMessagesWithHistory(stage3SystemPrompt, ctx, stage3UserPayload);
  const { parsed: stage3Result, rawText: stage3Raw, usage: stage3Usage } = await callAndParse(
    llm, stage3Messages, 'Stage3 Action生成', validateStage3, stage3SystemPrompt
  );

  let actions = Array.isArray(stage3Result.actions) ? stage3Result.actions.slice(0, LIMITS.MAX_ACTIONS) : [];
  const reply = String(stage3Result.reply || '');

  stages.push({
    title: 'STAGE 3 · Action Generation（Action 生成）',
    status: 'ok',
    detail: {
      actionCount: actions.length,
      actionTypes: [...new Set(actions.map(a => a.type))],
      confidence: stage3Result.confidence,
      usage: stage3Usage
    }
  });

  /* ──────────────────────────────────────────────────────
   * Event Chain 展开
   * ──────────────────────────────────────────────────── */
  const expandedActions = [];
  const eventChainDetails = [];

  for (const action of actions) {
    if (action.type === 'trigger_event_chain' && action.clientId && action.eventType) {
      const { actions: chainActions, recommendedScripts } = expandEventChain(action.clientId, action.eventType);
      expandedActions.push(...chainActions);
      eventChainDetails.push({
        eventType: action.eventType,
        clientId: action.clientId,
        expandedCount: chainActions.length,
        recommendedScripts
      });
    } else {
      expandedActions.push(action);
    }
  }

  if (eventChainDetails.length > 0) {
    stages.push({
      title: 'STAGE 5 · Event Chain Expansion（事件链展开）',
      status: 'ok',
      detail: { chains: eventChainDetails, totalExpanded: expandedActions.length }
    });
  }

  actions = expandedActions;

  /* ──────────────────────────────────────────────────────
   * 更新上下文
   * ──────────────────────────────────────────────────── */
  let updatedCtx = ctx;

  // 更新 focus_client
  if (resolvedClients.length > 0 && !lockedClient) {
    const primaryResolved = resolvedClients[0];
    const fullClient = clients.find(c => c.id === primaryResolved.id);
    if (fullClient) {
      updatedCtx = updateFocusClient(updatedCtx, fullClient);
    }
  }

  // 追加消息
  updatedCtx = appendMessage(updatedCtx, inputText, reply);

  /* ──────────────────────────────────────────────────────
   * 统计 & 返回
   * ──────────────────────────────────────────────────── */
  stages.push({
    title: 'STAGE 8 · Call Statistics（调用统计）',
    status: 'ok',
    detail: {
      model: llm.model,
      endpoint: llm.requestUrl,
      totalLLMCalls: llm.getCallCount(),
      callLog: llm.callLog,
      elapsedMs: Date.now() - startedAt
    }
  });

  return {
    userText: inputText,
    reply,
    confidence: stage3Result.confidence ?? stage1Confidence,
    needsClarification: false,
    clarifyingQuestion: '',
    focusChange: resolvedClients.map(c => c.name).filter(Boolean),
    intents,
    actions,
    stages,
    ctx: updatedCtx,
    requestMeta: {
      resolvedClients,
      rawStage1: clipText(stage1Raw, 600),
      rawStage3: clipText(stage3Raw, 600),
      pendingCreateMentions
    }
  };
}
