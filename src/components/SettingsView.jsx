import React, { useEffect, useState } from "react";

const SETTINGS_KEY = "crm.settings.v1";

const DEFAULT_DOMAIN = "";
const DEFAULT_KEYWORDS = [];
const DEFAULT_KNOWLEDGE_FILES = [];

const loadSettings = () => {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      return {
        domain: DEFAULT_DOMAIN,
        keywords: DEFAULT_KEYWORDS,
        knowledgeFiles: DEFAULT_KNOWLEDGE_FILES
      };
    }
    const parsed = JSON.parse(raw);
    return {
      domain: parsed.domain || DEFAULT_DOMAIN,
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : DEFAULT_KEYWORDS,
      knowledgeFiles: Array.isArray(parsed.knowledgeFiles) ? parsed.knowledgeFiles : DEFAULT_KNOWLEDGE_FILES
    };
  } catch {
    return {
      domain: DEFAULT_DOMAIN,
      keywords: DEFAULT_KEYWORDS,
      knowledgeFiles: DEFAULT_KNOWLEDGE_FILES
    };
  }
};

export default function SettingsView({ setView, settingsTab, setSettingsTab, aiPrompt, setAiPrompt }) {
  const initial = loadSettings();
  const [domain, setDomain] = useState(initial.domain);
  const [newUrl, setNewUrl] = useState("");
  
  const [knowledgeFiles, setKnowledgeFiles] = useState(initial.knowledgeFiles);

  const addUrl = () => {
    if (newUrl.trim() && !knowledgeFiles.some(f => f.name === newUrl)) {
      setKnowledgeFiles([{ name: newUrl, type: "url", size: "web", active: true }, ...knowledgeFiles]);
      setNewUrl("");
    }
  };

  const [keywords, setKeywords] = useState(DEFAULT_KEYWORDS);
  const [newKeyword, setNewKeyword] = useState("");

  const addKeyword = () => {
    if (newKeyword.trim() && !keywords.includes(newKeyword.trim())) {
      setKeywords([...keywords, newKeyword.trim()]);
      setNewKeyword("");
    }
  };
  const removeKeyword = (k) => {
    setKeywords(keywords.filter(x => x !== k));
  };

  return (
    <div className="page" style={{ background: "#faf9f7" }}>
      <div className="top-spacer" />
      <div className="back-container" style={{ paddingBottom: 8 }}>
        <button onClick={() => setView("voice")} className="back-btn">← close settings</button>
      </div>

      <div className="settings-scroll">
        
        <div className="settings-tabs">
          <button onClick={() => setSettingsTab("account")} className={`settings-tab ${settingsTab === "account" ? "active" : "inactive"}`}>Intelligence</button>
          <button onClick={() => setSettingsTab("knowledge")} className={`settings-tab ${settingsTab === "knowledge" ? "active" : "inactive"}`}>Knowledge</button>
          <button onClick={() => setSettingsTab("billing")} className={`settings-tab ${settingsTab === "billing" ? "active" : "inactive"}`}>Plan</button>
        </div>

        {/* --- INTELLIGENCE TAB --- */}
        {settingsTab === "account" && <div style={{ animation: "fadeUp 0.3s ease" }}>
          
          <div className="section-label" style={{ marginBottom: 12 }}>YOUR EXPERTISE DOMAIN</div>
          <input value={domain} onChange={e=>setDomain(e.target.value)} placeholder="e.g. Real Estate, Wealth Management..." className="account-input settings-domain-input" />

          <div className="section-label" style={{ marginBottom: 16 }}>STRATEGIC FOCUS KEYWORDS</div>
          <div className="settings-focus-desc">
             Tell your Copilot to always hunt for opportunities related to these specific concepts or products during analysis.
          </div>
          
          <div className="settings-keyword-row">
            <input value={newKeyword} onChange={e=>setNewKeyword(e.target.value)} onKeyDown={e => e.key === "Enter" && addKeyword()} placeholder="add concept (e.g. Asset Allocation)" className="account-input settings-keyword-input" />
            <button onClick={addKeyword} className="settings-add-btn">+ add</button>
          </div>

          <div className="settings-keywords-wrap">
            {keywords.map((k, i) => (
              <span key={i} onClick={() => removeKeyword(k)} className="trait-pill settings-keyword-pill">
                {k} <span className="settings-keyword-x">✕</span>
              </span>
            ))}
          </div>

        </div>}

        {/* --- KNOWLEDGE TAB --- */}
        {settingsTab === "knowledge" && <div style={{ animation: "fadeUp 0.3s ease" }}>
          
          <div className="settings-knowledge-header">
             <div className="section-label">DOMAIN KNOWLEDGE BASE</div>
             <div className="settings-sources-count">{knowledgeFiles.length} SOURCES ACTIVE</div>
          </div>
          
          {/* File Upload Dropzone */}
          <div className="settings-dropzone" onMouseEnter={e => e.currentTarget.style.background = "rgba(0,0,0,0.02)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
             <div className="settings-dropzone-icon">
               <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
             </div>
             <div className="settings-dropzone-title">Upload Files</div>
             <div className="settings-dropzone-desc">Drop PDFs, DOCs, images or firm spreadsheets here. Internal engine auto-indexes content.</div>
          </div>

          {/* URL Input */}
          <div className="settings-url-row">
            <input value={newUrl} onChange={e=>setNewUrl(e.target.value)} onKeyDown={e => e.key === "Enter" && addUrl()} placeholder="https://..." className="account-input settings-url-input" />
            <button onClick={addUrl} className="settings-url-add-btn">Add Link</button>
          </div>
          
          {/* Active Sources List */}
          <div className="section-label" style={{ marginBottom: 16 }}>ACTIVE SOURCES</div>
          <div className="settings-sources-list">
            {knowledgeFiles.length === 0 ? <div className="settings-no-sources">No sources uploaded yet.</div> : knowledgeFiles.map((f, i) => (
              <div key={i} className="settings-source-item">
                <div className="settings-source-left">
                  <div className={`settings-source-icon ${f.type === 'url' ? 'settings-source-icon-url' : 'settings-source-icon-file'}`}>
                    {f.type === 'url' ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg> : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>}
                  </div>
                  <div className="settings-source-info">
                    <div className="settings-source-name">{f.name}</div>
                    <div className="settings-source-meta">{f.size} {f.active && <span className="settings-source-synced">• Synced</span>}</div>
                  </div>
                </div>
                <button onClick={() => { setKnowledgeFiles(p => p.filter((_, idx) => idx !== i)) }} className="settings-source-remove">✕</button>
              </div>
            ))}
          </div>
        </div>}

        {/* --- PLAN TAB --- */}
        {settingsTab === "billing" && <div style={{ animation: "fadeUp 0.3s ease" }}>
          <div className="plan-card settings-plan-current">
            <div className="plan-badge">CURRENT</div>
            <div className="plan-header"><span className="plan-name">Pro Copilot</span><span><span className="plan-price">$29</span><span className="plan-mo">/mo</span></span></div>
            <div className="plan-features">
              <div className="plan-feature">✓ Unlimited AI Advisory</div>
              <div className="plan-feature">✓ Up to 500 Clients Sync</div>
              <div className="plan-feature">✓ Deep Domain Context</div>
            </div>
          </div>

          <div className="usage-section">
            <div className="settings-label" style={{ marginBottom: 16 }}>MONTHLY USAGE</div>
            <div className="usage-row">
              <div className="usage-col">
                <div className="usage-val text-red">124</div>
                <div className="usage-max">of 500 clients</div>
                <div className="settings-usage-bar"><div className="settings-usage-fill" /></div>
              </div>
              <div className="usage-col">
                <div className="usage-val">3,402</div>
                <div className="usage-max">insights generated</div>
              </div>
            </div>
          </div>
        </div>}

      </div>
    </div>
  );
}
