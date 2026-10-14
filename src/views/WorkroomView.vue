<script setup>
// 工作间：你服务器上的 Codex 干活的地方。先是「直接用 Codex」：你说，它在项目文件夹里读写、跑命令；
// 过程一条条摊开（说的话、计划、命令和输出、改了哪些文件和 diff、要你点的审批），可以插话、可以停。
// 以后「和他一起工作」也在这里：他带着记忆来，替你指挥 Codex。
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from "vue";
import { useRoute, useRouter } from "vue-router";
import { wr, refresh, connect, disconnect, loadThread, thread, startLogin, logout, newProject, newThread, say, interrupt, answer, setPolicy, limitsOf } from "../lib/workroom.js";
import { blockMd } from "../lib/inlineMd.js";
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
async function addThread() {
  const n = prompt("这个任务叫什么？", "");
  if (n == null) return;
  try { const t = await newThread(project.value, n.trim()); open(t.id); } catch (e) { toast(e.message, 4000); }
}

// ---------- 一个任务（线程）的时间线 ----------
const cur = ref("");
const t = computed(() => (cur.value ? thread(cur.value) : null));
const running = computed(() => !!t.value?.turnId);
const scroller = ref(null);
const down = () => nextTick(() => { const el = scroller.value; if (el) el.scrollTop = el.scrollHeight; });
async function open(id) {
  cur.value = id;
  router.replace({ query: { t: id } });
  try { await loadThread(id); } catch (e) { toast(e.message, 4000); }
  down();
}
function close() { cur.value = ""; router.replace({ query: {} }); }
// 新东西来了：已经在最下面就跟着滚
watch(() => t.value?.items.length, () => {
  const el = scroller.value;
  if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 160) down();
});

