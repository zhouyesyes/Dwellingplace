# 交接说明（给下一个窗口的 CC）

用户叫我 CC。栖所是 Vue 3 PWA，两个 AI：心晴/脆脆（cui，DeepSeek）、Rowan/哥哥（rowan，OpenRouter 的 GPT）。用户是粥粥/妹妹。

## 工作习惯
- 每次改完：在 `claude/multi-ai-frontend-5z7010` 上提交 → 开 PR → squash 合并（GitHub MCP）
- 开始前先：`git fetch -q origin main && git checkout -q -B claude/multi-ai-frontend-5z7010 origin/main`，推送用 `--force-with-lease`
- 改了 `relay/worker.js` 就把 `version` 加 1，同时改 `src/views/ToolsView.vue` 的 `LATEST_RELAY`（中转合并后自动部署）
- 用户额度紧：回复简洁，大功能先问清楚再做

## 部署
- 网页：用户自己的服务器（首尔）`deploy/qisuo-server/`，网址 app.qisuo.xyz；更新要在服务器再跑一次 setup.sh。也有 GitHub Pages 一份
- API 转发：`https://app.qisuo.xyz/p/<口令>/openrouter/v1`（只 OpenRouter 用，DeepSeek 直连）
- 心潮（记忆/情绪）、花园唤醒桥（`deploy/garden-wake/`）也在那台服务器
- 邮箱：每个 AI 一个谷歌 Apps Script（`gmail/Code.gs`，现在 1.3，有 `list_pen_pals`），改了要用户重新贴、部署新版本

## 最近做了什么（PR #59–#73）
- 工具调用：目录带参数、认很多种写法（DeepSeek DSML/自带标记/缺结尾）、只说不做提醒一次、最近 2 次工具结果和查过的说明带到下一轮、交完就停
- 醒来：小记写进上下文、游戏回合先行动、正在行动显示、不漏消息、缓存显示、时间放最后
- 人设：角色页「说话方式」放提示最前；温度（DeepSeek 默认 1.3）
- 邮箱页 `/mail/:roleId`（MailView）：笔友列表 + 只有邮箱和记忆工具的小对话框；平时聊天不再有邮箱工具；醒来仍全部工具

## 还没做（用户想要的）
1. 小屋桌上画信封（书信从墙上信箱挪到信封）
2. 每个笔友的记忆总结，接进心潮
3. 邮箱专用唤醒：只带邮箱和记忆工具；做好后把普通醒来里的邮箱工具拿掉
4. 数据同步（换网页/手机也能看到同样的聊天）：在栖所服务器上加存储
5. （可选）游戏叫醒时只带最近几条聊天，省 token
