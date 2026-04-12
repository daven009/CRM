import React, { useMemo, useState } from "react";
import { getAvailableModels } from "../lib/models";
import { resolveModelProviderPreference } from "../lib/modelSettings";
import { runStagedPipeline } from "../lib/router/pipeline";
import { getScenarioPlan, runScenarioPlan, SCENARIOS } from "../lib/benchmarkScenarios";

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

const shortText = (value, max = 120) => {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

export default function BenchmarkView({ setView, standalone = false }) {
  const availableModels = useMemo(() => getAvailableModels(), []);
  const [provider, setProvider] = useState(resolveModelProviderPreference());
  const [statuses, setStatuses] = useState(() => initialStatuses());
  const [isRunningAll, setIsRunningAll] = useState(false);
  const [globalError, setGlobalError] = useState("");

  const selectedModel = availableModels.find((item) => item.id === provider);
  const configured = Boolean(selectedModel?.configured);
  const total = SCENARIOS.length;
  const passCount = Object.values(statuses).filter((item) => item.pass === true).length;
  const failCount = Object.values(statuses).filter((item) => item.pass === false).length;
  const finishedCount = Object.values(statuses).filter((item) => item.status === "pass" || item.status === "fail").length;

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
    const plan = getScenarioPlan(scenarioId);
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
          now: "2026-04-12T10:00:00+08:00"
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
      for (const scenario of SCENARIOS) {
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
    setStatuses(initialStatuses());
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
          <button onClick={clearResults} className="benchmark-secondary-btn">clear</button>
        </div>
      </div>

      {!configured && (
        <div className="benchmark-warning">
          当前选择的模型未配置。请先在 Settings 中设置 API Key，或者切换到已配置的 provider。
        </div>
      )}

      {globalError && <div className="benchmark-warning benchmark-error">{globalError}</div>}

      <div className="benchmark-list">
        {SCENARIOS.map((scenario, index) => {
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

                  {state.error && (
                    <div className="benchmark-error-box">
                      {state.error}
                    </div>
                  )}

                  {state.steps?.length > 0 && state.steps.map((step, stepIndex) => {
                    const result = step.result || {};
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
