import { ContactWithDetails, CustomerRepository } from "../repositories/customer-repository";
import { parseDueTime } from "./time-parser";
import { ContactResolverService } from "./contact-resolver";
import { ContactIntroGenerator } from "./contact-intro-generator";
import { EngineActionPlanner, PlannedActionResult } from "./engine-action-planner";
import { EngineUnderstandingService } from "./engine-understanding";
import { QueryExecutorService } from "./query-executor";
import { EngineReplyComposer } from "./engine-reply-composer";
import { ActionExecutorService } from "./action-executor";
import {
  ExecutionResult,
  ContactCandidate,
  ContactResolution,
  EngineMode,
  EngineRespondRequest,
  EngineResponse,
  GroundedConcept,
  PendingQuestion,
  PendingQuestionType,
  ProposedAction,
  SessionState,
  Understanding,
} from "../types/engine";

function buildNotRunExecutionResult(): ExecutionResult {
  return {
    status: "not_run",
    executed_actions: [],
    failed_actions: [],
  };
}

function buildExecutionAssistantReply(executionResult: ExecutionResult) {
  const executedCount = executionResult.executed_actions.length;
  const failedCount = executionResult.failed_actions.length;
  const noteCount = executionResult.executed_actions.filter((item) => item.kind === "add_note").length;
  const taskCount = executionResult.executed_actions.filter((item) => item.kind === "create_task").length;
  const reminderCount = executionResult.executed_actions.filter((item) => item.kind === "create_reminder").length;

  if (executionResult.status === "success") {
    const parts: string[] = [];
    if (noteCount > 0) {
      parts.push(`已记录 ${noteCount} 条备注`);
    }
    if (taskCount > 0) {
      parts.push(`已创建 ${taskCount} 条待办`);
    }
    if (reminderCount > 0) {
      parts.push(`已新增 ${reminderCount} 条提醒`);
    }
    return parts.join("，") || `已执行 ${executedCount} 条动作。`;
  }

  if (executionResult.status === "partial_success") {
    return `已执行 ${executedCount} 条动作，${failedCount} 条失败。`;
  }

  if (executionResult.status === "failed") {
    return `动作执行失败，共 ${failedCount} 条未写入数据库。`;
  }

  return "当前未执行任何动作。";
}

interface RequestContext {
  isContinuationAnswer: boolean;
  rawInput: string;
  previousPendingQuestion: PendingQuestion | null;
  previousResolution: ContactResolution | undefined;
  previousDraftPlan: SessionState["draft_plan"] | undefined;
  previousConfirmedContactId: string | null;
}

function compactText(text: string) {
  return text.replace(/\s+/g, "");
}

function hasStrongNewRequestSignals(text: string) {
  const normalized = compactText(text);
  return (
    normalized.length > 18 ||
    /[，。,；？！]/.test(text) ||
    /(今天和|聊了|感兴趣|demo|演示|生日|提醒|待办|最近|手机号|职位|公司|报价|合同|帮我写|写个|跟进|发给)/i.test(normalized)
  );
}

function isLikelyContinuationAnswer(
  input: EngineRespondRequest,
  previousPendingQuestion: PendingQuestion | null,
): boolean {
  if (!previousPendingQuestion) {
    return false;
  }

  const normalized = compactText(input.input_text);
  if (!normalized) {
    return false;
  }

  if (previousPendingQuestion.type === "contact_resolution") {
    if (input.selected_contact_id) {
      return true;
    }

    if (isConfirmationInput(input.input_text)) {
      return true;
    }

    if (/^(那位|这位|就是他|就是她|就是这位|新海科技那位|ABC贸易那位|明远制造那位)/.test(normalized)) {
      return true;
    }

    return normalized.length <= 16 && !hasStrongNewRequestSignals(input.input_text);
  }

  if (previousPendingQuestion.type === "slot_filling") {
    if (parseDueTime(input.input_text, input.now)) {
      return true;
    }

    return normalized.length <= 16 && !hasStrongNewRequestSignals(input.input_text);
  }

  if (previousPendingQuestion.type === "action_selection") {
    if (input.selected_action_ids?.length) {
      return true;
    }

    if (/(全部|全选|都要|都执行|执行第|第[一二两三四五六七八九十\d]+)/.test(normalized)) {
      return true;
    }

    return false;
  }

  if (previousPendingQuestion.type === "generic_clarification") {
    return normalized.length <= 16 && !hasStrongNewRequestSignals(input.input_text);
  }

  return false;
}

function deriveRequestContext(input: EngineRespondRequest): RequestContext {
  const previousPendingQuestion = input.session_state?.pending_question ?? null;
  const previousResolution = input.session_state?.contact_resolution;
  const previousDraftPlan = input.session_state?.draft_plan;
  const previousConfirmedContactId = previousResolution?.confirmed_contact_id ?? null;
  const isContinuationAnswer = isLikelyContinuationAnswer(input, previousPendingQuestion);

  return {
    isContinuationAnswer,
    rawInput: isContinuationAnswer ? (input.session_state?.raw_user_input ?? input.input_text) : input.input_text,
    previousPendingQuestion: isContinuationAnswer ? previousPendingQuestion : null,
    previousResolution,
    previousDraftPlan,
    previousConfirmedContactId,
  };
}

function hasAnyEntityClues(understanding: Understanding) {
  return Object.values(understanding.contact_hints).some(Boolean);
}

