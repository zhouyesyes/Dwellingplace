<script setup>
import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import { store, MAIN } from "../store/index.js";
import { SEARCH_PROVIDERS, relayPing, relaySearch } from "../lib/search.js";
import { newServer, refreshTools, callToolRaw } from "../lib/mcp.js";
import { serverBase } from "../lib/server.js";
import SubHeader from "../components/SubHeader.vue";
import Icon from "../components/Icon.vue";

const router = useRouter();

// ---------- 他的浏览器（自己服务器上的 chrome-mcp-bridge，经 …/p/口令/chrome/ 转发） ----------
const browser = computed(() => store.mcpServers.find(s => s.browser));
const bState = ref(null); // { ok, text }
const bBusy = ref("");
const qr = ref(""); // 小红书登录页截图
const qrBig = ref(""); // 从截图里找出来、放大的二维码
// 在截图里找二维码，裁出来放大（不糊：放大时不做平滑）
async function cropQr(dataUrl) {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const { default: jsQR } = await import("jsqr");
  const found = jsQR(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
  if (!found) return "";
  const pts = Object.values(found.location).filter(p => p && typeof p.x === "number");
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const pad = (Math.max(...xs) - Math.min(...xs)) * 0.12;
  const x = Math.max(0, Math.min(...xs) - pad), y = Math.max(0, Math.min(...ys) - pad);
  const w = Math.min(c.width - x, Math.max(...xs) - Math.min(...xs) + pad * 2), h = Math.min(c.height - y, Math.max(...ys) - Math.min(...ys) + pad * 2);
  const k = Math.max(2, Math.floor(600 / Math.max(w, h)));
  const out = document.createElement("canvas");
  out.width = Math.round(w * k); out.height = Math.round(h * k);
  const o = out.getContext("2d");
  o.imageSmoothingEnabled = false;
  o.fillStyle = "#fff"; o.fillRect(0, 0, out.width, out.height);
  o.drawImage(c, x, y, w, h, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}
async function connectBrowser() {
  bBusy.value = "connect";
  bState.value = null;
  try {
    const base = await serverBase();
    if (!base) throw new Error("找不到你服务器的地址：先在「设置 → 同步」里连上服务器");
    let s = browser.value;
    if (!s) {
      s = newServer({ name: "浏览器", url: `${base}/chrome/`, viaRelay: false, roleIds: [MAIN], headers: [], browser: true });
      store.mcpServers.push(s);
      s = store.mcpServers[store.mcpServers.length - 1];
    }
    const r = await refreshTools(s);
    bState.value = { ok: true, text: `接上了：${r.tools.map(t => t.name).join("、")}` };
  } catch (e) {
    bState.value = { ok: false, text: /404|不认识/.test(e.message) ? "服务器上还没装浏览器：再运行一次安装那一行，问到浏览器时选 y" : e.message };
  } finally {
    bBusy.value = "";
  }
}
// 清空他的浏览器：退出所有网站的登录（换账号用），浏览器会重开
async function resetBrowser() {
  if (!confirm("清空他的浏览器？所有网站（包括小红书）都会退出登录，之后可以用别的账号重新扫码登录。")) return;
  bBusy.value = "reset";
  bState.value = null;
  qr.value = qrBig.value = "";
  try {
    const r = await fetch(browser.value.url.replace(/\/$/, "") + "/__reset", { method: "POST" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error?.message || `服务器返回 ${r.status}`);
    await new Promise(res => setTimeout(res, 6000)); // 等浏览器清空、重开
    bState.value = { ok: true, text: "清空了，所有登录都退出了。要登新账号就点「登录小红书」。" };
  } catch (e) {
    bState.value = { ok: false, text: /404|没装浏览器/.test(e.message) ? "服务器还是旧版本：再运行一次安装那一行，再来清空" : e.message };
  } finally {
    bBusy.value = "";
  }
}
// ---------- 遥控他的浏览器：给你登录网站用（看画面、点一下、打字、回车） ----------
const rPage = ref(""); // 现在操作的页面
const rTitle = ref("");
const typed = ref("");
const ctlUrl = () => browser.value.url.replace(/\/chrome\/?$/, "/chromectl/");
async function ctl(body) {
  const r = await fetch(ctlUrl(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 404 && /不认识/.test(j.error?.message || "")) throw new Error("服务器还是旧版本：再运行一次安装那一行");
  if (!r.ok) throw new Error(j.error?.message || `服务器返回 ${r.status}`);
  return j;
}
const wait = ms => new Promise(r => setTimeout(r, ms));
async function remote(what, fn) {
  bBusy.value = what;
  bState.value = null;
  try { await fn(); } catch (e) { bState.value = { ok: false, text: e.message }; } finally { bBusy.value = ""; }
}
async function look() {
  const j = await ctl({ action: "screenshot", ...(rPage.value ? { page_id: rPage.value } : {}) });
  rPage.value = j.page_id;
  rTitle.value = j.title || j.url || "";
  qr.value = `data:image/jpeg;base64,${j.image}`;
  qrBig.value = await cropQr(qr.value).catch(() => "");
}
const openSite = url => remote("open", async () => {
  qr.value = qrBig.value = "";
  rPage.value = (await ctl({ action: "open", url })).page_id;
  await wait(3500);
  await look();
});
const refreshShot = () => remote("look", look);
// 点截图上的位置 = 点网页上的这个位置
function tapShot(e) {
  const img = e.currentTarget;
  const r = img.getBoundingClientRect();
  const x = (e.clientX - r.left) * (img.naturalWidth / r.width), y = (e.clientY - r.top) * (img.naturalHeight / r.height);
  remote("tap", async () => { await ctl({ action: "click", page_id: rPage.value, x, y }); await wait(1500); await look(); });
}
const typeIn = () => remote("type", async () => {
  if (!typed.value) return;
  await ctl({ action: "type", page_id: rPage.value, text: typed.value });
  typed.value = "";
  await wait(600);
  await look();
});
const pressKey = key => remote("key", async () => { await ctl({ action: "key", page_id: rPage.value, key }); await wait(1500); await look(); });
const GUIDE = "https://github.com/zhouyesyes/Dwellingplace/blob/main/docs/cloudflare-relay.md";

// 搜索服务的设置平时收起来（不常改）
const searchOpen = ref(false);
// 他的 MCP（旧居里那两位的不列在这里）
const mine = computed(() => store.mcpServers.filter(s => (s.roleIds || []).includes(MAIN)));
const toolsText = s => (s.tools?.length ? `工具 ${s.tools.length - (s.disabledTools?.length || 0)}/${s.tools.length}` : "还没读取工具");

const pingState = ref(null); // { ok, text }
const searchState = ref(null); // { ok, text, results }
const testQuery = ref("今天的新闻");
const busy = ref("");

const LATEST_RELAY = 26; // relay/worker.js 里的 version
async function testRelay() {
  busy.value = "ping";
  pingState.value = null;
  try {
    const r = await relayPing();
    const ready = r.ready?.length ? `Worker 里已经配好 Key 的：${r.ready.map(k => SEARCH_PROVIDERS[k]?.label || k).join("、")}` : "Worker 里还没有配搜索服务的 Key（可以在下面填）";
    const v = r.version || 1;
    const old = v < 3 ? "。注意：中转是旧版本，MCP / 网页读取可能用不了，请按说明更新 Worker 代码"
      : v < LATEST_RELAY ? "。中转不是最新版：花园唤醒桥、一次性闹钟、他自己来找你（心潮的桥）、醒来时查工具说明要新版才能用" : "";
    // 中转这次从哪儿发出请求：在 HK、CN 这些地区的话，OpenAI 这类模型会拒绝
    const w = r.where?.loc ? `。中转这次从 ${r.where.loc}（机房 ${r.where.colo}）发出请求${/^(HK|CN|MO)$/.test(r.where.loc) ? "：这个地区 OpenAI 等模型不提供服务，走中转也会被拦" : ""}` : "";
    pingState.value = { ok: v >= 3, text: `连上了！中转版本 v${v}${v >= LATEST_RELAY ? "（最新）" : ""}。${ready}${w}${old}` };
  } catch (e) {
    pingState.value = { ok: false, text: e.message };
  } finally {
    busy.value = "";
  }
}

async function testSearch() {
  busy.value = "search";
  searchState.value = null;
  try {
    const r = await relaySearch(testQuery.value.trim() || "今天的新闻");
    searchState.value = { ok: true, text: `搜到 ${r.results.length} 条结果`, results: r.results.slice(0, 3) };
  } catch (e) {
    searchState.value = { ok: false, text: e.message };
  } finally {
    busy.value = "";
  }
}
</script>

<template>
  <div class="page">
    <SubHeader title="工具" />

    <!-- 中转 -->
    <div class="section-label">中转（Cloudflare Worker）</div>
    <div class="card body">
      <p class="desc">
        浏览器不能直接访问搜索服务，需要一个中转替它去请求。中转是你自己免费部署的，
        <a :href="GUIDE" target="_blank">看部署步骤</a>。
      </p>
      <label class="field"><span>中转地址</span><input v-model.trim="store.tools.relay.url" class="input" inputmode="url" autocapitalize="off" autocorrect="off" placeholder="https://qisuo-relay.xxx.workers.dev" /></label>
      <label class="field"><span>中转密码</span><input v-model.trim="store.tools.relay.token" class="input" type="password" autocomplete="off" placeholder="和 Worker 里的 RELAY_TOKEN 一样" /></label>
      <button class="btn soft wide" :disabled="!!busy || !store.tools.relay.url" @click="testRelay">{{ busy === "ping" ? "测试中…" : "测试连接" }}</button>
      <p v-if="pingState" class="result" :class="{ bad: !pingState.ok }">{{ pingState.text }}</p>
    </div>

    <!-- 搜索 -->
    <div class="section-label">联网搜索（通过中转，所有模型都能用）</div>
    <div class="list-card">
      <label class="list-row">
        <Icon name="globe" :size="20" />
        <span class="grow">开启联网搜索<span class="sub">他需要时会自己搜</span></span>
        <input v-model="store.tools.search.enabled" type="checkbox" class="sw" />
      </label>
    </div>
    <button class="fold" @click="searchOpen = !searchOpen">{{ searchOpen ? "收起搜索服务设置 ▴" : `搜索服务：${SEARCH_PROVIDERS[store.tools.search.provider]?.label || "还没选"} · 展开设置 ▾` }}</button>
    <div v-if="searchOpen" class="card body" style="margin-top: 8px">
      <div class="field">
        <span>搜索服务</span>
        <div class="providers">
          <button v-for="(p, k) in SEARCH_PROVIDERS" :key="k" :class="{ on: store.tools.search.provider === k }" @click="store.tools.search.provider = k">
            <b>{{ p.label }}</b><small>{{ p.note }}</small>
          </button>
        </div>
      </div>
      <label class="field">
        <span>搜索服务的 Key</span>
        <input v-model.trim="store.tools.search.key" class="input" type="password" autocomplete="off" placeholder="已在 Worker 里配好就留空" />
      </label>
      <div class="test-row">
        <input v-model="testQuery" class="input" placeholder="测试搜点什么" />
        <button class="btn soft" :disabled="!!busy || !store.tools.relay.url" @click="testSearch">{{ busy === "search" ? "搜索中…" : "测试搜索" }}</button>
      </div>
      <div v-if="searchState" class="result" :class="{ bad: !searchState.ok }">
        {{ searchState.text }}
        <ul v-if="searchState.results?.length">
          <li v-for="r in searchState.results" :key="r.url"><a :href="r.url" target="_blank">{{ r.title }}</a></li>
        </ul>
      </div>
    </div>

    <!-- 流式 -->
    <div class="section-label">回复方式</div>
    <div class="list-card">
      <label class="list-row">
        <Icon name="send" :size="20" />
        <span class="grow">流式回复<span class="sub">开着：一边生成一边显示；关掉：等整条写完一次显示</span></span>
        <input v-model="store.tools.stream" type="checkbox" class="sw" />
      </label>
    </div>
    <p class="note">所有 API 通用。关掉以后，开头那段等待没有动静，但中途断掉时整条会自动重试，不会只剩半句；回复很长时要等得久一点。</p>

    <!-- 网页读取 -->
    <div class="section-label">网页读取（fetch）</div>
    <div class="list-card">
      <label class="list-row">
        <Icon name="file" :size="20" />
        <span class="grow">开启网页读取<span class="sub">发链接给他，他能打开读全文</span></span>
        <input v-model="store.tools.fetch.enabled" type="checkbox" class="sw" />
      </label>
    </div>
    <p class="note">和搜索不一样：搜索是找网页，网页读取是打开一个具体的链接读正文。通过上面的中转（需要第 3 版）。</p>

    <!-- 官方自带 -->
    <div class="section-label">官方 Claude 自带搜索</div>
    <div class="list-card">
      <label class="list-row">
        <Icon name="search" :size="20" />
        <span class="grow">官方自带搜索<span class="sub">不需要中转；只对官方 API 有效</span></span>
        <input v-model="store.tools.webSearch" type="checkbox" class="sw" />
      </label>
    </div>
    <p class="note">开了上面的「通过中转搜索」时，会优先用中转，这个开关就不起作用。</p>

    <div class="section-label">浏览器（他自己上网看）</div>
    <div class="card body">
      <p class="desc">装在你自己的服务器上的浏览器（chrome-mcp-bridge）。他能打开网页、读文字、<b>看网页里的图片和截图</b>；小红书笔记会带回正文、评论和图片。比上面的网页读取慢一些，但看得全。</p>
      <button class="btn soft wide" :disabled="!!bBusy" @click="connectBrowser">{{ bBusy === "connect" ? "连接中…" : browser ? "重新连接" : "接上浏览器" }}</button>
      <template v-if="browser">
        <label class="switch-row"><span>他可以用浏览器</span><input v-model="browser.enabled" type="checkbox" class="sw" /></label>
        <button class="btn soft wide" :disabled="!!bBusy" @click="openSite('https://www.xiaohongshu.com/explore')">{{ bBusy === "open" ? "打开中…（要等几秒）" : "登录小红书" }}</button>
        <button class="btn soft wide gap" :disabled="!!bBusy" @click="resetBrowser">{{ bBusy === "reset" ? "清空中…" : "清空浏览器（退出所有登录、换账号）" }}</button>
      </template>
      <p v-if="bState" class="result" :class="{ bad: !bState.ok }">{{ bState.text }}</p>
      <template v-if="qr">
        <p v-if="qrBig" class="tip-sm">有二维码：长按下面的二维码「存储到照片」→ 小红书「扫一扫」选相册这张 → 手机上确认。确认完点「刷新画面」看看，要填验证码就在下面填。</p>
        <img v-if="qrBig" :src="qrBig" alt="登录二维码" class="qr-big" />
        <div class="remote">
          <div class="r-top"><span class="r-title">{{ rTitle }}</span><button class="btn soft small" :disabled="!!bBusy" @click="refreshShot">{{ bBusy && bBusy !== "reset" ? "…" : "刷新画面" }}</button></div>
          <img :src="qr" alt="" class="qr" @click="tapShot" />
          <p class="tip-sm">这是他浏览器现在的样子。点截图上的地方 = 点网页上的那里（比如先点验证码的框）。</p>
          <div class="r-type">
            <input v-model="typed" class="input" placeholder="要填进去的字（比如短信验证码）" autocomplete="one-time-code" inputmode="text" @keydown.enter.prevent="typeIn" />
            <button class="btn small" :disabled="!!bBusy || !typed" @click="typeIn">填进去</button>
          </div>
          <div class="r-keys">
            <button class="btn soft small" :disabled="!!bBusy" @click="pressKey('Enter')">回车</button>
            <button class="btn soft small" :disabled="!!bBusy" @click="pressKey('Backspace')">删一个字</button>
          </div>
        </div>
      </template>
    </div>
    <p class="note">要先在服务器上装好：运行安装那一行，问到「要给他装一个浏览器吗」选 y。浏览器只在你服务器内部，经过带口令的地址才能用。</p>

    <div class="section-label">MCP</div>
    <div class="list-card">
      <div v-for="s in mine.filter(x => !x.browser)" :key="s.id" class="list-row">
        <Icon name="tool" :size="20" />
        <button class="grow plain" @click="router.push(`/settings/mcp/${s.id}`)">
          {{ s.name }}<span v-if="!s.enabled" class="off">（关着）</span>
          <span class="sub">{{ toolsText(s) }} · 点进去设置</span>
        </button>
        <input v-model="s.enabled" type="checkbox" class="sw" />
      </div>
      <button class="list-row add" @click="router.push('/settings/mcp/new')"><Icon name="plus" :size="20" /><span class="grow">添加 MCP</span></button>
    </div>
    <p class="note">开关打开，他就能用这个 MCP。MCP 通过上面的中转连接。</p>
  </div>
</template>

<style scoped>
.body { padding: 16px 18px; }
.desc { margin: 0 0 12px; font-size: 0.87rem; color: var(--text-2); line-height: 1.7; }
.desc a, .result a { color: var(--accent); }
.wide { width: 100%; }
.sw { width: 20px; height: 20px; accent-color: var(--ink); }
.result { margin: 10px 2px 0; font-size: 0.87rem; color: #3f8f63; line-height: 1.6; word-break: break-all; }
.result.bad { color: var(--danger); }
.result ul { margin: 6px 0 0; padding-left: 18px; }
.providers { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.providers button { border: 1px solid var(--line); background: var(--card); border-radius: 14px; padding: 8px 10px; text-align: left; display: flex; flex-direction: column; gap: 1px; }
.providers button b { font-size: 0.9rem; }
.providers button small { font-size: 0.73rem; color: var(--text-3); line-height: 1.4; }
.providers button.on { border-color: var(--ink); background: var(--card-2); }
.test-row { display: flex; gap: 8px; }
.test-row .btn { flex: none; }
.add { color: var(--text-2); }
.gap { margin-top: 8px; }
.tip-sm { font-size: 0.8rem; color: var(--text-2); line-height: 1.6; margin: 10px 2px 0; }
.remote { margin-top: 12px; }
.r-top { display: flex; align-items: center; gap: 8px; }
.r-title { flex: 1; min-width: 0; font-size: 0.8rem; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.r-type { display: flex; gap: 8px; margin-top: 10px; }
.r-type .btn { flex: none; }
.r-keys { display: flex; gap: 8px; margin-top: 8px; }
.qr-big { display: block; width: min(100%, 300px); margin: 12px auto 0; image-rendering: pixelated; border-radius: 8px; }
.shot { margin-top: 10px; font-size: 0.82rem; color: var(--text-2); }
.qr { display: block; width: 100%; margin-top: 10px; border-radius: 12px; border: 1px solid var(--line); }
.switch-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 2px; font-size: 0.93rem; }
.plain { border: 0; background: none; padding: 0; text-align: left; color: inherit; font: inherit; }
.fold { display: block; width: 100%; margin-top: 8px; border: 0; background: none; color: var(--text-2); font-size: 0.85rem; padding: 8px; text-align: center; }
.off { color: var(--text-3); font-size: 0.8rem; }
.note { font-size: 0.8rem; color: var(--text-3); line-height: 1.7; margin: 10px 8px 0; }
</style>
