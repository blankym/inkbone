# evals

`trigger-queries.json`：20 条真实用户语气的请求，10 条该触发 InkBone（`should_trigger: true`），10 条不该（写作相关但超出长篇连载范畴的近似场景，以及无关任务）。

## 怎么用

这份评测集不绑定任何运行时。测的是「你这个环境里的模型，看到 description 后会不会主动加载 skill」：

- **Claude Code**：可以直接用 [skill-creator](https://github.com/anthropics/skills/tree/main/skills/skill-creator) 的 `run_eval.py`，把 SKILL.md 路径和这份 JSON 喂给它。
- **其他 agent 运行时**（Codex、各类 CLI）：把每条 query 单独丢给目标环境，记录 skill 是否被加载或引用，再和 `should_trigger` 对比。每个运行时各存一份结果，别把不同环境的触发率混成一个数。
- **没有自动触发机制的环境**：跳过触发率，直接测 skill 加载后的产出质量（有/无 skill 对照）。

## 注意

- 触发率衡量的是「运行时的发现机制 + 模型判断 + description 写法」三者的合力，不是 skill 内容质量。改 description 时看它在哪个环境涨、哪个环境跌，别只看一个数。
- 每条 query 至少跑 3 次再下结论，单次触发或不触发都有随机性。
