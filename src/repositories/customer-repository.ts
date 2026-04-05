import { getDb } from "../db/client";
import { ConversationInsight, CustomerContext, OpenTask } from "../types/agent";

export interface ContactRecord {
  id: string;
  customer_id: string | null;
  name: string;
  display_name: string;
  company: string;
  phone: string | null;
}

export interface ContactMethodRecord {
  id: string;
  contact_id: string;
  method_type: string;
  label: string;
  value: string;
  is_primary: boolean;
}

export interface ContactBasicRecord {
  id: string;
  contact_id: string;
  company: string;
  industry: string | null;
  relationship_type: string | null;
  acquisition_channel: string | null;
  first_met_at: string | null;
  owner: string | null;
}

export interface ContactProfileRecord {
  id: string;
  contact_id: string;
  title: string | null;
  department: string | null;
  city: string | null;
  source: string | null;
  owner: string | null;
  preferences: string[];
  profile: Record<string, string>;
}

export interface ContactWithDetails extends ContactRecord {
  basics: ContactBasicRecord | null;
  methods: ContactMethodRecord[];
  profile: ContactProfileRecord | null;
}

export interface ConversationNoteRecord {
  id: string;
  customer_id: string;
  raw_text: string;
  note_type: string;
  summary: string;
  tags: string[];
  structured_slots: Record<string, string>;
  created_at: string;
}

