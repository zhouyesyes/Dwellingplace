# LoreGovernor 世界书面板视觉同步：一键安装与完整回退

这是栖所 PR #337 的安装包装，不是另一份扩展。保留 Zeaden 的作者署名和完整 MIT License，不改世界书数据和聊天选择。补丁原件在 `docs/patches/LoreGovernor-native-panel.patch`，安装器固定下载原 PR 的提交并校验 SHA-256，不跟随该分支变化。

## 在小续的 Ubuntu 宿主服务器上执行

已经装过 LoreGovernor 扩展后，在服务器终端复制下面**一整行**。不用进入任何目录、不用拉仓库、不用手动搬文件。需要服务器已有 Node.js 18.17+、Git、curl、sudo；脚本不安装软件。不要在本机手机或栖所 Docker 容器里执行。先暂停扩展更新和编辑，等待命令完成后再操作酒馆。

安装：

```sh
( set -eu; f=$(mktemp --suffix=.mjs); trap 'rm -f "$f"' EXIT; curl -fL --retry 2 https://raw.githubusercontent.com/zhouyesyes/Dwellingplace/main/scripts/loregovernor/install.mjs -o "$f"; sudo node "$f" install )
```

完整回退（自动找到安装时的备份，恢复整个扩展目录，包括 `.git`、隐藏文件及安装前的本地文件）：

```sh
( set -eu; f=$(mktemp --suffix=.mjs); trap 'rm -f "$f"' EXIT; curl -fL --retry 2 https://raw.githubusercontent.com/zhouyesyes/Dwellingplace/main/scripts/loregovernor/install.mjs -o "$f"; sudo node "$f" rollback )
```

看到「安装完成」或「已完整回退」才算成功，然后重新加载酒馆页面。`sudo` 如要求服务器密码，只在服务器终端输入。

## 兼容性与备份

- 自动搜索宿主目录及 Docker 命名卷，跳过虚拟文件系统、镜像层、缓存与本脚本备份。只接受唯一一份 LoreGovernor；未安装或找到多份就停止，不猜哪个正在用。符号链接目录不跟随，扩展内部有链接或特殊文件也停止。
- 严格核对已验证 Fork 基线 `fea3fd70303b9a7a971eef9e96b391a7d0d2a722` 的 `index.js`、`style.css`、`README.md`、`manifest.json` 和 `LICENSE` 全文哈希。原版、更新版、本地改过这些文件的版本会停止；不会擅自换装 Fork 或覆盖本地修改。
- 下载后先校验补丁哈希，在同文件系统临时副本里 `git apply --check`、应用补丁、跑语法和原补丁的逻辑/DOM 检查。现有扩展直到所有检查通过都不会修改。
- 切换前再次比较完整目录，确认期间没有变化；按时间在扩展同级创建 `.qisuo-lg-backup-时间-随机值/`。原扩展整个目录原样移入其中的 `original/`，包括版本信息、权限和属主，再切入已验证副本；普通切换错误会立即放回原目录。备份目录只允许执行者读取。
- 回退时验证备份完整性，恢复备份副本；回退前的扩展另存为备份里的 `rollback-before-时间/`，原始备份继续保留。安装后新增或修改的扩展文件也会被整体撤回。酒馆目录之外的数据不受影响。
- 重复安装会提示已经安装，不会叠加补丁、覆盖首份备份。测试期间不要自动更新扩展；更新可能覆盖补丁和回退标记。
- 扩展目录本身若是 Docker 挂载点，系统可能拒绝目录改名，此时停止并保留原目录。请在宿主机执行；挂载的是整个酒馆目录或 `third-party` 目录时正常使用。
- 突然断电或强制结束进程可能留下同级 `.qisuo-lg-lock` 与备份/临时目录；下次运行会停止。这种情况先保留现场，找人检查，别盲目删除。正常成功或失败会清理临时目录与锁。

## 显示效果与验收

受管条目的开关、灰显随当前聊天配置同步，旁边显示「聊天配置 · 不写回原书」；未管理条目保持原生行为。请切两个聊天、保存不同选择、换书/搜索/翻页和刷新面板，检查显示更新；网络面板确认视觉同步没有世界书保存请求。标题和正文仍是原生编辑器，手动编辑它们仍会保存原书。

容器无浏览器，没截图，也没有在小续服务器上实际安装；需要在真实酒馆检查浅色/深色。此次不改 `deploy/qisuo-server/` 和 `relay/`，不用重跑栖所服务器安装、不用重部署中转。

开发验证：`node scripts/loregovernor/tests/install.test.mjs`（在系统临时目录下载公开基线副本，不接触真实安装）。
