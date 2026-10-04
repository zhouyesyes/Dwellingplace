import { state, save, uid, COLORS, companionById, activeRoom } from "./store.js";
import { PROVIDERS, streamReply } from "./providers.js";

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const els = {
  sidebar: $("#sidebar"), roomList: $("#roomList"), companionList: $("#companionList"),
  roomTitle: $("#roomTitle"), roomMembers: $("#roomMembers"), messages: $("#messages"),
  input: $("#input"), sendBtn: $("#sendBtn"), continueBtn: $("#continueBtn"),
  stopBtn: $("#stopBtn"), hint: $("#hint"), dialog: $("#dialog"), form: $("#dialogForm"),
};

let busy = false;
let abortCtrl = null;

// ================= 渲染 =================

function avatar(c, cls = "") {
  return `<span class="avatar ${cls}" style="--c:${esc(c.color)}">${esc(c.avatar)}</span>`;
}

function renderSidebar() {
  els.roomList.innerHTML = state.rooms.map(r => {
    const members = r.memberIds.map(companionById).filter(Boolean);
    return `<li data-room="${r.id}" class="${r.id === state.activeRoomId ? "active" : ""}">
      <span class="avatar-stack">${members.slice(0, 3).map(c => avatar(c)).join("")}</span>
      <span class="name">${esc(r.name)}<div class="sub">${members.length} 位伙伴</div></span>
    </li>`;
  }).join("");

  els.companionList.innerHTML = state.companions.map(c => `
    <li data-companion="${c.id}">
      ${avatar(c)}
      <span class="name">${esc(c.name)}<div class="sub">${esc(PROVIDERS[c.provider]?.label.split(/[（(]/)[0] ?? "")}</div></span>
      <span class="row-actions">
        <button class="icon-btn tiny" data-dm="${c.id}" title="单独聊天">💬</button>
      </span>
    </li>`).join("");
}

function renderHeader() {
  const room = activeRoom();
  if (!room) { els.roomTitle.textContent = "—"; els.roomMembers.innerHTML = ""; return; }
  els.roomTitle.textContent = room.name;
  const members = room.memberIds.map(companionById).filter(Boolean);
  els.roomMembers.innerHTML = members.map(c =>
    `<span class="member-chip" style="--c:${esc(c.color)}"><span class="dot"></span>${esc(c.name)}</span>`).join("")
    + (room.replyMode === "one" && members.length > 1 ? `<span>· 每次一位回应</span>` : "");
}

function messageHTML(m) {
  if (m.author === "system") return `<div class="msg system">${esc(m.text)}</div>`;
  if (m.author === "user") {
    return `<div class="msg user" data-id="${m.id}"><div class="body">
      <div class="bubble">${esc(m.text)}</div></div></div>`;
  }
  const c = companionById(m.author) ?? { name: "（已删除）", avatar: "?", color: "#999" };
  return `<div class="msg" data-id="${m.id}">${avatar(c, "lg")}<div class="body">
    <div class="author" style="--c:${esc(c.color)}"><b>${esc(c.name)}</b></div>
    <div class="bubble ${m.error ? "error" : ""} ${m.pending ? "typing" : ""}">${esc(m.text)}</div></div></div>`;
}

function renderMessages() {
  const room = activeRoom();
  if (!room) {
    els.messages.innerHTML = `<div class="empty"><div class="big">⌂</div>还没有房间，点左边的 ＋ 建一个吧。</div>`;
    return;
  }
  if (!room.messages.length) {
    const names = room.memberIds.map(companionById).filter(Boolean).map(c => c.name).join("、");
    els.messages.innerHTML = `<div class="empty"><div class="big">☕</div>
      ${names ? `${esc(names)} 都在这里。` : "房间里还没有伙伴，点右上角 ✎ 邀请。"}<br>打个招呼吧。</div>`;
    return;
  }
  els.messages.innerHTML = room.messages.map(messageHTML).join("");
  scrollToBottom();
}

function scrollToBottom() { els.messages.scrollTop = els.messages.scrollHeight; }

function renderAll() {
  renderSidebar(); renderHeader(); renderMessages(); updateComposer();
}

function updateComposer() {
  const room = activeRoom();
  const hasMembers = room && room.memberIds.some(companionById);
  els.sendBtn.disabled = busy || !room;
  els.continueBtn.disabled = busy || !hasMembers;
  els.stopBtn.classList.toggle("hidden", !busy);
}

// ================= 对话逻辑 =================

