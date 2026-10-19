// 小螃蟹的工作室：照着它聊天的地址（…/claude/v1）配一个工作室的（…/claude/studio/v1），单独一个对话
import { store, uid, apiById, studioThreadOf, CRAB } from "../store/index.js";
import { newApi } from "./providers.js";

// 能看仓库的那个接口（没有就配一个）；小螃蟹聊天时说「看仓库」就换到它
export function studioApi(role) {
  const chatApi = apiById(role?.apiId);
  if (!chatApi || !/\/claude\/v1\/?$/i.test(chatApi.baseUrl || "")) return null;
  const url = chatApi.baseUrl.replace(/\/+$/, "").replace(/\/claude\/v1$/i, "/claude/studio/v1");
  let api = store.apis.find(a => a.baseUrl?.replace(/\/+$/, "") === url);
  if (!api) {
    api = { ...newApi("openai"), id: uid(), name: "小螃蟹的工作室", baseUrl: url, key: "plan", model: chatApi.model || "sonnet", favModels: ["sonnet", "opus"] };
    store.apis.push(api);
  }
  return api;
}

// 以前单独的工作室对话（现在并进聊天了，留着给旧数据用）
export function studioPath(role) {
  const api = studioApi(role);
  return api ? `/chat/${CRAB}/${studioThreadOf(CRAB, api.id).id}` : `/settings/role/${CRAB}`;
}
