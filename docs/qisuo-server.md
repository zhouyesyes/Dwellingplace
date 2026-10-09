# 把栖所放到自己的服务器上

做两件事：

1. **网页从自己的服务器打开**（`https://app.你的域名`），不再从 GitHub Pages 打开，国内打开更稳
2. **API 从服务器转发**：服务器在首尔，能直接连 OpenRouter，手机不开梯子也能和用 GPT 的 TA 聊天

代码在 `deploy/qisuo-server/`：`server.mjs` 只用 Node 自带的东西，放网页、转发 API；`setup.sh` 用 Docker 装好。

## 安装

在服务器终端粘贴：

```sh
bash <(curl -fsSL https://raw.githubusercontent.com/zhouyesyes/Dwellingplace/main/deploy/qisuo-server/setup.sh)
```

它会问两个问题（端口、网址），然后：

- 下载最新的栖所、构建、启动（`--restart unless-stopped`，服务器重启后会自己起来）
- 生成一个**转发口令**，试一下能不能连上 OpenRouter
- 把新网址加进每一份心潮的 `DASHBOARD_ALLOWED_ORIGINS`，重启心潮（不然新网址连不上心潮）
- 把要做的事写进 `~/qisuo-server/栖所服务器信息.txt`

## 装完以后

1. **Cloudflare 隧道加一条公共主机名**：`app` → `HTTP` → `localhost:18200`（和装心潮时一样的地方）
2. 手机打开 `https://app.你的域名/health`，看到 `"ok":true` 就通了
3. **搬数据**：旧栖所「设置 → 备份 → 导出」，新网址「设置 → 备份 → 导入」
4. **改 API 地址**：「设置 → API」里把 OpenRouter 的接口地址换成信息文件里那个 `https://app.你的域名/p/口令/openrouter/v1`，Key 不用改
5. 新网址重新「添加到主屏幕」，唤醒页重新打开推送通知

## 转发是怎么回事

`/p/<口令>/<去哪>/…` 原样转发到下面几家，流式回复一块块往回送：

| 去哪 | 转到 |
|---|---|
| `openrouter` | `https://openrouter.ai/api` |
| `openai` | `https://api.openai.com` |
| `anthropic` | `https://api.anthropic.com` |
| `deepseek` | `https://api.deepseek.com` |
| `gemini` | `https://generativelanguage.googleapis.com` |

口令不对就拒绝，别的网站也转不了，不会被别人拿去当跳板。Key 只是路过，服务器不存。

## 更新

再运行一次安装那一行：口令、端口、网址都不变，只换成最新的栖所。
