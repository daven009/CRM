import OpenAI from "openai";
import { z } from "zod";
import { contactEntityCluesSchema } from "../lib/engine-schema";
import { ContactClueExtractorService } from "./contact-clue-extractor";
import { ConceptGrounderService } from "./concept-grounder";
import { EngineDebugInfo, GroundedConcept, PendingQuestion, SemanticFacets, Understanding } from "../types/engine";

const understandingOutputSchema = z.object({
  primary_interaction_type: z.enum([
    "query",
    "note",
    "task",
    "reminder",
    "craft",
    "mixed",
    "answer_to_pending",
  ]),
  semantic_facets: z.object({
    has_query: z.boolean(),
    has_note: z.boolean(),
    has_task: z.boolean(),
    has_reminder: z.boolean(),
    has_craft: z.boolean(),
    is_answer_to_pending: z.boolean(),
  }),
  confidence: z.number().min(0).max(1),
  requires_contact_resolution: z.boolean(),
  contact_hints: contactEntityCluesSchema,
  query_intent: z.string().nullable(),
  action_intent: z.string().nullable(),
  needs_clarification: z.boolean(),
  clarification_focus: z.string().nullable(),
  summary: z.string().min(1),
});

interface EngineUnderstandingInput {
  inputText: string;
  now: string;
  previousPendingQuestion?: PendingQuestion | null;
  previousConfirmedContactId?: string | null;
  groundedConcepts?: GroundedConcept[];
}

function normalizeNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeConfidence(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0.5;
  }

  return Math.max(0, Math.min(1, value));
}

function normalizeContactHints(value: unknown) {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    person_name: normalizeNullableString(record.person_name),
    company: normalizeNullableString(record.company),
    phone: normalizeNullableString(record.phone),
    email: normalizeNullableString(record.email),
    wechat: normalizeNullableString(record.wechat),
    title_hint: normalizeNullableString(record.title_hint),
  };
}

function normalizeSemanticFacets(value: unknown): SemanticFacets {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    has_query: normalizeBoolean(record.has_query),
    has_note: normalizeBoolean(record.has_note),
    has_task: normalizeBoolean(record.has_task),
    has_reminder: normalizeBoolean(record.has_reminder),
    has_craft: normalizeBoolean(record.has_craft),
    is_answer_to_pending: normalizeBoolean(record.is_answer_to_pending),
  };
}

function normalizeUnderstandingOutput(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }

  const record = value as Record<string, unknown>;
  return {
    primary_interaction_type: record.primary_interaction_type ?? record.interaction_type,
    semantic_facets: normalizeSemanticFacets(record.semantic_facets),
    confidence: normalizeConfidence(record.confidence),
    grounded_concepts: [],
    requires_contact_resolution: normalizeBoolean(record.requires_contact_resolution),
    contact_hints: normalizeContactHints(record.contact_hints),
    query_intent: normalizeNullableString(record.query_intent),
    action_intent: normalizeNullableString(record.action_intent),
    needs_clarification: normalizeBoolean(record.needs_clarification),
    clarification_focus: normalizeNullableString(record.clarification_focus),
    summary:
      typeof record.summary === "string" && record.summary.trim()
        ? record.summary
        : "LLM 未提供 summary，已按归一化结果继续处理。",
  };
}

function compact(text: string) {
  return text.replace(/\s+/g, "");
}

function countActiveSemanticFacets(facets: SemanticFacets) {
  return [
    facets.has_query,
    facets.has_note,
    facets.has_task,
    facets.has_reminder,
    facets.has_craft,
  ].filter(Boolean).length;
}

function derivePrimaryFromFacets(facets: SemanticFacets): Understanding["primary_interaction_type"] {
  if (facets.is_answer_to_pending) {
    return "answer_to_pending";
  }

  const activeCount = countActiveSemanticFacets(facets);
  if (activeCount > 1) {
    return "mixed";
  }

  if (facets.has_craft) {
    return "craft";
  }

  if (facets.has_query) {
    return "query";
  }

  if (facets.has_task) {
    return "task";
  }

  if (facets.has_reminder) {
    return "reminder";
  }

  if (facets.has_note) {
    return "note";
  }

  return "note";
}

