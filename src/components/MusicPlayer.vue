<script setup>
import { computed, ref, watch, onMounted, onBeforeUnmount } from "vue";
import Icon from "./Icon.vue";
import { getMusicPlayer, activePlaylist, playingPlaylist, playFromPlaylist, musicLibrary, musicRevision, musicStatus, addPlaylist, savedPosition } from "../lib/musicPlayer.js";
import { searchSongs, resolveCover, lyricOf, lineAt } from "../lib/music/music.mjs";
import { toast } from "../lib/toast.js";
defineProps({ compact: Boolean });
const player = getMusicPlayer();
const queueOpen = ref(false), query = ref(""), results = ref([]), searching = ref(false), error = ref("");
let searchVersion = 0;
const playlist = computed(() => { musicRevision.value; return activePlaylist(); });
const playback = computed(() => { musicRevision.value; return playingPlaylist(); });
const library = computed(musicLibrary);
const current = computed(() => { musicRevision.value; return player.current(); });
const playing = computed(() => { musicRevision.value; return player.playing(); });
const elapsed = computed(() => { musicRevision.value; return player.audio.readyState ? player.audio.currentTime : savedPosition(current.value); });
const duration = computed(() => { musicRevision.value; return Number.isFinite(player.audio.duration) ? player.audio.duration : 0; });
const previewLyrics = ref([]);
const loadingLyrics = ref(false);
watch(current, async (song, _, onCleanup) => {
  let cancelled = false;
  onCleanup(() => { cancelled = true; });
  previewLyrics.value = [];
  loadingLyrics.value = !!song;
  if (!song) return;
  try {
    const lines = await lyricOf(song);
    if (!cancelled) previewLyrics.value = lines;
  } catch { /* 音源没返回歌词 */ }
  finally { if (!cancelled) loadingLyrics.value = false; }
}, { immediate: true });
const lyrics = computed(() => {
  musicRevision.value;
  const live = player.lyric();
  return live.length ? live : previewLyrics.value;
});
const currentLine = computed(() => Math.max(0, lineAt(lyrics.value, elapsed.value)));
function loadCovers(songs) {
  for (const song of songs) resolveCover(song).catch(() => {});
}
watch(() => [current.value, ...(queueOpen.value ? playlist.value.list : [])],
  songs => loadCovers(songs.filter(Boolean)), { immediate: true });
