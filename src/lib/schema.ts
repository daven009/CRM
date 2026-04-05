import { z } from "zod";
import { INTENTS, NOTE_TYPES, TASK_STATUSES, TASK_TYPES } from "../types/agent";

export const customerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});

export const openTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  task_type: z.enum(TASK_TYPES),
  status: z.enum(TASK_STATUSES),
  due_at: z.string().datetime({ offset: true }).nullable(),
  note: z.string().nullable(),
});

export const parseTaskIntentRequestSchema = z.object({
  now: z.string().datetime({ offset: true }),
  customer: customerSchema,
  open_tasks: z.array(openTaskSchema),
  input_text: z.string().min(1),
});

const taskHintSchema = z.object({
  task_type: z.enum(TASK_TYPES).nullable(),
  title_keywords: z.array(z.string()),
});

const newTaskSchema = z.object({
  title: z.string().nullable(),
  task_type: z.enum(TASK_TYPES).nullable(),
  due_at: z.string().datetime({ offset: true }).nullable(),
  note: z.string().nullable(),
});

const changesSchema = z.object({
  title: z.string().nullable(),
  due_at: z.string().datetime({ offset: true }).nullable(),
  status: z.enum(TASK_STATUSES).nullable(),
  note: z.string().nullable(),
});

const conversationInsightSchema = z.object({
  note_type: z.enum(NOTE_TYPES),
  summary: z.string(),
  tags: z.array(z.string()),
  structured_slots: z.record(z.string(), z.string()),
});

export const taskOperationSchema = z.object({
  op: z.enum(INTENTS),
  target_task_id: z.string().nullable(),
  target_task_hint: taskHintSchema,
  new_task: newTaskSchema,
  changes: changesSchema,
});

export const parseTaskIntentResponseSchema = taskOperationSchema.extend({
  intent: z.enum(INTENTS),
  operations: z.array(taskOperationSchema),
  needs_clarification: z.boolean(),
  clarification_question: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  evidence: z.string(),
  conversation_insight: conversationInsightSchema.nullable(),
});

export const extractionResultSchema = z.object({
  intent: z.enum(INTENTS),
  referencedTaskType: z.enum(TASK_TYPES).nullable(),
  title: z.string().nullable(),
  dueAt: z.string().datetime({ offset: true }).nullable(),
  note: z.string().nullable(),
  evidence: z.string(),
  confidence: z.number().min(0).max(1),
  ambiguityReason: z.string().nullable(),
  titleKeywords: z.array(z.string()),
  conversationInsight: conversationInsightSchema.nullable(),
});
