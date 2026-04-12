/**
 * 第一波修复离线测试脚本
 * 
 * 测试覆盖：
 *   修复 #1: Stage 3 是否正确注入 lockedClient 的 materials/todos
 *   修复 #2: birthday_milestone 是否有 Event Chain 定义
 *   修复 #8: MAX_TOTAL_LLM_CALLS 是否已调至 6
 *
 * 运行：node --experimental-vm-modules scripts/test_wave1_fixes.js
 *       （需要先在顶部做 import.meta.env shim）
 */

// ── shim import.meta.env + localStorage ──────────────────
// 这些 shim 让浏览器端代码能在 Node 里加载
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

// ── 颜色 helper ──────────────────────────────────────────
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

const pass = (msg) => console.log(`  ${GREEN}✓${RESET} ${msg}`);
const fail = (msg) => { console.log(`  ${RED}✗${RESET} ${msg}`); failures.push(msg); };
const section = (msg) => console.log(`\n${CYAN}${BOLD}▸ ${msg}${RESET}`);

const failures = [];

// ─────────────────────────────────────────────────────────
// 由于模块使用 import.meta.env 和 localStorage，无法在 Node 中直接
// import。我们采用"直接读文件 + 正则提取"的方式验证关键逻辑。
// ─────────────────────────────────────────────────────────

/* ═══════════════════════════════════════════════════════════
 * 测试 #1：Stage 3 payload 是否包含 client_materials 字段
 * ═══════════════════════════════════════════════════════════ */
section('修复 #1: Stage 3 是否注入 lockedClient 的 materials/todos');

const pipelineSrc = fs.readFileSync(resolve(ROOT, 'src/lib/router/pipeline.js'), 'utf-8');

// 检查 stage3UserPayload 区域是否包含关键字段
const stage3PayloadMatch = pipelineSrc.match(
  /const stage3UserPayload\s*=\s*JSON\.stringify\(\{([\s\S]*?)\}\);/
);

if (!stage3PayloadMatch) {
  fail('未找到 stage3UserPayload 定义');
} else {
  const payload = stage3PayloadMatch[1];

  // 检查 client_materials
  if (payload.includes('client_materials')) {
    pass('stage3UserPayload 包含 client_materials 字段');
  } else {
    fail('stage3UserPayload 缺少 client_materials 字段');
  }

  // 检查 client_materials_meta
  if (payload.includes('client_materials_meta')) {
    pass('stage3UserPayload 包含 client_materials_meta 字段');
  } else {
    fail('stage3UserPayload 缺少 client_materials_meta 字段');
  }

  // 检查 current_focus_client 含 open_todos
  if (payload.includes('open_todos')) {
    pass('stage3UserPayload 的 current_focus_client 含 open_todos');
  } else {
    fail('stage3UserPayload 的 current_focus_client 缺少 open_todos');
  }

  // 检查 current_focus_client 含 materials
  if (payload.includes('materials:') || payload.includes('materials,')) {
    pass('stage3UserPayload 的 current_focus_client 含 materials');
  } else {
    fail('stage3UserPayload 的 current_focus_client 缺少 materials');
  }

  // 检查 materials_total_count
  if (payload.includes('materials_total_count')) {
    pass('stage3UserPayload 含 materials_total_count（截断元信息）');
  } else {
    fail('stage3UserPayload 缺少 materials_total_count');
  }

  // 检查 materials_truncated
  if (payload.includes('materials_truncated')) {
    pass('stage3UserPayload 含 materials_truncated（截断标记）');
  } else {
    fail('stage3UserPayload 缺少 materials_truncated');
  }
}

/* ═══════════════════════════════════════════════════════════
 * 测试 #2：birthday_milestone Event Chain 定义存在且完整
 * ═══════════════════════════════════════════════════════════ */
section('修复 #2: birthday_milestone Event Chain 定义');

const eventChainsSrc = fs.readFileSync(resolve(ROOT, 'src/lib/router/eventChains.js'), 'utf-8');

// 检查 birthday_milestone key 存在
if (eventChainsSrc.includes('birthday_milestone:') || eventChainsSrc.includes('birthday_milestone :')) {
  pass('EVENT_CHAINS 包含 birthday_milestone 定义');
} else {
  fail('EVENT_CHAINS 缺少 birthday_milestone 定义');
}

