# Changelog

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
