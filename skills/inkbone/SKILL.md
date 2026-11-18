---
name: inkbone
description: 写中文长篇小说时使用：开新书、写新章节、续写连载，或者检查和修改已有书稿（去 AI 味、查前后矛盾、提高可读性）。包含规划、写作、审读、修改各阶段的提示词，以及一个检查台账、题材用词、套话和主语歧义的本地命令行工具（需要 Node.js 18+）。
---

# InkBone（墨骨）1.1

用来写中文分章小说：开新书、写新章、续写，或者检查和修改已有书稿。每本书自己的设定、台账、语体合同和专属规则都放在小说的项目目录里，这个 skill 本身不带任何一本书的口味。

## 运行环境与路径

- **路径约定**：本文件所在的目录记作 `SKILL_DIR`。下文所有 `$SKILL_DIR/...` 路径都相对这个目录，不相对小说项目目录。执行命令前先设置一次，例如 `SKILL_DIR=/path/to/skills/inkbone`。
- **运行要求**：命令行工具需要 Node.js 18 或更高版本，没有第三方依赖，不需要 `npm install`。检查方法：`node --version`。
- **不能执行命令时**：只用提示词部分（`$SKILL_DIR/prompts/` 与 `$SKILL_DIR/resources/`），规划、写作、审读照常进行。格式与台账检查、引文核对、规则统计、盲读计分这些代码检查都做不了，交付时要说明这一点，不要假装已经检查过。
- **按阶段按需读取**：一次只读当前环节所需的 1 份阶段提示词和 1 份对应题材的 `genre_playbooks/<genre>.md`，不要一开头就把 `00`～`06` 和所有参考文档一次性全部读进上下文，避免冗余耗时与注意力稀释。
- **项目文件**：小说自己的 `novel.json`、`ledger.json`、语体合同和项目层规则放在小说项目目录里，不放进 `SKILL_DIR`。

## 文件索引

- 命令行工具：`node "$SKILL_DIR/bin/inkbone.mjs"`（用 `npm install -g` 全局安装后可以直接用 `inkbone`）。`--help` 列出全部命令。
- 内置题材包：`$SKILL_DIR/configs/genres.json`，运行 `node "$SKILL_DIR/bin/inkbone.mjs" genres` 查看。
- 各阶段提示词：
  - 定语体：`$SKILL_DIR/prompts/00-style-architect.md`
  - 排节拍：`$SKILL_DIR/prompts/01-beat-planner.md`
  - 写正文：`$SKILL_DIR/prompts/02-paratactic-renderer.md`
  - 局部修改：`$SKILL_DIR/prompts/03-targeted-rewriter.md`
  - 逻辑审读：`$SKILL_DIR/prompts/04-evidence-reviewer.md`
  - 读者模拟（零背景新读者和老读者两种视角）：`$SKILL_DIR/prompts/05-reader-simulator.md`
  - 给已有书稿建台账：`$SKILL_DIR/prompts/06-ledger-importer.md`
- 参考资料（用到时再读，不必一开始全读）：
  - `$SKILL_DIR/resources/bad_vs_good_cases.md`：改稿前后的句子对照
  - `$SKILL_DIR/resources/micro_techniques.md`：制造压迫感、开场写法、对话潜台词，以及常见问题速查
  - `$SKILL_DIR/resources/genre_playbooks/<genre>.md`：9 个题材各自的常见问题和人物说话方式

## 规则分三层

| 层 | 放什么 | 位置 |
| :--- | :--- | :--- |
| 通用层 | 换了题材也成立的套话、水话、对称句式、对话标点问题 | `$SKILL_DIR/configs/zh-linguistics.json`，以及 `genres.json` 里的 `universalFillerRules` |
| 题材层 | 某个题材共有的用词问题，比如古代背景里出现现代网络词 | `genres.json` 各题材包的 `registerRules` / `clicheRules` / `fillerRules` |
| 项目层 | 只属于这本书的语体要求和专属禁用词 | 小说目录 `novel.json` 里的 `projectRules`，或它用 `rulesFile` 指向的规则文件 |

- `audit` 和 `doctor` 会从章节所在目录往上找 `novel.json`，使用其中的 `genre`、`preset`、`ledgerFile` 和项目层规则。`--project <目录或文件>` 显式指定，`--no-project` 不用项目配置，`--no-ledger` 不读台账。`doctor` 会递归扫描分卷子目录，跳过隐藏目录和下划线开头的目录（比如 `_原稿备份`、`_reviews`）。
- **引号内外**：修辞和句式类规则默认只查引号外的叙述（`scope: "narration"`），用词和寒暄类规则连对白一起查（`scope: "all"`）。书里有意保留的写法，可以登记到小说目录的 `.inkbone-whitelist`，或 `novel.json` 的 `whitelistFile` / `whitelistLiterals`。
- **提示和必改**：规则可以设密度门槛（`minHits`、`perKilo`）。偶发的问题报 warning（`advisory`）；模型退化、工程用语泄漏，以及同一种句式反复出现到阈值以上，会升级成 error（`blocking`）。还有一条反向检查，防止把文字删成没有连接词的电报体。
- 项目层可以用 `disabledRuleIds` 关掉上层的某条规则。每条命中都带 `layer`（`universal` / `genre` / `project`）、`level`（`blocking` / `advisory`）和 `review`（`mechanical` / `semantic`）字段。
- **新规则放哪一层**：换一本同题材的书还成立吗？不成立就放项目层。换一个题材还成立吗？不成立就放题材层。都成立才放通用层。改某一章时发现的具体句子，默认放项目层。
- **新规则先量误报**：用 `rule-stats` 看这条规则在人类作品里每万字命中几次。在人类作品里也常见（判为 `taste`）的规则，管的是个人口味，只能放项目层。

