# 1313a2b 最终验收

2026-10-16 · Codex。原提交 1313a2b 保持不变；本次只读检查后发现四处可复现缺陷，修复另建提交。未联网或 git pull，未安装依赖，未访问真实用户素材/生产凭据，未部署、重启或更新生产服务。测试仅启动新的 127.0.0.1 隔离服务，结束即关闭。

## 发现与修复

| 缺陷 | 原提交复现 | 修复与回归 |
| --- | --- | --- |
| 慢请求覆盖新状态 | 暂停重命名 body，期间归档，再释放 body；归档状态变回 used，libraryPath 丢失 | 读完 body 后再读当前元数据；并发归档/使用记录保留 |
| 未通知任务的引用缺失 | attach 已写入任务附件，但未 send/通知失败时，素材 tasks 不含新任务 | attach 即登记关联，不标记使用；usedTasks 单独记录通知被接受的任务。保存已有素材也补充来源引用 |
| 链接成功、元数据中断后无法重试 | 故意令素材元数据写入失败，重试保存/归档返回 EEXIST | 同 dev/inode 的普通文件可复用；不同文件或符号链接拒绝，不覆盖目标 |
| 旧通知覆盖新用途/状态 | 旧 send 的 RPC 暂停，重新 attach 新用途，再释放旧 RPC；新用途被覆盖且误报 delivered | notificationRevision 校验；旧通知不覆盖新版本，新版本失败仍 pending，重试后 delivered |

回归测试故意在本脚本创建的临时目录注入故障和替换目录，不修改任何已有用户文件。

## 证据类型

- **本地真实**：实际 Node/Vue 代码、Linux 文件读写/硬链接/目录描述符、PNG 原字节和浏览器 DOM/交互/截图。
- **离线替身**：Codex app-server RPC、模型、UI 后端接口和系统剪贴板方法；文件测试仅将临时附件目录的所有权查询模拟为 root，文件权限/读取没有跳过。另测真实非 root 所有权与可组写目录被拒绝。
- **尚未验证/未实现**：下面逐条写明，绝不把上述替身当作生产链路实测。

## 原任务 A/B 对照

| 条目 | 已检查/验证 | 限制 |
| --- | --- | --- |
| A1 既有结构和 API | 本地读代码核对 WorkroomView/workroom/workTogether、bridge、proxy、安装和原截图收取器 | 未连线上 API |
| A2 创建及运行中追加 | 新任务前选文件/用途和创建后上传代码已核对；已有任务真实处理函数上传，UI file input 上传交互通过 | 新任务创建→真实 app-server→上传的完整端到端流程未验；创建 UI 命名流程本轮仅代码审查 |
| A3 目录及输入 | 真实落盘 tasks/<任务>/<UUID>，Codex 输入中名称/MIME/字节数/用途/路径/localImage 断言通过；项目素材挂接仅在任务元数据引用共享路径 | 输入接收由 RPC 替身确认；全任务共用 UID，无 OS 级任务保密隔离 |
| A4 列表/缩略图/预览/下载 | Vue 真实渲染和交互；真实处理函数返回 PNG 字节、MIME、长度和下载名称均与原件一致，无转码 | UI 与真实生产鉴权/proxy 全链路未连接 |
| A5 保留/清理 | 结束处理不删除输入；任务归档后原件/附件列表可读；文档明确永久保留 | 无删除 API、总配额、清理实现。未来清理只能作为设计约束，不能声称已经验过自动清理 |
| A6 追加通知 | steer 目标轮、输入内容、明确失败不记已通知、同文件重试和新旧版本并发状态通过 | 全为 RPC 替身；真实 Codex 运行中接收/采取行动、网络断开时是否接受未知，未验证；不承诺 exactly-once |
| B1 固定导入区 | 实际 projects/<项目>/inbox 命名空间与列表 UI | 目录位于源码之外；通过项目相对 ../.qisuo-attachments/... 访问，不是仓库内素材目录 |
| B2 上传/预览/复制/改名/入库 | 两通道真实 Vue 按钮/文件选择；复制按钮传给剪贴板方法的值与显示路径一致；真实文件改名/归档后旧路径仍可读 | 剪贴板方法替身，未验设备系统剪贴板；UI API 为虚构 fixture |
| B3 路径读取 | 实际 uid 1001 子进程，以临时项目目录为 cwd，读取 API 生成 inbox/library 相对路径，原字节一致 | 非生产实际目录，不读取真实素材；未向另一个真实 Codex 派单 |
| B4 状态/来源/同名 | pending/used/archived、tasks/usedTasks/sourceTask/originalPath，路径派单标记、同名 UUID 隔离通过 | used 表示派单被接受，不表示真正读取/加工；原始历史 usedTasks 不补猜 |
| B5 双向挂接/共用原件 | 任务→收件箱、收件箱→任务、归档同 inode，无字节复制；来源/挂接引用与失败重试通过 | 多文件元数据不是数据库事务；清理必须扫描全部真实引用，不能只依赖一个数组 |

## 安全边界