function inferQueryIntent(text: string): string | null {
  const explicitQuery = /(是什么|多少|几号|什么时候|哪家|哪家公司|谁|哪个|怎么|最近.*聊了什么|最近聊了什么|最近沟通|最近记录|\?|？)/.test(text);

  if (/(生日|女儿生日|儿子生日|孩子生日)/.test(text)) {
    return explicitQuery ? "relationship_birthday" : null;
  }

  if (/(手机号|电话|微信|邮箱|联系方式)/.test(text)) {
    return "contact_lookup";
  }

  if (/(职位|岗位|头衔|title)/i.test(text)) {
    return "contact_title";
  }

  if (/(最近.*聊了什么|最近聊了什么|最近沟通|最近记录)/.test(text)) {
    return "recent_conversation";
  }

  if (/(谁|哪个|什么时候|怎么|进展|情况|还有谁|该跟进谁)/.test(text)) {
    return "crm_query";
  }

  return null;
}

function hasTemporalPlanningSignal(text: string) {
  return /(提醒|记得|回访|下周|明天|后天|周五|周三|月底|明年|前|之前|期间)/.test(text);
}

function hasRelationshipGrounding(groundedConcepts: GroundedConcept[]) {
  return groundedConcepts.some((concept) =>
    concept.crm_semantic_hint === "family_milestone_event" ||
    concept.crm_semantic_hint === "family_life_stage_event" ||
    concept.crm_semantic_hint === "relationship_maintenance_holiday",
  );
}

function inferActionIntent(text: string, groundedConcepts: GroundedConcept[]): string | null {
  if (hasTemporalPlanningSignal(text)) {
    return "follow_up";
  }

  if (/(demo|演示)/i.test(text)) {
    return "send_demo";
  }

  if (/(报价感兴趣|感兴趣|记录|聊了|沟通|备注|喜欢|关注|偏好|生日)/.test(text) || hasRelationshipGrounding(groundedConcepts)) {
    return "record_note";
  }

  if (/(写|生成|草稿|邮件|whatsapp|消息|话术)/i.test(text)) {
    return "craft_message";
  }

  return null;
}

function isLikelyAnswerToPending(text: string, pendingQuestion?: PendingQuestion | null) {
  if (!pendingQuestion) {
    return false;
  }

  const normalized = compact(text);
  if (!normalized) {
    return false;
  }

  if (/^(是|是的|对|确认|好的|行|可以|继续|全部|全选|第[一二两三四五六七八九十\d]+)/.test(normalized)) {
    return true;
  }

  return normalized.length <= 16;
}

function detectLocalSemanticFacets(
  text: string,
  pendingQuestion?: PendingQuestion | null,
  groundedConcepts: GroundedConcept[] = [],
): SemanticFacets {
  const explicitQuery = /(是什么|多少|几号|什么时候|哪家|哪家公司|谁|哪个|怎么|最近.*聊了什么|最近聊了什么|最近沟通|最近记录|\?|？)/.test(text);
  const hasGroundedRelationshipConcept = hasRelationshipGrounding(groundedConcepts);
  const hasTemporalSignal = hasTemporalPlanningSignal(text);
  return {
    has_query:
      explicitQuery ||
      /(手机号|电话|微信|邮箱|联系方式|职位|岗位|头衔|title|进展|情况|最近.*聊了什么|最近聊了什么|最近沟通|最近记录)/i.test(text),
    has_note: /(喜欢|感兴趣|关注|预算|敏感|记录|备注|偏好|价格)/.test(text) || hasGroundedRelationshipConcept,
    has_task: /(发.?demo|demo|演示|跟进|回访|报价|合同|发给|发送|安排|任务)/i.test(text),
    has_reminder:
      !explicitQuery &&
      (
        /(提醒|生日|到期|下个月\d{1,2}[号日]|月底|明天|后天|下周)/.test(text) ||
        (hasGroundedRelationshipConcept && hasTemporalSignal)
      ),
    has_craft: /(帮我写|帮我生成|写个|写一封|写邮件|whatsapp|邮件|话术|message)/i.test(text),
    is_answer_to_pending: isLikelyAnswerToPending(text, pendingQuestion),
  };
}

