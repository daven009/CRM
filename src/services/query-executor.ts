import { ContactWithDetails, ConversationNoteRecord, CustomerRepository } from "../repositories/customer-repository";

export interface QueryExecutionResult {
  answer: string;
  summary: string;
  signals: string[];
}

function pickPhone(contact: ContactWithDetails): string | null {
  const primaryMobile = contact.methods.find((method) => method.is_primary && method.method_type === "mobile")?.value;
  return primaryMobile ?? contact.phone ?? null;
}

function extractBirthdaySignal(contact: ContactWithDetails, notes: ConversationNoteRecord[]): string | null {
  const familyNote = typeof contact.profile?.profile.family_note === "string" ? contact.profile.profile.family_note : null;
  if (familyNote) {
    return familyNote;
  }

  const birthdayNote = notes.find((note) =>
    note.note_type === "relationship_info" ||
    /生日/.test(note.raw_text) ||
    /生日/.test(note.summary) ||
    /生日/.test(note.structured_slots.important_date ?? ""),
  );

  if (!birthdayNote) {
    return null;
  }

  return birthdayNote.structured_slots.important_date ?? birthdayNote.summary ?? birthdayNote.raw_text;
}

function summarizeRecentNotes(notes: ConversationNoteRecord[]): string {
  if (notes.length === 0) {
    return "当前还没有找到和这位联系人的历史沟通记录。";
  }

  const summaries = notes.slice(0, 3).map((note, index) => `${index + 1}. ${note.summary}`);
  return `最近相关记录：\n${summaries.join("\n")}`;
}

function summarizeOpenTasks(contact: ContactWithDetails, repository: CustomerRepository): string {
  if (!contact.customer_id) {
    return "当前没有关联 customer，无法查询 open tasks。";
  }

  const tasks = repository.getOpenTasksByCustomerId(contact.customer_id);
  if (tasks.length === 0) {
    return "当前没有和这位联系人关联的 open tasks。";
  }

  const summaries = tasks.slice(0, 3).map((task, index) => {
    const dueAt = task.due_at ? `，截止 ${task.due_at}` : "";
    return `${index + 1}. ${task.title}${dueAt}`;
  });
  return `当前 open tasks：\n${summaries.join("\n")}`;
}

export class QueryExecutorService {
  private readonly repository = new CustomerRepository();

  execute(text: string, contact: ContactWithDetails): QueryExecutionResult {
    const notes = contact.customer_id ? this.repository.listNotesByCustomerId(contact.customer_id) : [];

    if (/(手机号|手机|电话)/.test(text)) {
      const phone = pickPhone(contact);
      return phone
        ? {
            answer: `${contact.display_name}的手机号是 ${phone}。`,
            summary: "已返回联系人手机号。",
            signals: ["query:phone"],
          }
        : {
            answer: `当前没有找到 ${contact.display_name} 的手机号记录。`,
            summary: "未找到联系人手机号。",
            signals: ["query:phone_missing"],
          };
    }

    if (/(职位|title|岗位|头衔)/i.test(text)) {
      return contact.profile?.title
        ? {
            answer: `${contact.display_name}当前记录的职位是 ${contact.profile.title}。`,
            summary: "已返回联系人职位。",
            signals: ["query:title"],
          }
        : {
            answer: `当前没有找到 ${contact.display_name} 的职位信息。`,
            summary: "未找到联系人职位。",
            signals: ["query:title_missing"],
          };
    }

    if (/(公司|哪家公司)/.test(text)) {
      const company = contact.basics?.company ?? contact.company;
      return {
        answer: `${contact.display_name}当前关联的公司是 ${company}。`,
        summary: "已返回联系人公司。",
        signals: ["query:company"],
      };
    }

    if (/(生日|女儿生日|儿子生日|孩子生日)/.test(text)) {
      const birthdaySignal = extractBirthdaySignal(contact, notes);
      return birthdaySignal
        ? {
            answer: `${contact.display_name}相关的生日信息里，目前只查到：${birthdaySignal}。`,
            summary: "已返回关系信息中的生日线索。",
            signals: ["query:birthday"],
          }
        : {
            answer: `当前没有找到 ${contact.display_name} 相关的明确生日记录。`,
            summary: "未找到明确生日信息。",
            signals: ["query:birthday_missing"],
          };
    }

    if (/(最近.*聊了什么|最近聊了什么|最近沟通|最近记录|最近说了什么)/.test(text)) {
      return {
        answer: summarizeRecentNotes(notes),
        summary: "已返回最近沟通摘要。",
        signals: ["query:recent_notes"],
      };
    }

    if (/(待办|open task|任务)/i.test(text)) {
      return {
        answer: summarizeOpenTasks(contact, this.repository),
        summary: "已返回 open tasks 摘要。",
        signals: ["query:open_tasks"],
      };
    }

    if (/(偏好|喜好|profile|画像|城市|部门|来源)/.test(text)) {
      const fields = [
        contact.profile?.department ? `部门：${contact.profile.department}` : null,
        contact.profile?.city ? `城市：${contact.profile.city}` : null,
        contact.profile?.source ? `来源：${contact.profile.source}` : null,
        contact.profile?.preferences?.length ? `偏好：${contact.profile.preferences.join("、")}` : null,
      ].filter(Boolean);

      return fields.length > 0
        ? {
            answer: `${contact.display_name}当前画像信息：${fields.join("；")}。`,
            summary: "已返回联系人画像字段。",
            signals: ["query:profile"],
          }
        : {
            answer: `当前没有找到 ${contact.display_name} 的更多画像字段。`,
            summary: "未找到联系人画像字段。",
            signals: ["query:profile_missing"],
          };
    }

    return {
      answer: `当前还不能稳定回答这个查询，但我已经确认了联系人 ${contact.display_name}。你可以继续问手机号、职位、公司、生日、最近沟通或 open tasks。`,
      summary: "当前 query executor 暂不支持该查询。",
      signals: ["query:unsupported"],
    };
  }
}