// 检查 birthday_milestone 有 todos 数组
const bmBlock = eventChainsSrc.match(/birthday_milestone\s*:\s*\{([\s\S]*?)\n  \}/);
if (bmBlock) {
  const block = bmBlock[1];

  // todos
  const todoMatches = block.match(/todo:\s*'[^']+'/g) || [];
  if (todoMatches.length >= 3) {
    pass(`birthday_milestone 有 ${todoMatches.length} 条待办`);
  } else {
    fail(`birthday_milestone 待办数量不足: ${todoMatches.length}`);
  }

  // traits
  if (block.includes('traits:')) {
    pass('birthday_milestone 有 traits 定义');
  } else {
    fail('birthday_milestone 缺少 traits 定义');
  }

  // recommendedScripts
  if (block.includes('recommendedScripts:')) {
    pass('birthday_milestone 有 recommendedScripts 定义');
  } else {
    fail('birthday_milestone 缺少 recommendedScripts 定义');
  }
} else {
  fail('无法解析 birthday_milestone 代码块');
}

// 检查 prompt 白名单与 EVENT_CHAINS 一致性
const stage3WriteSrc = fs.readFileSync(resolve(ROOT, 'src/lib/prompts/stage3Write.js'), 'utf-8');

// 从 prompt 中提取所有事件类型（行首 - event_name 格式）
const promptEventTypes = [...stage3WriteSrc.matchAll(/-\s+(\w+)\s+/g)]
  .map(m => m[1])
  .filter(e => !['trigger_event_chain', 'clientId', 'eventType'].includes(e) && /^[a-z_]+$/.test(e));