## 先规划，等确认，再动笔

1. 定完语体、建完台账，或者排完节拍表以后，先停下来，等作者确认，再写正文。规划没定下来，不要直接写出整章。
2. 作者只要求检查或审读时，只跑 `doctor` / `audit` 和审读，列出问题清单，等作者确认要改哪些，再动手改。

## 轻量快改（不建台账、单段或单章救急）

当作者只丢来一段话或单独一章，明确要求“去一下 AI 味”“改干瘪对话”“顺一下标点”且目录尚未建立 `novel.json` 时，**不要强迫作者先 `init` 和建全书大纲**，直接走快改通道：

1. 直接对当前文件跑零配置清理检查与单章审计：
   ```bash
   node "$SKILL_DIR/bin/inkbone.mjs" normalize <chapter.md> --check --strip-bold
   node "$SKILL_DIR/bin/inkbone.mjs" audit <chapter.md> [--genre <id>] --no-project --no-ledger --skip-length
   ```
   （不传 `--genre` 时可先对照 `genres` 选最贴近题材，或用 `general-clean`。）
2. 只读 `$SKILL_DIR/prompts/03-targeted-rewriter.md`，对照报告行号局部砍水话、换套词、校对主语和对话标点，不动原本通顺的段落。
3. 改完复跑一遍 `audit` 确认 `error` 为 0、主要警告清干净即可交付；只有作者进一步想连载扩展或接管整本书时，再补 `init` 或 `import-ledger`。

## 写新书或新章节

1. **定语体**（`00-style-architect.md`）：读作者的创意或总纲，根据时代背景、主角出身和职业、世界的权力规则选定题材包，生成项目目录里的 `novel.json`、`ledger.json` 和本书的语体合同。骨架可以用 `node "$SKILL_DIR/bin/inkbone.mjs" init <dir> --genre <id> --title <书名>` 生成。
2. **排节拍**（`01-beat-planner.md`，写完停下等确认）：
   - 先运行 `node "$SKILL_DIR/bin/inkbone.mjs" packet --ledger <ledger.json> --chapter <N> [--prev <上一章.md>]`，得到写这一章用的上下文。台账 `knowledgeLedger` 里还没到 `revealChapter` 的真相（`fullTruth`）会被隐去。
   - 按 `01-beat-planner.md` 输出信息分配表和分幕节拍表，需要时参考 `$SKILL_DIR/resources/micro_techniques.md` 和对应题材的手册。等级、数值、能力第一次出现时，要在它第一次影响局势的地方交代差距有多大、暴露了会怎样。人物发火、催促、动手之前，要先有让他这样做的原因。对话标出从哪里切入、在哪里收住。节拍表里不要写成段的正文。
3. **写正文**（`02-paratactic-renderer.md`）：守住本书的语域，从上一章结尾的状态直接往下写，不照抄细纲原句，核对人数、件数、时间先后，不写寒暄水话。不要连续 3 段用同一种方式起头；省略主语之前，确认上一句的主语是同一个人。
4. **检查和审读**：按下面的“定稿前的检查”执行。

## 检查和修改已有书稿

作者拿来已经写好的单章或整本书，要求建台账、检查、润色、去 AI 味或提高可读性时：

0. **还没有台账时先建台账**：
   ```bash
   node "$SKILL_DIR/bin/inkbone.mjs" import-ledger <章节目录> [--merge <已有ledger.json>] --out <目标ledger.json>
   ```
   工具会识别中文和阿拉伯数字的章号、统计每章字数，合并已有的 `chapters[]` 和高频专有名词，不会覆盖原有内容。然后按 `06-ledger-importer.md` 补全每章摘要、`knowledgeLedger`、`characterSnapshots` 和 `foreshadowing`。原文里找不到依据的一律填 `[待补充]`。
1. **整本检查**：
   ```bash
   node "$SKILL_DIR/bin/inkbone.mjs" doctor <章节或目录> [--outline <大纲目录>] [--ledger <ledger.json>]
   ```
   工具会根据大纲和正文自动识别题材（也可以用 `--genre <id>` 指定），一次报出四类问题：格式和台账错误；不属于本书语域的用词（比如古风里的现代网络词、超过八刻的时辰，或现代文里的半文言词，本书专属的禁用词由项目层规则给出）；寒暄、解释尾巴、说书腔这类水话；连续同一种起头、主语歧义和套话集中的段落。
