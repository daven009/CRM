export const C = [
  {
    id: 1,
    n: "张伟",
    sub: "David Zhang",
    co: "Prudential",
    role: "Senior Manager",
    tel: "+65 9123 4567",
    hp: 92,
    bd: "1989.03.15",
    ps: "理性务实",
    traits: [
      "⛳ 高尔夫",
      "🍷 红酒收藏",
      "👶 太太怀孕中",
      "📚 教育基金",
      "🐕 新买的金毛猎犬"
    ],
    todos: [
      { t: "发送教育基金方案", d: -2, s: "ai", done: false },
      { t: "约下周面谈投资组合", d: 3, s: "manual", done: false },
      { t: "宝宝保障计划咨询", d: 24, s: "ai", done: false }
    ],
    log: [
      { 
        dt: "03.31", src: "对话", tx: "更新了家庭画像并查询了保单详情", ai: "新增金毛猎犬作为情感切入点",
        history: [
          { r: "user", t: "资料更新一下，张伟最近新买了一只金毛猎犬。" },
          { r: "ai", t: "收到！已经为张伟添加了「新买的金毛猎犬」标签。这说明他最近的心情很放松，是一个很好的话题切入点。" },
          { r: "user", t: "他的保单详情和健康度评级是多少？" },
          { r: "ai", t: "张伟目前的保单涵盖非常全面，核心文件包含 Policy_2024.pdf 等，健康度评级为 92。考虑到宝宝即将出生，他现在的保障非常稳健。" }
        ]
      },
      { dt: "03.20", src: "微信", tx: "聊了教育基金，他很感兴趣", ai: "兴趣度高，建议3天内发方案" }
    ],
    social: ["WeChat ✓", "WhatsApp ✓", "LinkedIn"],
    files: ["Policy_2024.pdf", "Investment_Q1.xlsx"],
    from: "cold call · 2023",
    refs: ["李梅"],
    gifts: [
      { n: "Titleist Pro V1 高尔夫球", p: "S$89", why: "核心爱好", url: "https://titleist.com" },
      { n: "Macallan 12年雪莉桶", p: "S$128", why: "品质之选", url: "https://themacallan.com" }
    ]
  },

  {
    id: 2,
    n: "李梅",
    sub: "May Li",
    co: "DBS Bank",
    role: "VP, Wealth",
    tel: "+65 8234 5678",
    hp: 88,
    bd: "04.05",
    ps: "外向热情",
    traits: [
      "🧘 瑜伽",
      "🍽️ 美食达人",
      "🇬🇧 儿子在伦敦留学",
      "✨ 偏好高端品牌"
    ],
    todos: [
      { t: "准备大额储蓄险方案", d: 2, s: "ai", done: false },
      { t: "准备生日礼物 4.05", d: 8, s: "sys", done: false }
    ],
    log: [
      { 
        dt: "03.25", src: "对话", tx: "关于儿子伦敦留学的资产规划咨询", ai: "涉及跨境传承，是深度联系契机",
        history: [
          { r: "user", t: "李梅最近挺开心的，她儿子要去伦敦读研了。" },
          { r: "ai", t: "太棒了！伦敦的生活成本和学费都不低，她有提到资金安排吗？" },
          { r: "user", t: "她想咨询一下在那边买房或者大额汇款的合规问题。" },
          { r: "ai", t: "建议：通过设立「教育基金信托」来平衡资金利用率。不仅能解决学费，还能作为海外资产配置的第一步。我已经把相关案例发给她了。" }
        ]
      },
      { dt: "03.10", src: "面谈", tx: "下午茶讨论市场波动及资产避险", ai: "她对稳健资产有持续需求" }
    ],
    social: ["WeChat ✓", "WhatsApp ✓", "LinkedIn"],
    files: ["Referral_Agreement.pdf"],
    from: "张伟介绍",
    refs: ["王强", "Robert"],
    gifts: [
      { n: "Odette 米其林双人晚餐", p: "S$600", why: "美食达人，Odette是顶级餐厅", url: "https://odetterestaurant.com" },
      { n: "Lululemon Align 套装", p: "S$248", why: "瑜伽爱好者首选", url: "https://lululemon.com.sg" }
    ]
  },

  {
    id: 3,
    n: "王强",
    sub: "James Wang",
    co: "TechVenture",
    role: "CEO",
    tel: "+65 9345 6789",
    hp: 55,
    bd: "11.03",
    ps: "果断高效",
    traits: [
      "🏃 跑步",
      "🎧 播客",
      "📱 偏好WhatsApp",
      "⚡ 时间宝贵",
      "📈 投资"
    ],
    todos: [
      { t: "团队保险报价跟进（已发未回）", d: -5, s: "ai", done: false },
      { t: "Key-man insurance需求", d: 4, s: "manual", done: false }
    ],
    log: [
      { dt: "03.14", src: "WhatsApp", tx: "发了报价，还没回复", ai: "5天未回复，建议简短催一下" },
      { dt: "03.08", src: "电话", tx: "讨论团队保险需求", ai: null }
    ],
    social: ["WhatsApp ✓", "Twitter"],
    files: ["Team_Quote.pdf"],
    from: "李梅介绍",
    refs: [],
    gifts: [
      { n: "AirPods Pro 2", p: "S$379", why: "播客+跑步，降噪耳机", url: "https://apple.com/sg" },
      { n: "Garmin Forerunner 265", p: "S$649", why: "跑步进阶装备", url: "https://garmin.com.sg" }
    ]
  },

  {
    id: 4,
    n: "陈思思",
    sub: "Sisi Chen",
    co: "Freelance",
    role: "Creative Director",
    tel: "+65 8456 7890",
    hp: 28,
    bd: "04.12",
    ps: "感性细腻",
    traits: [
      "📸 摄影",
      "🎨 画画",
      "☕ 精品咖啡",
      "🏠 新工作室",
      "💫 重视体验",
      "💼 自由职业"
    ],
    todos: [
      { t: "祝贺新工作室开张", d: -10, s: "ai", done: false },
      { t: "重新介绍自由职业储蓄险", d: 6, s: "manual", done: false },
      { t: "准备生日礼物 4.12", d: 21, s: "sys", done: false }
    ],
    log: [
      { dt: "02.25", src: "微信", tx: "问候了一下，说最近很忙", ai: "25天未联系，关系下降中" }
    ],
    social: ["WeChat ✓", "Instagram"],
    files: [],
    from: "Design Conference 2025",
    refs: [],
    gifts: [
      { n: "Fellow Ode 磨豆机", p: "S$459", why: "精品咖啡爱好者", url: "https://fellowproducts.com" },
      { n: "Sony ZV-1 II 相机", p: "S$1,099", why: "摄影+创作者最爱", url: "https://sony.com.sg" }
    ]
  },

  {
    id: 5,
    n: "Robert",
    sub: "Tan",
    co: "Baker McKenzie",
    role: "Partner",
    tel: "+65 9567 8901",
    hp: 65,
    bd: "1985.01.25",
    ps: "严谨专业",
    traits: [
      "⛵ 帆船",
      "🥃 威士忌",
      "📖 阅读",
      "🎯 注重细节",
      "👩 太太Susan理财",
      "🏦 信托大客户"
    ],
    todos: [
      { t: "发送更新信托方案", d: 3, s: "ai", done: false },
      { t: "准备Susan理财分析", d: 3, s: "manual", done: false },
      { t: "年度保单Review", d: 6, s: "sys", done: false }
    ],
    log: [
      { 
        dt: "03.21", src: "对话", tx: "与 Robert 会面，讨论 Susan 的理财需求", 
        ai: "已为您生成后续智能提醒",
        history: [
          { r: "user", t: "我刚才见完 Robert 了，聊了关于他信托调整的事。" },
          { r: "ai", t: "收到，Robert 的态度怎么样？他之前对那个避税点有些疑虑。" },
          { r: "user", t: "解释清楚了，他也接受了。不过他太太 Susan 也在场，说听起来很有道理，想看看针对她自己的理财方案。" },
          { r: "ai", t: "这可是个绝佳的交叉销售机会！Susan 的偏好是什么？" },
          { r: "user", t: "她更看重稳健，不太喜欢高波动的。" },
          { r: "ai", t: "明白了。已为您更新 Susan 的标签，并创建了「Susan 理财初步分析」待办。下次见面前我帮你准备资料。" }
        ]
      },
      { 
        dt: "03.18", src: "对话", tx: "关于 Robert 信托会议的会前推演", 
        ai: "已为您排查重点疑虑",
        history: [
          { r: "user", t: "明天要见 Robert，帮我过一下他的情况。" },
          { r: "ai", t: "Robert 是 Baker McKenzie 的合伙人，职业病就是对细节特别敏感。上次你们卡在了信托资产跨境的部分。" },
          { r: "user", t: "对，帮我找个那个部分的专业解答话术。" },
          { r: "ai", t: "没问题。针对他的严谨风格，建议从监管合规角度切入。建议：重点提到新加坡金融管理局的最新合规指南，这将极大地增加你的话术公信力。" }
        ]
      }
    ],
    social: ["WhatsApp ✓", "LinkedIn"],
    files: ["Trust.pdf", "Estate_2025.pdf", "Policy_Bundle.pdf"],
    from: "李梅介绍",
    refs: [],
    gifts: [
      { n: "Balvenie 21年 Portwood", p: "S$388", why: "威士忌鉴赏家，收藏级", url: "https://thebalvenie.com" },
      { n: "Kindle Scribe", p: "S$529", why: "爱阅读，可以手写笔记", url: "https://amazon.sg" }
    ]
  }
];

