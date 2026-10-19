<script setup>
// 主页（她自己画的设计）：大字「Dwelling place」+ 他写的一段话；底下一块圆角的功能区，小章鱼坐在边上。
// 功能区往上滑就是聊天；往下拉，后面藏着的两间像素小屋（章鱼的、螃蟹的）露出来。背景默认灰色，长按可以换图
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from "vue";
import { useRouter } from "vue-router";
import { store, MAIN } from "../store/index.js";
import { useImage, pickAndCrop, deleteImage } from "../lib/images.js";
import { octopusRoom, crabRoom } from "../lib/pixelRooms.js";
import { PET_FEET } from "../lib/petFrames.js";
import { toast } from "../lib/toast.js";
import { resumeSync } from "../lib/sync.js";
import Icon from "../components/Icon.vue";
import PixelArt from "../components/PixelArt.vue";
import PixelPet from "../components/pet/PixelPet.vue";
import Sheet from "../components/Sheet.vue";
import BioSheet from "../components/home/BioSheet.vue";
import AnnivWidget from "../components/widgets/AnnivWidget.vue";

const router = useRouter();

// 回到前台时顺手同步一下（以前的下拉刷新：现在往下拉是看小屋）
let foregroundAt = 0;
function foreground() {
  if (document.visibilityState !== "visible" || Date.now() - foregroundAt < 1000) return;
  foregroundAt = Date.now();
  resumeSync();
}

// ---------- 他写的话、背景 ----------
const bioOpen = ref(false);
const words = computed(() => store.profile.bios[MAIN]?.text?.replace(/\n\s*\n/g, "\n") || "");
const hisName = computed(() => store.roles.find(r => r.id === MAIN)?.name || "他");
const cover = useImage(() => store.profile.cover);
const bgOpen = ref(false);
async function changeCover() {
  bgOpen.value = false;
  const id = await pickAndCrop({ aspect: innerWidth / innerHeight, title: "调整背景", maxSize: 1800 });
  if (!id) return;
  deleteImage(store.profile.cover);
  store.profile.cover = id;
}
function plainCover() {
  bgOpen.value = false;
  deleteImage(store.profile.cover);
  store.profile.cover = null;
}
// 长按背景：换图
let press = null;
function heroDown(e) {
  if (e.target.closest("button")) return;
  const x = e.clientX, y = e.clientY;
  press = { x, y, t: setTimeout(() => { press = null; bgOpen.value = true; }, 600) };
}
function heroMove(e) { if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) heroUp(); }
function heroUp() { if (press) clearTimeout(press.t); press = null; }

// ---------- 功能区 ----------
const anniv = ref(null);
const ENTRIES = [
  { en: "CHAT", icon: "chat", go: () => router.push(`/chat/${MAIN}`) },
  { en: "READ", icon: "book", go: () => router.push("/books") },
  { en: "LETTER", icon: "mail", go: () => router.push("/letters") },
  { en: "WRITE", icon: "edit", go: () => router.push("/write") },
  { en: "RECORD", icon: "diary", go: () => router.push("/record") },
  { en: "MEMORY", icon: "memory", go: () => router.push("/memory") },
  { en: "DAYS", icon: "heart", go: () => anniv.value?.openManage() },
  { en: "SETTING", icon: "settings", go: () => router.push("/settings") },
];

// ---------- 小屋：平时整个藏在功能区后面，往下拉才露出来 ----------
const OCTO = octopusRoom(), CRAB = crabRoom();
const panel = ref(null), rooms = ref(null);
const restTop = ref(0); // 功能区平时的上沿
const maxDown = ref(0); // 往下拉多少，两间小屋刚好全露出来
function measure() {
  if (!panel.value || !rooms.value) return;
  restTop.value = panel.value.offsetTop;
  maxDown.value = rooms.value.offsetHeight + 26;
}
const down = ref(false);
const offset = ref(0); // 手指拖着的时候功能区挪了多少（往下为正）
const dragging = ref(false);
const shift = computed(() => (dragging.value ? offset.value : down.value ? maxDown.value : 0));
let start = null, moved = false;
// 手指一拖就可能出了功能区（往上滑时马上就出去了），所以拖动跟着整个窗口听
function panelDown(e) {
  start = { y: e.clientY, base: down.value ? maxDown.value : 0 };
  moved = false;
  window.addEventListener("pointermove", panelMove);
  window.addEventListener("pointerup", panelUp);
  window.addEventListener("pointercancel", panelUp);
}
function panelMove(e) {
  if (!start) return;
  const dy = e.clientY - start.y;
  if (!moved && Math.abs(dy) < 8) return;
  if (!moved) { moved = true; dragging.value = true; }
  // 往上拉有一点阻力；往下最多拉到小屋全露出来
  const v = start.base + dy;
  offset.value = v < 0 ? v * .5 : Math.min(maxDown.value + 20, v);
}
function panelUp() {
  window.removeEventListener("pointermove", panelMove);
  window.removeEventListener("pointerup", panelUp);
  window.removeEventListener("pointercancel", panelUp);
  if (!start) return;
  start = null;
  if (!moved) return;
  const v = offset.value;
  dragging.value = false;
  offset.value = 0;
  if (v < -40) { down.value = false; return router.push(`/chat/${MAIN}`); } // 上滑：聊天
  down.value = v > maxDown.value / 2;
}
// 拖过了就不算点了
function noClickAfterDrag(e) { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }

onMounted(async () => {
  foreground();
  document.addEventListener("visibilitychange", foreground);
  window.addEventListener("pageshow", foreground);
  window.addEventListener("resize", measure);
  await nextTick();
  measure();
});
onBeforeUnmount(() => {
  document.removeEventListener("visibilitychange", foreground);
  window.removeEventListener("pageshow", foreground);
  window.removeEventListener("resize", measure);
  heroUp();
  panelUp();
});
</script>

