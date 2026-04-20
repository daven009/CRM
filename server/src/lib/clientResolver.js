/**
 * 程序侧客户消歧模块
 * 负责 fuzzy search、启发式匹配、澄清问题生成
 */

/**
 * 模糊搜索客户（程序侧）
 * @param {string} mention - 用户提到的客户称谓
 * @param {Array} clients - 完整客户列表
 * @returns {Array} 匹配的客户数组
 */
export function fuzzySearchClients(mention, clients = []) {
  const m = String(mention || '').trim().toLowerCase();
  if (!m) return [];

  const results = [];
  for (const c of clients) {
    const name = String(c.n || '').trim().toLowerCase();
    if (!name) continue;

    // 完全匹配
    if (name === m) {
      results.push(c);
      continue;
    }

    // 名字包含 mention（如 mention="张伟"，name="张伟明"）
    if (name.includes(m)) {
      results.push(c);
      continue;
    }

    // mention 包含名字（如 mention="张总"，name="张伟"）
    if (m.includes(name)) {
      results.push(c);
      continue;
    }

    // 姓氏 + 称谓匹配（如"张总"匹配所有姓张的）
    const surnameMatch = m.match(/^([\u4e00-\u9fa5])\s*(?:总|姐|哥|弟|叔|阿姨|太太|先生|女士|老师|老板|经理|董事|主任)/);
    if (surnameMatch && name.startsWith(surnameMatch[1])) {
      results.push(c);
      continue;
    }

    // 英文名模糊匹配（忽略大小写）
    if (/[a-zA-Z]/.test(m) && name.includes(m)) {
      results.push(c);
    }
  }

  return results;
}

/**
 * 启发式消歧：当 fuzzy search 命中多人时，尝试用程序侧规则缩小范围
 *
 * 设计原则：
 * - 此函数只在用户**显式提到模糊称谓**（如"陈总"命中多人）时被调用
 * - 当 is_focus_change=false（用户没有切换讨论对象）且 focus_client 在候选列表中时，
 *   优先选用 focus_client —— 这避免了"已确定焦点后还重复触发澄清"的问题
 * - 当 is_focus_change=true 时，不做 focus_client 优先选定，走正常消歧
 * - 只有当某个候选人有"压倒性"信号时才自动选定，否则返回 null 进入澄清
 *
 * @param {string} mention
 * @param {Array} hits - fuzzySearch 的命中结果
 * @param {Object} ctx - 会话上下文
 * @param {Object} [options] - 额外选项
 * @param {boolean} [options.isFocusChange=false] - Stage 1 判断是否切换了讨论对象
 * @returns {Object|null} 匹配的单个客户，或 null（需进一步消歧）
 */
export function heuristicMatch(mention, hits, ctx, options = {}) {
  if (!hits || hits.length <= 1) return hits?.[0] || null;

  const { isFocusChange = false } = options;

  // 1. 完全匹配姓名的优先（mention 完全等于某人名字，且只有一个完全匹配）
  const m = String(mention || '').trim().toLowerCase();
  const exactMatches = hits.filter(c => String(c.n || '').trim().toLowerCase() === m);
  if (exactMatches.length === 1) {
    return exactMatches[0];
  }

  // 2. Focus client 维持：当用户没有切换讨论对象（is_focus_change=false），
  //    且 focus_client 已确定且在候选列表中，优先选用 focus_client
  //    场景：用户之前已确定"陈素"，后续说"帮他写条祝福"→ LLM 返回 mentions=["陈总"]
  //    → fuzzy search 命中陈凯+陈素 → 应直接选陈素而非再次澄清
  if (!isFocusChange && ctx.focus_client && ctx.focus_client.id != null) {
    const focusHit = hits.find(c => c.id === ctx.focus_client.id);
    if (focusHit) {
      return focusHit;
    }
  }

  // 3. 多命中且没有唯一完全匹配 → 无法启发式判断，返回 null 进入澄清
  return null;
}

/**
 * 构建澄清问题
 * @param {string} mention
 * @param {Array} hits
 * @returns {string}
 */
export function buildClarifyQuestion(mention, hits) {
  const opts = hits
    .slice(0, 5)
    .map(c => `${c.n || '未知'}（${c.co || '未知公司'}，id:${c.id}）`)
    .join('；');
  return `我识别到"${mention}"对应多位客户，请确认你指的是哪一位：${opts}。`;
}

/**
 * 将客户对象转换为给 LLM 可读的完整档案格式
 * @param {Object} client - 原始客户对象
 * @returns {Object} LLM 可读格式
 */
export function toResolvedClientProfile(client) {
  return {
    id: client.id,
    name: client.n || '',
    company: client.co || '',
    role: client.role || '',
    phone: client.tel || '',
    birthday: client.bd || '',
    personality: client.ps || '',
    health_score: client.hp ?? 50,
    traits: client.traits || [],
    open_todos: (client.todos || []).filter(t => !t.done).map(t => ({
      text: t.t,
      days_from_now: t.d,
      source: t.s
    })),
    relations: client.refs || [],
    recent_log: (client.log || []).slice(0, 5).map(l => ({
      date: l.dt,
      source: l.src,
      text: l.tx
    }))
  };
}
