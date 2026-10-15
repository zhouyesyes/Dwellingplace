// 文案只作为纯文本显示；占位符每次按当前昵称展开，历史记录保留当时的文字。
export const POKE_RE = /\[戳一戳\]/g;
export const POKE_DEFAULTS = { user: "你戳了戳{他}的脑袋", ai: "{他}戳了戳你" };
export const cleanPoke = value => typeof value === "string" ? [...value.replace(/[\u0000-\u001f\u007f]/g, " ").trim()].slice(0, 60).join("") : "";
export function pokeText(role, direction) {
  const template = cleanPoke(role.poke?.[direction]) || POKE_DEFAULTS[direction];
  return template.replace(/\{(他|我)\}/g, (_, key) => cleanPoke(key === "他" ? role.name : role.me?.name) || (key === "他" ? "GPT" : "你"));
}