const lyricBox = ref(null);
let browseTimer;
function followLyric() {
  const box = lyricBox.value;
  const line = box?.querySelector(".current");
  if (line) box.scrollTop = line.offsetTop + (line.offsetHeight - box.clientHeight) / 2;
}
function browseLyrics() {
  clearTimeout(browseTimer);
  browseTimer = setTimeout(() => { browseTimer = null; followLyric(); }, 6000);
}
watch(lyrics, () => { clearTimeout(browseTimer); browseTimer = null; followLyric(); }, { flush: "post" });
watch(currentLine, () => { if (!browseTimer) followLyric(); }, { flush: "post" });
onMounted(followLyric);
onBeforeUnmount(() => clearTimeout(browseTimer));
const modeName = computed(() => ({ all: "列表循环", one: "单曲循环", shuffle: "随机播放" })[playback.value.mode || "all"]);
const time = n => Math.floor(n / 60) + ":" + String(Math.floor(n % 60)).padStart(2, "0");
async function search() {
  const version = ++searchVersion;
  if (!query.value.trim()) { results.value = []; searching.value = false; error.value = ""; return; }
  searching.value = true; error.value = "";
  try {
    const songs = await searchSongs(query.value.trim());
    if (version !== searchVersion) return;
    results.value = songs.map(song => ({ ...song }));
    loadCovers(results.value);
  }
  catch { if (version === searchVersion) error.value = "搜歌失败，请稍后重试"; }
  finally { if (version === searchVersion) searching.value = false; }
}
function newList() { const name = prompt("新歌单的名字"); if (name?.trim()) addPlaylist(name.trim()); }
function addSong(song, play) {
  const index = player.add({ ...song }, false, playlist.value);
  if (play) playFromPlaylist(index);
}
function removeSong(song) {
  const list = playlist.value;
  if (confirm("从「" + list.name + "」移除《" + song.title + "》？")) player.remove(list.list.indexOf(song), list);
}
function copySong(song, event) {
  const dest = library.value.playlists.find(p => p.id === event.target.value);
  event.target.value = "";
  if (!dest) return;
  player.add({ ...song }, false, dest);
  toast("已加入「" + dest.name + "」");
}
</script>
<template>
  <section class="music-surface" :class="{ compact }" aria-label="公共音乐播放器">
    <div class="music-heading">
      <div class="record" :class="{ playing }"><div class="record-cover"><Icon name="music" :size="30" /><img v-if="current?.cover" :key="current.cover" :src="current.cover" alt="" referrerpolicy="no-referrer" @error="$event.target.hidden = true"></div></div>
      <div class="song-info"><strong>{{ current?.title || "A little music" }}</strong><small>{{ current?.artist || "Your shared soundtrack" }}</small></div>
    </div>
    <div ref="lyricBox" class="music-lyrics" tabindex="0" aria-label="歌词" @wheel.passive="browseLyrics" @touchmove.passive="browseLyrics" @pointerdown="browseLyrics" @keydown="browseLyrics">
      <p v-for="(line, i) in lyrics" :key="i" :class="{ current: i === currentLine }" :aria-current="i === currentLine ? 'true' : undefined">{{ line.text }}</p>
      <p v-if="!lyrics.length" class="lyric-empty">{{ loadingLyrics ? "正在加载歌词…" : current ? "暂无歌词" : "选首歌，在这里慢慢听。" }}</p>
    </div>
    <label class="music-seek"><span class="sr-only">播放进度</span><input type="range" min="0" max="1000" :value="duration ? elapsed / duration * 1000 : 0" :disabled="!duration" @input="player.seek(Number($event.target.value) / 1000)"></label>
    <div class="music-time"><span>{{ time(elapsed) }}</span><span>{{ time(duration) }}</span></div>
    <div class="music-controls">
      <button :aria-label="modeName + '，点击切换'" :title="modeName" @click="player.mode()"><span aria-hidden="true">{{ playback.mode === 'shuffle' ? '⤨' : playback.mode === 'one' ? '↻₁' : '↻' }}</span></button>
      <button aria-label="上一首" :disabled="!playback.list.length" @click="player.prev()">‹</button>
      <button class="music-play" :aria-label="playing ? '暂停' : '播放'" :disabled="!playback.list.length" @click="player.toggle()">
        <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
          <path v-if="playing" d="M4 3h2.5v10H4zm5.5 0H12v10H9.5z" />
          <path v-else d="M4 2.5 13 8l-9 5.5z" />
        </svg>
      </button>
      <button aria-label="下一首" :disabled="!playback.list.length" @click="player.next()">›</button>
      <button aria-label="展开或收起歌单" :aria-expanded="queueOpen" @click="queueOpen = !queueOpen"><Icon name="menu" :size="18" /></button>
    </div>
    <p v-if="musicStatus" class="music-status" role="status">{{ musicStatus }}</p>
    <div v-if="queueOpen" class="music-queue">
      <div class="queue-tracks">
        <div v-for="(song, i) in playlist.list" :key="song.src + ':' + song.id" class="queue-track" :class="{ active: song === current }">
          <button @click="playFromPlaylist(i)">
            <span class="track-cover"><Icon name="music" :size="15" /><img v-if="song.cover" :key="song.cover" :src="song.cover" alt="" referrerpolicy="no-referrer" @error="$event.target.hidden = true"></span>
            <span class="track-copy"><strong>{{ song.title }}</strong><small>{{ song.artist }}</small></span>
          </button>
          <label v-if="library.playlists.length > 1" class="track-add">
            <span aria-hidden="true">+</span>
            <select :aria-label="'将《' + song.title + '》加入其他歌单'" @change="copySong(song, $event)">
              <option value="" disabled selected>加入其他歌单</option>
              <option v-for="dest in library.playlists.filter(p => p.id !== playlist.id)" :key="dest.id" :value="dest.id">{{ dest.name }}</option>
            </select>
          </label>
          <button class="track-remove" :aria-label="'从歌单移除' + song.title" @click="removeSong(song)">×</button>
        </div>
        <p v-if="!playlist.list.length">歌单还是空的，搜一首喜欢的歌。</p>
      </div>
      <form class="music-search" @submit.prevent="search"><input v-model="query" aria-label="搜歌" placeholder="Search songs"><button :disabled="searching">{{ searching ? "…" : "Search" }}</button></form>
      <div class="playlist-switch"><select v-model="library.active" aria-label="切换歌单"><option v-for="p in library.playlists" :key="p.id" :value="p.id">{{ p.name }}</option></select><button aria-label="新建歌单" @click="newList">+</button></div>
      <p v-if="error" role="alert">{{ error }}</p>
      <div class="queue-tracks">
        <div v-for="song in results" :key="song.src + ':' + song.id" class="queue-track">
          <button @click="addSong(song, true)">
            <span class="track-cover"><Icon name="music" :size="15" /><img v-if="song.cover" :key="song.cover" :src="song.cover" alt="" referrerpolicy="no-referrer" @error="$event.target.hidden = true"></span>
            <span class="track-copy"><strong>{{ song.title }}</strong><small>{{ song.artist }}</small></span>
          </button>
          <button :aria-label="'加入歌单' + song.title" @click="addSong(song, false)">+</button>
        </div>
      </div>
    </div>
  </section>
</template>
