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
export function playingPlaylist() {
  const library = musicLibrary();
  const previous = library.playlists.find(p => p.id === library.bookmark?.playlistId);
  if (playbackPlaylist?.list.length) return playbackPlaylist;
  return previous?.list.length ? previous : activePlaylist();
}
const trackKey = track => track && (track.src || "netease") + ":" + track.id;
export function savedPosition(track) {
  const bookmark = musicLibrary().bookmark;
  return bookmark?.playlistId === playingPlaylist().id && bookmark.track === trackKey(track) ? bookmark.seconds : 0;
}
export function playFromPlaylist(index) {
  return getMusicPlayer().play(index, { playlist: activePlaylist() });
}
export function getMusicPlayer() {
  if (!player) {
    const playlist = playingPlaylist();
    const bookmark = musicLibrary().bookmark;
    const index = playlist.list.findIndex(track => bookmark?.track === trackKey(track));
    if (bookmark?.playlistId === playlist.id && index >= 0) playlist.idx = index;
    player = createPlayer({
      load: playingPlaylist,
      onStart: (playlist, track, seconds) => {
        playbackPlaylist = playlist;
        musicLibrary().bookmark = { playlistId: playlist.id, track: trackKey(track), seconds };
      },
      resumePosition: savedPosition,
      save: () => { musicRevision.value++; },
      onChange: () => { musicRevision.value++; },
      onStatus: text => { musicStatus.value = text; },
    });
    function rememberPosition(exact = false) {
      const bookmark = musicLibrary().bookmark;
      const seconds = player.audio.currentTime;
      if (!bookmark || !player.audio.readyState || !Number.isFinite(seconds)) return;
      if (exact || Math.abs(seconds - bookmark.seconds) >= 5) bookmark.seconds = seconds;
    }
    player.audio.addEventListener("timeupdate", () => { rememberPosition(); musicRevision.value++; });
    player.audio.addEventListener("pause", () => rememberPosition(true));
    player.audio.addEventListener("seeked", () => rememberPosition(true));
    player.audio.addEventListener("durationchange", () => { musicRevision.value++; });
  }
  return player;
}
export function addPlaylist(name) {
  const playlist = { id: uid(), name, list: [], idx: 0, mode: "all" };
  musicLibrary().playlists.push(playlist);
  musicLibrary().active = playlist.id;
}
