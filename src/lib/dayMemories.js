// 某一天他记住了什么（接了心潮的才有）：潮汐表格子上的小星星，点日期后在下面列出来
// 以前白日历（CalendarWidget）里的这个功能，搬到了 Record 页的潮汐表
import { computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { store } from "../store/index.js";
import { hasXinchao, dashToken, loadMemoryMap, xcCache, starDate } from "./xinchao.js";
import { ymd } from "./dates.js";

export function useDayMemories({ load = false } = {}) {
  const router = useRouter();
  const roles = computed(() => store.roles.filter(r => hasXinchao(r) && dashToken(r)));
  if (load) onMounted(() => roles.value.forEach(r => loadMemoryMap(r)));
  const byDate = computed(() => {
    const m = {};
    for (const r of roles.value) {
      for (const s of xcCache[r.id]?.map?.stars || []) {
        const d = starDate(s);
        if (d) (m[ymd(d)] ??= []).push({ ...s, role: r });
      }
    }
    return m;
  });
  const starsOf = date => [...new Set((byDate.value[date] || []).map(s => s.role.color))].slice(0, 3);
  const memsOn = date => (byDate.value[date] || []).slice().sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.importance || 0) - (a.importance || 0));
  const openMem = s => router.push({ path: "/memory", query: { role: s.role.id, open: s.id } });
  return { starsOf, memsOn, openMem };
}
