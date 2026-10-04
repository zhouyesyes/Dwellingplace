<script setup>
// 小组件桌面：长按进入编辑；编辑时可以拖动排序、删除、换大小、添加
import { ref, computed, nextTick, onBeforeUnmount } from "vue";
import { store, uid } from "../../store/index.js";
import ChickWidget from "../widgets/ChickWidget.vue";
import AnnivWidget from "../widgets/AnnivWidget.vue";
import CalendarWidget from "../widgets/CalendarWidget.vue";
import Sheet from "../Sheet.vue";
import Icon from "../Icon.vue";

const TYPES = {
  chick: { label: "小鸡", desc: "我们一起养的小鸡，点一下会换个样子", comp: ChickWidget, sizes: ["small", "large"] },
  anniv: { label: "纪念日", desc: "在一起第几天，下一个纪念日还有多久", comp: AnnivWidget, sizes: ["small", "large"] },
  calendar: { label: "日历", desc: "和 TA 们一起记录的小事", comp: CalendarWidget, sizes: ["large"] },
};

const editing = ref(false);
const widgets = computed(() => store.widgets.filter(w => TYPES[w.type]));

// ---------- 长按进入编辑 ----------
let pressTimer = null;
let pressStart = null;
function cancelPress() {
  clearTimeout(pressTimer);
  pressTimer = null;
}

// ---------- 拖动排序 ----------
const els = {};
const dragId = ref(null);
let grab = null; // { dx, dy, el, x, y }

function place() {
  const { el, x, y, dx, dy } = grab;
  el.style.transform = "none";
  const r = el.getBoundingClientRect();
  el.style.transform = `translate(${x - dx - r.left}px, ${y - dy - r.top}px) scale(1.03)`;
}

function onDown(e, w) {
  if (!editing.value) {
    pressStart = { x: e.clientX, y: e.clientY };
    pressTimer = setTimeout(() => {
      pressTimer = null;
      editing.value = true;
      navigator.vibrate?.(12);
    }, 450);
    return;
  }
  if (e.target.closest(".badge")) return;
  const el = els[w.id];
  const r = el.getBoundingClientRect();
  el.setPointerCapture(e.pointerId);
  grab = { el, dx: e.clientX - r.left, dy: e.clientY - r.top, x: e.clientX, y: e.clientY };
  dragId.value = w.id;
}

async function onMove(e) {
  if (pressTimer && pressStart && Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) > 8) cancelPress();
  if (!grab) return;
  grab.x = e.clientX;
  grab.y = e.clientY;
  place();
  // 指到了哪个组件上，就把拖着的这个挪到那里
  for (const w of store.widgets) {
    if (w.id === dragId.value || !els[w.id]) continue;
    const r = els[w.id].getBoundingClientRect();
    if (e.clientX > r.left && e.clientX < r.right && e.clientY > r.top && e.clientY < r.bottom) {
      const from = store.widgets.findIndex(x => x.id === dragId.value);
      const to = store.widgets.indexOf(w);
      const [moved] = store.widgets.splice(from, 1);
      store.widgets.splice(to, 0, moved);
      await nextTick();
      if (grab) place();
      break;
    }
  }
}

function onUp() {
  cancelPress();
  if (grab) {
    grab.el.style.transform = "";
    grab = null;
    dragId.value = null;
  }
}
onBeforeUnmount(cancelPress);

function remove(w) {
  store.widgets.splice(store.widgets.indexOf(w), 1);
}
function toggleSize(w) {
  const s = TYPES[w.type].sizes;
  w.size = s[(s.indexOf(w.size) + 1) % s.length];
}

// ---------- 添加 ----------
const addOpen = ref(false);
const addable = computed(() => Object.entries(TYPES).filter(([k]) => !store.widgets.some(w => w.type === k)));
function add(type) {
  store.widgets.push({ id: uid(), type, size: TYPES[type].sizes[0] });
  addOpen.value = false;
}
</script>