function mergeSemanticFacets(llmFacets: SemanticFacets, localFacets: SemanticFacets): SemanticFacets {
  return {
    has_query: llmFacets.has_query || localFacets.has_query,
    has_note: llmFacets.has_note || localFacets.has_note,
    has_task: llmFacets.has_task || localFacets.has_task,
    has_reminder: llmFacets.has_reminder || localFacets.has_reminder,
    has_craft: llmFacets.has_craft || localFacets.has_craft,
    is_answer_to_pending: llmFacets.is_answer_to_pending || localFacets.is_answer_to_pending,
  };
}

function arbitrateUnderstanding(
  llmUnderstanding: Understanding,
  localFacets: SemanticFacets,
): Understanding {
  const mergedFacets = mergeSemanticFacets(llmUnderstanding.semantic_facets, localFacets);
  const llmPrimary = llmUnderstanding.primary_interaction_type;
  const derivedPrimary = derivePrimaryFromFacets(mergedFacets);
  const localActiveCount = countActiveSemanticFacets(localFacets);
  const mergedActiveCount = countActiveSemanticFacets(mergedFacets);
  const arbitrationNotes = [...(llmUnderstanding.arbitration_notes ?? [])];

  if (JSON.stringify(mergedFacets) !== JSON.stringify(llmUnderstanding.semantic_facets)) {
    arbitrationNotes.push("merged_local_facets_into_llm");
  }

  let primaryInteractionType = llmPrimary;
  if (
    !mergedFacets.is_answer_to_pending &&
    llmPrimary !== "mixed" &&
    derivedPrimary === "mixed" &&
    localActiveCount >= 2 &&
    mergedActiveCount >= 2
  ) {
    primaryInteractionType = "mixed";
    arbitrationNotes.push(`promoted_to_mixed_from_${llmPrimary}`);
  } else {
    arbitrationNotes.push("retained_llm_primary_type");
  }

  const source =
    arbitrationNotes.includes("merged_local_facets_into_llm") ||
    arbitrationNotes.some((note) => note.startsWith("promoted_to_mixed_from_"))
      ? "hybrid"
      : "llm";

  return {
    ...llmUnderstanding,
    primary_interaction_type: primaryInteractionType,
    semantic_facets: mergedFacets,
    source,
    arbitration_notes: arbitrationNotes,
    signals: Array.from(
      new Set([
        ...llmUnderstanding.signals,
        `primary:${primaryInteractionType}`,
        ...Object.entries(mergedFacets)
          .filter(([, active]) => active)
          .map(([facet]) => `facet:${facet}`),
      ]),
    ),
  };
}

