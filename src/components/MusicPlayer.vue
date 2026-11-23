<script setup>
import { computed, ref } from "vue";
import Icon from "./Icon.vue";
import { getMusicPlayer, activePlaylist, musicLibrary, musicRevision, musicStatus, addPlaylist } from "../lib/musicPlayer.js";
import { searchSongs } from "../lib/music/music.mjs";
defineProps({ compact: Boolean });
const player = getMusicPlayer();
const queueOpen = ref(false), query = ref(""), results = ref([]), searching = ref(false), error = ref("");
let searchVersion = 0;
const playlist = computed(() => { musicRevision.value; return activePlaylist(); });
const library = computed(musicLibrary);
const current = computed(() => { musicRevision.value; return player.current(); });
const playing = computed(() => { musicRevision.value; return player.playing(); });
const elapsed = computed(() => { musicRevision.value; return player.audio.currentTime || 0; });
const duration = computed(() => { musicRevision.value; return Number.isFinite(player.audio.duration) ? player.audio.duration : 0; });
const lyrics = computed(() => {
  musicRevision.value;
  const all = player.lyric();
  if (!all.length) return ["", current.value ? "暂无歌词" : "选首歌，在这里慢慢听。", ""];
  const index = Math.max(0, player.line());
  return [all[index - 1]?.text || "", all[index]?.text || "", all[index + 1]?.text || ""];
});
const modeName = computed(() => ({ all: "列表循环", one: "单曲循环", shuffle: "随机播放" })[playlist.value.mode || "all"]);
const time = n => Math.floor(n / 60) + ":" + String(Math.floor(n % 60)).padStart(2, "0");
async function search() {
  const version = ++searchVersion;
  if (!query.value.trim()) { results.value = []; return; }
  searching.value = true; error.value = "";
  try { const songs = await searchSongs(query.value.trim()); if (version === searchVersion) results.value = songs; }
  catch { if (version === searchVersion) error.value = "搜歌失败，请稍后重试"; }
  finally { if (version === searchVersion) searching.value = false; }
}
function newList() { const name = prompt("新歌单的名字"); if (name?.trim()) addPlaylist(name.trim()); }
function changePlaylist() { player.stop(); musicRevision.value++; }
</script>
<template>
  <section class="music-surface" :class="{ compact }" aria-label="公共音乐播放器">
    <div class="music-heading">
      <div class="record" :class="{ playing }"><div class="record-cover"><img v-if="current?.cover" :key="current.cover" :src="current.cover" alt="歌曲封面" @error="$event.target.hidden = true"><Icon v-else name="music" :size="30" /></div></div>
      <div class="song-info"><strong>{{ current?.title || "A little music" }}</strong><small>{{ current?.artist || "Your shared soundtrack" }}</small></div>
    </div>
    <div class="music-lyrics"><p v-for="(line, i) in lyrics" :key="i" :class="{ current: i === 1 }">{{ line || "　" }}</p></div>
    <label class="music-seek"><span class="sr-only">播放进度</span><input type="range" min="0" max="1000" :value="duration ? elapsed / duration * 1000 : 0" :disabled="!duration" @input="player.seek(Number($event.target.value) / 1000)"></label>
    <div class="music-time"><span>{{ time(elapsed) }}</span><span>{{ time(duration) }}</span></div>
    <div class="music-controls">
      <button :aria-label="modeName + '，点击切换'" :title="modeName" @click="player.mode()"><span aria-hidden="true">{{ playlist.mode === 'shuffle' ? '⤨' : playlist.mode === 'one' ? '↻₁' : '↻' }}</span></button>
      <button aria-label="上一首" :disabled="!playlist.list.length" @click="player.prev()">‹</button>
      <button class="music-play" :aria-label="playing ? '暂停' : '播放'" :disabled="!playlist.list.length" @click="player.toggle()"><span aria-hidden="true">{{ playing ? 'Ⅱ' : '▶' }}</span></button>
      <button aria-label="下一首" :disabled="!playlist.list.length" @click="player.next()">›</button>
      <button aria-label="展开或收起歌单" :aria-expanded="queueOpen" @click="queueOpen = !queueOpen"><Icon name="menu" :size="18" /></button>
    </div>
    <p v-if="musicStatus" class="music-status" role="status">{{ musicStatus }}</p>
    <div v-if="queueOpen" class="music-queue">
      <div class="queue-tracks"><div v-for="(song, i) in playlist.list" :key="song.src + ':' + song.id" class="queue-track" :class="{ active: song.id === current?.id }"><button @click="player.play(i)"><strong>{{ song.title }}</strong><small>{{ song.artist }}</small></button><button :aria-label="'从歌单移除' + song.title" @click="player.remove(i)">×</button></div><p v-if="!playlist.list.length">歌单还是空的，搜一首喜欢的歌。</p></div>
      <form class="music-search" @submit.prevent="search"><input v-model="query" aria-label="搜歌" placeholder="Search songs"><button :disabled="searching">{{ searching ? "…" : "Search" }}</button></form>
      <div class="playlist-switch"><select v-model="library.active" aria-label="切换歌单" @change="changePlaylist"><option v-for="p in library.playlists" :key="p.id" :value="p.id">{{ p.name }}</option></select><button aria-label="新建歌单" @click="newList">+</button></div>
      <p v-if="error" role="alert">{{ error }}</p>
      <div class="queue-tracks"><div v-for="song in results" :key="song.src + ':' + song.id" class="queue-track"><button @click="player.add(song, true)"><strong>{{ song.title }}</strong><small>{{ song.artist }}</small></button><button :aria-label="'加入歌单' + song.title" @click="player.add(song, false)">+</button></div></div>
    </div>
  </section>
</template>
