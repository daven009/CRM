import React, { useState } from "react";
import { C, WEEKDAYS, MONTH_NAMES } from "../data/mockData";

export default function LogView({ setView, history, logDate, setLogDate, onBack }) {
  // Start at March 2024 to match our '03.xx' mock dates
  const [currentMonth, setCurrentMonth] = useState(new Date(2024, 2, 1)); 
  const [selectedDay, setSelectedDay] = useState("03.21");

  const formatMMDD = (month, day) => {
    const mm = String(month + 1).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    return `${mm}.${dd}`;
  };

  const getBirthdayMMDD = (bd) => {
    if (!bd) return "";
    const val = String(bd).trim();
    const ymd = val.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
    if (ymd) return `${String(ymd[2]).padStart(2, "0")}.${String(ymd[3]).padStart(2, "0")}`;

    const md = val.match(/^(\d{1,2})[./-](\d{1,2})$/);
    if (md) return `${String(md[1]).padStart(2, "0")}.${String(md[2]).padStart(2, "0")}`;

    return "";
  };

  const getDaysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year, month) => new Date(year, month, 1).getDay(); // 0 = Sunday

  const generateCalendar = () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = getFirstDayOfMonth(year, month);
    
    // Prepare ToDos dynamically based on today's OS date so `d` offsets map properly
    const todayObj = new Date();
    todayObj.setHours(0,0,0,0);
    const allTodos = [];
    C.forEach(client => {
      client.todos.forEach(td => {
        const targetDate = new Date(todayObj.getTime() + td.d * 24 * 60 * 60 * 1000);
        const dateStr = `${String(targetDate.getMonth() + 1).padStart(2, '0')}.${String(targetDate.getDate()).padStart(2, '0')}`;
        allTodos.push({ clientName: client.n, title: td.t, d: td.d, done: td.done, dateStr, convos: td.convos || [] });
      });
    });

    let days = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) {
      const dateStr = formatMMDD(month, i);
      const dayLogs = history.filter(h => h.date === dateStr && (h.year || 2024) === year);
      const dayTodos = allTodos.filter(td => td.dateStr === dateStr);
      days.push({ day: i, dateStr, logs: dayLogs, todos: dayTodos });
    }
    return days;
  };

  const calendarDays = generateCalendar();
  
  const anniversaryClients = C.filter(client => client.bd && getBirthdayMMDD(client.bd) === selectedDay);
  const selectedDayData = calendarDays.find(d => d && d.dateStr === selectedDay);
  const dayTodosDisplay = selectedDayData ? selectedDayData.todos.map((td, idx) => ({
    id: `todo-${td.clientName}-${idx}`,
    isTodo: true,
    time: td.done ? "DONE" : (td.d < 0 ? "OVERDUE" : (td.d === 0 ? "TODAY" : "UPCOMING")),
    clients: [td.clientName],
    summary: `${td.title} ${td.d < 0 && !td.done ? `(逾期 ${Math.abs(td.d)} 天)` : ""}`,
    date: selectedDay,
    done: td.done,
    convos: td.convos || []
  })) : [];

  const displayLogs = [
    ...anniversaryClients.map(c => ({
      isAnniversary: true,
      time: "ANNIVERSARY",
      clients: [c.n],
      summary: `🎂 ${c.n} 的关键生日 / 纪念日`,
      date: selectedDay,
      convos: []
    })),
    ...dayTodosDisplay,
    ...history.filter(h => h.date === selectedDay && (h.year || 2024) === currentMonth.getFullYear())
  ];
  const selLog = displayLogs.find(h => (h.id || (h.date + h.time)) === logDate);

  const prevMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  const nextMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));

  return (
    <div className="page" style={{ background: "#faf9f7" }}>
      <div className="top-spacer log-top-spacer" />
      <div className="log-header" style={{ paddingBottom: 8 }}>
        <button onClick={() => (onBack ? onBack() : setView("voice"))} className="back-btn">← back</button>
        <span className="log-title">ACTIVITY LOG</span>
        <div style={{ width: 40 }} />
      </div>

      {/* Calendar Header */}
      <div className="log-calendar-header">
        <button onClick={prevMonth} className="back-btn log-nav-btn">{"<"}</button>
        <div className="log-month-title">{MONTH_NAMES[currentMonth.getMonth()]} {currentMonth.getFullYear()}</div>
        <button onClick={nextMonth} className="back-btn log-nav-btn">{">"}</button>
      </div>

      {/* Calendar Grid */}
      <div className="log-calendar-wrap">
        <div className="log-weekdays">
          {WEEKDAYS.map((w, i) => <div key={i} className="log-weekday">{w}</div>)}
        </div>
        <div className="log-days-grid">
          {calendarDays.map((d, i) => {
            if (!d) return <div key={`empty-${i}`} />;
            
            const isSelected = selectedDay === d.dateStr;
            const dots = [];
            
            const hasAnniversary = C.some(client => client.bd && getBirthdayMMDD(client.bd) === d.dateStr);
            if (hasAnniversary) {
              dots.push(<div key="anni" className="log-dot" style={{ background: "#c0392b" }} />);
            }
            
            if (d.todos.some(td => td.d < 0 && !td.done)) {
              dots.push(<div key="todo-overdue" className="log-dot" style={{ background: "#f97316" }} />);
            } else if (d.todos.some(td => !td.done)) {
              dots.push(<div key="todo-upcoming" className="log-dot" style={{ background: "#fbbf24" }} />);
            } else if (d.todos.some(td => td.done)) {
              dots.push(<div key="todo-done" className="log-dot" style={{ background: "#2d6a4f" }} />);
            }

            const count = Math.min(d.logs.length, 3 - dots.length);
            for (let k = 0; k < count; k++) {
              const l = d.logs[k];
              const dotColor = l.clients && l.clients.length > 0 ? "#2d6a4f" : "#3b82f6";
              dots.push(<div key={`log-${k}`} className="log-dot" style={{ background: dotColor }} />);
            }

            return (
              <div key={i} className="log-day-cell" onClick={() => setSelectedDay(d.dateStr)}>
                <div className={`log-day-num ${isSelected ? "selected" : "unselected"}`}>
                  {d.day}
                </div>
                <div className="log-day-dots">
                  {dots}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Log List for Selected Day */}
      <div className="log-scroll log-scroll-border">
        <div className="section-label" style={{ marginBottom: 12 }}>{selectedDay} LOGS</div>
        {displayLogs.length === 0 ? <div className="log-empty" style={{ marginTop: 20 }}>No activity on this date.</div> : displayLogs.map((h, i) => (
          <div key={i}>
            <button onClick={() => !h.isAnniversary && setLogDate(h.id || (h.date + h.time))} className="log-btn">
              <div className="log-meta-row" style={{ marginBottom: 6 }}>
                <span className="log-date" style={{ color: h.isAnniversary ? "#c0392b" : (h.done ? "#2d6a4f" : (h.isTodo && h.time==="OVERDUE" ? "#f97316" : "#999")) }}>{h.time}</span>
                {h.clients.length > 0 ? (
                  <span className="log-clients" style={{ color: h.isAnniversary ? "#c0392b" : (h.isTodo && !h.done ? "#f97316" : "#1a1a1a") }}>@{h.clients.join(", ")}</span>
                ) : (
                  <span className="log-clients" style={{ color: "#3b82f6" }}>Copilot Assistant</span>
                )}
              </div>
              <div className="log-summary log-summary-overflow" style={{ color: h.isAnniversary ? "#c0392b" : (h.done ? "#999" : "#444") }}>
                {h.summary.replace(/\n|•/g, " ")}
              </div>
            </button>
          </div>
        ))}
      </div>

      {/* Glass Overlay (Log Details) */}
      {selLog && (
        <div className="glass-overlay log-glass-overlay">
          <div className="top-spacer" />
          
          <div className="glass-header">
            <div className="glass-name">{selLog.date} · {selLog.time}</div>
            <button onClick={() => setLogDate(null)} className="back-btn">close</button>
          </div>

          {/* Top 1/3: Summary */}
          <div className={`log-glass-summary ${selLog.convos && selLog.convos.length > 0 ? "log-glass-summary-bordered" : ""}`}>
            <div className="section-label" style={{ marginBottom: 12 }}>SUMMARY</div>
            {selLog.clients.length > 0 && (
              <div className="log-glass-clients">
                {selLog.clients.map((c, i) => <span key={i} className="trait-pill log-glass-client-pill">@{c}</span>)}
              </div>
            )}
            <div className="log-glass-body">{selLog.summary}</div>
          </div>

          {/* Bottom 2/3: Original Conversation */}
          {selLog.convos && selLog.convos.length > 0 && (
            <div className="log-glass-transcript">
              <div className="section-label" style={{ marginBottom: 20 }}>TRANSCRIPT</div>
              {selLog.convos.map((c, i) => (
                <div key={i} className={`chat-row ${c.r}`} style={{ marginBottom: 16 }}>
                  <div className={`chat-bubble ${c.r}`} style={{ maxWidth: "85%" }}>
                    {c.t}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
