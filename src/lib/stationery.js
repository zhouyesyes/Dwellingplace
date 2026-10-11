// 信纸和信封：九套（GPT 画的素材切出来的）。每封信记着用的是哪套（letter.paper）
//   素材：n-env1~4（合上 → 打开 → 信在里面 → 信抽出来），n-top / n-mid / n-bot（信纸的上段、带横线的中段、下段；信长了中段接着往下铺）
//   geom：每套信纸的尺寸（640 宽时的像素）——上段多高、一行多高、下段多高、横线左右端
import geom from "./stationery-geom.json";

const files = import.meta.glob("../assets/letters/*.webp", { eager: true, query: "?url", import: "default" });
export const asset = name => files[`../assets/letters/${name}.webp`];

export const PAPERS = [
  { id: "plain", n: 1, name: "素笺", ink: "#3d342b" },
  { id: "sakura", n: 2, name: "樱粉", ink: "#6a3c44" },
  { id: "ribbon", n: 3, name: "蓝绸", ink: "#2e3d5c" },
  { id: "wisteria", n: 4, name: "紫藤", ink: "#463d63" },
  { id: "lily", n: 5, name: "铃兰", ink: "#394837" },
  { id: "night", n: 6, name: "星夜", ink: "#1f2a44" },
  { id: "airmail", n: 7, name: "航空", ink: "#2c3550" },
  { id: "cloud", n: 8, name: "云月", ink: "#33405a" },
  { id: "lace", n: 9, name: "蕾丝", ink: "#4a3e38" },
].map(p => ({ ...p, g: geom[p.n], env: [1, 2, 3, 4].map(i => asset(`${p.n}-env${i}`)), top: asset(`${p.n}-top`), mid: asset(`${p.n}-mid`), bot: asset(`${p.n}-bot`) }));

export const DEFAULT_MINE = "plain";
export const DEFAULT_HIS = "night";
export const paperById = id => PAPERS.find(p => p.id === id);
export const paperByName = name => PAPERS.find(p => p.name === String(name || "").trim());
// 没选过的旧信：你的素笺，他的星夜
export const paperOf = l => paperById(l?.paper) || paperById(l?.from === "me" ? DEFAULT_MINE : DEFAULT_HIS);
