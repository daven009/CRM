/**
 * Lightweight regression suite for the staged CRM pipeline.
 *
 * Goals:
 * - No external API calls
 * - Deterministic mock LLM responses
 * - Covers routing, disambiguation, context carry-over, pending create,
 *   event chain expansion, and prompt/wiring invariants
 */
import path from 'path';
import { fileURLToPath } from 'url';
import process from 'process';

import { runStagedPipeline } from '../src/lib/router/pipeline.js';
import { createContext } from '../src/lib/router/context.js';
import { fuzzySearchClients, heuristicMatch, buildClarifyQuestion } from '../src/lib/router/clientResolver.js';
import { expandEventChain, EVENT_CHAINS } from '../src/lib/router/eventChains.js';
import { selectCapabilityModules } from '../src/lib/router/promptBuilder.js';
import { STAGE3_WRITE_TEMPLATE } from '../src/lib/prompts/stage3Write.js';
import { formatScenarioList } from './regression-scenarios.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const FIXED_NOW = '2026-04-12T10:00:00+08:00';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

const results = [];
const argv = new Set(process.argv.slice(2));

if (argv.has('--list')) {
  console.log(formatScenarioList());
  process.exit(0);
}

function pass(message) {
  console.log(`  ${GREEN}✓${RESET} ${message}`);
}

function fail(message) {
  console.log(`  ${RED}✗${RESET} ${message}`);
  throw new Error(message);
}

function logFailure(name, error) {
  console.log(`  ${RED}✗${RESET} ${name}`);
  console.log(`    ${error.message}`);
}

function section(title) {
  console.log(`\n${CYAN}${BOLD}▸ ${title}${RESET}`);
}

function expect(condition, message) {
  if (!condition) fail(message);
}

function deepIncludes(collection, predicate) {
  return Array.isArray(collection) && collection.some(predicate);
}

function toResponse(payload) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify(payload)
        }
      }
    ]
  };
}

function createScriptedCaller(script) {
  let callCount = 0;
  const callLog = [];

  return {
    provider: 'mock',
    model: 'regression-mock',
    requestUrl: 'mock://regression',
    callLog,
    getCallCount() {
      return callCount;
    },
    async call(messages, label) {
      const step = script[Math.min(callCount, script.length - 1)];
      callLog.push({
        idx: callCount,
        label,
        promptHead: String(messages?.at?.(-1)?.content || '').slice(0, 120)
      });
      callCount += 1;

      const payload = typeof step === 'function'
        ? await step({ messages, label, callCount })
        : step;

      if (payload && payload.__raw) return payload.__raw;
      return toResponse(payload);
    }
  };
}

function makeStage1({ intents, clientMentions = [], isFocusChange = false, confidence = 0.93, needsClarification = false, clarifyingQuestion = null }) {
  return {
    intents,
    client_mentions: clientMentions,
    is_focus_change: isFocusChange,
    needs_clarification: needsClarification,
    clarifying_question: clarifyingQuestion,
    confidence
  };
}

function makeStage3({ reply, actions = [], confidence = 0.92 }) {
  return { reply, actions, confidence };
}

function makeStage4({ reply, actions = [], confidence = 0.99 }) {
  return { reply, actions, confidence };
}

async function runPipelineCase({
  inputText,
  clients,
  ctx,
  responses,
  options = {}
}) {
  const caller = createScriptedCaller(responses);
  const result = await runStagedPipeline(
    inputText,
    clients,
    ctx,
    'mock',
    {
      ...options,
      llmCaller: caller,
      now: FIXED_NOW
    }
  );
  return { caller, result };
}

function makeClient(id, n, co, extra = {}) {
  return {
    id,
    n,
    co,
    role: extra.role || '客户',
    tel: extra.tel || '',
    hp: extra.hp ?? 80,
    bd: extra.bd || '',
    ps: extra.ps || '',
    traits: extra.traits || [],
    todos: extra.todos || [],
    log: extra.log || [],
    refs: extra.refs || [],
    files: extra.files || []
  };
}

