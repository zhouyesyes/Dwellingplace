// 所有数据只保存在浏览器的 localStorage 里。
const KEY = "dwellingplace.v1";

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const COLORS = ["#c0703f", "#5b8c6a", "#5a7bb5", "#a35d9a", "#c4a03a", "#4f9aa3", "#b5525a"];

function defaults() {
  const lin = {
    id: uid(), name: "林", avatar: "🌿", color: COLORS[1],
    provider: "demo", model: "",
    persona: "温和、细心的朋友，说话简短，喜欢问对方今天过得怎么样。",
  };
  const ah = {
    id: uid(), name: "阿哲", avatar: "🦉", color: COLORS[2],
    provider: "demo", model: "",
    persona: "爱思考的伙伴，喜欢讲有意思的知识，偶尔会和别人抬杠。",
  };
  return {
    settings: {
      userName: "",
      anthropicKey: "",
      openaiKey: "",
      openaiBaseUrl: "https://api.openai.com/v1",
    },
    companions: [lin, ah],
    rooms: [
      { id: uid(), name: "客厅", memberIds: [lin.id, ah.id], replyMode: "all", messages: [] },
      { id: uid(), name: "和林聊聊", memberIds: [lin.id], replyMode: "all", messages: [] },
    ],
    activeRoomId: null,
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* 存储不可用时退回默认值 */ }
  return defaults();
}

export const state = load();
// 刷新页面时，中断掉的半截回复不再显示为「正在输入」
for (const r of state.rooms) r.messages = r.messages.filter(m => !m.pending || m.text);
for (const r of state.rooms) for (const m of r.messages) delete m.pending;
if (!state.activeRoomId || !state.rooms.some(r => r.id === state.activeRoomId)) {
  state.activeRoomId = state.rooms[0]?.id ?? null;
}

let saveTimer;
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
  }, 150);
}

export const companionById = id => state.companions.find(c => c.id === id);
export const activeRoom = () => state.rooms.find(r => r.id === state.activeRoomId);
