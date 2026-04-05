import OpenAI from "openai";
import {
  ContactResolution,
  ExecutionResult,
  EngineMode,
  PendingQuestion,
  ProposedAction,
} from "../types/engine";

interface ReplyComposerInput {
  mode: EngineMode;
  contactResolution: ContactResolution;
  actions: ProposedAction[];
  pendingQuestion: PendingQuestion | null;
  selectedActionIds?: string[];
  actionsConfirmed?: boolean;
  executionResult?: ExecutionResult;
  fallbackReply: string;
}

function summarizeActions(actions: ProposedAction[]) {
  return actions.map((action, index) => ({
    index: index + 1,
    id: action.id,
    kind: action.kind,
    status: action.status,
    display_text: action.display_text,
  }));
}

function buildPrompt(input: ReplyComposerInput) {
  return [
    "你是 CRM query engine 的回复组织助手。",
    "你的任务是基于已经确定好的状态机结果，帮系统组织一段自然、简洁、对用户友好的中文回复。",
    "不要改动状态机含义，不要编造事实，不要让用户以为系统已经执行了还没执行的动作。",
    "要求：",
    "1. 只输出最终要对用户说的话，不要输出 JSON，不要解释。",
    "2. 如果当前是 clarify，要直接问缺失信息，不要说空泛的“这个任务”。尽量引用具体动作。",
    "3. 如果当前是 action_selection，要明确是“请选择要执行的动作”。",
    "4. 如果当前是 resolve_contact，要明确是在确认联系人或补联系人信息。",
    "5. 如果当前是 answer 且 execution_result.status 是 success / partial_success / failed，要准确反映执行结果。",
    "6. 如果当前是 answer 且 actionsConfirmed = true 但 execution_result.status = not_run，不要说已经真实执行。",
    "7. 语气自然，1-3 句即可。",
    "",
    JSON.stringify(
      {
        mode: input.mode,
        contact_resolution: {
          status: input.contactResolution.status,
          query_name: input.contactResolution.query_name,
          selected_contact_id: input.contactResolution.selected_contact_id,
          confirmed_contact_id: input.contactResolution.confirmed_contact_id,
          confirmation_required: input.contactResolution.confirmation_required,
          candidates: input.contactResolution.candidates.map((candidate) => ({
            id: candidate.id,
            display_name: candidate.display_name,
            name: candidate.name,
            company: candidate.company,
            profile_summary: candidate.profile_summary,
          })),
        },
        pending_question: input.pendingQuestion,
        selected_action_ids: input.selectedActionIds ?? [],
        actions_confirmed: Boolean(input.actionsConfirmed),
        execution_result: input.executionResult,
        actions: summarizeActions(input.actions),
        fallback_reply: input.fallbackReply,
      },
      null,
      2,
    ),
  ].join("\n");
}

export class EngineReplyComposer {
  private readonly apiKey = process.env.OPENAI_API_KEY;
  private readonly model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

  async compose(input: ReplyComposerInput): Promise<string> {
    if (!this.apiKey) {
      return input.fallbackReply;
    }

    try {
      const client = new OpenAI({ apiKey: this.apiKey });
      const response = await client.responses.create({
        model: this.model,
        input: buildPrompt(input),
      });

      const text = response.output_text?.trim();
      return text || input.fallbackReply;
    } catch {
      return input.fallbackReply;
    }
  }
}