function buildCarriedContactResolution(previousResolution: ContactResolution): ContactResolution {
  return {
    ...previousResolution,
    status: "resolved",
    selected_contact_id: previousResolution.confirmed_contact_id,
    confirmed_contact_id: previousResolution.confirmed_contact_id,
    confirmation_required: false,
  };
}

function normalizeComparableText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, "").toLowerCase();
}

function isClueContained(clue: string | null, ...candidates: Array<string | null | undefined>) {
  if (!clue) {
    return true;
  }

  const normalizedClue = normalizeComparableText(clue);
  if (!normalizedClue) {
    return true;
  }

  return candidates.some((candidate) => {
    const normalizedCandidate = normalizeComparableText(candidate);
    return normalizedCandidate.includes(normalizedClue) || normalizedClue.includes(normalizedCandidate);
  });
}

function isCompatibleWithRecentContact(understanding: Understanding, contact: ContactWithDetails): boolean {
  const clues = understanding.contact_hints;
  const company = contact.basics?.company ?? contact.company;
  const phoneValues = [contact.phone, ...contact.methods.map((method) => method.value)];
  const emailValues = contact.methods.filter((method) => method.method_type === "email").map((method) => method.value);
  const wechatValues = contact.methods.filter((method) => method.method_type === "wechat").map((method) => method.value);
  const titleValues = [contact.profile?.title];

  if (clues.phone && !phoneValues.some((value) => normalizeComparableText(value) === normalizeComparableText(clues.phone))) {
    return false;
  }

  if (clues.email && !emailValues.some((value) => normalizeComparableText(value) === normalizeComparableText(clues.email))) {
    return false;
  }

  if (clues.wechat && !wechatValues.some((value) => normalizeComparableText(value) === normalizeComparableText(clues.wechat))) {
    return false;
  }

  if (clues.company && !isClueContained(clues.company, company)) {
    return false;
  }

  if (clues.person_name && !isClueContained(clues.person_name, contact.display_name, contact.name)) {
    return false;
  }

  if (clues.title_hint && !isClueContained(clues.title_hint, ...titleValues, contact.display_name, contact.name)) {
    return false;
  }

  return true;
}

function buildInheritedContactResolution(contact: ContactWithDetails, queryName: string | null): ContactResolution {
  return {
    status: "resolved",
    query_name: queryName,
    candidates: [
      {
        id: contact.id,
        name: contact.name,
        display_name: contact.display_name,
        company: contact.basics?.company ?? contact.company,
        phone: contact.phone,
        customer_id: contact.customer_id,
        score: null,
        matched_fields: ["recent_confirmed_contact"],
        profile_summary: null,
      },
    ],
    selected_contact_id: contact.id,
    confirmed_contact_id: contact.id,
    confirmation_required: false,
  };
}

function generateSessionId() {
  return `sess_${Date.now()}`;
}

function generateActionId(kind: string, index: number) {
  return `${kind}_${index + 1}`;
}

function summarizeCandidates(candidates: ContactCandidate[]) {
  return candidates
    .map((candidate, index) => `${index + 1}. ${candidate.display_name} / ${candidate.name} / ${candidate.company}`)
    .join("\n");
}

function isConfirmationInput(text: string) {
  return /^(是|是的|对|对的|确认|没错|就是他|就是这位|是他|是她)/.test(text.replace(/\s+/g, ""));
}

function chineseOrdinalToNumber(token: string): number | null {
  const normalized = token.trim();
  const map: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };

  if (/^\d+$/.test(normalized)) {
    return Number(normalized);
  }

  if (map[normalized] != null) {
    return map[normalized];
  }

  if (normalized.startsWith("十")) {
    const tail = normalized.slice(1);
    return 10 + (map[tail] ?? 0);
  }

  const tenIndex = normalized.indexOf("十");
  if (tenIndex > 0) {
    const head = map[normalized.slice(0, tenIndex)] ?? null;
    const tailToken = normalized.slice(tenIndex + 1);
    const tail = tailToken ? (map[tailToken] ?? null) : 0;
    if (head != null && tail != null) {
      return head * 10 + tail;
    }
  }

  return null;
}

function buildContactProfileSummary(candidate: ContactCandidate) {
  return candidate.profile_summary ?? `${candidate.display_name}，来自 ${candidate.company}。`;
}

function updateUnderstanding(
  base: Understanding,
  overrides: Partial<Understanding>,
): Understanding {
  return {
    ...base,
    ...overrides,
  };
}

function isAnswerToPending(understanding: Understanding) {
  return understanding.semantic_facets.is_answer_to_pending || understanding.primary_interaction_type === "answer_to_pending";
}

function shouldEnterQueryBranch(understanding: Understanding) {
  const facets = understanding.semantic_facets;
  if (facets.has_task || facets.has_craft) {
    return false;
  }

  if (understanding.query_intent) {
    return facets.has_query;
  }

  return facets.has_query && !facets.has_note && !facets.has_reminder;
}

function detectReminderDate(text: string, now: string): { raw: string | null; normalized: string | null } {
  const explicit = text.match(/下个月(\d{1,2})[号日]/);
  if (explicit) {
    const month = new Date(now).getMonth() + 2;
    const year = new Date(now).getFullYear() + (month > 12 ? 1 : 0);
    const normalizedMonth = ((month - 1) % 12) + 1;
    const day = Number(explicit[1]);
    const iso = `${year}-${String(normalizedMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}T09:00:00+08:00`;
    return {
      raw: `下个月${explicit[1]}号`,
      normalized: iso,
    };
  }

  const raw = text.match(/(\d{1,2}[号日])/);
  return {
    raw: raw?.[1] ?? null,
    normalized: null,
  };
}

