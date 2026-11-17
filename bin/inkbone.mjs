#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  profileText,
  auditChapterText,
  compileBoundaryPacket,
  validateEvidenceReview,
  runCorpusBenchmark,
  formatBenchmarkMarkdown,
  calibrateReference,
  mineOverusedPhrases,
  collectTextFiles,
  detectWithZhuque,
  listGenres,
  diagnoseProject,
  formatDoctorMarkdown,
  scaffoldProject,
  findProjectConfig,
  loadProjectConfig,
  importLedgerFromChapters,
  normalizeFiles,
  checkOutlineContract,
  computeRuleStats,
  formatRuleStatsMarkdown,
  buildBlindPack,
  writeBlindPack,
  scoreBallots,
  loadPairTexts,
  saveReview,
  summarizeReviews,
} from "../src/index.mjs";

const currentFile = fileURLToPath(import.meta.url);
const binDir = path.dirname(currentFile);
const rootDir = path.resolve(binDir, "..");

// 解析简单的命令行键值对标志参数
function parseFlags(args) {
  const positional = [];
  const flags = {};
  const multiValueKeys = new Set(["ai", "human", "vocab", "outline", "a", "b"]);
  const booleanKeys = new Set([
    "check",
    "strip-bold",
    "fix-emdash",
    "force",
    "json",
    "strict",
    "full",
    "skip-length",
    "no-ledger",
    "no-project",
    "no-cache",
    "all",
  ]);
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = args[i + 1];
      if (booleanKeys.has(key) || !next || next.startsWith("--")) {
        flags[key] = true;
      } else if (multiValueKeys.has(key)) {
        // 多值参数：一直读到下一个 -- 标志为止
        const values = [];
        while (i + 1 < args.length && !args[i + 1].startsWith("--")) {
          values.push(args[i + 1]);
          i += 1;
        }
        flags[key] = values;
      } else {
        flags[key] = next;
        i += 1;
      }
    } else {
      positional.push(token);
    }
  }
  return { positional, flags };
}

// 定位并加载书目录的项目配置：--project 显式指定，否则从目标文件向上找 novel.json；--no-project 关闭
function resolveProject(flags, targetPath) {
  if (flags["no-project"]) return null;
  let configPath = null;
  if (typeof flags.project === "string") {
    const explicit = path.resolve(flags.project);
    configPath =
      fs.existsSync(explicit) && fs.statSync(explicit).isDirectory()
        ? path.join(explicit, "novel.json")
        : explicit;
    if (!fs.existsSync(configPath)) {
      throw new Error(`Project config not found: ${configPath}`);
    }
  } else if (targetPath) {
    const abs = path.resolve(targetPath);
    const startDir =
      fs.existsSync(abs) && fs.statSync(abs).isDirectory() ? abs : path.dirname(abs);
    configPath = findProjectConfig(startDir);
  }
  if (!configPath) return null;
  const project = loadProjectConfig(configPath);
  console.error(`[inkbone] project config: ${project.path}`);
  return project;
}

// 动态发现 benchmarks 子目录下的 manifest.json 文件列表（去除单书硬编码）
function discoverBenchmarkEntries(explicitManifest = null) {
  if (explicitManifest) {
    const mPath = path.resolve(explicitManifest);
    if (!fs.existsSync(mPath)) return [];
    const parsed = JSON.parse(fs.readFileSync(mPath, "utf8"));
    return (parsed.entries || []).map((e) => ({
      ...e,
      path: path.resolve(path.dirname(mPath), e.file),
    }));
  }
  const benchRoot = path.resolve(rootDir, "benchmarks");
  if (!fs.existsSync(benchRoot)) return [];
  const results = [];
  for (const sub of fs.readdirSync(benchRoot, { withFileTypes: true })) {
    if (!sub.isDirectory()) continue;
    const mPath = path.resolve(benchRoot, sub.name, "manifest.json");
    if (!fs.existsSync(mPath)) continue;
    const parsed = JSON.parse(fs.readFileSync(mPath, "utf8"));
    for (const e of parsed.entries || []) {
      results.push({
        ...e,
        path: path.resolve(path.dirname(mPath), e.file),
      });
    }
  }
  return results;
}

