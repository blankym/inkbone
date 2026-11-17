# 评估集：怎么判断新版 skill 是不是真的写得更好

审计 0 告警不等于写得好。比较两个版本的 skill，最终要看真人读者更愿意读哪一版。这里给出一套固定的做法。

## 1. 生成两组稿子

`seeds.json` 里有几种题材的原创开篇种子。用旧版 skill 和新版 skill 各写一遍第 1 章，文件名带上种子序号，方便配对：

```
runs/old/01-xianxia-herb-ditch.md
runs/old/02-mystery-harbor-coroner.md
runs/new/01-xianxia-herb-ditch.md
runs/new/02-mystery-harbor-coroner.md
```

两组用同一个模型、同样的温度，只换 skill 版本。反过来，想知道 skill 在不同模型上的效果，就固定 skill 版本，只换模型。一次只改一个变量，否则分不清差异来自哪里。

## 2. 机器检查（只作参考）

```bash
node ./bin/inkbone.mjs doctor runs/old --json > runs/old-doctor.json
node ./bin/inkbone.mjs doctor runs/new --json > runs/new-doctor.json
```

再对每篇跑逻辑审读（`prompts/04`）和读者模拟（`prompts/05`），用 `review-save` 存档（`--model` 记做审读的模型，`--writer-model` 记写这一章的模型），最后用 `review-stats` 比较两组的跳读点和问题条数。两组的审读最好用同一个模型来做，否则条数差异可能来自审读模型。

## 3. 生成盲读包，请真人读

```bash
node ./bin/inkbone.mjs eval-pack --a runs/old --b runs/new --label-a v1.0 --label-b v1.1 \
  --model-a <生成旧版用的模型> --model-b <生成新版用的模型> --out runs/blind --seed 20261117
```

- `runs/blind/packet/` 发给读者：每组只有 X、Y 两篇正文、一份说明和一份 `ballot.json` 选票，看不出哪篇是哪个版本。
- `runs/blind/key.json` 留在自己手里，记录 X/Y 对应的版本、生成模型和原文哈希。

## 4. 统计结果

```bash
node ./bin/inkbone.mjs eval-score --key runs/blind/key.json ballots/*.json
```

输出两个版本各赢了几组、平局几组、符号检验 p 值，以及每个版本被标了多少处跳读。跳读引文会和原文核对，抄错的单独列出。

## 怎么看结果

- 只有盲读胜出的改动才算改进。读者少于 5 人、或者 p 值大于 0.1 时，结论只能算倾向。
- 某个改动只让审计告警或检测分下降，盲读却没赢，要先怀疑它是不是在凑指标。
- 外部 AI 检测分可以附在报告里当参考，每篇只测一次，不按分数改稿。
