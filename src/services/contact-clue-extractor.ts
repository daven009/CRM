import OpenAI from "openai";
import { z } from "zod";
import { contactEntityCluesSchema } from "../lib/engine-schema";
import { ContactEntityClues } from "../types/engine";

const EXEC_TITLES = ["总", "老板", "总经理", "董事长", "董", "经理"];

function cleanCompanyHint(raw: string | null): string | null {
  if (!raw) {
    return null;
  }

  let cleaned = raw.replace(/^(今天|昨天|前天|上午|下午|晚上|中午|刚刚|刚才)/, "");
  const splitMatch = cleaned.match(/(?:和|跟|与)([^和跟与]{2,12})$/);
  if (splitMatch?.[1]) {
    cleaned = splitMatch[1];
  }

  return cleaned || null;
}

function pickTitleHint(personName: string | null): string | null {
  if (!personName) {
    return null;
  }

  const matched = EXEC_TITLES.find((title) => personName.endsWith(title));
  return matched ?? null;
}

function extractCompanyClue(text: string): string | null {
  const normalized = text.replace(/\s+/g, "");
  const exactCompany =
    normalized.match(/([A-Za-z0-9\u4e00-\u9fa5]{2,16}(?:科技|贸易|制造|实业|渠道|集团|公司))/)?.[1] ??
    normalized.match(/(?:和|跟|与)?([A-Za-z0-9\u4e00-\u9fa5]{2,10})的[张王李赵钱孙周吴郑冯陈褚卫蒋沈韩杨朱秦尤许何吕施孔曹严华金魏陶姜][\u4e00-\u9fa5]{0,2}(?:总|老板|经理|董)/)?.[1] ??
    normalized.match(/(?:和|跟|与)?([A-Za-z0-9\u4e00-\u9fa5]{2,10})[张王李赵钱孙周吴郑冯陈褚卫蒋沈韩杨朱秦尤许何吕施孔曹严华金魏陶姜][\u4e00-\u9fa5]{0,2}(?:总|老板|经理|董)/)?.[1] ??
    null;

  return cleanCompanyHint(exactCompany ?? null);
}

function extractPersonName(text: string): string | null {
  const normalized = text.replace(/\s+/g, "");
  const matched =
    normalized.match(/[张王李赵钱孙周吴郑冯陈褚卫蒋沈韩杨朱秦尤许何吕施孔曹严华金魏陶姜][\u4e00-\u9fa5]{0,2}(?:总|老板|经理|董)/) ??
    normalized.match(
      /(?:和|跟|与|给|找|约|联系)?([张王李赵钱孙周吴郑冯陈褚卫蒋沈韩杨朱秦尤许何吕施孔曹严华金魏陶姜][\u4e00-\u9fa5]{0,2}(?:总|老板|经理|董))(?:聊|说|沟通|联系|见|回|打|发|还|他|她|的|是|在|有|要|吗|呢|什么|多少|几号|什么时候|，|。|,|\?|？|$)/,
    ) ??
    normalized.match(/(?:和|跟|与|给|找|约|联系)?([\u4e00-\u9fa5]{1,4}(?:总|老板|经理|董))(?:聊|说|沟通|联系|见|回|打|发|还|他|她|的|是|在|有|要|吗|呢|什么|多少|几号|什么时候|，|。|,|\?|？|$)/);

  return matched?.[1] ?? matched?.[0] ?? null;
}

export function extractEntityClues(text: string): ContactEntityClues {
  const phone = text.match(/1[3-9]\d{9}/)?.[0] ?? null;
  const email = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0] ?? null;
  const wechat =
    text.match(/微信(?:号|是)?[:：]?\s*([A-Za-z0-9_-]{5,})/)?.[1] ??
    text.match(/wechat[:：]?\s*([A-Za-z0-9_-]{5,})/i)?.[1] ??
    null;
  const personName = extractPersonName(text);
  const company = extractCompanyClue(text);

  return {
    person_name: personName,
    company,
    phone,
    email,
    wechat,
    title_hint: pickTitleHint(personName),
  };
}

function buildPrompt(inputText: string) {
  return [
    "你是 CRM 联系人线索抽取器。",
    "请从用户原话里抽取联系人相关 clues，返回 JSON，不要输出解释。",
    "不要输出 contact_id，不要猜数据库里的最终联系人。",
    "只抽这几个字段：person_name, company, phone, email, wechat, title_hint。",
    "如果字段不存在，填 null。",
    "company 可以是简称，例如 '新海'；不要强行补全为数据库值。",
    "",
    JSON.stringify({ input_text: inputText }, null, 2),
  ].join("\n");
}

export class ContactClueExtractorService {
  private readonly apiKey = process.env.OPENAI_API_KEY;
  private readonly model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

  extractRuleBased(inputText: string): ContactEntityClues {
    return extractEntityClues(inputText);
  }

  async extract(inputText: string): Promise<ContactEntityClues> {
    const fallback = this.extractRuleBased(inputText);
    if (!this.apiKey) {
      return fallback;
    }

    try {
      const client = new OpenAI({ apiKey: this.apiKey });
      const response = await client.responses.create({
        model: this.model,
        input: buildPrompt(inputText),
      });

      const raw = response.output_text?.trim();
      if (!raw) {
        return fallback;
      }

      const parsed = contactEntityCluesSchema.parse(JSON.parse(raw));
      return {
        ...fallback,
        ...parsed,
        title_hint: parsed.title_hint ?? pickTitleHint(parsed.person_name ?? fallback.person_name),
      };
    } catch {
      return fallback;
    }
  }
}
