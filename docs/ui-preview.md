# 界面验收截图

## 已调查的能力

- 前端是 Vue + Vite，`npm run dev` / `npm run preview` 原本绑定所有网卡。新增命令不复用这些服务；单独构建到系统临时目录，用 Node HTTP 仅监听 `127.0.0.1` 的随机端口，退出关闭，无需部署。
- 工作间已有输入附件上传、随机编号、20 MB 限额、任务归属检查和经过服务器鉴权的查看接口；原来没有生成产物收取。现在复用该接口保存截图，通过 `qisuo/preview/ready` 事件持久化到任务记录并实时显示，重进任务会回放。
- 容器 Dockerfile 已安装全局 Playwright、Chromium 和中文字体；无新增 npm 或系统依赖。本机也已可用。
- 页面数据存浏览器 IndexedDB，不需要登录即可显示空白主页、设置等。同步、模型和唤醒需要另行配置；截图不导入这些配置，不读取真实用户数据库或浏览器 profile。

## 使用

在项目根目录运行（工作间会在每轮输入提示真实任务编号）：

```sh
node scripts/ui-preview.cjs --task 工作间任务编号 --route /settings
```

默认生成手机 390×844、平板 834×1194、桌面 1440×900 的浅色和深色截图。按需缩小范围：

```sh
node scripts/ui-preview.cjs --task 工作间任务编号 --route /books --views phone,tablet --themes light
```

手动测试可不传 `--task`，产物放入 `manual`。不支持携带查询参数的路由，避免意外把令牌写入标注。当前每次命令只截一个路由；多个页面分别运行。

截图和清单：`.qisuo-previews/<任务编号>/<随机运行编号>/`。PNG 下边缘标注路由、视口、主题及 UTC 生成时间；`manifest.json` 最后写入，标记这一组已经完成。该目录已被 Git 忽略。预览临时构建会自动清理，验收截图会保留，不自动删除任务产物。

本轮任务结束时，bridge 按当前项目及任务编号收取清单，校验文件大小、PNG 签名和安全路径，将文件复制到原有受保护附件目录。每张图会在工作间显示缩略图和可打开的附件链接，并附带路由、视口、主题、时间；已收取的运行编号保存在任务元数据中，避免重复。失败显示提示，后续一轮结束会重试。每轮最多处理 20 组，每组最多 6 张；失败组不妨碍其他组。

## 隔离与收尾

- 不读取项目 `.env`，不继承 `VITE_*` 构建环境变量，不导入 storageState、cookies、生产凭据、聊天或图片。
- 每张图使用新的 browser context，禁用 Service Worker 和 WebSocket；仅允许本次预览来源的静态 GET。外部网络、接口和提交请求均不放行；本地服务器只提供临时构建目录中的文件。
- 正常完成或异常走 `finally` 关闭 Chromium、HTTP 服务并清理临时构建；处理 SIGINT/SIGTERM，另有两分钟总超时。强制 SIGKILL 无法执行脚本清理，但服务与脚本在同一进程内，不会留下单独的预览服务器。
- 收取器运行于 Linux 工作间，逐层以 O_NOFOLLOW 打开并固定目录描述符，拒绝符号链接、路径穿越及跨任务引用。仍沿用原有服务器鉴权，不建立公开图片服务。
- 默认空白状态适合基本布局。需要聊天、书籍或工作间复杂状态时，应另写任务专用的虚构 fixture / 接口模拟；不可复制生产数据。本次工作间展示验收使用模拟后端及真实测试截图，未连接线上工作间。

## 验证与生效

```sh
node scripts/ui-preview.cjs
node scripts/preview-artifacts-check.mjs
node scripts/ui-preview-lifecycle-check.cjs
node scripts/workroom-attachments-check.mjs
node scripts/workroom-progress-check.mjs
npx --no-install vite build
```

`workroom-preview-ui-check.cjs` 与原 `workroom-ui-check.cjs` 需独立本地 Vite 服务，通过 `QISUO_TEST_URL` 指定；本轮由临时 Node runner 启动随机本机端口，执行后 `finally` 关闭。前者验证真实 PNG 的 SSE 事件展示、任务附件链接和标注，并保存工作间浅深色截图到手动截图目录。

附件测试的临时目录属于普通用户，所以仅在测试 fixture 中把该目录的所有权查询模拟为安装后 root 所有；生产目录检查未放宽。

本地截图命令现在可用。线上工作间自动回传需她先推上线，再按原流程重新运行服务器安装命令以更新容器（Dockerfile 新增复制 previews.mjs）。本次没有推送、部署、重启服务器或改动线上数据，无需审批安装新依赖。现有正在运行的 bridge 不会因为改本地源码而自动拥有新协议；本轮用隔离测试验证整条新链路，并在回复中直接提供截图。
