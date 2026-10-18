<script setup>
// 小组件桌面：长按进入编辑；编辑时可以拖动排序、删除、换大小、添加
import { ref, computed, nextTick, onBeforeUnmount, onMounted, watch } from "vue";
import { packWidgets } from "../../lib/widgetLayout.js";
import { store, uid } from "../../store/index.js";
import AnnivWidget from "../widgets/AnnivWidget.vue";
import BookshelfWidget from "../widgets/BookshelfWidget.vue";
import DeskWidget from "../widgets/DeskWidget.vue";
import Sheet from "../Sheet.vue";
import Icon from "../Icon.vue";

const TYPES = {
  // 小鸡（暖暖）收起来了：组件还在 widgets/ChickWidget.vue，数据也没删
  anniv: { label: "纪念日", desc: "在一起第几天，下一个纪念日还有多久", comp: AnnivWidget, sizes: ["small", "large"] },
  desk: { label: "共写", desc: "在写的书，和他一起琢磨卡片和资料", comp: DeskWidget, sizes: ["large", "small"] },
  books: { label: "书架（共读）", desc: "放几本书，和他一起读，书里能贴便利贴", comp: BookshelfWidget, sizes: ["large"] },
};

const editing = ref(false);
const widgets = computed(() => store.widgets.filter(w => TYPES[w.type]));

// 平板使用像素行轨道，卡片各自占高，不再被同一行最高的卡片撑开。
const desk = ref(null);
const positions = ref({});
let observer;
let frame;
let disposed = false;
const tabletQuery = "(min-width: 760px) and (max-width: 1366px) and (any-pointer: coarse)";
const tabletMedia = matchMedia(tabletQuery);
function scheduleLayout() {
  if (disposed) return;
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(layout);
}
function layout() {
  if (disposed || !desk.value) return;
  const tablet = tabletMedia.matches;
  if (!tablet) { positions.value = {}; return; }
  const column = (desk.value.clientWidth - 28) / 3;
  const items = widgets.value.map(w => ({
    ...w,
    height: w.size === 'small' ? column : (column * 2 + 14) / 2,
  }));
  if (editing.value) items.push({ id: '__add', size: 'small', height: column });
  const packed = packWidgets(items);
  positions.value = Object.fromEntries(packed.map(p => [p.id, {
    gridColumn: `${p.x + 1} / span ${p.width}`,
    gridRow: `${p.y + 1} / span ${p.height}`,
  }]));
  positions.value.__hint = { gridColumn: "1 / -1", gridRow: `${Math.max(0, ...packed.map(p => p.y + p.height)) + 19} / span 24` };
}
onMounted(() => {
  observer = new ResizeObserver(scheduleLayout);
  observer.observe(desk.value);
  window.addEventListener('resize', onResize);
  window.addEventListener('blur', onUp);
  window.addEventListener('pagehide', onUp);
  window.addEventListener('scroll', onScroll, true);
  document.addEventListener('visibilitychange', onVisibility);
  tabletMedia.addEventListener('change', onResize);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  scheduleLayout();
});
watch([widgets, editing], async () => {
  await nextTick();
  if (disposed) return;
  observer?.disconnect();
  if (desk.value) observer?.observe(desk.value);
  for (const w of widgets.value) {
    const inner = els[w.id]?.querySelector('.inner');
    if (inner) observer?.observe(inner);
  }
  scheduleLayout();
}, { deep: true, immediate: true });
onBeforeUnmount(() => {
  disposed = true;
  onUp();
  observer?.disconnect();
  cancelAnimationFrame(frame);
  window.removeEventListener('resize', onResize);
  window.removeEventListener('blur', onUp);
  window.removeEventListener('pagehide', onUp);
  window.removeEventListener('scroll', onScroll, true);
  document.removeEventListener('visibilitychange', onVisibility);
  tabletMedia.removeEventListener('change', onResize);
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  window.removeEventListener('pointercancel', onUp);
});

