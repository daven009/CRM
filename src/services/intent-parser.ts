import { createLlmProvider } from "../providers/llm";
import {
  ConversationInsight,
  ParseTaskIntentRequest,
  ParseTaskIntentResponse,
  ExtractionResult,
  Intent,
  NewTaskPayload,
  TaskChanges,
  TaskOperation,
  TaskType,
} from "../types/agent";
import { resolveTask } from "./task-resolver";
import { parseDueTime } from "./time-parser";

function detectTaskType(text: string): TaskType | null {
  if (/(付款|打款|转账|回款|催款|首付款|尾款)/.test(text)) {
    return "collect_payment";
  }
  if (/(报价|报价单|价格方案)/.test(text)) {
    return "send_quote";
  }
  if (/(跟进|回访|联系|沟通|电话)/.test(text)) {
    return "follow_up";
  }
  if (/(会议|见面|拜访|约时间|约一下)/.test(text)) {
    return "schedule_meeting";
  }
  if (/(资料|合同|文档|方案|PPT|材料)/.test(text)) {
    return "send_material";
  }
  return null;
}

function buildKeywords(text: string): string[] {
  const keywords = new Set<string>();
  const candidates = ["报价", "付款", "打款", "转账", "方案", "资料", "会议", "拜访", "跟进", "这条", "那条", "这个"];

  for (const candidate of candidates) {
    if (text.includes(candidate)) {
      keywords.add(candidate);
    }
  }

  return [...keywords];
}

function normalizeTitle(text: string, taskType: TaskType | null): string | null {
  if (taskType === "send_quote") {
    return "发送报价";
  }
  if (taskType === "collect_payment") {
    return "跟进付款";
  }
  if (taskType === "schedule_meeting") {
    return "安排会议";
  }
  if (taskType === "send_material") {
    return "发送材料";
  }
  if (taskType === "follow_up") {
    return "客户跟进";
  }

  const sanitized = text.replace(/^(记得|需要|要|必须|之前要完成|请|帮我|把)/, "").trim();
  return sanitized || null;
}

function isPronounReference(text: string): boolean {
  return /(这条|那条|这个|那个)/.test(text);
}

