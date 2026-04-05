import React from "react";

export default function DetailView({
  sel, setSel, setView, hpColor, detailChat, setDetailChat, detailConvos, setDetailConvos,
  detailText, setDetailText, detailTyping, detailSend, startNewDetailSession, closeDetailChat, recording, setRecording, detailRef
}) {
  const msgIdx = React.useRef(0);
  const [activeTab, setActiveTab] = React.useState("overview");
  const tabIdx = activeTab === "overview" ? 0 : activeTab === "timeline" ? 1 : 2;
  const [touchStart, setTouchStart] = React.useState(null);
  const [touchEnd, setTouchEnd] = React.useState(null);
  const [isDragging, setIsDragging] = React.useState(false);

  const [viewingLog, setViewingLog] = React.useState(null);

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
      editingTodo.t = editVal.t;
      editingTodo.d = parseInt(editVal.d) || 0;
      setSel({ ...sel });
      setEditingTodo(null);
    }
  };

  const [newSocial, setNewSocial] = React.useState("");
  const addSocial = () => {
    if (newSocial.trim()) { sel.social = [...sel.social, newSocial.trim()]; setSel({ ...sel }); setNewSocial(""); }
  };
  const removeSocial = (idx) => { sel.social = sel.social.filter((_, i) => i !== idx); setSel({ ...sel }); };
  const mockUpload = () => { sel.files = [...sel.files, `Document_${Math.floor(Math.random() * 900 + 100)}.pdf`]; setSel({ ...sel }); };
  const removeFile = (idx) => { sel.files = sel.files.filter((_, i) => i !== idx); setSel({ ...sel }); };

  if (!sel) return null;

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
          <div className="traits-wrap">
            {sel.traits.map((tr, i) => <span key={i} className="trait-pill" style={{ animation: `slideIn 0.3s ease ${i * 0.04}s both` }}>{tr}</span>)}
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
                {sel.todos.filter(t => !t.done).length > 0 && <div className="detail-todos-section">
                  {sel.todos.filter(t => !t.done).sort((a, b) => a.d - b.d).map((td, i) => (
                    <div 
                      key={i} 
                      className="todo-item todo-item-detail"
                      onMouseDown={() => startPress(td)}
                      onMouseUp={endPress}
                      onTouchStart={() => startPress(td)}
                      onTouchEnd={endPress}
                    >
                      <div 
                        className="todo-circle" 
                        onClick={(e) => { e.stopPropagation(); td.done = true; setSel({ ...sel }); }}
                        style={{ border: `1.5px solid ${td.d < 0 ? "#c0392b" : "rgba(0,0,0,0.12)"}`, cursor: "pointer" }} 
                      />
                      <div className="todo-text-wrap"><div className="todo-text">{td.t}</div></div>
                      <span className="todo-days" style={{ color: td.d < 0 ? "#c0392b" : "#bbb" }}>{td.d < 0 ? `-${Math.abs(td.d)}d` : `${td.d}d`}</span>
                    </div>
                  ))}
                  {sel.todos.filter(t => t.done).length > 0 && (
                    <div className="done-list">
                      {sel.todos.filter(t => t.done).map((td, i) => (
                        <div key={i} className="done-item done-item-flex">
                          <div 
                            className="todo-circle todo-circle-done" 
                            onClick={() => { td.done = false; setSel({ ...sel }); }}
                          >✓</div>
                          <div className="done-item-text">{td.t}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>}
                {sel.todos.filter(t => !t.done).length === 0 && <div className="no-tasks-text">No active tasks.</div>}
              </div>
            </div>

            {/* Slide 2: Timeline */}
            <div className="tab-slide">
              <div className="tab-slide-pad">
                <div className="detail-timeline" style={{ marginTop: 0 }}>
                  {sel.log.map((l, i) => (
                    <div 
                      key={i} 
                      className="timeline-item" 
                      onClick={() => l.history && setViewingLog(l)}
                      style={{ cursor: l.history ? "pointer" : "default" }}
                    >
                      <div className="timeline-header">
                        <div className="timeline-dot" style={{ background: l.src.includes("微信") || l.src.includes("WeChat") || l.src.includes("WhatsApp") ? "#8b5cf6" : l.src.includes("面谈") ? "#2d6a4f" : "#3b82f6" }} />
                        <span className="timeline-date">{l.dt}</span>
                        {l.history && <span className="timeline-view-chat">· view chat</span>}
                      </div>
                      <div className="timeline-text" style={{ color: l.history ? "#333" : "#777" }}>{l.tx}</div>
                      {l.ai && <div className="timeline-ai">{l.ai}</div>}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Slide 3: Data */}
            <div className="tab-slide">
              <div className="tab-slide-pad-bottom">
                <div className="files-list">
                  {sel.files.map((f, i) => (
                    <div key={i} className="file-row">
                      <div className="file-row-left">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                        <span className="file-row-name">{f}</span>
                      </div>
                      <button onClick={() => removeFile(i)} className="file-remove-btn">✕</button>
                    </div>
                  ))}
                  {sel.files.length === 0 && <div className="no-files-text">No documents yet.</div>}
                </div>

              </div>
            </div>

          </div>
        </div>
      </div>

      {/* Bottom action bar */}
      <div className="talk-btn-container" style={{ zIndex: 5 }}>
        <button onClick={mockUpload} className="detail-add-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
        </button>
        <button
          onMouseDown={() => { startNewDetailSession(); setRecording(true); }}
          onMouseUp={() => { setRecording(false); detailSend(); }}
          onMouseLeave={() => setRecording(false)}
          onTouchStart={(e) => { e.preventDefault(); startNewDetailSession(); setRecording(true); }}
          onTouchEnd={(e) => { e.preventDefault(); setRecording(false); detailSend(); }}
          className={`talk-btn ${recording ? "talk-btn-recording" : "talk-btn-idle"}`}
        >
          <div className="talk-dot" style={{ animation: recording ? "pulse 1s infinite" : "none" }} />
          {recording ? "listening..." : `hold to talk about ${sel.n.split(' ')[0]}`}
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
                Hold the button below to start talking.
              </div>
            )}
            {detailConvos.length === 0 && recording && (
              <div className="detail-chat-listening">
                ...Listening...
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
    </div>
  );
}
