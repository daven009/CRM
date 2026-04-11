import { useState, useRef, useMemo, useEffect } from "react";
import "./App.css";
import VoiceView from "./components/VoiceView";
import CardsView from "./components/CardsView";
import DetailView from "./components/DetailView";
import LogView from "./components/LogView";
import SettingsView from "./components/SettingsView";
import PlaygroundView from "./components/PlaygroundView";
import PlaygroundView2 from "./components/PlaygroundView2";
import { isSupabaseEnabled, loadClientsFromSupabase, upsertClientsToSupabase, deleteClientFromSupabase, uploadContactFileToStorage, deleteContactFileFromStorage } from "./lib/supabaseClient";
import { applyClientAction } from "./lib/clientMutations";
import { analyzeScreenshotWithOpenAI } from "./lib/models/openaiVision";
import { summarizeConversationWithOpenAI } from "./lib/models/openaiSummary";
import { analyzeMaterialWithOpenAI } from "./lib/models/openaiMaterial";
import { runCrmPipeline } from "./lib/crmPipeline";
import { parseMaterialFile } from "./lib/materialParsers";
import { resolveModelProviderPreference } from "./lib/modelSettings";

const CLIENTS_KEY = "crm.clients.v1";
const HISTORY_KEY = "crm.history.v1";

const readJSON = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const EVT = (clients) => {
  const items = [];
  clients.forEach(c => {
    (c.todos || []).filter(t => !t.done).forEach(t => {
      items.push({ c, tx: t.t, d: t.d, type: t.s === "sys" ? "system" : (t.d < 0 ? "overdue" : "todo") });
    });
  });
  return items.sort((a, b) => a.d - b.d);
};

