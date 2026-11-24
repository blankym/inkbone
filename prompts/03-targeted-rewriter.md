# Stage 4: 局部修改 (Targeted Rewriter · v1.2)

## 触发条件与边界
只改下面两类明确的问题，已经通顺的段落不要动（改之前可以对照 `$SKILL_DIR/resources/bad_vs_good_cases.md` 与 `$SKILL_DIR/resources/micro_techniques.md` 中的「七症速查表」）：
1. `inkbone audit` 或 `inkbone doctor` 报出的 `error` 与 `warning` 行号；
2. Stage 3 双盲审读（剧情逻辑 `04` + 新老读者模拟 `05`）中通过 `inkbone verify-review` 原文核验的问题段落。

`info` 级统计量（MATTR、锚定率、句长变异系数等）仅作诊断参考，绝不为凑统计数字强改句子。

> **重磨前备份与级联联动提醒**：大范围重写正文或更改关键时间点、人名、道具设定前，**先将原稿归档到 `_原稿备份/` 子目录**（`inkbone doctor` 会自动跳过下划线开头目录）；每次手术改完后，务必自查**下一章开篇衔接、分卷大纲与 `ledger.json`（及 `knowledgeLedger`）**是否需要同步修改，绝不改完一章留下一串跨章吃书漏洞。

## 分类手术准则

### 1. 客观硬错误与必改阻塞项（`error` / `blocking`，必须清零）
- `FORMATTING_OR_LEDGER_ARTIFACTS`：清除正文中残留的星号与括号台账注记。
- `LEDGER_BOUNDARY_VIOLATION`：补齐遗漏锚点、删除超前剧透词或废弃旧名；若确需变更剧情设定，须同步更新台账并向作者说明。
- `PREVIOUS_ENDING_ECHO`：删去开篇对上一章结尾的重复回放，直接从新动作推进。
- `DEGENERATION_DETECTED`：清除模型退化硬伤（紧邻复读/长句复读、章末截断、乱码、AI 自指与拒绝语/省略占位符）。
- `ENGINEERING_META_LEAK`（Tier 1 阻塞项 / Tier 2 提示项）：清除“细纲/情节点/章尾钩子”及正文中“第X章/上一章/前文”等工程结构词，改为角色当下可感知的时间或事件锚点。
- `OUTLINE_COPY_DETECTED`（传入 `--outline-chapter` 时触发）：把大段照搬细纲文字的叙述打碎重铸为当下感官与动作对白，若属必须复现的原话/复沓锚句，在细纲内标注 `原样出现的原话：` 或 `复沓锚句：` 以合理豁免。

