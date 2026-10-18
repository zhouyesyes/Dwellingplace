<script setup>
// 主页：一间房间铺满整屏，左右滑着逛；底下一张索引，收着时只看纪念日和他的签名，点一下或往上拉整个升起来
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from "vue";
import { useRouter } from "vue-router";
import { store, MAIN } from "../store/index.js";
import { anniversaryInfo, parseYmd, MONTHS_EN } from "../lib/dates.js";
import BioSheet from "../components/home/BioSheet.vue";
import AnnivWidget from "../components/widgets/AnnivWidget.vue";

import { syncState, startSync, resumeSync } from "../lib/sync.js";
import { useHomePullRefresh } from "../lib/homePullRefresh.js";

// ---------- 下拉刷新（在索引上往下拉）、回到前台自动同步 ----------
const refreshing = ref(false);
const refreshError = ref("");
const home = ref(null);
const feedback = ref("");
let feedbackTimer;
let disposed = false;
const busy = computed(() => refreshing.value || syncState.busy);
const { distance, armed } = useHomePullRefresh(home, busy, refreshHome);
const pullLabel = computed(() => distance.value ? (armed.value ? "松开刷新" : "下拉刷新") : refreshing.value ? "正在刷新…" : feedback.value);
async function refreshHome() {
  if (busy.value) return;
  clearTimeout(feedbackTimer);
  feedback.value = "";
  refreshing.value = true;
  refreshError.value = "";
  try {
    await startSync();
    if (syncState.error) throw new Error(syncState.error);
    feedback.value = syncState.deferred || syncState.pending ? "仍有内容待同步" : !syncState.on ? "尚未连接同步" : "已是最新";
  } catch (e) {
    refreshError.value = e.message || String(e);
    feedback.value = "刷新失败，请重试";
  } finally {
    refreshing.value = false;
    if (!disposed) feedbackTimer = setTimeout(() => { feedback.value = ""; }, refreshError.value ? 3500 : 1800);
  }
}
let foregroundAt = 0;
function foreground() {
  if (document.visibilityState !== "visible" || Date.now() - foregroundAt < 1000) return;
  foregroundAt = Date.now();
  resumeSync();
}

// ---------- 房间：一打开停在沙发那里 ----------
const pan = ref(null);
const ROOM = `${import.meta.env.BASE_URL}home/room.webp`; // 栖所挂在带口令的路径下，不能写成 /home/…
const SOFA = 0.42; // 沙发在图里横向的位置（0 最左，1 最右）
function toSofa() {
  const el = pan.value, img = el?.querySelector("img");
  if (!img?.naturalWidth) return;
  // 图左边裁掉了一点（offsetLeft 是负的），见 .stage
  el.scrollLeft = Math.max(0, img.offsetWidth * SOFA + img.offsetLeft - el.clientWidth / 2);
}

onMounted(async () => {
  foreground();
  document.addEventListener("visibilitychange", foreground);
  window.addEventListener("pageshow", foreground);
  window.addEventListener("focus", foreground);
  window.addEventListener("online", foreground);
  await nextTick();
  toSofa();
});
onBeforeUnmount(() => {
  disposed = true;
  clearTimeout(feedbackTimer);
  document.removeEventListener("visibilitychange", foreground);
  for (const event of ["pageshow", "focus", "online"]) window.removeEventListener(event, foreground);
});

// ---------- 索引里的东西 ----------
const router = useRouter();
const bioOpen = ref(false);
const anniv = ref(null);
// 纪念日：先看和他的那个，没有就第一个
const day = computed(() => store.anniversaries.find(a => a.roleId === MAIN) || store.anniversaries[0] || null);
const info = computed(() => day.value && anniversaryInfo(day.value.date));
const since = computed(() => {
  if (!day.value) return "";
  const d = parseYmd(day.value.date), n = d.getDate();
  const th = n % 10 === 1 && n !== 11 ? "ST" : n % 10 === 2 && n !== 12 ? "ND" : n % 10 === 3 && n !== 13 ? "RD" : "TH";
  return `SINCE ${d.getFullYear()} · ${MONTHS_EN[d.getMonth()].toUpperCase()} ${n}${th}`;
});
// 小圆环：离下一个整百天 / 周年走了多少
const ring = computed(() => {
  const i = info.value;
  if (!i || i.future) return 0;
  const span = /周年/.test(i.nextLabel) ? 365 : 100;
  return Math.max(0, Math.min(1, 1 - i.until / span));
});
const words = computed(() => store.profile.bios[MAIN]?.text?.replace(/\n\s*\n/g, "\n") || "");
const hisName = computed(() => store.roles.find(r => r.id === MAIN)?.name || "他");

