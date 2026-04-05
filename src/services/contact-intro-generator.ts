import OpenAI from "openai";
import { ContactWithDetails } from "../repositories/customer-repository";

function buildFallbackIntro(contact: ContactWithDetails): string {
  return [
    contact.basics?.industry
      ? `${contact.basics.company}，${contact.basics.industry}`
      : contact.basics?.company ?? contact.company,
    contact.profile?.title ? `职位是${contact.profile.title}` : null,
    contact.basics?.acquisition_channel ? `最初通过${contact.basics.acquisition_channel}认识` : null,
    contact.profile?.preferences?.length
      ? `已知偏好：${contact.profile.preferences.slice(0, 2).join("、")}`
      : null,
  ]
    .filter(Boolean)
    .join("；");
}

function buildPrompt(contact: ContactWithDetails): string {
  return [
    "你是 CRM 联系人确认助手。",
    "请基于给定联系人资料，生成一段简短、自然的中文确认简介，帮助用户判断联系人是否正确。",
    "要求：",
    "1. 只使用提供的事实，不要编造。",
    "2. 长度控制在一到两句。",
    "3. 不要输出列表、JSON、标题、解释。",
    "4. 优先包含公司、职位、认识方式、已知偏好中的高价值信息。",
    "",
    JSON.stringify(
      {
        name: contact.name,
        display_name: contact.display_name,
        company: contact.basics?.company ?? contact.company,
        industry: contact.basics?.industry ?? null,
        relationship_type: contact.basics?.relationship_type ?? null,
        acquisition_channel: contact.basics?.acquisition_channel ?? null,
        owner: contact.basics?.owner ?? null,
        title: contact.profile?.title ?? null,
        preferences: contact.profile?.preferences ?? [],
        methods: contact.methods.map((method) => ({
          type: method.method_type,
          label: method.label,
          is_primary: method.is_primary,
        })),
      },
      null,
      2,
    ),
  ].join("\n");
}

export class ContactIntroGenerator {
  private readonly apiKey = process.env.OPENAI_API_KEY;
  private readonly model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

  async generate(contact: ContactWithDetails): Promise<string> {
    const fallback = buildFallbackIntro(contact);
    if (!this.apiKey) {
      return fallback;
    }

    try {
      const client = new OpenAI({ apiKey: this.apiKey });
      const response = await client.responses.create({
        model: this.model,
        input: buildPrompt(contact),
      });

      const text = response.output_text?.trim();
      return text || fallback;
    } catch {
      return fallback;
    }
  }
}
