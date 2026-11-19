# InkBone for VS Code / Cursor（中文小说实时质检扩展）

把 InkBone 的零依赖确定性检查引擎直接搬进 VS Code 与 Cursor，实现像 ESLint 一样的**边写边实时划波浪线**：

- **实时行内波浪线**：自动向上发现书目录的 `novel.json`、`ledger.json` 与 `.inkbone-whitelist`，实时标出语域穿帮、历法错误、AI 套话、退化、对话标点与主语歧义；
- **一键 Quick Fix（灯泡菜单）**：一键剥离残留 `**星号**` 格式，或将本书合法专属表达加入 `.inkbone-whitelist`；
- **命令面板四件套**：
  - `InkBone: Audit Current Chapter`
  - `InkBone: Normalize Markdown & Punctuation`
  - `InkBone: Copy Targeted Rewrite Prompt`（复制精准局部改稿指令）
  - `InkBone: Export Current Chapter for Platform`（一键预览起点/番茄/七猫/晋江投稿版）

## 本地试用与打包

1. 在 VS Code / Cursor 中打开本目录 `editors/vscode-inkbone/`，按 `F5` 即可在 Extension Development Host 窗口实时体验；
2. 若需安装为本地插件包：
   ```bash
   cd editors/vscode-inkbone
   npx @vscode/vsce package --allow-missing-repository
   code --install-extension inkbone-vscode-2.0.0.vsix
   ```

> **Obsidian 复用提示**：`diagnostics-core.mjs` 与 `src/core/` 完全纯 JS 且零第三方依赖，可无缝封装为 Obsidian CodeMirror 6 实时 linter 插件。
