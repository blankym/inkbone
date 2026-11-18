# Changelog

## Unreleased

### 修复与改进
- 修复 `dialogueSpan` 混淆直角引号专名（`「...」`/`『...』`）与说话对白的问题，避免打断 `SUBJECT_AMBIGUITY` 主语追踪或误重置 `EXPOSITION_DIALOGUE_DROUGHT`
- 修复 `doctor` 在中文分卷目录（第一卷/第二卷/第三卷）下按字典序乱序导致跨卷衔接回声漏检的问题，`collectTextFiles` 同步改用自然数字序
- 扩展 `ledgerBracketNote` 以捕获纯中文数字和长前缀的括号算式注记
- 修复 `normalizer` 剥离斜体时丢失 HTML 注释与书级白名单保护区间的漏洞
- 统一 `profiler` 的 Frontmatter/代码块/注释跳过逻辑、白名单星号保护以及 `CHAPTER_TERM_FATIGUE` 主角别名豁免；启用 `advisoryMinHits` 规则门槛配置
- 修正 README 命令数与测试数说明，补充 `check-outline` 适用范围提示并同步打包 Skill 目录

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
