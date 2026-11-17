# Contributing

InkBone 的规则分三层，改之前先想清楚你的规则属于哪一层：

| 层 | 位置 | 判据 |
| :--- | :--- | :--- |
| 通用层 | `configs/zh-linguistics.json`、`configs/genres.json` 的通用规则 | 换任何题材任何书都成立 |
| 题材层 | `configs/genres.json` 各题材包 | 这个题材的书普遍需要 |
| 项目层 | 书目录 `novel.json` 的 `projectRules` | 只对这一本书成立 |

**拿不准就先放项目层。** 一条规则想进通用层，需要证据：跑 `rule-stats --human <人类文本> --ai <AI稿>`，看它在人类作品里的误报率。人类作者也这么写的，是口味不是错误。

## 开发

```bash
npm test               # 38 项测试；其中一项回归需要作者的私有语料，没有会自动跳过
npm run build:skill    # 改了 bin/src/configs/prompts/resources 之后重新打包 skills/inkbone
npm run check:skill    # 提交前确认打包结果与源文件同步（CI 也查这项）
```

- `skills/inkbone/` 里除 SKILL.md 外都是生成物，不要直接改。
- 测试数据放进 `tests/fixtures.json`（中文样本），JS 测试文件里不写中文断言。
- 规则的正则写进 JSON 配置，正文扫描默认遮蔽成对引号内的台词（`scope: "narration"`）；需要看引号内容的规则用 `scope: "all"`。

## 不报人类作品的文本

`calibrate`、`rule-stats`、`mine` 需要人类作品语料做参照。本项目不分发任何人类文本，也不要在 issue / PR 里贴大段受版权保护的原文——贴命中片段和统计量就够了。