### 2. 语域、修辞、密度与水词问题（`warning` / `advisory` 优先清洗；高频触发 `blocking` 时必改）
- `REGISTER_COLLISION`：清除跨语域污染词（如古风里的现代网络词、超过八刻的时辰刻数，或现代文中的半文言酸词；本书《语体合同》另列的禁用词以项目层规则为准），替换为合同允许的干净表达。命中来自项目层（`layer: project`）时，说明这是本书口味，换书不一定成立。
- `NARRATIVE_FILLER`：按“晚进早出”原则直接整句删掉送客寒暄、说书人感叹与“免得……”式解释尾巴。
- `PRONOUN_HEAD_STREAK` / `OPENING_PATTERN_STREAK`：连续 3 段同一种起头（“他/她……”、先动作后补主语、整段无主语、主角名）时，换掉其中一两段的起头方式，比如用环境声响、对手的动作或直接用人名起笔。不要为了避开“他”把每段都改成无主语。
- `SUBJECT_AMBIGUITY`：上一句以别的角色开头，这一句省略了主语，读者会把动作算到那个角色头上。在这一句补上人名或“他/她”；`scope: next-paragraph` 的命中先读一遍上下文，确实不会读错可以不改。
- `FORBIDDEN_AI_CLICHE` / `MECHANICAL_SYMMETRIC_SKELETON` / `RHETORICAL_AI_PATTERN` / `EM_DASH_OVERUSE`：拆掉网文预制词与高频“不是A，而是B / 是A，不是B”、音量反差腔、否定排比和章尾 600 字预告/总结腔，改写为场景独有的物理细节与动作停顿。
- `PROSE_DENSITY_TIC`：逐处核对密度提示（动作清单、叙述短词引号强调、套式身体反应、`V了一下`微动作、论文推理链），**同时注意 `tic_overcompressed_prose` / `tic_low_connective_density` 反向守卫，严禁把文本脱水成无连接电报体**；确有叙事功能的作者特选表达，可按精准字面量登记到书目录 `.inkbone-whitelist` 或 `novel.json` 的 `whitelistLiterals`。
- `DIALOGUE_PUNCTUATION_ERROR`：修正居中提示语误用冒号、句末句号漏在引号外，以及同段内反复出现`动作。“台词。”`（`dialogue_period_before_quote`）的生硬切句——改为冒号引出，或将台词独立成段。
- `AIGC_WINDOW_RISK` / `CADENCE_TEMPLATE_MONOTONY` / `TELEGRAPHIC_MODIFIER_STUFFING`（开启 `--aigc-guard` 或运行 `aigc-check` 命中时）：只对命中的 280 字局部窗口做结构去同构与自然呼吸恢复，**严守以下三条“防越改越假”铁律**：
  1. **严禁强抠“的”字并用“这/那”硬替**：中文自然叙事每百字保留 `1.45～2.15` 个“的”最顺耳；若把“的”删到 `<1.1/百字`，同时冒出大量`这/那/那名`（`>1.3/百字`）或五字以上无虚词硬拼砖块（如`泛黄塑料壳老电视`），反而会触发更强的机器生成特征。遇到此类窗口，应拆开硬拼长定语、删掉多余的“这/那”，补回顺畅的口语助词。
  2. **严禁把对话全改成居中夹心段（`S`）**：改稿时切勿顺手把相邻几段都改成`“……”他做某事，“……”`；若出现连续 `S` 段或长串 `A`（`动作：“……”`）墙，将其中一两段拆为纯叙述段（`N`）加不带提示语的首引号短台词（`Q`），拉开段落节奏。
  3. **面板/鉴定与转场套话直接转入当面互动**：若窗口内同时存在旁白播报单据数字（`rhet_panel_dossier_recitation`）、免提播报腔、旁观呛汤嘀咕或“补了一觉烧壶热水”日常蒙太奇，删去旁白复述，改为角色当场接话算账或直接硬切下一幕冲突。

### 3. 初读者盲点、物理逻辑与精简手术（来自 Stage 3 举证审读）
- `cold_reader_scale_blind` / `cold_reader_stakes_blind`：在首次提及等级/数值/隐藏状态处，用 1～2 句具体人事对比补齐“差距有多大”和“暴露/失败有什么下场”，严禁塞入大段设定百科。
- `cold_reader_term_blind`：消除未出场机制带来的动词歧义，首次动用核心能力时用极简动作交代其触发代价与效果。
- `physics_geometry_contradiction` / `redundant_scene_beat` / `pov_boundary_breach`：修正作息时间线、道具常备位置、建筑常理与视距漏洞；剔除第三人称有限视角下的上帝旁白越界；删除同章或相邻章重复两次的同类施压与借口。
- `character_logic_suicide` / `tool_causality_mismatch`：若主角按常理“顺从就能活”却偏去冒险，补足“顺从也活不成”的先置铁证（出口被封、凶器已亮、下场摆在眼前），并交代这次动用能力能直接换来破局手段；开篇只用一次具体的使用或手感埋下能力，规则说明留到第一次动用时讲一次。
- `reader_micro_bloat` / `reader_dialogue_awkward` / `reader_exposition_drag`：删光无意义的道具连锁反应、七步动作流水账、舞台指示过桥词；将念起来别扭、解释过多或阴阳怪气的台词砍成最冷硬自然的短句；压缩开篇与高潮处的静态算账。
- `early_reveal` / `decision_logic`：把抢跑的结论挪到物证齐备之后，把“临时抱佛脚”的反人设动作修正为常态前置防备。

## 输出记录
每处修改列一行：`行号 | 原句片段 -> 修改后句子 | 对应的问题码`。
