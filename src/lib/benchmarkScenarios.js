import { createContext } from './router/context.js';
import { applyClientAction } from './clientMutations.js';

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

export function makeBenchmarkClients() {
  return [
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
}

export const SCENARIOS = [
  { id: 'chat_short_circuit', category: 'short-circuit', title: '纯闲聊短路', input: '你好，今天怎么样', expectedRoute: 'shortCircuit', tags: ['CHAT', 'no-action', 'fast-path'] },
  { id: 'knowledge_short_circuit', category: 'short-circuit', title: '纯知识问答短路', input: '终身寿险怎么算现金价值？', expectedRoute: 'shortCircuit', tags: ['KNOWLEDGE', 'no-action', 'fast-path'] },
  { id: 'focus_query', category: 'context', title: '沿用当前 focus_client 查询', input: '他最近怎样', expectedRoute: 'resolved', tags: ['QUERY', 'focus_client', 'pronoun'] },
  { id: 'locked_client', category: 'context', title: '详情页锁定客户', input: '他最近怎样', expectedRoute: 'resolvedLocked', tags: ['QUERY', 'lockedClient', 'detail-chat'] },
  { id: 'ambiguity_clarify', category: 'disambiguation', title: '重名歧义澄清', input: '张总最近怎样', expectedRoute: 'clarify', tags: ['QUERY', 'ambiguous', 'disambiguation'] },
  { id: 'switch_contact', category: 'context', title: '明确切换联系人', input: '那李总呢？', expectedRoute: 'resolvedSwitch', tags: ['QUERY', 'focus_change', 'switch-contact'] },
  { id: 'multi_turn_summary', category: 'context', title: '多轮对话摘要保留', input: '帮我写一条跟进短信', expectedRoute: 'generate', tags: ['GENERATE', 'memory', 'summary'] },
  { id: 'pending_create', category: 'write', title: '新客户建档', input: '今天见了个新朋友叫 Alice Ong', expectedRoute: 'pendingCreate', tags: ['RECORD', 'create_profile', 'new-client'] },
  { id: 'life_event_spouse_pregnancy', category: 'write', title: '人生事件：配偶怀孕', input: '李总太太怀孕了', expectedRoute: 'eventChain', tags: ['RECORD', 'trigger_event_chain', 'spouse_pregnancy'] },
  { id: 'command_reminder', category: 'write', title: '命令类回访提醒', input: '提醒我下周二给李总打电话', expectedRoute: 'write', tags: ['COMMAND', 'add_todo', 'reminder'] },
  { id: 'generate_birthday_wish', category: 'generate', title: '生成生日祝福', input: '帮我写条生日祝福给陈先生', expectedRoute: 'generate', tags: ['GENERATE', 'personalized-copy'] }
];

const clone = (value) => {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const baseContext = () => createContext();

function createStep(input, { clients = makeBenchmarkClients(), ctx = baseContext(), options = {} } = {}) {
  return { input, clients, ctx, options };
}

export function getScenarioPlan(id) {
  const commonClients = makeBenchmarkClients();

  switch (id) {
    case 'chat_short_circuit':
      return {
        scenario: SCENARIOS.find((s) => s.id === id),
        steps: [createStep('你好，今天怎么样', { clients: commonClients, ctx: baseContext() })],
        evaluate: (steps) => ({
          pass: Boolean(steps[0]?.result?.requestMeta?.shortCircuit) && (steps[0]?.result?.actions || []).length === 0,
          expected: 'shortCircuit + no actions'
        })
      };
    case 'knowledge_short_circuit':
      return {
        scenario: SCENARIOS.find((s) => s.id === id),
        steps: [createStep('终身寿险怎么算现金价值？', { clients: commonClients, ctx: baseContext() })],
        evaluate: (steps) => ({
          pass: Boolean(steps[0]?.result?.requestMeta?.shortCircuit) && (steps[0]?.result?.actions || []).length === 0,
          expected: 'shortCircuit + no actions'
        })
      };
    case 'focus_query': {
      const ctx = baseContext();
      ctx.focus_client = { id: 1, name: '张伟' };
      return {
        scenario: SCENARIOS.find((s) => s.id === id),
        steps: [createStep('他最近怎样', { clients: commonClients, ctx })],
        evaluate: (steps) => ({
          pass: steps[0]?.result?.requestMeta?.resolvedClients?.[0]?.id === 1 || steps[0]?.result?.ctx?.focus_client?.id === 1,
          expected: 'use focus_client = 1'
        })
      };
    }
    case 'locked_client': {
      const lockedClient = commonClients[2];
      return {
        scenario: SCENARIOS.find((s) => s.id === id),
        steps: [createStep('他最近怎样', { clients: [lockedClient], ctx: baseContext(), options: { lockedClient } })],
        evaluate: (steps) => ({
          pass: steps[0]?.result?.requestMeta?.resolvedClients?.[0]?.id === 3,
          expected: 'lockedClient resolves to id 3'
        })
      };
    }
    case 'ambiguity_clarify':
      return {
        scenario: SCENARIOS.find((s) => s.id === id),
        steps: [createStep('张总最近怎样', { clients: commonClients, ctx: baseContext() })],
        evaluate: (steps) => ({
          pass: Boolean(steps[0]?.result?.needsClarification),
          expected: 'needsClarification = true'
        })
      };
    case 'switch_contact': {
      const ctx = baseContext();
      ctx.focus_client = { id: 1, name: '张伟' };
      return {
        scenario: SCENARIOS.find((s) => s.id === id),
        steps: [createStep('那李总呢？', { clients: commonClients, ctx })],
        evaluate: (steps) => ({
          pass: steps[0]?.result?.ctx?.focus_client?.id === 3,
          expected: 'focus_client switches to id 3'
        })
      };
    }
    case 'multi_turn_summary': {
      const firstCtx = baseContext();
      return {
        scenario: SCENARIOS.find((s) => s.id === id),
        steps: [
          createStep('张伟最近怎样', { clients: commonClients, ctx: firstCtx }),
          createStep('帮我写一条跟进短信', { clients: commonClients, ctx: 'previous' })
        ],
          evaluate: (steps) => {
          const second = steps[1]?.result;
          return {
            pass: Boolean(second?.ctx?.conversation_summary) && (second?.ctx?.recent_messages || []).length >= 2 && String(second?.ctx?.conversation_summary).includes('张伟最近怎样'),
            expected: 'conversation summary persists'
          };
        }
      };
    }
    case 'pending_create':
      return {
        scenario: SCENARIOS.find((s) => s.id === id),
        steps: [createStep('今天见了个新朋友叫 Alice Ong', { clients: commonClients, ctx: baseContext() })],
        evaluate: (steps) => ({
          pass: (steps[0]?.result?.requestMeta?.pendingCreateMentions || []).includes('Alice Ong') ||
            (steps[0]?.result?.actions || []).some((a) => a.type === 'create_profile' && a.name === 'Alice Ong'),
          expected: 'create_profile or pending create'
        })
      };
    case 'life_event_spouse_pregnancy': {
      const ctx = baseContext();
      ctx.focus_client = { id: 3, name: '李总' };
      return {
        scenario: SCENARIOS.find((s) => s.id === id),
        steps: [createStep('李总太太怀孕了', { clients: commonClients, ctx })],
        evaluate: (steps) => ({
          pass: (steps[0]?.result?.actions || []).some((a) => a.type === 'add_todo' || a.type === 'add_trait') &&
            !(steps[0]?.result?.actions || []).some((a) => a.type === 'trigger_event_chain'),
          expected: 'expanded event chain actions only'
        })
      };
    }
    case 'command_reminder': {
      const ctx = baseContext();
      ctx.focus_client = { id: 3, name: '李总' };
      return {
        scenario: SCENARIOS.find((s) => s.id === id),
        steps: [createStep('提醒我下周二给李总打电话', { clients: commonClients, ctx })],
        evaluate: (steps) => ({
          pass: (steps[0]?.result?.actions || []).some((a) => a.type === 'add_todo' && a.clientId === 3),
          expected: 'add_todo for id 3'
        })
      };
    }
    case 'generate_birthday_wish':
      return {
        scenario: SCENARIOS.find((s) => s.id === id),
        steps: [createStep('帮我写条生日祝福给陈先生', { clients: commonClients, ctx: baseContext() })],
        evaluate: (steps) => ({
          pass: (steps[0]?.result?.actions || []).length === 0 && String(steps[0]?.result?.reply || '').includes('陈先生'),
          expected: 'no actions + personalized reply'
        })
      };
    default:
      return null;
  }
}

export async function runScenarioPlan(plan, runner) {
  const steps = [];
  let workingClients = null;
  let previousCtx = null;

  for (const step of plan.steps) {
    const ctx = step.ctx === 'previous' ? previousCtx : step.ctx;
    const clients = workingClients ? clone(workingClients) : clone(step.clients || []);
    const result = await runner(step.input, clients, ctx, step.options || {});
    steps.push({ ...step, result });
    previousCtx = result?.ctx || previousCtx;

    // 纯内存模拟生产写入：让下一轮看到上一轮动作后的客户状态，但不写任何持久化存储。
    let nextClients = clone(clients);
    for (const action of result?.actions || []) {
      const mutation = applyClientAction(nextClients, action);
      nextClients = mutation.nextClients;
    }
    workingClients = nextClients;
    if (!workingClients) {
      workingClients = clone(clients);
    }
  }

  const evaluation = plan.evaluate(steps);
  return {
    scenario: plan.scenario,
    steps,
    evaluation,
    finalClients: workingClients || []
  };
}

export function formatScenarioList() {
  return SCENARIOS.map((s, idx) => {
    const tags = s.tags?.length ? s.tags.join(', ') : '-';
    return `${String(idx + 1).padStart(2, '0')}. [${s.category}] ${s.title}\n    id: ${s.id}\n    input: ${s.input}\n    expected: ${s.expectedRoute}\n    tags: ${tags}`;
  }).join('\n');
}
