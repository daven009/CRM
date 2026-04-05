export const ENGINE_MODES = [
  "resolve_contact",
  "clarify",
  "confirm",
  "answer",
  "execute",
] as const;

export const CONTACT_RESOLUTION_STATUSES = [
  "unresolved",
  "ambiguous",
  "resolved",
  "not_found",
] as const;

export const PROPOSED_ACTION_KINDS = [
  "add_note",
  "create_task",
  "update_task",
  "complete_task",
  "create_reminder",
  "query",
] as const;

export const PROPOSED_ACTION_STATUSES = [
  "proposed",
  "needs_input",
  "ready",
] as const;

export const PENDING_QUESTION_TYPES = [
  "contact_resolution",
  "slot_filling",
  "action_selection",
  "action_confirmation",
  "generic_clarification",
] as const;

export const INTERACTION_TYPES = [
  "query",
  "note",
  "task",
  "reminder",
  "craft",
  "mixed",
  "answer_to_pending",
] as const;

export const UNDERSTANDING_SOURCES = [
  "llm",
  "fallback_rules",
  "hybrid",
] as const;

export const ENGINE_DEBUG_FALLBACK_REASONS = [
  "missing_api_key",
  "empty_output",
  "invalid_json",
  "invalid_schema",
  "llm_error",
] as const;

export type EngineMode = (typeof ENGINE_MODES)[number];
export type ContactResolutionStatus = (typeof CONTACT_RESOLUTION_STATUSES)[number];
export type SupportedProposedActionKind = (typeof PROPOSED_ACTION_KINDS)[number];
export type ProposedActionKind = string;
export type ProposedActionStatus = (typeof PROPOSED_ACTION_STATUSES)[number];
export type PendingQuestionType = (typeof PENDING_QUESTION_TYPES)[number];
export type InteractionType = (typeof INTERACTION_TYPES)[number];
export type UnderstandingSource = (typeof UNDERSTANDING_SOURCES)[number];
export type EngineDebugFallbackReason = (typeof ENGINE_DEBUG_FALLBACK_REASONS)[number];

export interface SemanticFacets {
  has_query: boolean;
  has_note: boolean;
  has_task: boolean;
  has_reminder: boolean;
  has_craft: boolean;
  is_answer_to_pending: boolean;
}

export interface ContactCandidate {
  id: string;
  name: string;
  display_name: string;
  company: string;
  phone: string | null;
  customer_id: string | null;
  score: number | null;
  matched_fields: string[];
  profile_summary: string | null;
}

export interface ContactEntityClues {
  person_name: string | null;
  company: string | null;
  phone: string | null;
  email: string | null;
  wechat: string | null;
  title_hint: string | null;
}

export interface ContactResolution {
  status: ContactResolutionStatus;
  query_name: string | null;
  candidates: ContactCandidate[];
  selected_contact_id: string | null;
  confirmed_contact_id: string | null;
  confirmation_required: boolean;
}

export interface GroundedConcept {
  raw: string;
  normalized: string;
  concept_type: string;
  crm_semantic_hint: string;
  confidence: number;
}

export interface ProposedAction {
  id: string;
  kind: ProposedActionKind;
  status: ProposedActionStatus;
  confidence: number;
  display_text: string;
  payload: Record<string, unknown>;
}

export const ACTION_EXECUTION_STATUSES = [
  "not_run",
  "partial_success",
  "success",
  "failed",
] as const;

export type ActionExecutionStatus = (typeof ACTION_EXECUTION_STATUSES)[number];

export interface ActionExecutionItem {
  action_id: string;
  kind: ProposedActionKind;
  success: boolean;
  record_id: string | null;
  message: string;
}

export interface ExecutionResult {
  status: ActionExecutionStatus;
  executed_actions: ActionExecutionItem[];
  failed_actions: ActionExecutionItem[];
}

export interface PendingQuestionOption {
  label: string;
  value: string;
}

export interface PendingQuestion {
  type: PendingQuestionType;
  question: string;
  field: string | null;
  action_id: string | null;
  options: PendingQuestionOption[];
}

export interface Understanding {
  primary_interaction_type: InteractionType;
  semantic_facets: SemanticFacets;
  confidence: number;
  grounded_concepts: GroundedConcept[];
  requires_contact_resolution: boolean;
  contact_hints: ContactEntityClues;
  query_intent: string | null;
  action_intent: string | null;
  needs_clarification: boolean;
  clarification_focus: string | null;
  summary: string;
  source: UnderstandingSource;
  arbitration_notes?: string[];
  extracted_contact_name: string | null;
  signals: string[];
  entity_clues: ContactEntityClues;
  planning_source: UnderstandingSource;
}

export interface DraftPlan {
  summary: string | null;
  proposed_actions: ProposedAction[];
  selected_action_ids: string[];
  actions_confirmed: boolean;
}

export interface SessionState {
  session_id: string;
  raw_user_input: string;
  contact_resolution: ContactResolution;
  draft_plan: DraftPlan;
  pending_question: PendingQuestion | null;
}

export interface EngineRespondRequest {
  session_id?: string;
  now: string;
  input_text: string;
  session_state?: SessionState;
  selected_contact_id?: string;
  selected_action_ids?: string[];
  confirm_selected_actions?: boolean;
}

export interface EngineDebugInfo {
  understanding_provider: "openai" | "fallback_rules";
  understanding_fallback_reason: EngineDebugFallbackReason | null;
}

export interface EngineResponse {
  mode: EngineMode;
  session_state: SessionState;
  contact_resolution: ContactResolution;
  understanding: Understanding;
  proposed_actions: ProposedAction[];
  pending_question: PendingQuestion | null;
  execution_result: ExecutionResult;
  assistant_reply: string;
  debug?: EngineDebugInfo;
}
