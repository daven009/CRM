import React, { useEffect, useRef, useState } from "react";
import { isSupabaseEnabled, loadSettingsFromSupabase, upsertSettingsToSupabase } from "../lib/supabaseClient";
import { getAvailableModels } from "../lib/models";
import { analyzeMaterialWithOpenAI } from "../lib/models/openaiMaterial";
import { analyzeScreenshotWithOpenAI } from "../lib/models/openaiVision";
import { parseMaterialFile } from "../lib/materialParsers";
import { normalizeKnowledgeSource } from "../lib/knowledgeSources";
import { generateKnowledgeEmbedding } from "../lib/knowledgeEmbedding";

const SETTINGS_KEY = "crm.settings.v1";

const DEFAULT_DOMAIN = "";
const DEFAULT_KEYWORDS = [];
const DEFAULT_KNOWLEDGE_FILES = [];
const DEFAULT_MODEL_PROVIDER = "openai";

const formatFileSize = (size) => {
  const bytes = Number(size || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "web";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const loadSettings = () => {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      return {
        domain: DEFAULT_DOMAIN,
        keywords: DEFAULT_KEYWORDS,
        knowledgeFiles: DEFAULT_KNOWLEDGE_FILES,
        modelProvider: DEFAULT_MODEL_PROVIDER
      };
    }
    const parsed = JSON.parse(raw);
    return {
      domain: parsed.domain || DEFAULT_DOMAIN,
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : DEFAULT_KEYWORDS,
      knowledgeFiles: Array.isArray(parsed.knowledgeFiles)
        ? parsed.knowledgeFiles.map((item) => normalizeKnowledgeSource(item)).filter(Boolean)
        : DEFAULT_KNOWLEDGE_FILES,
      modelProvider: parsed.modelProvider || DEFAULT_MODEL_PROVIDER
    };
  } catch {
    return {
      domain: DEFAULT_DOMAIN,
      keywords: DEFAULT_KEYWORDS,
      knowledgeFiles: DEFAULT_KNOWLEDGE_FILES,
      modelProvider: DEFAULT_MODEL_PROVIDER
    };
  }
};

