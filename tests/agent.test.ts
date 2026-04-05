import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { CustomerRepository } from "../src/repositories/customer-repository";
import { ActionExecutorService } from "../src/services/action-executor";

process.env.DATABASE_URL = ":memory:";
process.env.OPENAI_API_KEY = "";

let app: ReturnType<typeof request>;
let repository: CustomerRepository;

function buildConfirmedSessionState(actions: Array<Record<string, unknown>>) {
  return {
    session_id: `sess_test_${Date.now()}`,
    raw_user_input: "原始输入",
    contact_resolution: {
      status: "resolved",
      query_name: "王总",
      candidates: [],
      selected_contact_id: "ct_003",
      confirmed_contact_id: "ct_003",
      confirmation_required: false,
    },
    draft_plan: {
      summary: "测试动作草案",
      proposed_actions: actions,
      selected_action_ids: [],
      actions_confirmed: false,
    },
    pending_question: {
      type: "action_selection",
      question: "请选择要执行的动作，可多选，也可以直接选全部。",
      field: null,
      action_id: null,
      options: [],
    },
  };
}

function buildConfirmedContactSessionState(contactId = "ct_003", queryName = "王总") {
  return {
    session_id: `sess_contact_${Date.now()}`,
    raw_user_input: "上一轮输入",
    contact_resolution: {
      status: "resolved",
      query_name: queryName,
      candidates: [],
      selected_contact_id: contactId,
      confirmed_contact_id: contactId,
      confirmation_required: false,
    },
    draft_plan: {
      summary: null,
      proposed_actions: [],
      selected_action_ids: [],
      actions_confirmed: false,
    },
    pending_question: null,
  };
}

beforeAll(async () => {
  const { createApp } = await import("../src/app");
  app = request(createApp());
  repository = new CustomerRepository();
});

const basePayload = {
  now: "2026-03-31T10:00:00+08:00",
  customer: {
    id: "c_001",
    name: "张老板",
  },
  open_tasks: [
    {
      id: "t_101",
      title: "发送报价",
      task_type: "send_quote",
      status: "open",
      due_at: "2026-04-02T18:00:00+08:00",
      note: null,
    },
    {
      id: "t_102",
      title: "催收首付款",
      task_type: "collect_payment",
      status: "open",
      due_at: null,
      note: null,
    },
  ],
};

describe("POST /agent/parse-task-intent", () => {
  it("creates a new task from a deadline request", async () => {
    const response = await app.post("/agent/parse-task-intent").send({
      ...basePayload,
      input_text: "2月10日前必须把报价给到张老板",
    });

    expect(response.status).toBe(200);
    expect(response.body.intent).toBe("create");
    expect(response.body.new_task.task_type).toBe("send_quote");
    expect(response.body.new_task.due_at).toBe("2027-02-10T23:59:59+08:00");
  });

  it("completes payment collection when customer has paid", async () => {
    const response = await app.post("/agent/parse-task-intent").send({
      ...basePayload,
      input_text: "张老板已经付款了",
    });

    expect(response.status).toBe(200);
    expect(response.body.intent).toBe("complete");
    expect(response.body.target_task_id).toBe("t_102");
    expect(response.body.changes.status).toBe("done");
  });

  it("updates due date for an existing quote task", async () => {
    const response = await app.post("/agent/parse-task-intent").send({
      ...basePayload,
      input_text: "把报价时间改到下周三",
    });

    expect(response.status).toBe(200);
    expect(response.body.intent).toBe("update");
    expect(response.body.target_task_id).toBe("t_101");
    expect(response.body.changes.due_at).toBe("2026-04-08T23:59:59+08:00");
  });

  it("asks for clarification when a pronoun cannot be safely resolved", async () => {
    const response = await app.post("/agent/parse-task-intent").send({
      ...basePayload,
      input_text: "这条先不用做了",
    });

    expect(response.status).toBe(200);
    expect(response.body.intent).toBe("cancel");
    expect(response.body.needs_clarification).toBe(true);
    expect(response.body.clarification_question).toBe("你指的是哪条待办？");
    expect(response.body.target_task_id).toBeNull();
  });

  it("keeps conversation notes as noop_or_note", async () => {
    const response = await app.post("/agent/parse-task-intent").send({
      ...basePayload,
      input_text: "他最近对价格比较敏感",
    });

    expect(response.status).toBe(200);
    expect(response.body.intent).toBe("noop_or_note");
    expect(response.body.target_task_id).toBeNull();
    expect(response.body.changes.note).toBe("他最近对价格比较敏感");
    expect(response.body.conversation_insight.note_type).toBe("price_sensitivity");
    expect(response.body.conversation_insight.summary).toBe("客户对价格较敏感");
  });

  it("extracts customer preference from open-ended notes", async () => {
    const response = await app.post("/agent/parse-task-intent").send({
      ...basePayload,
      input_text: "今天和张老板聊天，发现他喜欢红酒",
    });

    expect(response.status).toBe(200);
    expect(response.body.intent).toBe("noop_or_note");
    expect(response.body.conversation_insight.note_type).toBe("customer_preference");
    expect(response.body.conversation_insight.structured_slots.preference_item).toBe("红酒");
  });

  it("extracts relationship info from personal facts", async () => {
    const response = await app.post("/agent/parse-task-intent").send({
      ...basePayload,
      input_text: "张老板生日是24号",
    });

    expect(response.status).toBe(200);
    expect(response.body.intent).toBe("noop_or_note");
    expect(response.body.conversation_insight.note_type).toBe("relationship_info");
    expect(response.body.conversation_insight.structured_slots.important_date).toBe("24号");
  });
});

