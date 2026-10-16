<script setup>
// 工作间：你服务器上的 Codex 干活的地方。先是「直接用 Codex」：你说，它在项目文件夹里读写、跑命令；
// 过程一条条摊开（说的话、计划、命令和输出、改了哪些文件和 diff、要你点的审批），可以插话、可以停。
// 以后「和他一起工作」也在这里：他带着记忆来，替你指挥 Codex。
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from "vue";
import { useRoute, useRouter } from "vue-router";
import { wr, refresh, connect, disconnect, ensureLive, loadThread, thread, startLogin, logout, newProject, deleteProject, gitState, gitPush, gitPull, newThread, say, interrupt, answer, setPolicy, limitsOf, uploadAttachment, attachmentUrl } from "../lib/workroom.js";
import { blockMd } from "../lib/inlineMd.js";
import { store, MAIN, roleById } from "../store/index.js";
import { workThread, loadTalk, talk, report, wrapUp, turnDoneSince, busy as himBusy, phases as himPhases } from "../lib/workTogether.js";
import WorkMarkdown from "../components/WorkMarkdown.vue";
import Avatar from "../components/Avatar.vue";

// Codex 写的话：```代码块```、[文字](链接) 也排出来（链接是本地文件路径的，显示成代码样子）
const escHtml = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const mdCache = new Map();
function workMd(text) {
  if (mdCache.has(text)) return mdCache.get(text);
  const html = renderWorkMd(text);
  if (mdCache.size > 200) mdCache.clear();
  mdCache.set(text, html);
  return html;
}
function renderWorkMd(text) {
  return String(text || "").split(/(```[\w-]*\n?[\s\S]*?(?:```|$))/).map(part => {
    const m = part.match(/^```[\w-]*\n?([\s\S]*?)(?:```)?$/);
    if (m && part.startsWith("```")) return `<pre class="code">${escHtml(m[1].replace(/\n$/, ""))}</pre>`;
    return blockMd(part.replace(/^\n+|\n+$/g, ""))
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, "<code>$1</code>");
  }).filter(Boolean).join("");
}
import { vAutoGrow } from "../lib/autogrow.js";
import { toast } from "../lib/toast.js";
import { goBack } from "../lib/nav.js";
import Icon from "../components/Icon.vue";
import Sheet from "../components/Sheet.vue";

const route = useRoute();
const router = useRouter();
const loading = ref(true);
onMounted(async () => {
  await refresh();
  loading.value = false;
  connect();
  if (route.query.t) open(String(route.query.t));
});
onBeforeUnmount(disconnect);
// 看门狗：实时连接悄悄断了（切到后台、服务器重装过）就重连；服务器说有审批在等、页面上却没有，就把这个任务重新拉一遍
// 不然 Codex 等你点、你这边什么也看不到
async function watchdog() {
  if (document.hidden) return;
  ensureLive();
  await refresh();
  const id = cur.value;
  if (!id || !t.value) return;
  // 服务器说没在干活了，页面还以为在干（重启时那一轮没了）：以服务器为准，停止键也就不会白按
  const meta = (wr.status?.threads || []).find(x => x.id === id);
  if (meta && !meta.turnId && t.value.turnId) t.value.turnId = null;
  const waiting = (wr.status?.approvals || []).filter(a => a.threadId === id);
  const shownKeys = new Set(t.value.items.filter(x => x.kind === "approval" && x.state === "pending").map(x => x.key));
  if (!wr.live || waiting.some(a => !shownKeys.has(a.key))) loadThread(id).catch(() => {});
}
const dogTimer = setInterval(watchdog, 8000);
// 从后台回来：手机在后台会悄悄掐断连接、页面却以为还连着，直接重连（服务器会马上回一句，很快就绿）
const onShow = () => { if (!document.hidden) { disconnect(); connect(); watchdog(); } };
document.addEventListener("visibilitychange", onShow);
onBeforeUnmount(() => { clearInterval(dogTimer); document.removeEventListener("visibilitychange", onShow); });
// Safari 收键盘时高度和 offsetTop 不一定同时恢复，不能把残留偏移当成整页的 top。
const viewport = ref({});
let viewportFrame;
let viewportSettles = [];
const updateViewport = () => {
  cancelAnimationFrame(viewportFrame);
  viewportFrame = requestAnimationFrame(() => {
    const vv = window.visualViewport;
    const height = vv?.height || window.innerHeight;
    const gap = Math.max(0, window.innerHeight - height);
    const top = Math.min(Math.max(0, vv?.offsetTop || 0), gap);
    viewport.value = { height: `${height}px`, top: `${top}px` };
    // 工作间只让正文滚动；收键盘后清掉 Safari 为聚焦输入框产生的文档滚动。
    if (gap <= 1 && (!vv || !vv.scale || vv.scale === 1) && window.scrollY) window.scrollTo(0, 0);
  });
};
const settleViewport = () => {
  viewportSettles.forEach(clearTimeout);
  updateViewport();
  // 等 Safari 的收键盘动画结束再读一次，不缓存键盘高度。
  viewportSettles = [100, 350, 700].map(ms => setTimeout(updateViewport, ms));
};
onMounted(() => {
  updateViewport();
  document.addEventListener('focusout', settleViewport);
  window.visualViewport?.addEventListener('resize', updateViewport);
  window.visualViewport?.addEventListener('scroll', updateViewport);
  window.addEventListener('resize', updateViewport);
});
onBeforeUnmount(() => {
  cancelAnimationFrame(viewportFrame);
  viewportSettles.forEach(clearTimeout);
  document.removeEventListener('focusout', settleViewport);
  window.visualViewport?.removeEventListener('resize', updateViewport);
  window.visualViewport?.removeEventListener('scroll', updateViewport);
  window.removeEventListener('resize', updateViewport);
});

