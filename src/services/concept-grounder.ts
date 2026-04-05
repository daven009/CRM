import OpenAI from "openai";
import { z } from "zod";
import { GroundedConcept } from "../types/engine";

const groundedConceptOutputSchema = z.object({
  grounded_concepts: z.array(
    z.object({
      raw: z.string().min(1),
      normalized: z.string().min(1),
      concept_type: z.string().min(1),
      crm_semantic_hint: z.string().min(1),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

const fallbackAnchors: Array<{
  pattern: RegExp;
  normalized: string;
  concept_type: string;
  crm_semantic_hint: string;
  confidence: number;
}> = [
  {
    pattern: /\bpsle\b|小六汇考|小六会考|小学离校考试|primary\s*school\s*leaving\s*examination/i,
    normalized: "PSLE",
    concept_type: "education_exam",
    crm_semantic_hint: "family_milestone_event",
    confidence: 0.9,
  },
  {
    pattern: /\bo\s*level\b/i,
    normalized: "O Level",
    concept_type: "education_exam",
    crm_semantic_hint: "family_milestone_event",
    confidence: 0.88,
  },
  {
    pattern: /\ba\s*level\b/i,
    normalized: "A Level",
    concept_type: "education_exam",
    crm_semantic_hint: "family_milestone_event",
    confidence: 0.88,
  },
  {
    pattern: /\bns\b|国民服役|兵役|当兵/i,
    normalized: "NS",
    concept_type: "national_service",
    crm_semantic_hint: "family_life_stage_event",
    confidence: 0.87,
  },
  {
    pattern: /hari\s*raya/i,
    normalized: "Hari Raya",
    concept_type: "cultural_holiday",
    crm_semantic_hint: "relationship_maintenance_holiday",
    confidence: 0.9,
  },
  {
    pattern: /\bcny\b|春节|农历新年|过年/i,
    normalized: "CNY",
    concept_type: "cultural_holiday",
    crm_semantic_hint: "relationship_maintenance_holiday",
    confidence: 0.9,
  },
  {
    pattern: /deepavali/i,
    normalized: "Deepavali",
    concept_type: "cultural_holiday",
    crm_semantic_hint: "relationship_maintenance_holiday",
    confidence: 0.9,
  },
];

function dedupeConcepts(concepts: GroundedConcept[]) {
  const seen = new Set<string>();
  return concepts.filter((concept) => {
    const key = `${concept.normalized}:${concept.concept_type}:${concept.crm_semantic_hint}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function buildPrompt(text: string, now: string) {
  return [
    "你是 CRM query engine 的 world knowledge grounder。",
    "用户场景是新加坡销售 CRM，对话里可能出现本地缩写、教育事件、人生阶段、节日、行业术语。",
    "你的任务不是做百科解释，也不是产出动作。",
    "你只负责：识别现实世界概念、做归一化、给出 CRM semantic hint。",
    "这不是关键词抽取任务，而是现实世界概念归一化任务。",
    "如果输入里出现俗称、别称、中文说法、英文全称、英文缩写，且它们现实里指向同一个概念，你应该统一映射到一个标准 normalized 名称。",
    "即使用户原话没有说出标准缩写，也要尽量根据语义做归一化。",
    "请只输出 JSON。",
    "返回格式固定为：",
    '{"grounded_concepts":[{"raw":"psle","normalized":"PSLE","concept_type":"education_exam","crm_semantic_hint":"family_milestone_event","confidence":0.93}]}',
    "如果没有需要 grounding 的概念，返回 grounded_concepts: []。",
    "高价值参考概念示例：PSLE, O level, A level, NS, Hari Raya, CNY, Deepavali。",
    "少量归一化示例：",
    '- "女儿下周小六会考" -> normalized: "PSLE", concept_type: "education_exam", crm_semantic_hint: "family_milestone_event"',
    '- "他儿子明年要当兵" -> normalized: "NS", concept_type: "national_service", crm_semantic_hint: "family_life_stage_event"',
    '- "过年前提醒我问候一下" -> normalized: "CNY", concept_type: "cultural_holiday", crm_semantic_hint: "relationship_maintenance_holiday"',
    "这些只是示例，不是闭集。请做语义映射，不要只做字符串匹配。",
    "不要输出长篇解释，不要输出百科内容。",
    "",
    JSON.stringify({ now, input_text: text }, null, 2),
  ].join("\n");
}

function runFallback(text: string): GroundedConcept[] {
  return dedupeConcepts(
    fallbackAnchors.flatMap((anchor) => {
      const match = text.match(anchor.pattern);
      if (!match) {
        return [];
      }

      return [
        {
          raw: match[0],
          normalized: anchor.normalized,
          concept_type: anchor.concept_type,
          crm_semantic_hint: anchor.crm_semantic_hint,
          confidence: anchor.confidence,
        },
      ];
    }),
  );
}

export class ConceptGrounderService {
  private readonly apiKey = process.env.OPENAI_API_KEY;
  private readonly model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

  async ground(text: string, now: string): Promise<GroundedConcept[]> {
    if (!this.apiKey) {
      return runFallback(text);
    }

    try {
      const client = new OpenAI({ apiKey: this.apiKey });
      const response = await client.responses.create({
        model: this.model,
        input: buildPrompt(text, now),
      });

      const raw = response.output_text?.trim();
      if (!raw) {
        return runFallback(text);
      }

      const parsed = groundedConceptOutputSchema.parse(JSON.parse(raw));
      return dedupeConcepts(parsed.grounded_concepts);
    } catch {
      return runFallback(text);
    }
  }
}
