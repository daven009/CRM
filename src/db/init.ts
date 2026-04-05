import { getDb } from "./client";

function buildTimestamp() {
  return new Date().toISOString();
}

function insertOrIgnore(db: ReturnType<typeof getDb>, sql: string, params: Record<string, unknown>) {
  db.prepare(sql).run(params);
}

export function initDatabase() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY,
      customer_id TEXT,
      name TEXT NOT NULL,
      display_name TEXT NOT NULL,
      company TEXT NOT NULL,
      phone TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    CREATE TABLE IF NOT EXISTS contact_methods (
      id TEXT PRIMARY KEY,
      contact_id TEXT NOT NULL,
      method_type TEXT NOT NULL,
      label TEXT NOT NULL,
      value TEXT NOT NULL,
      is_primary INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (contact_id) REFERENCES contacts(id)
    );

    CREATE TABLE IF NOT EXISTS contact_basics (
      id TEXT PRIMARY KEY,
      contact_id TEXT NOT NULL,
      company TEXT NOT NULL,
      industry TEXT,
      relationship_type TEXT,
      acquisition_channel TEXT,
      first_met_at TEXT,
      owner TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (contact_id) REFERENCES contacts(id)
    );

    CREATE TABLE IF NOT EXISTS contact_profiles (
      id TEXT PRIMARY KEY,
      contact_id TEXT NOT NULL,
      title TEXT,
      department TEXT,
      city TEXT,
      source TEXT,
      owner TEXT,
      preference_json TEXT NOT NULL,
      profile_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (contact_id) REFERENCES contacts(id)
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      title TEXT NOT NULL,
      task_type TEXT NOT NULL,
      status TEXT NOT NULL,
      due_at TEXT,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    CREATE TABLE IF NOT EXISTS conversation_notes (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      raw_text TEXT NOT NULL,
      note_type TEXT NOT NULL,
      summary TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      structured_slots_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY,
      contact_id TEXT NOT NULL,
      customer_id TEXT,
      title TEXT NOT NULL,
      remind_at TEXT NOT NULL,
      note TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (contact_id) REFERENCES contacts(id),
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );
  `);

  const now = buildTimestamp();

  insertOrIgnore(
    db,
    "INSERT OR IGNORE INTO customers (id, name, created_at) VALUES (@id, @name, @created_at)",
    {
    id: "c_001",
    name: "张老板",
    created_at: now,
    },
  );
  insertOrIgnore(
    db,
    "INSERT OR IGNORE INTO customers (id, name, created_at) VALUES (@id, @name, @created_at)",
    {
    id: "c_002",
    name: "张建国",
    created_at: now,
    },
  );
  insertOrIgnore(
    db,
    "INSERT OR IGNORE INTO customers (id, name, created_at) VALUES (@id, @name, @created_at)",
    {
    id: "c_003",
    name: "王总",
    created_at: now,
    },
  );
  insertOrIgnore(
    db,
    "INSERT OR IGNORE INTO customers (id, name, created_at) VALUES (@id, @name, @created_at)",
    {
    id: "c_004",
    name: "张明远",
    created_at: now,
    },
  );
  insertOrIgnore(
    db,
    "INSERT OR IGNORE INTO customers (id, name, created_at) VALUES (@id, @name, @created_at)",
    {
    id: "c_005",
    name: "张志强",
    created_at: now,
    },
  );

  const insertContact = db.prepare(`
    INSERT OR IGNORE INTO contacts (id, customer_id, name, display_name, company, phone, created_at)
    VALUES (@id, @customer_id, @name, @display_name, @company, @phone, @created_at)
  `);

  insertContact.run({
    id: "ct_001",
    customer_id: "c_001",
    name: "张伟",
    display_name: "张总",
    company: "ABC贸易",
    phone: "13800000001",
    created_at: now,
  });

  insertContact.run({
    id: "ct_002",
    customer_id: "c_002",
    name: "张建国",
    display_name: "张总",
    company: "新海科技",
    phone: "13800000002",
    created_at: now,
  });

  insertContact.run({
    id: "ct_003",
    customer_id: "c_003",
    name: "王海峰",
    display_name: "王总",
    company: "远航实业",
    phone: "13800000003",
    created_at: now,
  });

  insertContact.run({
    id: "ct_004",
    customer_id: "c_004",
    name: "张明远",
    display_name: "张老板",
    company: "明远制造",
    phone: "13800000004",
    created_at: now,
  });

  insertContact.run({
    id: "ct_005",
    customer_id: "c_005",
    name: "张志强",
    display_name: "张总",
    company: "华星渠道",
    phone: "13800000005",
    created_at: now,
  });

  const insertContactMethod = db.prepare(`
    INSERT OR IGNORE INTO contact_methods (id, contact_id, method_type, label, value, is_primary, created_at)
    VALUES (@id, @contact_id, @method_type, @label, @value, @is_primary, @created_at)
  `);

  insertContactMethod.run({
    id: "cm_001",
    contact_id: "ct_001",
    method_type: "mobile",
    label: "工作手机",
    value: "13800000001",
    is_primary: 1,
    created_at: now,
  });
  insertContactMethod.run({
    id: "cm_002",
    contact_id: "ct_001",
    method_type: "wechat",
    label: "微信",
    value: "zhangwei_abc",
    is_primary: 0,
    created_at: now,
  });
  insertContactMethod.run({
    id: "cm_003",
    contact_id: "ct_001",
    method_type: "email",
    label: "邮箱",
    value: "zhangwei@abctrade.com",
    is_primary: 0,
    created_at: now,
  });

  insertContactMethod.run({
    id: "cm_004",
    contact_id: "ct_002",
    method_type: "mobile",
    label: "工作手机",
    value: "13800000002",
    is_primary: 1,
    created_at: now,
  });
  insertContactMethod.run({
    id: "cm_005",
    contact_id: "ct_002",
    method_type: "wechat",
    label: "微信",
    value: "xinhai_zhang",
    is_primary: 0,
    created_at: now,
  });
  insertContactMethod.run({
    id: "cm_006",
    contact_id: "ct_002",
    method_type: "email",
    label: "邮箱",
    value: "zhangjg@xinhai-tech.com",
    is_primary: 0,
    created_at: now,
  });

  insertContactMethod.run({
    id: "cm_007",
    contact_id: "ct_003",
    method_type: "mobile",
    label: "工作手机",
    value: "13800000003",
    is_primary: 1,
    created_at: now,
  });
  insertContactMethod.run({
    id: "cm_008",
    contact_id: "ct_003",
    method_type: "wechat",
    label: "微信",
    value: "wanghf_yhsy",
    is_primary: 0,
    created_at: now,
  });
  insertContactMethod.run({
    id: "cm_009",
    contact_id: "ct_004",
    method_type: "mobile",
    label: "老板手机",
    value: "13800000004",
    is_primary: 1,
    created_at: now,
  });
  insertContactMethod.run({
    id: "cm_010",
    contact_id: "ct_004",
    method_type: "wechat",
    label: "微信",
    value: "zhanglaoban_my",
    is_primary: 0,
    created_at: now,
  });
  insertContactMethod.run({
    id: "cm_011",
    contact_id: "ct_005",
    method_type: "mobile",
    label: "工作手机",
    value: "13800000005",
    is_primary: 1,
    created_at: now,
  });
  insertContactMethod.run({
    id: "cm_012",
    contact_id: "ct_005",
    method_type: "email",
    label: "邮箱",
    value: "zhangzq@huaxing-channel.com",
    is_primary: 0,
    created_at: now,
  });

  const insertContactBasic = db.prepare(`
    INSERT OR IGNORE INTO contact_basics (
      id, contact_id, company, industry, relationship_type, acquisition_channel, first_met_at, owner, created_at, updated_at
    ) VALUES (
      @id, @contact_id, @company, @industry, @relationship_type, @acquisition_channel, @first_met_at, @owner, @created_at, @updated_at
    )
  `);

  insertContactBasic.run({
    id: "cb_001",
    contact_id: "ct_001",
    company: "ABC贸易",
    industry: "跨境贸易",
    relationship_type: "客户",
    acquisition_channel: "展会认识",
    first_met_at: "2025-11-12T10:00:00+08:00",
    owner: "Alice",
    created_at: now,
    updated_at: now,
  });
  insertContactBasic.run({
    id: "cb_002",
    contact_id: "ct_002",
    company: "新海科技",
    industry: "工业软件",
    relationship_type: "客户",
    acquisition_channel: "老客户转介绍",
    first_met_at: "2025-09-03T14:30:00+08:00",
    owner: "Bob",
    created_at: now,
    updated_at: now,
  });
  insertContactBasic.run({
    id: "cb_003",
    contact_id: "ct_003",
    company: "远航实业",
    industry: "制造业",
    relationship_type: "客户",
    acquisition_channel: "官网留资",
    first_met_at: "2026-01-08T09:00:00+08:00",
    owner: "Cindy",
    created_at: now,
    updated_at: now,
  });
  insertContactBasic.run({
    id: "cb_004",
    contact_id: "ct_004",
    company: "明远制造",
    industry: "汽车零部件",
    relationship_type: "重点客户",
    acquisition_channel: "朋友介绍",
    first_met_at: "2025-12-20T19:00:00+08:00",
    owner: "Derek",
    created_at: now,
    updated_at: now,
  });
  insertContactBasic.run({
    id: "cb_005",
    contact_id: "ct_005",
    company: "华星渠道",
    industry: "渠道分销",
    relationship_type: "潜在客户",
    acquisition_channel: "渠道大会",
    first_met_at: "2026-02-18T11:00:00+08:00",
    owner: "Emma",
    created_at: now,
    updated_at: now,
  });

  const insertContactProfile = db.prepare(`
    INSERT OR IGNORE INTO contact_profiles (
      id, contact_id, title, department, city, source, owner, preference_json, profile_json, created_at, updated_at
    ) VALUES (
      @id, @contact_id, @title, @department, @city, @source, @owner, @preference_json, @profile_json, @created_at, @updated_at
    )
  `);

  insertContactProfile.run({
    id: "cp_001",
    contact_id: "ct_001",
    title: "总经理",
    department: "管理层",
    city: "上海",
    source: "展会线索",
    owner: "Alice",
    preference_json: JSON.stringify(["偏好微信沟通", "关注交付周期", "喜欢红酒"]),
    profile_json: JSON.stringify({
      budget_level: "high",
      buying_stage: "proposal",
      family_note: "女儿下个月24号生日",
    }),
    created_at: now,
    updated_at: now,
  });
  insertContactProfile.run({
    id: "cp_002",
    contact_id: "ct_002",
    title: "董事长",
    department: "管理层",
    city: "苏州",
    source: "老客户转介绍",
    owner: "Bob",
    preference_json: JSON.stringify(["更喜欢电话", "关注价格", "习惯周二上午开会"]),
    profile_json: JSON.stringify({
      budget_level: "medium",
      buying_stage: "evaluation",
      objection: "价格敏感",
    }),
    created_at: now,
    updated_at: now,
  });
  insertContactProfile.run({
    id: "cp_003",
    contact_id: "ct_003",
    title: "总经理",
    department: "销售管理",
    city: "杭州",
    source: "官网留资",
    owner: "Cindy",
    preference_json: JSON.stringify(["接受邮件和微信", "对产品demo很积极"]),
    profile_json: JSON.stringify({
      budget_level: "medium_high",
      buying_stage: "demo",
      decision_role: "final_approver",
    }),
    created_at: now,
    updated_at: now,
  });

  const insertTask = db.prepare(`
    INSERT OR IGNORE INTO tasks (id, customer_id, title, task_type, status, due_at, note, created_at, updated_at)
    VALUES (@id, @customer_id, @title, @task_type, @status, @due_at, @note, @created_at, @updated_at)
  `);

  insertTask.run({
    id: "t_101",
    customer_id: "c_001",
    title: "发送报价",
    task_type: "send_quote",
    status: "open",
    due_at: "2026-04-02T18:00:00+08:00",
    note: null,
    created_at: now,
    updated_at: now,
  });

  insertTask.run({
    id: "t_102",
    customer_id: "c_001",
    title: "催收首付款",
    task_type: "collect_payment",
    status: "open",
    due_at: null,
    note: null,
    created_at: now,
    updated_at: now,
  });

  insertOrIgnore(
    db,
    `
      INSERT OR IGNORE INTO reminders (
        id, contact_id, customer_id, title, remind_at, note, status, created_at, updated_at
      ) VALUES (
        @id, @contact_id, @customer_id, @title, @remind_at, @note, @status, @created_at, @updated_at
      )
    `,
    {
      id: "r_101",
      contact_id: "ct_001",
      customer_id: "c_001",
      title: "女儿生日提醒",
      remind_at: "2026-04-24T09:00:00+08:00",
      note: "示例提醒数据",
      status: "active",
      created_at: now,
      updated_at: now,
    },
  );
}
