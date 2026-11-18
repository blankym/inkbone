# InkBone（墨骨）

**An Agent Skill + zero-dependency local QA CLI for writing Chinese long-form fiction.**

The model writes; InkBone checks. Does chapter 40 still honor a rule established in chapter 3? Did a xianxia chapter slip in modern internet slang? When a sentence drops its subject, whose action does the reader see? These are the mistakes a model can't catch in its own output. InkBone runs them through deterministic tools, line by line.

[![test](https://github.com/blankym/inkbone/actions/workflows/test.yml/badge.svg)](https://github.com/blankym/inkbone/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js ≥ 18](https://img.shields.io/badge/Node.js-%E2%89%A518-brightgreen.svg)](https://nodejs.org)
[![Dependencies: 0](https://img.shields.io/badge/dependencies-0-orange.svg)](package.json)
[![Version: 1.1](https://img.shields.io/badge/version-1.1-lightgrey.svg)](package.json)

[中文](README.md) · 9 genre packs · 19 commands · 20+ style-fingerprint metrics · 43 tests

> **Note:** The rule packs, prompts, and CLI output are in Chinese: the tool exists to write and revise Chinese novels. This README explains the architecture and workflow; you'll want Chinese reading ability (or an agent that has it) to use it.

## See it work in 30 seconds

A deliberately broken opening (`ch01.md`, abridged):

```markdown
子时三刻，药园的木门被人拍响。

陆青瞳孔骤缩，起身去开门。
…
“寅时十刻之前，把渠里的符拔干净。”

孙岳转身靠在门柱上，合上了眼。从袖子里摸出一把小刀，挑开了渠边的泥。
```

Plus a character roster `ledger.json` (subject checks need to know who's in the book):

```json
{ "characterNames": ["陆青", "孙岳"] }
```

```bash
node bin/inkbone.mjs audit ch01.md --genre classical-xianxia --ledger ledger.json --skip-length
```

| line | rule | hit | why |
| ---: | :--- | :--- | :--- |
| 3 | `FORBIDDEN_AI_CLICHE` | 瞳孔骤缩 ("pupils contracted") | a stock phrase that fits every novel ever written |
| 7 | `REGISTER_COLLISION` | 寅时十刻 ("the tenth quarter of yin") | a traditional Chinese hour has at most eight quarters |
| 9 | `SUBJECT_AMBIGUITY` | 从袖子里摸出一把小刀… | the previous sentence opened with Sun Yue; this one has no subject; readers will assume *he* pulled the knife |

That third check isn't keyword matching: it tracks the previous sentence's actor, then re-reads the subject-less sentence in that light. A model can't do this for itself. It forgets the last sentence's grammatical role as soon as it's written. InkBone remembers for it.

## How it differs from prompt-only writing skills

Most fiction-writing skills are one big prompt: "avoid clichés, stay consistent." The problem is that models are bad at self-review and have no persistent memory. By chapter 40, the chapter-3 contract has fallen out of context.

InkBone splits the work:

- **Before writing**, staged prompts establish contracts: register, information placement, beat layout, shown to the author for approval first;
- **After writing**, a local CLI runs deterministic checks: regex, dictionaries, ledger diffing, statistical fingerprints. Zero tokens, reproducible, same input → same output;
- **During review**, every flagged issue must quote the source text verbatim; reviews whose quotes can't be found are rejected (`verify-review`);
- **After revising**, `rule-stats` measures each rule's false-positive rate against human-written text, and blind A/B packets let real readers pick the winner, not vibes.

## Install

Node.js 18+, **zero third-party dependencies**.

**CLI only (simplest):**

```bash
git clone https://github.com/blankym/inkbone.git
cd inkbone
node bin/inkbone.mjs --help
```

**As an Agent Skill:** copy `skills/inkbone/` into your agent's skills directory (self-contained: SKILL.md ships with the CLI, configs, prompts, and knowledge base). Paths in SKILL.md are written as `$SKILL_DIR/...`. If your platform can't execute commands, the prompt stages still work standalone.

```bash
cp -R skills/inkbone <your skills dir>/inkbone
```

## Workflow

Seven staged prompts in `prompts/`, with the CLI checking between stages:

1. **Register contract** (`00`): read the outline, produce the book's style contract and `novel.json`;
2. **Beat plan** (`01`): each piece of information gets exactly one slot; no exposition dump before the opening conflict; stops for author sign-off;
3. **Draft** (`02`);
4. **Local checks**: `audit` per chapter, `doctor` recursively over a directory;
5. **Reviews**: logic review (`04`) + cold-reader simulation (`05`), both emitting JSON; `verify-review` validates quotes, `review-save` archives;
6. **Targeted rewrite** (`03`), back to step 4;
7. *(Optional)* `detect` — one Zhuque AIGC scan after freeze (record-only).

For a book already in progress: `import-ledger` scans chapters to build the ledger → `doctor` for a full checkup → enter at step 5.

## What it checks

| category | examples |
| :--- | :--- |
| ledger continuity | required anchors missing, foreshadowing revealed early, chapter re-opening the previous ending |
| genre register | modern internet slang in a historical setting, fake traditional calendars, wuxia terms in sci-fi |
| clichés & syntax | "pupils contracted"-tier stock phrases, repeated symmetric skeletons, same paragraph opening three times |
| rhetorical density | similes, reasoning chains, micro-actions, exclamation marks — fires only past the per-chapter threshold |
| model degeneration | repetition loops, truncated endings, "as an AI" leakage, engineering terms ("chapter 6 outline") in prose |
| subject continuity | subject-dropped sentences whose action lands on the wrong character |
| format & word count | Markdown residue, claimed-vs-actual length mismatch |
| statistical fingerprint | lexical entropy, sentence-length variance, 的-chain density: 20+ metrics vs. human reference ranges |

Warnings inform; errors (format residue, ledger violations, degeneration, word-count fraud) exit non-zero — CI-ready.

## Three rule layers — your taste stays yours

| layer | location | scope |
| :--- | :--- | :--- |
| universal | `configs/` | clichés and filler that fail across genres |
| genre | `configs/genres.json` — 9 packs | register collisions a genre shares |
| project | `novel.json` in your book directory | this book's voice contract and banned phrases; `disabledRuleIds` can switch off inherited rules |

Before adding a rule, ask: does it still hold for a different book? Then run `rule-stats` against human text. What human authors also write is taste, not error — project layer only.

## Why AIGC detector scores aren't the target

A lesson bought with a dozen revisions of one chapter. Early versions chased the Zhuque score; measured results:

- A draft that spelled out every noun and repeated each conclusion three times: **judged 100% human** — and unreadable;
- The same chapter with redundancy cut: 80.95% "likely AI";
- Two adjacent drafts differing by ~2% of characters: score jumped 0.37 → 0.55.

The score doesn't measure readability; chasing it mostly measures noise. So InkBone manages plot and reader experience, treats statistics as diagnostics only, runs detection at most once post-freeze, and lets real blind readers decide whether a change helped. Raw log: `benchmarks/shoushi-wenxian/manifest.json`.

## Commands

| command | what it does |
| :--- | :--- |
| `genres` | list the 9 genre packs |
| `init` | scaffold a novel project |
| `import-ledger` | scan existing chapters, build/merge a ledger |
| `packet` | assemble next-chapter context; un-revealed truths stay hidden |
| `normalize` | strip asterisks, separators, malformed ellipses (zero tokens) |
| `check-outline` | Stage 1 chapter beat-outline placeholders & missing beats |
| `audit` | check one chapter |
| `doctor` | recursive directory checkup, auto-detects genre & project config |
| `verify-review` | validate review quotes against the text |
| `review-save` / `review-stats` | archive reviews (chapter hash + model name) & stats |
| `eval-pack` / `eval-score` | blind A/B packets & ballot tally (with sign-test p) |
| `profile` | 20+ style-fingerprint metrics for a chapter |
| `rule-stats` | per-rule hit rates in human vs AI text |
| `mine` | find collocations AI drafts overuse vs human prose |
| `calibrate` | build human reference ranges |
| `detect` | single Zhuque scan (bring your own API key), record-only |
| `benchmark` | corpus comparison |

Full flags: `node bin/inkbone.mjs --help`.

## Evaluation

`benchmarks/eval-set/` ships 4 original opening seeds (xianxia / mystery / urban / romance) and the full protocol: same model, two skill versions → `eval-pack` produces anonymized packets → human readers vote → `eval-score` tallies. To compare models, fix the skill version and swap models.

## Known limits

- Most rules and examples come from the author's own xianxia novel; the other 8 genre packs are thin and uncalibrated on large human corpora — which is exactly why the project layer exists;
- Some universal rules may be taste (e.g., counting "heart sank" as filler) pending more human-text validation;
- Subject-continuity needs a character roster and misses pronoun/honorific references;
- Blind-read tooling exists; a full human evaluation round hasn't been run yet;
- No human-authored text is distributed — bring your own corpus (and rights) for `calibrate`/`rule-stats`/`mine`.

## Development

```bash
npm test               # 43 tests (one regression needs a private corpus; auto-skips in the public repo)
npm run build:skill    # repackage skills/inkbone after touching bin/src/configs/prompts/resources
npm run check:skill    # sync check only
```

## Acknowledgments

- Chapter-boundary handling and "reviews must quote the text": [EthanYoQ/Pagekin](https://github.com/EthanYoQ/Pagekin);
- Chinese sentence-trunk and symmetric-construction handling: [LifelongLazyLearner/qu-ai-wei](https://github.com/LifelongLazyLearner/qu-ai-wei);
- Rhetorical-density grading, degeneration & engineering-term leakage checks: [zenstory-ai/oh-story-claudecode](https://github.com/zenstory-ai/oh-story-claudecode).

## License

MIT — the rule files too. Fork them and build your own genre pack.