function dedupe(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function buildConversationInsight(text: string): ConversationInsight {
  const tags: string[] = [];
  const structuredSlots: Record<string, string> = {};

  if (/(喜欢|爱喝|偏好|爱好)/.test(text)) {
    const itemMatch = text.match(/(?:喜欢|爱喝|偏好)([^，。；]+)/);
    const value = itemMatch?.[1]?.trim() ?? "";
    if (value) {
      tags.push(value, "个人偏好");
      structuredSlots.preference_item = value;
    }
    return {
      note_type: "customer_preference",
      summary: value ? `客户偏好${value}` : "记录到客户偏好信息",
      tags: dedupe(tags),
      structured_slots: structuredSlots,
    };
  }

  if (/(价格敏感|对价格比较敏感|预算有限|嫌贵|太贵|预算不足)/.test(text)) {
    const match = text.match(/(价格敏感|预算有限|预算不足|嫌贵|太贵)/);
    if (match?.[1]) {
      tags.push(match[1], "价格");
      structuredSlots.objection = match[1];
    }
    return {
      note_type: "price_sensitivity",
      summary: "客户对价格较敏感",
      tags: dedupe(tags),
      structured_slots: structuredSlots,
    };
  }

  if (/(老婆|老公|孩子|儿子|女儿|生日|结婚|家里|家庭)/.test(text)) {
    const relationMatch = text.match(/(老婆|老公|孩子|儿子|女儿|家里|家庭|生日)/g) ?? [];
    tags.push(...relationMatch, "关系信息");
    if (/生日/.test(text)) {
      const dateMatch = text.match(/(\d{1,2}号|\d{1,2}日|\d{1,2}月\d{1,2}[日号]?)/);
      if (dateMatch?.[1]) {
        structuredSlots.important_date = dateMatch[1];
      }
    }
    return {
      note_type: "relationship_info",
      summary: "记录到客户关系信息",
      tags: dedupe(tags),
      structured_slots: structuredSlots,
    };
  }

  if (/(风险|不太可能|黄了|困难|卡住|拖着|没有预算|竞争对手|比价)/.test(text)) {
    const signalMatch = text.match(/(没有预算|竞争对手|比价|卡住|拖着|风险)/g) ?? [];
    tags.push(...signalMatch, "风险");
    return {
      note_type: "risk_signal",
      summary: "识别到潜在跟进风险",
      tags: dedupe(tags),
      structured_slots: structuredSlots,
    };
  }

  if (/(决定|拍板|审批|老板定|下周答复|月底答复|本周确认)/.test(text)) {
    const signalMatch = text.match(/(拍板|审批|答复|确认|决定)/g) ?? [];
    tags.push(...signalMatch, "决策");
    return {
      note_type: "decision_signal",
      summary: "识别到决策推进信号",
      tags: dedupe(tags),
      structured_slots: structuredSlots,
    };
  }

  if (/(聊了|沟通了|开会|会议|讨论了|今天和)/.test(text)) {
    const meetingTags = text.match(/(会议|开会|沟通|讨论)/g) ?? [];
    tags.push(...meetingTags);
    return {
      note_type: "meeting_summary",
      summary: "记录本次沟通摘要",
      tags: dedupe(tags),
      structured_slots: structuredSlots,
    };
  }

  return {
    note_type: "general_note",
    summary: "记录一般备注信息",
    tags: [],
    structured_slots: {},
  };
}

function fallbackExtract(input: ParseTaskIntentRequest): ExtractionResult {
  const text = input.input_text.trim();
  const dueAt = parseDueTime(text, input.now);
  const taskType = detectTaskType(text);
  const titleKeywords = buildKeywords(text);

  let intent: Intent = "noop_or_note";
  let confidence = 0.6;

  if (/(已经付款了|已经打款了|已经转账了|已经发了|发过去了|给他了|处理完了|完成了)/.test(text)) {
    intent = "complete";
    confidence = 0.9;
  } else if (/(改到|延到|推到|改成|延期到)/.test(text)) {
    intent = "update";
    confidence = 0.88;
  } else if (/(不用了|先取消|不跟了|不用做了|先别做了)/.test(text)) {
    intent = "cancel";
    confidence = 0.88;
  } else if (/(记得|需要|要|必须|之前要完成)/.test(text)) {
    intent = "create";
    confidence = 0.86;
  } else if (dueAt && taskType) {
    intent = "create";
    confidence = 0.72;
  }

  const noteIntent = intent === "noop_or_note";

  return {
    intent,
    referencedTaskType: taskType,
    title: noteIntent ? null : normalizeTitle(text, taskType),
    dueAt,
    note: noteIntent ? text : null,
    evidence: text,
    confidence,
    ambiguityReason: isPronounReference(text) ? "pronoun_reference" : null,
    titleKeywords,
    conversationInsight: noteIntent ? buildConversationInsight(text) : null,
  };
}

function emptyNewTask(): NewTaskPayload {
  return { title: null, task_type: null, due_at: null, note: null };
}

function emptyChanges(): TaskChanges {
  return { title: null, due_at: null, status: null, note: null };
}

export class IntentParserService {
  private readonly llmProvider = createLlmProvider();

  async parse(input: ParseTaskIntentRequest): Promise<ParseTaskIntentResponse> {
    const extracted = (await this.llmProvider.extractTaskIntent(input)) ?? fallbackExtract(input);
    const resolution = resolveTask(input.open_tasks, extracted);

    let needsClarification = resolution.needsClarification;
    let clarificationQuestion = resolution.clarificationQuestion;

    if (
      ["complete", "update", "cancel"].includes(extracted.intent) &&
      extracted.ambiguityReason === "pronoun_reference" &&
      !resolution.targetTaskId
    ) {
      needsClarification = true;
      clarificationQuestion = "你指的是哪条待办？";
    }

    const base: Omit<TaskOperation, "op"> = {
      target_task_id: resolution.targetTaskId,
      target_task_hint: resolution.hint,
      new_task: emptyNewTask(),
      changes: emptyChanges(),
    };

    let operation: TaskOperation = {
      op: extracted.intent,
      ...base,
    };

    if (extracted.intent === "create") {
      operation = {
        ...operation,
        new_task: {
          title: extracted.title,
          task_type: extracted.referencedTaskType ?? "custom",
          due_at: extracted.dueAt,
          note: null,
        },
      };
    }

    if (extracted.intent === "complete") {
      operation = {
        ...operation,
        changes: {
          ...emptyChanges(),
          status: "done",
        },
      };
    }

    if (extracted.intent === "update") {
      operation = {
        ...operation,
        changes: {
          ...emptyChanges(),
          due_at: extracted.dueAt,
          status: extracted.dueAt ? null : "snoozed",
        },
      };
      if (!extracted.dueAt) {
        needsClarification = true;
        clarificationQuestion = "要改到什么时间？";
      }
    }

    if (extracted.intent === "cancel") {
      operation = {
        ...operation,
        changes: {
          ...emptyChanges(),
          status: "cancelled",
        },
      };
    }

    if (extracted.intent === "noop_or_note") {
      operation = {
        ...operation,
        changes: {
          ...emptyChanges(),
          note: extracted.note,
        },
      };
    }

    const response: ParseTaskIntentResponse = {
      intent: extracted.intent,
      ...operation,
      operations: [operation],
      needs_clarification: needsClarification,
      clarification_question: clarificationQuestion,
      confidence: Number(Math.max(0, Math.min(1, extracted.confidence)).toFixed(2)),
      evidence: extracted.evidence,
      conversation_insight: extracted.conversationInsight,
    };

    return response;
  }
}
