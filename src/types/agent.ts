export const INTENTS = [
  "create",
  "complete",
  "update",
  "cancel",
  "noop_or_note",
] as const;

export const TASK_TYPES = [
  "send_quote",
  "follow_up",
  "collect_payment",
  "schedule_meeting",
  "send_material",
  "custom",
] as const;

export const TASK_STATUSES = ["open", "done", "cancelled", "snoozed"] as const;
export const NOTE_TYPES = [
  "general_note",
  "customer_preference",
  "price_sensitivity",
  "relationship_info",
  "meeting_summary",
  "risk_signal",
  "decision_signal",
] as const;

export type Intent = (typeof INTENTS)[number];
export type TaskType = (typeof TASK_TYPES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type NoteType = (typeof NOTE_TYPES)[number];

export interface CustomerContext {
  id: string;
  name: string;
}

export interface OpenTask {
  id: string;
  title: string;
  task_type: TaskType;
  status: TaskStatus;
  due_at: string | null;
  note: string | null;
}

export interface ParseTaskIntentRequest {
  now: string;
  customer: CustomerContext;
  open_tasks: OpenTask[];
  input_text: string;
}

export interface TaskHint {
  task_type: TaskType | null;
  title_keywords: string[];
}

export interface NewTaskPayload {
  title: string | null;
  task_type: TaskType | null;
  due_at: string | null;
  note: string | null;
}

export interface TaskChanges {
  title: string | null;
  due_at: string | null;
  status: TaskStatus | null;
  note: string | null;
}

export interface TaskOperation {
  op: Intent;
  target_task_id: string | null;
  target_task_hint: TaskHint;
  new_task: NewTaskPayload;
  changes: TaskChanges;
}

export interface ConversationInsight {
  note_type: NoteType;
  summary: string;
  tags: string[];
  structured_slots: Record<string, string>;
}

export interface ParseTaskIntentResponse extends TaskOperation {
  intent: Intent;
  operations: TaskOperation[];
  needs_clarification: boolean;
  clarification_question: string | null;
  confidence: number;
  evidence: string;
  conversation_insight: ConversationInsight | null;
}

export interface ExtractionResult {
  intent: Intent;
  referencedTaskType: TaskType | null;
  title: string | null;
  dueAt: string | null;
  note: string | null;
  evidence: string;
  confidence: number;
  ambiguityReason: string | null;
  titleKeywords: string[];
  conversationInsight: ConversationInsight | null;
}