2. **审读**：按 `04-evidence-reviewer.md` 做逻辑审读，按 `05-reader-simulator.md` 分别以零背景新读者和老读者的视角做读者模拟，各输出一份 JSON，用 `verify-review` 核对引文。重点找作者以为读者知道、新读者其实看不懂的设定、等级差距和人物动机。
3. **局部修改**：对照检查结果的行号和审读清单，按 `03-targeted-rewriter.md` 修改：换掉不合语域的词、删掉水话、补上逻辑漏洞。如果改动涉及时间或设定，要同时检查前后相邻的章节能不能接上。

## 定稿前的检查

0. **清理格式（可选）**：
   ```bash
   node "$SKILL_DIR/bin/inkbone.mjs" normalize <章节或目录> [--check] [--strip-bold]
   node "$SKILL_DIR/bin/inkbone.mjs" check-outline <细纲文件或目录>
   ```
   `normalize --strip-bold` 会去掉误留的 Markdown 加粗星号和 `---` 分隔线，白名单里的内容和行内代码不动。`check-outline` 在动笔前检查单章 Stage 1 节拍细纲是否缺少关键要素，或者还留着 `[待补充]`。
1. **本地检查**：
   ```bash
   node "$SKILL_DIR/bin/inkbone.mjs" audit <chapter.md> --genre <genreId> [--ledger <ledger.json> --chapter <N> --prev <上一章.md>] [--outline-chapter <细纲.md>]
   ```
   - `error` 必须是 0，包括 `FORMATTING_OR_LEDGER_ARTIFACTS`、`CHAR_COUNT_CLAIM_MISMATCH` 和模型退化。
   - `REGISTER_COLLISION`、`NARRATIVE_FILLER`、`PRONOUN_HEAD_STREAK`、`OPENING_PATTERN_STREAK`、`SUBJECT_AMBIGUITY`、`FORBIDDEN_AI_CLICHE`、`OUTLINE_COPY_DETECTED` 逐条看，确实有问题就改，没问题说明理由。
   - 审计 0 告警只说明没有规则能抓到的问题。同一个信息讲了两遍、开场前背景交代太长、人物动机不顺，只能靠第 2 步的审读发现。
2. **审读、核对和存档**：逻辑审读（04）和读者模拟（05）的 JSON 先核对引文，再存档：
   ```bash
   node "$SKILL_DIR/bin/inkbone.mjs" verify-review <chapter.md> <review.json>
   node "$SKILL_DIR/bin/inkbone.mjs" review-save <chapter.md> <review.json> --kind <logic|reader> --model <做审读的模型> --writer-model <写这一章的模型>
   node "$SKILL_DIR/bin/inkbone.mjs" review-stats <章节目录>/_reviews
   ```
   存档时会记下正文哈希和模型名。改稿以后重新审读，用 `review-stats` 看跳读点和问题条数是不是真的少了。两次审读用的模型不同时，统计里会标出 `reviewer model changed`，这时条数的变化可能只是换了模型造成的。
3. **AI 检测（可选，放在最后）**：
   - 本地检查和审读都没问题之前，不调用外部检测。
   - 定稿后每章最多测一次：`node "$SKILL_DIR/bin/inkbone.mjs" detect <chapter.md>`，结果只做记录。
   - 不按检测分改稿，也不对单个窗口反复复测：改几十个字，分数就可能差 0.1 以上，反复测量到的主要是噪声。标黄的段落可以当作提示，用读者的眼光再读一遍，确实有问题再为读者改。

## 维护 skill：怎么判断改动有没有用

1. **规则误报**：`node "$SKILL_DIR/bin/inkbone.mjs" rule-stats --human <人类作品目录> --ai <AI稿目录> [--genre <id>]`。人类样本不到 2 万字时，结果会标为不可靠。
2. **版本盲读**：用 `$SKILL_DIR/benchmarks/eval-set/seeds.json` 里的种子，新旧两版 skill 各写一遍，然后：
   ```bash
   node "$SKILL_DIR/bin/inkbone.mjs" eval-pack --a runs/old --b runs/new --label-a <旧版> --label-b <新版> --model-a <模型> --model-b <模型> --out runs/blind
   node "$SKILL_DIR/bin/inkbone.mjs" eval-score --key runs/blind/key.json <ballot.json>...
   ```
   `packet/` 发给真人读者，`key.json` 自己留着。只有盲读赢了的改动才算改进；只让告警数或检测分下降的改动，要先怀疑是不是在凑指标。完整流程见 `$SKILL_DIR/benchmarks/eval-set/README.md`。
3. **按模型比较**：同一套 skill 在不同模型上效果不同。比较 skill 版本时固定模型，比较模型时固定 skill 版本，两边的模型名和版本都要记下来（`eval-pack` 的 `--model-a` / `--model-b`，`review-save` 的 `--model` / `--writer-model`，以及基准 manifest 的 `generation` 字段）。模型升级以后，重跑一遍评估集。
