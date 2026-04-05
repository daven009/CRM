import { ExtractionResult, OpenTask, TaskHint } from "../types/agent";

function containsAny(text: string, candidates: string[]): boolean {
  return candidates.some((candidate) => text.includes(candidate));
}

function scoreTask(task: OpenTask, extraction: ExtractionResult): number {
  let score = 0;
  const text = `${task.title} ${task.note ?? ""}`;

  if (extraction.referencedTaskType && task.task_type === extraction.referencedTaskType) {
    score += 5;
  }

  for (const keyword of extraction.titleKeywords) {
    if (text.includes(keyword)) {
      score += 2;
    }
  }

  if (containsAny(text, ["报价"]) && extraction.referencedTaskType === "send_quote") {
    score += 2;
  }
  if (containsAny(text, ["付款", "打款", "转账", "首付款", "尾款"]) && extraction.referencedTaskType === "collect_payment") {
    score += 2;
  }

  return score;
}

export interface ResolutionResult {
  targetTaskId: string | null;
  hint: TaskHint;
  needsClarification: boolean;
  clarificationQuestion: string | null;
}

export function resolveTask(openTasks: OpenTask[], extraction: ExtractionResult): ResolutionResult {
  const hint: TaskHint = {
    task_type: extraction.referencedTaskType,
    title_keywords: extraction.titleKeywords,
  };

  if (["create", "noop_or_note"].includes(extraction.intent)) {
    return {
      targetTaskId: null,
      hint,
      needsClarification: false,
      clarificationQuestion: null,
    };
  }

  const candidatePool = openTasks.filter((task) => task.status === "open");
  if (candidatePool.length === 0) {
    return {
      targetTaskId: null,
      hint,
      needsClarification: true,
      clarificationQuestion: "当前没有可操作的待办，要新建一条吗？",
    };
  }

  const scored = candidatePool
    .map((task) => ({ task, score: scoreTask(task, extraction) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return {
      targetTaskId: null,
      hint,
      needsClarification: true,
      clarificationQuestion: "你要操作的是哪条待办？",
    };
  }

  if (scored.length > 1 && scored[0].score === scored[1].score) {
    return {
      targetTaskId: null,
      hint,
      needsClarification: true,
      clarificationQuestion: "你要操作的是哪条待办？",
    };
  }

  return {
    targetTaskId: scored[0].task.id,
    hint,
    needsClarification: false,
    clarificationQuestion: null,
  };
}
