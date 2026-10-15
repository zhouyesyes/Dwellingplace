# 同步机制与验证（2026-10-15）

数据仍在浏览器 IndexedDB（meta、msgs:*、img:*、file:* 等）和自有服务器 DATA_DIR/sync 中。服务器使用 /p/<口令>/sync 鉴权，没有栖所账号、登录会话、账号与数据空间映射；ChatGPT/Codex 的登录只是模型授权，不能用来查找栖所数据。

已有 sync:conf 优先继续使用；没有时，从已配置的服务器 API 地址提取同一受口令保护的服务器地址，探测成功后自动连接并无损合并。没有服务器配置的新设备仍须先提供服务器凭据，无法仅凭 ChatGPT 账号发现数据。关闭同步会留下本机关闭标记，避免自动连接违背用户选择。

启动先核对本地内容指纹，补回可能因退出而未记账的修改，再拉取、上传。visibilitychange 可见、pageshow、focus、online 立即同步，可见时每 20 秒轮询；本地保存后约 1.5 秒推送；正在生成的聊天暂缓；请求 30 秒超时，失败/未完成项约 5 秒后重试，待同步项写入 IndexedDB。系统杀掉后台前无法保证请求完成，下次启动继续。

写入必须带已知 rev；409 取回最新版本合并。消息有同步基线时三方合并，旧设备没有消息基线时以云端同 id 内容为准、保留本地新增 id。无法判断的同字段冲突优先云端，合并前完整本地内容及远端内容保存在本机 sync:conflict:<时间>:<键>。这些副本不上传，也不进入普通备份导出；目前没有冲突恢复界面，需要在浏览器开发者工具的 IndexedDB 中查看/取回。没有自动清理冲突副本。重新连接只合并，不再提供清库或强制覆盖入口。

上传完成只确认实际发送的一版，下载写入使用 IndexedDB 事务检查本地编辑序号；meta 尚未落盘的编辑也会阻止替换。消息基线保留本机额外副本，会增加缓存占用。服务端删除也保留 rev，旧 base=0 不再绕过删除版本；索引读取损坏时返回错误，不重建空索引。服务器数据文件和索引还没有跨文件数据库事务；多标签页没有跨页编辑锁，仍可能发生需要合并的冲突，因此这次没有实现严格的“云端唯一数据源”。完整账号方案还需要独立鉴权、账号与数据空间绑定、登录后下发数据端点，以及冲突恢复界面。

验证不接触真实服务器或账号：

```sh
npx vite --host 127.0.0.1 --port 5199
node scripts/sync-check.cjs
node scripts/sync-server-check.mjs
node scripts/workroom-ui-check.cjs
node scripts/chat-stream-check.mjs
npx vite build
```

浏览器脚本直接导入源码；修改源码后先重启 Vite，避免 HMR 时间戳产生两个不同的测试模块实例。

sync-check 覆盖启动/回前台拉取、旧缓存冲突、上传/下载期间编辑、失败保留和自动重试、失败后重启恢复、关闭后不自动连接、从已有 API 配置自动发现、冲突副本。sync-server-check 使用临时目录检查并发 CAS 和删除版本。项目无类型检查脚本或 TypeScript 配置。

工作间截图在 /tmp/workroom-{light,dark}.png、/tmp/workroom-keyboard-{light,dark}.png 和 /tmp/workroom-tablet.png；模拟手机 390×844、键盘缩短及平移、长草稿、恢复视口和平板 820×1180。Chromium 不等同于 iOS 真机键盘。提供的 MP4 在现有 Chromium 无法解码；Playwright 自带 FFmpeg 只支持有限格式，也无法读取该 MP4，所以未能逐帧核对录屏，仍需真机复核。

已有 workroom-attachments-check.mjs 当前在 cc 新增的“附件根目录需由安装脚本预建”检查处失败；与此次改动无关，本次未修改它。