describe("auxiliary routes", () => {
  it("reports fallback provider status when no key is configured", async () => {
    const response = await app.get("/agent/provider-status");

    expect(response.status).toBe(200);
    expect(response.body.provider).toBe("fallback_rules");
    expect(response.body.model).toBeNull();
  });

  it("serves the playground page", async () => {
    const response = await app.get("/playground");

    expect(response.status).toBe(200);
    expect(response.text).toContain("CRM 待办意图识别");
    expect(response.text).toContain("解析输入");
  });

  it("serves the engine playground page", async () => {
    const response = await app.get("/engine-playground");

    expect(response.status).toBe(200);
    expect(response.text).toContain("CRM Query Engine");
    expect(response.text).toContain("/engine/respond");
  });

  it("returns seeded customer context from database", async () => {
    const response = await app.get("/customers/c_001/context");

    expect(response.status).toBe(200);
    expect(response.body.customer.name).toBe("张老板");
    expect(response.body.contacts).toHaveLength(1);
    expect(response.body.contacts[0].display_name).toBe("张总");
    expect(response.body.contacts[0].basics.company).toBe("ABC贸易");
    expect(response.body.contacts[0].basics.acquisition_channel).toBe("展会认识");
    expect(response.body.contacts[0].methods.length).toBeGreaterThanOrEqual(2);
    expect(response.body.contacts[0].methods[0].is_primary).toBe(true);
    expect(response.body.contacts[0].profile.title).toBe("总经理");
    expect(response.body.contacts[0].profile.preferences).toContain("喜欢红酒");
    expect(response.body.open_tasks).toHaveLength(2);
  });

  it("parses intent using database-backed customer context and persists notes", async () => {
    const parseResponse = await app.post("/customers/c_001/parse-task-intent").send({
      now: "2026-03-31T10:00:00+08:00",
      input_text: "今天和张老板聊天，发现他喜欢红酒",
      persist_note: true,
    });

    expect(parseResponse.status).toBe(200);
    expect(parseResponse.body.intent).toBe("noop_or_note");
    expect(parseResponse.body.conversation_insight.note_type).toBe("customer_preference");
    expect(parseResponse.body.saved_note_id).toMatch(/^n_/);

    const contextResponse = await app.get("/customers/c_001/context");
    expect(contextResponse.body.notes[0].summary).toBe("客户偏好红酒");
  });
});