export interface ReminderRecord {
  id: string;
  contact_id: string;
  customer_id: string | null;
  title: string;
  remind_at: string;
  note: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export class CustomerRepository {
  private readonly db = getDb();

  listAllContactsWithDetails(): ContactWithDetails[] {
    const contacts = this.db
      .prepare(
        "SELECT id, customer_id, name, display_name, company, phone FROM contacts ORDER BY display_name ASC, name ASC",
      )
      .all() as ContactRecord[];

    return contacts.map((contact) => ({
      ...contact,
      basics: this.getContactBasics(contact.id),
      methods: this.listContactMethods(contact.id),
      profile: this.getContactProfile(contact.id),
    }));
  }

  getContactById(id: string): ContactRecord | null {
    const row = this.db
      .prepare(
        "SELECT id, customer_id, name, display_name, company, phone FROM contacts WHERE id = ?",
      )
      .get(id) as ContactRecord | undefined;

    return row ?? null;
  }

  getContactWithDetailsById(id: string): ContactWithDetails | null {
    const contact = this.getContactById(id);
    if (!contact) {
      return null;
    }

    return {
      ...contact,
      basics: this.getContactBasics(id),
      methods: this.listContactMethods(id),
      profile: this.getContactProfile(id),
    };
  }

  searchContacts(query: string): ContactRecord[] {
    const exact = this.db
      .prepare(
        `
          SELECT id, customer_id, name, display_name, company, phone
          FROM contacts
          WHERE display_name = @query
             OR name = @query
          ORDER BY display_name ASC, name ASC
        `,
      )
      .all({ query }) as ContactRecord[];

    if (exact.length > 0) {
      return exact;
    }

    return this.db
      .prepare(
        `
          SELECT id, customer_id, name, display_name, company, phone
          FROM contacts
          WHERE display_name LIKE @likeQuery
             OR name LIKE @likeQuery
             OR company LIKE @likeQuery
          ORDER BY display_name ASC, name ASC
        `,
      )
      .all({ likeQuery: `%${query}%` }) as ContactRecord[];
  }

  listContactsByCustomerId(customerId: string): ContactWithDetails[] {
    const contacts = this.db
      .prepare(
        "SELECT id, customer_id, name, display_name, company, phone FROM contacts WHERE customer_id = ? ORDER BY display_name ASC, name ASC",
      )
      .all(customerId) as ContactRecord[];

    return contacts.map((contact) => ({
      ...contact,
      basics: this.getContactBasics(contact.id),
      methods: this.listContactMethods(contact.id),
      profile: this.getContactProfile(contact.id),
    }));
  }

  private getContactBasics(contactId: string): ContactBasicRecord | null {
    const row = this.db
      .prepare(
        `
          SELECT id, contact_id, company, industry, relationship_type, acquisition_channel, first_met_at, owner
          FROM contact_basics
          WHERE contact_id = ?
        `,
      )
      .get(contactId) as ContactBasicRecord | undefined;

    return row ?? null;
  }

  private listContactMethods(contactId: string): ContactMethodRecord[] {
    const rows = this.db
      .prepare(
        "SELECT id, contact_id, method_type, label, value, is_primary FROM contact_methods WHERE contact_id = ? ORDER BY is_primary DESC, created_at ASC",
      )
      .all(contactId) as Array<{
        id: string;
        contact_id: string;
        method_type: string;
        label: string;
        value: string;
        is_primary: number;
      }>;

    return rows.map((row) => ({
      ...row,
      is_primary: Boolean(row.is_primary),
    }));
  }

  private getContactProfile(contactId: string): ContactProfileRecord | null {
    const row = this.db
      .prepare(
        `
          SELECT id, contact_id, title, department, city, source, owner, preference_json, profile_json
          FROM contact_profiles
          WHERE contact_id = ?
        `,
      )
      .get(contactId) as
      | {
          id: string;
          contact_id: string;
          title: string | null;
          department: string | null;
          city: string | null;
          source: string | null;
          owner: string | null;
          preference_json: string;
          profile_json: string;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      contact_id: row.contact_id,
      title: row.title,
      department: row.department,
      city: row.city,
      source: row.source,
      owner: row.owner,
      preferences: JSON.parse(row.preference_json),
      profile: JSON.parse(row.profile_json),
    };
  }

  getCustomerById(id: string): CustomerContext | null {
    const row = this.db.prepare("SELECT id, name FROM customers WHERE id = ?").get(id) as
      | { id: string; name: string }
      | undefined;

    return row ?? null;
  }

  getOpenTasksByCustomerId(customerId: string): OpenTask[] {
    return this.db
      .prepare(
        "SELECT id, title, task_type, status, due_at, note FROM tasks WHERE customer_id = ? AND status = 'open' ORDER BY created_at ASC",
      )
      .all(customerId) as OpenTask[];
  }

  listNotesByCustomerId(customerId: string): ConversationNoteRecord[] {
    const rows = this.db
      .prepare(
        "SELECT id, customer_id, raw_text, note_type, summary, tags_json, structured_slots_json, created_at FROM conversation_notes WHERE customer_id = ? ORDER BY created_at DESC",
      )
      .all(customerId) as Array<{
        id: string;
        customer_id: string;
        raw_text: string;
        note_type: string;
        summary: string;
        tags_json: string;
        structured_slots_json: string;
        created_at: string;
      }>;

    return rows.map((row) => ({
      id: row.id,
      customer_id: row.customer_id,
      raw_text: row.raw_text,
      note_type: row.note_type,
      summary: row.summary,
      tags: JSON.parse(row.tags_json),
      structured_slots: JSON.parse(row.structured_slots_json),
      created_at: row.created_at,
    }));
  }

  saveConversationInsight(customerId: string, rawText: string, insight: ConversationInsight) {
    const now = new Date().toISOString();
    const id = `n_${Date.now()}`;

    this.db
      .prepare(`
        INSERT INTO conversation_notes (
          id, customer_id, raw_text, note_type, summary, tags_json, structured_slots_json, created_at
        ) VALUES (
          @id, @customer_id, @raw_text, @note_type, @summary, @tags_json, @structured_slots_json, @created_at
        )
      `)
      .run({
        id,
        customer_id: customerId,
        raw_text: rawText,
        note_type: insight.note_type,
        summary: insight.summary,
        tags_json: JSON.stringify(insight.tags),
        structured_slots_json: JSON.stringify(insight.structured_slots),
        created_at: now,
      });

    return id;
  }

  saveConversationNote(input: {
    contactId: string;
    rawText: string;
    summary: string;
    noteType?: string;
    tags?: string[];
    structuredSlots?: Record<string, string>;
  }) {
    const contact = this.getContactById(input.contactId);
    if (!contact?.customer_id) {
      throw new Error("contact_missing_customer");
    }

    const now = new Date().toISOString();
    const id = `n_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    this.db
      .prepare(`
        INSERT INTO conversation_notes (
          id, customer_id, raw_text, note_type, summary, tags_json, structured_slots_json, created_at
        ) VALUES (
          @id, @customer_id, @raw_text, @note_type, @summary, @tags_json, @structured_slots_json, @created_at
        )
      `)
      .run({
        id,
        customer_id: contact.customer_id,
        raw_text: input.rawText,
        note_type: input.noteType ?? "general_note",
        summary: input.summary,
        tags_json: JSON.stringify(input.tags ?? []),
        structured_slots_json: JSON.stringify(input.structuredSlots ?? {}),
        created_at: now,
      });

    return {
      id,
      customer_id: contact.customer_id,
    };
  }

  createTaskForContact(input: {
    contactId: string;
    title: string;
    dueAt?: string | null;
    note?: string | null;
    taskType?: string;
  }) {
    const contact = this.getContactById(input.contactId);
    if (!contact?.customer_id) {
      throw new Error("contact_missing_customer");
    }

    const now = new Date().toISOString();
    const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    this.db
      .prepare(`
        INSERT INTO tasks (
          id, customer_id, title, task_type, status, due_at, note, created_at, updated_at
        ) VALUES (
          @id, @customer_id, @title, @task_type, @status, @due_at, @note, @created_at, @updated_at
        )
      `)
      .run({
        id,
        customer_id: contact.customer_id,
        title: input.title,
        task_type: input.taskType ?? "follow_up",
        status: "open",
        due_at: input.dueAt ?? null,
        note: input.note ?? null,
        created_at: now,
        updated_at: now,
      });

    return {
      id,
      customer_id: contact.customer_id,
    };
  }

  createReminderForContact(input: {
    contactId: string;
    title: string;
    remindAt: string;
    note?: string | null;
    status?: string;
  }) {
    const contact = this.getContactById(input.contactId);
    if (!contact) {
      throw new Error("contact_not_found");
    }

    const now = new Date().toISOString();
    const id = `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    this.db
      .prepare(`
        INSERT INTO reminders (
          id, contact_id, customer_id, title, remind_at, note, status, created_at, updated_at
        ) VALUES (
          @id, @contact_id, @customer_id, @title, @remind_at, @note, @status, @created_at, @updated_at
        )
      `)
      .run({
        id,
        contact_id: input.contactId,
        customer_id: contact.customer_id,
        title: input.title,
        remind_at: input.remindAt,
        note: input.note ?? null,
        status: input.status ?? "active",
        created_at: now,
        updated_at: now,
      });

    return {
      id,
      contact_id: input.contactId,
      customer_id: contact.customer_id,
    };
  }

  listRemindersByContactId(contactId: string): ReminderRecord[] {
    return this.db
      .prepare(`
        SELECT id, contact_id, customer_id, title, remind_at, note, status, created_at, updated_at
        FROM reminders
        WHERE contact_id = ?
        ORDER BY created_at DESC
      `)
      .all(contactId) as ReminderRecord[];
  }
}