const st = computed(() => wr.status);
const projects = computed(() => st.value?.projects || []);
const project = ref("");
watch(projects, ps => { if (!project.value && ps.length) project.value = ps[0]; }, { immediate: true });
const threadsHere = computed(() => (st.value?.threads || []).filter(t => t.project === project.value && t.status !== "archived"));
const limits = computed(() => limitsOf(st.value?.rateLimits));

// ---------- 登录 ----------
const logging = ref(false);
async function login() {
  logging.value = true;
  try { await startLogin(); } catch (e) { toast(e.message, 5000); } finally { logging.value = false; }
}
const copy = t => navigator.clipboard?.writeText(t).then(() => toast("复制了")).catch(() => {});

// ---------- 项目、任务 ----------
async function addProject() {
  const n = prompt("新项目叫什么？（会在服务器上建一个同名文件夹）");
  if (!n?.trim()) return;
  try { await newProject(n); project.value = n.trim(); } catch (e) { toast(e.message, 4000); }
}
async function dropProject() {
  const n = project.value;
  if (!n || !confirm(`删掉项目「${n}」？服务器上这个文件夹里的东西会全部删掉，里面的任务记录也一起收起来。删了就找不回来。`)) return;
  try { await deleteProject(n); project.value = ""; toast("删掉了"); } catch (e) { toast(e.message, 5000); }
}
// 连着 GitHub 的项目（栖所）：还没推上去的提交，她点了才推
const git = ref(null);
const gitBusy = ref(false);
async function loadGit() {
  const n = project.value;
  git.value = null;
  if (n !== "栖所") return;
  try { const g = await gitState(n); if (project.value === n) git.value = g; } catch (e) { git.value = { error: e.message }; }
}
watch(project, loadGit, { immediate: true });
async function pushNow() {
  const g = git.value;
  if (!g?.ahead?.length) return;
  if (!confirm(`把这 ${g.ahead.length} 个提交推上线？\n\n${g.ahead.map(c => `· ${c.subject}`).join("\n")}\n\n推上去以后网页和中转会自动更新。`)) return;
  gitBusy.value = true;
  try { await gitPush(project.value); toast("推上去了"); } catch (e) { toast(e.message, 6000); } finally { gitBusy.value = false; loadGit(); }
}
// 拉最新的：GitHub 上有新提交（比如 cc 合并的），她点一下就同步到工作间
async function pullNow() {
  gitBusy.value = true;
  try { const r = await gitPull(project.value); toast(r.pulled ? `拉下来了 ${r.pulled} 个新提交` : "已经是最新的了"); } catch (e) { toast(e.message, 6000); } finally { gitBusy.value = false; loadGit(); }
}
async function addThread() {
  const n = prompt("这个任务叫什么？", "");
  if (n == null) return;
  try { const t = await newThread(project.value, n.trim()); open(t.id); } catch (e) { toast(e.message, 4000); }
}

// ---------- 一个任务（线程）的时间线 ----------
const cur = ref("");
const t = computed(() => (cur.value ? thread(cur.value) : null));
const running = computed(() => !!t.value?.turnId);
// 和他一起 / 直接用 Codex（每个任务各自记着；新任务默认和他一起）
const role = computed(() => roleById(MAIN));
const him = computed(() => role.value?.name || "他");
const wt = computed(() => (cur.value ? workThread(cur.value) : null));
const together = computed(() => wt.value?.mode !== "direct");
const talkList = ref([]);
const thinking = computed(() => !!himBusy[cur.value]);
const submitting = ref(null); // 带任务编号，切换任务时不会把上一条的阶段带过去
const progress = computed(() => {
  const sub = submitting.value?.id === cur.value ? submitting.value : null;
  if (sub?.uploading) return "正在上传附件";
  if (himPhases[cur.value] === "checking") return "正在检查结果";
  if (himPhases[cur.value] === "wrapping") return "正在整理收工摘要";
  if (himPhases[cur.value] === "preparing") return "正在整理任务";
  if (running.value) return "Codex 正在执行";
  if (sub) return sub.mode ? "正在整理任务" : "正在发送给 Codex";
  return "";
});
// 时间线：你们的对话插在说话那时 Codex 过程走到的地方（按先后，不靠服务器和手机的钟）；直接用 Codex 时只有过程
const timeline = computed(() => {
  const codex = t.value?.items || [];
  if (!talkList.value.length) return codex;
  const talks = talkList.value.map(m => ({ kind: m.from === "me" ? "talkMe" : "talkHim", text: m.text, notes: m.notes, attachments: m.attachments, ts: m.ts, id: m.id, at: m.at ?? Infinity }));
  // 按时间排先后（以前按「说话时 Codex 走到第几条」，记录一多、页面只拉最近一段，条数对不上，你们的对话全被挤到最后）
  const out = [];
  let k = 0;
  codex.forEach(it => { while (k < talks.length && it.ts && talks[k].ts <= it.ts) out.push(talks[k++]); out.push(it); });
  while (k < talks.length) out.push(talks[k++]);
  return out;
});
// 等你点的审批：不夹在过程里，固定放在最下面（输入框上面），一进来就看得到
const asks = computed(() => (t.value?.items || []).filter(x => x.kind === "approval" && x.state === "pending"));
// Codex 那边「你说的话」：是他交过去的，就标成「他交给 Codex」
const sentByHim = it => together.value || (wt.value?.sent || []).some(s => String(it.text || "").startsWith(s));
// 他交过去的那一轮做完了：他先看一遍再告诉你（页面开着才会；没开着，下次打开时补上）
async function maybeReport() {
  const id = cur.value;
  if (!id || !together.value || !role.value) return;
  const w = workThread(id);
  if (w.awaiting && !t.value?.turnId && turnDoneSince(id, w.dispatchedAt)) {
    try { await report(role.value, id); } catch (e) { toast(`${him.value}没看成：${e.message}`, 4000); }
    down();
  }
}
const scroller = ref(null);
const down = () => nextTick(() => { const el = scroller.value; if (el) el.scrollTop = el.scrollHeight; });
async function open(id) {
  cur.value = id;
  router.replace({ query: { t: id } });
  try { await loadThread(id); } catch (e) { toast(e.message, 4000); }
  talkList.value = await loadTalk(id);
  down();
  maybeReport();
}
function close() { cur.value = ""; router.replace({ query: {} }); }
// 新东西来了：已经在最下面就跟着滚
watch(() => [t.value?.items.length, t.value?.items.at(-1)?.text, t.value?.items.at(-1)?.output, talkList.value.length, himBusy[cur.value]], () => {
  const el = scroller.value;
  if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 160) down();
  maybeReport();
});
const setMode = m => { if (wt.value) wt.value.mode = m; };
async function finish() {
  try { await wrapUp(role.value, cur.value); down(); } catch (e) { toast(e.message, 4000); }
}
// 最后是「这一轮做完了」、没在干活：提示在等你
const waitingYou = computed(() => {
  if (!t.value || running.value || thinking.value) return false;
  const last = timeline.value[timeline.value.length - 1];
  return last && ((last.kind === "turn" && last.state !== "started") || last.kind === "talkHim");
});

