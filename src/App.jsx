import { useState, useRef, useMemo, useEffect } from "react";
import "./App.css";
import { C, EVT, MOCK_HISTORY, MOCK_SCENARIOS } from "./data/mockData";
import VoiceView from "./components/VoiceView";
import CardsView from "./components/CardsView";
import DetailView from "./components/DetailView";
import LogView from "./components/LogView";
import SettingsView from "./components/SettingsView";

export default function App() {
  const [view, setView] = useState("voice"); // voice | cards | detail | settings | log
  const [sel, setSel] = useState(null);
  const [recording, setRecording] = useState(false);
  const [convos, setConvos] = useState([]); // current conversation
  const [activeTask, setActiveTask] = useState(null); // tracking the currently handled task
  const [history, setHistory] = useState(MOCK_HISTORY);
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
  const [sessionIndex, setSessionIndex] = useState(0); 
  const [sessionTurn, setSessionTurn] = useState(0);
  const [aiPrompt, setAiPrompt] = useState("你是一个专业且亲和的保险顾问。了解新加坡市场，善于维护关系。语气温暖但专业。根据客户画像和互动记录生成个性化建议。");

  const [aiTone, setAiTone] = useState("casual");
  const events = useMemo(() => EVT(C), []);

  const hpColor = (hp) => hp >= 75 ? "#2d6a4f" : hp >= 45 ? "#b45309" : "#c0392b";

  useEffect(() => {
    if (view !== "cards") {
      setCardsLogOpen(false);
      setLogDate(null);
    }
  }, [view]);

  // Simulate AI response
  const sendMsg = (text) => {
    if (!text.trim()) return;
    
    setConvos(p => {
      const nextConvos = [...p, { r: "user", t: text }];
      // Sync in real-time if handling a task
      if (activeTask) {
        const cc = C.find(c => c.id === activeTask.client);
        const t = cc && cc.todos.find(td => td.t === activeTask.todo);
        if (t) t.convos = nextConvos;
      }
      return nextConvos;
    });
    
    setUserText("");
    setAiTyping(true);
    setTimeout(() => {
      const lo = text.toLowerCase();
      let reply = "";
      let action = null;
      
      const targetClient = C.find(c => lo.includes(c.n.toLowerCase()) || (c.sub && lo.includes(c.sub.toLowerCase().split(' ')[0])));
      
      if (targetClient) {
        if (lo.includes("处理") || lo.includes("跟进") || lo.includes("拟") || lo.includes("写") || lo.includes("发消息")) {
          const urgent = targetClient.todos.filter(t => !t.done).sort((a, b) => a.d - b.d)[0];
          reply = `好的，针对${targetClient.n}的性格标签（${targetClient.ps}），我为你草拟了关于「${urgent ? urgent.t.split('（')[0] : '随访问候'}」的跟进话术：\n\n「Hi ${targetClient.sub?.split(' ')[0] || targetClient.n}，${targetClient.log[0]?.tx ? `上次提到的${targetClient.log[0].tx.split('，')[0]}的事，` : ''}最近有新进展吗？方便时随时联系我。」\n\n你可以复制后发送给他。办理完毕后记得告诉我！`;
          if (urgent) action = { type: "mark_done", client: targetClient.id, todo: urgent.t };
        } else if (lo.includes("礼物") || lo.includes("送")) {
          const g = targetClient.gifts || [];
          reply = g.length > 0 ? `根据${targetClient.n}的爱好，推荐以下礼物：\n\n${g.map(gi => `· ${gi.n}（${gi.p}）— ${gi.why}`).join("\n")}` : `暂时没有针对${targetClient.n}的礼物建议。`;
        } else {
          const urgent = targetClient.todos.filter(t => !t.done).sort((a, b) => a.d - b.d)[0];
          reply = `${targetClient.n}，${targetClient.co} ${targetClient.role}。目前健康度 ${targetClient.hp}。\n\n${urgent ? `⚠️ 近期核心待办：${urgent.t} ${urgent.d < 0 ? `(已过期${Math.abs(urgent.d)}天)` : `(还有${urgent.d}天)`}` : "暂无紧急待办。"}\n\n要我帮你处理吗？`;
        }
      } else if (lo.includes("跟进") || lo.includes("紧急") || lo.includes("联系谁") || lo.includes("联系")) {
        const urgents = C.map(c => ({ c, urgent: c.todos.find(t => !t.done && t.d <= 0) })).filter(item => item.urgent).sort((a, b) => a.c.hp - b.c.hp);
        reply = urgents.length > 0 
          ? `当前需要紧急跟进的客户有 ${urgents.length} 位：\n\n${urgents.map((u, i) => `${i + 1}. ${u.c.n} — ${u.urgent.t} (健康度 ${u.c.hp})`).join('\n')}\n\n你想先从谁开始？`
          : "目前没有紧急或者逾期的跟进事项，大家都很健康！";
      } else if (lo.includes("礼物") || lo.includes("送什么")) {
        reply = "你想给谁送礼物？告诉我客户名字和相关场合（比如生日或生子），我会根据他/她的爱好标签进行精准推荐。";
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
        reply = "好的，我帮你记录到 Timeline 中。聊了什么内容？有哪些新的情报需要我更新到客户画像里？";
      } else {
        reply = `你有 ${C.length} 位重点客户。\n当前有 ${events.filter(e => e.d < 0).length} 项已过期待办。\n\n你可以试着说：\n· "今天该联系谁？"\n· "帮我处理王强的跟进"\n· "给李梅准备什么礼物"`;
      }
      
      setConvos(p => {
        const nextConvos = [...p, { r: "ai", t: reply, action }];
        if (activeTask) {
          const cc = C.find(c => c.id === activeTask.client);
          const t = cc && cc.todos.find(td => td.t === activeTask.todo);
          if (t) t.convos = nextConvos;
        }
        return nextConvos;
      });
      setAiTyping(false);
    }, 1500);
  };

  const handleTask = (clientId, todoTx) => {
    setActiveTask({ client: clientId, todo: todoTx });
    const cc = C.find(c => c.id === clientId);
    const t = cc && cc.todos.find(td => td.t === todoTx);
    
    if (t && t.convos && t.convos.length > 0) {
      setConvos([...t.convos]);
    } else {
      setConvos([]);
      setTimeout(() => sendMsg(`帮我处理${cc?.n}的${todoTx}`), 20);
    }
  };

  const markDone = (clientId, todoTx) => {
    const cc = C.find(c => c.id === clientId);
    if (!cc) return;
    const t = cc.todos.find(td => td.t === todoTx);
    if (t) {
      t.done = true;
      if (activeTask && activeTask.todo === todoTx) t.convos = [...convos];
      const d = new Date();
      const today = `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
      cc.log.unshift({ dt: today, src: "系统", tx: `标记待办「${todoTx.slice(0, 8)}...」完成`, ai: null });
    }
    
    if (activeTask && activeTask.todo === todoTx) {
      setConvos([]);
      setActiveTask(null);
    }
  };

  const startNewDetailSession = () => {
    if (detailChat) return;
    setDetailChat(true);
    setSessionIndex(p => p + 1);
    setSessionTurn(0);
    // Create the session ID IMMEDIATELY when the window opens
    sessionLogIdRef.current = Date.now();
  };

  const detailSend = () => {
    if (!sel) return;
    const scenario = MOCK_SCENARIOS[sessionIndex % 5];
    const name = sel.n.split(' ')[0]; // Use first name
    const fill = (str) => str.replace(/\{name\}/g, name);
    const currentTurn = sessionTurn % 3;

    const userText = fill(scenario.turns[currentTurn]);
    const userMsg = { r: "user", t: userText };
    
    setDetailConvos(p => [...p, userMsg]);
    setDetailTyping(true);
    
    setTimeout(() => detailRef.current?.scrollIntoView({ behavior: "smooth" }), 50);

    setTimeout(() => {
      const reply = fill(scenario.responses[currentTurn]);
      const aiMsg = { r: "ai", t: reply };
      setDetailConvos(prev => [...prev, aiMsg]);
      setSessionTurn(prev => prev + 1);
      setDetailTyping(false);

      // Create todo if this turn's response promises one
      if (scenario.todoCreates && scenario.todoCreates[currentTurn]) {
        const todoDef = scenario.todoCreates[currentTurn];
        const newTodo = { t: fill(todoDef.t), d: todoDef.d, s: todoDef.s, done: false };
        // Avoid duplicates
        if (!sel.todos.some(td => td.t === newTodo.t)) {
          sel.todos.push(newTodo);
          setSel({ ...sel });
        }
      }
    }, 1200);
  };

  const closeDetailChat = () => {
    if (detailConvos.length > 0 && sel) {
      const scenario = MOCK_SCENARIOS[sessionIndex % 5];
      const name = sel.n.split(' ')[0];
      const fill = (str) => str.replace(/\{name\}/g, name);
      
      const d = new Date();
      const todayStr = `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
      const timeStr = d.toLocaleTimeString('en-US',{hour12:false,hour:'2-digit',minute:'2-digit'});
      const sid = sessionLogIdRef.current || Date.now();
      const savedConvos = [...detailConvos];

      if (scenario.type === "progress") {
        // Full timeline entry
        const logEntry = { sid, d: sid, dt: todayStr, src: "进展", tx: fill(`客户进展同步：${scenario.theme}`), ai: "已归档完整推演记录", history: savedConvos };
        sel.log.unshift(logEntry);
        setHistory(hPrev => [{ sid, date: todayStr, time: timeStr, summary: fill(scenario.summary), clients: [sel.n], convos: savedConvos }, ...hPrev]);
        setSel({ ...sel });
      } else if (scenario.type === "operational") {
        // Update client profile traits
        if (scenario.profileUpdates) {
          const newTraits = [...sel.traits];
          scenario.profileUpdates.forEach(tag => {
            const finalTag = fill(tag);
            if (!newTraits.includes(finalTag)) newTraits.push(finalTag);
          });
          sel.traits = newTraits;
        }
        // Brief notation on client log only, no global history
        const updatedTags = scenario.profileUpdates ? scenario.profileUpdates.map(fill).join("、") : scenario.theme;
        sel.log.unshift({ d: sid, dt: todayStr, src: "更新", tx: `画像已更新：${updatedTags}`, ai: null });
        setSel({ ...sel });
      }
      // advisory: save nothing
    }

    setDetailChat(false);
    setDetailConvos([]);
    setDetailText("");
    sessionLogIdRef.current = null;
    setSessionTurn(0);
  };

  const newConvo = () => {
    if (convos.length > 0) {
      if (!activeTask) {
        const clients = [...new Set(convos.filter(c => c.r === "user").flatMap(c => { const t = c.t; return C.filter(ct => t.includes(ct.n)).map(ct => ct.n) }))];
        const d = new Date();
        const today = `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
        setHistory(p => [{ date: today, time: new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }), summary: `${convos.length}轮对话` + (clients.length > 0 ? `，涉及${clients.join("、")}` : ""), clients, convos: [...convos] }, ...p]);
      }
    }
    setConvos([]);
    setActiveTask(null);
  };

  const addContact = (name, company) => {
    const newId = Math.max(...C.map(c => c.id)) + 1;
    const newContact = {
      id: newId,
      n: name,
      sub: "",
      co: company || "Unknown",
      role: "",
      hp: 50,
      bd: "",
      ps: "待了解",
      traits: [],
      todos: [],
      log: [{
        dt: `${String(new Date().getMonth() + 1).padStart(2, '0')}.${String(new Date().getDate()).padStart(2, '0')}`,
        src: "系统",
        tx: "联系人已创建",
        ai: null
      }],
      social: [],
      files: [],
      from: "手动添加",
      refs: [],
      gifts: []
    };
    C.push(newContact);
    return newContact;
  };

  return (
    <div className="app-wrapper">
      {view === "voice" && (
        <VoiceView setView={setView} setSettingsTab={setSettingsTab} setRecording={setRecording} recording={recording} userText={userText} setUserText={setUserText} sendMsg={sendMsg} aiTyping={aiTyping} convos={convos} events={events} newConvo={newConvo} C={C} markDone={markDone} handleTask={handleTask} activeTask={activeTask} addContact={addContact} setConvos={setConvos} />
      )}
      {view === "cards" && (
        <>
          <CardsView
            C={C}
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
              />
            </div>
          )}
        </>
      )}
      {view === "detail" && (
        <DetailView sel={sel} setSel={setSel} setView={setView} hpColor={hpColor} detailChat={detailChat} setDetailChat={setDetailChat} detailConvos={detailConvos} setDetailConvos={setDetailConvos} detailText={detailText} setDetailText={setDetailText} detailTyping={detailTyping} detailSend={detailSend} startNewDetailSession={startNewDetailSession} closeDetailChat={closeDetailChat} recording={recording} setRecording={setRecording} detailRef={detailRef} />
      )}
      {view === "log" && (
        <LogView setView={setView} history={history} logDate={logDate} setLogDate={setLogDate} />
      )}
      {view === "settings" && (
        <SettingsView setView={setView} settingsTab={settingsTab} setSettingsTab={setSettingsTab} aiPrompt={aiPrompt} setAiPrompt={setAiPrompt} aiTone={aiTone} setAiTone={setAiTone} />
      )}
    </div>
  );
}
