# InkBone

**A persistent ledger, style contract, and zero-dependency local QA CLI for writing Chinese long-form fiction with LLMs.**

[![test](https://github.com/blankym/inkbone/actions/workflows/test.yml/badge.svg)](https://github.com/blankym/inkbone/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js ≥ 18](https://img.shields.io/badge/Node.js-%E2%89%A518-brightgreen.svg)](https://nodejs.org)
[![Dependencies: 0](https://img.shields.io/badge/dependencies-0-orange.svg)](package.json)
[![Version: 1.3](https://img.shields.io/badge/version-1.3-lightgrey.svg)](package.json)

[中文](README.md) · **[Live Browser Playground (client-side)](https://blankym.github.io/inkbone/)** · 9 genre packs · 23 commands · Zero-dep MCP server · 58 tests · zero external dependencies

> **Language note:** Prompts, rule patterns, and CLI findings target **Chinese fiction**. This README documents the design and workflow in English.

Long-form LLM fiction usually breaks down around chapter 15:

- A setup planted in chapter 3 gets forgotten or spoiled in narration forty chapters later.
- Classical xianxia prose starts slipping in corporate jargon, impossible traditional time counts, or repetitive stock reactions.
- Subject-dropped Chinese action sentences silently switch actors right after another character's line.
- Ask a model to review its own draft and it often invents quotes that never appeared in the chapter while telling you to "add more sensory adjectives."

Prompting alone stops working once earlier rules fall out of context. InkBone separates drafting guidance (staged prompts) from deterministic checks (local Node scripts running regexes, lexicons, ledger boundaries, and continuity rules).

---

## See it work in 30 seconds

> **Want to try without cloning, or drafting directly in web LLMs?** Open the **[Live Browser Playground](https://blankym.github.io/inkbone/)** — pure browser-side ES Modules running the exact engine locally with zero server uploads, including local `.md`/`.txt` drag-and-drop, inline `<mark>` highlighting, paragraph rhythm strips, **one-click copy of targeted rewrite prompts**, and live `packet` / `check-ledger` / `verify-review` demos.

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

### Option 2: Zero-Dependency MCP Server & Claude Code Hooks

InkBone ships a **zero-dependency stdio MCP Server** exposing 7 structured tools (`inkbone_packet`, `inkbone_audit`, `inkbone_doctor`, `inkbone_normalize`, `inkbone_verify_review`, `inkbone_check_ledger`, `inkbone_settle`) for Claude Desktop, Cursor, Antigravity, and Codex (see [examples/mcp-config.json](examples/mcp-config.json)):

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

For automatic post-edit chapter auditing in Claude Code, see [examples/claude-code-hooks.json](examples/claude-code-hooks.json).

### Option 3: Standalone CLI

```bash
# Run directly via npx (once published to npm) or install globally:
npx inkbone audit ch01.md --genre classical-xianxia --format md --skip-length

# Or run offline from git clone (no npm install required):
git clone https://github.com/blankym/inkbone.git
cd inkbone
node bin/inkbone.mjs --help       # Daily writing & revision commands
node bin/inkbone.mjs --help-all   # All 23 commands
```

Three common starting points:

1. **No setup? 30-second standalone chapter check & targeted rewrite prompt**
   ```bash
   node bin/inkbone.mjs audit ch01.md --genre urban-realism --format md --lang en --no-project --no-ledger --skip-length
   node bin/inkbone.mjs rewrite-prompt ch01.md --genre urban-realism --lang en --no-project --no-ledger --skip-length
   ```
2. **Starting a new book with post-chapter ledger settlement**
   ```bash
   node bin/inkbone.mjs init ./my-novel --genre classical-xianxia --title "BookTitle"
   # Build next-chapter context with un-revealed secrets masked out & due foreshadowing surfaced
   node bin/inkbone.mjs packet --ledger ./my-novel/ledger.json --chapter 4 --prev ./my-novel/ch03.md
   # Merge post-chapter settlement updates and check ledger health
   node bin/inkbone.mjs settle --ledger ./my-novel/ledger.json --patch ./my-novel/ch04-settlement.json
   node bin/inkbone.mjs check-ledger ./my-novel/ledger.json --current 4
   ```
3. **Taking over an existing draft**
   ```bash
   # Scan existing chapters, auto-mine candidate character names for subject-ambiguity checks, and merge ledger
   node bin/inkbone.mjs import-ledger ./my-novel/chapters --auto-characters --out ./my-novel/ledger.json --title "BookTitle"
   # Run a full directory checkup sorted by chapter number (--lang zh|en)
   node bin/inkbone.mjs doctor ./my-novel/chapters --lang en
   # Strip leftover Markdown bold/dividers and malformed ellipses deterministically (zero LLM tokens)
   node bin/inkbone.mjs normalize ./my-novel/chapters --strip-bold
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
| | `audit` | Audit a single chapter (supports `--format md --lang zh|en` or raw JSON) |
| | `doctor` | Recursively scan a directory sorted by chapter number, auto-detecting genre and project config |
| | `rewrite-prompt` | Audit a chapter and emit a copy-ready targeted rewrite prompt for web LLMs |
| Protocol | `mcp` | Start the zero-dependency JSON-RPC 2.0 stdio MCP server (7 structured tools) |
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

Run `node bin/inkbone.mjs --help` for daily commands, or `--help-all` for all 23 commands.

---

## Layout & Development

```text
bin/  src/         CLI, zero-dependency core engine & stdio MCP server
configs/           Universal rules, 9 genre packs, presets, severity levels & zh/en message catalog
docs/              Browser-only static playground (zero-dependency core)
examples/          MCP client config & Claude Code PostToolUse Hook templates
prompts/           8 staged drafting, review & settlement prompts (00–07)
resources/         Before/after examples, micro-techniques, 9 genre playbooks, eval guide
benchmarks/        4 blind-eval opening seeds + chapter-1 test log (private drafts omitted)
evals/             Runtime-agnostic skill trigger eval set
skills/inkbone/    Generated self-contained skill package (do not edit directly)
tests/             58 unit tests
```

```bash
npm test               # Run all 58 tests (includes zero-Han-literal, MCP, docs sync, and skill sync checks; 1 private-corpus test auto-skips)
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
