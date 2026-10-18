// 文案只作为纯文本显示；占位符每次按当前昵称展开，历史记录保留当时的文字。
export const POKE_RE = /\[戳一戳\]/g;
export const POKE_DEFAULTS = { user: "你戳了戳{他}的脑袋", ai: "{他}戳了戳你" };
export const cleanPoke = value => typeof value === "string" ? [...value.replace(/[\u0000-\u001f\u007f]/g, " ").trim()].slice(0, 60).join("") : "";
export function pokeText(role, direction) {
  const template = cleanPoke(role.poke?.[direction]) || POKE_DEFAULTS[direction];
  return template.replace(/\{(他|我)\}/g, (_, key) => cleanPoke(key === "他" ? role.name : role.me?.name) || (key === "他" ? "GPT" : "你"));
}

// 他自己改戳一戳显示的那句话：[改戳一戳:你戳对方|文案]（他戳她时显示的）、[改戳一戳:对方戳你|文案]（她戳他时显示的）。
// 悄悄改（她 10/18 定的，不提示）；文案里可以用 {他}（他的名字）、{我}（她的名字）
export const POKE_EDIT_RE = /\[改戳一戳[:：]\s*(你戳对方|对方戳你)\s*[|｜]([^\]\n]{1,80})\]/g;
export function applyPokeTags(role, text) {
  return { text: String(text || "").replace(POKE_EDIT_RE, (_, who, value) => {
    const v = cleanPoke(value);
    if (v) { role.poke ??= {}; role.poke[who === "你戳对方" ? "ai" : "user"] = v; }
    return "";
  }).replace(/\n{3,}/g, "\n\n").trim(), notes: [] };
}