export default function SettingsView({ setView, settingsTab, setSettingsTab, aiTone, setAiTone }) {
  const initial = loadSettings();
  const availableModels = getAvailableModels();
  const knowledgeInputRef = useRef(null);
  const [domain, setDomain] = useState(initial.domain);
  const [savedDomain, setSavedDomain] = useState(initial.domain);
  const [newUrl, setNewUrl] = useState("");
  const [knowledgeFiles, setKnowledgeFiles] = useState(initial.knowledgeFiles);
  const [modelProvider, setModelProvider] = useState(initial.modelProvider);
  const [saveState, setSaveState] = useState("idle");
  const [knowledgeState, setKnowledgeState] = useState("idle");
  const [knowledgeMessage, setKnowledgeMessage] = useState("");
  const [remoteHydrated, setRemoteHydrated] = useState(false);
  const [dropActive, setDropActive] = useState(false);

  const addUrl = () => {
    const url = newUrl.trim();
    if (url && !knowledgeFiles.some((f) => (f.url || f.name) === url)) {
      setKnowledgeFiles([
        normalizeKnowledgeSource({
          id: `url-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: url,
          sourceType: "url",
          kind: "link",
          url,
          size: "web",
          sizeLabel: "web",
          active: true,
          status: "active",
          summary: url,
          promptContext: url,
          uploadedAt: new Date().toISOString()
        }),
        ...knowledgeFiles
      ]);
      setNewUrl("");
    }
  };

  const [keywords, setKeywords] = useState(initial.keywords);
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

  const removeKnowledgeSource = (index) => {
    setKnowledgeFiles((prev) => prev.filter((_, idx) => idx !== index));
  };

  const persistSettings = async (payload) => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload));
    if (isSupabaseEnabled()) {
      await upsertSettingsToSupabase(payload);
    }
  };

  const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });

  const resizeImageDataUrl = (dataUrl, maxWidth = 1280, quality = 0.82) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("图片处理失败")); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => reject(new Error("图片加载失败"));
    img.src = dataUrl;
  });

  const handleKnowledgeFiles = async (fileList) => {
    const files = Array.from(fileList || []).filter(Boolean);
    if (!files.length) return;

    setKnowledgeState("saving");
    setKnowledgeMessage(`Analyzing ${files.length} uploaded file${files.length > 1 ? "s" : ""}...`);

    const added = [];
    const failures = [];

    for (const file of files) {
      try {
        const isImage = String(file.type || "").startsWith("image/");
        let analysis;
        let extractedText = "";
        let parsedPreview = null;
        let fileKind = "file";

        if (isImage) {
          // 图片文件：Vision OCR → 提取文本 → 向量化
          const dataUrl = await readFileAsDataUrl(file);
          const resizedUrl = await resizeImageDataUrl(dataUrl);
          analysis = await analyzeScreenshotWithOpenAI({
            dataUrl: resizedUrl,
            filename: file.name || "screenshot.png"
          });
          // 将 OCR 结果组装为可向量化的文本
          extractedText = [
            analysis.summary,
            ...(analysis.details || [])
          ].filter(Boolean).join("\n");
          fileKind = "screenshot";
        } else {
          // 文档文件：原有逻辑
          const parsed = await parseMaterialFile(file);
          analysis = await analyzeMaterialWithOpenAI({
            filename: file.name || "upload",
            kind: parsed.kind || "file",
            extractedText: parsed.extractedText || "",
            parsedPreview: parsed.parsedPreview || null
          });
          extractedText = parsed.extractedText || "";
          parsedPreview = parsed.parsedPreview || null;
          fileKind = parsed.kind || "file";
        }

        const sourceId = `knowledge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const normalized = normalizeKnowledgeSource({
          id: sourceId,
          name: file.name || "upload",
          sourceType: "file",
          kind: fileKind,
          mimeType: file.type || "",
          size: file.size || 0,
          sizeLabel: formatFileSize(file.size),
          active: true,
          status: "active",
          summary: analysis.summary,
          details: analysis.details,
          tags: analysis.tags,
          suggestedActions: analysis.suggestedActions,
          promptContext: isImage
            ? [analysis.summary, ...(analysis.details || [])].filter(Boolean).join("；")
            : analysis.promptContext,
          extractedText,
          parsedPreview,
          uploadedAt: new Date().toISOString(),
          searchKeywords: analysis.searchKeywords || []
        });

        // 后台异步生成 embedding，不阻塞 UI
        generateKnowledgeEmbedding(normalized).then((embedding) => {
          if (embedding && embedding.length > 0) {
            setKnowledgeFiles((prev) => prev.map((f) =>
              f.id === sourceId ? { ...f, embedding } : f
            ));
          }
        }).catch((err) => {
          console.warn(`[Embedding] ${file.name} 向量生成失败:`, err.message);
        });

        added.push(normalized);
      } catch (err) {
        failures.push(`${file.name || "upload"}: ${err instanceof Error ? err.message : "解析失败"}`);
      }
    }

    if (added.length > 0) {
      setKnowledgeFiles((prev) => [...added, ...prev]);
      setKnowledgeMessage(`Saved ${added.length} knowledge file${added.length > 1 ? "s" : ""}.`);
    }

    if (failures.length > 0) {
      console.error("[Knowledge] 文件解析失败:", failures);
    }

    if (added.length > 0 && failures.length === 0) {
      setKnowledgeState("saved");
    } else if (added.length > 0 && failures.length > 0) {
      setKnowledgeState("saved");
      setKnowledgeMessage(`${added.length} file(s) saved, ${failures.length} failed.`);
    } else if (failures.length > 0) {
      setKnowledgeState("error");
      setKnowledgeMessage(failures[0]);
    } else {
      setKnowledgeState("idle");
    }

    window.setTimeout(() => {
      setKnowledgeState("idle");
      setKnowledgeMessage("");
    }, 1800);
  };

  const onKnowledgeDrop = async (event) => {
    event.preventDefault();
    setDropActive(false);
    const files = event.dataTransfer?.files;
    if (files && files.length) {
      await handleKnowledgeFiles(files);
    }
  };

  const handleSaveDomain = async () => {
    const nextDomain = domain.trim();
    const payload = {
      domain: nextDomain,
      keywords,
      knowledgeFiles,
      modelProvider
    };

    setSaveState("saving");
    try {
      await persistSettings(payload);
      setSavedDomain(nextDomain);
      setDomain(nextDomain);
      setSaveState("saved");
    } catch (err) {
      console.error("[Supabase] 保存 domain 失败:", err);
      setSaveState("idle");
    }
  };

  useEffect(() => {
    let cancelled = false;

    const hydrateFromSupabase = async () => {
      if (!isSupabaseEnabled()) {
        setRemoteHydrated(true);
        return;
      }

      try {
        const remote = await loadSettingsFromSupabase();
        if (!cancelled && remote) {
          setDomain(remote.domain || "");
          setSavedDomain(remote.domain || "");
          setKeywords(Array.isArray(remote.keywords) ? remote.keywords : []);
          setKnowledgeFiles(Array.isArray(remote.knowledgeFiles)
            ? remote.knowledgeFiles.map((item) => normalizeKnowledgeSource(item)).filter(Boolean)
            : []);
          if (remote.modelProvider) {
            setModelProvider(remote.modelProvider);
          }
        }
      } catch (err) {
        console.error("[Supabase] 加载 settings 失败:", err);
      } finally {
        if (!cancelled) setRemoteHydrated(true);
      }
    };

    hydrateFromSupabase();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!remoteHydrated) return undefined;

    const payload = {
      domain: savedDomain.trim(),
      keywords,
      knowledgeFiles,
      modelProvider
    };

    const timer = setTimeout(async () => {
      try {
        await persistSettings(payload);
      } catch (err) {
        console.error("[Supabase] 保存 settings 失败:", err);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [savedDomain, keywords, knowledgeFiles, modelProvider, remoteHydrated]);

  useEffect(() => {
    if (saveState !== "saved") return undefined;
    const timer = setTimeout(() => setSaveState("idle"), 1200);
    return () => clearTimeout(timer);
  }, [saveState]);

  const domainDirty = domain.trim() !== savedDomain.trim();
  const activeKnowledgeCount = knowledgeFiles.filter((item) => item?.active !== false).length;
  const handleSelectModelProvider = (providerId) => {
    if (!availableModels.some((model) => model.id === providerId && model.configured)) return;
    setModelProvider(providerId);
    setSaveState("saving");
    window.setTimeout(() => setSaveState("saved"), 50);
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
          
          <div className="settings-section-head">
            <div className="section-label">YOUR EXPERTISE DOMAIN</div>
            <div className={`settings-save-status ${saveState}`}>
              {saveState === "saving" ? "Saving..." : saveState === "saved" ? "Saved" : ""}
            </div>
          </div>
          <div className="settings-domain-row">
            <input value={domain} onChange={e=>setDomain(e.target.value)} placeholder="e.g. Real Estate, Wealth Management..." className="account-input settings-domain-input" />
            {domainDirty && (
              <button onClick={handleSaveDomain} className="settings-domain-save-btn" disabled={saveState === "saving"}>
                {saveState === "saving" ? "Saving..." : "Save"}
              </button>
            )}
          </div>

          <div className="section-label" style={{ marginBottom: 16, marginTop: 28 }}>MODEL PROVIDER</div>
          <div className="settings-focus-desc">
            Choose which configured model the main app and playground should use by default.
          </div>
          <div className="settings-keywords-wrap">
            {availableModels.map((model) => {
              const active = modelProvider === model.id;
              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => handleSelectModelProvider(model.id)}
                  className={`trait-pill settings-model-pill ${active ? "active" : ""} ${model.configured ? "" : "disabled"}`}
                  disabled={!model.configured}
                >
                  <span>{model.label}</span>
                  {active && <span className="settings-model-pill-check">✓</span>}
                  {!model.configured ? " (Not Configured)" : ""}
                </button>
              );
            })}
          </div>

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
             <div className={`settings-sources-count ${knowledgeState}`} title={knowledgeMessage}>{activeKnowledgeCount} SOURCES ACTIVE</div>
          </div>
          
          {/* File Upload Dropzone */}
          <input
            ref={knowledgeInputRef}
            type="file"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg,.webp,.gif"
            multiple
            onChange={(e) => {
              void handleKnowledgeFiles(e.target.files);
              e.target.value = "";
            }}
            style={{ display: "none" }}
          />
          <div
            className={`settings-dropzone ${dropActive ? "active" : ""}`}
            onClick={() => knowledgeInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDropActive(true); }}
            onDragLeave={() => setDropActive(false)}
            onDrop={onKnowledgeDrop}
          >
             <div className="settings-dropzone-icon">
               <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
             </div>
             <div className="settings-dropzone-title">Upload Knowledge Files</div>
             <div className="settings-dropzone-desc">Drop PDFs, Word docs, Excel sheets, CSV files, or screenshots here. Images will be processed with OCR first, then all content is vectorized for semantic search.</div>
             {knowledgeState !== "idle" && (
               <div className={`settings-knowledge-status ${knowledgeState}`}>{knowledgeMessage || "Analyzing uploaded file..."}</div>
             )}
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
                  <div className={`settings-source-icon ${f.sourceType === 'url' ? 'settings-source-icon-url' : 'settings-source-icon-file'}`}>
                    {f.sourceType === 'url' ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg> : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>}
                  </div>
                  <div className="settings-source-info">
                    <div className="settings-source-name">{f.name}</div>
                    <div className="settings-source-meta">
                      {f.sourceType === "url" ? (f.url || f.name) : `${f.kind || "file"} • ${f.sizeLabel || formatFileSize(f.size)}`}
                      {f.active !== false && <span className="settings-source-synced">• Synced</span>}
                    </div>
                    <div className="settings-source-summary">{f.summary || f.promptContext || "No summary available yet."}</div>
                    {Array.isArray(f.tags) && f.tags.length > 0 && (
                      <div className="settings-source-tags">
                        {f.tags.slice(0, 3).map((tag) => <span key={tag} className="settings-source-tag">{tag}</span>)}
                      </div>
                    )}
                  </div>
                </div>
                <button onClick={() => removeKnowledgeSource(i)} className="settings-source-remove">✕</button>
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
