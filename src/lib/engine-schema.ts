import { z } from "zod";
import {
  ACTION_EXECUTION_STATUSES,
  CONTACT_RESOLUTION_STATUSES,
  ENGINE_MODES,
  ENGINE_DEBUG_FALLBACK_REASONS,
  INTERACTION_TYPES,
  PENDING_QUESTION_TYPES,
  PROPOSED_ACTION_STATUSES,
  UNDERSTANDING_SOURCES,
} from "../types/engine";

export const contactCandidateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  display_name: z.string().min(1),
  company: z.string().min(1),
  phone: z.string().nullable(),
  customer_id: z.string().nullable(),
  score: z.number().nullable(),
  matched_fields: z.array(z.string()),
  profile_summary: z.string().nullable(),
});

export const contactEntityCluesSchema = z.object({
  person_name: z.string().nullable(),
  company: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  wechat: z.string().nullable(),
  title_hint: z.string().nullable(),
});

export const groundedConceptSchema = z.object({
  raw: z.string().min(1),
  normalized: z.string().min(1),
  concept_type: z.string().min(1),
  crm_semantic_hint: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export const contactResolutionSchema = z.object({
  status: z.enum(CONTACT_RESOLUTION_STATUSES),
  query_name: z.string().nullable(),
  candidates: z.array(contactCandidateSchema),
  selected_contact_id: z.string().nullable(),
  confirmed_contact_id: z.string().nullable(),
  confirmation_required: z.boolean(),
});

export const proposedActionSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  status: z.enum(PROPOSED_ACTION_STATUSES),
  confidence: z.number().min(0).max(1),
  display_text: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});

export const pendingQuestionOptionSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
});

export const pendingQuestionSchema = z.object({
  type: z.enum(PENDING_QUESTION_TYPES),
  question: z.string().min(1),
  field: z.string().nullable(),
  action_id: z.string().nullable(),
  options: z.array(pendingQuestionOptionSchema),
});

export const actionExecutionItemSchema = z.object({
  action_id: z.string().min(1),
  kind: z.string().min(1),
  success: z.boolean(),
  record_id: z.string().nullable(),
  message: z.string().min(1),
});

export const executionResultSchema = z.object({
  status: z.enum(ACTION_EXECUTION_STATUSES),
  executed_actions: z.array(actionExecutionItemSchema),
  failed_actions: z.array(actionExecutionItemSchema),
});

export const understandingSchema = z.object({
  primary_interaction_type: z.enum(INTERACTION_TYPES),
  semantic_facets: z.object({
    has_query: z.boolean(),
    has_note: z.boolean(),
    has_task: z.boolean(),
    has_reminder: z.boolean(),
    has_craft: z.boolean(),
    is_answer_to_pending: z.boolean(),
  }),
  confidence: z.number().min(0).max(1),
  grounded_concepts: z.array(groundedConceptSchema),
  requires_contact_resolution: z.boolean(),
  contact_hints: contactEntityCluesSchema,
  query_intent: z.string().nullable(),
  action_intent: z.string().nullable(),
  needs_clarification: z.boolean(),
  clarification_focus: z.string().nullable(),
  summary: z.string(),
  source: z.enum(UNDERSTANDING_SOURCES),
  arbitration_notes: z.array(z.string()).optional(),
  extracted_contact_name: z.string().nullable(),
  signals: z.array(z.string()),
  entity_clues: contactEntityCluesSchema,
  planning_source: z.enum(UNDERSTANDING_SOURCES),
});

export const draftPlanSchema = z.object({
  summary: z.string().nullable(),
  proposed_actions: z.array(proposedActionSchema),
  selected_action_ids: z.array(z.string()),
  actions_confirmed: z.boolean(),
});

export const sessionStateSchema = z.object({
  session_id: z.string().min(1),
  raw_user_input: z.string(),
  contact_resolution: contactResolutionSchema,
  draft_plan: draftPlanSchema,
  pending_question: pendingQuestionSchema.nullable(),
});

export const engineRespondRequestSchema = z.object({
  session_id: z.string().min(1).optional(),
  now: z.string().datetime({ offset: true }),
  input_text: z.string().min(1),
  session_state: sessionStateSchema.optional(),
  selected_contact_id: z.string().min(1).optional(),
  selected_action_ids: z.array(z.string().min(1)).optional(),
  confirm_selected_actions: z.boolean().optional(),
});

export const engineDebugInfoSchema = z.object({
  understanding_provider: z.enum(["openai", "fallback_rules"]),
  understanding_fallback_reason: z.enum(ENGINE_DEBUG_FALLBACK_REASONS).nullable(),
});

export const engineResponseSchema = z.object({
  mode: z.enum(ENGINE_MODES),
  session_state: sessionStateSchema,
  contact_resolution: contactResolutionSchema,
  understanding: understandingSchema,
  proposed_actions: z.array(proposedActionSchema),
  pending_question: pendingQuestionSchema.nullable(),
  execution_result: executionResultSchema,
  assistant_reply: z.string(),
  debug: engineDebugInfoSchema.optional(),
});