export const EVT = (cs) => {
  const items = [];
  cs.forEach(c => {
    c.todos.filter(t => !t.done).forEach(t => {
      items.push({ c: c, tx: t.t, d: t.d, type: t.s === "sys" ? "system" : (t.d < 0 ? "overdue" : "todo") });
    });
  });
  return items.sort((a, b) => a.d - b.d);
};

export const MOCK_HISTORY = [
  {
    date: "03.21", 
    time: "09:30", 
    summary: "• AI助手交互：早间业务梳理\n• 数据洞察：AI 排出了重点客户跟进优先级，未发现紧急红灯\n• 结论确认：今天总体以稳健维系和日常跟进为主", 
    clients: [], 
    convos: [
      { r: "user", t: "今天该联系谁？" }, 
      { r: "ai", t: "你有 5 位重点客户。\n当前有 2 项已过期待办。\n\n你可以试着说：\n· 帮我处理王强的跟进\n· 给李梅准备什么礼物" }
    ] 
  },
  {
    date: "03.21", 
    time: "16:20", 
    summary: "• 进度更新：完成了与 Robert 的会面，信托方案即将调整\n• AI辅助：已确认需要重写信托架构文件，准备提供模板\n• 潜在商机：Susan 提到理财需求，AI 已自动打上「太太Susan理财」标签并新建分析待办", 
    clients: ["Robert"], 
    convos: [
      { r: "user", t: "我刚见完Robert，聊了信托调整的事" }, 
      { r: "ai", t: "已记录。Robert的信托方案需要更新，要我帮你准备文件吗？" }, 
      { r: "user", t: "好的，另外Susan说对理财感兴趣" }, 
      { r: "ai", t: "已添加标签「太太Susan理财」。建议下次会面准备一份初步分析。已创建待办。" }
    ] 
  },
  { 
    date: "03.20", 
    time: "11:45", 
    summary: "• 所属事务：张伟「教育基金」报价推进\n• 预警提醒：AI 侦测到该方案已拖延 2 天未发送\n• 执行动作：AI 利用客户「理性务实」的性格标签，量身定制了一套强调“税务与收益率”的话术供复制", 
    clients: ["张伟"], 
    convos: [
      { r: "user", t: "张伟教育基金那个事怎么样了" }, 
      { r: "ai", t: "上次3月20日微信聊过，他表现出高兴趣。方案对比还没发给他，已经过了2天。要我帮你写条消息吗？" }, 
      { r: "user", t: "帮我写一条" }, 
      { r: "ai", t: "好的，基于他理性务实的性格，我写了一条偏数据导向的消息：\n\n「Hi David，教育基金的几个方案我帮你做了对比分析，涵盖收益率、灵活度和税务优化三个维度。方便的话这周找个时间详细聊聊？」" }
    ] 
  }
];

