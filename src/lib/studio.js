// 小螃蟹的工作室：照着它聊天的地址（…/claude/v1）配一个工作室的（…/claude/studio/v1），单独一个对话
import { store, uid, apiById, studioThreadOf, CRAB } from "../store/index.js";
import { newApi } from "./providers.js";

// 返回工作室对话的地址；还没配好小螃蟹的接口就去它的设定
export function studioPath(role) {
  const chatApi = apiById(role?.apiId);
  if (!chatApi) return `/settings/role/${CRAB}`;
  const url = chatApi.baseUrl.replace(/\/+$/, "").replace(/\/claude\/v1$/i, "/claude/studio/v1");
  let api = store.apis.find(a => a.baseUrl?.replace(/\/+$/, "") === url);
  if (!api) {
    api = { ...newApi("openai"), id: uid(), name: "小螃蟹的工作室", baseUrl: url, key: "plan", model: chatApi.model || "sonnet", favModels: ["sonnet", "opus"] };
    store.apis.push(api);
  }
  return `/chat/${CRAB}/${studioThreadOf(CRAB, api.id).id}`;
}
