import React, { useEffect, useMemo, useState } from "react";
import { getAvailableModels } from "../lib/models";
import { resolveModelProviderPreference } from "../lib/modelSettings";
import { runStagedPipeline } from "../lib/router/pipeline";
import { createContext } from "../lib/router/context";
import { getScenarioPlan, runScenarioPlan, SCENARIOS, makeBenchmarkClients } from "../lib/benchmarkScenarios";

const CUSTOM_CASES_KEY = "crm.benchmark.customCases.v1";
const FIXED_NOW = "2026-04-12T10:00:00+08:00";
const blankRound = () => ({ input: "", expected: "" });

const makeId = () => `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const loadCustomCases = () => {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(CUSTOM_CASES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        const rounds = Array.isArray(item?.rounds)
          ? item.rounds.map((round) => ({
            input: String(round?.input || "").trim(),
            expected: String(round?.expected || "").trim()
          })).filter((round) => round.input)
          : [];
        if (!item?.id || !item?.title || rounds.length === 0) return null;
        return {
          id: String(item.id),
          title: String(item.title),
          rounds,
          createdAt: item.createdAt || new Date().toISOString(),
          updatedAt: item.updatedAt || new Date().toISOString()
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
};

const buildStepSummary = (result) => {
  const data = {
    reply: String(result?.reply || ""),
    needsClarification: Boolean(result?.needsClarification),
    clarifyingQuestion: String(result?.clarifyingQuestion || ""),
    focusChange: Array.isArray(result?.focusChange) ? result.focusChange : [],
    intents: Array.isArray(result?.intents) ? result.intents : [],
    actions: Array.isArray(result?.actions) ? result.actions : [],
    requestMeta: result?.requestMeta || {}
  };
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(result?.reply || "");
  }
};

const splitExpectedLines = (expected) => String(expected || "")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

const containsAllExpected = (expected, actual) => {
  const needles = splitExpectedLines(expected);
  if (needles.length === 0) return true;
  const haystack = String(actual || "");
  return needles.every((needle) => haystack.includes(needle));
};

const buildCustomPlan = (scenario) => {
  const rounds = Array.isArray(scenario?.rounds) ? scenario.rounds.filter((round) => round?.input) : [];
  const customScenario = {
    id: scenario.id,
    category: "custom",
    title: scenario.title || "自定义场景",
    input: rounds[0]?.input || "",
    expectedRoute: "manual",
    tags: ["CUSTOM", "manual", "multi-turn"]
  };

  return {
    scenario: customScenario,
    steps: rounds.map((round, index) => ({
      input: round.input,
      expected: round.expected || "",
      clients: makeBenchmarkClients(),
      ctx: index === 0 ? createContext() : "previous",
      options: {}
    })),
    evaluate: (steps) => {
      const checks = steps.map((step) => {
        const actual = buildStepSummary(step?.result);
        const matched = containsAllExpected(step?.expected || "", actual);
        return {
          expected: step?.expected || "",
          actual,
          matched
        };
      });
      const pass = checks.length > 0 && checks.every((item) => item.matched);
      return {
        pass,
        expected: pass
          ? "所有轮次的预期内容都命中"
          : "至少有一轮预期内容没有命中",
        checks
      };
    }
  };
};

const initialStatuses = () => {
  const next = {};
  SCENARIOS.forEach((scenario) => {
    next[scenario.id] = {
      status: "idle",
      expanded: false,
      pass: null,
      evaluation: null,
      steps: [],
      error: ""
    };
  });
  return next;
};

const syncStatusesForCases = (prev, cases) => {
  const next = { ...prev };
  const ids = new Set(cases.map((item) => item.id));
  Object.keys(next).forEach((id) => {
    if (!ids.has(id)) delete next[id];
  });
  cases.forEach((scenario) => {
    if (!next[scenario.id]) {
      next[scenario.id] = {
        status: "idle",
        expanded: false,
        pass: null,
        evaluation: null,
        steps: [],
        error: ""
      };
    }
  });
  return next;
};

const shortText = (value, max = 120) => {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

const formatClient = (client) => {
  if (!client) return "(none)";
  const label = client.n || client.name || `#${client.id}`;
  return client.co ? `${label} · ${client.co}` : label;
};

