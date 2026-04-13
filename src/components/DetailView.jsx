import React from "react";

const clipText = (value, max = 32) => {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

const summarizeHistory = (history = []) => {
  const items = Array.isArray(history) ? history : [];
  const userTurns = items.filter((item) => item?.r === "user").map((item) => String(item.t || "").trim()).filter(Boolean);
  const aiTurns = items.filter((item) => item?.r === "ai").map((item) => String(item.t || "").trim()).filter(Boolean);

  return {
    summary: clipText(userTurns[0] || "沟通记录", 20),
    detail: clipText(aiTurns[aiTurns.length - 1] || userTurns[1] || "点击查看完整聊天记录", 28)
  };
};

export default function DetailView({
  sel, setSel, setView, hpColor, detailChat, setDetailChat, detailConvos, setDetailConvos,
  detailText, setDetailText, detailTyping, detailSend, startNewDetailSession, closeDetailChat, recording, setRecording, detailRef,
  attachScreenshotToClient, saveDetailClient, removeDataFileFromClient
}) {
  const msgIdx = React.useRef(0);
  const [activeTab, setActiveTab] = React.useState("overview");
  const tabIdx = activeTab === "overview" ? 0 : activeTab === "timeline" ? 1 : 2;
  const [touchStart, setTouchStart] = React.useState(null);
  const [touchEnd, setTouchEnd] = React.useState(null);
  const [isDragging, setIsDragging] = React.useState(false);

  const [viewingLog, setViewingLog] = React.useState(null);
  const [viewingFile, setViewingFile] = React.useState(null);
  const [uploadingScreenshot, setUploadingScreenshot] = React.useState(false);
  const [swipedLogIndex, setSwipedLogIndex] = React.useState(null);
  const [editingLogIndex, setEditingLogIndex] = React.useState(null);
  const [editingLogSummary, setEditingLogSummary] = React.useState("");
  const [editingFileIndex, setEditingFileIndex] = React.useState(null);
  const [editingFileSummary, setEditingFileSummary] = React.useState("");
  const [deletingFileIndex, setDeletingFileIndex] = React.useState(null);
  const [traitsEditing, setTraitsEditing] = React.useState(false);
  const traitPressTimer = React.useRef(null);
  const traitsWrapRef = React.useRef(null);

  React.useEffect(() => {
    if (!traitsEditing) return;
    const handleClickOutside = (e) => {
      if (traitsWrapRef.current && !traitsWrapRef.current.contains(e.target)) {
        setTraitsEditing(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [traitsEditing]);
  const screenshotInputRef = React.useRef(null);
  const logPressTimerRef = React.useRef(null);
  const filePressTimerRef = React.useRef(null);

  React.useEffect(() => {
    if (detailChat && detailRef.current) {
      detailRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [detailConvos, detailTyping, detailChat]);

  const onDragStart = (x) => {
    setTouchEnd(null);
    setTouchStart(x);
    setIsDragging(true);
  };

  const onDragMove = (x) => {
    if (!isDragging) return;
    setTouchEnd(x);
  };

  const onDragEnd = () => {
    if (!isDragging) return;
    setIsDragging(false);
    if (!touchStart || !touchEnd) return;
    const dist = touchStart - touchEnd;
    const tabs = ["overview", "timeline", "data"];
    if (dist > 60 && tabIdx < 2) setActiveTab(tabs[tabIdx + 1]);
    if (dist < -60 && tabIdx > 0) setActiveTab(tabs[tabIdx - 1]);
  };

  const [editingTodo, setEditingTodo] = React.useState(null);
  const [editVal, setEditVal] = React.useState({ t: "", d: 0 });
  const pressTimer = React.useRef(null);

  const startPress = (td) => {
    pressTimer.current = setTimeout(() => {
      setEditingTodo(td);
      setEditVal({ t: td.t, d: td.d });
    }, 600);
  };
  const endPress = () => clearTimeout(pressTimer.current);

  const saveEdit = () => {
    if (editingTodo) {
      // P1-3: 不直接修改 editingTodo，使用不可变更新
      const nextTodos = (sel.todos || []).map(td =>
        td === editingTodo
          ? { ...td, t: editVal.t, d: parseInt(editVal.d) || 0 }
          : td
      );
      commitClientUpdate({ ...sel, todos: nextTodos });
      setEditingTodo(null);
    }
  };

  const [newSocial, setNewSocial] = React.useState("");
  const addSocial = () => {
    if (newSocial.trim()) {
      commitClientUpdate({ ...sel, social: [...(sel.social || []), newSocial.trim()] });
      setNewSocial("");
    }
  };
  const removeSocial = (idx) => {
    commitClientUpdate({ ...sel, social: (sel.social || []).filter((_, i) => i !== idx) });
  };
  const normalizeFileEntry = (value) => {
    if (typeof value === "string") {
      return { name: value, summary: "", previewUrl: "", tags: [], details: [] };
    }
    return {
      kind: value?.kind || "file",
      name: value?.name || "Untitled",
      summary: value?.summary || "",
      originalUrl: value?.originalUrl || value?.previewUrl || "",
      previewUrl: value?.previewUrl || "",
      tags: Array.isArray(value?.tags) ? value.tags : [],
      details: Array.isArray(value?.details) ? value.details : [],
      parsedPreview: value?.parsedPreview || null,
      mimeType: value?.mimeType || ""
    };
  };
  if (!sel) return null;

  const commitClientUpdate = (nextClient) => {
    setSel(nextClient);
    if (typeof saveDetailClient === "function") {
      saveDetailClient(nextClient);
    }
  };

  const deleteTimelineItem = (idx) => {
    const nextLog = (sel.log || []).filter((_, logIdx) => logIdx !== idx);
    commitClientUpdate({ ...sel, log: nextLog });
    setSwipedLogIndex(null);
    if (viewingLog && sel.log?.[idx] === viewingLog) {
      setViewingLog(null);
    }
  };

  const startLogLongPress = (idx, summary) => {
    clearTimeout(logPressTimerRef.current);
    logPressTimerRef.current = setTimeout(() => {
      setEditingLogIndex(idx);
      setEditingLogSummary(summary || "");
      setSwipedLogIndex(null);
    }, 550);
  };

  const clearLogLongPress = () => clearTimeout(logPressTimerRef.current);

  const saveTimelineSummary = () => {
    if (editingLogIndex == null) return;
    const nextSummary = editingLogSummary.trim();
    const nextLog = (sel.log || []).map((item, idx) => {
      if (idx !== editingLogIndex) return item;
      return {
        ...item,
        tx: nextSummary || item.tx
      };
    });
    commitClientUpdate({ ...sel, log: nextLog });
    setEditingLogIndex(null);
    setEditingLogSummary("");
  };

  const startFileLongPress = (idx, summary) => {
    clearTimeout(filePressTimerRef.current);
    filePressTimerRef.current = setTimeout(() => {
      setEditingFileIndex(idx);
      setEditingFileSummary(summary || "");
    }, 550);
  };

  const clearFileLongPress = () => clearTimeout(filePressTimerRef.current);

  const saveFileSummary = () => {
    if (editingFileIndex == null) return;

    const nextSummary = editingFileSummary.trim();
    const nextFiles = (sel.files || []).map((item, idx) => {
      if (idx !== editingFileIndex) return item;
      if (typeof item === "string") return nextSummary || item;
      return {
        ...item,
        summary: nextSummary || item.summary
      };
    });

    commitClientUpdate({ ...sel, files: nextFiles });
    setEditingFileIndex(null);
    setEditingFileSummary("");
  };

  const removeFile = async (idx) => {
    if (typeof removeDataFileFromClient !== "function") return;
    setDeletingFileIndex(idx);
    try {
      await removeDataFileFromClient(sel.id, idx);
      if (viewingFile && normalizeFileEntry(sel.files?.[idx]).originalUrl === viewingFile.originalUrl) {
        setViewingFile(null);
      }
    } catch (err) {
      console.error("[Data] 删除资料失败:", err);
      alert(err instanceof Error ? err.message : "删除资料失败");
    } finally {
      setDeletingFileIndex(null);
    }
  };

  const handlePickScreenshot = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!attachScreenshotToClient) return;

    setUploadingScreenshot(true);
    try {
      await attachScreenshotToClient(sel.id, file);
    } catch (err) {
      console.error("[Screenshot] 上传失败:", err);
      alert(err instanceof Error ? err.message : "截图上传失败");
    } finally {
      setUploadingScreenshot(false);
      if (screenshotInputRef.current) screenshotInputRef.current.value = "";
    }
  };

  const onDetailKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      detailSend(detailText);
    }
  };

  return (
    <div className="page">
      <div className="top-spacer" />
      <div className="back-container">
        <button onClick={() => setView("cards")} className="back-btn">← back</button>
      </div>

      <div className="detail-scroll detail-scroll-flex">

        {/* ── 2. Identity ── */}
        <div className="detail-identity detail-identity-top">
          <div className="detail-name-row">
            <span className="detail-name">{sel.n}</span>
          </div>
          <div className="detail-role">{sel.co} · {sel.role}</div>
          <div className="detail-role">📞 {sel.tel || "未填写电话"}</div>
          <div className="detail-meta-row">
            <span className="meta-text">{sel.bd}</span>
            <span className="meta-dot-text">·</span>
            <span className="meta-ps">{sel.ps}</span>
            <span className="flex-spacer" />
            <div className="flex-gap-12 hp-inline">
              <div className="hp-dot" style={{ background: hpColor(sel.hp) }} />
              <span className="meta-text" style={{ color: hpColor(sel.hp) }}>{sel.hp}</span>
            </div>
          </div>
        </div>

        {/* ── 3. Traits ── */}
        <div className="detail-traits">
          <div
            className="traits-wrap"
            ref={traitsWrapRef}
            onMouseDown={() => { traitPressTimer.current = setTimeout(() => setTraitsEditing(true), 500); }}
            onMouseUp={() => clearTimeout(traitPressTimer.current)}
            onMouseLeave={() => clearTimeout(traitPressTimer.current)}
            onTouchStart={() => { traitPressTimer.current = setTimeout(() => setTraitsEditing(true), 500); }}
            onTouchEnd={() => clearTimeout(traitPressTimer.current)}
          >
            {sel.traits.map((tr, i) => (
              <span key={i} className={`trait-pill ${traitsEditing ? "trait-pill-editing" : ""}`} style={traitsEditing ? { animation: `wobble 0.25s ease-in-out ${i * 0.05}s infinite alternate` } : { animation: `slideIn 0.3s ease ${i * 0.04}s both` }}>
                {tr}
                {traitsEditing && (
                  <span
                    className="trait-delete-badge"
                    onClick={(e) => {
                      e.stopPropagation();
                      const nextTraits = sel.traits.filter((_, idx) => idx !== i);
                      commitClientUpdate({ ...sel, traits: nextTraits });
                    }}
                  >−</span>
                )}
              </span>
            ))}
          </div>
        </div>

        {/* ── TABS ── */}
        <div className="detail-tabs">
          <button onClick={() => setActiveTab("overview")} className={`detail-tab ${activeTab === "overview" ? "active" : ""}`}>Tasks</button>
          <button onClick={() => setActiveTab("timeline")} className={`detail-tab ${activeTab === "timeline" ? "active" : ""}`}>Timeline</button>
          <button onClick={() => setActiveTab("data")} className={`detail-tab ${activeTab === "data" ? "active" : ""}`}>Data</button>
        </div>

        {/* ── TABS CONTAINER WITH SLIDE ── */}
        <div
          className="tabs-container"
          onTouchStart={e => onDragStart(e.targetTouches[0].clientX)}
          onTouchMove={e => onDragMove(e.targetTouches[0].clientX)}
          onTouchEnd={onDragEnd}
          onMouseDown={e => onDragStart(e.clientX)}
          onMouseMove={e => onDragMove(e.clientX)}
          onMouseUp={onDragEnd}
          onMouseLeave={onDragEnd}
        >
          <div className="tabs-slider" style={{ transform: `translateX(-${tabIdx * (100 / 3)}%)` }}>

            {/* Slide 1: Tasks */}
            <div className="tab-slide">
              <div className="tab-slide-pad">
                {(() => {
                  const pending = sel.todos.filter(t => !t.done).sort((a, b) => a.d - b.d);
                  const done = sel.todos.filter(t => t.done);
                  // 总共最多显示 10 条：优先显示未完成，剩余名额给已完成
                  const maxTotal = 10;
                  const shownPending = pending.slice(0, maxTotal);
                  const shownDone = done.slice(0, Math.max(0, maxTotal - shownPending.length));
                  if (shownPending.length === 0 && shownDone.length === 0) {
                    return <div className="no-tasks-text">No active tasks.</div>;
                  }
                  return (
                    <div className="detail-todos-section">
                      {shownPending.map((td, i) => (
                        <div 
                          key={`p-${i}`} 
                          className="todo-item todo-item-detail"
                          onMouseDown={() => startPress(td)}
                          onMouseUp={endPress}
                          onTouchStart={() => startPress(td)}
                          onTouchEnd={endPress}
                        >
                          <div 
                            className="todo-circle" 
                            onClick={(e) => { e.stopPropagation(); const nextTodos = (sel.todos || []).map(t => t === td ? { ...t, done: true } : t); commitClientUpdate({ ...sel, todos: nextTodos }); }}
                            style={{ border: `1.5px solid ${td.d < 0 ? "#c0392b" : "rgba(0,0,0,0.12)"}`, cursor: "pointer" }} 
                          />
                          <div className="todo-text-wrap"><div className="todo-text">{td.t}</div></div>
                          <span className="todo-days" style={{ color: td.d < 0 ? "#c0392b" : "#bbb" }}>{td.d < 0 ? `-${Math.abs(td.d)}d` : `${td.d}d`}</span>
                        </div>
                      ))}
                      {shownDone.length > 0 && (
                        <div className="done-list">
                          {shownDone.map((td, i) => (
                            <div key={`d-${i}`} className="done-item done-item-flex">
                              <div 
                                className="todo-circle todo-circle-done" 
                                onClick={() => { const nextTodos = (sel.todos || []).map(t => t === td ? { ...t, done: false } : t); commitClientUpdate({ ...sel, todos: nextTodos }); }}
                              >✓</div>
                              <div className="done-item-text">{td.t}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Slide 2: Timeline */}
            <div className="tab-slide">
              <div className="tab-slide-pad">
                <div className="detail-timeline" style={{ marginTop: 0 }}>
                  {sel.log.map((l, i) => (
                    (() => {
                      const hasHistory = Array.isArray(l.history) && l.history.length > 0;
                      const chatSummary = hasHistory ? summarizeHistory(l.history) : null;
                      const displaySummary = hasHistory ? (l.tx || chatSummary.summary) : l.tx;

                      return (
                        <div key={i} className={`timeline-swipe-wrap ${swipedLogIndex === i ? "revealed" : ""}`}>
                          <div className="timeline-swipe-actions">
                            <button onClick={() => deleteTimelineItem(i)} className="timeline-delete-btn">Delete</button>
                          </div>
                          <div
                            className={`timeline-item ${hasHistory ? "timeline-item-chat" : ""}`}
                            onClick={() => hasHistory && setViewingLog(l)}
                            onTouchStart={(e) => {
                              startLogLongPress(i, displaySummary);
                              setTouchStart(e.targetTouches[0].clientX);
                              setTouchEnd(null);
                            }}
                            onTouchMove={(e) => {
                              clearLogLongPress();
                              setTouchEnd(e.targetTouches[0].clientX);
                            }}
                            onTouchEnd={() => {
                              clearLogLongPress();
                              if (touchStart != null && touchEnd != null) {
                                const dist = touchStart - touchEnd;
                                if (dist > 50) setSwipedLogIndex(i);
                                else if (dist < -30) setSwipedLogIndex(null);
                              }
                              setTouchStart(null);
                              setTouchEnd(null);
                            }}
                            onMouseDown={() => startLogLongPress(i, displaySummary)}
                            onMouseUp={clearLogLongPress}
                            onMouseLeave={clearLogLongPress}
                            style={{ cursor: hasHistory ? "pointer" : "default" }}
                          >
                            <button
                              type="button"
                              className="timeline-inline-delete"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteTimelineItem(i);
                              }}
                            >
                              ×
                            </button>
                            <div className="timeline-header">
                              <div className="timeline-dot" style={{ background: l.src.includes("微信") || l.src.includes("WeChat") || l.src.includes("WhatsApp") ? "#8b5cf6" : l.src.includes("面谈") ? "#2d6a4f" : "#3b82f6" }} />
                              <span className="timeline-date">{l.dt}</span>
                              {hasHistory && <span className="timeline-view-chat">· view chat</span>}
                            </div>
                            <div className="timeline-text" style={{ color: hasHistory ? "#333" : "#777" }}>
                              {displaySummary}
                            </div>
                            {(hasHistory || l.ai) && (
                              <div className="timeline-ai">{hasHistory ? chatSummary.detail : l.ai}</div>
                            )}
                          </div>
                        </div>
                      );
                    })()
                  ))}
                </div>
              </div>
            </div>

            {/* Slide 3: Data */}
            <div className="tab-slide">
              <div className="tab-slide-pad-bottom">
                <div className="files-list">
                  {sel.files.map((rawFile, i) => {
                    const f = normalizeFileEntry(rawFile);
                    return (
                    <div key={i} className="file-row">
                      <button
                        type="button"
                        className="file-open-btn"
                        onMouseDown={() => startFileLongPress(i, f.summary)}
                        onMouseUp={clearFileLongPress}
                        onMouseLeave={clearFileLongPress}
                        onTouchStart={() => startFileLongPress(i, f.summary)}
                        onTouchEnd={clearFileLongPress}
                        onClick={() => {
                          if (!f.originalUrl) return;
                          if (String(f.mimeType || "").startsWith("image/") || f.kind === "screenshot") {
                            setViewingFile(f);
                            return;
                          }
                          window.open(f.originalUrl, "_blank", "noopener,noreferrer");
                        }}
                        disabled={!f.originalUrl}
                      >
                      <div className="file-row-left">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                        <div className="file-row-meta">
                          <span className="file-row-name">{f.name}</span>
                          {f.summary && <span className="file-row-summary">{f.summary}</span>}
                          {f.details?.[0] && <span className="file-row-summary">{f.details[0]}</span>}
                        </div>
                      </div>
                      </button>
                      <button onClick={() => removeFile(i)} className="file-remove-btn" disabled={deletingFileIndex === i}>
                        {deletingFileIndex === i ? "…" : "✕"}
                      </button>
                    </div>
                    );
                  })}
                  {uploadingScreenshot && <div className="no-files-text">Analyzing uploaded file...</div>}
                  {sel.files.length === 0 && <div className="no-files-text">No documents yet.</div>}
                </div>

              </div>
            </div>

          </div>
        </div>
      </div>

      {/* Bottom action bar */}
      <div className="talk-btn-container" style={{ zIndex: 5 }}>
        <input
          ref={screenshotInputRef}
          type="file"
          accept="image/*,.csv,.xlsx,.xls,.doc,.docx"
          onChange={handlePickScreenshot}
          style={{ display: "none" }}
        />
        <button onClick={() => screenshotInputRef.current?.click()} className="detail-add-btn" disabled={uploadingScreenshot}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
        </button>
        <button
          onClick={() => startNewDetailSession()}
          className="talk-btn talk-btn-idle"
        >
          <div className="talk-dot" />
          {`talk about ${sel.n.split(' ')[0]}`}
        </button>
      </div>

      {/* Invisible overlay for click-outside to dismiss */}
      {detailChat && <div className="detail-chat-dismiss" onClick={closeDetailChat} />}

      {/* Detail Chat Popover */}
      {detailChat && (
        <div className="detail-chat-popover">
          <div className="detail-chat-inner">
            {detailConvos.length === 0 && !recording && (
              <div className="detail-chat-empty">
                Start chatting with the agent about {sel.n}.
              </div>
            )}
            {detailConvos.map((c, i) => (
              <div key={i} className={`chat-row ${c.r}`} style={{ marginBottom: 16 }}>
                <div className={`chat-bubble detail-chat-bubble ${c.r}`}>{c.t}</div>
              </div>
            ))}
            {detailTyping && <div className="typing-indicator" style={{ marginBottom: 16 }}><div className="typing-box">{[0, 1, 2].map(i => <div key={i} className="dot" />)}</div></div>}
            <div ref={detailRef} />
          </div>
          <div className="detail-chat-inputbar">
            <input
              value={detailText}
              onChange={(e) => setDetailText(e.target.value)}
              onKeyDown={onDetailKeyDown}
              placeholder={`Ask about ${sel.n}...`}
              className="detail-chat-input"
            />
            <button onClick={() => detailSend(detailText)} className="detail-chat-send-btn" disabled={!detailText.trim() || detailTyping}>
              Send
            </button>
          </div>
        </div>
      )}

      {/* Task Edit Floating Window */}
      {editingTodo && (
        <>
          <div onClick={saveEdit} className="edit-overlay" />
          <div className="edit-modal">
            <div className="edit-modal-title">Edit Task</div>
            
            <div className="edit-field">
              <div className="edit-field-label">TASK NAME</div>
              <input 
                autoFocus
                value={editVal.t} 
                onChange={e => setEditVal({...editVal, t: e.target.value})} 
                className="account-input edit-task-input" 
              />
            </div>

            <div>
              <div className="edit-field-label">DUE DATE</div>
              <input 
                type="date"
                value={(() => {
                  const d = new Date();
                  d.setDate(d.getDate() + parseInt(editVal.d));
                  return d.toISOString().split('T')[0];
                })()}
                onChange={e => {
                  const selectedDate = new Date(e.target.value);
                  const today = new Date();
                  today.setHours(0,0,0,0);
                  selectedDate.setHours(0,0,0,0);
                  const diff = Math.round((selectedDate - today) / 86400000);
                  setEditVal({...editVal, d: diff});
                }}
                className="edit-date-input"
              />
            </div>
            
            <button
              className="edit-delete-btn"
              onClick={() => {
                const nextTodos = (sel.todos || []).filter(t => t !== editingTodo);
                commitClientUpdate({ ...sel, todos: nextTodos });
                setEditingTodo(null);
              }}
            >
              Delete Task
            </button>

            <div className="edit-modal-hint">
              Click outside to save
            </div>
          </div>
        </>
      )}

      {/* Timeline Chat History Popover */}
      {viewingLog && (
        <>
          <div onClick={() => setViewingLog(null)} className="history-overlay" />
          <div className="history-modal">
            <div className="history-modal-header">
              <div className="history-modal-label">Interaction History</div>
              <div className="history-modal-title">{viewingLog.dt} · {viewingLog.src}</div>
            </div>
            
            <div className="history-modal-body">
              {viewingLog.history.map((c, i) => (
                <div key={i} className={`chat-row ${c.r}`} style={{ marginBottom: 16 }}>
                  <div className={`history-chat-bubble ${c.r === 'ai' ? 'history-chat-bubble-ai' : 'history-chat-bubble-user'}`}>{c.t}</div>
                </div>
              ))}
            </div>
            
            <div className="history-modal-footer">
              Tap outside to dismiss
            </div>
          </div>
        </>
      )}

      {viewingFile && (
        <>
          <div onClick={() => setViewingFile(null)} className="history-overlay" />
          <div className="image-modal">
            <div className="history-modal-header">
              <div className="history-modal-label">Screenshot</div>
              <div className="history-modal-title">{viewingFile.name}</div>
            </div>
            <div className="image-modal-body">
              <img src={viewingFile.originalUrl} alt={viewingFile.name} className="image-modal-img" />
            </div>
          </div>
        </>
      )}

      {editingLogIndex != null && (
        <>
          <div onClick={saveTimelineSummary} className="edit-overlay" />
          <div className="edit-modal">
            <div className="edit-modal-title">Edit Timeline Summary</div>
            <div className="edit-field">
              <div className="edit-field-label">SUMMARY</div>
              <input
                autoFocus
                value={editingLogSummary}
                onChange={(e) => setEditingLogSummary(e.target.value)}
                className="account-input edit-task-input"
              />
            </div>
            <div className="edit-modal-hint">
              Click outside to save
            </div>
          </div>
        </>
      )}

      {editingFileIndex != null && (
        <>
          <div onClick={saveFileSummary} className="edit-overlay" />
          <div className="edit-modal">
            <div className="edit-modal-title">Edit Data Summary</div>
            <div className="edit-field">
              <div className="edit-field-label">SUMMARY</div>
              <input
                autoFocus
                value={editingFileSummary}
                onChange={(e) => setEditingFileSummary(e.target.value)}
                className="account-input edit-task-input"
              />
            </div>
            <div className="edit-modal-hint">
              Click outside to save
            </div>
          </div>
        </>
      )}
    </div>
  );
}
