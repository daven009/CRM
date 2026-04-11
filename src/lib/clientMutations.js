const todayLabel = () => {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
};

const createLog = (tx, src = "系统", ai = null) => ({ dt: todayLabel(), src, tx, ai });

const clamp = (num, min, max) => Math.max(min, Math.min(max, num));

export const createClientDraft = ({ id, name, company = "", source = "手动添加" }) => ({
  id,
  n: name,
  co: company || "Unknown",
  role: "",
  tel: "",
  hp: 50,
  bd: "",
  ps: "待了解",
  traits: [],
  todos: [],
  log: [createLog("联系人已创建")],
  social: [],
  files: [],
  from: source,
  refs: [],
  gifts: []
});

const PROFILE_FIELD_ALIASES = {
  co: ["co", "company", "公司", "corp", "organization"],
  role: ["role", "title", "职位", "职业", "position", "job", "job_title"],
  bd: ["bd", "birthday", "生日", "birth", "birth_date", "birthdate", "dob", "date_of_birth"],
  ps: ["ps", "personality", "性格", "persona", "character", "note", "备注"],
  tel: ["tel", "phone", "电话", "telephone", "mobile", "手机", "phone_number"],
  n: ["n", "name", "姓名", "名字", "client_name"],
};

const resolveUpdates = (raw = {}) => {
  const resolved = {};
  const entries = Object.entries(raw);

  for (const [canonical, aliases] of Object.entries(PROFILE_FIELD_ALIASES)) {
    for (const [key, value] of entries) {
      if (value === undefined || value === null) continue;
      if (aliases.includes(key) || aliases.includes(key.toLowerCase())) {
        resolved[canonical] = String(value).trim();
        break;
      }
    }
  }

  return resolved;
};

const pickProfileChanges = (client, rawUpdates = {}) => {
  const updates = resolveUpdates(rawUpdates);
  const next = { ...client };
  const changed = [];

  if (updates.n !== undefined && updates.n !== client.n) {
    next.n = updates.n;
    changed.push("姓名");
  }
  if (updates.co !== undefined && updates.co !== client.co) {
    next.co = updates.co;
    changed.push("公司");
  }
  if (updates.role !== undefined && updates.role !== client.role) {
    next.role = updates.role;
    changed.push("职位");
  }
  if (updates.bd !== undefined && updates.bd !== client.bd) {
    next.bd = updates.bd;
    changed.push("生日");
  }
  if (updates.ps !== undefined && updates.ps !== client.ps) {
    next.ps = updates.ps;
    changed.push("性格");
  }
  if (updates.tel !== undefined && updates.tel !== client.tel) {
    next.tel = updates.tel;
    changed.push("电话");
  }

  return { next, changed };
};

