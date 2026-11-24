# Changelog

## 2.1.0 — 2026-11

### 新增与改进（完全向后兼容 v2.0 CLI、MCP 与台账格式）
- **离线 280 字滑窗 AIGC 结构熵与虚词双侧护栏（`aigc-check` + `--aigc-guard` + `inkbone_aigc_check`）**：
  - 新增纯内存零依赖模块 `src/core/aigc-guard.mjs` 与本地封装 `src/aigc-guard.mjs`，同时接入 CLI、Browser Playground（`--aigc-guard` 勾选开关）、Browser Doctor 与第 10 个 MCP 工具 `inkbone_aigc_check`；
  - 区分五类自然段结构句式（`N` 纯叙述、`A` 动作冒号、`Q` 首引号单轮、`S` 居中提示语夹心、`M` 多轮冒号复合段），计算段落句式香农熵并精准识别 `SSS+` 连续夹心对话同构与长串 `A` 动作冒号墙；
  - 实施双侧`的`字护栏与引号外叙述层指代/砖块扫描：拦截因“强抠`的`字（`<1.25/百字`）改塞`这/那`指示词或硬拼 `>=6` 字实词定语砖块”引发的越改越假反弹，同时自动豁免台账角色名与项目白名单，避免误伤鲜活口语对白；
  - 默认 `audit` / `doctor` 模式下仅输出 `cadenceEntropy`、`sandwichParaRatio`、`demonsPer100Han`、`maxWindowAigcRisk` 作为 `info` 参考指标（对既有合规书稿保持 100% 零误报），显式传入 `--aigc-guard` 或运行 `aigc-check` 时输出行级局部改稿目标。
- **高区分度对话标点与叙事结构套路扩充**：
  - `configs/zh-linguistics.json` 新增对话标点规则 `dialogue_period_before_quote`（同段内高频出现`动作。“台词。”`句号贴左引号硬切）、修辞规则 `rhet_panel_dossier_recitation`（第三人称旁白说明书式播报折价单/账单/面板数字），以及禁用套话 `cliche_speakerphone_briefing`（免提静默两秒传出干脆嗓音）与 `cliche_bystander_choke_mutter`（旁观者呛汤低声嘀咕切镜）；
  - `configs/genres.json` 通用水词新增 `filler_eat_sleep_boil_montage`（补觉睡醒烧热水日常蒙太奇），`urban-realism` 与 `light-fantasy` 新增警情通报量词 `reg_news_classifier_demonstrative`（`这名/那名男子/摊主`）。
- **起草/局部改稿提示词与 10 组正反例升级**：
  - 升级 `prompts/02-paratactic-renderer.md`（v1.2）与 `prompts/03-targeted-rewriter.md`（v1.2），区分上位者冷硬短句与市井日常角色口语呼吸（`吧/吗/啊/呢`），明确面板/账目数字走当面抢白、旁观反应做当面拉扯，并写入“三条防越改越假铁律”；
  - 扩充 `resources/bad_vs_good_cases.md` 至 10 组对照（新增案例九「账目/面板信息去说明书化」与案例十「防强删‘的’字反弹与连续夹心对话模板」），同步补强 `resources/genre_playbooks/light-fantasy.md`。
- **脱敏校准基准与 80 项自动化测试**：新增原创零单书耦合对照样本 `benchmarks/zhuque-calibration/samples.json` 与 `tests/v21-aigc-guard.test.mjs`（含全仓 `.mjs` 源码零汉字字面量守卫），全量测试扩充至 80 项。

## 2.0.0 — 2026-11

