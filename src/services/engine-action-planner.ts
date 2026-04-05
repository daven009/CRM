import OpenAI from "openai";
import { z } from "zod";
import { pendingQuestionSchema } from "../lib/engine-schema";
import { ContactCandidate, GroundedConcept, PendingQuestion, ProposedAction } from "../types/engine";

const plannerOutputSchema = z.object({
  summary: z.string().min(1),
  signals: z.array(z.string()).default([]),
  pending_question: z.union([z.string().min(1), pendingQuestionSchema]).nullable(),
  proposed_actions: z.array(
    z.object({
      kind: z.enum([
        "add_note",
        "create_task",
        "update_task",
        "complete_task",
        "create_reminder",
        "query",
      ]),
      status: z.enum(["proposed", "needs_input", "ready"]),
      confidence: z.number().min(0).max(1),
      display_text: z.string().min(1).optional(),
      payload: z.record(z.string(), z.unknown()),
    }),
  ),
});

export interface PlannedActionResult {
  summary: string;
  signals: string[];
  pendingQuestion: PendingQuestion | null;
  actions: ProposedAction[];
  planningSource: "llm" | "fallback_rules";
}

function generateActionId(kind: string, index: number) {
  return `${kind}_${index + 1}`;
}

function buildFallbackDisplayText(kind: ProposedAction["kind"], payload: Record<string, unknown>, contact: ContactCandidate) {
  if (kind === "create_task") {
    const title = typeof payload.title === "string" ? payload.title : "创建任务";
    const dueAt = typeof payload.due_at === "string" ? `，时间 ${payload.due_at}` : "";
    return `为 ${contact.display_name} 创建任务：${title}${dueAt}`;
  }

  if (kind === "create_reminder") {
    const title = typeof payload.title === "string" ? payload.title : "创建提醒";
    const remindFor = typeof payload.reminder_for === "string" ? `，对象 ${payload.reminder_for}` : "";
    return `为 ${contact.display_name} 创建提醒：${title}${remindFor}`;
  }

  if (kind === "add_note") {
    const note = typeof payload.note === "string" ? payload.note : "补充沟通备注";
    return `记录备注：${note}`;
  }

  if (kind === "update_task") {
    return `更新与 ${contact.display_name} 相关的待办`;
  }

  if (kind === "complete_task") {
    return `完成与 ${contact.display_name} 相关的待办`;
  }

  if (kind === "query") {
    const query = typeof payload.query === "string" ? payload.query : "查询联系人相关信息";
    return `查询：${query}`;
  }

  return `${kind}`;
}

function buildPrompt(text: string, now: string, contact: ContactCandidate) {
  return buildPromptWithGrounding(text, now, contact, []);
}

function buildPromptWithGrounding(text: string, now: string, contact: ContactCandidate, groundedConcepts: GroundedConcept[]) {
  return [
    "你是 CRM query engine 的候选动作规划器。",
    "请根据用户原话和已确认的联系人，输出 JSON，不要输出解释。",
    "目标是识别这句话里值得进入后续确认或执行的 proposed_actions。",
    "规则：",
    "1. 只输出 JSON。",
    "2. proposed_actions.kind 只能是 add_note, create_task, update_task, complete_task, create_reminder, query。",
    "3. proposed_actions.status 只能是 proposed, needs_input, ready。",
    "4. confidence 取值 0 到 1。",
    "5. 每个动作尽量提供 display_text，用一句简短中文说明这个动作到底是什么，给终端用户看。",
    "6. payload 只放结构化事实，不要编造数据库里不存在的字段；如果是 add_note，payload.note 必须是可直接写入数据库的完整备注文本。",
    "7. 如果时间信息不够完整，例如只有“下周”“月底”，可以创建动作，但要给出 pending_question。",
    "8. 如果一句话里有多个动作，尽量全部拆出来。",
    "9. 如果只是沟通事实，也可以给 add_note。",
    "10. 不要输出 id，系统会补。",
    "11. 系统已提供 grounded_concepts，它们只是现实世界概念归一化结果；你要把这些概念转成 CRM 可执行事实，而不是重复解释概念本身。",
    "12. family_milestone_event / family_life_stage_event 通常至少应生成一条 add_note；如果有明显时间信号，也可以补 create_reminder。",
    "13. relationship_maintenance_holiday 通常可生成 create_reminder 或 add_note，但 payload 必须完整可执行。",
    "",
    JSON.stringify(
      {
        now,
        contact: {
          id: contact.id,
          name: contact.name,
          display_name: contact.display_name,
          company: contact.company,
        },
        input_text: text,
        grounded_concepts: groundedConcepts,
      },
      null,
      2,
    ),
    "",
    '返回格式：{"summary":"...","signals":["..."],"pending_question":null,"proposed_actions":[{"kind":"add_note","status":"ready","confidence":0.8,"display_text":"记录客户对报价感兴趣","payload":{}}]}',
  ].join("\n");
}

