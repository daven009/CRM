import React, { useRef, useEffect, useState } from "react";

export default function VoiceView({
  setView, setSettingsTab, setRecording, recording, userText, setUserText,
  sendMsg, aiTyping, convos, events, newConvo, C, markDone, handleTask, activeTask,
  addContact, setConvos
}) {
  const scrollRef = useRef(null);
  const [topIndex, setTopIndex] = useState(0);

  // Inline contact card state
  const [contactCard, setContactCard] = useState(null); // { name, company, msgIndex }

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [convos]);

  // Check if the latest AI message has a new_contact action
  useEffect(() => {
    if (convos.length > 0) {
      const last = convos[convos.length - 1];
      if (last.r === "ai" && last.action?.type === "new_contact" && !contactCard) {
        setContactCard({
          name: last.action.name,
          company: last.action.company || "",
          msgIndex: convos.length - 1
        });
      }
    }
  }, [convos]);

  const confirmContact = () => {
    if (!contactCard || !contactCard.name.trim()) return;
    const created = addContact(contactCard.name.trim(), contactCard.company.trim());
    // Replace the AI message with a confirmation
    setConvos(p => {
      const next = [...p];
      next[contactCard.msgIndex] = {
        ...next[contactCard.msgIndex],
        t: `✅ 已成功创建联系人「${created.n}」${created.co !== "Unknown" ? ` — ${created.co}` : ""}。你可以在 Cards 列表中找到他/她。`,
        action: null
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
          t: "好的，已取消创建。",
          action: null
        };
      }
      return next;
    });
    setContactCard(null);
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
            <button onClick={() => markDone(top.c.id, top.tx)} className="action-btn text-green">done</button>
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
          {c.r === "ai" && c.action?.type === "new_contact" && contactCard && contactCard.msgIndex === i && (
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
        </React.Fragment>)}
        {aiTyping && <div className="typing-indicator"><div className="typing-box">{[0, 1, 2].map(i => <div key={i} className="dot" />)}</div></div>}
        
        {/* Contextual Action Pill */}
        {!aiTyping && (activeTask || (convos.length > 0 && convos[convos.length - 1].action?.type === "mark_done")) && (
          <div className="action-pill-wrapper">
            <button 
              onClick={() => {
                if (activeTask) markDone(activeTask.client, activeTask.todo);
                else markDone(convos[convos.length - 1].action.client, convos[convos.length - 1].action.todo);
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
          <button onMouseDown={() => setRecording(true)} onMouseUp={() => { setRecording(false); sendMsg("今天该联系谁") }} onMouseLeave={() => setRecording(false)} onTouchStart={() => setRecording(true)} onTouchEnd={() => { setRecording(false); sendMsg("今天该联系谁") }} className={`record-btn ${recording ? 'active' : 'inactive'}`}>
            <div className={`record-inner ${recording ? 'active' : 'inactive'}`} />
          </button>
          <div className="record-side-slot record-side-slot-right">
            {convos.length > 0 && (
              <button onClick={newConvo} className="voice-new-bottom-btn text-mono-12 text-red">{activeTask ? "close" : "new"}</button>
            )}
          </div>
        </div>
        <div className="record-hint">{recording ? "listening..." : "hold to speak"}</div>
      </div>

      {/* Bottom tab */}
      <div className="bottom-tab">
        <button className="tab-btn active">voice</button>
        <button onClick={() => setView("cards")} className="tab-btn">cards</button>
      </div>
    </div>
  );
}
