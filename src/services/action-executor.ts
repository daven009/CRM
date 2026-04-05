import { CustomerRepository } from "../repositories/customer-repository";
import { ActionExecutionItem, ExecutionResult, ProposedAction } from "../types/engine";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function buildSummary(executed: ActionExecutionItem[], failed: ActionExecutionItem[]): ExecutionResult["status"] {
  if (executed.length === 0 && failed.length === 0) {
    return "not_run";
  }

  if (executed.length > 0 && failed.length === 0) {
    return "success";
  }

  if (executed.length === 0 && failed.length > 0) {
    return "failed";
  }

  return "partial_success";
}

export class ActionExecutorService {
  constructor(private readonly repository = new CustomerRepository()) {}

  execute(actions: ProposedAction[]): ExecutionResult {
    const executed_actions: ActionExecutionItem[] = [];
    const failed_actions: ActionExecutionItem[] = [];

    for (const action of actions) {
      try {
        const item = this.executeSingleAction(action);
        if (item.success) {
          executed_actions.push(item);
        } else {
          failed_actions.push(item);
        }
      } catch (error) {
        failed_actions.push({
          action_id: action.id,
          kind: action.kind,
          success: false,
          record_id: null,
          message: error instanceof Error ? error.message : "unknown_execution_error",
        });
      }
    }

    return {
      status: buildSummary(executed_actions, failed_actions),
      executed_actions,
      failed_actions,
    };
  }

  private executeSingleAction(action: ProposedAction): ActionExecutionItem {
    if (action.kind === "add_note") {
      return this.executeAddNote(action);
    }

    if (action.kind === "create_task") {
      return this.executeCreateTask(action);
    }

    if (action.kind === "create_reminder") {
      return this.executeCreateReminder(action);
    }

    return {
      action_id: action.id,
      kind: action.kind,
      success: false,
      record_id: null,
      message: `unsupported_action_kind:${action.kind}`,
    };
  }

  private executeAddNote(action: ProposedAction): ActionExecutionItem {
    const contactId = action.payload.contact_id;
    const note = action.payload.note;

    if (!isNonEmptyString(contactId)) {
      return this.failed(action, "missing_contact_id");
    }

    if (!isNonEmptyString(note)) {
      return this.failed(action, "missing_note");
    }

    const summary = isNonEmptyString(action.display_text) ? action.display_text : note;
    const category = isNonEmptyString(action.payload.category) ? action.payload.category : "general_note";
    const created = this.repository.saveConversationNote({
      contactId,
      rawText: note,
      summary,
      noteType: category,
      tags: [],
      structuredSlots: {},
    });

    return {
      action_id: action.id,
      kind: action.kind,
      success: true,
      record_id: created.id,
      message: "note_saved",
    };
  }

  private executeCreateTask(action: ProposedAction): ActionExecutionItem {
    const contactId = action.payload.contact_id;
    const title = action.payload.title;
    const dueAt = action.payload.due_at;
    const note = action.payload.note;

    if (!isNonEmptyString(contactId)) {
      return this.failed(action, "missing_contact_id");
    }

    if (!isNonEmptyString(title)) {
      return this.failed(action, "missing_title");
    }

    if (!isNonEmptyString(dueAt)) {
      return this.failed(action, "missing_due_at");
    }

    const created = this.repository.createTaskForContact({
      contactId,
      title,
      dueAt,
      note: isNonEmptyString(note) ? note : null,
      taskType: "follow_up",
    });

    return {
      action_id: action.id,
      kind: action.kind,
      success: true,
      record_id: created.id,
      message: "task_created",
    };
  }

  private executeCreateReminder(action: ProposedAction): ActionExecutionItem {
    const contactId = action.payload.contact_id;
    const title = action.payload.title;
    const remindAt = action.payload.remind_at;
    const note = action.payload.note;

    if (!isNonEmptyString(contactId)) {
      return this.failed(action, "missing_contact_id");
    }

    if (!isNonEmptyString(title)) {
      return this.failed(action, "missing_title");
    }

    if (!isNonEmptyString(remindAt)) {
      return this.failed(action, "missing_remind_at");
    }

    const created = this.repository.createReminderForContact({
      contactId,
      title,
      remindAt,
      note: isNonEmptyString(note) ? note : null,
      status: "active",
    });

    return {
      action_id: action.id,
      kind: action.kind,
      success: true,
      record_id: created.id,
      message: "reminder_created",
    };
  }

  private failed(action: ProposedAction, message: string): ActionExecutionItem {
    return {
      action_id: action.id,
      kind: action.kind,
      success: false,
      record_id: null,
      message,
    };
  }
}