describe("POST /engine/respond", () => {
  it("grounds PSLE as a family education milestone and enriches understanding", async () => {
    const response = await app.post("/engine/respond").send({
      now: "2026-04-05T10:00:00+08:00",
      input_text: "今天和王总聊了10分钟，他女儿下周 psle",
    });

    expect(response.status).toBe(200);
    expect(response.body.understanding.grounded_concepts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          normalized: "PSLE",
          concept_type: "education_exam",
          crm_semantic_hint: "family_milestone_event",
        }),
      ]),
    );
    expect(response.body.understanding.semantic_facets.has_note).toBe(true);
    expect(response.body.understanding.semantic_facets.has_reminder).toBe(true);
    expect(response.body.understanding.primary_interaction_type).toBe("mixed");
  });

  it("grounds 小六汇考 as PSLE instead of treating it as an unrelated phrase", async () => {
    const response = await app.post("/engine/respond").send({
      now: "2026-04-05T10:00:00+08:00",
      input_text: "今天和王总聊了10分钟，他女儿下周小六汇考",
    });

    expect(response.status).toBe(200);
    expect(response.body.understanding.grounded_concepts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          raw: expect.stringMatching(/小六汇考/),
          normalized: "PSLE",
          concept_type: "education_exam",
          crm_semantic_hint: "family_milestone_event",
        }),
      ]),
    );
    expect(response.body.understanding.semantic_facets.has_note).toBe(true);
    expect(response.body.understanding.semantic_facets.has_reminder).toBe(true);
  });

  it("builds executable grounded note actions for PSLE family events and writes them after selection", async () => {
    const beforeNotes = repository.listNotesByCustomerId("c_003").length;

    const first = await app.post("/engine/respond").send({
      now: "2026-04-05T10:00:00+08:00",
      input_text: "今天和王总聊了10分钟，他对我们的报价很感兴趣，他女儿下个月 PSLE。",
    });

    const second = await app.post("/engine/respond").send({
      now: "2026-04-05T10:00:00+08:00",
      input_text: "是的",
      session_state: first.body.session_state,
      selected_contact_id: first.body.contact_resolution.selected_contact_id,
    });

    expect(second.status).toBe(200);
    expect(second.body.mode).toBe("confirm");
    expect(second.body.pending_question.type).toBe("action_selection");
    expect(second.body.proposed_actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "add_note",
          payload: expect.objectContaining({
            note: expect.stringContaining("PSLE"),
          }),
        }),
      ]),
    );

    const third = await app.post("/engine/respond").send({
      now: "2026-04-05T10:00:00+08:00",
      input_text: "全选当前动作",
      session_state: second.body.session_state,
      selected_action_ids: second.body.proposed_actions.map((action: { id: string }) => action.id),
    });

    expect(third.status).toBe(200);
    expect(third.body.mode).toBe("answer");
    expect(third.body.execution_result.status).toBe("success");
    expect(third.body.execution_result.executed_actions).toHaveLength(2);
    expect(third.body.execution_result.executed_actions.every((item: { kind: string }) => item.kind === "add_note")).toBe(true);

    const afterNotes = repository.listNotesByCustomerId("c_003");
    expect(afterNotes.length).toBe(beforeNotes + 2);
    expect(afterNotes.some((note) => note.raw_text.includes("PSLE"))).toBe(true);
    expect(afterNotes.some((note) => note.raw_text.includes("报价"))).toBe(true);
  });

  it("grounds O Level with confirmed contact context on a new request", async () => {
    const response = await app.post("/engine/respond").send({
      now: "2026-04-05T10:00:00+08:00",
      input_text: "她儿子明年 O level",
      session_state: buildConfirmedContactSessionState(),
    });

    expect(response.status).toBe(200);
    expect(response.body.contact_resolution.confirmed_contact_id).toBe("ct_003");
    expect(response.body.understanding.grounded_concepts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          normalized: "O Level",
          concept_type: "education_exam",
          crm_semantic_hint: "family_milestone_event",
        }),
      ]),
    );
    expect(response.body.understanding.semantic_facets.has_note).toBe(true);
    expect(response.body.understanding.semantic_facets.has_reminder).toBe(true);
  });

  it("grounds NS as a family life-stage event", async () => {
    const response = await app.post("/engine/respond").send({
      now: "2026-04-05T10:00:00+08:00",
      input_text: "他儿子明年 NS",
      session_state: buildConfirmedContactSessionState(),
    });

    expect(response.status).toBe(200);
    expect(response.body.understanding.grounded_concepts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          normalized: "NS",
          concept_type: "national_service",
          crm_semantic_hint: "family_life_stage_event",
        }),
      ]),
    );
    expect(response.body.understanding.semantic_facets.has_note).toBe(true);
    expect(response.body.understanding.semantic_facets.has_reminder).toBe(true);
  });

  it("grounds Hari Raya as a relationship-maintenance holiday cue", async () => {
    const response = await app.post("/engine/respond").send({
      now: "2026-04-05T10:00:00+08:00",
      input_text: "Hari Raya 前提醒我问候一下",
      session_state: buildConfirmedContactSessionState("ct_002", "张总"),
    });

    expect(response.status).toBe(200);
    expect(response.body.understanding.grounded_concepts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          normalized: "Hari Raya",
          concept_type: "cultural_holiday",
          crm_semantic_hint: "relationship_maintenance_holiday",
        }),
      ]),
    );
    expect(response.body.understanding.semantic_facets.has_reminder).toBe(true);
    expect(response.body.understanding.action_intent).toBe("follow_up");
  });

  it("asks to resolve contact when no contact clue is detected", async () => {
    const response = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "下周发一下报价。",
    });

    expect(response.status).toBe(200);
    expect(response.body.mode).toBe("resolve_contact");
    expect(response.body.contact_resolution.status).toBe("unresolved");
    expect(response.body.pending_question.type).toBe("contact_resolution");
    expect(response.body.understanding.primary_interaction_type).toBe("mixed");
    expect(response.body.understanding.semantic_facets.has_task).toBe(true);
    expect(response.body.understanding.semantic_facets.has_reminder).toBe(true);
    expect(response.body.understanding.source).toBe("fallback_rules");
    expect(response.body.session_state.draft_plan.selected_action_ids).toEqual([]);
    expect(response.body.session_state.draft_plan.actions_confirmed).toBe(false);
  });

  it("returns ambiguous contact candidates when multiple matches exist", async () => {
    const response = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "今天和张总聊了10分钟，他对我们的报价很感兴趣，下周要把产品demo发给他。",
    });

    expect(response.status).toBe(200);
    expect(response.body.mode).toBe("resolve_contact");
    expect(response.body.contact_resolution.status).toBe("ambiguous");
    expect(response.body.contact_resolution.candidates).toHaveLength(3);
    expect(response.body.pending_question.type).toBe("contact_resolution");
  });

  it("resolves a unique contact and returns multiple proposed actions", async () => {
    const response = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "今天和王总聊了10分钟，他对我们的报价很感兴趣，下周三要把产品demo发给他。还聊到他女儿下个月24号过生日。",
    });

    expect(response.status).toBe(200);
    expect(response.body.mode).toBe("confirm");
    expect(response.body.contact_resolution.status).toBe("resolved");
    expect(response.body.contact_resolution.selected_contact_id).toBe("ct_003");
    expect(response.body.contact_resolution.confirmation_required).toBe(true);
    expect(response.body.proposed_actions).toHaveLength(0);
    expect(response.body.pending_question.type).toBe("contact_resolution");
    expect(response.body.pending_question.question).toContain("联系人");
  });

  it("uses company clues to resolve 新海的张总 to 张建国", async () => {
    const response = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "今天和新海的张总聊了10分钟，他对我们的报价很感兴趣，下周三要把产品demo发给他。",
    });

    expect(response.status).toBe(200);
    expect(response.body.contact_resolution.status).toBe("resolved");
    expect(response.body.contact_resolution.selected_contact_id).toBe("ct_002");
    expect(response.body.contact_resolution.confirmation_required).toBe(true);
    expect(response.body.understanding.entity_clues.company).toBe("新海");
    expect(response.body.contact_resolution.candidates[0].matched_fields).toContain("company_partial");
  });

  it("uses company clues to resolve 新海张总 to 张建国", async () => {
    const response = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "新海张总对报价很感兴趣。",
    });

    expect(response.status).toBe(200);
    expect(response.body.contact_resolution.status).toBe("resolved");
    expect(response.body.contact_resolution.selected_contact_id).toBe("ct_002");
    expect(response.body.understanding.source).toBe("fallback_rules");
    expect(response.body.understanding.entity_clues.company).toBe("新海");
  });

  it("uses company clues to resolve 新海科技张总 to 张建国", async () => {
    const response = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "新海科技张总对报价很感兴趣。",
    });

    expect(response.status).toBe(200);
    expect(response.body.contact_resolution.status).toBe("resolved");
    expect(response.body.contact_resolution.selected_contact_id).toBe("ct_002");
    expect(response.body.understanding.entity_clues.company).toBe("新海科技");
  });

  it("uses company clues to resolve 今天和新海张总聊了10分钟 to 张建国", async () => {
    const response = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "今天和新海张总聊了10分钟。",
    });

    expect(response.status).toBe(200);
    expect(response.body.contact_resolution.status).toBe("resolved");
    expect(response.body.contact_resolution.selected_contact_id).toBe("ct_002");
    expect(response.body.understanding.entity_clues.company).toBe("新海");
  });

  it("uses contact method clues to resolve by phone number", async () => {
    const response = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "13800000004 这个联系人今天沟通过，月底提醒我再跟进。",
    });

    expect(response.status).toBe(200);
    expect(response.body.contact_resolution.status).toBe("resolved");
    expect(response.body.contact_resolution.selected_contact_id).toBe("ct_004");
    expect(response.body.contact_resolution.confirmation_required).toBe(true);
    expect(response.body.understanding.entity_clues.phone).toBe("13800000004");
  });

  it("asks a follow-up question when action timing is not specific enough", async () => {
    const first = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "今天和王总聊了10分钟，他对我们的报价很感兴趣，下周要把产品demo发给他。",
    });

    const response = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "是的",
      session_state: first.body.session_state,
      selected_contact_id: first.body.contact_resolution.selected_contact_id,
    });

    expect(response.status).toBe(200);
    expect(response.body.mode).toBe("clarify");
    expect(response.body.pending_question.type).toBe("slot_filling");
    expect(response.body.pending_question.question).toContain("demo");
    expect(response.body.understanding.planning_source).toBe("fallback_rules");
    expect(response.body.session_state.raw_user_input).toBe("今天和王总聊了10分钟，他对我们的报价很感兴趣，下周要把产品demo发给他。");
    const demoAction = response.body.proposed_actions.find((action: { kind: string }) => action.kind === "create_task");
    expect(demoAction.status).toBe("needs_input");
  });

  it("applies slot filling answer and advances to action selection", async () => {
    const first = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "今天和王总聊了10分钟，他对我们的报价很感兴趣，下周要把产品demo发给他。",
    });

    const second = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "是的",
      session_state: first.body.session_state,
      selected_contact_id: first.body.contact_resolution.selected_contact_id,
    });

    expect(second.status).toBe(200);
    expect(second.body.mode).toBe("clarify");
    expect(second.body.pending_question.type).toBe("slot_filling");

    const third = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "下周二",
      session_state: second.body.session_state,
    });

    expect(third.status).toBe(200);
    expect(third.body.mode).toBe("confirm");
    expect(third.body.session_state.raw_user_input).toBe("今天和王总聊了10分钟，他对我们的报价很感兴趣，下周要把产品demo发给他。");
    expect(third.body.pending_question.type).toBe("action_selection");
    const demoAction = third.body.proposed_actions.find((action: { kind: string }) => action.kind === "create_task");
    expect(demoAction.status).toBe("ready");
    expect(demoAction.payload.due_at).toContain("2026-04-07");
  });

  it("executes selected actions directly after slot filling completes", async () => {
    const first = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "今天和王总聊了10分钟，他对我们的报价很感兴趣，下周要把产品demo发给他。还聊到他女儿下个月24号过生日。",
    });

    const second = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "是的",
      session_state: first.body.session_state,
      selected_contact_id: first.body.contact_resolution.selected_contact_id,
    });

    const third = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "第1个和第2个",
      session_state: second.body.session_state,
    });

    expect(third.status).toBe(200);
    expect(third.body.mode).toBe("clarify");

    const fourth = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "下周二",
      session_state: third.body.session_state,
      selected_action_ids: third.body.session_state.draft_plan.selected_action_ids,
    });

    expect(fourth.status).toBe(200);
    expect(fourth.body.mode).toBe("answer");
    expect(fourth.body.pending_question).toBeNull();
    expect(fourth.body.execution_result.status).toBe("success");
    expect(fourth.body.assistant_reply).toContain("已记录");
    expect(fourth.body.assistant_reply).not.toContain("还缺一个关键信息");
  });

  it("keeps filled due_at when user selects actions after clarify", async () => {
    const first = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "今天和张总聊了10分钟，他对我们的报价很感兴趣，下周要把产品demo发给他。还聊到他女儿下个月24号过生日。",
    });

    const second = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "新海科技那位",
      session_state: first.body.session_state,
    });

    expect(second.body.mode).toBe("clarify");
    expect(second.body.pending_question.type).toBe("slot_filling");

    const third = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "下周二",
      session_state: second.body.session_state,
    });

    expect(third.body.mode).toBe("confirm");
    expect(third.body.pending_question.type).toBe("action_selection");
    const thirdTask = third.body.proposed_actions.find((action: { kind: string }) => action.kind === "create_task");
    expect(thirdTask.payload.due_at).toContain("2026-04-07");

    const fourth = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "第1个、第2个和第3个",
      session_state: third.body.session_state,
    });

    expect(fourth.body.mode).toBe("answer");
    expect(fourth.body.pending_question).toBeNull();
    const fourthTask = fourth.body.proposed_actions.find((action: { kind: string }) => action.kind === "create_task");
    expect(fourthTask.status).toBe("ready");
    expect(fourthTask.payload.due_at).toContain("2026-04-07");
    expect(fourth.body.assistant_reply).not.toContain("具体要安排在哪一天");
  });

  it("asks for more contact info when contact is not found", async () => {
    const response = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "今天和赵总聊过了，下周发合同。",
    });

    expect(response.status).toBe(200);
    expect(response.body.mode).toBe("resolve_contact");
    expect(response.body.contact_resolution.status).toBe("not_found");
    expect(response.body.pending_question.type).toBe("contact_resolution");
    expect(response.body.pending_question.question).toContain("联系人");
  });

  it("resolves ambiguous birthday query before answering", async () => {
    const first = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "张总女儿生日是什么时候？",
    });

    expect(first.status).toBe(200);
    expect(first.body.mode).toBe("resolve_contact");
    expect(first.body.pending_question.type).toBe("contact_resolution");
    expect(first.body.contact_resolution.status).toBe("ambiguous");
    expect(first.body.understanding.primary_interaction_type).toBe("query");
    expect(first.body.understanding.semantic_facets.has_query).toBe(true);
    expect(first.body.understanding.query_intent).toBe("relationship_birthday");

    const second = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "ABC贸易那位",
      session_state: first.body.session_state,
    });

    expect(second.status).toBe(200);
    expect(second.body.mode).toBe("answer");
    expect(second.body.pending_question).toBeNull();
    expect(second.body.contact_resolution.confirmed_contact_id).toBe("ct_001");
    expect(second.body.assistant_reply).toContain("24号生日");
  });

  it("answers phone query after contact confirmation", async () => {
    const response = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "新海张总手机号是多少？",
    });

    expect(response.status).toBe(200);
    expect(response.body.mode).toBe("confirm");
    expect(response.body.pending_question.type).toBe("contact_resolution");
    expect(response.body.understanding.primary_interaction_type).toBe("query");
    expect(response.body.understanding.semantic_facets.has_query).toBe(true);
    expect(response.body.understanding.query_intent).toBe("contact_lookup");
    expect(response.body.understanding.entity_clues.company).toBe("新海");

    const second = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "是的",
      session_state: response.body.session_state,
      selected_contact_id: response.body.contact_resolution.selected_contact_id,
    });

    expect(second.status).toBe(200);
    expect(second.body.mode).toBe("answer");
    expect(second.body.pending_question).toBeNull();
    expect(second.body.understanding.primary_interaction_type).toBe("query");
    expect(second.body.assistant_reply).toContain("13800000002");
  });

  it("answers title query for confirmed contact", async () => {
    const response = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "王总现在是什么职位？",
    });

    expect(response.status).toBe(200);
    expect(response.body.mode).toBe("confirm");

    const second = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "是的",
      session_state: response.body.session_state,
      selected_contact_id: response.body.contact_resolution.selected_contact_id,
    });

    expect(second.status).toBe(200);
    expect(second.body.mode).toBe("answer");
    expect(second.body.pending_question).toBeNull();
    expect(second.body.understanding.primary_interaction_type).toBe("query");
    expect(second.body.assistant_reply).toContain("总经理");
  });

  it("answers birthday query with explicit not found when no clear record exists", async () => {
    const response = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "新海张总女儿生日是什么时候？",
    });

    expect(response.status).toBe(200);
    expect(response.body.mode).toBe("confirm");

    const second = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "是的",
      session_state: response.body.session_state,
      selected_contact_id: response.body.contact_resolution.selected_contact_id,
    });

    expect(second.status).toBe(200);
    expect(second.body.mode).toBe("answer");
    expect(second.body.pending_question).toBeNull();
    expect(second.body.understanding.primary_interaction_type).toBe("query");
    expect(second.body.assistant_reply).toContain("没有找到");
  });

  it("answers recent conversation query from saved notes", async () => {
    await app.post("/customers/c_001/parse-task-intent").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "今天和张老板聊天，发现他喜欢红酒",
      persist_note: true,
    });

    const first = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "张总最近和他聊了什么？",
    });

    expect(first.status).toBe(200);
    expect(first.body.mode).toBe("resolve_contact");

    const second = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "ABC贸易那位",
      session_state: first.body.session_state,
    });

    expect(second.status).toBe(200);
    expect(second.body.mode).toBe("answer");
    expect(second.body.pending_question).toBeNull();
    expect(second.body.understanding.primary_interaction_type).toBe("query");
    expect(second.body.understanding.grounded_concepts).toEqual([]);
    expect(second.body.assistant_reply).toContain("最近相关记录");
  });

  it("treats a new mixed input after query answer as a new request turn", async () => {
    const first = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "新海张总有什么待办？",
    });

    const second = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "是的",
      session_state: first.body.session_state,
      selected_contact_id: first.body.contact_resolution.selected_contact_id,
    });

    expect(second.status).toBe(200);
    expect(second.body.mode).toBe("answer");
    expect(second.body.session_state.raw_user_input).toBe("新海张总有什么待办？");

    const third = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "今天和王总聊了10分钟，他对我们的报价很感兴趣，下周要把产品demo发给他。还聊到他女儿下个月24号过生日。",
      session_state: second.body.session_state,
    });

    expect(third.status).toBe(200);
    expect(third.body.session_state.raw_user_input).toBe("今天和王总聊了10分钟，他对我们的报价很感兴趣，下周要把产品demo发给他。还聊到他女儿下个月24号过生日。");
    expect(third.body.session_state.draft_plan.selected_action_ids).toEqual([]);
    expect(third.body.session_state.draft_plan.actions_confirmed).toBe(false);
    expect(third.body.understanding.primary_interaction_type).toBe("mixed");
    expect(third.body.mode).toBe("confirm");
    expect(third.body.pending_question.type).toBe("contact_resolution");
  });

  it("treats a new query after query answer as a new request while keeping confirmed contact context", async () => {
    const first = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "新海张总手机号是多少？",
    });

    const second = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "是的",
      session_state: first.body.session_state,
      selected_contact_id: first.body.contact_resolution.selected_contact_id,
    });

    expect(second.status).toBe(200);
    expect(second.body.mode).toBe("answer");
    expect(second.body.assistant_reply).toContain("13800000002");

    const third = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "最近和他聊了什么？",
      session_state: second.body.session_state,
    });

    expect(third.status).toBe(200);
    expect(third.body.mode).toBe("answer");
    expect(third.body.session_state.raw_user_input).toBe("最近和他聊了什么？");
    expect(third.body.understanding.primary_interaction_type).toBe("query");
    expect(third.body.assistant_reply).not.toContain("13800000002");
  });

  it("reuses the most recently confirmed contact for a compatible new ambiguous title", async () => {
    const first = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "新海张总手机号是多少？",
    });

    const second = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "是的",
      session_state: first.body.session_state,
      selected_contact_id: first.body.contact_resolution.selected_contact_id,
    });

    const third = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "张总最近和他聊了什么？",
      session_state: second.body.session_state,
    });

    expect(third.status).toBe(200);
    expect(third.body.mode).toBe("answer");
    expect(third.body.contact_resolution.confirmed_contact_id).toBe("ct_002");
    expect(third.body.contact_resolution.confirmation_required).toBe(false);
    expect(third.body.contact_resolution.candidates[0].matched_fields).toContain("recent_confirmed_contact");
    expect(third.body.pending_question).toBeNull();
  });

  it("does not reuse the recent contact when the new request carries conflicting company clues", async () => {
    const first = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "新海张总手机号是多少？",
    });

    const second = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "是的",
      session_state: first.body.session_state,
      selected_contact_id: first.body.contact_resolution.selected_contact_id,
    });

    const third = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "ABC贸易的张总最近和他聊了什么？",
      session_state: second.body.session_state,
    });

    expect(third.status).toBe(200);
    expect(third.body.mode).toBe("confirm");
    expect(third.body.contact_resolution.confirmed_contact_id).not.toBe("ct_002");
    expect(third.body.contact_resolution.selected_contact_id).toBe("ct_001");
    expect(third.body.pending_question.type).toBe("contact_resolution");
  });

  it("continues after contact confirmation using session state", async () => {
    const first = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "今天和张总聊了10分钟，他对我们的报价很感兴趣，下周要把产品demo发给他。还聊到他女儿下个月24号过生日。",
    });

    const second = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "是新海科技那位",
      session_state: first.body.session_state,
    });

    expect(second.status).toBe(200);
    expect(second.body.contact_resolution.status).toBe("resolved");
    expect(second.body.contact_resolution.selected_contact_id).toBe("ct_002");
    expect(second.body.contact_resolution.confirmed_contact_id).toBe("ct_002");
    expect(second.body.session_state.raw_user_input).toBe("今天和张总聊了10分钟，他对我们的报价很感兴趣，下周要把产品demo发给他。还聊到他女儿下个月24号过生日。");
    expect(first.body.understanding.primary_interaction_type).toBe("mixed");
    expect(first.body.understanding.semantic_facets.has_note).toBe(true);
    expect(first.body.understanding.semantic_facets.has_task).toBe(true);
    expect(first.body.understanding.semantic_facets.has_reminder).toBe(true);
    expect(second.body.mode).toBe("clarify");
    expect(second.body.proposed_actions.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps note-task-reminder flow on action planning path after understanding", async () => {
    const first = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "今天和王总聊了10分钟，他对我们的报价很感兴趣，下周三要把产品demo发给他。还聊到他女儿下个月24号过生日。",
    });

    expect(first.status).toBe(200);
    expect(first.body.understanding.primary_interaction_type).toBe("mixed");
    expect(first.body.understanding.semantic_facets.has_note).toBe(true);
    expect(first.body.understanding.semantic_facets.has_task).toBe(true);
    expect(first.body.understanding.semantic_facets.has_reminder).toBe(true);
    expect(first.body.mode).toBe("confirm");
    expect(first.body.pending_question.type).toBe("contact_resolution");

    const second = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "是的",
      session_state: first.body.session_state,
      selected_contact_id: first.body.contact_resolution.selected_contact_id,
    });

    expect(second.status).toBe(200);
    expect(second.body.mode).toBe("confirm");
    expect(second.body.pending_question.type).toBe("action_selection");
    expect(second.body.understanding.primary_interaction_type).toBe("answer_to_pending");
    expect(second.body.understanding.semantic_facets.is_answer_to_pending).toBe(true);
    expect(second.body.proposed_actions.length).toBeGreaterThan(0);
  });

  it("represents composite input with multiple semantic facets and mixed primary type", async () => {
    const response = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "今天和新海张总聊了10分钟，他对报价感兴趣，下周发 demo，还聊到生日",
    });

    expect(response.status).toBe(200);
    expect(response.body.understanding.primary_interaction_type).toBe("mixed");
    expect(response.body.understanding.semantic_facets.has_note).toBe(true);
    expect(response.body.understanding.semantic_facets.has_task).toBe(true);
    expect(response.body.understanding.semantic_facets.has_reminder).toBe(true);
    expect(response.body.understanding.arbitration_notes?.length ?? 0).toBeGreaterThan(0);
  });

  it("detects pure task input via semantic facets", async () => {
    const response = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "下周三给王总发 demo",
    });

    expect(response.status).toBe(200);
    expect(response.body.understanding.grounded_concepts).toEqual([]);
    expect(response.body.understanding.semantic_facets.has_task).toBe(true);
  });

  it("detects pure craft input via semantic facets", async () => {
    const response = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "帮我写个 WhatsApp 跟进张总",
    });

    expect(response.status).toBe(200);
    expect(response.body.understanding.semantic_facets.has_craft).toBe(true);
  });

  it("returns action selection when actions are ready but not yet selected", async () => {
    const first = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "今天和王总聊了10分钟，他对我们的报价很感兴趣，下周三要把产品demo发给他。还聊到他女儿下个月24号过生日。",
    });

    const second = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "是的",
      session_state: first.body.session_state,
      selected_contact_id: first.body.contact_resolution.selected_contact_id,
    });

    expect(second.status).toBe(200);
    expect(second.body.mode).toBe("confirm");
    expect(second.body.pending_question.type).toBe("action_selection");
    expect(second.body.session_state.draft_plan.selected_action_ids).toEqual([]);
    expect(second.body.session_state.draft_plan.actions_confirmed).toBe(false);
    expect(second.body.proposed_actions.length).toBeGreaterThan(0);
  });

  it("supports selecting actions via natural language", async () => {
    const first = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "今天和王总聊了10分钟，他对我们的报价很感兴趣，下周三要把产品demo发给他。还聊到他女儿下个月24号过生日。",
    });

    const second = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "是的",
      session_state: first.body.session_state,
      selected_contact_id: first.body.contact_resolution.selected_contact_id,
    });

    const third = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "第1个和第3个",
      session_state: second.body.session_state,
    });

    expect(third.status).toBe(200);
    expect(third.body.mode).toBe("answer");
    expect(third.body.session_state.raw_user_input).toBe("今天和王总聊了10分钟，他对我们的报价很感兴趣，下周三要把产品demo发给他。还聊到他女儿下个月24号过生日。");
    expect(third.body.session_state.draft_plan.selected_action_ids).toHaveLength(2);
    expect(third.body.session_state.draft_plan.actions_confirmed).toBe(true);
    expect(third.body.pending_question).toBeNull();
    expect(third.body.execution_result.status).toBe("success");
  });

  it("supports direct execution from selected_action_ids without a second confirmation step", async () => {
    const first = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "今天和王总聊了10分钟，他对我们的报价很感兴趣，下周三要把产品demo发给他。还聊到他女儿下个月24号过生日。",
    });

    const second = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "是的",
      session_state: first.body.session_state,
      selected_contact_id: first.body.contact_resolution.selected_contact_id,
    });

    const third = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "这些动作",
      session_state: second.body.session_state,
      selected_action_ids: second.body.proposed_actions.map((action: { id: string }) => action.id),
    });

    expect(third.status).toBe(200);
    expect(third.body.mode).toBe("answer");
    expect(third.body.session_state.draft_plan.actions_confirmed).toBe(true);
    expect(third.body.pending_question).toBeNull();
    expect(third.body.session_state.draft_plan.selected_action_ids).toHaveLength(3);
    expect(third.body.execution_result.status).toBe("success");
  });

  it("supports selecting and executing a single action in one natural-language utterance", async () => {
    const first = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "今天和王总聊了10分钟，他对我们的报价很感兴趣，下周三要把产品demo发给他。还聊到他女儿下个月24号过生日。",
    });

    const second = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "是的",
      session_state: first.body.session_state,
      selected_contact_id: first.body.contact_resolution.selected_contact_id,
    });

    const third = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "执行第一个选项",
      session_state: second.body.session_state,
    });

    expect(third.status).toBe(200);
    expect(third.body.mode).toBe("answer");
    expect(third.body.session_state.draft_plan.selected_action_ids).toHaveLength(1);
    expect(third.body.session_state.draft_plan.actions_confirmed).toBe(true);
    expect(third.body.pending_question).toBeNull();
    expect(third.body.execution_result.status).toBe("success");
  });

  it("supports Chinese ordinal multi-select", async () => {
    const first = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "今天和王总聊了10分钟，他对我们的报价很感兴趣，下周三要把产品demo发给他。还聊到他女儿下个月24号过生日。",
    });

    const second = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "是的",
      session_state: first.body.session_state,
      selected_contact_id: first.body.contact_resolution.selected_contact_id,
    });

    const third = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "第一个和第三个",
      session_state: second.body.session_state,
    });

    expect(third.status).toBe(200);
    expect(third.body.mode).toBe("answer");
    expect(third.body.session_state.draft_plan.selected_action_ids).toHaveLength(2);
    expect(third.body.execution_result.status).toBe("success");
  });

  it("executes all actions directly when user selects all", async () => {
    const first = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "今天和王总聊了10分钟，他对我们的报价很感兴趣，下周三要把产品demo发给他。还聊到他女儿下个月24号过生日。",
    });

    const second = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "是的",
      session_state: first.body.session_state,
      selected_contact_id: first.body.contact_resolution.selected_contact_id,
    });

    const third = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "全部",
      session_state: second.body.session_state,
    });

    expect(third.status).toBe(200);
    expect(third.body.mode).toBe("answer");
    expect(third.body.pending_question).toBeNull();
    expect(third.body.session_state.draft_plan.selected_action_ids).toHaveLength(3);
    expect(third.body.execution_result.status).toBe("success");
    expect(third.body.execution_result.executed_actions).toHaveLength(3);
  });

  it("executes add_note after contact confirmation and action selection", async () => {
    const beforeNotes = repository.listNotesByCustomerId("c_003").length;

    const first = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "今天和王总聊了10分钟，他对我们的报价很感兴趣。",
    });

    const second = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "是的",
      session_state: first.body.session_state,
      selected_contact_id: first.body.contact_resolution.selected_contact_id,
    });

    const third = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "执行第一个选项",
      session_state: second.body.session_state,
    });

    expect(third.status).toBe(200);
    expect(third.body.mode).toBe("answer");
    expect(third.body.execution_result.status).toBe("success");
    expect(third.body.execution_result.executed_actions).toHaveLength(1);
    expect(third.body.execution_result.executed_actions[0].kind).toBe("add_note");
    expect(third.body.execution_result.executed_actions[0].record_id).toMatch(/^n_/);

    const afterNotes = repository.listNotesByCustomerId("c_003");
    expect(afterNotes.length).toBe(beforeNotes + 1);
    expect(afterNotes[0].raw_text).toContain("联系人对报价表现出兴趣");
  });

  it("starts a new request context after action execution completes", async () => {
    const first = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "今天和王总聊了10分钟，他对我们的报价很感兴趣。",
    });

    const second = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "是的",
      session_state: first.body.session_state,
      selected_contact_id: first.body.contact_resolution.selected_contact_id,
    });

    const third = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "执行第一个选项",
      session_state: second.body.session_state,
    });

    expect(third.status).toBe(200);
    expect(third.body.mode).toBe("answer");
    expect(third.body.session_state.draft_plan.actions_confirmed).toBe(true);

    const fourth = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "他现在是什么职位？",
      session_state: third.body.session_state,
    });

    expect(fourth.status).toBe(200);
    expect(fourth.body.mode).toBe("answer");
    expect(fourth.body.session_state.raw_user_input).toBe("他现在是什么职位？");
    expect(fourth.body.session_state.draft_plan.proposed_actions).toEqual([]);
    expect(fourth.body.session_state.draft_plan.selected_action_ids).toEqual([]);
    expect(fourth.body.session_state.draft_plan.actions_confirmed).toBe(false);
    expect(fourth.body.assistant_reply).toContain("总经理");
  });

  it("executes create_task after selection and writes task to database", async () => {
    const beforeTasks = repository.getOpenTasksByCustomerId("c_003").length;

    const first = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "今天和王总聊了10分钟，下周三要把产品demo发给他。",
    });

    const second = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "是的",
      session_state: first.body.session_state,
      selected_contact_id: first.body.contact_resolution.selected_contact_id,
    });

    const third = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "执行第一个选项",
      session_state: second.body.session_state,
    });

    expect(third.status).toBe(200);
    expect(third.body.mode).toBe("answer");
    expect(third.body.execution_result.status).toBe("success");
    expect(third.body.execution_result.executed_actions[0].kind).toBe("create_task");

    const afterTasks = repository.getOpenTasksByCustomerId("c_003");
    expect(afterTasks.length).toBe(beforeTasks + 1);
    expect(afterTasks[afterTasks.length - 1].title).toBe("发送产品demo");
    expect(afterTasks[afterTasks.length - 1].due_at).toContain("2026-04-08");
  });

  it("executes create_reminder after selection and writes reminder to database", async () => {
    const beforeReminders = repository.listRemindersByContactId("ct_003").length;

    const first = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "今天和王总聊了10分钟，还聊到他女儿下个月24号过生日。",
    });

    const second = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "是的",
      session_state: first.body.session_state,
      selected_contact_id: first.body.contact_resolution.selected_contact_id,
    });

    const third = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "执行第一个选项",
      session_state: second.body.session_state,
    });

    expect(third.status).toBe(200);
    expect(third.body.mode).toBe("answer");
    expect(third.body.execution_result.status).toBe("success");
    expect(third.body.execution_result.executed_actions[0].kind).toBe("create_reminder");

    const afterReminders = repository.listRemindersByContactId("ct_003");
    expect(afterReminders.length).toBe(beforeReminders + 1);
    expect(afterReminders[0].title).toBe("生日提醒");
    expect(afterReminders[0].remind_at).toContain("2026-05-24");
  });

  it("returns partial_success when mixed actions only partially execute", async () => {
    const beforeNotes = repository.listNotesByCustomerId("c_003").length;
    const beforeTasks = repository.getOpenTasksByCustomerId("c_003").length;

    const response = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "确认执行这些动作",
      session_state: buildConfirmedSessionState([
        {
          id: "add_note_1",
          kind: "add_note",
          status: "ready",
          confidence: 0.9,
          display_text: "记录客户对报价感兴趣",
          payload: {
            contact_id: "ct_003",
            note: "联系人对报价表现出兴趣",
            category: "opportunity_signal",
          },
        },
        {
          id: "create_task_2",
          kind: "create_task",
          status: "ready",
          confidence: 0.9,
          display_text: "发送产品demo给王总",
          payload: {
            contact_id: "ct_003",
            title: "发送产品demo",
            due_at: "2026-04-08T23:59:59+08:00",
          },
        },
        {
          id: "create_reminder_3",
          kind: "create_reminder",
          status: "ready",
          confidence: 0.9,
          display_text: "设置生日提醒",
          payload: {
            contact_id: "ct_003",
            title: "生日提醒",
          },
        },
      ]),
      selected_action_ids: ["add_note_1", "create_task_2", "create_reminder_3"],
      confirm_selected_actions: true,
    });

    expect(response.status).toBe(200);
    expect(response.body.mode).toBe("answer");
    expect(response.body.execution_result.status).toBe("partial_success");
    expect(response.body.execution_result.executed_actions).toHaveLength(2);
    expect(response.body.execution_result.failed_actions).toHaveLength(1);
    expect(response.body.execution_result.failed_actions[0].kind).toBe("create_reminder");

    expect(repository.listNotesByCustomerId("c_003").length).toBe(beforeNotes + 1);
    expect(repository.getOpenTasksByCustomerId("c_003").length).toBe(beforeTasks + 1);
  });

  it("does not execute before action confirmation", async () => {
    const beforeNotes = repository.listNotesByCustomerId("c_003").length;

    const first = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "今天和王总聊了10分钟，他对我们的报价很感兴趣。",
    });

    const second = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "是的",
      session_state: first.body.session_state,
      selected_contact_id: first.body.contact_resolution.selected_contact_id,
    });

    expect(second.status).toBe(200);
    expect(second.body.mode).toBe("confirm");
    expect(second.body.pending_question.type).toBe("action_selection");
    expect(second.body.execution_result.status).toBe("not_run");
    expect(repository.listNotesByCustomerId("c_003").length).toBe(beforeNotes);
  });

  it("returns 200 and failed execution_result for an unsupported action kind through /engine/respond", async () => {
    const beforeNotes = repository.listNotesByCustomerId("c_003").length;

    const response = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "确认执行这些动作",
      session_state: buildConfirmedSessionState([
        {
          id: "unsupported_1",
          kind: "update_profile",
          status: "ready",
          confidence: 0.8,
          display_text: "更新画像",
          payload: {
            contact_id: "ct_003",
          },
        },
      ]),
      selected_action_ids: ["unsupported_1"],
      confirm_selected_actions: true,
    });

    expect(response.status).toBe(200);
    expect(response.body.mode).toBe("answer");
    expect(response.body.execution_result.status).toBe("failed");
    expect(response.body.execution_result.executed_actions).toHaveLength(0);
    expect(response.body.execution_result.failed_actions).toHaveLength(1);
    expect(response.body.execution_result.failed_actions[0].kind).toBe("update_profile");
    expect(response.body.execution_result.failed_actions[0].message).toContain("unsupported_action_kind:update_profile");
    expect(response.body.assistant_reply).toContain("执行失败");
    expect(repository.listNotesByCustomerId("c_003").length).toBe(beforeNotes);
  });

  it("keeps supported writes when unsupported and supported actions are mixed through /engine/respond", async () => {
    const beforeNotes = repository.listNotesByCustomerId("c_003").length;

    const response = await app.post("/engine/respond").send({
      now: "2026-04-01T10:00:00+08:00",
      input_text: "确认执行这些动作",
      session_state: buildConfirmedSessionState([
        {
          id: "add_note_1",
          kind: "add_note",
          status: "ready",
          confidence: 0.9,
          display_text: "记录客户对报价感兴趣",
          payload: {
            contact_id: "ct_003",
            note: "联系人对报价表现出兴趣",
            category: "opportunity_signal",
          },
        },
        {
          id: "unsupported_2",
          kind: "update_profile",
          status: "ready",
          confidence: 0.8,
          display_text: "更新画像",
          payload: {
            contact_id: "ct_003",
          },
        },
      ]),
      selected_action_ids: ["add_note_1", "unsupported_2"],
      confirm_selected_actions: true,
    });

    expect(response.status).toBe(200);
    expect(response.body.mode).toBe("answer");
    expect(response.body.execution_result.status).toBe("partial_success");
    expect(response.body.execution_result.executed_actions).toHaveLength(1);
    expect(response.body.execution_result.executed_actions[0].kind).toBe("add_note");
    expect(response.body.execution_result.failed_actions).toHaveLength(1);
    expect(response.body.execution_result.failed_actions[0].kind).toBe("update_profile");
    expect(response.body.assistant_reply).toContain("1 条失败");

    const afterNotes = repository.listNotesByCustomerId("c_003");
    expect(afterNotes.length).toBe(beforeNotes + 1);
    expect(afterNotes[0].raw_text).toContain("联系人对报价表现出兴趣");
  });

  it("marks unsupported action kinds as failed without crashing in the executor service", () => {
    const beforeNotes = repository.listNotesByCustomerId("c_003").length;
    const executor = new ActionExecutorService(repository);
    const result = executor.execute([
      {
        id: "unsupported_1",
        kind: "update_profile" as never,
        status: "ready",
        confidence: 0.8,
        display_text: "更新画像",
        payload: {
          contact_id: "ct_003",
        },
      },
    ]);

    expect(result.status).toBe("failed");
    expect(result.executed_actions).toHaveLength(0);
    expect(result.failed_actions).toHaveLength(1);
    expect(result.failed_actions[0].message).toContain("unsupported_action_kind");
    expect(repository.listNotesByCustomerId("c_003").length).toBe(beforeNotes);
  });
});
