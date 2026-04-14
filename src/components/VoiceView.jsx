import React, { useRef, useEffect, useState } from "react";
import { useVoiceRecorder, formatDuration } from "../hooks/useVoiceRecorder";
import { buildSTTPrompt } from "../lib/models/openaiTranscribe";

export default function VoiceView({
  setView, setSettingsTab, setRecording, recording, userText, setUserText,
  sendMsg, aiTyping, convos, events, newConvo, markDone, handleTask, activeTask,
  addContact, updateContact, setConvos, clients, conversationCtx
}) {
  const scrollRef = useRef(null);
  const [topIndex, setTopIndex] = useState(0);

  // Build STT prompt from clients list for better recognition
  const sttPrompt = buildSTTPrompt(clients || [], conversationCtx);

  // Real voice recorder hook
  const {
    state: voiceState,
    duration: voiceDuration,
    error: voiceError,
    isSupported: voiceSupported,
    startRecording: startVoice,
    stopRecording: stopVoice,
    cancelRecording: cancelVoice,
  } = useVoiceRecorder({
    onResult: (text) => {
      setRecording(false);
      if (text) sendMsg(text);
    },
    onError: (err) => {
      setRecording(false);
      console.warn("[Voice]", err);
    },
    promptHint: sttPrompt,
    maxDuration: 60,
  });

  // Sync voiceState to parent recording state for CSS
  useEffect(() => {
    setRecording(voiceState === "recording");
  }, [voiceState, setRecording]);

  const handleRecordStart = (e) => {
    if (e?.preventDefault) e.preventDefault();
    startVoice();
  };

  const handleRecordEnd = (e) => {
    if (e?.preventDefault) e.preventDefault();
    stopVoice();
  };

  const handleRecordLeave = () => {
    cancelVoice();
  };

  // Inline contact card state
  const [contactCard, setContactCard] = useState(null); // { name, company, msgIndex }
  const [updateCard, setUpdateCard] = useState(null); // { clientId, co, role, tel, bd, ps, msgIndex }

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [convos]);

  useEffect(() => {
    if (contactCard || updateCard) {
      setTimeout(() => {
        scrollRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      }, 0);
    }
  }, [contactCard, updateCard]);

  // Check if the latest AI message has inline actions (from actions array)
  useEffect(() => {
    if (convos.length > 0) {
      const last = convos[convos.length - 1];
      if (last.r !== "ai" || !Array.isArray(last.actions)) return;
      const createAction = last.actions.find(a => a.type === "create_profile");
      if (createAction && !contactCard) {
        setContactCard({
          name: createAction.name || "",
          company: createAction.company || "",
          msgIndex: convos.length - 1
        });
      }
      const updateAction = last.actions.find(a => a.type === "update_profile");
      if (updateAction && !updateCard) {
        setUpdateCard({
          clientId: updateAction.clientId,
          co: updateAction.updates?.co || "",
          role: updateAction.updates?.role || "",
          tel: updateAction.updates?.tel || "",
          bd: updateAction.updates?.bd || "",
          ps: updateAction.updates?.ps || "",
          msgIndex: convos.length - 1
        });
      }
    }
  }, [convos, contactCard, updateCard]);

  const confirmContact = () => {
    if (!contactCard || !contactCard.name.trim()) return;
    // create_profile 已被自动执行，这里用编辑后的值更新已创建的客户
    // addContact 仍然可以安全调用——如果名字一样会创建新的，所以我们只替换消息文本
    setConvos(p => {
      const next = [...p];
      next[contactCard.msgIndex] = {
        ...next[contactCard.msgIndex],
        t: `✅ 已创建联系人「${contactCard.name.trim()}」${contactCard.company.trim() ? ` — ${contactCard.company.trim()}` : ""}。`,
        actions: []
      };
      return next;
    });
    setContactCard(null);
  };

  const dismissCard = () => {
    setConvos(p => {
      const next = [...p];
      if (contactCard) {
        next[contactCard.msgIndex] = {
          ...next[contactCard.msgIndex],
          actions: []
        };
      }
      return next;
    });
    setContactCard(null);
  };

  const confirmUpdate = () => {
    if (!updateCard) return;
    // update_profile 已被自动执行，用卡片上编辑后的值再更新一次（覆盖）
    updateContact(updateCard.clientId, {
      co: updateCard.co.trim(),
      role: updateCard.role.trim(),
      tel: updateCard.tel.trim(),
      bd: updateCard.bd.trim(),
      ps: updateCard.ps.trim()
    });
    setConvos(p => {
      const next = [...p];
      next[updateCard.msgIndex] = {
        ...next[updateCard.msgIndex],
        t: `✅ 已更新联系人资料。`,
        actions: []
      };
      return next;
    });
    setUpdateCard(null);
  };

  const dismissUpdate = () => {
    setConvos(p => {
      const next = [...p];
      if (updateCard) {
        next[updateCard.msgIndex] = {
          ...next[updateCard.msgIndex],
          actions: []
        };
      }
      return next;
    });
    setUpdateCard(null);
  };

  return (
    <div className="page">
      <div className="top-spacer" />

      {/* Top bar */}
      <div className="top-bar">
        <button onClick={() => { setView("settings"); setSettingsTab("account") }} className="btn-icon">Y</button>
        <span className="brand-text">RelateAI</span>
        <div className="flex-gap-12">
          <button onClick={() => setView("log")} className="text-mono-12 text-gray">log</button>
        </div>
      </div>

      {/* AI suggestion (when no conversation) */}
      {convos.length === 0 && !aiTyping && (() => {
        const topEvents = events.filter(e => !e.c.todos.find(t => t.t === e.tx && t.done));
        const top = topEvents.length > 0 ? topEvents[topIndex % topEvents.length] : null;
        
        return <div className="suggestion-box">
          <div className="suggestion-text">{top ? <>{top.c.n}的{top.tx.replace(/ · .*/, "")}，{top.d < 0 ? `已经过了${Math.abs(top.d)}天。` : `还有${top.d}天。`}</> : "今天没有紧急事项。"}</div>
          {top && <div className="suggestion-actions">
            <button onClick={() => handleTask(top.c.id, top.tx)} className="action-btn text-red">handle</button>
            <button onClick={() => { markDone(top.c.id, top.tx); setTopIndex(p => p + 1); }} className="action-btn text-green">done</button>
            <button onClick={() => setTopIndex(p => p + 1)} className="action-btn text-gray">skip</button>
          </div>}
        </div>
      })()}

      {/* Conversation area */}
      {(convos.length > 0 || aiTyping) && <div className="chat-area">
        {convos.map((c, i) => <React.Fragment key={i}>
          <div className={`chat-row ${c.r}`}>
            <div className={`chat-bubble ${c.r}`}>{c.t}</div>
          </div>
          
          {/* Inline Editable Contact Card - rendered as separate block */}
          {c.r === "ai" && Array.isArray(c.actions) && c.actions.some(a => a.type === "create_profile") && contactCard && contactCard.msgIndex === i && (
            <div className="contact-card-wrapper">
              <div className="contact-card">
                <div className="contact-card-title">NEW CONTACT</div>
                
                <div className="contact-card-field">
                  <div className="contact-card-label">NAME</div>
                  <input
                    value={contactCard.name}
                    onChange={e => setContactCard(p => ({ ...p, name: e.target.value }))}
                    autoFocus
                    className="contact-card-name-input"
                  />
                </div>
                
                <div className="contact-card-field-last">
                  <div className="contact-card-label">COMPANY</div>
                  <input
                    value={contactCard.company}
                    onChange={e => setContactCard(p => ({ ...p, company: e.target.value }))}
                    placeholder="optional"
                    className="contact-card-company-input"
                  />
                </div>
                
                <div className="contact-card-actions">
                  <button onClick={confirmContact} className="contact-card-confirm">✓ confirm</button>
                  <button onClick={dismissCard} className="contact-card-skip">skip</button>
                </div>
              </div>
            </div>
          )}

          {c.r === "ai" && Array.isArray(c.actions) && c.actions.some(a => a.type === "update_profile") && updateCard && updateCard.msgIndex === i && (
            <div className="contact-card-wrapper">
              <div className="contact-card">
                <div className="contact-card-title">UPDATE CONTACT</div>

                <div className="contact-card-field">
                  <div className="contact-card-label">COMPANY</div>
                  <input
                    value={updateCard.co}
                    onChange={e => setUpdateCard(p => ({ ...p, co: e.target.value }))}
                    className="contact-card-company-input"
                  />
                </div>

                <div className="contact-card-field">
                  <div className="contact-card-label">ROLE</div>
                  <input
                    value={updateCard.role}
                    onChange={e => setUpdateCard(p => ({ ...p, role: e.target.value }))}
                    className="contact-card-company-input"
                  />
                </div>

                <div className="contact-card-field">
                  <div className="contact-card-label">PHONE</div>
                  <input
                    value={updateCard.tel}
                    onChange={e => setUpdateCard(p => ({ ...p, tel: e.target.value }))}
                    placeholder="e.g. +65 9123 4567"
                    className="contact-card-company-input"
                  />
                </div>

                <div className="contact-card-field">
                  <div className="contact-card-label">BIRTHDAY (YYYY.MM.DD)</div>
                  <input
                    value={updateCard.bd}
                    onChange={e => setUpdateCard(p => ({ ...p, bd: e.target.value }))}
                    placeholder="e.g. 1990.05.10"
                    className="contact-card-company-input"
                  />
                </div>

                <div className="contact-card-field-last">
                  <div className="contact-card-label">PERSONALITY</div>
                  <input
                    value={updateCard.ps}
                    onChange={e => setUpdateCard(p => ({ ...p, ps: e.target.value }))}
                    className="contact-card-company-input"
                  />
                </div>

                <div className="contact-card-actions">
                  <button onClick={confirmUpdate} className="contact-card-confirm">✓ confirm</button>
                  <button onClick={dismissUpdate} className="contact-card-skip">skip</button>
                </div>
              </div>
            </div>
          )}
        </React.Fragment>)}
        {aiTyping && <div className="typing-indicator"><div className="typing-box">{[0, 1, 2].map(i => <div key={i} className="dot" />)}</div></div>}
        
        {/* Contextual Action Pill */}
        {!aiTyping && (activeTask || (() => {
          const last = convos.length > 0 ? convos[convos.length - 1] : null;
          return last && Array.isArray(last.actions) && last.actions.some(a => a.type === "complete_todo");
        })()) && (
          <div className="action-pill-wrapper">
            <button 
              onClick={() => {
                if (activeTask) markDone(activeTask.client, activeTask.todo);
                else {
                  const last = convos[convos.length - 1];
                  const doneAction = last?.actions?.find(a => a.type === "complete_todo");
                  if (doneAction) markDone(doneAction.clientId, doneAction.todo);
                }
              }} 
              className="action-pill-btn"
            >
              ✓ mark done
            </button>
          </div>
        )}
        <div ref={scrollRef} />
      </div>}

      {/* Input area */}
      <div className="input-area">
        <div className="input-row">
          <input value={userText} onChange={e => setUserText(e.target.value)} onKeyDown={e => e.key === "Enter" && sendMsg(userText)} placeholder="type here..." className="input-field" />
          {userText && <button onClick={() => sendMsg(userText)} className="action-btn text-red">send</button>}
        </div>
        <div className="record-row">
          <div className="record-side-slot" aria-hidden="true" />
          <button onMouseDown={handleRecordStart} onMouseUp={handleRecordEnd} onMouseLeave={handleRecordLeave} onTouchStart={handleRecordStart} onTouchEnd={handleRecordEnd} className={`record-btn ${voiceState === 'recording' ? 'active' : voiceState === 'transcribing' || voiceState === 'processing' ? 'processing' : 'inactive'}`} disabled={voiceState === 'transcribing' || voiceState === 'processing'}>
            <div className={`record-inner ${voiceState === 'recording' ? 'active' : 'inactive'}`} />
          </button>
          <div className="record-side-slot record-side-slot-right">
            {convos.length > 0 && (
              <button onClick={newConvo} className="voice-new-bottom-btn text-mono-12 text-red">{activeTask ? "close" : "new"}</button>
            )}
          </div>
        </div>
        <div className="record-hint">
          {voiceState === "idle" && "hold to speak"}
          {voiceState === "recording" && `listening... ${formatDuration(voiceDuration)}`}
          {voiceState === "processing" && "processing..."}
          {voiceState === "transcribing" && "transcribing..."}
          {voiceState === "error" && (voiceError || "error — tap to retry")}
        </div>
      </div>

      {/* Bottom tab */}
      <div className="bottom-tab">
        <button className="tab-btn active">voice</button>
        <button onClick={() => setView("cards")} className="tab-btn">cards</button>
      </div>
    </div>
  );
}