<template>
  <section class="desk" :class="{ editing }">
    <div
      v-for="w in widgets"
      :key="w.id"
      :ref="el => (els[w.id] = el)"
      class="widget"
      :class="[w.size, w.type, { dragging: dragId === w.id }]"
      @pointerdown="onDown($event, w)"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
      @contextmenu.prevent
    >
      <div class="inner">
        <component :is="TYPES[w.type].comp" :size="w.size" :editing="editing" />
      </div>
      <template v-if="editing">
        <button class="badge del" aria-label="移除" @click.stop="remove(w)"><Icon name="close" :size="13" /></button>
        <button v-if="TYPES[w.type].sizes.length > 1" class="badge size" aria-label="换大小" @click.stop="toggleSize(w)">
          {{ w.size === "small" ? "大" : "小" }}
        </button>
      </template>
    </div>

    <button v-if="editing" class="widget small add-tile" @click="addOpen = true">
      <Icon name="plus" :size="26" /><span>添加组件</span>
    </button>
    <p v-if="!editing" class="hint">长按组件可以排序、删除或添加</p>
    <p v-if="!widgets.length && !editing" class="hint"><button class="btn soft small" @click="editing = true">编辑桌面</button></p>
  </section>

  <Transition name="fade">
    <div v-if="editing" class="edit-bar">
      <button class="btn soft" @click="addOpen = true"><Icon name="plus" :size="16" /> 添加</button>
      <button class="btn" @click="editing = false">完成</button>
    </div>
  </Transition>

  <Sheet :open="addOpen" title="添加组件" @close="addOpen = false">
    <div class="list-card flat">
      <button v-for="[k, t] in addable" :key="k" class="list-row" @click="add(k)">
        <span class="grow">{{ t.label }}<span class="sub">{{ t.desc }}</span></span>
        <Icon name="plus" :size="18" />
      </button>
    </div>
    <p v-if="!addable.length" class="empty-hint">所有组件都已经在桌面上啦，之后会有更多～</p>
  </Sheet>
</template>

<style scoped>
.desk {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  grid-auto-flow: row dense;
  margin-top: 22px;
}
.widget {
  min-width: 0;
  position: relative;
  border-radius: 24px;
  background: var(--card);
  box-shadow: var(--shadow);
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
}
.widget .inner { height: 100%; border-radius: inherit; overflow: hidden; }
.widget.small { aspect-ratio: 1; }
.widget.large { grid-column: span 2; }
.widget.large.chick, .widget.large.anniv { aspect-ratio: 2 / 1; }

/* 编辑模式 */
.editing .widget { touch-action: none; animation: wiggle .32s ease-in-out infinite alternate; cursor: grab; }
.editing .widget:nth-child(2n) { animation-delay: -.16s; }
.editing .widget .inner { pointer-events: none; }
.widget.dragging { z-index: 30; animation: none; box-shadow: 0 16px 40px rgba(40, 40, 60, .22); transition: none; cursor: grabbing; }
@keyframes wiggle { from { rotate: -.6deg; } to { rotate: .6deg; } }

.badge {
  position: absolute;
  z-index: 2;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 0;
  display: grid;
  place-items: center;
  padding: 0;
  box-shadow: 0 2px 6px rgba(40, 40, 60, .18);
  font-size: 0.75rem;
  font-weight: 700;
}
.badge.del { top: -8px; left: -8px; background: #fff; color: var(--text-2); }
.badge.size { bottom: -8px; right: -8px; background: var(--ink); color: #fff; }

.add-tile {
  border: 2px dashed var(--line);
  background: transparent;
  box-shadow: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--text-3);
  font-size: 0.87rem;
  animation: none !important;
}
.hint { grid-column: span 2; text-align: center; font-size: 0.75rem; color: var(--text-3); margin: 4px 0 0; }

.edit-bar {
  position: fixed;
  left: 50%;
  bottom: calc(var(--safe-bottom) + 74px);
  transform: translateX(-50%);
  display: flex;
  gap: 10px;
  z-index: 25;
  padding: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, .92);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
  box-shadow: 0 6px 22px rgba(40, 40, 60, .14);
}
.edit-bar .btn { display: flex; align-items: center; gap: 4px; }
.list-card.flat { box-shadow: none; border: 1px solid var(--line); }
</style>