const draft = ref("");
const sending = ref(false);
async function send() {
  const text = draft.value.trim();
  if (!text || sending.value) return;
  sending.value = true;
  try { await say(cur.value, text); draft.value = ""; down(); } catch (e) { toast(e.message, 5000); } finally { sending.value = false; }
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
const openOut = ref({}); // 哪条命令的输出展开着
const openDiff = ref({});
const diffLines = d => String(d || "").split("\n").map(l => ({ l, c: /^\+(?!\+\+)/.test(l) ? "add" : /^-(?!--)/.test(l) ? "del" : /^@@/.test(l) ? "hunk" : "" }));
const dur = ms => (ms == null ? "" : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);
const resetText = s => { if (!s) return ""; const m = Math.round((s * 1000 - Date.now()) / 60000); return m <= 0 ? "" : m < 60 ? `${m} 分钟后恢复` : `${Math.round(m / 60)} 小时后恢复`; };

// ---------- 规则 ----------
const ruleOpen = ref(false);
const RULES = [
  ["autoRead", "只看不改的命令直接放行", "看文件、搜索、git status / diff 这类"],
  ["autoTest", "跑测试、检查直接放行", "npm test、node --test、pytest 这类（会执行项目里的代码）"],
  ["autoEdit", "改项目里的文件直接放行", "改了什么都在 diff 里看得见；改项目外面的还是要问"],
];
</script>

<template>
  <div class="wr">
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
          <div class="bar"><i :style="{ width: Math.min(100, l.used) + '%' }" :class="{ hi: l.used >= 80 }" /></div>
          <em>用了 {{ l.used }}%<template v-if="resetText(l.resetsAt)"> · {{ resetText(l.resetsAt) }}</template></em>
        </div>
      </div>
      <p class="sec">项目<small>　服务器上的文件夹，Codex 只能动这里面的东西</small></p>
      <div class="chips">
        <button v-for="p in projects" :key="p" :class="{ on: project === p }" @click="project = p">{{ p }}</button>
        <button class="add" @click="addProject">＋ 新项目</button>
      </div>
      <template v-if="project">
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
      <main ref="scroller" class="tl">
        <p v-if="!t.items.length" class="hint">说说要做什么。Codex 会在「{{ t.meta?.project }}」这个文件夹里读文件、改代码、跑命令，过程都会摊在这里。</p>
        <template v-for="(it, i) in t.items" :key="it.id || i">
          <div v-if="it.kind === 'user'" class="me"><p>{{ it.text }}</p><small v-if="it.steer">插话</small></div>
          <div v-else-if="it.kind === 'agent'" class="agent" v-html="blockMd(it.text)" />
          <details v-else-if="it.kind === 'reasoning' && it.text" class="think"><summary>思考</summary><p>{{ it.text }}</p></details>
          <div v-else-if="it.kind === 'plan'" class="card plan">
            <b>计划</b>
            <p v-if="it.explanation" class="muted small">{{ it.explanation }}</p>
            <p v-for="(s, k) in it.steps || []" :key="k" :class="s.status"><i>{{ s.status === "completed" ? "✓" : s.status === "inProgress" ? "▸" : "○" }}</i>{{ s.step }}</p>
            <p v-if="!it.steps && it.text">{{ it.text }}</p>
          </div>
          <div v-else-if="it.kind === 'command'" class="card cmd" :class="it.status">
            <div class="cmd-head" @click="openOut[it.id] = !openOut[it.id]">
              <code>$ {{ cmdText(it.command) }}</code>
              <span class="badge">{{ CMD_STATE[it.status] || "…" }}<template v-if="it.exitCode != null"> · {{ it.exitCode }}</template><template v-if="it.durationMs != null"> · {{ dur(it.durationMs) }}</template></span>
            </div>
            <pre v-if="(openOut[it.id] ?? it.status === 'inProgress') && it.output" class="out">{{ it.output }}</pre>
            <small v-else-if="it.output" class="muted tap" @click="openOut[it.id] = true">看输出（{{ it.output.split("\n").length }} 行）</small>
          </div>
          <div v-else-if="it.kind === 'files'" class="card files">
            <b>改了文件</b>
            <div v-for="(c, k) in it.changes || []" :key="k" class="file">
              <div class="file-head" @click="openDiff[it.id + k] = !openDiff[it.id + k]"><span class="kind">{{ KIND[c.kind?.type || c.kind] || "修改" }}</span><code>{{ c.path }}</code><span class="muted">{{ openDiff[it.id + k] ? "▴" : "▾" }}</span></div>
              <pre v-if="openDiff[it.id + k]" class="diff"><span v-for="(x, j) in diffLines(c.diff)" :key="j" :class="x.c">{{ x.l }}
</span></pre>
            </div>
          </div>
          <div v-else-if="it.kind === 'approval' && it.state === 'pending'" class="card ask">
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
        <div v-if="running" class="working"><i /><i /><i /> Codex 在干活</div>
      </main>
      <footer class="dock">
        <textarea v-model="draft" v-auto-grow rows="1" class="input" :placeholder="running ? '插一句（不用停下它）…' : '要做什么…'" />
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
.wr { min-height: 100dvh; background: var(--bg); display: flex; flex-direction: column; }
.bar { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 8px; padding: calc(var(--safe-top) + 10px) 12px 10px; background: rgba(var(--glass-rgb), .86); -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px); }
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
.lim .bar { height: 6px; border-radius: 3px; background: var(--line); overflow: hidden; }
.lim .bar i { display: block; height: 100%; background: var(--accent); }
.lim .bar i.hi { background: var(--danger); }
.lim em { font-style: normal; color: var(--text-3); }
.sec { margin: 20px 18px 8px; font-size: .86rem; font-weight: 600; color: var(--text-2); }
.sec small { font-weight: 400; color: var(--text-3); font-size: .72rem; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 16px; }
.chips button { border: 0; background: var(--card); padding: 6px 13px; border-radius: 999px; font-size: .84rem; color: var(--text-2); box-shadow: var(--shadow-soft); }
.chips button.on { background: var(--ink); color: var(--on-ink); }
.chips .add { background: none; box-shadow: inset 0 0 0 1.5px var(--line); }
.row { display: flex; align-items: baseline; gap: 8px; width: calc(100% - 32px); margin: 0 16px 8px; border: 0; text-align: left; background: var(--card); border-radius: 14px; padding: 12px 14px; box-shadow: var(--shadow-soft); color: var(--text); }
.row b { flex: 1; font-size: .92rem; }
.row small { color: var(--text-3); font-size: .72rem; }
.row.add { background: none; box-shadow: inset 0 0 0 1.5px var(--line); color: var(--text-2); justify-content: center; }
.wait { font-style: normal; font-size: .7rem; color: #fff; background: var(--danger); border-radius: 999px; padding: 1px 8px; }
.tl { flex: 1; max-width: 820px; width: 100%; margin: 0 auto; padding: 12px 14px calc(var(--safe-bottom) + 96px); display: flex; flex-direction: column; gap: 10px; }
.me { align-self: flex-end; max-width: 85%; text-align: right; }
.me p { margin: 0; background: var(--ink); color: var(--on-ink); padding: 9px 13px; border-radius: 16px 16px 4px 16px; white-space: pre-wrap; line-height: 1.6; font-size: .92rem; text-align: left; }
.me small { font-size: .68rem; color: var(--text-3); }
.agent { font-size: .93rem; line-height: 1.75; color: var(--text); }
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
.working { display: flex; align-items: center; gap: 4px; font-size: .78rem; color: var(--text-3); }
.working i { width: 6px; height: 6px; border-radius: 50%; background: var(--text-3); animation: hop 1.2s infinite; }
.working i:nth-child(2) { animation-delay: .15s; }
.working i:nth-child(3) { animation-delay: .3s; margin-right: 4px; }
@keyframes hop { 0%, 60%, 100% { transform: translateY(0); opacity: .5; } 30% { transform: translateY(-3px); opacity: 1; } }
.dock { position: fixed; left: 0; right: 0; bottom: 0; z-index: 6; display: flex; align-items: flex-end; gap: 8px; max-width: 820px; margin: 0 auto; padding: 10px 14px calc(var(--safe-bottom) + 12px); }
.dock .input { flex: 1; resize: none; min-height: 44px; height: 44px; max-height: 40vh; line-height: 1.5; border-radius: 22px; padding: 11px 16px; background: rgba(var(--glass-rgb), .94); -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px); box-shadow: var(--shadow-soft); }
.send { width: 44px; height: 44px; border-radius: 50%; border: 0; display: grid; place-items: center; background: var(--card); color: var(--text-3); box-shadow: var(--shadow-soft); flex: none; }
.send.on { background: var(--ink); color: var(--on-ink); }
.send.stop { color: var(--danger); }
.rule { display: flex; align-items: center; gap: 12px; padding: 10px 2px; border-bottom: 1px solid var(--line); }
.rule span { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.rule b { font-size: .9rem; font-weight: 500; }
.rule small { font-size: .74rem; color: var(--text-3); }
</style>