const INDEX = [
  { en: "CHAT", zh: "聊天", go: () => router.push(`/chat/${MAIN}`) },
  { en: "READ", zh: "共读", go: () => router.push("/books") },
  { en: "LETTER", zh: "信件", go: () => router.push("/letters") },
  { en: "WRITE", zh: "一起写", go: () => router.push("/write") },
  { en: "DAYS", zh: "纪念日", go: () => anniv.value?.openManage() },
  { en: "SETTING", zh: "设置", go: () => router.push("/settings") },
];

// ---------- 索引：点一下 / 往上拉升起来，往下拉收回去 ----------
const open = ref(false);
const sheet = ref(null);
const fullH = ref(0); // 升起来的高度：正好放下里面的东西（最多屏幕的 85%）
watch(open, async o => {
  if (!o) return;
  await nextTick();
  const el = sheet.value, cs = getComputedStyle(el);
  fullH.value = Math.min(innerHeight * .85, el.querySelector(".more").scrollHeight + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + 18);
});
const drag = ref(0); // 手指拖了多少（往上为正）
let start = null;
function down(e) {
  if (e.target.closest("button, a")) return;
  start = { y: e.clientY, moved: false };
  e.currentTarget.setPointerCapture?.(e.pointerId); // 手指拖出索引外也跟着
}
function move(e) {
  if (!start) return;
  const dy = start.y - e.clientY;
  if (!start.moved && Math.abs(dy) < 8) return;
  start.moved = true;
  drag.value = open.value ? Math.min(0, dy) : Math.max(0, dy);
}
function up() {
  if (!start) return;
  const { moved } = start;
  start = null;
  const d = drag.value;
  drag.value = 0;
  if (!moved) { if (!open.value) open.value = true; return; }
  if (!open.value && d > 50) open.value = true;
  else if (open.value && d < -60) open.value = false;
}
</script>

<template>
  <div ref="home" class="home">
    <div ref="pan" class="pan">
      <div class="stage"><img :src="ROOM" alt="我们的房间" draggable="false" @load="toSofa" /></div>
    </div>

    <div class="pull-status" :class="{ on: pullLabel }" role="status" aria-live="polite">{{ pullLabel }}</div>

    <Transition name="fade"><div v-if="open" class="dim" @click="open = false" /></Transition>

    <section ref="sheet" class="sheet" :class="{ open, dragging: drag }" :style="{ '--drag': drag + 'px', '--full': fullH ? fullH + 'px' : '84svh' }"
      @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up">
      <div class="handle" />
      <!-- 收着：纪念日 + 他的签名 -->
      <div v-if="!open" class="cols">
        <div>
          <div class="k">TOGETHER</div>
          <template v-if="info">
            <div class="dd">{{ info.future ? info.until : info.day }}<small>天</small></div>
            <div class="sm">{{ info.future ? "天后就是那一天" : `离${info.nextLabel}还有 ${info.until} 天` }}</div>
          </template>
          <button v-else class="add" @click="anniv?.openManage()">＋ 加一个纪念日</button>
        </div>
        <div>
          <div class="k">HIS WORDS</div>
          <p v-if="words" class="sig">{{ words }}</p>
          <button v-else class="add" @click="bioOpen = true">让{{ hisName }}写一句</button>
          <small v-if="words" class="by">— {{ hisName }}</small>
        </div>
      </div>
      <!-- 升起来 -->
      <div v-else class="more">
        <template v-if="info && !info.future">
          <div class="since">{{ since }}</div>
          <div class="ring">
            <svg width="30" height="30" viewBox="0 0 36 36" aria-hidden="true">
              <circle cx="18" cy="18" r="15" fill="none" stroke="var(--line)" stroke-width="3" />
              <circle cx="18" cy="18" r="15" fill="none" stroke="var(--ring)" stroke-width="3" stroke-linecap="round" :stroke-dasharray="`${ring * 94.2} 94.2`" transform="rotate(-90 18 18)" />
            </svg>
            在一起的第 {{ info.day }} 天
          </div>
        </template>
        <div class="lbl">About</div>
        <p class="about" @click="bioOpen = true">{{ words || `点这里让${hisName}写一段` }}</p>
        <div class="lbl">Index</div>
        <div class="grid">
          <button v-for="x in INDEX" :key="x.en" class="it" @click="x.go()"><i>{{ x.en }}</i>{{ x.zh }}</button>
        </div>
      </div>
    </section>

    <BioSheet :open="bioOpen" @close="bioOpen = false" />
    <!-- 纪念日的管理弹窗借用原来的小组件（它本身不显示） -->
    <div hidden><AnnivWidget ref="anniv" size="small" /></div>
  </div>
</template>