// 谁来回应：被 @ 的人优先；否则按房间设置（全部依次 / 随机一位）。
function pickResponders(room, text) {
  const members = room.memberIds.map(companionById).filter(Boolean);
  if (text) {
    const mentioned = members
      .map(c => ({ c, i: text.indexOf("@" + c.name) }))
      .filter(x => x.i >= 0).sort((a, b) => a.i - b.i).map(x => x.c);
    if (mentioned.length) return mentioned;
  }
  if (room.replyMode === "one" || !text) {
    // 「继续聊」时也只挑一位，避开刚说过话的人
    const last = [...room.messages].reverse().find(m => m.author !== "system");
    const pool = members.length > 1 ? members.filter(c => c.id !== last?.author) : members;
    return pool.length ? [pool[Math.floor(Math.random() * pool.length)]] : [];
  }
  return members;
}

function buildSystem(room, me) {
  const others = room.memberIds.map(companionById).filter(c => c && c.id !== me.id);
  const user = state.settings.userName || "用户";
  return [
    `你是「${me.name}」。`,
    me.persona ? `你的设定：${me.persona}` : "",
    `你现在在一个叫「${room.name}」的地方，和 ${user}${others.length ? `、${others.map(o => o.name).join("、")}` : ""} 在一起聊天。`,
    others.length ? "这是多人对话：别人的发言会以「[名字]: 」开头。只用你自己的身份说话，不要替别人发言，也不要在开头写自己的名字。" : "",
    "像真人聊天一样自然、简短地回应，除非对方需要更详细的回答。",
  ].filter(Boolean).join("\n");
}

// 把房间里的多方对话，转换成某一位伙伴视角的 user/assistant 交替消息。
function buildMessages(room, me) {
  const user = state.settings.userName || "用户";
  const multi = room.memberIds.length > 1;
  const out = [];
  for (const m of room.messages.slice(-60)) {
    if (m.author === "system" || m.error || m.pending || !m.text) continue;
    let role, content;
    if (m.author === me.id) { role = "assistant"; content = m.text; }
    else {
      role = "user";
      const name = m.author === "user" ? user : (companionById(m.author)?.name ?? "某人");
      content = multi ? `[${name}]: ${m.text}` : m.text;
    }
    const prev = out[out.length - 1];
    if (prev && prev.role === role) prev.content += "\n\n" + content;
    else out.push({ role, content });
  }
  if (!out.length || out[0].role !== "user") out.unshift({ role: "user", content: "（对话开始）" });
  if (out[out.length - 1].role !== "user") out.push({ role: "user", content: "（大家在等你接着说）" });
  return out;
}

async function runTurn(text) {
  const room = activeRoom();
  if (!room || busy) return;

  if (text) {
    room.messages.push({ id: uid(), author: "user", text, ts: Date.now() });
    save();
    renderMessages();
  }

  const responders = pickResponders(room, text);
  if (!responders.length) {
    els.hint.textContent = "这个房间还没有伙伴，点右上角 ✎ 邀请几位进来。";
    return;
  }

  busy = true;
  abortCtrl = new AbortController();
  updateComposer();

  for (const c of responders) {
    if (abortCtrl.signal.aborted) break;
    const msg = { id: uid(), author: c.id, text: "", pending: true, ts: Date.now() };
    const system = buildSystem(room, c);
    const messages = buildMessages(room, c);
    room.messages.push(msg);
    renderMessages();
    els.hint.textContent = `${c.name} 正在输入…`;
    const bubble = () => els.messages.querySelector(`[data-id="${msg.id}"] .bubble`);

    try {
      const full = await streamReply({
        companion: c,
        settings: state.settings,
        system,
        messages,
        signal: abortCtrl.signal,
        others: room.memberIds.map(companionById).filter(o => o && o.id !== c.id),
        onText: delta => {
          msg.text += delta;
          const b = bubble();
          if (b) { b.textContent = msg.text; scrollToBottom(); }
        },
      });
      msg.text = stripSelfPrefix(full || msg.text, c.name);
    } catch (err) {
      if (err?.name === "AbortError" || abortCtrl.signal.aborted) {
        if (!msg.text) room.messages.splice(room.messages.indexOf(msg), 1);
      } else {
        msg.error = true;
        msg.text = `出错了：${err?.message || err}`;
      }
    }
    delete msg.pending;
    save();
    renderMessages();
  }

  busy = false;
  abortCtrl = null;
  els.hint.textContent = "";
  updateComposer();
}

// 有些模型会在开头自带「[名字]: 」，去掉它。
function stripSelfPrefix(text, name) {
  return text.replace(new RegExp(`^\\s*\\[?${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]?\\s*[:：]\\s*`), "");
}

// ================= 对话框 =================