const clients = [
  makeClient(1, '张伟', 'AIA', {
    role: '企业主',
    traits: ['稳健'],
    todos: [{ t: '周三回访保单进度', d: 2, s: 'ai', done: false }]
  }),
  makeClient(2, '张伟明', 'Prudential', { role: '高管' }),
  makeClient(3, '李总', 'DBS', { role: '总监' }),
  makeClient(4, '陈先生', 'OCBC', { role: '顾问' }),
  makeClient(5, 'Kevin Tan', 'None', { role: '新客户' })
];

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// ── source / wiring invariants ───────────────────────────
test('event chain whitelist and prompt whitelist stay aligned', async () => {
  const promptEventTypes = [...STAGE3_WRITE_TEMPLATE.matchAll(/-\s+(\w+)\s+\/\//gm)]
    .map((m) => m[1])
    .filter((t) => !['trigger_event_chain', 'clientId', 'eventType'].includes(t));
  const chainEventTypes = Object.keys(EVENT_CHAINS);

  expect(promptEventTypes.length === chainEventTypes.length, `事件白名单数量不一致: prompt=${promptEventTypes.length}, chain=${chainEventTypes.length}`);
  const missingInChains = promptEventTypes.filter((t) => !chainEventTypes.includes(t));
  const missingInPrompt = chainEventTypes.filter((t) => !promptEventTypes.includes(t));
  expect(missingInChains.length === 0, `白名单有但 EVENT_CHAINS 缺失: ${missingInChains.join(', ')}`);
  expect(missingInPrompt.length === 0, `EVENT_CHAINS 有但白名单缺失: ${missingInPrompt.join(', ')}`);
});

test('promptBuilder capability selection stays minimal', async () => {
  const queryModules = selectCapabilityModules([{ type: 'QUERY' }]);
  const recordModules = selectCapabilityModules([{ type: 'RECORD' }]);
  const generateModules = selectCapabilityModules([{ type: 'GENERATE' }]);

  expect(queryModules.length === 1, 'QUERY 只应注入 1 个能力模块');
  expect(recordModules.length === 1, 'RECORD 只应注入 1 个能力模块');
  expect(generateModules.length === 1, 'GENERATE 只应注入 1 个能力模块');
});

test('client resolver heuristics stay stable', async () => {
  const hits = fuzzySearchClients('张总', clients);
  expect(hits.length >= 2, '张总 应命中多个候选');

  const focusCtx = {
    ...createContext(),
    focus_client: { id: 1, name: '张伟' }
  };
  const selected = heuristicMatch('张总', hits, focusCtx, { isFocusChange: false });
  expect(selected?.id === 1, 'focus_client 应优先于模糊重名');

  const clarified = buildClarifyQuestion('张总', hits);
  expect(clarified.includes('张总'), '澄清问题应保留原称谓');
});

test('event chain expansion returns deterministic actions', async () => {
  const expanded = expandEventChain(3, 'job_change');
  expect(expanded.actions.length >= 3, 'job_change 应展开为多条待办');
  expect(deepIncludes(expanded.actions, (a) => a.type === 'add_todo'), 'event chain 应生成 add_todo');
  expect(Array.isArray(expanded.recommendedScripts), 'event chain 应返回 recommendedScripts');
});

// ── pipeline scenarios ───────────────────────────────────
test('short-circuits pure chat without touching stage 3', async () => {
  const ctx = createContext();
  const { caller, result } = await runPipelineCase({
    name: 'short chat',
    inputText: '你好，今天怎么样',
    clients,
    ctx,
    responses: [
      makeStage1({
        intents: [{ type: 'CHAT', content: '寒暄' }],
        clientMentions: [],
        isFocusChange: false
      }),
      makeStage4({ reply: '你好，可以直接告诉我客户名或需求。', actions: [] })
    ]
  });

  expect(result.requestMeta.shortCircuit === true, '纯闲聊应走短路');
  expect(result.actions.length === 0, '纯闲聊不应产生 actions');
  expect(caller.getCallCount() === 2, '纯闲聊只应调用 stage1 + stage4');
  expect(result.stages.some((s) => String(s.title).includes('STAGE 4')), '应记录 stage4');
});

test('short-circuits pure knowledge questions without actions', async () => {
  const ctx = createContext();
  const { result } = await runPipelineCase({
    name: 'knowledge short circuit',
    inputText: '终身寿险怎么算现金价值？',
    clients,
    ctx,
    responses: [
      makeStage1({
        intents: [{ type: 'KNOWLEDGE', content: '保险知识问答' }],
        clientMentions: [],
        isFocusChange: false
      }),
      makeStage4({ reply: '现金价值通常由保单条款和缴费年限决定。', actions: [] })
    ]
  });

  expect(result.requestMeta.shortCircuit === true, '知识问答应走短路');
  expect(result.actions.length === 0, '知识问答不应产生 actions');
});

test('uses focus client when no client mention is present', async () => {
  const ctx = {
    ...createContext(),
    focus_client: { id: 1, name: '张伟' }
  };
  const { result } = await runPipelineCase({
    name: 'focus client query',
    inputText: '他最近怎样',
    clients,
    ctx,
    responses: [
      makeStage1({
        intents: [{ type: 'QUERY', content: '查询客户近况' }],
        clientMentions: [],
        isFocusChange: false
      }),
      makeStage3({ reply: '张伟最近没有新增待办。', actions: [] })
    ]
  });

  expect(result.requestMeta.resolvedClients?.[0]?.id === 1, '无明确称谓时应沿用 focus_client');
  expect(result.ctx.focus_client?.id === 1, 'focus_client 应保持不变');
  expect(result.actions.length === 0, 'QUERY 不应产生 actions');
});

test('lockedClient path bypasses disambiguation in detail chat', async () => {
  const lockedClient = clients[2];
  const ctx = createContext();
  const { result } = await runPipelineCase({
    name: 'locked client',
    inputText: '他最近怎样',
    clients,
    ctx,
    options: { lockedClient },
    responses: [
      makeStage1({
        intents: [{ type: 'QUERY', content: '查询锁定客户近况' }],
        clientMentions: [],
        isFocusChange: false
      }),
      makeStage3({ reply: '李总最近正常。', actions: [] })
    ]
  });

  expect(result.requestMeta.resolvedClients?.[0]?.id === lockedClient.id, 'lockedClient 应直接进入 resolvedClients');
  expect(result.stages.some((s) => String(s.title).includes('skipped') || String(s.detail?.reason || '').includes('lockedClient')), 'stage2 应跳过消歧');
});

test('clarifies when a称谓 hits multiple clients and no heuristic applies', async () => {
  const ctx = createContext();
  const { result } = await runPipelineCase({
    name: 'ambiguity clarification',
    inputText: '张总最近怎样',
    clients,
    ctx,
    responses: [
      makeStage1({
        intents: [{ type: 'QUERY', content: '查询张总近况' }],
        clientMentions: ['张总'],
        isFocusChange: false
      }),
      {
        resolved_client_id: null,
        reasoning: '无法唯一确定',
        needs_clarification: true,
        clarifying_question: '请确认张总是哪一位'
      }
    ]
  });

  expect(result.needsClarification === true, '歧义输入应返回澄清');
  expect(String(result.reply).includes('请确认'), '澄清回复应包含确认提示');
  expect(result.actions.length === 0, '澄清分支不应产生 actions');
});

test('switches focus client when user explicitly changes contact', async () => {
  const ctx = {
    ...createContext(),
    focus_client: { id: 1, name: '张伟' }
  };
  const { result } = await runPipelineCase({
    name: 'switch contact',
    inputText: '那李总呢？',
    clients,
    ctx,
    responses: [
      makeStage1({
        intents: [{ type: 'QUERY', content: '切换到李总' }],
        clientMentions: ['李总'],
        isFocusChange: true
      }),
      makeStage3({ reply: '李总最近状态正常。', actions: [] })
    ]
  });

  expect(result.ctx.focus_client?.id === 3, '应切换到李总');
  expect(Array.isArray(result.focusChange) && result.focusChange.includes('李总'), 'focusChange 应记录新联系人');
});

test('preserves conversation summary across turns', async () => {
  const firstCtx = createContext();
  const first = await runPipelineCase({
    name: 'turn 1',
    inputText: '张伟最近怎样',
    clients,
    ctx: firstCtx,
    responses: [
      makeStage1({
        intents: [{ type: 'QUERY', content: '查询张伟近况' }],
        clientMentions: ['张伟'],
        isFocusChange: false
      }),
      makeStage3({ reply: '张伟最近没有新增待办。', actions: [] })
    ]
  });

  const second = await runPipelineCase({
    name: 'turn 2',
    inputText: '帮我写一条跟进短信',
    clients,
    ctx: first.result.ctx,
    responses: [
      makeStage1({
        intents: [{ type: 'GENERATE', content: '生成跟进短信' }],
        clientMentions: [],
        isFocusChange: false
      }),
      makeStage3({ reply: '好的，短信草稿如下。', actions: [] })
    ]
  });

  expect(first.result.ctx.recent_messages.length === 1, '第一轮后 recent_messages 应有 1 条');
  expect(second.result.ctx.recent_messages.length === 2, '第二轮后 recent_messages 应追加');
  expect(String(second.result.ctx.conversation_summary).includes('张伟最近怎样'), 'conversation_summary 应保留上一轮语义');
});

test('supports pending create for unseen contacts', async () => {
  const ctx = createContext();
  const { result } = await runPipelineCase({
    name: 'pending create',
    inputText: '今天见了个新朋友叫 Alice Ong',
    clients,
    ctx,
    responses: [
      makeStage1({
        intents: [{ type: 'RECORD', content: '记录新客户' }],
        clientMentions: ['Alice Ong'],
        isFocusChange: true
      }),
      makeStage3({
        reply: '好的，已经为 Alice Ong 建立档案。',
        actions: [
          { type: 'create_profile', name: 'Alice Ong' }
        ]
      })
    ]
  });

  expect(deepIncludes(result.requestMeta.resolvedClients, (c) => c._pending_create && c.name === 'Alice Ong'), '未命中客户应转为 pending_create');
  expect(deepIncludes(result.actions, (a) => a.type === 'create_profile' && a.name === 'Alice Ong'), '应输出 create_profile');
});

test('expands life events instead of returning trigger_event_chain directly', async () => {
  const ctx = {
    ...createContext(),
    focus_client: { id: 3, name: '李总' }
  };
  const { result } = await runPipelineCase({
    name: 'event chain',
    inputText: '李总太太怀孕了',
    clients,
    ctx,
    responses: [
      makeStage1({
        intents: [{ type: 'RECORD', content: '配偶怀孕' }],
        clientMentions: ['李总'],
        isFocusChange: false
      }),
      makeStage3({
        reply: '好的，已经记下。',
        actions: [
          { type: 'trigger_event_chain', clientId: 3, eventType: 'spouse_pregnancy' },
          { type: 'update_profile', clientId: 3, updates: { co: 'DBS' } }
        ]
      })
    ]
  });

  expect(!deepIncludes(result.actions, (a) => a.type === 'trigger_event_chain'), '最终 actions 不应保留 trigger_event_chain');
  expect(deepIncludes(result.actions, (a) => a.type === 'add_todo'), 'event chain 应展开为 add_todo');
  expect(deepIncludes(result.actions, (a) => a.type === 'add_trait'), 'event chain 应展开为 add_trait');
  expect(deepIncludes(result.actions, (a) => a.type === 'update_profile'), '非事件动作应保留');
});

test('routes command reminders to add_todo for the right contact', async () => {
  const ctx = {
    ...createContext(),
    focus_client: { id: 3, name: '李总' }
  };
  const { result } = await runPipelineCase({
    name: 'reminder command',
    inputText: '提醒我下周二给李总打电话',
    clients,
    ctx,
    responses: [
      makeStage1({
        intents: [{ type: 'COMMAND', content: '创建回访提醒' }],
        clientMentions: ['李总'],
        isFocusChange: false
      }),
      makeStage3({
        reply: '已为李总安排回访提醒。',
        actions: [
          { type: 'add_todo', clientId: 3, todo: '下周二电话回访李总', days: 7 }
        ]
      })
    ]
  });

  expect(deepIncludes(result.actions, (a) => a.type === 'add_todo' && a.clientId === 3), '应生成 add_todo');
  expect(String(result.actions[0]?.todo || '').includes('李总'), '待办应绑定到正确客户');
});

test('generates reply without actions for content generation', async () => {
  const ctx = createContext();
  const { result } = await runPipelineCase({
    name: 'generate reply',
    inputText: '帮我写条生日祝福给陈先生',
    clients,
    ctx,
    responses: [
      makeStage1({
        intents: [{ type: 'GENERATE', content: '生成祝福语' }],
        clientMentions: ['陈先生'],
        isFocusChange: false
      }),
      makeStage3({
        reply: '陈先生，祝您生日快乐，愿新的一年顺心安康。',
        actions: []
      })
    ]
  });

  expect(result.actions.length === 0, '生成类意图不应产生 actions');
  expect(result.reply.includes('陈先生'), '生成内容应保留具体客户名');
});

// ── runner ───────────────────────────────────────────────
async function main() {
  section('Regession Suite');
  console.log(`Root: ${ROOT}`);
  console.log(`Fixed time: ${FIXED_NOW}`);

  for (const t of tests) {
    try {
      await t.fn();
      pass(t.name);
      results.push({ name: t.name, ok: true });
    } catch (error) {
      logFailure(t.name, error);
      results.push({ name: t.name, ok: false, error: error.message });
    }
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;

  console.log(`\n${'═'.repeat(68)}`);
  console.log(`${BOLD}${failed === 0 ? GREEN : RED}Passed ${passed}/${results.length} regression checks${RESET}`);
  if (failed > 0) {
    console.log(`${RED}${failed} check(s) failed${RESET}`);
  } else {
    console.log(`${GREEN}All regression checks passed${RESET}`);
  }
  console.log('═'.repeat(68) + '\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