const formatRecentMessages = (messages) => {
  const items = Array.isArray(messages) ? messages : [];
  if (!items.length) return "(no recent messages)";
  return items
    .map((msg, idx) => {
      const user = shortText(msg?.user, 120) || "(empty)";
      const ai = shortText(msg?.ai, 140) || "(empty)";
      return `${idx + 1}. 用户: ${user}\n   AI: ${ai}`;
    })
    .join("\n");
};

export default function BenchmarkView({ setView, standalone = false }) {
  const availableModels = useMemo(() => getAvailableModels(), []);
  const [provider, setProvider] = useState(resolveModelProviderPreference());
  const [customCases, setCustomCases] = useState(() => loadCustomCases());
  const [statuses, setStatuses] = useState(() => initialStatuses());
  const [isRunningAll, setIsRunningAll] = useState(false);
  const [globalError, setGlobalError] = useState("");
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftRounds, setDraftRounds] = useState([blankRound()]);

  const cases = useMemo(() => ([
    ...SCENARIOS.map((scenario) => ({ ...scenario, source: "built-in" })),
    ...customCases.map((scenario) => ({ ...scenario, source: "custom" }))
  ]), [customCases]);

  const selectedModel = availableModels.find((item) => item.id === provider);
  const configured = Boolean(selectedModel?.configured);
  const total = cases.length;
  const passCount = Object.values(statuses).filter((item) => item.pass === true).length;
  const failCount = Object.values(statuses).filter((item) => item.pass === false).length;
  const finishedCount = Object.values(statuses).filter((item) => item.status === "pass" || item.status === "fail").length;

  useEffect(() => {
    setStatuses((prev) => syncStatusesForCases(prev, cases));
  }, [cases]);

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(CUSTOM_CASES_KEY, JSON.stringify(customCases));
    } catch {
      // ignore write failures in unsupported environments
    }
  }, [customCases]);

  const updateScenario = (id, patch) => {
    setStatuses((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        ...patch
      }
    }));
  };

  const runOne = async (scenarioId) => {
    const customScenario = customCases.find((item) => item.id === scenarioId);
    const plan = customScenario ? buildCustomPlan(customScenario) : getScenarioPlan(scenarioId);
    if (!plan) {
      updateScenario(scenarioId, {
        status: "fail",
        pass: false,
        error: "未找到场景定义"
      });
      return;
    }

    updateScenario(scenarioId, {
      status: "running",
      expanded: true,
      error: ""
    });

    try {
      const outcome = await runScenarioPlan(plan, async (input, clients, ctx, options) => runStagedPipeline(
        input,
        clients,
        ctx,
        provider,
        {
          ...options,
          now: FIXED_NOW
        }
      ));

      const evaluation = outcome.evaluation || { pass: false, expected: "unknown" };
      updateScenario(scenarioId, {
        status: evaluation.pass ? "pass" : "fail",
        pass: evaluation.pass,
        evaluation,
        steps: outcome.steps,
        error: ""
      });
      return outcome;
    } catch (error) {
      updateScenario(scenarioId, {
        status: "fail",
        pass: false,
        error: error instanceof Error ? error.message : "运行失败"
      });
      throw error;
    }
  };

  const runAll = async () => {
    setGlobalError("");
    setIsRunningAll(true);
    try {
      let firstError = "";
      for (const scenario of cases) {
        // 每个场景独立运行，不把动作写回生产数据
        // 结果只保留在本地页面 state 中
        try {
          await runOne(scenario.id);
        } catch (error) {
          if (!firstError) firstError = error instanceof Error ? error.message : "批量测试失败";
        }
      }
      if (firstError) setGlobalError(firstError);
    } finally {
      setIsRunningAll(false);
    }
  };

  const clearResults = () => {
    setStatuses(syncStatusesForCases(initialStatuses(), cases));
    setGlobalError("");
  };

  const toggleExpanded = (scenarioId) => {
    setStatuses((prev) => ({
      ...prev,
      [scenarioId]: {
        ...prev[scenarioId],
        expanded: !prev[scenarioId]?.expanded
      }
    }));
  };

  const updateDraftRound = (index, field, value) => {
    setDraftRounds((prev) => prev.map((round, i) => (i === index ? { ...round, [field]: value } : round)));
  };

  const addDraftRound = () => {
    setDraftRounds((prev) => [...prev, blankRound()]);
  };

  const removeDraftRound = (index) => {
    setDraftRounds((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, i) => i !== index);
    });
  };

  const resetComposer = () => {
    setDraftTitle("");
    setDraftRounds([blankRound()]);
    setIsComposerOpen(false);
  };

  const saveCustomCase = () => {
    const title = String(draftTitle || "").trim();
    const rounds = draftRounds
      .map((round) => ({
        input: String(round.input || "").trim(),
        expected: String(round.expected || "").trim()
      }))
      .filter((round) => round.input);

    if (!title) {
      setGlobalError("请先填写 custom case 标题。");
      return;
    }
    if (rounds.length === 0) {
      setGlobalError("至少需要填写一轮输入。");
      return;
    }

    const now = new Date().toISOString();
    const nextCase = {
      id: makeId(),
      title,
      rounds,
      createdAt: now,
      updatedAt: now
    };

    setCustomCases((prev) => [nextCase, ...prev]);
    setStatuses((prev) => ({
      ...prev,
      [nextCase.id]: {
        status: "idle",
        expanded: true,
        pass: null,
        evaluation: null,
        steps: [],
        error: ""
      }
    }));
    setGlobalError("");
    resetComposer();
  };

  const deleteCustomCase = (scenarioId) => {
    const confirmed = window.confirm("确定删除这个 custom case 吗？");
    if (!confirmed) return;
    setCustomCases((prev) => prev.filter((item) => item.id !== scenarioId));
    setStatuses((prev) => {
      const next = { ...prev };
      delete next[scenarioId];
      return next;
    });
  };

  return (
    <div className="page benchmark-page">
      <div className="top-spacer" />

      <div className="top-bar benchmark-top-bar">
        {!standalone && <button onClick={() => setView("voice")} className="back-btn">← back</button>}
        <span className="brand-text">BENCHMARK</span>
        <button
          onClick={runAll}
          className="benchmark-run-all"
          disabled={isRunningAll || !configured}
        >
          {isRunningAll ? "running…" : "run all"}
        </button>
      </div>

      <div className="benchmark-toolbar">
        <div className="benchmark-summary">
          <div className="benchmark-summary-item">
            <div className="benchmark-summary-value">{passCount}</div>
            <div className="benchmark-summary-label">pass</div>
          </div>
          <div className="benchmark-summary-item">
            <div className="benchmark-summary-value">{failCount}</div>
            <div className="benchmark-summary-label">fail</div>
          </div>
          <div className="benchmark-summary-item">
            <div className="benchmark-summary-value">{finishedCount}/{total}</div>
            <div className="benchmark-summary-label">done</div>
          </div>
        </div>

        <div className="benchmark-controls">
          <select
            className="benchmark-select"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          >
            {availableModels.map((model) => (
              <option key={model.id} value={model.id} disabled={!model.configured}>
                {model.label}{model.configured ? "" : " (Not Configured)"}
              </option>
            ))}
          </select>
          <button onClick={() => setIsComposerOpen((prev) => !prev)} className="benchmark-secondary-btn">
            add custom case
          </button>
          <button onClick={clearResults} className="benchmark-secondary-btn">clear</button>
        </div>
      </div>

      {isComposerOpen && (
        <div className="benchmark-composer">
          <div className="benchmark-composer-header">
            <div>
              <div className="benchmark-composer-title">Add custom case</div>
              <div className="benchmark-composer-subtitle">手动录入每一轮输入和预期内容，保存后会加入测试列表。</div>
            </div>
            <button type="button" className="benchmark-secondary-btn" onClick={resetComposer}>close</button>
          </div>

          <div className="benchmark-composer-grid">
            <label className="benchmark-composer-field benchmark-composer-field-wide">
              <span>Case title</span>
              <input
                className="benchmark-composer-input"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder="例如：多轮切换联系人后仍然误判"
              />
            </label>
          </div>

          <div className="benchmark-composer-rounds">
            {draftRounds.map((round, index) => (
              <div key={`draft-round-${index}`} className="benchmark-composer-round">
                <div className="benchmark-composer-round-head">
                  <span>Round {index + 1}</span>
                  <button
                    type="button"
                    className="benchmark-composer-link"
                    onClick={() => removeDraftRound(index)}
                    disabled={draftRounds.length <= 1}
                  >
                    remove
                  </button>
                </div>
                <label className="benchmark-composer-field">
                  <span>User input</span>
                  <textarea
                    className="benchmark-composer-textarea"
                    value={round.input}
                    onChange={(e) => updateDraftRound(index, "input", e.target.value)}
                    placeholder="输入这一轮的用户原话"
                  />
                </label>
                <label className="benchmark-composer-field">
                  <span>Expected</span>
                  <textarea
                    className="benchmark-composer-textarea"
                    value={round.expected}
                    onChange={(e) => updateDraftRound(index, "expected", e.target.value)}
                    placeholder="输入这一轮预期内容。可以写 reply / action / clarification 的关键字，支持多行。"
                  />
                </label>
              </div>
            ))}
          </div>

          <div className="benchmark-composer-actions">
            <button type="button" className="benchmark-secondary-btn" onClick={addDraftRound}>add round</button>
            <button type="button" className="benchmark-run-all" onClick={saveCustomCase}>save case</button>
          </div>
        </div>
      )}

      {!configured && (
        <div className="benchmark-warning">
          当前选择的模型未配置。请先在 Settings 中设置 API Key，或者切换到已配置的 provider。
        </div>
      )}

      {globalError && <div className="benchmark-warning benchmark-error">{globalError}</div>}

      <div className="benchmark-list">
        {cases.map((scenario, index) => {
          const state = statuses[scenario.id] || {};
          const status = state.status || "idle";
          const badgeClass = `benchmark-status-badge ${status}`;
          return (
              <div key={scenario.id} className={`benchmark-row ${state.expanded ? "expanded" : ""}`}>
              <div
                className="benchmark-row-head"
                role="button"
                tabIndex={0}
                onClick={() => toggleExpanded(scenario.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggleExpanded(scenario.id);
                  }
                }}
              >
                <div className="benchmark-row-left">
                  <div className="benchmark-row-index">{String(index + 1).padStart(2, "0")}</div>
                  <div className="benchmark-row-main">
                    <div className="benchmark-row-title">{scenario.title}</div>
                    <div className="benchmark-row-sub">
                      <span className="benchmark-pill">{scenario.category}</span>
                      {scenario.source === "custom" && <span className="benchmark-pill benchmark-pill-custom">custom</span>}
                      <span className="benchmark-input">{shortText(scenario.input, 56)}</span>
                    </div>
                  </div>
                </div>
                <div className="benchmark-row-right">
                  <span className={badgeClass}>{status}</span>
                  <button
                    type="button"
                    className="benchmark-run-one"
                    onClick={(e) => {
                      e.stopPropagation();
                      void runOne(scenario.id);
                      }}
                      disabled={state.status === "running" || !configured}
                    >
                      run
                    </button>
                    {scenario.source === "custom" && (
                      <button
                        type="button"
                        className="benchmark-delete-one"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteCustomCase(scenario.id);
                        }}
                      >
                        delete
                      </button>
                    )}
                </div>
              </div>

              {state.expanded && (
                <div className="benchmark-row-body">
                  <div className="benchmark-detail-grid">
                    <div className="benchmark-detail-card">
                      <div className="benchmark-detail-label">INPUT</div>
                      <div className="benchmark-detail-value">{scenario.input}</div>
                    </div>
                    <div className="benchmark-detail-card">
                      <div className="benchmark-detail-label">EXPECTED</div>
                      <div className="benchmark-detail-value">{state.evaluation?.expected || scenario.expectedRoute}</div>
                    </div>
                    <div className="benchmark-detail-card">
                      <div className="benchmark-detail-label">STATUS</div>
                      <div className="benchmark-detail-value">{status}</div>
                    </div>
                    <div className="benchmark-detail-card">
                      <div className="benchmark-detail-label">TAGS</div>
                      <div className="benchmark-tags">
                        {scenario.tags.map((tag) => (
                          <span key={tag} className="benchmark-pill">{tag}</span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {scenario.source === "custom" && Array.isArray(scenario.rounds) && scenario.rounds.length > 0 && (
                    <div className="benchmark-custom-rounds">
                      <div className="benchmark-detail-label">CUSTOM ROUNDS</div>
                      {scenario.rounds.map((round, roundIndex) => (
                        <div key={`${scenario.id}-draft-${roundIndex}`} className="benchmark-custom-round">
                          <div className="benchmark-custom-round-head">
                            <span>Round {roundIndex + 1}</span>
                            <span className="benchmark-custom-round-input">{shortText(round.input, 90)}</span>
                          </div>
                          <div className="benchmark-custom-round-body">
                            <div className="benchmark-custom-round-col">
                              <div className="benchmark-step-label">INPUT</div>
                              <pre>{round.input}</pre>
                            </div>
                            <div className="benchmark-custom-round-col">
                              <div className="benchmark-step-label">EXPECTED</div>
                              <pre>{round.expected || "(empty)"}</pre>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {state.error && (
                    <div className="benchmark-error-box">
                      {state.error}
                    </div>
                  )}

                  {state.steps?.length > 0 && state.steps.map((step, stepIndex) => {
                    const result = step.result || {};
                    const check = state.evaluation?.checks?.[stepIndex];
                    return (
                      <div key={`${scenario.id}-${stepIndex}`} className="benchmark-step">
                        <div className="benchmark-step-head">
                          <span>step {stepIndex + 1}</span>
                          <span className="benchmark-step-input">{shortText(step.input, 80)}</span>
                        </div>
                        <div className="benchmark-step-body">
                          <div className="benchmark-step-col">
                            <div className="benchmark-step-label">INTENTS</div>
                            <pre>{JSON.stringify(result.intents || [], null, 2)}</pre>
                          </div>
                          <div className="benchmark-step-col">
                            <div className="benchmark-step-label">ACTIONS</div>
                            <pre>{JSON.stringify(result.actions || [], null, 2)}</pre>
                          </div>
                          <div className="benchmark-step-col">
                            <div className="benchmark-step-label">REPLY</div>
                            <pre>{String(result.reply || "")}</pre>
                          </div>
                    <div className="benchmark-step-col">
                      <div className="benchmark-step-label">TRACE</div>
                      <pre>{JSON.stringify(result.stages || [], null, 2)}</pre>
                    </div>
                    <div className="benchmark-step-col">
                      <div className="benchmark-step-label">CONTEXT</div>
                      <pre>{JSON.stringify({
                        focus_client: formatClient(result.ctx?.focus_client),
                        conversation_summary: result.ctx?.conversation_summary || "(none)",
                        compressed_summary: result.ctx?.compressed_summary || "(none)",
                        recent_messages_count: Array.isArray(result.ctx?.recent_messages) ? result.ctx.recent_messages.length : 0
                      }, null, 2)}</pre>
                    </div>
                          <div className="benchmark-step-col benchmark-step-col-wide">
                            <div className="benchmark-step-label">RECENT MESSAGES</div>
                            <pre>{formatRecentMessages(result.ctx?.recent_messages)}</pre>
                          </div>
                          {step.expected && (
                            <div className="benchmark-step-col benchmark-step-col-wide">
                              <div className="benchmark-step-label">EXPECTED</div>
                              <pre>{step.expected}</pre>
                            </div>
                          )}
                          {check && (
                            <div className="benchmark-step-col benchmark-step-col-wide">
                              <div className="benchmark-step-label">CHECK</div>
                              <pre>{check.matched ? "matched" : "mismatched"}\n\n{check.actual}</pre>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {state.evaluation && (
                    <div className="benchmark-result-line">
                      <span className={`benchmark-final-pill ${state.pass ? "pass" : "fail"}`}>
                        {state.pass ? "pass" : "fail"}
                      </span>
                      <span className="benchmark-result-text">{state.evaluation.expected}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="benchmark-footer-hint">
        只读测试模式。页面只展示系统返回结果，不会把 actions 写入客户库。
      </div>
    </div>
  );
}