| 边界 | 结论 |
| --- | --- |
| 文件类型/MIME/头部/大小/路径 | 本地测试通过：允许列表、可执行后缀/原型属性名拒绝、空文件/超限拒绝、恰好 20 MiB 接受、JSON/文本原校验。文件名清理、改名保留扩展名、穿越拒绝 |
| API 跨任务/项目 | 不属于任务的附件 ID、其他项目素材 ID、跨项目 attach 被拒绝。认证是整个私人工作间共用的身份，不是每任务独立账户 |
| 符号链接/目录替换 | 拒绝叶子及父目录链接到其他任务、项目、受控目录外的假文件。打开目录后再替换路径，读取仍使用原 fd；新请求拒绝链接。root 所有权查询替身的范围已披露 |
| 直接磁盘读取隔离 | **未实现**：所有任务共用 UID 1001，原件 0644/目录 0755，知道路径即可读其他任务/项目素材。API 防穿越不等于 OS 访问隔离；不能宣称严格跨任务保密验收通过 |
| 不自动执行 | 无解压或执行上传内容代码；上传文件 0644，执行文件扩展名拒绝。未启动危险文件验证，没有自动执行路径 |
| 凭据和日志 | 本次未读凭据或真实素材；新增代码不写凭据/签名 URL 日志。任务内必须给出受控原件路径，不能将其误报为凭据泄漏；生产反向代理/系统日志未验 |
| 数据/依赖/生产/无关 UI | 无新增依赖、无用户数据删除、无部署或生产重启；主页插件/下拉刷新/其他 UI 未改 |
| 移动/归档/清理 | 归档增加硬链接，显示改名不动路径，不覆盖原件。只在临时副本演示 unlink 某链接后其他链接字节仍在，但被删路径会悬空；文档禁止删除任何仍被登记的路径，自动清理未实现 |

## 六条验收要求

1. **直接附件链路**：真实 PNG→真实上传处理/落盘→实际 UID 读取→真实预览/下载处理函数字节一致通过；界面上传/预览/下载入口通过 mock API；Codex RPC 为替身，线上端到端未验。
2. **收件箱链路**：真实上传/项目相对路径读取、路径派单后的 used、归档仍保留旧路径通过；浏览器复制值通过剪贴板替身，实际系统剪贴板/真实 Codex 按路径读取未验。
3. **运行中追加**：steer/expectedTurnId、明确失败、重试、通知版本并发通过替身；真实 app-server 的进行中上下文可见性/实际读取动作未验。
4. **测试/类型/构建**：下面相关测试与构建通过；仓库无独立 typecheck，Node --check 仅语法检查，Vite 构建不是完整类型检查。
5. **截图**：用已有 ui-preview，两套界面各六张手机/平板/桌面浅深色，虚构数据；正常/SIGTERM 收尾和真实收取器回归通过。生产 bridge 的本轮自动收取/回传未在本地证明，PNG/manifest 已按任务约定存放。
6. **最终报告**：核对原提交 14 个文件与 git show --name-only 一致；存储表与代码一致、20 MiB/4附件限制一致、默认永久保留与代码一致、两种使用步骤/API 建议一致。补充 tasks/usedTasks、通知版本、共享 UID 和未来清理的准确限制。本轮修复文件另见 git diff/新提交。

## 测试命令

均只在本地运行，未安装包。隔离 UI runner 使用 createServer(configFile:false, envDir:临时目录, host:127.0.0.1, 随机端口)，依次执行两个原 UI 脚本后 finally 关闭；从不复用或重启既有服务。

```sh
node scripts/workroom-attachments-check.mjs
node scripts/workroom-progress-check.mjs
node scripts/preview-artifacts-check.mjs
node /tmp/qisuo-final-ui-runner.mjs
# runner 内分别执行：
# QISUO_TEST_URL=<本次隔离本机地址> node scripts/workroom-ui-check.cjs
# QISUO_TEST_URL=<本次隔离本机地址> node scripts/workroom-preview-ui-check.cjs
node scripts/ui-preview-lifecycle-check.cjs
node scripts/ui-preview.cjs --task 01a143b9-f117-7043-a6cb-e59c578bb7f1 --route /work --fixture workroom-materials
node scripts/ui-preview.cjs --task 01a143b9-f117-7043-a6cb-e59c578bb7f1 --route /work --fixture workroom-attachments
node --check deploy/qisuo-server/codex/bridge.mjs
node --check scripts/fixtures/workroom-materials.cjs
node node_modules/vite/bin/vite.js build
git diff --check
```

Vite 仅既有动态/静态导入提示；原界面测试还有既有 CalendarWidget 非 props 属性提示。未为这些无关提示改代码。

上线后仍需她按相同两条路径使用无敏感素材，确认真实鉴权/proxy、root 管理目录及容器挂载、系统复制下载、真实 Codex start/steer 接收与读取，以及跨服务重启后的附件/通知恢复。严格任务间不可读需要单独的隔离设计，无法靠上线复验补齐。

## 本轮截图

素材收件箱：`.qisuo-previews/01a143b9-f117-7043-a6cb-e59c578bb7f1/d03c3906-0aa9-4593-b855-ff97dfe6e8e1/`。
任务附件：`.qisuo-previews/01a143b9-f117-7043-a6cb-e59c578bb7f1/89b27d6c-496d-4a87-ad58-6ea51ef85756/`。
各有 phone/tablet/desktop 的 light/dark 六图及 manifest；人工查看手机浅色和附件平板深色。均为虚构数据，不含生产信息。