export const applyClientAction = (clients, actionLike = {}) => {
  const action = { ...actionLike, type: String(actionLike?.type || "") };
  const next = Array.isArray(clients) ? [...clients] : [];
  const index = action.clientId == null ? -1 : next.findIndex((c) => c.id === action.clientId);
  const target = index >= 0 ? next[index] : null;

  const result = {
    nextClients: next,
    mutation: null,
    changedClient: null,
    deletedClientId: null,
    createdClient: null
  };

  if (action.type === "create_profile") {
    const id = next.length ? Math.max(...next.map((c) => Number(c.id) || 0)) + 1 : 1;
    const created = createClientDraft({
      id,
      name: String(action.name || "新联系人"),
      company: String(action.company || ""),
      source: "Playground"
    });
    next.unshift(created);
    result.createdClient = created;
    result.changedClient = created;
    result.mutation = `创建联系人 #${id} ${created.n}`;
    return result;
  }

  if (action.type === "delete_profile") {
    if (!target) return result;
    const name = target.n;
    next.splice(index, 1);
    result.deletedClientId = target.id;
    result.mutation = `删除联系人 ${name}(#${target.id})`;
    return result;
  }

  if (!target) return result;

  if (action.type === "update_profile") {
    const { next: updated, changed } = pickProfileChanges(target, action.updates || {});
    if (changed.length > 0) {
      updated.log = [createLog(`更新了${changed.join("、")}信息`), ...(target.log || [])];
      next[index] = updated;
      result.changedClient = updated;
      result.mutation = `更新 ${updated.n} 资料`;
    }
    return result;
  }

  if (action.type === "add_trait") {
    const trait = String(action.trait || "").trim();
    if (!trait || (target.traits || []).includes(trait)) return result;
    const updated = { ...target, traits: [trait, ...(target.traits || [])] };
    next[index] = updated;
    result.changedClient = updated;
    result.mutation = `为 ${updated.n} 新增标签: ${trait}`;
    return result;
  }

  if (action.type === "remove_trait") {
    const trait = String(action.trait || "").trim();
    if (!trait) return result;
    const updatedTraits = (target.traits || []).filter((t) => t !== trait);
    if (updatedTraits.length === (target.traits || []).length) return result;
    const updated = { ...target, traits: updatedTraits };
    next[index] = updated;
    result.changedClient = updated;
    result.mutation = `为 ${updated.n} 移除标签: ${trait}`;
    return result;
  }

  if (action.type === "add_relation") {
    const relation = String(action.relation || "新增关系线索").trim();
    const updated = { ...target, refs: [relation, ...(target.refs || [])] };
    next[index] = updated;
    result.changedClient = updated;
    result.mutation = `为 ${updated.n} 新增关系线索`;
    return result;
  }

  if (action.type === "add_todo") {
    const genericTodoRe = /(安排一次跟进|安排跟进|跟进一下|后续跟进|保持联系|后续再聊|推进一下|回头联系|抽空联系)/;
    const rawTodo = String(action.todo || "").trim();
    const todo = rawTodo && !genericTodoRe.test(rawTodo)
      ? rawTodo
      : "确认具体跟进目标并明确下一步动作";
    const days = Number.isFinite(Number(action.days)) ? Number(action.days) : 3;
    const updated = {
      ...target,
      todos: [{ t: todo, d: days, s: "ai", done: false }, ...(target.todos || [])]
    };
    next[index] = updated;
    result.changedClient = updated;
    result.mutation = `为 ${updated.n} 新增待办: ${todo}`;
    return result;
  }

  if (action.type === "complete_todo") {
    const todos = [...(target.todos || [])];
    const idx = action.todo ? todos.findIndex((x) => !x.done && x.t === action.todo) : todos.findIndex((x) => !x.done);
    if (idx < 0) return result;
    todos[idx] = { ...todos[idx], done: true };
    const updated = {
      ...target,
      todos,
      log: [createLog(`标记待办「${String(todos[idx].t || "").slice(0, 8)}...」完成`), ...(target.log || [])]
    };
    next[index] = updated;
    result.changedClient = updated;
    result.mutation = `将 ${updated.n} 的待办标记完成`;
    return result;
  }

  if (action.type === "update_todo") {
    const todos = [...(target.todos || [])];
    const idx = todos.findIndex((x) => !x.done && (action.targetTodo ? x.t === action.targetTodo : true));
    if (idx < 0) return result;
    const nextTodo = action.todo ? String(action.todo) : todos[idx].t;
    const nextDays = Number.isFinite(Number(action.days)) ? Number(action.days) : todos[idx].d;
    todos[idx] = { ...todos[idx], t: nextTodo, d: nextDays };
    const updated = { ...target, todos };
    next[index] = updated;
    result.changedClient = updated;
    result.mutation = `更新 ${updated.n} 的待办`;
    return result;
  }

  if (action.type === "delete_todo") {
    const todo = String(action.todo || "").trim();
    if (!todo) return result;
    const todos = (target.todos || []).filter((x) => x.t !== todo);
    if (todos.length === (target.todos || []).length) return result;
    const updated = { ...target, todos };
    next[index] = updated;
    result.changedClient = updated;
    result.mutation = `删除 ${updated.n} 的待办: ${todo}`;
    return result;
  }

  if (action.type === "update_health") {
    const delta = Number.isFinite(Number(action.delta)) ? Number(action.delta) : 0;
    const before = Number.isFinite(Number(target.hp)) ? Number(target.hp) : 50;
    const updated = { ...target, hp: clamp(before + delta, 0, 100) };
    next[index] = updated;
    result.changedClient = updated;
    result.mutation = `更新 ${updated.n} 健康度: ${before} → ${updated.hp}`;
    return result;
  }

  if (action.type === "add_timeline" || action.type === "add_notification") {
    const text = String(action.text || "已记录输入文本").trim();
    if (!text) return result;
    const updated = {
      ...target,
      log: [createLog(text, "Playground", "模型输出驱动"), ...(target.log || [])]
    };
    next[index] = updated;
    result.changedClient = updated;
    result.mutation = `向 ${updated.n} 的 timeline 写入 1 条`;
    return result;
  }

  return result;
};