<style scoped>
.home { position: fixed; inset: 0; overflow: hidden; background: var(--bg); --ring: #e7a3b0; }

/* 房间：比屏幕高一截，左右能滑；图左右各裁掉一点白边 */
.pan { position: absolute; inset: 0; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; overscroll-behavior-x: contain; }
.pan::-webkit-scrollbar { display: none; }
/* 图高 --h：一般是屏幕的 1.3 倍；屏幕很宽时再大一点，免得右边露白 */
.stage { --h: max(130svh, 77.6vw); position: relative; height: 100%; width: calc(var(--h) * 1.5 * .86); overflow: hidden; }
.stage img { position: absolute; top: calc((100svh - var(--h)) * .6); left: calc(var(--h) * 1.5 * -.07); height: var(--h); width: calc(var(--h) * 1.5); max-width: none; mix-blend-mode: multiply; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
/* 深色：先把白天的图调暗（以后换成夜景图） */
:root[data-theme="dark"] .stage img { mix-blend-mode: normal; filter: brightness(.55) saturate(.85) contrast(1.05); }

.pull-status { position: absolute; top: calc(var(--safe-top) + 10px); left: 50%; transform: translate(-50%, -8px); padding: 6px 14px; border-radius: 999px; background: rgba(var(--glass-rgb), .92); font-size: .8rem; color: var(--text-2); box-shadow: var(--shadow-soft); opacity: 0; transition: opacity .2s, transform .2s; pointer-events: none; z-index: 3; }
.pull-status.on { opacity: 1; transform: translate(-50%, 0); }

.dim { position: fixed; inset: 0; background: rgba(30, 30, 40, .25); z-index: 24; }
.sheet {
  --peek: calc(var(--tabbar-h) + var(--safe-bottom) + 150px);
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 15;
  max-width: 680px; margin: 0 auto;
  height: calc(var(--peek) + var(--drag, 0px));
  background: var(--card); border-radius: 26px 26px 0 0; box-shadow: 0 -8px 28px rgba(40, 40, 60, .08);
  padding: 10px 22px calc(var(--tabbar-h) + var(--safe-bottom) + 16px);
  overflow: hidden; touch-action: none;
  transition: height .28s cubic-bezier(.2, .8, .3, 1);
}
.sheet.open { z-index: 25; height: calc(var(--full) + var(--drag, 0px)); overflow-y: auto; touch-action: pan-y; }
.sheet.dragging { transition: none; }
.handle { width: 36px; height: 4px; border-radius: 9px; background: var(--line); margin: 0 auto 14px; }

.cols { display: grid; grid-template-columns: .9fr 1.1fr; }
.cols > div { min-width: 0; padding: 2px 2px 0; }
.cols > div + div { border-left: 1px solid var(--line); padding-left: 18px; }
.k { font-size: .66rem; letter-spacing: 3px; color: var(--text-3); font-weight: 600; }
.dd { font-size: 2.5rem; line-height: 1; margin-top: 10px; letter-spacing: -.5px; }
.dd small { font-size: .82rem; color: var(--text-2); margin-left: 4px; letter-spacing: 0; }
.sm { font-size: .72rem; color: var(--text-2); margin-top: 8px; }
.sig { margin: 10px 0 0; font-size: .85rem; line-height: 1.65; white-space: pre-line; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.by { display: block; color: var(--text-3); font-size: .72rem; margin-top: 4px; }
.add { margin-top: 12px; border: 0; background: var(--card-2); color: var(--text-2); border-radius: 999px; padding: 7px 12px; font-size: .78rem; box-shadow: 0 0 0 1px var(--line); }

.more { padding-top: 4px; }
.since { text-align: center; font-size: .66rem; letter-spacing: 4px; color: var(--text-2); margin-top: 6px; }
.ring { display: flex; align-items: center; gap: 8px; margin: 14px auto 0; width: max-content; padding: 5px 14px 5px 5px; border-radius: 999px; border: 1px solid var(--line); font-size: .85rem; }
.ring svg { display: block; }
.lbl { font-size: .72rem; color: var(--text-3); margin: 20px 2px 6px; letter-spacing: .5px; }
.about { margin: 0 2px; font-size: .9rem; line-height: 1.75; white-space: pre-line; cursor: pointer; }
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 4px; }
.it { border: 1px solid var(--line); background: none; border-radius: 16px; padding: 12px 10px; font-size: .85rem; color: var(--text); display: flex; flex-direction: column; align-items: flex-start; gap: 6px; text-align: left; }
.it i { font-style: normal; font-size: .62rem; letter-spacing: 2px; color: var(--text-3); }
.it:active { background: var(--card-2); }

.fade-enter-active, .fade-leave-active { transition: opacity .25s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* 平板横屏：底栏在左边，索引不用给它让位 */
@media (min-width: 1000px) {
  .sheet { --peek: calc(var(--safe-bottom) + 170px); padding-bottom: calc(var(--safe-bottom) + 16px); }
}
</style>
