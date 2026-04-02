import React, { useState } from "react";

export default function CardsView({ C, cardSort, setCardSort, setSel, setView, onOpenLog }) {
  const [search, setSearch] = useState("");
  return (
    <div className="page">
      <div className="top-spacer" />

      <div className="top-bar">
        <div className="cards-top-left-spacer" aria-hidden="true" />
        <span className="brand-text">RelateAI</span>
        <div className="flex-gap-12">
          <button onClick={() => (onOpenLog ? onOpenLog() : setView("log"))} className="text-mono-12 text-gray">log</button>
        </div>
      </div>

      <div className="search-container">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="search" className="search-input" />
      </div>
      <div className="sort-toggle">
        {[{ id: "priority", label: "建议" }, { id: "alpha", label: "姓名" }].map(s => (
          <button key={s.id} onClick={() => setCardSort(s.id)} className={`sort-btn ${cardSort === s.id ? 'active' : 'inactive'}`}>
            {s.label}
          </button>
        ))}
      </div>

      <div className="card-list">
        {[...C].sort((a, b) => {
          if (cardSort === "alpha") return a.n.localeCompare(b.n, "zh");
          const aU = a.todos.filter(t => !t.done && t.d < 0).length;
          const bU = b.todos.filter(t => !t.done && t.d < 0).length;
          if (aU !== bU) return bU - aU;
          const aU2 = a.todos.filter(t => !t.done).length;
          const bU2 = b.todos.filter(t => !t.done).length;
          if (aU2 !== bU2) return bU2 - aU2;
          return a.hp - b.hp;
        }).filter(c => c.n.includes(search) || c.co.includes(search)).map((c, i) => {
          const urgent = c.todos.filter(t => !t.done).sort((a, b) => a.d - b.d)[0];
          return (
            <button key={i} onClick={() => { setSel(c); setView("detail") }} className="card-item" style={{ animation: `fadeUp 0.3s ease ${i * 0.04}s both` }}>
              <div className="card-avatar">{c.n.slice(0, 1)}</div>
              <div className="card-content">
                <div className="card-header"><span className="card-name">{c.n}</span><span className="card-co">{c.co.split(" ")[0]}</span></div>
                <div className="card-status" style={{ color: urgent && urgent.d < 0 ? "#c0392b" : "#999" }}>
                  {urgent ? `${urgent.t.slice(0, 12)} · ${urgent.d < 0 ? `${Math.abs(urgent.d)}d overdue` : `${urgent.d}d`}` : "All good"}
                </div>
              </div>
              <div className="hp-dot" style={{ background: c.hp >= 75 ? "#2d6a4f" : c.hp >= 45 ? "#b45309" : "#c0392b" }} />
            </button>
          )
        })}
      </div>

      {/* Bottom tab */}
      <div className="bottom-tab">
        <button onClick={() => setView("voice")} className="tab-btn">voice</button>
        <button className="tab-btn active">cards</button>
      </div>
    </div>
  );
}