function buildActionDisplayText(action: Pick<ProposedAction, "kind" | "payload">, contact: ContactCandidate) {
  if (action.kind === "add_note") {
    const note = typeof action.payload.note === "string" ? action.payload.note : "记录沟通备注";
    return note;
  }

  if (action.kind === "create_task") {
    const title = typeof action.payload.title === "string" ? action.payload.title : "创建任务";
    const dueAt = typeof action.payload.due_at === "string" ? `，时间 ${action.payload.due_at}` : "";
    return `给 ${contact.display_name}${title.includes("发送") ? "" : "创建"}${title}${dueAt}`;
  }

  if (action.kind === "create_reminder") {
    const title = typeof action.payload.title === "string" ? action.payload.title : "创建提醒";
    const remindFor = typeof action.payload.reminder_for === "string" ? `，对象 ${action.payload.reminder_for}` : "";
    return `设置提醒：${title}${remindFor}`;
  }

  if (action.kind === "query") {
    const query = typeof action.payload.query === "string" ? action.payload.query : "查询联系人信息";
    return `查询：${query}`;
  }

  if (action.kind === "update_task") {
    return `更新与 ${contact.display_name} 相关的待办`;
  }

  if (action.kind === "complete_task") {
    return `完成与 ${contact.display_name} 相关的待办`;
  }

  return action.kind;
}

function hasGroundedHint(groundedConcepts: GroundedConcept[], hint: string) {
  return groundedConcepts.some((concept) => concept.crm_semantic_hint === hint);
}

function deriveGroundedNoteCategory(groundedConcepts: GroundedConcept[]) {
  if (hasGroundedHint(groundedConcepts, "relationship_maintenance_holiday")) {
    return "relationship_maintenance";
  }

  if (
    hasGroundedHint(groundedConcepts, "family_milestone_event") ||
    hasGroundedHint(groundedConcepts, "family_life_stage_event")
  ) {
    return "relationship_info";
  }

  return "general_note";
}

function buildGroundedNoteText(text: string, groundedConcepts: GroundedConcept[]) {
  const compact = text.replace(/\s+/g, "");
  const normalizedConcepts = groundedConcepts.map((concept) => concept.normalized).join("、");

  if (/(女儿|儿子|孩子)/.test(compact)) {
    return `客户提到家人相关事件：${compact}${normalizedConcepts ? `（概念归一化：${normalizedConcepts}）` : ""}`;
  }

  if (hasGroundedHint(groundedConcepts, "relationship_maintenance_holiday")) {
    return `客户提到节日关系维护事项：${compact}${normalizedConcepts ? `（概念归一化：${normalizedConcepts}）` : ""}`;
  }

  return `客户提到重要关系事件：${compact}${normalizedConcepts ? `（概念归一化：${normalizedConcepts}）` : ""}`;
}

function maybeBuildGroundedReminder(
  text: string,
  now: string,
  contact: ContactCandidate,
  groundedConcepts: GroundedConcept[],
  nextIndex: number,
) {
  const explicitReminder = /(提醒|记得|问候|跟进)/.test(text);
  const relationshipEvent =
    hasGroundedHint(groundedConcepts, "family_milestone_event") ||
    hasGroundedHint(groundedConcepts, "family_life_stage_event") ||
    hasGroundedHint(groundedConcepts, "relationship_maintenance_holiday");

  if (!relationshipEvent) {
    return null;
  }

  const preciseReminder = detectReminderDate(text, now);
  const dueAt = preciseReminder.normalized ?? parseDueTime(text, now);
  if (!explicitReminder && !dueAt) {
    return null;
  }

  const primaryConcept = groundedConcepts[0]?.normalized ?? "关系维护";
  return {
    id: generateActionId("create_reminder", nextIndex),
    kind: "create_reminder" as const,
    status: dueAt ? ("ready" as const) : ("needs_input" as const),
    confidence: 0.76,
    display_text: `设置${contact.display_name}相关提醒：${primaryConcept}`,
    payload: {
      contact_id: contact.id,
      title: `${primaryConcept}提醒`,
      note: buildGroundedNoteText(text, groundedConcepts),
      reminder_for: preciseReminder.raw ?? primaryConcept,
      remind_at: dueAt,
    },
  };
}