<template>
  <div class="home" :class="{ img: cover }" :style="cover ? { backgroundImage: `url(${cover})` } : null"
    @pointerdown="heroDown" @pointermove="heroMove" @pointerup="heroUp" @pointercancel="heroUp" @contextmenu.prevent>
    <div class="hero">
      <h1><span>Dwelling</span><span>place</span></h1>
      <button class="bio" @click="bioOpen = true">
        <p v-if="words">{{ words }}</p>
        <p v-else class="ph">点这里，让{{ hisName }}写一句话</p>
        <small v-if="words">— {{ hisName }}</small>
      </button>
    </div>

    <div ref="rooms" class="rooms" :style="{ top: restTop + 8 + 'px' }" :aria-hidden="!down">
      <button class="room" aria-label="章鱼的小屋" @click="router.push(`/room/${MAIN}`)"><PixelArt :grid="OCTO" :size="36" /></button>
      <button class="room" aria-label="螃蟹的小屋" @click="toast('螃蟹的小屋还在布置～')"><PixelArt :grid="CRAB" :size="36" /></button>
    </div>

    <section ref="panel" class="panel" :class="{ dragging }" :style="{ transform: `translateY(${shift}px)` }"
      @pointerdown.stop="panelDown" @click.capture="noClickAfterDrag">
      <div class="pet" :style="{ top: `${-PET_FEET * 3}px` }"><PixelPet :scale="3" /></div>
      <div class="handle" />
      <div class="hint">上滑 · 和{{ hisName }}聊天</div>
      <div class="grid">
        <button v-for="x in ENTRIES" :key="x.en" class="it" @click="x.go()">
          <Icon :name="x.icon" :size="20" />
          <i>{{ x.en }}</i>
        </button>
      </div>
    </section>

    <Sheet :open="bgOpen" title="主页背景" @close="bgOpen = false">
      <button class="btn wide" @click="changeCover">换一张图</button>
      <button v-if="store.profile.cover" class="btn soft wide" @click="plainCover">用回灰色</button>
    </Sheet>
    <BioSheet :open="bioOpen" @close="bioOpen = false" />
    <!-- 纪念日的管理弹窗借用原来的小组件（它本身不显示） -->
    <div hidden><AnnivWidget ref="anniv" size="small" /></div>
  </div>
</template>

<style scoped>
.home {
  --hero: #dedee2;
  position: fixed; inset: 0; overflow: hidden;
  background: var(--hero) center / cover no-repeat;
  -webkit-user-select: none; user-select: none; -webkit-touch-callout: none;
}
:root[data-theme="dark"] .home { --hero: #2a2e37; }
.home.img { box-shadow: inset 0 0 0 100vmax rgba(10, 12, 18, var(--img-dim)); }

.hero { position: absolute; left: 28px; right: 28px; top: calc(var(--safe-top) + 12svh); max-width: 560px; }
h1 { margin: 0; color: var(--text); letter-spacing: -1px; }
h1 span { display: block; font-size: 4.1rem; font-weight: 600; line-height: .92; }
h1 span + span { font-size: 3.1rem; font-weight: 500; margin-top: 2px; }
.bio { display: block; margin-top: 30px; padding: 0; border: 0; background: none; text-align: left; color: var(--text); max-width: 320px; }
.bio p { margin: 0; font-size: 1.05rem; font-weight: 500; line-height: 1.6; white-space: pre-line; display: -webkit-box; -webkit-line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden; }
.bio p.ph { color: var(--text-2); font-weight: 400; font-size: .9rem; }
.bio small { display: block; margin-top: 4px; font-size: .78rem; color: var(--text-2); }
.home.img .hero { text-shadow: 0 1px 12px rgba(var(--glass-rgb), .6); }

.rooms { position: absolute; left: 22px; right: 22px; display: grid; grid-template-columns: 1fr 1fr; gap: 14px; max-width: 520px; margin: 0 auto; }
.room { padding: 0; border: 1.5px solid #3a3d5c; border-radius: 4px; overflow: hidden; line-height: 0; background: none; }
.room :deep(svg) { width: 100%; height: auto; }
:root[data-theme="dark"] .room { border-color: #c9cbd6; }
:root[data-theme="dark"] .room :deep(svg) { filter: brightness(.82); }

.panel {
  position: absolute; left: 0; right: 0; bottom: 0; max-width: 680px; margin: 0 auto;
  background: var(--card); border-radius: 30px 30px 0 0; box-shadow: 0 -6px 24px rgba(40, 40, 60, .06);
  padding: 12px 20px calc(var(--safe-bottom) + 14px);
  touch-action: none; transition: transform .3s cubic-bezier(.2, .8, .3, 1);
}
.panel.dragging { transition: none; }
.pet { position: absolute; left: 30px; pointer-events: none; }
.handle { width: 36px; height: 4px; border-radius: 9px; background: var(--line); margin: 0 auto 10px; }
.hint { text-align: center; font-size: .72rem; color: var(--text-3); margin-bottom: 16px; letter-spacing: .5px; }
.grid { display: grid; grid-template-columns: repeat(4, 1fr); border-top: 1px solid var(--line); border-left: 1px solid var(--line); }
.it {
  height: min(112px, 13svh); padding: 14px 12px 12px; border: 0; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line);
  background: none; color: var(--text-2); display: flex; flex-direction: column; align-items: flex-start; justify-content: space-between;
}
.it i { font-style: normal; font-size: .62rem; letter-spacing: 1.5px; color: var(--text-3); }
.it:active { background: var(--card-2); }
.wide { width: 100%; margin-top: 8px; }
</style>
