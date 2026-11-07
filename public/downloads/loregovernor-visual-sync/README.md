# LoreGovernor 视觉同步：GitHub 网页上传版

[下载 ZIP](https://raw.githubusercontent.com/zhouyesyes/Dwellingplace/main/public/downloads/loregovernor-visual-sync/LoreGovernor-visual-sync.zip)

ZIP 根目录只有三个完整运行文件，不是差异补丁。单文件备用下载：

- [index.js](https://raw.githubusercontent.com/zhouyesyes/Dwellingplace/main/public/downloads/loregovernor-visual-sync/index.js)
- [style.css](https://raw.githubusercontent.com/zhouyesyes/Dwellingplace/main/public/downloads/loregovernor-visual-sync/style.css)
- [native-panel.mjs](https://raw.githubusercontent.com/zhouyesyes/Dwellingplace/main/public/downloads/loregovernor-visual-sync/native-panel.mjs)

## 在 GitHub 网页上传

1. 下载 ZIP 并解压。
2. 打开 [zhouyesyes/LoreGovernor 根目录](https://github.com/zhouyesyes/LoreGovernor)，选择要更新的分支，点 Add file → Upload files。
3. 同时拖入解压后的三个文件（不要拖整个文件夹或 ZIP），确认 index.js、style.css 被替换、native-panel.mjs 位于仓库根目录，再提交。

这次只提供上传文件；没有直接修改 LoreGovernor 仓库。上传前若这三个文件已有其他改动，先比对，不要覆盖新修改。

## 来源与效果

2026-11-07 核对 Fork 当前 main 基线：fea3fd70303b9a7a971eef9e96b391a7d0d2a722。应用 [栖所 PR #337](https://github.com/zhouyesyes/Dwellingplace/pull/337) 的原补丁后导出；除在文件开头加入原作者 Zeaden 的完整 MIT 许可外，三个文件与补丁应用结果逐字一致。原仓库 LICENSE、manifest.json 等其他文件不变。

受管条目的开关和灰显跟随当前聊天，旁边显示「聊天配置 · 不写回原书」。受管开关只读，选择仍在扩展配置中修改；未管理条目保持原生行为。视觉同步不保存世界书，手动编辑标题、正文仍会保存原书。

语法与原补丁逻辑/DOM 检查通过，ZIP 内容校验通过。没截图，尚未在真实酒馆验收。更新扩展并刷新后，请检查浅色/深色、切聊天、保存不同选择和刷新世界书面板，并确认视觉同步没有世界书保存请求。