function buildProposedActions(
  text: string,
  now: string,
  contact: ContactCandidate,
  groundedConcepts: GroundedConcept[] = [],
): { actions: ProposedAction[]; pendingQuestion: PendingQuestion | null; summary: string; signals: string[] } {
  const actions: ProposedAction[] = [];
  const signals: string[] = [];
  let pendingQuestion: PendingQuestion | null = null;

  if (/(感兴趣|对.*报价.*感兴趣|价格可以接受|愿意继续了解)/.test(text)) {
    actions.push({
      id: generateActionId("add_note", actions.length),
      kind: "add_note",
      status: "ready",
      confidence: 0.85,
      display_text: "记录客户对报价感兴趣",
      payload: {
        contact_id: contact.id,
        note: "联系人对报价表现出兴趣",
        category: "opportunity_signal",
      },
    });
    signals.push("报价兴趣");
  }

  if (/(demo|演示|产品demo|产品演示)/i.test(text)) {
    const dueAt = parseDueTime(text, now);
    const needsInput = !dueAt;
    actions.push({
      id: generateActionId("create_task", actions.length),
      kind: "create_task",
      status: needsInput ? "needs_input" : "ready",
      confidence: 0.88,
      display_text: `发送产品demo给${contact.display_name}`,
      payload: {
        contact_id: contact.id,
        title: "发送产品demo",
        due_at: dueAt,
        note: "基于最新沟通创建",
      },
    });
    signals.push("demo跟进");
    if (needsInput) {
      pendingQuestion = {
        type: "slot_filling",
        question: `${contact.display_name}的 demo 准备下周哪天发？`,
        field: "due_at",
        action_id: actions[actions.length - 1].id,
        options: [],
      };
    }
  }

  if (/(女儿|儿子|孩子).*(生日)/.test(text) || /(生日)/.test(text)) {
    const reminder = detectReminderDate(text, now);
    actions.push({
      id: generateActionId("create_reminder", actions.length),
      kind: "create_reminder",
      status: reminder.normalized ? "ready" : "needs_input",
      confidence: 0.8,
      display_text: `设置${contact.display_name}家人生日提醒`,
      payload: {
        contact_id: contact.id,
        title: "生日提醒",
        reminder_for: reminder.raw ?? "生日",
        remind_at: reminder.normalized,
      },
    });
    signals.push("关系维护");
    if (!pendingQuestion && !reminder.normalized) {
      pendingQuestion = {
        type: "slot_filling",
        question: `${contact.display_name}家人的生日提醒要设在哪一天？`,
        field: "remind_at",
        action_id: actions[actions.length - 1].id,
        options: [],
      };
    }
  }

  const hasRelationshipGroundedConcept =
    hasGroundedHint(groundedConcepts, "family_milestone_event") ||
    hasGroundedHint(groundedConcepts, "family_life_stage_event") ||
    hasGroundedHint(groundedConcepts, "relationship_maintenance_holiday");

  if (
    hasRelationshipGroundedConcept &&
    !actions.some((action) => action.kind === "add_note" && action.payload.category === "relationship_info")
  ) {
    actions.push({
      id: generateActionId("add_note", actions.length),
      kind: "add_note",
      status: "ready",
      confidence: 0.84,
      display_text:
        hasGroundedHint(groundedConcepts, "relationship_maintenance_holiday")
          ? `记录${contact.display_name}的节日关系维护信息`
          : `记录${contact.display_name}的家庭相关信息`,
      payload: {
        contact_id: contact.id,
        note: buildGroundedNoteText(text, groundedConcepts),
        category: deriveGroundedNoteCategory(groundedConcepts),
      },
    });
    signals.push("grounded_relationship_event");
  }

  const groundedReminderAction = maybeBuildGroundedReminder(text, now, contact, groundedConcepts, actions.length);
  if (
    groundedReminderAction &&
    !actions.some((action) =>
      action.kind === "create_reminder" &&
      String(action.payload.title ?? "") === String(groundedReminderAction.payload.title ?? ""),
    )
  ) {
    actions.push(groundedReminderAction);
    signals.push("grounded_relationship_reminder");

    if (!pendingQuestion && groundedReminderAction.status === "needs_input") {
      pendingQuestion = {
        type: "slot_filling",
        question: `${contact.display_name}这条提醒具体要设在哪一天？`,
        field: "remind_at",
        action_id: groundedReminderAction.id,
        options: [],
      };
    }
  }

  if (/(谁|哪个|什么时候|怎么)/.test(text)) {
    actions.push({
      id: generateActionId("query", actions.length),
      kind: "query",
      status: "proposed",
      confidence: 0.6,
      display_text: `查询：${text}`,
      payload: {
        contact_id: contact.id,
        query: text,
      },
    });
    signals.push("查询意图");
  }

  if (actions.length === 0) {
    actions.push({
      id: generateActionId("add_note", actions.length),
      kind: "add_note",
      status: "ready",
      confidence: 0.65,
      display_text: text,
      payload: {
        contact_id: contact.id,
        note: text,
        category: "general_note",
      },
    });
    signals.push("沟通记录");
  }

  return {
    actions,
    pendingQuestion,
    summary: `已识别联系人 ${contact.display_name}，并抽取 ${actions.length} 个候选动作。`,
    signals,
  };
}

function buildFallbackAssistantReply(
  mode: EngineMode,
  contactResolution: ContactResolution,
  actions: ProposedAction[],
  pendingQuestion: PendingQuestion | null,
  selectedActionIds: string[] = [],
) {
  if (mode === "resolve_contact" && contactResolution.status === "ambiguous") {
    return `我找到了多个“${contactResolution.query_name}”，请先确认是哪个联系人：\n${summarizeCandidates(contactResolution.candidates)}`;
  }

  if (mode === "confirm" && contactResolution.status === "resolved" && contactResolution.confirmation_required) {
    const candidate = contactResolution.candidates.find(
      (item) => item.id === contactResolution.selected_contact_id,
    );
    if (candidate) {
      return `我找到一个最像的联系人，请确认是否是 ${candidate.display_name} / ${candidate.name}。\n${buildContactProfileSummary(candidate)}`;
    }
  }

  if (contactResolution.status === "not_found") {
    return `我没有找到“${contactResolution.query_name}”对应的联系人。请补充更完整的姓名、公司或手机号。`;
  }

  if (contactResolution.status === "unresolved") {
    return "我还没识别到你说的是哪位联系人。请补充姓名、称呼或公司。";
  }

  if (pendingQuestion?.type === "action_selection") {
    const list = actions
      .map((action, index) => `${index + 1}. ${action.display_text}`)
      .join("\n");
    return `我已经确认联系人，并识别出以下可执行动作，请直接选择要执行的动作：\n${list}\n你可以多选，也可以直接选“全部”。`;
  }

  if (pendingQuestion) {
    return `我已经识别到 ${actions.length} 个候选动作，但还缺一个关键信息：${pendingQuestion.question}`;
  }

  if (selectedActionIds.length > 0) {
    return `已选择 ${selectedActionIds.length} 个动作，准备直接执行。`;
  }

  return `我已经确认联系人，并整理出 ${actions.length} 个候选动作。`;
}

