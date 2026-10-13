// 小章鱼桌宠：站在输入框上面（共读页站在「一起读」上面）。
// 平时待机、偶尔走两步、吐个泡泡；他在回复时敲键盘（短的两条敲，长的四条敲），用工具时指着小终端，还没开口时在想；
// 出错了着急；做完事、收到夸奖、收到信，各播一次小反应；很久没动静就缩成一团、困了；半夜还在聊，就举牌子催你睡觉。
// 一次性的小反应从这里发出去：petOnce("happy" | "shy" | "success" | "letter" | "bubble")
import { reactive } from "vue";
import { store } from "../store/index.js";

export const pet = reactive({ once: null, at: 0, lastActive: Date.now(), bedtimeOff: 0 });
export const petOn = () => store.settings.pet !== false;
export function petOnce(kind) { pet.once = kind; pet.at = Date.now(); }
export function petActive() { pet.lastActive = Date.now(); }

// 你说的话：夸他、撒娇，他会开心或者害羞一下
const SHY = /可爱|亲亲|抱抱|想你|爱你|喜欢你|贴贴|么么|mua/i;
const HAPPY = /谢谢|辛苦|真棒|好棒|厉害|聪明|夸夸|好厉害|太好了|完美/;
export function petHears(text) {
  petActive();
  const t = String(text || "");
  if (SHY.test(t)) petOnce("shy");
  else if (HAPPY.test(t)) petOnce("happy");
}
// 他回完一条：写了信 → 收到信；用过工具、记了东西 → 做成了
export function petAfterReply(msg) {
  if (!msg || msg.error) return;
  const notes = (msg.notes || []).map(n => n.text || "");
  if (notes.some(t => /写了一封信/.test(t))) petOnce("letter");
  else if (notes.some(t => /翻了翻记忆|搜索了|用了|记下|贴了|放了一张/.test(t))) petOnce("success");
}
