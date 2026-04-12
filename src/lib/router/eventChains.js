/**
 * Event Chain 展开逻辑
 * LLM 只负责识别 eventType，程序侧负责展开具体待办
 */

// daysOffset: 相对当前日期的天数偏移（0=今天，7=一周后）
export const EVENT_CHAINS = {
  spouse_pregnancy: {
    todos: [
      { todo: '发送孕期祝福消息', daysOffset: 0 },
      { todo: '第二孕期电话问候，了解保障需求', daysOffset: 90 },
      { todo: '第三孕期推荐儿童重疾险方案', daysOffset: 180 },
      { todo: '预产期前两周送祝福礼盒', daysOffset: 240 }
    ],
    traits: ['即将为人父母'],
    recommendedScripts: ['pregnancy_congrats', 'child_protection_intro']
  },

  bereavement: {
    todos: [
      { todo: '发送哀悼慰问，注意措辞克制', daysOffset: 0 },
      { todo: '一周后电话问候，仅表达关心，不谈业务', daysOffset: 7 },
      { todo: '一个月后视情况联系，了解后续安排', daysOffset: 30 }
    ],
    traits: [],
    recommendedScripts: ['condolence_message']
  },

  job_change: {
    todos: [
      { todo: '发送祝贺消息', daysOffset: 0 },
      { todo: '一个月后了解新工作适应情况，关注收入变化', daysOffset: 30 },
      { todo: '三个月后回访，评估是否需要调整保障方案', daysOffset: 90 }
    ],
    traits: [],
    recommendedScripts: ['job_change_congrats', 'protection_review']
  },

  childbirth: {
    todos: [
      { todo: '发送新生儿祝福消息', daysOffset: 0 },
      { todo: '一周后送新生儿礼物', daysOffset: 7 },
      { todo: '满月时电话问候，了解家庭保障需求', daysOffset: 30 },
      { todo: '三个月后推荐儿童教育金/重疾险方案', daysOffset: 90 }
    ],
    traits: ['新晋父母'],
    recommendedScripts: ['birth_congrats', 'child_protection_intro']
  },

  marriage: {
    todos: [
      { todo: '发送结婚祝福消息', daysOffset: 0 },
      { todo: '一个月后了解家庭保障规划需求', daysOffset: 30 },
      { todo: '三个月后评估联合保障方案', daysOffset: 90 }
    ],
    traits: ['已婚'],
    recommendedScripts: ['wedding_congrats', 'family_protection']
  },

  engagement: {
    todos: [
      { todo: '发送订婚祝福消息', daysOffset: 0 },
      { todo: '婚前一个月了解婚后规划需求', daysOffset: 60 }
    ],
    traits: ['已订婚'],
    recommendedScripts: ['engagement_congrats']
  },

  divorce: {
    todos: [
      { todo: '发送关心消息，措辞谨慎', daysOffset: 0 },
      { todo: '两周后电话问候，了解生活变化', daysOffset: 14 },
      { todo: '一个月后评估保单受益人变更需求', daysOffset: 30 }
    ],
    traits: [],
    recommendedScripts: ['concern_message']
  },

  promotion: {
    todos: [
      { todo: '发送升职祝贺消息', daysOffset: 0 },
      { todo: '一个月后了解收入变化，评估保障升级需求', daysOffset: 30 }
    ],
    traits: [],
    recommendedScripts: ['promotion_congrats']
  },

  start_business: {
    todos: [
      { todo: '发送创业祝福消息', daysOffset: 0 },
      { todo: '一个月后了解创业进展，评估商业保障需求', daysOffset: 30 },
      { todo: '三个月后回访，了解企业保障规划', daysOffset: 90 }
    ],
    traits: ['创业者'],
    recommendedScripts: ['business_congrats', 'business_protection']
  },

  relocation: {
    todos: [
      { todo: '发送乔迁祝福消息', daysOffset: 0 },
      { todo: '两周后了解新居安顿情况', daysOffset: 14 },
      { todo: '一个月后评估是否需要更新联系信息和保单地址', daysOffset: 30 }
    ],
    traits: [],
    recommendedScripts: ['moving_congrats']
  },

  home_purchase: {
    todos: [
      { todo: '发送购房祝贺消息', daysOffset: 0 },
      { todo: '一周后了解房贷情况，评估房贷保障需求', daysOffset: 7 },
      { todo: '一个月后推荐火险/家居保障方案', daysOffset: 30 }
    ],
    traits: ['有房产'],
    recommendedScripts: ['home_purchase_congrats', 'mortgage_protection']
  },

  child_education_milestone: {
    todos: [
      { todo: '发送学业祝福/鼓励消息', daysOffset: 0 },
      { todo: '一周后了解升学规划和教育资金需求', daysOffset: 7 },
      { todo: '一个月后推荐教育储蓄方案', daysOffset: 30 }
    ],
    traits: [],
    recommendedScripts: ['education_milestone']
  },

  graduation: {
    todos: [
      { todo: '发送毕业祝贺消息', daysOffset: 0 },
      { todo: '两周后了解就业/深造计划', daysOffset: 14 }
    ],
    traits: [],
    recommendedScripts: ['graduation_congrats']
  },

  retirement: {
    todos: [
      { todo: '发送退休祝福消息', daysOffset: 0 },
      { todo: '一周后了解退休生活规划', daysOffset: 7 },
      { todo: '一个月后评估退休金方案和医疗保障需求', daysOffset: 30 }
    ],
    traits: ['已退休'],
    recommendedScripts: ['retirement_congrats', 'retirement_planning']
  },

  critical_illness: {
    todos: [
      { todo: '发送慰问消息，措辞温暖克制', daysOffset: 0 },
      { todo: '一周后电话问候，仅表达关心', daysOffset: 7 },
      { todo: '一个月后了解治疗进展，视情况协助理赔', daysOffset: 30 }
    ],
    traits: [],
    recommendedScripts: ['illness_concern']
  },

  recovery: {
    todos: [
      { todo: '发送康复祝福消息', daysOffset: 0 },
      { todo: '两周后电话问候，了解恢复情况', daysOffset: 14 },
      { todo: '一个月后评估保障方案是否需要调整', daysOffset: 30 }
    ],
    traits: [],
    recommendedScripts: ['recovery_congrats']
  },

  anniversary: {
    todos: [
      { todo: '发送周年纪念祝福消息', daysOffset: 0 },
      { todo: '一周后联系关心，维护关系', daysOffset: 7 }
    ],
    traits: [],
    recommendedScripts: ['anniversary_wishes']
  },

  birthday_milestone: {
    todos: [
      { todo: '发送整数大寿祝福消息（附赠小礼物或贺卡）', daysOffset: 0 },
      { todo: '生日当天电话问候，表达重视', daysOffset: 0 },
      { todo: '一周后回访，了解近况和保障需求变化', daysOffset: 7 },
      { todo: '一个月后评估是否需要调整保障方案（年龄节点费率变化）', daysOffset: 30 }
    ],
    traits: ['整数大寿'],
    recommendedScripts: ['birthday_milestone_wishes', 'age_milestone_review']
  }
};

/**
 * 在程序侧展开 event chain，生成待办和标签
 * 返回展开的 actions 数组（由前端 applyPlaygroundActions 执行）
 * @param {number|string} clientId
 * @param {string} eventType
 * @returns {{ actions: Array, recommendedScripts: string[] }}
 */
export function expandEventChain(clientId, eventType) {
  const chain = EVENT_CHAINS[eventType];
  if (!chain) {
    console.warn(`Unknown event type: ${eventType}`);
    return { actions: [], recommendedScripts: [] };
  }

  const actions = [];

  // 展开待办
  for (const t of chain.todos || []) {
    actions.push({
      type: 'add_todo',
      clientId,
      todo: t.todo,
      days: t.daysOffset
    });
  }

  // 展开标签
  for (const trait of chain.traits || []) {
    actions.push({
      type: 'add_trait',
      clientId,
      trait
    });
  }

  return {
    actions,
    recommendedScripts: chain.recommendedScripts || []
  };
}