export const USER_PROFILE = {
  n: "Steven",
  co: "Prudential",
  role: "Financial Director",
  avatar: "S"
};

export const CONNECTED_APPS = [
  { n: "WhatsApp", sub: "Message drafting & sync", on: true },
  { n: "WeChat", sub: "Client timeline sync", on: true },
  { n: "Google Calendar", sub: "Meetings & Birthdays", on: false },
  { n: "LinkedIn", sub: "Profile enrichment", on: true },
  { n: "Outlook", sub: "Email thread sync", on: false }
];

export const BDAY_ALERTS = {
  2: { tx: "生日还有14天，还没准备礼物。", act: "准备礼物" },
  4: { tx: "生日还有21天。25天未联系，建议先破冰。", act: "帮我拟消息" }
};

export const MOCK_SCENARIOS = [
  {
    theme: "Policy Renewal",
    type: "progress",
    turns: [
      "我刚才跟{name}电话聊了一下，他/她对续保方案挺感兴趣的。",
      "他/她问了保费能不能优化，我说帮他/她对比几家看看。",
      "他说这周五之前给我答复，到时候再确认细节。"
    ],
    responses: [
      "收到！根据{name}的画像，他/她比较看重性价比。建议你准备一份「保障不变、保费优化」的对比表，更容易打动他/她。",
      "好的。针对他/她目前的保额，我帮你拉了三家的报价对比。其中有一家在同等保障下能省 15% 左右，可以作为核心推荐。",
      "明白了。我帮你设置了周五的跟进提醒。另外建议提前准备好电子签名链接，他/她确认后可以马上推进。"
    ],
    todoCreates: [null, null, { t: "周五跟进续保答复", d: 5, s: "ai" }],
    summary: "• 续保进展：{name}对优化方案感兴趣\n• 下一步：周五前等待客户答复确认"
  },
  {
    theme: "Meeting Debrief",
    type: "progress",
    turns: [
      "我刚见完{name}，聊了差不多一个小时。",
      "他/她最近对资产配置有些新想法，想做一些调整。",
      "另外他/她提到有朋友也想了解一下，可能是个转介绍机会。"
    ],
    responses: [
      "一个小时的面谈效率很高。{name}主动聊资产配置说明信任度在提升，这是深化关系的好信号。",
      "建议趁热打铁，48 小时内把调整方案的初稿发给他/她。记住他的风格——数据先行，结论在前。",
      "转介绍太棒了！建议你下次见面时自然地提一句：'方便的话帮我引荐一下，我可以先帮他/她做个免费的保障缺口分析。'我已经帮你新建了一个待办。"
    ],
    todoCreates: [null, { t: "48h内发送资产配置调整方案初稿", d: 2, s: "ai" }, { t: "跟进转介绍机会", d: 7, s: "ai" }],
    summary: "• 面谈总结：{name}有资产配置调整需求\n• 潜在机会：客户提到转介绍意向"
  },
  {
    theme: "Profile Update",
    type: "operational",
    profileUpdates: ["🎯 资产配置需求", "⛳ 高尔夫兴趣"],
    turns: [
      "帮我更新一下{name}的资料，他/她最近有了新的理财需求。",
      "对了，他/她的年度保单 Review 也该安排了。",
      "帮我记录一下，他/她最近对高尔夫产生了兴趣。"
    ],
    responses: [
      "好的，已经帮{name}标注了「资产配置需求」，并创建了待办提醒。这个标签会帮助我在后续推荐中优先匹配相关方案。",
      "没问题，已为{name}创建「年度保单Review」待办。建议在下次联系时主动提出，显得你很专业、有节奏感。",
      "收到。高尔夫是一个非常好的线下社交场景。我已经为{name}更新了「⛳ 高尔夫」标签，下次可以以此切入。"
    ],
    todoCreates: [{ t: "准备资产配置方案", d: 5, s: "ai" }, { t: "安排年度保单Review", d: 14, s: "ai" }, null],
    summary: "• 画像更新：{name}新增资产配置需求\n• 待办：年度Review安排及高尔夫兴趣记录"
  },
  {
    theme: "Strategy Consultation",
    type: "advisory",
    turns: [
      "{name}最近不太回消息，你觉得我该怎么办？",
      "他/她是不是对我们的方案不太满意？",
      "帮我想个能自然地重新建立联系的方式。"
    ],
    responses: [
      "别担心，不回消息不一定代表不感兴趣。根据{name}的性格画像，他/她可能只是在忙。建议换个非业务的话题切入。",
      "未必是不满意。可能是方案太多选择反而犹豫了。建议你精简到最核心的一个推荐，降低他的决策负担。",
      "可以从他的兴趣爱好入手。比如发一篇和他爱好相关的文章，附上一句'看到这个想到你'，自然又不刻意。我帮你设了3天后的跟进提醒，届时再顺势聊回业务。"
    ],
    todoCreates: [null, null, { t: "兴趣话题破冰后跟进业务", d: 3, s: "ai" }],
    summary: "• 咨询建议：{name}失联应对策略\n• 核心方法：兴趣话题破冰、精简方案降低决策负担"
  },
  {
    theme: "Family Planning",
    type: "progress",
    turns: [
      "我刚才听{name}说，他/她们家最近在考虑给孩子存教育金。",
      "他/她想看看有没有那种既有保障，收益又比较稳健的方案。",
      "帮我准备一份针对家庭教育支出的财务建议书。"
    ],
    responses: [
      "教育金是刚需，也是深耕家庭关系的最好入口。对于{name}来说，稳定性是排名第一的诉求。",
      "没问题。我会结合{name}的当前保单，找出一个能和现有保障互补的教育金模型。重点突出：复利增长、刚性给付、税务优化。",
      "好的，建议书大纲已生成。你可以告诉他/她：'这不仅是给孩子的存钱罐，更是他/她未来的教育护照。'话术已经帮你准备好了。"
    ],
    todoCreates: [null, null, { t: "发送教育金财务建议书", d: 3, s: "ai" }],
    summary: "• 业务深潜：{name}家庭教育金规划推演\n• 核心方案：复利型教育金、税务优化咨询"
  }
];

export const DETAIL_MOCK_MSGS = [
  "刚跟她通完电话，下个月面聊准备续保的事",
  "她的保单详情和健康度评级是多少",
  "资料更新一下，她最近新买了一只金毛猎犬"
];

export const DEFAULT_DOMAIN = "高端财富管理与保险规划";

export const DEFAULT_KEYWORDS = ["家族信托", "大额保单", "CRS税务筹划", "隔代传承"];

export const DEFAULT_KNOWLEDGE_FILES = [
  { name: "2024_FWD_Life_Shield_Terms.pdf", type: "file", size: "2.4 MB", active: true },
  { name: "High Net Worth Guide.docx", type: "file", size: "840 KB", active: true },
  { name: "www.straitstimes.com/market-outlook", type: "url", size: "web", active: true }
];

export const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