const draft = ref("");
const files = ref([]);
const picker = ref(null);
function removeFile(i) { URL.revokeObjectURL(files.value[i].url); files.value.splice(i, 1); }
function chooseFiles(event) {
  for (const file of event.target.files || []) {
    if (files.value.length >= 4) { toast("每条消息最多 4 个附件"); break; }
    if (!/\.(png|jpe?g|gif|webp|mp4|webm|pdf|txt|md|csv|json|zip)$/i.test(file.name)) { toast("支持图片 PNG/JPEG/GIF/WebP、视频 MP4/WebM，以及 PDF/TXT/MD/CSV/JSON/ZIP"); continue; }
    if (!file.size || file.size > 20 * 1024 * 1024) { toast("附件必须非空且不超过 20 MB"); continue; }
    files.value.push({ file, url: URL.createObjectURL(file) });
  }
  event.target.value = "";
}
onBeforeUnmount(() => files.value.forEach(f => URL.revokeObjectURL(f.url)));

const sending = ref(false);
async function send() {
  const text = draft.value.trim();
  if ((!text && !files.value.length) || sending.value) return;
  sending.value = true;
  draft.value = "";
  const mode = together.value;
  const id = cur.value;
  submitting.value = { id, mode, uploading: files.value.length > 0 };
  down();
  try {
    const attached = [];
    for (const f of files.value) attached.push(await uploadAttachment(id, f.file));
    submitting.value.uploading = false;
    const picked = files.value.map(f => f.file);
    while (files.value.length) removeFile(0); // 传上去了就收起来，不等他回完
    if (mode) { const p = talk(role.value, id, text, attached, picked); down(); await p; }
    else { await say(id, text, attached); }
    down();
  } catch (e) { if (!draft.value) draft.value = text; toast(e.message, 5000); } finally { sending.value = false; submitting.value = null; }
}
async function stop() { try { await interrupt(cur.value); } catch (e) { toast(e.message, 4000); } }
async function decide(it, decision) {
  try { await answer(it.key, decision); it.state = "answered"; it.decision = decision; } catch (e) { toast(e.message, 4000); }
}

