# Changelog

## 1.3.0 — 2026-11

### 新增与改进
- **零依赖 stdio MCP Server（`inkbone mcp`）与宿主 Hooks 模板**：纯 Node 实现 JSON-RPC 2.0 over stdio（同时兼容 NDJSON 与 `Content-Length` 帧协议），暴露 `inkbone_packet`、`inkbone_audit`、`inkbone_doctor`、`inkbone_normalize`、`inkbone_verify_review`、`inkbone_check_ledger`、`inkbone_settle` 7 个工具；新增 [examples/mcp-config.json](examples/mcp-config.json) 与 [examples/claude-code-hooks.json](examples/claude-code-hooks.json)
- **写后结算与活账本闭环**：新增纯内存 `src/core/ledger-manager.mjs`、`prompts/07-chapter-settler.md` 以及 `check-ledger` / `settle` 命令，支持无损合入章节摘要、角色 8 字段快照增量与伏笔状态跃迁，自动检查章号重复/断档、揭露章先后矛盾与逾期未收伏笔；`packet` 支持自动过滤已完结伏笔、提醒 `dueForeshadowing`，并支持按 `activeCharacters` 裁剪长篇角色快照
- **存量书稿候选人名自动挖掘**：`import-ledger` 新增启发式角色候选抽取（`stats.candidateCharacters`）与 `--auto-characters` 自动回填 `characterNames`，解决存量书稿因角色名单为空导致主语连续性检测默认跳过的问题；`doctor` 在角色名单为空时显式输出引导提示
- **双语文案抽离与 `audit` 可读报告**：新增 `configs/messages.json`（代码保持零汉字字面量），`doctor` 默认输出全中文报告（支持 `--lang en`），`audit` 新增 `--format md --lang zh|en`，新增 `rewrite-prompt` 命令输出精准局部改稿指令
- **补厚 6 个垂直题材包规则**：为 `wuxia-jianghu`、`mystery-thriller`、`urban-realism`、`scifi-wasteland`、`light-fantasy`、`romance-emotional` 扩充高信噪比 `registerRules`、`clicheRules` 与 `fillerRules`，全部通过正反例零误报回归
- **静态试跑台（Playground）生产力升级**：新增词级 `<mark>` 高亮、一键复制“精准改稿 Prompt”（服务不使用 CLI 的网页端 AI 写手）、本地 `.md`/`.txt` 拖拽导入、纯 CSS/DOM 段落节奏心电图，以及 Tab 2 实时台账健康体检
- **CLI 版本治理与生态分发**：新增 `--version`/`-v`（与 `package.json` 同步）、`--help` 日常高频分层与 `--help-all`、`SKILL.md` 补全 `agentskills.io` 标准 frontmatter、`.github/` 新增误报反馈/规则提案 Issue 模板与 Tag 自动发布 workflow

## 1.2.0 — 2026-11

### 新增与改进
- 补强 `mystery-thriller`、`urban-realism`、`scifi-wasteland`、`light-fantasy` 四个题材包的内置 `clicheRules` / `registerRules` 与剧本卡细则，并在 `general-clean`、`classical-xianxia` 等剧本卡补充因果触发门禁与节奏抗打断规则（禁止无前提动作的手机/道具自爆巧合、禁止紧张推进中段插境界科普）
- 在 `SKILL.md` 新增「轻量快改（不建台账、单段/单章救急）」入口与“按阶段按需读取”守则，降低短任务摩擦与首轮上下文开销
- 中英文 README 新增“150 字实测改前/改后直观对照”与单章 30 秒零配置快检示例，同步纳入 `docs/` 纯浏览器静态试跑台（含 `build:docs` / `check:docs`）
- 改进 `eval-pack`（`buildBlindPack`）：多对样本采用受 seed 控制的半数均衡洗牌，消除小样本全落同侧偏差；改进 `doctor`（`diagnoseProject`）：未指定题材且无 `novel.json` 扫描混题材目录时输出 `mixedGenreFiles` 告警提示

## 1.1.1 — 2026-11

### 修复与改进
- 修复 `dialogueSpan` 混淆直角引号专名（`「...」`/`『...』`）与说话对白的问题，避免打断 `SUBJECT_AMBIGUITY` 主语追踪或误重置 `EXPOSITION_DIALOGUE_DROUGHT`
- 修复 `doctor` 在中文分卷目录（第一卷/第二卷/第三卷）下按字典序乱序导致跨卷衔接回声漏检的问题，`collectTextFiles` 同步改用自然数字序
- 扩展 `ledgerBracketNote` 以捕获纯中文数字和长前缀的括号算式注记
- 修复 `normalizer` 剥离斜体时丢失 HTML 注释与书级白名单保护区间的漏洞
- 统一 `profiler` 的 Frontmatter/代码块/注释跳过逻辑、白名单星号保护以及 `CHAPTER_TERM_FATIGUE` 主角别名豁免；启用 `advisoryMinHits` 规则门槛配置
- 扩充 `micro_techniques.md` 伏笔与换地图规则，补强历史权谋、传统武侠、悬疑推理、科幻废土剧本卡及历史称谓/武侠模板检测规则
- 修复埋坑压测暴露出的四处边界漏检：全角/半角作者批注（如 `【注：……】`）纳入 Tier1 工程词拦截、引号前置时外漏句号检测（`“……”。”` / `“……”。他提醒道`）、脱离时辰的非法刻数（`九刻钟` 等），以及 `boundary-compiler` 校验必达锚点与剧透词时忽略内嵌 Markdown 强调星号
- 修复 `compileBoundaryPacket` 未对 `futureBlueprints` 做联动脱敏的侧路剧透隐患：未到 `revealChapter` 的禁止词在 `futureBlueprints` 的标题和梗概中会自动脱敏为 `[REDACTED]`
- 重写中英文 README（精简聚焦上手演示、19 条命令与 46 项测试，补齐写作方法库说明）并同步打包 Skill 目录

## 1.1.0 — 2026-11

### 新增
- 规则三层：通用层 → 题材包 → 项目层（`novel.json` 的 `projectRules` / `rulesFile` / `.inkbone-whitelist`，`disabledRuleIds` 可关上层规则）
- 9 个题材包；`doctor`/`audit` 自动发现项目配置
- 密度型文风探针（微动作、套式反应、动作清单、引号强调、解释链、感叹号密度与连叠、电报体反向守卫等 13 项）
- 模型退化检测：复读、截断、AI 自指、占位符、Tier1/Tier2 工程词泄漏
- 引号感知：规则默认只扫叙述层，`scope` 可选
- `normalize`、`check-outline`、`import-ledger`、`eval-pack`/`eval-score`、`rule-stats`、`mine` 命令
- 每命中带 `layer` 字段，可回溯到所属层

## 1.0.0 — 2026-11

首次公开。分阶段写作提示词（语体合同 → 节拍 → 正文 → 审读 → 局部修改）、台账边界检查、语域防火墙、套话清洗、引文真实性校验、朱雀检测记录、盲读评估工具。