function createPendingQuestion(
  type: PendingQuestionType,
  question: string,
  overrides: Partial<Omit<PendingQuestion, "type" | "question">> = {},
): PendingQuestion {
  return {
    type,
    question,
    field: overrides.field ?? null,
    action_id: overrides.action_id ?? null,
    options: overrides.options ?? [],
  };
}

function buildResolveContactQuestion(contactResolution: ContactResolution): PendingQuestion {
  if (contactResolution.status === "ambiguous") {
    return createPendingQuestion(
      "contact_resolution",
      "我找到了多个候选联系人，请先确认是哪一位。",
      {
        field: "contact",
        options: contactResolution.candidates.map((candidate) => ({
          label: `${candidate.display_name} / ${candidate.name} / ${candidate.company}`,
          value: candidate.id,
        })),
      },
    );
  }

  if (contactResolution.status === "not_found") {
    return createPendingQuestion("contact_resolution", "请补充联系人姓名、公司或手机号。", {
      field: "contact",
    });
  }

  return createPendingQuestion("contact_resolution", "请告诉我你说的是哪位联系人。", {
    field: "contact",
  });
}

function buildContactConfirmationQuestion(contactResolution: ContactResolution): PendingQuestion {
  return createPendingQuestion("contact_resolution", "请确认联系人是否正确。", {
    options: contactResolution.candidates
      .filter((candidate) => candidate.id === contactResolution.selected_contact_id)
      .map((candidate) => ({
        label: `${candidate.display_name} / ${candidate.name} / ${candidate.company}`,
        value: candidate.id,
      })),
  });
}

function normalizeClarifyQuestion(pendingQuestion: PendingQuestion): PendingQuestion {
  if (pendingQuestion.type === "slot_filling" || pendingQuestion.type === "generic_clarification") {
    return pendingQuestion;
  }

  return createPendingQuestion("generic_clarification", pendingQuestion.question, {
    field: pendingQuestion.field,
    action_id: pendingQuestion.action_id,
    options: pendingQuestion.options,
  });
}

function inferClarifyQuestionFromActions(actions: ProposedAction[]): PendingQuestion | null {
  const needsInputAction = actions.find((action) => action.status === "needs_input");
  if (!needsInputAction) {
    return null;
  }

  if (needsInputAction.kind === "create_task" && typeof needsInputAction.payload.due_at !== "string") {
    return createPendingQuestion("slot_filling", "这个任务具体要哪一天执行？", {
      field: "due_at",
      action_id: needsInputAction.id,
      options: [],
    });
  }

  if (needsInputAction.kind === "create_reminder" && typeof needsInputAction.payload.remind_at !== "string") {
    return createPendingQuestion("slot_filling", "这个提醒具体要设在哪一天？", {
      field: "remind_at",
      action_id: needsInputAction.id,
      options: [],
    });
  }

  return createPendingQuestion("generic_clarification", `还有关键信息未补全：${needsInputAction.display_text}`, {
    action_id: needsInputAction.id,
    options: [],
  });
}

function buildActionSelectionQuestion(actions: ProposedAction[]): PendingQuestion {
  return createPendingQuestion("action_selection", "请选择要执行的动作，可多选，也可以直接选全部。", {
    options: actions.map((action) => ({
      label: action.display_text,
      value: action.id,
    })),
  });
}

function resolveActionStage(
  actions: ProposedAction[],
  plannerPendingQuestion: PendingQuestion | null,
  selectedActionIds: string[],
): { mode: EngineMode; pendingQuestion: PendingQuestion | null } {
  // Step 1B keeps execute reserved in the enum but does not return it from the current prototype.
  const inferredPendingQuestion = plannerPendingQuestion ?? inferClarifyQuestionFromActions(actions);

  if (inferredPendingQuestion) {
    return {
      mode: "clarify",
      pendingQuestion: normalizeClarifyQuestion(inferredPendingQuestion),
    };
  }

  if (selectedActionIds.length > 0) {
    return {
      mode: "answer",
      pendingQuestion: null,
    };
  }

  return {
    mode: "confirm",
    pendingQuestion: buildActionSelectionQuestion(actions),
  };
}

function extractSelectedActionIds(
  text: string,
  actions: ProposedAction[],
): string[] {
  const compact = text.replace(/\s+/g, "");
  if (!compact) {
    return [];
  }

  if (/(全部|全选|都要|都执行|全部执行|全部都要)/.test(compact)) {
    return actions.map((action) => action.id);
  }

  const indexMatches = Array.from(compact.matchAll(/第([一二两三四五六七八九十\d]+)(?:个|项|条|个选项|个动作|项动作|项选项)?/g))
    .map((match) => chineseOrdinalToNumber(match[1]))
    .filter((value): value is number => value != null)
    .map((value) => value - 1)
    .filter((index) => index >= 0 && index < actions.length)
    .map((index) => actions[index].id);

  if (indexMatches.length > 0) {
    return Array.from(new Set(indexMatches));
  }

  const matchedIds = actions
    .filter((action) => {
      const payload = JSON.stringify(action.payload);
      return compact.includes(action.kind) || compact.includes(payload);
    })
    .map((action) => action.id);

  return Array.from(new Set(matchedIds));
}

