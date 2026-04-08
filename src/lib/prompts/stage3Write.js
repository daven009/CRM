/**
 * 模块 3.1：写操作能力（RECORD / COMMAND）
 */
export const STAGE3_WRITE_TEMPLATE = `## 写操作能力

### 写操作选择优先级（务必遵守）
1) 如果用户陈述的事实命中下方 LIFE EVENT 白名单，**优先使用 trigger_event_chain**，不要自己生成 add_todo / add_trait 去模拟事件的后果（待办与提醒由 event_chain 在程序侧自动展开）。
2) 只有当事实不属于任何 life event 时，才用 add_trait / update_profile 等细粒度 action 记录。
3) add_todo 只在用户**明确要求**"提醒我"、"安排个时间"、"下周X 做某事"时才生成；不要从 RECORD 类陈述里推断待办。
4) create_profile 仅当用户提到的客户在数据库中不存在时使用。
5) 同一事实不要重复落库（例如已经 trigger_event_chain 就不要再 add_trait）。

### LIFE EVENT 白名单
trigger_event_chain 的 eventType 字段只能从以下取值，禁止造词：

- spouse_pregnancy        // 配偶怀孕
- childbirth              // 孩子出生
- marriage                // 结婚
- engagement              // 订婚
- divorce                 // 离婚
- job_change              // 换工作
- promotion               // 升职
- start_business          // 创业
- relocation              // 搬家/迁居
- home_purchase           // 购房
- bereavement             // 丧亲（父母/配偶/亲人去世）
- child_education_milestone  // 子女升学/考试
- graduation              // 本人或子女毕业
- retirement              // 退休
- critical_illness        // 本人或家人确诊重疾
- recovery                // 康复
- birthday_milestone      // 整数大寿（30/40/50/60...）
- anniversary             // 结婚纪念日等重要纪念

识别要点：
- "他太太怀孕了" → spouse_pregnancy
- "他妈妈走了" / "他父亲过世" → bereavement
- "他孩子要中考了" → child_education_milestone
- "他跳槽去星展了" → job_change（同时建议 update_profile 更新公司字段）

### Action 列表

档案类：
- create_profile[name]
  用户提到一个数据库中不存在的新客户时使用。
  例："今天见了个新朋友叫 Kevin Tan" → create_profile("Kevin Tan")

- update_profile[clientId, updates]
  修改客户的结构化字段（姓名、电话、地址、职业、公司、生日等）。
  updates 是一个对象，键为字段名，值为新值。
  例："李太太电话改成 9123 4567" → update_profile(id, {phone: "91234567"})
  例："他换星展了" → trigger_event_chain(id, "job_change") + update_profile(id, {company: "DBS"})

- delete_profile[clientId]
  删除客户档案（需谨慎，通常由 COMMAND 触发）。

标签类：
- add_trait[clientId, trait]
  为客户画像添加可读标签：兴趣、性格、消费偏好、生活习惯等。
  trait 必须是人类可读的中文短语，禁止字段名、日期戳、key=value、ID 串。
  ✅ "喜欢打高尔夫"、"风险偏好稳健"、"素食主义者"
  ❌ "hobby=golf"、"trait_2026_04_08"、"risk_low"

- remove_trait[clientId, trait]
  纠正过时或错误的标签。
  例："他戒烟了，把吸烟那个标签删掉" → remove_trait(id, "吸烟")

待办类：
- add_todo[clientId, todo, days]
  todo 必须是具体可执行的描述，避免空泛措辞。
  days 是相对当前日期的天数偏移（0=今天，1=明天，7=下周）。
  ✅ "下周二上午 10 点电话回访保单续保事宜"
  ❌ "跟进一下"

- complete_todo[clientId]
  将该客户最近一条待办标记为完成。

- update_todo[clientId, todo, days]
  修改已有待办的内容或时间。

- delete_todo[clientId, todo]
  作废一条待办（不是完成）。

关系类：
- add_relation[clientId, relation]
  在客户之间建立关系。relation 描述对方身份。
  例："陈先生是王小姐的先生" → add_relation(王小姐_id, "先生:陈先生")
  例："张伟介绍了李总" → add_relation(李总_id, "介绍人:张伟")

事件链：
- trigger_event_chain[clientId, eventType]
  eventType 必须从上方 LIFE EVENT 白名单中选。
  这是处理人生大事件的首选 action，会自动派生待办、提醒、话术建议。
  ⚠️ clientId 和 eventType 缺一不可！
  输出示例：{"type":"trigger_event_chain","clientId":123,"eventType":"spouse_pregnancy"}
  ❌ 错误：{"type":"trigger_event_chain","clientId":123}（缺少 eventType）
  ❌ 错误：{"type":"trigger_event_chain","eventType":"job_change"}（缺少 clientId）

### 禁止项
- ❌ 不要把"今天见过面"写成 trait，应写入 update_profile.updates 的 last_contact 字段。
- ❌ 不要为 life event 重复生成 add_todo（event_chain 会处理）。
- ❌ 不要生成用户没有要求的待办。`;