### 重大升级（完全向后兼容 v1.x CLI 与台账格式）
- **MCP 全能力三件套（9 Tools + 8 Prompts + 11 Resources）**：`inkbone mcp` 在零第三方依赖的前提下补齐 `prompts/list`、`prompts/get`（传入 `genre` 自动拼附对应题材剧本卡）、`resources/list` 与 `resources/read`（9 份流派剧本卡 + 微技法 + 正反例对照），并新增 `inkbone_style_profile` 与 `inkbone_export` 工具
- **零版权风险“安全拆书”引擎（`style-profile` + `customGates`）**：新增 `src/core/style-profiler.mjs` 与 `inkbone style-profile` 命令，基于样本纯统计区间自动匹配最接近预设并生成可直接写入 `novel.json` 的 `customGates`，绝不输出任何原句
- **长篇硬状态守卫（阵亡/退场角色防诈尸 + 短线战术道具追踪 + 可执行世界观铁律 + 资源流水账与历法跨度守卫）**：
  - `DECEASED_CHARACTER_APPEARANCE`：从 `characterSnapshots[name].status` 或 `deceasedCharacters[]` 识别已退场角色，在后续章节非回忆/追忆段落中若作为活跃主语说话或行动则精准预警；
  - `UNRESOLVED_TACTICAL_PROP`：支持在 `foreshadowing` 或 `tacticalProps` 中标记 `mustResolveByChapter` 与 `anchorTerm`，到达截止章仍未出现且未结清时自动预警；
  - `WORLD_RULE_VIOLATION`：`immutableWorldRules` 升级支持结构化规则对象 `{ id, rule, forbiddenPattern, activeChapters, exemptTerms }`，把世界观铁律编译为确定性代码门禁；
  - `RESOURCE_LEDGER_MISMATCH` 与 `CALENDAR_SPAN_CONTRADICTION`：`settle` 与 `check-ledger` 支持 `resourceDeltas`（`{ before, delta, after }`）单章算术与跨章期初/期末余额守恒核验；审计引擎新增同章农历月日跨度与“半个月”宣称自相矛盾检测
- **黄金三章首屏留存门禁（`--golden-three` / `GOLDEN_OPENING_SLOW_START`）**：开启后自动核查开篇前 380 汉字是否零对白且缺乏即时冲突动作信号，拦截慢热风景/背景铺垫开局
- **大长篇增量体检、4 平台投稿导出与零依赖内投 `.docx` / `.zip` 打包**：`doctor` 新增 `--chapters <40-45>` 与 `--changed [git-ref]` 增量模式；`export` 新增 `--docx-out`（零依赖直出标准宋体小四、1.25 倍行距、首行缩进 2 字符、自动防双重缩进的 OOXML Word 内投文档，支持 `--outline` 拼合大纲）、`--zip-out` 分章压缩包与各平台内投达标字数（2万/1.5万字）自动核验
- **存量旧书批量回填台账工作流（`backfill-prompt` + `settle --batch`）**：新增 `inkbone backfill-prompt` 按批次为未填摘要的存量章节生成结构化回填 Prompt，配合 `inkbone settle --batch` 一次无损合入多章结算数组
- **繁体中文 / 港台网文规则层与自动识别**：新增 `configs/zh-traditional.json` 与 `--variant auto|zh-hans|zh-hant`，自动识别繁体文本并叠加繁体高频 AI 套话、港台跨语境用词、繁体历法刻数与直角引号（`「」`/`『』`）对话标点卫生检查
- **浏览器试跑台原地双击改稿与整书多章体检台（Browser Doctor · Tab 4）**：Tab 1 支持双击任意高亮行原地编辑（`contentEditable`）、实时重算高亮并自动持久化至 `localStorage`；Tab 4 支持一次拖入整个 `chapters/` 文件夹跑跨章回声体检、Top 10 套话榜、一键下载 `ledger.json`、一键导出平台 `.txt` / **内投 Word `.docx`** / **分章 `.zip`**
- **VS Code / Cursor 实时波浪线扩展升级**：新增角色台账 Hover 悬停状态卡片（防写串/防诈尸）、状态栏当前章有效汉字数与目标平台字数差额实时显示、一键导出内投 `.docx` 命令及完整插件市场发布元数据
- **公开可复现基准与实机截图**：新增 `benchmarks/eval-set/public-pairs.json`、`scripts/run-public-eval.mjs` 与 `benchmarks/public-report.md`，并在 README 首屏补充实机截图与公开对比表

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
