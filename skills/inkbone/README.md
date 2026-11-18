# InkBone（墨骨）

**写中文长篇小说的 Agent Skill + 零依赖本地质检 CLI。**

模型管写，InkBone 管查：第 3 章埋的设定第 40 章有没有吃书、仙侠文里有没有冒出网络热词、省略主语的动作会不会被安到别人头上。这些模型自己看不出来的错，交给确定性工具一条条过。

[![test](https://github.com/blankym/inkbone/actions/workflows/test.yml/badge.svg)](https://github.com/blankym/inkbone/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js ≥ 18](https://img.shields.io/badge/Node.js-%E2%89%A518-brightgreen.svg)](https://nodejs.org)
[![依赖: 0](https://img.shields.io/badge/%E4%BE%9D%E8%B5%96-0-orange.svg)](package.json)
[![版本: 1.1](https://img.shields.io/badge/%E7%89%88%E6%9C%AC-1.1-lightgrey.svg)](package.json)

[English](README.en.md) · 9 个题材包 · 19 条命令 · 20+ 项语体指纹指标 · 43 项测试

## 30 秒看到效果

一段故意写坏的开头（`ch01.md`）：

```markdown
子时三刻，药园的木门被人拍响。

陆青瞳孔骤缩，起身去开门。

门外站着执事孙岳，雨水落到他身上就散成白雾。孙岳没进门，把一块铁牌丢在桌上。

“寅时十刻之前，把渠里的符拔干净。”

孙岳转身靠在门柱上，合上了眼。从袖子里摸出一把小刀，挑开了渠边的泥。
```

再给一份人物名单 `ledger.json`（主语检查要知道书里都有谁）：

```json
{ "characterNames": ["陆青", "孙岳"] }
```

```bash
node bin/inkbone.mjs audit ch01.md --genre classical-xianxia --ledger ledger.json --skip-length
```

| 行 | 规则 | 命中 | 为什么 |
| ---: | :--- | :--- | :--- |
| 3 | `FORBIDDEN_AI_CLICHE` | 瞳孔骤缩 | 放进哪本书都成立的现成说法 |
| 7 | `REGISTER_COLLISION` | 寅时十刻 | 一个时辰最多八刻 |
| 9 | `SUBJECT_AMBIGUITY` | 从袖子里摸出一把小刀…… | 上一句以孙岳开头，这句没写主语，读者会以为摸刀的是孙岳 |

第三条不是关键词匹配能做到的：它要知道"上一句的动作者是谁"，再把缺主语的句子接回去读一遍。这类检查模型自己做不到：它写完就忘了上一句的语法角色，InkBone 替它记住。

## 和"只有提示词"的写作 Skill 有什么不同

市面上的写小说 skill 大多是一大段提示词：告诉模型"别写套话""注意前后一致"。问题在于，模型既不擅长自查，也没有持久的记忆。写到第 40 章，第 3 章的约定早不在上下文里了。

InkBone 把约束分成两半：

- **写之前**，提示词先立合同：语体怎么定、信息放哪、节拍怎么排，写之前先给作者过目；
- **写之后**，本地 CLI 做确定性检查：正则、词典、台账比对、统计指纹，不消耗 token，结果可复现，同样输入永远同样输出；
- **审读环节**，要求每个问题必须引用原文，引文在正文里找不到的直接拒收（`verify-review`）；
- **改完以后**，用 `rule-stats` 看每条规则在人类作品里的误报率，用盲读包请真人选，不靠感觉判断"是不是改好了"。

## 安装

需要 Node.js 18+，**零第三方依赖**，克隆下来就能用。

**只用 CLI（最简）：**

```bash
git clone https://github.com/blankym/inkbone.git
cd inkbone
node bin/inkbone.mjs --help
```

**作为 Agent Skill：** 把 `skills/inkbone/` 整个目录复制到你所用 Agent 的 skills 目录（自包含，SKILL.md 旁边带着 CLI、配置、提示词和知识库）。SKILL.md 里的路径写成 `$SKILL_DIR/...`，指 SKILL.md 所在目录；平台不允许执行命令时，只用提示词部分。

```bash
cp -R skills/inkbone <你的 skills 目录>/inkbone
```

## 工作流：写一章要走哪几步

`prompts/` 里是 7 个阶段提示词，CLI 在各阶段之间做检查：

1. **定语体**（`00`）：读大纲，生成本书的语体合同和 `novel.json`；
2. **排节拍**（`01`）：每条信息只安排一个位置，开场冲突前不堆背景，排完先停，等作者确认再动笔；
3. **写正文**（`02`）；
4. **本地检查**：`audit` 查单章，`doctor` 递归查整个目录；
5. **审读**：逻辑审读（`04`）+ 零背景读者模拟（`05`），各出一份 JSON，`verify-review` 核对引文，`review-save` 存档；
6. **局部修改**（`03`），改完回到第 4 步；
7. （可选）定稿后 `detect` 跑一次朱雀检测，只做记录。

已写到一半的书：`import-ledger` 扫描章节自动建台账 → `doctor` 整本体检 → 从第 5 步进入流程。

## 它查什么

| 类别 | 例子 |
| :--- | :--- |
| 台账连续性 | 锚点物件没交代就使用、真相提前剧透、本章重复上一章结尾 |
| 题材语域 | 古代背景出现"拉胯/赋能"、修真文出现伪历法、科幻里冒武侠词 |
| 套话与句式 | "瞳孔骤缩""命运的齿轮"、对称骨架连用、同一段连续同一开头 |
| 修辞密度 | 单章内比喻/解释链/微动作/感叹号超过阈值才告警，不误伤正常写作 |
| 模型退化 | 复读打转、无标点截断、"作为AI"元信息泄漏、"第X章"等工程词混进正文 |
| 主语连续性 | 省略主语后动作被安错人（见上面的例子） |
| 格式与字数 | Markdown 残留、声明字数与实际不符 |
| 统计指纹 | 词汇熵、句长变异、'的'字链等 20+ 项指标，对照人类作品参考区间 |

warning 只提示不阻塞；error（格式残留、台账违规、退化、字数造假）才返回非零退出码，可以直接接 CI。

## 规则分三层，不会拿别人的口味管你

| 层 | 位置 | 管什么 |
| :--- | :--- | :--- |
| 通用层 | `configs/` | 换题材也成立的套话、水话、句式 |
| 题材层 | `configs/genres.json` 9 个题材包 | 题材共有的串味问题（古言出现网络词等） |
| 项目层 | 书目录里的 `novel.json` | **只属于这本书**的声口合同和禁用词，可用 `disabledRuleIds` 关掉上层规则 |

加规则之前先问：换一本书它还成立吗？再跑 `rule-stats` 看它在人类作品里的误报率。人类作者也这么写的，是个人口味，只能放项目层，引擎不替你定风格。

## 为什么不拿 AI 检测分当目标

这是用一整章十几版改稿换来的教训。早期版本把朱雀 AIGC 分当目标，实测：

- 每句都把名词写全、一个结论讲三遍的稿子：**朱雀判 100% 人工**，作者读着啰嗦；
- 删掉重复、读着顺了的稿子：朱雀判 80.95% 疑似 AI；
- 相邻两稿只改约 2% 的字，分数从 0.37 跳到 0.55。

检测分说明不了好不好看，追它改稿量到的主要是噪声。所以 InkBone 先管剧情和读者，统计指标只作诊断，检测在定稿后最多测一次做记录，改动有没有用最后由真人盲读决定。原始记录见 `benchmarks/shoushi-wenxian/manifest.json`。

## 命令一览

| 命令 | 做什么 |
| :--- | :--- |
| `genres` | 列出 9 个题材包（仙侠/历史/悬疑/都市/科幻/言情/轻小说/武侠/通用） |
| `init` | 新建小说项目 |
| `import-ledger` | 扫描已有章节，自动生成/合并台账 |
| `packet` | 给下一章装配上下文，没到时候的真相自动隐去 |
| `normalize` | 清理星号、分隔线、不规范省略号（零 token） |
| `check-outline` | 查单章节拍细纲（Stage 1）的占位符和要素缺失 |
| `audit` | 查单章 |
| `doctor` | 递归查整个目录，自动识别题材和项目配置 |
| `verify-review` | 核对审读 JSON 的引文是否真在正文里 |
| `review-save` / `review-stats` | 审读存档（带正文哈希和模型名）与统计 |
| `eval-pack` / `eval-score` | 生成盲读 A/B 包、统计真人选票（含符号检验 p 值） |
| `profile` | 输出一章的 20+ 项语体指纹 |
| `rule-stats` | 每条规则在人类 vs AI 文本里的每万字命中率 |
| `mine` | 挖 AI 稿相对人类作品过度使用的搭配 |
| `calibrate` | 从人类作品算统计参考区间 |
| `detect` | 单次朱雀检测（需自带 API key），只记录 |
| `benchmark` | 基准语料对比 |

完整参数：`node bin/inkbone.mjs --help`。规则详情和正反例见 `resources/`。

## 怎么验证它真的有用

`benchmarks/eval-set/` 带 4 个原创开篇种子（仙侠/悬疑/都市/言情）和完整评估流程：同一模型、新旧两版 skill 各写一遍 → `eval-pack` 生成隐去版本号的盲读包 → 发给真人读者 → `eval-score` 统票。比模型时反过来，固定 skill 换模型。

## 已知不足（说在前面）

- 规则和正反例主要来自作者自己写的一本仙侠，其余 8 个题材包规则偏少，没在大规模人类语料上量过误报，这正是项目层存在的理由；
- 部分通用规则可能只是口味（如"心头一沉"算水话），需要更多人类文本验证；
- 主语歧义检查依赖人物名单，称谓/代词指人的段落会漏报；
- 盲读工具齐备，还没跑过一轮完整真人评估；
- 不分发任何人类作品文本，`calibrate`/`rule-stats`/`mine` 的语料需自备并确认有权使用。

## 目录结构

```
bin/  src/         CLI 与核心实现（纯 Node，零依赖）
configs/           三层规则、9 个题材包、分级与阈值
prompts/           7 个阶段提示词（00–06）
resources/         正反例、微技法、9 份题材手册、盲读说明
benchmarks/        评估种子 + 第一章各版本检测记录（正文不公开）
skills/inkbone/    打包好的 Skill（脚本生成，勿手改）
tests/             43 项测试
```

## 开发

```bash
npm test               # 43 项测试（含 skill 同步检查；一项回归需私有语料，公开仓库自动跳过）
npm run build:skill    # 改了 bin/src/configs/prompts/resources 后重新打包
npm run check:skill    # 只检查同步状态
```

## 致谢

- 上下章边界与"审稿必须引原文"参考 [EthanYoQ/Pagekin](https://github.com/EthanYoQ/Pagekin)；
- 中文主干与对称句式处理参考 [LifelongLazyLearner/qu-ai-wei](https://github.com/LifelongLazyLearner/qu-ai-wei)；
- 修辞密度分级、退化与工程词泄漏检查参考 [zenstory-ai/oh-story-claudecode](https://github.com/zenstory-ai/oh-story-claudecode)。

## 许可

MIT。规则文件也是 MIT，欢迎抄走去改你自己的题材包。