// ---------- 长按进入编辑 ----------
let pressTimer = null;
let pressStart = null;
let pressPointer = null;
function cancelPress() {
  clearTimeout(pressTimer);
  pressTimer = null;
  pressPointer = null;
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
  if (grab || e.isPrimary === false || (e.pointerType === "mouse" && e.button !== 0)) return;
  if (!editing.value) {
    cancelPress();
    pressPointer = e.pointerId;
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
  grab = { pointerId: e.pointerId, order: [...store.widgets], targets: widgets.value.filter(item => item.id !== w.id).map(item => ({ id: item.id, rect: els[item.id].getBoundingClientRect() })), lastTarget: null, el, dx: e.clientX - r.left, dy: e.clientY - r.top, x: e.clientX, y: e.clientY };
  dragId.value = w.id;
}

async function onMove(e) {
  if (pressTimer && pressPointer === e.pointerId && pressStart && Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) > 8) cancelPress();
  if (!grab || grab.pointerId !== e.pointerId) return;
  const active = grab;
  grab.x = e.clientX;
  grab.y = e.clientY;
  place();
  // 使用按下时的命中区，补位后的卡片移动不会在指针下反复交换。
  const target = grab.targets.find(({ rect: r }) => e.clientX > r.left && e.clientX < r.right && e.clientY > r.top && e.clientY < r.bottom);
  if (!target || target.id === grab.lastTarget) return;
  grab.lastTarget = target.id;
  const order = [...grab.order];
  const from = order.findIndex(w => w.id === dragId.value);
  const to = order.findIndex(w => w.id === target.id);
  if (from < 0 || to < 0) return;
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved);
  store.widgets = order;
  await nextTick();
  if (grab !== active) return;
  layout();
  await nextTick();
  if (grab === active) place();
}

function onUp(e) {
  if (e?.pointerId !== undefined && e.pointerId !== (grab?.pointerId ?? pressPointer)) return;
  cancelPress();
  if (grab) {
    grab.el.style.transform = "";
    if (grab.el.hasPointerCapture(grab.pointerId)) grab.el.releasePointerCapture(grab.pointerId);
    grab = null;
    dragId.value = null;
  }
}
function onResize() { onUp(); scheduleLayout(); }
function onScroll() { if (grab || pressTimer) onUp(); }
function onVisibility() { if (document.hidden) onUp(); }

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
  <section ref="desk" class="wdesk" :class="{ editing }">
    <div
      v-for="w in widgets"
      :key="w.id"
      :ref="el => (els[w.id] = el)"
      class="widget"
      :data-widget-id="w.id"
      :style="positions[w.id]"
      :class="[w.size, w.type, { dragging: dragId === w.id }]"
      @pointerdown="onDown($event, w)"
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

    <button v-if="editing" class="widget small add-tile" :style="positions.__add" @click="addOpen = true">
      <Icon name="plus" :size="26" /><span>添加组件</span>
    </button>
    <p v-if="widgets.length && !editing" class="hint" :style="positions.__hint">长按组件可以排序、删除或添加</p>
    <p v-if="!widgets.length && !editing" class="hint" :style="positions.__hint"><button class="btn soft small" @click="editing = true">编辑桌面</button></p>
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
.wdesk {
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
/* 大的统一 2:1、小的 1:1（日历要放一整个月，单独高一些） */
.widget.large { aspect-ratio: 2 / 1; }
/* 平板：一行三格，小组件不再被撑得很大 */
@media (min-width: 760px) {
  .wdesk { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

@media (min-width: 760px) and (max-width: 1366px) and (any-pointer: coarse) {
  .wdesk { grid-auto-rows: 1px; row-gap: 0; grid-auto-flow: row; align-items: start; }
  .widget { height: 100%; aspect-ratio: auto !important; }
  .hint { grid-column: 1 / -1; margin-top: 18px; }
  .wdesk.editing { margin-bottom: 150px; }
}

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
.badge.del { top: -8px; left: -8px; background: var(--card); color: var(--text-2); }
.badge.size { bottom: -8px; right: -8px; background: var(--ink); color: var(--on-ink); }

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
  background: rgba(var(--glass-rgb), .92);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
  box-shadow: 0 6px 22px rgba(40, 40, 60, .14);
}
.edit-bar .btn { display: flex; align-items: center; gap: 4px; }
.list-card.flat { box-shadow: none; border: 1px solid var(--line); }
</style>