function applySlotFillingAnswer(
  actions: ProposedAction[],
  pendingQuestion: PendingQuestion | null | undefined,
  answerText: string,
  now: string,
): { actions: ProposedAction[]; resolved: boolean; pendingQuestion: PendingQuestion | null } {
  if (!pendingQuestion || pendingQuestion.type !== "slot_filling" || !pendingQuestion.field) {
    return {
      actions,
      resolved: false,
      pendingQuestion: pendingQuestion ?? null,
    };
  }

  const normalizedValue = parseDueTime(answerText, now);
  if (!normalizedValue) {
    return {
      actions,
      resolved: false,
      pendingQuestion,
    };
  }

  const updatedActions = actions.map((action) => {
    if (pendingQuestion.action_id && action.id !== pendingQuestion.action_id) {
      return action;
    }

    if (pendingQuestion.field === "due_at") {
      return {
        ...action,
        status: "ready" as const,
        payload: {
          ...action.payload,
          due_at: normalizedValue,
        },
      };
    }

    if (pendingQuestion.field === "remind_at") {
      return {
        ...action,
        status: "ready" as const,
        payload: {
          ...action.payload,
          remind_at: normalizedValue,
        },
      };
    }

    return action;
  });

  return {
    actions: updatedActions,
    resolved: true,
    pendingQuestion: null,
  };
}

export class QueryEngineService {
  private readonly contactResolver = new ContactResolverService();
  private readonly repository = new CustomerRepository();
  private readonly contactIntroGenerator = new ContactIntroGenerator();
  private readonly actionPlanner = new EngineActionPlanner();
  private readonly understandingService = new EngineUnderstandingService();
  private readonly queryExecutor = new QueryExecutorService();
  private readonly replyComposer = new EngineReplyComposer();
  private readonly actionExecutor = new ActionExecutorService();

  private async planActions(
    text: string,
    now: string,
    contact: ContactCandidate,
    groundedConcepts: GroundedConcept[] = [],
  ): Promise<PlannedActionResult> {
    const llmResult = await this.actionPlanner.plan(text, now, contact, groundedConcepts);
    if (llmResult) {
      return llmResult;
    }

    const fallback = buildProposedActions(text, now, contact, groundedConcepts);
    return {
      actions: fallback.actions,
      pendingQuestion: fallback.pendingQuestion,
      summary: fallback.summary,
      signals: fallback.signals,
      planningSource: "fallback_rules",
    };
  }

  private buildCarryForwardActionResult(
    actions: ProposedAction[],
    summary: string,
    planningSource: PlannedActionResult["planningSource"],
  ): PlannedActionResult {
    return {
      actions,
      pendingQuestion: null,
      summary,
      signals: [],
      planningSource,
    };
  }

