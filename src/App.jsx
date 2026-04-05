import { useState, useRef, useMemo, useEffect } from "react";
import "./App.css";
import VoiceView from "./components/VoiceView";
import CardsView from "./components/CardsView";
import DetailView from "./components/DetailView";
import LogView from "./components/LogView";
import SettingsView from "./components/SettingsView";
import PlaygroundView from "./components/PlaygroundView";
import { isSupabaseEnabled, loadClientsFromSupabase, upsertClientsToSupabase, deleteClientFromSupabase } from "./lib/supabaseClient";
import { applyClientAction } from "./lib/clientMutations";

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

const detectStandalonePlayground = () => {
  if (typeof window === "undefined") return false;

  const path = (window.location.pathname || "").toLowerCase();
  const hash = (window.location.hash || "").toLowerCase();
  const search = new URLSearchParams(window.location.search || "");

  return (
    path === "/playground" ||
    path === "/playground/" ||
    hash === "#/playground" ||
    search.get("playground") === "1"
  );
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
  const [aiPrompt, setAiPrompt] = useState("你是一个专业且亲和的保险顾问。了解新加坡市场，善于维护关系。语气温暖但专业。根据客户画像和互动记录生成个性化建议。");
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
      setView("playground");
    }
  }, [standalonePlayground]);

  const sendMsg = (text) => {
    if (!text.trim()) return;

    setConvos(p => {
      const nextConvos = [...p, { r: "user", t: text }];
      return nextConvos;
    });

    setUserText("");
    setAiTyping(true);

    setTimeout(() => {
      const lo = text.toLowerCase();
      let reply = "";
      let action = null;

      const targetClient = clients.find(c => lo.includes((c.n || "").toLowerCase()));

      if (targetClient) {
        const isModifyIntent = lo.includes("修改") || lo.includes("更新") || lo.includes("改为") || lo.includes("改成") || lo.includes("update");
        const isNaturalCompanyChange = lo.includes("换公司") || lo.includes("跳槽") || lo.includes("入职") || lo.includes("加入");

        if (isModifyIntent || isNaturalCompanyChange) {
          const updates = {};

          const bdYmdMatch = text.match(/生日[^，。,\n]*?(\d{4})[年.\/-](\d{1,2})[月.\/-](\d{1,2})/u);
          const bdMdMatch = text.match(/生日[^，。,\n]*?(\d{1,2})[月.\/-](\d{1,2})/u);
          if (bdYmdMatch) {
            updates.bd = normalizeBirthday(bdYmdMatch[1], bdYmdMatch[2], bdYmdMatch[3]);
          } else if (bdMdMatch) {
            const prevYear = (targetClient.bd || "").match(/^(\d{4})[.\/-]/)?.[1] || String(new Date().getFullYear());
            updates.bd = normalizeBirthday(prevYear, bdMdMatch[1], bdMdMatch[2]);
          }

          const psMatch = text.match(/性格[^，。,\n]*?(?:是|为|改为|改成|[:：])\s*([^，。,\n]+)/u);
          if (psMatch?.[1]) updates.ps = psMatch[1].trim();

          const roleMatch = text.match(/(?:职位|岗位|role|title)[^，。,\n]*?(?:是|为|改为|改成|[:：])\s*([^，。,\n]+)/iu);
          if (roleMatch?.[1]) updates.role = roleMatch[1].trim();

          const companyMatch = text.match(/(?:公司|company)[^，。,\n]*?(?:是|为|改为|改成|[:：])\s*([^，。,\n]+)/iu);
          const naturalCompanyMatch = text.match(/(?:换到|跳槽到|加入|入职|去了|到)\s*([^，。,\n]+)/u);
          if (companyMatch?.[1]) updates.co = companyMatch[1].trim();
          else if (naturalCompanyMatch?.[1]) updates.co = naturalCompanyMatch[1].trim();

          const phoneStrictMatch = text.match(/(?:电话|电话号码|手机号|手机|phone|mobile)[^，。,\n]*?(?:是|为|改为|改成|[:：])\s*([+\d][\d\s-]{5,20})/iu);
          const phoneLooseMatch = text.match(/(?:更新|修改|改)?[^，。,\n]*?(?:电话|电话号码|手机号|手机|phone|mobile)\s*(?:为|成)?\s*([+\d][\d\s-]{5,20})/iu);
          const parsedPhone = (phoneStrictMatch?.[1] || phoneLooseMatch?.[1] || "").trim();
          if (parsedPhone) updates.tel = parsedPhone;

          if (Object.keys(updates).length > 0 || isNaturalCompanyChange) {
            reply = isNaturalCompanyChange && !updates.co
              ? `收到，你说${targetClient.n}换公司了。请在下面填写新公司并确认。`
              : `好的，我帮你更新${targetClient.n}的信息，请确认：`;
            action = {
              type: "update_contact",
              clientId: targetClient.id,
              updates: {
                co: updates.co ?? targetClient.co,
                role: updates.role ?? targetClient.role,
                bd: updates.bd ?? targetClient.bd,
                ps: updates.ps ?? targetClient.ps,
                tel: updates.tel ?? targetClient.tel ?? ""
              }
            };
          } else {
            reply = `我可以帮你修改${targetClient.n}的公司、职位、电话、生日（YYYY.MM.DD）和性格。你可以说：修改${targetClient.n}的电话为+65 9123 4567。`;
          }
        } else if (lo.includes("处理") || lo.includes("跟进") || lo.includes("拟") || lo.includes("写") || lo.includes("发消息")) {
          const urgent = (targetClient.todos || []).filter(t => !t.done).sort((a, b) => a.d - b.d)[0];
          reply = `好的，针对${targetClient.n}的性格标签（${targetClient.ps || "待补充"}），我为你草拟了关于「${urgent ? urgent.t.split('（')[0] : '随访问候'}」的跟进话术：\n\n「Hi ${targetClient.n}，最近有新进展吗？方便时随时联系我。」\n\n你可以复制后发送给他。办理完毕后记得告诉我！`;
          if (urgent) action = { type: "mark_done", client: targetClient.id, todo: urgent.t };
        } else if (lo.includes("礼物") || lo.includes("送")) {
          const g = targetClient.gifts || [];
          reply = g.length > 0 ? `根据${targetClient.n}的爱好，推荐以下礼物：\n\n${g.map(gi => `· ${gi.n}（${gi.p}）— ${gi.why}`).join("\n")}` : `暂时没有针对${targetClient.n}的礼物建议。`;
        } else {
          const urgent = (targetClient.todos || []).filter(t => !t.done).sort((a, b) => a.d - b.d)[0];
          reply = `${targetClient.n}，${targetClient.co || "未知公司"} ${targetClient.role || ""}。目前健康度 ${targetClient.hp ?? 50}。\n\n${urgent ? `⚠️ 近期核心待办：${urgent.t} ${urgent.d < 0 ? `(已过期${Math.abs(urgent.d)}天)` : `(还有${urgent.d}天)`}` : "暂无紧急待办。"}\n\n要我帮你处理吗？`;
        }
      } else if (lo.includes("跟进") || lo.includes("紧急") || lo.includes("联系谁") || lo.includes("联系")) {
        const urgents = clients
          .map(c => ({ c, urgent: (c.todos || []).find(t => !t.done && t.d <= 0) }))
          .filter(item => item.urgent)
          .sort((a, b) => (a.c.hp ?? 50) - (b.c.hp ?? 50));
        reply = urgents.length > 0
          ? `当前需要紧急跟进的客户有 ${urgents.length} 位：\n\n${urgents.map((u, i) => `${i + 1}. ${u.c.n} — ${u.urgent.t} (健康度 ${u.c.hp ?? 50})`).join("\n")}\n\n你想先从谁开始？`
          : "目前没有紧急或者逾期的跟进事项。";
      } else if (lo.includes("礼物") || lo.includes("送什么")) {
        reply = "你想给谁送礼物？告诉我客户名字和相关场合，我会根据他/她的标签给出建议。";
      } else if (lo.includes("添加") || lo.includes("新客户") || lo.includes("新联系人") || lo.includes("add contact") || lo.includes("新的客户")) {
        let parsedName = "";
        let parsedCo = "";
        const nameMatch = text.match(/叫([^，,、]+)/u) || text.match(/联系人([^，,、]+)/u);
        const coMatch = text.match(/([^，,、]+公司)/u) || text.match(/([^，,、]+(?:集团|地产|证券|银行|保险|科技|资本))/u);
        if (nameMatch) parsedName = nameMatch[1].trim();
        if (coMatch) parsedCo = coMatch[1].trim();
        if (!parsedName) {
          const chars = text.replace(/添加|新客户|新联系人|帮我|一个|叫|的/g, "").trim();
          const nameGuess = chars.match(/([\u4e00-\u9fa5]{2,4})/u);
          if (nameGuess) parsedName = nameGuess[1];
        }
        reply = "好的，我帮你创建新联系人，请确认以下信息：";
        action = { type: "new_contact", name: parsedName || "新联系人", company: parsedCo || "" };
      } else if (lo.includes("见完") || lo.includes("聊了")) {
        reply = "好的，我帮你记录。你可以继续补充这次沟通的重点与下一步动作。";
      } else {
        const overdue = events.filter(e => e.d < 0).length;
        reply = `你当前有 ${clients.length} 位客户。\n当前有 ${overdue} 项已过期待办。\n\n你可以试着说：\n· 今天该联系谁？\n· 帮我处理某某的跟进\n· 添加一个新联系人`;
      }

      setConvos(p => [...p, { r: "ai", t: reply, action }]);
      setAiTyping(false);
    }, 500);
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

  const detailSend = () => {
    if (!sel) return;
    const userMsgText = detailText.trim() || `记录与${sel.n}的一次沟通`;
    const userMsg = { r: "user", t: userMsgText };

    setDetailConvos(p => [...p, userMsg]);
    setDetailText("");
    setDetailTyping(true);

    setTimeout(() => {
      const urgent = (sel.todos || []).filter(t => !t.done).sort((a, b) => a.d - b.d)[0];
      const reply = urgent
        ? `已记录。本次建议优先推进「${urgent.t}」，并在${urgent.d < 0 ? `今天补救跟进` : `${urgent.d}天内完成`}。`
        : "已记录。本次沟通暂无紧急待办，我已归档到客户时间线。";
      setDetailConvos(prev => [...prev, { r: "ai", t: reply }]);
      setDetailTyping(false);
    }, 500);
  };

  const closeDetailChat = () => {
    if (detailConvos.length > 0 && sel) {
      const d = new Date();
      const todayStr = `${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
      const timeStr = d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" });
      const sid = sessionLogIdRef.current || Date.now();
      const savedConvos = [...detailConvos];

      setClients(prev => prev.map(c => {
        if (c.id !== sel.id) return c;
        const logEntry = {
          sid,
          d: sid,
          dt: todayStr,
          src: "对话",
          tx: `与${c.n}完成一次沟通记录`,
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

  if (standalonePlayground) {
    return (
      <div className="app-standalone" style={{ position: "relative" }}>
        <PlaygroundView
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
          aiPrompt={aiPrompt}
          setAiPrompt={setAiPrompt}
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
    </div>
  );
}
