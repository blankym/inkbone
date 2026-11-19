# InkBone

**A persistent ledger, style contract, and zero-dependency local QA CLI for writing Chinese long-form fiction with LLMs.**

[![test](https://github.com/blankym/inkbone/actions/workflows/test.yml/badge.svg)](https://github.com/blankym/inkbone/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js ≥ 18](https://img.shields.io/badge/Node.js-%E2%89%A518-brightgreen.svg)](https://nodejs.org)
[![Dependencies: 0](https://img.shields.io/badge/dependencies-0-orange.svg)](package.json)
[![Version: 2.0](https://img.shields.io/badge/version-2.0-lightgrey.svg)](package.json)

[中文](README.md) · **[Live Playground & Browser Doctor (client-side)](https://blankym.github.io/inkbone/)** · 9 genre packs · Simplified + Traditional Chinese · 25 commands · Full MCP Server · VS Code Extension · 66 tests · zero dependencies

> **Language note:** Prompts, rule patterns, and CLI findings target **Chinese fiction**. This README documents the design and workflow in English.

Long-form LLM fiction usually breaks down around chapter 15:

- A setup planted in chapter 3 gets forgotten or spoiled in narration forty chapters later.
- Classical xianxia prose starts slipping in corporate jargon, impossible traditional time counts, or repetitive stock reactions.
- Subject-dropped Chinese action sentences silently switch actors right after another character's line.
- Ask a model to review its own draft and it often invents quotes that never appeared in the chapter while telling you to "add more sensory adjectives."

Prompting alone stops working once earlier rules fall out of context. InkBone separates drafting guidance (staged prompts) from deterministic checks (local Node scripts running regexes, lexicons, ledger boundaries, and continuity rules).

---

## See it work in 30 seconds

> **Want to try without cloning, or check a whole novel in your browser?** Open the **[Live Playground & Browser Doctor](https://blankym.github.io/inkbone/)** — pure client-side ES Modules with zero server uploads, supporting single-chapter inline `<mark>` highlights, auto Simplified/Traditional Chinese detection, one-click targeted rewrite prompts, **multi-chapter Browser Doctor (drop an entire `chapters/` folder for cross-chapter echo checks, Top 10 cliché rankings, auto-mined `ledger.json`, and platform `.txt` export)**, plus live `packet` / `check-ledger` / `verify-review` demos.

![InkBone Browser Playground: inline word-level highlights, rhythm strip, and one-click targeted rewrite prompt](docs/assets/playground-audit.png)

<details>
<summary>Expand Tab 4 screenshot: Browser Doctor multi-chapter checkup & platform exporter</summary>

![InkBone Browser Doctor: multi-chapter sorting, cross-chapter echo detection, Top 10 clichés, and auto-mined ledger](docs/assets/playground-book-doctor.png)

</details>

Save a 9-line sample chapter (`ch01.md`):

```markdown
子时三刻，药园的木门被人拍响。

陆青瞳孔骤缩，起身去开门。

门外站着执事孙岳，雨水落到他身上就散成白雾。孙岳没进门，把一块铁牌丢在桌上：

“寅时十刻之前，把渠里的符拔干净。”

孙岳转身靠在门柱上，合上了眼。从袖子里摸出一把小刀，挑开了渠边的泥。
```

Add a character roster (`ledger.json`):

```json
{ "characterNames": ["陆青", "孙岳"] }
```

Run `doctor` locally (no API key or `npm install` needed):

```bash
node bin/inkbone.mjs doctor ch01.md --genre classical-xianxia --ledger ledger.json --skip-length
```

Output:

```markdown
## ch01.md
- **L3**: `cliche_pupil_shrink` (瞳孔骤缩)
- **L7**: `reg_impossible_ke_count` (寅时十刻)
- **L9**: `subject_ambiguity` (previous actor 孙岳: 从袖子里摸出一把小刀，挑开了渠边的泥。)
```

- **Line 3**: flags a stock AI cliché in narration while leaving quoted dialogue alone.
- **Line 7**: catches a calendar error (a traditional *shichen* only has 8 *ke*, never 10).
- **Line 9**: tracks that the previous sentence opened with Sun Yue (`孙岳`), sees a subjectless action right after it, and warns that readers will read it as Sun Yue pulling the knife.

### Before / After in Practice

```markdown
Before (typical AI draft):
Forty-three-year-old veteran Zhou Jianmin ran the old-town delivery station and worried about cutting complaints before month-end. Taking a deep breath with a bitter smile, he pushed open the glass door so no one would see his unease.

After (cut resume dump, stock tics, and explanatory tail):
The complaint rate sat at 0.62%, well above the district cutoff. Zhou flattened the appeal sheets, pulled his yellow raincoat off the hook. Outside under the awning, Hu Fei tapped "decline" two rings into a dispatch alert.
```

### Reproducible Public Benchmark (4 Original Seeds)

Run `node scripts/run-public-eval.mjs` to reproduce [benchmarks/public-report.md](benchmarks/public-report.md) on the 4 original zero-copyright pairs in [benchmarks/eval-set/public-pairs.json](benchmarks/eval-set/public-pairs.json):

| Seed | Genre | Baseline (Errors / Warnings / Line Hits) | InkBone Revised (Errors / Warnings / Line Hits) |
| :--- | :--- | :---: | :---: |
| Herb Ditch (`xianxia-herb-ditch`) | `classical-xianxia` | 0 / 5 / 13 | 0 / 0 / 0 |
| Fog Harbor (`mystery-harbor-coroner`) | `mystery-thriller` | 1 / 5 / 12 | 0 / 0 / 0 |
| Delivery Station (`urban-delivery-station`) | `urban-realism` | 0 / 4 / 8 | 0 / 0 / 0 |
| Cooling-Off Day (`romance-cooling-off`) | `romance-emotional` | 0 / 3 / 14 | 0 / 0 / 0 |
| **Total (4 genres)** | — | **1 / 17 / 47** | **0 / 0 / 0** |

---

## Installation & Quickstart

Requires **Node.js 18+**. No `npm install` needed.

### Option 1: One-Line Agent Skill Install (Recommended)

`skills/inkbone/` follows the open `agentskills` layout and bundles `SKILL.md`, the CLI, configs, 8 stage prompts, and craft resources. Install directly into Claude Code, Codex, Cursor, or Antigravity:

```bash
npx skills add blankym/inkbone
```

Or copy manually offline:

```bash
git clone https://github.com/blankym/inkbone.git
cp -R inkbone/skills/inkbone <your-skills-dir>/inkbone
```

Once loaded, you can ask your agent directly:
- "Set up a mystery novel project with InkBone and generate `novel.json` and `ledger.json`."
- "Compile the chapter 12 packet from `ledger.json`, outline the scene beats, and settle the ledger once drafted."
- "Import `chapters/` into a ledger with auto-mined character names and run `doctor` across all volumes."

*(If your agent runtime blocks shell execution, the prompt stages in `prompts/` and `resources/` still work standalone; local checks simply won't run automatically.)*

### Option 2: Full Zero-Dependency MCP Server (Tools + Prompts + Resources) & Editor Integration

InkBone ships a **zero-dependency stdio MCP Server** exposing **9 structured tools** (including `inkbone_style_profile` & `inkbone_export`), **8 stage prompts** (`inkbone/beat-planner`, etc. — passing `genre` auto-attaches the matching playbook), and **11 read-only craft resources** (`inkbone://playbooks/<genre>`, micro-techniques, before/after cases). See [examples/mcp-config.json](examples/mcp-config.json):

```json
{
  "mcpServers": {
    "inkbone": {
      "command": "npx",
      "args": ["-y", "inkbone", "mcp"]
    }
  }
}
```

- For automatic post-edit chapter auditing in Claude Code, see [examples/claude-code-hooks.json](examples/claude-code-hooks.json).
- For real-time squiggly diagnostics and Quick Fixes inside **VS Code / Cursor**, see the standalone zero-dependency extension in [editors/vscode-inkbone/](editors/vscode-inkbone/).

### Option 3: Standalone CLI

```bash
# Run directly via npx (once published to npm) or install globally:
npx inkbone audit ch01.md --genre classical-xianxia --format md --skip-length

# Or run offline from git clone (no npm install required):
git clone https://github.com/blankym/inkbone.git
cd inkbone
node bin/inkbone.mjs --help       # Daily writing, revision & publishing commands
node bin/inkbone.mjs --help-all   # All 25 commands
```

Four common starting points:

1. **30-second chapter check & rewrite prompt (Simplified + Traditional Chinese auto-detected)**
   ```bash
   node bin/inkbone.mjs audit ch01.md --genre urban-realism --format md --lang en --no-project --no-ledger --skip-length
   node bin/inkbone.mjs rewrite-prompt ch01.md --genre urban-realism --lang en --no-project --no-ledger --skip-length
   ```
2. **Copyright-safe style profiling + living ledger loop**
   ```bash
   node bin/inkbone.mjs style-profile ./ref-samples --out ./my-novel/style.json
   node bin/inkbone.mjs init ./my-novel --genre classical-xianxia --title "BookTitle"
   node bin/inkbone.mjs packet --ledger ./my-novel/ledger.json --chapter 4 --prev ./my-novel/ch03.md
   node bin/inkbone.mjs settle --ledger ./my-novel/ledger.json --patch ./my-novel/ch04-settlement.json
   node bin/inkbone.mjs check-ledger ./my-novel/ledger.json --current 4
   ```
3. **Incremental long-form checkup (`--chapters` / `--changed`)**
   ```bash
   node bin/inkbone.mjs import-ledger ./my-novel/chapters --auto-characters --out ./my-novel/ledger.json --title "BookTitle"
   node bin/inkbone.mjs doctor ./my-novel/chapters --chapters 40-45 --lang en
   node bin/inkbone.mjs doctor ./my-novel/chapters --changed --lang en
   ```
4. **Export clean chapters for Chinese web-fiction platforms (`qidian`, `fanqie`, `qimao`, `jjwxc`)**
   ```bash
   node bin/inkbone.mjs export ./my-novel/chapters --platform qidian --out ./dist/qidian --merge-out ./dist/vol1.txt
   ```

---

## Workflow & Core Checks

The `prompts/` directory defines seven stages (`00`–`06`), with the CLI checking between stages:

1. **Register contract (`00-style-architect.md`)**: derives the book's genre pack, three-tier character voice matrix, and banned terms into `novel.json`.
2. **Beat plan (`01-beat-planner.md`)**: pulls context via `packet`, lays out information placement and scene beats, and pauses for author sign-off before drafting. `check-outline` verifies beat sheets against `[待补充]` placeholders and required dramatic elements.
3. **Drafting (`02-paratactic-renderer.md`)**: continues directly from the end of the prior chapter without copying beat-sheet prose verbatim.
4. **Local audit (`audit` / `doctor`)**: reports blocking errors and line-level warnings.
5. **Grounded review (`04`, `05` + `verify-review` / `review-save`)**:
   - `04-evidence-reviewer.md` checks plot continuity, timelines, physical logic, and character motivation.
   - `05-reader-simulator.md` runs two passes: a cold reader with zero lore background, and a genre veteran scanning for drag or register slips.
   - `verify-review` rejects any review item whose quote cannot be found verbatim in the chapter or whose feedback tries to meddle with prose aesthetics ("add sensory adjectives").
6. **Targeted revision (`03-targeted-rewriter.md`)**: edits only verified review items and flagged lines, then re-audits.
7. **Post-freeze scan (`detect`, optional)**: records one Zhuque AIGC scan after the chapter is locked.

### What it checks

| Area | Examples | Default level |
| :--- | :--- | :--- |
| Ledger continuity | Missing required anchors, premature spoilers before `revealChapter`, deprecated terms, opening echoing the prior ending | `error` (fails check) |
| Format & length claims | Markdown asterisks, inline ledger notes like `(余13滴)`, mismatched quote-length claims | `error` (fails check) |
| Model degeneration | Verbatim line/sentence loops, truncated endings, garbled characters, AI refusal/meta-leakage | `error` / `warning` |
| Subject continuity | Subjectless action right after another character's action; three consecutive paragraphs opening the same way | `warning` |
| Genre register | Modern slang in period settings, invalid traditional time counts, archaic phrasing in urban fiction | `warning` (escalates on high density) |
| Clichés & density | Stock micro-acting phrases, symmetric skeletons, excessive similes/exclamation marks/ellipses, telegraphic over-compression guard | `warning` (escalates on high density) |
| Statistical fingerprint | 20+ metrics (MATTR-50, sentence-length CV, `的`-modifier density) compared against human reference ranges | `info` (diagnostic only) |

Warnings exit `0` so authors review them in context; hard errors and high-frequency blocking violations exit non-zero for CI. Pass `--strict` to fail on all gates.

### Three-layer rules

`audit` and `doctor` walk upward from chapter files to find `novel.json` and merge three rule layers:

1. **Universal (`configs/`)**: clichés, filler phrases, dialogue punctuation, and syntax checks that apply across genres.
2. **Genre (`configs/genres.json`)**: 9 built-in genre packs catching cross-genre leakage.
3. **Project (`novel.json` + `.inkbone-whitelist`)**: book-specific vocabulary, banned patterns, literal whitelists, and `disabledRuleIds` to turn off any inherited rule you intentionally break.

Before promoting a rule above the project layer, run `rule-stats --human <human-corpus> --ai <ai-drafts>` to check how often human authors write the same pattern. Patterns common in human prose are stylistic choices and stay in project rules.

---

## Built-in Fiction Craft & Revision Library (`resources/`)

Beyond mechanical linting, InkBone ships practical plotting and editing handbooks distilled from classic fiction breakdowns and web-novel editorial standards (loaded on demand per stage so prompts stay lean):

- **[Micro-Techniques & Revision Lookup (`resources/micro_techniques.md`)](resources/micro_techniques.md)**: concrete execution formulas covering action-reaction "two-press, one-lift" beats, 80/20 climax framing (80% physical fallout and bystander benchmarks, 20% lethal strike), multi-purpose foreshadowing and pre-map-switch anchoring, post-climax three-part loot settlements, anti-bloat pacing rules, and a 9-symptom troubleshooting table.
- **[8 Before/After Case Studies (`resources/bad_vs_good_cases.md`)](resources/bad_vs_good_cases.md)**: side-by-side rewrites showing how to cut multi-step micro-action bloat, apply late-in/early-out dialogue, weave worldbuilding stakes into concrete characters, and avoid over-trimming into telegraphic prose.
- **[9 Genre Playbooks (`resources/genre_playbooks/`)](resources/genre_playbooks/)**: dedicated playbooks for xianxia, historical court, wuxia, mystery/thriller, urban realism, sci-fi wasteland, light fantasy, romance, and clean general fiction covering core tension drivers, stale trope traps, physical props, and chapter hooks.

---

## Genre Packs & Command Reference

<details>
<summary>9 built-in genre packs (run <code>node bin/inkbone.mjs genres</code> to inspect)</summary>

- `classical-xianxia`: classical cultivation and xianxia
- `historical-court`: historical intrigue and period drama
- `wuxia-jianghu`: traditional martial-arts fiction
- `mystery-thriller`: crime, folklore horror, and rule-based suspense
- `urban-realism`: contemporary urban, workplace, and realistic drama
- `scifi-wasteland`: sci-fi, cyberpunk, and post-apocalyptic survival
- `light-fantasy`: brisk light-novel / system comedy
- `romance-emotional`: historical and contemporary romance
- `general-clean`: neutral cross-genre baseline

</details>

| Group | Command | Purpose |
| :--- | :--- | :--- |
| Living ledger | `genres` | List all 9 built-in genre packs and default presets |
| | `init` | Scaffold `novel.json` and `ledger.json` in a project directory |
| | `import-ledger` | Scan existing chapters, heuristically mine candidate character names, and merge ledger non-destructively |
| | `packet` | Compile next-chapter context with un-revealed `fullTruth` hidden, closed foreshadowing filtered, and optional snapshot pruning |
| | `check-ledger` | Validate ledger health (duplicate/missing chapters, invalid reveal order, empty roster, overdue foreshadowing) |
| | `settle` | Non-destructively merge post-chapter settlement JSON into `ledger.json` with diff and health check |
| Format & QA | `normalize` | Deterministically clean bold/italic asterisks, dividers, and malformed ellipses/dashes |
| | `check-outline` | Check Stage 1 beat outlines for `[待补充]` placeholders and missing dramatic facets |
| | `audit` | Audit a single chapter (supports `--format md`, `--variant auto\|zh-hans\|zh-hant`, deceased-character guard) |
| | `doctor` | Full or incremental directory checkup (`--chapters 40-45` / `--changed`, preserving boundary echo checks) |
| | `rewrite-prompt` | Audit a chapter and emit a copy-ready targeted rewrite prompt for web LLMs |
| Style & publish | `style-profile` | Copyright-safe statistical style profile, nearest preset match & `customGates` generator |
| | `export` | Clean Markdown & format chapters for `qidian`, `fanqie`, `qimao`, or `jjwxc` (single files or merged volume) |
| Protocol | `mcp` | Start the zero-dependency stdio MCP server (9 tools, 8 prompts, 11 resources) |
| Review & blind eval | `verify-review` | Verify that review quotes exist verbatim in the chapter and reject style meddling |
| | `review-save` | Verify and archive a review JSON with chapter SHA-256 and reviewer/writer model metadata |
| | `review-stats` | Compare issue counts and skip points across saved review revisions |
| | `eval-pack` | Build an anonymized X/Y blind reading packet alongside a private `key.json` |
| | `eval-score` | Tally blind reader ballots with win rates, sign-test p-values, and skip-quote verification |
| Calibration & logs | `profile` | Compute 20+ linguistic fingerprint metrics for a chapter |
| | `calibrate` | Generate statistics-only p10/median/p90 reference ranges from a human corpus |
| | `rule-stats` | Measure per-rule hit rates per 10k characters across human vs. AI texts |
| | `mine` | Extract 3/4-gram phrases overused in AI drafts compared to human prose |
| | `detect` | Run a single cached Zhuque AIGC scan (requires `.env` API key), record-only |
| | `benchmark` | Compare corpus metrics against manifest entries |

Run `node bin/inkbone.mjs --help` for daily commands, or `--help-all` for all 25 commands.

---

## Layout & Development

```text
bin/  src/         CLI, zero-dependency core engine (style profiler, exporter, Browser Doctor) & full MCP server
configs/           Universal rules, 9 genre packs, Traditional Chinese layer, 4 platform presets, gates & zh/en catalog
docs/              Browser-only static playground & multi-chapter Browser Doctor
editors/           Standalone zero-dependency VS Code / Cursor real-time linter extension
examples/          MCP client config & Claude Code PostToolUse Hook templates
prompts/           8 staged drafting, review & settlement prompts (00–07)
resources/         Before/after examples, micro-techniques, 9 genre playbooks, eval guide
benchmarks/        4 original eval seeds, public eval pairs & reproducible comparison report (no private drafts)
evals/             Runtime-agnostic skill trigger eval set
skills/inkbone/    Generated self-contained skill package (do not edit directly)
tests/             66 unit tests
```

```bash
npm test               # Run all 66 tests (zero-Han-literal, full MCP, zh-hant, VS Code core, docs & skill sync)
npm run build:skill    # Repackage skills/inkbone after editing bin/src/configs/prompts/resources
npm run check:skill    # Verify skills/inkbone matches sources (enforced in CI)
npm run build:docs     # Sync browser playground docs/vendor after editing src/core or configs
npm run check:docs     # Verify docs/vendor matches sources (enforced in CI)
```

## Acknowledgments & License

- Chapter boundary isolation and verbatim-quote review checks inspired by [EthanYoQ/Pagekin](https://github.com/EthanYoQ/Pagekin)
- Chinese clause-trunk and symmetric-frame checks inspired by [LifelongLazyLearner/qu-ai-wei](https://github.com/LifelongLazyLearner/qu-ai-wei)
- Rhetorical density grading, degeneration detection, and meta-leak checks inspired by [zenstory-ai/oh-story-claudecode](https://github.com/zenstory-ai/oh-story-claudecode)
- Community & feedback: [GitHub Discussions](https://github.com/blankym/inkbone/discussions) · [Report False Positive / Propose Rule](https://github.com/blankym/inkbone/issues/new/choose) · [LINUX DO](https://linux.do/)

Released under the [MIT License](LICENSE), including all rule configurations.