// 打印 CLI 帮助指南
function printHelp() {
  const usage = [
    "InkBone CLI 1.1 - local checks for Chinese long-form fiction (continuity, genre register, stock phrases, unclear subjects)",
    "",
    "Rule layers: universal (configs/) -> genre pack -> project (novel.json found upward from the chapter:",
    "             inline projectRules, rulesFile, whitelistLiterals / .inkbone-whitelist, and ledgerFile).",
    "",
    "Commands:",
    "  inkbone genres                                    List built-in multi-genre register packs",
    "  inkbone init [dir] [--genre <id>] [--title <name>] [--force]",
    "                                                    Scaffold universal novel.json & ledger.json",
    "  inkbone doctor <file|dir>... [--genre <id>] [--outline <dir|file>...] [--ledger <ledger.json>] [--no-ledger]",
    "                 [--project <dir|novel.json>] [--no-project] [--json]",
    "                                                    Recursive multi-chapter checkup (errors, register, rhetoric, degeneration)",
    "  inkbone audit <file.md> [--genre <id>] [--preset <id>]",
    "                [--ledger <ledger.json> --chapter <n> --prev <prev.md> --skip-length] [--no-ledger]",
    "                [--outline-chapter <outline.md>] [--reference <reference.json>] [--strict]",
    "                [--project <dir|novel.json>] [--no-project]",
    "                                                    Run hard boundary, register, rhetoric, density & degeneration audit",
    "  inkbone packet --ledger <ledger.json> --chapter <n> [--prev <prev.md>]",
    "                                                    Compile hard-boundary context packet for drafting",
    "  inkbone import-ledger <file|dir>... [--merge <ledger.json>] [--out <ledger.json>] [--title <name>]",
    "                                                    Scan existing chapters and merge non-destructively into ledger",
    "  inkbone normalize <file|dir>... [--check] [--strip-bold] [--fix-emdash] [--project <dir|novel.json>] [--no-project]",
    "                                                    Deterministic formatting & pause-punctuation cleaner (zero LLM tokens)",
    "  inkbone check-outline <file|dir>...               Check chapter outlines for placeholders & required dramatic facets",
    "  inkbone verify-review <chapter.md> <review.json>  Verify verbatim quotes in logic & cold-reader reviews",
    "  inkbone review-save <chapter.md> <review.json> --kind <logic|reader> [--model <reviewer>] [--writer-model <writer>] [--dir <dir>] [--force]",
    "                                                    Verify then archive a review with the chapter hash (default <chapter dir>/_reviews)",
    "  inkbone review-stats <dir|file>... [--json]       Count archived review items by category and show the latest change",
    "  inkbone eval-pack --a <dir|file>... --b <dir|file>... --out <dir> [--label-a <name>] [--label-b <name>]",
    "                [--model-a <model>] [--model-b <model>] [--seed <n>]",
    "                                                    Build a blind A/B reading packet (packet/ for readers, key.json for you)",
    "  inkbone eval-score --key <key.json> <ballot.json>... [--json]",
    "                                                    Tally blind ballots: wins, ties, sign-test p, skim marks",
    "  inkbone profile <file.md> [--full]                Measure 20+ linguistic fingerprint metrics",
    "  inkbone calibrate <dir|file>... [--out <ref.json>] [--label <name>]",
    "                                                    Build a human reference range (statistics only)",
    "  inkbone rule-stats --human <dir|file>... --ai <dir|file>... [--genre <id>] [--project <dir>] [--json] [--all]",
    "                                                    Per-rule hits per 10k chars in human vs AI text (taste vs AI marker)",
    "  inkbone mine --ai <dir|file>... --human <dir|file>... [--vocab <dir|file>...] [--top <n>]",
    "                                                    Mine phrases overused in AI drafts vs human prose",
    "  inkbone detect <chapter.md> [--lines <start-end>] [--threshold <0.5>] [--no-cache]",
    "                                                    Single-call cached Zhuque scan (final step only)",
    "  inkbone benchmark [--json] [--corpus <corpus.json>] [--manifest <manifest.json>]",
  ];
  console.log(usage.join("\n"));
}

