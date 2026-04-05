import OpenAI from "openai";
import { extractionResultSchema } from "../lib/schema";
import { ParseTaskIntentRequest, ExtractionResult } from "../types/agent";

function buildPrompt(input: ParseTaskIntentRequest): string {
  return [
    "你是 CRM 待办意图抽取器，只输出 JSON。",
    "结合当前客户、当前待办列表和用户输入，抽取主要意图。",
    "返回字段必须是：intent, referencedTaskType, title, dueAt, note, evidence, confidence, ambiguityReason, titleKeywords, conversationInsight。",
    "intent 只能是 create, complete, update, cancel, noop_or_note。",
    "referencedTaskType 只能是 send_quote, follow_up, collect_payment, schedule_meeting, send_material, custom 或 null。",
    "dueAt 必须是 ISO 8601 且使用 Asia/Singapore 时区；无法确定就返回 null。",
    "如果只是沟通备注，返回 noop_or_note，并把 note 填好。",
    "conversationInsight 为 null 或对象，对象字段必须是：note_type, summary, tags, structured_slots。",
    "note_type 只能是 general_note, customer_preference, price_sensitivity, relationship_info, meeting_summary, risk_signal, decision_signal。",
    JSON.stringify(input, null, 2),
  ].join("\n");
}

export interface LlmProvider {
  extractTaskIntent(input: ParseTaskIntentRequest): Promise<ExtractionResult | null>;
}

export class NoopLlmProvider implements LlmProvider {
  async extractTaskIntent(_: ParseTaskIntentRequest): Promise<ExtractionResult | null> {
    return null;
  }
}

export class OpenAiLlmProvider implements LlmProvider {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async extractTaskIntent(input: ParseTaskIntentRequest): Promise<ExtractionResult | null> {
    try {
      const response = await this.client.responses.create({
        model: this.model,
        input: buildPrompt(input),
      });

      const raw = response.output_text?.trim();
      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw);
      return extractionResultSchema.parse(parsed);
    } catch {
      return null;
    }
  }
}

export function getProviderMetadata() {
  if (process.env.OPENAI_API_KEY) {
    return {
      provider: "openai",
      model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
    };
  }

  return {
    provider: "fallback_rules",
    model: null,
  };
}

export function createLlmProvider(): LlmProvider {
  if (process.env.OPENAI_API_KEY) {
    return new OpenAiLlmProvider(
      process.env.OPENAI_API_KEY,
      process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
    );
  }

  return new NoopLlmProvider();
}