function openDialog(html, onSubmit, onReady) {
  els.form.innerHTML = html;
  els.form.onsubmit = e => {
    const action = e.submitter?.value;
    if (action === "cancel") return;
    onSubmit(new FormData(els.form), action);
  };
  onReady?.(els.form);
  els.dialog.showModal();
}

function editCompanion(c) {
  const isNew = !c;
  c ??= { id: uid(), name: "", avatar: "✨", color: COLORS[state.companions.length % COLORS.length], provider: "demo", model: "", persona: "" };
  const providerOpts = Object.entries(PROVIDERS)
    .map(([k, p]) => `<option value="${k}" ${k === c.provider ? "selected" : ""}>${esc(p.label)}</option>`).join("");

  openDialog(`
    <h2>${isNew ? "新的伙伴" : `编辑 ${esc(c.name)}`}</h2>
    <div class="row">
      <label style="flex:0 0 80px">头像<input name="avatar" value="${esc(c.avatar)}" maxlength="4" required></label>
      <label>名字<input name="name" value="${esc(c.name)}" required placeholder="例如：小满"></label>
    </div>
    <div class="swatches">${COLORS.map(col => `<label><input type="radio" name="color" value="${col}" ${col === c.color ? "checked" : ""}><span style="--c:${col}"></span></label>`).join("")}</div>
    <label>性格 / 设定
      <textarea name="persona" placeholder="TA 是谁？说话是什么风格？和你是什么关系？">${esc(c.persona)}</textarea>
    </label>
    <fieldset>
      <legend>大脑（模型）</legend>
      <label>来源<select name="provider">${providerOpts}</select></label>
      <label data-for="claude openai">模型<input name="model" value="${esc(c.model)}" placeholder=""></label>
      <label data-for="openai">接口地址（可选，留空用设置里的默认值）<input name="baseUrl" value="${esc(c.baseUrl)}" placeholder="https://api.deepseek.com/v1"></label>
      <label data-for="openai">API Key（可选，留空用设置里的默认值）<input name="apiKey" type="password" value="${esc(c.apiKey)}" autocomplete="off"></label>
      <p class="note" data-for="claude">使用「设置」里的 Anthropic API Key。</p>
    </fieldset>
    <div class="actions">
      ${isNew ? "" : `<button class="ghost-btn danger" value="delete">删除</button>`}
      <span class="spacer"></span>
      <button class="ghost-btn" value="cancel" formnovalidate>取消</button>
      <button class="primary-btn" value="save">保存</button>
    </div>`,
    (fd, action) => {
      if (action === "delete") {
        if (!confirm(`确定删除 ${c.name}？TA 在房间里的旧消息会保留。`)) return;
        state.companions = state.companions.filter(x => x.id !== c.id);
        state.rooms.forEach(r => { r.memberIds = r.memberIds.filter(id => id !== c.id); });
      } else {
        Object.assign(c, {
          name: fd.get("name").trim(), avatar: fd.get("avatar").trim() || "✨",
          color: fd.get("color") || c.color, persona: fd.get("persona").trim(),
          provider: fd.get("provider"), model: fd.get("model").trim(),
          baseUrl: fd.get("baseUrl").trim(), apiKey: fd.get("apiKey").trim(),
        });
        if (isNew) state.companions.push(c);
      }
      save(); renderAll();
    },
    form => {
      const sel = form.querySelector("[name=provider]");
      const sync = () => {
        form.querySelectorAll("[data-for]").forEach(el => {
          el.classList.toggle("hidden", !el.dataset.for.split(" ").includes(sel.value));
        });
        form.querySelector("[name=model]").placeholder = PROVIDERS[sel.value].defaultModel;
      };
      sel.onchange = sync; sync();
    });
}