// ---------- 显示 ----------
// /bin/sh -lc '…'：只留里面的命令
const cmdText = c => { const s = String(c || ""); const m = s.match(/^\/bin\/(?:ba)?sh -l?c (["'])([\s\S]*)\1$/); return m ? m[2] : s; };
const CMD_STATE = { inProgress: "运行中", completed: "完成", failed: "失败", declined: "没让跑" };
const TURN_STATE = { completed: "这一轮做完了", interrupted: "这一轮停下了", failed: "这一轮出错了" };
const DECISION = { accept: "允许了这一次", acceptForSession: "这次任务里都允许", decline: "没允许", cancel: "没允许，并停下了" };
const KIND = { add: "新建", delete: "删除", update: "修改" };
const openOut = ref({}); // 哪条命令展开着（整条命令 + 输出）
// 连着跑的命令收成一行「跑了 N 条命令」，点开才看每一条（命令太长，摊开一大串看不懂）
// 夹在命令中间、已经答过的审批（「你这次任务里都允许」）也收进去；还在等你点的照样露在外面
const openGrp = ref({});
const quietAsk = it => it.kind === "approval" && it.state !== "pending";
const shown = computed(() => {
  const out = [];
  for (const it of timeline.value) {
    const last = out[out.length - 1];
    if (it.kind === "approval" && it.state === "pending") continue; // 放到最下面去
    if (it.kind !== "command" && !quietAsk(it)) out.push(it);
    else if (last?.kind === "cmds") { last.seq.push(it); if (it.kind === "command") last.list.push(it); }
    else out.push({ kind: "cmds", id: `g:${it.id || out.length}`, seq: [it], list: it.kind === "command" ? [it] : [] });
  }
  // 只收到审批、没有命令的：还是原样一行
  return out.flatMap(g => (g.kind === "cmds" && !g.list.length ? g.seq : [g]));
});
const firstLine = c => { const l = cmdText(c).split("\n")[0]; return l.length > 36 ? l.slice(0, 36) + "…" : l; };
const grpState = list => (list.some(c => c.status === "inProgress") ? "inProgress" : list.some(c => c.status === "failed") ? "failed" : "completed");
function grpLabel(list) {
  const now = list.find(c => c.status === "inProgress");
  if (now) return `正在跑：${firstLine(now.command)}`;
  const bad = list.filter(c => c.status === "failed").length;
  return `跑了 ${list.length} 条命令${bad ? `，${bad} 条没成功` : ""}`;
}
const openDiff = ref({});
const diffLines = d => String(d || "").split("\n").map(l => ({ l, c: /^\+(?!\+\+)/.test(l) ? "add" : /^-(?!--)/.test(l) ? "del" : /^@@/.test(l) ? "hunk" : "" }));
const dur = ms => (ms == null ? "" : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);
const resetText = s => { if (!s) return ""; const m = Math.round((s * 1000 - Date.now()) / 60000); return m <= 0 ? "" : m < 60 ? `${m} 分钟后恢复` : `${Math.round(m / 60)} 小时后恢复`; };

// ---------- 规则 ----------
const ruleOpen = ref(false);
const RULES = [
  ["autoAll", "放手让它做", "在项目里干活都不问你；只有删东西、装东西、联网、碰项目外面才问"],
  ["autoRead", "只看不改的命令直接放行", "看文件、搜索、git status / diff 这类"],
  ["autoTest", "跑测试、检查直接放行", "npm test、node --test、pytest 这类（会执行项目里的代码）"],
  ["autoEdit", "改项目里的文件直接放行", "改了什么都在 diff 里看得见；改项目外面的还是要问"],
];
</script>

<template>
  <div class="wr" :style="viewport">
    <header class="bar">
      <button class="icon-btn" aria-label="返回" @click="cur ? close() : goBack(router, '/settings')"><Icon name="back" /></button>
      <div class="ttl">
        <b>{{ cur ? t?.meta?.title || "任务" : "工作间" }}</b>
        <small><i class="dot" :class="{ on: wr.live }" />{{ cur ? `${t?.meta?.project || ""} · ${running ? "正在干活" : "空闲"}` : wr.live ? "连着服务器上的 Codex" : "没连上" }}</small>
      </div>
      <button v-if="st?.account" class="icon-btn" aria-label="规则" @click="ruleOpen = true"><Icon name="settings" /></button>
    </header>

    <p v-if="loading" class="hint">在连服务器…</p>
    <div v-else-if="wr.error && !st" class="card pad">
      <b>连不上工作间</b>
      <p class="muted">{{ wr.error }}</p>
      <p class="muted">工作间装在你自己的服务器上：在服务器上再运行一次栖所服务器的安装，问到「要装工作间吗」回答 y。详细见 docs/workroom.md。</p>
      <button class="btn soft small" @click="refresh">再试一次</button>
    </div>

    <!-- 还没登录 -->
    <div v-else-if="st && !st.account" class="card pad">
      <b>用你的 ChatGPT 登录 Codex</b>
      <p class="muted">用的是你 Plus 的 Codex 额度。登录信息只存在你的服务器上。</p>
      <template v-if="wr.login">
        <p>1. 打开这个网址：</p>
        <a class="link" :href="wr.login.verificationUrl" target="_blank" rel="noopener">{{ wr.login.verificationUrl }}</a>
        <p>2. 登录 ChatGPT，输入这串码：</p>
        <div class="code" @click="copy(wr.login.userCode)">{{ wr.login.userCode }}<small>点一下复制</small></div>
        <p class="muted small">这串码只在 OpenAI 的页面上输入，不要发给任何人。输好以后这里会自己变。</p>
        <p class="muted small">如果页面说要先在 ChatGPT 设置里打开「设备码登录」：设置 → 安全 → 打开它，再回来点一次登录。</p>
      </template>
      <button class="btn" :disabled="logging" @click="login">{{ logging ? "在要码…" : wr.login ? "换一串码" : "登录" }}</button>
    </div>

    <!-- 项目和任务 -->
    <template v-else-if="st && !cur">
      <div v-if="limits.length" class="limits">
        <div v-for="l in limits" :key="l.label" class="lim">
          <span>{{ l.label }}额度</span>
          <div class="lbar"><i :style="{ width: Math.max(2, Math.min(100, l.used)) + '%' }" :class="{ hi: l.used >= 80 }" /></div>
          <em>用了 {{ l.used }}%<template v-if="resetText(l.resetsAt)"> · {{ resetText(l.resetsAt) }}</template></em>
        </div>
      </div>
      <p class="sec">项目<small>　服务器上的文件夹，Codex 只能动这里面的东西</small></p>
      <div class="chips">
        <button v-for="p in projects" :key="p" :class="{ on: project === p }" @click="project = p">{{ p }}</button>
        <button class="add" @click="addProject">＋ 新项目</button>
      </div>
      <button v-if="project" class="del-proj" @click="dropProject">删掉「{{ project }}」这个项目</button>
      <template v-if="project">
        <div v-if="git" class="git">
          <template v-if="git.error"><small>GitHub：{{ git.error }}</small></template>
          <template v-else-if="!git.cloned"><small>这里还没有栖所的代码（服务器上重新运行一次安装那一行就会放进来）</small></template>
          <template v-else>
            <p><b>GitHub</b><small>　{{ git.repo }} · {{ git.branch }}</small><button class="re" @click="loadGit">刷新</button></p>
            <template v-if="git.behind">
              <small>GitHub 上有 {{ git.behind }} 个新提交这里还没有</small>
              <button class="push soft" :disabled="gitBusy" @click="pullNow">{{ gitBusy ? "在拉…" : "拉最新的" }}</button>
            </template>
            <small v-if="git.dirty.length">还有 {{ git.dirty.length }} 个文件改了没提交</small>
            <template v-if="git.ahead.length">
              <ul><li v-for="c in git.ahead" :key="c.sha">{{ c.subject }}</li></ul>
              <button class="push" :disabled="gitBusy || !git.canPush || git.behind > 0" @click="pushNow">{{ gitBusy ? "推上去中…" : `推上线（${git.ahead.length} 个提交）` }}</button>
              <small v-if="!git.canPush">还没放 GitHub 钥匙，推不了（服务器上重新运行一次安装那一行，按提示放）</small>
            </template>
            <small v-else-if="!git.dirty.length && !git.behind">和线上一样，没有要推的</small>
          </template>
        </div>
        <p class="sec">任务<small>　每个任务是一段单独的工作记录</small></p>
        <button v-for="x in threadsHere" :key="x.id" class="row" @click="open(x.id)">
          <b>{{ x.title }}</b>
          <small>{{ x.turnId ? "正在干活 · " : "" }}{{ new Date(x.updatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) }}</small>
          <i v-if="(st.approvals || []).some(a => a.threadId === x.id)" class="wait">等你点</i>
        </button>
        <button class="row add" @click="addThread"><b>＋ 新任务</b></button>
      </template>
      <p v-else class="hint">先建一个项目。以后要改的代码放进服务器的 codex-work 文件夹，或者让 Codex 自己建。</p>
    </template>

    <!-- 一个任务的过程 -->
    <template v-else-if="t">
      <div class="modes">
        <button :class="{ on: together }" @click="setMode('gpt')">和{{ him }}一起</button>
        <button :class="{ on: !together }" @click="setMode('direct')">直接用 Codex</button>
      </div>
      <main ref="scroller" class="tl">
        <p v-if="!timeline.length" class="hint">{{ together ? `和${him}说说要做什么。${him}会和你商量，把具体的活交给 Codex，Codex 干活的过程都会摊在这里，做完${him}先看一遍再告诉你。` : `说说要做什么。Codex 会在「${t.meta?.project}」这个文件夹里读文件、改代码、跑命令，过程都会摊在这里。` }}</p>
        <template v-for="(it, i) in shown" :key="it.id || i">
          <div v-if="it.attachments?.length" class="attachments"><a v-for="a in it.attachments" :key="a.id" :href="attachmentUrl(cur, a.id)" target="_blank" rel="noopener noreferrer"><img v-if="a.type.startsWith('image/')" :src="attachmentUrl(cur, a.id)" /><video v-else-if="a.type.startsWith('video/')" :src="attachmentUrl(cur, a.id)" controls preload="metadata" />{{ a.name }} · {{ Math.ceil(a.size / 1024) }} KB · {{ a.type }}<small v-if="a.preview">{{ a.preview.route }} · {{ a.preview.width }}×{{ a.preview.height }} · {{ a.preview.theme }} · {{ a.preview.generatedAt }}</small></a></div>
          <div v-if="it.kind === 'talkMe'" class="me"><p>{{ it.text }}</p></div>
          <div v-else-if="it.kind === 'talkHim'" class="him">
            <Avatar :img="role?.avatar" :name="him" :color="role?.color" :size="30" />
            <div class="him-body">
              <WorkMarkdown v-if="it.text" class="agent" :text="it.text" :render="workMd" />
              <small v-for="(n, k) in it.notes || []" :key="k" class="him-note">{{ n }}</small>
            </div>
          </div>
          <div v-else-if="it.kind === 'user' && sentByHim(it)" class="card task"><b>{{ him }}交给 Codex{{ it.steer ? "（插话）" : "" }}</b></div>
          <div v-else-if="it.kind === 'user'" class="me"><p>{{ it.text }}</p><small v-if="it.steer">插话</small></div>
          <p v-else-if="it.kind === 'previewError'" class="hint">{{ it.text }}</p>
          <WorkMarkdown v-else-if="it.kind === 'agent'" class="agent" :text="it.text" :render="workMd" />
          <details v-else-if="it.kind === 'reasoning' && it.text" class="think"><summary>思考</summary><p>{{ it.text }}</p></details>
          <div v-else-if="it.kind === 'plan'" class="card plan">
            <b>计划</b>
            <p v-if="it.explanation" class="muted small">{{ it.explanation }}</p>
            <p v-for="(s, k) in it.steps || []" :key="k" :class="s.status"><i>{{ s.status === "completed" ? "✓" : s.status === "inProgress" ? "▸" : "○" }}</i>{{ s.step }}</p>
            <p v-if="!it.steps && it.text">{{ it.text }}</p>
          </div>
          <div v-else-if="it.kind === 'cmds'" class="cmds">
            <button class="cmds-head" @click="openGrp[it.id] = !openGrp[it.id]">
              <i class="st" :class="grpState(it.list)" /><span>{{ grpLabel(it.list) }}</span><em>{{ openGrp[it.id] ? "收起 ▴" : "展开 ▾" }}</em>
            </button>
            <template v-if="openGrp[it.id]">
              <template v-for="(c, k) in it.seq" :key="c.id || k">
              <p v-if="c.kind === 'approval'" class="line">{{ c.state === "auto" ? `自动放行：${cmdText(c.command) || "改文件"}` : `你${DECISION[c.decision] || "回答了"}` }}</p>
              <div v-else class="card cmd" :class="c.status">
                <div class="cmd-head" @click="openOut[c.id] = !openOut[c.id]">
                  <code :class="{ clamp: !openOut[c.id] }">$ {{ cmdText(c.command) }}</code>
                  <span class="badge"><i v-if="c.auto" class="auto">自动放行</i>{{ CMD_STATE[c.status] || "…" }}<template v-if="c.exitCode != null"> · {{ c.exitCode }}</template><template v-if="c.durationMs"> · {{ dur(c.durationMs) }}</template></span>
                </div>
                <pre v-if="openOut[c.id] && c.output" class="out">{{ c.output }}</pre>
                <small v-else-if="c.output" class="muted tap" @click="openOut[c.id] = true">看输出（{{ c.output.split("\n").length }} 行）</small>
              </div>
              </template>
            </template>
          </div>
          <div v-else-if="it.kind === 'files'" class="card files">
            <b>改了文件<i v-if="it.auto" class="auto">自动放行</i></b>
            <div v-for="(c, k) in it.changes || []" :key="k" class="file">
              <div class="file-head" @click="openDiff[it.id + k] = !openDiff[it.id + k]"><span class="kind">{{ KIND[c.kind?.type || c.kind] || "修改" }}</span><code>{{ c.path }}</code><span class="muted">{{ openDiff[it.id + k] ? "▴" : "▾" }}</span></div>
              <pre v-if="openDiff[it.id + k]" class="diff"><span v-for="(x, j) in diffLines(c.diff)" :key="j" :class="x.c">{{ x.l }}
</span></pre>
            </div>
          </div>
          <p v-else-if="it.kind === 'approval'" class="line">{{ it.state === "auto" ? `自动放行：${cmdText(it.command) || "改文件"}` : `你${DECISION[it.decision] || "回答了"}` }}</p>
          <p v-else-if="it.kind === 'tool'" class="line">用了 {{ it.name }}</p>
          <p v-else-if="it.kind === 'note'" class="line">{{ it.text }}</p>
          <p v-else-if="it.kind === 'error'" class="line bad">{{ it.retrying ? "出了点问题，Codex 在自己重试：" : "出错了：" }}{{ it.text }}</p>
          <div v-else-if="it.kind === 'turn' && it.state !== 'started'" class="turn" :class="it.state">
            <span>{{ TURN_STATE[it.state] || it.state }}{{ it.error ? `：${it.error}` : "" }}</span>
            <button v-if="it.diff" class="tap" @click="openDiff['turn' + i] = !openDiff['turn' + i]">这一轮的全部改动 {{ openDiff["turn" + i] ? "▴" : "▾" }}</button>
            <pre v-if="openDiff['turn' + i]" class="diff"><span v-for="(x, j) in diffLines(it.diff)" :key="j" :class="x.c">{{ x.l }}
</span></pre>
          </div>
        </template>
        <div v-for="it in asks" :key="it.id" class="card ask">
          <b>{{ it.method?.includes("fileChange") ? "要改文件" : it.method?.includes("commandExecution") ? "要跑这条命令" : "要你确认" }}</b>
          <code v-if="it.command">$ {{ cmdText(it.command) }}</code>
          <p v-if="it.cwd" class="muted small">在 {{ it.cwd }}</p>
          <p v-if="it.reason" class="muted small">原因：{{ it.reason }}</p>
          <p v-if="it.grantRoot" class="muted small">想要能写：{{ it.grantRoot }}</p>
          <div class="ask-btns">
            <button class="btn small" @click="decide(it, 'accept')">允许这一次</button>
            <button class="btn soft small" @click="decide(it, 'acceptForSession')">这次任务里都允许</button>
            <button class="btn soft small" @click="decide(it, 'decline')">不行</button>
            <button class="btn soft small danger" @click="decide(it, 'cancel')">不行，停下</button>
          </div>
        </div>
        <div v-if="progress" class="working" role="status" aria-live="polite"><i /><i /><i /> {{ progress }}</div>
        <p v-else-if="waitingYou" class="your-turn">{{ together ? `等你说下一步` : "Codex 做完了，等你说下一步" }}<button v-if="together && talkList.length" class="tap" @click="finish">· 收工，让{{ him }}记下来</button></p>
      </main>
      <div v-if="files.length" class="attachments pending"><div v-for="(f, i) in files" :key="f.url"><img v-if="f.file.type.startsWith('image/')" :src="f.url" /><video v-else-if="f.file.type.startsWith('video/')" :src="f.url" controls preload="metadata" /><span>{{ f.file.name }} · {{ Math.ceil(f.file.size / 1024) }} KB · {{ f.file.type || '未知类型' }}</span><button :disabled="sending" @click="removeFile(i)">移除</button></div></div>
      <footer class="dock">
        <input ref="picker" type="file" multiple hidden @change="chooseFiles" />
        <button class="send" :disabled="sending" aria-label="添加附件" @click="picker.click()">＋</button>
        <textarea v-model="draft" v-auto-grow="160" rows="1" class="input" :placeholder="together ? `和${him}说…` : running ? '插一句（不用停下它）…' : '要做什么…'" />
        <button v-if="running" class="send stop" aria-label="停下" @click="stop"><Icon name="stop" :size="18" /></button>
        <button class="send" :class="{ on: draft.trim() }" :disabled="sending" aria-label="发送" @click="send"><Icon name="send" :size="18" /></button>
      </footer>
    </template>

    <Sheet :open="ruleOpen" title="哪些事不用问你" @close="ruleOpen = false">
      <label v-for="[k, l, sub] in RULES" :key="k" class="rule">
        <span><b>{{ l }}</b><small>{{ sub }}</small></span>
        <input type="checkbox" class="sw" :checked="st?.policy?.[k]" @change="setPolicy({ [k]: $event.target.checked })" />
      </label>
      <p class="muted small">删东西、装东西、联网、碰项目外面的，永远要问你。Codex 所在的容器只能连 OpenAI，别的网站都被门卫拦着。</p>
      <button v-if="st?.account" class="btn soft small" @click="logout(); ruleOpen = false">退出 Codex 登录</button>
    </Sheet>
  </div>
</template>

<style scoped>
.wr { position: fixed; inset: 0 0 auto; width: 100%; height: 100dvh; min-height: 0; overflow: hidden; background: var(--bg); display: flex; flex-direction: column; }
.bar { flex: none; position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 8px; padding: calc(var(--safe-top) + 10px) 12px 10px; background: rgba(var(--glass-rgb), .86); -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px); }
.ttl { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.ttl b { font-size: 1rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ttl small { font-size: .72rem; color: var(--text-3); display: flex; align-items: center; gap: 5px; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text-3); }
.dot.on { background: #6fbf73; }
.card { background: var(--card); border-radius: 16px; box-shadow: var(--shadow-soft); }
.pad { margin: 16px; padding: 16px; display: flex; flex-direction: column; gap: 8px; }
.pad p { margin: 0; line-height: 1.7; font-size: .9rem; }
.muted { color: var(--text-3); }
.small { font-size: .76rem; }
.link { word-break: break-all; color: var(--accent); }
.code { font: 600 1.6rem ui-monospace, Menlo, monospace; letter-spacing: .12em; text-align: center; padding: 12px; background: var(--bg-deep); border-radius: 12px; display: flex; flex-direction: column; cursor: pointer; }
.code small { font: .7rem sans-serif; letter-spacing: 0; color: var(--text-3); }
.hint { text-align: center; color: var(--text-3); font-size: .84rem; line-height: 1.8; margin: 24px 16px; }
.limits { margin: 12px 16px 0; display: flex; flex-direction: column; gap: 6px; }
.lim { display: grid; grid-template-columns: 6.5em 1fr auto; gap: 8px; align-items: center; font-size: .74rem; color: var(--text-2); }
/* 额度条：细细一条（类名别和顶栏的 .bar 撞了）；深色时用亮一点的蓝 */
.lbar { height: 4px; border-radius: 2px; background: var(--line); overflow: hidden; }
.lbar i { display: block; height: 100%; border-radius: 2px; background: var(--accent); }
.lbar i.hi { background: var(--danger); }
:root[data-theme="dark"] .lbar { background: #2f3542; }
:root[data-theme="dark"] .lbar i { background: #4da3ff; }
.lim em { font-style: normal; color: var(--text-3); }
.sec { margin: 20px 18px 8px; font-size: .86rem; font-weight: 600; color: var(--text-2); }
.sec small { font-weight: 400; color: var(--text-3); font-size: .72rem; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 16px; }
.chips button { border: 0; background: var(--card); padding: 6px 13px; border-radius: 999px; font-size: .84rem; color: var(--text-2); box-shadow: var(--shadow-soft); }
.chips button.on { background: var(--ink); color: var(--on-ink); }
.chips .add { background: none; box-shadow: inset 0 0 0 1.5px var(--line); }
.git { margin: 10px 14px 0; padding: 10px 12px; border-radius: 14px; background: rgba(var(--glass-rgb), .6); font-size: .8rem; }
.git p { margin: 0 0 4px; display: flex; align-items: center; }
.git small { display: block; color: var(--text-3); font-size: .72rem; line-height: 1.6; }
.git p small { display: inline; flex: 1; }
.git .re { border: 0; background: none; color: var(--accent); font-size: .72rem; }
.git ul { margin: 4px 0 8px; padding-left: 18px; color: var(--text-2); line-height: 1.6; }
.git .push { border: 0; border-radius: 10px; padding: 7px 14px; background: var(--accent); color: #fff; font-size: .8rem; }
.git .push:disabled { opacity: .5; }
.git .push.soft { background: var(--bg-deep); color: var(--text); margin: 4px 0 6px; }
.del-proj { display: block; margin: 8px 18px 0 auto; border: 0; background: none; font-size: .72rem; color: var(--text-3); }
.row { display: flex; align-items: baseline; gap: 8px; width: calc(100% - 32px); margin: 0 16px 8px; border: 0; text-align: left; background: var(--card); border-radius: 14px; padding: 12px 14px; box-shadow: var(--shadow-soft); color: var(--text); }
.row b { flex: 1; font-size: .92rem; }
.row small { color: var(--text-3); font-size: .72rem; }
.row.add { background: none; box-shadow: inset 0 0 0 1.5px var(--line); color: var(--text-2); justify-content: center; }
.wait { font-style: normal; font-size: .7rem; color: #fff; background: var(--danger); border-radius: 999px; padding: 1px 8px; }
.tl > * { flex-shrink: 0; }
.bar, .modes { flex-shrink: 0; }
.tl { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; max-width: 820px; width: 100%; margin: 0 auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
.me { align-self: flex-end; max-width: 85%; text-align: right; }
.me p { margin: 0; background: var(--ink); color: var(--on-ink); padding: 9px 13px; border-radius: 16px 16px 4px 16px; white-space: pre-wrap; line-height: 1.6; font-size: .92rem; text-align: left; }
.me small { font-size: .68rem; color: var(--text-3); }
.agent { font-size: .93rem; line-height: 1.75; color: var(--text); white-space: pre-wrap; }
.agent :deep(pre.code) { white-space: pre; overflow-x: auto; margin: .4em 0; font: .78rem/1.5 ui-monospace, Menlo, monospace; background: var(--bg-deep); padding: 8px 10px; border-radius: 8px; }
.agent :deep(a) { color: var(--accent); }
.auto { font-style: normal; font-size: .64rem; font-weight: 400; color: var(--text-3); background: var(--bg-deep); padding: 1px 6px; border-radius: 999px; margin: 0 6px; }
.agent :deep(p) { margin: 0 0 .5em; }
.agent :deep(code) { font-size: .86em; background: var(--bg-deep); padding: 1px 5px; border-radius: 5px; }
.think { font-size: .8rem; color: var(--text-3); }
.think p { white-space: pre-wrap; margin: 4px 0 0; line-height: 1.6; }
.plan { padding: 10px 14px; font-size: .86rem; }
.plan p { margin: 4px 0; display: flex; gap: 8px; color: var(--text-2); }
.plan p.completed { color: var(--text-3); text-decoration: line-through; }
.plan p.inProgress { color: var(--text); font-weight: 600; }
.plan i { font-style: normal; width: 1em; }
.cmd { padding: 8px 12px; border-left: 3px solid var(--line); }
.cmd.inProgress { border-left-color: var(--accent); }
.cmd.failed { border-left-color: var(--danger); }
.cmd.completed { border-left-color: #6fbf73; }
.cmd-head { display: flex; gap: 8px; align-items: baseline; cursor: pointer; }
.cmd-head code { flex: 1; font: .8rem ui-monospace, Menlo, monospace; white-space: pre-wrap; word-break: break-all; color: var(--text); }
.cmd-head code.clamp { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.cmds { display: flex; flex-direction: column; gap: 6px; }
.cmds-head { display: flex; align-items: center; gap: 8px; width: 100%; border: 0; background: var(--card); box-shadow: var(--shadow-soft); border-radius: 12px; padding: 8px 12px; font-size: .8rem; color: var(--text-2); text-align: left; }
.cmds-head span { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cmds-head em { font-style: normal; font-size: .7rem; color: var(--text-3); flex: none; }
.cmds-head .st { width: 7px; height: 7px; border-radius: 50%; flex: none; background: #6fbf73; }
.cmds-head .st.failed { background: var(--danger); }
.cmds-head .st.inProgress { background: var(--accent); animation: hop 1.2s infinite; }
.badge { font-size: .68rem; color: var(--text-3); white-space: nowrap; }
.out, .diff { margin: 8px 0 2px; max-height: 320px; overflow: auto; font: .74rem/1.5 ui-monospace, Menlo, monospace; background: var(--bg-deep); color: var(--text-2); padding: 8px 10px; border-radius: 8px; white-space: pre; }
.diff .add { color: #3f8f4f; background: rgba(111, 191, 115, .12); display: block; }
.diff .del { color: #c0505a; background: rgba(232, 136, 143, .12); display: block; }
.diff .hunk { color: var(--accent); display: block; }
.tap { font-size: .74rem; color: var(--text-3); cursor: pointer; border: 0; background: none; padding: 0; }
.files { padding: 10px 12px; font-size: .86rem; }
.file-head { display: flex; gap: 8px; align-items: baseline; margin-top: 6px; cursor: pointer; }
.file-head code { flex: 1; font: .8rem ui-monospace, Menlo, monospace; word-break: break-all; }
.kind { font-size: .68rem; color: var(--text-3); background: var(--bg-deep); padding: 1px 7px; border-radius: 999px; }
.ask { padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; box-shadow: 0 0 0 2px var(--accent), var(--shadow-soft); }
.ask code { font: .8rem ui-monospace, Menlo, monospace; white-space: pre-wrap; word-break: break-all; background: var(--bg-deep); padding: 6px 8px; border-radius: 8px; }
.ask p { margin: 0; }
.ask-btns { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.danger { color: var(--danger); }
.line { margin: 0; font-size: .74rem; color: var(--text-3); text-align: center; }
.line.bad { color: var(--danger); }
.turn { font-size: .76rem; color: var(--text-3); text-align: center; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 4px 0 8px; border-bottom: 1px dashed var(--line); }
.turn.failed span { color: var(--danger); }
.turn .diff { align-self: stretch; text-align: left; }
.working { display: flex; align-items: center; gap: 4px; font-size: .78rem; color: var(--text-2); }
.working i { width: 6px; height: 6px; border-radius: 50%; background: var(--text-3); animation: hop 1.2s infinite; }
.working i:nth-child(2) { animation-delay: .15s; }
.working i:nth-child(3) { animation-delay: .3s; margin-right: 4px; }
@keyframes hop { 0%, 60%, 100% { transform: translateY(0); opacity: .5; } 30% { transform: translateY(-3px); opacity: 1; } }
.dock { position: relative; flex: none; width: 100%; z-index: 1; display: flex; align-items: flex-end; gap: 8px; max-width: 820px; margin: 0 auto; padding: 10px 14px calc(var(--safe-bottom) + 12px); }
.dock .input { flex: 1; resize: none; min-height: 44px; height: 44px; max-height: min(160px, 30dvh); min-width: 0; font-size: 14px; line-height: 22px; border-radius: 22px; padding: 11px 16px; background: rgba(var(--glass-rgb), .94); -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px); box-shadow: var(--shadow-soft); }
.send { width: 44px; height: 44px; border-radius: 50%; border: 0; display: grid; place-items: center; background: var(--card); color: var(--text-3); box-shadow: var(--shadow-soft); flex: none; }
.send.on { background: var(--ink); color: var(--on-ink); }
.send.stop { color: var(--danger); }
.modes { display: flex; gap: 6px; justify-content: center; padding: 8px 0 0; }
.modes button { border: 0; background: var(--card); color: var(--text-2); font-size: .78rem; padding: 5px 13px; border-radius: 999px; box-shadow: var(--shadow-soft); }
.modes button.on { background: var(--ink); color: var(--on-ink); }
.him { display: flex; gap: 8px; align-items: flex-start; }
.him-body { flex: 1; min-width: 0; }
.him-note { display: block; font-size: .72rem; color: var(--text-3); }
.task { padding: 10px 12px; border-left: 3px solid var(--accent); }
.task b { font-size: .78rem; color: var(--accent); }
.task p { margin: 4px 0 0; font-size: .84rem; line-height: 1.6; white-space: pre-wrap; color: var(--text-2); }
.task b { display: flex; align-items: baseline; }
.task b em { margin-left: auto; font-style: normal; font-weight: 400; font-size: .7rem; color: var(--text-3); }
.task p.clamp { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; overflow: hidden; }
.your-turn { margin: 4px 0 0; font-size: .8rem; color: var(--accent); text-align: center; }
.your-turn .tap { margin-left: 4px; }
.rule { display: flex; align-items: center; gap: 12px; padding: 10px 2px; border-bottom: 1px solid var(--line); }
.rule span { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.rule b { font-size: .9rem; font-weight: 500; }
.rule small { font-size: .74rem; color: var(--text-3); }
.attachments { display: flex; gap: 8px; flex-wrap: wrap; padding: 8px 14px; font-size: .75rem; overflow-wrap: anywhere; }
.attachments a, .attachments > div { display: flex; flex-direction: column; gap: 4px; color: var(--text); }
.attachments img, .attachments video { align-self: flex-start; width: auto; height: auto; max-width: 160px; max-height: 160px; object-fit: contain; border-radius: 8px; }
.pending { max-height: 160px; overflow-y: auto; flex: none; }
</style>