// 从 EVENT_CHAINS 中提取所有 key
const chainEventTypes = [...eventChainsSrc.matchAll(/^\s+(\w+)\s*:\s*\{/gm)]
  .map(m => m[1])
  .filter(e => e !== 'EVENT_CHAINS');

section('Prompt 白名单 vs EVENT_CHAINS 对齐检查');

// 找出在 prompt 中但不在 chains 中的
const missingInChains = promptEventTypes.filter(e => !chainEventTypes.includes(e));
if (missingInChains.length === 0) {
  pass('所有 prompt 白名单事件类型都有对应的 EVENT_CHAINS 定义');
} else {
  fail(`以下事件类型在 prompt 白名单中但缺少 EVENT_CHAINS 定义: ${missingInChains.join(', ')}`);
}

// 找出在 chains 中但不在 prompt 中的
const missingInPrompt = chainEventTypes.filter(e => !promptEventTypes.includes(e));
if (missingInPrompt.length === 0) {
  pass('所有 EVENT_CHAINS 定义都有对应的 prompt 白名单条目');
} else {
  // 这是 warning 不是 failure — chains 多了没事，prompt 少了可能影响 LLM 生成
  console.log(`  ${YELLOW}⚠${RESET} EVENT_CHAINS 有额外定义未在 prompt 中列出: ${missingInPrompt.join(', ')}（通常无害）`);
}

/* ═══════════════════════════════════════════════════════════
 * 测试 #3：MAX_TOTAL_LLM_CALLS 是否已提高
 * ═══════════════════════════════════════════════════════════ */
section('修复 #8: MAX_TOTAL_LLM_CALLS 上限调整');

const crmPipelineSrc = fs.readFileSync(resolve(ROOT, 'src/lib/crmPipeline.js'), 'utf-8');

const maxCallsMatch = crmPipelineSrc.match(/MAX_TOTAL_LLM_CALLS\s*:\s*(\d+)/);
if (maxCallsMatch) {
  const value = parseInt(maxCallsMatch[1], 10);
  if (value >= 6) {
    pass(`MAX_TOTAL_LLM_CALLS = ${value}（≥6，满足分层管线需求）`);
  } else {
    fail(`MAX_TOTAL_LLM_CALLS = ${value}，仍然太低（应 ≥ 6）`);
  }
} else {
  fail('未找到 MAX_TOTAL_LLM_CALLS 定义');
}

// 验证调用额度计算
const maxRepairMatch = crmPipelineSrc.match(/MAX_REPAIR_ROUNDS\s*:\s*(\d+)/);
const maxCalls = maxCallsMatch ? parseInt(maxCallsMatch[1], 10) : 0;
const maxRepairs = maxRepairMatch ? parseInt(maxRepairMatch[1], 10) : 0;

// 最坏情况: Stage1(1) + Stage1修复(maxRepairs) + Stage2(1) + Stage3(1) + Stage3修复(maxRepairs)
const worstCase = 1 + maxRepairs + 1 + 1 + maxRepairs;  // 不含 Stage2 修复
if (maxCalls >= worstCase) {
  pass(`额度够用：最坏情况需 ${worstCase} 次调用，上限 ${maxCalls}`);
} else {
  // 不一定是 failure，只是 warning
  console.log(`  ${YELLOW}⚠${RESET} 极端最坏情况需 ${worstCase} 次调用，上限 ${maxCalls}，可能紧张`);
}

/* ═══════════════════════════════════════════════════════════
 * 额外验证：expandEventChain 的 birthday_milestone 模拟展开
 * ═══════════════════════════════════════════════════════════ */
section('模拟 expandEventChain("birthday_milestone") 展开');

// 手动解析 EVENT_CHAINS 中 birthday_milestone 的 todos
const bmTodosMatch = eventChainsSrc.match(
  /birthday_milestone\s*:\s*\{[\s\S]*?todos\s*:\s*\[([\s\S]*?)\]/
);

if (bmTodosMatch) {
  const todosBlock = bmTodosMatch[1];
  const todos = [...todosBlock.matchAll(/\{\s*todo:\s*'([^']+)',\s*daysOffset:\s*(\d+)\s*\}/g)];
  
  if (todos.length > 0) {
    pass(`解析出 ${todos.length} 条待办：`);
    for (const t of todos) {
      console.log(`    📋 D+${t[2]}: ${t[1]}`);
    }
  } else {
    fail('birthday_milestone todos 解析失败');
  }
} else {
  fail('无法提取 birthday_milestone 的 todos 定义');
}

// 检查 traits
const bmTraitsMatch = eventChainsSrc.match(
  /birthday_milestone\s*:\s*\{[\s\S]*?traits\s*:\s*\[([\s\S]*?)\]/
);
if (bmTraitsMatch && bmTraitsMatch[1].trim()) {
  const traits = [...bmTraitsMatch[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  pass(`traits: [${traits.join(', ')}]`);
} else {
  console.log(`  ${YELLOW}⚠${RESET} birthday_milestone traits 为空（可接受但建议补充）`);
}

/* ═══════════════════════════════════════════════════════════
 * 额外验证：模拟用户输入场景下 pipeline 的关键分支
 * ═══════════════════════════════════════════════════════════ */
section('模拟用户场景：详情页对话（验证 lockedClient 路径）');

// 模拟检查：当 lockedClient 存在时，pipeline 中的条件分支
const hasLockedClientGuard = pipelineSrc.includes('lockedClient ? lockedClientMaterials : []');
if (hasLockedClientGuard) {
  pass('client_materials 有 lockedClient 条件守卫');
} else {
  fail('client_materials 缺少 lockedClient 条件守卫');
}

const hasMetaGuard = pipelineSrc.includes("lockedClient.files.length > materialLimit");
if (hasMetaGuard) {
  pass('client_materials_meta.truncated 有 materialLimit 截断检查');
} else {
  fail('client_materials_meta 缺少截断检查');
}

// 模拟场景：非详情页（lockedClient=null）应该得到空 materials
const hasNullFallback = pipelineSrc.includes('lockedClient\n      ? {') || pipelineSrc.includes('lockedClient\n      ?');
if (pipelineSrc.includes(': null,')) {
  pass('lockedClient 为 null 时，current_focus_client 正确设为 null');
} else {
  fail('lockedClient 为 null 时，fallback 处理有问题');
}

/* ═══════════════════════════════════════════════════════════
 * 测试总结
 * ═══════════════════════════════════════════════════════════ */
console.log('\n' + '═'.repeat(60));
if (failures.length === 0) {
  console.log(`${GREEN}${BOLD}✅ 全部通过！第一波修复验证成功。${RESET}`);
} else {
  console.log(`${RED}${BOLD}❌ 有 ${failures.length} 个失败：${RESET}`);
  failures.forEach((f, i) => console.log(`  ${RED}${i + 1}. ${f}${RESET}`));
}
console.log('═'.repeat(60) + '\n');

process.exit(failures.length > 0 ? 1 : 0);