function editRoom(room) {
  const isNew = !room;
  room ??= { id: uid(), name: "", memberIds: [], replyMode: "all", messages: [] };
  openDialog(`
    <h2>${isNew ? "新的房间" : "房间设置"}</h2>
    <label>名字<input name="name" value="${esc(room.name)}" required placeholder="例如：客厅、书房、深夜聊天"></label>
    <label>谁在这里</label>
    <div class="check-list">${state.companions.map(c => `
      <label><input type="checkbox" name="members" value="${c.id}" ${room.memberIds.includes(c.id) ? "checked" : ""}>
      ${avatar(c)} ${esc(c.name)}</label>`).join("") || `<p class="note">还没有伙伴，先去左边创建一位。</p>`}
    </div>
    <label>多人时怎么回应
      <select name="replyMode">
        <option value="all" ${room.replyMode !== "one" ? "selected" : ""}>每个人依次回应</option>
        <option value="one" ${room.replyMode === "one" ? "selected" : ""}>随机一位回应（更像群聊）</option>
      </select>
    </label>
    <p class="note">无论哪种模式，消息里写 @名字 都只会让被点名的人回答。</p>
    <div class="actions">
      ${isNew ? "" : `<button class="ghost-btn danger" value="clear">清空记录</button><button class="ghost-btn danger" value="delete">删除房间</button>`}
      <span class="spacer"></span>
      <button class="ghost-btn" value="cancel" formnovalidate>取消</button>
      <button class="primary-btn" value="save">保存</button>
    </div>`,
    (fd, action) => {
      if (action === "delete") {
        if (!confirm(`删除房间「${room.name}」和其中所有聊天记录？`)) return;
        state.rooms = state.rooms.filter(r => r.id !== room.id);
        if (state.activeRoomId === room.id) state.activeRoomId = state.rooms[0]?.id ?? null;
      } else if (action === "clear") {
        if (!confirm("清空这个房间的聊天记录？")) return;
        room.messages = [];
      } else {
        room.name = fd.get("name").trim();
        room.memberIds = fd.getAll("members");
        room.replyMode = fd.get("replyMode");
        if (isNew) { state.rooms.push(room); state.activeRoomId = room.id; }
      }
      save(); renderAll();
    });
}

function editSettings() {
  const s = state.settings;
  openDialog(`
    <h2>设置</h2>
    <label>你的名字（伙伴们会这样称呼你）<input name="userName" value="${esc(s.userName)}" placeholder="例如：小周"></label>
    <fieldset>
      <legend>Claude</legend>
      <label>Anthropic API Key<input name="anthropicKey" type="password" value="${esc(s.anthropicKey)}" placeholder="sk-ant-…" autocomplete="off"></label>
    </fieldset>
    <fieldset>
      <legend>OpenAI 兼容接口（默认值）</legend>
      <label>接口地址<input name="openaiBaseUrl" value="${esc(s.openaiBaseUrl)}"></label>
      <label>API Key<input name="openaiKey" type="password" value="${esc(s.openaiKey)}" autocomplete="off"></label>
    </fieldset>
    <p class="note">密钥只保存在这个浏览器的本地存储里，并由浏览器直接发给对应的服务商。请只在自己的设备上使用。</p>
    <div class="actions">
      <button class="ghost-btn danger" value="reset">重置全部数据</button>
      <span class="spacer"></span>
      <button class="ghost-btn" value="cancel" formnovalidate>取消</button>
      <button class="primary-btn" value="save">保存</button>
    </div>`,
    (fd, action) => {
      if (action === "reset") {
        if (!confirm("清除所有伙伴、房间、聊天记录和密钥？")) return;
        try { localStorage.clear(); } catch { /* ignore */ }
        location.reload();
        return;
      }
      for (const k of ["userName", "anthropicKey", "openaiBaseUrl", "openaiKey"]) s[k] = fd.get(k).trim();
      save(); renderAll();
    });
}

// ================= 事件 =================

function send() {
  const text = els.input.value.trim();
  if (!text || busy) return;
  els.input.value = "";
  autoGrow();
  runTurn(text);
}

function autoGrow() {
  els.input.style.height = "auto";
  els.input.style.height = Math.min(els.input.scrollHeight, 200) + "px";
}

els.sendBtn.onclick = send;
els.continueBtn.onclick = () => runTurn(null);
els.stopBtn.onclick = () => abortCtrl?.abort();
els.input.addEventListener("input", autoGrow);
els.input.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
});

$("#newRoomBtn").onclick = () => editRoom();
$("#newCompanionBtn").onclick = () => editCompanion();
$("#editRoomBtn").onclick = () => activeRoom() && editRoom(activeRoom());
$("#settingsBtn").onclick = editSettings;
$("#menuBtn").onclick = () => els.sidebar.classList.toggle("open");

els.roomList.onclick = e => {
  const li = e.target.closest("[data-room]");
  if (!li || busy) return;
  state.activeRoomId = li.dataset.room;
  els.sidebar.classList.remove("open");
  save(); renderAll();
};

els.companionList.onclick = e => {
  const dm = e.target.closest("[data-dm]");
  if (dm) {
    if (busy) return;
    const c = companionById(dm.dataset.dm);
    let room = state.rooms.find(r => r.memberIds.length === 1 && r.memberIds[0] === c.id);
    if (!room) {
      room = { id: uid(), name: `和${c.name}聊聊`, memberIds: [c.id], replyMode: "all", messages: [] };
      state.rooms.push(room);
    }
    state.activeRoomId = room.id;
    els.sidebar.classList.remove("open");
    save(); renderAll();
    return;
  }
  const li = e.target.closest("[data-companion]");
  if (li) editCompanion(companionById(li.dataset.companion));
};

renderAll();