function buildFallbackUnderstanding(input: EngineUnderstandingInput): Understanding {
  const groundedConcepts = input.groundedConcepts ?? [];
  const contactHints = new ContactClueExtractorService().extractRuleBased(input.inputText);
  const semanticFacets = detectLocalSemanticFacets(input.inputText, input.previousPendingQuestion, groundedConcepts);
  const primaryInteractionType = derivePrimaryFromFacets(semanticFacets);
  const queryIntent = inferQueryIntent(input.inputText);
  const actionIntent = inferActionIntent(input.inputText, groundedConcepts);
  const previousPendingType = input.previousPendingQuestion?.type ?? null;

  let requiresContactResolution =
    primaryInteractionType !== "craft" && Object.values(contactHints).some(Boolean);

  if (semanticFacets.is_answer_to_pending && previousPendingType) {
    requiresContactResolution = previousPendingType === "contact_resolution";
  }

  if (!requiresContactResolution && !input.previousConfirmedContactId && primaryInteractionType !== "craft") {
    requiresContactResolution = !semanticFacets.is_answer_to_pending;
  }

  const needsClarification =
    previousPendingType === "slot_filling" ||
    previousPendingType === "generic_clarification" ||
    /(下周|月底|尽快|改天)/.test(input.inputText);

  const clarificationFocus =
    previousPendingType === "slot_filling"
      ? input.previousPendingQuestion?.field ?? "parameter"
      : previousPendingType === "generic_clarification"
        ? "generic"
        : /(下周|月底)/.test(input.inputText)
          ? "time"
          : null;

  return {
    primary_interaction_type: primaryInteractionType,
    semantic_facets: semanticFacets,
    confidence: 0.55,
    grounded_concepts: groundedConcepts,
    requires_contact_resolution: requiresContactResolution,
    contact_hints: contactHints,
    query_intent: queryIntent,
    action_intent: actionIntent,
    needs_clarification: needsClarification,
    clarification_focus: clarificationFocus,
    summary:
      primaryInteractionType === "answer_to_pending"
        ? "当前输入更像是在回答上一轮问题。"
        : `已识别为 ${primaryInteractionType} 类型输入。`,
    source: "fallback_rules",
    arbitration_notes: ["fallback_facets_only"],
    extracted_contact_name: contactHints.person_name,
    signals: [
      `primary:${primaryInteractionType}`,
      ...Object.entries(semanticFacets)
        .filter(([, active]) => active)
        .map(([facet]) => `facet:${facet}`),
      ...(queryIntent ? [`query:${queryIntent}`] : []),
      ...(actionIntent ? [`action:${actionIntent}`] : []),
      ...groundedConcepts.map((concept) => `grounded:${concept.normalized}`),
      ...(previousPendingType ? [`pending:${previousPendingType}`] : []),
    ],
    entity_clues: contactHints,
    planning_source: "fallback_rules",
  };
}

function buildPrompt(input: EngineUnderstandingInput) {
  return [
    "你是 CRM query engine 的 understanding layer。",
    "你的任务是先做统一理解与分类，不要做最终联系人绑定，不要做动作执行。",
    "系统已经先做了一层 world knowledge grounding，用于把现实世界概念归一化。",
    "请只输出 JSON。",
    "你必须返回完整 JSON 对象，不能缺字段；如果没有值，请返回 null 或 false，不要省略字段。",
    '返回字段固定为：primary_interaction_type, semantic_facets, confidence, requires_contact_resolution, contact_hints, query_intent, action_intent, needs_clarification, clarification_focus, summary。',
    "primary_interaction_type 只能是 query, note, task, reminder, craft, mixed, answer_to_pending。",
    "不要把任务理解简化成单一标签；一句话可以同时有多个语义，semantic_facets 要把它们全部标出来。",
    "source 由系统补，不要输出。",
    "如果当前输入更像是在回答上一轮 pending question，请输出 answer_to_pending，并把 semantic_facets.is_answer_to_pending 设为 true。",
    "requires_contact_resolution 表示后续是否需要进入联系人解析/确认阶段。",
    "contact_hints 必须始终返回对象，且包含 person_name, company, phone, email, wechat, title_hint 六个字段；没有值时填 null。",
    "query_intent 和 action_intent 用简短 snake_case 标签，不确定时返回 null。",
    "semantic_facets 必须包含 has_query, has_note, has_task, has_reminder, has_craft, is_answer_to_pending 六个 boolean 字段。",
    "confidence 是 0 到 1 的数值。",
    "needs_clarification 必须是 boolean；不需要时返回 false。",
    "clarification_focus 用简短标签，例如 contact, time, parameter, generic；不需要时返回 null。",
    "summary 必须是简短中文总结字符串。",
    "grounding 只是辅助你理解 CRM 语义，不要输出百科解释。",
    '返回格式示例：{"primary_interaction_type":"mixed","semantic_facets":{"has_query":false,"has_note":true,"has_task":true,"has_reminder":true,"has_craft":false,"is_answer_to_pending":false},"confidence":0.83,"requires_contact_resolution":true,"contact_hints":{"person_name":"张总","company":"新海","phone":null,"email":null,"wechat":null,"title_hint":"总"},"query_intent":null,"action_intent":"follow_up","needs_clarification":false,"clarification_focus":null,"summary":"已识别为 mixed 输入，需要先确认联系人。"}',
    "",
    JSON.stringify(
      {
        now: input.now,
        input_text: input.inputText,
        grounded_concepts: input.groundedConcepts ?? [],
        previous_pending_question: input.previousPendingQuestion,
        previous_confirmed_contact_id: input.previousConfirmedContactId ?? null,
      },
      null,
      2,
    ),
  ].join("\n");
}