// 主命令行调度逻辑
async function main() {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.length === 0 || rawArgs.includes("--help") || rawArgs.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  const [command, ...rest] = rawArgs;
  const { positional, flags } = parseFlags(rest);

  if (command === "genres") {
    console.log(JSON.stringify(listGenres(), null, 2));
    return;
  }

  if (command === "init") {
    const targetDir = positional[0] || ".";
    const res = scaffoldProject(targetDir, {
      genre: typeof flags.genre === "string" ? flags.genre : undefined,
      title: typeof flags.title === "string" ? flags.title : undefined,
      presetName: typeof flags.preset === "string" ? flags.preset : undefined,
      force: Boolean(flags.force),
    });
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (command === "doctor") {
    if (positional.length === 0) {
      console.error("Error: Provide at least one <file.md> or <directory> for doctor.");
      process.exit(2);
    }
    const project = resolveProject(flags, positional[0]);
    const ledgerPath = flags.ledger
      ? path.resolve(flags.ledger)
      : !flags["no-ledger"] && project?.ledgerFile && fs.existsSync(project.ledgerFile)
        ? project.ledgerFile
        : null;
    const ledger = ledgerPath
      ? JSON.parse(fs.readFileSync(ledgerPath, "utf8"))
      : null;
    const diagnosis = diagnoseProject(positional, {
      genre:
        typeof flags.genre === "string" ? flags.genre : project?.genre || undefined,
      presetName:
        typeof flags.preset === "string" ? flags.preset : project?.preset || undefined,
      projectRules: project ? project.rules : null,
      genreSource:
        typeof flags.genre !== "string" && project?.genre ? "project" : undefined,
      outlinePaths: flags.outline || [],
      ledger,
      chapterNumber: flags.chapter ? Number(flags.chapter) : null,
      skipLengthGate: Boolean(flags["skip-length"]),
    });
    if (flags.json) {
      console.log(JSON.stringify(diagnosis, null, 2));
    } else {
      console.log(formatDoctorMarkdown(diagnosis));
    }
    process.exitCode = diagnosis.pass ? 0 : 1;
    return;
  }

  if (command === "profile") {
    const filePath = positional[0];
    if (!filePath) {
      console.error("Error: Missing <file.md> argument for profile.");
      process.exit(2);
    }
    const text = fs.readFileSync(path.resolve(filePath), "utf8");
    const result = profileText(text);
    console.log(
      JSON.stringify(
        flags.full ? result : { file: path.basename(filePath), ...result.metrics },
        null,
        2
      )
    );
    return;
  }

  if (command === "audit") {
    const filePath = positional[0];
    if (!filePath) {
      console.error("Error: Missing <file.md> argument for audit.");
      process.exit(2);
    }
    const text = fs.readFileSync(path.resolve(filePath), "utf8");
    const project = resolveProject(flags, filePath);
    const ledgerPath = flags.ledger
      ? path.resolve(flags.ledger)
      : !flags["no-ledger"] && project?.ledgerFile && fs.existsSync(project.ledgerFile)
        ? project.ledgerFile
        : null;
    const ledger = ledgerPath
      ? JSON.parse(fs.readFileSync(ledgerPath, "utf8"))
      : null;
    const prevText = flags.prev
      ? fs.readFileSync(path.resolve(flags.prev), "utf8")
      : "";
    let outlineText = "";
    if (typeof flags["outline-chapter"] === "string") {
      const outlinePath = path.resolve(flags["outline-chapter"]);
      if (!fs.existsSync(outlinePath)) {
        console.error(`Error: Outline file not found: ${outlinePath}`);
        process.exit(2);
      }
      outlineText = fs.readFileSync(outlinePath, "utf8");
    }
    const report = auditChapterText(text, {
      genre: typeof flags.genre === "string" ? flags.genre : project?.genre || null,
      presetName:
        typeof flags.preset === "string" ? flags.preset : project?.preset || null,
      projectRules: project ? project.rules : null,
      ledger,
      chapterNumber: flags.chapter ? Number(flags.chapter) : null,
      previousChapterText: prevText,
      outlineText,
      skipLengthGate: Boolean(flags["skip-length"]),
      strict: Boolean(flags.strict),
      reference: flags.reference
        ? JSON.parse(fs.readFileSync(path.resolve(flags.reference), "utf8"))
        : null,
    });

    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.pass ? 0 : 1;
    return;
  }

  if (command === "packet") {
    if (!flags.ledger || !flags.chapter) {
      console.error("Error: --ledger and --chapter are required for packet.");
      process.exit(2);
    }
    const ledger = JSON.parse(
      fs.readFileSync(path.resolve(flags.ledger), "utf8")
    );
    const prevText = flags.prev
      ? fs.readFileSync(path.resolve(flags.prev), "utf8")
      : "";
    const packet = compileBoundaryPacket(ledger, Number(flags.chapter), prevText);
    console.log(JSON.stringify(packet, null, 2));
    return;
  }

  if (command === "verify-review") {
    const [chapterPath, reviewPath] = positional;
    if (!chapterPath || !reviewPath) {
      console.error("Error: Provide both <chapter.md> and <review.json>.");
      process.exit(2);
    }
    const chapterText = fs.readFileSync(path.resolve(chapterPath), "utf8");
    const reviewJson = JSON.parse(
      fs.readFileSync(path.resolve(reviewPath), "utf8")
    );
    const validation = validateEvidenceReview(chapterText, reviewJson);
    console.log(JSON.stringify(validation, null, 2));
    process.exitCode = validation.valid ? 0 : 1;
    return;
  }

  if (command === "calibrate") {
    const files = collectTextFiles(positional);
    if (files.length === 0) {
      console.error("Error: No .md/.txt files found for calibrate.");
      process.exit(2);
    }
    const texts = files.map((f) => fs.readFileSync(f, "utf8"));
    const reference = calibrateReference(texts, { label: flags.label || "" });
    const output = JSON.stringify(reference, null, 2);
    if (flags.out) {
      fs.writeFileSync(path.resolve(flags.out), output + "\n");
      console.error(`Wrote ${reference.sampleCount} samples to ${flags.out} (reliable: ${reference.reliable})`);
    } else {
      console.log(output);
    }
    return;
  }

  if (command === "review-save") {
    const [chapterPath, reviewPath] = positional;
    if (!chapterPath || !reviewPath) {
      console.error("Error: Provide both <chapter.md> and <review.json>.");
      process.exit(2);
    }
    const payload = JSON.parse(fs.readFileSync(path.resolve(reviewPath), "utf8"));
    const result = saveReview(path.resolve(chapterPath), payload, {
      kind: typeof flags.kind === "string" ? flags.kind : "review",
      dir: typeof flags.dir === "string" ? path.resolve(flags.dir) : undefined,
      force: Boolean(flags.force),
      reviewerModel: typeof flags.model === "string" ? flags.model : null,
      writerModel: typeof flags["writer-model"] === "string" ? flags["writer-model"] : null,
    });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.saved ? 0 : 1;
    return;
  }

  if (command === "review-stats") {
    const inputs = positional.length > 0 ? positional : ["."];
    const files = [];
    const walk = (p) => {
      const abs = path.resolve(p);
      if (!fs.existsSync(abs)) return;
      if (fs.statSync(abs).isDirectory()) {
        for (const entry of fs.readdirSync(abs)) walk(path.join(abs, entry));
      } else if (abs.endsWith(".json")) {
        files.push(abs);
      }
    };
    inputs.forEach(walk);
    const stats = summarizeReviews(files);
    if (flags.json) {
      console.log(JSON.stringify(stats, null, 2));
    } else {
      for (const r of stats.records) {
        const models = `reviewer=${r.reviewerModel || "?"} writer=${r.writerModel || "?"}`;
        console.log(`${r.savedAt}  ${r.chapter}  ${r.kind}  ${models}  ${JSON.stringify(r.counts)}`);
      }
      for (const t of stats.trends) {
        const notes = [t.textChanged ? "" : "text unchanged", t.reviewerChanged ? "reviewer model changed" : ""].filter(Boolean).join(", ");
        console.log(`trend ${t.chapter} ${t.kind}: ${JSON.stringify(t.delta)}${notes ? ` (${notes})` : ""}`);
      }
    }
    return;
  }

  if (command === "eval-pack") {
    const aFiles = collectTextFiles([].concat(flags.a || []));
    const bFiles = collectTextFiles([].concat(flags.b || []));
    if (aFiles.length === 0 || bFiles.length === 0 || typeof flags.out !== "string") {
      console.error("Error: eval-pack needs --a, --b and --out.");
      process.exit(2);
    }
    const pack = buildBlindPack(aFiles, bFiles, {
      seed: flags.seed ? Number(flags.seed) : undefined,
      labelA: typeof flags["label-a"] === "string" ? flags["label-a"] : "A",
      labelB: typeof flags["label-b"] === "string" ? flags["label-b"] : "B",
      modelA: typeof flags["model-a"] === "string" ? flags["model-a"] : null,
      modelB: typeof flags["model-b"] === "string" ? flags["model-b"] : null,
    });
    if (pack.pairs.length === 0) {
      console.error("Error: No chapter pairs matched between --a and --b (match by the first number in file names).");
      process.exit(2);
    }
    const instructionsPath = path.resolve(rootDir, "resources/eval/blind-read-instructions.md");
    const written = writeBlindPack(pack, path.resolve(flags.out), {
      instructions: fs.existsSync(instructionsPath) ? fs.readFileSync(instructionsPath, "utf8") : "",
    });
    console.log(JSON.stringify({ ...written, seed: pack.seed, unpaired: pack.unpaired }, null, 2));
    return;
  }

  if (command === "eval-score") {
    if (typeof flags.key !== "string" || positional.length === 0) {
      console.error("Error: eval-score needs --key <key.json> and at least one ballot.json.");
      process.exit(2);
    }
    const key = JSON.parse(fs.readFileSync(path.resolve(flags.key), "utf8"));
    const ballots = positional.map((f) => JSON.parse(fs.readFileSync(path.resolve(f), "utf8")));
    const score = scoreBallots(key, ballots, { texts: loadPairTexts(key) });
    console.log(JSON.stringify(score, null, 2));
    return;
  }

  if (command === "rule-stats") {
    const humanFiles = collectTextFiles([].concat(flags.human || []));
    const aiFiles = collectTextFiles([].concat(flags.ai || []));
    if (humanFiles.length === 0 || aiFiles.length === 0) {
      console.error("Error: rule-stats needs both --human and --ai inputs.");
      process.exit(2);
    }
    const project = resolveProject(flags, aiFiles[0]);
    const read = (f) => fs.readFileSync(f, "utf8");
    const stats = computeRuleStats(humanFiles.map(read), aiFiles.map(read), {
      genre: typeof flags.genre === "string" ? flags.genre : project?.genre || null,
      projectRules: project ? project.rules : null,
    });
    if (flags.json) {
      console.log(JSON.stringify(stats, null, 2));
    } else {
      console.log(formatRuleStatsMarkdown(stats, { all: Boolean(flags.all) }));
    }
    return;
  }

  if (command === "mine") {
    const aiFiles = collectTextFiles([].concat(flags.ai || []));
    const humanFiles = collectTextFiles([].concat(flags.human || []));
    if (aiFiles.length === 0 || humanFiles.length === 0) {
      console.error("Error: mine needs both --ai and --human inputs.");
      process.exit(2);
    }
    const read = (f) => fs.readFileSync(f, "utf8");
    const vocabFiles = collectTextFiles([].concat(flags.vocab || []));
    const result = mineOverusedPhrases(aiFiles.map(read), humanFiles.map(read), {
      vocabTexts: vocabFiles.map(read),
      top: flags.top ? Number(flags.top) : undefined,
      minRatio: flags["min-ratio"] ? Number(flags["min-ratio"]) : undefined,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "detect") {
    const filePath = positional[0];
    if (!filePath) {
      console.error("Error: Missing <file.md> argument for detect.");
      process.exit(2);
    }
    const absPath = path.resolve(filePath);
    const text = fs.readFileSync(absPath, "utf8");
    let lineRange = null;
    if (typeof flags.lines === "string" && flags.lines.includes("-")) {
      const [s, e] = flags.lines.split("-").map((n) => Number(n.trim()));
      if (Number.isFinite(s) && Number.isFinite(e) && s >= 1 && e >= s) {
        lineRange = [s, e];
      }
    }
    const report = await detectWithZhuque(text, {
      startDir: path.dirname(absPath),
      lineRange,
      noCache: Boolean(flags["no-cache"]),
      threshold: flags.threshold ? Number(flags.threshold) : 0.5,
    });
    const output = flags.full
      ? report
      : {
          file: path.basename(absPath),
          pass: report.pass,
          cached: report.cached,
          lineSpan: report.lineSpan,
          inputChars: report.inputChars,
          tokenUsage: report.tokenUsage,
          humanPct: report.humanPct,
          suspectedPct: report.suspectedPct,
          aiPct: report.aiPct,
          softmaxConfidence: report.softmaxConfidence,
          segments: report.segments,
          flaggedWindowCount: report.flaggedWindowCount,
          flaggedWindows: report.flaggedWindows,
          fineWindows: report.fineWindows.map((w) => ({
            order: w.order,
            lines: `${w.startLine}-${w.endLine}`,
            aigc: w.aigc,
            preview: w.preview,
          })),
        };
    console.log(JSON.stringify(output, null, 2));
    process.exit(report.pass ? 0 : 1);
  }

  if (command === "benchmark") {
    const extraFiles = discoverBenchmarkEntries(
      typeof flags.manifest === "string" ? flags.manifest : null
    );
    const rows = runCorpusBenchmark({ extraFiles, corpusPath: flags.corpus || null });
    if (flags.json) {
      console.log(JSON.stringify(rows, null, 2));
    } else {
      console.log(formatBenchmarkMarkdown(rows));
    }
    return;
  }

  if (command === "import-ledger") {
    if (positional.length === 0) {
      console.error(
        "Error: Provide at least one <file.md> or <directory> for import-ledger."
      );
      process.exit(2);
    }
    const mergeFlag =
      typeof flags.merge === "string"
        ? flags.merge
        : typeof flags.ledger === "string"
          ? flags.ledger
          : null;
    let existingLedger = null;
    if (mergeFlag) {
      const mergePath = path.resolve(mergeFlag);
      if (!fs.existsSync(mergePath)) {
        console.error(`Error: Merge ledger file not found: ${mergePath}`);
        process.exit(2);
      }
      existingLedger = JSON.parse(fs.readFileSync(mergePath, "utf8"));
    }
    const imported = importLedgerFromChapters(positional, {
      existingLedger,
      projectTitle: typeof flags.title === "string" ? flags.title : undefined,
    });
    if (typeof flags.out === "string") {
      const outPath = path.resolve(flags.out);
      fs.writeFileSync(outPath, JSON.stringify(imported.ledger, null, 2) + "\n");
      console.log(
        JSON.stringify({ out: outPath, stats: imported.stats }, null, 2)
      );
    } else {
      console.log(JSON.stringify(imported, null, 2));
    }
    return;
  }

  if (command === "normalize") {
    if (positional.length === 0) {
      console.error(
        "Error: Provide at least one <file.md> or <directory> for normalize."
      );
      process.exit(2);
    }
    const project = resolveProject(flags, positional[0]);
    const report = normalizeFiles(positional, {
      check: Boolean(flags.check),
      stripMarkdownEmphasis: Boolean(flags["strip-bold"]),
      fixNarrationEmDash: Boolean(flags["fix-emdash"]),
      whitelistLiterals: project?.rules?.whitelistLiterals || [],
    });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.pass ? 0 : 1;
    return;
  }

  if (command === "check-outline") {
    if (positional.length === 0) {
      console.error(
        "Error: Provide at least one <outline.md> or <directory> for check-outline."
      );
      process.exit(2);
    }
    const files = collectTextFiles(positional);
    if (files.length === 0) {
      console.error("Error: No .md or .txt outline files found.");
      process.exit(2);
    }
    const results = files.map((absPath) => {
      const text = fs.readFileSync(absPath, "utf8");
      const check = checkOutlineContract(text);
      return {
        file: path.basename(absPath),
        path: absPath,
        ...check,
      };
    });
    const allPass = results.every((r) => r.pass);
    console.log(
      JSON.stringify(
        {
          pass: allPass,
          filesScanned: results.length,
          failingCount: results.filter((r) => !r.pass).length,
          files: results,
        },
        null,
        2
      )
    );
    process.exitCode = allPass ? 0 : 1;
    return;
  }

  console.error(`Unknown command: "${command}"`);
  printHelp();
  process.exit(2);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