function deriveNoteCategory(groundedConcepts: GroundedConcept[]) {
  if (groundedConcepts.some((concept) => concept.crm_semantic_hint === "relationship_maintenance_holiday")) {
    return "relationship_maintenance";
  }

  if (groundedConcepts.some((concept) =>
    concept.crm_semantic_hint === "family_milestone_event" ||
    concept.crm_semantic_hint === "family_life_stage_event",
  )) {
    return "relationship_info";
  }

  return "general_note";
}

function deriveNoteText(
  action: {
    display_text?: string;
    payload: Record<string, unknown>;
  },
  text: string,
  groundedConcepts: GroundedConcept[],
): string {
  if (typeof action.payload.note === "string" && action.payload.note.trim()) {
    return action.payload.note;
  }

  if (groundedConcepts.length > 0) {
    const normalized = groundedConcepts.map((concept) => concept.normalized).join("、");
    if (/(女儿|儿子|孩子)/.test(text)) {
      return `客户提到家人相关事件：${text.replace(/\s+/g, "")}（概念归一化：${normalized}）`;
    }

    return `客户提到重要事件：${text.replace(/\s+/g, "")}（概念归一化：${normalized}）`;
  }

  if (typeof action.display_text === "string" && action.display_text.trim()) {
    return action.display_text.trim();
  }

  return text.trim();
}

function normalizeActionPayload(
  action: {
    kind: ProposedAction["kind"];
    display_text?: string;
    payload: Record<string, unknown>;
  },
  text: string,
  groundedConcepts: GroundedConcept[],
) {
  if (action.kind === "add_note") {
    return {
      ...action.payload,
      note: deriveNoteText(action, text, groundedConcepts),
      category:
        (typeof action.payload.category === "string" && action.payload.category.trim()) ||
        deriveNoteCategory(groundedConcepts),
    };
  }

  if (action.kind === "create_reminder") {
    return {
      ...action.payload,
      title:
        (typeof action.payload.title === "string" && action.payload.title.trim()) ||
        (groundedConcepts[0] ? `${groundedConcepts[0].normalized}提醒` : "关系提醒"),
      note:
        (typeof action.payload.note === "string" && action.payload.note.trim()) ||
        (groundedConcepts[0] ? `围绕 ${groundedConcepts[0].normalized} 做提醒` : undefined),
    };
  }

  if (action.kind === "create_task") {
    return {
      ...action.payload,
      title:
        (typeof action.payload.title === "string" && action.payload.title.trim()) ||
        "创建任务",
    };
  }

  return action.payload;
}

function normalizeActionStatus(
  action: {
    kind: ProposedAction["kind"];
    status: ProposedAction["status"];
  },
  payload: Record<string, unknown>,
): ProposedAction["status"] {
  if (action.kind === "add_note") {
    return typeof payload.note === "string" && payload.note.trim() ? "ready" : "needs_input";
  }

  if (action.kind === "create_task") {
    return typeof payload.due_at === "string" && payload.due_at.trim() ? action.status : "needs_input";
  }

  if (action.kind === "create_reminder") {
    return typeof payload.remind_at === "string" && payload.remind_at.trim() ? action.status : "needs_input";
  }

  return action.status;
}

function normalizePendingQuestion(pendingQuestion: string | PendingQuestion | null): PendingQuestion | null {
  if (!pendingQuestion) {
    return null;
  }

  if (typeof pendingQuestion === "string") {
    return {
      type: "generic_clarification",
      question: pendingQuestion,
      field: null,
      action_id: null,
      options: [],
    };
  }

  return pendingQuestion;
}

export class EngineActionPlanner {
  private readonly apiKey = process.env.OPENAI_API_KEY;
  private readonly model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

  async plan(
    text: string,
    now: string,
    contact: ContactCandidate,
    groundedConcepts: GroundedConcept[] = [],
  ): Promise<PlannedActionResult | null> {
    if (!this.apiKey) {
      return null;
    }

    try {
      const client = new OpenAI({ apiKey: this.apiKey });
      const response = await client.responses.create({
        model: this.model,
        input: buildPromptWithGrounding(text, now, contact, groundedConcepts),
      });

      const raw = response.output_text?.trim();
      if (!raw) {
        return null;
      }

      const parsed = plannerOutputSchema.parse(JSON.parse(raw));
      const actions = parsed.proposed_actions.map((action, index) => {
        const normalizedPayload = {
          contact_id: contact.id,
          ...normalizeActionPayload(action, text, groundedConcepts),
        };

        return {
          id: generateActionId(action.kind, index),
          kind: action.kind,
          status: normalizeActionStatus(action, normalizedPayload),
          confidence: action.confidence,
          display_text: action.display_text ?? buildFallbackDisplayText(action.kind, normalizedPayload, contact),
          payload: normalizedPayload,
        };
      });

      return {
        summary: parsed.summary,
        signals: parsed.signals,
        pendingQuestion: normalizePendingQuestion(parsed.pending_question),
        actions,
        planningSource: "llm",
      };
    } catch {
      return null;
    }
  }
}
