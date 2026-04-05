import { Router } from "express";

const router = Router();

const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CRM Agent Playground</title>
  <style>
    :root {
      --bg: #f5f1e8;
      --panel: rgba(255, 251, 244, 0.82);
      --ink: #1f2933;
      --muted: #5e6b73;
      --line: #d8ceba;
      --accent: #0f766e;
      --accent-soft: #dff3ef;
      --danger: #9f1239;
      --radius: 18px;
      --shadow: 0 20px 50px rgba(31, 41, 51, 0.12);
      font-family: Georgia, "Times New Roman", serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(15,118,110,0.16), transparent 28%),
        radial-gradient(circle at 80% 10%, rgba(180,83,9,0.14), transparent 20%),
        linear-gradient(180deg, #fbf7f0 0%, var(--bg) 100%);
    }
    main {
      width: min(1160px, calc(100vw - 28px));
      margin: 24px auto;
      display: grid;
      grid-template-columns: 1.05fr 0.95fr;
      gap: 20px;
    }
    .card {
      background: var(--panel);
      border: 1px solid rgba(123, 107, 72, 0.16);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      overflow: hidden;
      backdrop-filter: blur(12px);
    }
    .hero {
      padding: 22px;
      background: linear-gradient(135deg, rgba(223,243,239,0.9), rgba(255,251,244,0.45));
      border-bottom: 1px solid rgba(123, 107, 72, 0.12);
    }
    .pane { padding: 22px; }
    h1, h2 { margin: 0; font-weight: 600; letter-spacing: 0.01em; }
    h1 { font-size: 34px; line-height: 1.05; }
    h2 { font-size: 18px; }
    p { margin: 10px 0 0; color: var(--muted); }
    label {
      display: block;
      margin-bottom: 8px;
      font-size: 13px;
      color: var(--muted);
    }
    input, textarea {
      width: 100%;
      border-radius: 12px;
      border: 1px solid var(--line);
      padding: 12px 14px;
      font: inherit;
      background: rgba(255,255,255,0.78);
      color: var(--ink);
    }
    textarea { min-height: 118px; resize: vertical; }
    .stack { display: grid; gap: 14px; }
    .split { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .actions { display: flex; gap: 10px; margin-top: 16px; }
    button {
      border-radius: 999px;
      padding: 12px 18px;
      font: inherit;
      cursor: pointer;
      transition: transform 140ms ease, opacity 140ms ease;
    }
    button:hover { transform: translateY(-1px); }
    .primary { background: var(--accent); color: #fff; border: none; }
    .secondary { background: transparent; color: var(--ink); border: 1px solid var(--line); }
    .pill {
      display: inline-flex;
      align-items: center;
      padding: 8px 12px;
      margin-top: 14px;
      border-radius: 999px;
      background: rgba(255,255,255,0.62);
      border: 1px solid rgba(123, 107, 72, 0.16);
      font-size: 12px;
    }
    .status {
      min-height: 20px;
      margin-top: 12px;
      font-size: 13px;
      color: var(--muted);
    }
    .status.error { color: var(--danger); }
    .log {
      display: grid;
      gap: 14px;
      max-height: 520px;
      overflow: auto;
      padding-right: 4px;
    }
    .bubble {
      border-radius: 16px;
      padding: 14px 16px;
      border: 1px solid rgba(123, 107, 72, 0.16);
      background: rgba(255,255,255,0.7);
    }
    .bubble.user {
      background: linear-gradient(135deg, rgba(15,118,110,0.12), rgba(255,255,255,0.74));
    }
    .bubble.assistant {
      background: linear-gradient(135deg, rgba(255,255,255,0.9), rgba(223,243,239,0.38));
    }
    .bubble-head {
      margin-bottom: 8px;
      font-size: 12px;
      color: var(--muted);
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .bubble-text {
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 16px;
      line-height: 1.6;
    }
    .bubble pre {
      margin: 10px 0 0;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: Menlo, Consolas, monospace;
      font-size: 12px;
      line-height: 1.5;
    }
    details.debug {
      margin-top: 10px;
      border-top: 1px solid rgba(123, 107, 72, 0.14);
      padding-top: 10px;
    }
    details.debug summary {
      cursor: pointer;
      color: var(--muted);
      font-size: 13px;
      user-select: none;
    }
    .hint {
      margin-top: 10px;
      padding: 12px 14px;
      border-radius: 12px;
      background: rgba(15,118,110,0.08);
      color: var(--ink);
      font-size: 14px;
      line-height: 1.5;
    }
    @media (max-width: 920px) {
      main, .split { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <section class="card">
      <div class="hero">
        <h1>CRM 待办意图识别</h1>
        <p>手动模拟指定客户详情页中的一句话输入，直接查看后端返回的结构化结果。</p>
        <div class="pill" id="provider-status">Provider: loading</div>
      </div>
      <div class="pane">
        <div class="stack">
          <div>
            <label for="now">当前时间</label>
            <input id="now" value="2026-03-31T10:00:00+08:00" />
          </div>
          <div class="split">
            <div>
              <label for="customer">客户 JSON</label>
              <textarea id="customer">{ "id": "c_001", "name": "张老板" }</textarea>
            </div>
            <div>
              <label for="input_text">用户输入</label>
              <textarea id="input_text">张老板已经付款了</textarea>
            </div>
          </div>
          <div>
            <label for="tasks">当前待办列表 JSON</label>
            <textarea id="tasks">[
  {
    "id": "t_101",
    "title": "发送报价",
    "task_type": "send_quote",
    "status": "open",
    "due_at": "2026-04-02T18:00:00+08:00",
    "note": null
  },
  {
    "id": "t_102",
    "title": "催收首付款",
    "task_type": "collect_payment",
    "status": "open",
    "due_at": null,
    "note": null
  }
]</textarea>
          </div>
        </div>
        <div class="actions">
          <button class="primary" id="send">解析输入</button>
          <button class="secondary" id="reset">恢复示例</button>
        </div>
        <div class="status" id="status"></div>
      </div>
    </section>
    <section class="card">
      <div class="hero">
        <h2>模拟对话</h2>
        <p>右侧只展示对话内容。结构化 JSON 会收进每条回复下方的调试区。</p>
      </div>
      <div class="pane">
        <div class="log" id="log"></div>
      </div>
    </section>
  </main>
  <script>
    const els = {
      now: document.getElementById("now"),
      customer: document.getElementById("customer"),
      tasks: document.getElementById("tasks"),
      inputText: document.getElementById("input_text"),
      send: document.getElementById("send"),
      reset: document.getElementById("reset"),
      status: document.getElementById("status"),
      log: document.getElementById("log"),
      providerStatus: document.getElementById("provider-status")
    };

    const defaults = {
      now: "2026-03-31T10:00:00+08:00",
      customer: '{ "id": "c_001", "name": "张老板" }',
      tasks: '[\\n  {\\n    "id": "t_101",\\n    "title": "发送报价",\\n    "task_type": "send_quote",\\n    "status": "open",\\n    "due_at": "2026-04-02T18:00:00+08:00",\\n    "note": null\\n  },\\n  {\\n    "id": "t_102",\\n    "title": "催收首付款",\\n    "task_type": "collect_payment",\\n    "status": "open",\\n    "due_at": null,\\n    "note": null\\n  }\\n]',
      inputText: "张老板已经付款了"
    };

    function setStatus(text, isError = false) {
      els.status.textContent = text;
      els.status.className = isError ? "status error" : "status";
    }

    function appendBubble(type, content) {
      const node = document.createElement("div");
      node.className = "bubble " + type;
      const head = document.createElement("div");
      head.className = "bubble-head";
      head.textContent = type === "user" ? "用户" : "系统";
      const body = document.createElement("div");
      body.className = "bubble-text";
      body.textContent = content;
      node.appendChild(head);
      node.appendChild(body);
      els.log.prepend(node);
    }

    function summarizeResponse(data) {
      const intentMap = {
        create: "我理解为：这是新增待办。",
        complete: "我理解为：这是完成待办。",
        update: "我理解为：这是修改待办。",
        cancel: "我理解为：这是取消待办。",
        noop_or_note: "我理解为：这是记录备注，不直接操作待办。"
      };

      const lines = [intentMap[data.intent] || "我已经完成解析。"];

      if (data.target_task_id) {
        lines.push("目标待办 ID：" + data.target_task_id);
      } else if (data.target_task_hint && (data.target_task_hint.task_type || (data.target_task_hint.title_keywords || []).length)) {
        const hintParts = [];
        if (data.target_task_hint.task_type) hintParts.push("类型倾向为 " + data.target_task_hint.task_type);
        if (data.target_task_hint.title_keywords && data.target_task_hint.title_keywords.length) {
          hintParts.push("关键词为 " + data.target_task_hint.title_keywords.join("、"));
        }
        if (hintParts.length) lines.push("定位线索：" + hintParts.join("，"));
      }

      if (data.new_task && data.new_task.title) {
        lines.push("新待办标题：" + data.new_task.title);
      }
      if (data.new_task && data.new_task.due_at) {
        lines.push("新待办时间：" + data.new_task.due_at);
      }
      if (data.changes && data.changes.status) {
        lines.push("状态变更：" + data.changes.status);
      }
      if (data.changes && data.changes.due_at) {
        lines.push("修改后时间：" + data.changes.due_at);
      }
      if (data.changes && data.changes.note) {
        lines.push("备注内容：" + data.changes.note);
      }
      if (data.conversation_insight) {
        lines.push("沟通理解类型：" + data.conversation_insight.note_type);
        lines.push("沟通理解摘要：" + data.conversation_insight.summary);
        if (data.conversation_insight.tags && data.conversation_insight.tags.length) {
          lines.push("标签：" + data.conversation_insight.tags.join("、"));
        }
      }
      if (data.needs_clarification) {
        lines.push("需要补充信息：" + (data.clarification_question || "请进一步确认。"));
      }

      return lines.join("\\n");
    }

    function appendAssistantBubble(data) {
      const node = document.createElement("div");
      node.className = "bubble assistant";

      const head = document.createElement("div");
      head.className = "bubble-head";
      head.textContent = "系统";

      const body = document.createElement("div");
      body.className = "bubble-text";
      body.textContent = summarizeResponse(data);

      node.appendChild(head);
      node.appendChild(body);

      if (data.needs_clarification && data.clarification_question) {
        const hint = document.createElement("div");
        hint.className = "hint";
        hint.textContent = data.clarification_question;
        node.appendChild(hint);
      }

      const details = document.createElement("details");
      details.className = "debug";
      const summary = document.createElement("summary");
      summary.textContent = "查看结构化结果";
      const pre = document.createElement("pre");
      pre.textContent = JSON.stringify(data, null, 2);
      details.appendChild(summary);
      details.appendChild(pre);
      node.appendChild(details);

      els.log.prepend(node);
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

    async function parseIntent() {
      let customer;
      let tasks;
      try {
        customer = JSON.parse(els.customer.value);
        tasks = JSON.parse(els.tasks.value);
      } catch {
        setStatus("JSON 格式有误，请检查客户或待办列表。", true);
        return;
      }

      const payload = {
        now: els.now.value,
        customer,
        open_tasks: tasks,
        input_text: els.inputText.value
      };

      appendBubble("user", payload.input_text);
      setStatus("正在解析...");

      try {
        const res = await fetch("/agent/parse-task-intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        appendAssistantBubble(data);
        setStatus(res.ok ? "解析完成。" : "请求失败。", !res.ok);
      } catch {
        setStatus("请求失败，请确认服务正在运行。", true);
      }
    }

    els.send.addEventListener("click", parseIntent);
    els.reset.addEventListener("click", () => {
      els.now.value = defaults.now;
      els.customer.value = defaults.customer;
      els.tasks.value = defaults.tasks;
      els.inputText.value = defaults.inputText;
      setStatus("已恢复示例。");
    });

    refreshProvider();
    appendBubble("assistant", "准备就绪。修改左侧内容后点击“解析输入”即可。结构化 JSON 在每条系统回复里可展开查看。");
  </script>
</body>
</html>`;

router.get("/playground", (_, res) => {
  res.type("html").send(html);
});

export { router as playgroundRouter };