const normalizeBirthday = (year, month, day) => {
  const yy = String(year).padStart(4, "0");
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${yy}.${mm}.${dd}`;
};

const clipText = (value, max = 28) => {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

const getDefaultModelProvider = () => resolveModelProviderPreference();

const toTurnHistory = (messages = []) => {
  const turns = [];
  let pendingUser = null;

  (Array.isArray(messages) ? messages : []).forEach((item) => {
    if (item?.r === "user") {
      pendingUser = { userText: String(item.t || "").trim() };
      return;
    }

    if (item?.r === "ai" && pendingUser?.userText) {
      turns.push({
        userText: pendingUser.userText,
        reply: String(item.t || "").trim(),
        intents: Array.isArray(item.intents) ? item.intents : [],
        actions: Array.isArray(item.actions) ? item.actions : []
      });
      pendingUser = null;
    }
  });

  return turns;
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
    if (!ctx) {
      reject(new Error("图片处理失败"));
      return;
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    resolve(canvas.toDataURL("image/jpeg", quality));
  };
  img.onerror = () => reject(new Error("图片加载失败"));
  img.src = dataUrl;
});

const detectStandalonePlayground = () => {
  if (typeof window === "undefined") return false;

  const path = (window.location.pathname || "").toLowerCase();
  const hash = (window.location.hash || "").toLowerCase();
  const search = new URLSearchParams(window.location.search || "");

  if (
    path === "/playground2" ||
    path === "/playground2/" ||
    hash === "#/playground2" ||
    search.get("playground2") === "1"
  ) return "playground2";

  if (
    path === "/playground" ||
    path === "/playground/" ||
    hash === "#/playground" ||
    search.get("playground") === "1"
  ) return "playground";

  return false;
};

export default function App() {
  const [clients, setClients] = useState(() => readJSON(CLIENTS_KEY, []));
  const [view, setView] = useState("voice"); // voice | cards | detail | settings | log
  const [sel, setSel] = useState(null);
  const [recording, setRecording] = useState(false);
  const [convos, setConvos] = useState([]);
  const [activeTask, setActiveTask] = useState(null);
  const [history, setHistory] = useState(() => readJSON(HISTORY_KEY, []));
  const [userText, setUserText] = useState("");
  const [aiTyping, setAiTyping] = useState(false);
  const [cardSort, setCardSort] = useState("priority");
  const [logDate, setLogDate] = useState(null);
  const [cardsLogOpen, setCardsLogOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState("account");
  const [detailChat, setDetailChat] = useState(false);
  const [detailConvos, setDetailConvos] = useState([]);
  const [detailText, setDetailText] = useState("");
  const [detailTyping, setDetailTyping] = useState(false);
  const detailRef = useRef(null);
  const sessionLogIdRef = useRef(null);
  const [aiTone, setAiTone] = useState("casual");
  const [standalonePlayground, setStandalonePlayground] = useState(() => detectStandalonePlayground());
  const [dbHydrated, setDbHydrated] = useState(false);

  const events = useMemo(() => EVT(clients), [clients]);

  const hpColor = (hp) => hp >= 75 ? "#2d6a4f" : hp >= 45 ? "#b45309" : "#c0392b";

  useEffect(() => {
    localStorage.setItem(CLIENTS_KEY, JSON.stringify(clients));
  }, [clients]);

  useEffect(() => {
    let cancelled = false;

    const hydrateFromSupabase = async () => {
      if (!isSupabaseEnabled()) {
        setDbHydrated(true);
        return;
      }

      try {
        const remoteClients = await loadClientsFromSupabase();
        if (!cancelled && remoteClients.length > 0) {
          setClients(remoteClients);
        }
      } catch (err) {
        console.error("[Supabase] 加载客户数据失败:", err);
      } finally {
        if (!cancelled) setDbHydrated(true);
      }
    };

    hydrateFromSupabase();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!dbHydrated || !isSupabaseEnabled()) return;

    const timer = setTimeout(() => {
      upsertClientsToSupabase(clients).catch((err) => {
        console.error("[Supabase] 同步客户数据失败:", err);
      });
    }, 250);

    return () => clearTimeout(timer);
  }, [clients, dbHydrated]);

  useEffect(() => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    if (!sel) return;
    const fresh = clients.find(c => c.id === sel.id);
    if (fresh && fresh !== sel) setSel(fresh);
    if (!fresh) setSel(null);
  }, [clients, sel]);

  useEffect(() => {
    if (view !== "cards") {
      setCardsLogOpen(false);
      setLogDate(null);
    }
  }, [view]);

  useEffect(() => {
    const syncMode = () => setStandalonePlayground(detectStandalonePlayground());
    window.addEventListener("hashchange", syncMode);
    window.addEventListener("popstate", syncMode);
    return () => {
      window.removeEventListener("hashchange", syncMode);
      window.removeEventListener("popstate", syncMode);
    };
  }, []);

  useEffect(() => {
    if (standalonePlayground) {
      setView(standalonePlayground); // "playground" or "playground2"
    }
  }, [standalonePlayground]);

  const sendMsg = async (text) => {
    const trimmed = String(text || "").trim();
    if (!trimmed) return;

    const nextUserMsg = { r: "user", t: trimmed };
    const prevConvos = [...convos];
    const historyTurns = toTurnHistory(prevConvos);

    setConvos((p) => [...p, nextUserMsg]);
    setUserText("");
    setAiTyping(true);

    try {
      const result = await runCrmPipeline(trimmed, clients || [], historyTurns, getDefaultModelProvider());
      const commitResult = applyPlaygroundActions(result.actions || []);
      const actionNote = commitResult?.applied > 0 ? `\n\n[已同步 ${commitResult.applied} 条 CRM 动作]` : "";

      setConvos((p) => [...p, {
        r: "ai",
        t: `${result.reply || "已处理。"}${actionNote}`,
        intents: result.intents || [],
        actions: result.actions || [],
        requestMeta: result.requestMeta || null
      }]);
    } catch (err) {
      setConvos((p) => [...p, {
        r: "ai",
        t: err instanceof Error ? `调用失败：${err.message}` : "调用失败，请稍后重试。",
        intents: [],
        actions: []
      }]);
    } finally {
      setAiTyping(false);
    }
  };

  const handleTask = (clientId, todoTx) => {
    setActiveTask({ client: clientId, todo: todoTx });
    const cc = clients.find(c => c.id === clientId);
    const t = cc && (cc.todos || []).find(td => td.t === todoTx);

    if (t && t.convos && t.convos.length > 0) {
      setConvos([...t.convos]);
    } else {
      setConvos([]);
      setTimeout(() => sendMsg(`帮我处理${cc?.n}的${todoTx}`), 20);
    }
  };

  const markDone = (clientId, todoTx) => {
    setClients(prev => prev.map(c => {
      if (c.id !== clientId) return c;
      const todos = (c.todos || []).map(td => {
        if (td.t !== todoTx) return td;
        return {
          ...td,
          done: true,
          ...(activeTask && activeTask.todo === todoTx ? { convos: [...convos] } : {})
        };
      });
      const d = new Date();
      const today = `${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
      const log = [{ dt: today, src: "系统", tx: `标记待办「${todoTx.slice(0, 8)}...」完成`, ai: null }, ...(c.log || [])];
      return { ...c, todos, log };
    }));

    if (activeTask && activeTask.todo === todoTx) {
      setConvos([]);
      setActiveTask(null);
    } else {
      setConvos(p => {
        if (p.length === 0) return p;
        const next = [...p];
        const last = next[next.length - 1];
        if (last?.action?.type === "mark_done" && last.action.client === clientId && last.action.todo === todoTx) {
          next[next.length - 1] = { ...last, action: null };
        }
        return next;
      });
    }
  };

  const startNewDetailSession = () => {
    if (detailChat) return;
    setDetailChat(true);
    sessionLogIdRef.current = Date.now();
  };

  const detailSend = async (rawText = detailText) => {
    if (!sel) return;
    const userMsgText = String(rawText || "").trim();
    if (!userMsgText) return;

    const historyTurns = toTurnHistory(detailConvos);

    setDetailConvos((p) => [...p, { r: "user", t: userMsgText }]);
    setDetailText("");
    setDetailTyping(true);

    try {
      const result = await runCrmPipeline(
        userMsgText,
        [sel],
        historyTurns,
        getDefaultModelProvider(),
        { lockedClient: sel }
      );
      const commitResult = applyPlaygroundActions(result.actions || []);
      const latestSel = (result.actions || []).length > 0
        ? clients.find((client) => client.id === sel.id) || sel
        : sel;
      if (latestSel?.id === sel.id) setSel(latestSel);

      const actionNote = commitResult?.applied > 0 ? `\n\n[已同步 ${commitResult.applied} 条 CRM 动作]` : "";

      setDetailConvos((prev) => [...prev, {
        r: "ai",
        t: `${result.reply || "已处理。"}${actionNote}`,
        intents: result.intents || [],
        actions: result.actions || [],
        requestMeta: result.requestMeta || null
      }]);
    } catch (err) {
      setDetailConvos((prev) => [...prev, {
        r: "ai",
        t: err instanceof Error ? `调用失败：${err.message}` : "调用失败，请稍后重试。"
      }]);
    } finally {
      setDetailTyping(false);
    }
  };

  const closeDetailChat = async () => {
    if (detailConvos.length > 0 && sel) {
      const d = new Date();
      const todayStr = `${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
      const timeStr = d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" });
      const sid = sessionLogIdRef.current || Date.now();
      const savedConvos = [...detailConvos];
      const timelineSummary = await summarizeConversationWithOpenAI({
        history: savedConvos,
        clientName: sel.n
      });

      setClients(prev => prev.map(c => {
        if (c.id !== sel.id) return c;
        const logEntry = {
          sid,
          d: sid,
          dt: todayStr,
          src: "对话",
          tx: timelineSummary,
          ai: "已归档沟通转录",
          history: savedConvos
        };
        return { ...c, log: [logEntry, ...(c.log || [])] };
      }));

      setHistory(hPrev => [{
        sid,
        year: d.getFullYear(),
        date: todayStr,
        time: timeStr,
        summary: `与${sel.n}新增${savedConvos.length}条沟通记录`,
        clients: [sel.n],
        convos: savedConvos
      }, ...hPrev]);
    }

    setDetailChat(false);
    setDetailConvos([]);
    setDetailText("");
    sessionLogIdRef.current = null;
  };

  const newConvo = () => {
    if (convos.length > 0 && !activeTask) {
      const clientsInConvo = [...new Set(
        convos
          .filter(c => c.r === "user")
          .flatMap(c => {
            const t = c.t;
            return clients.filter(ct => t.includes(ct.n)).map(ct => ct.n);
          })
      )];
      const d = new Date();
      const today = `${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
      setHistory(p => [{
        year: d.getFullYear(),
        date: today,
        time: new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" }),
        summary: `${convos.length}轮对话` + (clientsInConvo.length > 0 ? `，涉及${clientsInConvo.join("、")}` : ""),
        clients: clientsInConvo,
        convos: [...convos]
      }, ...p]);
    }
    setConvos([]);
    setActiveTask(null);
  };

  const persistUpserts = (clientList) => {
    if (!dbHydrated || !isSupabaseEnabled() || !Array.isArray(clientList) || clientList.length === 0) return;
    upsertClientsToSupabase(clientList).catch((err) => {
      console.error("[Supabase] 同步客户数据失败:", err);
    });
  };

  const persistDelete = (clientId) => {
    if (!dbHydrated || !isSupabaseEnabled() || clientId == null) return;
    deleteClientFromSupabase(clientId).catch((err) => {
      console.error("[Supabase] 删除客户失败:", err);
    });
  };

  const addContact = (name, company) => {
    const action = { type: "create_profile", name, company };
    const { nextClients, createdClient } = applyClientAction(clients, action);
    if (!createdClient) return null;
    setClients(nextClients);
    persistUpserts([createdClient]);
    return createdClient;
  };

  const updateContact = (clientId, updates) => {
    const action = { type: "update_profile", clientId, updates };
    const { nextClients, changedClient } = applyClientAction(clients, action);
    if (!changedClient) return null;
    setClients(nextClients);
    persistUpserts([changedClient]);
    return changedClient;
  };

  const deleteContact = (clientId) => {
    const action = { type: "delete_profile", clientId };
    const { nextClients, deletedClientId } = applyClientAction(clients, action);
    if (deletedClientId == null) return false;
    setClients(nextClients);
    persistDelete(deletedClientId);
    return true;
  };

  const applyPlaygroundActions = (actions = []) => {
    if (!Array.isArray(actions) || actions.length === 0) {
      return { applied: 0, upserted: 0, deleted: 0 };
    }

    let working = clients;
    const upsertMap = new Map();
    const deleteIds = new Set();
    let applied = 0;

    actions.forEach((action) => {
      const result = applyClientAction(working, action);
      working = result.nextClients;

      if (result.mutation) applied += 1;
      if (result.changedClient) upsertMap.set(result.changedClient.id, result.changedClient);
      if (result.createdClient) upsertMap.set(result.createdClient.id, result.createdClient);
      if (result.deletedClientId != null) {
        deleteIds.add(result.deletedClientId);
        upsertMap.delete(result.deletedClientId);
      }
    });

    setClients(working);
    persistUpserts([...upsertMap.values()]);
    deleteIds.forEach((id) => persistDelete(id));

    return {
      applied,
      upserted: upsertMap.size,
      deleted: deleteIds.size
    };
  };

  const attachScreenshotToClient = async (clientId, file) => {
    if (!file) throw new Error("未选择截图文件");
    const originalDataUrl = await readFileAsDataUrl(file);
    const resizedDataUrl = await resizeImageDataUrl(originalDataUrl);
    const storageFile = await uploadContactFileToStorage({ clientId, file });
    const analysis = await analyzeScreenshotWithOpenAI({
      dataUrl: resizedDataUrl,
      filename: file.name || "screenshot.png"
    });

    let changedClient = null;

    setClients((prev) => prev.map((client) => {
      if (client.id !== clientId) return client;

      const entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind: "screenshot",
        name: file.name || "screenshot.png",
        mimeType: file.type || "image/png",
        uploadedAt: new Date().toISOString(),
        summary: analysis.summary,
        details: analysis.details,
        tags: analysis.tags,
        suggestedActions: analysis.suggestedActions,
        promptContext: [analysis.summary, ...(analysis.details || [])].filter(Boolean).join("；"),
        storageBucket: storageFile.bucket,
        storagePath: storageFile.path,
        originalUrl: storageFile.publicUrl,
        previewUrl: storageFile.publicUrl
      };

      const nextClient = {
        ...client,
        files: [entry, ...(Array.isArray(client.files) ? client.files : [])],
        log: [
          {
            dt: `${String(new Date().getMonth() + 1).padStart(2, "0")}.${String(new Date().getDate()).padStart(2, "0")}`,
            src: "截图",
            tx: clipText(analysis.summary, 20) || "上传了一张资料截图",
            ai: clipText(analysis.details?.[0] || "已解析截图内容并沉淀到资料库", 30)
          },
          ...(client.log || [])
        ]
      };

      changedClient = nextClient;
      return nextClient;
    }));

    if (changedClient) {
      if (sel?.id === changedClient.id) {
        setSel(changedClient);
      }
      persistUpserts([changedClient]);
    }

    return analysis;
  };

  const attachDataFileToClient = async (clientId, file) => {
    if (!file) throw new Error("未选择资料文件");

    if (String(file.type || "").startsWith("image/")) {
      return attachScreenshotToClient(clientId, file);
    }

    const parsedFile = await parseMaterialFile(file);
    const storageFile = await uploadContactFileToStorage({ clientId, file });
    const analysis = await analyzeMaterialWithOpenAI({
      filename: file.name || "document",
      kind: parsedFile.kind,
      extractedText: parsedFile.extractedText,
      parsedPreview: parsedFile.parsedPreview
    });

    let changedClient = null;

    setClients((prev) => prev.map((client) => {
      if (client.id !== clientId) return client;

      const entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind: parsedFile.kind,
        name: file.name || "document",
        mimeType: file.type || "application/octet-stream",
        uploadedAt: new Date().toISOString(),
        size: Number(file.size || 0),
        summary: analysis.summary,
        details: analysis.details,
        tags: analysis.tags,
        suggestedActions: analysis.suggestedActions,
        promptContext: analysis.promptContext,
        parsedPreview: parsedFile.parsedPreview,
        extractedText: parsedFile.extractedText,
        storageBucket: storageFile.bucket,
        storagePath: storageFile.path,
        originalUrl: storageFile.publicUrl,
        previewUrl: storageFile.publicUrl
      };

      const nextClient = {
        ...client,
        files: [entry, ...(Array.isArray(client.files) ? client.files : [])],
        log: [
          {
            dt: `${String(new Date().getMonth() + 1).padStart(2, "0")}.${String(new Date().getDate()).padStart(2, "0")}`,
            src: parsedFile.kind === "spreadsheet" ? "表格" : "文档",
            tx: clipText(analysis.summary, 20) || "上传了一份联系人资料",
            ai: clipText(analysis.details?.[0] || analysis.promptContext || "已解析资料内容并沉淀到资料库", 30)
          },
          ...(client.log || [])
        ]
      };

      changedClient = nextClient;
      return nextClient;
    }));

    if (changedClient) {
      if (sel?.id === changedClient.id) {
        setSel(changedClient);
      }
      persistUpserts([changedClient]);
    }

    return analysis;
  };

  const saveDetailClient = (updatedClient) => {
    if (!updatedClient?.id) return;

    setClients((prev) => prev.map((client) => (
      client.id === updatedClient.id ? updatedClient : client
    )));

    if (sel?.id === updatedClient.id) {
      setSel(updatedClient);
    }

    persistUpserts([updatedClient]);
  };

  const removeDataFileFromClient = async (clientId, fileIndex) => {
    const targetClient = (clients || []).find((client) => client.id === clientId);
    if (!targetClient) throw new Error("未找到对应联系人。");

    const files = Array.isArray(targetClient.files) ? targetClient.files : [];
    const targetFile = files[fileIndex];
    if (targetFile == null) return;

    if (typeof targetFile !== "string" && targetFile.storagePath) {
      await deleteContactFileFromStorage({
        bucket: targetFile.storageBucket,
        path: targetFile.storagePath
      });
    }

    const nextClient = {
      ...targetClient,
      files: files.filter((_, idx) => idx !== fileIndex)
    };

    setClients((prev) => prev.map((client) => (
      client.id === clientId ? nextClient : client
    )));

    if (sel?.id === clientId) {
      setSel(nextClient);
    }

    persistUpserts([nextClient]);
  };

  if (standalonePlayground) {
    const PgComponent = standalonePlayground === "playground2" ? PlaygroundView2 : PlaygroundView;
    return (
      <div className="app-standalone" style={{ position: "relative" }}>
        <PgComponent
          setView={setView}
          clients={clients}
          applyPlaygroundActions={applyPlaygroundActions}
          standalone
        />
      </div>
    );
  }

  return (
    <div className="app-wrapper">
      {view === "voice" && (
        <VoiceView
          setView={setView}
          setSettingsTab={setSettingsTab}
          setRecording={setRecording}
          recording={recording}
          userText={userText}
          setUserText={setUserText}
          sendMsg={sendMsg}
          aiTyping={aiTyping}
          convos={convos}
          events={events}
          newConvo={newConvo}
          markDone={markDone}
          handleTask={handleTask}
          activeTask={activeTask}
          addContact={addContact}
          updateContact={updateContact}
          setConvos={setConvos}
        />
      )}
      {view === "cards" && (
        <>
          <CardsView
            C={clients}
            cardSort={cardSort}
            setCardSort={setCardSort}
            setSel={setSel}
            setView={setView}
            onOpenLog={() => setCardsLogOpen(true)}
          />
          {cardsLogOpen && (
            <div className="cards-log-overlay">
              <LogView
                setView={setView}
                history={history}
                logDate={logDate}
                setLogDate={setLogDate}
                onBack={() => {
                  setCardsLogOpen(false);
                  setLogDate(null);
                }}
                clients={clients}
              />
            </div>
          )}
        </>
      )}
      {view === "detail" && (
        <DetailView
          sel={sel}
          setSel={setSel}
          setView={setView}
          hpColor={hpColor}
          detailChat={detailChat}
          setDetailChat={setDetailChat}
          detailConvos={detailConvos}
          setDetailConvos={setDetailConvos}
          detailText={detailText}
          setDetailText={setDetailText}
          detailTyping={detailTyping}
          detailSend={detailSend}
          startNewDetailSession={startNewDetailSession}
          closeDetailChat={closeDetailChat}
          recording={recording}
          setRecording={setRecording}
          detailRef={detailRef}
          attachScreenshotToClient={attachDataFileToClient}
          saveDetailClient={saveDetailClient}
          removeDataFileFromClient={removeDataFileFromClient}
        />
      )}
      {view === "log" && (
        <LogView setView={setView} history={history} logDate={logDate} setLogDate={setLogDate} clients={clients} />
      )}
      {view === "settings" && (
        <SettingsView
          setView={setView}
          settingsTab={settingsTab}
          setSettingsTab={setSettingsTab}
          aiTone={aiTone}
          setAiTone={setAiTone}
        />
      )}
      {view === "playground" && (
        <PlaygroundView
          setView={setView}
          clients={clients}
          applyPlaygroundActions={applyPlaygroundActions}
        />
      )}
      {view === "playground2" && (
        <PlaygroundView2
          setView={setView}
          clients={clients}
          applyPlaygroundActions={applyPlaygroundActions}
        />
      )}
    </div>
  );
}
