/**
 * Live model benchmark for RelateAI scenarios.
 *
 * Usage:
 *   node scripts/model_benchmark.js
 *   node scripts/model_benchmark.js --provider openai
 *   node scripts/model_benchmark.js --scenario ambiguity_clarify
 *
 * This is intentionally softer than regression:
 * - it runs against a real model provider
 * - it scores broad behaviors rather than exact text
 * - it prints per-scenario observations for manual review
 */
import fs from 'fs';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';

import { SCENARIOS } from './regression-scenarios.js';
import { runStagedPipeline } from '../src/lib/router/pipeline.js';
import { createContext } from '../src/lib/router/context.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

const FIXED_NOW = '2026-04-12T10:00:00+08:00';

function loadDotEnv(filepath) {
  if (!fs.existsSync(filepath)) return {};
  const content = fs.readFileSync(filepath, 'utf-8');
  const out = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    out[key] = value;
  }
  return out;
}

function parseArgs() {
  const args = new Set(process.argv.slice(2));
  const providerIndex = process.argv.indexOf('--provider');
  const scenarioIndex = process.argv.indexOf('--scenario');
  const provider = providerIndex >= 0 ? (process.argv[providerIndex + 1] || 'openai') : 'openai';
  const scenario = scenarioIndex >= 0 ? (process.argv[scenarioIndex + 1] || '') : '';
  return {
    listOnly: args.has('--list'),
    provider,
    scenario
  };
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

function makeClients() {
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

function scoreScenario(id, result) {
  const actions = Array.isArray(result?.actions) ? result.actions : [];
  const intents = Array.isArray(result?.intents) ? result.intents : [];
  const topIntent = String(intents[0]?.type || '');

  switch (id) {
    case 'chat_short_circuit':
    case 'knowledge_short_circuit':
      return {
        pass: Boolean(result?.requestMeta?.shortCircuit) && actions.length === 0,
        expected: 'shortCircuit + no actions'
      };
    case 'focus_query':
      return {
        pass: result?.ctx?.focus_client?.id === 1 || result?.requestMeta?.resolvedClients?.[0]?.id === 1,
        expected: 'use focus_client = 1'
      };
    case 'locked_client':
      return {
        pass: result?.requestMeta?.resolvedClients?.[0]?.id === 3,
        expected: 'lockedClient resolves to id 3'
      };
    case 'ambiguity_clarify':
      return {
        pass: Boolean(result?.needsClarification),
        expected: 'needsClarification = true'
      };
    case 'switch_contact':
      return {
        pass: result?.ctx?.focus_client?.id === 3,
        expected: 'focus_client switches to id 3'
      };
    case 'multi_turn_summary':
      return {
        pass: Boolean(result?.ctx?.conversation_summary) && result.ctx.recent_messages?.length >= 1,
        expected: 'conversation summary persists'
      };
    case 'pending_create':
      return {
        pass: actions.some((a) => a.type === 'create_profile' && String(a.name || '').includes('Alice Ong')) ||
          result?.requestMeta?.pendingCreateMentions?.includes('Alice Ong'),
        expected: 'create_profile or pending create'
      };
    case 'life_event_spouse_pregnancy':
      return {
        pass: actions.some((a) => a.type === 'add_todo' || a.type === 'add_trait') && !actions.some((a) => a.type === 'trigger_event_chain'),
        expected: 'expanded event chain actions only'
      };
    case 'command_reminder':
      return {
        pass: actions.some((a) => a.type === 'add_todo' && a.clientId === 3),
        expected: 'add_todo for id 3'
      };
    case 'generate_birthday_wish':
      return {
        pass: actions.length === 0 && String(result?.reply || '').includes('陈先生'),
        expected: 'no actions + personalized reply'
      };
    default:
      return {
        pass: topIntent.length > 0,
        expected: 'basic response'
      };
  }
}

function printScenarioHeader(scenario, provider) {
  console.log(`\n${CYAN}${BOLD}${scenario.title}${RESET}`);
  console.log(`id: ${scenario.id}`);
  console.log(`provider: ${provider}`);
  console.log(`input: ${scenario.input}`);
}

async function runSingleScenario(provider, scenario) {
  const clients = makeClients();
  const ctx = createContext();
  let input = scenario.input;
  let options = { now: FIXED_NOW };
  let historyCtx = ctx;

  if (scenario.id === 'locked_client') {
    options = { ...options, lockedClient: clients[2] };
  }

  if (scenario.id === 'multi_turn_summary') {
    const first = await runStagedPipeline(
      '张伟最近怎样',
      clients,
      historyCtx,
      provider,
      { now: FIXED_NOW }
    );
    historyCtx = first.ctx;
    input = scenario.input;
    options = { ...options, now: FIXED_NOW };
    const second = await runStagedPipeline(input, clients, historyCtx, provider, options);
    return { first, second, result: second };
  }

  const result = await runStagedPipeline(input, clients, historyCtx, provider, options);
  return { result };
}

async function main() {
  const args = parseArgs();
  const env = {
    ...process.env,
    ...loadDotEnv(path.resolve(ROOT, '.env.local'))
  };
  globalThis.__RELATE_AI_ENV__ = env;

  if (args.listOnly) {
    console.log(SCENARIOS.map((s) => `${s.id}  [${s.category}]  ${s.title}`).join('\n'));
    return;
  }

  const targetScenarios = args.scenario
    ? SCENARIOS.filter((s) => s.id === args.scenario)
    : SCENARIOS;

  const hasKey = Boolean(
    env.VITE_OPENAI_API_KEY || env.VITE_CLAUDE_API_KEY || env.VITE_MINIMAX_API_KEY
  );

  if (!hasKey) {
    console.log(`${YELLOW}No API key detected in env or .env.local.${RESET}`);
    console.log(`Set VITE_OPENAI_API_KEY / VITE_CLAUDE_API_KEY / VITE_MINIMAX_API_KEY, or pass --provider with a configured model.`);
    process.exit(1);
  }

  console.log(`${CYAN}${BOLD}Live Model Benchmark${RESET}`);
  console.log(`Root: ${ROOT}`);
  console.log(`Provider: ${args.provider}`);
  console.log(`Scenarios: ${targetScenarios.length}`);

  const rows = [];
  let passCount = 0;

  for (const scenario of targetScenarios) {
    printScenarioHeader(scenario, args.provider);
    try {
      const run = await runSingleScenario(args.provider, scenario);
      const result = run.result;
      const score = scoreScenario(scenario.id, result);
      const intents = Array.isArray(result?.intents) ? result.intents.map((i) => i.type).join(', ') : '-';
      const actions = Array.isArray(result?.actions) ? result.actions.map((a) => a.type).join(', ') || '-' : '-';

      console.log(`  expected: ${score.expected}`);
      console.log(`  pass: ${score.pass ? 'yes' : 'no'}`);
      console.log(`  intents: ${intents}`);
      console.log(`  actions: ${actions}`);
      console.log(`  reply: ${String(result?.reply || '').slice(0, 180)}`);
      if (result?.needsClarification) {
        console.log(`  clarification: ${String(result?.clarifyingQuestion || '').slice(0, 180)}`);
      }
      if (score.pass) passCount += 1;
      rows.push({ id: scenario.id, pass: score.pass, result });
    } catch (error) {
      console.log(`  ${RED}error:${RESET} ${error.message}`);
      rows.push({ id: scenario.id, pass: false, error: error.message });
    }
  }

  const total = rows.length;
  const failed = total - passCount;
  console.log(`\n${'═'.repeat(72)}`);
  console.log(`${BOLD}${failed === 0 ? GREEN : RED}Passed ${passCount}/${total} live checks${RESET}`);
  if (failed > 0) {
    console.log(`${RED}${failed} scenario(s) need attention${RESET}`);
  }
  console.log('═'.repeat(72) + '\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