export class EngineUnderstandingService {
  private readonly apiKey = process.env.OPENAI_API_KEY;
  private readonly model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
  private readonly contactClueExtractor = new ContactClueExtractorService();
  private readonly conceptGrounder = new ConceptGrounderService();

  async understand(input: EngineUnderstandingInput): Promise<{ understanding: Understanding; debug: EngineDebugInfo }> {
    const groundedConcepts = await this.conceptGrounder.ground(input.inputText, input.now);
    const extractedClues = await this.contactClueExtractor.extract(input.inputText);
    if (!this.apiKey) {
      return {
        understanding: buildFallbackUnderstanding({
          ...input,
          groundedConcepts,
        }),
        debug: {
          understanding_provider: "fallback_rules",
          understanding_fallback_reason: "missing_api_key",
        },
      };
    }

    try {
      const client = new OpenAI({ apiKey: this.apiKey });
      const response = await client.responses.create({
        model: this.model,
        input: buildPrompt(input),
      });

      const raw = response.output_text?.trim();
      if (!raw) {
        return {
          understanding: buildFallbackUnderstanding({
            ...input,
            groundedConcepts,
          }),
          debug: {
            understanding_provider: "openai",
            understanding_fallback_reason: "empty_output",
          },
        };
      }

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(raw);
      } catch {
        return {
          understanding: buildFallbackUnderstanding({
            ...input,
            groundedConcepts,
          }),
          debug: {
            understanding_provider: "openai",
            understanding_fallback_reason: "invalid_json",
          },
        };
      }

      let parsed: z.infer<typeof understandingOutputSchema>;
      try {
        parsed = understandingOutputSchema.parse(normalizeUnderstandingOutput(parsedJson));
      } catch {
        return {
          understanding: buildFallbackUnderstanding({
            ...input,
            groundedConcepts,
          }),
          debug: {
            understanding_provider: "openai",
            understanding_fallback_reason: "invalid_schema",
          },
        };
      }

      return {
          understanding: arbitrateUnderstanding({
          ...parsed,
          grounded_concepts: groundedConcepts,
          source: "llm",
          contact_hints: {
            ...extractedClues,
            ...parsed.contact_hints,
          },
          extracted_contact_name: (parsed.contact_hints.person_name ?? extractedClues.person_name),
          signals: [
            `primary:${parsed.primary_interaction_type}`,
            ...Object.entries(parsed.semantic_facets)
              .filter(([, active]) => active)
              .map(([facet]) => `facet:${facet}`),
            ...(parsed.query_intent ? [`query:${parsed.query_intent}`] : []),
            ...(parsed.action_intent ? [`action:${parsed.action_intent}`] : []),
            ...groundedConcepts.map((concept) => `grounded:${concept.normalized}`),
          ],
          entity_clues: {
            ...extractedClues,
            ...parsed.contact_hints,
          },
          planning_source: "fallback_rules",
        }, detectLocalSemanticFacets(input.inputText, input.previousPendingQuestion, groundedConcepts)),
        debug: {
          understanding_provider: "openai",
          understanding_fallback_reason: null,
        },
      };
    } catch {
      return {
        understanding: buildFallbackUnderstanding({
          ...input,
          groundedConcepts,
        }),
        debug: {
          understanding_provider: "openai",
          understanding_fallback_reason: "llm_error",
        },
      };
    }
  }
}