  async respond(input: EngineRespondRequest): Promise<EngineResponse> {
    const requestContext = deriveRequestContext(input);
    const sessionId = input.session_id ?? input.session_state?.session_id ?? generateSessionId();
    const rawInput = requestContext.rawInput;
    const previousResolution = requestContext.previousResolution;
    const previousDraftPlan = requestContext.previousDraftPlan;
    const understandingResult = await this.understandingService.understand({
      inputText: input.input_text,
      now: input.now,
      previousPendingQuestion: requestContext.previousPendingQuestion,
      previousConfirmedContactId: requestContext.previousConfirmedContactId,
    });
    let understanding = understandingResult.understanding;
    let debug = understandingResult.debug;
    let requestUnderstanding = understanding;
    const entityClues = understanding.contact_hints;

    const recentConfirmedContact = requestContext.previousConfirmedContactId
      ? this.repository.getContactWithDetailsById(requestContext.previousConfirmedContactId)
      : null;

    let contactResolution: ContactResolution;

    if (
      requestContext.isContinuationAnswer &&
      isAnswerToPending(understanding) &&
      requestContext.previousPendingQuestion?.type === "contact_resolution" &&
      previousResolution?.status === "ambiguous"
    ) {
      contactResolution = this.contactResolver.resolveSelection(
        previousResolution,
        input.selected_contact_id,
        input.input_text,
      );
    } else if (
      requestContext.isContinuationAnswer &&
      previousResolution?.status === "resolved" &&
      previousResolution.confirmed_contact_id
    ) {
      contactResolution = previousResolution;
    } else if (
      requestContext.isContinuationAnswer &&
      previousResolution?.status === "resolved" &&
      previousResolution.confirmation_required
    ) {
      const confirmed =
        input.selected_contact_id === previousResolution.selected_contact_id ||
        isConfirmationInput(input.input_text);

      contactResolution = confirmed
        ? {
            ...previousResolution,
            confirmation_required: false,
            confirmed_contact_id: previousResolution.selected_contact_id,
          }
        : previousResolution;
    } else if (
      previousResolution?.confirmed_contact_id &&
      recentConfirmedContact &&
      (
        !hasAnyEntityClues(understanding) ||
        isCompatibleWithRecentContact(understanding, recentConfirmedContact)
      )
    ) {
      contactResolution = hasAnyEntityClues(understanding)
        ? buildInheritedContactResolution(recentConfirmedContact, understanding.extracted_contact_name)
        : buildCarriedContactResolution(previousResolution);
    } else if (!hasAnyEntityClues(understanding) && previousResolution?.confirmed_contact_id) {
      contactResolution = buildCarriedContactResolution(previousResolution);
    } else {
      contactResolution = this.contactResolver.resolveFromClues(input.input_text, entityClues);
    }

    let mode: EngineMode = "resolve_contact";
    let proposedActions: ProposedAction[] = [];
    let pendingQuestion: PendingQuestion | null = null;
    let executionResult = buildNotRunExecutionResult();
    let selectedActionIds: string[] = requestContext.isContinuationAnswer
      ? (input.selected_action_ids ?? previousDraftPlan?.selected_action_ids ?? [])
      : [];
    let actionsConfirmed = requestContext.isContinuationAnswer ? (previousDraftPlan?.actions_confirmed ?? false) : false;
    understanding = updateUnderstanding(understanding, {
      extracted_contact_name: contactResolution.query_name ?? understanding.extracted_contact_name,
      entity_clues: entityClues,
      contact_hints: entityClues,
      summary: understanding.summary || "等待联系人确认。",
    });

    if (
      contactResolution.status === "resolved" &&
      contactResolution.selected_contact_id &&
      contactResolution.confirmation_required
    ) {
      const selected = this.repository.getContactWithDetailsById(contactResolution.selected_contact_id);
      if (selected) {
        const intro = await this.contactIntroGenerator.generate(selected);
        contactResolution = {
          ...contactResolution,
          candidates: contactResolution.candidates.map((candidate) =>
            candidate.id === selected.id
              ? {
                  ...candidate,
                  profile_summary: intro,
                }
              : candidate,
          ),
        };
      }
      mode = "confirm";
      pendingQuestion = buildContactConfirmationQuestion(contactResolution);
      understanding = updateUnderstanding(understanding, {
        requires_contact_resolution: true,
        needs_clarification: false,
        clarification_focus: "contact",
        summary: "已命中一个高概率联系人，等待用户确认。",
        extracted_contact_name: contactResolution.query_name,
        signals: Array.from(new Set([...understanding.signals, "contact_confirmation_required"])),
      });
    } else if (
      contactResolution.status === "resolved" &&
      contactResolution.confirmed_contact_id
    ) {
      const selected = this.repository.getContactWithDetailsById(contactResolution.confirmed_contact_id);
      if (!selected) {
        contactResolution = {
          ...contactResolution,
          status: "not_found",
          selected_contact_id: null,
          confirmed_contact_id: null,
          confirmation_required: false,
        };
      } else {
        const candidate: ContactCandidate = {
          id: selected.id,
          name: selected.name,
          display_name: selected.display_name,
          company: selected.basics?.company ?? selected.company,
          phone: selected.phone,
          customer_id: selected.customer_id,
          score: null,
          matched_fields: [],
          profile_summary: [
            selected.basics?.industry ? `${selected.basics.company}，${selected.basics.industry}` : selected.basics?.company ?? selected.company,
            selected.profile?.title ? `职位是${selected.profile.title}` : null,
            selected.basics?.acquisition_channel ? `最初通过${selected.basics.acquisition_channel}认识` : null,
            selected.profile?.preferences?.length ? `已知偏好：${selected.profile.preferences.slice(0, 2).join("、")}` : null,
          ].filter(Boolean).join("；"),
        };
        if (
          requestContext.isContinuationAnswer &&
          isAnswerToPending(understanding) &&
          rawInput !== input.input_text
        ) {
          const requestUnderstandingResult = await this.understandingService.understand({
            inputText: rawInput,
            now: input.now,
            previousConfirmedContactId: contactResolution.confirmed_contact_id,
          });
          requestUnderstanding = requestUnderstandingResult.understanding;
          debug = requestUnderstandingResult.debug;
        }

        if (shouldEnterQueryBranch(requestUnderstanding)) {
          const queryResult = this.queryExecutor.execute(rawInput, selected);
          mode = "answer";
          pendingQuestion = null;
          proposedActions = [];
          selectedActionIds = [];
          actionsConfirmed = false;
          understanding = updateUnderstanding(requestUnderstanding, {
            requires_contact_resolution: false,
            needs_clarification: false,
            clarification_focus: null,
            summary: queryResult.summary,
            extracted_contact_name: contactResolution.query_name,
            contact_hints: entityClues,
            entity_clues: entityClues,
            signals: Array.from(new Set([...requestUnderstanding.signals, ...queryResult.signals])),
          });

          const sessionState: SessionState = {
            session_id: sessionId,
            raw_user_input: rawInput,
            contact_resolution: contactResolution,
            draft_plan: {
              summary: understanding.summary,
              proposed_actions: [],
              selected_action_ids: [],
              actions_confirmed: false,
            },
            pending_question: null,
          };

          return {
            mode,
            session_state: sessionState,
            contact_resolution: contactResolution,
            understanding,
            proposed_actions: [],
            pending_question: null,
            execution_result: executionResult,
            assistant_reply: queryResult.answer,
            debug,
          };
        }
        const previousPendingType = requestContext.previousPendingQuestion?.type ?? null;
        const shouldCarryForwardDraftPlan =
          requestContext.isContinuationAnswer &&
          !!previousDraftPlan?.proposed_actions?.length &&
          (
            previousPendingType === "action_selection" ||
            previousPendingType === "slot_filling"
          );

        let actionResult = shouldCarryForwardDraftPlan
          ? this.buildCarryForwardActionResult(
              previousDraftPlan.proposed_actions,
              previousDraftPlan.summary || "沿用上一轮动作草案，等待继续处理。",
              understanding.planning_source === "llm" ? "llm" : "fallback_rules",
            )
          : await this.planActions(rawInput, input.now, candidate, requestUnderstanding.grounded_concepts);
        proposedActions = actionResult.actions;
        if (
          requestContext.isContinuationAnswer &&
          isAnswerToPending(understanding) &&
          requestContext.previousPendingQuestion?.type === "slot_filling" &&
          previousDraftPlan?.proposed_actions?.length
        ) {
          const applied = applySlotFillingAnswer(
            previousDraftPlan.proposed_actions,
            requestContext.previousPendingQuestion,
            input.input_text,
            input.now,
          );
          if (applied.resolved) {
            proposedActions = applied.actions;
            actionResult = {
              ...actionResult,
              actions: applied.actions,
              pendingQuestion: null,
              summary: `已补齐 ${requestContext.previousPendingQuestion.field}，等待你选择要继续的动作。`,
              signals: [...actionResult.signals, `slot_filled:${requestContext.previousPendingQuestion.field}`],
            };
          }
        }
        selectedActionIds = requestContext.isContinuationAnswer
          ? (input.selected_action_ids ?? extractSelectedActionIds(input.input_text, proposedActions))
          : [];
        const hasSelectedActions = selectedActionIds.length > 0;
        const actionStage = resolveActionStage(
          proposedActions,
          actionResult.pendingQuestion,
          selectedActionIds,
        );
        actionsConfirmed = hasSelectedActions && actionStage.mode === "answer";
        mode = actionStage.mode;
        pendingQuestion = actionStage.pendingQuestion;
        const shouldRunExecution =
          actionStage.mode === "answer" &&
          hasSelectedActions &&
          !previousDraftPlan?.actions_confirmed;
        if (shouldRunExecution) {
          const actionsToExecute = proposedActions.filter((action) => selectedActionIds.includes(action.id));
          executionResult = this.actionExecutor.execute(actionsToExecute);
        }
        understanding = updateUnderstanding(understanding, {
          requires_contact_resolution: false,
          needs_clarification: actionStage.mode === "clarify",
          clarification_focus: actionStage.pendingQuestion?.field ?? actionStage.pendingQuestion?.type ?? null,
          summary: actionResult.summary,
          extracted_contact_name: contactResolution.query_name,
          signals: Array.from(new Set([...understanding.signals, ...actionResult.signals])),
          planning_source: actionResult.planningSource,
        });
      }
    } else if (contactResolution.status === "ambiguous") {
      mode = "resolve_contact";
      pendingQuestion = buildResolveContactQuestion(contactResolution);
      understanding = updateUnderstanding(understanding, {
        requires_contact_resolution: true,
        needs_clarification: true,
        clarification_focus: "contact",
        summary: "联系人存在多个候选，等待用户确认。",
        extracted_contact_name: contactResolution.query_name,
        signals: Array.from(new Set([...understanding.signals, "contact_ambiguity"])),
      });
    } else if (contactResolution.status === "not_found") {
      mode = "resolve_contact";
      pendingQuestion = buildResolveContactQuestion(contactResolution);
      understanding = updateUnderstanding(understanding, {
        requires_contact_resolution: true,
        needs_clarification: true,
        clarification_focus: "contact",
        summary: "未找到联系人，需要补充身份信息。",
        extracted_contact_name: contactResolution.query_name,
        signals: Array.from(new Set([...understanding.signals, "contact_not_found"])),
      });
    } else {
      mode = "resolve_contact";
      pendingQuestion = buildResolveContactQuestion(contactResolution);
      understanding = updateUnderstanding(understanding, {
        requires_contact_resolution: true,
        needs_clarification: true,
        clarification_focus: "contact",
        summary: "未识别到联系人，需要先确认对象。",
        extracted_contact_name: null,
        signals: Array.from(new Set([...understanding.signals, "contact_missing"])),
      });
    }

    const sessionState: SessionState = {
      session_id: sessionId,
      raw_user_input: rawInput,
      contact_resolution: contactResolution,
      draft_plan: {
        summary: understanding.summary,
        proposed_actions: proposedActions,
        selected_action_ids: selectedActionIds,
        actions_confirmed: actionsConfirmed,
      },
      pending_question: pendingQuestion,
    };

    const fallbackReply = buildFallbackAssistantReply(
      mode,
      contactResolution,
      proposedActions,
      pendingQuestion,
      selectedActionIds,
    );
    const replyFallback =
      mode === "answer" && executionResult.status !== "not_run"
        ? buildExecutionAssistantReply(executionResult)
        : fallbackReply;

    const assistantReply = await this.replyComposer.compose({
      mode,
      contactResolution,
      actions: proposedActions,
      pendingQuestion,
      selectedActionIds,
      actionsConfirmed,
      executionResult,
      fallbackReply: replyFallback,
    });

    return {
      mode,
      session_state: sessionState,
      contact_resolution: contactResolution,
      understanding,
      proposed_actions: proposedActions,
      pending_question: pendingQuestion,
      execution_result: executionResult,
      assistant_reply: assistantReply,
      debug,
    };
  }
}
