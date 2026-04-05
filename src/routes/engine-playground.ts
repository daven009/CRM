import { Router } from "express";

const router = Router();

const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CRM Engine Playground</title>
  <style>
    :root {
      --bg: #efe9dd;
      --panel: rgba(255, 252, 247, 0.82);
      --ink: #1d2a30;
      --muted: #61717a;
      --line: #d7cdbc;
      --accent: #0f766e;
      --accent-soft: #ddf4ef;
      --amber: #b45309;
      --danger: #9f1239;
      --radius: 20px;
      --shadow: 0 24px 60px rgba(29, 42, 48, 0.12);
      font-family: Georgia, "Times New Roman", serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(15,118,110,0.14), transparent 28%),
        radial-gradient(circle at 85% 10%, rgba(180,83,9,0.12), transparent 20%),
        linear-gradient(180deg, #faf5ed 0%, var(--bg) 100%);
    }
    main {
      width: min(1320px, calc(100vw - 28px));
      margin: 22px auto;
      display: grid;
      grid-template-columns: 1.2fr 0.8fr;
      gap: 18px;
    }
    .card {
      background: var(--panel);
      border: 1px solid rgba(124, 110, 84, 0.16);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      overflow: hidden;
      backdrop-filter: blur(12px);
    }
    .hero {
      padding: 22px;
      border-bottom: 1px solid rgba(124, 110, 84, 0.14);
      background: linear-gradient(135deg, rgba(221,244,239,0.88), rgba(255,252,247,0.46));
    }
    .pane { padding: 22px; }
    h1, h2, h3 { margin: 0; font-weight: 600; }
    h1 { font-size: 34px; line-height: 1.04; }
    h2 { font-size: 18px; }
    h3 { font-size: 16px; }
    p { margin: 10px 0 0; color: var(--muted); }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-top: 14px;
      padding: 8px 12px;
      border-radius: 999px;
      border: 1px solid rgba(124, 110, 84, 0.16);
      background: rgba(255,255,255,0.64);
      font-size: 12px;
    }
    .shell {
      display: grid;
      grid-template-rows: 1fr auto;
      min-height: 760px;
    }
    .chat {
      padding: 22px;
      display: grid;
      gap: 14px;
      max-height: 720px;
      overflow: auto;
      align-content: start;
    }
    .bubble {
      border-radius: 18px;
      padding: 16px;
      border: 1px solid rgba(124, 110, 84, 0.16);
      background: rgba(255,255,255,0.72);
    }
    .bubble.user {
      background: linear-gradient(135deg, rgba(15,118,110,0.12), rgba(255,255,255,0.76));
    }
    .bubble.assistant {
      background: linear-gradient(135deg, rgba(255,255,255,0.92), rgba(221,244,239,0.36));
    }
    .label {
      margin-bottom: 10px;
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .text {
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 17px;
      line-height: 1.65;
    }
    .subtle {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid rgba(124, 110, 84, 0.12);
      color: var(--muted);
      font-size: 13px;
      line-height: 1.5;
    }
    .composer {
      padding: 18px 22px 22px;
      border-top: 1px solid rgba(124, 110, 84, 0.14);
      background: rgba(255,255,255,0.4);
    }
    .quick {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 12px;
    }
    .chip, .candidate {
      border-radius: 999px;
      padding: 9px 14px;
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.84);
      font: inherit;
      cursor: pointer;
      color: var(--ink);
    }
    .candidate {
      display: inline-flex;
      margin-top: 10px;
      margin-right: 8px;
      background: rgba(15,118,110,0.08);
    }
    .candidate.active {
      background: rgba(15,118,110,0.18);
      border-color: rgba(15,118,110,0.45);
    }
    .candidate.confirm {
      background: rgba(180,83,9,0.08);
    }
    textarea, input {
      width: 100%;
      border-radius: 14px;
      border: 1px solid var(--line);
      padding: 13px 14px;
      font: inherit;
      color: var(--ink);
      background: rgba(255,255,255,0.9);
    }
    textarea {
      min-height: 110px;
      resize: vertical;
    }
    .row {
      display: grid;
      grid-template-columns: 220px 1fr;
      gap: 12px;
      margin-bottom: 12px;
    }
    .actions {
      display: flex;
      gap: 10px;
      margin-top: 12px;
    }
    .btn {
      border-radius: 999px;
      padding: 12px 18px;
      font: inherit;
      cursor: pointer;
      border: none;
    }
    .btn.primary { background: var(--accent); color: white; }
    .btn.secondary { background: transparent; border: 1px solid var(--line); color: var(--ink); }
    .status {
      min-height: 20px;
      margin-top: 12px;
      color: var(--muted);
      font-size: 13px;
    }
    .status.error { color: var(--danger); }
    .stack { display: grid; gap: 16px; }
    .panel-block {
      padding: 16px;
      border: 1px solid rgba(124, 110, 84, 0.14);
      border-radius: 16px;
      background: rgba(255,255,255,0.6);
      min-height: 0;
      display: grid;
      grid-template-rows: auto 1fr;
      gap: 10px;
    }
    .meta {
      display: grid;
      gap: 8px;
      font-size: 14px;
      color: var(--muted);
      line-height: 1.5;
      max-height: 180px;
      overflow: auto;
      padding-right: 4px;
    }
    .action-list {
      display: grid;
      gap: 10px;
      max-height: 260px;
      overflow: auto;
      padding-right: 4px;
    }
    .log-list {
      display: grid;
      gap: 12px;
      max-height: 980px;
      overflow: auto;
      padding-right: 4px;
      align-content: start;
    }
    .log-entry {
      padding: 14px 16px;
      border-radius: 16px;
      border: 1px solid rgba(124, 110, 84, 0.14);
      background: rgba(255,255,255,0.76);
    }
    .log-title {
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--muted);
      margin-bottom: 8px;
    }
    .log-body {
      font-size: 14px;
      line-height: 1.6;
      color: var(--ink);
      white-space: pre-wrap;
      word-break: break-word;
    }
    .action-card {
      padding: 12px 14px;
      border-radius: 14px;
      border: 1px solid rgba(124, 110, 84, 0.14);
      background: rgba(255,255,255,0.76);
      cursor: pointer;
    }
    .action-card.active {
      background: rgba(15,118,110,0.12);
      border-color: rgba(15,118,110,0.4);
    }
    .action-title {
      font-size: 14px;
      margin-bottom: 6px;
      color: var(--ink);
    }
    .action-meta {
      font-size: 12px;
      color: var(--muted);
      margin-bottom: 6px;
    }
    .action-card pre, .json pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: Menlo, Consolas, monospace;
      font-size: 12px;
      line-height: 1.55;
    }
    .json details summary {
      cursor: pointer;
      color: var(--muted);
      font-size: 13px;
    }
    .json details {
      margin-top: 10px;
    }
    .json pre {
      margin-top: 10px;
      max-height: 280px;
      overflow: auto;
      padding: 12px;
      border-radius: 12px;
      background: rgba(255,255,255,0.72);
      border: 1px solid rgba(124, 110, 84, 0.12);
    }
    .pending {
      color: var(--amber);
    }
    .option-group {
      display: grid;
      gap: 8px;
      margin-top: 10px;
    }
    .option-note {
      margin-top: 10px;
      color: var(--muted);
      font-size: 12px;
    }
    #candidate-actions {
      max-height: 190px;
      overflow: auto;
      padding-right: 4px;
    }
    @media (max-width: 1040px) {
      main { grid-template-columns: 1fr; }
      .row { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <section class="card shell">
      <div class="hero">
        <h1>CRM Query Engine</h1>
        <p>直接测试联系人确认、多轮继续和候选动作规划。这个页面走新的 <code>/engine/respond</code> 协议，不再依赖“先进入客户详情页”。</p>
        <div class="pill" id="provider-status">Provider: loading</div>
      </div>
      <div class="chat" id="chat"></div>
      <div class="composer">
        <div class="quick">
          <button class="chip" data-prompt="今天和张总聊了10分钟，他对我们的报价很感兴趣，下周要把产品demo发给他。还聊到他女儿下个月24号过生日。">张总歧义 + 多动作</button>
          <button class="chip" data-prompt="今天和王总聊了10分钟，他对我们的报价很感兴趣，下周三要把产品demo发给他。还聊到他女儿下个月24号过生日。">王总唯一命中</button>
          <button class="chip" data-prompt="新海张总手机号是多少？">Query: 手机号</button>
          <button class="chip" data-prompt="张总最近和他聊了什么？">Query: 最近沟通</button>
          <button class="chip" data-prompt="今天和赵总聊过了，下周发合同。">联系人不存在</button>
        </div>
        <div class="row">
          <div>
            <label for="now">当前时间</label>
            <input id="now" value="2026-04-01T10:00:00+08:00" />
          </div>
          <div>
            <label for="input">用户输入</label>
            <textarea id="input">今天和张总聊了10分钟，他对我们的报价很感兴趣，下周要把产品demo发给他。还聊到他女儿下个月24号过生日。</textarea>
          </div>
        </div>
        <div class="actions">
          <button class="btn primary" id="send">发送</button>
          <button class="btn secondary" id="reset">清空会话</button>
        </div>
        <div class="status" id="status"></div>
      </div>
    </section>
    <aside class="card">
      <div class="hero">
        <h2>State Log</h2>
        <p>这里只记录每一轮的判断过程和结果，方便追踪为什么进入当前状态。</p>
      </div>
      <div class="pane stack">
        <section class="panel-block">
          <h3>Decision Trace</h3>
          <div class="log-list" id="state-log">尚未开始。</div>
        </section>
      </div>
    </aside>
  </main>
  <script>
    const els = {
      now: document.getElementById("now"),
      input: document.getElementById("input"),
      send: document.getElementById("send"),
      reset: document.getElementById("reset"),
      chat: document.getElementById("chat"),
      status: document.getElementById("status"),
      providerStatus: document.getElementById("provider-status"),
      stateLog: document.getElementById("state-log"),
      quick: Array.from(document.querySelectorAll(".chip"))
    };

    let sessionState = null;
    let lastResponse = null;
    let selectedActionIds = [];
    let logEntries = [];
    let isSending = false;

    function appendSystemLog(title, body) {
      logEntries = [
        ...logEntries,
        { title, body }
      ];
      els.stateLog.innerHTML = "";
      logEntries.forEach((entry) => {
        const item = document.createElement("div");
        item.className = "log-entry";
        const titleNode = document.createElement("div");
        titleNode.className = "log-title";
        titleNode.textContent = entry.title;
        const bodyNode = document.createElement("div");
        bodyNode.className = "log-body";
        bodyNode.textContent = entry.body;
        item.appendChild(titleNode);
        item.appendChild(bodyNode);
        els.stateLog.appendChild(item);
      });
      els.stateLog.scrollTop = els.stateLog.scrollHeight;
    }

    function setStatus(text, isError = false) {
      els.status.textContent = text;
      els.status.className = isError ? "status error" : "status";
    }

    function addBubble(role, text, extraNode) {
      const bubble = document.createElement("div");
      bubble.className = "bubble " + role;
      const label = document.createElement("div");
      label.className = "label";
      label.textContent = role === "user" ? "用户" : "系统";
      const body = document.createElement("div");
      body.className = "text";
      body.textContent = text;
      bubble.appendChild(label);
      bubble.appendChild(body);
      if (extraNode) bubble.appendChild(extraNode);
      els.chat.appendChild(bubble);
      els.chat.scrollTop = els.chat.scrollHeight;
    }

    function syncActionSelectionUI() {
      document.querySelectorAll("[data-action-id]").forEach((node) => {
        const actionId = node.getAttribute("data-action-id");
        const active = selectedActionIds.includes(actionId);
        if (node.classList.contains("candidate") || node.classList.contains("action-card")) {
          node.classList.toggle("active", active);
        }
      });
    }

    function getPendingQuestionText(pendingQuestion) {
      if (!pendingQuestion) return null;
      if (typeof pendingQuestion === "string") return pendingQuestion;
      return pendingQuestion.question || null;
    }

    function getPendingQuestionType(pendingQuestion) {
      if (!pendingQuestion || typeof pendingQuestion === "string") return null;
      return pendingQuestion.type || null;
    }

    function getCurrentPendingQuestion(response) {
      return response?.pending_question || response?.session_state?.pending_question || null;
    }

    function isInteractiveActionState(response) {
      const pendingType = getPendingQuestionType(getCurrentPendingQuestion(response));
      return response?.mode === "confirm" && pendingType === "action_selection";
    }

    function buildFallbackResponseFromSession() {
      return {
        mode: "confirm",
        session_state: sessionState,
        contact_resolution: sessionState.contact_resolution,
        proposed_actions: sessionState.draft_plan.proposed_actions,
        understanding: lastResponse?.understanding || {
          primary_interaction_type: "mixed",
          semantic_facets: {
            has_query: false,
            has_note: true,
            has_task: true,
            has_reminder: false,
            has_craft: false,
            is_answer_to_pending: false
          },
          confidence: 0.5,
          source: "fallback_rules",
          planning_source: "fallback_rules",
          query_intent: null,
          action_intent: null,
          arbitration_notes: []
        },
        debug: lastResponse?.debug || {
          understanding_provider: "fallback_rules",
          understanding_fallback_reason: "missing_api_key"
        },
        pending_question: sessionState.pending_question,
        assistant_reply: ""
      };
    }

    function getPrimaryInteractionType(response) {
      return response?.understanding?.primary_interaction_type || "unknown";
    }

    function getSemanticFacetsText(response) {
      const facets = response?.understanding?.semantic_facets;
      if (!facets) return "null";
      return Object.entries(facets)
        .filter(([, active]) => active)
        .map(([facet]) => facet)
        .join(", ") || "none";
    }

    function getUnderstandingSource(response) {
      return response?.understanding?.source || "fallback_rules";
    }

    function appendStateLog(response) {
      const pendingQuestion = getCurrentPendingQuestion(response);
      const pendingQuestionType = getPendingQuestionType(pendingQuestion);
      const activeFacets = getSemanticFacetsText(response);
      const chosenActions = (response.session_state?.draft_plan?.selected_action_ids || []).join(", ") || "[]";
      const arbitrationNotes = (response.understanding?.arbitration_notes || []).join(", ") || "none";
      const routeSummary = getRouteSummary(response, pendingQuestionType);
      const candidateSummary = response.contact_resolution.candidates.length
        ? response.contact_resolution.candidates.map((candidate) => candidate.display_name + "/" + candidate.name + "/" + candidate.company).join(" | ")
        : "none";
      const actionsSummary = response.proposed_actions.length
        ? response.proposed_actions.map((action) => action.id + ": " + action.kind + " / " + action.status + " / " + action.display_text).join("\\n")
        : "none";

      const lines = [
        "Step 1 Understanding",
        "- primary_interaction_type: " + getPrimaryInteractionType(response),
        "- semantic_facets: " + activeFacets,
        "- confidence: " + (response.understanding.confidence ?? "null"),
        "- source: " + getUnderstandingSource(response),
        "- query_intent: " + (response.understanding.query_intent || "null"),
        "- action_intent: " + (response.understanding.action_intent || "null"),
        "- requires_contact_resolution: " + response.understanding.requires_contact_resolution,
        "- clarification_focus: " + (response.understanding.clarification_focus || "null"),
        "- summary: " + (response.understanding.summary || "null"),
        "- arbitration_notes: " + arbitrationNotes,
        "Step 2 Contact Resolution",
        "- status: " + response.contact_resolution.status,
        "- query_name: " + (response.contact_resolution.query_name || "null"),
        "- selected_contact_id: " + (response.contact_resolution.selected_contact_id || "null"),
        "- confirmed_contact_id: " + (response.contact_resolution.confirmed_contact_id || "null"),
        "- confirmation_required: " + response.contact_resolution.confirmation_required,
        "- candidates: " + candidateSummary,
        "Step 3 Route Result",
        "- mode: " + response.mode,
        "- route_result: " + routeSummary,
        "- planning_source: " + response.understanding.planning_source,
        "- pending_question.type: " + (pendingQuestionType || "null"),
        "- pending_question.field: " + (pendingQuestion?.field || "null"),
        "- pending_question.question: " + (getPendingQuestionText(pendingQuestion) || "null"),
        "- selected_action_ids: " + chosenActions,
        "- actions_confirmed: " + (response.session_state?.draft_plan?.actions_confirmed ?? false),
        "- proposed_actions:\\n" + actionsSummary,
        "Debug",
        "- understanding_provider: " + (response.debug?.understanding_provider || "unknown"),
        "- understanding_fallback_reason: " + (response.debug?.understanding_fallback_reason || "null"),
      ];

      appendSystemLog("Turn " + (logEntries.length + 1) + " · " + response.mode, lines.join("\\n"));
    }

    function getRouteSummary(response, pendingQuestionType) {
      if (response.mode === "resolve_contact") {
        return "先停在联系人确认阶段。";
      }

      if (response.mode === "clarify") {
        return "已进入动作补参阶段。";
      }

      if (response.mode === "confirm" && pendingQuestionType === "action_selection") {
        return "已进入动作选择阶段。";
      }

      if (response.mode === "answer" && getPrimaryInteractionType(response) === "query") {
        return "已走 query answer 路径。";
      }

      if (response.mode === "answer") {
        return "已走 action answer 路径。";
      }

      return "等待下一步判断。";
    }

    function getAnswerStateLabel(response) {
      const interactionType = getPrimaryInteractionType(response);
      if (response?.mode !== "answer") {
        return null;
      }

      if (interactionType === "query") {
        return "query answer: 联系人已确认，当前直接返回查询结果。";
      }

      const executionStatus = response?.execution_result?.status || "not_run";
      return "action answer: 已返回执行结果，status = " + executionStatus + "。";
    }

    function findCandidateById(candidateId) {
      if (!lastResponse?.contact_resolution?.candidates) return null;
      return lastResponse.contact_resolution.candidates.find((candidate) => candidate.id === candidateId) || null;
    }

    function renderOptionButtons(container, response, pendingQuestion) {
      if (!pendingQuestion?.options?.length) {
        return;
      }

      const wrap = document.createElement("div");
      wrap.className = "option-group";

      pendingQuestion.options.forEach((option) => {
        const button = document.createElement("button");
        button.className = "candidate";
        button.textContent = option.label;

        if (pendingQuestion.type === "action_selection") {
          button.setAttribute("data-action-id", option.value);
          if (selectedActionIds.includes(option.value)) {
            button.classList.add("active");
          }
        }

        button.addEventListener("click", () => handlePendingOption(response, pendingQuestion, option));
        wrap.appendChild(button);
      });

      container.appendChild(wrap);
    }

    async function handlePendingOption(response, pendingQuestion, option) {
      if (pendingQuestion.type === "contact_resolution") {
        const candidate = findCandidateById(option.value);
        if (candidate) {
          await confirmCandidate(candidate);
        }
        return;
      }

      if (pendingQuestion.type === "action_selection") {
        toggleAction(option.value);
        return;
      }

      await sendQuestionOption(option, pendingQuestion);
    }

    async function sendQuestionOption(option, pendingQuestion) {
      if (!sessionState) return;
      await sendMessage({
        now: els.now.value,
        input_text: option.label,
        session_state: sessionState,
        selected_action_ids: selectedActionIds.length ? selectedActionIds : undefined
      }, "选择选项：" + option.label);
      setStatus("已提交选项：" + option.label + (pendingQuestion?.field ? "（字段 " + pendingQuestion.field + "）" : "") + "。");
    }

    function renderActionSelectionControls(container, response) {
      const wrap = document.createElement("div");
      wrap.className = "option-group";

      const allButton = document.createElement("button");
      allButton.className = "candidate";
      allButton.textContent = "全选当前动作";
      allButton.addEventListener("click", () => executeAllActions(response.proposed_actions));
      wrap.appendChild(allButton);

      const continueButton = document.createElement("button");
      continueButton.className = "candidate confirm";
      continueButton.textContent = "执行已选动作";
      continueButton.addEventListener("click", () => submitSelectedActions());
      wrap.appendChild(continueButton);

      container.appendChild(wrap);
    }

    function renderAssistant(response) {
      const extra = document.createElement("div");
      const pendingQuestion = getCurrentPendingQuestion(response);
      const pendingQuestionType = getPendingQuestionType(pendingQuestion);
      extra.className = "subtle";

      if (pendingQuestion) {
        renderOptionButtons(extra, response, pendingQuestion);
      }

      if (response.mode === "confirm" && pendingQuestionType === "action_selection") {
        renderActionSelectionControls(extra, response);
      }

      if (response.mode === "clarify" && !pendingQuestion?.options?.length) {
        const note = document.createElement("div");
        note.className = "option-note";
        note.textContent = "这个阶段需要你补充参数，直接在输入框继续回答即可。";
        extra.appendChild(note);
      }

      if (response.mode === "answer") {
        const note = document.createElement("div");
        note.className = "option-note";
        note.textContent = getAnswerStateLabel(response);
        extra.appendChild(note);
      }

      addBubble("assistant", response.assistant_reply, extra.childNodes.length ? extra : null);
    }

    function updateSidePanel(response, options = {}) {
      const preserveSelection = Boolean(options.preserveSelection);
      sessionState = response.session_state;
      lastResponse = response;
      if (!preserveSelection) {
        selectedActionIds = response.session_state.draft_plan.selected_action_ids || [];
      }
      appendStateLog(response);
      syncActionSelectionUI();
    }

    async function refreshProvider() {
      try {
        const res = await fetch("/agent/provider-status");
        const data = await res.json();
        els.providerStatus.textContent = "Provider: " + data.provider + (data.model ? " (" + data.model + ")" : "");
      } catch {
        els.providerStatus.textContent = "Provider: unavailable";
      }
    }

    async function sendMessage(payload, userText) {
      setStatus("处理中...");
      if (userText) addBubble("user", userText);
      try {
        const res = await fetch("/engine/respond", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        renderAssistant(data);
        updateSidePanel(data);
        setStatus(res.ok ? "处理完成。" : "请求失败。", !res.ok);
      } catch {
        setStatus("请求失败，请确认服务仍在运行。", true);
      }
    }

    async function handleSend() {
      if (isSending) {
        return;
      }

      const inputText = els.input.value.trim();
      if (!inputText) {
        setStatus("请输入一句话。", true);
        return;
      }

      const payload = {
        now: els.now.value,
        input_text: inputText,
        session_state: sessionState || undefined,
        selected_action_ids: selectedActionIds.length ? selectedActionIds : undefined
      };

      isSending = true;
      els.send.disabled = true;

      try {
        await sendMessage(payload, inputText);
        els.input.value = "";
      } finally {
        isSending = false;
        els.send.disabled = false;
      }
    }

    async function confirmCandidate(candidate) {
      if (!sessionState) return;
      await sendMessage({
        now: els.now.value,
        input_text: candidate.company + "那位",
        session_state: sessionState,
        selected_contact_id: candidate.id
      }, "选择联系人：" + candidate.display_name + " / " + candidate.name + " / " + candidate.company);
    }

    function toggleAction(actionId) {
      if (!sessionState || !isInteractiveActionState(lastResponse || buildFallbackResponseFromSession())) return;
      selectedActionIds = selectedActionIds.includes(actionId)
        ? selectedActionIds.filter((id) => id !== actionId)
        : [...selectedActionIds, actionId];
      updateSidePanel(lastResponse || buildFallbackResponseFromSession(), { preserveSelection: true });
      syncActionSelectionUI();
      setStatus(selectedActionIds.length ? "已选择 " + selectedActionIds.length + " 个动作。" : "已清空动作选择。");
    }

    async function executeAllActions(actions) {
      selectedActionIds = actions.map((action) => action.id);
      if (lastResponse) {
        updateSidePanel(lastResponse, { preserveSelection: true });
      }
      syncActionSelectionUI();
      setStatus("已选择全部 " + selectedActionIds.length + " 个动作，准备执行。");
      await submitSelectedActions();
    }

    async function submitSelectedActions() {
      if (!sessionState || !selectedActionIds.length) {
        setStatus("请先至少选择一个动作。", true);
        return;
      }

      await sendMessage({
        now: els.now.value,
        input_text: "这些动作",
        session_state: sessionState,
        selected_action_ids: selectedActionIds
      }, "选择动作并执行：" + selectedActionIds.join(", "));
    }

    function handleReset() {
      sessionState = null;
      lastResponse = null;
      selectedActionIds = [];
      logEntries = [];
      els.chat.innerHTML = "";
      els.input.value = "今天和张总聊了10分钟，他对我们的报价很感兴趣，下周要把产品demo发给他。还聊到他女儿下个月24号过生日。";
      els.stateLog.textContent = "尚未开始。";
      setStatus("会话已清空。");
      addBubble("assistant", "准备就绪。输入一句自然语言，测试联系人确认和候选动作规划。");
    }

    window.addEventListener("error", (event) => {
      const message = event.error?.stack || event.message || "unknown error";
      appendSystemLog("Frontend Error", message);
      setStatus("前端脚本报错，请查看右侧 State Log。", true);
    });

    els.send.addEventListener("click", handleSend);
    els.reset.addEventListener("click", handleReset);

    els.quick.forEach((chip) => {
      chip.addEventListener("click", () => {
        els.input.value = chip.dataset.prompt || "";
      });
    });

    try {
      refreshProvider();
      addBubble("assistant", "准备就绪。输入一句自然语言，测试联系人确认和候选动作规划。");
      appendSystemLog("Init", "Playground initialized.\\n- send button bound\\n- reset button bound\\n- provider refresh started");
    } catch (error) {
      appendSystemLog("Init Error", error?.stack || String(error));
      setStatus("初始化失败，请查看右侧 State Log。", true);
    }
  </script>
</body>
</html>`;

router.get("/engine-playground", (_, res) => {
  res.type("html").send(html);
});

export { router as enginePlaygroundRouter };
