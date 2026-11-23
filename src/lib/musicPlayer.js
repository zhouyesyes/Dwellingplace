// 播放器沿用小吧台的音源、失败恢复和歌词逻辑；页面切换共用同一个音频实例。
import { ref } from "vue";
import { store, uid } from "../store/index.js";
import { createPlayer } from "./music/music.mjs";
export const musicRevision = ref(0);
export const musicStatus = ref("");
let player;
let playbackPlaylist;
export function musicLibrary() {
  store.settings.musicLibrary ??= { active: "default", playlists: [{ id: "default", name: "My playlist", list: [], idx: 0, mode: "all" }] };
  return store.settings.musicLibrary;
}
export function activePlaylist() {
  const library = musicLibrary();
  return library.playlists.find(p => p.id === library.active) || library.playlists[0];
}
// 浏览的歌单可以变，上一首、下一首和自动续播仍用开始播放时的歌单。
export function playingPlaylist() { return playbackPlaylist?.list.length ? playbackPlaylist : activePlaylist(); }
export function playFromPlaylist(index) {
  return getMusicPlayer().play(index, { playlist: activePlaylist() });
}
export function getMusicPlayer() {
  if (!player) {
    player = createPlayer({
      load: playingPlaylist,
      onStart: playlist => { playbackPlaylist = playlist; },
      save: () => { musicRevision.value++; },
      onChange: () => { musicRevision.value++; },
      onStatus: text => { musicStatus.value = text; },
    });
    player.audio.addEventListener("timeupdate", () => { musicRevision.value++; });
    player.audio.addEventListener("durationchange", () => { musicRevision.value++; });
  }
  return player;
}
export function addPlaylist(name) {
  const playlist = { id: uid(), name, list: [], idx: 0, mode: "all" };
  musicLibrary().playlists.push(playlist);
  musicLibrary().active = playlist.id;
}
